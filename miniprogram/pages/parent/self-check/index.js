// miniprogram/pages/parent/self-check/index.js
const auth = require('../../../utils/auth')
const api = require('../../../utils/api')
const format = require('../../../utils/format')

const db = wx.cloud.database()

Page({
  data: {
    step: 'child',         // child | method | form | consent
    inputMethod: 'manual', // manual | ocr
    children: [],
    selectedChild: null,
    showChildForm: false,
    newChild: { name: '', gender: '男', birth_date: '' },
    metrics: {},
    examDate: '',
    // 知情同意
    consentChecked: false,
    consentText: '我已了解：AI自查结果仅供参考，不能替代医生诊断。如有异常请及时就医。',
    loading: false,
    submitting: false
  },

  onLoad() {
    if (!auth.requireRole('parent')) return
    this.setData({ examDate: format.formatDate(new Date()) })
    this.loadChildren()
  },

  async loadChildren() {
    const openid = auth.getOpenid()
    try {
      const res = await db.collection('children')
        .where({ bound_parent_ids: openid })
        .orderBy('created_at', 'desc')
        .get()
      this.setData({ children: res.data })
    } catch (err) {
      console.error('加载儿童列表失败:', err)
    }
  },

  onSelectChild(e) {
    this.setData({ selectedChild: e.currentTarget.dataset.child, step: 'method' })
  },

  onShowChildForm() { this.setData({ showChildForm: true }) },

  onChildInput(e) {
    this.setData({ [`newChild.${e.currentTarget.dataset.field}`]: e.detail.value })
  },

  onGenderChange(e) { this.setData({ 'newChild.gender': e.detail.value }) },

  onBirthDateChange(e) { this.setData({ 'newChild.birth_date': e.detail.value }) },

  async onCreateChild() {
    const { name, gender, birth_date } = this.data.newChild
    if (!name || !birth_date) {
      wx.showToast({ title: '请填写姓名和出生日期', icon: 'none' })
      return
    }
    this.setData({ loading: true })
    try {
      const data = await api.saveChild({ action: 'create', name, gender, birth_date })
      const newChild = { _id: data.child_id, name, gender, birth_date }
      this.setData({ selectedChild: newChild, showChildForm: false, step: 'method', loading: false })
    } catch (err) {
      this.setData({ loading: false })
    }
  },

  onSelectMethod(e) {
    const method = e.currentTarget.dataset.method
    this.setData({ inputMethod: method })
    if (method === 'ocr') {
      this.onOcrUpload()
    } else {
      this.setData({ step: 'form' })
    }
  },

  onExamDateChange(e) { this.setData({ examDate: e.detail.value }) },

  onMetricsChange(e) { this.setData({ metrics: e.detail.metrics }) },

  // OCR 拍照上传
  async onOcrUpload() {
    if (!this.data.selectedChild) {
      wx.showToast({ title: '请先选择儿童', icon: 'none' })
      return
    }
    try {
      const chooseRes = await wx.chooseMedia({ count: 1, mediaType: ['image'], sourceType: ['album', 'camera'] })
      const tempPath = chooseRes.tempFiles[0].tempFilePath
      this.setData({ loading: true })
      const cloudPath = `ocr/${Date.now()}_${Math.random().toString(36).substr(2, 8)}.jpg`
      const uploadRes = await wx.cloud.uploadFile({ cloudPath, filePath: tempPath })
      wx.navigateTo({
        url: `/pages/parent/ocr-review/index?file_id=${uploadRes.fileID}&child_id=${this.data.selectedChild._id}&exam_date=${this.data.examDate}`
      })
      this.setData({ loading: false })
    } catch (err) {
      this.setData({ loading: false })
      if (err.errMsg && !err.errMsg.includes('cancel')) {
        wx.showToast({ title: '上传失败', icon: 'none' })
      }
    }
  },

  // 进入知情同意步骤
  onToConsent() {
    this.setData({ step: 'consent' })
  },

  onConsentChange(e) {
    this.setData({ consentChecked: e.detail.value.length > 0 })
  },

  // 提交自查（需勾选知情同意）
  async onSubmitSelfCheck() {
    if (!this.data.consentChecked) {
      wx.showToast({ title: '请先勾选知情同意', icon: 'none' })
      return
    }
    this.setData({ submitting: true })
    try {
      wx.showLoading({ title: 'AI解读中...', mask: true })
      const data = await api.selfCheck({
        child_id: this.data.selectedChild._id,
        input_method: this.data.inputMethod,
        metrics: this.data.metrics,
        exam_date: this.data.examDate,
        disclaimer_acknowledged: true
      })
      wx.hideLoading()
      wx.redirectTo({ url: `/pages/parent/self-check-result/index?self_check_id=${data.self_check_id}` })
    } catch (err) {
      wx.hideLoading()
      console.error('自查失败:', err)
    } finally {
      this.setData({ submitting: false })
    }
  },

  onBack() {
    const step = this.data.step
    if (step === 'method') this.setData({ step: 'child' })
    else if (step === 'form') this.setData({ step: 'method' })
    else if (step === 'consent') this.setData({ step: 'form' })
    else wx.navigateBack()
  }
})
