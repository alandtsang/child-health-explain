const cloud = require('wx-server-sdk');
const https = require('https');
const http = require('http');
const { URL } = require('url');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const ARK_BASE = 'https://ark.cn-beijing.volces.com/api/v3';
const SEEDANCE_MODEL = 'doubao-seedance-1-5-pro-251215';

/**
 * 通用 HTTP 请求，兼容所有 Node.js 版本（无需 fetch）
 * 返回类 fetch Response 对象：{ ok, status, text(), json(), arrayBuffer() }
 */
function httpRequest(url, options) {
  options = options || {};
  const method = (options.method || 'GET').toUpperCase();
  const headers = Object.assign({}, options.headers || {});
  const body = options.body || '';
  const timeout = options.timeout || 30000;
  if (method === 'POST' && body) {
    headers['Content-Length'] = Buffer.byteLength(body);
  }
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const isHttps = urlObj.protocol === 'https:';
    const lib = isHttps ? https : http;
    const req = lib.request({
      hostname: urlObj.hostname,
      port: urlObj.port || (isHttps ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method,
      headers
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode,
          text: () => Promise.resolve(buf.toString('utf8')),
          json: () => Promise.resolve(JSON.parse(buf.toString('utf8'))),
          arrayBuffer: () => Promise.resolve(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))
        });
      });
    });
    req.on('error', reject);
    req.setTimeout(timeout, () => { req.destroy(new Error(`请求超时(${timeout}ms)`)); });
    if (body) req.write(body);
    req.end();
  });
}

const LEVEL_PRIORITY = { severe: 0, moderate: 1, mild: 2, normal: 3 };

/**
 * 构建视频生成 prompt
 */
function buildVideoPrompt(theme, summary, interventions) {
  const interventionText = (interventions || [])
    .slice(0, 3)
    .map(i => i.detail)
    .join('；');

  return [
    '儿童健康科普动画短片',
    `主题：${theme}`,
    '画面：温馨可爱的卡通动画，展示儿童健康话题的相关场景',
    `解说：${summary}`,
    interventionText ? `建议：${interventionText}` : '',
    '风格：明亮温馨，色彩柔和，适合家长观看',
    '时长5秒'
  ].filter(Boolean).join('，');
}

exports.main = async (event, context) => {
  const { report_id } = event;
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;

  if (!report_id) {
    return { code: 400, message: '缺少 report_id' };
  }
  if (!process.env.ARK_API_KEY) {
    return { code: 500, message: '未配置 ARK_API_KEY 环境变量' };
  }

  const db = cloud.database();

  // 校验医生身份
  try {
    const userRes = await db.collection('users').where({ openid }).get();
    const user = userRes.data[0];
    if (!user || !user.roles || !user.roles.includes('doctor')) {
      return { code: 403, message: '仅医生端可生成视频' };
    }
  } catch (err) {
    return { code: 500, message: `身份验证失败: ${err.message}` };
  }

  // 获取报告和体检记录
  let report, exam;
  try {
    const reportRes = await db.collection('reports').doc(report_id).get();
    report = reportRes.data;
    if (!report) {
      return { code: 404, message: '报告不存在' };
    }
    if (report.review_status !== 'approved') {
      return { code: 400, message: '报告未审核通过，不可生成视频' };
    }

    const examRes = await db.collection('exams').doc(report.exam_id).get();
    exam = examRes.data;
  } catch (err) {
    return { code: 500, message: `数据查询失败: ${err.message}` };
  }

  // 构建 prompt
  const contentData = report.doctor_content || report.ai_content;
  const abnormals = exam.abnormal_items || [];
  const sorted = [...abnormals].sort(
    (a, b) => (LEVEL_PRIORITY[a.level] ?? 9) - (LEVEL_PRIORITY[b.level] ?? 9)
  );
  const theme = sorted.length > 0
    ? `${sorted[0].category}健康指导`
    : '儿童健康体检';
  const prompt = buildVideoPrompt(
    theme,
    contentData.summary || '',
    contentData.home_interventions || []
  );

  // 创建 media_assets 记录（status=generating）
  const addRes = await db.collection('media_assets').add({
    data: {
      report_id,
      self_check_id: null,
      source: 'doctor',
      type: 'video',
      status: 'generating',
      prompt,
      file_id: null,
      thumbnail_file_id: null,
      generation_meta: {
        model: SEEDANCE_MODEL,
        cost: null,
        duration_ms: null,
        error: null
      },
      ark_task_id: null,
      retries: 0,
      created_at: db.serverDate(),
      completed_at: null
    }
  });
  const mediaId = addRes._id;

  try {
    // 调用豆包 Seedance API 提交视频生成任务
    const resp = await httpRequest(`${ARK_BASE}/contents/generations/tasks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.ARK_API_KEY}`
      },
      body: JSON.stringify({
        model: SEEDANCE_MODEL,
        content: [{ type: 'text', text: prompt }],
        resolution: '720p',
        ratio: '16:9',
        duration: 5,
        generate_audio: true,
        watermark: true
      })
    });

    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`Seedance API ${resp.status}: ${errText}`);
    }

    const data = await resp.json();
    const taskId = data.id;

    if (!taskId) {
      throw new Error('Seedance 返回无任务 ID');
    }

    // 更新 media_assets 记录任务 ID
    await db.collection('media_assets').doc(mediaId).update({
      data: {
        ark_task_id: taskId
      }
    });

    return {
      code: 0,
      message: '视频生成任务已提交',
      data: {
        media_id: mediaId,
        task_id: taskId
      }
    };
  } catch (err) {
    // 任务创建失败，标记 media_assets 为 failed
    await db.collection('media_assets').doc(mediaId).update({
      data: {
        status: 'failed',
        generation_meta: {
          model: SEEDANCE_MODEL,
          cost: null,
          duration_ms: null,
          error: err.message
        }
      }
    });

    return {
      code: 500,
      message: `视频任务创建失败: ${err.message}`
    };
  }
};
