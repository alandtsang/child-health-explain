/**
 * cloudfunctions/reviewReport/index.js
 * 医生审核报告提交云函数
 *
 * 支持四种操作：
 *   save         - 保存doctor_content草稿(review_status保持pending)
 *   approve      - 一键通过(doctor_content=ai_content, review_status=approved)
 *   approveAndPush - 审核通过并推送(保存doctor_content + 创建随访 + 触发海报 + 推送通知)
 *   reject       - 驳回(review_status=rejected)
 *
 * 入参：{ action, reportId, doctorContent, doctorNote }
 * 返回：{ success, ... }
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

const DISCLAIMER = 'AI生成内容经医生审核，仅供参考'

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID
  const { action, reportId, doctorContent, doctorNote } = event

  if (!action || !reportId) {
    return { success: false, error: '缺少必要参数: action, reportId' }
  }

  // markViewed 不需要医生身份校验，家长即可调用
  if (action === 'markViewed') {
    try {
      return await handleMarkViewed(reportId, openid)
    } catch (err) {
      console.error('[reviewReport] markViewed error:', err)
      return { success: false, error: err.message || '标记已读失败' }
    }
  }

  // 服务端强制校验：仅已审核通过的医生可执行审核操作
  const doctorCheck = await validateApprovedDoctor(openid)
  if (!doctorCheck.isValid) {
    return { success: false, error: doctorCheck.message, code: doctorCheck.code }
  }

  try {
    switch (action) {
      case 'save':
        return await handleSave(reportId, doctorContent, doctorNote, openid)
      case 'approve':
        return await handleApprove(reportId, openid)
      case 'approveAndPush':
        return await handleApproveAndPush(reportId, doctorContent, doctorNote, openid)
      case 'reject':
        return await handleReject(reportId, openid)
      default:
        return { success: false, error: '未知的 action: ' + action }
    }
  } catch (err) {
    console.error('[reviewReport] error:', err)
    return { success: false, error: err.message || '审核操作过程中发生错误' }
  }
}

/**
 * 家长标记报告已读（安全规则迁移：reports write 限医生，家长改走云函数）
 */
async function handleMarkViewed(reportId, openid) {
  const report = await getReport(reportId)

  // 校验：仅被推送的家长可标记已读
  const pushedTo = Array.isArray(report.pushed_to) ? report.pushed_to : []
  if (!pushedTo.includes(openid)) {
    return { success: false, error: '无权操作此报告', code: 403 }
  }

  if (!report.viewed_at) {
    await db.collection('reports').doc(reportId).update({
      data: { viewed_at: db.serverDate() }
    })
  }

  return { success: true, message: '已标记已读' }
}

/**
 * 保存修改（草稿）
 */
async function handleSave(reportId, doctorContent, doctorNote, openid) {
  const report = await getReport(reportId)
  if (report.review_status !== 'pending') {
    return { success: false, error: '报告当前状态不允许保存修改' }
  }

  const updateData = {}
  if (doctorContent) {
    updateData.doctor_content = _.set({ ...doctorContent, doctor_note: doctorNote || '' })
  }
  updateData.updated_at = db.serverDate()

  await db.collection('reports').doc(reportId).update({ data: updateData })

  return { success: true, message: '修改已保存' }
}

/**
 * 一键通过（不推送）
 * 若有绑定家长则标记 pushed，无绑定家长则标记 pending_binding 待家长绑定后补发
 */
