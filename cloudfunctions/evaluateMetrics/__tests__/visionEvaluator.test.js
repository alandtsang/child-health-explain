const { evaluate } = require('../lib/visionEvaluator')

describe('visionEvaluator', () => {
  test('3岁 双眼4.8 正常', () => {
    const results = evaluate(
      { left: 4.8, right: 4.8 },
      { age_months: 40 }
    )
    expect(results.every(r => r.level === 'normal')).toBe(true)
  })

  test('3岁 左眼4.5 轻度视力不良', () => {
    const results = evaluate(
      { left: 4.5, right: 4.8 },
      { age_months: 40 }
    )
    const leftResult = results.find(r => r.item === 'left')
    expect(leftResult.level).toBe('mild')
  })

  test('5岁 右眼4.3 重度视力不良', () => {
    const results = evaluate(
      { left: 5.0, right: 4.3 },
      { age_months: 60 }
    )
    const rightResult = results.find(r => r.item === 'right')
    expect(rightResult.level).toBe('severe')
  })

  test('4岁 双眼4.7 轻度视力不良', () => {
    const results = evaluate(
      { left: 4.7, right: 4.7 },
      { age_months: 50 }
    )
    const leftResult = results.find(r => r.item === 'left')
    expect(leftResult.level).toBe('mild')
  })

  test('3岁以下不评估', () => {
    const results = evaluate(
      { left: 4.0, right: 4.0 },
      { age_months: 24 }
    )
    expect(results).toHaveLength(0)
  })

  test('整体视力取较差眼等级', () => {
    const results = evaluate(
      { left: 5.0, right: 4.3 },
      { age_months: 60 }
    )
    const overall = results.find(r => r.item === 'overall')
    expect(overall).toBeDefined()
    expect(overall.level).toBe('severe')
  })

  test('双眼正常无整体视力异常项', () => {
    const results = evaluate(
      { left: 5.0, right: 5.0 },
      { age_months: 60 }
    )
    const overall = results.find(r => r.item === 'overall')
    expect(overall).toBeUndefined()
  })
})
