/**
 * Bộ kiểm thử tự động — chạy không cần can thiệp.
 *
 * Kiểm tra 4 lớp:
 *   1. Unit test logic lõi (NLU, truy xuất, định dạng)
 *   2. Unit test adapter Facebook (chữ ký HMAC, challenge)
 *   3. Unit test quản lý cấu hình (mask/merge secret)
 *   4. Kiểm tra tích hợp: Worker local + API DVC thật + webhook
 *
 * Kết quả ghi ra:
 *   test-results/latest.json   (máy đọc được)
 *   test-results/latest.md     (người đọc được)
 *   test-results/history.log   (lịch sử các lần chạy)
 *
 * Chạy:  node test/auto.mjs
 */

import { execFile } from 'node:child_process';
import { writeFileSync, mkdirSync, appendFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const OUT = join(ROOT, 'test-results');
const BASE = process.env.WORKER_URL || 'http://127.0.0.1:8787';
const ADMIN_PW = process.env.ADMIN_PASSWORD || 'changeme';

mkdirSync(OUT, { recursive: true });

const results = [];
let startedAt = Date.now();

function record(group, name, ok, detail = '') {
  results.push({ group, name, ok: Boolean(ok), detail: String(detail).slice(0, 300) });
  const mark = ok ? '✔' : '✖';
  console.log(`  ${mark} ${name}${ok ? '' : '  -> ' + detail}`);
}

/** Chạy một file test con, trả về { code, stdout, stderr }. */
function runNode(scriptPath, timeoutMs = 120000) {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [scriptPath],
      { cwd: ROOT, timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout, stderr) => {
        resolve({
          code: err ? (err.code === undefined ? 1 : err.code) : 0,
          stdout: stdout || '',
          stderr: stderr || '',
        });
      }
    );
  });
}

/** Parse dòng kết quả "KẾT QUẢ: X đạt, Y lỗi" từ stdout. */
function parseSummary(stdout) {
  const m = stdout.match(/KẾT QUẢ:\s*(\d+)\s*đạt,\s*(\d+)\s*lỗi/);
  if (!m) return { pass: 0, fail: 0 };
  return { pass: Number(m[1]), fail: Number(m[2]) };
}

/** Gọi HTTP và trả { status, text, json }.
 *  Nếu `body` là string thì gửi nguyên văn (dùng cho kiểm tra chữ ký HMAC),
 *  nếu là object thì tự JSON.stringify. */
