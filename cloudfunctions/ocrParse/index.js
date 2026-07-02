/**
 * cloudfunctions/ocrParse/index.js
 * OCR体检单三段式解析云函数
 *
 * 流程：
 *   1. 下载云存储图片转base64
 *   2. 调腾讯云GeneralAccurateOCR识别全文
 *   3. 豆包2.1 Pro结构化提取为metrics + _parse_meta
 *   4. 降级：OCR置信度<0.6 提示手动录入
 *
 * 入参：{ fileID: string, age_months?: number }
 * 返回：{ success, metrics, ocr_raw, parse_meta, need_manual }
 */

const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const { ocr } = require('tencentcloud-sdk-nodejs-ocr')
const { chatCompletion, buildSchema } = require('./lib/arkClient')

const OcrClient = ocr.v20181119.Client

// OCR结构化提取的JSON Schema（与exams.metrics结构一致）
// 覆盖国家标准《0-6岁儿童健康检查记录表》三类表单 + 通用体检报告
const METRICS_SCHEMA = buildSchema('exam_metrics_extraction', {
  type: 'object',
  properties: {
    growth: {
      type: 'object',
      properties: {
        height: { type: ['number', 'null'], description: '身高/身长(cm)' },
        weight: { type: ['number', 'null'], description: '体重(kg)' },
        head_circ: { type: ['number', 'null'], description: '头围(cm)' },
        chest_circ: { type: ['number', 'null'], description: '胸围(cm)' },
        evaluation: { type: ['string', 'null'], description: '体格发育评价，如"上""中""下"或"正常""低体重""消瘦""生长迟缓""超重"' }
      },
      required: ['height', 'weight', 'head_circ', 'chest_circ', 'evaluation'],
      additionalProperties: false
    },
    vision: {
      type: 'object',
      properties: {
        left: { type: ['number', 'null'], description: '左眼裸眼视力(5分记录法)，3岁以下婴幼儿表单无此项则填null' },
        right: { type: ['number', 'null'], description: '右眼裸眼视力(5分记录法)，3岁以下婴幼儿表单无此项则填null' },
        corrected_left: { type: ['number', 'null'], description: '左眼矫正视力' },
        corrected_right: { type: ['number', 'null'], description: '右眼矫正视力' }
      },
      required: ['left', 'right', 'corrected_left', 'corrected_right'],
      additionalProperties: false
    },
    hearing: {
      type: 'object',
      properties: {
        left: { type: ['string', 'null'], description: '左耳听力，如"正常"或"异常"。表单只有单值时填到result，此处填null' },
        right: { type: ['string', 'null'], description: '右耳听力，如"正常"或"异常"。表单只有单值时填到result，此处填null' },
        result: { type: ['string', 'null'], description: '听力筛查结果，如"通过""未通过""未测"。婴幼儿表单听力为单值时填此字段' }
      },
      required: ['left', 'right', 'result'],
      additionalProperties: false
    },
    dental: {
      type: 'object',
      properties: {
        caries_count: { type: ['number', 'null'], description: '龋齿数量(颗)' },
        caries_teeth: { type: ['string', 'null'], description: '龋齿牙位描述' },
        teeth_count: { type: ['number', 'null'], description: '出牙数(颗)' }
      },
      required: ['caries_count', 'caries_teeth', 'teeth_count'],
      additionalProperties: false
    },
    blood: {
      type: 'object',
      properties: {
        hemoglobin: { type: ['number', 'null'], description: '血红蛋白(g/L)' },
        rbc: { type: ['number', 'null'], description: '红细胞计数(10^12/L)' },
        wbc: { type: ['number', 'null'], description: '白细胞计数(10^9/L)' },
        platelet: { type: ['number', 'null'], description: '血小板计数(10^9/L)' }
      },
      required: ['hemoglobin', 'rbc', 'wbc', 'platelet'],
      additionalProperties: false
    },
    urine: {
      type: 'object',
      properties: {
        protein: { type: ['string', 'null'], description: '尿蛋白，如"阴性""+"' },
        sugar: { type: ['string', 'null'], description: '尿糖，如"阴性""+"' },
        specific_gravity: { type: ['number', 'null'], description: '尿比重' }
      },
      required: ['protein', 'sugar', 'specific_gravity'],
      additionalProperties: false
    },
    spine: {
      type: 'object',
      properties: {
        adams_test: { type: ['string', 'null'], description: 'Adams前屈试验，"阴性"或"阳性"' },
        shoulder_balance: { type: ['string', 'null'], description: '肩平衡，"对称"或"不对称"' }
      },
      required: ['adams_test', 'shoulder_balance'],
      additionalProperties: false
    },
    internal: {
      type: 'object',
      properties: {
        heart: { type: ['string', 'null'], description: '心脏检查结果' },
        lung: { type: ['string', 'null'], description: '肺部检查结果' },
        abdomen: { type: ['string', 'null'], description: '腹部检查结果' },
        note: { type: ['string', 'null'], description: '其他内科备注' }
      },
      required: ['heart', 'lung', 'abdomen', 'note'],
      additionalProperties: false
    },
    development: {
      type: 'object',
      description: '发育评估（预警征筛查）。国家标准表单每个月龄有4条预警征，勾选表示阳性',
      properties: {
        screening_result: { type: ['string', 'null'], description: '预警征筛查结果："正常"(无阳性项)或"阳性"(有任一项勾选)' },
        positive_items: { type: ['string', 'null'], description: '阳性的预警征条目内容，分号分隔，如"不会独坐;不会区分生人和熟人"。无阳性则填null' }
      },
      required: ['screening_result', 'positive_items'],
      additionalProperties: false
    },
    rickets: {
      type: 'object',
      description: '佝偻病筛查（症状+体征）',
      properties: {
        symptoms: { type: ['string', 'null'], description: '可疑佝偻病症状，如"无"或"夜惊,多汗,烦躁"' },
        signs: { type: ['string', 'null'], description: '可疑佝偻病体征，如"无"或"肋串珠,方颅"' }
      },
      required: ['symptoms', 'signs'],
      additionalProperties: false
    },
    physical: {
      type: 'object',
      description: '体格检查（一般项目），国家标准表单中"未见异常/异常"类检查项',
      properties: {
        complexion: { type: ['string', 'null'], description: '面色，如"红润""黄染""其他"' },
        skin: { type: ['string', 'null'], description: '皮肤，"未见异常"或异常描述' },
        eyes: { type: ['string', 'null'], description: '眼睛，"未见异常"或异常描述' },
        ears: { type: ['string', 'null'], description: '耳外观，"未见异常"或异常描述' },
        anterior_fontanelle: { type: ['string', 'null'], description: '前囟，如"闭合"或"未闭 1.5cm×1.5cm"' },
        neck_mass: { type: ['string', 'null'], description: '颈部包块，"有"或"无"' },
        chest: { type: ['string', 'null'], description: '胸部，"未见异常"或异常描述' },
        abdomen: { type: ['string', 'null'], description: '腹部，"未见异常"或异常描述' },
        limbs: { type: ['string', 'null'], description: '四肢，"未见异常"或异常描述' },
        umbilicus: { type: ['string', 'null'], description: '脐部，如"未脱""脱落""脐部有渗出""其他"' },
        gait: { type: ['string', 'null'], description: '步态，"未见异常"或异常描述' },
        anus_genitalia: { type: ['string', 'null'], description: '肛门/外生殖器，"未见异常"或异常描述' },
        outdoor_activity: { type: ['number', 'null'], description: '户外活动(小时/日)' },
        vitamin_d: { type: ['number', 'null'], description: '服用维生素D(IU/日)' }
      },
      required: ['complexion', 'skin', 'eyes', 'ears', 'anterior_fontanelle', 'neck_mass', 'chest', 'abdomen', 'limbs', 'umbilicus', 'gait', 'anus_genitalia', 'outdoor_activity', 'vitamin_d'],
      additionalProperties: false
    },
    _parse_meta: {
      type: 'object',
      properties: {
        confidence: { type: 'number', description: '整体提取置信度0-1' },
        uncertain_fields: {
          type: 'array',
          items: { type: 'string' },
          description: '不确定的字段路径列表，如["growth.height","blood.hemoglobin"]'
        },
        raw_snippets: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              field: { type: 'string', description: '字段路径' },
              snippet: { type: 'string', description: 'OCR原文片段' }
            },
            required: ['field', 'snippet'],
            additionalProperties: false
          },
          description: '各字段对应的OCR原文片段'
        }
      },
      required: ['confidence', 'uncertain_fields', 'raw_snippets'],
      additionalProperties: false
    }
  },
  required: ['growth', 'vision', 'hearing', 'dental', 'blood', 'urine', 'spine', 'internal', 'development', 'rickets', 'physical', '_parse_meta'],
  additionalProperties: false
})

