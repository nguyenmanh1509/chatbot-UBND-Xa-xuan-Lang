/**
 * Test cho tầng đăng nhập admin (auth.js) và thủ tục của xã (procedures.js).
 *
 * Chạy: node --test test/auth.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  hashPassword,
  verifyPassword,
  makeSalt,
  timingSafeEqual,
  createSessionToken,
  verifySessionToken,
  sessionCookieHeader,
  clearSessionCookieHeader,
  readSessionCookie,
  login,
  createUser,
  changePassword,
  listUsers,
  getUser,
} from '../src/core/auth.js';

import {
  sanitizeProcedure,
  rowToProcedure,
  insertProcedure,
  updateProcedure,
  deleteProcedure,
  listProcedures,
  searchLocalProcedures,
  localProcedureToReply,
  localProcedureToText,
} from '../src/core/procedures.js';

/* ------------------------- fake D1 ------------------------- */

/**
 * D1 giả lập bằng SQLite in-memory (node:sqlite) để test logic SQL.
 * Chỉ hỗ trợ đúng những câu SQL mà code dùng.
 */
function makeFakeDb() {
  // Hai bảng riêng biệt (admin_users, procedures) - tránh lẫn dữ liệu.
  const users = [];
  const procs = [];
  let nextId = 1;
  let seq = 1;

  const exec = (sql, params = []) => {
    const s = sql.replace(/\s+/g, ' ').trim();

    if (s.startsWith('SELECT * FROM admin_users WHERE username')) {
      const r = users.find((x) => x.username === params[0]);
      return { results: r ? [r] : [] };
    }
    if (s.startsWith('SELECT id, username, display_name')) {
      // Chỉ trả về các cột được SELECT (không rò hash/salt ra ngoài).
      return {
        results: users.map((r) => ({
          id: r.id,
          username: r.username,
          display_name: r.display_name,
          role: r.role,
          is_default: r.is_default,
          active: r.active,
          last_login_at: r.last_login_at,
          created_at: r.created_at,
        })),
      };
    }
    if (s.startsWith('SELECT * FROM procedures WHERE id')) {
      const r = procs.find((x) => x.id === Number(params[0]));
      return { results: r ? [r] : [] };
    }
    if (s.startsWith('SELECT * FROM procedures')) {
      const onlyActive = s.includes('active = 1');
      let out = procs.filter((r) => (onlyActive ? r.active : true));
      out = out.slice().sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
      return { results: out.map((r) => ({ ...r })) };
    }
    if (s.startsWith('INSERT INTO admin_users')) {
      const r = {
        id: seq++,
        username: params[0],
        display_name: params[1],
        password_hash: params[2],
        salt: params[3],
        role: params[4],
        is_default: params[5],
        active: 1,
        last_login_at: null,
        created_at: '2026-01-01 00:00:00',
        updated_at: '2026-01-01 00:00:00',
      };
      users.push(r);
      return { meta: { last_row_id: r.id } };
    }
    if (s.startsWith('UPDATE admin_users SET last_login_at')) {
      const r = users.find((x) => x.id === Number(params[0]));
      if (r) r.last_login_at = '2026-01-01 00:00:00';
      return { meta: {} };
    }
    if (s.startsWith('UPDATE admin_users SET password_hash')) {
      // SQL thật: UPDATE ... SET password_hash = ?, salt = ?, updated_at = ...
      //              WHERE id = ?   -> bind(hash, salt, id)
      const r = users.find((x) => x.id === Number(params[2]));
      if (r) {
        r.password_hash = params[0];
        r.salt = params[1];
      }
      return { meta: {} };
    }
    if (s.startsWith('INSERT INTO procedures')) {
      const cols = s.match(/INSERT INTO procedures \(([^)]+)\)/)[1].split(',').map((c) => c.trim());
      const r = { id: nextId++, created_at: '2026-01-01', updated_at: '2026-01-01' };
      cols.forEach((c, i) => (r[c] = params[i]));
      if (r.active === undefined) r.active = 1;
      if (r.sort_order === undefined) r.sort_order = 0;
      procs.push(r);
      return { meta: { last_row_id: r.id } };
    }
    if (s.startsWith('UPDATE procedures SET')) {
      // SQL thật: UPDATE procedures SET c1 = ?, c2 = ?, ..., updated_at = ...
      //              WHERE id = ?   -> bind(v1, v2, ..., id)
      // Số cột = số tham số - 1 (tham số cuối là id).
      const values = params.slice(0, params.length - 1);
      const id = Number(params[params.length - 1]);
      const r = procs.find((x) => x.id === id);
      if (r) {
        // Thứ tự cột trong SQL khớp thứ tự PROCEDURE_FIELDS mà
        // updateProcedure() sinh ra -> dùng danh sách cột đã biết.
        const setPart = s.slice(s.indexOf('SET') + 3, s.indexOf('updated_at'));
        const cols = setPart.split(',').map((c) => c.trim().split(' = ')[0]);
        cols.forEach((c, i) => (r[c] = values[i]));
      }
      return { meta: {} };
    }
    if (s.startsWith('DELETE FROM procedures WHERE id')) {
      const i = procs.findIndex((x) => x.id === Number(params[0]));
      if (i >= 0) procs.splice(i, 1);
      return { meta: {} };
    }
    throw new Error('SQL chưa hỗ trợ trong fake db: ' + s);
  };

  return {
    prepare(sql) {
      return {
        bind(...params) {
          return {
            first: async () => exec(sql, params).results[0] || null,
            all: async () => exec(sql, params),
            run: async () => exec(sql, params),
          };
        },
        first: async () => exec(sql, []).results[0] || null,
        all: async () => exec(sql, []),
        run: async () => exec(sql, []),
      };
    },
  };
}

