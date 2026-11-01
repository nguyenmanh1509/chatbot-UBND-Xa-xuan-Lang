/**
 * Kiểm thử lớp AI — không gọi mạng thật, dùng fetch/binding giả lập.
 *
 * Mục tiêu: chốt lại các lỗi đã gặp
 *   1. Tên model Gemini sai ("gemini-3.8-flash" không tồn tại) -> phải tự thử model khác.
 *   2. Provider "workers-ai" không được gọi Gemini trước (đốt quota vô ích).
 *   3. Lỗi phải được mô tả rõ ràng, không nuốt thành chuỗi chung chung.
 *
 * Chạy:  node test/ai.test.mjs
 */

import { AiEngine, describeAiError, GEMINI_MODELS, DEFAULT_GEMINI_MODEL } from '../src/core/ai.js';

let pass = 0;
let fail = 0;

function check(name, cond, extra = '') {
  if (cond) {
    pass++;
    console.log(`  ✔ ${name}`);
  } else {
    fail++;
    console.log(`  ✖ ${name} ${extra}`);
  }
}

function section(t) {
  console.log(`\n=== ${t} ===`);
}

/** Thay thế global fetch bằng hàm giả lập, trả về hàm khôi phục. */
function mockFetch(handler) {
  const orig = globalThis.fetch;
  globalThis.fetch = handler;
  return () => {
    globalThis.fetch = orig;
  };
}

const jsonRes = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
  text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
});

// ---------------------------------------------------------------- provider

section('Provider — workers-ai KHÔNG gọi Gemini trước');
{
  const called = [];
  const restore = mockFetch(async (url) => {
    called.push(String(url));
    return jsonRes(200, { candidates: [{ content: { parts: [{ text: 'gemini' }] } }] });
  });
  const ai = new AiEngine({
    provider: 'workers-ai',
    geminiApiKey: 'AIzaFake',
    aiBinding: { run: async () => ({ response: 'workers-ai' }) },
  });
  const r = await ai.ask('xin chào', 'ctx');
  restore();

  check('trả lời qua workers-ai', r.engine === 'workers-ai' && r.text === 'workers-ai', JSON.stringify(r));
  check('KHÔNG gọi Gemini API', called.length === 0, `đã gọi ${called.length} lần`);
}

section('Provider — none không gọi AI nào');
{
  const restore = mockFetch(async () => jsonRes(200, {}));
  const ai = new AiEngine({ provider: 'none', geminiApiKey: 'AIzaFake' });
  const r = await ai.ask('xin chào', 'ctx');
  restore();
  check('engine = none', r.engine === 'none' && !r.text, JSON.stringify(r));
}

section('Provider — gemini ưu tiên Gemini, fallback sang Workers AI');
{
  // Gemini lỗi 404 (model sai) -> phải thử model khác, không bỏ luôn.
  const urls = [];
  const restore = mockFetch(async (url) => {
    urls.push(String(url));
    if (urls.length === 1) return jsonRes(404, { error: { message: 'model not found' } });
    return jsonRes(200, { candidates: [{ content: { parts: [{ text: 'ok gemini' }] } }] });
  });
  const ai = new AiEngine({ provider: 'gemini', geminiApiKey: 'AIzaFake', model: 'gemini-bad-name' });
  const r = await ai.ask('xin chào', 'ctx');
  restore();

  check('thử model hỏng trước', urls[0].includes('gemini-bad-name'), urls[0]);
  check('sau đó thử model hợp lệ', urls[1]?.includes('gemini-2.5-flash'), urls[1]);
  check('trả lời qua gemini', r.engine === 'gemini' && r.text === 'ok gemini', JSON.stringify(r));
}

section('Gemini — HTTP 400 "model not found" vẫn thử model tiếp theo');
{
  // Gemini thực tế trả 400 (không phải 404) khi tên model sai.
  const urls = [];
  const restore = mockFetch(async (url) => {
    urls.push(String(url));
    if (urls.length === 1) {
      return jsonRes(400, {
        error: { code: 400, message: "models/gemini-bad is not found for API version v1beta." },
      });
    }
    return jsonRes(200, { candidates: [{ content: { parts: [{ text: 'ok' }] } }] });
  });
  const ai = new AiEngine({ provider: 'gemini', geminiApiKey: 'AIzaFake', model: 'gemini-bad' });
  const r = await ai.ask('xin chào', 'ctx');
  restore();

  check('đã thử lại model khác', urls.length === 2, `gọi ${urls.length} lần`);
  check('trả lời qua gemini', r.text === 'ok', JSON.stringify(r));
}

