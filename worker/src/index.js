/**
 * Router chính của Cloudflare Worker.
 *
 * Đường dẫn:
 *   GET  /                  -> trang chat web (dùng chung core với các kênh)
 *   POST /api/chat          -> API chat cho web widget
 *   GET  /webhook/facebook  -> Meta webhook (GET = challenge, POST = sự kiện)
 *   POST /webhook/zalo-bot  -> Zalo Bot webhook
 *   POST /webhook/zalo-oa   -> Zalo OA webhook
 *   GET  /admin             -> trang quản trị
 *   *    /api/admin/*       -> API quản trị (yêu cầu Bearer token)
 */

import {
  loadConfig,
  saveConfig,
  redactConfig,
  mergeConfig,
  mergeSecretFields,
  channelStatus,
} from './core/config.js';
import { makeEngines, handleMessage } from './core/conversation.js';
import * as fb from './channels/facebook.js';
import * as zbot from './channels/zalo-bot.js';
import * as zoa from './channels/zalo-oa.js';
import ADMIN_HTML from './pages/admin.html';
import CHAT_HTML from './pages/chat.html';

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' };

/* ----------------------------- tiện ích ----------------------------- */

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

function ok(data) {
  return json({ ok: true, ...data });
}

function fail(msg, status = 400) {
  return json({ ok: false, error: msg }, status);
}

