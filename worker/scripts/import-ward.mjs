/**
 * Import toàn bộ thủ tục áp dụng tại xã Xuân Lãng từ Cổng DVC vào D1.
 *
 * Dùng cho lần đầu tiên (nạp ~3.500 thủ tục). Sau đó admin có thể bấm
 * "Nhập từ Cổng DVC" trong trang quản trị để cập nhật.
 *
 * Cách dùng:
 *   node scripts/import-ward.mjs
 *   node scripts/import-ward.mjs --start 1 --pages 5
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

/** Đọc .env để lấy WORKER_URL + ADMIN_PASSWORD. */
function loadEnv() {
  const out = {};
  try {
    const raw = readFileSync(resolve(ROOT, '.env'), 'utf8');
    for (const line of raw.split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !m[2].startsWith('#')) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch (_) { /* không có .env -> dùng biến môi trường */ }
  return { ...process.env, ...out };
}

const env = loadEnv();
const WORKER_URL = (env.WORKER_URL || '').replace(/\/+$/, '');
const ADMIN_PASSWORD = env.ADMIN_PASSWORD || '';

if (!WORKER_URL || !ADMIN_PASSWORD) {
  console.error('Thiếu WORKER_URL hoặc ADMIN_PASSWORD trong .env');
  process.exit(1);
}

function arg(name, dflt) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
}

const startPage = Number(arg('start', 1));
const pagesPerCall = Number(arg('pages', 5));
const maxRounds = Number(arg('rounds', 20));

let page = startPage;
let total = 0;
let grandTotal = 0;
let rounds = 0;

console.log(`→ Import từ ${WORKER_URL} (bắt đầu trang ${startPage})`);

while (rounds < maxRounds) {
  rounds += 1;
  const res = await fetch(`${WORKER_URL}/api/admin/procedures/import`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${ADMIN_PASSWORD}`,
    },
    body: JSON.stringify({ startPage: page, maxPages: pagesPerCall }),
  });

  const j = await res.json();
  if (!j.ok) {
    console.error('✖ Lỗi:', j.error);
    process.exit(1);
  }

  total = j.total || total;
  grandTotal += j.imported || 0;
  console.log(
    `  vòng ${rounds}: +${j.imported} thủ tục (trang ${page}) — tổng DB ${j.stats?.total ?? '?'}/${total}`
  );

  if (j.done || !j.nextPage) {
    console.log(`✔ Hoàn tất. Đã xử lý ${grandTotal} bản ghi.`);
    break;
  }
  page = j.nextPage;
}
