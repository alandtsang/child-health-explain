// miniprogram/components/report-card/index.js
const { ABNORMAL_LEVEL_INFO } = require('../../utils/constants')
const format = require('../../utils/format')

Component({
  properties: {
    report: { type: Object, value: {} },
    showNew: { type: Boolean, value: false },
    showStatus: { type: Boolean, value: false }
  },

  data: {
    levelInfo: ABNORMAL_LEVEL_INFO
  },

  methods: {
    onTap() {
      this.triggerEvent('tap', { report: this.data.report })
    }
  }
})
