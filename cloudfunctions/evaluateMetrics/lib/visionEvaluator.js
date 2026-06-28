const visionData = require('../standards/vision.json')

/**
 * 视力评估
 * @param {Object} metrics - { left, right, corrected_left, corrected_right }
 * @param {Object} childInfo - { age_months }
 * @returns {Array} abnormal_items
 */
function evaluate(metrics, childInfo) {
  const results = []
  const { left, right } = metrics
  const { age_months } = childInfo

  // 3岁以下不评估裸眼视力
  if (age_months < 36) return results

  // 找到对应年龄段
  const range = visionData.age_ranges.find(
    r => age_months >= r.min_months && age_months <= r.max_months
  )
  if (!range) return results

  // 左眼评估
  let leftResult = null
  if (left != null) {
    leftResult = evaluateSingleEye('left', '左眼', left, range)
    results.push(leftResult)
  }

  // 右眼评估
  let rightResult = null
  if (right != null) {
    rightResult = evaluateSingleEye('right', '右眼', right, range)
    results.push(rightResult)
  }

  // 整体视力（取较差眼等级）
  if (leftResult && rightResult) {
    const worseLevel = getWorseLevel(leftResult.level, rightResult.level)
    if (worseLevel !== 'normal') {
      results.push({
        category: 'vision',
        item: 'overall',
        item_label: '整体视力',
        value: Math.min(left, right),
        unit: '5分记录法',
        standard_ref: `正常 >= ${range.normal_min} (${range.label})`,
        level: worseLevel,
        description: `双眼中较差眼视力异常，等级: ${worseLevel}`,
        standard_source: '国家卫健委儿童眼保健规范'
      })
    }
  }

  return results
}

function evaluateSingleEye(side, label, vision, range) {
  let level = 'normal'
  let description = `${label}=${vision}，正常 (>= ${range.normal_min})`

  // 从严重到轻度逐级判定
  for (const rule of range.rules) {
    const m = rule.condition.match(/^vision\s*<\s*(\d+(?:\.\d+)?)$/)
    if (m) {
      if (vision < parseFloat(m[1])) {
        level = rule.level
        description = rule.description
        break
      }
      continue
    }

    const m2 = rule.condition.match(/^(\d+(?:\.\d+)?)\s*<=\s*vision\s*<\s*(\d+(?:\.\d+)?)$/)
    if (m2) {
      const lo = parseFloat(m2[1])
      const hi = parseFloat(m2[2])
      if (vision >= lo && vision < hi) {
        level = rule.level
        description = rule.description
        break
      }
    }
  }

  return {
    category: 'vision',
    item: side,
    item_label: label,
    value: vision,
    unit: '5分记录法',
    standard_ref: `正常 >= ${range.normal_min} (${range.label})`,
    level,
    description,
    standard_source: '国家卫健委儿童眼保健规范'
  }
}

const LEVEL_ORDER = { severe: 4, moderate: 3, mild: 2, normal: 1 }

function getWorseLevel(a, b) {
  return LEVEL_ORDER[a] >= LEVEL_ORDER[b] ? a : b
}

module.exports = { evaluate }
