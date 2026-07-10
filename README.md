# child-health-explain
通过 AI 解读儿童体检报告

## 环境配置

项目使用 `.env` 文件集中管理所有配置项（AppID、云环境、API Key 等），避免在多个文件中重复修改。

### 首次配置

```bash
# 1. 复制配置模板
cp .env.example .env

# 2. 编辑 .env，填入实际值
#    - WX_APPID: 微信小程序 AppID
#    - CLOUD_ENV: 云开发环境ID
#    - ARK_API_KEY: 火山方舟(豆包) API Key
#    - TENCENTCLOUD_SECRET_ID / SECRET_KEY: 腾讯云密钥（OCR用）

# 3. 运行同步脚本，自动分发到各文件
node scripts/sync-env.js
```

同步脚本会自动完成以下操作：
- 生成 6 个云函数的 `secrets.local.js`（含 API Key）
- 同步 `arkClient.js` 到各云函数 `lib/` 目录
- 生成 `miniprogram/utils/env.js`（云环境配置）
- 更新 `project.config.json` 中的 `appid`
- 更新 `cloudbaserc.json` 中的 `envId`

### 修改配置

只需编辑 `.env` 文件，然后重新运行 `node scripts/sync-env.js` 即可。

### 文件说明

| 文件 | 说明 | 是否提交到 Git |
|------|------|---------------|
| `.env` | 配置源文件（所有密钥） | 否（gitignored） |
| `.env.example` | 配置模板 | 是 |
| `cloudbaserc.example.json` | cloudbaserc 配置模板 | 是 |
| `cloudfunctions/*/secrets.local.js` | 各云函数密钥（自动生成） | 否（gitignored） |
| `cloudfunctions/*/lib/arkClient.js` | API 客户端（自动同步） | 是 |
| `cloudbaserc.json` | cloudbase 配置（自动生成） | 否（gitignored） |
| `miniprogram/utils/env.js` | 小程序环境配置（自动生成） | 否（gitignored） |
| `scripts/sync-env.js` | 同步脚本 | 是 |

### 生产环境建议

除了使用 `secrets.local.js`，建议在微信开发者工具中为每个云函数设置环境变量 `ARK_API_KEY`，这样即使不上传 `secrets.local.js` 也能正常运行。

### 订阅消息配置

通知推送功能依赖微信订阅消息，需在 [微信公众平台](https://mp.weixin.qq.com/) 后台创建订阅消息模板：

1. 进入「功能」→「订阅消息」→「我的模板」
2. 创建以下 3 个模板，记录模板 ID 填入 `.env`：

| 环境变量 | 模板用途 | 关键词字段 |
|----------|----------|-----------|
| `SUBSCRIBE_TEMPLATE_REPORT_PUSH` | 报告推送通知 | thing1(报告标题), date2(报告日期) |
| `SUBSCRIBE_TEMPLATE_FOLLOWUP_REMIND` | 随访到期提醒 | thing1(随访项目), date2(计划日期), thing3(提醒内容) |
| `SUBSCRIBE_TEMPLATE_VIDEO_DONE` | 视频生成完成 | thing1(通知标题), thing2(操作提示) |

3. 如需短信兜底，还需在腾讯云 SMS 控制台创建短信模板，填入 `SMS_TEMPLATE_*` 变量
4. 运行 `node scripts/sync-env.js` 同步配置
5. 重新部署 `sendNotification` 云函数

### 科普视频库管理

科普视频采用预生成模式，管理员通过脚本上传视频到云存储并写入 `video_library` 集合。

#### 支持的异常类别

| category | 说明 | 评估器 | 触发条件 |
|----------|------|--------|---------|
| growth | 生长发育 | growthEvaluator | 任何年龄，身高/体重 Z-Score 异常 |
| obesity | 超重肥胖 | obesityEvaluator | **仅 6-17 岁**，BMI 超标 |
| anemia | 贫血 | anemiaEvaluator | 血红蛋白低于标准 |
| vision | 视力 | visionEvaluator | 视力筛查异常 |
| dental | 口腔(龋齿) | dentalEvaluator | 龋齿检测 |
| spine | 脊柱 | spineEvaluator | 脊柱侧弯筛查 |
| hearing | 听力 | hearingEvaluator | 听力筛查异常 |
| development | 发育评估 | developmentEvaluator | 预警征筛查阳性 |
| rickets | 佝偻病 | ricketsEvaluator | 佝偻病筛查阳性 |

**注意**: 6 岁以下儿童体重偏高（体重别年龄 Z-Score ≥ +2SD）只产出 `growth` 类别异常项，不产出 `obesity`（`obesityEvaluator` 仅对 6-17 岁生效）。这类报告需上传 `growth` 类别的科普视频才能匹配。

#### 上传视频

```bash
node scripts/manage-video-library.js upload \
  --category anemia \
  --title "儿童贫血科普" \
  --file ./videos/anemia.mp4 \
  --thumbnail ./videos/anemia-cover.jpg \
  --duration 120 \
  --description "讲解儿童贫血的成因与应对"
```

#### 替换视频

```bash
node scripts/manage-video-library.js replace \
  --category anemia \
  --file ./videos/anemia-v2.mp4 \
  --title "儿童贫血科普(更新版)"
```

#### 查看视频库

```bash
node scripts/manage-video-library.js list
```

#### 停用视频

```bash
node scripts/manage-video-library.js deactivate --category anemia
```

**注意**: 脚本依赖 `wx-server-sdk`，需先在 `cloudfunctions/pushEducationVideos/` 目录运行 `npm install`。
视频建议压缩到 720p，单个文件控制在 30MB 以内。

#### 补发科普视频

当视频库新增了某类别的视频后，已推送的报告不会自动补发。管理员可通过脚本为指定报告重新匹配并创建科普视频记录。

```bash
# 试跑（只查不写，确认会匹配到哪些视频、哪些类别缺失）
node scripts/repull-education-videos.js --report_id <报告ID> --dry-run

# 实际补发
node scripts/repull-education-videos.js --report_id <报告ID>
```

`report_id` 是 `reports` 集合中报告文档的 `_id`，可在云开发控制台 `reports` 集合中查找，或从家长端报告详情页 URL 的 `report_id` 参数获取。

脚本会：读取报告关联的体检异常项 → 按类别去重 → 匹配 `video_library` 中 active 视频 → 创建 `media_assets` 记录（幂等，已存在的类别自动跳过）。补发后需确保 `listMediaAssets` 云函数已部署最新版本，家长端报告详情页即可看到视频。
