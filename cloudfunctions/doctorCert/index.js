/**
 * cloudfunctions/doctorCert/index.js
 * 医生认证申请云函数
 *
 * 支持四种操作：
 *   submit       - 用户提交医生认证申请（姓名/医院/科室/职称/执业证号/手机号/证件照片）
 *   getStatus    - 查询当前用户的最新申请状态
 *   listPending  - 管理员查询待审核申请列表
 *   review       - 管理员审核申请（approve / reject）
 *
 * 审核通过后自动将 openid 写入 doctor_whitelist（status='active'），
 * 用户再次点击「我是医生」即可激活医生角色。
 */

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

// 管理员 openid 列表：通过环境变量 ADMIN_OPENIDS 配置，逗号分隔
function getAdminOpenids() {
  const raw = getConfig('ADMIN_OPENIDS')
  return raw.split(',').map(s => s.trim()).filter(Boolean)
}

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID
  const { action } = event

  try {
    switch (action) {
      case 'submit':      return await handleSubmit(openid, event)
      case 'getStatus':   return await handleGetStatus(openid)
      case 'listPending': return await handleListPending(openid, event)
      case 'review':      return await handleReview(openid, event)
      default: return { code: 400, message: '未知的 action: ' + action }
    }
  } catch (err) {
    console.error('[doctorCert] action=%s openid=%s error:', action, openid, err)
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

// === 提交认证申请 ===
async function handleSubmit(openid, event) {
  const { name, practice_location, hospital, license_no, cert_photos } = event

  // 字段校验
  if (!name || !name.trim()) return { code: 400, message: '请输入姓名' }
  if (!practice_location || !practice_location.trim()) return { code: 400, message: '请输入执业地点' }
  if (!hospital || !hospital.trim()) return { code: 400, message: '请输入所在医疗机构' }
  if (!license_no || !license_no.trim()) return { code: 400, message: '请输入医师执业证书编号' }
  if (!cert_photos || !Array.isArray(cert_photos) || cert_photos.length === 0) {
    return { code: 400, message: '请至少上传一张证件照片' }
  }

  // 查询是否已在白名单中（已在白名单则无需申请）
  const whitelistEntry = await checkDoctorWhitelist(openid)
  if (whitelistEntry) {
    return { code: 400, message: '您已在医生白名单中，无需重复申请' }
  }

  // 查询是否已有待审核的申请
  const existingRes = await db.collection('doctor_applications')
    .where({ openid, status: 'pending' })
    .limit(1)
    .get()
  if (existingRes.data.length > 0) {
    return { code: 409, message: '您已有一份待审核的申请，请耐心等待管理员处理' }
  }

  // 创建申请记录
  const now = new Date()
  const applicationData = {
    openid,
    name: name.trim(),
    practice_location: practice_location.trim(),
    hospital: hospital.trim(),
    license_no: license_no.trim(),
    cert_photos,                  // 云存储 fileID 数组
    status: 'pending',            // pending / approved / rejected
    review_note: '',
    reviewed_by: '',
    reviewed_at: null,
    created_at: now,
    updated_at: now
  }

  const result = await db.collection('doctor_applications').add({ data: applicationData })

  return {
    code: 0,
    message: '申请已提交，请等待管理员审核',
    data: { application_id: result._id, status: 'pending' }
  }
}

// === 查询当前用户的最新申请状态 ===
async function handleGetStatus(openid) {
  // 先查白名单
  const whitelistEntry = await checkDoctorWhitelist(openid)
  if (whitelistEntry) {
    return {
      code: 0,
      data: {
        status: 'whitelisted',
        message: '您已在医生白名单中，可直接激活医生身份',
        doctorInfo: {
          name: whitelistEntry.name,
          practice_location: whitelistEntry.practice_location || '',
          hospital: whitelistEntry.hospital || '',
          license_no: whitelistEntry.license_no || ''
        }
      }
    }
  }

  // 查最新申请记录
  const res = await db.collection('doctor_applications')
    .where({ openid })
    .orderBy('created_at', 'desc')
    .limit(1)
    .get()

  if (res.data.length === 0) {
    return { code: 0, data: { status: 'none', message: '尚未提交认证申请' } }
  }

  const app = res.data[0]
  return {
    code: 0,
    data: {
      status: app.status,           // pending / approved / rejected
      message: app.status === 'pending' ? '申请审核中，请耐心等待'
             : app.status === 'approved' ? '申请已通过，请点击「我是医生」激活身份'
             : '申请未通过：' + (app.review_note || '请联系管理员'),
      application: {
        name: app.name,
        practice_location: app.practice_location,
        hospital: app.hospital,
        license_no: app.license_no,
        created_at: app.created_at,
        review_note: app.review_note || ''
      }
    }
  }
}

// === 管理员查询待审核申请列表 ===
async function handleListPending(openid, event) {
  const adminCheck = requireAdmin(openid)
  if (!adminCheck.ok) return { code: 403, message: adminCheck.message }

  const { status, page, pageSize } = event
  const filterStatus = status || 'pending'
  const currentPage = page || 0
  const currentPageSize = pageSize || 20

  const query = db.collection('doctor_applications').where({ status: filterStatus })
  const [countRes, listRes] = await Promise.all([
    query.count(),
    query.orderBy('created_at', 'desc')
      .skip(currentPage * currentPageSize)
      .limit(currentPageSize)
      .get()
  ])

  return {
    code: 0,
    data: {
      total: countRes.total,
      page: currentPage,
      pageSize: currentPageSize,
      list: listRes.data
    }
  }
}

// === 管理员审核申请 ===
async function handleReview(openid, event) {
  const adminCheck = requireAdmin(openid)
  if (!adminCheck.ok) return { code: 403, message: adminCheck.message }

  const { application_id, decision, review_note } = event
  if (!application_id) return { code: 400, message: '缺少 application_id' }
  if (!['approve', 'reject'].includes(decision)) {
    return { code: 400, message: 'decision 必须为 approve 或 reject' }
  }

  // 获取申请记录
  const appRes = await db.collection('doctor_applications').doc(application_id).get()
  const application = appRes.data
  if (!application) return { code: 404, message: '申请记录不存在' }
  if (application.status !== 'pending') {
    return { code: 400, message: '该申请已处理过' }
  }

  const now = new Date()

  if (decision === 'approve') {
    // 1. 更新申请状态为已通过
    await db.collection('doctor_applications').doc(application_id).update({
      data: {
        status: 'approved',
        review_note: review_note || '审核通过',
        reviewed_by: openid,
        reviewed_at: now,
        updated_at: now
      }
    })

    // 2. 写入 doctor_whitelist（若已存在则更新为 active）
    const existingWl = await db.collection('doctor_whitelist')
      .where({ openid: application.openid })
      .limit(1)
      .get()

    if (existingWl.data.length > 0) {
      await db.collection('doctor_whitelist').doc(existingWl.data[0]._id).update({
        data: {
          name: application.name,
          practice_location: application.practice_location,
          hospital: application.hospital,
          license_no: application.license_no,
          status: 'active',
          updated_at: now
        }
      })
    } else {
      await db.collection('doctor_whitelist').add({
        data: {
          openid: application.openid,
          name: application.name,
          practice_location: application.practice_location,
          hospital: application.hospital,
          license_no: application.license_no,
          status: 'active',
          source: 'application',
          created_at: now,
          updated_at: now
        }
      })
    }

    return {
      code: 0,
      message: '审核通过，已将该医生加入白名单',
      data: { application_id, status: 'approved' }
    }
  }

  // 驳回
  await db.collection('doctor_applications').doc(application_id).update({
    data: {
      status: 'rejected',
      review_note: review_note || '审核未通过',
      reviewed_by: openid,
      reviewed_at: now,
      updated_at: now
    }
  })

  return {
    code: 0,
    message: '已驳回该申请',
    data: { application_id, status: 'rejected' }
  }
}

// === 辅助函数 ===

async function checkDoctorWhitelist(openid) {
  try {
    const result = await db.collection('doctor_whitelist').where({ openid, status: 'active' }).limit(1).get()
    return result.data.length > 0 ? result.data[0] : null
  } catch (err) {
    if (isCollectionMissingError(err)) return null
    throw err
  }
}

function requireAdmin(openid) {
  const admins = getAdminOpenids()
  if (admins.length === 0) {
    return { ok: false, message: '未配置管理员，请在云函数环境变量中设置 ADMIN_OPENIDS' }
  }
  if (!admins.includes(openid)) {
    return { ok: false, message: '无权操作，仅管理员可执行此操作' }
  }
  return { ok: true }
}

function isCollectionMissingError(err) {
  const msg = (err && (err.errMsg || err.message)) || ''
  return /collection.*(not.*exist|不存在)|-502003/i.test(msg)
}
