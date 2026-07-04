const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID
  const { code, action } = event

  // preview action：只查不绑，用于家长扫码后先展示儿童摘要
  if (action === 'preview') return await previewInvite(code, openid)
  // 默认：执行绑定
  return await claimChild(code, openid)
}

// 预览邀请对应的儿童档案（不写入任何数据）
async function previewInvite(code, openid) {
  if (!code) return { code: 400, message: '缺少邀请码' }
  const normalizedCode = code.trim().toUpperCase()

  try {
    const inviteRes = await db.collection('bind_invites')
      .where({ code: normalizedCode })
      .limit(1)
      .get()
    const invite = inviteRes.data[0]
    if (!invite || invite.status !== 'pending') {
      return { code: 404, message: '邀请码无效或已使用' }
    }
    if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
      await db.collection('bind_invites').doc(invite._id).update({ data: { status: 'expired' } })
      return { code: 410, message: '邀请码已过期，请联系医生重新生成' }
    }
    const childRes = await db.collection('children').doc(invite.child_id).get()
    const child = childRes.data
    if (!child) return { code: 404, message: '儿童档案不存在' }
    // 重复绑定检查
    if (Array.isArray(child.bound_parent_ids) && child.bound_parent_ids.includes(openid)) {
      return { code: 409, message: '您已绑定该儿童档案', data: { child: sanitizeChild(child) } }
    }
    return { code: 0, data: { child: sanitizeChild(child) } }
  } catch (err) {
    if (isCollectionMissingError(err)) return { code: 503, message: '数据库集合未初始化' }
    return { code: 500, message: err.message }
  }
}

// 执行绑定：写入 bound_parent_ids + invite 置 used + 补发未推送报告
async function claimChild(code, openid) {
  if (!code || !code.trim()) return { code: 400, message: '缺少邀请码' }
  const normalizedCode = code.trim().toUpperCase()

  try {
    // 1. 查邀请记录
    const inviteRes = await db.collection('bind_invites')
      .where({ code: normalizedCode })
      .limit(1)
      .get()
    const invite = inviteRes.data[0]
    if (!invite || invite.status !== 'pending') {
      return { code: 404, message: '邀请码无效或已使用' }
    }

    // 2. 校验过期
    if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
      await db.collection('bind_invites').doc(invite._id).update({ data: { status: 'expired' } })
      return { code: 410, message: '邀请码已过期，请联系医生重新生成' }
    }

    // 3. 查儿童档案
    const childRes = await db.collection('children').doc(invite.child_id).get()
    const child = childRes.data
    if (!child) return { code: 404, message: '儿童档案不存在' }

    // 4. 重复绑定检查
    if (Array.isArray(child.bound_parent_ids) && child.bound_parent_ids.includes(openid)) {
      return { code: 409, message: '您已绑定该儿童档案', data: { child: sanitizeChild(child) } }
    }

    // 5. 相似档案冲突检测（v1 仅提示，不合并）
    const conflictRes = await db.collection('children')
      .where({ name: child.name, birth_date: child.birth_date, _id: _.neq(child._id) })
      .limit(1)
      .get()
    const conflictChild = conflictRes.data[0]
    if (conflictChild) {
      const conflictBound = Array.isArray(conflictChild.bound_parent_ids) ? conflictChild.bound_parent_ids : []
      if (conflictBound.includes(openid)) {
        return {
          code: 409,
          message: '您已有同名同生日的档案，是否仍要绑定此医生档案？',
          data: { conflict_child: sanitizeChild(conflictChild), target_child: sanitizeChild(child) }
        }
      }
    }

    // 6. 原子写入：追加 openid 到 bound_parent_ids，invite 置 used
    await db.collection('children').doc(child._id).update({
      data: { bound_parent_ids: _.addToSet(openid), updated_at: db.serverDate() }
    })
    await db.collection('bind_invites').doc(invite._id).update({
      data: { status: 'used', used_by: openid, used_at: db.serverDate() }
    })

    // 7. 触发补发未推送报告
    const pushResult = await pushPendingReports(child._id, openid)

    return {
      code: 0,
      data: {
        child: sanitizeChild(child),
        pushed_reports: pushResult
      }
    }
  } catch (err) {
    console.error('[claimChild] error:', err)
    if (isCollectionMissingError(err)) {
      return { code: 503, message: '数据库集合未初始化', error: err.errMsg || err.message }
    }
    return { code: 500, message: err.message || '绑定失败' }
  }
}

// 补发该儿童所有 pending_binding 报告给刚绑定的家长
async function pushPendingReports(childId, parentOpenid) {
  const results = []
  try {
    // 1. 查该儿童的所有 exams
    const examsRes = await db.collection('exams').where({ child_id: childId }).get()
    const examIds = examsRes.data.map(e => e._id)
    if (examIds.length === 0) return results

    // 2. 查 pending_binding 报告
    const reportsRes = await db.collection('reports')
      .where({ exam_id: _.in(examIds), push_status: 'pending_binding' })
      .get()

    for (const report of reportsRes.data) {
      try {
        // 写通知记录
        await db.collection('notifications').add({
          data: {
            target_openid: parentOpenid,
            type: 'report_push',
            title: '体检报告已生成',
            content: '医生已为您生成体检解读报告，请点击查看',
            channel: 'mp_subscribe',
            status: 'pending',
            related_id: report._id,
            sent_at: null,
            created_at: db.serverDate()
          }
        })
        // 更新报告推送状态
        await db.collection('reports').doc(report._id).update({
          data: {
            pushed_to: _.addToSet(parentOpenid),
            pushed_at: db.serverDate(),
            push_status: 'pushed'
          }
        })
        results.push({ report_id: report._id, status: 'pushed' })
      } catch (err) {
        console.error('[claimChild] 补发报告失败:', report._id, err.message)
        results.push({ report_id: report._id, status: 'failed', error: err.message })
      }
    }
  } catch (err) {
    console.error('[claimChild] pushPendingReports error:', err.message)
  }
  return results
}

function sanitizeChild(child) {
  return {
    _id: child._id,
    name: child.name,
    gender: child.gender,
    birth_date: child.birth_date
  }
}

function isCollectionMissingError(err) {
  const msg = (err && (err.errMsg || err.message)) || ''
  return /collection.*(not.*exist|不存在)|-502003/i.test(msg)
}
