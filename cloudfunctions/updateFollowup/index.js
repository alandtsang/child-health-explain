// cloudfunctions/updateFollowup/index.js
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

// 版本号，用于前端校验云端是否运行最新代码
const VERSION = 'v2.0.0'

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID
  const { action, followup_id, plan_date } = event

  console.log('[updateFollowup] 调用开始 version=%s action=%s followup_id=%s plan_date=%s openid=%s',
    VERSION, action, followup_id, plan_date, openid)

  try {
    let result
    switch (action) {
      case 'complete': result = await handleComplete(openid, event); break
      case 'adjust_date': result = await handleAdjustDate(openid, event); break
      case 'cancel': result = await handleCancel(openid, event); break
      case 'reactivate': result = await handleReactivate(openid, event); break
      default:
        console.warn('[updateFollowup] 未知 action: %s', action)
        return { code: 400, message: '未知的 action: ' + action, version: VERSION }
    }
    console.log('[updateFollowup] action=%s 完成, result=%j', action, result)
    return result
  } catch (err) {
    console.error('[updateFollowup] action=%s openid=%s error:', action, openid, err)
    if (isCollectionMissingError(err)) {
      return {
        code: 503,
        message: '数据库集合未初始化，请先调用 initDatabase 初始化集合',
        error: err.errMsg || err.message,
        version: VERSION
      }
    }
    const detail = err.errMsg || err.message || '未知错误'
    return { code: 500, message: '服务器错误：' + detail, error: err.message, version: VERSION }
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

  console.log('[updateFollowup] complete 更新数据库, id=%s', followup_id)
  const updateRes = await db.collection('followups').doc(followup_id).update({
    data: {
      status: 'completed',
      completed_at: new Date(),
      completion_source: isDoctor ? 'doctor' : 'parent',
      updated_at: new Date()
    }
  })
  console.log('[updateFollowup] complete 更新结果, stats=%j', updateRes.stats)
  return { code: 0, data: { followup_id } }
}

// 调整随访计划日期
async function handleAdjustDate(openid, event) {
  const { followup_id, plan_date } = event
  if (!followup_id) return { code: 400, message: '缺少 followup_id' }
  if (!plan_date) return { code: 400, message: '请选择新的计划日期' }

  // 服务端校验：仅已审核通过的医生可调整随访日期
  const doctorCheck = await validateApprovedDoctor(openid)
  if (!doctorCheck.isValid) return { code: doctorCheck.code, message: doctorCheck.message }

  const followup = await getFollowup(followup_id)
  if (!followup) return { code: 404, message: '随访记录不存在' }

  // 仅录入医生可调整日期
  if (followup.doctor_id !== openid) {
    console.warn('[updateFollowup] adjust_date 权限拒绝, doctor_id=%s openid=%s', followup.doctor_id, openid)
    return { code: 403, message: '仅录入医生可调整随访日期' }
  }

  if (followup.status === 'completed') {
    return { code: 400, message: '已完成的随访不可调整日期' }
  }

  console.log('[updateFollowup] adjust_date 更新数据库, id=%s 旧日期=%s 新日期=%s',
    followup_id, followup.plan_date, plan_date)
  const updateRes = await db.collection('followups').doc(followup_id).update({
    data: {
      plan_date,
      updated_at: new Date()
    }
  })
  console.log('[updateFollowup] adjust_date 更新结果, stats=%j', updateRes.stats)
  const updatedFollowup = await getFollowup(followup_id)
  if (!updatedFollowup || updatedFollowup.plan_date !== plan_date) {
    console.error('[updateFollowup] adjust_date 写后校验失败, id=%s expected=%s actual=%s stats=%j',
      followup_id, plan_date, updatedFollowup && updatedFollowup.plan_date, updateRes.stats)
    return {
      code: 500,
      message: '随访日期写入未生效，请重试',
      data: {
        followup_id,
        expected_plan_date: plan_date,
        actual_plan_date: updatedFollowup && updatedFollowup.plan_date,
        stats: updateRes.stats
      },
      version: VERSION
    }
  }
  return { code: 0, data: { followup_id, plan_date } }
}

// 取消随访
async function handleCancel(openid, event) {
  const { followup_id } = event
  if (!followup_id) return { code: 400, message: '缺少 followup_id' }

  // 服务端校验：仅已审核通过的医生可取消随访
  const doctorCheck = await validateApprovedDoctor(openid)
  if (!doctorCheck.isValid) return { code: doctorCheck.code, message: doctorCheck.message }

  const followup = await getFollowup(followup_id)
  if (!followup) return { code: 404, message: '随访记录不存在' }

  if (followup.doctor_id !== openid) {
    return { code: 403, message: '仅录入医生可取消随访' }
  }

  if (followup.status === 'completed') {
    return { code: 400, message: '已完成的随访不可取消' }
  }

  console.log('[updateFollowup] cancel 更新数据库, id=%s', followup_id)
  const updateRes = await db.collection('followups').doc(followup_id).update({
    data: {
      status: 'cancelled',
      updated_at: new Date()
    }
  })
  console.log('[updateFollowup] cancel 更新结果, stats=%j', updateRes.stats)
  return { code: 0, data: { followup_id } }
}

// 重新激活失访/已取消的随访
async function handleReactivate(openid, event) {
  const { followup_id, plan_date } = event
  if (!followup_id) return { code: 400, message: '缺少 followup_id' }
  if (!plan_date) return { code: 400, message: '请选择新的计划日期' }

  // 服务端校验：仅已审核通过的医生可重新激活随访
  const doctorCheck = await validateApprovedDoctor(openid)
  if (!doctorCheck.isValid) return { code: doctorCheck.code, message: doctorCheck.message }

  const followup = await getFollowup(followup_id)
  if (!followup) return { code: 404, message: '随访记录不存在' }

  // 仅录入医生可重新激活
  if (followup.doctor_id !== openid) {
    return { code: 403, message: '仅录入医生可重新激活随访' }
  }

  // 仅失访或已取消的随访可重新激活
  if (!['lost', 'cancelled'].includes(followup.status)) {
    return { code: 400, message: '仅失访或已取消的随访可重新激活' }
  }

  console.log('[updateFollowup] reactivate 更新数据库, id=%s 新日期=%s', followup_id, plan_date)
  const updateRes = await db.collection('followups').doc(followup_id).update({
    data: {
      status: 'scheduled',
      plan_date,
      // 重置提醒记录，使定时任务可重新发送提醒
      remind_records: [],
      completed_at: null,
      completion_source: null,
      updated_at: new Date()
    }
  })
  console.log('[updateFollowup] reactivate 更新结果, stats=%j', updateRes.stats)
  return { code: 0, data: { followup_id, plan_date } }
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

// 严格校验调用方是否为已审核通过的医生
// 同时满足：users.roles 含 'doctor' + doctor_info.status === 'approved'
async function validateApprovedDoctor(openid) {
  try {
    const res = await db.collection('users').where({ openid }).limit(1).get()
    const user = res.data[0]
    if (!user || !Array.isArray(user.roles) || !user.roles.includes('doctor')) {
      return { isValid: false, code: 403, message: '您不是医生角色，无权执行此操作' }
    }
    if (!user.doctor_info || user.doctor_info.status !== 'approved') {
      return { isValid: false, code: 403, message: '医生身份未审核通过，无法执行此操作' }
    }
    return { isValid: true, user }
  } catch (err) {
    if (isCollectionMissingError(err)) {
      return { isValid: false, code: 503, message: '数据库集合未初始化' }
    }
    throw err
  }
}
