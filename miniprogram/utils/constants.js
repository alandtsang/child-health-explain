// miniprogram/utils/constants.js
const ROLES = { DOCTOR: 'doctor', PARENT: 'parent' }
const API_CODE = { SUCCESS: 0, ERROR: -1, UNAUTHORIZED: 401, FORBIDDEN: 403, NOT_FOUND: 404 }
const ABNORMAL_LEVEL = { NORMAL: 'normal', MILD: 'mild', MODERATE: 'moderate', SEVERE: 'severe' }
const LEVEL_TEXT = { normal: '正常', mild: '轻度异常', moderate: '中度异常', severe: '重度异常' }
const LEVEL_COLOR = { normal: '#52C41A', mild: '#FAAD14', moderate: '#FA8C16', severe: '#FF4D4F' }
// 异常分级详细信息：order 越小越严重（severe=0 最严重），用于筛选最严重等级
const ABNORMAL_LEVEL_INFO = {
  normal: { order: 3, label: '正常', color: '#52C41A' },
  mild: { order: 2, label: '轻度异常', color: '#FAAD14' },
  moderate: { order: 1, label: '中度异常', color: '#FA8C16' },
  severe: { order: 0, label: '重度异常', color: '#FF4D4F' }
}
const FOLLOWUP_INTERVAL = { mild: 90, moderate: 30, severe: 14 }
const EXAM_CATEGORIES = ['growth', 'vision', 'hearing', 'dental', 'blood', 'urine', 'spine', 'internal']
const CATEGORY_LABELS = { growth: '生长发育', vision: '视力', hearing: '听力', dental: '口腔', blood: '血常规', urine: '尿常规', spine: '脊柱', internal: '内科' }
const METRIC_LABELS = {
  growth: { height: '身高(cm)', weight: '体重(kg)', head_circ: '头围(cm)', chest_circ: '胸围(cm)' },
  vision: { left: '左眼视力', right: '右眼视力', corrected_left: '矫正左眼', corrected_right: '矫正右眼' },
  hearing: { left: '左耳', right: '右耳' },
  dental: { caries_count: '龋齿数', caries_teeth: '龋齿牙位' },
  blood: { hemoglobin: '血红蛋白(g/L)', rbc: '红细胞(10^12/L)', wbc: '白细胞(10^9/L)', platelet: '血小板(10^9/L)' },
  urine: { protein: '尿蛋白', sugar: '尿糖', specific_gravity: '尿比重' },
  spine: { adams_test: '前屈试验', shoulder_balance: '肩膀平衡' },
  internal: { heart: '心脏', lung: '肺部', abdomen: '腹部', note: '内科备注' }
}
const DISCLAIMER = 'AI生成内容经医生审核，仅供参考，不替代专业医疗诊断'
const DISCLAIMER_SELF_CHECK = 'AI生成内容仅供参考，不替代医生诊断。如有疑问请及时就医。'
module.exports = { ROLES, API_CODE, ABNORMAL_LEVEL, LEVEL_TEXT, LEVEL_COLOR, ABNORMAL_LEVEL_INFO, FOLLOWUP_INTERVAL, EXAM_CATEGORIES, CATEGORY_LABELS, METRIC_LABELS, DISCLAIMER, DISCLAIMER_SELF_CHECK }
