const api = require('../../utils/api')
const auth = require('../../utils/auth')
const { ROLES } = require('../../utils/constants')

Page({
  data: {
    loading: false,
    lastRole: null,        // 返回用户的上次角色，用于显示"快速继续"
    userName: ''           // 医生则显示姓名，家长则空
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

  async onSelectDoctor() { await this.handleSelectRole(ROLES.DOCTOR) },
  async onSelectParent() { await this.handleSelectRole(ROLES.PARENT) },

  async handleSelectRole(role) {
    this.setData({ loading: true })
    try {
      const data = await api.selectRole(role)
      auth.saveUserInfo(data.user)
      auth.saveCurrentRole(data.currentRole)
      wx.showToast({ title: role === ROLES.DOCTOR ? '医生身份已激活' : '欢迎使用', icon: 'success', duration: 1500 })
      setTimeout(() => auth.redirectToHomeByRole(data.currentRole), 1500)
    } catch (err) { console.error('选择角色失败:', err) }
    finally { this.setData({ loading: false }) }
  }
})