// 年龄→列名映射表（国家标准0-6岁儿童健康检查记录表）
const AGE_COLUMN_MAP = [
  { max_months: 1, label: '满月' },
  { max_months: 3, label: '3月龄' },
  { max_months: 6, label: '6月龄' },
  { max_months: 8, label: '8月龄' },
  { max_months: 12, label: '12月龄' },
  { max_months: 18, label: '18月龄' },
  { max_months: 24, label: '24月龄' },
  { max_months: 30, label: '30月龄' },
  { max_months: 42, label: '3岁' },
  { max_months: 54, label: '4岁' },
  { max_months: 66, label: '5岁' },
  { max_months: 78, label: '6岁' }
]

/**
 * 根据月龄推断体检表单中应提取的列名
 */
function inferTargetColumn(ageMonths) {
  if (ageMonths == null) return null
  for (const entry of AGE_COLUMN_MAP) {
    if (ageMonths <= entry.max_months) return entry.label
  }
  return null
}

// 结构化提取系统提示
const EXTRACT_SYSTEM_PROMPT = `你是儿童体检报告解析助手，专门解析中国《国家基本公共卫生服务规范》0-6岁儿童健康检查记录表及通用体检报告。

【表单结构说明】
国家标准表单为横向多列布局，每列对应一个月龄/年龄检查节点：
- 1～8月龄表：满月 | 3月龄 | 6月龄 | 8月龄
- 12～30月龄表：12月龄 | 18月龄 | 24月龄 | 30月龄
- 3～6岁表：3岁 | 4岁 | 5岁 | 6岁
你必须只提取【目标列】的数据，忽略其他列。目标列会在用户消息中明确给出。

【字段填写规则】
1. 按指标类别归类：生长发育/视力/听力/口腔/血液/尿液/脊柱/内科/发育评估/佝偻病/体格检查
2. 数值统一为标准单位：身高cm、体重kg、血红蛋白g/L、视力5分记录法
3. 表单中标注"— —"或空白的格子，对应字段填null，不要臆造数据
4. 表单中"1未见异常 2异常"类选项：未见异常填"未见异常"，异常填具体异常描述
5. 听力：婴幼儿表单通常为单值"1通过 2未通过"，填入hearing.result（"通过"/"未通过"），hearing.left/right填null
6. 口腔：出牙数填dental.teeth_count，龋齿数填dental.caries_count
7. 发育评估（预警征）：4条预警征中任何一条被勾选标记则为"阳性"，positive_items填阳性条目内容；全部未勾选为"正常"，positive_items填null
8. 佝偻病：症状和体征选项中选了"1无"则填"无"，选了其他则填具体体征名称用逗号分隔
9. 体格发育评价：填表单中的评价等级，如"上""中""下"或"正常""低体重""消瘦""生长迟缓""超重"
10. 无法识别或不确定的字段填null

【置信度规则】
在_parse_meta中标注整体置信度(0-1)、不确定字段列表、各字段对应的OCR原文片段。
置信度依据：文字清晰度、数值完整性、格式规范性。模糊或存疑的数值加入uncertain_fields并降低confidence。`

