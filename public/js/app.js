/* 应用入口：登录、布局、路由 */
const App = {
  ctx: null,       // bootstrap 返回的基础数据
  session: null,
  viewEl: null,

  nav: [
    { role: 'hq', group: '总部运营', items: [
      { path: '/hq/dashboard', icon: '📊', name: '品牌看板' },
      { path: '/hq/stores', icon: '🏬', name: '门店管理' },
      { path: '/hq/services', icon: '💆', name: '项目与定价' },
      { path: '/hq/membership', icon: '👑', name: '会员体系' },
      { path: '/hq/commission', icon: '💰', name: '技师提成标准' },
    ]},
    { role: 'hq', group: '人力与流水', items: [
      { path: '/hq/technicians', icon: '🧑‍🔧', name: '技师档案' },
      { path: '/hq/transfers', icon: '🔁', name: '调动记录' },
      { path: '/hq/orders', icon: '🧾', name: '全部门店账单' },
      { path: '/hq/handovers', icon: '📋', name: '交班记录' },
      { path: '/hq/recharges', icon: '💳', name: '充值流水' },
    ]},
    { role: 'store', group: '门店运营', items: [
      { path: '/store/dashboard', icon: '🏠', name: '门店看板' },
      { path: '/store/orders', icon: '🧾', name: '上钟开单' },
      { path: '/store/handover', icon: '📝', name: '交班结算' },
      { path: '/store/performance', icon: '💰', name: '技师业绩提成' },
    ]},
    { role: 'store', group: '人员与会员', items: [
      { path: '/store/technicians', icon: '🧑‍🔧', name: '技师管理' },
      { path: '/store/members', icon: '👥', name: '会员管理' },
      { path: '/store/handovers', icon: '📋', name: '历史交班记录' },
    ]},
  ],

  titles: {
    '/hq/dashboard': '品牌经营看板', '/hq/stores': '门店管理', '/hq/services': '项目与统一定价',
    '/hq/membership': '会员体系', '/hq/commission': '技师提成标准', '/hq/technicians': '技师档案',
    '/hq/transfers': '跨店调动记录', '/hq/orders': '全部门店账单', '/hq/handovers': '交班记录', '/hq/recharges': '会员充值流水',
    '/store/dashboard': '门店看板', '/store/orders': '上钟开单', '/store/handover': '交班结算',
    '/store/performance': '技师业绩提成', '/store/technicians': '技师管理', '/store/members': '会员管理',
    '/store/handovers': '历史交班记录',
  },

  async start() {
    if (location.hash === '' || location.hash === '#/' || location.hash === '#/login') {
      return this.showLogin();
    }
    if (!api.token()) return this.showLogin();
    try {
      this.ctx = await api.get('/api/bootstrap');
      this.session = this.ctx.user;
      this.renderShell();
      this.route();
    } catch (e) {
      this.showLogin();
    }
  },

  async showLogin() {
    api.setToken(null);
    this.session = null; this.ctx = null;
    location.hash = '#/login';
    document.getElementById('app').innerHTML = `
      <div class="login-wrap">
        <div class="login-card">
          <div class="brand-logo">
            <div class="brand-mark">足</div>
            <div class="brand-name">悦足堂</div>
          </div>
          <div class="brand-sub">连 锁 足 浴 · 智 慧 运 营 平 台</div>
          <div class="login-tabs">
            <button data-role="hq" class="active">总部登录</button>
            <button data-role="store">门店登录</button>
          </div>
          <div class="login-error" id="login-err"></div>
          <div class="field" id="store-field" style="display:none">
            <label>选择门店</label>
            <select id="login-store"></select>
          </div>
          <div class="field"><label>账号</label><input id="login-user" placeholder="请输入账号" autocomplete="username"></div>
          <div class="field"><label>密码</label><input id="login-pwd" type="password" placeholder="请输入密码" autocomplete="current-password"></div>
          <button class="btn-login" id="login-btn">登 录</button>
          <div class="login-hint" id="login-hint">
            演示账号：<span class="chip-quick" data-fill="hq|123456">总部 hq / 123456</span><br>
            <span class="chip-quick" data-fill="s01|123456">门店 s01 / 123456</span>
            <span class="chip-quick" data-fill="s04|123456">s04</span>
            <span class="chip-quick" data-fill="s06|123456">s06</span>
          </div>
        </div>
      </div>`;
    const stores = await api.get('/api/public/stores').catch(() => null);
    const storeSel = $('#login-store');
    if (stores && storeSel) {
      storeSel.innerHTML = stores.map((s, i) => `<option value="${s.id}">${esc(s.name)}</option>`).join('');
    }
    let role = 'hq';
    const tabs = document.querySelectorAll('.login-tabs button');
    tabs.forEach(b => b.onclick = () => {
      role = b.dataset.role;
      tabs.forEach(x => x.classList.toggle('active', x === b));
      $('#store-field').style.display = role === 'store' ? '' : 'none';
      if (role === 'store') { $('#login-user').value = 's01'; } else { $('#login-user').value = 'hq'; }
      $('#login-pwd').value = '123456';
    });
    storeSel?.addEventListener('change', () => { $('#login-user').value = 's' + storeSel.value.slice(1); $('#login-pwd').value = '123456'; });
    document.querySelectorAll('[data-fill]').forEach(c => c.onclick = () => {
      const [u, p] = c.dataset.fill.split('|');
      $('#login-user').value = u; $('#login-pwd').value = p;
      if (u.startsWith('s')) {
        tabs.forEach(x => x.classList.toggle('active', x.dataset.role === 'store'));
        role = 'store'; $('#store-field').style.display = '';
        if (storeSel) storeSel.value = 'S' + u.slice(1);
      }
    });
    $('#login-user').value = 'hq'; $('#login-pwd').value = '123456';

    const doLogin = async () => {
      const err = $('#login-err'); err.classList.remove('show');
      try {
        const r = await api.post('/api/login', { username: $('#login-user').value.trim(), password: $('#login-pwd').value });
        api.setToken(r.token);
        location.hash = r.user.role === 'hq' ? '#/hq/dashboard' : '#/store/dashboard';
        await App.start();
      } catch (e) {
        err.textContent = e.message; err.classList.add('show');
      }
    };
    $('#login-btn').onclick = doLogin;
    $('#login-pwd').onkeydown = (e) => { if (e.key === 'Enter') doLogin(); };
  },

  renderShell() {
    const u = this.session;
    const groups = this.nav.filter(g => g.role === u.role);
    const defaultPath = u.role === 'hq' ? '/hq/dashboard' : '/store/dashboard';
    document.getElementById('app').innerHTML = `
      <div class="layout">
        <aside class="sidebar">
          <div class="brand-logo">
            <div class="brand-mark">足</div>
            <div class="brand-name">悦足堂</div>
          </div>
          <div class="brand-sub">YU ZU TANG · CHAIN</div>
          <nav class="nav">
            ${groups.map(g => `
              <div class="nav-group">
                <h4>${g.group}</h4>
                ${g.items.map(it => `
                  <div class="nav-item" data-path="${it.path}"><span class="ico">${it.icon}</span>${it.name}</div>`).join('')}
              </div>`).join('')}
          </nav>
          <div class="side-foot">
            <div class="u-name">
              <span class="role-badge ${u.role}">${u.role === 'hq' ? '总部' : '门店'}</span>
              ${esc(u.name)}
            </div>
            ${u.role === 'store' ? `<div style="margin-top:3px">${esc(this.ctx.stores.find(s => s.id === u.storeId)?.name || '')}</div>` : '<div style="margin-top:3px">品牌运营管理中心</div>'}
            <button class="btn-logout" id="logout-btn">退出登录</button>
          </div>
        </aside>
        <div class="main">
          <header class="topbar">
            <div><h1 id="page-title">工作台</h1><div class="crumb" id="page-crumb"></div></div>
            <div class="muted" style="font-size:12.5px">${new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })}</div>
          </header>
          <main class="content" id="view"></main>
        </div>
      </div>`;
    document.querySelectorAll('.nav-item').forEach(el => el.onclick = () => { location.hash = '#' + el.dataset.path; });
    $('#logout-btn').onclick = async () => { await api.post('/api/logout').catch(() => {}); this.showLogin(); };
    this.viewEl = $('#view');
    window.addEventListener('hashchange', () => this.route());
  },

  route() {
    if (!this.session) return this.start();
    const path = location.hash.replace(/^#/, '') || (this.session.role === 'hq' ? '/hq/dashboard' : '/store/dashboard');
    const allowed = this.nav.flatMap(g => g.items).map(i => i.path);
    if (!allowed.includes(path)) { location.hash = '#' + (this.session.role === 'hq' ? '/hq/dashboard' : '/store/dashboard'); return; }
    if (this.session.role === 'hq' && !path.startsWith('/hq/')) { location.hash = '#/hq/dashboard'; return; }
    if (this.session.role === 'store' && !path.startsWith('/store/')) { location.hash = '#/store/dashboard'; return; }
    document.querySelectorAll('.nav-item').forEach(el => el.classList.toggle('active', el.dataset.path === path));
    $('#page-title').textContent = this.titles[path] || '工作台';
    const group = this.nav.find(g => g.items.some(i => i.path === path));
    const item = group?.items.find(i => i.path === path);
    $('#page-crumb').textContent = `${this.session.role === 'hq' ? '总部' : '门店'} · ${group?.group || ''} / ${item?.name || ''}`;
    closeModal();
    this.viewEl.innerHTML = loading();
    const handler = (Views[this.session.role] || {})[path.slice(1).split('/').slice(1).join('/')]
      || Object.entries(Views[this.session.role] || {}).find(([k]) => path.endsWith(k))?.[1];
    Promise.resolve(handler ? handler(this.viewEl) : (this.viewEl.innerHTML = emptyBox())).catch(e => {
      console.error(e);
      this.viewEl.innerHTML = `<div class="empty"><span class="e-ico">⚠️</span>加载失败：${esc(e.message)}</div>`;
    });
  },
};

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', () => App.start());
} else {
  App.start();
}
