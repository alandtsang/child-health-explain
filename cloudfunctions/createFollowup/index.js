const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

// 随访分级映射：等级 → { 间隔天数, 标签 }
const FOLLOWUP_MAPPING = {
  mild: { interval_days: 90, label: '3个月' },
  moderate: { interval_days: 30, label: '1个月' },
  severe: { interval_days: 14, label: '2周' }
};

// 异常等级优先级（数字越小优先级越高）
const LEVEL_PRIORITY = { severe: 0, moderate: 1, mild: 2, normal: 3 };

/**
 * 获取异常项中的最高等级
 * @param {Array} abnormalItems - 异常项列表
 * @returns {string|null} 最高等级 (mild/moderate/severe)，全正常返回 null
 */
function getHighestLevel(abnormalItems) {
  if (!abnormalItems || abnormalItems.length === 0) {
    return null;
  }
  // 过滤掉 normal 项
  const abnormal = abnormalItems.filter(item => item.level !== 'normal');
  if (abnormal.length === 0) {
    return null;
  }
  // 按优先级排序，取最高等级
  abnormal.sort(
    (a, b) =>
      (LEVEL_PRIORITY[a.level] ?? 9) - (LEVEL_PRIORITY[b.level] ?? 9)
  );
  return abnormal[0].level;
}

/**
 * 根据等级计算计划复查日期
 * @param {string} level - 异常等级
 * @returns {Date|null} 计划日期
 */
function calculatePlanDate(level) {
  const mapping = FOLLOWUP_MAPPING[level];
  if (!mapping) return null;
  const date = new Date();
  date.setDate(date.getDate() + mapping.interval_days);
  return date;
}

/**
 * 格式化日期为 YYYY-MM-DD
 */
function formatDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

exports.main = async (event, context) => {
  const { exam_id } = event;

  if (!exam_id) {
    return { code: 400, message: '缺少 exam_id' };
  }

  const db = cloud.database();

  // 幂等检查：同一 exam_id 不重复创建
  const existingRes = await db
    .collection('followups')
    .where({ exam_id })
    .get();

  if (existingRes.data.length > 0) {
    return {
      code: 0,
      message: '随访计划已存在',
      data: { followup_id: existingRes.data[0]._id }
    };
  }

  // 获取体检记录
  let exam;
  try {
    const examRes = await db.collection('exams').doc(exam_id).get();
    exam = examRes.data;
    if (!exam) {
      return { code: 404, message: '体检记录不存在' };
    }
  } catch (err) {
    return { code: 500, message: `查询体检记录失败: ${err.message}` };
  }

  const abnormalItems = exam.abnormal_items || [];

  // 提取所有非 normal 项作为触发项
  const triggerItems = abnormalItems
    .filter(item => item.level !== 'normal')
    .map(item => ({ item: item.item, level: item.level }));

  // 所有项 normal → 不生成随访
  if (triggerItems.length === 0) {
    return {
      code: 0,
      message: '所有指标正常，无需随访',
      data: null
    };
  }

  // 获取最高等级
  const highestLevel = getHighestLevel(abnormalItems);
  if (!highestLevel) {
    return {
      code: 0,
      message: '所有指标正常，无需随访',
      data: null
    };
  }

  // 计算计划复查日期
  const planDate = calculatePlanDate(highestLevel);
  const planDateStr = formatDate(planDate);

  // 创建随访计划
  const addRes = await db.collection('followups').add({
    data: {
      exam_id,
      child_id: exam.child_id,
      doctor_id: exam.doctor_id,
      trigger_items: triggerItems,
      plan_date: planDateStr,
      remind_days_before: [7, 1],
      status: 'scheduled',
      remind_records: [],
      completed_at: null,
      completion_source: null,
      created_at: db.serverDate()
    }
  });

  return {
    code: 0,
    message: '随访计划已创建',
    data: {
      followup_id: addRes._id,
      plan_date: planDateStr,
      level: highestLevel,
      interval_label: FOLLOWUP_MAPPING[highestLevel].label,
      trigger_items: triggerItems
    }
  };
};
