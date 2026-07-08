/**
 * 存量数据修复：清理 children.bound_parent_ids 中误塞的医生 openid
 *
 * 背景：saveChild 修复前，医生建档时 bound_parent_ids 被误写为 [医生openid]。
 * 本脚本扫描所有 children 文档，对 bound_parent_ids 中的每个 openid 查 users 表，
 * 若该 openid 的 roles 含 'doctor'，则从 bound_parent_ids 移除。
 *
 * 执行方式：可转成云函数部署，或在云开发控制台手动运行。
 * 幂等：重复执行无副作用。
 */
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

exports.main = async (event, context) => {
  const stats = { scanned: 0, fixed: 0, skipped: 0, details: [] }

  // 1. 拉取所有 children（云开发单次 limit 100，分页处理）
  let skip = 0
  const pageSize = 100
  let hasMore = true
  while (hasMore) {
    const batch = await db.collection('children').skip(skip).limit(pageSize).get()
    if (batch.data.length === 0) { hasMore = false; break }

    for (const child of batch.data) {
      stats.scanned++
      const bound = Array.isArray(child.bound_parent_ids) ? child.bound_parent_ids : []
      if (bound.length === 0) { stats.skipped++; continue }

      // 2. 对每个 bound openid 查 users，判断是否为医生
      const doctorOpenids = []
      for (const openid of bound) {
        try {
          const uRes = await db.collection('users').where({ openid }).limit(1).get()
          const user = uRes.data[0]
          if (user && Array.isArray(user.roles) && user.roles.includes('doctor')) {
            doctorOpenids.push(openid)
          }
        } catch (e) {
          // 单个查询失败不阻塞整体，记录后继续
          stats.details.push({ child_id: child._id, openid, error: e.message })
        }
      }

      // 3. 若有医生 openid 混入，移除
      if (doctorOpenids.length > 0) {
        const cleaned = bound.filter(id => !doctorOpenids.includes(id))
        await db.collection('children').doc(child._id).update({
          data: { bound_parent_ids: _.set(cleaned), updated_at: db.serverDate() }
        })
        stats.fixed++
        stats.details.push({ child_id: child._id, removed: doctorOpenids, kept: cleaned })
      } else {
        stats.skipped++
      }
    }

    skip += pageSize
    if (batch.data.length < pageSize) hasMore = false
  }

  return { code: 0, data: stats }
}
