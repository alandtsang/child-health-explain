/**
 * cloudfunctions/selfCheck/index.js
 * 家长自查AI解读云函数
 *
 * 流程：
 *   1. 校验入参(metrics, child_id/childInfo, disclaimer_acknowledged)
 *   2. 读取儿童信息(age_months, gender)
 *   3. 调用evaluateMetrics获取异常分级
 *   4. 调用豆包2.1 Pro生成通俗化解读
 *   5. 存入self_checks集合(含disclaimer_acknowledged)
 *
 * 入参：{ metrics, child_id?, childInfo?, input_method, ocr_raw?, disclaimer_acknowledged }
 * 返回：{ success, self_check_id, ai_result, abnormal_items, max_level, disclaimer }
 *
 * 注意：自查结果不回流医生，家长端标注"仅供参考"
 */

const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const { chatCompletion, buildSchema } = require('./lib/arkClient')

const DISCLAIMER = '本结果由AI生成，仅供参考，不能替代医生诊断。如有疑问请及时就医。'

// 复用与generateReport相同的JSON Schema
const REPORT_SCHEMA = buildSchema('health_report', {
  type: 'object',
  properties: {
    summary: {
      type: 'string',
      description: '总体概况，用通俗语言总结本次体检结果，100-200字'
    },
    item_explanations: {
      type: 'array',
      description: '指标解读列表，只解读异常指标',
      items: {
        type: 'object',
        properties: {
          item: { type: 'string', description: '指标名称' },
          meaning: { type: 'string', description: '该指标的含义，通俗解释' },
          abnormal_implication: { type: 'string', description: '异常可能的影响，不做确诊' }
        },
        required: ['item', 'meaning', 'abnormal_implication'],
        additionalProperties: false
      }
    },
    triage_advice: {
      type: 'array',
      description: '分诊建议列表',
      items: {
        type: 'object',
        properties: {
          item: { type: 'string', description: '相关异常指标' },
          department: { type: 'string', description: '建议就诊科室' },
          urgency: { type: 'string', description: '紧迫程度：尽快就诊/1周内就诊/1月内就诊/定期复查' },
          reason: { type: 'string', description: '建议原因' }
        },
        required: ['item', 'department', 'urgency', 'reason'],
        additionalProperties: false
      }
    },
    home_interventions: {
      type: 'array',
      description: '家庭干预建议列表',
      items: {
        type: 'object',
        properties: {
          item: { type: 'string', description: '相关指标' },
          type: { type: 'string', enum: ['diet', 'exercise', 'habit'], description: '干预类型：diet饮食/exercise运动/habit习惯' },
          detail: { type: 'string', description: '具体可执行的干预建议' }
        },
        required: ['item', 'type', 'detail'],
        additionalProperties: false
      }
    }
  },
  required: ['summary', 'item_explanations', 'triage_advice', 'home_interventions'],
  additionalProperties: false
})

const SYSTEM_PROMPT = `你是儿童健康体检解读助手。根据家长提供的体检数据生成面向家长的通俗化解读。
要求：
1. 语言通俗，避免医学术语，小学文化家长能看懂
2. 结构固定为四部分：总体概况(summary)、指标解读(item_explanations)、分诊建议(triage_advice)、家庭干预(home_interventions)
3. 不得自行修改异常等级，只能基于提供的分级结果解读
4. 分诊建议要具体到科室和紧迫程度
5. 家庭干预要可执行（如具体饮食搭配、每日运动时长）
6. 不做确诊性结论，用"提示""建议进一步检查"等措辞
7. 如果所有指标正常，item_explanations、triage_advice、home_interventions可以为空数组，summary中说明一切正常
8. item_explanations只解读异常指标，正常指标在summary中简要提及
9. urgency字段使用：尽快就诊/1周内就诊/1月内就诊/定期复查
10. 请在解读中适当提醒家长，本结果仅供参考，如有疑问建议就医咨询`

/**
 * 计算月龄
 */
function calcAgeMonths(birthDate) {
  const birth = new Date(birthDate)
  const now = new Date()
  return (now.getFullYear() - birth.getFullYear()) * 12 +
         (now.getMonth() - birth.getMonth())
}

/**
 * 构建正常项摘要
 */
function buildNormalItemsSummary(abnormalItems) {
  const normalItems = (abnormalItems || []).filter(item => item.level === 'normal')
  if (normalItems.length === 0) return '无'
  const labels = []
  const seen = new Set()
  for (const item of normalItems) {
    const label = item.item_label || item.item
    if (!seen.has(label)) {
      seen.add(label)
      labels.push(label)
    }
  }
  return labels.join('、') + '均正常'
}

