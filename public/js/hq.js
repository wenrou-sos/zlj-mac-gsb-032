/* 总部端视图（hq.js 先于 store.js 加载，负责创建全局 Views） */
window.Views = window.Views || {};
const Views = window.Views;
Views.hq = {

/* ============ 品牌看板 ============ */
async 'dashboard'(el) {
  let days = Number(el.dataset.days) || 30;
  const [d] = await Promise.all([api.get(`/api/hq/dashboard?days=${days}`)]);
  el.innerHTML = `
    <div class="toolbar mb-16" style="justify-content:flex-end">
      <span class="muted" style="font-size:12.5px">统计周期 ${d.range.from} ~ ${d.range.to}</span>
      <div class="seg" id="range-seg">
        ${[7, 30, 45].map(n => `<button data-d="${n}" class="${n === days ? 'active' : ''}">近${n}天</button>`).join('')}
      </div>
    </div>
    <div class="grid g-4 mb-16">
      <div class="card kpi k-gold"><div class="k-ico">💰</div><div class="k-label">全品牌总营收</div><div class="k-val">${fmtMoney(d.kpi.totalRevenue)}</div><div class="k-foot">共 ${fmtNum(d.kpi.totalOrders)} 单 · 客单价 ${fmtMoney(d.kpi.avgTicket)}</div></div>
      <div class="card kpi k-jade"><div class="k-ico">👑</div><div class="k-label">会员充值总额</div><div class="k-val">${fmtMoney(d.kpi.rechargeTotal)}</div><div class="k-foot">含赠金 ${fmtMoney(d.kpi.rechargeBonus)} · 卡内余额 ${fmtMoney(d.kpi.memberBalances)}</div></div>
      <div class="card kpi k-blue"><div class="k-ico">🧑‍🔧</div><div class="k-label">在籍技师</div><div class="k-val">${d.kpi.activeTechCount}<small> 人</small></div><div class="k-foot">覆盖 ${d.kpi.storeCount} 家门店 · ${d.kpi.memberCount} 位会员</div></div>
      <div class="card kpi k-red"><div class="k-ico">📈</div><div class="k-label">技师提成总额</div><div class="k-val">${fmtMoney(d.kpi.totalCommission)}</div><div class="k-foot">占营收 ${(d.kpi.totalCommission / Math.max(1, d.kpi.totalRevenue) * 100).toFixed(1)}%</div></div>
    </div>
    <div class="grid g-2 mb-16">
      <div class="card">
        <div class="card-h"><h3>🏬 各门店营收排行</h3><span class="sub">单位：元</span></div>
        <div class="card-b" id="rank-box"></div>
      </div>
      <div class="card">
        <div class="card-h"><h3>📈 全品牌日营收趋势</h3></div>
        <div class="card-b">${Charts.areaLine(d.trend, { id: 'hq' })}</div>
      </div>
    </div>
    <div class="grid g-2">
      <div class="card">
        <div class="card-h"><h3>🥧 各项目品类销售占比</h3></div>
        <div class="card-b" style="display:flex;gap:24px;align-items:center;flex-wrap:wrap">
          <div>${Charts.donut(d.catShare.map(c => ({ name: c.category, value: c.revenue })), { centerLabel: '品类营收' })}</div>
          <div style="flex:1;min-width:240px">${Charts.legend(d.catShare.map(c => ({ name: c.category, value: c.revenue })))}</div>
        </div>
      </div>
      <div class="card">
        <div class="card-h"><h3>💆 项目销售 TOP ${d.serviceShare.length}</h3><span class="sub">按营收排序</span></div>
        <div class="card-b tbl-wrap">
          <table class="tbl">
            <thead><tr><th>#</th><th>项目</th><th class="num">销量</th><th class="num">营收</th><th class="num">占比</th></tr></thead>
            <tbody>${d.serviceShare.map((s, i) => `
              <tr><td class="muted">${i + 1}</td><td>${esc(s.name)}</td><td class="num">${s.count}</td>
              <td class="num money">${fmtMoney(s.revenue)}</td>
              <td class="num">${(s.revenue / Math.max(1, d.kpi.totalRevenue) * 100).toFixed(1)}%</td></tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>`;
  $('#rank-box').innerHTML = Charts.rankBars(d.storeRank.map(s => ({
    name: s.name, sub: s.city, value: s.revenue, extra: `${s.orders} 单`,
  })));
  $('#range-seg').querySelectorAll('button').forEach(b => b.onclick = () => {
    el.dataset.days = b.dataset.d; Views.hq.dashboard(el);
  });
},

/* ============ 门店管理 ============ */
async 'stores'(el) {
  const stores = await api.get('/api/stores');
  el.innerHTML = `
    <div class="card">
      <div class="card-h">
        <h3>🏬 门店列表 <span class="sub">共 ${stores.length} 家直营门店</span></h3>
        <button class="btn btn-gold" id="add-store">＋ 新增门店</button>
      </div>
      <div class="tbl-wrap">
        <table class="tbl">
          <thead><tr><th>编号</th><th>门店名称</th><th>城市</th><th>地址</th><th>店长</th><th>电话</th><th class="num">在籍技师</th><th class="num">会员</th><th>开业日期</th><th></th></tr></thead>
          <tbody>${stores.map(s => `
            <tr><td class="muted">${s.id}</td><td><b>${esc(s.name)}</b></td><td>${esc(s.city)}</td>
            <td class="muted" style="max-width:220px">${esc(s.address)}</td><td>${esc(s.manager)}</td><td class="nowrap muted">${esc(s.phone)}</td>
            <td class="num">${s.techCount}</td><td class="num">${s.memberCount}</td><td class="nowrap muted">${s.opened}</td>
            <td class="nowrap"><button class="btn btn-sm" data-edit='${esc(JSON.stringify(s))}'>编辑</button></td></tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>`;
  const form = (s = {}) => `
    <div class="form-row"><div class="form-item"><label><span class="req">*</span>门店名称</label><input id="f-name" value="${esc(s.name || '')}" placeholder="如：五角场合生汇店"></div>
    <div class="form-item"><label><span class="req">*</span>城市</label><input id="f-city" value="${esc(s.city || '')}" placeholder="如：上海"></div></div>
    <div class="form-row"><div class="form-item"><label>店长</label><input id="f-manager" value="${esc(s.manager || '')}"></div>
    <div class="form-item"><label>联系电话</label><input id="f-phone" value="${esc(s.phone || '')}"></div></div>
    <div class="form-row one"><div class="form-item"><label>详细地址</label><input id="f-address" value="${esc(s.address || '')}"></div></div>
    <div class="form-row"><div class="form-item"><label>开业日期</label><input type="date" id="f-opened" value="${s.opened || new Date().toISOString().slice(0, 10)}"></div></div>`;
  $('#add-store').onclick = () => {
    const m = openModal({ title: '新增门店', body: form(), footer: `<button class="btn" data-close>取消</button><button class="btn btn-primary" id="ok">保存</button>` });
    $('#ok', m.el).onclick = async () => {
      const body = {};
      ['name', 'city', 'manager', 'phone', 'address', 'opened'].forEach(k => body[k] = $('#f-' + k, m.el).value.trim());
      try { await api.post('/api/stores', body); toast('门店已创建'); closeModal(); this.stores(el); } catch (e) { toast(e.message, 'error'); }
    };
  };
  el.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => {
    const s = JSON.parse(b.dataset.edit);
    const m = openModal({ title: '编辑门店 · ' + s.name, body: form(s), footer: `<button class="btn" data-close>取消</button><button class="btn btn-primary" id="ok">保存</button>` });
    $('#ok', m.el).onclick = async () => {
      const body = {};
      ['name', 'city', 'manager', 'phone', 'address', 'opened'].forEach(k => body[k] = $('#f-' + k, m.el).value.trim());
      await api.put('/api/stores/' + s.id, body); toast('已保存'); closeModal(); this.stores(el);
    };
  });
},

/* ============ 项目与定价 ============ */
async 'services'(el) {
  const services = await api.get('/api/services');
  const cats = [...new Set(services.map(s => s.category))];
  el.innerHTML = `
    <div class="card mb-16" style="background:linear-gradient(120deg,#f3f9f7,#fbf7ec);border-color:#e0ece6">
      <div class="card-b" style="padding:14px 20px;font-size:13px;color:#46605b">
        💡 项目与价格由总部统一维护，所有门店实时同步生效。历史账单价格不受调价影响；技师提成默认按等级比例，特殊项目可在「技师提成标准」中设置固定提成。
      </div>
    </div>
    <div class="card">
      <div class="card-h"><h3>💆 服务项目目录</h3>
        <div class="toolbar"><div class="seg" id="cat-seg"><button class="active" data-c="">全部</button>${cats.map(c => `<button data-c="${c}">${c}</button>`).join('')}</div>
        <button class="btn btn-gold" id="add-svc">＋ 新增项目</button></div>
      </div>
      <div class="tbl-wrap" id="svc-tbl"></div>
    </div>`;
  const render = (cat) => {
    const list = cat ? services.filter(s => s.category === cat) : services;
    $('#svc-tbl', el).innerHTML = `
      <table class="tbl"><thead><tr><th>编号</th><th>项目名称</th><th>品类</th><th class="num">时长(分)</th><th class="num">统一价</th><th class="num">近30天销量</th><th>状态</th><th></th></tr></thead>
      <tbody>${list.map(s => `
        <tr><td class="muted">${s.id}</td><td><b>${esc(s.name)}</b></td><td><span class="tag tag-blue">${esc(s.category)}</span></td>
        <td class="num">${s.duration}</td><td class="num money">${fmtMoney(s.price)}</td><td class="num">${s.sold30}</td>
        <td>${s.active ? '<span class="tag tag-green">上架中</span>' : '<span class="tag tag-gray">已下架</span>'}</td>
        <td class="nowrap"><button class="btn btn-sm" data-edit='${esc(JSON.stringify(s))}'>调价/编辑</button></td></tr>`).join('')}
      </tbody></table>`;
    el.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => editSvc(JSON.parse(b.dataset.edit)));
  };
  render('');
  $('#cat-seg', el).querySelectorAll('button').forEach(b => b.onclick = () => {
    $('#cat-seg', el).querySelectorAll('button').forEach(x => x.classList.toggle('active', x === b));
    render(b.dataset.c);
  });
  const form = (s = {}) => `
    <div class="form-row"><div class="form-item"><label><span class="req">*</span>项目名称</label><input id="f-name" value="${esc(s.name || '')}"></div>
    <div class="form-item"><label>品类</label><select id="f-category">${['足疗', '推拿', 'SPA', '调理', '特色', '其他'].map(c => `<option ${s.category === c ? 'selected' : ''}>${c}</option>`).join('')}</select></div></div>
    <div class="form-row"><div class="form-item"><label><span class="req">*</span>统一价格（元）</label><input type="number" min="1" id="f-price" value="${s.price ?? ''}"></div>
    <div class="form-item"><label>服务时长（分钟）</label><input type="number" min="10" step="5" id="f-duration" value="${s.duration ?? 60}"></div></div>
    <div class="form-row one"><div class="form-item"><label>状态</label><select id="f-active"><option value="1" ${s.active !== 0 ? 'selected' : ''}>上架</option><option value="0" ${s.active === 0 ? 'selected' : ''}>下架</option></select></div></div>`;
  function editSvc(s) {
    const m = openModal({ title: s.id ? '调价 / 编辑项目' : '新增项目', body: form(s), footer: `<button class="btn" data-close>取消</button><button class="btn btn-primary" id="ok">保存并同步全部门店</button>` });
    $('#ok', m.el).onclick = async () => {
      const body = { name: $('#f-name', m.el).value.trim(), category: $('#f-category', m.el).value, price: Number($('#f-price', m.el).value), duration: Number($('#f-duration', m.el).value), active: Number($('#f-active', m.el).value) };
      if (!body.name || !(body.price > 0)) return toast('请填写名称与有效价格', 'error');
      try {
        if (s.id) await api.put('/api/services/' + s.id, body); else await api.post('/api/services', body);
        toast('价格已同步至全部门店'); closeModal(); Views.hq.services(el);
      } catch (e) { toast(e.message, 'error'); }
    };
  }
  $('#add-svc', el).onclick = () => editSvc({});
},

/* ============ 会员体系 ============ */
async 'membership'(el) {
  const levels = await api.get('/api/member-levels');
  const members = await api.get('/api/members');
  const totalBalance = members.reduce((a, m) => a + m.balance, 0);
  const totalRecharge = members.reduce((a, m) => a + m.totalRecharge, 0);
  const lvCount = levels.map(l => members.filter(m => m.levelId === l.id).length);
  el.innerHTML = `
    <div class="grid g-4 mb-16">
      <div class="card kpi"><div class="k-label">会员总数</div><div class="k-val">${members.length}<small> 人</small></div></div>
      <div class="card kpi k-gold"><div class="k-label">累计充值（含赠）</div><div class="k-val">${fmtMoney(totalRecharge)}</div></div>
      <div class="card kpi k-jade"><div class="k-label">会员卡总余额</div><div class="k-val">${fmtMoney(totalBalance)}</div></div>
      <div class="card kpi k-blue"><div class="k-label">充值满 3000 赠</div><div class="k-val">10<small>%</small></div><div class="k-foot">系统自动发放赠金</div></div>
    </div>
    <div class="card">
      <div class="card-h"><h3>👑 会员等级与折扣体系</h3><span class="sub">调整后新开卡/消费即时生效</span></div>
      <div class="tbl-wrap">
        <table class="tbl"><thead><tr><th>等级</th><th class="num">累计充值门槛</th><th class="num">消费折扣</th><th class="num">当前人数</th><th></th></tr></thead>
        <tbody>${levels.map((l, i) => `
          <tr><td><span class="tag tag-gold">${esc(l.name)}</span></td>
          <td class="num money">${l.threshold === 0 ? '注册即享' : '≥ ' + fmtMoney(l.threshold)}</td>
          <td class="num"><b>${(l.discount * 10).toFixed(1)} 折</b></td>
          <td class="num">${lvCount[i]}</td>
          <td><button class="btn btn-sm" data-edit="${l.id}">调整</button></td></tr>`).join('')}
        </tbody></table>
      </div>
    </div>`;
  el.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => {
    const l = levels.find(x => x.id === b.dataset.edit);
    const m = openModal({
      title: '调整会员等级 · ' + l.name,
      body: `<div class="form-row">
        <div class="form-item"><label>等级名称</label><input id="f-name" value="${esc(l.name)}"></div>
        <div class="form-item"><label>升级门槛（累计充值元，0=注册即享）</label><input type="number" min="0" id="f-th" value="${l.threshold}"></div></div>
        <div class="form-row one"><div class="form-item"><label>消费折扣（0.75 = 75折）</label><input type="number" min="0.5" max="1" step="0.01" id="f-dc" value="${l.discount}"></div></div>
        <p class="muted" style="font-size:12.5px">⚠️ 降低门槛/提高折扣将影响后续所有会员的消费金额，请谨慎调整。</p>`,
      footer: `<button class="btn" data-close>取消</button><button class="btn btn-primary" id="ok">保存</button>`,
    });
    $('#ok', m.el).onclick = async () => {
      try {
        await api.put('/api/member-levels/' + l.id, { name: $('#f-name', m.el).value.trim(), threshold: Number($('#f-th', m.el).value), discount: Number($('#f-dc', m.el).value) });
        toast('会员体系已更新'); closeModal(); this.membership(el);
      } catch (e) { toast(e.message, 'error'); }
    };
  });
},

