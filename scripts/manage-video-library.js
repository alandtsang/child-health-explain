#!/usr/bin/env node
/**
 * scripts/manage-video-library.js
 *
 * 科普视频库管理脚本，支持上传、替换、查看、停用视频。
 *
 * 用法:
 *   node scripts/manage-video-library.js upload \
 *     --category anemia --title "儿童贫血科普" \
 *     --file ./videos/anemia.mp4 \
 *     --thumbnail ./videos/anemia-cover.jpg \
 *     --duration 120 --description "讲解儿童贫血的成因与应对"
 *
 *   node scripts/manage-video-library.js replace \
 *     --category anemia --file ./videos/anemia-v2.mp4
 *
 *   node scripts/manage-video-library.js list
 *
 *   node scripts/manage-video-library.js deactivate --category anemia
 *
 * 前置步骤: 确保 .env 中已配置 CLOUD_ENV
 */

const fs = require('fs')
const path = require('path')

// 解析 .env
function loadEnv() {
  const envPath = path.resolve(__dirname, '..', '.env')
  if (!fs.existsSync(envPath)) {
    console.error('错误: 找不到 .env 文件，请先 cp .env.example .env 并填入 CLOUD_ENV')
    process.exit(1)
  }
  const content = fs.readFileSync(envPath, 'utf8')
  const config = {}
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx === -1) continue
    const key = trimmed.slice(0, eqIdx).trim()
    let val = trimmed.slice(eqIdx + 1).trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    config[key] = val
  }
  return config
}

// 解析命令行参数
function parseArgs() {
  const args = process.argv.slice(2)
  const command = args[0]
  const opts = {}
  for (let i = 1; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].slice(2)
      const val = args[i + 1] && !args[i + 1].startsWith('--') ? args[++i] : true
      opts[key] = val
    }
  }
  return { command, opts }
}

// 类别标签映射
const CATEGORY_LABELS = {
  growth: '生长发育',
  obesity: '超重肥胖',
  anemia: '贫血',
  vision: '视力',
  dental: '口腔(龋齿)',
  spine: '脊柱',
  hearing: '听力',
  development: '发育评估',
  rickets: '佝偻病'
}

async function main() {
  const { command, opts } = parseArgs()

  if (!command) {
    console.log('用法: node scripts/manage-video-library.js <upload|replace|list|deactivate> [options]')
    process.exit(1)
  }

  const config = loadEnv()
  const cloudEnv = config.CLOUD_ENV
  if (!cloudEnv) {
    console.error('错误: .env 中未配置 CLOUD_ENV')
    process.exit(1)
  }

  // 动态加载 wx-server-sdk（在云函数目录中安装的）
  const sdkPath = path.resolve(__dirname, '..', 'cloudfunctions', 'pushEducationVideos', 'node_modules', 'wx-server-sdk')
  let cloud
  try {
    cloud = require(sdkPath)
  } catch (e) {
    console.error('错误: 找不到 wx-server-sdk，请先在 cloudfunctions/pushEducationVideos/ 中运行 npm install')
    console.error('  cd cloudfunctions/pushEducationVideos && npm install')
    process.exit(1)
  }

  // 本地运行 wx-server-sdk 需要腾讯云密钥
  if (!config.TENCENTCLOUD_SECRET_ID || !config.TENCENTCLOUD_SECRET_KEY) {
    console.error('错误: .env 中未配置 TENCENTCLOUD_SECRET_ID / TENCENTCLOUD_SECRET_KEY')
    console.error('请在 .env 中填入腾讯云密钥后重试')
    process.exit(1)
  }

  cloud.init({
    env: cloudEnv,
    resourceAppid: config.WX_APPID || undefined,
    secretId: config.TENCENTCLOUD_SECRET_ID,
    secretKey: config.TENCENTCLOUD_SECRET_KEY
  })
  const db = cloud.database()

  switch (command) {
    case 'upload':
      return await handleUpload(cloud, db, opts)
    case 'replace':
      return await handleReplace(cloud, db, opts)
    case 'list':
      return await handleList(db)
    case 'deactivate':
      return await handleDeactivate(db, opts)
    default:
      console.error('未知命令:', command)
      console.log('可用命令: upload, replace, list, deactivate')
      process.exit(1)
  }
}