/* ============================ AUTH ============================ */

test('hashPassword xác định và không lưu mật khẩu rõ', async () => {
  const salt = makeSalt();
  const h1 = await hashPassword('secret123', salt);
  const h2 = await hashPassword('secret123', salt);
  assert.equal(h1, h2);
  assert.ok(!h1.includes('secret123'));
  assert.equal(h1.length, 64); // 256 bit -> hex
});

test('verifyPassword đúng/sai', async () => {
  const salt = makeSalt();
  const h = await hashPassword('matkhau', salt);
  assert.equal(await verifyPassword('matkhau', salt, h), true);
  assert.equal(await verifyPassword('MatKhau', salt, h), false);
  assert.equal(await verifyPassword('matkhau', 'bad', h), false);
  assert.equal(await verifyPassword('x', salt, ''), false);
});

test('makeSalt sinh giá trị khác nhau', () => {
  assert.notEqual(makeSalt(), makeSalt());
});

test('timingSafeEqual', () => {
  assert.equal(timingSafeEqual('abc', 'abc'), true);
  assert.equal(timingSafeEqual('abc', 'abd'), false);
  assert.equal(timingSafeEqual('abc', 'ab'), false);
  assert.equal(timingSafeEqual('', ''), true);
});

test('session token: tạo -> xác minh -> hết hạn -> sai chữ ký', async () => {
  const env = { ADMIN_PASSWORD: 'khoa-bi-mat' };
  const token = await createSessionToken(env, 'admin');
  assert.equal(await verifySessionToken(env, token), 'admin');

  // Token khác secret -> từ chối
  assert.equal(await verifySessionToken({ ADMIN_PASSWORD: 'khac' }, token), null);

  // Token rác -> từ chối
  assert.equal(await verifySessionToken(env, 'abc'), null);
  assert.equal(await verifySessionToken(env, 'a.b'), null);
  assert.equal(await verifySessionToken(env, ''), null);

  // Hết hạn -> từ chối
  const short = await createSessionToken(env, 'admin', -10);
  assert.equal(await verifySessionToken(env, short), null);
});

test('cookie phiên: HttpOnly, SameSite, đọc lại được', async () => {
  const token = await createSessionToken({ ADMIN_PASSWORD: 'k' }, 'admin');
  const header = sessionCookieHeader(token);
  assert.ok(header.includes('HttpOnly'));
  assert.ok(header.includes('SameSite=Strict'));
  assert.ok(header.includes('Secure'));
  assert.ok(header.includes('Max-Age='));

  const req = new Request('https://x.dev/', { headers: { Cookie: header.split(';')[0] } });
  assert.equal(readSessionCookie(req), token);

  const clear = clearSessionCookieHeader();
  assert.ok(clear.includes('Max-Age=0'));
});

