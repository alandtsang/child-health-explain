const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const growthEvaluator = require('./lib/growthEvaluator')
const obesityEvaluator = require('./lib/obesityEvaluator')
const anemiaEvaluator = require('./lib/anemiaEvaluator')
const visionEvaluator = require('./lib/visionEvaluator')
const dentalEvaluator = require('./lib/dentalEvaluator')
const spineEvaluator = require('./lib/spineEvaluator')
const { generateFollowup } = require('./lib/followupRules')

exports.main = async (event, context) => {
  const { metrics, childInfo, examDate } = event

  // 参数校验
  if (!metrics || !childInfo) {
    return {
      success: false,
      error: '缺少必要参数: metrics, childInfo'
    }
  }

  if (childInfo.age_months == null) {
    return {
      success: false,
      error: '缺少 childInfo.age_months'
    }
  }

  try {
    const allItems = []

    // 1. 生长发育（身高/体重 Z-Score）
    if (metrics.growth) {
      const items = growthEvaluator.evaluate(metrics.growth, childInfo)
      allItems.push(...items)
    }

    // 2. 超重肥胖（BMI，仅6-17岁）
    if (metrics.growth && metrics.growth.height && metrics.growth.weight) {
      const items = obesityEvaluator.evaluate(metrics.growth, childInfo)
      allItems.push(...items)
    }

    // 3. 贫血（血红蛋白）
    if (metrics.blood && metrics.blood.hemoglobin != null) {
      const items = anemiaEvaluator.evaluate(metrics.blood, childInfo)
      allItems.push(...items)
    }

    // 4. 视力
    if (metrics.vision) {
      const items = visionEvaluator.evaluate(metrics.vision, childInfo)
      allItems.push(...items)
    }

    // 5. 口腔（龋齿）
    if (metrics.dental) {
      const items = dentalEvaluator.evaluate(metrics.dental, childInfo)
      allItems.push(...items)
    }

    // 6. 脊柱
    if (metrics.spine) {
      const items = spineEvaluator.evaluate(metrics.spine, childInfo)
      allItems.push(...items)
    }

    // 生成随访信息
    const followupInfo = generateFollowup(allItems, examDate || new Date().toISOString().slice(0, 10))
    return {
      success: true,
      abnormal_items: allItems,
      max_level: followupInfo.max_level,
      has_abnormal: followupInfo.has_abnormal,
      followup: followupInfo.followup,
      trigger_items: followupInfo.trigger_items,
      evaluated_at: new Date().toISOString()
    }
  } catch (err) {
    console.error('evaluateMetrics error:', err)
    return {
      success: false,
      error: err.message || '评估过程中发生错误'
    }
  }
}
