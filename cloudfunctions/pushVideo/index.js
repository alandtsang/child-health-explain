const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

/**
 * 医生手动推送已生成的视频给家长
 * - 校验医生身份
 * - 查询该报告关联的已完成视频（media_assets type=video status=done）
 * - 向 report.pushed_to 中的家长发送 video_done 订阅消息通知
 */
exports.main = async (event, context) => {
  const { report_id } = event;
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;

  if (!report_id) {
    return { code: 400, message: '缺少 report_id' };
  }

  const db = cloud.database();

  // 校验医生身份
  try {
    const userRes = await db.collection('users').where({ openid }).get();
    const user = userRes.data[0];
    if (!user || !user.roles || !user.roles.includes('doctor')) {
      return { code: 403, message: '仅医生端可推送视频' };
    }
  } catch (err) {
    return { code: 500, message: `身份验证失败: ${err.message}` };
  }

  // 获取报告
  let report;
  try {
    const reportRes = await db.collection('reports').doc(report_id).get();
    report = reportRes.data;
    if (!report) {
      return { code: 404, message: '报告不存在' };
    }
    if (report.review_status !== 'approved') {
      return { code: 400, message: '报告未审核通过，不可推送视频' };
    }
  } catch (err) {
    return { code: 500, message: `报告查询失败: ${err.message}` };
  }

  // 校验推送目标
  if (!report.pushed_to || report.pushed_to.length === 0) {
    return { code: 400, message: '该报告尚无推送目标家长，请先推送报告' };
  }

  // 查询已完成的视频
  let videoMedia = null;
  try {
    const mediaRes = await db.collection('media_assets')
      .where({ report_id, type: 'video', status: 'done' })
      .limit(1)
      .get();
    videoMedia = mediaRes.data[0];
  } catch (err) {
    return { code: 500, message: `视频查询失败: ${err.message}` };
  }

  if (!videoMedia) {
    return { code: 404, message: '该报告暂无已生成的视频' };
  }

  // 向家长发送视频完成通知
  let successCount = 0;
  let failCount = 0;
  const errors = [];

  for (const parentOpenid of report.pushed_to) {
    try {
      const res = await cloud.callFunction({
        name: 'sendNotification',
        data: {
          target_openid: parentOpenid,
          type: 'video_done',
          title: '科普视频已生成',
          content: '医生为您生成的科普视频已完成，点击查看',
          related_id: videoMedia._id,
          template_data: {
            thing1: { value: '科普视频已生成' },
            thing2: { value: '点击查看详情' }
          },
          sms_allowed: false
        }
      });
      if (res.result && res.result.code === 0) {
        successCount++;
      } else {
        failCount++;
        errors.push(`家长 ${parentOpenid}: 通知发送失败`);
      }
    } catch (err) {
      failCount++;
      errors.push(`家长 ${parentOpenid}: ${err.message}`);
      console.error(`视频推送通知发送失败 ${parentOpenid}: ${err.message}`);
    }
  }

  return {
    code: 0,
    message: `视频推送完成：成功 ${successCount} 人，失败 ${failCount} 人`,
    data: {
      media_id: videoMedia._id,
      file_id: videoMedia.file_id,
      success_count: successCount,
      fail_count: failCount,
      errors: errors.length > 0 ? errors : undefined
    }
  };
};
