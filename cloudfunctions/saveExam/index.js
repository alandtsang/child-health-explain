// cloudfunctions/saveExam/index.js
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
    console.error('[saveExam] action=%s openid=%s error:', action, openid, err)
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

// 创建体检记录
async function handleCreate(openid, event) {
  const { child_id, exam_date, source, metrics, status } = event
  if (!child_id) return { code: 400, message: '缺少 child_id' }
  if (!exam_date) return { code: 400, message: '请选择体检日期' }

  // 服务端校验：如果调用者是医生角色，必须 doctor_info.status === 'approved'
  // 防止未审核或已吊销的医生录入体检数据
  const doctorCheck = await checkDoctorApproved(openid)
  if (doctorCheck.isDoctor && !doctorCheck.approved) {
    return { code: 403, message: '医生身份未审核通过，无法录入体检数据' }
  }

  // 查询儿童档案以计算月龄
  let child
  try {
    const childRes = await db.collection('children').doc(child_id).get()
    child = childRes.data
  } catch (err) {
    if (isCollectionMissingError(err)) throw err
    return { code: 404, message: '儿童档案不存在' }
  }
  if (!child) return { code: 404, message: '儿童档案不存在' }

  // 权限校验：创建者或绑定家长
  const isCreator = child.created_by === openid
  const isBoundParent = (child.bound_parent_ids || []).includes(openid)
  if (!isCreator && !isBoundParent) {
    return { code: 403, message: '无权为此儿童创建体检记录' }
  }

  // 计算月龄
  const ageMonths = calcAgeMonths(child.birth_date, exam_date)
  if (ageMonths < 0) return { code: 400, message: '体检日期早于出生日期' }

  const now = new Date()
  const examData = {
    child_id,
    doctor_id: openid,
    exam_date,
    source: source || 'manual',
    basic_info: { age_months: ageMonths },
    metrics: metrics || {},
    abnormal_items: [],
    status: status || 'draft',
    created_at: now,
    updated_at: now
  }

  // OCR 来源时保存原始信息
  if (source === 'ocr' && event.ocr_raw) {
    examData.ocr_raw = event.ocr_raw
  }

  const result = await db.collection('exams').add({ data: examData })
  const examId = result._id

  // 随访自动完成：同一儿童有活跃随访且新体检日期 ≥ 计划复查日期，自动标记完成
  await autoCompleteFollowups(child_id, exam_date, examId)

  return { code: 0, data: { exam_id: examId } }
}

/**
 * 随访自动完成判定（设计规格 7.3）
 * 同一 child_id 有 status=scheduled|reminded 的随访，且新体检 exam_date ≥ plan_date
 * → 自动标记为 completed，completion_source = 'doctor_input'
 * @param {string} childId - 儿童ID
 * @param {string} examDate - 新体检日期 'YYYY-MM-DD'
 * @param {string} examId - 新创建的体检记录ID（记录到 completed_exam_id）
 */
async function autoCompleteFollowups(childId, examDate, examId) {
  try {
    const _ = db.command
    // 查询该儿童所有活跃随访（scheduled / reminded）
    const followupRes = await db.collection('followups')
      .where({
        child_id: childId,
        status: _.in(['scheduled', 'reminded'])
      })
      .get()

    for (const followup of (followupRes.data || [])) {
      // 计划复查日期 ≤ 新体检日期 → 视为已复查，自动完成
      if (followup.plan_date <= examDate) {
        await db.collection('followups').doc(followup._id).update({
          data: {
            status: 'completed',
            completed_at: new Date(),
            completion_source: 'doctor_input',
            completed_exam_id: examId,
            updated_at: new Date()
          }
        })
      }
    }
  } catch (err) {
    // 随访自动完成失败不影响体检创建主流程
    if (isCollectionMissingError(err)) {
      console.warn('[saveExam] followups 集合未初始化，跳过随访自动完成')
    } else {
      console.error('[saveExam] 随访自动完成失败:', err.message || err.errMsg)
    }
  }
}

