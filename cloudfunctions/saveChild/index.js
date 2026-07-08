// cloudfunctions/saveChild/index.js
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID
  const { action } = event

  try {
    switch (action) {
      case 'create': return await handleCreate(openid, event)
      case 'update': return await handleUpdate(openid, event)
      case 'delete': return await handleDelete(openid, event)
      default: return { code: 400, message: '未知的 action: ' + action }
    }
  } catch (err) {
    console.error('[saveChild] action=%s openid=%s error:', action, openid, err)
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

// 创建儿童档案
// 角色感知：医生建档时 bound_parent_ids 留空（待家长扫码认领），
// 家长建档时 bound_parent_ids 含自己 openid
async function handleCreate(openid, event) {
  const { name, gender, birth_date } = event
  if (!name || !name.trim()) return { code: 400, message: '请输入姓名' }
  if (!gender) return { code: 400, message: '请选择性别' }
  if (!birth_date) return { code: 400, message: '请选择出生日期' }

  const isDoctor = await isCallerDoctor(openid)

  const now = new Date()
  const childData = {
    name: name.trim(),
    gender,
    birth_date,
    medical_record_no: event.medical_record_no || '',
    bound_parent_ids: isDoctor ? [] : [openid],
    created_by: openid,
    created_at: now,
    updated_at: now
  }

  const result = await db.collection('children').add({ data: childData })
  return { code: 0, data: { child_id: result._id } }
}

// 判断调用方是否为已审核通过的医生
// 同时满足：users.roles 含 'doctor' + doctor_info.status === 'approved'
// 防止未审核或已吊销的医生以医生身份建档（bound_parent_ids 留空）
async function isCallerDoctor(openid) {
  try {
    const res = await db.collection('users')
      .where({ openid })
      .limit(1)
      .get()
    const user = res.data[0]
    if (!user || !Array.isArray(user.roles) || !user.roles.includes('doctor')) {
      return false
    }
    // 必须同时校验 doctor_info.status，防止审核中或已吊销的医生绕过
    if (!user.doctor_info || user.doctor_info.status !== 'approved') {
      return false
    }
    return true
  } catch (err) {
    if (isCollectionMissingError(err)) {
      // users 集合未初始化，保守视为非医生（家长路径）
      return false
    }
    throw err
  }
}

// 更新儿童档案
async function handleUpdate(openid, event) {
  const { child_id, name, gender, birth_date } = event
  if (!child_id) return { code: 400, message: '缺少 child_id' }

  const child = await getChildWithPermission(child_id, openid)
  if (!child) return { code: 403, message: '无权修改此儿童档案' }

  const updateData = { updated_at: new Date() }
  if (name !== undefined) updateData.name = name.trim()
  if (gender !== undefined) updateData.gender = gender
  if (birth_date !== undefined) updateData.birth_date = birth_date
  if (event.medical_record_no !== undefined) updateData.medical_record_no = event.medical_record_no

  await db.collection('children').doc(child_id).update({ data: updateData })
  return { code: 0, data: { child_id } }
}

// 删除儿童档案
async function handleDelete(openid, event) {
  const { child_id } = event
  if (!child_id) return { code: 400, message: '缺少 child_id' }

  const child = await getChildWithPermission(child_id, openid)
  if (!child) return { code: 403, message: '无权删除此儿童档案' }

  await db.collection('children').doc(child_id).remove()
  return { code: 0, data: { child_id } }
}

// 获取儿童档案并校验权限（创建者或绑定家长均可操作）
async function getChildWithPermission(childId, openid) {
  try {
    const res = await db.collection('children').doc(childId).get()
    const child = res.data
    if (!child) return null
    const isCreator = child.created_by === openid
    const isBoundParent = (child.bound_parent_ids || []).includes(openid)
    if (!isCreator && !isBoundParent) return null
    return child
  } catch (err) {
    if (isCollectionMissingError(err)) throw err
    // doc 不存在时云开发会抛错，返回 null 表示无权限
    return null
  }
}

function isCollectionMissingError(err) {
  const msg = (err && (err.errMsg || err.message)) || ''
  return /collection.*(not.*exist|不存在)|-502003/i.test(msg)
}
