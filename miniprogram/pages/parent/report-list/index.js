// miniprogram/pages/parent/report-list/index.js
const auth = require('../../../utils/auth')
const api = require('../../../utils/api')
const format = require('../../../utils/format')
const { fixGrowthTerms } = format

const db = wx.cloud.database()

Page({
  data: {
    activeTab: 'doctor',  // doctor | self
    reports: [],
    selfChecks: [],
    loading: true,
    loadingMore: false,
    page: 0,
    pageSize: 10,
    hasMore: true
  },

  onLoad(options) {
    if (!auth.requireRole('parent')) return
    this.loadData()
  },

  onSwitchTab(e) {
    const tab = e.currentTarget.dataset.tab
    if (tab === this.data.activeTab) return
    this.setData({ activeTab: tab, page: 0, hasMore: true })
    this.loadData()
  },

  async loadData() {
    const openid = auth.getOpenid()
    const currentPage = this.data.page
    this.setData({ loadingMore: currentPage > 0 })

    try {
      if (this.data.activeTab === 'doctor') {
        // 查询推送给我的报告（pushed_to 是数组，用 db.command.in 满足子集要求）
        const res = await db.collection('reports')
          .where({ pushed_to: db.command.in([openid]), review_status: 'approved' })
          .orderBy('pushed_at', 'desc')
          .skip(currentPage * this.data.pageSize)
          .limit(this.data.pageSize)
          .get()

        const reports = await this.enrichReports(res.data)
        this.setData({
          reports: currentPage === 0 ? reports : this.data.reports.concat(reports),
          hasMore: res.data.length === this.data.pageSize,
          loading: false,
          loadingMore: false
        })
      } else {
        // 查询我的自查记录
        const res = await db.collection('self_checks')
          .where({ parent_openid: openid })
          .orderBy('created_at', 'desc')
          .skip(currentPage * this.data.pageSize)
          .limit(this.data.pageSize)
          .get()

        const selfChecks = res.data.map(s => ({
          _id: s._id,
          created_at: format.formatDate(s.created_at),
          summary: s.ai_result ? s.ai_result.summary : '',
          input_method: s.input_method === 'ocr' ? '拍照' : '手动'
        }))
        this.setData({
          selfChecks: currentPage === 0 ? selfChecks : this.data.selfChecks.concat(selfChecks),
          hasMore: res.data.length === this.data.pageSize,
          loading: false,
          loadingMore: false
        })
      }
    } catch (err) {
      console.error('加载列表失败:', err)
      this.setData({ loading: false, loadingMore: false })
      wx.showToast({ title: '加载失败', icon: 'none' })
    }
  },

  async enrichReports(reports) {
    if (reports.length === 0) return reports
    const examIds = [...new Set(reports.map(r => r.exam_id))]
    // exams read:false，改走云函数
    const exams = await api.getExamsByIds(examIds)
    const examMap = {}
    exams.forEach(e => { examMap[e._id] = e })

    const childIds = [...new Set(exams.map(e => e.child_id))]
    // children doc(id).get() 改走云函数（安全规则迁移）
    const children = await api.getChildrenByIds(childIds)
    const childMap = {}
    children.forEach(c => { childMap[c._id] = c })

    return reports.map(r => {
      const exam = examMap[r.exam_id] || {}
      const child = childMap[exam.child_id] || {}
      const content = r.doctor_content || r.ai_content || {}
      return {
        ...r,
        child_name: child.name || '',
        exam_date: format.formatDate(exam.exam_date),
        summary: fixGrowthTerms(content.summary || ''),
        has_new: !r.viewed_at || (r.pushed_at && new Date(r.pushed_at) > new Date(r.viewed_at))
      }
    })
  },

  onReportTap(e) {
    const reportId = e.currentTarget.dataset.id
    wx.navigateTo({ url: `/pages/parent/report-detail/index?report_id=${reportId}` })
  },

  onSelfCheckTap(e) {
    const id = e.currentTarget.dataset.id
    wx.navigateTo({ url: `/pages/parent/self-check-result/index?self_check_id=${id}` })
  },

  onPullDownRefresh() {
    this.setData({ page: 0, hasMore: true })
    this.loadData()
    wx.stopPullDownRefresh()
  },

  onReachBottom() {
    if (this.data.hasMore && !this.data.loadingMore) {
      this.loadData()
    }
  }
})
