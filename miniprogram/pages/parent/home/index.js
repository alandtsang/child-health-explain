// miniprogram/pages/parent/home/index.js
const auth = require('../../../utils/auth')
const api = require('../../../utils/api')
const format = require('../../../utils/format')
const subscribe = require('../../../utils/subscribe')

const db = wx.cloud.database()

Page({
  data: {
    parentInfo: null,
    children: [],
    currentChild: null,
    recentReports: [],
    pendingFollowups: [],
    loading: true,
    showChildPicker: false,
    // 订阅引导横幅
    showSubscribeBanner: false
  },

  onLoad() {
    if (!auth.requireRole('parent')) return
  },

  onShow() {
    if (!auth.isParent()) return
    const userInfo = auth.getUserInfo()
    this.setData({ parentInfo: userInfo ? userInfo.parent_info : null })
    this.loadChildren()
    this.checkSubscribeStatus()
  },

  // 检查是否需要引导订阅消息
  checkSubscribeStatus() {
    // report_push 或 followup_remind 任一在冷却期内则不显示横幅
    const needReport = !subscribe.isInCooldown('report_push')
    const needFollowup = !subscribe.isInCooldown('followup_remind')
    if (needReport || needFollowup) {
      this.setData({ showSubscribeBanner: true })
    } else {
      this.setData({ showSubscribeBanner: false })
    }
  },

  // 点击订阅引导横幅
  async onTapSubscribe() {
    await subscribe.subscribeParentNotifications()
    this.setData({ showSubscribeBanner: false })
  },

  // 关闭订阅横幅
  onCloseSubscribeBanner() {
    this.setData({ showSubscribeBanner: false })
  },

  // 加载绑定的儿童档案
  async loadChildren() {
    const openid = auth.getOpenid()
    try {
      const res = await db.collection('children')
        .where({ bound_parent_ids: openid })
        .orderBy('created_at', 'desc')
        .get()

      const children = res.data
      let currentChild = this.data.currentChild
      if (!currentChild && children.length > 0) {
        currentChild = children[0]
      }
      this.setData({ children, currentChild })
      if (currentChild) {
        this.loadHomeData(currentChild._id)
      } else {
        this.setData({ loading: false })
      }
    } catch (err) {
      console.error('加载儿童列表失败:', err)
      this.setData({ loading: false })
    }
  },

  // 加载首页数据：报告 + 随访
  async loadHomeData(childId) {
    this.setData({ loading: true })
    try {
      const openid = auth.getOpenid()

      const [reportsRes, followupsData] = await Promise.all([
        // 查询推送给我且关联该儿童的报告
        db.collection('reports')
          .where({ pushed_to: openid_includes(openid), review_status: 'approved' })
          .orderBy('pushed_at', 'desc')
          .limit(5)
          .get(),
        // 查询该儿童的待办随访（followups read:false，改走云函数）
        api.listFollowupsByChildren([childId], ['scheduled', 'reminded'], 0, 100)
      ])

      // 过滤并丰富报告数据
      const reportExamIds = reportsRes.data.map(r => r.exam_id)
      const exams = reportExamIds.length > 0
        ? await api.getExamsByIds(reportExamIds, childId)
        : []
      const examMap = {}
      exams.forEach(e => { examMap[e._id] = e })

      const recentReports = reportsRes.data
        .filter(r => examMap[r.exam_id])
        .map(r => {
          const content = r.doctor_content || r.ai_content || {}
          return {
            _id: r._id,
            exam_id: r.exam_id,
            exam_date: format.formatDate(examMap[r.exam_id].exam_date),
            summary: content.summary || '',
            has_new: !r.viewed_at || (new Date(r.pushed_at) > new Date(r.viewed_at))
          }
        })

      // 计算随访剩余天数
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      const pendingFollowups = followupsData.map(f => {
        const planDate = new Date(f.plan_date)
        const diffDays = Math.round((planDate - today) / 86400000)
        return {
          _id: f._id,
          plan_date: f.plan_date,
          trigger_items: f.trigger_items || [],
          days_left: diffDays
        }
      })

      this.setData({ recentReports, pendingFollowups, loading: false })
    } catch (err) {
      console.error('加载首页数据失败:', err)
      this.setData({ loading: false })
    }
  },

  // 显示儿童选择（始终可弹窗，确保家长随时能绑定新邀请码或新建档案）
  onShowChildPicker() {
    this.setData({ showChildPicker: true })
  },

  onSelectChild(e) {
    const child = e.currentTarget.dataset.child
    this.setData({ currentChild: child, showChildPicker: false })
    this.loadHomeData(child._id)
  },

  onCloseChildPicker() {
    this.setData({ showChildPicker: false })
  },

  // 新建儿童档案
  onAddChild() {
    wx.navigateTo({ url: '/pages/child-edit/child-edit' })
  },

  // 输入邀请码绑定已有档案
  onBindByCode() {
    this.setData({ showChildPicker: false })
    wx.navigateTo({ url: '/pages/parent/bind-confirm/index' })
  },

  // 快捷入口
  onSelfCheck() {
    wx.navigateTo({ url: '/pages/parent/self-check/index' })
  },

  onReportList() {
    wx.navigateTo({ url: '/pages/parent/report-list/index' })
  },

  onFollowup() {
    wx.navigateTo({ url: '/pages/parent/followup/index' })
  },

  onReportTap(e) {
    const reportId = e.currentTarget.dataset.id
    wx.navigateTo({ url: `/pages/parent/report-detail/index?report_id=${reportId}` })
  },

  onFollowupTap(e) {
    const followupId = e.currentTarget.dataset.id
    wx.navigateTo({ url: `/pages/parent/followup/index?id=${followupId}` })
  },

  onProfile() {
    wx.navigateTo({ url: '/pages/parent/profile/index' })
  },

  onPullDownRefresh() {
    if (this.data.currentChild) {
      this.loadHomeData(this.data.currentChild._id)
    }
    wx.stopPullDownRefresh()
  }
})

// 辅助函数：构建 openid 包含查询
function openid_includes(openid) {
  return db.command.in([openid])
}
