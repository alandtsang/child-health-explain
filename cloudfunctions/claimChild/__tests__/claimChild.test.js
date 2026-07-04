// mock wx-server-sdk，缓存对象模式
jest.mock('wx-server-sdk', () => {
  const now = Date.now()
  const dayMs = 86400000

  const state = {
    invites: {
      'VALID01': { _id: 'inv_1', child_id: 'child_001', code: 'VALID01', status: 'pending', expires_at: new Date(now + dayMs), used_by: null },
      'EXPIRED': { _id: 'inv_2', child_id: 'child_001', code: 'EXPIRED', status: 'pending', expires_at: new Date(now - dayMs), used_by: null },
      'USEDD01': { _id: 'inv_3', child_id: 'child_002', code: 'USEDD01', status: 'used', expires_at: new Date(now + dayMs), used_by: 'parent_old' }
    },
    children: {
      'child_001': { _id: 'child_001', name: '小明', gender: '男', birth_date: '2020-01-01', created_by: 'doctor_openid', bound_parent_ids: [] },
      'child_002': { _id: 'child_002', name: '小红', gender: '女', birth_date: '2019-05-05', created_by: 'doctor_openid', bound_parent_ids: ['parent_old'] }
    },
    exams: { 'child_001': [{ _id: 'exam_1', child_id: 'child_001' }] },
    reports: { 'exam_1': [{ _id: 'rpt_1', exam_id: 'exam_1', push_status: 'pending_binding' }] },
    callerOpenid: 'parent_new'
  }

  const invitesCol = {
    where: jest.fn((cond) => ({
      limit: jest.fn(() => ({ get: jest.fn(() => ({ data: state.invites[cond.code] ? [state.invites[cond.code]] : [] })) })),
      get: jest.fn(() => ({ data: state.invites[cond.code] ? [state.invites[cond.code]] : [] }))
    })),
    doc: jest.fn((id) => ({ update: jest.fn((args) => {
      // 模拟更新 invite 状态
      for (const k in state.invites) {
        if (state.invites[k]._id === id) {
          Object.assign(state.invites[k], args.data)
        }
      }
    }) }))
  }

  const childrenCol = {
    doc: jest.fn((id) => ({
      update: jest.fn((args) => {
        if (state.children[id] && args.data.bound_parent_ids) {
          // addToSet 语义：去重追加
          const cmd = args.data.bound_parent_ids
          // mock addToSet 行为
          state.children[id].bound_parent_ids = state.children[id].bound_parent_ids || []
        }
      }),
      get: jest.fn(() => ({ data: state.children[id] }))
    })),
    where: jest.fn(() => ({ limit: jest.fn(() => ({ get: jest.fn(() => ({ data: [] })) })), get: jest.fn(() => ({ data: [] })) }))
  }

  const examsCol = {
    where: jest.fn((cond) => ({ get: jest.fn(() => ({ data: state.exams[cond.child_id] || [] })) }))
  }

  const reportsCol = {
    where: jest.fn(() => ({ get: jest.fn(() => ({ data: state.reports['exam_1'] || [] })) })),
    doc: jest.fn(() => ({ update: jest.fn() }))
  }

  const notifsCol = { add: jest.fn(() => ({ _id: 'notif_1' })) }

  const db = {
    collection: jest.fn((name) => {
      if (name === 'bind_invites') return invitesCol
      if (name === 'children') return childrenCol
      if (name === 'exams') return examsCol
      if (name === 'reports') return reportsCol
      if (name === 'notifications') return notifsCol
      return { where: jest.fn(() => ({ get: jest.fn(() => ({ data: [] })) })) }
    }),
    command: { set: jest.fn(v => v), addToSet: jest.fn(v => ({ __addToSet: v })), in: jest.fn(v => ({ __in: v })), neq: jest.fn(v => ({ __neq: v })) },
    serverDate: jest.fn(() => new Date())
  }

  return {
    init: jest.fn(),
    database: jest.fn(() => db),
    getWXContext: jest.fn(() => ({ OPENID: state.callerOpenid })),
    DYNAMIC_CURRENT_ENV: 'test-env',
    __testState: state
  }
})

const cloud = require('wx-server-sdk')
const fn = require('../index.js')

describe('claimChild', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    // 重置 invite 状态，避免 preview 测试修改 state 后影响 claim 测试
    const now = Date.now()
    const dayMs = 86400000
    cloud.__testState.invites = {
      'VALID01': { _id: 'inv_1', child_id: 'child_001', code: 'VALID01', status: 'pending', expires_at: new Date(now + dayMs), used_by: null },
      'EXPIRED': { _id: 'inv_2', child_id: 'child_001', code: 'EXPIRED', status: 'pending', expires_at: new Date(now - dayMs), used_by: null },
      'USEDD01': { _id: 'inv_3', child_id: 'child_002', code: 'USEDD01', status: 'used', expires_at: new Date(now + dayMs), used_by: 'parent_old' }
    }
    cloud.__testState.children = {
      'child_001': { _id: 'child_001', name: '小明', gender: '男', birth_date: '2020-01-01', created_by: 'doctor_openid', bound_parent_ids: [] },
      'child_002': { _id: 'child_002', name: '小红', gender: '女', birth_date: '2019-05-05', created_by: 'doctor_openid', bound_parent_ids: ['parent_old'] }
    }
  })

  test('preview action 只查不绑', async () => {
    const res = await fn.main({ code: 'VALID01', action: 'preview' })
    expect(res.code).toBe(0)
    expect(res.data.child.name).toBe('小明')
  })

  test('preview 过期码 → 返回 410', async () => {
    const res = await fn.main({ code: 'EXPIRED', action: 'preview' })
    expect(res.code).toBe(410)
  })

  test('preview 已使用码 → 返回 404', async () => {
    const res = await fn.main({ code: 'USEDD01', action: 'preview' })
    expect(res.code).toBe(404)
  })

  test('preview 无效码 → 返回 404', async () => {
    const res = await fn.main({ code: 'NOTEXS', action: 'preview' })
    expect(res.code).toBe(404)
  })

  test('claim 有效码 + 首次绑定 → 成功', async () => {
    cloud.__testState.callerOpenid = 'parent_new'
    const res = await fn.main({ code: 'VALID01' })
    expect(res.code).toBe(0)
    expect(res.data.child.name).toBe('小明')
  })

  test('claim 过期码 → 返回 410', async () => {
    const res = await fn.main({ code: 'EXPIRED' })
    expect(res.code).toBe(410)
  })

  test('claim 已使用码 → 返回 404', async () => {
    const res = await fn.main({ code: 'USEDD01' })
    expect(res.code).toBe(404)
  })

  test('claim 无效码 → 返回 404', async () => {
    const res = await fn.main({ code: 'NOTEXS' })
    expect(res.code).toBe(404)
  })
})
