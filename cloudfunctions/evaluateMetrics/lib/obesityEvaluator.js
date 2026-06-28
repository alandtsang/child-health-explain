const path = require('path')
const { interpolateRow, round2 } = require('./interpolate')

const obesityData = require('../standards/obesity-wst586.json')

/**
 * 超重肥胖评估（BMI）
 * @param {Object} metrics - { height, weight }
 * @param {Object} childInfo - { age_months, gender }
 * @returns {Array} abnormal_items
 */
function evaluate(metrics, childInfo) {
  const results = []
  const { height, weight } = metrics
  const { age_months, gender } = childInfo

  // 需同时有身高和体重
  if (!height || !weight) return results

  const ageYears = Math.floor(age_months / 12)

  // 仅 6-17 岁适用
  if (ageYears < 6 || ageYears > 17) return results

  const genderKey = gender === 'male' ? 'boys' : 'girls'
  const table = obesityData.tables[genderKey]

  // 查找对应年龄行（精确匹配，无需插值）
  const row = table.find(r => r.age_years === ageYears)
  if (!row) return results

  // 计算 BMI
  const heightM = height / 100
  const bmi = round2(weight / (heightM * heightM))

  let level = 'normal'
  let description = `BMI=${bmi} kg/m2，正常`

  if (bmi >= row.obese_bmi) {
    level = 'moderate'
    description = `BMI=${bmi} >= ${row.obese_bmi}，肥胖`
  } else if (bmi >= row.overweight_bmi) {
    level = 'mild'
    description = `BMI=${bmi} >= ${row.overweight_bmi}，超重`
  }

  results.push({
    category: 'obesity',
    item: 'bmi',
    item_label: '体质指数(BMI)',
    value: bmi,
    unit: 'kg/m2',
    standard_ref: `超重>=${row.overweight_bmi}, 肥胖>=${row.obese_bmi}`,
    level,
    description,
    standard_source: 'WS/T 586-2018'
  })

  return results
}

module.exports = { evaluate }
