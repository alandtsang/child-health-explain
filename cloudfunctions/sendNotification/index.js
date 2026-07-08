const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const { SmsClient } = require('tencentcloud-sdk-nodejs-sms').sms.v20210111;

// 加载本地密钥配置（由 sync-env.js 从 .env 同步生成，已 gitignore）
let localSecrets = {};
try {
  localSecrets = require('../secrets.local');
} catch (e) {
  // secrets.local.js 不存在时忽略，使用云函数环境变量
}

// 从环境变量或本地密钥配置中获取配置值
function getConfig(key) {
  return process.env[key] || localSecrets[key] || '';
}

const SUBSCRIBE_TEMPLATES = {
  report_push: {
    template_id: getConfig('SUBSCRIBE_TEMPLATE_REPORT_PUSH'),
    page: 'pages/parent/report-detail/index',
    fields: ['thing1', 'date2']
  },
  followup_remind: {
    template_id: getConfig('SUBSCRIBE_TEMPLATE_FOLLOWUP_REMIND'),
    page: 'pages/parent/followup/index',
    fields: ['thing1', 'date2', 'thing3']
  },
  video_done: {
    template_id: getConfig('SUBSCRIBE_TEMPLATE_VIDEO_DONE'),
    page: 'pages/parent/report-detail/index',
    fields: ['thing1', 'thing2']
  }
};

const SMS_TEMPLATES = {
  report_push: {
    template_id: getConfig('SMS_TEMPLATE_REPORT_PUSH'),
    param_count: 2
  },
  followup_remind: {
    template_id: getConfig('SMS_TEMPLATE_FOLLOWUP_REMIND'),
    param_count: 3
  },
  video_done: {
    template_id: getConfig('SMS_TEMPLATE_VIDEO_DONE'),
    param_count: 1
  }
};

// SMS 客户端单例
let smsClient = null;

function getSmsClient() {
  if (!smsClient) {
    const secretId = getConfig('TENCENTCLOUD_SECRET_ID');
    const secretKey = getConfig('TENCENTCLOUD_SECRET_KEY');
    if (!secretId || !secretKey) {
      throw new Error('腾讯云密钥未配置：请在 .env 中设置 TENCENTCLOUD_SECRET_ID / TENCENTCLOUD_SECRET_KEY');
    }
    smsClient = new SmsClient({
      credential: { secretId, secretKey },
      region: 'ap-guangzhou'
    });
  }
  return smsClient;
}

exports.main = async (event, context) => {
  const {
    target_openid,
    type,
    title,
    content,
    related_id,
    template_data,
    page,
    sms_allowed,
    sms_params
  } = event;

  // 参数校验
  if (!target_openid) {
    return { code: 400, message: '缺少 target_openid' };
  }
  if (!type || !SUBSCRIBE_TEMPLATES[type]) {
    return { code: 400, message: `无效的消息类型: ${type}` };
  }

  const db = cloud.database();

  // Step 1: 创建 notifications 记录（status=pending）
  const notifRes = await db.collection('notifications').add({
    data: {
      target_openid,
      type,
      title: title || '',
      content: content || '',
      channel: null,
      status: 'pending',
      related_id: related_id || null,
      sent_at: null,
      created_at: db.serverDate()
    }
  });
  const notifId = notifRes._id;

  // Step 2: 尝试发送订阅消息（主通道）
  const subscribeTemplate = SUBSCRIBE_TEMPLATES[type];
  let subscribeSuccess = false;
  let lastError = null;

  if (subscribeTemplate.template_id) {
    try {
      await cloud.openapi.subscribeMessage.send({
        touser: target_openid,
        templateId: subscribeTemplate.template_id,
        page: page || subscribeTemplate.page,
        miniprogramState: 'formal',
        lang: 'zh_CN',
        data: template_data || {}
      });
      subscribeSuccess = true;
    } catch (err) {
      lastError = err;
      // errCode 43101 = 用户未订阅 / 配额不足
      // errCode 47003 = 模板参数不准确
      console.warn(
        `订阅消息发送失败 [${type}] openid=${target_openid} errCode=${err.errCode} msg=${err.errMsg || err.message}`
      );
    }
  } else {
    lastError = new Error(`未配置 ${type} 的订阅消息模板 ID`);
  }

  // 订阅消息发送成功
  if (subscribeSuccess) {
    await db
      .collection('notifications')
      .doc(notifId)
      .update({
        data: {
          channel: 'mp_subscribe',
          status: 'sent',
          sent_at: db.serverDate()
        }
      });
    return {
      code: 0,
      message: '订阅消息发送成功',
      channel: 'mp_subscribe'
    };
  }

  // Step 3: 订阅消息失败，尝试短信兜底
  if (sms_allowed && SMS_TEMPLATES[type] && SMS_TEMPLATES[type].template_id) {
    const smsTemplate = SMS_TEMPLATES[type];

    // 查询用户手机号
    let phone = null;
    try {
      const userRes = await db
        .collection('users')
        .where({ openid: target_openid })
        .get();
      const user = userRes.data[0];
      phone = user && user.parent_info ? user.parent_info.phone : null;
    } catch (err) {
      console.error(`查询用户手机号失败: ${err.message}`);
    }

    if (phone) {
      try {
        const client = getSmsClient();
        await client.SendSms({
          PhoneNumberSet: [`+86${phone}`],
          SmsSdkAppId: getConfig('SMS_SDK_APP_ID'),
          SignName: getConfig('SMS_SIGN_NAME'),
          TemplateId: smsTemplate.template_id,
          TemplateParamSet: sms_params || []
        });

        // 短信发送成功
        await db
          .collection('notifications')
          .doc(notifId)
          .update({
            data: {
              channel: 'sms',
              status: 'sent',
              sent_at: db.serverDate()
            }
          });
        return {
          code: 0,
          message: '短信发送成功',
          channel: 'sms'
        };
      } catch (smsErr) {
        lastError = smsErr;
        console.error(`短信发送失败: ${smsErr.message}`);
      }
    } else {
      console.warn(`用户 ${target_openid} 无绑定手机号，短信兜底跳过`);
    }
  }

  // Step 4: 所有通道均失败
  await db
    .collection('notifications')
    .doc(notifId)
    .update({
      data: {
        channel: sms_allowed ? 'sms' : 'mp_subscribe',
        status: 'failed',
        sent_at: db.serverDate()
      }
    });

  return {
    code: 500,
    message: '消息发送失败',
    error: lastError ? lastError.message || lastError.errMsg : '所有通道均不可用'
  };
};
