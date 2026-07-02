// miniprogram/components/metrics-form/metrics-form.js

// 类别配置
const CATEGORIES = [
  { key: 'growth', label: '生长发育' },
  { key: 'vision', label: '视力' },
  { key: 'hearing', label: '听力' },
  { key: 'dental', label: '口腔' },
  { key: 'blood', label: '血液' },
  { key: 'urine', label: '尿液' },
  { key: 'spine', label: '脊柱' },
  { key: 'internal', label: '内科' },
  { key: 'development', label: '发育评估' },
  { key: 'rickets', label: '佝偻病' },
  { key: 'physical', label: '体格检查' }
]

// 各类别字段配置
const FIELD_CONFIG = {
  growth: [
    { key: 'height', label: '身高/身长', type: 'number', unit: 'cm', placeholder: '如：105' },
    { key: 'weight', label: '体重', type: 'number', unit: 'kg', placeholder: '如：17.5' },
    { key: 'head_circ', label: '头围', type: 'number', unit: 'cm', placeholder: '如：50' },
    { key: 'chest_circ', label: '胸围', type: 'number', unit: 'cm', placeholder: '如：52' },
    { key: 'evaluation', label: '发育评价', type: 'text', placeholder: '上/中/下 或 正常/低体重/消瘦/生长迟缓/超重' }
  ],
  vision: [
    { key: 'left', label: '左眼视力', type: 'number', placeholder: '如：5.0' },
    { key: 'right', label: '右眼视力', type: 'number', placeholder: '如：5.0' },
    { key: 'corrected_left', label: '矫正左眼', type: 'number', placeholder: '无则留空' },
    { key: 'corrected_right', label: '矫正右眼', type: 'number', placeholder: '无则留空' }
  ],
  hearing: [
    { key: 'left', label: '左耳', type: 'text', placeholder: '正常/异常' },
    { key: 'right', label: '右耳', type: 'text', placeholder: '正常/异常' },
    { key: 'result', label: '听力筛查', type: 'text', placeholder: '通过/未通过/未测' }
  ],
  dental: [
    { key: 'teeth_count', label: '出牙数', type: 'number', unit: '颗', placeholder: '如：8' },
    { key: 'caries_count', label: '龋齿数', type: 'number', unit: '颗', placeholder: '如：0' },
    { key: 'caries_teeth', label: '龋齿牙位', type: 'text', placeholder: '如：左上第一乳磨牙' }
  ],
  blood: [
    { key: 'hemoglobin', label: '血红蛋白', type: 'number', unit: 'g/L', placeholder: '如：120' },
    { key: 'rbc', label: '红细胞', type: 'number', unit: '10¹²/L', placeholder: '如：4.5' },
    { key: 'wbc', label: '白细胞', type: 'number', unit: '10⁹/L', placeholder: '如：7.2' },
    { key: 'platelet', label: '血小板', type: 'number', unit: '10⁹/L', placeholder: '如：280' }
  ],
  urine: [
    { key: 'protein', label: '尿蛋白', type: 'text', placeholder: '阴性/±/+/++' },
    { key: 'sugar', label: '尿糖', type: 'text', placeholder: '阴性/±/+/++' },
    { key: 'specific_gravity', label: '尿比重', type: 'number', placeholder: '如：1.020' }
  ],
  spine: [
    { key: 'adams_test', label: 'Adams前屈试验', type: 'text', placeholder: '阴性/阳性' },
    { key: 'shoulder_balance', label: '肩平衡', type: 'text', placeholder: '对称/不对称' }
  ],
  internal: [
    { key: 'heart', label: '心脏', type: 'text', placeholder: '正常/异常描述' },
    { key: 'lung', label: '肺部', type: 'text', placeholder: '正常/异常描述' },
    { key: 'abdomen', label: '腹部', type: 'text', placeholder: '正常/异常描述' },
    { key: 'note', label: '备注', type: 'text', placeholder: '其他检查备注' }
  ],
  development: [
    { key: 'screening_result', label: '预警征筛查', type: 'text', placeholder: '正常/阳性' },
    { key: 'positive_items', label: '阳性条目', type: 'text', placeholder: '如：不会独坐;不会区分生人和熟人' }
  ],
  rickets: [
    { key: 'symptoms', label: '佝偻病症状', type: 'text', placeholder: '无 或 夜惊,多汗,烦躁' },
    { key: 'signs', label: '佝偻病体征', type: 'text', placeholder: '无 或 肋串珠,方颅,鸡胸等' }
  ],
  physical: [
    { key: 'complexion', label: '面色', type: 'text', placeholder: '红润/黄染/其他' },
    { key: 'skin', label: '皮肤', type: 'text', placeholder: '未见异常/异常描述' },
    { key: 'eyes', label: '眼睛', type: 'text', placeholder: '未见异常/异常描述' },
    { key: 'ears', label: '耳外观', type: 'text', placeholder: '未见异常/异常描述' },
    { key: 'anterior_fontanelle', label: '前囟', type: 'text', placeholder: '闭合 或 未闭 1.5cm×1.5cm' },
    { key: 'neck_mass', label: '颈部包块', type: 'text', placeholder: '有/无' },
    { key: 'chest', label: '胸部', type: 'text', placeholder: '未见异常/异常描述' },
    { key: 'abdomen', label: '腹部', type: 'text', placeholder: '未见异常/异常描述' },
    { key: 'limbs', label: '四肢', type: 'text', placeholder: '未见异常/异常描述' },
    { key: 'umbilicus', label: '脐部', type: 'text', placeholder: '未脱/脱落/脐部有渗出/其他' },
    { key: 'gait', label: '步态', type: 'text', placeholder: '未见异常/异常描述' },
    { key: 'anus_genitalia', label: '肛门/外生殖器', type: 'text', placeholder: '未见异常/异常描述' },
    { key: 'outdoor_activity', label: '户外活动', type: 'number', unit: '小时/日', placeholder: '如：2' },
    { key: 'vitamin_d', label: '服用维生素D', type: 'number', unit: 'IU/日', placeholder: '如：400' }
  ]
}

