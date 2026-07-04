// mock wx-server-sdk，避免真实云调用
// 使用缓存对象模式：同名 collection 返回同一 mock 对象，保证 add/update 等可被断言
jest.mock('wx-server-sdk', () => {
  // 可被测试动态修改的角色标记
  const state = { userRole: 'parent' }

  // 预创建各集合的 mock 对象，保证多次调用 collection('children') 返回同一实例
  const collections = {
    children: {
      where: jest.fn(() => ({ limit: jest.fn(() => ({ get: jest.fn(() => ({ data: [] })) })) })),
      add: jest.fn(() => ({ _id: 'new_child_id' })),
      doc: jest.fn(() => ({ update: jest.fn(), get: jest.fn(), remove: jest.fn() }))
    },
    users: {
      where: jest.fn(() => ({
        limit: jest.fn(() => ({
          get: jest.fn(() => ({
            // 动态返回角色：根据 state.userRole 决定
            get data() {
              return state.userRole ? [{ roles: [state.userRole] }] : []
            }
          }))
        }))
      }))
    }
  }

  const db = {
    collection: jest.fn((name) => collections[name] || collections.children),
    command: { set: jest.fn(v => v) },
    serverDate: jest.fn(() => new Date())
  }

  return {
    init: jest.fn(),
    database: jest.fn(() => db),
    getWXContext: jest.fn(() => ({ OPENID: 'caller_openid_001' })),
    DYNAMIC_CURRENT_ENV: 'test-env',
    // 暴露内部 state 供测试修改
    __testState: state
  }
})

const cloud = require('wx-server-sdk')
const saveChild = require('../index.js')

describe('saveChild handleCreate 角色感知', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    // 重置 children.add 的调用记录（clearAllMocks 已清，但确保 add 返回值正常）
    cloud.database().collection('children').add.mockReturnValue({ _id: 'new_child_id' })
  })

  test('医生建档时 bound_parent_ids 为空数组', async () => {
    cloud.__testState.userRole = 'doctor'
    const result = await saveChild.main({
      action: 'create',
      name: '测试儿童',
      gender: '男',
      birth_date: '2020-01-01'
    })
    expect(result.code).toBe(0)
    const addCall = cloud.database().collection('children').add.mock.calls[0][0]
    expect(addCall.data.bound_parent_ids).toEqual([])
    expect(addCall.data.created_by).toBe('caller_openid_001')
  })

  test('家长建档时 bound_parent_ids 含家长 openid', async () => {
    cloud.__testState.userRole = 'parent'
    const result = await saveChild.main({
      action: 'create',
      name: '测试儿童',
      gender: '男',
      birth_date: '2020-01-01'
    })
    expect(result.code).toBe(0)
    const addCall = cloud.database().collection('children').add.mock.calls[0][0]
    expect(addCall.data.bound_parent_ids).toEqual(['caller_openid_001'])
    expect(addCall.data.created_by).toBe('caller_openid_001')
  })

  test('无角色记录的用户建档时按家长处理（保守默认）', async () => {
    cloud.__testState.userRole = null
    const result = await saveChild.main({
      action: 'create',
      name: '测试儿童',
      gender: '男',
      birth_date: '2020-01-01'
    })
    expect(result.code).toBe(0)
    const addCall = cloud.database().collection('children').add.mock.calls[0][0]
    expect(addCall.data.bound_parent_ids).toEqual(['caller_openid_001'])
  })
})
