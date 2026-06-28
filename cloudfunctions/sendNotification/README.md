# sendNotification 云函数配置说明

## 环境变量

在云开发控制台 → 云函数 → sendNotification → 环境变量 中配置：

| 变量名 | 说明 | 获取方式 |
|--------|------|----------|
| TENCENTCLOUD_SECRET_ID | 腾讯云 API 密钥 ID | 腾讯云控制台 → 访问管理 → API 密钥管理 |
| TENCENTCLOUD_SECRET_KEY | 腾讯云 API 密钥 Key | 同上 |
| SMS_SDK_APP_ID | 短信应用 SDK AppId | 腾讯云短信控制台 → 应用管理 |
| SMS_SIGN_NAME | 短信签名内容 | 腾讯云短信控制台 → 签名管理（如"儿童健康"） |
| SMS_TEMPLATE_REPORT_PUSH | 报告推送短信模板 ID | 腾讯云短信控制台 → 正文模板管理 |
| SMS_TEMPLATE_FOLLOWUP_REMIND | 随访提醒短信模板 ID | 同上 |
| SUBSCRIBE_TEMPLATE_REPORT_PUSH | 报告推送订阅消息模板 ID | 微信公众平台 → 订阅消息 → 模板 |
| SUBSCRIBE_TEMPLATE_FOLLOWUP_REMIND | 随访提醒订阅消息模板 ID | 同上 |
| SUBSCRIBE_TEMPLATE_VIDEO_DONE | 视频完成订阅消息模板 ID | 同上 |

## 订阅消息模板字段

### 报告推送 (report_push)
- thing1: 报告标题（如"儿童姓名的体检报告"）
- date2: 报告日期（如"2026-06-28"）

### 随访提醒 (followup_remind)
- thing1: 随访项目（如"张小明的体检随访"）
- date2: 计划日期（如"2026-07-28"）
- thing3: 提醒内容（如"7天后到期，请安排复查"）

### 视频完成 (video_done)
- thing1: 通知标题（如"科普视频已生成"）
- thing2: 操作提示（如"点击查看详情"）

## 短信模板参数

### 报告推送 (SMS_TEMPLATE_REPORT_PUSH)
- {1}: 儿童姓名
- {2}: 报告日期

### 随访提醒 (SMS_TEMPLATE_FOLLOWUP_REMIND)
- {1}: 儿童姓名
- {2}: 计划日期
- {3}: 提醒内容

## 短信发送规则

短信仅在以下场景作为兜底发送（订阅消息失败时）：
1. 报告推送（report_push）—— 始终允许短信兜底
2. 随访提醒（followup_remind）—— 仅 severe 级别允许短信兜底
3. 失访通知（followup type=followup_remind）—— 始终允许短信兜底
4. 视频完成（video_done）—— 不发短信

调用方通过 `sms_allowed` 参数控制是否允许短信兜底。
