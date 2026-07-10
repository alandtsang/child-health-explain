#!/usr/bin/env node
/**
 * scripts/repull-education-videos.js
 *
 * 管理员补发脚本：为指定报告重新匹配并创建科普视频 media_assets 记录。
 * 用腾讯云密钥直连数据库，绕过云函数的医生身份校验（管理员操作）。
 *
 * 用法:
 *   node scripts/repull-education-videos.js --report_id <报告ID>
 *   node scripts/repull-education-videos.js --report_id <报告ID> --dry-run
 *
 * 前置: .env 中已配置 CLOUD_ENV / TENCENTCLOUD_SECRET_ID / TENCENTCLOUD_SECRET_KEY
 */

const fs = require('fs')
const path = require('path')

// ---------- .env 加载（与 manage-video-library.js 一致） ----------
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

function parseArgs() {
  const args = process.argv.slice(2)
  const opts = {}
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].slice(2)
      const val = args[i + 1] && !args[i + 1].startsWith('--') ? args[++i] : true
      opts[key] = val
    }
  }
  return opts
}

async function main() {
  const opts = parseArgs()
  const { report_id, dry_run } = opts

  if (!report_id) {
    console.error('用法: node scripts/repull-education-videos.js --report_id <报告ID> [--dry-run]')
    process.exit(1)
  }

  const config = loadEnv()
  const cloudEnv = config.CLOUD_ENV
  if (!cloudEnv) {
    console.error('错误: .env 中未配置 CLOUD_ENV')
    process.exit(1)
  }

  const sdkPath = path.resolve(__dirname, '..', 'cloudfunctions', 'pushEducationVideos', 'node_modules', 'wx-server-sdk')
  let cloud
  try {
    cloud = require(sdkPath)
  } catch (e) {
    console.error('错误: 找不到 wx-server-sdk，请先在 cloudfunctions/pushEducationVideos/ 中运行 npm install')
    process.exit(1)
  }

  if (!config.TENCENTCLOUD_SECRET_ID || !config.TENCENTCLOUD_SECRET_KEY) {
    console.error('错误: .env 中未配置 TENCENTCLOUD_SECRET_ID / TENCENTCLOUD_SECRET_KEY')
    process.exit(1)
  }

  cloud.init({
    env: cloudEnv,
    resourceAppid: config.WX_APPID || undefined,
    secretId: config.TENCENTCLOUD_SECRET_ID,
    secretKey: config.TENCENTCLOUD_SECRET_KEY
  })
  const db = cloud.database()
  const _ = db.command

  console.log(`\n报告 ID: ${report_id}`)
  if (dry_run) console.log('（dry-run 模式：只查不写）\n')

  // 1. 查报告
  let report
  try {
    const reportRes = await db.collection('reports').doc(report_id).get()
    report = reportRes.data
  } catch (err) {
    if (/not exist|-502005|-502003/i.test(err.errMsg || err.message || '')) {
      console.error('错误: 报告不存在或 reports 集合未创建')
    } else {
      console.error('查询报告失败:', err.errMsg || err.message)
    }
    process.exit(1)
  }
  if (!report) {
    console.error('错误: 报告不存在')
    process.exit(1)
  }

  const pushedTo = Array.isArray(report.pushed_to) ? report.pushed_to : []
  console.log(`review_status: ${report.review_status}`)
  console.log(`push_status: ${report.push_status || '(空)'}`)
  console.log(`pushed_to: ${pushedTo.length ? pushedTo.join(', ') : '(空 — 无人推送)'}`)
  console.log(`exam_id: ${report.exam_id}`)

  if (report.review_status !== 'approved') {
    console.error('\n⚠ 报告未审核通过，通常不应补发科普视频。如确需补发请确认后手动删除此检查。')
  }

  // 2. 查体检记录
  const examRes = await db.collection('exams').doc(report.exam_id).get()
  const exam = examRes.data
  if (!exam) {
    console.error('错误: 体检记录不存在')
    process.exit(1)
  }

  const abnormalItems = exam.abnormal_items || []
  console.log(`\n异常项 (${abnormalItems.length} 条):`)
  for (const item of abnormalItems) {
    const flag = item.level === 'normal' ? '  ' : '⚠ '
    console.log(`  ${flag}[${item.category}] ${item.item_label || item.item || ''} — ${item.description || ''} (level=${item.level})`)
  }

  // 3. 按 category 去重，仅保留非 normal
  const categorySet = new Set()
  for (const item of abnormalItems) {
    if (item.level !== 'normal' && item.category) {
      categorySet.add(item.category)
    }
  }
  const categories = Array.from(categorySet)
  console.log(`\n需匹配的异常类别: ${categories.length ? categories.join(', ') : '(无)'}`)

  if (categories.length === 0) {
    console.log('\n无异常类别，无需补发。')
    return
  }

  // 4. 查 video_library
  let videoRes = { data: [] }
  try {
    videoRes = await db.collection('video_library')
      .where({ category: _.in(categories), status: 'active' })
      .get()
  } catch (err) {
    console.warn('video_library 查询失败（集合可能未创建）:', err.errMsg || err.message)
  }

  const matchedCategories = videoRes.data.map(v => v.category)
  const skippedCategories = categories.filter(c => !matchedCategories.includes(c))

  console.log(`\n匹配到的视频 (${videoRes.data.length} 个):`)
  for (const v of videoRes.data) {
    console.log(`  ✓ [${v.category}] ${v.title} (v${v.version}, ${v.duration || '?'}s)`)
  }
  if (skippedCategories.length > 0) {
    console.log(`\n⚠ 无匹配视频的类别（需先上传视频）: ${skippedCategories.join(', ')}`)
  }

  if (videoRes.data.length === 0) {
    console.log('\n没有可补发的视频。请先用 manage-video-library.js 上传对应类别的视频。')
    return
  }

  if (dry_run) {
    console.log('\n[dry-run] 未写入任何数据。去掉 --dry-run 参数执行实际补发。')
    return
  }

  // 5. 逐个创建 media_assets（幂等）
  let created = 0
  let skipped = 0
  for (const video of videoRes.data) {
    // 幂等检查
    const existing = await db.collection('media_assets')
      .where({ report_id, category: video.category, source: 'library' })
      .limit(1)
      .get()

    if (existing.data.length > 0) {
      console.log(`\n  跳过 [${video.category}]：已存在 media_assets 记录 ${existing.data[0]._id}`)
      skipped++
      continue
    }

    const mediaRes = await db.collection('media_assets').add({
      data: {
        report_id,
        self_check_id: null,
        source: 'library',
        type: 'video',
        status: 'done',
        file_id: video.file_id,
        thumbnail_file_id: video.thumbnail_file_id || null,
        library_video_id: video._id,
        category: video.category,
        title: video.title || null,
        category_label: video.category_label || null,
        duration: video.duration || null,
        description: video.description || null,
        pushed_to: pushedTo,
        prompt: null,
        generation_meta: null,
        ark_task_id: null,
        retries: 0,
        created_at: db.serverDate(),
        completed_at: db.serverDate()
      }
    })
    console.log(`\n  ✓ 创建 [${video.category}] ${video.title} → media_assets ${mediaRes._id}`)
    created++
  }

  console.log(`\n──────────────────────────────`)
  console.log(`补发完成: 新建 ${created} 条，跳过 ${skipped} 条（已存在）`)
  if (skippedCategories.length > 0) {
    console.log(`仍未覆盖的类别: ${skippedCategories.join(', ')}`)
  }
  console.log(`\n提示: 修复 listMediaAssets 云函数并重新部署后，家长端报告详情页即可看到新补发的视频。`)
}

main().catch(err => {
  console.error('执行失败:', err.message || err)
  process.exit(1)
})
