/* 耗材库存模块：共享工具 + 总部端视图 */
window.Views = window.Views || {};
Views.hq = Views.hq || {};

/* ---------- 共享工具 ---------- */
const Inv = {
  matName(id) { return App.ctx.materials.find(m => m.id === id)?.name || id; },
  matUnit(id) { return App.ctx.materials.find(m => m.id === id)?.unit || ''; },
  policyName(p) { return p === 'negative' ? '允许负库存+预警' : '库存不足禁止开单'; },
  stockTag(row) {
    if (row.qty < 0) return '<span class="tag tag-red">负库存</span>';
    if (row.qty < (row.safetyStock ?? 0)) return '<span class="tag tag-gold">低库存</span>';
    return '<span class="tag tag-green">正常</span>';
  },
  transferStatusTag(s) {
    return {
      in_transit: '<span class="tag tag-blue">在途待确认</span>',
      done: '<span class="tag tag-green">已完成</span>',
      cancelled: '<span class="tag tag-gray">已取消</span>',
    }[s] || s;
  },
  /* 配方编辑器：选中服务项目后展示耗材明细，支持增删行 */
  recipeEditorModal(service, onSaved) {
    const materials = App.ctx.materials.filter(m => m.active);
    const cur = App.ctx.recipes.find(r => r.serviceId === service.id);
    let rows = (cur?.items || []).map(it => ({ materialId: it.materialId, qty: it.qty }));
    const costOf = () => rows.reduce((a, r) => {
      const m = materials.find(x => x.id === r.materialId);
      return a + (Number(r.qty) || 0) * (m?.standardCost || 0);
    }, 0);
    const bodyHtml = () => `
      <p class="muted" style="font-size:12.5px;margin-bottom:10px">📌 配方按<b>开单当时的版本快照</b>扣减库存；保存后新版本只影响之后的账单，历史账单不受影响。单价取耗材档案当前采购成本。</p>
      <div id="rp-rows"></div>
      <button class="btn btn-sm" id="rp-add" style="margin-top:8px">＋ 添加耗材</button>
      <div class="pay-box" style="margin-top:12px;text-align:left;background:#f6faf9">
        <div class="p-l">当前配方单次耗材成本</div>
        <div class="p-v money" id="rp-cost">¥0.00</div>
        <div class="muted" style="font-size:12px">项目挂牌价 ¥${service.price} ｜ 当前版本 v${cur?.version || 0}，保存后升为 v${(cur?.version || 0) + 1}</div>
      </div>`;
    const m = openModal({ title: `标准耗用配方 · ${service.name}`, size: 'lg', body: bodyHtml(),
      footer: `<button class="btn" data-close>取消</button><button class="btn btn-primary" id="rp-ok">保存配方（升版本）</button>` });
    const renderRows = () => {
      $('#rp-rows', m.el).innerHTML = rows.length ? rows.map((r, i) => `
        <div class="rp-row" data-i="${i}" style="display:grid;grid-template-columns:1fr 130px 90px 34px;gap:8px;margin-bottom:8px;align-items:center">
          <select class="inp rp-m" style="width:100%">${materials.map(x => `<option value="${x.id}" ${x.id === r.materialId ? 'selected' : ''}>${esc(x.name)}（¥${x.standardCost}/${x.unit}）</option>`).join('')}</select>
          <input type="number" min="0" step="0.01" class="inp rp-q" value="${r.qty}" placeholder="用量">
          <div class="muted">${esc(materials.find(x => x.id === r.materialId)?.unit || '')}</div>
          <button class="btn btn-sm btn-danger rp-del">删</button>
        </div>`).join('') : '<p class="muted">暂无耗材明细（空配方＝开单不扣库存）</p>';
      m.el.querySelectorAll('.rp-row').forEach(row => {
        const i = Number(row.dataset.i);
        $('.rp-m', row).onchange = (e) => { rows[i].materialId = e.target.value; sync(); };
        $('.rp-q', row).oninput = (e) => { rows[i].qty = Number(e.target.value); $('#rp-cost', m.el).textContent = fmtMoney(costOf()); };
        $('.rp-del', row).onclick = () => { rows.splice(i, 1); sync(); };
      });
      $('#rp-cost', m.el).textContent = fmtMoney(costOf());
    };
    const sync = () => {
      m.el.querySelectorAll('.rp-row').forEach(row => {
        const i = Number(row.dataset.i);
        rows[i] = { materialId: $('.rp-m', row).value, qty: Number($('.rp-q', row).value) || 0 };
      });
      renderRows();
    };
    $('#rp-add', m.el).onclick = () => { sync(); rows.push({ materialId: materials[0].id, qty: 1 }); renderRows(); };
    $('#rp-ok', m.el).onclick = async () => {
      sync();
      try {
        await api.put('/api/recipes/' + service.id, { items: rows.filter(r => r.qty > 0) });
        toast('配方已保存并升版本（仅影响新开账单）'); closeModal(); onSaved?.();
      } catch (e) { toast(e.message, 'error'); }
    };
    renderRows();
  },
};

