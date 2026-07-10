// miniprogram/utils/format.js
function formatDate(date, fmt) {
  if (!date) return ''
  const d = new Date(date)
  if (isNaN(d.getTime())) return ''
  fmt = fmt || 'YYYY-MM-DD'
  const o = { 'YYYY': d.getFullYear(), 'MM': String(d.getMonth() + 1).padStart(2, '0'), 'DD': String(d.getDate()).padStart(2, '0'), 'HH': String(d.getHours()).padStart(2, '0'), 'mm': String(d.getMinutes()).padStart(2, '0'), 'ss': String(d.getSeconds()).padStart(2, '0') }
  return fmt.replace(/YYYY|MM|DD|HH|mm|ss/g, m => o[m])
}

function formatDateTime(date) { return formatDate(date, 'YYYY-MM-DD HH:mm') }

function calculateAgeMonths(birthDate, referenceDate) {
  if (!birthDate) return 0
  const birth = new Date(birthDate)
  const ref = referenceDate ? new Date(referenceDate) : new Date()
  const months = (ref.getFullYear() - birth.getFullYear()) * 12 + (ref.getMonth() - birth.getMonth())
  return ref.getDate() < birth.getDate() ? months - 1 : months
}

function ageMonthsToText(months) {
  if (months < 12) return `${months}个月`
  const years = Math.floor(months / 12)
  const remain = months % 12
  return remain === 0 ? `${years}岁` : `${years}岁${remain}个月`
}

function formatAge(birthDate, referenceDate) { return ageMonthsToText(calculateAgeMonths(birthDate, referenceDate)) }

function relativeTime(date) {
  if (!date) return ''
  const diff = Date.now() - new Date(date).getTime()
  const min = Math.floor(diff / 60000), hour = Math.floor(diff / 3600000), day = Math.floor(diff / 86400000)
  if (min < 1) return '刚刚'
  if (min < 60) return `${min}分钟前`
  if (hour < 24) return `${hour}小时前`
  if (day < 7) return `${day}天前`
  if (day < 30) return `${Math.floor(day/7)}周前`
  if (day < 365) return `${Math.floor(day/30)}个月前`
  return `${Math.floor(day/365)}年前`
}

function formatMetricValue(value, decimals) {
  if (value === null || value === undefined || value === '') return '--'
  const num = Number(value)
  if (isNaN(num)) return String(value)
  if (decimals !== undefined) return num.toFixed(decimals)
  return Number.isInteger(num) ? String(num) : String(num)
}

function truncate(text, maxLen) { return (!text || text.length <= maxLen) ? (text||'') : text.substring(0, maxLen) + '...' }

// 异常项英文代码 → 中文标签映射（兼容旧数据）
const TRIGGER_LABEL_MAP = {
  height_for_age: '身高',
  weight_for_age: '体重',
  bmi: '体质指数(BMI)',
  hemoglobin: '血红蛋白',
  overall: '整体视力',
  left: '左眼',
  right: '右眼',
  caries_count: '龋齿数',
  spine_screening: '脊柱筛查',
  hearing_screening: '听力筛查',
  developmental_screening: '发育预警征筛查',
  rickets_signs: '佝偻病体征',
  rickets_symptoms: '佝偻病症状'
}

/**
 * 将触发项的英文代码转为中文标签
 * 已是中文的旧数据（如 createFollowup 修复后存储的 item_label）直接返回
 * @param {string} item - 触发项 item 字段
 * @returns {string} 中文标签
 */
function formatTriggerLabel(item) {
  if (!item) return ''
  return TRIGGER_LABEL_MAP[item] || item
}

/**
 * 修正旧数据中的术语变体，统一为简洁的"身高"/"体重"
 * 历史数据可能使用"身高别年龄""体重别年龄"或"年龄别身高""年龄别体重"，均替换为简洁表述
 * @param {string} text - 可能包含旧术语的文本
 * @returns {string} 修正后的文本
 */
function fixGrowthTerms(text) {
  if (!text || typeof text !== 'string') return text
  return text
    .replace(/身高别年龄/g, '身高')
    .replace(/年龄别身高/g, '身高')
    .replace(/体重别年龄/g, '体重')
    .replace(/年龄别体重/g, '体重')
}

/**
 * 递归修正对象中所有字符串值的错误术语（用于修正 abnormal_items、ai_content 等存储数据）
 * @param {*} obj - 任意数据结构
 * @returns {*} 修正后的同结构数据
 */
function fixGrowthTermsDeep(obj) {
  if (typeof obj === 'string') return fixGrowthTerms(obj)
  if (Array.isArray(obj)) return obj.map(fixGrowthTermsDeep)
  if (obj && typeof obj === 'object') {
    const result = {}
    for (const key in obj) {
      result[key] = fixGrowthTermsDeep(obj[key])
    }
    return result
  }
  return obj
}

module.exports = { formatDate, formatDateTime, calculateAgeMonths, ageMonthsToText, formatAge, relativeTime, formatMetricValue, truncate, formatTriggerLabel, fixGrowthTerms, fixGrowthTermsDeep }
