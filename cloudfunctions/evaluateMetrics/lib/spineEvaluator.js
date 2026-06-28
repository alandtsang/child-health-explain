const config = require('../standards/config.json')

/**
 * 脊柱评估
 * @param {Object} metrics - { adams_test: 'positive'|'negative', shoulder_balance: 'balanced'|'uneven' }
 * @param {Object} childInfo - { age_months }
 * @returns {Array} abnormal_items
 */
function evaluate(metrics, childInfo) {
  const results = []
  const { adams_test, shoulder_balance } = metrics

  // 两个字段都为空则不评估
  if (!adams_test && !shoulder_balance) return results

  const rules = config.spine_rules.rules
  let level = 'normal'
  let description = '脊柱检查正常'

  const adams = adams_test || 'unknown'
  const shoulder = shoulder_balance || 'unknown'

  for (const rule of rules) {
    // 解析 "adams_test == positive AND shoulder_balance == uneven"
    const m = rule.condition.match(
      /^adams_test\s*==\s*(\w+)\s+AND\s+shoulder_balance\s*==\s*(\w+)$/
    )
    if (m) {
      if (adams === m[1] && shoulder === m[2]) {
        level = rule.level
        description = rule.description
        break
      }
      continue
    }

    // 解析单条件 "adams_test == positive AND shoulder_balance == balanced"
    const m2 = rule.condition.match(
      /^adams_test\s*==\s*(\w+)\s+AND\s+shoulder_balance\s*==\s*(\w+)$/
    )
    if (m2 && adams === m2[1] && shoulder === m2[2]) {
      level = rule.level
      description = rule.description
      break
    }

    // 解析 "adams_test == negative AND shoulder_balance == uneven"
    const m3 = rule.condition.match(
      /^adams_test\s*==\s*(\w+)\s+AND\s+shoulder_balance\s*==\s*(\w+)$/
    )
    if (m3 && adams === m3[1] && shoulder === m3[2]) {
      level = rule.level
      description = rule.description
      break
    }
  }

  results.push({
    category: 'spine',
    item: 'spine_screening',
    item_label: '脊柱筛查',
    value: `Adams:${adams}, 肩平衡:${shoulder}`,
    unit: '',
    standard_ref: 'Adams试验阴性+肩平衡=正常',
    level,
    description,
    standard_source: '脊柱侧弯筛查标准'
  })

  return results
}

module.exports = { evaluate }
