// miniprogram/pages/doctor/followup-list/index.js
const auth = require('../../../utils/auth')
const api = require('../../../utils/api')
const format = require('../../../utils/format')

const db = wx.cloud.database()
const _ = db.command

const TABS = [
  { key: 'scheduled', label: '待随访' },
  { key: 'reminded', label: '已提醒' },
  { key: 'completed', label: '已完成' },
  { key: 'lost', label: '失访' }
]

const STATUS_LABELS = {
  scheduled: '待随访', reminded: '已提醒', completed: '已完成', lost: '失访'
}

Page({
  data: {
    tabs: TABS,
    activeTab: 'scheduled',
    followups: [],
    loading: true,
    loadingMore: false,
    page: 0,
    pageSize: 10,
    hasMore: true,
    // 详情弹窗
    detailVisible: false,
    detailFollowup: null,
    // 调整日期
    adjustVisible: false,
    adjustFollowup: null,
    newPlanDate: ''
  },

  onLoad(options) {
    if (!auth.requireRole('doctor')) return
    if (options.tab) this.setData({ activeTab: options.tab })
    this.loadFollowups()
  },

  onSwitchTab(e) {
    const key = e.currentTarget.dataset.key
    if (key === this.data.activeTab) return
    this.setData({ activeTab: key, page: 0, followups: [], hasMore: true })
    this.loadFollowups()
  },

  async loadFollowups() {
    if (this.data.loadingMore) return
    const openid = auth.getOpenid()
    const currentPage = this.data.page
    this.setData({ loadingMore: currentPage > 0 })

    try {
      const res = await db.collection('followups')
        .where({ doctor_id: openid, status: this.data.activeTab })
        .orderBy('plan_date', 'desc')
        .skip(currentPage * this.data.pageSize)
        .limit(this.data.pageSize)
        .get()

      const followups = await this.enrichFollowups(res.data)
      const hasMore = res.data.length === this.data.pageSize

      this.setData({
        followups: currentPage === 0 ? followups : this.data.followups.concat(followups),
        page: currentPage + 1,
        hasMore,
        loading: false,
        loadingMore: false
      })
    } catch (err) {
      console.error('加载随访列表失败:', err)
      this.setData({ loading: false, loadingMore: false })
      wx.showToast({ title: '加载失败', icon: 'none' })
    }
  },

  async enrichFollowups(followups) {
    if (followups.length === 0) return followups
    const childIds = [...new Set(followups.map(f => f.child_id))]
    const childRes = await db.collection('children').where({ _id: _.in(childIds) }).get()
    const childMap = {}
    childRes.data.forEach(c => { childMap[c._id] = c })

    const today = new Date()
    today.setHours(0, 0, 0, 0)

    return followups.map(f => {
      const child = childMap[f.child_id] || {}
      const planDate = new Date(f.plan_date)
      const diffDays = Math.round((planDate - today) / (86400000))
      const maxLevel = (f.trigger_items || []).reduce((max, t) => {
        const order = { severe: 0, moderate: 1, mild: 2, normal: 3 }
        return (order[t.level] || 9) < (order[max] || 9) ? t.level : max
      }, 'normal')

      return {
        ...f,
        child_name: child.name || '未知',
        status_label: STATUS_LABELS[f.status] || f.status,
        plan_date_fmt: f.plan_date,
        days_text: diffDays > 0 ? `${diffDays}天后` : diffDays === 0 ? '今天' : `已超期${Math.abs(diffDays)}天`,
        max_level: maxLevel
      }
    })
  },

  // 查看详情
  onFollowupTap(e) {
    const followup = e.currentTarget.dataset.followup
    this.setData({ detailFollowup: followup, detailVisible: true })
  },

  onCloseDetail() {
    this.setData({ detailVisible: false, detailFollowup: null })
  },

  // 调整随访日期
  onAdjustDate(e) {
    const followup = e.currentTarget.dataset.followup || this.data.detailFollowup
    this.setData({
      adjustFollowup: followup,
      adjustVisible: true,
      newPlanDate: followup.plan_date,
      detailVisible: false
    })
  },

  onDateChange(e) {
    this.setData({ newPlanDate: e.detail.value })
  },

  async onConfirmAdjust() {
    const { adjustFollowup, newPlanDate } = this.data
    if (!newPlanDate) {
      wx.showToast({ title: '请选择日期', icon: 'none' })
      return
    }
    this.setData({ loading: true })
    try {
      await api.updateFollowup(adjustFollowup._id, 'adjust_date', newPlanDate)
      wx.showToast({ title: '日期已调整', icon: 'success' })
      this.setData({ adjustVisible: false, adjustFollowup: null })
      this.setData({ page: 0, followups: [], hasMore: true })
      this.loadFollowups()
    } catch (err) {
      console.error('调整日期失败:', err)
    } finally {
      this.setData({ loading: false })
    }
  },

  onCancelAdjust() {
    this.setData({ adjustVisible: false, adjustFollowup: null })
  },

  // 标记完成
  onMarkComplete(e) {
    const followup = e.currentTarget.dataset.followup || this.data.detailFollowup
    wx.showModal({
      title: '确认完成',
      content: `确认 ${followup.child_name} 的随访已完成复查？`,
      success: async (res) => {
        if (res.confirm) {
          this.setData({ loading: true })
          try {
            await api.updateFollowup(followup._id, 'complete', null)
            wx.showToast({ title: '已标记完成', icon: 'success' })
            this.setData({ detailVisible: false })
            this.setData({ page: 0, followups: [], hasMore: true })
            this.loadFollowups()
          } catch (err) {
            console.error('标记完成失败:', err)
          } finally {
            this.setData({ loading: false })
          }
        }
      }
    })
  },

  onPullDownRefresh() {
    this.setData({ page: 0, followups: [], hasMore: true })
    this.loadFollowups()
    wx.stopPullDownRefresh()
  },

  onReachBottom() {
    if (this.data.hasMore && !this.data.loadingMore) {
      this.loadFollowups()
    }
  }
})