/* ============ 总部：耗材档案与配方 ============ */
Views.hq.materials = async function (el) {
  const [{ recipes }, config] = await Promise.all([api.get('/api/recipes'), api.get('/api/inventory-config')]);
  const services = App.ctx.services;
  el.innerHTML = `
    <div class="card mb-16" style="background:linear-gradient(120deg,#f3f9f7,#fbf7ec);border-color:#e0ece6">
      <div class="card-b" style="display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap">
        <div style="font-size:13px;color:#46605b">💡 总部统一维护耗材采购成本与每个服务项目的标准耗用配方。开单按<b>当时配方快照</b>扣库存，事后调整配方不影响历史账单与毛利。</div>
        <div class="toolbar">
          <span class="muted" style="font-size:12.5px">库存不足策略</span>
          <div class="seg" id="policy-seg">
            <button data-p="strict" class="${config.shortPolicy === 'strict' ? 'active' : ''}">禁止开单</button>
            <button data-p="negative" class="${config.shortPolicy === 'negative' ? 'active' : ''}">允许负库存+预警</button>
          </div>
        </div>
      </div>
    </div>
    <div class="grid" style="grid-template-columns:1.15fr .85fr;gap:16px;align-items:start">
      <div class="card">
        <div class="card-h"><h3>🧴 耗材档案</h3><button class="btn btn-gold" id="add-mat">＋ 新增耗材</button></div>
        <div class="tbl-wrap" id="mat-box">${loading()}</div>
      </div>
      <div class="card">
        <div class="card-h"><h3>🧪 项目标准配方</h3><span class="sub">共 ${recipes.length} 个项目已配置</span></div>
        <div class="tbl-wrap">
          <table class="tbl"><thead><tr><th>服务项目</th><th class="num">配方版本</th><th class="num">耗材种数</th><th class="num">单次成本</th><th></th></tr></thead>
            <tbody>${services.map(v => {
              const rp = recipes.find(r => r.serviceId === v.id);
              const cost = rp ? rp.items.reduce((a, it) => a + it.qty * it.unitCost, 0) : 0;
              return `<tr><td><b>${esc(v.name)}</b><div class="muted" style="font-size:12px">${esc(v.category)} · ¥${v.price}</div></td>
              <td class="num">${rp ? `<span class="tag tag-blue">v${rp.version}</span>` : '<span class="muted">未配置</span>'}</td>
              <td class="num">${rp ? rp.items.length : 0}</td>
              <td class="num money">${rp ? fmtMoney(cost) : '—'}</td>
              <td class="nowrap"><button class="btn btn-sm" data-rp="${v.id}">${rp ? '编辑配方' : '配置配方'}</button></td></tr>`;
            }).join('')}</tbody></table>
        </div>
      </div>
    </div>`;

  const loadMats = async () => {
    const mats = await api.get('/api/materials');
    $('#mat-box', el).innerHTML = `<table class="tbl"><thead><tr><th>编号</th><th>耗材</th><th>规格</th><th>分类</th><th class="num">单位</th><th class="num">采购成本</th><th class="num">安全库存</th><th class="num">用于项目</th><th>状态</th><th></th></tr></thead>
      <tbody>${mats.map(m => `<tr>
        <td class="muted">${m.id}</td>
        <td><b>${esc(m.name)}</b></td>
        <td class="muted" style="font-size:12.5px">${esc(m.spec)}</td>
        <td><span class="tag tag-blue">${esc(m.category)}</span></td>
        <td class="num">${esc(m.unit)}</td>
        <td class="num money">${fmtMoney(m.standardCost)}</td>
        <td class="num">${m.safetyStock}</td>
        <td class="num">${m.recipeCount}</td>
        <td>${m.active ? '<span class="tag tag-green">启用</span>' : '<span class="tag tag-gray">停用</span>'}</td>
        <td class="nowrap"><button class="btn btn-sm" data-edit='${esc(JSON.stringify(m))}'>编辑</button></td>
      </tr>`).join('')}</tbody></table>`;
    el.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => matDialog(JSON.parse(b.dataset.edit), loadMats));
  };
  el.querySelectorAll('[data-rp]').forEach(b => b.onclick = () => {
    const v = services.find(s => s.id === b.dataset.rp);
    Inv.recipeEditorModal(v, () => Views.hq.materials(el));
  });
  $('#add-mat', el).onclick = () => matDialog(null, loadMats);
  $('#policy-seg', el).querySelectorAll('button').forEach(b => b.onclick = async () => {
    try {
      await api.put('/api/inventory-config', { shortPolicy: b.dataset.p, storePolicies: config.storePolicies || {} });
      toast('库存不足策略已更新：' + Inv.policyName(b.dataset.p));
      $('#policy-seg', el).querySelectorAll('button').forEach(x => x.classList.toggle('active', x === b));
    } catch (e) { toast(e.message, 'error'); }
  });
  loadMats();
};

