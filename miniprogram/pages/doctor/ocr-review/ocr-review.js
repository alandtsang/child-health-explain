// miniprogram/pages/doctor/ocr-review/ocr-review.js
const app = getApp()
const api = require('../../../utils/api')

Page({
  data: {
    ocrData: null,        // OCR完整结果
    imageFileId: '',       // 原图fileID
    uncertainFields: [],   // 不确定字段列表
    ocrConfidence: 0,      // OCR置信度
    parseConfidence: 0,    // 提取置信度
    ocrConfidenceText: '--',   // OCR置信度显示文本
    parseConfidenceText: '--', // 提取置信度显示文本
    needManual: false,     // 是否需要手动录入
    children: [],          // 儿童档案列表
    selectedChildIndex: -1,
    selectedChildId: '',
    examDate: '',          // 体检日期
    submitting: false,
    parsing: false         // OCR解析中
  },

  onLoad(options) {
    // 从上一页 URL 获取上传后的图片 fileID（与 exam-input 跳转参数保持一致）
    const { file_id, child_id, exam_date } = options || {}
    if (!file_id) {
      wx.showToast({ title: '数据已失效，请重新上传', icon: 'none' })
      setTimeout(() => wx.navigateBack(), 1500)
      return
    }

    // 预填体检日期（优先使用上一页传入的日期）
    this.setData({
      imageFileId: file_id,
      examDate: exam_date || this.formatDate(new Date())
    })

    // 先加载儿童档案（获取出生日期计算月龄），再调用 OCR 解析
    this.loadChildren(child_id).then(selectedChild => {
      const ageMonths = selectedChild
        ? this.calcAgeMonths(selectedChild.birth_date, this.data.examDate)
        : null
      this.parseOcr(file_id, ageMonths)
    })
  },

  /**
   * 调用 OCR 云函数解析体检单图片
   */
  async parseOcr(fileId, ageMonths) {
    this.setData({ parsing: true })
    try {
      const ocrData = await api.ocrParse(fileId, ageMonths)

      const ocrConfidence = ocrData.ocr_raw?.confidence || 0
      const parseConfidence = ocrData.parse_meta?.confidence || 0

      this.setData({
        ocrData,
        imageFileId: ocrData.ocr_raw?.image_file_id || fileId,
        uncertainFields: ocrData.parse_meta?.uncertain_fields || [],
        ocrConfidence,
        parseConfidence,
        ocrConfidenceText: ocrConfidence === 0 ? '--' : (ocrConfidence * 100).toFixed(0) + '%',
        parseConfidenceText: parseConfidence === 0 ? '--' : (parseConfidence * 100).toFixed(0) + '%',
        needManual: ocrData.need_manual || false,
        parsing: false
      })

      // 低置信度提示
      if (ocrConfidence > 0 && ocrConfidence < 0.6) {
        wx.showModal({
          title: '识别提示',
          content: '图片识别置信度较低，请仔细核对各项数据，或改用手动录入',
          showCancel: false
        })
      }
    } catch (err) {
      console.error('[ocr-review] OCR解析失败:', err)
      this.setData({ parsing: false })
      wx.showModal({
        title: '解析失败',
        content: (err && err.message) || 'OCR解析失败，是否返回重新上传？',
        confirmText: '返回',
        cancelText: '留在此页',
        success: (res) => {
          if (res.confirm) wx.navigateBack()
        }
      })
    }
  },

  /**
   * 加载医生创建的儿童档案列表，并按 child_id 预选
   */
  async loadChildren(preselectChildId) {
    try {
      const db = wx.cloud.database()
      const res = await db.collection('children')
        .where({ created_by: app.globalData.openid })
        .orderBy('created_at', 'desc')
        .limit(50)
        .get()

      let selectedIndex = -1
      if (preselectChildId) {
        selectedIndex = res.data.findIndex(c => c._id === preselectChildId)
      }

      this.setData({
        children: res.data,
        selectedChildIndex: selectedIndex,
        selectedChildId: selectedIndex >= 0 ? res.data[selectedIndex]._id : ''
      })

      if (res.data.length === 0) {
        wx.showModal({
          title: '提示',
          content: '暂无儿童档案，请先创建儿童档案',
          showCancel: false,
          confirmText: '去创建',
          success: (modalRes) => {
            if (modalRes.confirm) {
              wx.navigateTo({ url: '/pages/child-edit/child-edit' })
            }
          }
        })
      }

      // 返回预选的儿童对象（含 birth_date），供调用方计算月龄
      return selectedIndex >= 0 ? res.data[selectedIndex] : null
    } catch (err) {
      console.error('加载儿童列表失败:', err)
      wx.showToast({ title: '加载儿童列表失败', icon: 'none' })
      return null
    }
  },

  /**
   * 选择儿童
   */
  onChildChange(e) {
    const index = Number(e.detail.value)
    const child = this.data.children[index]
    this.setData({
      selectedChildIndex: index,
      selectedChildId: child._id
    })
  },

  /**
   * 选择体检日期
   */
  onDateChange(e) {
    this.setData({ examDate: e.detail.value })
  },

  /**
   * 格式化日期为 YYYY-MM-DD
   */
  formatDate(date) {
    const y = date.getFullYear()
    const m = String(date.getMonth() + 1).padStart(2, '0')
    const d = String(date.getDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
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

  /**
   * 预览原图
   */
  previewImage() {
    if (!this.data.imageFileId) return
    wx.previewImage({
      urls: [this.data.imageFileId],
      current: this.data.imageFileId
    })
  },

  /**
   * 提交保存：创建exam + 调用evaluateMetrics + 调用generateReport
   */
  async onSubmit() {
    if (this.data.submitting) return

    // 校验
    if (!this.data.selectedChildId) {
      wx.showToast({ title: '请选择儿童档案', icon: 'none' })
      return
    }
    if (!this.data.examDate) {
      wx.showToast({ title: '请选择体检日期', icon: 'none' })
      return
    }

    const form = this.selectComponent('#metricsForm')
    if (!form) {
      wx.showToast({ title: '表单未加载', icon: 'none' })
      return
    }

    const metrics = form.getFormData()
    const selectedChild = this.data.children[this.data.selectedChildIndex]
    const ageMonths = this.calcAgeMonths(selectedChild.birth_date, this.data.examDate)

    if (ageMonths < 0) {
      wx.showToast({ title: '体检日期早于出生日期', icon: 'none' })
      return
    }

    this.setData({ submitting: true })
    wx.showLoading({ title: '保存中...', mask: true })

    try {
      const db = wx.cloud.database()

      // 1. 创建体检记录
      const examRes = await db.collection('exams').add({
        data: {
          child_id: this.data.selectedChildId,
          doctor_id: app.globalData.openid,
          exam_date: this.data.examDate,
          source: 'ocr',
          ocr_raw: {
            image_file_id: this.data.imageFileId,
            raw_text: this.data.ocrData.ocr_raw?.raw_text || '',
            confidence: this.data.ocrConfidence
          },
          basic_info: { age_months: ageMonths },
          metrics: metrics,
          abnormal_items: [],
          status: 'draft',
          created_at: db.serverDate()
        }
      })

      const examId = examRes._id
      console.log('[ocr-review] 体检记录已创建:', examId)

      // 2. 调用evaluateMetrics获取异常分级
      wx.showLoading({ title: '指标评估中...', mask: true })
      const evalRes = await wx.cloud.callFunction({
        name: 'evaluateMetrics',
        data: {
          metrics,
          childInfo: { age_months: ageMonths, gender: selectedChild.gender },
          examDate: this.data.examDate
        }
      })

      const abnormalItems = evalRes.result.abnormal_items || []

      // 更新体检记录的异常项
      await db.collection('exams').doc(examId).update({
        data: { abnormal_items: abnormalItems }
      })

      console.log('[ocr-review] 异常分级完成, 异常项数:', abnormalItems.length)

      // 3. 调用generateReport生成AI解读
      wx.showLoading({ title: '生成解读中...', mask: true })
      await wx.cloud.callFunction({
        name: 'generateReport',
        data: { exam_id: examId }
      })

      wx.hideLoading()
      wx.showToast({ title: '保存成功', icon: 'success' })

      // 跳转到报告审核页
      setTimeout(() => {
        wx.redirectTo({
          url: `/pages/doctor/report-review/index?exam_id=${examId}`,
          fail: () => {
            wx.reLaunch({ url: '/pages/doctor/home/index' })
          }
        })
      }, 1500)

    } catch (err) {
      console.error('[ocr-review] 提交失败:', err)
      wx.hideLoading()
      wx.showToast({ title: '保存失败: ' + (err.message || '未知错误'), icon: 'none' })
    } finally {
      this.setData({ submitting: false })
    }
  }
})
