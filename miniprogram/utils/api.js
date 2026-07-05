// miniprogram/utils/api.js
const { API_CODE } = require('./constants')

function callFunction(name, data, options) {
  const opts = options || {}
  if (opts.loading !== false) wx.showLoading({ title: opts.loadingText || '加载中...', mask: true })

  const callPromise = wx.cloud.callFunction({ name, data: data || {} })

  // 客户端超时保护：opts.timeout(毫秒) 到期后主动拒绝，避免用户无限等待
  const wrappedPromise = opts.timeout
    ? Promise.race([
        callPromise,
        new Promise((_, reject) => {
          setTimeout(() => {
            reject({ errCode: -504003, errMsg: `callFunction:${name} 客户端超时(${opts.timeout / 1000}秒)` })
          }, opts.timeout)
        })
      ])
    : callPromise

  let loadingHidden = false
  return wrappedPromise.then(res => {
    if (opts.loading !== false) { wx.hideLoading(); loadingHidden = true }
    const result = res.result
    if (result && (result.code === API_CODE.SUCCESS || result.success === true)) {
      return result.data || result
    }
    const errMsg = (result && (result.message || result.error)) || '请求失败'
    return Promise.reject(new Error(errMsg))
  }).catch(err => {
    // 仅在 .then 未执行过 hideLoading 时调用（网络错误场景）
    if (opts.loading !== false && !loadingHidden) wx.hideLoading()
    if (opts.showError !== false) {
      const tip = resolveCallErrorTip(err)
      const msg = tip || (err && err.message) || '请求失败'
      // 延迟显示，避免与 hideLoading 冲突导致 toast 被关闭
      setTimeout(() => {
        wx.showToast({ title: msg, icon: 'none', duration: 3000 })
      }, 100)
    }
    return Promise.reject(err)
  })
}

// 区分云调用失败原因，给出可操作提示而非笼统的"网络异常"
function resolveCallErrorTip(err) {
  if (!err) return ''
  const msg = (err.errMsg || err.message || '').toLowerCase()
  // 云环境未初始化 / 配置错误（排除 "ARK_API_KEY 环境变量" 等非云环境错误）
  if (/env.*invalid|invalid.*env|env_id|cloud.*env|环境.*不存在|环境.*id/.test(msg)) {
    return '云开发环境未配置，请检查 app.js 中的 cloudEnv'
  }
  // 云函数不存在或未部署
  if (/function.*not.*found|not.*exist|找不到|不存在/.test(msg)) {
    return '云函数未部署，请先上传云函数'
  }
  // 云函数执行超时（服务端 -504003 或客户端 Promise.race 超时）
  if (/timed out|timeout|超时|-504003/.test(msg)) {
    return '识别超时，请确认云函数超时配置后重试'
  }
  // 网络层错误
  if (err.errCode || err.errMsg) return '网络异常，请重试'
  return ''
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
function deleteExam(examId) {
  return callFunction('saveExam', { action: 'delete', exam_id: examId }, { loadingText: '删除中...' })
}
function generateReport(examId) {
  // generateReport 调用 LLM 生成解读，服务端超时 40s，客户端设 38s 提前断开
  return callFunction('generateReport', { exam_id: examId }, { loadingText: 'AI解读生成中...', timeout: 38000 })
}

// === OCR 解析（Phase 3）===
function ocrParse(imageFileId, ageMonths) {
  const data = { fileID: imageFileId }
  if (ageMonths != null) data.age_months = ageMonths
  // ocrParse 下载图片→腾讯OCR→豆包LLM 三步链路，服务端超时 60s，客户端设 55s
  return callFunction('ocrParse', data, { loadingText: '识别中...', timeout: 55000 })
}

// === 报告审核（Phase 4）===
function reviewReport(reportId, action, doctorContent, doctorNote) {
  return callFunction('reviewReport', {
    reportId, action, doctorContent, doctorNote
  }, { loadingText: '提交中...' })
}

// === 家长自查（Phase 4）===
function selfCheck(data) {
  // selfCheck 调用 LLM 解读，服务端超时 40s，客户端设 38s
  return callFunction('selfCheck', data, { loadingText: 'AI解读中...', timeout: 38000 })
}

// === 海报与视频（Phase 5）===
function genPoster(source, params) {
  return callFunction('genPoster', { source, ...params }, { loadingText: '海报生成中...', timeout: 55000 })
}
function videoCreate(reportId) {
  return callFunction('videoCreate', { report_id: reportId }, { loadingText: '提交中...' })
}

// === 随访管理（Phase 6）===
// options 可传入 { loading: false, showError: false } 让调用方自行管理 loading 和错误提示
function updateFollowup(followupId, action, planDate, options) {
  return callFunction('updateFollowup', { followup_id: followupId, action, plan_date: planDate }, options || { loadingText: '处理中...' })
}

// === 儿童档案 ===
function saveChild(data) {
  return callFunction('saveChild', data, { loadingText: '保存中...' })
}

// === 家长↔儿童档案绑定 ===
function createBindInvite(childId) {
  return callFunction('createBindInvite', { child_id: childId }, { loadingText: '生成邀请...' })
}
function previewInvite(code) {
  return callFunction('claimChild', { code, action: 'preview' }, { loading: false, showError: false })
}
function claimChild(code) {
  return callFunction('claimChild', { code }, { loadingText: '绑定中...' })
}

// === 医生认证申请 ===
function submitDoctorCert(data) {
  return callFunction('doctorCert', { action: 'submit', ...data }, { loadingText: '提交中...' })
}
function getDoctorCertStatus() {
  return callFunction('doctorCert', { action: 'getStatus' }, { loading: false, showError: false })
}
function listDoctorApplications(status, page, pageSize) {
  return callFunction('doctorCert', { action: 'listPending', status, page, pageSize }, { loadingText: '加载中...' })
}
function reviewDoctorApplication(applicationId, decision, reviewNote) {
  return callFunction('doctorCert', { action: 'review', application_id: applicationId, decision, review_note: reviewNote }, { loadingText: '处理中...' })
}

// === 数据库初始化（Phase 1 已有）===
function initCollections() { return callFunction('initDatabase', { action: 'initCollections' }, { loadingText: '初始化数据库...' }) }

module.exports = {
  callFunction, login, selectRole, switchRole, getDoctorStatus,
  evaluateMetrics, saveExam, deleteExam, generateReport, ocrParse, reviewReport,
  selfCheck, genPoster, videoCreate, updateFollowup, saveChild, initCollections,
  createBindInvite, previewInvite, claimChild,
  submitDoctorCert, getDoctorCertStatus, listDoctorApplications, reviewDoctorApplication
}
