// miniprogram/utils/subscribe.js
// 订阅消息引导工具模块
//
// 微信小程序订阅消息采用「一次性订阅」模式：
// - 每次调用 wx.requestSubscribeMessage 获取用户授权后，仅可发送一条对应模板的消息
// - 用户授权后会消耗一次配额，发送后需重新订阅
// - 因此策略为：在关键操作前引导用户订阅，确保后续消息可送达
//
// 模板类型：
// - report_push:     报告推送通知（家长端订阅，医生推送时发送）
// - followup_remind: 随访到期提醒（家长端订阅，定时触发器发送）
// - video_done:      视频推送通知（家长端订阅，医生通过 pushVideo 云函数手动推送时发送）

const { SUBSCRIBE_TEMPLATES } = require('./templateConfig')

// 本地缓存 key：记录用户已拒绝订阅的模板（避免反复弹窗骚扰）
const REFUSE_CACHE_KEY = 'subscribe_refused_templates'
// 拒绝后冷却天数（在此期间不再弹窗引导）
const REFUSE_COOLDOWN_DAYS = 7

/**
 * 从本地缓存读取已拒绝的模板记录
 * @returns {Object} { templateType: timestamp(ms) }
 */
function getRefusedMap() {
  try {
    return wx.getStorageSync(REFUSE_CACHE_KEY) || {}
  } catch (e) {
    return {}
  }
}

/**
 * 记录用户拒绝了某个模板的订阅
 * @param {string} templateType - 模板类型
 */
function recordRefusal(templateType) {
  const map = getRefusedMap()
  map[templateType] = Date.now()
  try {
    wx.setStorageSync(REFUSE_CACHE_KEY, map)
  } catch (e) {
    // 缓存写入失败不影响主流程
  }
}

/**
 * 检查某模板是否在拒绝冷却期内
 * @param {string} templateType
 * @returns {boolean} true=冷却期内不应再次弹窗
 */
function isInCooldown(templateType) {
  const map = getRefusedMap()
  const refusedAt = map[templateType]
  if (!refusedAt) return false
  const daysPassed = (Date.now() - refusedAt) / (1000 * 60 * 60 * 24)
  return daysPassed < REFUSE_COOLDOWN_DAYS
}

/**
 * 清除拒绝记录（用户重新订阅成功后调用）
 * @param {string} templateType
 */
function clearRefusal(templateType) {
  const map = getRefusedMap()
  delete map[templateType]
  try {
    wx.setStorageSync(REFUSE_CACHE_KEY, map)
  } catch (e) { /* ignore */ }
}

/**
 * 请求订阅消息授权
 *
 * @param {string[]} templateTypes - 需要订阅的模板类型数组，如 ['report_push', 'followup_remind']
 * @param {Object} [options]
 * @param {boolean} [options.silent=false] - true=静默模式，不显示 toast 提示
 * @param {boolean} [options.force=false] - true=忽略冷却期强制弹窗
 * @returns {Promise<Object>} { subscribed: string[], refused: string[], skipped: string[] }
 *   - subscribed: 用户同意订阅的模板类型
 *   - refused: 用户拒绝的模板类型
 *   - skipped: 因冷却期或无 templateId 而跳过的模板类型
 */
function requestSubscribe(templateTypes, options) {
  options = options || {}

  // 过滤掉冷却期内的模板（非 force 模式）
  const toRequest = []
  const skipped = []
  for (const type of templateTypes) {
    if (!options.force && isInCooldown(type)) {
      skipped.push(type)
      continue
    }
    toRequest.push(type)
  }

  if (toRequest.length === 0) {
    return Promise.resolve({ subscribed: [], refused: [], skipped })
  }

  // 收集有效的 templateId
  const tmplIds = []
  const typeToTmplId = {}
  for (const type of toRequest) {
    const config = SUBSCRIBE_TEMPLATES[type]
    if (config && config.templateId) {
      tmplIds.push(config.templateId)
      typeToTmplId[config.templateId] = type
    } else {
      skipped.push(type)
    }
  }

  if (tmplIds.length === 0) {
    if (!options.silent) {
      wx.showToast({ title: '订阅模板未配置', icon: 'none', duration: 2000 })
    }
    return Promise.resolve({ subscribed: [], refused: [], skipped })
  }

  return new Promise((resolve) => {
    wx.requestSubscribeMessage({
      tmplIds,
      success(res) {
        const subscribed = []
        const refused = []

        for (const tmplId of tmplIds) {
          const type = typeToTmplId[tmplId]
          const status = res[tmplId]

          if (status === 'accept') {
            subscribed.push(type)
            clearRefusal(type)
          } else {
            // reject: 用户拒绝  / ban: 后台禁用 / filter: 超过3个模板自动过滤
            refused.push(type)
            recordRefusal(type)
          }
        }

        if (!options.silent) {
          if (subscribed.length > 0 && refused.length === 0) {
            wx.showToast({ title: '订阅成功', icon: 'success', duration: 1500 })
          } else if (subscribed.length > 0 && refused.length > 0) {
            wx.showToast({ title: '部分订阅成功', icon: 'none', duration: 2000 })
          } else if (refused.length > 0) {
            wx.showToast({
              title: '未订阅将无法收到消息提醒',
              icon: 'none',
              duration: 2500
            })
          }
        }

        resolve({ subscribed, refused, skipped })
      },
      fail(err) {
        // 用户关闭弹窗 / 授权页关闭 等
        if (!options.silent) {
          wx.showToast({ title: '订阅未完成', icon: 'none', duration: 2000 })
        }
        for (const type of toRequest) {
          recordRefusal(type)
        }
        resolve({ subscribed: [], refused: toRequest, skipped })
      }
    })
  })
}

/**
 * 引导家长订阅报告推送和随访提醒
 * 在家长首次进入首页、或查看报告时调用
 *
 * @param {Object} [options]
 * @param {boolean} [options.silent=false]
 * @returns {Promise<Object>} 同 requestSubscribe 返回值
 */
function subscribeParentNotifications(options) {
  return requestSubscribe(['report_push', 'followup_remind', 'video_done'], options)
}

/**
 * 引导订阅随访提醒（单独订阅）
 * 在家长查看随访列表时调用
 *
 * @param {Object} [options]
 * @returns {Promise<Object>}
 */
function subscribeFollowupReminder(options) {
  return requestSubscribe(['followup_remind'], options)
}

/**
 * 引导订阅报告推送（单独订阅）
 *
 * @param {Object} [options]
 * @returns {Promise<Object>}
 */
function subscribeReportPush(options) {
  return requestSubscribe(['report_push'], options)
}

/**
 * 引导订阅视频推送通知（单独订阅）
 * 在家长查看报告详情时调用
 *
 * @param {Object} [options]
 * @returns {Promise<Object>}
 */
function subscribeVideoDone(options) {
  return requestSubscribe(['video_done'], options)
}

module.exports = {
  requestSubscribe,
  subscribeParentNotifications,
  subscribeFollowupReminder,
  subscribeReportPush,
  subscribeVideoDone,
  isInCooldown,
  clearRefusal
}
