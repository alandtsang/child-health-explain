// miniprogram/pages/doctor/report-list/index.js
const auth = require('../../../utils/auth')
const api = require('../../../utils/api')

const db = wx.cloud.database()
const _ = db.command

const TABS = [
  { key: 'pending', label: '待审核', status: 'pending' },
  { key: 'approved', label: '已推送', status: 'approved' },
  { key: 'all', label: '全部', status: null }
]

Page({
  data: {
    tabs: TABS,
    activeTab: 'pending',
    reports: [],
    loading: true,
    loadingMore: false,
    page: 0,
    pageSize: 10,
    hasMore: true
  },

  onLoad(options) {
    if (!auth.requireRole('doctor')) return
    if (options.tab) this.setData({ activeTab: options.tab })
    this.loadReports()
  },

  onSwitchTab(e) {
    const key = e.currentTarget.dataset.key
    if (key === this.data.activeTab) return
    this.setData({ activeTab: key, page: 0, reports: [], hasMore: true })
    this.loadReports()
  },

  async loadReports() {
    if (this.data.loadingMore) return
    const openid = auth.getOpenid()
    const currentPage = this.data.page
    const tab = this.data.tabs.find(t => t.key === this.data.activeTab)
    this.setData({ loadingMore: currentPage > 0 })

    try {
      let query = db.collection('reports').where({ reviewed_by: openid })
      if (tab.status) {
        query = query.where({ reviewed_by: openid, review_status: tab.status })
      }

      const res = await query
        .orderBy('created_at', 'desc')
        .skip(currentPage * this.data.pageSize)
        .limit(this.data.pageSize)
        .get()

      const reports = await this.enrichReports(res.data)
      const hasMore = res.data.length === this.data.pageSize

      this.setData({
        reports: currentPage === 0 ? reports : this.data.reports.concat(reports),
        page: currentPage + 1,
        hasMore,
        loading: false,
        loadingMore: false
      })
    } catch (err) {
      console.error('加载报告列表失败:', err)
      this.setData({ loading: false, loadingMore: false })
      wx.showToast({ title: '加载失败', icon: 'none' })
    }
  },

  // 关联查询体检和儿童信息
  async enrichReports(reports) {
    if (reports.length === 0) return reports
    const examIds = [...new Set(reports.map(r => r.exam_id))]
    const examRes = await db.collection('exams').where({ _id: _.in(examIds) }).get()
    const examMap = {}
    examRes.data.forEach(e => { examMap[e._id] = e })

    const childIds = [...new Set(examRes.data.map(e => e.child_id))]
    const childRes = await db.collection('children').where({ _id: _.in(childIds) }).get()
    const childMap = {}
    childRes.data.forEach(c => { childMap[c._id] = c })

    const { ABNORMAL_LEVEL_INFO } = require('../../../utils/constants')
    const format = require('../../../utils/format')

    return reports.map(r => {
      const exam = examMap[r.exam_id] || {}
      const child = childMap[exam.child_id] || {}
      const content = r.doctor_content || r.ai_content || {}
      const abnormals = (exam.abnormal_items || []).filter(a => a.level !== 'normal')
      const maxLevel = abnormals.length > 0 ? abnormals[0].level : 'normal'
      return {
        ...r,
        child_name: child.name || '未知',
        exam_date: format.formatDate(exam.exam_date),
        age_text: child.birth_date ? format.formatAge(child.birth_date, exam.exam_date) : '',
        summary: content.summary || '',
        max_level: maxLevel,
        abnormal_count: abnormals.length,
        has_new: false
      }
    })
  },

  onReportTap(e) {
    const report = e.detail.report
    wx.navigateTo({ url: `/pages/doctor/report-review/index?exam_id=${report.exam_id}` })
  },

  onPullDownRefresh() {
    this.setData({ page: 0, reports: [], hasMore: true })
    this.loadReports()
    wx.stopPullDownRefresh()
  },

  onReachBottom() {
    if (this.data.hasMore && !this.data.loadingMore) {
      this.loadReports()
    }
  }
})