async function handleUpload(cloud, db, opts) {
  const { category, title, file, thumbnail, duration, description } = opts

  if (!category || !title || !file) {
    console.error('upload 需要 --category, --title, --file 参数')
    process.exit(1)
  }

  if (!CATEGORY_LABELS[category]) {
    console.error('未知类别:', category)
    console.log('可用类别:', Object.keys(CATEGORY_LABELS).join(', '))
    process.exit(1)
  }

  const filePath = path.resolve(file)
  if (!fs.existsSync(filePath)) {
    console.error('视频文件不存在:', filePath)
    process.exit(1)
  }

  // 检查是否已存在 active 记录（集合不存在时视为无记录）
  let existing = { data: [] }
  try {
    existing = await db.collection('video_library')
      .where({ category, status: 'active' })
      .limit(1)
      .get()
  } catch (err) { /* 集合不存在，视为无记录 */ }

  if (existing.data.length > 0) {
    console.error(`类别 ${category} 已有 active 视频，请使用 replace 命令替换`)
    console.log('现有记录:', existing.data[0]._id, existing.data[0].title)
    process.exit(1)
  }

  // 获取当前最大 version（集合不存在时从 v1 开始）
  let allVersions = { data: [] }
  try {
    allVersions = await db.collection('video_library')
      .where({ category })
      .orderBy('version', 'desc')
      .limit(1)
      .get()
  } catch (err) { /* 集合不存在，version 从 1 开始 */ }

  const nextVersion = allVersions.data.length > 0 ? (allVersions.data[0].version || 0) + 1 : 1

  // 上传视频到云存储
  const cloudPath = `video-library/${category}/v${nextVersion}.mp4`
  console.log(`上传视频到云存储: ${cloudPath} ...`)
  const uploadRes = await cloud.uploadFile({
    cloudPath,
    fileContent: fs.createReadStream(filePath)
  })
  console.log('视频上传成功:', uploadRes.fileID)

  // 上传缩略图（可选）
  let thumbnailFileId = null
  if (thumbnail) {
    const thumbPath = path.resolve(thumbnail)
    if (fs.existsSync(thumbPath)) {
      const thumbCloudPath = `video-library/${category}/v${nextVersion}-cover.jpg`
      const thumbRes = await cloud.uploadFile({
        cloudPath: thumbCloudPath,
        fileContent: fs.createReadStream(thumbPath)
      })
      thumbnailFileId = thumbRes.fileID
      console.log('缩略图上传成功:', thumbnailFileId)
    } else {
      console.warn('缩略图文件不存在，跳过:', thumbPath)
    }
  }

  // 写入 video_library（集合不存在时自动创建）
  let addRes
  try {
    addRes = await db.collection('video_library').add({
      data: {
        category,
        category_label: CATEGORY_LABELS[category],
        title,
        file_id: uploadRes.fileID,
        thumbnail_file_id: thumbnailFileId,
        description: description || '',
        duration: duration ? parseInt(duration, 10) : null,
        status: 'active',
        version: nextVersion,
        created_at: db.serverDate(),
        updated_at: db.serverDate()
      }
    })
  } catch (addErr) {
    if (addErr && /not exist|-502005|-502003/i.test(addErr.errMsg || addErr.message || '')) {
      console.log('video_library 集合不存在，正在创建...')
      // 调用 initDatabase 云函数创建集合
      try {
        await cloud.callFunction({
          name: 'initDatabase',
          data: { action: 'initCollections' }
        })
      } catch (initErr) {
        console.error('自动创建集合失败:', initErr.message)
      }
      // 重试 add（集合创建后可能需要几秒生效）
      let retries = 3
      while (retries > 0) {
        try {
          await new Promise(r => setTimeout(r, 2000))
          addRes = await db.collection('video_library').add({
            data: {
              category,
              category_label: CATEGORY_LABELS[category],
              title,
              file_id: uploadRes.fileID,
              thumbnail_file_id: thumbnailFileId,
              description: description || '',
              duration: duration ? parseInt(duration, 10) : null,
              status: 'active',
              version: nextVersion,
              created_at: db.serverDate(),
              updated_at: db.serverDate()
            }
          })
          break
        } catch (retryErr) {
          retries--
          if (retries === 0) {
            console.error('\n无法自动创建 video_library 集合。')
            console.error('请在微信云开发控制台手动创建 video_library 集合后重试。')
            console.error('视频文件已上传到云存储:', uploadRes.fileID)
            process.exit(1)
          }
        }
      }
    } else {
      throw addErr
    }
  }

  console.log(`\n✓ 视频上传成功!`)
  console.log(`  类别: ${category} (${CATEGORY_LABELS[category]})`)
  console.log(`  标题: ${title}`)
  console.log(`  版本: v${nextVersion}`)
  console.log(`  fileID: ${uploadRes.fileID}`)
  console.log(`  记录ID: ${addRes._id}`)
}

