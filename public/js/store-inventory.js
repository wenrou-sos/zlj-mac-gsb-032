/* 门店端：库存与出入库 / 库存流水 / 调拨处理 */
window.Views = window.Views || {};
Views.store = Views.store || {};
const StoreInv = {
  sid: () => App.session.storeId,
};

/* ============ 库存与出入库（台账 + 采购/盘点/报损入口） ============ */
Views.store.inventory = async function (el) {
  const sid = StoreInv.sid();
  const [rows, config, alerts] = await Promise.all([
    api.get('/api/stock'), api.get('/api/inventory-config'), api.get('/api/inventory-alerts'),
  ]);
  const policy = config.storePolicies?.[sid] || config.shortPolicy || 'strict';
  el.innerHTML = `
    <div class="card mb-16" style="background:linear-gradient(120deg,#f3f9f7,#fbf7ec);border-color:#e0ece6">
      <div class="card-b" style="display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap">
        <div style="font-size:13px;color:#46605b">📌 当前总部库存策略：<b>${Inv.policyName(policy)}</b>${policy === 'strict' ? '。耗材不足时开单将被拦截，请及时采购补货。' : '。耗材不足时允许开单，库存可为负并产生预警，请尽快补货。'}</div>
        <div class="toolbar">
          <button class="btn btn-primary" id="btn-purchase">🛒 采购入库</button>
          <button class="btn btn-gold" id="btn-stocktake">📋 盘点</button>
          <button class="btn btn-danger" id="btn-damage">🧯 报损</button>
          <button class="btn" id="btn-transfer">🚚 发起调拨</button>
        </div>
      </div>
    </div>
    ${alerts.length ? `<div class="card mb-16" style="border-color:#ecc9c4">
      <div class="card-h"><h3 style="color:var(--red)">⚠️ 库存预警（${alerts.length}）</h3></div>
      <div class="tbl-wrap"><table class="tbl"><tbody>
        ${alerts.map(a => `<tr><td>${a.type === 'negative' ? '<span class="tag tag-red">负库存</span>' : '<span class="tag tag-gold">低库存</span>'}</td>
        <td><b>${esc(a.materialName)}</b></td><td>现存 <b class="${a.qty < 0 ? 'money red' : ''}">${a.qty} ${esc(a.unit)}</b>${a.safetyStock != null ? ` ｜ 安全线 ${a.safetyStock}${esc(a.unit)}` : ''}</td>
        <td class="muted nowrap" style="font-size:12px">${a.createdAt.slice(5, 16)}</td>
        <td class="right"><button class="btn btn-sm" data-resolve="${a.id}">已知晓</button></td></tr>`).join('')}
      </tbody></table></div></div>` : ''}
    <div class="card mb-16">
      <div class="card-h"><h3>📦 本店库存台账</h3>
        <div class="toolbar"><select class="inp" id="f-cat"><option value="">全部分类</option>${[...new Set(rows.map(r => r.category))].map(c => `<option>${esc(c)}</option>`).join('')}</select>
        <input class="inp" id="f-q" placeholder="耗材名称" style="width:160px"></div>
      </div>
      <div class="tbl-wrap" id="rows-box">${loading()}</div>
    </div>
    <div class="grid g-3">
      <div class="card"><div class="card-h"><h3>🛒 最近采购</h3></div><div class="tbl-wrap" id="pr-box">${loading()}</div></div>
      <div class="card"><div class="card-h"><h3>📋 最近盘点</h3></div><div class="tbl-wrap" id="sk-box">${loading()}</div></div>
      <div class="card"><div class="card-h"><h3>🧯 最近报损</h3></div><div class="tbl-wrap" id="dm-box">${loading()}</div></div>
    </div>`;
  const renderRows = () => {
    const cat = $('#f-cat', el).value, q = $('#f-q', el).value.trim();
    const list = rows.filter(r => (!cat || r.category === cat) && (!q || r.materialName.includes(q)));
    $('#rows-box', el).innerHTML = list.length ? `<table class="tbl">
      <thead><tr><th>耗材</th><th>分类</th><th class="num">现存量</th><th class="num">在途(调出)</th><th class="num">安全库存</th><th class="num">移动均价</th><th class="num">库存货值</th><th>状态</th></tr></thead>
      <tbody>${list.map(r => `<tr ${r.qty < 0 ? 'style="background:#fff7f6"' : ''}>
        <td><b>${esc(r.materialName)}</b><div class="muted" style="font-size:12px">${esc(r.spec || '')}</div></td>
        <td><span class="tag tag-blue">${esc(r.category)}</span></td>
        <td class="num ${r.qty < 0 ? 'money red' : ''}">${r.qty} ${esc(r.unit)}</td>
        <td class="num muted">${r.inTransit || 0}</td>
        <td class="num muted">${r.safetyStock}</td>
        <td class="num">${fmtMoney(r.avgCost)}</td>
        <td class="num money">${fmtMoney(r.stockValue)}</td>
        <td>${Inv.stockTag(r)}</td></tr>`).join('')}</tbody></table>`
      : emptyBox('暂无符合条件的耗材');
  };
  $('#f-cat', el).onchange = renderRows;
  $('#f-q', el).oninput = debounce(renderRows, 250);
  renderRows();
  el.querySelectorAll('[data-resolve]').forEach(b => b.onclick = async () => {
    await api.post(`/api/inventory-alerts/${b.dataset.resolve}/resolve`); toast('预警已标记处理'); Views.store.inventory(el);
  });
  const [purchases, stocktakes, damages] = await Promise.all([
    api.get('/api/purchases'), api.get('/api/stocktakes'), api.get('/api/damage-reports'),
  ]);
  const miniList = (box, arr, line) => { $(box, el).innerHTML = arr.length ? `<table class="tbl"><tbody>${arr.slice(0, 5).map(line).join('')}</tbody></table>` : `<div style="padding:24px" class="muted">暂无记录</div>`; };
  miniList('#pr-box', purchases, p => `<tr><td><div style="font-size:12.5px"><b>${fmtMoney(p.totalCost)}</b> · ${p.items.length} 种</div><div class="muted" style="font-size:11.5px">${p.createdAt.slice(5, 16)} ${esc(p.supplier)}</div></td></tr>`);
  miniList('#sk-box', stocktakes, k => `<tr><td><div style="font-size:12.5px">${k.items.length} 项全盘 ${k.lossCost ? `<span style="color:var(--red)">盘亏 ${fmtMoney(k.lossCost)}</span>` : '<span class="tag tag-green">账实相符</span>'}</div><div class="muted" style="font-size:11.5px">${k.createdAt.slice(5, 16)} · ${esc(k.operator)}</div></td></tr>`);
  miniList('#dm-box', damages, d => `<tr><td><div style="font-size:12.5px"><b>${esc(d.materialName)}</b> × ${d.qty}${esc(d.unit)}</div><div class="muted" style="font-size:11.5px">${fmtMoney(d.amount)} · ${esc(d.reason)}</div></td></tr>`);

  $('#btn-purchase', el).onclick = () => purchaseDialog(el);
  $('#btn-stocktake', el).onclick = () => stocktakeDialog(el);
  $('#btn-damage', el).onclick = () => damageDialog(el, rows);
  $('#btn-transfer', el).onclick = () => location.hash = '#/store/stock-transfers';
};