/**
 * 构建异常项列表（只含非normal项）
 */
function buildAbnormalItemsForAI(abnormalItems) {
  return (abnormalItems || [])
    .filter(item => item.level !== 'normal')
    .map(item => ({
      item: item.item_label || item.item,
      level: item.level,
      value: item.value,
      standard_ref: item.standard_ref || '',
      standard_source: item.standard_source || '',
      category: item.category
    }))
}

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID
  const { metrics, child_id, childInfo, input_method, ocr_raw, disclaimer_acknowledged } = event

  // ========== 1. 参数校验 ==========
  if (!metrics) {
    return { success: false, error: '缺少必要参数: metrics' }
  }

  if (!disclaimer_acknowledged) {
    return { success: false, error: '请先勾选知情同意' }
  }

  if (!['manual', 'ocr'].includes(input_method)) {
    return { success: false, error: 'input_method 必须为 manual 或 ocr' }
  }

  try {
    // ========== 2. 获取儿童信息 ==========
    let ageMonths = null
    let gender = null
    let childId = child_id || null

    if (child_id) {
      const childRes = await db.collection('children').doc(child_id).get()
      const child = childRes.data
      if (child) {
        gender = child.gender
        if (child.birth_date) {
          ageMonths = calcAgeMonths(child.birth_date)
        }
      }
    }

    // 优先使用传入的childInfo
    if (childInfo) {
      if (childInfo.age_months != null) ageMonths = childInfo.age_months
      if (childInfo.gender) gender = childInfo.gender
    }

    if (ageMonths == null) {
      return { success: false, error: '无法确定儿童月龄，请提供child_id或childInfo.age_months' }
    }

    // ========== 3. 调用evaluateMetrics分级 ==========
    console.log('[selfCheck] 调用evaluateMetrics')
    const evalRes = await cloud.callFunction({
      name: 'evaluateMetrics',
      data: {
        metrics,
        childInfo: { age_months: ageMonths, gender },
        examDate: new Date().toISOString().slice(0, 10)
      }
    })

    if (!evalRes.result.success) {
      return { success: false, error: '指标评估失败: ' + (evalRes.result.error || '未知错误') }
    }

    const abnormalItems = evalRes.result.abnormal_items || []
    const maxLevel = evalRes.result.max_level || 'normal'

    console.log('[selfCheck] 分级完成, 异常项:', abnormalItems.filter(i => i.level !== 'normal').length, '最高等级:', maxLevel)

    // ========== 4. 调用豆包生成解读 ==========
    const abnormalForAI = buildAbnormalItemsForAI(abnormalItems)
    const normalSummary = buildNormalItemsSummary(abnormalItems)

    const userMessage = JSON.stringify({
      child: { age_months: ageMonths, gender: gender || '未知' },
      abnormal_items: abnormalForAI,
      normal_items_summary: normalSummary
    }, null, 2)

    console.log('[selfCheck] 调用豆包生成解读')
    const { data: aiResult } = await chatCompletion({
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userMessage }
      ],
      schema: REPORT_SCHEMA,
      maxTokens: 4096,
      temperature: 0.3,
      timeout: 30000,
      retries: 1
    })

    console.log('[selfCheck] 解读生成完成')

    // ========== 5. 存入self_checks集合 ==========
    const selfCheckRecord = {
      parent_openid: openid,
      child_id: childId,
      input_method,
      metrics,
      ocr_raw: ocr_raw || null,
      ai_result: aiResult,
      abnormal_items: abnormalItems,
      max_level: maxLevel,
      disclaimer_acknowledged: true,
      disclaimer: DISCLAIMER,
      created_at: db.serverDate()
    }

    const insertResult = await db.collection('self_checks').add({ data: selfCheckRecord })

    console.log('[selfCheck] 自查记录已存储, id:', insertResult._id)

    return {
      success: true,
      self_check_id: insertResult._id,
      ai_result: aiResult,
      abnormal_items: abnormalItems,
      max_level: maxLevel,
      has_abnormal: evalRes.result.has_abnormal,
      disclaimer: DISCLAIMER
    }
  } catch (err) {
    console.error('[selfCheck] error:', err)
    return {
      success: false,
      error: err.message || '自查解读过程中发生错误'
    }
  }
}
