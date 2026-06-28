Component({
  properties: {
    level: { type: String, value: 'normal' },
    text: { type: String, value: '' }
  },
  data: {
    levelInfo: {
      normal: { label: '正常', className: 'tag-normal' },
      mild: { label: '轻度', className: 'tag-mild' },
      moderate: { label: '中度', className: 'tag-moderate' },
      severe: { label: '重度', className: 'tag-severe' }
    }
  }
})
