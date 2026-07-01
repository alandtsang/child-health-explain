/**
 * 佝偻病筛查评估
 * @param {Object} metrics - { symptoms, signs }
 *   - symptoms: "无" 或具体症状如 "夜惊,多汗,烦躁"
 *   - signs: "无" 或具体体征如 "肋串珠,方颅"
 * @param {Object} childInfo - { age_months }
 * @returns {Array} abnormal_items
 */
function evaluate(metrics, childInfo) {
  const results = []
  const { symptoms, signs } = metrics

  // 体征阳性 = 佝偻病可疑，需要随访
  if (signs) {
    const normalized = signs.trim()
    if (normalized !== '无' && normalized !== '' && normalized !== '1') {
      results.push({
        category: 'rickets',
        item: 'rickets_signs',
        item_label: '佝偻病体征',
        value: normalized,
        unit: '',
        standard_ref: '正常 = 无',
        level: 'moderate',
        description: `可疑佝偻病体征：${normalized}。建议补充维生素D并复查，必要时转诊`,
        standard_source: '国家基本公共卫生服务规范'
      })
    } else if (normalized === '无' || normalized === '1') {
      results.push({
        category: 'rickets',
        item: 'rickets_signs',
        item_label: '佝偻病体征',
        value: '无',
        unit: '',
        standard_ref: '正常 = 无',
        level: 'normal',
        description: '无可疑佝偻病体征',
        standard_source: '国家基本公共卫生服务规范'
      })
    }
  }

  // 症状阳性 = 提示性，需关注（级别低于体征）
  if (symptoms) {
    const normalized = symptoms.trim()
    if (normalized !== '无' && normalized !== '' && normalized !== '1') {
      results.push({
        category: 'rickets',
        item: 'rickets_symptoms',
        item_label: '佝偻病症状',
        value: normalized,
        unit: '',
        standard_ref: '正常 = 无',
        level: 'mild',
        description: `可疑佝偻病症状：${normalized}。建议关注维生素D补充情况，下次随访复查`,
        standard_source: '国家基本公共卫生服务规范'
      })
    }
  }

  return results
}

module.exports = { evaluate }