Component({
  properties: {
    // 初始metrics数据
    metrics: {
      type: Object,
      value: null,
      observer(newVal) {
        if (newVal) this.initFormData(newVal)
      }
    },
    // 不确定字段列表，格式如 ['growth.height', 'blood.hemoglobin']
    uncertainFields: {
      type: Array,
      value: []
    },
    // 是否可编辑
    editable: {
      type: Boolean,
      value: true
    }
  },

  data: {
    currentTab: 'growth',
    categories: CATEGORIES,
    displayFields: [],
    formData: {}
  },

  lifetimes: {
    attached() {
      if (!this.data.formData || Object.keys(this.data.formData).length === 0) {
        this.initFormData({})
      }
      this.updateDisplayFields()
    }
  },

  methods: {
    /**
     * 初始化表单数据，确保所有类别和字段都存在
     */
    initFormData(metrics) {
      const formData = {}
      for (const cat of CATEGORIES) {
        formData[cat.key] = {}
        const fields = FIELD_CONFIG[cat.key] || []
        const sourceData = metrics[cat.key] || {}
        for (const f of fields) {
          formData[cat.key][f.key] = sourceData[f.key] !== undefined ? sourceData[f.key] : null
        }
      }
      this.setData({ formData })
      this.updateDisplayFields()
    },

    /**
     * 更新当前tab的展示字段（含不确定标记和当前值）
     */
    updateDisplayFields() {
      const config = FIELD_CONFIG[this.data.currentTab] || []
      const uncertainSet = new Set(this.data.uncertainFields)
      const categoryData = this.data.formData[this.data.currentTab] || {}
      const displayFields = config.map(f => ({
        ...f,
        uncertain: uncertainSet.has(`${this.data.currentTab}.${f.key}`),
        value: categoryData[f.key] === null || categoryData[f.key] === undefined
          ? ''
          : String(categoryData[f.key])
      }))
      this.setData({ displayFields })
    },

    /**
     * 切换tab
     */
    switchTab(e) {
      const key = e.currentTarget.dataset.key
      if (key === this.data.currentTab) return
      this.setData({ currentTab: key })
      this.updateDisplayFields()
    },

    /**
     * 输入事件处理：更新formData，不更新displayFields以避免输入框光标跳动
     */
    onInput(e) {
      const { category, key, type } = e.currentTarget.dataset
      let value = e.detail.value
      if (type === 'number') {
        value = value === '' ? null : Number(value)
      }
      // 更新formData（使用setData保证数据一致性，input的value绑定在displayFields上不受影响）
      this.setData({
        [`formData.${category}.${key}`]: value
      })
      this.triggerEvent('change', { category, key, value })
    },

    /**
     * 获取完整表单数据（供父页面调用）
     */
    getFormData() {
      return JSON.parse(JSON.stringify(this.data.formData))
    },

    /**
     * 设置表单数据（供父页面调用，如重置）
     */
    setFormData(metrics) {
      this.initFormData(metrics)
    }
  }
})
