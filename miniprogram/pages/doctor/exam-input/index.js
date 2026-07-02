// miniprogram/pages/doctor/exam-input/index.js
const auth = require('../../../utils/auth')
const api = require('../../../utils/api')
const format = require('../../../utils/format')

const db = wx.cloud.database()

Page({
  data: {
    step: 'select',          // select(选方式) | child(选儿童) | form(填表单)
    inputMethod: 'manual',   // manual | ocr
    children: [],
    selectedChild: null,
    showChildForm: false,
    newChild: { name: '', gender: '男', birth_date: '' },
    metrics: {},
    examDate: '',
    generating: false,
    loading: false
  },

  onLoad(options) {
    if (!auth.requireRole('doctor')) return
    const today = format.formatDate(new Date())
    this.setData({ examDate: today })
    if (options.mode === 'ocr') {
      this.setData({ inputMethod: 'ocr', step: 'child' })
    }
    this.loadChildren()
  },

  // 加载医生创建过的儿童档案
  async loadChildren() {
    const openid = auth.getOpenid()
    this.setData({ loading: true })
    try {
      const res = await db.collection('children')
        .where({ created_by: openid })
        .orderBy('created_at', 'desc')
        .limit(50)
        .get()
      this.setData({ children: res.data, loading: false })
    } catch (err) {
      console.error('加载儿童列表失败:', err)
      this.setData({ loading: false })
    }
  },

  // 选择录入方式
  onSelectMethod(e) {
    const method = e.currentTarget.dataset.method
    this.setData({ inputMethod: method, step: 'child' })
  },

  // 选择已有儿童
  onSelectChild(e) {
    const child = e.currentTarget.dataset.child
    this.setData({ selectedChild: child, step: 'form' })
  },

  // 显示新建儿童表单
  onShowChildForm() {
    this.setData({ showChildForm: true })
  },

  onChildInput(e) {
    const field = e.currentTarget.dataset.field
    this.setData({ [`newChild.${field}`]: e.detail.value })
  },

  onGenderChange(e) {
    this.setData({ 'newChild.gender': e.detail.value })
  },

  onBirthDateChange(e) {
    this.setData({ 'newChild.birth_date': e.detail.value })
  },

  // 创建新儿童档案
  async onCreateChild() {
    const { name, gender, birth_date } = this.data.newChild
    if (!name || !birth_date) {
      wx.showToast({ title: '请填写姓名和出生日期', icon: 'none' })
      return
    }
    this.setData({ loading: true })
    try {
      const data = await api.saveChild({
        name, gender, birth_date,
        action: 'create'
      })
      const newChild = { _id: data.child_id, name, gender, birth_date }
      this.setData({
        selectedChild: newChild,
        showChildForm: false,
        step: 'form',
        loading: false
      })
      wx.showToast({ title: '档案已创建', icon: 'success' })
    } catch (err) {
      this.setData({ loading: false })
    }
  },

  onExamDateChange(e) {
    this.setData({ examDate: e.detail.value })
  },

  // OCR 拍照上传
  async onOcrUpload() {
    try {
      const chooseRes = await wx.chooseMedia({
        count: 1,
        mediaType: ['image'],
        sourceType: ['album', 'camera']
      })
      const tempPath = chooseRes.tempFiles[0].tempFilePath
      this.setData({ loading: true })

      // 上传到云存储
      const cloudPath = `ocr/${Date.now()}_${Math.random().toString(36).substr(2, 8)}.jpg`
      const uploadRes = await wx.cloud.uploadFile({ cloudPath, filePath: tempPath })

      // 跳转到 OCR 校对页
      wx.navigateTo({
        url: `/pages/doctor/ocr-review/ocr-review?file_id=${uploadRes.fileID}&child_id=${this.data.selectedChild._id}&exam_date=${this.data.examDate}`
      })
      this.setData({ loading: false })
    } catch (err) {
      console.error('OCR上传失败:', err)
      this.setData({ loading: false })
      if (err.errMsg && !err.errMsg.includes('cancel')) {
        wx.showToast({ title: '上传失败', icon: 'none' })
      }
    }
  },

  // 保存草稿
  async onSaveDraft() {
    if (!this.data.selectedChild) {
      wx.showToast({ title: '请先选择儿童', icon: 'none' })
      return
    }
    await this.saveExam('draft')
  },

  // 保存并生成解读
  async onGenerate() {
    if (!this.data.selectedChild) {
      wx.showToast({ title: '请先选择儿童', icon: 'none' })
      return
    }
    const examId = await this.saveExam('reported')
    if (examId) {
      this.generateReport(examId)
    }
  },

  // 保存体检记录
  async saveExam(status) {
    const { selectedChild, examDate, inputMethod } = this.data
    const form = this.selectComponent('#metricsForm')
    const metrics = form ? form.getFormData() : this.data.metrics
    this.setData({ loading: true })
    try {
      const data = await api.saveExam({
        action: 'create',
        child_id: selectedChild._id,
        exam_date: examDate,
        source: inputMethod,
        metrics,
        status
      })
      this.setData({ loading: false })
      if (status === 'draft') {
        wx.showToast({ title: '草稿已保存', icon: 'success' })
      }
      return data.exam_id
    } catch (err) {
      this.setData({ loading: false })
      return null
    }
  },

  // 调用AI生成解读
  async generateReport(examId) {
    this.setData({ generating: true })
    try {
      await api.callFunction('generateReport', { exam_id: examId }, {
        loading: false, showError: false, timeout: 38000
      })
      wx.showToast({ title: '解读已生成', icon: 'success' })
      // 跳转到报告审核页
      setTimeout(() => {
        wx.redirectTo({ url: `/pages/doctor/report-review/index?exam_id=${examId}` })
      }, 1000)
    } catch (err) {
      console.error('生成解读失败:', err)
      const errMsg = (err && err.message) || 'AI解读生成失败，请稍后重试'
      wx.showModal({
        title: '生成失败',
        content: errMsg + '\n是否跳转到报告列表查看？',
        confirmText: '去列表',
        success(res) {
          if (res.confirm) {
            wx.redirectTo({ url: '/pages/doctor/report-list/index' })
          }
        }
      })
    } finally {
      this.setData({ generating: false })
    }
  },

  onBack() {
    if (this.data.step === 'form') {
      this.setData({ step: 'child' })
    } else if (this.data.step === 'child') {
      this.setData({ step: 'select' })
    } else {
      wx.navigateBack()
    }
  }
})
