/**
 * vmail - Cloudflare Worker 临时邮箱服务
 *
 * 功能：
 * - 接收邮件（通过 Cloudflare Email Routing）
 * - 生成随机邮箱地址
 * - 通过 API 查询邮件
 */

// 生成随机邮箱前缀
function generateRandomPrefix(length = 10) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// 解析邮件内容
async function parseEmail(message) {
  const rawEmail = await new Response(message.raw).text();

  // 简单解析邮件头
  const headers = {};
  const headerSection = rawEmail.split('\r\n\r\n')[0] || rawEmail.split('\n\n')[0];
  const headerLines = headerSection.split(/\r?\n/);

  let currentHeader = '';
  for (const line of headerLines) {
    if (line.match(/^\s+/)) {
      // 续行
      headers[currentHeader] += ' ' + line.trim();
    } else {
      const match = line.match(/^([^:]+):\s*(.*)$/);
      if (match) {
        currentHeader = match[1].toLowerCase();
        headers[currentHeader] = match[2];
      }
    }
  }

  // 提取正文
  const bodyStart = rawEmail.indexOf('\r\n\r\n');
  const body = bodyStart > 0 ? rawEmail.substring(bodyStart + 4) : '';

  return {
    from: message.from,
    to: message.to,
    subject: headers['subject'] || '(无主题)',
    date: headers['date'] || new Date().toISOString(),
    body: body.substring(0, 10000), // 限制正文长度
    raw: rawEmail.substring(0, 50000), // 限制原始邮件长度
  };
}

// API 路由处理
async function handleRequest(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;

  // CORS 头
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };

  // 处理 OPTIONS 请求
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // API 密钥验证（如果设置了）
  if (env.API_KEY) {
    const authHeader = request.headers.get('Authorization');
    const token = authHeader?.replace('Bearer ', '');
    if (token !== env.API_KEY) {
      return jsonResponse({ error: 'Unauthorized' }, 401, corsHeaders);
    }
  }

  // 路由
  if (path === '/api/generate' && request.method === 'POST') {
    return handleGenerate(request, env, corsHeaders);
  }

  if (path === '/api/emails' && request.method === 'GET') {
    return handleGetEmails(request, env, corsHeaders);
  }

  if (path.startsWith('/api/email/') && request.method === 'GET') {
    const emailId = path.replace('/api/email/', '');
    return handleGetEmail(emailId, env, corsHeaders);
  }

  if (path.startsWith('/api/email/') && request.method === 'DELETE') {
    const emailId = path.replace('/api/email/', '');
    return handleDeleteEmail(emailId, env, corsHeaders);
  }

  if (path === '/api/inbox' && request.method === 'GET') {
    return handleGetInbox(request, env, corsHeaders);
  }

  if (path === '/' || path === '/health') {
    return jsonResponse({ status: 'ok', service: 'vmail' }, 200, corsHeaders);
  }

  return jsonResponse({ error: 'Not Found' }, 404, corsHeaders);
}

// 生成新邮箱
async function handleGenerate(request, env, corsHeaders) {
  let domain = 'example.com'; // 默认域名，需要替换为实际域名

  try {
    const body = await request.json();
    if (body.domain) {
      domain = body.domain;
    }
  } catch (e) {
    // 使用默认值
  }

  const prefix = generateRandomPrefix(12);
  const email = `${prefix}@${domain}`;
  const ttl = parseInt(env.EMAIL_TTL) || 3600;

  // 在 KV 中注册邮箱
  await env.EMAILS.put(`inbox:${email}`, JSON.stringify({
    email: email,
    created: new Date().toISOString(),
    messages: []
  }), { expirationTtl: ttl * 2 }); // 邮箱有效期是邮件的2倍

  return jsonResponse({
    email: email,
    expires_in: ttl,
    expires_at: new Date(Date.now() + ttl * 1000).toISOString()
  }, 200, corsHeaders);
}

