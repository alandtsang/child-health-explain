const path = require('path')
const { interpolateRow, determineZScoreBand, round2 } = require('./interpolate')

const growthData = require('../standards/growth-wst800.json')

/**
 * 生长发育评估
 * @param {Object} metrics - { height, weight, head_circ, chest_circ }
 * @param {Object} childInfo - { age_months, gender: 'male'|'female' }
 * @returns {Array} abnormal_items
 */
function evaluate(metrics, childInfo) {
  const results = []
  const { age_months, gender } = childInfo
  const genderKey = gender === 'male' ? 'boys' : 'girls'

  // ── 身高别年龄（生长迟缓）──
  if (metrics.height != null && age_months != null) {
    const table = growthData.tables.height_for_age[genderKey]
    const zRow = interpolateRow(table, age_months)
    if (zRow) {
      const { level, zScore, band } = determineZScoreBand(metrics.height, zRow, 'low')
      results.push({
        category: 'growth',
        item: 'height_for_age',
        item_label: '身高别年龄',
        value: metrics.height,
        unit: 'cm',
        standard_ref: `${zRow.z_minus2} ~ ${zRow.z_plus2} (±2SD)`,
        z_score: zScore,
        band,
        level,
        standard_source: 'WS/T 800-2022'
      })
    }
  }

  // ── 体重别年龄（低体重 / 超重）──
  if (metrics.weight != null && age_months != null) {
    const table = growthData.tables.weight_for_age[genderKey]
    const zRow = interpolateRow(table, age_months)
    if (zRow) {
      const { level, zScore, band } = determineZScoreBand(metrics.weight, zRow, 'both')
      results.push({
        category: 'growth',
        item: 'weight_for_age',
        item_label: '体重别年龄',
        value: metrics.weight,
        unit: 'kg',
        standard_ref: `${zRow.z_minus2} ~ ${zRow.z_plus2} (±2SD)`,
        z_score: zScore,
        band,
        level,
        standard_source: 'WS/T 800-2022'
      })
    }
  }

  return results
}

module.exports = { evaluate }