function matDialog(mat, onSaved) {
  const isEdit = !!mat;
  const m = openModal({ title: isEdit ? '编辑耗材' : '新增耗材',
    body: `
    <div class="form-row"><div class="form-item"><label><span class="req">*</span>耗材名称</label><input id="f-name" value="${esc(mat?.name || '')}"></div>
      <div class="form-item"><label>分类</label><input id="f-cat" value="${esc(mat?.category || '其他')}" list="mat-cats" placeholder="如：精油 / 一次性耗材">
        <datalist id="mat-cats"><option>精油</option><option>一次性耗材</option><option>泡脚药材</option><option>理疗用品</option><option>其他</option></datalist></div></div>
    <div class="form-row"><div class="form-item"><label>规格说明</label><input id="f-spec" value="${esc(mat?.spec || '')}" placeholder="如 500ml / 瓶"></div>
      <div class="form-item"><label><span class="req">*</span>计量单位</label><input id="f-unit" value="${esc(mat?.unit || '')}" placeholder="瓶 / 包 / 条"></div></div>
    <div class="form-row"><div class="form-item"><label><span class="req">*</span>标准采购成本（元）</label><input type="number" min="0" step="0.01" id="f-cost" value="${mat?.standardCost ?? ''}"></div>
      <div class="form-item"><label>安全库存（低于预警）</label><input type="number" min="0" id="f-safety" value="${mat?.safetyStock ?? 0}"></div></div>
    ${isEdit ? `<div class="form-row one"><div class="form-item"><label>状态</label><select id="f-active"><option value="1" ${mat.active !== 0 ? 'selected' : ''}>启用</option><option value="0" ${mat.active === 0 ? 'selected' : ''}>停用</option></select></div></div>` : ''}
    <p class="muted" style="font-size:12.5px">⚠️ 修改标准成本只影响新保存的配方版本，历史账单成本保持不变。</p>`,
    footer: `<button class="btn" data-close>取消</button><button class="btn btn-primary" id="f-ok">保存</button>` });
  $('#f-ok', m.el).onclick = async () => {
    const body = {
      name: $('#f-name', m.el).value.trim(), spec: $('#f-spec', m.el).value.trim(), unit: $('#f-unit', m.el).value.trim(),
      category: $('#f-cat', m.el).value.trim(), standardCost: Number($('#f-cost', m.el).value), safetyStock: Number($('#f-safety', m.el).value),
    };
    if (!body.name || !body.unit || !(body.standardCost >= 0)) return toast('请完整填写名称、单位与有效成本', 'error');
    if (isEdit) body.active = Number($('#f-active', m.el).value);
    try {
      if (isEdit) await api.put('/api/materials/' + mat.id, body); else await api.post('/api/materials', body);
      toast('耗材档案已保存'); closeModal(); App.ctx.materials = (await api.get('/api/materials')); onSaved?.();
    } catch (e) { toast(e.message, 'error'); }
  };
}

