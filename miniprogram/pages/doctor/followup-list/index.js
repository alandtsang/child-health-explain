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
  { key: 'lost', label: '失访' },
  { key: 'cancelled', label: '已取消' }
]

const STATUS_LABELS = {
  scheduled: '待随访', reminded: '已提醒', completed: '已完成', lost: '失访', cancelled: '已取消'
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
    newPlanDate: '',
    // 重新激活
    reactivateVisible: false,
    reactivateFollowup: null,
    reactivateDate: ''
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

      const isActive = f.status === 'scheduled' || f.status === 'reminded'
      const daysText = isActive
        ? (diffDays > 0 ? `${diffDays}天后` : diffDays === 0 ? '今天' : `已超期${Math.abs(diffDays)}天`)
        : ''

      return {
        ...f,
        child_name: child.name || '未知',
        status_label: STATUS_LABELS[f.status] || f.status,
        plan_date_fmt: f.plan_date,
        days_text: daysText,
        is_active: isActive,
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

  async onDateChange(e) {
    const newDate = e.detail.value
    this.setData({ newPlanDate: newDate })
    return this.doAdjustDate(newDate)
  },

  // 实际执行日期调整的函数（供日期选择器确认和按钮兜底调用）
  async doAdjustDate(newDate) {
    const adjustFollowup = this.data.adjustFollowup
    if (!adjustFollowup || !newDate) return
    // 日期未变化，直接关闭弹窗
    if (newDate === adjustFollowup.plan_date) {
      this.setData({ adjustVisible: false, adjustFollowup: null })
      return
    }

    console.log('[调整日期] 开始, id=%s, 旧日期=%s, 新日期=%s', adjustFollowup._id, adjustFollowup.plan_date, newDate)

    wx.showLoading({ title: '处理中...', mask: true })
    try {
      const result = await api.updateFollowup(adjustFollowup._id, 'adjust_date', newDate, { loading: false, showError: false })
      console.log('[调整日期] 云函数返回成功:', result)

      // 乐观更新：直接修改本地列表中的日期
      const followups = this.data.followups.map(f => {
        if (f._id === adjustFollowup._id) {
          return { ...f, plan_date: newDate, plan_date_fmt: newDate }
        }
        return f
      })
      this.setData({ adjustVisible: false, adjustFollowup: null, followups })

      wx.hideLoading()
      wx.showToast({ title: '日期已调整', icon: 'success' })
      this.setData({ page: 0, followups: [], hasMore: true, loadingMore: false, loading: true })
      await this.loadFollowups()
    } catch (err) {
      console.error('[调整日期] 失败:', err)
      wx.hideLoading()
      this.showFollowupError(err, '调整失败')
    }
  },

  async onConfirmAdjust() {
    if (!this.data.newPlanDate) {
      wx.showToast({ title: '请选择日期', icon: 'none' })
      return
    }
    return this.doAdjustDate(this.data.newPlanDate)
  },

  onCancelAdjust() {
    this.setData({ adjustVisible: false, adjustFollowup: null })
  },

  // 取消随访
  onCancelFollowup(e) {
    const followup = e.currentTarget.dataset.followup || this.data.detailFollowup
    wx.showModal({
      title: '确认取消随访',
      content: `确认取消 ${followup.child_name} 的随访计划？取消后可重新激活。`,
      confirmText: '取消随访',
      confirmColor: '#FF4D4F',
      success: async (res) => {
        if (!res.confirm) return

        console.log('[取消随访] 开始, id=%s', followup._id)
        wx.showLoading({ title: '处理中...', mask: true })
        try {
          await api.updateFollowup(followup._id, 'cancel', null, { loading: false, showError: false })
          // 乐观更新：从当前列表移除
          const followups = this.data.followups.filter(f => f._id !== followup._id)
          this.setData({ detailVisible: false, followups })
          wx.hideLoading()
          wx.showToast({ title: '已取消随访', icon: 'success' })
        } catch (err) {
          console.error('[取消随访] 失败:', err)
          wx.hideLoading()
          this.showFollowupError(err, '取消失败')
        }
      }
    })
  },

  // 重新激活失访/已取消的随访
  onReactivate(e) {
    const followup = e.currentTarget.dataset.followup || this.data.detailFollowup
    const defaultDate = new Date()
    defaultDate.setDate(defaultDate.getDate() + 14)
    const y = defaultDate.getFullYear()
    const m = String(defaultDate.getMonth() + 1).padStart(2, '0')
    const d = String(defaultDate.getDate()).padStart(2, '0')
    this.setData({
      reactivateFollowup: followup,
      reactivateVisible: true,
      reactivateDate: `${y}-${m}-${d}`,
      detailVisible: false
    })
  },

  onReactivateDateChange(e) {
    const newDate = e.detail.value
    this.setData({ reactivateDate: newDate })
    // 选择日期后立即执行激活
    this.doReactivate(newDate)
  },

  // 实际执行重新激活的函数
  async doReactivate(newDate) {
    const reactivateFollowup = this.data.reactivateFollowup
    if (!reactivateFollowup || !newDate) return

    console.log('[重新激活] 开始, id=%s, 新日期=%s', reactivateFollowup._id, newDate)
    wx.showLoading({ title: '处理中...', mask: true })
    try {
      await api.updateFollowup(reactivateFollowup._id, 'reactivate', newDate, { loading: false, showError: false })
      this.setData({ reactivateVisible: false, reactivateFollowup: null })
      wx.hideLoading()
      wx.showToast({ title: '已重新激活', icon: 'success' })
      // 跳转到待随访 tab 并刷新
      setTimeout(() => {
        this.setData({ activeTab: 'scheduled', page: 0, followups: [], hasMore: true, loadingMore: false, loading: true })
        this.loadFollowups()
      }, 300)
    } catch (err) {
      console.error('[重新激活] 失败:', err)
      wx.hideLoading()
      this.showFollowupError(err, '激活失败')
    }
  },

  async onConfirmReactivate() {
    // 兜底：直接用当前日期执行激活
    this.doReactivate(this.data.reactivateDate)
  },

  onCancelReactivate() {
    this.setData({ reactivateVisible: false, reactivateFollowup: null })
  },

  // 统一处理随访操作错误：区分"云函数未部署/旧版本"与普通业务错误
  showFollowupError(err, defaultMsg) {
    const msg = err.message || err.errMsg || defaultMsg
    if (msg.includes('未知的 action') || msg.includes('云函数未部署')) {
      wx.showModal({
        title: '云函数需更新',
        content: '云端运行的 updateFollowup 云函数不是最新版本，请在微信开发者工具中右键 updateFollowup 文件夹，选择"上传并部署：云端安装依赖"后重试。',
        showCancel: false
      })
    } else {
      wx.showToast({ title: msg, icon: 'none', duration: 3000 })
    }
  },

  // 标记完成
  onMarkComplete(e) {
    const followup = e.currentTarget.dataset.followup || this.data.detailFollowup
    wx.showModal({
      title: '确认完成',
      content: `确认 ${followup.child_name} 的随访已完成复查？`,
      success: async (res) => {
        if (!res.confirm) return

        console.log('[标记完成] 开始, id=%s', followup._id)
        wx.showLoading({ title: '处理中...', mask: true })
        try {
          await api.updateFollowup(followup._id, 'complete', null, { loading: false, showError: false })
          // 乐观更新：从当前列表移除
          const followups = this.data.followups.filter(f => f._id !== followup._id)
          this.setData({ detailVisible: false, followups })
          wx.hideLoading()
          wx.showToast({ title: '已标记完成', icon: 'success' })
        } catch (err) {
          console.error('[标记完成] 失败:', err)
          wx.hideLoading()
          this.showFollowupError(err, '操作失败')
        }
      }
    })
  },

  onPullDownRefresh() {
    this.setData({ page: 0, followups: [], hasMore: true, loadingMore: false })
    this.loadFollowups()
    wx.stopPullDownRefresh()
  },

  onReachBottom() {
    if (this.data.hasMore && !this.data.loadingMore) {
      this.loadFollowups()
    }
  }
})
