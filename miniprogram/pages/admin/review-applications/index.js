// miniprogram/pages/admin/review-applications/index.js
const api = require('../../../utils/api')
const format = require('../../../utils/format')

const TABS = [
  { key: 'pending', label: '待审核' },
  { key: 'approved', label: '已通过' },
  { key: 'rejected', label: '已驳回' }
]

const PAGE_SIZE = 20

Page({
  data: {
    tabs: TABS,
    activeTab: 'pending',
    applications: [],
    loading: true,
    loadingMore: false,
    page: 0,
    pageSize: PAGE_SIZE,
    hasMore: true,
    // 驳回弹窗
    rejectVisible: false,
    rejectApplicationId: '',
    rejectNote: '',
    submitting: false
  },

  onLoad() {
    this.loadApplications()
  },

  // 切换 Tab
  onSwitchTab(e) {
    const key = e.currentTarget.dataset.key
    if (key === this.data.activeTab) return
    this.setData({
      activeTab: key,
      page: 0,
      applications: [],
      hasMore: true,
      loading: true
    })
    this.loadApplications()
  },

  // 加载申请列表
  async loadApplications() {
    if (this.data.loadingMore) return
    const currentPage = this.data.page
    this.setData({ loadingMore: currentPage > 0 })

    try {
      const res = await api.listDoctorApplications(this.data.activeTab, currentPage, this.data.pageSize)
      const list = (res.list || []).map(item => ({
        ...item,
        created_at_fmt: format.formatDateTime(item.created_at),
        cert_photos: item.cert_photos || []
      }))
      const hasMore = list.length === this.data.pageSize

      this.setData({
        applications: currentPage === 0 ? list : this.data.applications.concat(list),
        page: currentPage + 1,
        hasMore,
        loading: false,
        loadingMore: false
      })
    } catch (err) {
      console.error('加载申请列表失败:', err)
      this.setData({ loading: false, loadingMore: false })
    }
  },

  // 预览证书照片
  onPreviewPhoto(e) {
    const { urls, current } = e.currentTarget.dataset
    wx.previewImage({
      current: current,
      urls: urls,
      fail(err) {
        console.error('预览图片失败:', err)
        wx.showToast({ title: '预览失败', icon: 'none' })
      }
    })
  },

  // 通过审核
  onApprove(e) {
    if (this.data.submitting) return
    const applicationId = e.currentTarget.dataset.id
    wx.showModal({
      title: '确认通过',
      content: '确认通过该医生的认证申请？',
      success: async (res) => {
        if (!res.confirm) return
        this.setData({ submitting: true })
        try {
          await api.reviewDoctorApplication(applicationId, 'approve', '')
          wx.showToast({ title: '已通过', icon: 'success' })
          this.refreshList()
        } catch (err) {
          console.error('通过审核失败:', err)
        } finally {
          this.setData({ submitting: false })
        }
      }
    })
  },

  // 驳回审核 - 打开弹窗输入原因
  onReject(e) {
    if (this.data.submitting) return
    const applicationId = e.currentTarget.dataset.id
    this.setData({
      rejectVisible: true,
      rejectApplicationId: applicationId,
      rejectNote: ''
    })
  },

  onRejectNoteInput(e) {
    this.setData({ rejectNote: e.detail.value })
  },

  // 点击遮罩层关闭弹窗（仅点击遮罩本身时触发，避免 textarea 原生组件冒泡问题）
  onOverlayTap(e) {
    if (e.target.dataset.role === 'overlay') {
      this.onCancelReject()
    }
  },

  // 空函数，用于 catchtap 阻止冒泡
  noop() {},

  onCancelReject() {
    this.setData({
      rejectVisible: false,
      rejectApplicationId: '',
      rejectNote: ''
    })
  },

  // 确认驳回
  async onConfirmReject() {
    const { rejectApplicationId, rejectNote, submitting } = this.data
    if (submitting) return
    if (!rejectNote.trim()) {
      wx.showToast({ title: '请输入驳回原因', icon: 'none' })
      return
    }
    this.setData({ submitting: true })
    try {
      await api.reviewDoctorApplication(rejectApplicationId, 'reject', rejectNote.trim())
      wx.showToast({ title: '已驳回', icon: 'success' })
      this.setData({
        rejectVisible: false,
        rejectApplicationId: '',
        rejectNote: ''
      })
      this.refreshList()
    } catch (err) {
      console.error('驳回审核失败:', err)
    } finally {
      this.setData({ submitting: false })
    }
  },

  // 审核操作后刷新当前列表
  refreshList() {
    this.setData({
      page: 0,
      applications: [],
      hasMore: true,
      loading: true
    })
    this.loadApplications()
  },

  onPullDownRefresh() {
    this.refreshList()
    wx.stopPullDownRefresh()
  },

  onReachBottom() {
    if (this.data.hasMore && !this.data.loadingMore) {
      this.loadApplications()
    }
  }
})