/* 采购入库弹窗 */
function purchaseDialog(el) {
  const materials = App.ctx.materials.filter(m => m.active);
  let rows = [{ materialId: materials[0].id, qty: 10, unitCost: materials[0].standardCost }];
  const total = () => rows.reduce((a, r) => a + (Number(r.qty) || 0) * (Number(r.unitCost) || 0), 0);
  const m = openModal({ title: '采购入库', size: 'lg',
    body: `<div class="form-row"><div class="form-item"><label>供应商</label><input id="pu-supplier" placeholder="如：本草堂供应链"></div>
      <div class="form-item"><label>备注</label><input id="pu-remark"></div></div>
      <h4 style="font-size:13.5px;margin:4px 0 8px">入库明细</h4><div id="pu-rows"></div>
      <button class="btn btn-sm" id="pu-add" style="margin-top:8px">＋ 添加耗材</button>
      <div class="pay-box" style="margin-top:12px;text-align:left;background:#f6faf9"><div class="p-l">采购合计</div><div class="p-v money" id="pu-total">¥0.00</div></div>`,
    footer: `<button class="btn" data-close>取消</button><button class="btn btn-primary" id="pu-ok">确认入库</button>` });
  const sync = () => {
    m.el.querySelectorAll('.pu-row').forEach(row => {
      const i = Number(row.dataset.i);
      rows[i] = { materialId: $('.pu-m', row).value, qty: Number($('.pu-q', row).value) || 0, unitCost: Number($('.pu-c', row).value) || 0 };
    });
    $('#pu-total', m.el).textContent = fmtMoney(total());
  };
  const render = () => {
    $('#pu-rows', m.el).innerHTML = rows.map((r, i) => `
      <div class="pu-row" data-i="${i}" style="display:grid;grid-template-columns:1fr 110px 120px 80px 34px;gap:8px;margin-bottom:8px;align-items:center">
        <select class="inp pu-m">${materials.map(x => `<option value="${x.id}" ${x.id === r.materialId ? 'selected' : ''}>${esc(x.name)}（安全线 ${x.safetyStock}${esc(x.unit)}）</option>`).join('')}</select>
        <input type="number" min="0" step="0.01" class="inp pu-q" value="${r.qty}" placeholder="数量">
        <input type="number" min="0" step="0.01" class="inp pu-c" value="${r.unitCost}" placeholder="单价">
        <div class="muted" id="pu-u">${esc(materials.find(x => x.id === r.materialId)?.unit || '')}</div>
        <button class="btn btn-sm btn-danger pu-del">删</button></div>`).join('');
    m.el.querySelectorAll('.pu-row').forEach(row => {
      $('.pu-m', row).onchange = (e) => {
        const i = Number(row.dataset.i);
        rows[i].unitCost = materials.find(x => x.id === e.target.value)?.standardCost || 0;
        sync(); render();
      };
      $('.pu-q', row).oninput = sync; $('.pu-c', row).oninput = sync;
      $('.pu-del', row).onclick = () => { sync(); rows.splice(Number(row.dataset.i), 1); render(); };
    });
    $('#pu-total', m.el).textContent = fmtMoney(total());
  };
  $('#pu-add', m.el).onclick = () => { sync(); rows.push({ materialId: materials[0].id, qty: 1, unitCost: materials[0].standardCost }); render(); };
  $('#pu-ok', m.el).onclick = async () => {
    sync();
    const items = rows.filter(r => r.qty > 0 && r.unitCost >= 0);
    if (!items.length) return toast('请填写至少一条有效入库明细', 'error');
    try {
      await api.post('/api/purchases', { supplier: $('#pu-supplier', m.el).value.trim(), remark: $('#pu-remark', m.el).value.trim(), items });
      toast(`采购入库成功，合计 ${fmtMoney(total())}`); closeModal(); Views.store.inventory(el);
    } catch (e) { toast(e.message, 'error'); }
  };
  render();
}

