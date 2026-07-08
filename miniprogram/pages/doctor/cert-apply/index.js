// miniprogram/pages/doctor/cert-apply/index.js
const api = require('../../../utils/api')
const auth = require('../../../utils/auth')

Page({
  data: {
    pageStatus: 'loading',      // loading | form | pending | whitelisted
    // 表单字段
    name: '',
    practice_location: '',      // 执业地点（医师执业证上的注册地点）
    hospital: '',               // 所在医疗机构
    license_no: '',             // 医师执业证书编号
    cert_photos: [],            // 云存储 fileID 数组
    // 状态展示
    rejectReason: '',           // 驳回原因（rejected 时展示）
    application: null,          // 申请详情（pending / rejected）
    doctorInfo: null,           // 已认证医生信息（whitelisted）
    submitting: false,          // 提交中
    uploading: false            // 照片上传中
  },

  onLoad() {
    this.loadStatus()
  },

  // 拉取当前认证状态
  async loadStatus() {
    this.setData({ pageStatus: 'loading' })
    try {
      const data = await api.getDoctorCertStatus()
      this.applyStatus(data)
    } catch (err) {
      console.error('获取认证状态失败:', err)
      // 拉取失败时降级展示表单，允许用户尝试提交
      this.setData({ pageStatus: 'form' })
    }
  },

  // 根据返回状态切换视图
  applyStatus(data) {
    const status = data && data.status
    const application = (data && data.application) || null
    const doctorInfo = (data && data.doctorInfo) || null

    // 已在白名单 / 申请已通过：展示成功视图
    if (status === 'whitelisted' || status === 'approved') {
      this.setData({ pageStatus: 'whitelisted', doctorInfo, application })
      return
    }

    // 审核中
    if (status === 'pending') {
      this.setData({ pageStatus: 'pending', application })
      return
    }

    // 被驳回：预填上次申请数据并展示驳回原因
    if (status === 'rejected' && application) {
      this.setData({
        pageStatus: 'form',
        name: application.name || '',
        practice_location: application.practice_location || '',
        hospital: application.hospital || '',
        license_no: application.license_no || '',
        cert_photos: [],
        rejectReason: application.review_note || '审核未通过，请修改后重新提交'
      })
      return
    }

    // 从未申请
    this.setData({
      pageStatus: 'form',
      name: '',
      practice_location: '',
      hospital: '',
      license_no: '',
      cert_photos: [],
      rejectReason: ''
    })
  },

  // 表单输入：通过 data-field 区分字段
  onInputChange(e) {
    const field = e.currentTarget.dataset.field
    this.setData({ [field]: e.detail.value })
  },

  // 选择并上传证件照片
  async onChoosePhotos() {
    if (this.data.uploading) return
    const remain = 3 - this.data.cert_photos.length
    if (remain <= 0) {
      wx.showToast({ title: '最多上传3张照片', icon: 'none' })
      return
    }
    try {
      const chooseRes = await wx.chooseMedia({
        count: remain,
        mediaType: ['image'],
        sourceType: ['album', 'camera'],
        sizeType: ['compressed']
      })
      if (!chooseRes.tempFiles || chooseRes.tempFiles.length === 0) return

      this.setData({ uploading: true })
      const openid = auth.getOpenid() || 'unknown'
      const timestamp = Date.now()

      // 逐张上传到云存储：doctor-cert/{openid}/{timestamp}-{index}.jpg
      const uploadTasks = chooseRes.tempFiles.map((file, index) => {
        const cloudPath = `doctor-cert/${openid}/${timestamp}-${index}.jpg`
        return wx.cloud.uploadFile({
          cloudPath,
          filePath: file.tempFilePath
        })
      })
      const results = await Promise.all(uploadTasks)
      const newFileIDs = results.map(r => r.fileID)

      this.setData({
        cert_photos: this.data.cert_photos.concat(newFileIDs),
        uploading: false
      })
    } catch (err) {
      this.setData({ uploading: false })
      console.error('上传证件照片失败:', err)
      if (err && err.errMsg && err.errMsg.includes('cancel')) return
      wx.showToast({ title: '照片上传失败', icon: 'none' })
    }
  },

  // 删除已上传照片
  onDeletePhoto(e) {
    const index = e.currentTarget.dataset.index
    const photos = this.data.cert_photos.slice()
    photos.splice(index, 1)
    this.setData({ cert_photos: photos })
  },

  // 预览证件照片
  onPreviewPhoto(e) {
    const index = e.currentTarget.dataset.index
    wx.previewImage({
      current: this.data.cert_photos[index],
      urls: this.data.cert_photos
    })
  },

  // 提交认证申请
  async onSubmit() {
    if (this.data.submitting) return
    const { name, practice_location, hospital, license_no, cert_photos } = this.data

    // 客户端校验（与云函数规则保持一致）
    if (!name.trim()) return wx.showToast({ title: '请输入姓名', icon: 'none' })
    if (!practice_location.trim()) return wx.showToast({ title: '请输入执业地点', icon: 'none' })
    if (!hospital.trim()) return wx.showToast({ title: '请输入所在医疗机构', icon: 'none' })
    if (!license_no.trim()) return wx.showToast({ title: '请输入医师执业证书编号', icon: 'none' })
    if (!cert_photos || cert_photos.length === 0) return wx.showToast({ title: '请至少上传一张证件照片', icon: 'none' })

    this.setData({ submitting: true })
    try {
      await api.submitDoctorCert({
        name: name.trim(),
        practice_location: practice_location.trim(),
        hospital: hospital.trim(),
        license_no: license_no.trim(),
        cert_photos
      })
      wx.showToast({ title: '申请已提交', icon: 'success' })

      // 提交成功后切换到审核中视图
      this.setData({
        pageStatus: 'pending',
        submitting: false,
        rejectReason: '',
        application: {
          name: name.trim(),
          practice_location: practice_location.trim(),
          hospital: hospital.trim(),
          license_no: license_no.trim()
        }
      })
    } catch (err) {
      this.setData({ submitting: false })
      console.error('提交认证申请失败:', err)
    }
  },

  // 返回角色选择页，点击「我是医生」激活身份
  onGoRoleSelect() {
    wx.reLaunch({ url: '/pages/role-select/role-select' })
  },

  // 返回上一页
  onBack() {
    wx.navigateBack({
      delta: 1,
      fail: () => {
        wx.reLaunch({ url: '/pages/role-select/role-select' })
      }
    })
  }
})
