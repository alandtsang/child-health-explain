// miniprogram/pages/parent/ocr-review/index.js
const auth = require('../../../utils/auth')
const api = require('../../../utils/api')
const { isChildAccessibleToParent } = require('../../../utils/db')

Page({
  data: {
    fileId: '',
    childId: '',
    examDate: '',
    ocrResult: null,
    confidenceText: '--',  // 预计算的置信度显示文本
    uncertainFields: [],   // OCR不确定字段列表
    metrics: {},
    loading: true,
    parsing: false
  },

  onLoad(options) {
    if (!auth.requireRole('parent')) return
    this.setData({
      fileId: options.file_id,
      childId: options.child_id,
      examDate: options.exam_date
    })
    this.startParse()
  },

  /**
   * 获取儿童出生日期 → 计算月龄 → 调用 OCR 解析
   */
  async startParse() {
    let ageMonths = null
    try {
      // children doc(id).get() 改走云函数（安全规则迁移）
      const child = await api.getChildDetail(this.data.childId)
      // 权限校验：仅允许为自己的孩子进行 OCR 自查，避免越权读取他人儿童档案
      if (!isChildAccessibleToParent(child, auth.getOpenid())) {
        this.setData({ loading: false })
        wx.showModal({
          title: '无权操作',
          content: '该儿童档案不属于您，无法进行自查',
          showCancel: false,
          success: () => wx.navigateBack()
        })
        return
      }
      if (child && child.birth_date) {
        ageMonths = this.calcAgeMonths(child.birth_date, this.data.examDate)
      }
    } catch (err) {
      console.warn('[ocr-review] 获取儿童档案失败，将不传月龄:', err)
    }
    this.parseOcr(ageMonths)
  },

  /**
   * 计算月龄
   */
  calcAgeMonths(birthDate, examDate) {
    const birth = new Date(birthDate)
    const exam = new Date(examDate)
    return (exam.getFullYear() - birth.getFullYear()) * 12 +
           (exam.getMonth() - birth.getMonth())
  },

  // 调用 OCR 云函数解析
  async parseOcr(ageMonths) {
    this.setData({ parsing: true })
    try {
      const data = await api.ocrParse(this.data.fileId, ageMonths)
      const confidence = data.parse_meta?.confidence || data.ocr_raw?.confidence || 0
      this.setData({
        ocrResult: data,
        confidenceText: confidence > 0 ? (confidence * 100).toFixed(0) + '%' : '--',
        uncertainFields: data.parse_meta?.uncertain_fields || [],
        metrics: data.metrics || {},
        loading: false,
        parsing: false
      })
      // 低置信度提示
      if (confidence > 0 && confidence < 0.6) {
        wx.showModal({
          title: '识别提示',
          content: '图片识别置信度较低，请仔细核对各项数据，或改用手动录入',
          showCancel: false
        })
      }
    } catch (err) {
      console.error('OCR解析失败:', err)
      this.setData({ loading: false, parsing: false })
      wx.showModal({
        title: '解析失败',
        content: 'OCR解析失败，是否改用手动录入？',
        confirmText: '手动录入',
        success: (res) => {
          if (res.confirm) {
            wx.redirectTo({ url: '/pages/parent/self-check/index' })
          }
        }
      })
    }
  },

  // 确认校对完成，跳回自查页提交
  onConfirm() {
    // 从表单组件获取校对后的完整数据
    const form = this.selectComponent('#metricsForm')
    const metrics = form ? form.getFormData() : this.data.metrics
    // 将校对后的 metrics 传回自查页（通过全局变量或缓存）
    const pages = getCurrentPages()
    const selfCheckPage = pages.find(p => p.route === 'pages/parent/self-check/index')
    if (selfCheckPage) {
      selfCheckPage.setData({
        metrics: metrics,
        inputMethod: 'ocr',
        step: 'consent'
      })
      wx.navigateBack()
    } else {
      // fallback: 直接提交
      wx.redirectTo({ url: '/pages/parent/self-check/index' })
    }
  },

  // 重新拍照
  onRetake() {
    wx.navigateBack()
  }
})
