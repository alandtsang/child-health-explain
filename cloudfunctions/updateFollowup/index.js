// cloudfunctions/updateFollowup/index.js
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID
  const { action } = event

  try {
    switch (action) {
      case 'complete': return await handleComplete(openid, event)
      case 'adjust_date': return await handleAdjustDate(openid, event)
      case 'cancel': return await handleCancel(openid, event)
      default: return { code: 400, message: '未知的 action: ' + action }
    }
  } catch (err) {
    console.error('[updateFollowup] action=%s openid=%s error:', action, openid, err)
    if (isCollectionMissingError(err)) {
      return {
        code: 503,
        message: '数据库集合未初始化，请先调用 initDatabase 初始化集合',
        error: err.errMsg || err.message
      }
    }
    const detail = err.errMsg || err.message || '未知错误'
    return { code: 500, message: '服务器错误：' + detail, error: err.message }
  }
}

// 标记随访完成
async function handleComplete(openid, event) {
  const { followup_id } = event
  if (!followup_id) return { code: 400, message: '缺少 followup_id' }

  const followup = await getFollowup(followup_id)
  if (!followup) return { code: 404, message: '随访记录不存在' }

  // 权限校验：医生（录入者）或绑定家长可完成
  const isDoctor = followup.doctor_id === openid
  let isParent = false
  if (!isDoctor && followup.child_id) {
    isParent = await checkParentBound(followup.child_id, openid)
  }
  if (!isDoctor && !isParent) {
    return { code: 403, message: '无权操作此随访记录' }
  }

  if (followup.status === 'completed') {
    return { code: 0, message: '随访已完成', data: { followup_id } }
  }

  await db.collection('followups').doc(followup_id).update({
    data: {
      status: 'completed',
      completed_at: new Date(),
      completion_source: isDoctor ? 'doctor' : 'parent',
      updated_at: new Date()
    }
  })
  return { code: 0, data: { followup_id } }
}

// 调整随访计划日期
async function handleAdjustDate(openid, event) {
  const { followup_id, plan_date } = event
  if (!followup_id) return { code: 400, message: '缺少 followup_id' }
  if (!plan_date) return { code: 400, message: '请选择新的计划日期' }

  const followup = await getFollowup(followup_id)
  if (!followup) return { code: 404, message: '随访记录不存在' }

  // 仅医生可调整日期
  if (followup.doctor_id !== openid) {
    return { code: 403, message: '仅医生可调整随访日期' }
  }

  if (followup.status === 'completed') {
    return { code: 400, message: '已完成的随访不可调整日期' }
  }

  await db.collection('followups').doc(followup_id).update({
    data: {
      plan_date,
      updated_at: new Date()
    }
  })
  return { code: 0, data: { followup_id, plan_date } }
}

// 取消随访
async function handleCancel(openid, event) {
  const { followup_id } = event
  if (!followup_id) return { code: 400, message: '缺少 followup_id' }

  const followup = await getFollowup(followup_id)
  if (!followup) return { code: 404, message: '随访记录不存在' }

  if (followup.doctor_id !== openid) {
    return { code: 403, message: '仅医生可取消随访' }
  }

  if (followup.status === 'completed') {
    return { code: 400, message: '已完成的随访不可取消' }
  }

  await db.collection('followups').doc(followup_id).update({
    data: {
      status: 'cancelled',
      updated_at: new Date()
    }
  })
  return { code: 0, data: { followup_id } }
}

// 获取随访记录
async function getFollowup(followupId) {
  try {
    const res = await db.collection('followups').doc(followupId).get()
    return res.data
  } catch (err) {
    if (isCollectionMissingError(err)) throw err
    return null
  }
}

// 检查家长是否绑定该儿童
async function checkParentBound(childId, openid) {
  try {
    const res = await db.collection('children').doc(childId).get()
    const child = res.data
    if (!child) return false
    return (child.bound_parent_ids || []).includes(openid)
  } catch (err) {
    if (isCollectionMissingError(err)) throw err
    return false
  }
}

function isCollectionMissingError(err) {
  const msg = (err && (err.errMsg || err.message)) || ''
  return /collection.*(not.*exist|不存在)|-502003/i.test(msg)
}
