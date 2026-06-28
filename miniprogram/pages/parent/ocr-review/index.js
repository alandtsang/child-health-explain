// miniprogram/pages/parent/ocr-review/index.js
const auth = require('../../../utils/auth')
const api = require('../../../utils/api')

Page({
  data: {
    fileId: '',
    childId: '',
    examDate: '',
    ocrResult: null,
    confidenceText: '--',  // 预计算的置信度显示文本
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
    this.parseOcr()
  },

  // 调用 OCR 云函数解析
  async parseOcr() {
    this.setData({ parsing: true })
    try {
      const data = await api.ocrParse(this.data.fileId)
      const confidence = data.confidence || 0
      this.setData({
        ocrResult: data,
        confidenceText: confidence > 0 ? (confidence * 100).toFixed(0) + '%' : '--',
        metrics: data.metrics || {},
        loading: false,
        parsing: false
      })
      // 低置信度提示
      if (data.confidence && data.confidence < 0.6) {
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

  onMetricsChange(e) {
    this.setData({ metrics: e.detail.metrics })
  },

  // 确认校对完成，跳回自查页提交
  onConfirm() {
    // 将校对后的 metrics 传回自查页（通过全局变量或缓存）
    const pages = getCurrentPages()
    const selfCheckPage = pages.find(p => p.route === 'pages/parent/self-check/index')
    if (selfCheckPage) {
      selfCheckPage.setData({
        metrics: this.data.metrics,
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
