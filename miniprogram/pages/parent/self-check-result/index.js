// miniprogram/pages/parent/self-check-result/index.js
const auth = require('../../../utils/auth')
const api = require('../../../utils/api')
const format = require('../../../utils/format')
const { ABNORMAL_LEVEL_INFO } = require('../../../utils/constants')

const db = wx.cloud.database()

Page({
  data: {
    selfCheckId: '',
    selfCheck: null,
    child: null,
    result: null,
    poster: null,
    loading: true,
    posterVisible: false,
    generatingPoster: false
  },

  onLoad(options) {
    if (!auth.requireRole('parent')) return
    this.setData({ selfCheckId: options.self_check_id })
    this.loadData()
  },

  async loadData() {
    try {
      const res = await db.collection('self_checks').doc(this.data.selfCheckId).get()
      const selfCheck = res.data
      if (!selfCheck) {
        wx.showToast({ title: '记录不存在', icon: 'none' })
        return
      }

      // 查询儿童信息
      let child = null
      try {
        const childRes = await db.collection('children').doc(selfCheck.child_id).get()
        child = childRes.data
      } catch (e) { /* ignore */ }

      const result = selfCheck.ai_result || {}
      // 格式化异常项
      if (result.abnormal_items) {
        result.abnormal_items_fmt = result.abnormal_items.map(a => ({
          ...a,
          level_info: ABNORMAL_LEVEL_INFO[a.level] || ABNORMAL_LEVEL_INFO.normal
        }))
      }

      selfCheck.created_at_fmt = format.formatDate(selfCheck.created_at)

      this.setData({ selfCheck, child, result, loading: false })

      // 查询是否已有海报
      this.loadPoster()
    } catch (err) {
      console.error('加载自查结果失败:', err)
      this.setData({ loading: false })
      wx.showToast({ title: '加载失败', icon: 'none' })
    }
  },

  async loadPoster() {
    try {
      const res = await db.collection('media_assets')
        .where({ self_check_id: this.data.selfCheckId, type: 'poster', status: 'done' })
        .limit(1)
        .get()
      if (res.data.length > 0) {
        this.setData({ poster: res.data[0] })
      }
    } catch (err) { /* ignore */ }
  },

  async onGeneratePoster() {
    this.setData({ generatingPoster: true })
    try {
      const data = await api.genPoster('self_check', { self_check_id: this.data.selfCheckId })
      this.setData({ poster: { _id: data.media_id, file_id: data.file_id }, posterVisible: true })
      wx.showToast({ title: '海报已生成', icon: 'success' })
    } catch (err) {
      console.error('生成海报失败:', err)
    } finally {
      this.setData({ generatingPoster: false })
    }
  },

  onViewPoster() {
    if (this.data.poster) {
      this.setData({ posterVisible: true })
    }
  },

  onPosterClose() {
    this.setData({ posterVisible: false })
  },

  onBackHome() {
    wx.reLaunch({ url: '/pages/parent/home/index' })
  },

  onShareAppMessage() {
    return {
      title: '儿童健康自查结果',
      path: `/pages/parent/self-check-result/index?self_check_id=${this.data.selfCheckId}`,
      imageUrl: this.data.poster ? this.data.poster.file_id : ''
    }
  }
})