/* 盘点弹窗：带出账面数，录入实存 */
function stocktakeDialog(el) {
  const m = openModal({ title: '库存盘点', size: 'lg', body: loading(), footer: `<button class="btn" data-close>取消</button><button class="btn btn-gold" id="sk-ok">提交盘点（自动调整差异）</button>` });
  api.get('/api/stock').then(rows => {
    $('.modal-b', m.el).innerHTML = `
      <p class="muted" style="font-size:12.5px;margin-bottom:10px">📋 录入实际盘点数量，系统自动与账面数量比对并生成盘盈/盘亏调整流水。</p>
      <div class="form-row one" style="margin-bottom:12px"><div class="form-item"><label>盘点备注</label><input id="sk-remark" placeholder="如：月末大盘"></div></div>
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>耗材</th><th class="num">账面数量</th><th class="num">实盘数量</th><th class="num">差异</th></tr></thead>
        <tbody>${rows.map((r, i) => `<tr>
          <td><b>${esc(r.materialName)}</b> <span class="muted">${esc(r.spec || '')}</span></td>
          <td class="num">${r.qty} ${esc(r.unit)}</td>
          <td class="num"><input type="number" min="0" step="0.01" class="inp sk-actual" data-i="${i}" data-book="${r.qty}" data-name="${esc(r.materialName)}" data-unit="${esc(r.unit)}" data-mid="${r.materialId}" value="${r.qty}" style="width:110px;text-align:right"></td>
          <td class="num sk-diff" data-i="${i}">0</td></tr>`).join('')}</tbody></table></div>`;
    const refreshDiffs = () => {
      m.el.querySelectorAll('.sk-actual').forEach(inp => {
        const i = inp.dataset.i, diff = Math.round((Number(inp.value) - Number(inp.dataset.book)) * 100) / 100;
        const cell = $(`.sk-diff[data-i="${i}"]`, m.el);
        cell.innerHTML = diff === 0 ? '<span class="muted">0</span>' : `<b style="color:${diff < 0 ? 'var(--red)' : 'var(--jade)'}">${diff > 0 ? '+' : ''}${diff} ${esc(inp.dataset.unit)}</b>`;
      });
    };
    m.el.querySelectorAll('.sk-actual').forEach(inp => inp.oninput = refreshDiffs);
    $('#sk-ok', m.el).onclick = async () => {
      const items = [...m.el.querySelectorAll('.sk-actual')].map(inp => ({ materialId: inp.dataset.mid, actualQty: Number(inp.value) }));
      try {
        const doc = await api.post('/api/stocktakes', { remark: $('#sk-remark', m.el).value.trim(), items });
        const net = doc.lossCost - doc.gainCost;
        toast(net > 0 ? `盘点完成，盘亏 ${fmtMoney(doc.lossCost)}` : doc.gainCost > 0 ? `盘点完成，盘盈 ${fmtMoney(doc.gainCost)}` : '盘点完成，账实相符');
        closeModal(); Views.store.inventory(el);
      } catch (e) { toast(e.message, 'error'); }
    };
  });
}

