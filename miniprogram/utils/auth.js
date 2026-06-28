// miniprogram/utils/auth.js
const { ROLES } = require('./constants')
const app = getApp()

function getUserInfo() { return app.globalData.userInfo }
function getOpenid() { return app.globalData.openid }
function getCurrentRole() { return app.globalData.currentRole }
function isDoctor() { return getCurrentRole() === ROLES.DOCTOR }
function isParent() { return getCurrentRole() === ROLES.PARENT }

function saveUserInfo(userInfo) { app.setUserInfo(userInfo) }
function saveCurrentRole(role) { app.setCurrentRole(role) }

function requireRole(role) {
  if (getCurrentRole() !== role) {
    wx.showModal({ title: '提示', content: '请先切换到对应身份', showCancel: false })
    return false
  }
  return true
}

function redirectToHomeByRole(role) {
  const url = role === ROLES.DOCTOR ? '/pages/doctor/home/index' : '/pages/parent/home/index'
  wx.reLaunch({ url })
}

function switchToRole(role) {
  saveCurrentRole(role)
  redirectToHomeByRole(role)
}

function clearSession() { app.clearSession() }

module.exports = { getUserInfo, getOpenid, getCurrentRole, isDoctor, isParent, saveUserInfo, saveCurrentRole, requireRole, redirectToHomeByRole, switchToRole, clearSession }