// 更新体检记录（如草稿转正式、修改指标）
async function handleUpdate(openid, event) {
  const { exam_id } = event
  if (!exam_id) return { code: 400, message: '缺少 exam_id' }

  const exam = await getExamWithPermission(exam_id, openid)
  if (!exam) return { code: 403, message: '无权修改此体检记录' }

  const updateData = { updated_at: new Date() }
  if (event.metrics !== undefined) updateData.metrics = event.metrics
  if (event.status !== undefined) updateData.status = event.status
  if (event.exam_date !== undefined) {
    updateData.exam_date = event.exam_date
    // 日期变更时重新计算月龄
    if (exam.child_id) {
      try {
        const childRes = await db.collection('children').doc(exam.child_id).get()
        const child = childRes.data
        if (child) {
          updateData.basic_info = { age_months: calcAgeMonths(child.birth_date, event.exam_date) }
        }
      } catch (err) {
        // 子查询失败不阻塞更新
      }
    }
  }
  if (event.abnormal_items !== undefined) updateData.abnormal_items = event.abnormal_items

  await db.collection('exams').doc(exam_id).update({ data: updateData })
  return { code: 0, data: { exam_id } }
}

// 删除体检记录（级联清理关联数据）
async function handleDelete(openid, event) {
  const { exam_id } = event
  if (!exam_id) return { code: 400, message: '缺少 exam_id' }

  const exam = await getExamWithPermission(exam_id, openid)
  if (!exam) return { code: 403, message: '无权删除此体检记录' }

  // 权限控制：若已有关联报告且报告已推送，禁止删除
  const reportRes = await db.collection('reports').where({ exam_id }).get()
  const reports = reportRes.data || []
  const hasPushedReport = reports.some(r => r.review_status === 'approved')
  if (hasPushedReport) {
    return { code: 403, message: '该体检记录已关联已推送报告，无法删除' }
  }

  // 级联清理关联数据
  const errors = []

  // 1. 删除关联报告
  for (const report of reports) {
    try {
      await db.collection('reports').doc(report._id).remove()
    } catch (err) {
      errors.push(`报告删除失败: ${report._id}`)
    }
  }

  // 2. 删除关联随访记录
  try {
    const followupRes = await db.collection('followups').where({ exam_id }).get()
    for (const followup of (followupRes.data || [])) {
      try {
        await db.collection('followups').doc(followup._id).remove()
      } catch (err) {
        errors.push(`随访删除失败: ${followup._id}`)
      }
    }
  } catch (err) {
    // followups 集合可能不存在，忽略
  }

  // 3. 删除关联媒体资源（海报/视频）
  try {
    const reportIds = reports.map(r => r._id)
    if (reportIds.length > 0) {
      const mediaRes = await db.collection('media_assets').where({ report_id: db.command.in(reportIds) }).get()
      for (const media of (mediaRes.data || [])) {
        try {
          // 删除云存储文件
          if (media.file_id) {
            try { await cloud.deleteFile({ fileList: [media.file_id] }) } catch (e) { /* ignore */ }
          }
          await db.collection('media_assets').doc(media._id).remove()
        } catch (err) {
          errors.push(`媒体删除失败: ${media._id}`)
        }
      }
    }
  } catch (err) {
    // media_assets 集合可能不存在，忽略
  }

  // 4. 删除体检记录本身
  await db.collection('exams').doc(exam_id).remove()

  return { code: 0, data: { exam_id }, warnings: errors.length > 0 ? errors : undefined }
}

// 获取体检记录并校验权限（仅录入医生可操作）
async function getExamWithPermission(examId, openid) {
  try {
    const res = await db.collection('exams').doc(examId).get()
    const exam = res.data
    if (!exam) return null
    if (exam.doctor_id !== openid) return null
    return exam
  } catch (err) {
    if (isCollectionMissingError(err)) throw err
    return null
  }
}

// 计算月龄
function calcAgeMonths(birthDate, examDate) {
  const birth = new Date(birthDate)
  const exam = new Date(examDate)
  return (exam.getFullYear() - birth.getFullYear()) * 12 +
         (exam.getMonth() - birth.getMonth())
}

// 检查调用方是否为医生角色及是否已审核通过
// 返回 { isDoctor: bool, approved: bool }
// 如果 isDoctor=true 且 approved=false，说明是未审核/已吊销的医生，应拒绝
async function checkDoctorApproved(openid) {
  try {
    const res = await db.collection('users').where({ openid }).limit(1).get()
    const user = res.data[0]
    if (!user || !Array.isArray(user.roles) || !user.roles.includes('doctor')) {
      return { isDoctor: false, approved: false }
    }
    const approved = !!(user.doctor_info && user.doctor_info.status === 'approved')
    return { isDoctor: true, approved }
  } catch (err) {
    if (isCollectionMissingError(err)) return { isDoctor: false, approved: false }
    throw err
  }
}

function isCollectionMissingError(err) {
  const msg = (err && (err.errMsg || err.message)) || ''
  return /collection.*(not.*exist|不存在)|-502003/i.test(msg)
}
