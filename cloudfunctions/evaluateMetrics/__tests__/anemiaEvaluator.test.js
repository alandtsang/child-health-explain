const { evaluate } = require('../lib/anemiaEvaluator')

describe('anemiaEvaluator', () => {
  test('6-59月 Hb=125 正常', () => {
    const results = evaluate(
      { hemoglobin: 125 },
      { age_months: 36 }
    )
    expect(results).toHaveLength(1)
    expect(results[0].level).toBe('normal')
    expect(results[0].standard_source).toBe('WS/T 279-2008')
  })

  test('6-59月 Hb=100 轻度贫血', () => {
    const results = evaluate(
      { hemoglobin: 100 },
      { age_months: 36 }
    )
    expect(results[0].level).toBe('mild')
    expect(results[0].description).toContain('轻度贫血')
  })

  test('6-59月 Hb=80 中度贫血', () => {
    const results = evaluate(
      { hemoglobin: 80 },
      { age_months: 24 }
    )
    expect(results[0].level).toBe('moderate')
    expect(results[0].description).toContain('中度贫血')
  })

  test('6-59月 Hb=50 重度贫血', () => {
    const results = evaluate(
      { hemoglobin: 50 },
      { age_months: 24 }
    )
    expect(results[0].level).toBe('severe')
    expect(results[0].description).toContain('重度贫血')
  })

  test('60-131月(5-11岁) Hb=112 轻度贫血', () => {
    const results = evaluate(
      { hemoglobin: 112 },
      { age_months: 72 }
    )
    expect(results[0].level).toBe('mild')
  })

  test('132-215月(12-17岁) Hb=118 轻度贫血', () => {
    const results = evaluate(
      { hemoglobin: 118 },
      { age_months: 144 }
    )
    expect(results[0].level).toBe('mild')
  })

  test('Hb 为 null 不评估', () => {
    const results = evaluate(
      { hemoglobin: null },
      { age_months: 36 }
    )
    expect(results).toHaveLength(0)
  })

  test('边界值 Hb=110 正常(6-59月)', () => {
    const results = evaluate(
      { hemoglobin: 110 },
      { age_months: 36 }
    )
    expect(results[0].level).toBe('normal')
  })

  test('边界值 Hb=109 轻度贫血(6-59月)', () => {
    const results = evaluate(
      { hemoglobin: 109 },
      { age_months: 36 }
    )
    expect(results[0].level).toBe('mild')
  })
})
