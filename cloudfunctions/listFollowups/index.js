/**
 * cloudfunctions/listFollowups/index.js
 * 随访记录读取云函数（安全规则迁移用）
 *
 * followups 集合启用 read:false 后，所有客户端直读将被拒绝。
 * 本云函数在服务端按角色校验后返回数据。
 *
 * Actions:
 *   listByDoctor   — 医生端：按 doctor_id + status 分页列出随访记录
 *   countByDoctor  — 医生端：按 doctor_id + status 统计数量（doctor/home 统计卡片用）
 *   listByChildren — 家长端：按儿童 ID + status 分页列出随访记录
 *   countByChildren— 家长端：按儿童 ID + status 统计数量（parent/home 统计用）
 *   getDetail      — 获取单个随访记录详情（家长端详情弹窗用）
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
      case 'listByDoctor':    return await handleListByDoctor(openid, userRole, event)
      case 'countByDoctor':   return await handleCountByDoctor(openid, userRole, event)
      case 'listByChildren':  return await handleListByChildren(openid, userRole, event)
      case 'countByChildren': return await handleCountByChildren(openid, userRole, event)
      case 'getDetail':       return await handleGetDetail(openid, userRole, event)
      default: return { code: 400, message: '未知的 action: ' + action }
    }
  } catch (err) {
    console.error('[listFollowups] action=%s openid=%s error:', action, openid, err)
    if (isCollectionMissingError(err)) {
      return { code: 503, message: '数据库集合未初始化，请先调用 initDatabase 初始化集合', error: err.errMsg || err.message }
    }
    return { code: 500, message: '服务器错误：' + (err.errMsg || err.message || '未知错误') }
  }
}

// 医生端：按 doctor_id + status 分页列出
async function handleListByDoctor(openid, userRole, event) {
  if (!userRole.isDoctor || !userRole.approved) {
    return { code: 403, message: '仅医生端可查看随访列表' }
  }

  const { status, page, pageSize } = event
  const currentPage = page || 0
  const currentPageSize = pageSize || 10

  const where = { doctor_id: openid }
  if (status) where.status = status

  const res = await db.collection('followups')
    .where(where)
    .orderBy('plan_date', 'desc')
    .skip(currentPage * currentPageSize)
    .limit(currentPageSize)
    .get()

  // 批量关联儿童信息
  const followups = await enrichWithChildren(res.data)
  return { code: 0, data: followups, hasMore: res.data.length === currentPageSize }
}

// 医生端：按 doctor_id + status 统计数量
async function handleCountByDoctor(openid, userRole, event) {
  if (!userRole.isDoctor || !userRole.approved) {
    return { code: 403, message: '仅医生端可查看随访统计' }
  }

  const { status } = event
  const where = { doctor_id: openid }
  if (status) {
    if (Array.isArray(status)) {
      where.status = _.in(status)
    } else {
      where.status = status
    }
  }

  const res = await db.collection('followups').where(where).count()
  return { code: 0, data: { total: res.total } }
}

// 家长端：按儿童 ID + status 分页列出
async function handleListByChildren(openid, userRole, event) {
  const { child_ids, status, page, pageSize } = event
  if (!Array.isArray(child_ids) || child_ids.length === 0) {
    return { code: 0, data: [] }
  }

  // 验证家长是否绑定了这些儿童
  const boundChildIds = await filterBoundChildren(child_ids, openid)
  if (boundChildIds.length === 0) {
    return { code: 403, message: '无权查看这些儿童的随访记录' }
  }

  const currentPage = page || 0
  const currentPageSize = pageSize || 10

  const where = { child_id: _.in(boundChildIds) }
  if (status) {
    if (Array.isArray(status)) {
      where.status = _.in(status)
    } else {
      where.status = status
    }
  }

  const res = await db.collection('followups')
    .where(where)
    .orderBy('plan_date', 'asc')
    .skip(currentPage * currentPageSize)
    .limit(currentPageSize)
    .get()

  const followups = await enrichWithChildren(res.data)
  return { code: 0, data: followups, hasMore: res.data.length === currentPageSize }
}

// 家长端：按儿童 ID + status 统计数量
async function handleCountByChildren(openid, userRole, event) {
  const { child_ids, status } = event
  if (!Array.isArray(child_ids) || child_ids.length === 0) {
    return { code: 0, data: { total: 0 } }
  }

  const boundChildIds = await filterBoundChildren(child_ids, openid)
  if (boundChildIds.length === 0) {
    return { code: 403, message: '无权查看这些儿童的随访统计' }
  }

  const where = { child_id: _.in(boundChildIds) }
  if (status) {
    if (Array.isArray(status)) {
      where.status = _.in(status)
    } else {
      where.status = status
    }
  }

  const res = await db.collection('followups').where(where).count()
  return { code: 0, data: { total: res.total } }
}

// 获取单个随访记录详情
async function handleGetDetail(openid, userRole, event) {
  const { followup_id } = event
  if (!followup_id) return { code: 400, message: '缺少 followup_id' }

  const res = await db.collection('followups').doc(followup_id).get()
  const followup = res.data
  if (!followup) return { code: 404, message: '随访记录不存在' }

  // 权限校验
  if (userRole.isDoctor && userRole.approved) {
    if (followup.doctor_id !== openid) {
      return { code: 403, message: '无权查看此随访记录' }
    }
  } else {
    // 家长：验证儿童是否已绑定
    const isBound = await isChildBoundToParent(followup.child_id, openid)
    if (!isBound) {
      return { code: 403, message: '无权查看此随访记录' }
    }
  }

  return { code: 0, data: followup }
}

// === 辅助函数 ===

// 为随访记录列表批量关联儿童信息
async function enrichWithChildren(followups) {
  const childIds = [...new Set(followups.map(f => f.child_id))]
  if (childIds.length === 0) return followups

  const childRes = await db.collection('children').where({ _id: _.in(childIds) }).get()
  const childMap = {}
  childRes.data.forEach(c => { childMap[c._id] = c })

  return followups.map(f => ({
    ...f,
    child: childMap[f.child_id] || null
  }))
}

// 过滤出家长已绑定的儿童 ID
async function filterBoundChildren(childIds, openid) {
  try {
    const res = await db.collection('children')
      .where({ _id: _.in(childIds), bound_parent_ids: openid })
      .get()
    return res.data.map(c => c._id)
  } catch (err) {
    if (isCollectionMissingError(err)) return []
    throw err
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
