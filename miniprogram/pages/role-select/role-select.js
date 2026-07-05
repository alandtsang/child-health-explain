const api = require('../../utils/api')
const auth = require('../../utils/auth')
const { ROLES } = require('../../utils/constants')

Page({
  data: {
    loading: false,
    lastRole: null,        // 返回用户的上次角色，用于显示"快速继续"
    userName: '',          // 医生则显示姓名，家长则空
    isAdmin: false         // 是否为管理员（用于显示审核入口）
  },

  onLoad() { this.initLogin() },

  async initLogin() {
    this.setData({ loading: true })
    try {
      const data = await api.login()
      auth.saveUserInfo(data.user)
      // 不自动跳转，始终展示选择页；记录上次角色供"快速继续"使用
      if (data.currentRole) {
        this.setData({
          lastRole: data.currentRole,
          userName: data.currentRole === ROLES.DOCTOR && data.user.doctor_info
            ? data.user.doctor_info.name : ''
        })
      }
      // 记录管理员标识
      this.setData({ isAdmin: !!data.isAdmin })
    } catch (err) { console.error('登录失败:', err) }
    finally { this.setData({ loading: false }) }
  },

  // 返回用户快速继续（已有角色，无需重新走 selectRole 白名单校验）
  async onQuickContinue() {
    const role = this.data.lastRole
    if (!role) return
    this.setData({ loading: true })
    try {
      const data = await api.switchRole(role)
      auth.saveUserInfo(data.user)
      auth.saveCurrentRole(data.currentRole)
      auth.redirectToHomeByRole(data.currentRole)
    } catch (err) { console.error('快速继续失败:', err) }
    finally { this.setData({ loading: false }) }
  },

  async onSelectDoctor() { await this.handleSelectDoctor() },
  async onSelectParent() { await this.handleSelectRole(ROLES.PARENT) },

  // 管理员入口：跳转到医生认证审核页
  onAdminReview() {
    wx.navigateTo({ url: '/pages/admin/review-applications/index' })
  },

  // 医生角色选择：未在白名单时根据认证申请状态决定跳转
  async handleSelectDoctor() {
    this.setData({ loading: true })
    try {
      // showError:false 抑制默认错误 toast，由本函数自行处理跳转逻辑
      const data = await api.callFunction('login', { action: 'selectRole', role: 'doctor' }, { loadingText: '处理中...', showError: false })
      auth.saveUserInfo(data.user)
      auth.saveCurrentRole(data.currentRole)
      wx.showToast({ title: '医生身份已激活', icon: 'success', duration: 1500 })
      setTimeout(() => auth.redirectToHomeByRole(data.currentRole), 1500)
    } catch (err) {
      // selectRole 失败：查询认证申请状态，决定跳转目标
      try {
        const certData = await api.getDoctorCertStatus()
        if (certData.status === 'pending') {
          wx.showModal({ title: '审核中', content: '您的认证申请正在审核中，请耐心等待管理员处理', showCancel: false })
        } else if (certData.status === 'whitelisted') {
          // 极端情况：白名单已存在但 selectRole 仍失败（可能是并发），提示重试
          wx.showToast({ title: '请重试', icon: 'none' })
        } else {
          // none 或 rejected → 跳转到认证申请页
          wx.navigateTo({ url: '/pages/doctor/cert-apply/index' })
        }
      } catch (certErr) {
        // 查询状态也失败，降级提示
        wx.showToast({ title: '操作失败，请重试', icon: 'none' })
      }
    } finally { this.setData({ loading: false }) }
  },

  async handleSelectRole(role) {
    this.setData({ loading: true })
    try {
      const data = await api.selectRole(role)
      auth.saveUserInfo(data.user)
      auth.saveCurrentRole(data.currentRole)
      wx.showToast({ title: '欢迎使用', icon: 'success', duration: 1500 })
      setTimeout(() => auth.redirectToHomeByRole(data.currentRole), 1500)
    } catch (err) { console.error('选择角色失败:', err) }
    finally { this.setData({ loading: false }) }
  }
})
