const { interpolateRow, determineZScoreBand, round2 } = require('../lib/interpolate')

describe('interpolateRow', () => {
  const mockRows = [
    { age_months: 0, z_median: 49.1, z_minus2: 46.1, z_plus2: 52.2 },
    { age_months: 6, z_median: 67.6, z_minus2: 63.7, z_plus2: 71.6 },
    { age_months: 12, z_median: 76.0, z_minus2: 71.7, z_plus2: 80.5 }
  ]

  test('精确匹配月龄返回对应行', () => {
    const row = interpolateRow(mockRows, 6)
    expect(row.age_months).toBe(6)
    expect(row.z_median).toBe(67.6)
  })

  test('非采样点月龄做线性插值', () => {
    const row = interpolateRow(mockRows, 3)
    expect(row.age_months).toBe(3)
    // z_median 在 0月(49.1) 和 6月(67.6) 之间插值，3月 = 中点
    expect(row.z_median).toBeCloseTo(58.35, 1)
  })

  test('低于最小月龄返回第一行', () => {
    const row = interpolateRow(mockRows, -1)
    // 边界外返回第一行本身（保留其原始 age_months），而非输入月龄
    expect(row).toEqual(mockRows[0])
    expect(row.age_months).toBe(0)
    expect(row.z_median).toBe(49.1)
  })

  test('高于最大月龄返回最后一行', () => {
    const row = interpolateRow(mockRows, 24)
    // 边界外返回最后一行本身（保留其原始 age_months），而非输入月龄
    expect(row).toEqual(mockRows[mockRows.length - 1])
    expect(row.age_months).toBe(12)
    expect(row.z_median).toBe(76.0)
  })

  test('空数组返回null', () => {
    expect(interpolateRow([], 6)).toBeNull()
  })
})

describe('determineZScoreBand', () => {
  const zRow = {
    z_minus3: 59.7, z_minus2: 63.7, z_minus1: 65.6,
    z_median: 67.6, z_plus1: 69.6, z_plus2: 71.6, z_plus3: 74.0
  }

  test('正常范围返回 normal', () => {
    const result = determineZScoreBand(67.6, zRow, 'both')
    expect(result.level).toBe('normal')
  })

  test('低于 -3SD 返回 severe', () => {
    const result = determineZScoreBand(55.0, zRow, 'low')
    expect(result.level).toBe('severe')
    expect(result.band).toContain('< -3SD')
  })

  test('-3SD 到 -2SD 返回 moderate', () => {
    const result = determineZScoreBand(61.0, zRow, 'low')
    expect(result.level).toBe('moderate')
    expect(result.band).toContain('-3SD ~ -2SD')
  })

  test('-2SD 到 -1SD 返回 mild', () => {
    const result = determineZScoreBand(64.5, zRow, 'low')
    expect(result.level).toBe('mild')
    expect(result.band).toContain('-2SD ~ -1SD')
  })

  test('+2SD 到 +3SD 返回 mild (超重)', () => {
    const result = determineZScoreBand(72.0, zRow, 'both')
    expect(result.level).toBe('mild')
    expect(result.band).toContain('+2SD ~ +3SD')
  })

  test('>= +3SD 返回 moderate (肥胖风险)', () => {
    const result = determineZScoreBand(75.0, zRow, 'both')
    expect(result.level).toBe('moderate')
    expect(result.band).toContain('>= +3SD')
  })
})

describe('round2', () => {
  test('保留两位小数', () => {
    expect(round2(3.14159)).toBe(3.14)
    expect(round2(2.71828)).toBe(2.72)
  })

  test('null 返回 null', () => {
    expect(round2(null)).toBeNull()
  })

  test('NaN 返回 null', () => {
    expect(round2(NaN)).toBeNull()
  })
})
