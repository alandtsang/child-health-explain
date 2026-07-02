const { evaluate } = require('../lib/hearingEvaluator')

describe('hearingEvaluator', () => {
  test('听力筛查通过 正常', () => {
    const results = evaluate(
      { left: null, right: null, result: '通过' },
      { age_months: 6 }
    )
    expect(results).toHaveLength(1)
    expect(results[0].level).toBe('normal')
    expect(results[0].value).toBe('通过')
  })

  test('听力筛查未通过 中度异常', () => {
    const results = evaluate(
      { left: null, right: null, result: '未通过' },
      { age_months: 12 }
    )
    expect(results).toHaveLength(1)
    expect(results[0].level).toBe('moderate')
  })

  test('分耳结果 左耳异常', () => {
    const results = evaluate(
      { left: '异常', right: '正常', result: null },
      { age_months: 48 }
    )
    const leftResult = results.find(r => r.item === 'hearing_left')
    expect(leftResult).toBeDefined()
    expect(leftResult.level).toBe('moderate')
  })

  test('分耳结果 双耳正常 无异常项', () => {
    const results = evaluate(
      { left: '正常', right: '正常', result: null },
      { age_months: 48 }
    )
    expect(results).toHaveLength(0)
  })

  test('空数据返回空数组', () => {
    const results = evaluate(
      { left: null, right: null, result: null },
      { age_months: 6 }
    )
    expect(results).toHaveLength(0)
  })

  test('未测 不产生结果', () => {
    const results = evaluate(
      { left: null, right: null, result: '未测' },
      { age_months: 6 }
    )
    expect(results).toHaveLength(0)
  })
})