/* ============ 技师提成标准 ============ */
async 'commission'(el) {
  const { levels, rules, services } = await api.get('/api/commission-rules');
  el.innerHTML = `
    <div class="card mb-16">
      <div class="card-h"><h3>🏅 技师等级默认提成比例</h3><span class="sub">按实付金额计提</span></div>
      <div class="card-b">
        <div class="grid g-4">
          ${levels.map(l => `
            <div class="pay-box" style="text-align:left">
              <div class="p-l">${esc(l.name)}</div>
              <div class="p-v" style="color:#123a3f">${(l.commissionRate * 100).toFixed(0)}%</div>
              <button class="btn btn-sm" data-lv="${l.id}" style="margin-top:8px">调整比例</button>
            </div>`).join('')}
        </div>
      </div>
    </div>
    <div class="card">
      <div class="card-h"><h3>📌 项目专项提成规则</h3><span class="sub">优先于等级默认比例（同一项目+等级仅一条）</span>
        <button class="btn btn-gold" id="add-rule">＋ 新增专项规则</button></div>
      <div class="tbl-wrap">
        <table class="tbl"><thead><tr><th>规则名称</th><th>项目</th><th>技师等级</th><th>提成方式</th><th>状态</th><th></th></tr></thead>
          <tbody>${rules.length ? rules.map(r => `
            <tr><td><b>${esc(r.name)}</b></td><td>${esc(services.find(s => s.id === r.serviceId)?.name)}</td>
            <td>${esc(levels.find(l => l.id === r.levelId)?.name)}</td>
            <td>${r.type === 'fixed' ? `每单固定 <b class="money">${fmtMoney(r.value)}</b>` : `按比例 <b>${(r.value * 100).toFixed(0)}%</b>`}</td>
            <td>${r.active ? '<span class="tag tag-green">生效中</span>' : '<span class="tag tag-gray">已停用</span>'}</td>
            <td class="nowrap"><button class="btn btn-sm" data-edit='${esc(JSON.stringify(r))}'>编辑</button>
            <button class="btn btn-sm btn-danger" data-del="${r.id}">删除</button></td></tr>`).join('')
            : `<tr><td colspan="6">${emptyBox('暂无专项规则，默认全部使用等级比例提成')}</td></tr>`}</tbody>
        </table>
      </div>
    </div>`;
  el.querySelectorAll('[data-lv]').forEach(b => b.onclick = () => {
    const l = levels.find(x => x.id === b.dataset.lv);
    const m = openModal({ title: '调整默认提成比例 · ' + l.name,
      body: `<div class="form-row one"><div class="form-item"><label>提成比例（实付金额的百分比，0~100）</label>
        <input type="number" min="1" max="100" id="f-rate" value="${Math.round(l.commissionRate * 100)}"></div></div>`,
      footer: `<button class="btn" data-close>取消</button><button class="btn btn-primary" id="ok">保存</button>` });
    $('#ok', m.el).onclick = async () => {
      try { await api.put('/api/tech-levels/' + l.id, { commissionRate: Number($('#f-rate', m.el).value) / 100 }); toast('已保存'); closeModal(); this.commission(el); }
      catch (e) { toast(e.message, 'error'); }
    };
  });
  const form = (r = {}) => `
    <div class="form-row one"><div class="form-item"><label>规则名称</label><input id="f-name" value="${esc(r.name || '')}" placeholder="如：金牌·热石SPA专项补贴"></div></div>
    <div class="form-row"><div class="form-item"><label><span class="req">*</span>适用项目</label><select id="f-svc">${services.map(s => `<option value="${s.id}" ${r.serviceId === s.id ? 'selected' : ''}>${esc(s.name)}（${fmtMoney(s.price)}）</option>`).join('')}</select></div>
    <div class="form-item"><label><span class="req">*</span>技师等级</label><select id="f-lv">${levels.map(l => `<option value="${l.id}" ${r.levelId === l.id ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}</select></div></div>
    <div class="form-row"><div class="form-item"><label>提成方式</label><select id="f-type"><option value="fixed" ${r.type === 'fixed' ? 'selected' : ''}>每单固定金额（元）</option><option value="rate" ${r.type === 'rate' ? 'selected' : ''}>实付比例（%）</option></select></div>
    <div class="form-item"><label><span class="req">*</span>数值</label><input type="number" min="1" step="0.01" id="f-val" value="${r.value ?? ''}"></div></div>`;
  const openRule = (r = {}) => {
    const m = openModal({ title: r.id ? '编辑专项提成规则' : '新增专项提成规则', body: form(r),
      footer: `<button class="btn" data-close>取消</button><button class="btn btn-primary" id="ok">保存</button>` });
    $('#ok', m.el).onclick = async () => {
      const type = $('#f-type', m.el).value;
      let value = Number($('#f-val', m.el).value);
      if (type === 'rate') value = value / 100;
      const body = { name: $('#f-name', m.el).value.trim() || '提成规则', serviceId: $('#f-svc', m.el).value, levelId: $('#f-lv', m.el).value, type, value };
      try {
        if (r.id) await api.put('/api/commission-rules/' + r.id, body); else await api.post('/api/commission-rules', body);
        toast('规则已保存'); closeModal(); this.commission(el);
      } catch (e) { toast(e.message, 'error'); }
    };
  };
  $('#add-rule', el).onclick = () => openRule();
  el.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => openRule(JSON.parse(b.dataset.edit)));
  el.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
    if (await confirmAsync('确定删除该专项提成规则？删除后该项目+等级将恢复使用默认比例。', '删除')) {
      await api.del('/api/commission-rules/' + b.dataset.del); toast('已删除'); this.commission(el);
    }
  });
},

/* ============ 技师档案（总部） ============ */
async 'technicians'(el) { return techList(el, 'hq'); },

/* ============ 调动记录 ============ */
async 'transfers'(el) {
  const transfers = await api.get('/api/transfers');
  el.innerHTML = `
    <div class="card">
      <div class="card-h"><h3>🔁 技师跨店调动记录</h3><button class="btn btn-gold" id="new-transfer">＋ 办理调动</button></div>
      <div class="tbl-wrap">
        <table class="tbl"><thead><tr><th>调令编号</th><th>技师</th><th>原门店</th><th></th><th>调入门店</th><th>调动日期</th><th>原因</th></tr></thead>
          <tbody>${transfers.length ? transfers.map(t => `
            <tr><td class="muted">${t.id}</td><td><b>${esc(t.techName)}</b></td>
            <td>${esc(t.fromStoreName || t.fromStoreId)}</td><td class="muted">→</td>
            <td>${esc(t.toStoreName || t.toStoreId)}</td><td class="nowrap">${t.transferDate}</td>
            <td class="muted">${esc(t.reason)}</td></tr>`).join('')
            : `<tr><td colspan="7">${emptyBox('暂无调动记录')}</td></tr>`}</tbody>
        </table>
      </div>
    </div>`;
  $('#new-transfer', el).onclick = () => transferDialog(el, 'hq');
},

/* ============ 全部账单 ============ */
async 'orders'(el) {
  const stores = App.ctx.stores;
  el.innerHTML = `
    <div class="card">
      <div class="card-h"><h3>🧾 全部门店账单流水</h3>
        <div class="toolbar">
          <select class="inp" id="f-store">${storeOptions(stores, '', '全部门店')}</select>
          <input type="date" class="inp" id="f-date">
          <button class="btn" id="f-btn">查询</button>
        </div>
      </div>
      <div id="ord-box" class="tbl-wrap">${loading()}</div>
      <div class="card-b" id="ord-sum" style="background:#fafcfb;border-top:1px solid var(--line);display:none"></div>
    </div>`;
  const load = async () => {
    const sid = $('#f-store', el).value, date = $('#f-date', el).value;
    const qs = new URLSearchParams(); if (sid) qs.set('storeId', sid); if (date) qs.set('date', date);
    const list = await api.get('/api/orders?' + qs);
    const valid = list.filter(o => !o.status || o.status === 'valid');
    const total = valid.reduce((a, o) => a + o.amount, 0);
    const comm = valid.reduce((a, o) => a + o.techCommission, 0);
    $('#ord-box', el).innerHTML = `
      <table class="tbl"><thead><tr><th>账单号</th><th>时间</th><th>门店</th><th>项目</th><th>技师</th><th>会员</th><th class="num">原价</th><th class="num">折扣</th><th class="num">实付</th><th>支付</th><th class="num">提成</th><th>状态</th></tr></thead>
      <tbody>${list.length ? list.map(o => `
        <tr class="${o.status && o.status !== 'valid' ? 'row-void' : ''}"><td class="muted nowrap">${o.orderNo}</td><td class="nowrap muted">${o.createdAt.slice(5, 16)}</td>
        <td style="max-width:150px">${esc(o.storeName)}</td><td>${esc(o.serviceName)}</td><td>${esc(o.techName)}</td>
        <td>${o.memberName ? esc(o.memberName) : '<span class="muted">散客</span>'}</td>
        <td class="num muted">${fmtMoney(o.price)}</td><td class="num muted">${o.discountRate < 1 ? (o.discountRate * 10).toFixed(1) + '折' : '—'}</td>
        <td class="num money">${fmtMoney(o.amount)}</td><td>${payTag(o.payMethod)}</td><td class="num">${fmtMoney(o.techCommission)}</td>
        <td>${o.status && o.status !== 'valid' ? `<span class="tag tag-red">${esc(o.statusName)}</span>` : '<span class="tag tag-green">正常</span>'}</td></tr>`).join('')
        : `<tr><td colspan="12">${emptyBox('该条件下暂无账单')}</td></tr>`}</tbody></table>`;
    $('#ord-sum', el).style.display = '';
    $('#ord-sum', el).innerHTML = `<b>合计（不含已冲正 ${list.length - valid.length} 单）：</b>${valid.length} 单 ｜ 实收 <b class="money">${fmtMoney(total)}</b> ｜ 技师提成 <b class="money red">${fmtMoney(comm)}</b>`;
  };
  $('#f-btn', el).onclick = () => load().catch(e => toast(e.message, 'error'));
  load();
},

/* ============ 交班记录（总部） ============ */
async 'handovers'(el) {
  const stores = App.ctx.stores;
  el.innerHTML = `
    <div class="card">
      <div class="card-h"><h3>📋 全品牌交班记录</h3>
        <select class="inp" id="f-store">${storeOptions(stores, '', '全部门店')}</select></div>
      <div id="hd-box" class="tbl-wrap">${loading()}</div>
    </div>`;
  const load = async () => {
    const sid = $('#f-store', el).value;
    const list = await api.get('/api/handovers' + (sid ? '?storeId=' + sid : ''));
    $('#hd-box', el).innerHTML = `
      <table class="tbl"><thead><tr><th>日期</th><th>班次</th><th>门店</th><th class="num">接待</th><th class="num">现金</th><th class="num">刷卡</th><th class="num">会员卡</th><th class="num">移动支付</th><th class="num">营收合计</th><th class="num">提成</th><th>交班/接班</th><th></th></tr></thead>
      <tbody>${list.length ? list.map(x => `
        <tr><td class="nowrap">${x.businessDate}</td><td>${esc(x.shiftName)}</td><td>${esc(x.storeName)}</td>
        <td class="num">${x.serveCount}</td><td class="num">${fmtMoney(x.cash)}</td><td class="num">${fmtMoney(x.card)}</td>
        <td class="num">${fmtMoney(x.member)}</td><td class="num">${fmtMoney(x.mp)}</td>
        <td class="num money">${fmtMoney(x.revenue)}</td><td class="num red">${fmtMoney(x.commission)}</td>
        <td class="nowrap" style="font-size:12.5px">${esc(x.opener)} → ${esc(x.closer)}</td>
        <td><button class="btn btn-sm" data-view="${x.id}">明细/签字</button></td></tr>`).join('')
        : `<tr><td colspan="12">${emptyBox('暂无交班记录')}</td></tr>`}</tbody></table>`;
    el.querySelectorAll('[data-view]').forEach(b => b.onclick = () => handoverDetail(b.dataset.view));
  };
  $('#f-store', el).onchange = load;
  load();
},

/* ============ 充值流水 ============ */
async 'recharges'(el) {
  const stores = App.ctx.stores;
  const [list] = await Promise.all([api.get('/api/recharges')]);
  const total = list.reduce((a, r) => a + r.amount, 0), bonus = list.reduce((a, r) => a + (r.bonus || 0), 0);
  el.innerHTML = `
    <div class="grid g-3 mb-16">
      <div class="card kpi k-gold"><div class="k-label">充值本金合计</div><div class="k-val">${fmtMoney(total)}</div><div class="k-foot">最近 ${list.length} 笔</div></div>
      <div class="card kpi k-jade"><div class="k-label">赠送金额合计</div><div class="k-val">${fmtMoney(bonus)}</div></div>
      <div class="card kpi"><div class="k-label">平均单笔充值</div><div class="k-val">${fmtMoney(list.length ? Math.round(total / list.length) : 0)}</div></div>
    </div>
    <div class="card">
      <div class="card-h"><h3>💳 会员充值流水</h3>
        <select class="inp" id="f-store">${storeOptions(stores, '', '全部门店')}</select></div>
      <div class="tbl-wrap" id="rc-box"></div>
    </div>`;
  const render = () => {
    const sid = $('#f-store', el).value;
    const data = sid ? list.filter(r => r.storeId === sid) : list;
    $('#rc-box', el).innerHTML = `<table class="tbl"><thead><tr><th>单号</th><th>时间</th><th>门店</th><th>会员</th><th class="num">充值本金</th><th class="num">赠金</th><th class="num">到账</th><th>支付方式</th></tr></thead>
      <tbody>${data.map(r => `<tr><td class="muted nowrap">${r.id}</td><td class="nowrap muted">${r.createdAt}</td>
      <td>${esc(r.storeName)}</td><td><b>${esc(r.memberName)}</b></td>
      <td class="num money">${fmtMoney(r.amount)}</td><td class="num" style="color:var(--jade)">+${fmtMoney(r.bonus)}</td>
      <td class="num money">${fmtMoney(r.amount + r.bonus)}</td><td>${payTag(r.payMethod)}</td></tr>`).join('')}</tbody></table>`;
  };
  $('#f-store', el).onchange = render;
  render();
},

/* ============ 耗材档案与采购成本 ============ */
async 'materials'(el) {
  const [list, policy] = await Promise.all([api.get('/api/materials'), api.get('/api/inventory-policy')]);
  const cats = [...new Set(list.map(m => m.category))];
  el.innerHTML = `
    <div class="card mb-16" style="background:linear-gradient(120deg,#f3f9f7,#fbf7ec);border-color:#e0ece6">
      <div class="card-b" style="display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap">
        <div style="font-size:13px;color:#46605b;max-width:760px">
          💡 耗材档案与采购成本由总部统一维护。<b>调整采购成本或配方只对之后的采购与开单生效</b>，历史账单始终按开单当时的配方快照（名称/用量/单价）核算，不被追溯改写。
        </div>
        <div class="toolbar">
          <span class="muted" style="font-size:12.5px">库存不足时：</span>
          <div class="seg" id="policy-seg">
            <button data-m="strict" class="${policy.shortageMode === 'strict' ? 'active' : ''}">禁止开单</button>
            <button data-m="negative" class="${policy.shortageMode === 'negative' ? 'active' : ''}">允许负库存+预警</button>
          </div>
        </div>
      </div>
    </div>
    <div class="card">
      <div class="card-h"><h3>📦 耗材档案 <span class="sub">共 ${list.length} 种 · 全品牌库存合计</span></h3>
        <div class="toolbar">
          <select class="inp" id="f-cat"><option value="">全部分类</option>${cats.map(c => `<option>${esc(c)}</option>`).join('')}</select>
          <button class="btn btn-gold" id="add-mat">＋ 新增耗材</button>
        </div>
      </div>
      <div class="tbl-wrap" id="mat-tbl"></div>
    </div>`;
  const render = () => {
    const cat = $('#f-cat', el).value;
    const rows = cat ? list.filter(m => m.category === cat) : list;
    $('#mat-tbl', el).innerHTML = `
      <table class="tbl"><thead><tr><th>编号</th><th>耗材名称</th><th>规格</th><th>分类</th><th>单位</th><th class="num">采购成本</th><th class="num">全品牌库存</th><th>状态</th><th></th></tr></thead>
      <tbody>${rows.map(m => `
        <tr><td class="muted">${m.id}</td><td><b>${esc(m.name)}</b></td><td class="muted">${esc(m.spec)}</td>
        <td><span class="tag tag-blue">${esc(m.category)}</span></td><td>${esc(m.unit)}</td>
        <td class="num money">${fmtMoney(m.defaultCost)}<span class="muted"> /${esc(m.unit)}</span></td>
        <td class="num ${m.totalQty <= 0 ? 'qty-neg' : ''}">${fmtNum(m.totalQty)} ${esc(m.unit)}</td>
        <td>${m.active ? '<span class="tag tag-green">启用</span>' : '<span class="tag tag-gray">停用</span>'}</td>
        <td class="nowrap"><button class="btn btn-sm" data-edit='${esc(JSON.stringify(m))}'>编辑/调价</button></td></tr>`).join('')}
      </tbody></table>`;
    el.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => editMat(JSON.parse(b.dataset.edit)));
  };
  $('#f-cat', el).onchange = render;
  $('#policy-seg', el).querySelectorAll('button').forEach(b => b.onclick = async () => {
    try {
      await api.put('/api/inventory-policy', { shortageMode: b.dataset.m });
      toast(b.dataset.m === 'strict' ? '已切换为：库存不足禁止开单' : '已切换为：允许负库存开单并自动预警');
      $('#policy-seg', el).querySelectorAll('button').forEach(x => x.classList.toggle('active', x === b));
    } catch (e) { toast(e.message, 'error'); }
  });
  const form = (m = {}) => `
    <div class="form-row"><div class="form-item"><label><span class="req">*</span>耗材名称</label><input id="f-name" value="${esc(m.name || '')}" placeholder="如：一次性泡脚袋"></div>
    <div class="form-item"><label>分类</label><select id="f-cat2">${['一次性耗材', '药浴耗材', '精油药油', '消毒用品', '工具耗材', '调理耗材', '其他耗材'].map(c => `<option ${m.category === c ? 'selected' : ''}>${c}</option>`).join('')}</select></div></div>
    <div class="form-row"><div class="form-item"><label>规格型号</label><input id="f-spec" value="${esc(m.spec || '')}" placeholder="如：加厚 65×55cm"></div>
    <div class="form-item"><label><span class="req">*</span>计量单位</label><input id="f-unit" value="${esc(m.unit || '')}" placeholder="个 / 条 / ml / 包"></div></div>
    <div class="form-row"><div class="form-item"><label><span class="req">*</span>标准采购成本（元）</label><input type="number" min="0" step="0.01" id="f-cost" value="${m.defaultCost ?? ''}"></div>
    <div class="form-item"><label>状态</label><select id="f-active"><option value="1" ${m.active !== 0 ? 'selected' : ''}>启用</option><option value="0" ${m.active === 0 ? 'selected' : ''}>停用</option></select></div></div>
    <p class="muted" style="font-size:12.5px">成本单价将作为门店采购默认价与项目毛利核算依据；门店可按实际采购价入库，以实际价计入流水。</p>`;
  function editMat(m) {
    const mo = openModal({ title: m.id ? `编辑耗材 · ${m.name}` : '新增耗材档案', body: form(m), footer: `<button class="btn" data-close>取消</button><button class="btn btn-primary" id="ok">保存</button>` });
    $('#ok', mo.el).onclick = async () => {
      const body = { name: $('#f-name', mo.el).value.trim(), category: $('#f-cat2', mo.el).value, spec: $('#f-spec', mo.el).value.trim(), unit: $('#f-unit', mo.el).value.trim(), defaultCost: Number($('#f-cost', mo.el).value), active: Number($('#f-active', mo.el).value) };
      if (!body.name || !body.unit || !(body.defaultCost >= 0)) return toast('请完整填写名称、单位与有效成本', 'error');
      try {
        if (m.id) await api.put('/api/materials/' + m.id, body); else await api.post('/api/materials', body);
        toast('耗材档案已保存'); closeModal(); Views.hq.materials(el);
      } catch (e) { toast(e.message, 'error'); }
    };
  }
  $('#add-mat', el).onclick = () => editMat({});
  render();
},

/* ============ 项目耗材配方（标准耗用） ============ */
async 'recipes'(el) {
  const { recipes } = await api.get('/api/recipes');
  const cats = [...new Set(recipes.map(r => r.category))];
  el.innerHTML = `
    <div class="card mb-16" style="background:linear-gradient(120deg,#f3f9f7,#fbf7ec);border-color:#e0ece6">
      <div class="card-b" style="font-size:13px;color:#46605b">
        💡 配方定义每个服务项目的<b>标准耗材耗用</b>。门店开单结账时系统把当时的配方（耗材、用量、成本）固化为快照并自动扣减库存；<b>事后修改配方不会影响历史账单与已生成的毛利数据</b>。
      </div>
    </div>
    <div class="card">
      <div class="card-h"><h3>🧪 服务项目标准耗用配方</h3>
        <div class="seg" id="cat-seg"><button class="active" data-c="">全部</button>${cats.map(c => `<button data-c="${esc(c)}">${esc(c)}</button>`).join('')}</div>
      </div>
      <div id="rcp-list" class="card-b" style="display:flex;flex-direction:column;gap:12px"></div>
    </div>`;
  const render = (cat) => {
    const rows = cat ? recipes.filter(r => r.category === cat) : recipes;
    $('#rcp-list', el).innerHTML = rows.map(r => `
      <div class="recipe-box ${r.lines.length ? '' : 'empty-recipe'}">
        <div class="recipe-head">
          <div><b style="font-size:14.5px">${esc(r.serviceName)}</b> <span class="tag tag-blue">${esc(r.category)}</span>
          ${r.active ? '' : '<span class="tag tag-gray">已下架</span>'}
          ${r.lines.length ? '' : '<span class="tag tag-red">未配置配方</span>'}</div>
          <div class="toolbar"><span class="muted" style="font-size:12.5px">单耗成本 <b class="money">${fmtMoney(r.costPerOrder)}</b>${r.updatedAt ? ` ｜ 更新于 ${r.updatedAt.slice(0, 10)}` : ''}</span>
          <button class="btn btn-sm btn-gold" data-edit="${r.serviceId}">维护配方</button></div>
        </div>
        <div class="recipe-lines">${r.lines.length ? r.lines.map(l => `<span class="mat-chip">${esc(l.materialName)} <b>×${l.qty}${esc(l.unit)}</b><span class="muted">（${fmtMoney(l.unitCost)}/${esc(l.unit)}）</span></span>`).join('') : '<span class="muted" style="font-size:12.5px">该项目暂无耗材配方，开单不会扣减库存</span>'}</div>
      </div>`).join('');
    el.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => recipeDialog(b.dataset.edit, el));
  };
  $('#cat-seg', el).querySelectorAll('button').forEach(b => b.onclick = () => {
    $('#cat-seg', el).querySelectorAll('button').forEach(x => x.classList.toggle('active', x === b));
    render(b.dataset.c);
  });
  render('');
},

/* ============ 总部：耗材成本 / 账实差异 / 损耗率 / 项目毛利 ============ */
async 'inventory-analysis'(el) {
  const today = new Date().toISOString().slice(0, 10);
  const fromDef = new Date(Date.now() - 29 * 864e5).toISOString().slice(0, 10);
  el.dataset.from = el.dataset.from || fromDef;
  el.dataset.to = el.dataset.to || today;
  await renderAnalysis(el);
},
};

/* ============ 共享：技师档案列表（总部/门店复用） ============ */
async function techList(el, scope) {
  const isHq = scope === 'hq';
  const stores = App.ctx.stores;
  el.innerHTML = `
    <div class="card">
      <div class="card-h"><h3>🧑‍🔧 技师档案</h3>
        <div class="toolbar">
          ${isHq ? `<select class="inp" id="f-store">${storeOptions(stores, '', '全部门店')}</select>` : ''}
          <select class="inp" id="f-status"><option value="">全部状态</option><option value="active">在职</option><option value="leave">休假</option><option value="left">已离职</option></select>
          <input class="inp" id="f-q" placeholder="姓名 / 手机号 / 工号" style="width:180px">
          <button class="btn btn-gold" id="f-add">＋ 入职登记</button>
        </div>
      </div>
      <div id="t-box" class="tbl-wrap">${loading()}</div>
    </div>`;
  const load = async () => {
    const qs = new URLSearchParams();
    if (isHq && $('#f-store', el).value) qs.set('storeId', $('#f-store', el).value);
    if ($('#f-status', el).value) qs.set('status', $('#f-status', el).value);
    if ($('#f-q', el).value.trim()) qs.set('q', $('#f-q', el).value.trim());
    const list = await api.get('/api/technicians?' + qs);
    $('#t-box', el).innerHTML = `
      <table class="tbl"><thead><tr><th>工号</th><th>姓名</th><th>性别/年龄</th><th>等级</th>${isHq ? '<th>门店</th>' : ''}<th>擅长项目</th><th>电话</th><th>入职日期</th><th>状态</th><th></th></tr></thead>
      <tbody>${list.length ? list.map(t => `
        <tr><td class="muted">${t.id}</td><td><b>${esc(t.name)}</b></td><td>${t.gender} · ${t.age}</td>
        <td><span class="tag tag-gold">${esc(t.levelName)}</span></td>
        ${isHq ? `<td>${esc(t.storeName)}</td>` : ''}
        <td style="max-width:260px">${t.specialties.length ? t.specialties.slice(0, 3).map(s => `<span class="tag tag-blue" style="margin:1px">${esc(s.name)}</span>`).join('') + (t.specialties.length > 3 ? ` <span class="muted">+${t.specialties.length - 3}</span>` : '') : '<span class="muted">未设置</span>'}</td>
        <td class="nowrap muted">${esc(t.phone)}</td><td class="nowrap">${t.hireDate}</td><td>${statusTag(t.status)}</td>
        <td class="nowrap"><button class="btn btn-sm" data-view="${t.id}">档案</button></td></tr>`).join('')
        : `<tr><td colspan="${isHq ? 10 : 9}">${emptyBox('没有符合条件的技师')}</td></tr>`}</tbody></table>`;
    el.querySelectorAll('[data-view]').forEach(b => b.onclick = () => techProfile(b.dataset.view, el, scope));
  };
  $('#f-add', el).onclick = () => techHireDialog(el, scope);
  $('#f-store', el)?.addEventListener('change', load);
  $('#f-status', el).onchange = load;
  $('#f-q', el).oninput = debounce(load, 300);
  load();
}

/* 入职登记 */
function techHireDialog(el, scope) {
  const isHq = scope === 'hq';
  const storeId = App.session.storeId;
  const services = App.ctx.services;
  const levels = App.ctx.techLevels;
  const m = openModal({ title: '技师入职登记', size: 'lg',
    body: `
    <div class="form-row">
      <div class="form-item"><label><span class="req">*</span>姓名</label><input id="f-name" placeholder="技师姓名"></div>
      <div class="form-item"><label><span class="req">*</span>技师等级</label><select id="f-level">${levels.map(l => `<option value="${l.id}">${esc(l.name)}（提成 ${(l.commissionRate * 100).toFixed(0)}%）</option>`).join('')}</select></div>
    </div>
    <div class="form-row">
      <div class="form-item"><label>性别</label><select id="f-gender"><option>女</option><option>男</option></select></div>
      <div class="form-item"><label>年龄</label><input type="number" min="18" max="65" id="f-age" value="28"></div>
    </div>
    <div class="form-row">
      <div class="form-item"><label>手机号</label><input id="f-phone" placeholder="11 位手机号"></div>
      <div class="form-item"><label>入职日期</label><input type="date" id="f-hire" value="${new Date().toISOString().slice(0, 10)}"></div>
    </div>
    ${isHq ? `<div class="form-row one"><div class="form-item"><label><span class="req">*</span>分配门店</label><select id="f-store">${storeOptions(App.ctx.stores, '')}</select></div></div>` : ''}
    <div class="form-row one"><div class="form-item"><label>擅长项目（可多选）</label>
      <div class="check-pills">${services.map(s => `<label><input type="checkbox" name="sp" value="${s.id}">${esc(s.name)}</label>`).join('')}</div></div></div>
    <div class="form-row">
      <div class="form-item"><label>培训/考核主题</label><input id="f-train" placeholder="如：岗前培训"></div>
      <div class="form-item"><label>考核分数（0-100，≥60 合格）</label><input type="number" min="0" max="100" id="f-score" value="85"></div>
    </div>
    <div class="form-row one"><div class="form-item"><label>取得证书（选填）</label><input id="f-cert" placeholder="如：保健按摩师（高级）"></div></div>
    <div class="form-row one"><div class="form-item"><label>备注</label><textarea id="f-remark" placeholder="从业经历、特殊说明等"></textarea></div></div>`,
    footer: `<button class="btn" data-close>取消</button><button class="btn btn-primary" id="ok">完成入职登记</button>` });
  $('#ok', m.el).onclick = async () => {
    const specialties = [...m.el.querySelectorAll('input[name=sp]:checked')].map(x => x.value);
    const trainTopic = $('#f-train', m.el).value.trim();
    const body = {
      name: $('#f-name', m.el).value.trim(), levelId: $('#f-level', m.el).value,
      gender: $('#f-gender', m.el).value, age: Number($('#f-age', m.el).value),
      phone: $('#f-phone', m.el).value.trim(), hireDate: $('#f-hire', m.el).value,
      remark: $('#f-remark', m.el).value.trim(), specialties,
      trainings: trainTopic ? [{ topic: trainTopic, trainDate: $('#f-hire', m.el).value, score: Number($('#f-score', m.el).value), cert: $('#f-cert', m.el).value.trim() || null }] : [],
    };
    if (isHq) body.storeId = $('#f-store', m.el).value;
    if (!body.name || !body.levelId || (isHq && !body.storeId)) return toast('请填写必填项', 'error');
    try {
      await api.post('/api/technicians', body); toast('入职登记成功'); closeModal();
      (isHq ? Views.hq.technicians : Views.store.technicians)(el);
    } catch (e) { toast(e.message, 'error'); }
  };
}

/* 技师档案详情 */
async function techProfile(id, el, scope) {
  const isHq = scope === 'hq';
  const t = await api.get('/api/technicians/' + id);
  const services = App.ctx.services;
  const stores = App.ctx.stores;
  const m = openModal({ title: `技师档案 · ${t.name}（${t.id}）`, size: 'xl',
    body: `
    <div class="grid g-3 mb-16">
      <div class="pay-box"><div class="p-l">等级 / 默认提成</div><div style="font-weight:700;margin-top:4px">${esc(t.levelName)} · ${(t.commissionRate * 100).toFixed(0)}%</div></div>
      <div class="pay-box"><div class="p-l">所属门店</div><div style="font-weight:700;margin-top:4px">${esc(t.storeName)}</div></div>
      <div class="pay-box"><div class="p-l">状态</div><div style="margin-top:4px">${statusTag(t.status)}</div></div>
    </div>
    <div class="form-row"><div class="form-item"><label>姓名 / 性别 / 年龄</label><div>${esc(t.name)} · ${t.gender} · ${t.age} 岁</div></div>
      <div class="form-item"><label>手机 / 入职</label><div>${esc(t.phone)} ｜ ${t.hireDate}${t.leaveDate ? ' ｜ 离开 ' + t.leaveDate : ''}</div></div></div>
    <div class="form-row one mb-16"><div class="form-item"><label>擅长项目</label>
      <div class="check-pills" id="sp-box">${services.map(s => `<label><input type="checkbox" value="${s.id}" ${t.specialties.some(x => x.id === s.id) ? 'checked' : ''}>${esc(s.name)}</label>`).join('')}</div></div></div>
    ${t.remark ? `<p class="muted mb-16" style="font-size:13px">备注：${esc(t.remark)}</p>` : ''}
    <h4 style="font-size:14px;margin:6px 0 8px">📜 培训与考核记录 ${t.status === 'active' ? '<button class="btn btn-sm" id="add-train" style="float:right">＋ 添加考核</button>' : ''}</h4>
    <table class="tbl mb-16"><thead><tr><th>日期</th><th>培训/考核主题</th><th class="num">分数</th><th>结果</th><th>证书</th></tr></thead>
      <tbody id="tr-body">${t.trainings.length ? t.trainings.map(x => `
        <tr><td class="nowrap">${x.trainDate}</td><td>${esc(x.topic)}</td><td class="num"><b>${x.score}</b></td>
        <td>${x.result === 'pass' ? '<span class="tag tag-green">合格</span>' : '<span class="tag tag-red">不合格</span>'}</td>
        <td>${x.cert ? esc(x.cert) : '<span class="muted">—</span>'}</td></tr>`).join('')
        : `<tr><td colspan="5">${emptyBox('暂无培训考核记录')}</td></tr>`}</tbody></table>
    <h4 style="font-size:14px;margin:6px 0 8px">🔁 调动记录</h4>
    <table class="tbl"><thead><tr><th>日期</th><th>原门店</th><th></th><th>调入门店</th><th>原因</th></tr></thead>
      <tbody>${t.transfers.length ? t.transfers.map(x => `
        <tr><td class="nowrap">${x.transferDate}</td><td>${esc(stores.find(s => s.id === x.fromStoreId)?.name)}</td><td>→</td>
        <td>${esc(stores.find(s => s.id === x.toStoreId)?.name)}</td><td class="muted">${esc(x.reason)}</td></tr>`).join('')
        : `<tr><td colspan="5">${emptyBox('无调动记录')}</td></tr>`}</tbody></table>`,
    footer: `
      ${t.status === 'active' ? `<button class="btn" id="btn-sp" style="margin-right:auto">保存擅长项目</button>
        <button class="btn" id="btn-transfer">🔁 调动门店</button>
        <button class="btn btn-danger" id="btn-leave">办理离职</button>` : '<span class="muted" style="margin-right:auto;align-self:center">该员工已离职/休假</span>'}
      <button class="btn" data-close>关闭</button>` });

  $('#btn-sp', m.el)?.addEventListener('click', async () => {
    const ids = [...m.el.querySelectorAll('#sp-box input:checked')].map(x => x.value);
    await api.post(`/api/technicians/${t.id}/specialties`, { serviceIds: ids });
    toast('擅长项目已更新');
  });
  $('#add-train', m.el)?.addEventListener('click', () => {
    const tm = openModal({ title: '添加培训考核记录',
      body: `<div class="form-row"><div class="form-item"><label><span class="req">*</span>主题</label><input id="x-topic"></div>
        <div class="form-item"><label>日期</label><input type="date" id="x-date" value="${new Date().toISOString().slice(0, 10)}"></div></div>
        <div class="form-row"><div class="form-item"><label>分数（≥60 合格）</label><input type="number" min="0" max="100" id="x-score" value="85"></div>
        <div class="form-item"><label>证书（选填）</label><input id="x-cert"></div></div>`,
      footer: `<button class="btn" data-close>取消</button><button class="btn btn-primary" id="x-ok">保存</button>` });
    $('#x-ok', tm.el).onclick = async () => {
      try {
        await api.post(`/api/technicians/${t.id}/trainings`, { topic: $('#x-topic', tm.el).value.trim(), trainDate: $('#x-date', tm.el).value, score: Number($('#x-score', tm.el).value), cert: $('#x-cert', tm.el).value.trim() || null });
        toast('考核记录已保存'); closeModal(); techProfile(id, el, scope);
      } catch (e) { toast(e.message, 'error'); }
    };
  });
  $('#btn-transfer', m.el)?.addEventListener('click', async () => {
    closeModal();
    await transferDialog(el, scope, id);
  });
  $('#btn-leave', m.el)?.addEventListener('click', async () => {
    closeModal();
    const lm = openModal({ title: '办理离职',
      body: `<div class="form-row"><div class="form-item"><label>离职日期</label><input type="date" id="lv-date" value="${new Date().toISOString().slice(0, 10)}"></div></div>
        <div class="form-row one"><div class="form-item"><label>离职原因</label><textarea id="lv-reason" placeholder="如：个人发展、合同到期"></textarea></div></div>`,
      footer: `<button class="btn" data-close>取消</button><button class="btn btn-danger" id="lv-ok">确认离职</button>` });
    $('#lv-ok', lm.el).onclick = async () => {
      try {
        await api.post(`/api/technicians/${t.id}/leave`, { leaveDate: $('#lv-date', lm.el).value, reason: $('#lv-reason', lm.el).value.trim() });
        toast('离职办理完成'); closeModal(); (isHq ? Views.hq.technicians : Views.store.technicians)(el);
      } catch (e) { toast(e.message, 'error'); }
    };
  });
}

/* 调动弹窗（总部可从调动记录发起，也可从档案发起） */
async function transferDialog(el, scope, preTechId) {
  const isHq = scope === 'hq';
  let techs = await api.get('/api/technicians?status=active');
  if (!isHq) techs = techs.filter(t => t.storeId === App.session.storeId);
  const stores = App.ctx.stores;
  const curStore = () => techs.find(t => t.id === $('#tr-tech').value)?.storeId;
  const m = openModal({ title: '技师跨店调动',
    body: `<div class="form-row"><div class="form-item"><label><span class="req">*</span>选择技师</label>
        <select id="tr-tech" style="width:100%">${techs.map(t => `<option value="${t.id}" ${t.id === preTechId ? 'selected' : ''}>${t.id} · ${esc(t.name)}（${esc(t.storeName)} · ${esc(t.levelName)}）</option>`).join('')}</select></div>
      <div class="form-item"><label>调动日期</label><input type="date" id="tr-date" value="${new Date().toISOString().slice(0, 10)}"></div></div>
      <div class="form-row one"><div class="form-item"><label><span class="req">*</span>调入门店</label><select id="tr-to" class="inp" style="width:100%"></select></div></div>
      <div class="form-row one"><div class="form-item"><label>调动原因</label><textarea id="tr-reason" placeholder="如：旺季人力支援、员工居住地变更"></textarea></div></div>`,
    footer: `<button class="btn" data-close>取消</button><button class="btn btn-primary" id="tr-ok">确认调动</button>` });
  const fillStores = () => {
    const from = curStore();
    $('#tr-to', m.el).innerHTML = stores.filter(s => s.id !== from).map(s => `<option value="${s.id}">${esc(s.name)}（${esc(s.city)}）</option>`).join('');
  };
  fillStores();
  $('#tr-tech', m.el).onchange = fillStores;
  $('#tr-ok', m.el).onclick = async () => {
    const techId = $('#tr-tech', m.el).value;
    try {
      await api.post(`/api/technicians/${techId}/transfer`, { toStoreId: $('#tr-to', m.el).value, transferDate: $('#tr-date', m.el).value, reason: $('#tr-reason', m.el).value.trim() });
      toast('调动完成，档案已转入目标门店'); closeModal();
      if (location.hash.includes('technicians')) (isHq ? Views.hq.technicians : Views.store.technicians)(el);
      if (location.hash.includes('transfers')) Views.hq.transfers(el);
    } catch (e) { toast(e.message, 'error'); }
  };
}

/* 交班明细 + 签字查看（总部/门店共用） */
async function handoverDetail(id, opts = {}) {
  const x = await api.get('/api/handovers/' + id);
  const isImg = (s) => typeof s === 'string' && s.startsWith('data:image');
  const sign = (s, name, role) => isImg(s)
    ? `<div style="text-align:center"><img src="${s}" style="height:78px;border:1px solid var(--line);border-radius:8px;background:#fff;padding:4px"><div class="muted" style="font-size:12px;margin-top:4px">${role}：${esc(name)}</div></div>`
    : `<div style="text-align:center;color:var(--text-3);font-size:12px;border:1px dashed var(--line);border-radius:8px;padding:22px 8px">历史数据签名<br>（${esc(name)}）</div>`;
  openModal({ title: `交班报表 · ${x.businessDate} ${x.shiftName} · ${x.storeName}`, size: 'xl',
    body: `
    <div class="pay-grid mb-16">
      <div class="pay-box"><div class="p-l">接待人数</div><div class="p-v" style="color:#123a3f">${x.serveCount} 人</div></div>
      <div class="pay-box cash"><div class="p-l">现金</div><div class="p-v">${fmtMoney(x.cash)}</div></div>
      <div class="pay-box card"><div class="p-l">刷卡</div><div class="p-v">${fmtMoney(x.card)}</div></div>
      <div class="pay-box member"><div class="p-l">会员卡</div><div class="p-v">${fmtMoney(x.member)}</div></div>
    </div>
    <div class="pay-grid mb-16">
      <div class="pay-box mp"><div class="p-l">移动支付</div><div class="p-v">${fmtMoney(x.mp)}</div></div>
      <div class="pay-box"><div class="p-l">营收合计</div><div class="p-v money">${fmtMoney(x.revenue)}</div></div>
      <div class="pay-box"><div class="p-l">技师提成合计</div><div class="p-v" style="color:var(--red)">${fmtMoney(x.commission)}</div></div>
      <div class="pay-box"><div class="p-l">确认时间</div><div class="p-v" style="font-size:15px">${x.confirmedAt.slice(5, 16)}</div></div>
    </div>
    <h4 style="font-size:14px;margin:4px 0 8px">🧾 本班技师上钟明细</h4>
    <div class="detail-list mb-16">
      <div class="dl-head"><span>时间</span><span>项目</span><span>技师</span><span>时长</span><span>支付</span><span class="right">实付/提成</span></div>
      ${x.orders.length ? x.orders.map(o => `
        <div class="dl-row"><span class="muted nowrap">${o.createdAt.slice(5, 16)}</span>
        <span><b>${esc(o.serviceName)}</b>${o.memberName ? ' <span class="tag tag-gold">会员·' + esc(o.memberName) + '</span>' : ''}</span>
        <span>${esc(o.techName)}</span><span>${o.duration}′</span><span>${payTag(o.payMethod)}</span>
        <span class="right"><b class="money">${fmtMoney(o.amount)}</b><br><span class="muted" style="font-size:12px">提成 ${fmtMoney(o.techCommission)}</span></span></div>`).join('')
        : `<div class="empty">本班无账单</div>`}
    </div>
    <h4 style="font-size:14px;margin:4px 0 8px">✍️ 交接班签字确认</h4>
    <div class="grid g-2">${sign(x.openerSign, x.opener, '交班人')}${sign(x.closerSign, x.closer, '接班人')}</div>
    ${x.remark ? `<p class="muted" style="font-size:13px;margin-top:12px">备注：${esc(x.remark)}</p>` : ''}`,
    footer: `<button class="btn btn-primary" data-close>关 闭</button>`,
    onClose: opts.onClose,
  });
}

/* ============ 配方编辑弹窗（总部） ============ */
async function recipeDialog(serviceId, el) {
  const { recipes, materials } = await api.get('/api/recipes');
  const r = recipes.find(x => x.serviceId === serviceId);
  const mats = materials.filter(m => m.active);
  let lines = r.lines.map(l => ({ materialId: l.materialId, qty: l.qty }));
  const body = () => `
    <p class="muted mb-16" style="font-size:12.5px">维护「${esc(r.serviceName)}」的标准耗用清单。保存后<b>仅对新开账单生效</b>，历史账单保留快照不追溯。</p>
    <div id="rl-list" style="display:flex;flex-direction:column;gap:8px;margin-bottom:10px"></div>
    <button class="btn btn-sm" id="rl-add" type="button">＋ 添加耗用品项</button>
    <div class="recipe-sum" id="rl-sum"></div>`;
  const m = openModal({ title: `维护配方 · ${r.serviceName}`, size: 'lg', body: body(),
    footer: `<button class="btn" data-close>取消</button><button class="btn btn-primary" id="rl-ok">保存配方</button>` });
  const draw = () => {
    $('#rl-list', m.el).innerHTML = lines.map((l, i) => {
      const mat = mats.find(x => x.id === l.materialId);
      return `<div class="rl-row">
        <select class="inp" data-k="materialId" data-i="${i}" style="flex:1">${mats.map(x => `<option value="${x.id}" ${x.id === l.materialId ? 'selected' : ''}>${esc(x.name)}（${esc(x.spec)} · ${esc(x.unit)} · ${fmtMoney(x.defaultCost)})</option>`).join('')}</select>
        <input class="inp" type="number" min="0.01" step="0.01" data-k="qty" data-i="${i}" value="${l.qty}" style="width:120px">
        <span class="muted" style="width:34px">${esc(mat?.unit || '')}</span>
        <button class="btn btn-sm btn-danger" data-del="${i}" type="button">删除</button>
      </div>`;
    }).join('') || '<div class="muted" style="font-size:12.5px">尚未添加品项，点击下方按钮添加（可全部删除保存为空配方）</div>';
    const cost = lines.reduce((a, l) => a + l.qty * (mats.find(x => x.id === l.materialId)?.defaultCost || 0), 0);
    $('#rl-sum', m.el).innerHTML = lines.length ? `当前单份标准耗用成本合计：<b class="money">${fmtMoney(Math.round(cost * 100) / 100)}</b>` : '';
    m.el.querySelectorAll('[data-k]').forEach(inp => inp.onchange = () => {
      const i = Number(inp.dataset.i);
      lines[i][inp.dataset.k] = inp.dataset.k === 'qty' ? Number(inp.value) : inp.value;
      draw();
    });
    m.el.querySelectorAll('[data-del]').forEach(b => b.onclick = () => { lines.splice(Number(b.dataset.del), 1); draw(); });
  };
  $('#rl-add', m.el).onclick = () => { lines.push({ materialId: mats[0].id, qty: 1 }); draw(); };
  draw();
  $('#rl-ok', m.el).onclick = async () => {
    try {
      await api.put('/api/recipes/' + serviceId, { lines });
      toast('配方已保存，后续开单按新配方快照扣库'); closeModal(); Views.hq.recipes(el);
    } catch (e) { toast(e.message, 'error'); }
  };
}

/* ============ 总部库存分析页 ============ */
async function renderAnalysis(el) {
  el.innerHTML = `
    <div class="toolbar mb-16" style="justify-content:space-between">
      <div class="toolbar">
        <input type="date" class="inp" id="a-from" value="${el.dataset.from}">
        <span class="muted">至</span>
        <input type="date" class="inp" id="a-to" value="${el.dataset.to}">
        <button class="btn btn-primary btn-sm" id="a-go">统计</button>
      </div>
      <span class="muted" style="font-size:12.5px">耗材成本取自每张账单的配方快照；损耗 = 报损 + 盘点盘亏</span>
    </div>
    <div id="a-body">${loading()}</div>`;
  const load = async () => {
    const d = await api.get(`/api/hq/inventory-analysis?from=${$('#a-from', el).value}&to=${$('#a-to', el).value}`);
    el.dataset.from = d.range.from; el.dataset.to = d.range.to;
    const pct = (x, base) => base > 0 ? (x / base * 100).toFixed(1) + '%' : '—';
    const maxLoss = Math.max(0.0001, ...d.stores.map(s => s.lossRate || 0));
    $('#a-body', el).innerHTML = `
      ${d.alerts.length ? `<div class="alert-bar">⚠️ 当前有 <b>${d.alerts.length}</b> 条未处理库存预警（负库存开单），请尽快采购或调拨补货。</div>` : ''}
      <div class="grid g-4 mb-16">
        <div class="card kpi k-gold"><div class="k-ico">🛒</div><div class="k-label">区间采购入库金额</div><div class="k-val">${fmtMoney(d.summary.purchaseAmount)}</div><div class="k-foot">${d.range.from} ~ ${d.range.to}</div></div>
        <div class="card kpi k-jade"><div class="k-ico">🧪</div><div class="k-label">项目耗材理论耗用</div><div class="k-val">${fmtMoney(d.summary.consumeAmount)}</div><div class="k-foot">按账单配方快照汇总</div></div>
        <div class="card kpi k-red"><div class="k-ico">📉</div><div class="k-label">报损+盘亏金额</div><div class="k-val">${fmtMoney(d.summary.lossAmount)}</div><div class="k-foot">占耗用 ${pct(d.summary.lossAmount, d.summary.consumeAmount)}</div></div>
        <div class="card kpi k-blue"><div class="k-ico">🏷️</div><div class="k-label">项目毛利（收入-耗材-提成）</div><div class="k-val">${fmtMoney(d.summary.grossProfit)}</div><div class="k-foot">毛利率 ${pct(d.summary.grossProfit, d.summary.revenue)}</div></div>
      </div>

      <div class="card mb-16">
        <div class="card-h"><h3>🏬 门店损耗率排行</h3><span class="sub">损耗率 =（报损+盘亏）/ 理论耗材耗用</span></div>
        <div class="tbl-wrap">
          <table class="tbl"><thead><tr><th>门店</th><th style="width:220px">损耗率</th><th class="num">采购/调入额</th><th class="num">理论耗用</th><th class="num">损耗金额</th><th class="num">期末库存额</th><th class="num">未处理预警</th></tr></thead>
          <tbody>${d.stores.map(s => `
            <tr><td><b>${esc(s.name)}</b><br><span class="muted" style="font-size:12px">${esc(s.city)}</span></td>
            <td><div class="loss-bar"><i style="width:${Math.round((s.lossRate || 0) / maxLoss * 100)}%"></i><span>${s.lossRate === null ? '无耗用' : (s.lossRate * 100).toFixed(2) + '%'}</span></div></td>
            <td class="num">${fmtMoney(s.purchaseAmount)}</td><td class="num">${fmtMoney(s.consumeAmount)}</td>
            <td class="num ${s.lossAmount > 0 ? 'money red' : ''}">${fmtMoney(s.lossAmount)}</td>
            <td class="num">${fmtMoney(s.endAmount)}</td>
            <td class="num">${s.openAlertCount ? `<span class="tag tag-red">${s.openAlertCount}</span>` : '0'}</td></tr>`).join('')}
          </tbody></table>
        </div>
      </div>

      <div class="grid g-2 mb-16">
        <div class="card">
          <div class="card-h"><h3>📦 耗材采购与耗用成本</h3><span class="sub">按品项汇总</span></div>
          <div class="tbl-wrap">
            <table class="tbl"><thead><tr><th>耗材</th><th class="num">采购量</th><th class="num">采购额</th><th class="num">耗用量</th><th class="num">耗用成本</th><th class="num">报损额</th><th class="num">期末结存</th></tr></thead>
            <tbody>${d.materials.filter(x => x.purchaseQty > 0 || x.consumeQty > 0 || x.lossAmount > 0).map(x => `
              <tr><td><b>${esc(x.name)}</b><br><span class="muted" style="font-size:12px">${esc(x.spec)} · ${esc(x.unit)}</span></td>
              <td class="num">${fmtNum(x.purchaseQty)}</td><td class="num">${fmtMoney(x.purchaseAmount)}</td>
              <td class="num">${fmtNum(x.consumeQty)}</td><td class="num money">${fmtMoney(x.consumeAmount)}</td>
              <td class="num ${x.lossAmount > 0 ? 'red' : ''}">${fmtMoney(x.lossAmount)}</td>
              <td class="num ${x.endQty <= 0 ? 'qty-neg' : ''}">${fmtNum(x.endQty)} ${esc(x.unit)}<br><span class="muted" style="font-size:12px">${fmtMoney(x.endAmount)}</span></td></tr>`).join('')}
            </tbody></table>
          </div>
        </div>
        <div class="card">
          <div class="card-h"><h3>🧾 理论库存与实际库存差异</h3><span class="sub">取各店最近一次盘点</span></div>
          <div class="tbl-wrap">
            <table class="tbl"><thead><tr><th>门店</th><th>耗材</th><th class="num">账面</th><th class="num">实盘</th><th class="num">差异</th><th class="num">差异金额</th><th>盘点日期</th></tr></thead>
            <tbody>${d.variance.length ? d.variance.map(v => `
              <tr><td style="font-size:12.5px">${esc(v.storeName)}</td><td>${esc(v.materialName)}</td>
              <td class="num">${fmtNum(v.systemQty)}</td><td class="num">${fmtNum(v.actualQty)}</td>
              <td class="num ${v.diff < 0 ? 'qty-neg' : 'qty-pos'}">${v.diff > 0 ? '+' : ''}${fmtNum(v.diff)} ${esc(v.unit)}</td>
              <td class="num ${v.diff < 0 ? 'red' : ''}">${v.diff > 0 ? '+' : ''}${fmtMoney(v.diffAmount)}</td>
              <td class="nowrap muted">${v.checkedAt.slice(0, 10)}</td></tr>`).join('')
              : `<tr><td colspan="7">${emptyBox('区间内暂无盘点差异记录')}</td></tr>`}</tbody></table>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-h"><h3>💆 项目毛利分析</h3><span class="sub">毛利 = 服务收入 − 耗材成本快照 − 技师提成</span></div>
        <div class="tbl-wrap">
          <table class="tbl"><thead><tr><th>项目</th><th>品类</th><th class="num">单数</th><th class="num">服务收入</th><th class="num">耗材成本</th><th class="num">技师提成</th><th class="num">项目毛利</th><th class="num">毛利率</th><th class="num">单均耗材</th></tr></thead>
          <tbody>${d.services.map(x => `
            <tr><td><b>${esc(x.name)}</b></td><td><span class="tag tag-blue">${esc(x.category)}</span></td>
            <td class="num">${x.orders}</td><td class="num money">${fmtMoney(x.revenue)}</td>
            <td class="num">${fmtMoney(x.materialCost)}</td><td class="num red">${fmtMoney(x.commission)}</td>
            <td class="num money">${fmtMoney(x.grossProfit)}</td>
            <td class="num"><b style="color:${x.margin >= 0.6 ? 'var(--jade)' : x.margin >= 0.4 ? 'var(--gold)' : 'var(--red)'}">${x.margin === null ? '—' : (x.margin * 100).toFixed(1) + '%'}</b></td>
            <td class="num muted">${fmtMoney(x.avgCostPerOrder)}</td></tr>`).join('')}
          </tbody></table>
        </div>
      </div>`;
  };
  $('#a-go', el).onclick = () => load().catch(e => toast(e.message, 'error'));
  load();
}
