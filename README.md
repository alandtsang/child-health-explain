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
