/**
 * Widget Chat Trợ lý Xuân Lãng — phiên bản standalone embeddable
 * Cách dùng: <script src="https://YOUR-DOMAIN.com/chat-widget.js"><\/script>
 * Hoặc nhúng trực tiếp vào Custom HTML Module của Joomla.
 */
(function () {
    'use strict';

    /* ─── CSS ─────────────────────────────────────────── */
    const CSS = `
*, ::before, ::after { box-sizing: border-box; margin: 0; padding: 0; }

:root {
    --cw-navy:   #0B3D62;
    --cw-red:    #C1272D;
    --cw-green:  #1B8A5A;
    --cw-border: #DCE3E8;
    --cw-muted:  #5B6B76;
    --cw-surface: #FFFFFF;
}

#cw-root {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    font-size: 14px;
    color: #12202B;
}

/* Nút bong bóng */
#cw-launcher {
    position: fixed;
    right: 24px; bottom: 24px;
    width: 60px; height: 60px;
    border-radius: 50%;
    border: none;
    background: linear-gradient(135deg, #0f3a8a 0%, #1e54c7 100%);
    color: #fff;
    cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    box-shadow: 0 10px 30px rgba(15,23,42,.35), 0 0 0 4px rgba(255,255,255,.85);
    z-index: 2147483647;
    transition: transform .2s, box-shadow .2s;
    animation: cw-popIn .5s cubic-bezier(.2,.9,.3,1.2) both;
}
#cw-launcher:hover {
    transform: translateY(-3px) scale(1.05);
    box-shadow: 0 14px 36px rgba(15,23,42,.4), 0 0 0 4px rgba(255,255,255,.9);
}
#cw-launcher:active { transform: scale(.97); }
#cw-launcher.cw-open {
    background: linear-gradient(135deg, #475569 0%, #64748b 100%);
}

#cw-badge {
    position: absolute; top: 4px; right: 4px;
    background: #ef4444; color: #fff;
    font-size: 11px; font-weight: 700;
    min-width: 18px; height: 18px;
    border-radius: 9px; padding: 0 5px;
    display: flex; align-items: center; justify-content: center;
    box-shadow: 0 0 0 2px #fff;
    animation: cw-pulse 1.8s ease-in-out infinite;
}
#cw-badge.cw-hide { display: none; }

/* Panel */
#cw-panel {
    position: fixed;
    right: 20px; bottom: 90px;
    width: 420px; max-width: calc(100vw - 40px);
    height: min(640px, calc(100vh - 100px));
    display: flex; flex-direction: column;
    background: var(--cw-surface);
    border-radius: 16px;
    border: 1px solid var(--cw-border);
    box-shadow: 0 18px 60px rgba(15,23,42,.25), 0 4px 14px rgba(15,23,42,.12);
    overflow: hidden;
    z-index: 2147483646;
    transform-origin: bottom right;
    animation: cw-widgetIn .25s cubic-bezier(.2,.9,.3,1.2) both;
}
#cw-panel[hidden] { display: none !important; }

/* Header */
#cw-header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 14px 18px;
    background: var(--cw-navy); color: #fff;
    flex-shrink: 0;
}
#cw-title {
    display: flex; align-items: center; gap: 10px;
}
#cw-avatar {
    width: 34px; height: 34px; border-radius: 8px;
    background: var(--cw-red);
    display: flex; align-items: center; justify-content: center;
    font-weight: 700; font-size: 14px;
}
#cw-name { font-size: 15px; font-weight: 700; }
#cw-sub {
    font-size: 11px; color: #C9D8E4; margin-top: 1px;
    display: flex; align-items: center; gap: 4px;
}
#cw-dot { width: 7px; height: 7px; border-radius: 50%; background: #3FD08A; }
#cw-close {
    width: 30px; height: 30px; border-radius: 7px;
    border: 1px solid rgba(255,255,255,.2);
    background: rgba(255,255,255,.1); color: #fff;
    font-size: 14px; cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    transition: background .15s;
}
#cw-close:hover { background: rgba(255,255,255,.22); }

/* Chat body */
#cw-chat {
    flex: 1; overflow-y: auto;
    padding: 16px 18px;
    display: flex; flex-direction: column; gap: 12px;
    background: #F4F6F8;
}
.cw-msg { display: flex; gap: 8px; max-width: 100%; animation: cw-fade .2s ease; }
.cw-msg-user { justify-content: flex-end; }
.cw-bubble {
    padding: 10px 13px; border-radius: 10px;
    line-height: 1.55; max-width: 82%; font-size: 13.5px;
}
.cw-msg-bot .cw-bubble {
    background: var(--cw-surface);
    border: 1px solid var(--cw-border);
    border-top-left-radius: 3px;
}
.cw-msg-user .cw-bubble {
    background: var(--cw-red); color: #fff;
    border-top-right-radius: 3px;
}
.cw-avatar-small {
    width: 26px; height: 26px; border-radius: 6px; flex-shrink: 0;
    background: var(--cw-navy); color: #fff;
    display: flex; align-items: center; justify-content: center;
    font-size: 11px; font-weight: 700; align-self: flex-end;
}
.cw-card-list { display: flex; flex-direction: column; gap: 7px; margin-top: 8px; }
.cw-card {
    display: flex; gap: 9px; border: 1px solid var(--cw-border);
    border-left: 3px solid var(--cw-navy);
    border-radius: 8px; padding: 9px 11px; background: #fff;
}
.cw-card.cw-has-online { border-left-color: var(--cw-green); }
.cw-card-body { flex: 1; min-width: 0; }
.cw-card-code { font-size: 11px; color: var(--cw-muted); }
.cw-card-name { font-size: 13px; font-weight: 600; margin: 2px 0 3px; }
.cw-card-meta { font-size: 11px; color: var(--cw-muted); }
.cw-card-online { font-size: 11px; color: var(--cw-green); }
.cw-card-btn {
    border: 1px solid var(--cw-navy); background: #fff; color: var(--cw-navy);
    border-radius: 6px; padding: 5px 9px; font-size: 11px; cursor: pointer; white-space: nowrap;
    align-self: center; flex-shrink: 0;
}
.cw-card-btn:hover { background: var(--cw-navy); color: #fff; }
.cw-detail-rows { display: flex; flex-direction: column; gap: 6px; margin-top: 8px; }
.cw-row { display: flex; gap: 8px; font-size: 13px; }
.cw-row-k { color: var(--cw-muted); min-width: 140px; flex-shrink: 0; }
.cw-row-v { color: #12202B; word-break: break-word; }
.cw-err-bubble { border-left: 3px solid var(--cw-red) !important; }
.cw-err-bubble .cw-row-v { color: var(--cw-red); }
.cw-pager { display: flex; gap: 7px; margin-top: 10px; align-items: center; }
.cw-pager button {
    border: 1px solid var(--cw-border); background: #fff;
    border-radius: 6px; padding: 5px 10px; font-size: 12px; cursor: pointer;
}
.cw-pager button:disabled { opacity: .4; cursor: default; }
.cw-pager span { font-size: 12px; color: var(--cw-muted); }
.cw-help-list { display: flex; flex-direction: column; gap: 3px; margin-top: 6px; }
.cw-help-row { display: flex; gap: 7px; font-size: 12.5px; }
.cw-help-code { background: #F0F3F5; padding: 1px 6px; border-radius: 4px; font-size: 12px; flex-shrink: 0; }
.cw-backdrop {
    position: fixed; inset: 0;
    background: rgba(15,23,42,.45); z-index: 2147483645;
    animation: cw-fade .2s ease;
}
.cw-backdrop[hidden] { display: none !important; }

/* Chips */
#cw-chips {
    display: flex; gap: 7px; padding: 10px 18px 0;
    flex-wrap: wrap; background: #F4F6F8;
}
.cw-chip {
    border: 1px solid var(--cw-border); background: #F7F9FA;
    color: #12202B; border-radius: 16px;
    padding: 5px 11px; font-size: 12px; cursor: pointer;
}
.cw-chip:hover { background: #EDF1F3; }

/* Input */
#cw-input-bar {
    display: flex; gap: 9px; padding: 10px 18px 16px;
    background: #F4F6F8;
}
#cw-input {
    flex: 1; border: 1px solid var(--cw-border); border-radius: 9px;
    padding: 10px 13px; font-size: 13.5px;
}
#cw-input:focus { outline: 2px solid var(--cw-navy); outline-offset: 1px; }
#cw-send {
    background: var(--cw-navy); color: #fff; border: none;
    border-radius: 9px; padding: 0 18px; font-size: 13.5px;
    font-weight: 600; cursor: pointer;
}
#cw-send:hover { background: #082A44; }
#cw-send:disabled { opacity: .5; cursor: default; }

/* Animations */
@keyframes cw-popIn   { from { transform: scale(0); } to { transform: scale(1); } }
@keyframes cw-pulse  { 0%,100%{transform:scale(1)} 50%{transform:scale(1.18)} }
@keyframes cw-widgetIn { from{transform:scale(.85) translateY(20px);opacity:0} to{transform:scale(1) translateY(0);opacity:1} }
@keyframes cw-fade   { from{opacity:0;transform:translateY(4px)} to{opacity:1;transform:translateY(0)} }

/* Mobile */
@media (max-width: 520px) {
    #cw-panel {
        right: 10px; bottom: 90px;
        width: calc(100vw - 20px); height: calc(100vh - 110px);
        max-width: none; border-radius: 14px;
    }
    #cw-launcher { right: 16px; bottom: 16px; width: 56px; height: 56px; }
    #cw-bubble { max-width: 90%; }
}
`;

    /* ─── HTML ────────────────────────────────────────── */
    const HTML = `
<button id="cw-launcher" aria-label="Mở trợ lý chat">
    <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path>
    </svg>
    <span id="cw-badge">1</span>
</button>

<div id="cw-panel" hidden>
    <div id="cw-header">
        <div id="cw-title">
            <div id="cw-avatar">TT</div>
            <div>
                <div id="cw-name">Trợ lý Xuân Lãng</div>
                <div id="cw-sub"><span id="cw-dot"></span>Đang hoạt động</div>
            </div>
        </div>
        <button id="cw-close" aria-label="Đóng chat">✕</button>
    </div>
    <div id="cw-chat"></div>
    <div id="cw-chips">
        <div class="cw-chip" data-action="sample-search">Tìm "đăng ký kết hôn"</div>
        <div class="cw-chip" data-action="xuanlang">Thủ tục xã Xuân Lãng</div>
        <div class="cw-chip" data-action="categories">Danh mục / lĩnh vực</div>
        <div class="cw-chip" data-action="myward">Thông tin xã</div>
    </div>
    <div id="cw-input-bar">
        <input id="cw-input" type="text" placeholder="Nhập tên thủ tục, mã, hoặc gõ /trogiup…">
        <button id="cw-send">Gửi</button>
    </div>
</div>

<div class="cw-backdrop" id="cw-backdrop" hidden></div>
`;

    /* ─── INJECT ──────────────────────────────────────── */
    function injectStyle(css) {
        const s = document.createElement('style');
        s.textContent = css;
        document.head.appendChild(s);
    }
    function injectHTML(html) {
        const d = document.createElement('div');
        d.id = 'cw-root';
        d.innerHTML = html;
        document.body.appendChild(d);
    }

    /* ─── HELPERS ─────────────────────────────────────── */
    const S = {
        baseUrl: 'https://dichvucong.cloudgo.vn',
        mode: 'gateway',
        apiKey: '',
        searchParam: 'q',
        provinceParam: 'province_code',
        categoryParam: 'category_code',
        agencyParam: 'agency_code',
        serviceGroupParam: 'service_group_code',
        pageSize: 5,
    };

    const pathFor = p => S.baseUrl + (S.mode === 'rest' ? '/rest' : '') + p;
    const headersFor = () => { const h = {}; if (S.mode === 'rest' && S.apiKey) h['X-API-Key'] = S.apiKey; return h; };

    async function callApi(path, params) {
        let url = pathFor(path);
        if (params) {
            const clean = {};
            Object.keys(params).forEach(k => { if (params[k] != null && params[k] !== '') clean[k] = params[k]; });
            const qs = new URLSearchParams(clean).toString();
            if (qs) url += '?' + qs;
        }
        let res;
        try { res = await fetch(url, { headers: headersFor() }); }
        catch (e) { throw new Error('network'); }
        if (res.status === 401 || res.status === 403) throw new Error('unauthorized');
        if (res.status === 404) throw new Error('notfound');
        if (!res.ok) throw new Error('http_' + res.status);
        return res.headers.get('content-type')?.includes('application/json') ? res.json() : res;
    }

    function errMsg(e) {
        switch (e.message) {
            case 'network': return 'Không gọi được máy chủ. Có thể do CORS hoặc Base URL sai.';
            case 'unauthorized': return 'Thiếu hoặc sai X-API-Key.';
            case 'notfound': return 'Không tìm thấy dữ liệu.';
            default: return 'Lỗi: ' + e.message + '. Vui lòng thử lại.';
        }
    }

    /* ─── DOM refs ─────────────────────────────────────── */
    let $chat, $input, $sendBtn, $launcher, $panel, $closeBtn, $badge, $backdrop;

    function dom(id) { return document.getElementById(id); }

    function appendChat(role, node) {
        const wrap = document.createElement('div');
        wrap.className = 'cw-msg ' + role;
        if (role === 'bot') {
            const av = document.createElement('div');
            av.className = 'cw-avatar-small'; av.textContent = 'TT';
            wrap.appendChild(av);
        }
        const b = document.createElement('div');
        b.className = 'cw-bubble';
        b.appendChild(node);
        wrap.appendChild(b);
        $chat.appendChild(wrap);
        $chat.scrollTop = $chat.scrollHeight;
        return b;
    }

    function txt(t) {
        const d = document.createElement('div');
        d.textContent = safeString(t);
        return d;
    }
    function addBot(t) { return appendChat('bot', txt(t)); }
    function addUser(t) { appendChat('user', txt(t)); }
    function addBotErr(e) { appendChat('bot', txt(errMsg(e))).classList.add('cw-err-bubble'); }

    /* ─── Rendering helpers ────────────────────────────── */
    const PK = ['name','title','label','ward_name','province_name','agency_name','category_name','group_name'];
    const SK = ['code','id','ward_code','province_code','agency_code','category_code'];

    function pickPri(o) { for (const k of PK) if (o[k]) return String(o[k]); const f = Object.values(o).find(v=>typeof v==='string'); return f||'(Không có tên)'; }
    function pickSec(o) { for (const k of SK) if (o[k]!==undefined) return String(o[k]); return ''; }
    function labelFor(k) {
        const m={'name':'Tên','title':'Tên thủ tục','code':'Mã','agency':'Cơ quan','agency_name':'Cơ quan','level':'Cấp','fee':'Lệ phí','processing_time':'Thời gian','has_submission':'Nộp online','province_name':'Tỉnh/thành','ward_name':'Phường/xã','description':'Mô tả'};
        return m[k]||k;
    }

    function renderDetail(code) {
        addBot('Đang tải chi tiết…');
        callApi('/api/services/detail', { code }).then(data => {
            $chat.lastChild?.remove();
            const rows = [];
            if (data.code) rows.push([labelFor('code'), data.code]);
            if (data.issuing_agency) rows.push(['Cơ quan ban hành', data.issuing_agency]);
            if (data.is_ward) rows.push(['Cấp thực hiện','Phường/xã']);
            else if (data.is_province) rows.push(['Cấp thực hiện','Tỉnh/thành']);
            else if (data.is_ministry) rows.push(['Cấp thực hiện','Bộ/ngành']);
            if (Array.isArray(data.submission_methods)&&data.submission_methods.length)
                rows.push(['Hình thức nộp', data.submission_methods.join(', ')]);
            if (data.processing_time!=null) rows.push(['Thời gian', data.processing_time + (data.processing_time_unit?' '+data.processing_time_unit.toLowerCase():'')]);
            if (Array.isArray(data.fees)&&data.fees.length) rows.push(['Lệ phí', data.fees.map(v=>v.name||v).join('; ')]);
            else if (data.fee) rows.push(['Lệ phí', data.fee.name||data.fee]);
            if (Array.isArray(data.results)&&data.results.length) rows.push(['Kết quả', data.results.map(v=>v.name||v).join('; ')]);
            if (data.requirements) rows.push(['Hồ sơ', data.requirements.name||data.requirements]);
            if (data.has_submission!==undefined) rows.push(['Nộp online', data.has_submission?'Có':'Không']);
            const box = document.createElement('div');
            if (!rows.length) { box.appendChild(txt('Không có thông tin chi tiết.')); addBot(box); return; }
            const el = document.createElement('div'); el.className='cw-detail-rows';
            rows.forEach(([k,v])=>{
                const r=document.createElement('div'); r.className='cw-row';
                const a=document.createElement('div'); a.className='cw-row-k'; a.textContent=k;
                const b=document.createElement('div'); b.className='cw-row-v'; b.textContent=v;
                r.appendChild(a); r.appendChild(b); el.appendChild(r);
            });
            addBot(el);
        }).catch(e => { $chat.lastChild?.remove(); addBotErr(e); });
    }

    function renderList(items, empty) {
        const box = document.createElement('div');
        if (!items?.length) { box.appendChild(txt(empty||'Không có dữ liệu.')); addBot(box); return; }
        box.appendChild(txt('Tìm thấy ' + items.length + ' kết quả:'));
        const list = document.createElement('div'); list.className='cw-card-list';
        items.forEach(item => {
            const c = document.createElement('div');
            c.className = 'cw-card' + (item.has_submission?' cw-has-online':'');
            const body = document.createElement('div'); body.className='cw-card-body';
            const sec = pickSec(item);
            if (sec) { const co=document.createElement('div'); co.className='cw-card-code'; co.textContent='Mã: '+sec; body.appendChild(co); }
            const na=document.createElement('div'); na.className='cw-card-name'; na.textContent=pickPri(item); body.appendChild(na);
            if (item.has_submission) { const t=document.createElement('div'); t.className='cw-card-online'; t.textContent='Hỗ trợ nộp online'; body.appendChild(t); }
            c.appendChild(body);
            const btn=document.createElement('button'); btn.className='cw-card-btn'; btn.textContent='Xem chi tiết';
            btn.addEventListener('click',()=>renderDetail(sec));
            c.appendChild(btn);
            list.appendChild(c);
        });
        box.appendChild(list); addBot(box);
    }

    /* ─── Commands ─────────────────────────────────────── */
    function handleAction(text) {
        const t = text.trim().toLowerCase();
        if (t.startsWith('/trogiup')) {
            addBot(txt('Các lệnh:\n/danhmuc – Danh mục lĩnh vực\n/tinhthanh – Danh sách tỉnh/thành\n/canquan – Cơ quan ban hành\n/nhom – Nhóm dịch vụ\n/timphuong – Tìm phường/xã\n/timtinh [tên] – Tìm tỉnh/thành'));
            return;
        }
        if (t.startsWith('/danhmuc')) {
            addBot('Đang tải danh mục…');
            callApi('/api/services/categories').then(d=>renderList(d.categories||d.items||[])).catch(e=>addBotErr(e));
            return;
        }
        if (t.startsWith('/tinhthanh')) {
            addBot('Đang tải tỉnh/thành…');
            callApi('/api/locations/provinces').then(d=>renderList(d.provinces||d.items||[])).catch(e=>{
                callApi('/api/provinces').then(d2=>renderList(d2.provinces||d2.items||[])).catch(e2=>addBotErr(e2));
            });
            return;
        }
        if (t.startsWith('/canquan')) {
            addBot('Đang tải cơ quan…');
            callApi('/api/agencies').then(d=>renderList(d.agencies||d.items||[])).catch(e=>addBotErr(e));
            return;
        }
        if (t.startsWith('/nhom')) {
            addBot('Đang tải nhóm dịch vụ…');
            callApi('/api/service-groups').then(d=>renderList(d.groups||d.items||[])).catch(e=>addBotErr(e));
            return;
        }
        if (t.startsWith('/timphuong')) {
            addBot('Đang tìm phường/xã tại Phú Thọ…');
            const p = { [S.provinceParam]: '92' };
            callApi('/api/locations/wards', p).then(d=>renderList(d.wards||d.items||[])).catch(e=>{
                callApi('/api/wards', p).then(d2=>renderList(d2.wards||d2.items||[])).catch(e2=>addBotErr(e2));
            });
            return;
        }
        if (t.startsWith('/timtinh')) {
            const name = text.replace(/\/timtinh\s*/i,'').trim();
            addBot('Đang tìm tỉnh "' + (name||'Phú Thọ') + '"…');
            const p = {}; p[S.searchParam] = name || 'Phú Thọ';
            callApi('/api/locations/provinces', p).then(d=>renderList(d.provinces||d.items||[])).catch(e=>addBotErr(e));
            return;
        }
        // Tìm kiếm thủ tục
        addBot('Đang tìm: "' + text + '"…');
        const params = { [S.searchParam]: text };
        callApi('/api/services', params).then(d => {
            $chat.lastChild?.remove();
            const items = d.items||d.data?.items||[];
            renderList(items, 'Không tìm thấy thủ tục nào phù hợp.');
        }).catch(e => { $chat.lastChild?.remove(); addBotErr(e); });
    }

    /* ─── Input handlers ───────────────────────────────── */
    function doSend() {
        let raw = $input.value;
        const v = (typeof raw === 'string' ? raw : (raw && raw.textContent) || '').trim();
        if (!v) return;
        addUser(v);
        $input.value = '';
        $sendBtn.disabled = true;
        try { handleAction(v); } catch(e) { console.error('handleAction error:', e); }
        setTimeout(() => { $sendBtn.disabled = false; }, 800);
    }

    function safeString(x) {
        if (x == null) return '';
        if (typeof x === 'string') return x;
        if (typeof x === 'number' || typeof x === 'boolean') return String(x);
        if (x && typeof x === 'object') return x.textContent || x.value || x.outerHTML || '';
        return String(x);
    }

    /* ─── Widget open/close ────────────────────────────── */
    function openPanel() {
        $panel.hidden = false;
        $launcher.classList.add('cw-open');
        $badge.classList.add('cw-hide');
        if (window.matchMedia('(max-width:520px)').matches) $backdrop.hidden = false;
        setTimeout(() => $input.focus(), 200);
        $chat.scrollTop = $chat.scrollHeight;
    }

    function closePanel() {
        $panel.hidden = true;
        $launcher.classList.remove('cw-open');
        $backdrop.hidden = true;
    }

    /* ─── Boot ─────────────────────────────────────────── */
    function init() {
        injectStyle(CSS);
        injectHTML(HTML);

        $chat      = dom('cw-chat');
        $input     = dom('cw-input');
        $sendBtn   = dom('cw-send');
        $launcher  = dom('cw-launcher');
        $panel     = dom('cw-panel');
        $closeBtn  = dom('cw-close');
        $badge     = dom('cw-badge');
        $backdrop  = dom('cw-backdrop');

        // Events
        $launcher.addEventListener('click', () => {
            $panel.hidden ? openPanel() : closePanel();
        });
        $closeBtn.addEventListener('click', closePanel);
        $backdrop.addEventListener('click', closePanel);
        $sendBtn.addEventListener('click', doSend);
        $input.addEventListener('keydown', e => { if (e.key === 'Enter') doSend(); });
        document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$panel.hidden) closePanel(); });

        // Chips
        document.querySelectorAll('.cw-chip').forEach(chip => {
            chip.addEventListener('click', () => {
                openPanel();
                const action = chip.dataset.action;
                if (action === 'sample-search') handleAction('đăng ký kết hôn');
                else if (action === 'xuanlang') handleAction('thủ tục Phú Thọ');
                else if (action === 'categories') handleAction('/danhmuc');
                else if (action === 'myward') handleAction('thông tin xã Xuân Lãng Phú Thọ');
            });
        });

        // Greeting
        addBot('Xin chào! Tôi là trợ lý tra cứu thủ tục hành chính xã Xuân Lãng (Phú Thọ). Gõ /trogiup để xem lệnh hoặc nhập tên thủ tục bạn cần tìm.');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
