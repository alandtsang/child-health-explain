const config = require('../standards/config.json')

/**
 * 口腔（龋齿）评估
 * @param {Object} metrics - { caries_count, caries_teeth }
 * @param {Object} childInfo - { age_months }
 * @returns {Array} abnormal_items
 */
function evaluate(metrics, childInfo) {
  const results = []
  const { caries_count, caries_teeth } = metrics

  if (caries_count == null) return results

  const rules = config.dental_rules.rules
  let level = 'normal'
  let description = `龋齿数=${caries_count}，正常`

  for (const rule of rules) {
    // 解析 "caries_count >= 4" 和 "1 <= caries_count < 4"
    const m1 = rule.condition.match(/^caries_count\s*>=\s*(\d+)$/)
    if (m1 && caries_count >= parseInt(m1[1])) {
      level = rule.level
      description = rule.description
      break
    }

    const m2 = rule.condition.match(/^(\d+)\s*<=\s*caries_count\s*<\s*(\d+)$/)
    if (m2) {
      const lo = parseInt(m2[1])
      const hi = parseInt(m2[2])
      if (caries_count >= lo && caries_count < hi) {
        level = rule.level
        description = rule.description
        break
      }
    }
  }

  results.push({
    category: 'dental',
    item: 'caries_count',
    item_label: '龋齿数',
    value: caries_count,
    unit: '颗',
    standard_ref: '正常 = 0 颗',
    level,
    description,
    caries_teeth: caries_teeth || '',
    standard_source: '计数判定'
  })

  return results
}

module.exports = { evaluate }