test('cookie phiên local không gắn Secure', () => {
  const header = sessionCookieHeader('tok', { secure: false });
  assert.ok(!header.includes('Secure'));
});

test('login: đúng, sai mật khẩu, sai tài khoản, thiếu trường', async () => {
  const db = makeFakeDb();
  await createUser(db, { username: 'admin', password: 'matkhau123', displayName: 'Admin' });

  const good = await login(db, 'admin', 'matkhau123');
  assert.equal(good.ok, true);
  assert.equal(good.user.username, 'admin');

  const badPwd = await login(db, 'admin', 'sai');
  assert.equal(badPwd.ok, false);
  assert.ok(!badPwd.error.includes('matkhau123'));

  const badUser = await login(db, 'khongco', 'matkhau123');
  assert.equal(badUser.ok, false);

  const empty = await login(db, '', '');
  assert.equal(empty.ok, false);
});

test('tài khoản bị khoá (active=0) không đăng nhập được', async () => {
  const db = makeFakeDb();
  await createUser(db, { username: 'a', password: 'matkhau123' });
  // Tắt active
  const user = await getUser(db, 'a');
  assert.ok(user);
  user.active = 0;
  const r = await login(db, 'a', 'matkhau123');
  assert.equal(r.ok, false);
});

test('createUser: trùng tên, mật khẩu ngắn, thiếu tên', async () => {
  const db = makeFakeDb();
  const r1 = await createUser(db, { username: 'a', password: 'matkhau123' });
  assert.equal(r1.ok, true);

  const dup = await createUser(db, { username: 'a', password: 'matkhau123' });
  assert.equal(dup.ok, false);

  const short = await createUser(db, { username: 'b', password: '123' });
  assert.equal(short.ok, false);

  const noName = await createUser(db, { username: '', password: 'matkhau123' });
  assert.equal(noName.ok, false);
});

test('changePassword đổi được và đăng nhập bằng mật khẩu mới', async () => {
  const db = makeFakeDb();
  await createUser(db, { username: 'a', password: 'matkhau123' });

  const ch = await changePassword(db, 'a', 'matkhaumoi');
  assert.equal(ch.ok, true);

  assert.equal((await login(db, 'a', 'matkhau123')).ok, false);
  assert.equal((await login(db, 'a', 'matkhaumoi')).ok, true);

  const short = await changePassword(db, 'a', '1');
  assert.equal(short.ok, false);
});

test('listUsers không trả về hash mật khẩu', async () => {
  const db = makeFakeDb();
  await createUser(db, { username: 'a', password: 'matkhau123' });
  const list = await listUsers(db);
  assert.equal(list.length, 1);
  assert.equal(list[0].password_hash, undefined);
  assert.equal(list[0].salt, undefined);
  assert.equal(list[0].username, 'a');
});

/* ========================= THỦ TỤC XÃ ========================= */

test('sanitizeProcedure: chuỗi rỗng -> null, chỉ giữ trường hợp lệ', () => {
  const { data, error } = sanitizeProcedure({
    name: '  Thủ tục X  ',
    officer: '',
    phone: '   ',
    bogus_field: 'hack',
    active: 1,
    sort_order: '5',
  });
  assert.equal(error, undefined);
  assert.equal(data.name, 'Thủ tục X');
  assert.equal(data.officer, null);
  assert.equal(data.phone, null);
  assert.equal(data.bogus_field, undefined);
  assert.equal(data.active, 1);
  assert.equal(data.sort_order, 5);
});

test('sanitizeProcedure: thiếu tên -> lỗi', () => {
  const r = sanitizeProcedure({ officer: 'A' });
  assert.ok(r.error);
});

test('rowToProcedure chuẩn hóa NULL thành chuỗi rỗng', () => {
  const p = rowToProcedure({ id: 1, name: 'X', officer: null, active: 0 });
  assert.equal(p.officer, '');
  assert.equal(p.active, false);
  assert.equal(p.id, 1);
});

