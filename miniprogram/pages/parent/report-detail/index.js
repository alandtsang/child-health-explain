// miniprogram/pages/parent/report-detail/index.js
const auth = require('../../../utils/auth')
const api = require('../../../utils/api')
const format = require('../../../utils/format')
const { ABNORMAL_LEVEL_INFO } = require('../../../utils/constants')
const subscribe = require('../../../utils/subscribe')
const { isChildAccessibleToParent } = require('../../../utils/db')

const db = wx.cloud.database()

Page({
  data: {
    reportId: '',
    report: null,
    exam: null,
    child: null,
    content: null,
    poster: null,
    video: null,
    loading: true,
    posterVisible: false,
    generatingPoster: false,
    // 订阅引导（有异常项时显示，引导订阅随访提醒）
    showSubscribeTip: false
  },

  onLoad(options) {
    if (!auth.requireRole('parent')) return
    this.setData({ reportId: options.report_id })
    this.loadReport()
  },

  async loadReport() {
    try {
      const openid = auth.getOpenid()
      // reports 安全规则：doc(id).get() 不满足子集要求，改用 where + pushed_to 查询
      // pushed_to 是数组，需用 db.command.in 查询以满足 auth.openid in doc.pushed_to 子集要求
      const res = await db.collection('reports')
        .where({ _id: this.data.reportId, pushed_to: db.command.in([openid]) })
        .get()
      const report = res.data[0]
      if (!report) {
        wx.showToast({ title: '报告不存在', icon: 'none' })
        return
      }

      // 查询体检+儿童（exams read:false，改走云函数，同时返回 child）
      const examDetail = await api.getExamDetail(report.exam_id)
      const exam = examDetail.exam
      const child = examDetail.child

      // 权限校验：仅允许查看自己绑定/创建儿童的报告，避免家长查看他人孩子的体检数据
      if (!isChildAccessibleToParent(child, auth.getOpenid())) {
        this.setData({ loading: false })
        wx.showModal({
          title: '无权查看',
          content: '该报告关联的儿童不是您绑定的孩子，无法查看',
          showCancel: false,
          success: () => wx.navigateBack()
        })
        return
      }

      // 权限校验通过后再标记已查看（reports write 限医生，家长改走云函数）
      if (!report.viewed_at) {
        api.markReportViewed(this.data.reportId)
      }

      const content = report.doctor_content || report.ai_content || {}
      exam.abnormal_items_fmt = (exam.abnormal_items || []).map(a => ({
        ...a,
        level_info: ABNORMAL_LEVEL_INFO[a.level] || ABNORMAL_LEVEL_INFO.normal
      }))

      // 有异常项且未在冷却期内 → 显示随访提醒订阅引导
      const hasAbnormal = (exam.abnormal_items || []).some(a => a.level !== 'normal')
      const needSubscribe = hasAbnormal && !subscribe.isInCooldown('followup_remind')

      this.setData({
        report, exam, child, content,
        showSubscribeTip: needSubscribe,
        loading: false
      })

      // 加载海报和视频
      this.loadMedia(this.data.reportId)
    } catch (err) {
      console.error('加载报告失败:', err)
      this.setData({ loading: false })
      wx.showToast({ title: '加载失败', icon: 'none' })
    }
  },

  // 加载关联的海报和视频
  async loadMedia(reportId) {
    try {
      // media_assets read:false，改走云函数
      const assets = await api.listMediaByReport(reportId, null, 'done')
      const poster = assets.find(m => m.type === 'poster')
      const video = assets.find(m => m.type === 'video')
      this.setData({ poster: poster || null, video: video || null })
    } catch (err) {
      console.error('加载媒体失败:', err)
    }
  },

  // 生成海报
  async onGeneratePoster() {
    this.setData({ generatingPoster: true })
    try {
      const data = await api.genPoster('doctor', { report_id: this.data.reportId })
      const poster = { _id: data.media_id, file_id: data.file_id, type: 'poster' }
      this.setData({ poster, posterVisible: true })
      wx.showToast({ title: '海报已生成', icon: 'success' })
    } catch (err) {
      console.error('生成海报失败:', err)
    } finally {
      this.setData({ generatingPoster: false })
    }
  },

  // 查看海报
  onViewPoster() {
    if (this.data.poster) {
      this.setData({ posterVisible: true })
    }
  },

  onPosterClose() {
    this.setData({ posterVisible: false })
  },

  // 订阅随访提醒
  async onTapSubscribeFollowup() {
    await subscribe.subscribeFollowupReminder()
    this.setData({ showSubscribeTip: false })
  },

  // 关闭订阅提示
  onCloseSubscribeTip() {
    this.setData({ showSubscribeTip: false })
  },

  onShareAppMessage() {
    return {
      title: `${this.data.child ? this.data.child.name : '孩子'}的体检报告`,
      path: `/pages/parent/report-detail/index?report_id=${this.data.reportId}`,
      imageUrl: this.data.poster ? this.data.poster.file_id : ''
    }
  }
})
