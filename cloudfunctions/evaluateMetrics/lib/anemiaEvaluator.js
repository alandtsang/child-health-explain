const anemiaData = require('../standards/anemia-wst279.json')

/**
 * 贫血评估（血红蛋白）
 * @param {Object} metrics - { hemoglobin, rbc, wbc, platelet }
 * @param {Object} childInfo - { age_months }
 * @returns {Array} abnormal_items
 */
function evaluate(metrics, childInfo) {
  const results = []
  const { hemoglobin } = metrics
  const { age_months } = childInfo

  if (hemoglobin == null) return results

  // 找到对应年龄段
  const range = anemiaData.age_ranges.find(
    r => age_months >= r.min_months && age_months <= r.max_months
  )
  if (!range) return results

  let level = 'normal'
  let description = `Hb=${hemoglobin} g/L，正常 (>= ${range.normal_min})`

  // 从严重到轻度逐级判定
  for (const rule of range.rules) {
    if (matchHbCondition(hemoglobin, rule.condition)) {
      level = rule.level
      description = rule.description
      break
    }
  }

  results.push({
    category: 'anemia',
    item: 'hemoglobin',
    item_label: '血红蛋白',
    value: hemoglobin,
    unit: 'g/L',
    standard_ref: `正常 >= ${range.normal_min} g/L (${range.label})`,
    level,
    description,
    standard_source: 'WS/T 279-2008'
  })

  return results
}

/**
 * 解析血红蛋白条件表达式
 * 支持格式：
 *   "hb < 90"
 *   "90 <= hb < 120"
 */
function matchHbCondition(hb, condition) {
  // 格式1: "hb < 90"
  let m = condition.match(/^hb\s*<\s*(\d+(?:\.\d+)?)$/)
  if (m) return hb < parseFloat(m[1])

  // 格式2: "90 <= hb < 120"
  m = condition.match(/^(\d+(?:\.\d+)?)\s*<=\s*hb\s*<\s*(\d+(?:\.\d+)?)$/)
  if (m) {
    const lo = parseFloat(m[1])
    const hi = parseFloat(m[2])
    return hb >= lo && hb < hi
  }

  return false
}

module.exports = { evaluate }
