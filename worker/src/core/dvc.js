/**
 * DVC API client — lớp truy cập dữ liệu thủ tục hành chính.
 * Hoạt động ở cả 2 chế độ:
 *   - gateway: /api/*            (công khai, không cần key)
 *   - rest:    /rest/api/*       (cần X-API-Key tenant -> có thêm submission_links riêng của xã)
 */

const DEFAULT_BASE = 'https://dichvucong.cloudgo.vn';

export class DvcClient {
  constructor({ baseUrl, apiKey } = {}) {
    this.baseUrl = (baseUrl || DEFAULT_BASE).replace(/\/+$/, '');
    this.apiKey = apiKey || '';
  }

  get prefix() {
    return this.apiKey ? '/rest/api' : '/api';
  }

  async request(path, params = {}) {
    const url = new URL(this.baseUrl + this.prefix + path);
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === null || v === '') continue;
      url.searchParams.set(k, String(v));
    }
    const headers = { Accept: 'application/json' };
    if (this.apiKey) headers['X-API-Key'] = this.apiKey;

    const res = await fetch(url.toString(), { headers });
    const text = await res.text();
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try {
        const j = JSON.parse(text);
        msg = j.error || j.message || msg;
      } catch (_) { /* body không phải JSON */ }
      const err = new Error(msg);
      err.status = res.status;
      throw err;
    }
    try {
      return JSON.parse(text);
    } catch (_) {
      return text;
    }
  }

  health() {
    return this.request('/health');
  }

  /** Tìm thủ tục toàn quốc. */
  async searchProcedures(q, { limit = 8, page = 1 } = {}) {
    const d = await this.request('/procedures', { q, page, size: limit });
    return { total: d.total ?? 0, items: d.items || [] };
  }

  /**
   * Tìm thủ tục CÓ ÁP DỤNG tại một phường/xã.
   * Endpoint này lọc server-side theo từ khóa trong phạm vi xã -> chính xác & nhanh.
   */
  async searchWardProcedures(wardCode, q, { limit = 8, page = 1 } = {}) {
    const d = await this.request('/wards/' + encodeURIComponent(wardCode), {
      q: q || undefined,
      page,
      size: limit,
    });
    const p = d.procedures || { total: 0, items: [] };
    return { total: p.total ?? 0, items: p.items || [] };
  }

  /** Chi tiết đầy đủ một thủ tục. */
  getProcedure(code) {
    return this.request('/procedures/' + encodeURIComponent(code));
  }

  /** Tìm phường/xã theo tên. */
  async searchWards(name, { limit = 5 } = {}) {
    const d = await this.request('/wards', { q: name, size: limit });
    return d.items || [];
  }

  /** Tìm tỉnh/thành theo tên. */
  async searchProvinces(name, { limit = 5 } = {}) {
    const d = await this.request('/provinces', { q: name, size: limit });
    return d.items || [];
  }

  async listAgencies() {
    const d = await this.request('/agencies');
    return Array.isArray(d) ? d : (d.items || []);
  }

  async listCategories(q) {
    const d = await this.request('/categories', { q: q || undefined, size: 50 });
    return { total: d.total ?? 0, items: d.items || [] };
  }

  async listServiceGroups() {
    const d = await this.request('/service-groups');
    return Array.isArray(d) ? d : (d.items || []);
  }

  async stats() {
    return this.request('/stats');
  }
}
