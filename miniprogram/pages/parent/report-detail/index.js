// miniprogram/pages/parent/report-detail/index.js
const auth = require('../../../utils/auth')
const api = require('../../../utils/api')
const format = require('../../../utils/format')
const { ABNORMAL_LEVEL_INFO } = require('../../../utils/constants')
const subscribe = require('../../../utils/subscribe')
const { isChildAccessibleToParent } = require('../../../utils/db')

const db = wx.cloud.database()
const _ = db.command

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
    generatingVideo: false,
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
      const res = await db.collection('reports').doc(this.data.reportId).get()
      const report = res.data
      if (!report) {
        wx.showToast({ title: '报告不存在', icon: 'none' })
        return
      }

      // 查询体检+儿童
      const examRes = await db.collection('exams').doc(report.exam_id).get()
      const exam = examRes.data
      let child = null
      if (exam) {
        const childRes = await db.collection('children').doc(exam.child_id).get()
        child = childRes.data
      }

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

      // 权限校验通过后再标记已查看
      if (!report.viewed_at) {
        db.collection('reports').doc(this.data.reportId).update({ data: { viewed_at: db.serverDate() } })
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
      const res = await db.collection('media_assets')
        .where({ report_id: reportId, status: 'done' })
        .get()
      const poster = res.data.find(m => m.type === 'poster')
      const video = res.data.find(m => m.type === 'video')
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

  // 生成视频（仅医生推送报告）
  async onGenerateVideo() {
    this.setData({ generatingVideo: true })
    try {
      await api.videoCreate(this.data.reportId)
      wx.showToast({ title: '视频生成中，完成后通知您', icon: 'none', duration: 3000 })
    } catch (err) {
      console.error('视频生成失败:', err)
    } finally {
      this.setData({ generatingVideo: false })
    }
  },

  // 播放视频（直接展示视频组件，无需跳转）
  onPlayVideo() {
    if (this.data.video && this.data.video.file_id) {
      this.setData({ videoVisible: true })
    }
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
