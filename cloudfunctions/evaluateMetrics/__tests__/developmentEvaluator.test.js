const { evaluate } = require('../lib/developmentEvaluator')

describe('developmentEvaluator', () => {
  test('预警征正常', () => {
    const results = evaluate(
      { screening_result: '正常', positive_items: null },
      { age_months: 8 }
    )
    expect(results).toHaveLength(1)
    expect(results[0].level).toBe('normal')
  })

  test('预警征阳性 高度异常', () => {
    const results = evaluate(
      { screening_result: '阳性', positive_items: '不会独坐;不会区分生人和熟人' },
      { age_months: 8 }
    )
    expect(results).toHaveLength(1)
    expect(results[0].level).toBe('high')
    expect(results[0].positive_items).toHaveLength(2)
  })

  test('预警征阳性无具体条目 仍判异常', () => {
    const results = evaluate(
      { screening_result: '阳性', positive_items: null },
      { age_months: 12 }
    )
    expect(results).toHaveLength(1)
    expect(results[0].level).toBe('high')
  })

  test('空数据返回空数组', () => {
    const results = evaluate(
      { screening_result: null, positive_items: null },
      { age_months: 6 }
    )
    expect(results).toHaveLength(0)
  })
})
