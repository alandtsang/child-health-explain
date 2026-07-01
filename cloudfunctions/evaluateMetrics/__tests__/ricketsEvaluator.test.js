const { evaluate } = require('../lib/ricketsEvaluator')

describe('ricketsEvaluator', () => {
  test('体征正常 症状正常', () => {
    const results = evaluate(
      { symptoms: '无', signs: '无' },
      { age_months: 6 }
    )
    expect(results).toHaveLength(1)
    expect(results[0].level).toBe('normal')
  })

  test('体征阳性 中度异常', () => {
    const results = evaluate(
      { symptoms: '无', signs: '肋串珠,方颅' },
      { age_months: 8 }
    )
    const signResult = results.find(r => r.item === 'rickets_signs')
    expect(signResult).toBeDefined()
    expect(signResult.level).toBe('moderate')
  })

  test('症状阳性 轻度异常', () => {
    const results = evaluate(
      { symptoms: '夜惊,多汗', signs: '无' },
      { age_months: 3 }
    )
    const symResult = results.find(r => r.item === 'rickets_symptoms')
    expect(symResult).toBeDefined()
    expect(symResult.level).toBe('mild')
  })

  test('体征和症状同时阳性 产生两条', () => {
    const results = evaluate(
      { symptoms: '烦躁', signs: '鸡胸' },
      { age_months: 12 }
    )
    expect(results).toHaveLength(2)
    const signResult = results.find(r => r.item === 'rickets_signs')
    const symResult = results.find(r => r.item === 'rickets_symptoms')
    expect(signResult.level).toBe('moderate')
    expect(symResult.level).toBe('mild')
  })

  test('空数据返回空数组', () => {
    const results = evaluate(
      { symptoms: null, signs: null },
      { age_months: 6 }
    )
    expect(results).toHaveLength(0)
  })
})