/* ============ 总部：门店库存总览（含预警、调拨/出入库单据查看） ============ */
Views.hq.inventory = async function (el) {
  const stores = App.ctx.stores;
  el.innerHTML = `
    <div class="card mb-16">
      <div class="card-h"><h3>📦 全品牌门店库存</h3>
        <div class="toolbar">
          <select class="inp" id="f-store">${storeOptions(stores, '', '全部门店')}</select>
          <select class="inp" id="f-status"><option value="">全部状态</option><option value="low">低库存</option><option value="negative">负库存</option><option value="ok">正常</option></select>
        </div>
      </div>
      <div id="inv-kpi" class="card-b" style="display:flex;gap:12px;flex-wrap:wrap"></div>
      <div class="tbl-wrap" id="inv-box">${loading()}</div>
    </div>
    <div class="grid g-2">
      <div class="card"><div class="card-h"><h3>🚚 跨店调拨单</h3>
          <select class="inp" id="f-tr"><option value="">全部状态</option><option value="in_transit">在途待确认</option><option value="done">已完成</option><option value="cancelled">已取消</option></select></div>
        <div class="tbl-wrap" id="tr-box">${loading()}</div></div>
      <div class="card"><div class="card-h"><h3>⚠️ 未处理库存预警</h3></div>
        <div class="tbl-wrap" id="al-box">${loading()}</div></div>
    </div>`;
  const load = async () => {
    const sid = $('#f-store', el).value, st = $('#f-status', el).value, trs = $('#f-tr', el).value;
    const qs = new URLSearchParams(); if (sid) qs.set('storeId', sid);
    const [rows, transfers, alerts] = await Promise.all([
      api.get('/api/stock?' + qs),
      api.get('/api/stock-transfers?' + qs + (trs ? (sid ? '&' : '') + 'status=' + trs : '')),
      api.get('/api/inventory-alerts?' + qs),
    ]);
    const list = st ? rows.filter(r => r.status === st) : rows;
    const lowCount = rows.filter(r => r.status === 'low').length, negCount = rows.filter(r => r.status === 'negative').length;
    const inTransit = transfers.filter(t => t.status === 'in_transit').length;
    $('#inv-kpi', el).innerHTML = `
      <div class="pay-box" style="min-width:150px"><div class="p-l">库存货值（移动平均成本）</div><div class="p-v money" style="font-size:19px">${fmtMoney(rows.reduce((a, r) => a + r.stockValue, 0))}</div></div>
      <div class="pay-box" style="min-width:130px"><div class="p-l">低库存耗材</div><div class="p-v" style="color:var(--gold);font-size:19px">${lowCount}</div></div>
      <div class="pay-box" style="min-width:130px"><div class="p-l">负库存耗材</div><div class="p-v" style="color:var(--red);font-size:19px">${negCount}</div></div>
      <div class="pay-box" style="min-width:150px"><div class="p-l">在途调拨</div><div class="p-v" style="color:var(--blue);font-size:19px">${inTransit} 单</div></div>`;
    $('#inv-box', el).innerHTML = list.length ? `<table class="tbl">
      <thead><tr><th>门店</th><th>耗材</th><th>分类</th><th class="num">现存量</th><th class="num">在途</th><th class="num">安全库存</th><th class="num">移动均价</th><th class="num">库存货值</th><th>状态</th></tr></thead>
      <tbody>${list.map(r => `<tr ${r.qty < 0 ? 'style="background:#fff7f6"' : ''}>
        <td style="font-size:12.5px">${esc(r.storeName)}</td>
        <td><b>${esc(r.materialName)}</b><div class="muted" style="font-size:12px">${esc(r.spec || '')}</div></td>
        <td><span class="tag tag-blue">${esc(r.category)}</span></td>
        <td class="num ${r.qty < 0 ? 'money red' : ''}">${r.qty} ${esc(r.unit)}</td>
        <td class="num muted">${r.inTransit}</td>
        <td class="num muted">${r.safetyStock}</td>
        <td class="num">${fmtMoney(r.avgCost)}</td>
        <td class="num money">${fmtMoney(r.stockValue)}</td>
        <td>${Inv.stockTag(r)}</td></tr>`).join('')}</tbody></table>`
      : emptyBox('暂无库存记录（门店尚未发生采购或耗用）');
    $('#tr-box', el).innerHTML = transfers.length ? `<table class="tbl">
      <thead><tr><th>单号</th><th>调出 → 调入</th><th>耗材</th><th class="num">数量</th><th class="num">金额</th><th>状态</th></tr></thead>
      <tbody>${transfers.slice(0, 50).map(t => `<tr>
        <td class="muted nowrap">${t.id}</td>
        <td style="font-size:12.5px">${esc(t.fromStoreName)} <span class="muted">→</span> ${esc(t.toStoreName)}</td>
        <td>${esc(t.materialName)}</td><td class="num">${t.qty} ${esc(t.unit)}</td>
        <td class="num money">${fmtMoney(t.amount)}</td><td>${Inv.transferStatusTag(t.status)}</td></tr>`).join('')}</tbody></table>`
      : emptyBox('暂无调拨单');
    $('#al-box', el).innerHTML = alerts.length ? `<table class="tbl">
      <thead><tr><th>门店</th><th>耗材</th><th>类型</th><th class="num">现存</th><th class="num">安全线</th><th>时间</th><th></th></tr></thead>
      <tbody>${alerts.map(a => `<tr>
        <td style="font-size:12.5px">${esc(a.storeName)}</td><td>${esc(a.materialName)}</td>
        <td>${a.type === 'negative' ? '<span class="tag tag-red">负库存</span>' : '<span class="tag tag-gold">低库存</span>'}</td>
        <td class="num ${a.qty < 0 ? 'money red' : ''}">${a.qty} ${esc(a.unit)}</td>
        <td class="num muted">${a.safetyStock ?? '—'}</td><td class="nowrap muted" style="font-size:12px">${a.createdAt.slice(5, 16)}</td>
        <td><button class="btn btn-sm" data-resolve="${a.id}">忽略</button></td></tr>`).join('')}</tbody></table>`
      : emptyBox('暂无未处理预警 🎉');
    el.querySelectorAll('[data-resolve]').forEach(b => b.onclick = async () => {
      await api.post(`/api/inventory-alerts/${b.dataset.resolve}/resolve`); toast('预警已标记处理'); load();
    });
  };
  $('#f-store', el).onchange = load; $('#f-status', el).onchange = load; $('#f-tr', el).onchange = load;
  load();
};

