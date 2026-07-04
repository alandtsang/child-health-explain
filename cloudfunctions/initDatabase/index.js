// cloudfunctions/initDatabase/index.js
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const COLLECTIONS = ['users','children','exams','reports','media_assets','followups','self_checks','notifications','doctor_whitelist','bind_invites']

exports.main = async (event, context) => {
  const { action } = event
  switch (action) {
    case 'initCollections': return await initCollections()
    case 'seedDoctorWhitelist': return await seedDoctorWhitelist(event.doctors || [])
    case 'checkCollections': return await checkCollections()
    default: return { code: 400, message: '未知 action: ' + action }
  }
}

async function initCollections() {
  const results = []
  for (const name of COLLECTIONS) {
    try {
      // 使用官方 createCollection API 创建集合（仅云函数端可用）
      // 旧方案 add()+remove() 在新版云环境中会报 -502005，无法自动建集合
      await db.createCollection(name)
      results.push({ collection: name, status: 'created' })
    } catch (err) {
      const msg = err.errMsg || err.message || ''
      // createCollection 在集合已存在时会报错，属正常情况
      if (/already exist|已存在/i.test(msg)) {
        results.push({ collection: name, status: 'already_exists' })
      } else {
        results.push({ collection: name, status: 'error', error: msg })
      }
    }
  }
  return { code: 0, data: results }
}

async function checkCollections() {
  const results = []
  for (const name of COLLECTIONS) {
    try {
      const res = await db.collection(name).count()
      results.push({ collection: name, exists: true, count: res.total })
    } catch (err) {
      results.push({ collection: name, exists: false, error: err.errMsg || err.message })
    }
  }
  return { code: 0, data: results }
}

async function seedDoctorWhitelist(doctors) {
  const results = []
  for (const doc of doctors) {
    try {
      const existing = await db.collection('doctor_whitelist').where({ openid: doc.openid }).limit(1).get()
      if (existing.data.length > 0) {
        await db.collection('doctor_whitelist').doc(existing.data[0]._id).update({
          data: { name: doc.name, hospital: doc.hospital || '', department: doc.department || '', title: doc.title || '', license_no: doc.license_no || '', status: 'active', updated_at: new Date() }
        })
        results.push({ openid: doc.openid, status: 'updated' })
      } else {
        await db.collection('doctor_whitelist').add({
          data: { openid: doc.openid, name: doc.name, hospital: doc.hospital || '', department: doc.department || '', title: doc.title || '', license_no: doc.license_no || '', status: 'active', created_at: new Date() }
        })
        results.push({ openid: doc.openid, status: 'created' })
      }
    } catch (err) {
      results.push({ openid: doc.openid, status: 'error', error: err.message })
    }
  }
  return { code: 0, data: results }
}