async function handleApprove(reportId, openid) {
  const report = await getReport(reportId)
  if (report.review_status !== 'pending') {
    return { success: false, error: '报告当前状态不允许审核' }
  }

  // 一键通过：doctor_content = ai_content
  const doctorContent = { ...report.ai_content, doctor_note: '' }

  // 取 exam + child 判断是否有绑定家长
  let pushStatus = 'pending_binding'
  try {
    const examRes = await db.collection('exams').doc(report.exam_id).get()
    const exam = examRes.data
    if (exam) {
      const childRes = await db.collection('children').doc(exam.child_id).get()
      const child = childRes.data
      if (child && Array.isArray(child.bound_parent_ids) && child.bound_parent_ids.length > 0) {
        pushStatus = 'pushed'
      }
    }
  } catch (err) {
    console.warn('[reviewReport] handleApprove 获取 child 失败，默认 pending_binding:', err.message)
  }

  await db.collection('reports').doc(reportId).update({
    data: {
      doctor_content: _.set(doctorContent),
      review_status: 'approved',
      reviewed_by: openid,
      reviewed_at: db.serverDate(),
      updated_at: db.serverDate(),
      push_status: pushStatus
    }
  })

  // 更新体检记录状态
  await updateExamStatus(report.exam_id, 'reported')

  const msg = pushStatus === 'pushed' ? '审核通过' : '审核通过，待家长绑定后自动推送'
  return { success: true, message: msg, review_status: 'approved' }
}

/**
 * 审核通过并推送：保存doctor_content + 创建随访 + 触发海报 + 推送通知
 */
async function handleApproveAndPush(reportId, doctorContent, doctorNote, openid) {
  const report = await getReport(reportId)

  // 允许两种场景：
  // 1. 待审核报告（review_status=pending）：完整审核 + 推送
  // 2. 已审核待绑定报告（review_status=approved, push_status=pending_binding）：仅补推
  const isPendingReview = report.review_status === 'pending'
  const isPendingBinding = report.review_status === 'approved' && report.push_status === 'pending_binding'

  if (!isPendingReview && !isPendingBinding) {
    return { success: false, error: '报告当前状态不允许审核' }
  }

  // 仅在待审核时更新报告内容（已审核待绑定的报告内容不再变动）
  if (isPendingReview) {
    const finalDoctorContent = doctorContent
      ? { ...doctorContent, doctor_note: doctorNote || '' }
      : { ...report.ai_content, doctor_note: doctorNote || '' }

    await db.collection('reports').doc(reportId).update({
      data: {
        doctor_content: _.set(finalDoctorContent),
        review_status: 'approved',
        reviewed_by: openid,
        reviewed_at: db.serverDate(),
        updated_at: db.serverDate()
      }
    })

    await updateExamStatus(report.exam_id, 'reported')
  }

  // 2. 读取体检记录和儿童信息
  const examRes = await db.collection('exams').doc(report.exam_id).get()
  const exam = examRes.data
  const childRes = await db.collection('children').doc(exam.child_id).get()
  const child = childRes.data
  const parentIds = child?.bound_parent_ids || []

  const results = {
    followup: null,
    poster: null,
    notifications: []
  }

  // 3. 创建随访计划（有异常项时）
  if (exam.abnormal_items && exam.abnormal_items.length > 0) {
    const hasAbnormal = exam.abnormal_items.some(item => item.level !== 'normal')
    if (hasAbnormal) {
      try {
        const followupRes = await cloud.callFunction({
          name: 'createFollowup',
          data: {
            exam_id: exam._id
          }
        })
        results.followup = followupRes.result
        console.log('[reviewReport] 随访计划创建:', followupRes.result.success)
      } catch (err) {
        console.error('[reviewReport] 创建随访失败:', err.message)
        results.followup = { success: false, error: err.message }
      }
    }
  }

  // 4. 触发海报生成（有绑定家长时自动生成，医生也可在审核页手动生成）
  if (parentIds.length > 0) {
    try {
      const posterRes = await cloud.callFunction({
        name: 'genPoster',
        data: { source: 'doctor', report_id: reportId }
      })
      results.poster = posterRes.result
      console.log('[reviewReport] 海报生成结果:', posterRes.result.code === 0 ? '成功' : posterRes.result.message)
    } catch (err) {
      console.error('[reviewReport] 海报生成失败:', err.message)
      results.poster = { code: 500, message: err.message }
    }
  }

  // 5. 推送通知给绑定家长
  const pushedTo = []
  let pushStatus = 'pushed'

  if (parentIds.length === 0) {
    // 无绑定家长：标记 pending_binding，待家长扫码绑定后由 claimChild 触发补发
    pushStatus = 'pending_binding'
  } else {
    for (const parentId of parentIds) {
      try {
        // 创建通知记录
        const notifRecord = {
          target_openid: parentId,
          type: 'report_push',
          title: `${child?.name || '儿童'}的体检报告已生成`,
          content: '医生已为您生成体检解读报告，请点击查看',
          channel: 'mp_subscribe',
          status: 'pending',
          related_id: reportId,
          sent_at: null,
          created_at: db.serverDate()
        }
        const notifRes = await db.collection('notifications').add({ data: notifRecord })
        results.notifications.push({ notification_id: notifRes._id, target: parentId, status: 'pending' })

        // 尝试发送订阅消息
        await sendSubscribeMessage(parentId, child, reportId)
        pushedTo.push(parentId)
      } catch (err) {
        console.error('[reviewReport] 推送通知失败:', parentId, err.message)
        results.notifications.push({ target: parentId, status: 'failed', error: err.message })
      }
    }
  }

  // 6. 更新报告推送状态
  await db.collection('reports').doc(reportId).update({
    data: {
      pushed_to: _.set(pushedTo),
      pushed_at: pushedTo.length > 0 ? db.serverDate() : null,
      push_status: pushStatus
    }
  })

  const msg = pushStatus === 'pushed' ? '审核通过并推送成功' : '审核通过，待家长绑定后自动推送'
  return {
    success: true,
    message: msg,
    review_status: 'approved',
    results
  }
}

