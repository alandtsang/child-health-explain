const auth = require('../../../utils/auth')
const api = require('../../../utils/api')

Page({
  data: {
    code: '',
    child: null,
    conflictChild: null,
    loading: true,
    binding: false,
    bindSuccess: false,
    error: '',
    showManualInput: false,
    manualCode: ''
  },

  onLoad(options) {
    if (!auth.requireRole('parent')) return
    // 扫码进入：scene 参数
    if (options.scene) {
      const code = decodeURIComponent(options.scene)
      this.setData({ code })
      this.loadInvite(code)
    } else {
      // 无 scene，展示手输入口
      this.setData({ loading: false, showManualInput: true })
    }
  },

  // 预览邀请对应的儿童摘要（只查不绑）
  async loadInvite(code) {
    this.setData({ loading: true })
    try {
      const data = await api.previewInvite(code)
      if (data.child) {
        this.setData({ child: data.child, loading: false })
      } else {
        this.setData({ loading: false, error: '未找到儿童档案' })
      }
    } catch (err) {
      const msg = (err && err.message) || '查询失败'
      this.setData({ loading: false, error: msg })
    }
  },

  // 手输邀请码提交
  async onManualSubmit() {
    const code = this.data.manualCode.trim().toUpperCase()
    if (!code) {
      wx.showToast({ title: '请输入邀请码', icon: 'none' })
      return
    }
    this.setData({ code, showManualInput: false, loading: true })
    await this.loadInvite(code)
  },

  onManualInput(e) {
    this.setData({ manualCode: e.detail.value.toUpperCase() })
  },

  // 确认是我的孩子 → 执行绑定
  async onConfirmBind() {
    this.setData({ binding: true })
    try {
      await api.claimChild(this.data.code)
      this.setData({ bindSuccess: true, binding: false })
      wx.showToast({ title: '绑定成功', icon: 'success' })
      setTimeout(() => {
        wx.reLaunch({ url: '/pages/parent/home/index' })
      }, 1500)
    } catch (err) {
      const msg = (err && err.message) || '绑定失败'
      this.setData({ binding: false, error: msg })
    }
  },

  // 仍要绑定（冲突二次确认时用）
  async onForceBind() {
    this.setData({ conflictChild: null })
    await this.onConfirmBind()
  },

  onCancel() {
    wx.navigateBack()
  }
})
