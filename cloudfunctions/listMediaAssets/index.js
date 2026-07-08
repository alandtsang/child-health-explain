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

function isCollectionMissingError(err) {
  const msg = (err && (err.errMsg || err.message)) || ''
  return /collection.*(not.*exist|不存在)|-502003/i.test(msg)
}
