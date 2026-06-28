// miniprogram/utils/api.js
const { API_CODE } = require('./constants')

function callFunction(name, data, options) {
  const opts = options || {}
  if (opts.loading !== false) wx.showLoading({ title: opts.loadingText || '加载中...', mask: true })
  return wx.cloud.callFunction({ name, data: data || {} }).then(res => {
    if (opts.loading !== false) wx.hideLoading()
    const result = res.result
    if (result && (result.code === API_CODE.SUCCESS || result.success === true)) {
      return result.data || result
    }
    const errMsg = (result && (result.message || result.error)) || '请求失败'
    if (opts.showError !== false) wx.showToast({ title: errMsg, icon: 'none', duration: 3000 })
    return Promise.reject(new Error(errMsg))
  }).catch(err => {
    if (opts.loading !== false) wx.hideLoading()
    if ((err.errCode || err.errMsg) && opts.showError !== false) {
      wx.showToast({ title: '网络异常，请重试', icon: 'none' })
    }
    return Promise.reject(err)
  })
}

// === 登录与角色（Phase 1 已有）===
function login() { return callFunction('login', { action: 'login' }, { loadingText: '登录中...' }) }
function selectRole(role) { return callFunction('login', { action: 'selectRole', role }, { loadingText: '处理中...' }) }
function switchRole(role) { return callFunction('login', { action: 'switchRole', role }, { loadingText: '切换中...' }) }
function getDoctorStatus() { return callFunction('login', { action: 'getDoctorStatus' }, { loading: false }) }

// === 指标评估（Phase 2 已有）===
function evaluateMetrics(metrics, childInfo) {
  return callFunction('evaluateMetrics', { metrics, childInfo }, { loadingText: '评估中...' })
}

// === 体检录入（Phase 4 generateReport 依赖 exam 已入库）===
function saveExam(data) {
  return callFunction('saveExam', data, { loadingText: '保存中...' })
}
function generateReport(examId) {
  return callFunction('generateReport', { exam_id: examId }, { loadingText: 'AI解读生成中...' })
}

// === OCR 解析（Phase 3）===
function ocrParse(imageFileId) {
  return callFunction('ocrParse', { image_file_id: imageFileId }, { loadingText: '识别中...' })
}

// === 报告审核（Phase 4）===
function reviewReport(reportId, action, doctorContent, doctorNote) {
  return callFunction('reviewReport', {
    report_id: reportId, action, doctor_content: doctorContent, doctor_note: doctorNote
  }, { loadingText: '提交中...' })
}

// === 家长自查（Phase 4）===
function selfCheck(data) {
  return callFunction('selfCheck', data, { loadingText: 'AI解读中...' })
}

// === 海报与视频（Phase 5）===
function genPoster(source, params) {
  return callFunction('genPoster', { source, ...params }, { loadingText: '海报生成中...' })
}
function videoCreate(reportId) {
  return callFunction('videoCreate', { report_id: reportId }, { loadingText: '提交中...' })
}

// === 随访管理（Phase 6）===
function updateFollowup(followupId, action, planDate) {
  return callFunction('updateFollowup', { followup_id: followupId, action, plan_date: planDate }, { loadingText: '处理中...' })
}

// === 儿童档案 ===
function saveChild(data) {
  return callFunction('saveChild', data, { loadingText: '保存中...' })
}

// === 数据库初始化（Phase 1 已有）===
function initCollections() { return callFunction('initDatabase', { action: 'initCollections' }, { loadingText: '初始化数据库...' }) }

module.exports = {
  callFunction, login, selectRole, switchRole, getDoctorStatus,
  evaluateMetrics, saveExam, generateReport, ocrParse, reviewReport,
  selfCheck, genPoster, videoCreate, updateFollowup, saveChild, initCollections
}