/**
 * 创建腾讯云OCR客户端
 * 密钥来源优先级：环境变量 > secrets.local.js 本地配置文件
 */
function createOcrClient() {
  let secretId = process.env.TENCENTCLOUD_SECRET_ID
  let secretKey = process.env.TENCENTCLOUD_SECRET_KEY

  // 环境变量未设置时，回退到本地密钥配置文件（部署时随函数一起上传）
  if (!secretId || !secretKey) {
    try {
      const localSecrets = require('./secrets.local')
      secretId = secretId || localSecrets.TENCENTCLOUD_SECRET_ID
      secretKey = secretKey || localSecrets.TENCENTCLOUD_SECRET_KEY
    } catch (e) {
      // secrets.local.js 不存在时忽略
    }
  }

  if (!secretId || !secretKey) {
    throw new Error('腾讯云密钥未配置：请在云函数环境变量中设置 TENCENTCLOUD_SECRET_ID 和 TENCENTCLOUD_SECRET_KEY，或在 cloudfunctions/ocrParse/secrets.local.js 中填写')
  }
  return new OcrClient({
    credential: { secretId, secretKey },
    region: 'ap-guangzhou',
    profile: {
      signMethod: 'TC3-HMAC-SHA256',
      httpProfile: { reqMethod: 'POST', reqTimeout: 30 }
    }
  })
}

/**
 * 计算OCR识别平均置信度
 */
function calcOcrConfidence(textDetections) {
  if (!textDetections || textDetections.length === 0) return 0
  const sum = textDetections.reduce((acc, d) => acc + (d.Confidence || 0), 0)
  return sum / textDetections.length / 100 // 腾讯云Confidence为0-100，转为0-1
}

/**
 * 初始化空metrics结构（所有字段为null）
 */