/* 报损弹窗 */
function damageDialog(el, rows) {
  const materials = App.ctx.materials.filter(m => m.active);
  const m = openModal({ title: '耗材报损',
    body: `<div class="form-row"><div class="form-item"><label><span class="req">*</span>报损耗材</label>
        <select id="dm-mat">${materials.map(x => { const r = rows.find(z => z.materialId === x.id); return `<option value="${x.id}">${esc(x.name)}（现存 ${r?.qty ?? 0}${esc(x.unit)}）</option>`; }).join('')}</select></div>
      <div class="form-item"><label><span class="req">*</span>报损数量</label><input type="number" min="0.01" step="0.01" id="dm-qty" value="1"></div></div>
      <div class="form-row one"><div class="form-item"><label><span class="req">*</span>报损原因</label><textarea id="dm-reason" placeholder="如：临期/包装破损、操作损毁、变质"></textarea></div></div>
      <p class="muted" style="font-size:12.5px">报损按移动平均成本核减库存并计入门店损耗率。</p>`,
    footer: `<button class="btn" data-close>取消</button><button class="btn btn-danger" id="dm-ok">确认报损</button>` });
  $('#dm-ok', m.el).onclick = async () => {
    try {
      const doc = await api.post('/api/damage-reports', { materialId: $('#dm-mat', m.el).value, qty: Number($('#dm-qty', m.el).value), reason: $('#dm-reason', m.el).value.trim() });
      toast(`报损成功，核销 ${fmtMoney(doc.amount)}`); closeModal(); Views.store.inventory(el);
    } catch (e) { toast(e.message, 'error'); }
  };
}

