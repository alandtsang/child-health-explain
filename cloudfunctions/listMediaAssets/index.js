/**
 * cloudfunctions/listMediaAssets/index.js
 * 媒体资源读取云函数（安全规则迁移用）
 *
 * media_assets 集合启用 read:false 后，所有客户端直读将被拒绝。
 * 本云函数在服务端按角色校验后返回数据。
 *
 * Actions:
 *   listByReport    — 按报告 ID 查询媒体资源（海报/视频）
 *                     医生：校验 report.reviewed_by == openid
 *                     家长：校验 report.pushed_to == openid
 *   listBySelfCheck — 按自查记录 ID 查询媒体资源（海报）
 *                     家长：校验 self_check.parent_openid == openid
 *   previewByExam   — 按体检 ID 预览将匹配的科普视频（医生端推送前预览）
 *                     医生：校验 child.created_by == openid
 *                     读取 exam.abnormal_items → 按 category 匹配 video_library active 视频
 */

const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID
  const { action } = event

  try {
    switch (action) {
      case 'listByReport':    return await handleListByReport(openid, event)
      case 'listBySelfCheck': return await handleListBySelfCheck(openid, event)
      case 'previewByExam':   return await handlePreviewByExam(openid, event)
      default: return { code: 400, message: '未知的 action: ' + action }
    }
  } catch (err) {
    console.error('[listMediaAssets] action=%s openid=%s error:', action, openid, err)
    if (isCollectionMissingError(err)) {
      return { code: 503, message: '数据库集合未初始化，请先调用 initDatabase 初始化集合', error: err.errMsg || err.message }
    }
    return { code: 500, message: '服务器错误：' + (err.errMsg || err.message || '未知错误') }
  }
}

// 按报告 ID 查询媒体资源
async function handleListByReport(openid, event) {
  const { report_id, type, status } = event
  if (!report_id) return { code: 400, message: '缺少 report_id' }

  // 校验报告访问权限：医生（reviewed_by）或家长（pushed_to）
  const reportRes = await db.collection('reports').doc(report_id).get()
  const report = reportRes.data
  if (!report) return { code: 404, message: '报告不存在' }

  const isReviewer = report.reviewed_by === openid
  const isPushedTo = report.pushed_to === openid
  if (!isReviewer && !isPushedTo) {
    return { code: 403, message: '无权查看此报告的媒体资源' }
  }

  // 查询媒体资源
  const where = { report_id }
  if (type) where.type = type
  if (status) where.status = status

  const res = await db.collection('media_assets')
    .where(where)
    .orderBy('created_at', 'desc')
    .get()

  return { code: 0, data: res.data }
}

// 按自查记录 ID 查询媒体资源
async function handleListBySelfCheck(openid, event) {
  const { self_check_id, type, status } = event
  if (!self_check_id) return { code: 400, message: '缺少 self_check_id' }

  // 校验自查记录归属
  const scRes = await db.collection('self_checks').doc(self_check_id).get()
  const selfCheck = scRes.data
  if (!selfCheck) return { code: 404, message: '自查记录不存在' }

  if (selfCheck.parent_openid !== openid) {
    return { code: 403, message: '无权查看此自查记录的媒体资源' }
  }

  // 查询媒体资源
  const where = { self_check_id }
  if (type) where.type = type
  if (status) where.status = status

  const res = await db.collection('media_assets')
    .where(where)
    .orderBy('created_at', 'desc')
    .get()

  return { code: 0, data: res.data }
}

// 按体检 ID 预览将匹配的科普视频（医生端推送前预览）
// 读取 exam.abnormal_items → 按 category 去重(仅 level≠normal) → 查 video_library active 视频
async function handlePreviewByExam(openid, event) {
  const { exam_id } = event
  if (!exam_id) return { code: 400, message: '缺少 exam_id' }

  // 1. 校验调用方为医生
  const doctorCheck = await validateDoctor(openid)
  if (!doctorCheck.isValid) {
    return { code: doctorCheck.code, message: doctorCheck.message }
  }

  // 2. 读取体检记录
  const examRes = await db.collection('exams').doc(exam_id).get()
  const exam = examRes.data
  if (!exam) return { code: 404, message: '体检记录不存在' }

  // 3. 校验医生对该体检关联儿童有访问权限
  const childRes = await db.collection('children').doc(exam.child_id).get()
  const child = childRes.data
  if (!child) return { code: 404, message: '儿童档案不存在' }
  if (child.created_by !== openid) {
    return { code: 403, message: '无权查看此体检的科普视频预览' }
  }

  // 4. 提取异常类别（去重，仅 level≠normal）
  const abnormalItems = exam.abnormal_items || []
  const categorySet = new Set()
  for (const item of abnormalItems) {
    if (item.level !== 'normal' && item.category) {
      categorySet.add(item.category)
    }
  }
  const categories = Array.from(categorySet)

  if (categories.length === 0) {
    return { code: 0, data: { videos: [], skipped_categories: [] }, message: '无异常项，无需推送科普视频' }
  }

  // 5. 查询 video_library 匹配 active 视频
  const videoRes = await db.collection('video_library')
    .where({ category: _.in(categories), status: 'active' })
    .get()

  // 6. 补充未匹配类别信息
  const matchedCategories = videoRes.data.map(v => v.category)
  const skippedCategories = categories.filter(c => !matchedCategories.includes(c))

  return {
    code: 0,
    data: {
      videos: videoRes.data,
      skipped_categories: skippedCategories
    }
  }
}

// 校验调用方是否为医生角色
async function validateDoctor(openid) {
  try {
    const res = await db.collection('users').where({ openid }).limit(1).get()
    const user = res.data[0]
    if (!user || !Array.isArray(user.roles) || !user.roles.includes('doctor')) {
      return { isValid: false, code: 403, message: '您不是医生角色，无权执行此操作' }
    }
    return { isValid: true, user }
  } catch (err) {
    if (isCollectionMissingError(err)) {
      return { isValid: false, code: 503, message: '数据库集合未初始化' }
    }
    throw err
  }
}

function isCollectionMissingError(err) {
  const msg = (err && (err.errMsg || err.message)) || ''
  return /collection.*(not.*exist|不存在)|-502003/i.test(msg)
}
