// miniprogram/app.js
App({
  globalData: {
    userInfo: null,
    openid: null,
    currentRole: null,
    cloudEnv: 'REPLACE_WITH_YOUR_ENV_ID'
  },

  onLaunch() {
    if (!wx.cloud) {
      console.error('请使用 2.2.3 或以上的基础库以使用云能力')
      return
    }
    wx.cloud.init({ env: this.globalData.cloudEnv, traceUser: true })
    this.restoreSession()
  },

  restoreSession() {
    const cachedRole = wx.getStorageSync('currentRole')
    const cachedUserInfo = wx.getStorageSync('userInfo')
    if (cachedRole) this.globalData.currentRole = cachedRole
    if (cachedUserInfo) {
      this.globalData.userInfo = cachedUserInfo
      this.globalData.openid = cachedUserInfo.openid
    }
  },

  setCurrentRole(role) {
    this.globalData.currentRole = role
    wx.setStorageSync('currentRole', role)
  },

  setUserInfo(userInfo) {
    this.globalData.userInfo = userInfo
    this.globalData.openid = userInfo.openid
    wx.setStorageSync('userInfo', userInfo)
  },

  clearSession() {
    this.globalData.userInfo = null
    this.globalData.openid = null
    this.globalData.currentRole = null
    wx.removeStorageSync('userInfo')
    wx.removeStorageSync('currentRole')
  }
})