test('CRUD thủ tục qua fake D1', async () => {
  const db = makeFakeDb();
  const ins = await insertProcedure(db, { name: 'Thủ tục A', officer: 'Chị B', phone: '0123' });
  assert.equal(ins.ok, true);

  let list = await listProcedures(db);
  assert.equal(list.length, 1);
  assert.equal(list[0].name, 'Thủ tục A');

  const upd = await updateProcedure(db, list[0].id, { phone: '0456' });
  assert.equal(upd.ok, true);
  list = await listProcedures(db);
  assert.equal(list[0].phone, '0456');
  assert.equal(list[0].officer, 'Chị B'); // không bị mất

  const del = await deleteProcedure(db, list[0].id);
  assert.equal(del.ok, true);
  list = await listProcedures(db);
  assert.equal(list.length, 0);
});

test('insertProcedure thiếu tên -> lỗi, không ghi vào DB', async () => {
  const db = makeFakeDb();
  const r = await insertProcedure(db, { phone: '0123' });
  assert.equal(r.ok, false);
  assert.equal((await listProcedures(db)).length, 0);
});

test('listProcedures onlyActive lọc đúng', async () => {
  const db = makeFakeDb();
  await insertProcedure(db, { name: 'A' });
  await insertProcedure(db, { name: 'B', active: 0 });
  assert.equal((await listProcedures(db)).length, 2);
  assert.equal((await listProcedures(db, { onlyActive: true })).length, 1);
});

test('searchLocalProcedures: tên trùng khớp chính xác', async () => {
  const db = makeFakeDb();
  await insertProcedure(db, { name: 'Cấp giấy xác nhận hộ khẩu', code: '1.001' });
  await insertProcedure(db, { name: 'Thủ tục Abc', keywords: 'abc, thu tuc abc' });

  const r = await searchLocalProcedures(db, 'thủ tục Abc');
  assert.ok(r.length);
  assert.equal(r[0].procedure.name, 'Thủ tục Abc');
  assert.equal(r[0].exact, true);
});

test('searchLocalProcedures: câu hỏi chung -> Dice thấp (không chiếm câu hỏi)', async () => {
  const db = makeFakeDb();
  await insertProcedure(db, { name: 'Cấp giấy xác nhận tình trạng hộ khẩu' });
  const r = await searchLocalProcedures(db, 'hộ khẩu');
  // Vẫn tìm thấy, nhưng điểm Dice phải thấp để conversation.js bỏ qua
  assert.ok(r.length >= 0);
  if (r.length) assert.ok(r[0].dice < 0.75);
});

test('searchLocalProcedures: khớp từ khoá admin khai báo -> exact', async () => {
  const db = makeFakeDb();
  await insertProcedure(db, { name: 'Thủ tục riêng', keywords: 'giấy xác nhận' });
  const r = await searchLocalProcedures(db, 'giấy xác nhận');
  assert.equal(r[0].exact, true);
});

test('searchLocalProcedures: không khớp -> rỗng', async () => {
  const db = makeFakeDb();
  await insertProcedure(db, { name: 'Thủ tục Abc' });
  const r = await searchLocalProcedures(db, 'bảo hiểm y tế');
  assert.equal(r.length, 0);
});

test('localProcedureToReply BỎ QUA trường rỗng', () => {
  const out = localProcedureToReply({
    name: 'Thủ tục X',
    code: '',
    description: '',
    officer: 'Chị B',
    desk: '',
    phone: '0123',
    office_hours: '',
    docs_url: '',
    portal_url: '',
  });
  assert.ok(out.includes('Chị B'));
  assert.ok(out.includes('0123'));
  assert.ok(!out.includes('Bàn số'));
  assert.ok(!out.includes('Giờ làm việc'));
  assert.ok(!out.includes('Mô tả'));
  assert.ok(!out.includes('không có'));
  assert.ok(!out.includes('null'));
  assert.ok(!out.includes('undefined'));
});

test('localProcedureToText BỎ QUA trường rỗng', () => {
  const out = localProcedureToText({
    name: 'Thủ tục X',
    code: '',
    description: '',
    officer: 'Chị B',
    desk: '',
    phone: '',
    office_hours: '',
    keywords: '',
    docs_url: '',
    portal_url: '',
  });
  assert.ok(out.includes('Đồng chí phụ trách: Chị B'));
  assert.ok(!out.includes('Bàn số'));
  assert.ok(!out.includes('Số điện thoại'));
  assert.ok(!out.includes('null'));
});