/** Kiểm tra quyền admin qua header Authorization: Bearer <password>. */
function isAdmin(request, env) {
  const h = request.headers.get('Authorization') || '';
  const token = h.startsWith('Bearer ') ? h.slice(7).trim() : '';
  const expected = env.ADMIN_PASSWORD || '';
  if (!expected || !token) return false;
  if (token.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < token.length; i++) diff |= token.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

/** Ghi log vào KV (nếu có). */
async function logEvent(env, entry) {
  // In ra console để theo dõi trực tiếp trong wrangler tail / Cloudflare Logs
  const tag = entry.type === 'error' ? 'ERROR' : 'INFO';
  console.log(`[${tag}] ${entry.channel || 'app'} ${entry.type || ''}`, JSON.stringify(entry));

  if (!env.LOGS) return;
  try {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await env.LOGS.put(`log:${id}`, JSON.stringify({ ts: Date.now(), ...entry }), {
      expirationTtl: 60 * 60 * 24 * 30, // giữ 30 ngày
    });
  } catch (_) { /* log lỗi không được làm hỏng luồng chính */ }
}

/** Ghi lịch sử hội thoại để AI có ngữ cảnh các lượt trước. */
async function getHistory(env, channelKey, userId, limit = 6) {
  if (!env.LOGS) return [];
  try {
    const raw = await env.LOGS.get(`hist:${channelKey}:${userId}`, 'json');
    const arr = Array.isArray(raw) ? raw : [];
    return arr.slice(-limit);
  } catch (_) {
    return [];
  }
}

async function pushHistory(env, channelKey, userId, role, text) {
  if (!env.LOGS) return;
  try {
    const key = `hist:${channelKey}:${userId}`;
    const raw = await env.LOGS.get(key, 'json');
    const arr = Array.isArray(raw) ? raw : [];
    arr.push({ role, text: String(text).slice(0, 800) });
    while (arr.length > 20) arr.shift();
    await env.LOGS.put(key, JSON.stringify(arr), { expirationTtl: 60 * 60 * 24 * 7 });
  } catch (_) { /* im lặng */ }
}

/* ------------------------------ routes ------------------------------ */

async function handleFacebookWebhook(request, env, cfg, ctx) {
  const ch = cfg.channels.facebook;
  const url = new URL(request.url);

  // 1) GET -> Meta xác minh webhook
  //
  // LƯU Ý: bước verify KHÔNG yêu cầu ch.enabled = true.
  // Lý do: phải verify webhook trước rồi mới bật kênh (đúng trình tự Meta yêu cầu),
  // nếu chặn ở đây sẽ thành vòng tròn: cần token -> cần verify -> cần bật -> cần token.
  // Chỉ cần có verifyToken là verify được.
  if (request.method === 'GET') {
    if (!ch.verifyToken) return new Response('Verify token not configured', { status: 403 });
    return fb.handleChallenge(url, ch.verifyToken);
  }

  // 2) POST -> sự kiện (cần bật kênh)
  if (!ch.enabled) return new Response('Facebook channel disabled', { status: 403 });

  const rawBody = await request.text();
  const okSig = await fb.verifySignature(rawBody, request.headers.get('X-Hub-Signature-256'), ch.appSecret);
  if (!okSig) {
    await logEvent(env, { channel: 'facebook', type: 'invalid_signature' });
    return new Response('Invalid signature', { status: 401 });
  }

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch (_) {
    return new Response('Bad JSON', { status: 400 });
  }

  const events = fb.extractMessages(payload).filter((e) => !e.isEcho && e.text);
  if (!events.length) return ok({ handled: 0 });

  // Trả 200 ngay, xử lý bất đồng bộ -> đáp ứng yêu cầu <2s của Meta/Zalo
  const ctxWait = ctx.waitUntil.bind(ctx);
  ctxWait(
    (async () => {
      const { dvc, ai } = makeEngines(cfg);
      for (const ev of events) {
        try {
          const history = await getHistory(env, 'facebook', ev.senderId);
          const r = await handleMessage({
            dvc,
            ai,
            cfg,
            text: ev.text,
            channel: { id: 'facebook', aiEnabled: ch.aiEnabled },
            history,
          });
          await fb.sendMessages(ch, ev.senderId, r.messages);
          await pushHistory(env, 'facebook', ev.senderId, 'user', ev.text);
          await pushHistory(env, 'facebook', ev.senderId, 'bot', r.messages.join('\n'));
          await logEvent(env, {
            channel: 'facebook',
            type: 'reply',
            user: ev.senderId,
            engine: r.meta.engine,
            scope: r.meta.scope,
          });
        } catch (err) {
          await logEvent(env, { channel: 'facebook', type: 'error', error: String(err?.message || err) });
          try {
            await fb.sendMessage(ch, { recipientId: ev.senderId, text: cfg.errorMessage });
          } catch (_) { /* bỏ qua */ }
        }
      }
    })()
  );

  return ok({ handled: events.length });
}

async function handleZaloBotWebhook(request, env, cfg, ctx) {
  const ch = cfg.channels.zaloBot;
  if (!ch.enabled) return new Response('Zalo Bot channel disabled', { status: 403 });

  if (!zbot.verifySecret(request.headers.get('X-Bot-Api-Secret-Token'), ch.secretToken)) {
    await logEvent(env, { channel: 'zalo-bot', type: 'invalid_secret' });
    return new Response('Invalid secret token', { status: 401 });
  }

  let payload;
  try {
    payload = await request.json();
  } catch (_) {
    return new Response('Bad JSON', { status: 400 });
  }

  const events = zbot.extractMessages(payload);
  if (!events.length) return ok({ handled: 0 });

  const ctxWait = ctx.waitUntil.bind(ctx);
  ctxWait(
    (async () => {
      const { dvc, ai } = makeEngines(cfg);
      for (const ev of events) {
        try {
          const history = await getHistory(env, 'zalo-bot', ev.chatId);
          const r = await handleMessage({
            dvc,
            ai,
            cfg,
            text: ev.text,
            channel: { id: 'zalo-bot', aiEnabled: ch.aiEnabled },
            history,
          });
          await zbot.sendMessages(ch, ev.chatId, r.messages);
          await pushHistory(env, 'zalo-bot', ev.chatId, 'user', ev.text);
          await pushHistory(env, 'zalo-bot', ev.chatId, 'bot', r.messages.join('\n'));
          await logEvent(env, {
            channel: 'zalo-bot',
            type: 'reply',
            user: ev.chatId,
            engine: r.meta.engine,
          });
        } catch (err) {
          await logEvent(env, { channel: 'zalo-bot', type: 'error', error: String(err?.message || err) });
        }
      }
    })()
  );

  return ok({ handled: events.length });
}

async function handleZaloOaWebhook(request, env, cfg, ctx) {
  const ch = cfg.channels.zaloOa;
  if (!ch.enabled) return new Response('Zalo OA channel disabled', { status: 403 });

  const rawBody = await request.text();
  const timestamp = request.headers.get('X-ZEvent-Timestamp') || '';
  const sig = request.headers.get('X-ZEvent-Signature') || '';
  const sigOk = await zoa.verifySignature(
    sig,
    ch.appId,
    rawBody,
    timestamp,
    ch.secretKey
  );
  if (!sigOk) {
    await logEvent(env, { channel: 'zalo-oa', type: 'invalid_signature' });
    return new Response('Invalid signature', { status: 401 });
  }

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch (_) {
    return new Response('Bad JSON', { status: 400 });
  }

  const events = zoa.extractMessages(payload);
  if (!events.length) return ok({ handled: 0 });

  const ctxWait = ctx.waitUntil.bind(ctx);
  ctxWait(
    (async () => {
      const { dvc, ai } = makeEngines(cfg);
      for (const ev of events) {
        try {
          const history = await getHistory(env, 'zalo-oa', ev.senderId);
          const r = await handleMessage({
            dvc,
            ai,
            cfg,
            text: ev.text,
            channel: { id: 'zalo-oa', aiEnabled: ch.aiEnabled },
            history,
          });
          await zoa.sendMessages(ch, ev.replyMessageId, r.messages);
          await pushHistory(env, 'zalo-oa', ev.senderId, 'user', ev.text);
          await pushHistory(env, 'zalo-oa', ev.senderId, 'bot', r.messages.join('\n'));
          await logEvent(env, {
            channel: 'zalo-oa',
            type: 'reply',
            user: ev.senderId,
            engine: r.meta.engine,
          });
        } catch (err) {
          await logEvent(env, { channel: 'zalo-oa', type: 'error', error: String(err?.message || err) });
        }
      }
    })()
  );

  return ok({ handled: events.length });
}

/** API chat cho web widget. */
async function handleChatApi(request, env, cfg) {
  let body;
  try {
    body = await request.json();
  } catch (_) {
    return fail('Body phải là JSON');
  }

  const text = String(body?.text || '').trim();
  const sessionId = String(body?.sessionId || 'anon').slice(0, 80);
  if (!text) return fail('Thiếu nội dung câu hỏi');

  try {
    const { dvc, ai } = makeEngines(cfg);
    const history = await getHistory(env, 'web', sessionId);
    const r = await handleMessage({
      dvc,
      ai,
      cfg,
      text,
      channel: { id: 'web', aiEnabled: body.aiEnabled !== false },
      history,
    });
    await pushHistory(env, 'web', sessionId, 'user', text);
    await pushHistory(env, 'web', sessionId, 'bot', r.messages.join('\n'));
    return ok({
      messages: r.messages,
      engine: r.meta.engine,
      scope: r.meta.scope,
      kind: r.meta.kind,
    });
  } catch (err) {
    return fail(String(err?.message || err), 500);
  }
}

/** API quản trị. */
async function handleAdminApi(request, env, cfg, pathname) {
  if (!isAdmin(request, env)) return fail('Unauthorized', 401);

  // Lấy config
  if (pathname === '/api/admin/config' && request.method === 'GET') {
    return ok({ config: redactConfig(cfg), status: channelStatus(cfg) });
  }

  // ------------------------------------------------------------------
  //  Backup / Restore config — dùng cho bộ test tự động.
  //
  //  GET /api/admin/config trả về secrets đã che (••••••) nên không dùng
  //  để backup được. Endpoint này trả config GỐC (chưa che), chỉ dành cho
  //  script test nội bộ — cần đúng Bearer token admin.
  // ------------------------------------------------------------------
  if (pathname === '/api/admin/config-raw' && request.method === 'GET') {
    return ok({ config: cfg });
  }

  if (pathname === '/api/admin/config-raw' && request.method === 'POST') {
    let body;
    try {
      body = await request.json();
    } catch (_) {
      return fail('Body phải là JSON');
    }
    const raw = body?.config;
    if (!raw || typeof raw !== 'object') return fail('Thiếu config');
    await saveConfig(env, mergeConfig(raw));
    await logEvent(env, { channel: 'admin', type: 'config_restored' });
    return ok({ config: redactConfig(cfg), status: channelStatus(cfg) });
  }

  // Lưu config
  if (pathname === '/api/admin/config' && request.method === 'POST') {
    let body;
    try {
      body = await request.json();
    } catch (_) {
      return fail('Body phải là JSON');
    }
    const incoming = body?.config || body;
    const merged = mergeSecretFields(incoming, cfg);
    await saveConfig(env, merged);    await logEvent(env, { channel: 'admin', type: 'config_saved' });
    return ok({ config: redactConfig(merged), status: channelStatus(merged) });
  }

  // Kiểm tra kết nối từng kênh
  if (pathname === '/api/admin/test' && request.method === 'POST') {
    let body;
    try {
      body = await request.json();
    } catch (_) {
      return fail('Body phải là JSON');
    }
    const target = body?.channel;
    const results = {};

    if (target === 'facebook') {
      const ch = cfg.channels.facebook;
      if (!ch.pageId || !ch.pageAccessToken) {
        results.facebook = { ok: false, error: 'Thiếu Page ID hoặc Page Access Token' };
      } else {
        try {
          const res = await fetch(
            `https://graph.facebook.com/v26.0/${ch.pageId}?access_token=${encodeURIComponent(ch.pageAccessToken)}`
          );
          const j = await res.json();
          results.facebook = res.ok && j.id
            ? { ok: true, detail: `Đã kết nối tới Page: ${j.name} (${j.id})` }
            : { ok: false, error: j.error?.message || `HTTP ${res.status}` };
        } catch (err) {
          results.facebook = { ok: false, error: String(err?.message || err) };
        }
      }
    }

    if (target === 'zalo-bot') {
      const ch = cfg.channels.zaloBot;
      if (!ch.botToken) {
        results.zaloBot = { ok: false, error: 'Thiếu Bot Token' };
      } else {
        try {
          const j = await zbot.getWebhookInfo(ch);
          results.zaloBot = j?.ok
            ? { ok: true, detail: `Webhook đã đăng ký: ${j.result?.url || '(chưa có)'}` }
            : { ok: false, error: JSON.stringify(j).slice(0, 200) };
        } catch (err) {
          results.zaloBot = { ok: false, error: String(err?.message || err) };
        }
      }
    }

    if (target === 'zalo-oa') {
      const ch = cfg.channels.zaloOa;
      if (!ch.accessToken) {
        results.zaloOa = { ok: false, error: 'Thiếu Access Token' };
      } else {
        try {
          const res = await fetch('https://openapi.zalo.me/v2.0/oa/getprofile', {
            method: 'GET',
            headers: { access_token: ch.accessToken },
          });
          const j = await res.json();
          results.zaloOa = j?.error === 0
            ? { ok: true, detail: `Đã kết nối tới OA: ${j.data?.name || ch.oaId}` }
            : { ok: false, error: j?.message || `HTTP ${res.status}` };
        } catch (err) {
          results.zaloOa = { ok: false, error: String(err?.message || err) };
        }
      }
    }

    if (target === 'dvc') {
      try {
        const { dvc } = makeEngines(cfg);
        const h = await dvc.health();
        results.dvc = h?.ok
          ? { ok: true, detail: 'Kết nối DVC thành công' }
          : { ok: false, error: JSON.stringify(h) };
      } catch (err) {
        results.dvc = { ok: false, error: String(err?.message || err) };
      }
    }

    if (target === 'ai') {
      const { ai } = makeEngines(cfg);
      if (!ai.hasGemini && !ai.hasCfAi) {
        results.ai = { ok: false, error: 'Chưa cấu hình API key AI nào' };
      } else {
        const r = await ai.ask('Xin chào, bạn khoẻ không?', 'Không có dữ liệu tra cứu.');
        results.ai = r.text
          ? { ok: true, detail: `Phản hồi qua ${r.engine}: "${r.text.slice(0, 80)}"` }
          : { ok: false, error: 'AI không phản hồi (có thể hết quota hoặc sai API key)' };
      }
    }

    return ok({ results });
  }

  // Thống kê
  if (pathname === '/api/admin/stats' && request.method === 'GET') {
    let totals = {};
    if (env.LOGS) {
      try {
        const list = await env.LOGS.list({ prefix: 'log:', limit: 1000 });
        const byChannel = {};
        let replies = 0;
        let errors = 0;
        const engines = {};
        for (const k of list.keys) {
          const e = await env.LOGS.get(k.name, 'json').catch(() => null);
          if (!e) continue;
          if (e.type === 'reply') {
            replies++;
            byChannel[e.channel] = (byChannel[e.channel] || 0) + 1;
            engines[e.engine] = (engines[e.engine] || 0) + 1;
          }
          if (e.type === 'error') errors++;
        }
        totals = { replies, errors, byChannel, engines, sampled: list.keys.length };
      } catch (_) { /* im lặng */ }
    }
    return ok({ stats: totals });
  }

  // Lịch sử hội thoại (theo kênh + user)
  if (pathname === '/api/admin/history' && request.method === 'GET') {
    const url = new URL(request.url);
    const channelKey = url.searchParams.get('channel') || 'facebook';
    const userId = url.searchParams.get('user');
    if (!userId) return fail('Thiếu tham số user');
    const hist = await getHistory(env, channelKey, userId, 50);
    return ok({ history: hist });
  }

  // Test gửi tin thử (cho admin xem kết quả thật)
  if (pathname === '/api/admin/simulate' && request.method === 'POST') {
    let body;
    try {
      body = await request.json();
    } catch (_) {
      return fail('Body phải là JSON');
    }
    const text = String(body?.text || '').trim();
    if (!text) return fail('Thiếu câu hỏi');
    try {
      const { dvc, ai } = makeEngines(cfg);
      const r = await handleMessage({
        dvc,
        ai,
        cfg,
        text,
        channel: { id: 'simulate', aiEnabled: body.aiEnabled !== false },
      });
      return ok({ messages: r.messages, engine: r.meta.engine, scope: r.meta.scope });
    } catch (err) {
      return fail(String(err?.message || err), 500);
    }
  }

  // Đăng ký webhook Zalo Bot từ trang quản trị
  if (pathname === '/api/admin/zalo-bot-webhook' && request.method === 'POST') {
    let body;
    try {
      body = await request.json();
    } catch (_) {
      return fail('Body phải là JSON');
    }
    const url = String(body?.url || '').trim();
    if (!url || !/^https:\/\//.test(url)) return fail('URL webhook phải bắt đầu bằng https://');
    if (!cfg.channels.zaloBot.botToken) return fail('Chưa cấu hình Bot Token');
    try {
      const r = await zbot.setWebhook(cfg.channels.zaloBot, url);
      return ok({ result: r });
    } catch (err) {
      return fail(String(err?.message || err), 500);
    }
  }

  return fail('Not found', 404);
}

/* ------------------------------ router ------------------------------ */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const pathname = url.pathname;

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        },
      });
    }

    let cfg;
    try {
      cfg = await loadConfig(env);
    } catch (err) {
      return fail(`Lỗi tải cấu hình: ${String(err?.message || err)}`, 500);
    }

    try {
      if (pathname === '/webhook/facebook') {
        return await handleFacebookWebhook(request, env, cfg, ctx);
      }
      if (pathname === '/webhook/zalo-bot') {
        return await handleZaloBotWebhook(request, env, cfg, ctx);
      }
      if (pathname === '/webhook/zalo-oa') {
        return await handleZaloOaWebhook(request, env, cfg, ctx);
      }
      if (pathname === '/api/chat' && request.method === 'POST') {
        return await handleChatApi(request, env, cfg);
      }
      if (pathname.startsWith('/api/admin/')) {
        return await handleAdminApi(request, env, cfg, pathname);
      }
      if (pathname === '/admin' || pathname === '/admin/') {
        return new Response(ADMIN_HTML, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
      }
      if (pathname === '/api/health') {
        return ok({ status: 'ok', channels: channelStatus(cfg) });
      }
      if (pathname === '/') {
        return new Response(CHAT_HTML, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
      }
      return new Response('Not found', { status: 404 });
    } catch (err) {
      await logEvent(env, { channel: 'router', type: 'error', path: pathname, error: String(err?.message || err) });
      return fail(String(err?.message || err), 500);
    }
  },

  /** Cron: làm mới access token Zalo OA (tránh token hết hạn). */
  async scheduled(event, env, ctx) {
    const cfg = await loadConfig(env);
    const ch = cfg.channels.zaloOa;
    if (!ch.enabled || !ch.refreshToken || !ch.secretKey) return;

    try {
      const r = await zoa.refreshAccessToken(ch);
      if (r?.access_token) {
        ch.accessToken = r.access_token;
        if (r.refresh_token) ch.refreshToken = r.refresh_token;
        await saveConfig(env, ch === cfg.channels.zaloOa ? cfg : cfg);
        await logEvent(env, { channel: 'zalo-oa', type: 'token_refreshed' });
      }
    } catch (err) {
      await logEvent(env, { channel: 'zalo-oa', type: 'token_refresh_failed', error: String(err?.message || err) });
    }
  },
};
