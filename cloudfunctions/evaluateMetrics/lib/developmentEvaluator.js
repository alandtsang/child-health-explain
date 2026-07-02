/**
 * 发育评估（预警征筛查）
 * @param {Object} metrics - { screening_result, positive_items }
 *   - screening_result: "正常" 或 "阳性"
 *   - positive_items: 阳性条目内容，分号分隔
 * @param {Object} childInfo - { age_months }
 * @returns {Array} abnormal_items
 */
function evaluate(metrics, childInfo) {
  const results = []
  const { screening_result, positive_items } = metrics

  if (!screening_result) return results

  const normalized = screening_result.trim()

  if (normalized === '阳性') {
    const items = positive_items
      ? positive_items.split(/[;；]/).map(s => s.trim()).filter(Boolean)
      : []

    results.push({
      category: 'development',
      item: 'developmental_screening',
      item_label: '发育预警征筛查',
      value: '阳性',
      unit: '',
      standard_ref: '正常 = 无阳性项',
      level: 'high',
      description: items.length > 0
        ? `发育预警征阳性：${items.join('；')}。建议转儿童保健科或发育行为科进一步评估`
        : '发育预警征阳性，建议转儿童保健科进一步评估',
      positive_items: items,
      standard_source: '国家基本公共卫生服务规范（0-6岁儿童健康管理）'
    })
  } else if (normalized === '正常') {
    results.push({
      category: 'development',
      item: 'developmental_screening',
      item_label: '发育预警征筛查',
      value: '正常',
      unit: '',
      standard_ref: '正常 = 无阳性项',
      level: 'normal',
      description: '发育预警征筛查正常，各月龄发育里程碑达标',
      standard_source: '国家基本公共卫生服务规范（0-6岁儿童健康管理）'
    })
  }

  return results
}

module.exports = { evaluate }