section('Gemini — HTTP 400 "API key not valid" thì DỪNG, không đốt request');
{
  let n = 0;
  const restore = mockFetch(async () => {
    n++;
    return jsonRes(400, { error: { code: 400, message: 'API key not valid. Please pass a valid API key.' } });
  });
  const ai = new AiEngine({ provider: 'gemini', geminiApiKey: 'AIzaFake' });
  const r = await ai.ask('xin chào', 'ctx');
  restore();

  check('chỉ gọi 1 lần', n === 1, `gọi ${n} lần`);
  check('báo đúng là sai API key', /api key/i.test(ai.lastError || ''), ai.lastError);
}

section('Ghi lỗi từng provider (để admin biết cái nào hỏng)');
{
  const restore = mockFetch(async () =>
    jsonRes(400, { error: { code: 400, message: 'API key not valid.' } })
  );
  const ai = new AiEngine({
    provider: 'gemini',
    geminiApiKey: 'AIzaFake',
    aiBinding: { run: async () => ({ response: 'workers-ai' }) },
  });
  const r = await ai.ask('xin chào', 'ctx');
  restore();

  check('vẫn trả lời qua fallback', r.engine === 'workers-ai', JSON.stringify(r));
  check('ghi lỗi gemini', !!ai.errors?.gemini, JSON.stringify(ai.errors));
  check('lỗi gemini nói rõ sai key', /api key/i.test(ai.errors?.gemini || ''), ai.errors?.gemini);
}

section('Gemini — model mặc định hợp lệ');
{
  const c = new AiEngine({ geminiApiKey: 'AIzaFake' });
  check('model mặc định tồn tại trong danh sách', GEMINI_MODELS.includes(c.model), c.model);
  check('default là gemini-2.5-flash', DEFAULT_GEMINI_MODEL === 'gemini-2.5-flash', DEFAULT_GEMINI_MODEL);
  check('model cũ gemini-3.8-flash không còn trong list', !GEMINI_MODELS.includes('gemini-3.8-flash'));
}

section('Gemini — 429 không thử lại (đừng đốt thêm request)');
{
  let n = 0;
  const restore = mockFetch(async () => {
    n++;
    return jsonRes(429, { error: { message: 'Resource has been exhausted' } });
  });
  const ai = new AiEngine({ provider: 'gemini', geminiApiKey: 'AIzaFake' });
  const r = await ai.ask('xin chào', 'ctx');
  restore();

  check('chỉ gọi 1 lần', n === 1, `gọi ${n} lần`);
  check('không có phản hồi', !r.text);
  check('báo lỗi quota rõ ràng', /quota/i.test(ai.lastError || ''), ai.lastError);
}

// ------------------------------------------------------------- Workers AI

section('Workers AI — thử model dự phòng khi model chính lỗi');
{
  const models = [];
  const binding = {
    run: async (model) => {
      models.push(model);
      if (models.length === 1) throw Object.assign(new Error('boom'), { status: 404 });
      return { response: 'llama ok' };
    },
  };
  const ai = new AiEngine({ provider: 'workers-ai', aiBinding: binding });
  const r = await ai.ask('xin chào', 'ctx');

  check('thử 2 model', models.length === 2, JSON.stringify(models));
  check('trả lời qua workers-ai', r.engine === 'workers-ai' && r.text === 'llama ok', JSON.stringify(r));
}

section('Workers AI — 429 thì dừng ngay, không thử model khác');
{
  let n = 0;
  const binding = {
    run: async () => {
      n++;
      throw Object.assign(new Error('quota exceeded'), { status: 429 });
    },
  };
  const ai = new AiEngine({ provider: 'workers-ai', aiBinding: binding });
  const r = await ai.ask('xin chào', 'ctx');

  check('chỉ gọi 1 lần', n === 1, `gọi ${n} lần`);
  check('báo lỗi quota rõ ràng', /quota/i.test(ai.lastError || ''), ai.lastError);
}

// ------------------------------------------------------------ mô tả lỗi

section('Mô tả lỗi — không báo chung chung');
{
  const e429 = describeAiError({ status: 429, message: 'quota exceeded' }, { provider: 'workers-ai' });
  check('429 -> nhắc quota + cách xử lý', /quota/i.test(e429) && /neuron/i.test(e429), e429);

  const e404 = describeAiError({ status: 404, message: 'not found' }, { provider: 'gemini', model: 'x' });
  check('404 -> nêu model hợp lệ', /gemini-2\.5-flash/.test(e404), e404);

  const e403 = describeAiError({ status: 403, message: 'forbidden' }, { provider: 'gemini' });
  check('403 -> nhắc API key', /api key/i.test(e403), e403);

  const e500 = describeAiError({ status: 500, message: 'internal' });
  check('lỗi lạ -> vẫn có nội dung', e500.length > 10 && !/không rõ nguyên nhân/.test(e500), e500);
}

console.log(`\n${pass} pass, ${fail} fail`);
if (fail) process.exit(1);
