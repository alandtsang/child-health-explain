/**
 * cloudfunctions/generateReport/lib/arkClient.js
 * 火山引擎方舟API客户端 - 文本Chat调用封装
 * 支持 json_schema 模式的结构化输出
 *
 * 使用方式（复制到各云函数 lib/ 目录后）：
 *   const { chatCompletion, buildSchema } = require('./lib/arkClient')
 *   const result = await chatCompletion({ messages, schema })
 */

const https = require('https')
const { URL } = require('url')

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
 * 基于 Node.js 原生 https 模块的 POST 请求
 * 兼容所有 Node.js 版本（云函数运行时可能低于 Node.js 18，无全局 fetch）
 * @param {string} url - 请求地址
 * @param {Object} opts - { headers, body }
 * @param {number} timeout - 超时毫秒数
 * @returns {Promise<{ok: boolean, status: number, text: () => Promise<string>, json: () => Promise<Object>}>}
 */
function httpPost(url, opts, timeout) {
  const headers = (opts && opts.headers) || {}
  const body = (opts && opts.body) || ''
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url)
    const req = https.request({
      hostname: urlObj.hostname,
      port: urlObj.port || 443,
      path: urlObj.pathname + urlObj.search,
      method: 'POST',
      headers: Object.assign({}, headers, { 'Content-Length': Buffer.byteLength(body) })
    }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => {
        const bodyStr = Buffer.concat(chunks).toString('utf8')
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode,
          text: () => Promise.resolve(bodyStr),
          json: () => Promise.resolve(JSON.parse(bodyStr))
        })
      })
    })
    req.on('error', reject)
    req.setTimeout(timeout, () => {
      req.destroy(new Error(`方舟API请求超时(${timeout}ms)`))
    })
    req.write(body)
    req.end()
  })
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
      const resp = await httpPost(`${ARK_BASE}/chat/completions`, {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify(body)
      }, timeout)

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
