// miniprogram/pages/parent/followup/index.js
const auth = require('../../../utils/auth')
const api = require('../../../utils/api')
const format = require('../../../utils/format')
const subscribe = require('../../../utils/subscribe')
const { isChildAccessibleToParent } = require('../../../utils/db')

const db = wx.cloud.database()

Page({
  data: {
    followups: [],
    loading: true,
    loadingMore: false,
    page: 0,
    pageSize: 10,
    hasMore: true,
    // 详情
    detailVisible: false,
    detailFollowup: null,
    completing: false,
    // 订阅引导
    showSubscribeBanner: false
  },

  onLoad(options) {
    if (!auth.requireRole('parent')) return
    this.loadFollowups()
    if (options.id) {
      // 从首页直接跳入某条随访详情
      this.loadDetail(options.id)
    }
    // 检查是否需要引导订阅
    if (!subscribe.isInCooldown('followup_remind')) {
      this.setData({ showSubscribeBanner: true })
    }
  },

  async loadFollowups() {
    const openid = auth.getOpenid()
    const currentPage = this.data.page
    this.setData({ loadingMore: currentPage > 0 })

    try {
      // 查询绑定儿童的随访记录（通过 children 集合关联）
      const childRes = await db.collection('children')
        .where({ bound_parent_ids: openid })
        .get()
      const childIds = childRes.data.map(c => c._id)

      if (childIds.length === 0) {
        this.setData({ loading: false, followups: [] })
        return
      }

      // followups read:false，改走云函数
      const followupsData = await api.listFollowupsByChildren(childIds, ['scheduled', 'reminded'], currentPage, this.data.pageSize)

      const followups = await this.enrichFollowups(followupsData)
      const hasMore = followupsData.length === this.data.pageSize

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
    // children doc(id).get() 改走云函数（安全规则迁移）
    const children = await api.getChildrenByIds(childIds)
    const childMap = {}
    children.forEach(c => { childMap[c._id] = c })

    const today = new Date()
    today.setHours(0, 0, 0, 0)

    return followups.map(f => {
      const child = childMap[f.child_id] || {}
      const planDate = new Date(f.plan_date)
      const diffDays = Math.round((planDate - today) / 86400000)
      const maxLevel = (f.trigger_items || []).reduce((max, t) => {
        const order = { severe: 0, moderate: 1, mild: 2, normal: 3 }
        return (order[t.level] || 9) < (order[max] || 9) ? t.level : max
      }, 'normal')
      return {
        ...f,
        child_name: child.name || '',
        plan_date_fmt: f.plan_date,
        days_left: diffDays,
        days_text: diffDays > 0 ? `${diffDays}天后` : diffDays === 0 ? '今天' : `已超期${Math.abs(diffDays)}天`,
        max_level: maxLevel
      }
    })
  },

  async loadDetail(followupId) {
    try {
      // followups read:false，改走云函数
      const followup = await api.getFollowupDetail(followupId)
      if (!followup) return

      // 权限校验：仅允许查看自己绑定儿童的随访，避免家长查看他人孩子的数据
      // children doc(id).get() 改走云函数（安全规则迁移）
      const child = await api.getChildDetail(followup.child_id).catch(() => null)
      if (!isChildAccessibleToParent(child, auth.getOpenid())) {
        wx.showModal({
          title: '无权查看',
          content: '该随访不属于您绑定的孩子，无法查看',
          showCancel: false
        })
        return
      }

      // 丰富数据
      const enriched = await this.enrichFollowups([followup])
      this.setData({ detailFollowup: enriched[0], detailVisible: true })
    } catch (err) {
      console.error('加载详情失败:', err)
    }
  },

  onFollowupTap(e) {
    this.loadDetail(e.currentTarget.dataset.id)
  },

  onCloseDetail() {
    this.setData({ detailVisible: false, detailFollowup: null })
  },

  // 确认已复查
  onConfirmCompleted() {
    wx.showModal({
      title: '确认已复查',
      content: '确认已带孩子完成复查？确认后此随访将标记为已完成。',
      success: async (res) => {
        if (res.confirm) {
          this.setData({ completing: true })
          try {
            await api.updateFollowup(this.data.detailFollowup._id, 'complete', null)
            wx.showToast({ title: '已确认完成', icon: 'success' })
            this.setData({ detailVisible: false, detailFollowup: null })
            // 重新加载列表
            this.setData({ page: 0, followups: [], hasMore: true })
            this.loadFollowups()
          } catch (err) {
            console.error('确认失败:', err)
          } finally {
            this.setData({ completing: false })
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
  },

  // 订阅随访提醒
  async onTapSubscribe() {
    await subscribe.subscribeFollowupReminder()
    this.setData({ showSubscribeBanner: false })
  },

  // 关闭订阅横幅
  onCloseSubscribeBanner() {
    this.setData({ showSubscribeBanner: false })
  }
})
