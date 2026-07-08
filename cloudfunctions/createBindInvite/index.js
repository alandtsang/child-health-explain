const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const INVITE_EXPIRE_DAYS = 7
// 去掉易混字符 I O 0 1
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

function genCode() {
  let s = ''
  for (let i = 0; i < 6; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]
  return s
}

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID
  const { child_id } = event

  if (!child_id) return { code: 400, message: '缺少 child_id' }

  try {
    // 1. 校验调用方为医生
    const isDoctor = await isCallerDoctor(openid)
    if (!isDoctor) return { code: 403, message: '仅医生可生成绑定邀请' }

    // 2. 校验档案存在且归属当前医生
    const childRes = await db.collection('children').doc(child_id).get()
    const child = childRes.data
    if (!child) return { code: 404, message: '儿童档案不存在' }
    if (child.created_by !== openid) return { code: 403, message: '只能为自己的档案生成邀请' }

    // 3. 已绑定家长则不再生成
    if (Array.isArray(child.bound_parent_ids) && child.bound_parent_ids.length > 0) {
      return { code: 409, message: '该档案已有家长绑定，无需再次邀请' }
    }

    // 4. 把该 child 现有 pending invite 置 cancelled
    const existingPending = await db.collection('bind_invites')
      .where({ child_id, status: 'pending' })
      .get()
    for (const inv of existingPending.data) {
      await db.collection('bind_invites').doc(inv._id).update({ data: { status: 'cancelled' } })
    }

    // 5. 生成唯一 code（去重检查）
    let code = ''
    for (let attempt = 0; attempt < 5; attempt++) {
      const candidate = genCode()
      const dup = await db.collection('bind_invites').where({ code: candidate }).limit(1).get()
      if (dup.data.length === 0) { code = candidate; break }
    }
    if (!code) return { code: 500, message: '邀请码生成失败，请重试' }

    // 6. 计算过期时间
    const now = new Date()
    const expiresAt = new Date(now.getTime() + INVITE_EXPIRE_DAYS * 86400000)

    // 7. 写入 bind_invites
    const invite = {
      child_id,
      code,
      scene: code,
      doctor_openid: openid,
      status: 'pending',
      expires_at: expiresAt,
      used_by: null,
      used_at: null,
      created_at: db.serverDate()
    }
    const addRes = await db.collection('bind_invites').add({ data: invite })

    // 8. 生成小程序码（scene=code，page=bind-confirm）
    let qrFileId = null
    try {
      const qrRes = await cloud.openapi.wxacode.getUnlimited({
        scene: code,
        page: 'pages/parent/bind-confirm/index',
        width: 280,
        isHyaline: false
      })
      qrFileId = qrRes.fileID || null
    } catch (err) {
      console.error('[createBindInvite] 小程序码生成失败:', err.message)
      // 不阻塞，code 仍可用于手输
    }

    return {
      code: 0,
      data: {
        invite_id: addRes._id,
        code,
        qr_file_id: qrFileId,
        expires_in_days: INVITE_EXPIRE_DAYS,
        expires_at: expiresAt
      }
    }
  } catch (err) {
    console.error('[createBindInvite] error:', err)
    if (isCollectionMissingError(err)) {
      return { code: 503, message: '数据库集合未初始化，请先调用 initDatabase', error: err.errMsg || err.message }
    }
    return { code: 500, message: err.message || '生成邀请失败' }
  }
}

// 判断调用方是否为医生
async function isCallerDoctor(openid) {
  try {
    const res = await db.collection('users').where({ openid }).limit(1).get()
    const user = res.data[0]
    return !!(user && Array.isArray(user.roles) && user.roles.includes('doctor'))
  } catch (err) {
    if (isCollectionMissingError(err)) return false
    throw err
  }
}

function isCollectionMissingError(err) {
  const msg = (err && (err.errMsg || err.message)) || ''
  return /collection.*(not.*exist|不存在)|-502003/i.test(msg)
}
