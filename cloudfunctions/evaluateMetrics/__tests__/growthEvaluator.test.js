const { evaluate } = require('../lib/growthEvaluator')

describe('growthEvaluator', () => {
  const childInfo = { age_months: 36, gender: 'male' }

  test('正常身高体重返回 normal', () => {
    const metrics = { height: 95, weight: 14 }
    const results = evaluate(metrics, childInfo)
    expect(results).toHaveLength(2)
    expect(results[0].item).toBe('height_for_age')
    expect(results[0].level).toBe('normal')
    expect(results[1].item).toBe('weight_for_age')
    expect(results[1].level).toBe('normal')
  })

  test('身高低于 -2SD 返回 moderate (生长迟缓)', () => {
    const metrics = { height: 83, weight: 14 }
    const results = evaluate(metrics, childInfo)
    const heightResult = results.find(r => r.item === 'height_for_age')
    expect(heightResult.level).toBe('moderate')
    expect(heightResult.standard_source).toBe('WS/T 800-2022')
  })

  test('身高低于 -3SD 返回 severe', () => {
    const metrics = { height: 80, weight: 14 }
    const results = evaluate(metrics, childInfo)
    const heightResult = results.find(r => r.item === 'height_for_age')
    expect(heightResult.level).toBe('severe')
  })

  test('体重高于 +2SD 返回 mild (超重)', () => {
    const metrics = { height: 95, weight: 20 }
    const results = evaluate(metrics, childInfo)
    const weightResult = results.find(r => r.item === 'weight_for_age')
    expect(['mild', 'moderate']).toContain(weightResult.level)
  })

  test('体重低于 -2SD 返回 moderate (低体重)', () => {
    const metrics = { height: 95, weight: 9 }
    const results = evaluate(metrics, childInfo)
    const weightResult = results.find(r => r.item === 'weight_for_age')
    expect(['moderate', 'severe']).toContain(weightResult.level)
  })

  test('女性儿童使用 girls 表', () => {
    const metrics = { height: 94, weight: 14 }
    const results = evaluate(metrics, { age_months: 36, gender: 'female' })
    expect(results).toHaveLength(2)
    expect(results[0].level).toBe('normal')
  })

  test('缺少身高只评估体重', () => {
    const metrics = { weight: 14 }
    const results = evaluate(metrics, childInfo)
    expect(results).toHaveLength(1)
    expect(results[0].item).toBe('weight_for_age')
  })

  test('非采样月龄(37月)正确插值', () => {
    const metrics = { height: 96, weight: 15 }
    const results = evaluate(metrics, { age_months: 37, gender: 'male' })
    expect(results).toHaveLength(2)
    expect(results[0].level).toBe('normal')
  })
})
