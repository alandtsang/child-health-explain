/**
 * cloudfunctions/listExams/index.js
 * 体检记录读取云函数（安全规则迁移用）
 *
 * exams 集合启用 read:false 后，所有客户端直读将被拒绝。
 * 本云函数在服务端按角色校验后返回数据。
 *
 * Actions:
 *   listByDoctor — 医生端：按 doctor_id 分页列出体检记录（doctor/home 用）
 *   getDetail    — 获取单个体检记录 + 关联儿童信息（doctor/report-review / parent/report-detail 用）
 *   getByIds     — 批量按 ID 查询体检记录（doctor/report-list / parent/report-list / parent/home enrichReports 用）
 *   listByChild  — 家长端：按儿童 ID 查询体检记录（parent/home 用）
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
    const userRole = await getUserRole(openid)

    switch (action) {
      case 'listByDoctor': return await handleListByDoctor(openid, userRole, event)
      case 'getDetail':    return await handleGetDetail(openid, userRole, event)
      case 'getByIds':     return await handleGetByIds(openid, userRole, event)
      case 'listByChild':  return await handleListByChild(openid, userRole, event)
      default: return { code: 400, message: '未知的 action: ' + action }
    }
  } catch (err) {
    console.error('[listExams] action=%s openid=%s error:', action, openid, err)
    if (isCollectionMissingError(err)) {
      return { code: 503, message: '数据库集合未初始化，请先调用 initDatabase 初始化集合', error: err.errMsg || err.message }
    }
    return { code: 500, message: '服务器错误：' + (err.errMsg || err.message || '未知错误') }
  }
}

// 医生端：按 doctor_id 分页列出体检记录
async function handleListByDoctor(openid, userRole, event) {
  if (!userRole.isDoctor || !userRole.approved) {
    return { code: 403, message: '仅医生端可查看体检列表' }
  }

  const { page, pageSize } = event
  const currentPage = page || 0
  const currentPageSize = pageSize || 10

  const res = await db.collection('exams')
    .where({ doctor_id: openid })
    .orderBy('created_at', 'desc')
    .skip(currentPage * currentPageSize)
    .limit(currentPageSize)
    .get()

  // 批量关联儿童信息
  const exams = await enrichWithChildren(res.data)
  return { code: 0, data: exams, hasMore: res.data.length === currentPageSize }
}

// 获取单个体检记录 + 关联儿童信息
async function handleGetDetail(openid, userRole, event) {
  const { exam_id } = event
  if (!exam_id) return { code: 400, message: '缺少 exam_id' }

  const res = await db.collection('exams').doc(exam_id).get()
  const exam = res.data
  if (!exam) return { code: 404, message: '体检记录不存在' }

  // 权限校验
  await assertExamAccess(exam, openid, userRole)

  // 关联儿童信息
  let child = null
  try {
    const childRes = await db.collection('children').doc(exam.child_id).get()
    child = childRes.data
  } catch (e) { /* ignore */ }

  return { code: 0, data: { exam, child } }
}

// 批量按 ID 查询体检记录
async function handleGetByIds(openid, userRole, event) {
  const { ids, child_id } = event
  if (!Array.isArray(ids) || ids.length === 0) {
    return { code: 0, data: [] }
  }

  // 构建查询条件
  const where = { _id: _.in(ids) }
  if (child_id) where.child_id = child_id

  const res = await db.collection('exams').where(where).get()

  // 权限校验：确保调用者有权访问这些体检记录
  for (const exam of res.data) {
    await assertExamAccess(exam, openid, userRole)
  }

  return { code: 0, data: res.data }
}

// 家长端：按儿童 ID 查询体检记录
async function handleListByChild(openid, userRole, event) {
  const { child_id, exam_ids, page, pageSize } = event

  // 家长：验证儿童是否已绑定
  const isBound = await isChildBoundToParent(child_id, openid)
  if (!isBound) {
    return { code: 403, message: '无权查看此儿童的体检记录' }
  }

  const currentPage = page || 0
  const currentPageSize = pageSize || 10

  let where = { child_id }
  if (exam_ids && Array.isArray(exam_ids) && exam_ids.length > 0) {
    where = { child_id, _id: _.in(exam_ids) }
  }

  const res = await db.collection('exams')
    .where(where)
    .orderBy('created_at', 'desc')
    .skip(currentPage * currentPageSize)
    .limit(currentPageSize)
    .get()

  return { code: 0, data: res.data }
}

// === 辅助函数 ===

// 为体检记录列表批量关联儿童信息
async function enrichWithChildren(exams) {
  const childIds = [...new Set(exams.map(e => e.child_id))]
  if (childIds.length === 0) return exams

  const childRes = await db.collection('children').where({ _id: _.in(childIds) }).get()
  const childMap = {}
  childRes.data.forEach(c => { childMap[c._id] = c })

  return exams.map(exam => ({
    ...exam,
    child: childMap[exam.child_id] || null
  }))
}

// 校验体检记录访问权限
async function assertExamAccess(exam, openid, userRole) {
  if (userRole.isDoctor && userRole.approved) {
    // 医生：必须是录入该体检的医生
    if (exam.doctor_id !== openid) {
      throw new Error('无权查看此体检记录')
    }
  } else {
    // 家长：体检关联的儿童必须已绑定
    const isBound = await isChildBoundToParent(exam.child_id, openid)
    if (!isBound) {
      throw new Error('无权查看此体检记录')
    }
  }
}

// 检查儿童是否已绑定到家长
async function isChildBoundToParent(childId, openid) {
  try {
    const res = await db.collection('children').doc(childId).get()
    const child = res.data
    return !!(child && (child.bound_parent_ids || []).includes(openid))
  } catch (err) {
    if (isCollectionMissingError(err)) return false
    throw err
  }
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