// 获取邮箱的所有邮件
async function handleGetInbox(request, env, corsHeaders) {
  const url = new URL(request.url);
  const email = url.searchParams.get('email');

  if (!email) {
    return jsonResponse({ error: 'Missing email parameter' }, 400, corsHeaders);
  }

  // 获取该邮箱的所有邮件 ID
  const inboxData = await env.EMAILS.get(`inbox:${email}`);
  if (!inboxData) {
    return jsonResponse({ error: 'Inbox not found or expired' }, 404, corsHeaders);
  }

  const inbox = JSON.parse(inboxData);
  const messages = [];

  // 获取每封邮件的摘要
  for (const msgId of inbox.messages || []) {
    const msgData = await env.EMAILS.get(`msg:${msgId}`);
    if (msgData) {
      const msg = JSON.parse(msgData);
      messages.push({
        id: msgId,
        from: msg.from,
        subject: msg.subject,
        date: msg.date,
      });
    }
  }

  return jsonResponse({
    email: email,
    messages: messages,
    count: messages.length
  }, 200, corsHeaders);
}

// 获取所有邮件列表（管理用）
async function handleGetEmails(request, env, corsHeaders) {
  const url = new URL(request.url);
  const limit = parseInt(url.searchParams.get('limit')) || 50;

  // 列出所有邮件
  const list = await env.EMAILS.list({ prefix: 'msg:', limit: limit });
  const emails = [];

  for (const key of list.keys) {
    const data = await env.EMAILS.get(key.name);
    if (data) {
      const email = JSON.parse(data);
      emails.push({
        id: key.name.replace('msg:', ''),
        from: email.from,
        to: email.to,
        subject: email.subject,
        date: email.date,
      });
    }
  }

  return jsonResponse({ emails: emails, count: emails.length }, 200, corsHeaders);
}

// 获取单封邮件详情
async function handleGetEmail(emailId, env, corsHeaders) {
  const data = await env.EMAILS.get(`msg:${emailId}`);
  if (!data) {
    return jsonResponse({ error: 'Email not found' }, 404, corsHeaders);
  }

  return jsonResponse(JSON.parse(data), 200, corsHeaders);
}

// 删除邮件
async function handleDeleteEmail(emailId, env, corsHeaders) {
  await env.EMAILS.delete(`msg:${emailId}`);
  return jsonResponse({ success: true }, 200, corsHeaders);
}

// JSON 响应辅助函数
function jsonResponse(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    status: status,
    headers: {
      'Content-Type': 'application/json',
      ...extraHeaders
    }
  });
}

// 邮件接收处理
async function handleEmail(message, env) {
  const to = message.to;
  const ttl = parseInt(env.EMAIL_TTL) || 3600;

  // 解析邮件
  const parsed = await parseEmail(message);

  // 生成唯一 ID
  const msgId = `${Date.now()}-${generateRandomPrefix(8)}`;

  // 保存邮件
  await env.EMAILS.put(`msg:${msgId}`, JSON.stringify({
    id: msgId,
    ...parsed,
    received: new Date().toISOString()
  }), { expirationTtl: ttl });

  // 更新收件箱
  const inboxKey = `inbox:${to}`;
  const inboxData = await env.EMAILS.get(inboxKey);

  if (inboxData) {
    const inbox = JSON.parse(inboxData);
    inbox.messages = inbox.messages || [];
    inbox.messages.push(msgId);
    await env.EMAILS.put(inboxKey, JSON.stringify(inbox), { expirationTtl: ttl * 2 });
  } else {
    // 自动创建收件箱
    await env.EMAILS.put(inboxKey, JSON.stringify({
      email: to,
      created: new Date().toISOString(),
      messages: [msgId]
    }), { expirationTtl: ttl * 2 });
  }

  console.log(`Received email for ${to}: ${parsed.subject}`);
}

// 导出
export default {
  async fetch(request, env, ctx) {
    return handleRequest(request, env);
  },

  async email(message, env, ctx) {
    await handleEmail(message, env);
  }
};