/* ============ 库存流水 ============ */
Views.store['stock-ledger'] = async function (el) {
  const today = new Date().toISOString().slice(0, 10);
  const fromDefault = new Date(Date.now() - 29 * 864e5).toISOString().slice(0, 10);
  el.innerHTML = `
    <div class="card">
      <div class="card-h"><h3>📒 本店库存流水</h3>
        <div class="toolbar">
          <select class="inp" id="f-type"><option value="">全部类型</option>
            <option value="purchase_in">采购入库</option><option value="consume">服务耗用</option><option value="consume_revert">冲正回补</option>
            <option value="stocktake_adjust">盘点调整</option><option value="damage">报损</option>
            <option value="transfer_out">调出</option><option value="transfer_in">调入</option><option value="transfer_cancel">调拨撤销</option>
          </select>
          <select class="inp" id="f-mat"><option value="">全部耗材</option>${App.ctx.materials.map(x => `<option value="${x.id}">${esc(x.name)}</option>`).join('')}</select>
          <input type="date" class="inp" id="f-from" value="${fromDefault}"><span class="muted">至</span><input type="date" class="inp" id="f-to" value="${today}">
          <button class="btn btn-primary btn-sm" id="f-go">查询</button>
        </div>
      </div>
      <div id="lg-box" class="tbl-wrap">${loading()}</div>
      <div class="card-b" id="lg-sum" style="background:#fafcfb;border-top:1px solid var(--line);display:none"></div>
    </div>`;
  const typeTag = (t) => ({
    purchase_in: '<span class="tag tag-green">采购入库</span>', consume: '<span class="tag tag-blue">服务耗用</span>',
    consume_revert: '<span class="tag tag-gold">冲正回补</span>', stocktake_adjust: '<span class="tag tag-gray">盘点调整</span>',
    damage: '<span class="tag tag-red">报损</span>', transfer_out: '<span class="tag tag-red">调出</span>',
    transfer_in: '<span class="tag tag-green">调入</span>', transfer_cancel: '<span class="tag tag-gold">调拨撤销</span>',
  }[t] || t);
  const load = async () => {
    const qs = new URLSearchParams();
    qs.set('from', $('#f-from', el).value); qs.set('to', $('#f-to', el).value);
    if ($('#f-type', el).value) qs.set('type', $('#f-type', el).value);
    if ($('#f-mat', el).value) qs.set('materialId', $('#f-mat', el).value);
    const list = await api.get('/api/stock-ledger?' + qs);
    $('#lg-box', el).innerHTML = list.length ? `<table class="tbl">
      <thead><tr><th>时间</th><th>类型</th><th>耗材</th><th class="num">变动数量</th><th class="num">单价</th><th class="num">结余</th><th>关联单据/说明</th></tr></thead>
      <tbody>${list.map(l => `<tr>
        <td class="nowrap muted">${l.time.slice(5, 16)}</td>
        <td>${typeTag(l.type)}</td>
        <td><b>${esc(l.materialName)}</b></td>
        <td class="num ${l.qty < 0 ? 'money red' : ''}" style="font-weight:650">${l.qty > 0 ? '+' : ''}${l.qty} ${esc(l.unit)}</td>
        <td class="num muted">${fmtMoney(l.unitCost)}</td>
        <td class="num">${l.balanceAfter} ${esc(l.unit)}</td>
        <td class="muted" style="font-size:12.5px">${l.refId ? esc(l.refId) + ' · ' : ''}${esc(l.remark || '')}</td></tr>`).join('')}</tbody></table>`
      : emptyBox('该条件下暂无流水');
    const inAmt = list.filter(l => l.qty > 0).reduce((a, l) => a + l.qty * l.unitCost, 0);
    const outAmt = list.filter(l => l.qty < 0).reduce((a, l) => a + -l.qty * l.unitCost, 0);
    $('#lg-sum', el).style.display = '';
    $('#lg-sum', el).innerHTML = `<b>合计：</b>${list.length} 条 ｜ 入库金额 <b class="money">${fmtMoney(inAmt)}</b> ｜ 出库/耗用金额 <b class="money red">${fmtMoney(outAmt)}</b>`;
  };
  $('#f-go', el).onclick = () => load().catch(e => toast(e.message, 'error'));
  load();
};

