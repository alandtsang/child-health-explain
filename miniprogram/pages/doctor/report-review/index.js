// miniprogram/pages/doctor/report-review/index.js
const auth = require('../../../utils/auth')
const api = require('../../../utils/api')
const format = require('../../../utils/format')
const { ABNORMAL_LEVEL_INFO } = require('../../../utils/constants')

const db = wx.cloud.database()

Page({
  data: {
    examId: '',
    exam: null,
    report: null,
    child: null,
    // 报告尚未生成（用于展示生成按钮）
    noReport: false,
    generating: false,
    // 编辑态的医生内容（从 ai_content 复制，可编辑）
    editContent: {
      summary: '',
      item_explanations: [],
      triage_advice: [],
      home_interventions: []
    },
    doctorNote: '',
    // AI 原始内容（用于 diff 对比）
    aiContent: null,
    // 是否有修改
    hasChanges: false,
    loading: true,
    submitting: false,
    // 海报相关
    poster: null,           // 已生成的海报 media_assets 记录
    posterVisible: false,   // 海报查看器弹窗
    generatingPoster: false,  // 海报生成中
    // 家长绑定状态
    isBound: false,          // 该儿童是否已有家长绑定
    inviteData: null,        // 邀请码 + 小程序码信息
    inviteVisible: false,    // 邀请弹窗显示
    // 底部按钮状态：review(待审核) | pending_binding(已审核待绑定) | pushed(已推送) | rejected(已驳回)
    btnState: 'review'
  },

  onLoad(options) {
    if (!auth.requireRole('doctor')) return
    this.setData({ examId: options.exam_id })
    this.loadData()
  },

  // 加载体检+报告+儿童数据
  async loadData() {
    this.setData({ loading: true })
    try {
      // 查询体检记录 + 儿童信息（通过云函数，exams read:false 后无法客户端直读）
      const detail = await api.getExamDetail(this.data.examId)
      const exam = detail.exam
      if (!exam) {
        wx.showToast({ title: '体检记录不存在', icon: 'none' })
        return
      }
      const child = detail.child

      // 格式化体检数据展示
      exam.exam_date_fmt = format.formatDate(exam.exam_date)
      if (child && child.birth_date) {
        exam.age_text = format.formatAge(child.birth_date, exam.exam_date)
      }
      // 格式化异常项
      exam.abnormal_items_fmt = (exam.abnormal_items || []).map(a => ({
        ...a,
        level_info: ABNORMAL_LEVEL_INFO[a.level] || ABNORMAL_LEVEL_INFO.normal
      }))

      // 查询关联报告（添加 reviewed_by 约束以符合 reports 安全规则）
      const openid = auth.getOpenid()
      const reportRes = await db.collection('reports')
        .where({ exam_id: this.data.examId, reviewed_by: openid })
        .orderBy('created_at', 'desc')
        .limit(1)
        .get()

      if (reportRes.data.length === 0) {
        // 报告尚未生成：展示体检信息 + 生成按钮，而非卡在加载界面
        this.setData({ exam, child, loading: false, noReport: true })
        return
      }
      const report = reportRes.data[0]

      // 取 AI 内容作为编辑基线
      const aiContent = report.ai_content || {}
      const baseContent = report.doctor_content || aiContent

      const editContent = JSON.parse(JSON.stringify({
        summary: baseContent.summary || '',
        item_explanations: baseContent.item_explanations || [],
        triage_advice: baseContent.triage_advice || [],
        home_interventions: baseContent.home_interventions || []
      }))

      // 计算底部按钮状态
      let btnState = 'review'
      if (report.review_status === 'approved') {
        btnState = report.push_status === 'pending_binding' ? 'pending_binding' : 'pushed'
      } else if (report.review_status === 'rejected') {
        btnState = 'rejected'
      }

      this.setData({
        exam,
        report,
        child,
        isBound: !!(child && Array.isArray(child.bound_parent_ids) && child.bound_parent_ids.length > 0),
        aiContent,
        editContent,
        doctorNote: (report.doctor_content || {}).doctor_note || '',
        btnState,
        loading: false
      })

      // 加载已有海报
      this.loadPoster(report._id)
    } catch (err) {
      console.error('加载报告失败:', err)
      this.setData({ loading: false })
      wx.showToast({ title: '加载失败', icon: 'none' })
    }
  },

  // 概况编辑
  onSummaryInput(e) {
    this.setData({ 'editContent.summary': e.detail.value })
    this.checkChanges()
  },

  // 指标解读编辑
  onExplanationInput(e) {
    const { index, field } = e.currentTarget.dataset
    this.setData({ [`editContent.item_explanations[${index}].${field}`]: e.detail.value })
    this.checkChanges()
  },

  // 分诊建议编辑
  onTriageInput(e) {
    const { index, field } = e.currentTarget.dataset
    this.setData({ [`editContent.triage_advice[${index}].${field}`]: e.detail.value })
    this.checkChanges()
  },

  // 家庭干预编辑
  onInterventionInput(e) {
    const { index, field } = e.currentTarget.dataset
    this.setData({ [`editContent.home_interventions[${index}].${field}`]: e.detail.value })
    this.checkChanges()
  },

  // 医生备注
  onNoteInput(e) {
    this.setData({ doctorNote: e.detail.value })
    this.checkChanges()
  },

  // 检查是否有修改（与 AI 原文对比）
  checkChanges() {
    const ai = this.data.aiContent || {}
    const edit = this.data.editContent
    let changed = false
    if (edit.summary !== (ai.summary || '')) changed = true
    if (this.data.doctorNote !== ((ai.doctor_note) || '')) changed = true
    // 简化对比：JSON 序列化对比
    if (JSON.stringify(edit.item_explanations) !== JSON.stringify(ai.item_explanations || [])) changed = true
    if (JSON.stringify(edit.triage_advice) !== JSON.stringify(ai.triage_advice || [])) changed = true
    if (JSON.stringify(edit.home_interventions) !== JSON.stringify(ai.home_interventions || [])) changed = true
    this.setData({ hasChanges: changed })
  },

  // 一键通过（不修改内容，直接审核通过）
  async onQuickApprove() {
    await this.submitReview('approve')
  },

  // 保存修改（仅保存 doctor_content，不改变状态）
  async onSaveChanges() {
    await this.submitReview('save')
  },

  // 审核通过：根据绑定状态分流
  async onApproveAndPush() {
    if (this.data.btnState === 'pending_binding') {
      // 已审核待绑定：若家长已绑定则补推，否则按钮不可点击
      if (!this.data.isBound) return
      wx.showModal({
        title: '确认推送',
        content: '家长已绑定，确认将报告推送给家长？',
        success: async (res) => {
          if (res.confirm) await this.submitReview('approveAndPush')
        }
      })
      return
    }

    if (this.data.isBound) {
      // 已绑定家长 → 直接推送
      wx.showModal({
        title: '确认推送',
        content: '审核通过后报告将推送给家长，并创建随访计划。确认操作？',
        success: async (res) => {
          if (res.confirm) await this.submitReview('approveAndPush')
        }
      })
    } else {
      // 未绑定家长 → 先审核，再邀请家长（不自动返回，保留页面展示邀请码）
      wx.showModal({
        title: '暂无绑定家长',
        content: '该儿童档案暂无家长绑定，需先邀请家长扫码绑定后才能推送报告。是否现在生成邀请？',
        confirmText: '生成邀请',
        success: async (res) => {
          if (res.confirm) {
            await this.submitReview('approve', { skipNavigateBack: true })
            this.onInviteParent()
          }
        }
      })
    }
  },

  // 邀请家长绑定（无绑定家长时）
  async onInviteParent() {
    if (!this.data.child) return
    try {
      const data = await api.createBindInvite(this.data.child._id)
      this.setData({ inviteData: data, inviteVisible: true })
    } catch (err) {
      console.error('生成邀请失败:', err)
    }
  },

  onCloseInvite() {
    this.setData({ inviteVisible: false })
  },

  // 复制邀请码
  onCopyCode() {
    wx.setClipboardData({
      data: this.data.inviteData.code,
      success: () => wx.showToast({ title: '已复制', icon: 'success' })
    })
  },

  // 保存邀请码图片
  onSaveQr() {
    if (!this.data.inviteData || !this.data.inviteData.qr_file_id) {
      wx.showToast({ title: '小程序码未生成', icon: 'none' })
      return
    }
    wx.cloud.downloadFile({ fileID: this.data.inviteData.qr_file_id }).then(res => {
      wx.saveImageToPhotosAlbum({
        filePath: res.tempFilePath,
        success: () => wx.showToast({ title: '已保存', icon: 'success' }),
        fail: () => wx.showToast({ title: '保存失败', icon: 'none' })
      })
    })
  },

  // 提交审核
  async submitReview(action, opts) {
    const { skipNavigateBack = false } = opts || {}
    this.setData({ submitting: true })
    try {
      await api.reviewReport(this.data.report._id, action, this.data.editContent, this.data.doctorNote)

      if (action === 'save') {
        wx.showToast({ title: '修改已保存', icon: 'success' })
        this.setData({ hasChanges: false })
      } else if (action === 'approve') {
        // approve 后：已绑定→pushed，未绑定→pending_binding
        const newBtnState = this.data.isBound ? 'pushed' : 'pending_binding'
        this.setData({ btnState: newBtnState, 'report.review_status': 'approved', 'report.push_status': this.data.isBound ? 'pushed' : 'pending_binding' })
        wx.showToast({ title: this.data.isBound ? '审核通过' : '审核通过，待家长绑定后自动推送', icon: 'none' })
        if (!skipNavigateBack) setTimeout(() => wx.navigateBack(), 1500)
      } else if (action === 'approveAndPush') {
        this.setData({ btnState: 'pushed', 'report.review_status': 'approved', 'report.push_status': 'pushed' })
        wx.showToast({ title: '已推送家长', icon: 'success' })
        setTimeout(() => wx.navigateBack(), 1500)
      }
    } catch (err) {
      console.error('审核提交失败:', err)
    } finally {
      this.setData({ submitting: false })
    }
  },

  // 判断字段是否被修改（用于 diff 高亮）
  isChanged(field, index, key) {
    const ai = this.data.aiContent || {}
    const edit = this.data.editContent
    if (field === 'summary') {
      return edit.summary !== (ai.summary || '')
    }
    if (field === 'item_explanations') {
      const aiItem = (ai.item_explanations || [])[index] || {}
      const editItem = (edit.item_explanations || [])[index] || {}
      return editItem[key] !== aiItem[key]
    }
    if (field === 'triage_advice') {
      const aiItem = (ai.triage_advice || [])[index] || {}
      const editItem = (edit.triage_advice || [])[index] || {}
      return editItem[key] !== aiItem[key]
    }
    if (field === 'home_interventions') {
      const aiItem = (ai.home_interventions || [])[index] || {}
      const editItem = (edit.home_interventions || [])[index] || {}
      return editItem[key] !== aiItem[key]
    }
    return false
  },

  // 删除体检记录
  async onDeleteExam() {
    wx.showModal({
      title: '确认删除',
      content: '确定要删除该体检记录吗？此操作不可恢复。',
      success: async (res) => {
        if (res.confirm) {
          try {
            this.setData({ submitting: true })
            await api.deleteExam(this.data.examId)
            wx.showToast({ title: '删除成功', icon: 'success' })
            setTimeout(() => wx.navigateBack(), 1500)
          } catch (err) {
            console.error('删除失败:', err)
            wx.showToast({ title: '删除失败', icon: 'none' })
          } finally {
            this.setData({ submitting: false })
          }
        }
      }
    })
  },

  // 报告尚未生成时，手动触发 AI 解读生成
  async onGenerateReport() {
    if (this.data.generating) return
    this.setData({ generating: true })
    try {
      // 直接调用 callFunction，用 generating 状态控制 WXML loading overlay
      // 关闭 wrapper 的 loading 和 toast，避免双重提示
      await api.callFunction('generateReport', { exam_id: this.data.examId }, {
        loading: false, showError: false, timeout: 38000
      })
      wx.showToast({ title: '解读已生成', icon: 'success' })
      // 重新加载数据，进入审核界面
      this.setData({ noReport: false, loading: true, generating: false })
      this.loadData()
    } catch (err) {
      console.error('生成解读失败:', err)
      const errMsg = (err && err.message) || 'AI解读生成失败，请稍后重试'
      wx.showModal({
        title: '生成失败',
        content: errMsg,
        showCancel: false
      })
    } finally {
      this.setData({ generating: false })
    }
  },

  // === 海报功能 ===

  // 加载已有海报（查询 media_assets 中已完成的 poster）
  async loadPoster(reportId) {
    try {
      const assets = await api.listMediaByReport(reportId, 'poster', 'done')
      if (assets.length > 0) {
        this.setData({ poster: assets[0] })
      }
    } catch (err) {
      console.error('加载海报失败:', err)
    }
  },

  // 生成海报（调用 genPoster 云函数）
  async onGeneratePoster() {
    if (this.data.generatingPoster) return
    this.setData({ generatingPoster: true })
    try {
      // 直接用 callFunction 以控制 loading 和错误提示方式
      // genPoster 调豆包 Seedream 文生图，服务端超时 60s，客户端设 55s
      const data = await api.callFunction('genPoster',
        { source: 'doctor', report_id: this.data.report._id },
        { loading: false, showError: false, timeout: 55000 }
      )
      const poster = { _id: data.media_id, file_id: data.file_id, type: 'poster' }
      this.setData({ poster })
      wx.showToast({ title: '海报已生成', icon: 'success' })
      // 延迟 500ms 弹出全屏预览，让 toast 先显示
      setTimeout(() => this.onViewPoster(), 500)
    } catch (err) {
      console.error('生成海报失败:', err)
      const errMsg = (err && err.message) || String(err) || '海报生成失败'
      // 云函数超时（服务端 3 秒限制，需重新部署 config.json）
      if (errMsg.includes('timed out') || errMsg.includes('-504003') || errMsg.includes('TIME_LIMIT')) {
        wx.showModal({
          title: '海报生成超时',
          content: 'genPoster 云函数超时（默认仅 3 秒）。请在微信开发者工具中右键 genPoster 云函数 → 上传并部署：云端安装依赖，使 config.json 中的 timeout:60 生效。',
          showCancel: false
        })
      } else if (errMsg.includes('ARK_API_KEY') || errMsg.includes('未配置')) {
        wx.showModal({
          title: '海报生成失败',
          content: 'genPoster 云函数未配置 ARK_API_KEY。请在微信开发者工具中右键 genPoster 云函数 → 上传并部署（云端安装依赖），确保 secrets.local.js 一起上传。',
          showCancel: false
        })
      } else {
        wx.showModal({
          title: '海报生成失败',
          content: errMsg,
          showCancel: false
        })
      }
    } finally {
      this.setData({ generatingPoster: false })
    }
  },

  // 重新生成海报（需确认）
  onRegeneratePoster() {
    wx.showModal({
      title: '重新生成',
      content: '将重新生成科普海报，原海报将被替换。确认操作？',
      success: (res) => {
        if (res.confirm) {
          this.onGeneratePoster()
        }
      }
    })
  },

  // 查看已有海报（直接调 wx.previewImage 全屏预览）
  onViewPoster() {
    if (!this.data.poster || !this.data.poster.file_id) return
    wx.previewImage({
      urls: [this.data.poster.file_id],
      current: this.data.poster.file_id,
      fail(err) {
        console.error('预览海报失败:', err)
        wx.showToast({ title: '预览失败，请重试', icon: 'none' })
      }
    })
  },

  // 关闭海报查看器
  onPosterClose() {
    this.setData({ posterVisible: false })
  },

  onPullDownRefresh() {
    this.loadData()
    wx.stopPullDownRefresh()
  }
})
