// cloudfunctions/login/index.js
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

// 加载本地密钥配置（由 sync-env.js 从 .env 同步生成，已 gitignore）
let localSecrets = {}
try {
  localSecrets = require('./secrets.local')
} catch (e) {
  // secrets.local.js 不存在时忽略，使用云函数环境变量
}

// 从环境变量或本地密钥配置中获取配置值
function getConfig(key) {
  return process.env[key] || localSecrets[key] || ''
}

// 获取管理员 openid 列表
function getAdminOpenids() {
  const raw = getConfig('ADMIN_OPENIDS')
  return raw.split(',').map(s => s.trim()).filter(Boolean)
}

// 判断 openid 是否为管理员
function isAdmin(openid) {
  return getAdminOpenids().includes(openid)
}

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
    console.error('[login] action=%s openid=%s error:', action, openid, err)
    // 集合未初始化时给出可操作提示，而非笼统的"服务器错误"
    if (isCollectionMissingError(err)) {
      return {
        code: 503,
        message: '数据库集合未初始化，请先在云开发控制台或调用 initDatabase 初始化集合',
        error: err.errMsg || err.message
      }
    }
    // 调试阶段：message 包含具体错误原因，便于前端直接定位问题
    const detail = err.errMsg || err.message || '未知错误'
    return { code: 500, message: '服务器错误：' + detail, error: err.message }
  }
}

async function handleLogin(openid) {
  const user = await getOrCreateUser(openid)
  let currentRole = null
  if (user.roles && user.roles.length > 0) {
    currentRole = user.last_active_role || user.roles[0]
  }
  const adminFlag = isAdmin(openid)
  return { code: 0, data: { openid, user: sanitizeUser(user), currentRole, hasRole: user.roles && user.roles.length > 0, isAdmin: adminFlag } }
}

async function handleSelectRole(openid, role) {
  if (!['parent', 'doctor'].includes(role)) return { code: 400, message: '无效的角色类型' }
  const user = await getOrCreateUser(openid)
  const roles = user.roles || []

  if (role === 'doctor') {
    const whitelistEntry = await checkDoctorWhitelist(openid)
    if (!whitelistEntry) {
      // 不在白名单：查询是否有认证申请记录，前端据此决定跳转到申请页还是待审核页
      const applicationStatus = await getApplicationStatus(openid)
      return {
        code: 403,
        message: applicationStatus === 'pending' ? '您的认证申请正在审核中，请耐心等待'
               : applicationStatus === 'rejected' ? '您的认证申请未通过，请重新提交'
               : '您尚未通过医生认证，请先提交认证申请',
        data: { needApproval: true, applicationStatus }
      }
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
  // 对象类型字段用 _.set() 强制替换，避免在 null 值上合并嵌套字段报错
  // 例：doctor_info 初始为 null，直接 update 嵌套对象会触发 "Cannot create field in element {null}"
  const updateData = { updated_at: new Date() }
  for (const [key, value] of Object.entries(data)) {
    if (value !== null && typeof value === 'object' && !(value instanceof Date)) {
      updateData[key] = _.set(value)
    } else {
      updateData[key] = value
    }
  }
  await db.collection('users').doc(userId).update({ data: updateData })
}

async function checkDoctorWhitelist(openid) {
  try {
    const result = await db.collection('doctor_whitelist').where({ openid, status: 'active' }).limit(1).get()
    return result.data.length > 0 ? result.data[0] : null
  } catch (err) {
    // 集合不存在时降级为"不在白名单"，返回 403 而非 500，避免阻塞医生登录流程排查
    if (isCollectionMissingError(err)) {
      console.warn('[login] doctor_whitelist 集合未初始化，请调用 initDatabase 创建')
      return null
    }
    throw err
  }
}

// 查询当前用户最新的认证申请状态（pending / approved / rejected / none）
// 用于 selectRole 失败时告知前端应跳转到「申请页」还是「待审核页」
async function getApplicationStatus(openid) {
  try {
    const res = await db.collection('doctor_applications')
      .where({ openid })
      .orderBy('created_at', 'desc')
      .limit(1)
      .get()
    if (res.data.length === 0) return 'none'
    return res.data[0].status  // pending / approved / rejected
  } catch (err) {
    if (isCollectionMissingError(err)) return 'none'
    throw err
  }
}

// 微信云开发查询不存在的集合时，错误信息包含 collection not exists 或 errCode -502003
function isCollectionMissingError(err) {
  const msg = (err && (err.errMsg || err.message)) || ''
  return /collection.*(not.*exist|不存在)|-502003/i.test(msg)
}

function sanitizeUser(user) {
  return { _id: user._id, openid: user.openid, roles: user.roles || [], doctor_info: user.doctor_info, parent_info: user.parent_info, created_at: user.created_at }
}