/* ============ 总部：耗材成本与毛利分析 ============ */
Views.hq['inventory-analysis'] = async function (el) {
  let days = Number(el.dataset.days) || 30;
  const d = await api.get(`/api/hq/inventory-analysis?days=${days}`);
  el.innerHTML = `
    <div class="toolbar mb-16" style="justify-content:flex-end">
      <span class="muted" style="font-size:12.5px">统计周期 ${d.range.from} ~ ${d.range.to}</span>
      <div class="seg" id="range-seg">${[7, 30, 45].map(n => `<button data-d="${n}" class="${n === days ? 'active' : ''}">近${n}天</button>`).join('')}</div>
    </div>
    <div class="grid g-4 mb-16">
      <div class="card kpi k-gold"><div class="k-ico">💆</div><div class="k-label">项目总收入</div><div class="k-val">${fmtMoney(d.totals.revenue)}</div></div>
      <div class="card kpi k-red"><div class="k-ico">🧴</div><div class="k-label">耗材耗用成本</div><div class="k-val">${fmtMoney(d.totals.materialCost)}</div><div class="k-foot">占收入 ${(d.totals.materialCost / Math.max(1, d.totals.revenue) * 100).toFixed(1)}%</div></div>
      <div class="card kpi k-blue"><div class="k-ico">📦</div><div class="k-label">期末库存货值</div><div class="k-val">${fmtMoney(d.totals.stockValue)}</div><div class="k-foot">区间采购 ${fmtMoney(d.totals.purchaseAmount)}</div></div>
      <div class="card kpi k-jade"><div class="k-ico">📈</div><div class="k-label">项目毛利（扣提成+耗材）</div><div class="k-val">${fmtMoney(d.totals.grossProfit)}</div><div class="k-foot">综合毛利率 ${(d.totals.margin * 100).toFixed(1)}% ｜ 净损耗 ${fmtMoney(d.totals.netLoss)}</div></div>
    </div>

    <div class="card mb-16">
      <div class="card-h"><h3>💆 项目毛利分析</h3><span class="sub">毛利 = 实付收入 − 技师提成 − 耗材成本（开单快照成本）</span></div>
      <div class="tbl-wrap">
        <table class="tbl"><thead><tr><th>#</th><th>项目</th><th>品类</th><th class="num">单数</th><th class="num">收入</th><th class="num">技师提成</th><th class="num">耗材成本</th><th class="num">毛利</th><th class="num">毛利率</th></tr></thead>
          <tbody>${d.projectProfit.length ? d.projectProfit.map((p, i) => `<tr>
            <td class="muted">${i + 1}</td><td><b>${esc(p.name)}</b></td><td><span class="tag tag-blue">${esc(p.category)}</span></td>
            <td class="num">${p.count}</td><td class="num money">${fmtMoney(p.revenue)}</td>
            <td class="num">${fmtMoney(p.commission)}</td><td class="num">${fmtMoney(p.materialCost)}</td>
            <td class="num money ${p.grossProfit < 0 ? 'red' : ''}">${fmtMoney(p.grossProfit)}</td>
            <td class="num"><b style="color:${p.margin >= 0.5 ? 'var(--jade)' : p.margin >= 0.3 ? 'var(--gold)' : 'var(--red)'}">${(p.margin * 100).toFixed(1)}%</b></td></tr>`).join('')
            : `<tr><td colspan="9">${emptyBox('该周期暂无账单')}</td></tr>`}</tbody></table>
      </div>
    </div>

    <div class="grid g-2 mb-16">
      <div class="card">
        <div class="card-h"><h3>🧴 耗材成本明细</h3><span class="sub">净耗用（已扣冲正回补）</span></div>
        <div class="tbl-wrap">
          <table class="tbl"><thead><tr><th>耗材</th><th class="num">耗用量</th><th class="num">耗用成本</th><th class="num">采购金额</th><th class="num">报损</th><th class="num">盘亏</th><th class="num">盘盈</th><th class="num">期末/货值</th></tr></thead>
            <tbody>${d.materialCosts.filter(m => m.consumeQty > 0 || m.purchaseAmount > 0).map(m => `<tr>
              <td><b>${esc(m.name)}</b><div class="muted" style="font-size:12px">${esc(m.category)}</div></td>
              <td class="num">${m.consumeQty} ${esc(m.unit)}</td>
              <td class="num money">${fmtMoney(m.consumeCost)}</td>
              <td class="num muted">${fmtMoney(m.purchaseAmount)}</td>
              <td class="num" style="color:var(--red)">${m.damageCost ? fmtMoney(m.damageCost) : '—'}</td>
              <td class="num" style="color:var(--red)">${m.lossCost ? fmtMoney(m.lossCost) : '—'}</td>
              <td class="num" style="color:var(--jade)">${m.gainCost ? fmtMoney(m.gainCost) : '—'}</td>
              <td class="num">${m.endQty} / ${fmtMoney(m.stockValue)}</td></tr>`).join('')}</tbody></table>
        </div>
      </div>
      <div class="card">
        <div class="card-h"><h3>📊 门店损耗率排行</h3><span class="sub">（报损+盘亏−盘盈）/ 理论耗用成本</span></div>
        <div class="tbl-wrap">
          <table class="tbl"><thead><tr><th>#</th><th>门店</th><th class="num">耗用成本</th><th class="num">报损</th><th class="num">盘亏</th><th class="num">盘盈</th><th class="num">净损耗</th><th class="num">损耗率</th></tr></thead>
            <tbody>${d.storeLoss.map((s, i) => `<tr ${s.lossRate > 0.03 ? 'style="background:#fff7f6"' : ''}>
              <td><div class="rank-no">${i + 1}</div></td><td><b>${esc(s.storeName)}</b></td>
              <td class="num">${fmtMoney(s.consumeCost)}</td>
              <td class="num">${fmtMoney(s.damage)}</td><td class="num">${fmtMoney(s.stockLoss)}</td>
              <td class="num" style="color:var(--jade)">${s.stockGain ? fmtMoney(s.stockGain) : '—'}</td>
              <td class="num money ${s.netLoss > 0 ? 'red' : ''}">${fmtMoney(s.netLoss)}</td>
              <td class="num"><b style="color:${s.lossRate > 0.03 ? 'var(--red)' : 'var(--jade)'}">${(s.lossRate * 100).toFixed(2)}%</b></td></tr>`).join('')}</tbody></table>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-h"><h3>📐 理论库存 vs 实际库存差异</h3><span class="sub">以周期内各门店最近一次盘点为准（盘盈/盘亏即理论账与实盘差异）</span></div>
      <div class="tbl-wrap">
        <table class="tbl"><thead><tr><th>门店</th><th>最近盘点时间</th><th class="num">盘点次数</th><th class="num">盘亏金额</th><th class="num">盘盈金额</th><th class="num">周期盘亏合计</th><th>主要差异耗材</th></tr></thead>
          <tbody>${d.storeVariance.map(v => `<tr>
            <td><b>${esc(v.storeName)}</b></td>
            <td class="nowrap muted">${v.latestAt ? v.latestAt.slice(0, 16) : '周期内未盘点'}</td>
            <td class="num">${v.stocktakeCount}</td>
            <td class="num money ${v.latestLoss ? 'red' : ''}">${fmtMoney(v.latestLoss)}</td>
            <td class="num" style="color:var(--jade)">${v.latestGain ? fmtMoney(v.latestGain) : '—'}</td>
            <td class="num">${fmtMoney(v.periodLoss)}</td>
            <td style="font-size:12.5px">${v.diffItems.slice(0, 3).map(i => `${esc(i.materialName)} ${i.diffQty > 0 ? '+' : ''}${i.diffQty}${esc(i.unit)}`).join('；') || '<span class="muted">账实相符</span>'}</td></tr>`).join('')}</tbody></table>
      </div>
    </div>`;
  $('#range-seg', el).querySelectorAll('button').forEach(b => b.onclick = () => { el.dataset.days = b.dataset.d; Views.hq['inventory-analysis'](el); });
};
