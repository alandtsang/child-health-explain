// miniprogram/pages/doctor/report-review/index.js
const auth = require('../../../utils/auth')
const api = require('../../../utils/api')
const format = require('../../../utils/format')
const { ABNORMAL_LEVEL_INFO } = require('../../../utils/constants')

const db = wx.cloud.database()

Page({
  data: {
    examId: '',
    exam: null,
    report: null,
    child: null,
    // 报告尚未生成（用于展示生成按钮）
    noReport: false,
    generating: false,
    // 编辑态的医生内容（从 ai_content 复制，可编辑）
    editContent: {
      summary: '',
      item_explanations: [],
      triage_advice: [],
      home_interventions: []
    },
    doctorNote: '',
    // AI 原始内容（用于 diff 对比）
    aiContent: null,
    // 是否有修改
    hasChanges: false,
    loading: true,
    submitting: false
  },

  onLoad(options) {
    if (!auth.requireRole('doctor')) return
    this.setData({ examId: options.exam_id })
    this.loadData()
  },

  // 加载体检+报告+儿童数据
  async loadData() {
    this.setData({ loading: true })
    try {
      // 查询体检记录
      const examRes = await db.collection('exams').doc(this.data.examId).get()
      const exam = examRes.data
      if (!exam) {
        wx.showToast({ title: '体检记录不存在', icon: 'none' })
        return
      }

      // 查询儿童信息（先查儿童，报告缺失时也需要展示体检信息）
      let child = null
      try {
        const childRes = await db.collection('children').doc(exam.child_id).get()
        child = childRes.data
      } catch (e) { /* ignore */ }

      // 格式化体检数据展示
      exam.exam_date_fmt = format.formatDate(exam.exam_date)
      if (child && child.birth_date) {
        exam.age_text = format.formatAge(child.birth_date, exam.exam_date)
      }
      // 格式化异常项
      exam.abnormal_items_fmt = (exam.abnormal_items || []).map(a => ({
        ...a,
        level_info: ABNORMAL_LEVEL_INFO[a.level] || ABNORMAL_LEVEL_INFO.normal
      }))

      // 查询关联报告
      const reportRes = await db.collection('reports')
        .where({ exam_id: this.data.examId })
        .orderBy('created_at', 'desc')
        .limit(1)
        .get()

      if (reportRes.data.length === 0) {
        // 报告尚未生成：展示体检信息 + 生成按钮，而非卡在加载界面
        this.setData({ exam, child, loading: false, noReport: true })
        return
      }
      const report = reportRes.data[0]

      // 取 AI 内容作为编辑基线
      const aiContent = report.ai_content || {}
      const baseContent = report.doctor_content || aiContent

      const editContent = JSON.parse(JSON.stringify({
        summary: baseContent.summary || '',
        item_explanations: baseContent.item_explanations || [],
        triage_advice: baseContent.triage_advice || [],
        home_interventions: baseContent.home_interventions || []
      }))

      this.setData({
        exam,
        report,
        child,
        aiContent,
        editContent,
        doctorNote: (report.doctor_content || {}).doctor_note || '',
        loading: false
      })
    } catch (err) {
      console.error('加载报告失败:', err)
      this.setData({ loading: false })
      wx.showToast({ title: '加载失败', icon: 'none' })
    }
  },

  // 概况编辑
  onSummaryInput(e) {
    this.setData({ 'editContent.summary': e.detail.value })
    this.checkChanges()
  },

  // 指标解读编辑
  onExplanationInput(e) {
    const { index, field } = e.currentTarget.dataset
    this.setData({ [`editContent.item_explanations[${index}].${field}`]: e.detail.value })
    this.checkChanges()
  },

  // 分诊建议编辑
  onTriageInput(e) {
    const { index, field } = e.currentTarget.dataset
    this.setData({ [`editContent.triage_advice[${index}].${field}`]: e.detail.value })
    this.checkChanges()
  },

  // 家庭干预编辑
  onInterventionInput(e) {
    const { index, field } = e.currentTarget.dataset
    this.setData({ [`editContent.home_interventions[${index}].${field}`]: e.detail.value })
    this.checkChanges()
  },

  // 医生备注
  onNoteInput(e) {
    this.setData({ doctorNote: e.detail.value })
    this.checkChanges()
  },

  // 检查是否有修改（与 AI 原文对比）
  checkChanges() {
    const ai = this.data.aiContent || {}
    const edit = this.data.editContent
    let changed = false
    if (edit.summary !== (ai.summary || '')) changed = true
    if (this.data.doctorNote !== ((ai.doctor_note) || '')) changed = true
    // 简化对比：JSON 序列化对比
    if (JSON.stringify(edit.item_explanations) !== JSON.stringify(ai.item_explanations || [])) changed = true
    if (JSON.stringify(edit.triage_advice) !== JSON.stringify(ai.triage_advice || [])) changed = true
    if (JSON.stringify(edit.home_interventions) !== JSON.stringify(ai.home_interventions || [])) changed = true
    this.setData({ hasChanges: changed })
  },

  // 一键通过（不修改内容，直接审核通过）
  async onQuickApprove() {
    await this.submitReview('approve')
  },

  // 保存修改（仅保存 doctor_content，不改变状态）
  async onSaveChanges() {
    await this.submitReview('save')
  },

  // 审核通过并推送
  async onApproveAndPush() {
    wx.showModal({
      title: '确认推送',
      content: '审核通过后报告将推送给家长，并创建随访计划。确认操作？',
      success: async (res) => {
        if (res.confirm) {
          await this.submitReview('approveAndPush')
        }
      }
    })
  },

  // 提交审核
  async submitReview(action) {
    this.setData({ submitting: true })
    try {
      await api.reviewReport(this.data.report._id, action, this.data.editContent, this.data.doctorNote)

      if (action === 'save') {
        wx.showToast({ title: '修改已保存', icon: 'success' })
        this.setData({ hasChanges: false })
      } else if (action === 'approve') {
        wx.showToast({ title: '审核通过', icon: 'success' })
        setTimeout(() => wx.navigateBack(), 1500)
      } else if (action === 'approveAndPush') {
        wx.showToast({ title: '已推送家长', icon: 'success' })
        setTimeout(() => wx.navigateBack(), 1500)
      }
    } catch (err) {
      console.error('审核提交失败:', err)
    } finally {
      this.setData({ submitting: false })
    }
  },

  // 判断字段是否被修改（用于 diff 高亮）
  isChanged(field, index, key) {
    const ai = this.data.aiContent || {}
    const edit = this.data.editContent
    if (field === 'summary') {
      return edit.summary !== (ai.summary || '')
    }
    if (field === 'item_explanations') {
      const aiItem = (ai.item_explanations || [])[index] || {}
      const editItem = (edit.item_explanations || [])[index] || {}
      return editItem[key] !== aiItem[key]
    }
    if (field === 'triage_advice') {
      const aiItem = (ai.triage_advice || [])[index] || {}
      const editItem = (edit.triage_advice || [])[index] || {}
      return editItem[key] !== aiItem[key]
    }
    if (field === 'home_interventions') {
      const aiItem = (ai.home_interventions || [])[index] || {}
      const editItem = (edit.home_interventions || [])[index] || {}
      return editItem[key] !== aiItem[key]
    }
    return false
  },

  // 删除体检记录
  async onDeleteExam() {
    wx.showModal({
      title: '确认删除',
      content: '确定要删除该体检记录吗？此操作不可恢复。',
      success: async (res) => {
        if (res.confirm) {
          try {
            this.setData({ submitting: true })
            await api.deleteExam(this.data.examId)
            wx.showToast({ title: '删除成功', icon: 'success' })
            setTimeout(() => wx.navigateBack(), 1500)
          } catch (err) {
            console.error('删除失败:', err)
            wx.showToast({ title: '删除失败', icon: 'none' })
          } finally {
            this.setData({ submitting: false })
          }
        }
      }
    })
  },

  // 报告尚未生成时，手动触发 AI 解读生成
  async onGenerateReport() {
    if (this.data.generating) return
    this.setData({ generating: true })
    try {
      // 直接调用 callFunction，用 generating 状态控制 WXML loading overlay
      // 关闭 wrapper 的 loading 和 toast，避免双重提示
      await api.callFunction('generateReport', { exam_id: this.data.examId }, {
        loading: false, showError: false, timeout: 38000
      })
      wx.showToast({ title: '解读已生成', icon: 'success' })
      // 重新加载数据，进入审核界面
      this.setData({ noReport: false, loading: true, generating: false })
      this.loadData()
    } catch (err) {
      console.error('生成解读失败:', err)
      const errMsg = (err && err.message) || 'AI解读生成失败，请稍后重试'
      wx.showModal({
        title: '生成失败',
        content: errMsg,
        showCancel: false
      })
    } finally {
      this.setData({ generating: false })
    }
  },

  onPullDownRefresh() {
    this.loadData()
    wx.stopPullDownRefresh()
  }
})
