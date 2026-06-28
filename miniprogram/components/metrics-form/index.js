// miniprogram/components/metrics-form/index.js
Component({
  properties: {
    metrics: { type: Object, value: {} },
    disabled: { type: Boolean, value: false }
  },

  data: {
    categories: [
      { key: 'growth', label: '生长发育', fields: [
        { key: 'height', label: '身高(cm)', type: 'number', placeholder: '如 95.5' },
        { key: 'weight', label: '体重(kg)', type: 'number', placeholder: '如 14.2' },
        { key: 'head_circ', label: '头围(cm)', type: 'number', placeholder: '如 48.0' },
        { key: 'chest_circ', label: '胸围(cm)', type: 'number', placeholder: '如 49.0' }
      ]},
      { key: 'vision', label: '视力', fields: [
        { key: 'left', label: '左眼视力', type: 'text', placeholder: '如 0.8' },
        { key: 'right', label: '右眼视力', type: 'text', placeholder: '如 0.8' }
      ]},
      { key: 'hearing', label: '听力', fields: [
        { key: 'left', label: '左耳', type: 'text', placeholder: '正常/异常' },
        { key: 'right', label: '右耳', type: 'text', placeholder: '正常/异常' }
      ]},
      { key: 'dental', label: '口腔', fields: [
        { key: 'caries_count', label: '龋齿数', type: 'number', placeholder: '如 0' },
        { key: 'caries_teeth', label: '龋齿牙位', type: 'text', placeholder: '如 无' }
      ]},
      { key: 'blood', label: '血液', fields: [
        { key: 'hemoglobin', label: '血红蛋白(g/L)', type: 'number', placeholder: '如 120' },
        { key: 'rbc', label: '红细胞(10^12/L)', type: 'number', placeholder: '如 4.5' },
        { key: 'wbc', label: '白细胞(10^9/L)', type: 'number', placeholder: '如 8.0' }
      ]},
      { key: 'urine', label: '尿液', fields: [
        { key: 'protein', label: '尿蛋白', type: 'text', placeholder: '阴性/阳性' },
        { key: 'sugar', label: '尿糖', type: 'text', placeholder: '阴性/阳性' }
      ]},
      { key: 'spine', label: '脊柱', fields: [
        { key: 'adams_test', label: 'Adams前屈试验', type: 'text', placeholder: '阴性/阳性' },
        { key: 'shoulder_balance', label: '肩膀平衡', type: 'text', placeholder: '正常/异常' }
      ]},
      { key: 'internal', label: '内科', fields: [
        { key: 'heart', label: '心脏', type: 'text', placeholder: '正常' },
        { key: 'lung', label: '肺部', type: 'text', placeholder: '正常' },
        { key: 'abdomen', label: '腹部', type: 'text', placeholder: '正常' },
        { key: 'note', label: '内科备注', type: 'text', placeholder: '其他说明' }
      ]}
    ],
    expandedKeys: ['growth']
  },

  methods: {
    onToggleCategory(e) {
      const key = e.currentTarget.dataset.key
      const keys = this.data.expandedKeys
      const idx = keys.indexOf(key)
      if (idx > -1) {
        keys.splice(idx, 1)
      } else {
        keys.push(key)
      }
      this.setData({ expandedKeys: keys })
    },

    onInput(e) {
      const { category, field } = e.currentTarget.dataset
      const value = e.detail.value
      const metrics = this.data.metrics
      if (!metrics[category]) metrics[category] = {}
      metrics[category][field] = value
      this.triggerEvent('change', { metrics })
    },

    getMetrics() {
      return this.data.metrics
    }
  }
})
