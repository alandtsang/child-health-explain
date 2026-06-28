// miniprogram/pages/doctor/home/index.js
const auth = require('../../../utils/auth')
const api = require('../../../utils/api')
const format = require('../../../utils/format')
const { ABNORMAL_LEVEL_INFO } = require('../../../utils/constants')

const db = wx.cloud.database()
const _ = db.command

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

  // 加载统计数据
  async loadStats() {
    const openid = auth.getOpenid()
    try {
      const [pendingRes, pushedRes, followupRes] = await Promise.all([
        db.collection('reports').where({ review_status: 'pending', reviewed_by: openid }).count(),
        db.collection('reports').where({ review_status: 'approved', reviewed_by: openid }).count(),
        db.collection('followups').where({ doctor_id: openid, status: _.in(['scheduled', 'reminded']) }).count()
      ])
      this.setData({
        stats: {
          pendingReview: pendingRes.total,
          pushed: pushedRes.total,
          pendingFollowup: followupRes.total
        }
      })
    } catch (err) {
      console.error('加载统计失败:', err)
    }
  },

  // 重置并加载体检列表
  resetAndLoadExams() {
    this.setData({ page: 0, recentExams: [], hasMore: true, loading: true })
    this.loadExams()
  },

  // 加载最近体检记录（关联查询儿童信息）
  async loadExams() {
    if (this.data.loadingMore || (!this.data.loading && this.data.page > 0 && !this.data.hasMore)) return
    const openid = auth.getOpenid()
    const currentPage = this.data.page
    this.setData({ loadingMore: currentPage > 0 })

    try {
      const res = await db.collection('exams')
        .where({ doctor_id: openid })
        .orderBy('created_at', 'desc')
        .skip(currentPage * this.data.pageSize)
        .limit(this.data.pageSize)
        .get()

      const exams = await this.enrichExamsWithChild(res.data)
      const hasMore = res.data.length === this.data.pageSize

      this.setData({
        recentExams: currentPage === 0 ? exams : this.data.recentExams.concat(exams),
        page: currentPage + 1,
        hasMore,
        loading: false,
        loadingMore: false
      })
    } catch (err) {
      console.error('加载体检列表失败:', err)
      this.setData({ loading: false, loadingMore: false })
      wx.showToast({ title: '加载失败', icon: 'none' })
    }
  },

  // 关联查询儿童信息并计算展示字段
  async enrichExamsWithChild(exams) {
    const childIds = [...new Set(exams.map(e => e.child_id))]
    if (childIds.length === 0) return exams

    const childRes = await db.collection('children')
      .where({ _id: _.in(childIds) })
      .get()
    const childMap = {}
    childRes.data.forEach(c => { childMap[c._id] = c })

    return exams.map(exam => {
      const child = childMap[exam.child_id] || {}
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
        max_level: maxLevel
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
