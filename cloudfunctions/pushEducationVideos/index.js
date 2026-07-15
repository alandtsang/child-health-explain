/**
 * cloudfunctions/pushEducationVideos/index.js
 * 按异常类别匹配科普视频库并推送给家长
 *
 * 输入: { report_id }
 * 流程:
 *   1. 查询 report → 校验已审核 + 获取 exam_id + pushed_to
 *   2. 查询 exam → 获取 abnormal_items
 *   3. 按 category 去重，得到异常类别列表
 *   4. 查询 video_library 匹配 active 视频
 *   5. 对每个匹配视频: 创建 media_assets + 发送 video_done 通知
 *   6. 返回 { pushed_count, skipped_categories, errors }
 *
 * 注意: 本函数为内部云函数，仅由 reviewReport（医生端推送）和
 * claimChild（家长绑定后补发）调用，不直接暴露给客户端。
 * 调用方身份由上游函数保障，此处不再重复校验医生权限。
 */

const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

exports.main = async (event, context) => {
  const { report_id } = event

  if (!report_id) {
    return { code: 400, message: '缺少 report_id' }
  }

  try {
    // 1. 查询报告
    const reportRes = await db.collection('reports').doc(report_id).get()
    const report = reportRes.data
    if (!report) {
      return { code: 404, message: '报告不存在' }
    }
    if (report.review_status !== 'approved') {
      return { code: 400, message: '报告未审核通过，不可推送科普视频' }
    }

    // pushed_to 可能在 report 上，也可能需要从 child 获取
    let pushedTo = Array.isArray(report.pushed_to) ? report.pushed_to : []
    if (pushedTo.length === 0) {
      return { code: 400, message: '该报告尚无推送目标家长' }
    }

    // 2. 查询体检记录获取异常项
    const examRes = await db.collection('exams').doc(report.exam_id).get()
    const exam = examRes.data
    if (!exam) {
      return { code: 404, message: '体检记录不存在' }
    }

    const abnormalItems = exam.abnormal_items || []
    if (abnormalItems.length === 0) {
      return { code: 0, message: '无异常项，跳过视频推送', data: { pushed_count: 0, skipped_categories: [], errors: [] } }
    }

    // 3. 按 category 去重，仅保留非 normal 的异常类别
    const categorySet = new Set()
    for (const item of abnormalItems) {
      if (item.level !== 'normal' && item.category) {
        categorySet.add(item.category)
      }
    }
    const categories = Array.from(categorySet)

    if (categories.length === 0) {
      return { code: 0, message: '无异常类别，跳过视频推送', data: { pushed_count: 0, skipped_categories: [], errors: [] } }
    }

    // 4. 查询 video_library 匹配 active 视频
    const videoRes = await db.collection('video_library')
      .where({ category: _.in(categories), status: 'active' })
      .get()

    const matchedVideos = videoRes.data
    const matchedCategories = matchedVideos.map(v => v.category)
    const skippedCategories = categories.filter(c => !matchedCategories.includes(c))

    if (matchedVideos.length === 0) {
      console.log('[pushEducationVideos] 无匹配视频，categories:', categories)
      return {
        code: 0,
        message: '无匹配的科普视频',
        data: { pushed_count: 0, skipped_categories: skippedCategories, errors: [] }
      }
    }

    // 5. 对每个匹配视频: 创建 media_assets + 发送通知
    const errors = []
    let pushedCount = 0

    for (const video of matchedVideos) {
      try {
        // 幂等检查: 同 report_id + category 已存在 media_assets 则跳过
        const existing = await db.collection('media_assets')
          .where({ report_id, category: video.category, source: 'library' })
          .limit(1)
          .get()

        if (existing.data.length > 0) {
          console.log('[pushEducationVideos] 已存在推送记录，跳过:', report_id, video.category)
          continue
        }

        // 创建 media_assets 记录
        const mediaRes = await db.collection('media_assets').add({
          data: {
            report_id,
            self_check_id: null,
            source: 'library',
            type: 'video',
            status: 'done',
            file_id: video.file_id,
            thumbnail_file_id: video.thumbnail_file_id || null,
            library_video_id: video._id,
            category: video.category,
            title: video.title || null,
            category_label: video.category_label || null,
            duration: video.duration || null,
            description: video.description || null,
            pushed_to: pushedTo,
            prompt: null,
            generation_meta: null,
            ark_task_id: null,
            retries: 0,
            created_at: db.serverDate(),
            completed_at: db.serverDate()
          }
        })

        // 向每个家长发送 video_done 通知
        const videoTitle = video.title || video.category_label || '科普视频'
        for (const parentOpenid of pushedTo) {
          try {
            const res = await cloud.callFunction({
              name: 'sendNotification',
              data: {
                target_openid: parentOpenid,
                type: 'video_done',
                title: '科普视频已推送',
                content: `${videoTitle}已为您推送，点击查看`,
                related_id: mediaRes._id,
                template_data: {
                  thing1: { value: videoTitle },
                  thing2: { value: '点击查看详情' }
                },
                sms_allowed: false
              }
            })
            if (!res.result || res.result.code !== 0) {
              console.warn('[pushEducationVideos] 通知发送失败:', parentOpenid, res.result)
            }
          } catch (notifErr) {
            console.error('[pushEducationVideos] 通知异常:', parentOpenid, notifErr.message)
            // 通知失败不中断流程
          }
        }

        pushedCount++
      } catch (err) {
        console.error('[pushEducationVideos] 视频推送失败:', video.category, err.message)
        errors.push({ category: video.category, error: err.message })
      }
    }

    return {
      code: 0,
      message: `科普视频推送完成: ${pushedCount} 个视频`,
      data: {
        pushed_count: pushedCount,
        skipped_categories: skippedCategories,
        errors: errors
      }
    }
  } catch (err) {
    console.error('[pushEducationVideos] error:', err)
    const msg = (err && (err.errMsg || err.message)) || ''
    if (/collection.*(not.*exist|不存在)|-502003/i.test(msg)) {
      return { code: 503, message: '数据库集合未初始化' }
    }
    return { code: 500, message: err.message || '推送科普视频失败' }
  }
}
