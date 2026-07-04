// mock wx-server-sdk，缓存对象模式
jest.mock('wx-server-sdk', () => {
  const state = {
    // 测试可动态修改的数据
    child: { _id: 'child_001', name: '小明', created_by: 'doctor_openid', bound_parent_ids: [] },
    userRoles: ['doctor'],
    existingInvites: []  // pending invites
  }

  const invitesCol = {
    where: jest.fn((cond) => ({
      get: jest.fn(() => ({ data: state.existingInvites.filter(() => true) })),
      limit: jest.fn(() => ({ get: jest.fn(() => ({ data: [] })) }))
    })),
    add: jest.fn(() => ({ _id: 'inv_new' })),
    doc: jest.fn(() => ({ update: jest.fn() }))
  }

  const childrenCol = {
    doc: jest.fn((id) => ({
      get: jest.fn(() => ({ data: state.child }))
    })),
    where: jest.fn(() => ({ get: jest.fn(() => ({ data: [] })) }))
  }

  const usersCol = {
    where: jest.fn(() => ({
      limit: jest.fn(() => ({
        get: jest.fn(() => ({
          get data() { return state.userRoles ? [{ roles: state.userRoles }] : [] }
        }))
      }))
    }))
  }

  const db = {
    collection: jest.fn((name) => {
      if (name === 'children') return childrenCol
      if (name === 'bind_invites') return invitesCol
      if (name === 'users') return usersCol
      return { where: jest.fn(() => ({ get: jest.fn(() => ({ data: [] })) })) }
    }),
    command: { set: jest.fn(v => v) },
    serverDate: jest.fn(() => new Date())
  }

  return {
    init: jest.fn(),
    database: jest.fn(() => db),
    getWXContext: jest.fn(() => ({ OPENID: 'doctor_openid' })),
    DYNAMIC_CURRENT_ENV: 'test-env',
    openapi: { wxacode: { getUnlimited: jest.fn(() => ({ fileID: 'qr_file_001' })) } },
    __testState: state
  }
})

const cloud = require('wx-server-sdk')
const fn = require('../index.js')

describe('createBindInvite', () => {
  beforeEach(() => { jest.clearAllMocks() })

  test('医生为自己的档案生成邀请成功', async () => {
    cloud.__testState.child = { _id: 'child_001', name: '小明', created_by: 'doctor_openid', bound_parent_ids: [] }
    cloud.__testState.userRoles = ['doctor']
    cloud.__testState.existingInvites = []

    const res = await fn.main({ child_id: 'child_001' })
    expect(res.code).toBe(0)
    expect(res.data.code).toMatch(/^[A-Z0-9]{6}$/)
    expect(res.data.qr_file_id).toBe('qr_file_001')
    expect(res.data.expires_in_days).toBe(7)
  })

  test('非创建者医生不能为他人档案生成邀请', async () => {
    cloud.__testState.child = { _id: 'child_002', created_by: 'other_doctor', bound_parent_ids: [] }
    cloud.__testState.userRoles = ['doctor']

    const res = await fn.main({ child_id: 'child_002' })
    expect(res.code).toBe(403)
  })

  test('已绑定家长的档案不再生成邀请', async () => {
    cloud.__testState.child = { _id: 'child_003', created_by: 'doctor_openid', bound_parent_ids: ['parent_001'] }
    cloud.__testState.userRoles = ['doctor']

    const res = await fn.main({ child_id: 'child_003' })
    expect(res.code).toBe(409)
  })

  test('非医生用户不能生成邀请', async () => {
    cloud.__testState.userRoles = ['parent']

    const res = await fn.main({ child_id: 'child_001' })
    expect(res.code).toBe(403)
  })
})
