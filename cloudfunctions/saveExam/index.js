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
  return { code: 0, data: { exam_id: result._id } }
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

// 删除体检记录
async function handleDelete(openid, event) {
  const { exam_id } = event
  if (!exam_id) return { code: 400, message: '缺少 exam_id' }

  const exam = await getExamWithPermission(exam_id, openid)
  if (!exam) return { code: 403, message: '无权删除此体检记录' }

  await db.collection('exams').doc(exam_id).remove()
  return { code: 0, data: { exam_id } }
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

function isCollectionMissingError(err) {
  const msg = (err && (err.errMsg || err.message)) || ''
  return /collection.*(not.*exist|不存在)|-502003/i.test(msg)
}
