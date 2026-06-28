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

module.exports = { formatDate, formatDateTime, calculateAgeMonths, ageMonthsToText, formatAge, relativeTime, formatMetricValue, truncate }
