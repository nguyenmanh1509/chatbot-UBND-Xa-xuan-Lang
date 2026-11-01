/**
 * Cập nhật cấu hình lưu trong KV (dùng 1 lần khi đổi lời chào / tên cơ quan mặc định).
 * KHÔNG ghi đè các khóa admin đã tự thiết lập (channels, ai, dvc...).
 *
 * Dùng: node scripts/patch-config.mjs
 */
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { defaultConfig } from '../src/core/config.js';

const raw = execSync('npx wrangler kv key get --binding=CONFIG "config:v1"', { encoding: 'utf8' });
const saved = JSON.parse(raw);
const d = defaultConfig();

const next = {
  ...saved,
  siteName: d.siteName,
  chatTitle: d.chatTitle,
  officeName: d.officeName,
  greeting: d.greeting,
};

writeFileSync('/tmp/config-v1.json', JSON.stringify(next));
execSync('npx wrangler kv key put --binding=CONFIG "config:v1" --path /tmp/config-v1.json', { encoding: 'utf8' });
console.log('Đã cập nhật config:v1 trong KV');
console.log('greeting:', next.greeting.split('\n')[0]);
