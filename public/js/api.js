/* API 封装 */
const TOKEN_KEY = 'yzt_token';
const api = {
  token() { return localStorage.getItem(TOKEN_KEY); },
  setToken(t) { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); },
  async req(method, path, body) {
    const opt = { method, headers: { 'Content-Type': 'application/json' } };
    const tk = this.token();
    if (tk) opt.headers.Authorization = 'Bearer ' + tk;
    if (body) opt.body = JSON.stringify(body);
    const res = await fetch(path, opt);
    let data = null;
    try { data = await res.json(); } catch { /* ignore */ }
    if (!res.ok) {
      if (res.status === 401) { this.setToken(null); location.hash = '#/login'; }
      throw new Error(data?.error || `请求失败 (${res.status})`);
    }
    return data;
  },
  get(p) { return this.req('GET', p); },
  post(p, b) { return this.req('POST', p, b || {}); },
  put(p, b) { return this.req('PUT', p, b || {}); },
  del(p) { return this.req('DELETE', p); },
};