async function http(path, { method = 'GET', body, headers = {}, timeout = 60000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  const isRaw = typeof body === 'string';
  try {
    const res = await fetch(BASE + path, {
      method,
      headers: {
        ...(body && !isRaw ? { 'Content-Type': 'application/json' } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : isRaw ? body : JSON.stringify(body),
      signal: ctrl.signal,
    });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch (_) { /* không phải JSON */ }
    return { status: res.status, text, json };
  } catch (err) {
    return { status: 0, text: String(err?.message || err), json: null };
  } finally {
    clearTimeout(timer);
  }
}

/** Chờ Worker local sẵn sàng. */
async function waitForWorker(timeoutSec = 60) {
  const deadline = Date.now() + timeoutSec * 1000;
  while (Date.now() < deadline) {
    const r = await http('/api/health', { timeout: 3000 });
    if (r.status === 200) return true;
    await new Promise((res) => setTimeout(res, 1500));
  }
  return false;
}

function section(t) {
  console.log(`\n=== ${t} ===`);
}

/* ------------------------------------------------------------------ */
/* 1. Unit test các module                                             */
/* ------------------------------------------------------------------ */
async function runUnitSuites() {
  const suites = [
    ['core', join(__dirname, 'core.test.mjs')],
    ['facebook', join(__dirname, 'facebook.test.mjs')],
    ['config', join(__dirname, 'config.test.mjs')],
  ];

  for (const [group, path] of suites) {
    section(`Unit: ${group}`);
    const r = await runNode(path);
    const s = parseSummary(r.stdout);
    record(
      group,
      `suite ${group}.test.mjs chạy thành công`,
      r.code === 0 && s.fail === 0,
      r.code !== 0
        ? `exit=${r.code}; ${(r.stderr || r.stdout).split('\n').slice(-6).join(' | ')}`
        : `${s.pass} đạt, ${s.fail} lỗi`
    );
    record(group, `suite ${group} không có lỗi`, s.fail === 0, `${s.fail} lỗi`);
  }
}

/* ------------------------------------------------------------------ */
/* 2. Tích hợp: Worker local                                           */
/* ------------------------------------------------------------------ */
async function runIntegration() {
  section('Tích hợp: Worker local');

  const up = await waitForWorker();
  record('integration', 'Worker khởi động và trả lời /api/health', up, `không kết nối được ${BASE}`);
  if (!up) return;

  const health = await http('/api/health');
  record('integration', 'GET /api/health trả ok=true', health.json?.ok === true, health.text.slice(0, 120));
  record(
    'integration',
    'health báo đủ 3 kênh (facebook, zaloBot, zaloOa)',
    health.json?.channels &&
      health.json.channels.facebook &&
      health.json.channels.zaloBot &&
      health.json.channels.zaloOa,
    JSON.stringify(health.json?.channels || {}).slice(0, 120)
  );

  // --- Chat: câu hỏi có địa danh ---
  const c1 = await http('/api/chat', {
    method: 'POST',
    body: {
      text: 'cần hồ sơ gì để đăng ký kết hôn tại xã Xuân Lãng',
      sessionId: 'auto-test-1',
    },
  });
  const m1 = (c1.json?.messages || []).join(' ');
  record('integration', 'POST /api/chat trả ok=true', c1.json?.ok === true, c1.text.slice(0, 150));
  record('integration', 'chat lọc đúng phạm vi xã (scope=ward)', c1.json?.scope === 'ward', `scope=${c1.json?.scope}`);
  record('integration', 'chat nhắc tới thủ tục kết hôn', /kết hôn/i.test(m1), m1.slice(0, 120));
  record('integration', 'chat có mã thủ tục', /1\.000894/.test(m1), m1.slice(0, 120));
  record('integration', 'chat có link nộp trực tuyến', /https?:\/\//.test(m1), m1.slice(0, 120));
  record(
    'integration',
    'mọi tin nhắn <= 2000 ký tự',
    (c1.json?.messages || []).every((x) => x.length <= 2000),
    'vượt giới hạn Zalo/Messenger'
  );

  // --- Chat: mã thủ tục ---
  const c2 = await http('/api/chat', {
    method: 'POST',
    body: { text: '1.000894', sessionId: 'auto-test-2' },
  });
  const m2 = (c2.json?.messages || []).join(' ');
  record('integration', 'chat theo mã thủ tục -> kind=detail', c2.json?.kind === 'detail', `kind=${c2.json?.kind}`);
  record('integration', 'chi tiết có phần hồ sơ', /hồ sơ/i.test(m2), m2.slice(0, 120));

  // --- Chat: câu hỏi không liên quan -> fallback ---
  const c3 = await http('/api/chat', {
    method: 'POST',
    body: { text: 'xyzabc khoong ton tai gi ca', sessionId: 'auto-test-3' },
  });
  record(
    'integration',
    'câu hỏi vô nghĩa -> trả fallback, không crash',
    c3.json?.ok === true && (c3.json?.messages || []).length > 0,
    c3.text.slice(0, 120)
  );

  // --- Admin: xác thực ---
  const noAuth = await http('/api/admin/config');
  record('admin', 'admin API chặn request không token (401)', noAuth.status === 401, `status=${noAuth.status}`);

  const withAuth = await http('/api/admin/config', {
    headers: { Authorization: `Bearer ${ADMIN_PW}` },
  });
  record('admin', 'admin API chấp nhận token đúng', withAuth.json?.ok === true, withAuth.text.slice(0, 120));

  // ==========================================================
  //  BACKUP cấu hình thật
  //
  //  Bộ test ghi đè config (bật kênh, đổi appSecret, xoá token...).
  //  Nếu chạy trên PRODUCTION, phải khôi phục lại nguyên trạng,
  //  nếu không cấu hình thật của người dùng sẽ bị mất!
  //
  //  Dùng /api/admin/config-raw vì /api/admin/config che secrets (••••••).
  // ==========================================================
  const backupRes = await http('/api/admin/config-raw', {
    headers: { Authorization: `Bearer ${ADMIN_PW}` },
  });
  const savedBackup = backupRes.json?.config;
  if (!savedBackup) {
    console.warn('  ⚠ Không đọc được bản backup cấu hình — sẽ không khôi phục');
  } else {
    console.log('  ℹ Đã backup cấu hình thật (sẽ khôi phục sau test)');
  }

  record(
    'admin',
    'secret được che (không lộ token)',
    withAuth.json?.config?.ai?.geminiApiKey !== 'AIza' && withAuth.json?.config?.ai?.geminiApiKey !== undefined,
    `geminiApiKey=${JSON.stringify(withAuth.json?.config?.ai?.geminiApiKey)}`
  );
  record(
    'admin',
    'config có đủ 3 kênh',
    !!(withAuth.json?.config?.channels?.facebook &&
      withAuth.json?.config?.channels?.zaloBot &&
      withAuth.json?.config?.channels?.zaloOa),
    'thiếu kênh'
  );

  // --- Admin: lưu config rồi đọc lại ---
  const saved = await http('/api/admin/config', {
    method: 'POST',
    headers: { Authorization: `Bearer ${ADMIN_PW}` },
    body: {
      config: {
        siteName: 'Trợ lý tra cứu thủ tục hành chính UBND xã Xuân Lãng',
        channels: {
          // Bật kênh Facebook để kiểm tra webhook thật sự hoạt động
          facebook: { enabled: true, pageId: '987654321', verifyToken: 'auto-test-vt' },
        },
      },
    },
  });
  record('admin', 'lưu config partial thành công', saved.json?.ok === true, saved.text.slice(0, 150));

  const reread = await http('/api/admin/config', {
    headers: { Authorization: `Bearer ${ADMIN_PW}` },
  });
  record(
    'admin',
    'config đọc lại giữ nguyên pageId vừa lưu',
    reread.json?.config?.channels?.facebook?.pageId === '987654321',
    `pageId=${reread.json?.config?.channels?.facebook?.pageId}`
  );
  record(
    'admin',
    'các field khác không bị mất khi lưu partial',
    !!reread.json?.config?.ai?.geminiModel && !!reread.json?.config?.defaultWardCode,
    'mất field'
  );

  // --- Trang HTML ---
  const adminHtml = await http('/admin');
  record('ui', 'GET /admin trả về trang quản trị', adminHtml.status === 200 && /Quản trị/.test(adminHtml.text), `status=${adminHtml.status}`);
  const chatHtml = await http('/');
  record('ui', 'GET / trả về trang chat', chatHtml.status === 200 && /Tra cứu|tra cứu/i.test(chatHtml.text), `status=${chatHtml.status}`);

  // --- Webhook Facebook: challenge ---
  const chOk = await http('/webhook/facebook?hub.mode=subscribe&hub.verify_token=auto-test-vt&hub.challenge=ECHO_OK');
  record(
    'facebook',
    'webhook challenge với verify token đúng -> trả challenge',
    chOk.status === 200 && chOk.text.includes('ECHO_OK'),
    `status=${chOk.status} body=${chOk.text.slice(0, 80)}`
  );

  const chBad = await http('/webhook/facebook?hub.mode=subscribe&hub.verify_token=SAI&hub.challenge=1');
  record('facebook', 'webhook challenge với token sai -> 403', chBad.status === 403, `status=${chBad.status}`);

  // --- Webhook Facebook: chữ ký HMAC thật ---
  const secret = 'auto-test-app-secret';
  const payload = JSON.stringify({
    object: 'page',
    entry: [
      { messaging: [{ sender: { id: 'AUTO_TEST' }, message: { mid: 'm1', text: 'xin chào' } }] },
    ],
  });
  const { computeSignatureForTest } = await import(join(ROOT, 'src/channels/facebook.js'));
  const realSig = await computeSignatureForTest(payload, secret);

  // Lưu appSecret để bật kiểm tra chữ ký
  await http('/api/admin/config', {
    method: 'POST',
    headers: { Authorization: `Bearer ${ADMIN_PW}` },
    body: { config: { channels: { facebook: { appSecret: secret } } } },
  });

  const sigBad = await http('/webhook/facebook', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Hub-Signature-256': 'sha256=' + '0'.repeat(64),
    },
    body: payload,
  });
  record(
    'facebook',
    'webhook POST với chữ ký sai -> 401 (từ chối)',
    sigBad.status === 401,
    `status=${sigBad.status} body=${sigBad.text.slice(0, 100)}`
  );

  const sigGood = await http('/webhook/facebook', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Hub-Signature-256': realSig,
    },
    body: payload,
  });
  record(
    'facebook',
    'webhook POST với chữ ký đúng -> 200 (nhận sự kiện)',
    sigGood.status === 200 && sigGood.json?.ok === true,
    `status=${sigGood.status} body=${sigGood.text.slice(0, 100)}`
  );

  // --- Webhook Zalo Bot: secret sai ---
  const zbBad = await http('/webhook/zalo-bot', {
    method: 'POST',
    headers: { 'X-Bot-Api-Secret-Token': 'sai-token' },
    body: { event_name: 'message.text.received', message: { text: 'hi' } },
  });
  record('zalo-bot', 'webhook Zalo Bot chặn secret sai', zbBad.status === 401 || zbBad.status === 403, `status=${zbBad.status}`);

  // --- Dọn dẹp: xoá hết cấu hình Facebook test ---
  await http('/api/admin/config', {
    method: 'POST',
    headers: { Authorization: `Bearer ${ADMIN_PW}` },
    body: {
      config: {
        channels: {
          facebook: {
            enabled: false,
            appSecret: '',
            pageId: '',
            verifyToken: '',
            pageAccessToken: '',
          },
        },
      },
    },
  });
  // Sau khi xoá verifyToken -> GET challenge phải bị từ chối
  const fbOff = await http('/webhook/facebook?hub.mode=subscribe&hub.verify_token=x&hub.challenge=1');
  record(
    'facebook',
    'chưa có verifyToken -> webhook challenge từ chối (403)',
    fbOff.status === 403,
    `status=${fbOff.status}`
  );

  // --- Verify token đã đặt nhưng kênh CHƯA bật -> GET challenge vẫn phải trả challenge ---
  // (đúng trình tự Meta: verify webhook trước, bật kênh sau)
  await http('/api/admin/config', {
    method: 'POST',
    headers: { Authorization: `Bearer ${ADMIN_PW}` },
    body: {
      config: {
        channels: {
          facebook: { enabled: false, verifyToken: 'test-verify-token-abc' },
        },
      },
    },
  });
  const fbChallengeWhileOff = await http(
    '/webhook/facebook?hub.mode=subscribe&hub.verify_token=test-verify-token-abc&hub.challenge=chal_999'
  );
  record(
    'facebook',
    'kênh chưa bật nhưng có verifyToken -> challenge vẫn trả về (để verify trước)',
    fbChallengeWhileOff.status === 200 && fbChallengeWhileOff.text.includes('chal_999'),
    `status=${fbChallengeWhileOff.status} body=${fbChallengeWhileOff.text.slice(0, 60)}`
  );

  // --- POST sự kiện khi kênh chưa bật -> phải từ chối 403 ---
  const fbPostWhileOff = await http('/webhook/facebook', {
    method: 'POST',
    headers: { 'X-Hub-Signature-256': 'sha256=bad' },
    body: { object: 'page', entry: [] },
  });
  record(
    'facebook',
    'kênh chưa bật -> POST sự kiện bị từ chối (403)',
    fbPostWhileOff.status === 403,
    `status=${fbPostWhileOff.status}`
  );

  // --- Dọn dẹp: xoá hết verifyToken ---
  await http('/api/admin/config', {
    method: 'POST',
    headers: { Authorization: `Bearer ${ADMIN_PW}` },
    body: {
      config: {
        channels: {
          facebook: { enabled: false, appSecret: '', pageId: '', verifyToken: '', pageAccessToken: '' },
        },
      },
    },
  });

  // ==========================================================
  //  RESTORE cấu hình thật (quan trọng khi test trên PRODUCTION)
  // ==========================================================
  if (savedBackup) {
    await http('/api/admin/config-raw', {
      method: 'POST',
      headers: { Authorization: `Bearer ${ADMIN_PW}` },
      body: { config: savedBackup },
    });
    const after = await http('/api/admin/config-raw', {
      headers: { Authorization: `Bearer ${ADMIN_PW}` },
    });
    const fb = after.json?.config?.channels?.facebook || {};
    const ok =
      fb.enabled === savedBackup.channels?.facebook?.enabled &&
      (fb.pageId || '') === (savedBackup.channels?.facebook?.pageId || '') &&
      (fb.verifyToken || '') === (savedBackup.channels?.facebook?.verifyToken || '') &&
      (fb.pageAccessToken || '') === (savedBackup.channels?.facebook?.pageAccessToken || '') &&
      (fb.appSecret || '') === (savedBackup.channels?.facebook?.appSecret || '');
    record(
      'admin',
      'khôi phục lại cấu hình thật sau test',
      ok,
      `enabled=${fb.enabled} pageId=${fb.pageId} vt=${fb.verifyToken} token=${!!fb.pageAccessToken} secret=${!!fb.appSecret}`
    );
    console.log(
      ok
        ? '  ✔ Đã khôi phục cấu hình gốc (Page ID, token, verify token, app secret)'
        : '  ⚠ Khôi phục cấu hình KHÔNG khớp — cần kiểm tra lại Admin panel'
    );
  }
}

