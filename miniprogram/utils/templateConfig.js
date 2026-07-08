// miniprogram/utils/templateConfig.js
// 订阅消息模板配置（前端侧）
//
// templateId 在微信公众平台后台创建模板后获取
// 填入 .env 文件的以下变量，运行 node scripts/sync-env.js 同步：
//   SUBSCRIBE_TEMPLATE_REPORT_PUSH
//   SUBSCRIBE_TEMPLATE_FOLLOWUP_REMIND
//   SUBSCRIBE_TEMPLATE_VIDEO_DONE
//
// 模板字段说明（需与公众平台模板一致）：
// - report_push:     thing1(报告标题), date2(报告日期)
// - followup_remind: thing1(随访项目), date2(计划日期), thing3(提醒内容)
// - video_done:      thing1(通知标题), thing2(操作提示)

const env = require('./env')

const SUBSCRIBE_TEMPLATES = {
  report_push: {
    templateId: env.subscribeTemplates && env.subscribeTemplates.report_push || '',
    page: 'pages/parent/report-detail/index',
    fields: ['thing1', 'date2']
  },
  followup_remind: {
    templateId: env.subscribeTemplates && env.subscribeTemplates.followup_remind || '',
    page: 'pages/parent/followup/index',
    fields: ['thing1', 'date2', 'thing3']
  },
  video_done: {
    templateId: env.subscribeTemplates && env.subscribeTemplates.video_done || '',
    page: 'pages/parent/report-detail/index',
    fields: ['thing1', 'thing2']
  }
}

module.exports = {
  SUBSCRIBE_TEMPLATES
}
