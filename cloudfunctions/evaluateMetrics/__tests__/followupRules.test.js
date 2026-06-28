const { generateFollowup, addDays } = require('../lib/followupRules')

describe('generateFollowup', () => {
  test('全部正常不生成随访', () => {
    const items = [
      { item: 'height', level: 'normal' },
      { item: 'weight', level: 'normal' }
    ]
    const result = generateFollowup(items, '2026-06-28')
    expect(result.has_abnormal).toBe(false)
    expect(result.max_level).toBe('normal')
    expect(result.followup).toBeNull()
    expect(result.trigger_items).toHaveLength(0)
  })

  test('轻度异常生成90天随访', () => {
    const items = [
      { item: 'height', item_label: '身高', level: 'normal' },
      { item: 'weight', item_label: '体重', level: 'mild' }
    ]
    const result = generateFollowup(items, '2026-06-28')
    expect(result.has_abnormal).toBe(true)
    expect(result.max_level).toBe('mild')
    expect(result.followup.followup_days).toBe(90)
    expect(result.followup.plan_date).toBe('2026-09-26')
    expect(result.trigger_items).toHaveLength(1)
    expect(result.trigger_items[0].item).toBe('体重')
  })

  test('中度异常生成30天随访', () => {
    const items = [
      { item: 'hemoglobin', item_label: '血红蛋白', level: 'moderate' }
    ]
    const result = generateFollowup(items, '2026-06-28')
    expect(result.max_level).toBe('moderate')
    expect(result.followup.followup_days).toBe(30)
    expect(result.followup.plan_date).toBe('2026-07-28')
  })

  test('重度异常生成14天随访', () => {
    const items = [
      { item: 'hemoglobin', item_label: '血红蛋白', level: 'severe' }
    ]
    const result = generateFollowup(items, '2026-06-28')
    expect(result.max_level).toBe('severe')
    expect(result.followup.followup_days).toBe(14)
    expect(result.followup.plan_date).toBe('2026-07-12')
  })

  test('多异常取最高等级', () => {
    const items = [
      { item: 'height', item_label: '身高', level: 'mild' },
      { item: 'hemoglobin', item_label: '血红蛋白', level: 'severe' },
      { item: 'vision', item_label: '视力', level: 'moderate' }
    ]
    const result = generateFollowup(items, '2026-06-28')
    expect(result.max_level).toBe('severe')
    expect(result.followup.followup_days).toBe(14)
    expect(result.trigger_items).toHaveLength(3)
  })

  test('提醒天数为 [7, 1]', () => {
    const items = [{ item: 'test', level: 'mild' }]
    const result = generateFollowup(items, '2026-06-28')
    expect(result.followup.remind_days_before).toEqual([7, 1])
  })
})

describe('addDays', () => {
  test('加30天', () => {
    expect(addDays('2026-01-01', 30)).toBe('2026-01-31')
  })

  test('跨月', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01')
  })

  test('跨年', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
  })

  test('加0天', () => {
    expect(addDays('2026-06-28', 0)).toBe('2026-06-28')
  })

  test('闰年2月', () => {
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29')
  })
})
