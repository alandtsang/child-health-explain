// cloudfunctions/login/index.js
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID
  const { action } = event

  try {
    switch (action) {
      case 'login': return await handleLogin(openid)
      case 'selectRole': return await handleSelectRole(openid, event.role)
      case 'switchRole': return await handleSwitchRole(openid, event.role)
      case 'getDoctorStatus': return await handleGetDoctorStatus(openid)
      default: return { code: 400, message: '未知的 action: ' + action }
    }
  } catch (err) {
    console.error('[login] error:', err)
    return { code: 500, message: '服务器错误', error: err.message }
  }
}

async function handleLogin(openid) {
  const user = await getOrCreateUser(openid)
  let currentRole = null
  if (user.roles && user.roles.length > 0) {
    currentRole = user.last_active_role || user.roles[0]
  }
  return { code: 0, data: { openid, user: sanitizeUser(user), currentRole, hasRole: user.roles && user.roles.length > 0 } }
}

async function handleSelectRole(openid, role) {
  if (!['parent', 'doctor'].includes(role)) return { code: 400, message: '无效的角色类型' }
  const user = await getOrCreateUser(openid)
  const roles = user.roles || []

  if (role === 'doctor') {
    const whitelistEntry = await checkDoctorWhitelist(openid)
    if (!whitelistEntry) {
      return { code: 403, message: '您的账号尚未在医生白名单中，请联系管理员激活', data: { needApproval: true } }
    }
    const doctorInfo = {
      name: whitelistEntry.name, hospital: whitelistEntry.hospital || '',
      department: whitelistEntry.department || '', title: whitelistEntry.title || '',
      license_no: whitelistEntry.license_no || '', status: 'approved',
      approved_by: 'system_whitelist', approved_at: new Date()
    }
    if (!roles.includes('doctor')) roles.push('doctor')
    await updateUserRecord(user._id, { roles, doctor_info: doctorInfo, last_active_role: 'doctor' })
    return { code: 0, data: { currentRole: 'doctor', user: sanitizeUser({ ...user, roles, doctor_info: doctorInfo }) } }
  }

  if (!roles.includes('parent')) roles.push('parent')
  await updateUserRecord(user._id, { roles, last_active_role: 'parent' })
  return { code: 0, data: { currentRole: 'parent', user: sanitizeUser({ ...user, roles }) } }
}

async function handleSwitchRole(openid, role) {
  if (!['parent', 'doctor'].includes(role)) return { code: 400, message: '无效的角色类型' }
  const user = await getOrCreateUser(openid)
  if (!(user.roles || []).includes(role)) return { code: 403, message: '您尚未拥有该角色' }
  if (role === 'doctor' && user.doctor_info && user.doctor_info.status !== 'approved') return { code: 403, message: '医生身份待审核' }
  await updateUserRecord(user._id, { last_active_role: role })
  return { code: 0, data: { currentRole: role, user: sanitizeUser(user) } }
}

async function handleGetDoctorStatus(openid) {
  const user = await getOrCreateUser(openid)
  if (!user.doctor_info) return { code: 0, data: { status: 'none', message: '未申请医生身份' } }
  return { code: 0, data: { status: user.doctor_info.status, doctorInfo: user.doctor_info } }
}

async function getOrCreateUser(openid) {
  const existing = await db.collection('users').where({ openid }).limit(1).get()
  if (existing.data.length > 0) return existing.data[0]
  const now = new Date()
  const newUser = { openid, roles: [], doctor_info: null, parent_info: null, created_at: now, updated_at: now }
  const result = await db.collection('users').add({ data: newUser })
  return { _id: result._id, ...newUser }
}

async function updateUserRecord(userId, data) {
  await db.collection('users').doc(userId).update({ data: { ...data, updated_at: new Date() } })
}

async function checkDoctorWhitelist(openid) {
  const result = await db.collection('doctor_whitelist').where({ openid, status: 'active' }).limit(1).get()
  return result.data.length > 0 ? result.data[0] : null
}

function sanitizeUser(user) {
  return { _id: user._id, openid: user.openid, roles: user.roles || [], doctor_info: user.doctor_info, parent_info: user.parent_info, created_at: user.created_at }
}
