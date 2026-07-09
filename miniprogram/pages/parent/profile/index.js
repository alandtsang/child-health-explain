// miniprogram/pages/parent/profile/index.js
const auth = require('../../../utils/auth')
const api = require('../../../utils/api')
const { ROLES } = require('../../../utils/constants')

const db = wx.cloud.database()

Page({
  data: {
    userInfo: null,
    children: [],
    hasDoctorRole: false,
    loading: false
  },

  onShow() {
    if (!auth.isParent()) return
    const userInfo = auth.getUserInfo()
    this.setData({
      userInfo,
      hasDoctorRole: userInfo && userInfo.roles && userInfo.roles.includes(ROLES.DOCTOR)
    })
    this.loadChildren()
  },

  async loadChildren() {
    const openid = auth.getOpenid()
    try {
      const res = await db.collection('children')
        .where({ bound_parent_ids: openid })
        .orderBy('created_at', 'desc')
        .get()
      this.setData({ children: res.data })
    } catch (err) {
      console.error('加载儿童列表失败:', err)
    }
  },

  // 手机号绑定
  async onGetPhoneNumber(e) {
    if (e.detail.errMsg !== 'getPhoneNumber:ok') return
    this.setData({ loading: true })
    try {
      // 调用云函数解密手机号并绑定
      const res = await wx.cloud.callFunction({
        name: 'login',
        data: { action: 'bindPhone', cloud_id: e.detail.cloudID }
      })
      if (res.result && res.result.success) {
        const userInfo = auth.getUserInfo()
        if (userInfo && userInfo.parent_info) {
          userInfo.parent_info.phone = res.result.data.phone
        }
        auth.saveUserInfo(userInfo)
        this.setData({ userInfo })
        wx.showToast({ title: '手机号已绑定', icon: 'success' })
      }
    } catch (err) {
      console.error('手机号绑定失败:', err)
      wx.showToast({ title: '绑定失败', icon: 'none' })
    } finally {
      this.setData({ loading: false })
    }
  },

  // 编辑儿童档案
  onEditChild(e) {
    const childId = e.currentTarget.dataset.id
    wx.navigateTo({ url: `/pages/child-edit/child-edit?id=${childId}` })
  },

  // 新建儿童档案
  onAddChild() {
    wx.navigateTo({ url: '/pages/child-edit/child-edit' })
  },

  // 输入邀请码绑定已有档案
  onBindByCode() {
    console.log('[profile] onBindByCode triggered')
    wx.navigateTo({
      url: '/pages/parent/bind-confirm/index',
      fail: (err) => {
        console.error('[profile] navigateTo bind-confirm failed:', err)
        wx.showToast({ title: '页面跳转失败，请重试', icon: 'none' })
      }
    })
  },

  // 切换到医生身份
  async onSwitchToDoctor() {
    if (!this.data.hasDoctorRole) {
      wx.showModal({
        title: '提示',
        content: '您尚未开通医生身份。医生身份需要资质认证，是否前往认证？',
        confirmText: '去认证',
        success: (res) => {
          if (res.confirm) {
            wx.reLaunch({ url: '/pages/role-select/role-select' })
          }
        }
      })
      return
    }
    try {
      const data = await api.switchRole(ROLES.DOCTOR)
      auth.saveUserInfo(data.user)
      auth.saveCurrentRole(ROLES.DOCTOR)
      wx.reLaunch({ url: '/pages/doctor/home/index' })
    } catch (err) { /* error handled */ }
  },

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
