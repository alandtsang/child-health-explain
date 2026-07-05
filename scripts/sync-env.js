#!/usr/bin/env node
/**
 * scripts/sync-env.js
 *
 * 从项目根目录的 .env 文件读取配置，自动分发到各云函数的 secrets.local.js
 * 以及小程序端的 miniprogram/utils/env.js、project.config.json 等文件。
 *
 * 用法：
 *   node scripts/sync-env.js
 *
 * 前置步骤：
 *   1. cp .env.example .env
 *   2. 在 .env 中填入实际值
 *   3. 运行本脚本
 */

const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const ENV_FILE = path.join(ROOT, '.env')

// ── .env 解析（无第三方依赖）──────────────────────────────
function parseDotEnv(filePath) {
  if (!fs.existsSync(filePath)) {
    console.error(`\x1b[31m[sync-env] 错误：找不到 ${filePath}\x1b[0m`)
    console.error('\x1b[33m请先复制模板: cp .env.example .env 并填入实际值\x1b[0m')
    process.exit(1)
  }
  const content = fs.readFileSync(filePath, 'utf8')
  const config = {}
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx === -1) continue
    const key = trimmed.slice(0, eqIdx).trim()
    let val = trimmed.slice(eqIdx + 1).trim()
    // 去除首尾引号
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    config[key] = val
  }
  return config
}

// ── 写文件（带目录创建）────────────────────────────────────
function writeFile(dir, filename, content) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  const fullPath = path.join(dir, filename)
  fs.writeFileSync(fullPath, content, 'utf8')
  const rel = path.relative(ROOT, fullPath)
  console.log(`  ✓ ${rel}`)
}

// ── 生成 secrets.local.js ─────────────────────────────────
function genSecretsFile(keys, config, funcName) {
  const pairs = keys
    .filter(k => config[k] !== undefined)
    .map(k => `  ${k}: '${config[k].replace(/'/g, "\\'")}'`)
    .join(',\n')
  return `// 自动生成 - 请勿手动编辑（由 scripts/sync-env.js 从 .env 同步）
// 本地密钥配置文件（已加入 .gitignore，不会提交到代码仓库）
// 部署云函数时会一起上传到云端
module.exports = {
${pairs}
}
`
}

// ── 更新 JSON 文件中的字段 ────────────────────────────────
function updateJsonField(filePath, updates) {
  if (!fs.existsSync(filePath)) {
    console.log(`  · 跳过（文件不存在）: ${path.relative(ROOT, filePath)}`)
    return
  }
  const json = JSON.parse(fs.readFileSync(filePath, 'utf8'))
  for (const [key, value] of Object.entries(updates)) {
    json[key] = value
  }
  fs.writeFileSync(filePath, JSON.stringify(json, null, 2) + '\n', 'utf8')
  console.log(`  ✓ ${path.relative(ROOT, filePath)}`)
}

