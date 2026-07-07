// miniprogram/pages/child-edit/child-edit.js
const auth = require('../../utils/auth')
const api = require('../../utils/api')
const format = require('../../utils/format')
const { isChildAccessibleToParent } = require('../../utils/db')

Page({
  data: {
    childId: '',
    isEdit: false,
    form: {
      name: '',
      gender: '男',
      birth_date: ''
    },
    today: '',
    loading: false
  },

  onLoad(options) {
    const today = format.formatDate(new Date())
    this.setData({ today })
    if (options.id) {
      this.setData({ childId: options.id, isEdit: true })
      this.loadChild(options.id)
    }
  },

  async loadChild(id) {
    try {
      // children doc(id).get() 改走云函数（安全规则迁移）
      const child = await api.getChildDetail(id)
      // 权限校验：仅允许查看/编辑自己绑定或创建的儿童档案
      if (!isChildAccessibleToParent(child, auth.getOpenid())) {
        wx.showModal({
          title: '无权查看',
          content: '该儿童档案不属于您，无法查看',
          showCancel: false,
          success: () => wx.navigateBack()
        })
        return
      }
      this.setData({ form: { name: child.name, gender: child.gender, birth_date: child.birth_date } })
    } catch (err) {
      console.error('加载儿童信息失败:', err)
      wx.showToast({ title: '加载失败', icon: 'none' })
    }
  },

  onInput(e) {
    this.setData({ [`form.${e.currentTarget.dataset.field}`]: e.detail.value })
  },

  onGenderChange(e) {
    this.setData({ 'form.gender': e.detail.value })
  },

  onBirthDateChange(e) {
    this.setData({ 'form.birth_date': e.detail.value })
  },

  async onSave() {
    const { name, gender, birth_date } = this.data.form
    if (!name.trim()) {
      wx.showToast({ title: '请输入姓名', icon: 'none' })
      return
    }
    if (!birth_date) {
      wx.showToast({ title: '请选择出生日期', icon: 'none' })
      return
    }
    this.setData({ loading: true })
    try {
      const action = this.data.isEdit ? 'update' : 'create'
      const payload = { action, name, gender, birth_date }
      if (this.data.isEdit) payload.child_id = this.data.childId
      await api.saveChild(payload)
      wx.showToast({ title: this.data.isEdit ? '已保存' : '已创建', icon: 'success' })
      setTimeout(() => wx.navigateBack(), 1500)
    } catch (err) {
      console.error('保存失败:', err)
    } finally {
      this.setData({ loading: false })
    }
  },

  // 删除儿童档案（仅编辑模式）
  onDelete() {
    wx.showModal({
      title: '删除档案',
      content: '确认删除此儿童档案？关联的体检记录将保留。',
      confirmText: '删除',
      confirmColor: '#FF4D4F',
      success: async (res) => {
        if (res.confirm) {
          this.setData({ loading: true })
          try {
            await api.saveChild({ action: 'delete', child_id: this.data.childId })
            wx.showToast({ title: '已删除', icon: 'success' })
            setTimeout(() => wx.navigateBack(), 1500)
          } catch (err) {
            console.error('删除失败:', err)
          } finally {
            this.setData({ loading: false })
          }
        }
      }
    })
  }
})