/* ============ 调拨处理（待确认/我发起的 + 发起调拨） ============ */
Views.store['stock-transfers'] = async function (el) {
  const sid = StoreInv.sid();
  el.innerHTML = `
    <div class="card mb-16">
      <div class="card-h"><h3>🚚 跨店调拨</h3>
        <div class="toolbar"><div class="seg" id="tab-seg">
          <button data-t="todo" class="active">待我确认（调入）</button>
          <button data-t="out">我发起的（调出）</button>
          <button data-t="all">全部相关</button>
        </div><button class="btn btn-gold" id="btn-new">＋ 发起调拨</button></div>
      </div>
      <div id="tr-box" class="tbl-wrap">${loading()}</div>
    </div>`;
  let tab = 'todo';
  const load = async () => {
    const qs = tab === 'todo' ? 'scope=in&status=in_transit' : tab === 'out' ? 'scope=out' : '';
    const list = await api.get('/api/stock-transfers?' + qs);
    $('#tr-box', el).innerHTML = list.length ? `<table class="tbl">
      <thead><tr><th>调拨单号</th><th>方向</th><th>耗材</th><th class="num">数量</th><th class="num">单价/金额</th><th>状态</th><th>发起/确认时间</th><th></th></tr></thead>
      <tbody>${list.map(t => {
        const inbound = t.toStoreId === sid;
        return `<tr>
        <td class="muted nowrap">${t.id}</td>
        <td style="font-size:12.5px">${esc(t.fromStoreName)} <span class="muted">→</span> ${esc(t.toStoreName)}${inbound ? ' <span class="tag tag-blue">调入</span>' : ' <span class="tag tag-gold">调出</span>'}</td>
        <td><b>${esc(t.materialName)}</b></td>
        <td class="num">${t.qty} ${esc(t.unit)}</td>
        <td class="num">${fmtMoney(t.unitCost)} / <b class="money">${fmtMoney(t.amount)}</b></td>
        <td>${Inv.transferStatusTag(t.status)}</td>
        <td class="nowrap muted" style="font-size:12px">发起 ${t.createdAt.slice(5, 16)}${t.confirmedAt ? `<br>确认 ${t.confirmedAt.slice(5, 16)}` : ''}${t.cancelledAt ? `<br>取消 ${t.cancelledAt.slice(5, 16)}` : ''}</td>
        <td class="nowrap">
          ${t.status === 'in_transit' && inbound ? '<button class="btn btn-sm btn-primary" data-confirm="' + t.id + '">✓ 确认收货</button>' : ''}
          ${t.status === 'in_transit' && !inbound ? '<button class="btn btn-sm btn-danger" data-cancel="' + t.id + '">途中取消</button>' : ''}
          ${t.status !== 'in_transit' ? '<span class="muted">—</span>' : ''}
        </td></tr>`;
      }).join('')}</tbody></table>`
      : emptyBox(tab === 'todo' ? '暂无待确认的调入调拨' : tab === 'out' ? '暂未发起过调拨' : '暂无调拨记录');
    el.querySelectorAll('[data-confirm]').forEach(b => b.onclick = async () => {
      if (!(await confirmAsync('确认收到调入的耗材？确认后将正式入本店库存，且不能重复确认。', '确认收货', false))) return;
      try { await api.post(`/api/stock-transfers/${b.dataset.confirm}/confirm`); toast('已确认入库'); load(); }
      catch (e) { toast(e.message, 'error'); }
    });
    el.querySelectorAll('[data-cancel]').forEach(b => b.onclick = async () => {
      if (!(await confirmAsync('在途取消该调拨？调出库存将原路回补，取消后对方不能再确认。', '途中取消'))) return;
      try { await api.post(`/api/stock-transfers/${b.dataset.cancel}/cancel`, { reason: '门店端途中取消' }); toast('已取消，库存已回补'); load(); }
      catch (e) { toast(e.message, 'error'); }
    });
  };
  $('#tab-seg', el).querySelectorAll('button').forEach(b => b.onclick = () => {
    tab = b.dataset.t; $('#tab-seg', el).querySelectorAll('button').forEach(x => x.classList.toggle('active', x === b)); load();
  });
  $('#btn-new', el).onclick = () => transferCreateDialog(el, load);
  load();
};

