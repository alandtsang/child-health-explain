const api = require('../../utils/api')
const auth = require('../../utils/auth')
const { ROLES } = require('../../utils/constants')

Page({
  data: { loading: false },

  onLoad() { this.initLogin() },

  async initLogin() {
    this.setData({ loading: true })
    try {
      const data = await api.login()
      auth.saveUserInfo(data.user)
      if (data.currentRole) {
        auth.saveCurrentRole(data.currentRole)
        setTimeout(() => auth.redirectToHomeByRole(data.currentRole), 300)
        return
      }
    } catch (err) { console.error('登录失败:', err) }
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