function initEmptyMetrics() {
  return {
    growth: { height: null, weight: null, head_circ: null, chest_circ: null, evaluation: null },
    vision: { left: null, right: null, corrected_left: null, corrected_right: null },
    hearing: { left: null, right: null, result: null },
    dental: { caries_count: null, caries_teeth: null, teeth_count: null },
    blood: { hemoglobin: null, rbc: null, wbc: null, platelet: null },
    urine: { protein: null, sugar: null, specific_gravity: null },
    spine: { adams_test: null, shoulder_balance: null },
    internal: { heart: null, lung: null, abdomen: null, note: null },
    development: { screening_result: null, positive_items: null },
    rickets: { symptoms: null, signs: null },
    physical: {
      complexion: null, skin: null, eyes: null, ears: null,
      anterior_fontanelle: null, neck_mass: null, chest: null, abdomen: null,
      limbs: null, umbilicus: null, gait: null, anus_genitalia: null,
      outdoor_activity: null, vitamin_d: null
    }
  }
}

exports.main = async (event, context) => {
  const { fileID, age_months } = event
  // 兼容 image_file_id 旧参数名
  const resolvedFileID = fileID || event.image_file_id

  // 参数校验
  if (!resolvedFileID) {
    return { success: false, error: '缺少必要参数: fileID' }
  }

  // 推断目标列名（用于指导LLM定位正确列）
  const targetColumn = inferTargetColumn(age_months)
  if (age_months != null) {
    console.log('[ocrParse] age_months=%s, 目标列=%s', age_months, targetColumn || '未知')
  }

  try {
    // ========== 第①步：下载云存储图片转base64 ==========
    console.log('[ocrParse] 开始下载图片:', resolvedFileID)
    const downloadRes = await cloud.downloadFile({ fileID: resolvedFileID })
    const imageBase64 = downloadRes.fileContent.toString('base64')
    console.log('[ocrParse] 图片下载完成, base64长度:', imageBase64.length)

    // ========== 第②步：调腾讯云GeneralAccurateOCR ==========
    console.log('[ocrParse] 开始调用腾讯云OCR')
    const ocrClient = createOcrClient()
    const ocrResp = await ocrClient.GeneralAccurateOCR({ ImageBase64: imageBase64 })

    const textDetections = ocrResp.TextDetections || []
    const fullText = textDetections.map(d => d.DetectedText).join('\n')
    const ocrConfidence = calcOcrConfidence(textDetections)

    console.log('[ocrParse] OCR识别完成, 文本行数:', textDetections.length, '置信度:', ocrConfidence)

    // OCR结果为空
    if (!fullText.trim()) {
      return {
        success: false,
        error: 'OCR未识别到任何文字，请重新上传清晰的体检单照片',
        ocr_raw: { image_file_id: resolvedFileID, raw_text: '', confidence: 0 }
      }
    }

    // 降级：OCR置信度过低，提示手动录入
    if (ocrConfidence < 0.6) {
      return {
        success: true,
        need_manual: true,
        metrics: initEmptyMetrics(),
        ocr_raw: {
          image_file_id: resolvedFileID,
          raw_text: fullText,
          confidence: ocrConfidence
        },
        parse_meta: {
          confidence: ocrConfidence,
          uncertain_fields: [],
          raw_snippets: []
        },
        message: 'OCR识别置信度较低，建议手动录入体检数据'
      }
    }

    // ========== 第③步：豆包2.1 Pro结构化提取 ==========
    console.log('[ocrParse] 开始调用豆包结构化提取')
    // 构建用户消息：包含目标列指引 + OCR全文
    const columnHint = targetColumn
      ? `【目标列】请只提取"${targetColumn}"列的数据（该儿童月龄约${age_months}月）。忽略其他月龄/年龄列的数据。\n\n`
      : (age_months != null
        ? `【目标列】该儿童月龄约${age_months}月，请找到最接近该月龄的检查列并提取数据。\n\n`
        : '')

    const { data: extracted } = await chatCompletion({
      messages: [
        { role: 'system', content: EXTRACT_SYSTEM_PROMPT },
        { role: 'user', content: `${columnHint}OCR全文：\n${fullText}` }
      ],
      schema: METRICS_SCHEMA,
      maxTokens: 4096,
      temperature: 0.1,
      timeout: 30000,
      retries: 1
    })

    console.log('[ocrParse] 结构化提取完成, 置信度:', extracted._parse_meta?.confidence)

    // 分离metrics和parse_meta
    const { _parse_meta, ...metrics } = extracted
    const parseConfidence = _parse_meta?.confidence || 0

    // 综合降级判断：模型提取置信度也过低
    const needManual = parseConfidence < 0.6

    return {
      success: true,
      need_manual: needManual,
      metrics,
      ocr_raw: {
        image_file_id: resolvedFileID,
        raw_text: fullText,
        confidence: ocrConfidence
      },
      parse_meta: _parse_meta,
      message: needManual ? '部分指标提取不确定，请仔细核对标红字段' : '识别成功，请核对数据'
    }
  } catch (err) {
    console.error('[ocrParse] error:', err)
    return {
      success: false,
      error: err.message || 'OCR解析过程中发生错误',
      need_manual: true
    }
  }
}
