// miniprogram/pages/doctor/home/index.js
const auth = require('../../../utils/auth')
const api = require('../../../utils/api')
const format = require('../../../utils/format')
const { ABNORMAL_LEVEL_INFO } = require('../../../utils/constants')
const { isCollectionMissingError } = require('../../../utils/db')

const db = wx.cloud.database()

Page({
  data: {
    doctorInfo: null,
    stats: { pendingReview: 0, pushed: 0, pendingFollowup: 0 },
    recentExams: [],
    loading: true,
    loadingMore: false,
    page: 0,
    pageSize: 10,
    hasMore: true
  },

  onLoad() {
    if (!auth.requireRole('doctor')) return
  },

  onShow() {
    if (!auth.isDoctor()) return
    const userInfo = auth.getUserInfo()
    if (userInfo && userInfo.doctor_info) {
      this.setData({ doctorInfo: userInfo.doctor_info })
    }
    this.loadStats()
    this.resetAndLoadExams()
  },

  // 加载统计数据（使用 allSettled 容错：单项失败不影响其他统计）
  async loadStats() {
    const openid = auth.getOpenid()
    const results = await Promise.allSettled([
      db.collection('reports').where({ review_status: 'pending', reviewed_by: openid }).count(),
      db.collection('reports').where({ review_status: 'approved', reviewed_by: openid }).count(),
      api.countFollowupsByDoctor(['scheduled', 'reminded'])
    ])

    const stats = { ...this.data.stats }
    if (results[0].status === 'fulfilled') stats.pendingReview = results[0].value.total
    if (results[1].status === 'fulfilled') stats.pushed = results[1].value.total
    if (results[2].status === 'fulfilled') stats.pendingFollowup = results[2].value.total
    this.setData({ stats })

    // 仅记录失败项，不影响已成功的统计
    results.forEach((r, i) => {
      if (r.status === 'rejected') {
        const label = ['待审核', '已推送', '待随访'][i]
        if (isCollectionMissingError(r.reason)) {
          console.error(`统计[${label}]失败：数据库集合未初始化`)
        } else {
          console.error(`统计[${label}]失败:`, r.reason)
        }
      }
    })
  },

  // 重置并加载体检列表
  resetAndLoadExams() {
    this.setData({ page: 0, recentExams: [], hasMore: true, loading: true })
    this.loadExams()
  },

  // 加载最近体检记录（关联查询儿童信息）
  async loadExams() {
    if (this.data.loadingMore || (!this.data.loading && this.data.page > 0 && !this.data.hasMore)) return
    const currentPage = this.data.page
    this.setData({ loadingMore: currentPage > 0 })

    try {
      const exams = await api.listExamsByDoctor(currentPage, this.data.pageSize)
      const formattedExams = this.enrichExamsWithChild(exams)
      const hasMore = exams.length === this.data.pageSize

      this.setData({
        recentExams: currentPage === 0 ? formattedExams : this.data.recentExams.concat(formattedExams),
        page: currentPage + 1,
        hasMore,
        loading: false,
        loadingMore: false
      })
    } catch (err) {
      console.error('加载体检列表失败:', err)
      this.setData({ loading: false, loadingMore: false })
      let tip = '加载失败'
      const msg = (err && (err.errMsg || err.message)) || ''
      if (isCollectionMissingError(err)) {
        tip = '数据库未初始化，请在云开发控制台运行 initDatabase'
      } else if (/function.*not.*found|not.*exist|找不到|不存在|-502003/.test(msg)) {
        tip = '云函数未部署，请先上传 listExams 等云函数'
      }
      wx.showToast({ title: tip, icon: 'none', duration: 3000 })
    }
  },

  // 计算展示字段（child 信息由 listExamsByDoctor 云函数返回）
  enrichExamsWithChild(exams) {
    return exams.map(exam => {
      const child = exam.child || {}
      const abnormals = (exam.abnormal_items || []).filter(a => a.level !== 'normal')
      const maxLevel = abnormals.length > 0
        ? abnormals.reduce((max, a) =>
          (ABNORMAL_LEVEL_INFO[a.level] || {}).order < (ABNORMAL_LEVEL_INFO[max] || {}).order ? a.level : max, 'normal')
        : 'normal'
      return {
        ...exam,
        child_name: child.name || '未知',
        age_text: child.birth_date ? format.formatAge(child.birth_date, exam.exam_date) : '',
        exam_date: format.formatDate(exam.exam_date),
        abnormal_count: abnormals.length,
        max_level: maxLevel,
        is_draft: exam.status === 'draft'
      }
    })
  },

  onExamInput() {
    wx.navigateTo({ url: '/pages/doctor/exam-input/index' })
  },

  onScanUpload() {
    wx.navigateTo({ url: '/pages/doctor/exam-input/index?mode=ocr' })
  },

  onExamTap(e) {
    const examId = e.currentTarget.dataset.id
    wx.navigateTo({ url: `/pages/doctor/report-review/index?exam_id=${examId}` })
  },

  // 长按体检记录卡片 - 删除
  onExamLongPress(e) {
    const examId = e.currentTarget.dataset.id
    const exam = this.data.recentExams.find(item => item._id === examId)
    if (!exam) return

    // 草稿状态可直接删除；已生成报告但未推送的需提示
    const isDraft = exam.is_draft
    const content = isDraft
      ? '确认删除此草稿体检记录？'
      : '该体检记录已提交，删除后将同时清除关联的报告和随访数据。确认删除？'

    wx.showModal({
      title: '删除体检记录',
      content,
      confirmText: '删除',
      confirmColor: '#FF4D4F',
      success: async (res) => {
        if (res.confirm) {
          this.setData({ loading: true })
          try {
            await api.deleteExam(examId)
            wx.showToast({ title: '已删除', icon: 'success' })
            // 从列表中移除
            const recentExams = this.data.recentExams.filter(item => item._id !== examId)
            this.setData({ recentExams, loading: false })
            // 重新加载统计
            this.loadStats()
          } catch (err) {
            console.error('删除体检记录失败:', err)
            this.setData({ loading: false })
          }
        }
      }
    })
  },

  onReportList() {
    wx.navigateTo({ url: '/pages/doctor/report-list/index' })
  },

  onFollowupList() {
    wx.navigateTo({ url: '/pages/doctor/followup-list/index' })
  },

  onProfile() {
    wx.navigateTo({ url: '/pages/doctor/profile/index' })
  },

  onPullDownRefresh() {
    this.loadStats()
    this.resetAndLoadExams()
    wx.stopPullDownRefresh()
  },

  onReachBottom() {
    if (this.data.hasMore && !this.data.loadingMore) {
      this.loadExams()
    }
  }
})
