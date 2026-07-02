const cloud = require('wx-server-sdk');
const https = require('https');
const http = require('http');
const { URL } = require('url');
const { getApiKey } = require('./lib/arkClient');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const ARK_BASE = 'https://ark.cn-beijing.volces.com/api/v3';
const SEEDREAM_MODEL = 'doubao-seedream-4-5-251128';

const LEVEL_PRIORITY = { severe: 0, moderate: 1, mild: 2, normal: 3 };

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

/**
 * 构建海报 prompt（主题+版式+内容文字+风格+尺寸）
 */
function buildPosterPrompt(theme, contentText) {
  return [
    '儿童健康科普海报',
    `主题：${theme}`,
    '版式：顶部大标题居中，中部温馨卡通插画，底部文字解读区域，右下角小字免责声明"AI生成内容仅供参考"',
    `内容文字："${contentText}"`,
    '风格：明亮温馨卡通风，柔和粉蓝色调，圆角卡片元素，适合家长阅读和朋友圈转发',
    '要求：文字清晰可读，排版整洁，信息层次分明'
  ].join('，');
}

/**
 * 从报告/自查内容构建海报文字
 */
function buildContentText(contentData) {
  const parts = [];
  if (contentData.summary) {
    parts.push(contentData.summary);
  }
  if (contentData.item_explanations && contentData.item_explanations.length > 0) {
    contentData.item_explanations.forEach(item => {
      parts.push(`${item.item}：${item.meaning}`);
    });
  }
  if (contentData.home_interventions && contentData.home_interventions.length > 0) {
    parts.push('家庭干预：');
    contentData.home_interventions.forEach(item => {
      parts.push(`·${item.detail}`);
    });
  }
  let text = parts.join('\n');
  if (text.length > 200) {
    text = text.substring(0, 200) + '...';
  }
  return text;
}

/**
 * 从异常项中提取最高等级主题
 */
function getTopTheme(abnormalItems) {
  if (!abnormalItems || abnormalItems.length === 0) {
    return '儿童健康体检';
  }
  const sorted = [...abnormalItems].sort(
    (a, b) => (LEVEL_PRIORITY[a.level] ?? 9) - (LEVEL_PRIORITY[b.level] ?? 9)
  );
  const top = sorted[0];
  return `${top.category}健康指导`;
}

exports.main = async (event, context) => {
  const { source, report_id, self_check_id } = event;

  // 参数校验
  if (!source || !['doctor', 'parent'].includes(source)) {
    return { code: 400, message: '无效的来源参数' };
  }
  if (source === 'doctor' && !report_id) {
    return { code: 400, message: '缺少 report_id' };
  }
  if (source === 'parent' && !self_check_id) {
    return { code: 400, message: '缺少 self_check_id' };
  }
  let apiKey;
  try {
    apiKey = getApiKey();
  } catch (e) {
    return { code: 500, message: e.message };
  }

  const db = cloud.database();

  // 获取解读内容
  let contentData;
  let theme;

  try {
    if (source === 'doctor') {
      const reportRes = await db.collection('reports').doc(report_id).get();
      const report = reportRes.data;
      if (!report) {
        return { code: 404, message: '报告不存在' };
      }
      contentData = report.doctor_content || report.ai_content;

      const examRes = await db.collection('exams').doc(report.exam_id).get();
      const exam = examRes.data;
      theme = getTopTheme(exam.abnormal_items);
    } else {
      const checkRes = await db.collection('self_checks').doc(self_check_id).get();
      const selfCheck = checkRes.data;
      if (!selfCheck) {
        return { code: 404, message: '自查记录不存在' };
      }
      contentData = selfCheck.ai_result;
      theme = '儿童健康自查指导';
    }

    if (!contentData) {
      return { code: 400, message: '无可用的解读内容' };
    }
  } catch (err) {
    return { code: 500, message: `数据查询失败: ${err.message}` };
  }

  const contentText = buildContentText(contentData);
  const prompt = buildPosterPrompt(theme, contentText);

  // 创建 media_assets 记录
  const addRes = await db.collection('media_assets').add({
    data: {
      report_id: source === 'doctor' ? report_id : null,
      self_check_id: source === 'parent' ? self_check_id : null,
      source,
      type: 'poster',
      status: 'generating',
      prompt,
      file_id: null,
      thumbnail_file_id: null,
      generation_meta: {
        model: SEEDREAM_MODEL,
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

  const startTime = Date.now();

  try {
    // 调用豆包 Seedream 文生图 API
    const resp = await httpRequest(`${ARK_BASE}/images/generations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: SEEDREAM_MODEL,
        prompt,
        size: '1440x2560',
        response_format: 'url',
        watermark: false
      })
    });

    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`Seedream API ${resp.status}: ${errText}`);
    }

    const data = await resp.json();
    const imgUrl = data.data[0].url;

    if (!imgUrl) {
      throw new Error('Seedream 返回无图片 URL');
    }

    // 下载图片（URL 24h 失效，必须转存）
    const imgResp = await httpRequest(imgUrl);
    if (!imgResp.ok) {
      throw new Error(`下载图片失败: ${imgResp.status}`);
    }
    const buffer = Buffer.from(await imgResp.arrayBuffer());

    // 上传到云存储
    const cloudPath = `posters/${mediaId}_${Date.now()}.jpg`;
    const uploadRes = await cloud.uploadFile({
      cloudPath,
      fileContent: buffer
    });

    const durationMs = Date.now() - startTime;

    // 更新 media_assets 为完成
    await db.collection('media_assets').doc(mediaId).update({
      data: {
        status: 'done',
        file_id: uploadRes.fileID,
        generation_meta: {
          model: SEEDREAM_MODEL,
          cost: null,
          duration_ms: durationMs,
          error: null
        },
        completed_at: db.serverDate()
      }
    });

    return {
      code: 0,
      message: '海报生成成功',
      data: {
        media_id: mediaId,
        file_id: uploadRes.fileID
      }
    };
  } catch (err) {
    const durationMs = Date.now() - startTime;

    // 更新 media_assets 为失败
    await db.collection('media_assets').doc(mediaId).update({
      data: {
        status: 'failed',
        generation_meta: {
          model: SEEDREAM_MODEL,
          cost: null,
          duration_ms: durationMs,
          error: err.message
        }
      }
    });

    return {
      code: 500,
      message: `海报生成失败: ${err.message}`
    };
  }
};
