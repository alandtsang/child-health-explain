/**
 * cloudfunctions/shared/arkClient.js
 * 火山引擎方舟API客户端 - 文本Chat调用封装
 * 支持 json_schema 模式的结构化输出
 *
 * 使用方式（复制到各云函数 lib/ 目录后）：
 *   const { chatCompletion, buildSchema } = require('./lib/arkClient')
 *   const result = await chatCompletion({ messages, schema })
 */

const ARK_BASE = 'https://ark.cn-beijing.volces.com/api/v3'
const TEXT_MODEL = 'doubao-seed-2-0-pro-260215'

/**
 * 构建 json_schema 响应格式对象
 * @param {string} name - schema名称
 * @param {Object} schema - JSON Schema定义对象
 * @returns {Object} - response_format 参数对象
 */
function buildSchema(name, schema) {
  return {
    name,
    strict: true,
    schema
  }
}

/**
 * 调用方舟文本 Chat Completions API
 * @param {Object} params
 * @param {Array<{role: string, content: string}>} params.messages - 消息数组
 * @param {Object} [params.schema] - JSON Schema对象（由 buildSchema 生成），不传则不使用结构化输出
 * @param {number} [params.maxTokens=4096] - 最大输出token数
 * @param {number} [params.temperature=0.3] - 温度参数（医学内容建议0.3保证稳定性）
 * @param {number} [params.timeout=30000] - 请求超时毫秒数
 * @param {number} [params.retries=1] - 失败重试次数
 * @returns {Promise<{data: Object, usage: Object|null, raw: string}>} - 解析后的JSON对象及元信息
 * @throws {Error} - API调用失败或JSON解析失败时抛出
 */
async function chatCompletion({ messages, schema, maxTokens = 4096, temperature = 0.3, timeout = 30000, retries = 1 }) {
  let apiKey = process.env.ARK_API_KEY
  // 环境变量未设置时，回退到本地密钥配置文件
  if (!apiKey) {
    try {
      const localSecrets = require('../secrets.local')
      apiKey = localSecrets.ARK_API_KEY
    } catch (e) {
      // secrets.local.js 不存在时忽略
    }
  }
  if (!apiKey) {
    throw new Error('ARK_API_KEY 未配置：请在云函数环境变量中设置 ARK_API_KEY，或在 cloudfunctions/generateReport/secrets.local.js 中填写')
  }

  const body = {
    model: TEXT_MODEL,
    messages,
    thinking: { type: 'disabled' },
    max_tokens: maxTokens,
    stream: false,
    temperature
  }

  if (schema) {
    body.response_format = {
      type: 'json_schema',
      json_schema: schema
    }
  }

  let lastError = null

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      // 使用 Promise.race 实现超时控制，兼容 Node.js 16+
      const fetchPromise = fetch(`${ARK_BASE}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify(body)
      })

      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error(`方舟API请求超时(${timeout}ms)`)), timeout)
      })

      const resp = await Promise.race([fetchPromise, timeoutPromise])

      if (!resp.ok) {
        const errText = await resp.text()
        throw new Error(`方舟API HTTP ${resp.status}: ${errText}`)
      }

      const data = await resp.json()

      if (!data.choices || !data.choices[0] || !data.choices[0].message) {
        throw new Error('方舟API返回数据格式异常: 缺少choices字段')
      }

      const content = data.choices[0].message.content

      if (!content) {
        throw new Error('方舟API返回空内容')
      }

      // 解析JSON响应
      let parsed
      try {
        parsed = JSON.parse(content)
      } catch (parseErr) {
        // 尝试提取JSON代码块中的内容
        const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/)
        if (jsonMatch) {
          parsed = JSON.parse(jsonMatch[1])
        } else {
          throw new Error(`方舟API返回内容JSON解析失败: ${parseErr.message}`)
        }
      }

      return {
        data: parsed,
        usage: data.usage || null,
        raw: content
      }
    } catch (err) {
      lastError = err
      console.error(`[arkClient] 第${attempt + 1}/${retries + 1}次尝试失败:`, err.message)
      if (attempt < retries) {
        const delay = 1000 * (attempt + 1)
        console.log(`[arkClient] ${delay}ms后重试...`)
        await new Promise(r => setTimeout(r, delay))
      }
    }
  }

  throw lastError
}

module.exports = { chatCompletion, buildSchema, ARK_BASE, TEXT_MODEL }
