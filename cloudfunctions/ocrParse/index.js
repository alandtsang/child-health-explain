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
 * 入参：{ fileID: string }
 * 返回：{ success, metrics, ocr_raw, parse_meta, need_manual }
 */

const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const { ocr } = require('tencentcloud-sdk-nodejs-ocr')
const { chatCompletion, buildSchema } = require('./lib/arkClient')

const OcrClient = ocr.v20181119.Client

// OCR结构化提取的JSON Schema（与exams.metrics结构一致）
const METRICS_SCHEMA = buildSchema('exam_metrics_extraction', {
  type: 'object',
  properties: {
    growth: {
      type: 'object',
      properties: {
        height: { type: ['number', 'null'], description: '身高(cm)' },
        weight: { type: ['number', 'null'], description: '体重(kg)' },
        head_circ: { type: ['number', 'null'], description: '头围(cm)' },
        chest_circ: { type: ['number', 'null'], description: '胸围(cm)' }
      },
      required: ['height', 'weight', 'head_circ', 'chest_circ'],
      additionalProperties: false
    },
    vision: {
      type: 'object',
      properties: {
        left: { type: ['number', 'null'], description: '左眼裸眼视力' },
        right: { type: ['number', 'null'], description: '右眼裸眼视力' },
        corrected_left: { type: ['number', 'null'], description: '左眼矫正视力' },
        corrected_right: { type: ['number', 'null'], description: '右眼矫正视力' }
      },
      required: ['left', 'right', 'corrected_left', 'corrected_right'],
      additionalProperties: false
    },
    hearing: {
      type: 'object',
      properties: {
        left: { type: ['string', 'null'], description: '左耳听力，如"正常"或"异常"' },
        right: { type: ['string', 'null'], description: '右耳听力，如"正常"或"异常"' }
      },
      required: ['left', 'right'],
      additionalProperties: false
    },
    dental: {
      type: 'object',
      properties: {
        caries_count: { type: ['number', 'null'], description: '龋齿数量' },
        caries_teeth: { type: ['string', 'null'], description: '龋齿牙位描述' }
      },
      required: ['caries_count', 'caries_teeth'],
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
  required: ['growth', 'vision', 'hearing', 'dental', 'blood', 'urine', 'spine', 'internal', '_parse_meta'],
  additionalProperties: false
})

// 结构化提取系统提示
const EXTRACT_SYSTEM_PROMPT = `你是体检报告解析助手。将OCR识别的文本提取为结构化数据。
要求：
1. 按指标类别归类（生长发育/视力/听力/口腔/血液/尿液/脊柱/内科）
2. 数值统一为标准单位（身高cm、体重kg、血红蛋白g/L等）
3. 无法识别或不确定的字段填null，不要臆造数据
4. 在_parse_meta中标注整体置信度（0-1）、不确定字段列表、各字段对应的OCR原文片段
5. 置信度评估依据：文字清晰度、数值完整性、格式规范性
6. 对于明显模糊或存疑的数值，加入uncertain_fields并适当降低confidence`

/**
 * 创建腾讯云OCR客户端
 */
function createOcrClient() {
  const secretId = process.env.TENCENTCLOUD_SECRET_ID
  const secretKey = process.env.TENCENTCLOUD_SECRET_KEY
  if (!secretId || !secretKey) {
    throw new Error('TENCENTCLOUD_SECRET_ID 或 TENCENTCLOUD_SECRET_KEY 环境变量未设置')
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
    growth: { height: null, weight: null, head_circ: null, chest_circ: null },
    vision: { left: null, right: null, corrected_left: null, corrected_right: null },
    hearing: { left: null, right: null },
    dental: { caries_count: null, caries_teeth: null },
    blood: { hemoglobin: null, rbc: null, wbc: null, platelet: null },
    urine: { protein: null, sugar: null, specific_gravity: null },
    spine: { adams_test: null, shoulder_balance: null },
    internal: { heart: null, lung: null, abdomen: null, note: null }
  }
}

exports.main = async (event, context) => {
  const { fileID } = event

  // 参数校验
  if (!fileID) {
    return { success: false, error: '缺少必要参数: fileID' }
  }

  try {
    // ========== 第①步：下载云存储图片转base64 ==========
    console.log('[ocrParse] 开始下载图片:', fileID)
    const downloadRes = await cloud.downloadFile({ fileID })
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
        ocr_raw: { image_file_id: fileID, raw_text: '', confidence: 0 }
      }
    }

    // 降级：OCR置信度过低，提示手动录入
    if (ocrConfidence < 0.6) {
      return {
        success: true,
        need_manual: true,
        metrics: initEmptyMetrics(),
        ocr_raw: {
          image_file_id: fileID,
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
    const { data: extracted } = await chatCompletion({
      messages: [
        { role: 'system', content: EXTRACT_SYSTEM_PROMPT },
        { role: 'user', content: `OCR全文：\n${fullText}` }
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
        image_file_id: fileID,
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
