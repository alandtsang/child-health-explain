/**
 * 听力评估
 * @param {Object} metrics - { left, right, result }
 *   - result: 婴幼儿表单单值听力筛查 "通过"/"未通过"/"未测"
 *   - left/right: 分耳结果 "正常"/"异常"（部分体检报告格式）
 * @param {Object} childInfo - { age_months }
 * @returns {Array} abnormal_items
 */
function evaluate(metrics, childInfo) {
  const results = []
  const { result, left, right } = metrics

  // 模式1：单值听力筛查（国家标准婴幼儿表单）
  if (result) {
    const normalized = result.trim()
    if (normalized === '未通过' || normalized === '2') {
      results.push({
        category: 'hearing',
        item: 'hearing_screening',
        item_label: '听力筛查',
        value: normalized,
        unit: '',
        standard_ref: '正常 = 通过',
        level: 'moderate',
        description: `听力筛查未通过，建议复查或转专科听力诊断`,
        standard_source: '国家基本公共卫生服务规范'
      })
    } else if (normalized === '通过' || normalized === '1') {
      results.push({
        category: 'hearing',
        item: 'hearing_screening',
        item_label: '听力筛查',
        value: normalized,
        unit: '',
        standard_ref: '正常 = 通过',
        level: 'normal',
        description: '听力筛查通过',
        standard_source: '国家基本公共卫生服务规范'
      })
    }
  }

  // 模式2：分耳结果（通用体检报告）
  for (const [side, label] of [['left', '左耳'], ['right', '右耳']]) {
    const val = metrics[side]
    if (!val) continue
    const normalized = val.trim()
    if (normalized === '异常' || normalized === '未通过') {
      results.push({
        category: 'hearing',
        item: `hearing_${side}`,
        item_label: `${label}听力`,
        value: normalized,
        unit: '',
        standard_ref: '正常 = 正常/通过',
        level: 'moderate',
        description: `${label}听力异常，建议进一步检查`,
        standard_source: '临床判定'
      })
    }
  }

  return results
}

module.exports = { evaluate }