// ── 主流程 ────────────────────────────────────────────────
function main() {
  console.log('\n\x1b[36m[sync-env] 开始同步环境配置...\x1b[0m\n')

  const config = parseDotEnv(ENV_FILE)

  // 1. 生成各云函数的 secrets.local.js
  console.log('生成 secrets.local.js:')
  const CF = path.join(ROOT, 'cloudfunctions')

  // ARK_API_KEY 函数列表
  const arkFunctions = ['selfCheck', 'generateReport', 'ocrParse', 'genPoster', 'videoPoll', 'videoCreate']
  for (const fn of arkFunctions) {
    const keys = fn === 'ocrParse'
      ? ['ARK_API_KEY', 'TENCENTCLOUD_SECRET_ID', 'TENCENTCLOUD_SECRET_KEY']
      : ['ARK_API_KEY']
    writeFile(path.join(CF, fn), 'secrets.local.js', genSecretsFile(keys, config, fn))
  }

  // sendNotification: 订阅消息模板ID + 短信配置
  const notifKeys = [
    'TENCENTCLOUD_SECRET_ID', 'TENCENTCLOUD_SECRET_KEY',
    'SUBSCRIBE_TEMPLATE_REPORT_PUSH', 'SUBSCRIBE_TEMPLATE_FOLLOWUP_REMIND', 'SUBSCRIBE_TEMPLATE_VIDEO_DONE',
    'SMS_SDK_APP_ID', 'SMS_SIGN_NAME', 'SMS_TEMPLATE_REPORT_PUSH', 'SMS_TEMPLATE_FOLLOWUP_REMIND'
  ]
  writeFile(path.join(CF, 'sendNotification'), 'secrets.local.js', genSecretsFile(notifKeys, config, 'sendNotification'))

  // reviewReport: 订阅消息模板ID（用于审核通过时直接推送）
  const reviewKeys = ['SUBSCRIBE_TEMPLATE_REPORT_PUSH']
  writeFile(path.join(CF, 'reviewReport'), 'secrets.local.js', genSecretsFile(reviewKeys, config, 'reviewReport'))

  // doctorCert: 管理员 openid 列表（用于医生认证申请审核）
  const doctorCertKeys = ['ADMIN_OPENIDS']
  writeFile(path.join(CF, 'doctorCert'), 'secrets.local.js', genSecretsFile(doctorCertKeys, config, 'doctorCert'))

  // login: 管理员 openid 列表（用于首页识别管理员身份，展示审核入口）
  const loginKeys = ['ADMIN_OPENIDS']
  writeFile(path.join(CF, 'login'), 'secrets.local.js', genSecretsFile(loginKeys, config, 'login'))

  // 2. 同步 arkClient.js 到各云函数 lib/ 目录
  console.log('\n同步 arkClient.js:')
  const sharedArk = path.join(CF, 'shared', 'arkClient.js')
  if (fs.existsSync(sharedArk)) {
    const arkContent = fs.readFileSync(sharedArk, 'utf8')
    for (const fn of arkFunctions) {
      writeFile(path.join(CF, fn, 'lib'), 'arkClient.js', arkContent)
    }
  } else {
    console.log('  · 跳过（cloudfunctions/shared/arkClient.js 不存在）')
  }

  // 3. 生成小程序端 env.js
  console.log('\n生成小程序配置:')
  const tmplReport = config.SUBSCRIBE_TEMPLATE_REPORT_PUSH || ''
  const tmplFollowup = config.SUBSCRIBE_TEMPLATE_FOLLOWUP_REMIND || ''
  const tmplVideo = config.SUBSCRIBE_TEMPLATE_VIDEO_DONE || ''
  const envJs = `// 自动生成 - 请勿手动编辑（由 scripts/sync-env.js 从 .env 同步）
// 小程序运行时环境配置
module.exports = {
  cloudEnv: '${config.CLOUD_ENV || ''}',
  appId: '${config.WX_APPID || ''}',
  subscribeTemplates: {
    report_push: '${tmplReport}',
    followup_remind: '${tmplFollowup}',
    video_done: '${tmplVideo}'
  }
}
`
  writeFile(path.join(ROOT, 'miniprogram', 'utils'), 'env.js', envJs)

  // 4. 更新 project.config.json 中的 appid
  console.log('\n更新项目配置:')
  updateJsonField(path.join(ROOT, 'project.config.json'), { appid: config.WX_APPID || '' })
  updateJsonField(path.join(ROOT, 'miniprogram', 'project.config.json'), { appid: config.WX_APPID || '' })

  // 5. 更新 cloudbaserc.json 中的 envId
  updateJsonField(path.join(ROOT, 'cloudbaserc.json'), { envId: config.CLOUD_ENV || '' })

  // 6. 汇总
  console.log('\n\x1b[32m[sync-env] 同步完成！\x1b[0m')
  console.log('  - 8 个云函数 secrets.local.js 已生成（含 sendNotification + reviewReport）')
  console.log('  - 6 个云函数 lib/arkClient.js 已同步')
  console.log('  - miniprogram/utils/env.js 已生成（含订阅模板ID配置）')
  console.log('  - project.config.json appid 已更新')
  console.log('  - cloudbaserc.json envId 已更新')
  console.log('\n\x1b[33m提示：部署云函数前，也可以在微信开发者工具中为每个云函数设置环境变量（推荐生产环境使用）\x1b[0m')
  console.log('\x1b[33m提示：订阅消息模板ID请在微信公众平台后台创建模板后填入 .env\x1b[0m\n')
}

main()
