/**
 * 订阅消息模板配置
 * 实际 templateId 需在微信公众平台后台创建模板后，填入云函数环境变量
 *
 * 模板字段说明（需与公众平台模板一致）：
 * - report_push:     thing1(报告标题), date2(报告日期)
 * - followup_remind: thing1(随访项目), date2(计划日期), thing3(提醒内容)
 * - video_done:      thing1(通知标题), thing2(操作提示)
 */
const SUBSCRIBE_TEMPLATES = {
  report_push: {
    template_id: process.env.SUBSCRIBE_TEMPLATE_REPORT_PUSH,
    page: 'pages/parent/report-detail/index',
    fields: ['thing1', 'date2']
  },
  followup_remind: {
    template_id: process.env.SUBSCRIBE_TEMPLATE_FOLLOWUP_REMIND,
    page: 'pages/parent/followup/index',
    fields: ['thing1', 'date2', 'thing3']
  },
  video_done: {
    template_id: process.env.SUBSCRIBE_TEMPLATE_VIDEO_DONE,
    page: 'pages/parent/report-detail/index',
    fields: ['thing1', 'thing2']
  }
};

/**
 * 短信模板配置
 * 短信仅用于：报告推送 + 随访提醒(severe/失访)
 * video_done 不发短信（设为 null）
 *
 * TemplateParamSet 参数顺序需与腾讯云短信模板占位符一致：
 * - report_push:     {1}儿童姓名, {2}报告日期
 * - followup_remind: {1}儿童姓名, {2}计划日期, {3}提醒内容
 */
const SMS_TEMPLATES = {
  report_push: {
    template_id: process.env.SMS_TEMPLATE_REPORT_PUSH,
    param_count: 2
  },
  followup_remind: {
    template_id: process.env.SMS_TEMPLATE_FOLLOWUP_REMIND,
    param_count: 3
  },
  video_done: null
};

module.exports = {
  SUBSCRIBE_TEMPLATES,
  SMS_TEMPLATES
};