/* ------------------------------------------------------------------ */
/* 3. API DVC thật (kiểm tra nguồn dữ liệu còn sống)                    */
/* ------------------------------------------------------------------ */
async function runDvcChecks() {
  section('API DVC thật');

  try {
    const { DvcClient } = await import(join(ROOT, 'src/core/dvc.js'));
    const dvc = new DvcClient({ baseUrl: 'https://dichvucong.cloudgo.vn' });

    const h = await dvc.health();
    record('dvc', 'GET /api/health còn sống', h?.ok === true, JSON.stringify(h).slice(0, 120));

    const w = await dvc.searchWards('Xuân Lãng', { limit: 5 });
    const xl = w.find((x) => (x.ward_name || '').includes('Xuân Lãng'));
    record('dvc', 'tìm thấy xã Xuân Lãng', !!xl, JSON.stringify(w.slice(0, 2)).slice(0, 120));

    const wp = await dvc.searchWardProcedures('H44.195', 'kết hôn', { limit: 5 });
    record('dvc', 'lọc thủ tục theo xã hoạt động', wp.total > 0, `total=${wp.total}`);

    const d = await dvc.getProcedure('1.000894');
    record('dvc', 'lấy chi tiết thủ tục 1.000894', !!d?.name, d?.name?.slice(0, 80));

    const nat = await dvc.searchProcedures('kết hôn', { limit: 3 });
    record('dvc', 'tìm thủ tục toàn quốc', nat.total > 0, `total=${nat.total}`);
  } catch (err) {
    record('dvc', 'kết nối API DVC', false, String(err?.message || err));
  }
}

