const config = require('../standards/config.json')

/**
 * 根据异常项列表，确定最高异常等级和随访计划
 * @param {Array} abnormalItems - 所有评估项（含 normal）
 * @param {string} examDate - 体检日期 'YYYY-MM-DD'
 * @returns {{ max_level: string, has_abnormal: boolean, followup: Object|null, trigger_items: Array }}
 */
function generateFollowup(abnormalItems, examDate) {
  const levelPriority = config.level_priority

  // 过滤出非 normal 项
  const abnormalOnly = abnormalItems.filter(item => item.level !== 'normal')

  // 找出最高等级
  let maxLevel = 'normal'
  let maxPriority = 0
  for (const item of abnormalItems) {
    const priority = levelPriority[item.level] || 0
    if (priority > maxPriority) {
      maxPriority = priority
      maxLevel = item.level
    }
  }

  const hasAbnormal = abnormalOnly.length > 0

  if (!hasAbnormal) {
    return {
      max_level: 'normal',
      has_abnormal: false,
      followup: null,
      trigger_items: []
    }
  }

  // 触发项（记录 item + level）
  const triggerItems = abnormalOnly.map(item => ({
    item: item.item_label || item.item,
    level: item.level
  }))

  // 计算随访日期
  const followupDays = config.abnormal_levels[maxLevel].followup_days
  const planDate = addDays(examDate, followupDays)

  const followup = {
    plan_date: planDate,
    followup_days: followupDays,
    remind_days_before: config.followup_rules.remind_days_before,
    max_level: maxLevel,
    trigger_items: triggerItems
  }

  return {
    max_level: maxLevel,
    has_abnormal: true,
    followup,
    trigger_items: triggerItems
  }
}

/**
 * 给日期字符串加天数
 * @param {string} dateStr - 'YYYY-MM-DD'
 * @param {number} days
 * @returns {string} 'YYYY-MM-DD'
 */
function addDays(dateStr, days) {
  const date = new Date(dateStr + 'T00:00:00')
  date.setDate(date.getDate() + days)
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

module.exports = { generateFollowup, addDays }