async function handleReplace(cloud, db, opts) {
  const { category, title, file, thumbnail, duration, description } = opts

  if (!category || !file) {
    console.error('replace 需要 --category, --file 参数')
    process.exit(1)
  }

  if (!CATEGORY_LABELS[category]) {
    console.error('未知类别:', category)
    process.exit(1)
  }

  // 将旧 active 记录标记为 inactive（集合不存在时跳过）
  let oldRecords = { data: [] }
  try {
    oldRecords = await db.collection('video_library')
      .where({ category, status: 'active' })
      .get()
  } catch (err) { /* 集合不存在，无旧记录 */ }

  for (const old of oldRecords.data) {
    await db.collection('video_library').doc(old._id).update({
      data: { status: 'inactive', updated_at: db.serverDate() }
    })
    console.log(`旧视频已停用: v${old.version} (${old.title})`)
  }

  // 复用 upload 逻辑上传新视频
  await handleUpload(cloud, db, opts)
  console.log('替换完成')
}

async function handleList(db) {
  let res
  try {
    res = await db.collection('video_library')
      .orderBy('category', 'asc')
      .orderBy('version', 'desc')
      .get()
  } catch (err) {
    if (err && /not exist|-502005|-502003/i.test(err.errMsg || err.message || '')) {
      console.log('视频库为空（video_library 集合尚未创建，上传第一个视频后将自动创建）')
      return
    }
    throw err
  }

  if (res.data.length === 0) {
    console.log('视频库为空')
    return
  }

  console.log('\n科普视频库列表:')
  console.log('─'.repeat(80))

  const grouped = {}
  for (const v of res.data) {
    if (!grouped[v.category]) grouped[v.category] = []
    grouped[v.category].push(v)
  }

  for (const [cat, videos] of Object.entries(grouped)) {
    console.log(`\n[${cat}] ${CATEGORY_LABELS[cat] || cat}`)
    for (const v of videos) {
      const status = v.status === 'active' ? '✓ active' : `  ${v.status}`
      console.log(`  ${status}  v${v.version}  ${v.title}  (${v.duration || '?'}s)`)
      console.log(`          fileID: ${v.file_id}`)
      if (v.description) {
        console.log(`          desc: ${v.description}`)
      }
    }
  }
  console.log('\n' + '─'.repeat(80))
  console.log(`共 ${res.data.length} 条记录`)
}

async function handleDeactivate(db, opts) {
  const { category } = opts

  if (!category) {
    console.error('deactivate 需要 --category 参数')
    process.exit(1)
  }

  let res = { data: [] }
  try {
    res = await db.collection('video_library')
      .where({ category, status: 'active' })
      .get()
  } catch (err) { /* 集合不存在，视为无记录 */ }

  if (res.data.length === 0) {
    console.log(`类别 ${category} 无 active 视频`)
    return
  }

  for (const v of res.data) {
    await db.collection('video_library').doc(v._id).update({
      data: { status: 'inactive', updated_at: db.serverDate() }
    })
    console.log(`已停用: ${v.title} (v${v.version})`)
  }
  console.log(`类别 ${category} 已停用`)
}

main().catch(err => {
  console.error('执行失败:', err.message || err)
  process.exit(1)
})
