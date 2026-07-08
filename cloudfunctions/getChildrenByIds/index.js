/**
 * cloudfunctions/getChildrenByIds/index.js
 * 儿童档案读取云函数（安全规则迁移用）
 *
 * exams/followups/media_assets 集合启用 read:false 后，医生端无法客户端直读 children（因医生既非 created_by 也非 bound_parent）。
 * 本云函数在服务端校验医生身份后返回数据，不受安全规则限制。
 * 同时支持家长端读取：家长端 doc(id).get() 改走本云函数 getDetail，服务端校验 bound_parent_ids。
 *
 * Actions:
 *   getByIds  — 批量按 ID 查询儿童档案（医生端 enrichExams/enrichReports/enrichFollowups 用）
 *   listMine  — 列出当前用户创建（医生）或绑定（家长）的儿童档案
 *   getDetail — 获取单个儿童档案详情（医生端 report-review / 家长端 child-edit 用）
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
    // 获取用户角色
    const userRole = await getUserRole(openid)

    switch (action) {
      case 'getByIds':  return await handleGetByIds(openid, userRole, event)
      case 'listMine':  return await handleListMine(openid, userRole, event)
      case 'getDetail': return await handleGetDetail(openid, userRole, event)
      default: return { code: 400, message: '未知的 action: ' + action }
    }
  } catch (err) {
    console.error('[getChildrenByIds] action=%s openid=%s error:', action, openid, err)
    if (isCollectionMissingError(err)) {
      return { code: 503, message: '数据库集合未初始化，请先调用 initDatabase 初始化集合', error: err.errMsg || err.message }
    }
    return { code: 500, message: '服务器错误：' + (err.errMsg || err.message || '未知错误') }
  }
}

// 批量按 ID 查询
async function handleGetByIds(openid, userRole, event) {
  const { ids } = event
  if (!Array.isArray(ids) || ids.length === 0) {
    return { code: 0, data: [] }
  }

  // 医生：校验身份后返回所有匹配的儿童
  // 家长：仅返回 bound_parent_ids 包含自己 openid 的儿童
  let query = db.collection('children').where({ _id: _.in(ids) })

  if (userRole.isDoctor && userRole.approved) {
    // 医生可查看所有匹配的儿童
  } else {
    // 家长或未审核医生：仅能查看自己绑定的儿童
    query = db.collection('children').where({ _id: _.in(ids), bound_parent_ids: openid })
  }

  const res = await query.get()
  return { code: 0, data: res.data }
}

// 列出我的儿童档案
async function handleListMine(openid, userRole, event) {
  const { page, pageSize } = event
  const currentPage = page || 0
  const currentPageSize = pageSize || 50

  let query
  if (userRole.isDoctor && userRole.approved) {
    // 医生：按 created_by 查询
    query = db.collection('children').where({ created_by: openid })
  } else {
    // 家长：按 bound_parent_ids 查询
    query = db.collection('children').where({ bound_parent_ids: openid })
  }

  const res = await query
    .orderBy('created_at', 'desc')
    .skip(currentPage * currentPageSize)
    .limit(currentPageSize)
    .get()

  return { code: 0, data: res.data }
}

// 获取单个儿童详情
async function handleGetDetail(openid, userRole, event) {
  const { child_id } = event
  if (!child_id) return { code: 400, message: '缺少 child_id' }

  const res = await db.collection('children').doc(child_id).get()
  const child = res.data
  if (!child) return { code: 404, message: '儿童档案不存在' }

  // 权限校验
  if (userRole.isDoctor && userRole.approved) {
    // 医生可查看
  } else {
    // 家长：必须已绑定
    if (!(child.bound_parent_ids || []).includes(openid)) {
      return { code: 403, message: '无权查看此儿童档案' }
    }
  }

  return { code: 0, data: child }
}

// 获取用户角色
async function getUserRole(openid) {
  try {
    const res = await db.collection('users').where({ openid }).limit(1).get()
    const user = res.data[0]
    if (!user || !Array.isArray(user.roles) || !user.roles.includes('doctor')) {
      return { isDoctor: false, approved: false }
    }
    const approved = !!(user.doctor_info && user.doctor_info.status === 'approved')
    return { isDoctor: true, approved }
  } catch (err) {
    if (isCollectionMissingError(err)) return { isDoctor: false, approved: false }
    throw err
  }
}

function isCollectionMissingError(err) {
  const msg = (err && (err.errMsg || err.message)) || ''
  return /collection.*(not.*exist|不存在)|-502003/i.test(msg)
}
