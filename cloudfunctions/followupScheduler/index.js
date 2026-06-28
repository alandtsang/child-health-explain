const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const LEVEL_PRIORITY = { severe: 0, moderate: 1, mild: 2, normal: 3 };

/**
 * 格式化日期为 YYYY-MM-DD
 */
function formatDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * 从 trigger_items 获取最高等级
 */
function getHighestLevel(triggerItems) {
  if (!triggerItems || triggerItems.length === 0) return null;
  const sorted = [...triggerItems].sort(
    (a, b) =>
      (LEVEL_PRIORITY[a.level] ?? 9) - (LEVEL_PRIORITY[b.level] ?? 9)
  );
  return sorted[0].level;
}

exports.main = async (event, context) => {
  const db = cloud.database();
  const _ = db.command;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const results = {
    reminders_sent: 0,
    lost_marked: 0,
    errors: []
  };

  // 获取所有活跃随访计划（scheduled 或 reminded）
  const followupsRes = await db
    .collection('followups')
    .where({
      status: _.in(['scheduled', 'reminded'])
    })
    .limit(50)
    .get();

  for (const followup of followupsRes.data) {
    try {
      const planDate = new Date(followup.plan_date);
      planDate.setHours(0, 0, 0, 0);

      // 计算与今天的日期差（天）
      const diffDays = Math.round(
        (planDate - today) / (1000 * 60 * 60 * 24)
      );

      // 提前 7 天、1 天提醒
      if ([7, 1].includes(diffDays)) {
        // 检查是否已发送过该天数的提醒
        const alreadySent = (followup.remind_records || []).some(
          r => r.days_before === diffDays
        );
        if (!alreadySent) {
          await sendReminder(followup, diffDays);
          results.reminders_sent++;
        }
      }

      // 到期后 7 天未完成 → 标记失访
      if (diffDays < -7) {
        await markLost(followup);
        results.lost_marked++;
      }
    } catch (err) {
      results.errors.push({
        followup_id: followup._id,
        error: err.message
      });
      console.error(`随访处理异常 ${followup._id}: ${err.message}`);
    }
  }

  return {
    code: 0,
    ...results
  };
};

/**
 * 发送随访提醒
 * @param {Object} followup - 随访计划
 * @param {number} daysBefore - 提前天数 (7 或 1)
 */
async function sendReminder(followup, daysBefore) {
  const db = cloud.database();
  const _ = db.command;

  // 获取儿童信息
  const childRes = await db.collection('children').doc(followup.child_id).get();
  const child = childRes.data;
  const childName = child ? child.name : '您的孩子';

  // 获取绑定的家长
  const parentIds = child ? child.bound_parent_ids || [] : [];
  if (parentIds.length === 0) return;

  // 判断是否 severe 级别（仅 severe 允许短信兜底）
  const highestLevel = getHighestLevel(followup.trigger_items);
  const isSevere = highestLevel === 'severe';

  const reminderDesc =
    daysBefore === 7 ? '7天后到期，请安排复查' : '明天到期，请安排复查';
  const content = `您孩子${childName}的体检随访${reminderDesc}`;

  // 向每位家长发送通知
  for (const openid of parentIds) {
    try {
      const result = await cloud.callFunction({
        name: 'sendNotification',
        data: {
          target_openid: openid,
          type: 'followup_remind',
          title: '随访到期提醒',
          content,
          related_id: followup._id,
          template_data: {
            thing1: { value: `${childName}的体检随访` },
            date2: { value: followup.plan_date },
            thing3: { value: reminderDesc }
          },
          sms_allowed: isSevere,
          sms_params: isSevere
            ? [childName, followup.plan_date, reminderDesc]
            : null
        }
      });

      // 记录提醒发送
      const channel =
        result.result && result.result.channel
          ? result.result.channel
          : 'mp_subscribe';

      await db
        .collection('followups')
        .doc(followup._id)
        .update({
          data: {
            status: 'reminded',
            remind_records: _.push({
              channel,
              sent_at: db.serverDate(),
              days_before: daysBefore
            })
          }
        });
    } catch (err) {
      console.error(`随访提醒发送失败 ${openid}: ${err.message}`);
    }
  }
}

/**
 * 标记失访并通知
 * @param {Object} followup - 随访计划
 */
async function markLost(followup) {
  const db = cloud.database();

  // 更新状态为失访
  await db
    .collection('followups')
    .doc(followup._id)
    .update({
      data: {
        status: 'lost'
      }
    });

  // 获取儿童信息
  const childRes = await db.collection('children').doc(followup.child_id).get();
  const child = childRes.data;
  const childName = child ? child.name : '您的孩子';

  // 获取绑定的家长
  const parentIds = child ? child.bound_parent_ids || [] : [];

  // 失访通知始终允许短信兜底
  for (const openid of parentIds) {
    try {
      await cloud.callFunction({
        name: 'sendNotification',
        data: {
          target_openid: openid,
          type: 'followup_remind',
          title: '随访失访通知',
          content: `您孩子${childName}的体检随访已超期，建议尽快安排复查`,
          related_id: followup._id,
          template_data: {
            thing1: { value: `${childName}的体检随访` },
            date2: { value: followup.plan_date },
            thing3: { value: '已超期，请尽快复查' }
          },
          sms_allowed: true,
          sms_params: [childName, followup.plan_date, '已超期，请尽快复查']
        }
      });
    } catch (err) {
      console.error(`失访通知发送失败 ${openid}: ${err.message}`);
    }
  }
}
