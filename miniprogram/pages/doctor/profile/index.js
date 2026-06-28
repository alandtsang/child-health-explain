// miniprogram/pages/doctor/profile/index.js
const auth = require('../../../utils/auth')
const api = require('../../../utils/api')
const { ROLES } = require('../../../utils/constants')

Page({
  data: {
    userInfo: null,
    doctorInfo: null,
    hasParentRole: false
  },

  onShow() {
    if (!auth.isDoctor()) return
    const userInfo = auth.getUserInfo()
    this.setData({
      userInfo,
      doctorInfo: userInfo ? userInfo.doctor_info : null,
      hasParentRole: userInfo && userInfo.roles && userInfo.roles.includes(ROLES.PARENT)
    })
  },

  // 切换到家长身份
  async onSwitchToParent() {
    if (!this.data.hasParentRole) {
      wx.showModal({
        title: '提示',
        content: '您尚未开通家长身份，是否现在开通？',
        success: async (res) => {
          if (res.confirm) {
            try {
              const data = await api.switchRole(ROLES.PARENT)
              auth.saveUserInfo(data.user)
              auth.saveCurrentRole(ROLES.PARENT)
              wx.reLaunch({ url: '/pages/parent/home/index' })
            } catch (err) { /* error handled in api */ }
          }
        }
      })
      return
    }
    try {
      const data = await api.switchRole(ROLES.PARENT)
      auth.saveUserInfo(data.user)
      auth.saveCurrentRole(ROLES.PARENT)
      wx.reLaunch({ url: '/pages/parent/home/index' })
    } catch (err) { /* error handled */ }
  },

  // 退出登录
  onLogout() {
    wx.showModal({
      title: '退出登录',
      content: '确认退出登录？',
      success: (res) => {
        if (res.confirm) {
          auth.clearSession()
          wx.reLaunch({ url: '/pages/role-select/role-select' })
        }
      }
    })
  }
})