function transferCreateDialog(el, onDone) {
  const sid = StoreInv.sid();
  const targets = App.ctx.stores.filter(s => s.id !== sid);
  let stockRows = [];
  const m = openModal({ title: '发起跨店调拨',
    body: `<div class="form-row"><div class="form-item"><label><span class="req">*</span>调入门店</label>
        <select id="tr-to">${targets.map(s => `<option value="${s.id}">${esc(s.name)}（${esc(s.city)}）</option>`).join('')}</select></div>
      <div class="form-item"><label><span class="req">*</span>调拨耗材</label><select id="tr-mat"></select></div></div>
      <div class="form-row"><div class="form-item"><label><span class="req">*</span>调拨数量（发起后立即从本店扣减转为在途）</label><input type="number" min="0.01" step="0.01" id="tr-qty" value="1"></div>
      <div class="form-item"><label>备注</label><input id="tr-remark" placeholder="如：兄弟店应急支援"></div></div>
      <div class="pay-box" style="background:#f6faf9;text-align:left"><div class="p-l">本店库存</div><div id="tr-info" class="p-v" style="font-size:15px;color:#123a3f">—</div></div>
      <p class="muted" style="font-size:12.5px;margin-top:8px">调拨单需<b>调入方确认后</b>才正式入对方账；对方确认前你可以途中取消，库存原路回补。</p>`,
    footer: `<button class="btn" data-close>取消</button><button class="btn btn-gold" id="tr-ok">发起调拨</button>` });
  api.get('/api/stock').then(rows => {
    stockRows = rows;
    const fillMat = () => {
      $('#tr-mat', m.el).innerHTML = rows.map(r => `<option value="${r.materialId}">${esc(r.materialName)}（现存 ${r.qty}${esc(r.unit)}）</option>`).join('');
      showInfo();
    };
    const showInfo = () => {
      const r = rows.find(x => x.materialId === $('#tr-mat', m.el).value);
      if (!r) return;
      $('#tr-info', m.el).innerHTML = `现存 <b>${r.qty} ${esc(r.unit)}</b> ｜ 在途 ${r.inTransit || 0} ${esc(r.unit)} ｜ 移动均价 ${fmtMoney(r.avgCost)}${r.qty < r.safetyStock ? '<br><span style="color:var(--red)">当前低于安全库存，调拨后请尽快补货</span>' : ''}`;
    };
    fillMat();
    $('#tr-mat', m.el).onchange = showInfo;
  });
  $('#tr-ok', m.el).onclick = async () => {
    try {
      await api.post('/api/stock-transfers', { toStoreId: $('#tr-to', m.el).value, materialId: $('#tr-mat', m.el).value, qty: Number($('#tr-qty', m.el).value), remark: $('#tr-remark', m.el).value.trim() });
      toast('调拨已发起，库存转为在途，等待对方确认'); closeModal(); onDone?.();
    } catch (e) { toast(e.message, 'error'); }
  };
}
