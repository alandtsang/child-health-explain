/**
 * cloudfunctions/generateReport/index.js
 * AI文本解读报告生成云函数
 *
 * 流程：
 *   1. 读取exam记录(metrics + abnormal_items + child信息)
 *   2. 若abnormal_items缺失，调用evaluateMetrics补充
 *   3. 构建系统提示+用户消息，调豆包2.1 Pro生成解读
 *   4. JSON Schema强约束输出（四部分结构）
 *   5. 存入reports集合(ai_content, review_status=pending)
 *
 * 入参：{ exam_id: string }
 * 返回：{ success, report_id, ai_content }
 */

const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const { chatCompletion, buildSchema } = require('./lib/arkClient')

// AI解读报告JSON Schema
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

// 系统提示
const SYSTEM_PROMPT = `你是儿童健康体检解读助手。根据体检数据生成面向家长的通俗化解读。
要求：
1. 语言通俗，避免医学术语，小学文化家长能看懂
2. 结构固定为四部分：总体概况(summary)、指标解读(item_explanations)、分诊建议(triage_advice)、家庭干预(home_interventions)
3. 不得自行修改异常等级，只能基于提供的分级结果解读
4. 分诊建议要具体到科室和紧迫程度
5. 家庭干预要可执行（如具体饮食搭配、每日运动时长）
6. 不做确诊性结论，用"提示""建议进一步检查"等措辞
7. 如果所有指标正常，item_explanations、triage_advice、home_interventions可以为空数组，summary中说明一切正常
8. item_explanations只解读异常指标，正常指标在summary中简要提及
9. urgency字段使用：尽快就诊/1周内就诊/1月内就诊/定期复查`

/**
 * 计算月龄
 */
function calcAgeMonths(birthDate, examDate) {
  const birth = new Date(birthDate)
  const exam = new Date(examDate)
  return (exam.getFullYear() - birth.getFullYear()) * 12 +
         (exam.getMonth() - birth.getMonth())
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
  const { exam_id } = event

  if (!exam_id) {
    return { success: false, error: '缺少必要参数: exam_id' }
  }

  try {
    // ========== 1. 读取exam记录 ==========
    const examRes = await db.collection('exams').doc(exam_id).get()
    const exam = examRes.data

    if (!exam) {
      return { success: false, error: '体检记录不存在' }
    }

    let abnormalItems = exam.abnormal_items || []
    let ageMonths = exam.basic_info?.age_months

    // ========== 2. 若abnormal_items缺失，调用evaluateMetrics ==========
    if (abnormalItems.length === 0) {
      console.log('[generateReport] abnormal_items为空，调用evaluateMetrics')

      // 读取儿童信息
      const childRes = await db.collection('children').doc(exam.child_id).get()
      const child = childRes.data

      if (!ageMonths && child?.birth_date) {
        ageMonths = calcAgeMonths(child.birth_date, exam.exam_date)
      }

      const evalResult = await cloud.callFunction({
        name: 'evaluateMetrics',
        data: {
          metrics: exam.metrics,
          childInfo: { age_months: ageMonths, gender: child?.gender },
          examDate: exam.exam_date
        }
      })

      abnormalItems = evalResult.result.abnormal_items || []

      // 更新exam记录
      await db.collection('exams').doc(exam_id).update({
        data: { abnormal_items: abnormalItems }
      })

      console.log('[generateReport] evaluateMetrics完成, 异常项数:', abnormalItems.length)
    }

    // ========== 3. 构建AI请求 ==========
    const abnormalForAI = buildAbnormalItemsForAI(abnormalItems)
    const normalSummary = buildNormalItemsSummary(abnormalItems)

    const userMessage = JSON.stringify({
      child: {
        age_months: ageMonths,
        gender: exam.child_gender || '未知'
      },
      abnormal_items: abnormalForAI,
      normal_items_summary: normalSummary
    }, null, 2)

    console.log('[generateReport] 开始调用豆包生成解读, 异常项数:', abnormalForAI.length)

    // ========== 4. 调用豆包2.1 Pro ==========
    const { data: aiContent } = await chatCompletion({
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

    console.log('[generateReport] 豆包解读生成完成')

    // ========== 5. 存入reports集合 ==========
    // 检查是否已有报告（版本递增）
    const existingReports = await db.collection('reports')
      .where({ exam_id })
      .orderBy('version', 'desc')
      .limit(1)
      .get()

    const version = existingReports.data.length > 0
      ? (existingReports.data[0].version || 0) + 1
      : 1

    const reportRecord = {
      exam_id,
      version,
      ai_content: aiContent,
      doctor_content: null,
      review_status: 'pending',
      reviewed_by: null,
      reviewed_at: null,
      pushed_to: [],
      pushed_at: null,
      disclaimer: 'AI生成内容经医生审核，仅供参考',
      created_at: db.serverDate()
    }

    const reportResult = await db.collection('reports').add({ data: reportRecord })

    console.log('[generateReport] 报告已存储, report_id:', reportResult._id, 'version:', version)

    return {
      success: true,
      report_id: reportResult._id,
      version,
      ai_content: aiContent
    }
  } catch (err) {
    console.error('[generateReport] error:', err)
    return {
      success: false,
      error: err.message || '报告生成过程中发生错误'
    }
  }
}