/**
 * 驳回
 */
async function handleReject(reportId, openid) {
  const report = await getReport(reportId)
  if (report.review_status !== 'pending') {
    return { success: false, error: '报告当前状态不允许驳回' }
  }

  await db.collection('reports').doc(reportId).update({
    data: {
      review_status: 'rejected',
      reviewed_by: openid,
      reviewed_at: db.serverDate(),
      updated_at: db.serverDate()
    }
  })

  return { success: true, message: '已驳回', review_status: 'rejected' }
}

/**
 * 获取报告记录
 */
async function getReport(reportId) {
  const res = await db.collection('reports').doc(reportId).get()
  if (!res.data) {
    throw new Error('报告不存在')
  }
  return res.data
}

/**
 * 更新体检记录状态
 */
async function updateExamStatus(examId, status) {
  try {
    await db.collection('exams').doc(examId).update({
      data: { status, updated_at: db.serverDate() }
    })
  } catch (err) {
    console.error('[reviewReport] 更新体检状态失败:', err.message)
  }
}

/**
 * 发送微信订阅消息
 */
async function sendSubscribeMessage(openid, child, reportId) {
  const templateId = getConfig('SUBSCRIBE_TEMPLATE_REPORT_PUSH')
  if (!templateId) {
    console.log('[reviewReport] SUBSCRIBE_TEMPLATE_REPORT_PUSH 未配置，跳过订阅消息发送')
    return
  }

  try {
    const now = new Date()
    const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`

    await cloud.openapi.subscribeMessage.send({
      touser: openid,
      templateId,
      page: `pages/parent/report-detail/index?report_id=${reportId}`,
      data: {
        thing1: { value: `${child?.name || '儿童'}的体检报告` },
        date2: { value: dateStr }
      },
      miniprogramState: 'formal'
    })

    console.log('[reviewReport] 订阅消息发送成功:', openid)
  } catch (err) {
    console.error('[reviewReport] 订阅消息发送失败:', openid, err.message)
    // 不抛出错误，推送失败不影响审核流程
  }
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
    const msg = (err && (err.errMsg || err.message)) || ''
    if (/collection.*(not.*exist|不存在)|-502003/i.test(msg)) {
      return { isValid: false, code: 503, message: '数据库集合未初始化' }
    }
    throw err
  }
}