/* ------------------------------------------------------------------ */
/* 4. Ghi báo cáo                                                      */
/* ------------------------------------------------------------------ */
function writeReport() {
  const total = results.length;
  const pass = results.filter((r) => r.ok).length;
  const fail = total - pass;
  const durationMs = Date.now() - startedAt;

  const byGroup = {};
  for (const r of results) {
    byGroup[r.group] = byGroup[r.group] || { pass: 0, fail: 0 };
    if (r.ok) byGroup[r.group].pass++;
    else byGroup[r.group].fail++;
  }

  const payload = {
    timestamp: new Date().toISOString(),
    total,
    pass,
    fail,
    durationMs,
    byGroup,
    results,
  };

  writeFileSync(join(OUT, 'latest.json'), JSON.stringify(payload, null, 2), 'utf8');

  const md = [
    '# Báo cáo kiểm thử tự động',
    '',
    `- Thời điểm: ${new Date().toLocaleString('vi-VN')}`,
    `- Kết quả: **${pass}/${total} đạt**, ${fail} lỗi`,
    `- Thời gian: ${(durationMs / 1000).toFixed(1)}s`,
    '',
    '| Nhóm | Đạt | Lỗi |',
    '|---|---|---|',
    ...Object.entries(byGroup).map(([g, v]) => `| ${g} | ${v.pass} | ${v.fail} |`),
    '',
    fail ? '## Các mục lỗi' : '## Không có lỗi',
    '',
    ...(fail
      ? results.filter((r) => !r.ok).map((r) => `- **${r.group}** — ${r.name}: ${r.detail}`)
      : ['Tất cả kiểm thử đều đạt.']),
    '',
  ].join('\n');

  writeFileSync(join(OUT, 'latest.md'), md, 'utf8');

  const line = `${new Date().toISOString()} | ${pass}/${total} đạt | ${fail} lỗi | ${(durationMs / 1000).toFixed(1)}s\n`;
  appendFileSync(join(OUT, 'history.log'), line, 'utf8');

  console.log(`\n${'='.repeat(50)}`);
  console.log(`KẾT QUẢ TỔNG: ${pass}/${total} đạt, ${fail} lỗi (${(durationMs / 1000).toFixed(1)}s)`);
  console.log(`Báo cáo: test-results/latest.md`);
  console.log('='.repeat(50));

  return fail;
}

const exitCode = await (async () => {
  try {
    await runUnitSuites();
    await runIntegration();
    await runDvcChecks();
  } catch (err) {
    record('runner', 'Bộ test chạy hoàn chỉnh', false, String(err?.message || err));
  }
  return writeReport();
})();

process.exit(exitCode ? 1 : 0);
