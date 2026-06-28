/**
 * 线性插值工具
 * 用于在 Z-Score 表中按月龄插值，并判定实测值落入的 Z-Score 区间。
 */

/**
 * 在已排序的数组中，按 age_months 做线性插值，返回插值后的行对象。
 * @param {Array} rows - 表行数组，每行含 age_months 及若干 Z 列
 * @param {number} ageMonths - 目标月龄
 * @returns {Object|null} - 插值行（含 age_months 及各 Z 列），超出范围返回最近的边界行
 */
function interpolateRow(rows, ageMonths) {
  if (!rows || rows.length === 0) return null

  // 低于最小月龄 → 返回第一行
  if (ageMonths <= rows[0].age_months) return { ...rows[0] }
  // 高于最大月龄 → 返回最后一行
  if (ageMonths >= rows[rows.length - 1].age_months) return { ...rows[rows.length - 1] }

  // 二分查找相邻两行
  let lo = 0, hi = rows.length - 1
  while (lo < hi - 1) {
    const mid = Math.floor((lo + hi) / 2)
    if (rows[mid].age_months <= ageMonths) lo = mid
    else hi = mid
  }

  const rowA = rows[lo]
  const rowB = rows[hi]
  const span = rowB.age_months - rowA.age_months
  if (span === 0) return { ...rowA }
  const t = (ageMonths - rowA.age_months) / span

  // 对所有 Z 列做插值
  const result = { age_months: ageMonths }
  const keys = Object.keys(rowA).filter(k => k !== 'age_months')
  for (const k of keys) {
    result[k] = round2(rowA[k] + (rowB[k] - rowA[k]) * t)
  }
  return result
}

/**
 * 判定实测值落入哪个 Z-Score 区间，返回 { level, zScore, band }
 * Z 列顺序：z_minus3 < z_minus2 < z_minus1 < z_median < z_plus1 < z_plus2 < z_plus3
 *
 * 对于偏低类指标（身高、体重）：
 *   value < z_minus3           → severe
 *   z_minus3 <= value < z_minus2 → moderate
 *   z_minus2 <= value < z_minus1 → mild
 *   z_minus1 <= value < z_plus2  → normal
 *   z_plus2 <= value < z_plus3   → mild (超重)
 *   value >= z_plus3             → moderate (肥胖风险)
 *
 * @param {number} value - 实测值
 * @param {Object} zRow - 插值行（含 z_minus3...z_plus3）
 * @param {string} direction - 'low' (偏低异常) 或 'high' (偏高异常) 或 'both'
 * @returns {{ level: string, zScore: number, band: string }}
 */
function determineZScoreBand(value, zRow, direction = 'both') {
  const z3 = zRow.z_minus3
  const z2 = zRow.z_minus2
  const z1 = zRow.z_minus1
  const m  = zRow.z_median
  const p1 = zRow.z_plus1
  const p2 = zRow.z_plus2
  const p3 = zRow.z_plus3

  let zScore = null
  let level = 'normal'
  let band = ''

  if (direction === 'low' || direction === 'both') {
    if (value < z3) {
      level = 'severe'
      band = '< -3SD'
      zScore = -3 - (z3 - value) / (z2 - z3)
    } else if (value < z2) {
      level = 'moderate'
      band = '-3SD ~ -2SD'
      zScore = -3 + (value - z3) / (z2 - z3)
    } else if (value < z1) {
      level = 'mild'
      band = '-2SD ~ -1SD'
      zScore = -2 + (value - z2) / (z1 - z2)
    } else if (value >= z2 && value < p2) {
      level = 'normal'
      band = '-1SD ~ +2SD'
      zScore = -1 + (value - z1) / (m - z1)
    }
  }

  if (direction === 'high' || direction === 'both') {
    if (level === 'normal') {
      if (value >= p3) {
        level = 'moderate'
        band = '>= +3SD'
        zScore = 3 + (value - p3) / (p3 - p2)
      } else if (value >= p2) {
        level = 'mild'
        band = '+2SD ~ +3SD'
        zScore = 2 + (value - p2) / (p3 - p2)
      }
    }
  }

  return { level, zScore: round2(zScore), band }
}

/**
 * 简单线性插值（通用）
 */
function lerp(a, b, t) {
  return a + (b - a) * t
}

/**
 * 保留两位小数
 */
function round2(v) {
  if (v === null || v === undefined || isNaN(v)) return null
  return Math.round(v * 100) / 100
}

module.exports = { interpolateRow, determineZScoreBand, lerp, round2 }
