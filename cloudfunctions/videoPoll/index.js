const cloud = require('wx-server-sdk');
const https = require('https');
const http = require('http');
const { URL } = require('url');
const { getApiKey } = require('./lib/arkClient');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const ARK_BASE = 'https://ark.cn-beijing.volces.com/api/v3';
const SEEDANCE_MODEL = 'doubao-seedance-1-5-pro-251215';
const MAX_RETRIES = 2;

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

exports.main = async (event, context) => {
  let apiKey;
  try {
    apiKey = getApiKey();
  } catch (e) {
    console.error(e.message);
    return { code: 500, message: e.message };
  }

  const db = cloud.database();

  // 获取所有生成中的视频任务
  const generatingRes = await db.collection('media_assets')
    .where({
      type: 'video',
      status: 'generating'
    })
    .limit(20)
    .get();

  const results = [];

  for (const media of generatingRes.data) {
    try {
      const result = await pollSingleTask(media);
      results.push(result);
    } catch (err) {
      console.error(`轮询任务 ${media._id} 异常: ${err.message}`);
      results.push({
        media_id: media._id,
        status: 'error',
        error: err.message
      });
    }
  }

  return {
    code: 0,
    processed: results.length,
    results
  };
};

/**
 * 轮询单个视频任务
 */
async function pollSingleTask(media) {
  const db = cloud.database();
  const taskId = media.ark_task_id;

  if (!taskId) {
    await db.collection('media_assets').doc(media._id).update({
      data: {
        status: 'failed',
        'generation_meta.error': '无任务 ID'
      }
    });
    return { media_id: media._id, status: 'failed', error: '无任务 ID' };
  }

  // 查询任务状态
  const resp = await httpRequest(
    `${ARK_BASE}/contents/generations/tasks/${taskId}`,
    {
      headers: {
        Authorization: `Bearer ${getApiKey()}`
      }
    }
  );

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`查询任务失败 ${resp.status}: ${errText}`);
  }

  const task = await resp.json();

  if (task.status === 'succeeded') {
    return await handleTaskSuccess(media, task);
  } else if (task.status === 'failed') {
    return await handleTaskFailed(media);
  } else {
    // queued 或 running，等待下次轮询
    return { media_id: media._id, status: task.status };
  }
}

/**
 * 处理任务成功：下载转存 + 通知
 */
async function handleTaskSuccess(media, task) {
  const db = cloud.database();

  const videoUrl = task.content?.video_url;
  if (!videoUrl) {
    throw new Error('任务成功但无视频 URL');
  }

  // 下载视频（URL 24h 失效，必须转存）
  const videoResp = await httpRequest(videoUrl);
  if (!videoResp.ok) {
    throw new Error(`下载视频失败: ${videoResp.status}`);
  }
  const buffer = Buffer.from(await videoResp.arrayBuffer());

  // 上传到云存储
  const cloudPath = `videos/${media._id}_${Date.now()}.mp4`;
  const uploadRes = await cloud.uploadFile({
    cloudPath,
    fileContent: buffer
  });

  // 更新 media_assets 为完成
  await db.collection('media_assets').doc(media._id).update({
    data: {
      status: 'done',
      file_id: uploadRes.fileID,
      'generation_meta.error': null,
      completed_at: db.serverDate()
    }
  });

  // 不再自动通知家长，由医生在医生端手动推送视频
  // notifyVideoDone 已移除，医生通过 pushVideo 云函数手动推送

  return {
    media_id: media._id,
    status: 'done',
    file_id: uploadRes.fileID
  };
}

/**
 * 处理任务失败：重试或标记失败
 */
async function handleTaskFailed(media) {
  const db = cloud.database();
  const _ = db.command;

  const currentRetries = (media.retries || 0) + 1;

  if (currentRetries > MAX_RETRIES) {
    // 超过最大重试次数，标记为失败
    await db.collection('media_assets').doc(media._id).update({
      data: {
        status: 'failed',
        retries: currentRetries,
        'generation_meta.error': `任务失败，已重试 ${MAX_RETRIES} 次`
      }
    });

    // 通知医生视频生成失败
    await notifyVideoFailed(media);

    return {
      media_id: media._id,
      status: 'failed',
      retries: currentRetries
    };
  }

  // 重新提交任务
  await resubmitTask(media, currentRetries);

  return {
    media_id: media._id,
    status: 'retrying',
    retries: currentRetries
  };
}

/**
 * 重新提交视频生成任务
 */
async function resubmitTask(media, retries) {
  const db = cloud.database();

  const resp = await httpRequest(`${ARK_BASE}/contents/generations/tasks`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getApiKey()}`
    },
    body: JSON.stringify({
      model: SEEDANCE_MODEL,
      content: [{ type: 'text', text: media.prompt }],
      resolution: '720p',
      ratio: '16:9',
      duration: 5,
      generate_audio: true,
      watermark: true
    })
  });

  const data = await resp.json();
  const newTaskId = data.id;

  if (!newTaskId) {
    throw new Error('重新提交任务未返回任务 ID');
  }

  await db.collection('media_assets').doc(media._id).update({
    data: {
      ark_task_id: newTaskId,
      retries
    }
  });
}

/**
 * 通知医生视频生成失败
 */
async function notifyVideoFailed(media) {
  const db = cloud.database();

  if (!media.report_id) return;

  // 获取报告对应的医生
  const reportRes = await db.collection('reports').doc(media.report_id).get();
  const report = reportRes.data;
  if (!report) return;

  const examRes = await db.collection('exams').doc(report.exam_id).get();
  const exam = examRes.data;
  if (!exam || !exam.doctor_id) return;

  try {
    await cloud.callFunction({
      name: 'sendNotification',
      data: {
        target_openid: exam.doctor_id,
        type: 'video_done',
        title: '视频生成失败',
        content: '科普视频生成失败，请稍后重试',
        related_id: media._id,
        template_data: {
          thing1: { value: '视频生成失败' },
          thing2: { value: '请稍后重试' }
        },
        sms_allowed: false
      }
    });
  } catch (err) {
    console.error(`视频失败通知发送失败: ${err.message}`);
  }
}
