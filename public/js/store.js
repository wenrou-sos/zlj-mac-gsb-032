/* 门店端视图（复用 hq.js 创建的全局 Views 与共享函数） */
window.Views = window.Views || {};
Views.store = {

/* ============ 门店看板 ============ */
async 'dashboard'(el) {
  let days = Number(el.dataset.days) || 30;
  const sid = App.session.storeId;
  const [d, techs] = await Promise.all([
    api.get(`/api/stores/${sid}/dashboard?days=${days}`),
    api.get('/api/technicians?status=active'),
  ]);
  const activeTechs = techs.filter(t => t.storeId === sid);
  el.innerHTML = `
    <div class="toolbar mb-16" style="justify-content:space-between">
      <div style="font-size:13px;color:var(--text-2)">今日营业日：<b>${d.range.to}</b> ｜ 本店在籍技师 <b>${activeTechs.length}</b> 人</div>
      <div class="seg" id="range-seg">${[7, 30, 45].map(n => `<button data-d="${n}" class="${n === days ? 'active' : ''}">近${n}天</button>`).join('')}</div>
    </div>
    <div class="grid g-4 mb-16">
      <div class="card kpi k-gold"><div class="k-ico">💰</div><div class="k-label">周期营收</div><div class="k-val">${fmtMoney(d.kpi.revenue)}</div><div class="k-foot">${d.range.from} ~ ${d.range.to}</div></div>
      <div class="card kpi k-jade"><div class="k-ico">📅</div><div class="k-label">今日营收</div><div class="k-val">${fmtMoney(d.kpi.todayRevenue)}</div><div class="k-foot">今日 ${d.kpi.todayOrders} 单</div></div>
      <div class="card kpi k-blue"><div class="k-ico">🧾</div><div class="k-label">周期账单</div><div class="k-val">${d.kpi.orders}<small> 单</small></div></div>
      <div class="card kpi"><div class="k-ico">👑</div><div class="k-label">周期会员充值</div><div class="k-val">${fmtMoney(d.kpi.memberRecharge)}</div></div>
    </div>

    <div class="card mb-16">
      <div class="card-h"><h3>${d.openShift ? '🕒 当前班次进行中' : '🌙 当前无进行中的班次'}</h3>
        ${d.openShift
          ? `<div class="toolbar"><span class="tag tag-blue">${esc(d.openShift.shiftName)} · ${d.openShift.startTime.slice(11, 16)} 开班</span><button class="btn btn-gold" id="go-handover">交班结算 →</button></div>`
          : `<div class="toolbar"><select class="inp" id="open-code">${App.ctx.shiftDefs.map(x => `<option value="${x.code}">${x.name}（${x.start}-${x.end}）</option>`).join('')}</select><button class="btn btn-primary" id="open-shift">开班打卡</button></div>`}
      </div>
      ${d.openShift ? `<div class="card-b">
        <div class="pay-grid">
          <div class="pay-box"><div class="p-l">本班已接待</div><div class="p-v" style="color:#123a3f">${d.openShift.serveCount} 人</div></div>
          <div class="pay-box cash"><div class="p-l">现金</div><div class="p-v">${fmtMoney(d.openShift.cash)}</div></div>
          <div class="pay-box card"><div class="p-l">刷卡</div><div class="p-v">${fmtMoney(d.openShift.card)}</div></div>
          <div class="pay-box member"><div class="p-l">会员卡</div><div class="p-v">${fmtMoney(d.openShift.member)}</div></div>
        </div>
        <div class="pay-grid" style="margin-top:12px">
          <div class="pay-box mp"><div class="p-l">移动支付</div><div class="p-v">${fmtMoney(d.openShift.mp)}</div></div>
          <div class="pay-box"><div class="p-l">本班营收</div><div class="p-v money">${fmtMoney(d.openShift.revenue)}</div></div>
          <div class="pay-box" style="grid-column:span 2"><div class="p-l">操作</div><div style="margin-top:6px"><button class="btn btn-primary btn-sm" id="go-order">＋ 上钟开单</button> <button class="btn btn-sm" id="go-orders">查看本班账单</button></div></div>
        </div>
      </div>` : `<div class="card-b muted">开班后即可上钟录单，交班时系统自动汇总本班营收并由双方签字确认。</div>`}
    </div>

    <div class="grid g-2 mb-16">
      <div class="card"><div class="card-h"><h3>📈 营收与单量趋势</h3></div>
        <div class="card-b">${Charts.areaLine(d.trend, { id: 'store' })}</div></div>
      <div class="card"><div class="card-h"><h3>🥧 品类营收占比</h3></div>
        <div class="card-b" style="display:flex;gap:20px;align-items:center;flex-wrap:wrap">
          <div>${Charts.donut(d.catShare.map(c => ({ name: c.category, value: c.revenue })), { centerLabel: '周期营收' })}</div>
          <div style="flex:1;min-width:200px">${Charts.legend(d.catShare.map(c => ({ name: c.category, value: c.revenue })))}</div>
        </div></div>
    </div>

    <div class="card">
      <div class="card-h"><h3>📋 近期交班记录</h3><button class="btn" id="all-hd">查看全部</button></div>
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>日期</th><th>班次</th><th class="num">接待</th><th class="num">现金</th><th class="num">刷卡</th><th class="num">会员卡</th><th class="num">移动</th><th class="num">合计</th><th>交班/接班</th><th></th></tr></thead>
        <tbody>${d.recentHandovers.length ? d.recentHandovers.map(x => `
          <tr><td class="nowrap">${x.businessDate}</td><td>${esc(x.shiftName)}</td><td class="num">${x.serveCount}</td>
          <td class="num">${fmtMoney(x.cash)}</td><td class="num">${fmtMoney(x.card)}</td><td class="num">${fmtMoney(x.member)}</td><td class="num">${fmtMoney(x.mp)}</td>
          <td class="num money">${fmtMoney(x.revenue)}</td><td class="nowrap" style="font-size:12.5px">${esc(x.opener)}→${esc(x.closer)}</td>
          <td><button class="btn btn-sm" data-hd="${x.id}">明细</button></td></tr>`).join('')
          : `<tr><td colspan="10">${emptyBox('近期暂无交班记录')}</td></tr>`}</tbody></table></div>
    </div>`;
  $('#range-seg', el).querySelectorAll('button').forEach(b => b.onclick = () => { el.dataset.days = b.dataset.d; this.dashboard(el); });
  $('#go-handover', el)?.addEventListener('click', () => location.hash = '#/store/handover');
  $('#go-order', el)?.addEventListener('click', () => location.hash = '#/store/orders');
  $('#go-orders', el)?.addEventListener('click', () => location.hash = '#/store/orders');
  $('#all-hd', el)?.addEventListener('click', () => location.hash = '#/store/handovers');
  $('#open-shift', el)?.addEventListener('click', async () => {
    try { await api.post('/api/shifts', { shiftCode: $('#open-code', el).value }); toast('开班成功'); this.dashboard(el); }
    catch (e) { toast(e.message, 'error'); }
  });
  el.querySelectorAll('[data-hd]').forEach(b => b.onclick = () => handoverDetail(b.dataset.hd));
},

/* ============ 上钟开单 ============ */
async 'orders'(el) {
  const sid = App.session.storeId;
  const [shifts, techsAll, members] = await Promise.all([
    api.get('/api/shifts?status=open'), api.get('/api/technicians?status=active'), api.get('/api/members'),
  ]);
  const shift = shifts[0] || null;
  const techs = techsAll.filter(t => t.storeId === sid);
  el.innerHTML = `
    <div class="grid g-2 mb-16" style="grid-template-columns: 380px 1fr">
      <div class="card" id="order-form-card">
        <div class="card-h"><h3>🛎️ 上钟开单</h3>${shift ? `<span class="tag tag-blue">${esc(shift.shiftName)}进行中</span>` : '<span class="tag tag-red">未开班</span>'}</div>
        <div class="card-b">
          ${!shift ? `<div class="empty"><span class="e-ico">⏸️</span>当前没有进行中的班次<br><br><button class="btn btn-primary" id="quick-open">立即开班</button></div>` : `
          <div class="form-item mb-16"><label><span class="req">*</span>服务项目（总部统一定价）</label>
            <select id="o-svc" class="inp" style="width:100%"><option value="">请选择项目</option>
            ${App.ctx.services.filter(s => s.active).map(s => `<option value="${s.id}">${esc(s.name)} · ${s.duration}分钟 · ${fmtMoney(s.price)}</option>`).join('')}</select></div>
          <div class="form-item mb-16"><label><span class="req">*</span>上钟技师</label>
            <select id="o-tech" class="inp" style="width:100%"><option value="">请选择技师</option>
            ${techs.map(t => `<option value="${t.id}">${esc(t.name)} · ${esc(t.levelName)}</option>`).join('')}</select></div>
          <div class="form-item mb-16"><label>会员（可选，选择后自动使用会员卡余额支付）</label>
            <select id="o-member" class="inp" style="width:100%"><option value="">散客</option>
            ${members.map(m => `<option value="${m.id}">${esc(m.name)} · ${esc(m.levelName)} · 余额${fmtMoney(m.balance)}</option>`).join('')}</select></div>
          <div class="form-item mb-16" id="pay-row"><label>支付方式</label>
            <select id="o-pay" class="inp" style="width:100%"><option value="cash">现金</option><option value="card">刷卡</option><option value="mp">移动支付</option></select></div>
          <div class="pay-box mb-16" style="background:#f6faf9;text-align:left">
            <div class="p-l">金额试算</div>
            <div id="quote" style="margin-top:6px;font-size:13px;line-height:1.9"><span class="muted">选择项目和技师后自动试算…</span></div>
          </div>
          <button class="btn btn-gold" style="width:100%;justify-content:center;padding:11px" id="o-submit">✓ 确认开单结账</button>`}
        </div>
      </div>
      <div class="card">
        <div class="card-h"><h3>🧾 本班账单实时列表</h3>${shift ? `<span class="sub" id="live-sum"></span>` : ''}</div>
        <div class="tbl-wrap" id="order-list">${loading()}</div>
      </div>
    </div>`;

  const reloadList = async () => {
    if (!shift) return;
    const list = await api.get('/api/orders?shiftId=' + shift.id);
    const validList = list.filter(o => !o.status || o.status === 'valid');
    const sum = (pm) => validList.filter(o => o.payMethod === pm).reduce((a, o) => a + o.amount, 0);
    $('#live-sum', el).textContent = `${list.length} 单 · 营收 ${fmtMoney(list.reduce((a, o) => a + o.amount, 0))}`;
    $('#order-list', el).innerHTML = list.length ? `
      <table class="tbl"><thead><tr><th>时间</th><th>项目</th><th>技师</th><th>会员</th><th class="num">实付</th><th>支付</th><th class="num">耗材成本</th><th class="num">技师提成</th><th>状态</th><th></th></tr></thead>
      <tbody>${list.map(o => `
        <tr class="${o.status && o.status !== 'valid' ? 'row-void' : ''}"><td class="nowrap muted">${o.createdAt.slice(11, 16)}</td><td>${esc(o.serviceName)}</td><td>${esc(o.techName)}</td>
        <td>${o.memberName ? esc(o.memberName) : '<span class="muted">散客</span>'}</td>
        <td class="num money">${fmtMoney(o.amount)}</td><td>${payTag(o.payMethod)}</td>
        <td class="num muted">${o.materialCost != null ? fmtMoney(o.materialCost) : '—'}</td>
        <td class="num">${fmtMoney(o.techCommission)}</td>
        <td>${o.status && o.status !== 'valid' ? `<span class="tag tag-red">${esc(o.statusName)}</span>` : '<span class="tag tag-green">正常</span>'}</td>
        <td class="nowrap">${o.status && o.status !== 'valid'
          ? '<span class="muted" title="' + esc(o.reverseReason || '') + '">已回补库存</span>'
          : `<button class="btn btn-sm btn-danger" data-rev="${o.id}">撤销/冲正</button>`}</td></tr>`).join('')}
        <tr style="background:#fafcfb;font-weight:600"><td colspan="4" class="right">本班合计（正常账单）</td>
        <td class="num money">${fmtMoney(list.filter(o => !o.status || o.status === 'valid').reduce((a, o) => a + o.amount, 0))}</td>
        <td style="font-size:12px"><span class="muted">现</span>${fmtMoney(sum('cash'))} <span class="muted">卡</span>${fmtMoney(sum('card'))} <span class="muted">会</span>${fmtMoney(sum('member'))} <span class="muted">移</span>${fmtMoney(sum('mp'))}</td>
        <td class="num muted">${fmtMoney(list.filter(o => !o.status || o.status === 'valid').reduce((a, o) => a + (o.materialCost || 0), 0))}</td>
        <td class="num red">${fmtMoney(list.filter(o => !o.status || o.status === 'valid').reduce((a, o) => a + o.techCommission, 0))}</td><td colspan="2"></td></tr>
      </tbody></table>` : emptyBox('本班暂无账单');
    el.querySelectorAll('[data-rev]').forEach(b => b.onclick = async () => {
      const ok = await confirmAsync('撤销/冲正后该账单作废，会员卡支付会原路退回余额，耗材库存按开单时快照回补（仅回补一次，不可重复冲正）。确认继续？', '确认冲正', true);
      if (!ok) return;
      try { await api.post(`/api/orders/${b.dataset.rev}/reverse`, { reason: '门店当日冲正' }); toast('账单已冲正，耗材库存已按快照回补'); reloadList(); }
      catch (e) { toast(e.message, 'error'); }
    });
  };

  $('#quick-open', el)?.addEventListener('click', async () => {
    await api.post('/api/shifts', { shiftCode: 'day' }); toast('已开班'); this.orders(el);
  });

  const quote = async () => {
    const serviceId = $('#o-svc', el).value, techId = $('#o-tech', el).value, memberId = $('#o-member', el).value;
    $('#pay-row', el).style.display = memberId ? 'none' : '';
    if (!serviceId || !techId) return;
    try {
      const q = await api.post('/api/orders/quote', { serviceId, techId, memberId: memberId || null });
      const matRows = (q.materials || []).map(x => {
        const lack = (x.stockQty ?? 0) < x.qty;
        return `<div class="mat-line ${lack ? 'lack' : ''}"><span>${esc(x.materialName)}</span>
        <span class="muted">用 ${x.qty}${esc(x.unit)} ｜ 库存 <b class="${lack ? 'qty-neg' : ''}">${x.stockQty == null ? '-' : fmtNum(x.stockQty)}${esc(x.unit)}</b></span></div>`;
      }).join('');
      $('#quote', el).innerHTML = `
        挂牌价 <b>${fmtMoney(q.price)}</b>${q.discountRate < 1 ? ` ｜ 会员折扣 <b style="color:var(--gold)">${(q.discountRate * 10).toFixed(1)}折</b>` : ''}<br>
        实付金额 <b class="money" style="font-size:16px">${fmtMoney(q.amount)}</b> ｜ 技师提成 <b style="color:var(--red)">${fmtMoney(q.commission)}</b><br>
        <div class="mat-quote"><div class="mq-head">🧪 标准耗材耗用 · 单耗成本 <b class="money">${fmtMoney(q.materialCost)}</b></div>${matRows || '<span class="muted">该项目暂无耗材配方</span>'}</div>
        ${q.shortage.length ? (q.shortageMode === 'strict'
          ? `<div class="stock-warn">🚫 库存不足，当前策略禁止开单：${q.shortage.map(x => esc(x.materialName) + '缺' + x.gap + x.unit).join('、')}</div>`
          : `<div class="stock-warn neg">⚠️ 库存不足，将以负库存开单并自动产生预警：${q.shortage.map(x => esc(x.materialName) + '缺' + x.gap + x.unit).join('、')}</div>`) : ''}
        <span class="muted">提成依据：${esc(q.basis)}</span>${memberId ? `<br><span class="muted">会员卡余额 ${fmtMoney(q.balance)}</span>` : ''}`;
    } catch (e) { $('#quote', el).textContent = e.message; }
  };
  if (shift) {
    ['o-svc', 'o-tech', 'o-member'].forEach(id => $('#' + id, el).onchange = quote);
    $('#o-submit', el).onclick = async () => {
      const body = { serviceId: $('#o-svc', el).value, techId: $('#o-tech', el).value, payMethod: $('#o-pay', el).value };
      const mid = $('#o-member', el).value; if (mid) body.memberId = mid;
      if (!body.serviceId || !body.techId) return toast('请选择项目与技师', 'error');
      try {
        const r = await api.post('/api/orders', body);
        toast(`开单成功：${fmtMoney(r.amount)}（耗材 ${fmtMoney(r.materialCost)} · 提成 ${fmtMoney(r.techCommission)}）`);
        if (r.negativeAlert) toast('已产生负库存预警，请及时补货', 'error');
        this.orders(el);
      } catch (e) { toast(e.message, 'error'); }
    };
    reloadList();
  }
},

/* ============ 交班结算 ============ */
async 'handover'(el) {
  const sid = App.session.storeId;
  const shifts = await api.get('/api/shifts?status=open');
  const shift = shifts.find(s => s.storeId === sid);
  el.innerHTML = `<div id="hd-root">${loading()}</div>`;
  if (!shift) {
    const last = (await api.get('/api/handovers'))[0];
    $('#hd-root', el).innerHTML = `
      <div class="card"><div class="card-b" style="text-align:center;padding:50px">
        <div style="font-size:40px;margin-bottom:10px">🌙</div>
        <h3 style="margin-bottom:6px">当前没有进行中的班次</h3>
        <p class="muted mb-16">上一班次已完成交班${last ? `（${last.businessDate} ${last.shiftName}）` : ''}，请先开班。</p>
        <div style="display:flex;gap:10px;justify-content:center">
          <select class="inp" id="sh-code">${App.ctx.shiftDefs.map(x => `<option value="${x.code}">${x.name}（${x.start}-${x.end}）</option>`).join('')}</select>
          <button class="btn btn-primary" id="sh-open">开班打卡</button></div>
      </div></div>`;
    $('#sh-open', el).onclick = async () => {
      try { await api.post('/api/shifts', { shiftCode: $('#sh-code', el).value }); toast('开班成功'); this.handover(el); }
      catch (e) { toast(e.message, 'error'); }
    };
    return;
  }
  const orders = await api.get('/api/orders?shiftId=' + shift.id);
  const sum = (pm) => orders.filter(o => o.payMethod === pm).reduce((a, o) => a + o.amount, 0);
  const total = orders.reduce((a, o) => a + o.amount, 0);
  const comm = orders.reduce((a, o) => a + o.techCommission, 0);

  $('#hd-root', el).innerHTML = `
    <div class="card mb-16">
      <div class="card-h"><h3>📝 交班报表 · ${shift.businessDate} ${shift.shiftName}</h3>
        <span class="sub">班次时段 ${shift.startTime.slice(11)} ~ ${shift.endTime.slice(11)} ｜ 开班 ${esc(shift.opener)}</span></div>
      <div class="card-b">
        <div class="pay-grid mb-16">
          <div class="pay-box"><div class="p-l">本班接待人数</div><div class="p-v" style="color:#123a3f">${orders.length} 人</div></div>
          <div class="pay-box cash"><div class="p-l">现金收入</div><div class="p-v">${fmtMoney(sum('cash'))}</div></div>
          <div class="pay-box card"><div class="p-l">刷卡收入</div><div class="p-v">${fmtMoney(sum('card'))}</div></div>
          <div class="pay-box member"><div class="p-l">会员卡收入</div><div class="p-v">${fmtMoney(sum('member'))}</div></div>
        </div>
        <div class="pay-grid mb-16">
          <div class="pay-box mp"><div class="p-l">移动支付</div><div class="p-v">${fmtMoney(sum('mp'))}</div></div>
          <div class="pay-box"><div class="p-l">营收合计</div><div class="p-v money">${fmtMoney(total)}</div></div>
          <div class="pay-box"><div class="p-l">技师提成合计</div><div class="p-v" style="color:var(--red)">${fmtMoney(comm)}</div></div>
          <div class="pay-box"><div class="p-l">班账单数</div><div class="p-v">${orders.length}</div></div>
        </div>
        <div class="detail-list">
          <div class="dl-head"><span>时间</span><span>项目</span><span>技师</span><span>时长</span><span>支付</span><span class="right">实付/提成</span></div>
          ${orders.length ? orders.map(o => `
            <div class="dl-row"><span class="muted nowrap">${o.createdAt.slice(11, 16)}</span>
            <span>${esc(o.serviceName)}${o.memberName ? ' <span class="tag tag-gold">' + esc(o.memberName) + '</span>' : ''}</span>
            <span>${esc(o.techName)}</span><span>${o.duration}′</span><span>${payTag(o.payMethod)}</span>
            <span class="right"><b class="money">${fmtMoney(o.amount)}</b><br><span class="muted" style="font-size:12px">${fmtMoney(o.techCommission)}</span></span></div>`).join('')
            : `<div class="empty">本班暂无上钟记录</div>`}
        </div>
      </div>
    </div>
    <div class="card">
      <div class="card-h"><h3>✍️ 交接班签字确认</h3><span class="sub">双方签字后方可完成交班，数据同步总部</span></div>
      <div class="card-b">
        <div class="form-row">
          <div class="form-item"><label><span class="req">*</span>交班人（本班负责人）</label><input class="inp" id="c-opener" value="${esc(shift.opener)}" style="width:100%"></div>
          <div class="form-item"><label><span class="req">*</span>接班人</label><input class="inp" id="c-closer" placeholder="接班人姓名" style="width:100%"></div>
        </div>
        <div class="grid g-2 mb-16">
          <div><div class="form-item"><label>交班人签字</label><canvas class="sign-canvas" id="sign1"></canvas><div class="sign-tip"><span>请在框内手写签名</span><button class="btn btn-sm" id="clr1">清除</button></div></div></div>
          <div><div class="form-item"><label>接班人签字</label><canvas class="sign-canvas" id="sign2"></canvas><div class="sign-tip"><span>请在框内手写签名</span><button class="btn btn-sm" id="clr2">清除</button></div></div></div>
        </div>
        <div class="form-row one"><div class="form-item"><label>交班备注（选填）</label><textarea id="c-remark" placeholder="现金封包金额、设备异常、待跟进事项等"></textarea></div></div>
        <div style="display:flex;gap:10px;justify-content:flex-end">
          <button class="btn" id="c-preview">预览交班报表</button>
          <button class="btn btn-gold" id="c-ok" style="padding:10px 22px">✓ 双方签字确认，完成交班</button>
        </div>
      </div>
    </div>`;

  const pad1 = initSignature($('#sign1', el)), pad2 = initSignature($('#sign2', el));
  $('#clr1', el).onclick = () => pad1.clear();
  $('#clr2', el).onclick = () => pad2.clear();
  $('#c-preview', el).onclick = () => handoverPreviewShifts(orders, { sum, total, comm, shift });

  $('#c-ok', el).onclick = async () => {
    const opener = $('#c-opener', el).value.trim(), closer = $('#c-closer', el).value.trim();
    if (!opener || !closer) return toast('请填写交班人与接班人', 'error');
    const s1 = pad1.dataURL(), s2 = pad2.dataURL();
    if (!s1 || !s2) return toast('交班双方都必须手写签字', 'error');
    try {
      const hand = await api.post(`/api/shifts/${shift.id}/close`, {
        opener, closer, openerSign: s1, closerSign: s2, remark: $('#c-remark', el).value.trim(),
      });
      toast('交班完成，报表已同步总部');
      renderHandoverDone(el, hand, shift);
    } catch (e) { toast(e.message, 'error'); }
  };
},

/* ============ 技师业绩提成 ============ */
async 'performance'(el) {
  const sid = App.session.storeId;
  const today = new Date().toISOString().slice(0, 10);
  const fromDefault = new Date(Date.now() - 29 * 864e5).toISOString().slice(0, 10);
  el.innerHTML = `
    <div class="card">
      <div class="card-h"><h3>💰 技师上钟业绩与提成</h3>
        <div class="toolbar">
          <input type="date" class="inp" id="p-from" value="${fromDefault}">
          <span class="muted">至</span>
          <input type="date" class="inp" id="p-to" value="${today}">
          <button class="btn btn-primary btn-sm" id="p-go">统计</button>
        </div>
      </div>
      <div id="p-box" class="tbl-wrap">${loading()}</div>
    </div>`;
  const load = async () => {
    const qs = new URLSearchParams({ from: $('#p-from', el).value, to: $('#p-to', el).value });
    const d = await api.get(`/api/stores/${sid}/tech-performance?` + qs);
    const totRev = d.rows.reduce((a, r) => a + r.revenue, 0), totComm = d.rows.reduce((a, r) => a + r.commission, 0), totCnt = d.rows.reduce((a, r) => a + r.orderCount, 0);
    $('#p-box', el).innerHTML = `
      <table class="tbl"><thead><tr><th>排名</th><th>工号</th><th>技师</th><th>等级</th><th class="num">上钟单数</th><th class="num">服务时长(h)</th><th class="num">服务营收</th><th class="num">应发提成</th><th>状态</th></tr></thead>
      <tbody>${d.rows.map((r, i) => `
        <tr><td><div class="rank-no">${i + 1}</div></td><td class="muted">${r.techId}</td><td><b>${esc(r.name)}</b></td>
        <td><span class="tag tag-gold">${esc(r.levelName)}</span></td>
        <td class="num">${r.orderCount}</td><td class="num">${r.hours}</td>
        <td class="num money">${fmtMoney(r.revenue)}</td>
        <td class="num"><b class="money red">${fmtMoney(r.commission)}</b></td>
        <td>${statusTag(r.status)}</td></tr>`).join('')}
        <tr style="background:#fafcfb;font-weight:600"><td colspan="4" class="right">合计</td>
        <td class="num">${totCnt}</td><td class="num">${(d.rows.reduce((a, r) => a + r.hours, 0)).toFixed(1)}</td>
        <td class="num money">${fmtMoney(totRev)}</td><td class="num money red">${fmtMoney(totComm)}</td><td></td></tr>
      </tbody></table>
      <p class="muted" style="padding:12px 16px;font-size:12.5px">统计区间 ${d.from} ~ ${d.to}；提成按总部下发的「技师提成标准」实时计算，专项固定提成规则优先于等级比例。</p>`;
  };
  $('#p-go', el).onclick = () => load().catch(e => toast(e.message, 'error'));
  load();
},

/* ============ 技师管理（门店） ============ */
async 'technicians'(el) { return techList(el, 'store'); },

/* ============ 会员管理（门店） ============ */
async 'members'(el) {
  el.innerHTML = `
    <div class="card">
      <div class="card-h"><h3>👥 本店会员</h3>
        <div class="toolbar"><input class="inp" id="m-q" placeholder="姓名 / 手机号" style="width:200px">
        <button class="btn btn-gold" id="m-add">＋ 新会员开卡</button></div>
      </div>
      <div id="m-box" class="tbl-wrap">${loading()}</div>
    </div>`;
  const load = async () => {
    const q = $('#m-q', el).value.trim();
    const list = await api.get('/api/members' + (q ? '?q=' + encodeURIComponent(q) : ''));
    $('#m-box', el).innerHTML = `
      <table class="tbl"><thead><tr><th>会员号</th><th>姓名</th><th>手机号</th><th>等级</th><th class="num">卡内余额</th><th class="num">累计充值</th><th class="num">累计消费</th><th>开卡日期</th><th></th></tr></thead>
      <tbody>${list.length ? list.map(m => `
        <tr><td class="muted">${m.id}</td><td><b>${esc(m.name)}</b></td><td class="nowrap">${esc(m.phone)}</td>
        <td><span class="tag tag-gold">${esc(m.levelName)}</span> <span class="muted">${(m.discount * 10).toFixed(1)}折</span></td>
        <td class="num money">${fmtMoney(m.balance)}</td><td class="num">${fmtMoney(m.totalRecharge)}</td>
        <td class="num">${fmtMoney(m.totalConsume)}</td><td class="nowrap muted">${m.regDate}</td>
        <td class="nowrap"><button class="btn btn-sm btn-gold" data-rc="${m.id}">充值</button>
        <button class="btn btn-sm" data-log="${m.id}">充值记录</button></td></tr>`).join('')
        : `<tr><td colspan="9">${emptyBox('未找到会员')}</td></tr>`}</tbody></table>`;
    el.querySelectorAll('[data-rc]').forEach(b => b.onclick = () => rechargeDialog(b.dataset.rc, el));
    el.querySelectorAll('[data-log]').forEach(b => b.onclick = async () => {
      const logs = await api.get(`/api/members/${b.dataset.log}/recharges`);
      openModal({ title: '充值记录', body: logs.length ? `
        <table class="tbl"><thead><tr><th>时间</th><th class="num">本金</th><th class="num">赠金</th><th class="num">到账</th><th>支付</th></tr></thead>
        <tbody>${logs.map(r => `<tr><td class="nowrap">${r.createdAt}</td><td class="num">${fmtMoney(r.amount)}</td>
        <td class="num" style="color:var(--jade)">+${fmtMoney(r.bonus)}</td><td class="num money">${fmtMoney(r.amount + r.bonus)}</td><td>${payTag(r.payMethod)}</td></tr>`).join('')}</tbody></table>`
        : emptyBox('暂无充值记录'), footer: `<button class="btn btn-primary" data-close>关闭</button>` });
    });
  };
  $('#m-q', el).oninput = debounce(load, 300);
  $('#m-add', el).onclick = () => {
    const m = openModal({ title: '新会员开卡',
      body: `<div class="form-row"><div class="form-item"><label><span class="req">*</span>姓名</label><input id="nm-name"></div>
      <div class="form-item"><label><span class="req">*</span>手机号</label><input id="nm-phone" placeholder="11 位手机号"></div></div>
      <div class="form-row"><div class="form-item"><label>开卡首次充值（可选）</label><input type="number" min="0" id="nm-amt" value="1000"></div>
      <div class="form-item"><label>充值支付方式</label><select id="nm-pay"><option value="cash">现金</option><option value="card">刷卡</option><option value="mp">移动支付</option></select></div></div>
      <p class="muted" style="font-size:12.5px">充值满 3000 元系统自动赠送 10%，累计充值自动升级会员等级。</p>`,
      footer: `<button class="btn" data-close>取消</button><button class="btn btn-primary" id="nm-ok">开卡</button>` });
    $('#nm-ok', m.el).onclick = async () => {
      try {
        await api.post('/api/members', { name: $('#nm-name', m.el).value.trim(), phone: $('#nm-phone', m.el).value.trim(), initAmount: Number($('#nm-amt', m.el).value) || 0, payMethod: $('#nm-pay', m.el).value });
        toast('开卡成功'); closeModal(); load();
      } catch (e) { toast(e.message, 'error'); }
    };
  };
  load();
},

/* ============ 历史交班记录（门店） ============ */
async 'handovers'(el) {
  el.innerHTML = `
    <div class="card"><div class="card-h"><h3>📋 本店历史交班记录</h3></div>
    <div id="hd-box" class="tbl-wrap">${loading()}</div></div>`;
  const list = await api.get('/api/handovers');
  $('#hd-box', el).innerHTML = `
    <table class="tbl"><thead><tr><th>日期</th><th>班次</th><th class="num">接待</th><th class="num">现金</th><th class="num">刷卡</th><th class="num">会员卡</th><th class="num">移动支付</th><th class="num">合计</th><th class="num">提成</th><th>交班/接班</th><th></th></tr></thead>
    <tbody>${list.length ? list.map(x => `
      <tr><td class="nowrap">${x.businessDate}</td><td>${esc(x.shiftName)}</td><td class="num">${x.serveCount}</td>
      <td class="num">${fmtMoney(x.cash)}</td><td class="num">${fmtMoney(x.card)}</td><td class="num">${fmtMoney(x.member)}</td><td class="num">${fmtMoney(x.mp)}</td>
      <td class="num money">${fmtMoney(x.revenue)}</td><td class="num red">${fmtMoney(x.commission)}</td>
      <td class="nowrap" style="font-size:12.5px">${esc(x.opener)} → ${esc(x.closer)}</td>
      <td><button class="btn btn-sm" data-view="${x.id}">明细/签字</button></td></tr>`).join('')
      : `<tr><td colspan="11">${emptyBox('暂无交班记录')}</td></tr>`}</tbody></table>`;
  el.querySelectorAll('[data-view]').forEach(b => b.onclick = () => handoverDetail(b.dataset.view));
},

/* ============ 耗材库存（采购入库 / 盘点 / 报损） ============ */
async 'inventory'(el) {
  const sid = App.session.storeId;
  let inv = await api.get(`/api/stores/${sid}/inventory`);
  const levelTag = (lv) => ({ out: '<span class="tag tag-red">缺货</span>', low: '<span class="tag tag-gold">低库存</span>', ok: '<span class="tag tag-green">正常</span>' }[lv]);
  el.innerHTML = `
    <div class="grid g-4 mb-16">
      <div class="card kpi"><div class="k-label">库存金额（按标准成本）</div><div class="k-val">${fmtMoney(inv.summary.totalAmount)}</div><div class="k-foot">${inv.summary.skuCount} 种耗材</div></div>
      <div class="card kpi k-red"><div class="k-ico">⚠️</div><div class="k-label">缺货品项</div><div class="k-val">${inv.summary.outCount}<small> 种</small></div><div class="k-foot">需立即补货</div></div>
      <div class="card kpi k-gold"><div class="k-ico">🕯️</div><div class="k-label">低库存品项</div><div class="k-val">${inv.summary.lowCount}<small> 种</small></div><div class="k-foot">低于安全存量</div></div>
      <div class="card kpi k-blue"><div class="k-ico">🚚</div><div class="k-label">在途调入 / 未处理预警</div><div class="k-val">${inv.incoming.length}<small> 笔</small> / ${inv.summary.openAlerts}</div><div class="k-foot">待调入确认的调拨单</div></div>
    </div>
    <div class="card mb-16" style="${inv.policy.shortageMode === 'negative' ? 'border-color:#ecc9c4;background:#fdf7f6' : 'background:#f6faf9'}">
      <div class="card-b" style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;font-size:13px">
        <span>${inv.policy.shortageMode === 'strict'
          ? '🔒 总部策略：<b>耗材库存不足时禁止开单</b>，请及时采购或申请调拨'
          : '⚠️ 总部策略：<b>库存不足时允许负库存开单</b>，系统将自动产生预警并计入总部监控'}</span>
        <button class="btn btn-sm" id="go-transfer">🚚 去跨店调拨</button>
      </div>
    </div>
    ${inv.incoming.length ? `<div class="card mb-16" style="border-color:#bfe0d6">
      <div class="card-h"><h3>📥 待本店确认收货的调入</h3><span class="sub">确认后才正式入本店账面</span></div>
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>调拨单号</th><th>调出门店</th><th>耗材</th><th class="num">数量</th><th></th></tr></thead>
      <tbody>${inv.incoming.map(x => `<tr><td class="muted">${x.transferId}</td><td>${esc(x.fromStoreName)}</td><td>${esc(x.materialName)}</td>
      <td class="num">${x.qty}</td><td><button class="btn btn-sm btn-gold" data-confirm="${x.transferId}">确认收货入账</button></td></tr>`).join('')}</tbody></table></div>
    </div>` : ''}
    <div class="card">
      <div class="card-h"><h3>📦 本店耗材库存</h3>
        <div class="toolbar">
          <select class="inp" id="f-level"><option value="">全部状态</option><option value="out">缺货</option><option value="low">低库存</option><option value="ok">正常</option></select>
          <input class="inp" id="f-q" placeholder="耗材名称" style="width:160px">
          <button class="btn btn-gold" id="btn-purchase">＋ 采购入库</button>
          <button class="btn" id="btn-check">📋 盘点</button>
          <button class="btn btn-danger" id="btn-loss">♻️ 报损</button>
        </div>
      </div>
      <div class="tbl-wrap" id="inv-tbl"></div>
    </div>`;
  const render = () => {
    const lv = $('#f-level', el).value, q = $('#f-q', el).value.trim();
    let rows = inv.items;
    if (lv) rows = rows.filter(i => i.level === lv);
    if (q) rows = rows.filter(i => i.name.includes(q));
    $('#inv-tbl', el).innerHTML = rows.length ? `
      <table class="tbl"><thead><tr><th>编号</th><th>耗材</th><th>分类</th><th class="num">库存数量</th><th class="num">库存金额</th><th>状态</th></tr></thead>
      <tbody>${rows.map(i => `
        <tr><td class="muted">${i.id}</td><td><b>${esc(i.name)}</b><br><span class="muted" style="font-size:12px">${esc(i.spec)}</span></td>
        <td><span class="tag tag-blue">${esc(i.category)}</span></td>
        <td class="num ${i.qty <= 0 ? 'qty-neg' : ''}" style="font-size:15px;font-weight:650">${fmtNum(i.qty)} <span class="muted" style="font-weight:400">${esc(i.unit)}</span></td>
        <td class="num money">${fmtMoney(i.amount)}</td><td>${levelTag(i.level)}</td></tr>`).join('')}
      </tbody></table>` : emptyBox('没有符合条件的耗材');
  };
  $('#f-level', el).onchange = render;
  $('#f-q', el).oninput = debounce(render, 200);
  $('#go-transfer', el).onclick = () => location.hash = '#/store/transfers';
  el.querySelectorAll('[data-confirm]').forEach(b => b.onclick = async () => {
    try {
      await api.post(`/api/inventory-transfers/${b.dataset.confirm}/confirm`);
      toast('已确认收货，库存正式入账'); Views.store.inventory(el);
    } catch (e) { toast(e.message, 'error'); }
  });
  $('#btn-purchase', el).onclick = () => purchaseDialog(el, inv.items);
  $('#btn-check', el).onclick = () => checkDialog(el, inv.items);
  $('#btn-loss', el).onclick = () => lossDialog(el, inv.items);
  render();
},

/* ============ 库存流水 ============ */
async 'stock-movements'(el) {
  const today = new Date().toISOString().slice(0, 10);
  const fromDef = new Date(Date.now() - 14 * 864e5).toISOString().slice(0, 10);
  const [materials] = await Promise.all([api.get('/api/materials')]);
  el.innerHTML = `
    <div class="card">
      <div class="card-h"><h3>🔀 本店库存流水</h3>
        <div class="toolbar">
          <input type="date" class="inp" id="f-from" value="${fromDef}">
          <span class="muted">至</span>
          <input type="date" class="inp" id="f-to" value="${today}">
          <select class="inp" id="f-type"><option value="">全部类型</option>
            <option value="purchase">采购入库</option><option value="consume">项目耗用</option>
            <option value="consume_reverse">冲正回补</option><option value="check">盘点调整</option>
            <option value="loss">报损</option><option value="transfer_out">调拨调出</option>
            <option value="transfer_in">调拨入库</option><option value="transfer_cancel">调拨取消回补</option>
            <option value="init">期初建账</option></select>
          <input class="inp" id="f-q" placeholder="耗材名称" style="width:140px">
          <button class="btn btn-primary btn-sm" id="f-go">查询</button>
        </div>
      </div>
      <div id="mv-box" class="tbl-wrap">${loading()}</div>
    </div>`;
  const typeTag = (t) => ({
    purchase: 'tag-green', consume: 'tag-gray', consume_reverse: 'tag-jade',
    check: 'tag-gold', loss: 'tag-red', transfer_out: 'tag-blue', transfer_in: 'tag-green',
    transfer_cancel: 'tag-jade', init: 'tag-gray',
  }[t] || 'tag-gray');
  const load = async () => {
    const qs = new URLSearchParams({ from: $('#f-from', el).value, to: $('#f-to', el).value });
    if ($('#f-type', el).value) qs.set('type', $('#f-type', el).value);
    const list = await api.get('/api/stock-movements?' + qs);
    const q = $('#f-q', el).value.trim();
    const rows = q ? list.filter(x => x.materialName.includes(q)) : list;
    $('#mv-box', el).innerHTML = rows.length ? `
      <table class="tbl"><thead><tr><th>时间</th><th>类型</th><th>耗材</th><th>关联单号</th><th class="num">入库</th><th class="num">出库</th><th class="num">结存</th><th>经手人</th><th>备注</th></tr></thead>
      <tbody>${rows.map(x => `
        <tr><td class="nowrap muted">${x.createdAt.slice(5, 16)}</td>
        <td><span class="tag ${typeTag(x.refType)}">${x.typeName}</span></td>
        <td><b>${esc(x.materialName)}</b><br><span class="muted" style="font-size:12px">${esc(x.spec)}</span></td>
        <td class="muted nowrap" style="font-size:12px">${x.refId || '—'}</td>
        <td class="num qty-pos">${x.direction === 'in' ? '+' + fmtNum(x.qty) : ''}</td>
        <td class="num qty-neg">${x.direction === 'out' ? '−' + fmtNum(x.qty) : ''}</td>
        <td class="num"><b>${fmtNum(x.balanceAfter)}</b> <span class="muted">${esc(materials.find(m => m.id === x.materialId)?.unit || '')}</span></td>
        <td class="nowrap">${esc(x.operator)}</td><td class="muted" style="font-size:12px">${esc(x.remark)}</td></tr>`).join('')}
      </tbody></table>
      <p class="muted" style="padding:10px 16px;font-size:12.5px">共 ${rows.length} 条（最多展示 300 条）。项目耗用按开单时的配方快照自动生成；冲正回补每笔账单仅发生一次。</p>`
      : emptyBox('该条件下暂无库存流水');
  };
  $('#f-go', el).onclick = () => load().catch(e => toast(e.message, 'error'));
  $('#f-type', el).onchange = load;
  $('#f-q', el).oninput = debounce(load, 300);
  load();
},

/* ============ 跨店调拨 ============ */
async 'transfers'(el) {
  const sid = App.session.storeId;
  const stores = App.ctx.stores;
  const [inv, list] = await Promise.all([
    api.get(`/api/stores/${sid}/inventory`),
    api.get('/api/inventory-transfers'),
  ]);
  const waitIn = list.filter(t => t.toStoreId === sid && t.status === 'in_transit');
  const waitOut = list.filter(t => t.fromStoreId === sid && t.status === 'in_transit');
  const statusTagT = (s) => ({ in_transit: 'tag-gold', confirmed: 'tag-green', canceled: 'tag-gray' }[s] || 'tag-gray');
  el.innerHTML = `
    ${waitIn.length ? `<div class="card mb-16" style="border-color:#bfe0d6;background:linear-gradient(120deg,#f4fbf8,#fcfaf3)">
      <div class="card-h"><h3>📥 待本店确认（${waitIn.length}）</h3><span class="sub">调出方已出账在途，本店确认后才正式入账</span></div>
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>单号</th><th>调出门店</th><th>耗材</th><th class="num">数量</th><th>发起时间</th><th></th></tr></thead>
      <tbody>${waitIn.map(t => t.lineViews.map((l, i) => `<tr><td class="muted">${i === 0 ? t.id : ''}</td>
      <td>${i === 0 ? esc(t.fromStoreName) : ''}</td><td>${esc(l.materialName)}（${esc(l.spec)}）</td><td class="num">${l.qty} ${esc(l.unit)}</td>
      <td class="nowrap muted">${i === 0 ? t.createdAt.slice(5, 16) : ''}</td>
      <td class="nowrap">${i === 0 ? `<button class="btn btn-sm btn-gold" data-confirm="${t.id}">✓ 确认收货</button>` : ''}</td></tr>`).join('')).join('')}</tbody></table></div>
    </div>` : ''}
    <div class="card mb-16">
      <div class="card-h"><h3>🚚 发起跨店调拨</h3>
        <button class="btn btn-gold" id="btn-new">＋ 新建调拨单</button></div>
      <div class="card-b muted" style="font-size:13px">
        调拨流程：<b>本店发起即从本店账面出账（货物在途）→ 调入门店确认收货后才入对方账面</b>。在途期间本店可取消，库存原路回补；已确认的调拨不能取消（需对方反向调回）。所有确认/取消操作均做幂等保护，重复点击不会造成库存错账。
        ${waitOut.length ? `<br><b style="color:var(--gold)">本店有 ${waitOut.length} 笔在途调出等待对方确认：${waitOut.map(t => t.id).join('、')}</b>` : ''}
      </div>
    </div>
    <div class="card">
      <div class="card-h"><h3>📜 调拨记录</h3>
        <select class="inp" id="f-st"><option value="">全部状态</option><option value="in_transit">待确认</option><option value="confirmed">已完成</option><option value="canceled">已取消</option></select>
      </div>
      <div class="tbl-wrap" id="tr-box"></div>
    </div>`;
  const render = () => {
    const st = $('#f-st', el).value;
    const rows = st ? list.filter(t => t.status === st) : list;
    $('#tr-box', el).innerHTML = rows.length ? `
      <table class="tbl"><thead><tr><th>单号</th><th>方向</th><th>耗材明细</th><th>事由</th><th>状态</th><th>发起/确认时间</th><th>操作</th></tr></thead>
      <tbody>${rows.map(t => {
        const isFrom = t.fromStoreId === sid, isTo = t.toStoreId === sid;
        return `<tr>
        <td class="muted nowrap">${t.id}</td>
        <td class="nowrap" style="font-size:12.5px">${esc(t.fromStoreName)}<br>→ ${esc(t.toStoreName)}</td>
        <td>${t.lineViews.map(l => `<div>${esc(l.materialName)} <b>×${l.qty}${esc(l.unit)}</b></div>`).join('')}</td>
        <td class="muted" style="font-size:12px">${esc(t.reason || '—')}${t.cancelReason ? `<br><span style="color:var(--red)">取消：${esc(t.cancelReason)}</span>` : ''}</td>
        <td><span class="tag ${statusTagT(t.status)}">${t.statusName}</span></td>
        <td class="nowrap muted" style="font-size:12px">${t.createdAt.slice(5, 16)}<br>${t.confirmedAt ? '→ ' + t.confirmedAt.slice(5, 16) : (t.canceledAt ? '取消 ' + t.canceledAt.slice(5, 16) : '待确认')}</td>
        <td class="nowrap">
          ${t.status === 'in_transit' && isTo ? `<button class="btn btn-sm btn-gold" data-confirm="${t.id}">确认收货</button>` : ''}
          ${t.status === 'in_transit' && isFrom ? `<button class="btn btn-sm btn-danger" data-cancel="${t.id}">途中取消</button>` : ''}
          ${t.status !== 'in_transit' ? '<span class="muted">已完结</span>' : ''}
        </td></tr>`;
      }).join('')}</tbody></table>` : emptyBox('暂无调拨记录');
    el.querySelectorAll('[data-confirm]').forEach(b => b.onclick = async () => {
      try { await api.post(`/api/inventory-transfers/${b.dataset.confirm}/confirm`); toast('已确认收货，库存入账'); Views.store.transfers(el); }
      catch (e) { toast(e.message, 'error'); }
    });
    el.querySelectorAll('[data-cancel]').forEach(b => b.onclick = () => cancelTransferDialog(b.dataset.cancel, el));
  };
  $('#f-st', el).onchange = render;
  $('#btn-new', el).onclick = () => newTransferDialog(el, stores, inv.items);
  el.querySelectorAll('[data-confirm]').forEach(b => b.onclick = async () => {
    try { await api.post(`/api/inventory-transfers/${b.dataset.confirm}/confirm`); toast('已确认收货，库存入账'); Views.store.transfers(el); }
    catch (e) { toast(e.message, 'error'); }
  });
  render();
},
};

/* 交班报表预览（签字前核对） */
function handoverPreviewShifts(orders, { sum, total, comm, shift }) {
  openModal({ title: `交班报表预览 · ${shift.businessDate} ${shift.shiftName}`, size: 'xl',
    body: `
    <div class="pay-grid mb-16">
      <div class="pay-box"><div class="p-l">接待人数</div><div class="p-v" style="color:#123a3f">${orders.length} 人</div></div>
      <div class="pay-box cash"><div class="p-l">现金</div><div class="p-v">${fmtMoney(sum('cash'))}</div></div>
      <div class="pay-box card"><div class="p-l">刷卡</div><div class="p-v">${fmtMoney(sum('card'))}</div></div>
      <div class="pay-box member"><div class="p-l">会员卡</div><div class="p-v">${fmtMoney(sum('member'))}</div></div>
    </div>
    <div class="pay-grid mb-16">
      <div class="pay-box mp"><div class="p-l">移动支付</div><div class="p-v">${fmtMoney(sum('mp'))}</div></div>
      <div class="pay-box"><div class="p-l">营收合计</div><div class="p-v money">${fmtMoney(total)}</div></div>
      <div class="pay-box"><div class="p-l">技师提成</div><div class="p-v" style="color:var(--red)">${fmtMoney(comm)}</div></div>
      <div class="pay-box"><div class="p-l">账单数</div><div class="p-v">${orders.length}</div></div>
    </div>
    <div class="detail-list">
      <div class="dl-head"><span>时间</span><span>项目</span><span>技师</span><span>时长</span><span>支付</span><span class="right">实付/提成</span></div>
      ${orders.length ? orders.map(o => `
        <div class="dl-row"><span class="muted nowrap">${o.createdAt.slice(11, 16)}</span>
        <span>${esc(o.serviceName)}${o.memberName ? ' <span class="tag tag-gold">' + esc(o.memberName) + '</span>' : ''}</span>
        <span>${esc(o.techName)}</span><span>${o.duration}′</span><span>${payTag(o.payMethod)}</span>
        <span class="right"><b class="money">${fmtMoney(o.amount)}</b><br><span class="muted" style="font-size:12px">${fmtMoney(o.techCommission)}</span></span></div>`).join('')
        : `<div class="empty">本班暂无上钟记录</div>`}
    </div>
    <p class="muted" style="margin-top:12px;font-size:12.5px">核对无误后关闭预览，由交班人与接班人分别手写签名并完成交班。</p>`,
    footer: `<button class="btn btn-primary" data-close>我已核对，去签字</button>` });
}

/* 交班完成页（本班已结账，双方签字确认后展示） */
function renderHandoverDone(el, hand, shift) {
  const isImg = (s) => typeof s === 'string' && s.startsWith('data:image');
  const sign = (s, name, role) => isImg(s)
    ? `<div style="text-align:center"><img src="${s}" style="height:84px;border:1px solid var(--line);border-radius:8px;background:#fff;padding:4px"><div class="muted" style="font-size:12px;margin-top:4px">${role}：${esc(name)}</div></div>`
    : `<div class="muted">${esc(name)}</div>`;
  el.innerHTML = `
    <div class="card mb-16" style="border-color:#bfe0d6;background:linear-gradient(120deg,#f4fbf8,#fcfaf3)">
      <div class="card-b" style="display:flex;align-items:center;gap:14px">
        <div style="font-size:34px">✅</div>
        <div style="flex:1">
          <h3 style="font-size:17px">${hand.businessDate} ${esc(hand.shiftName)} 已完成交班</h3>
          <div class="muted" style="font-size:13px;margin-top:2px">报表编号 ${hand.id} ｜ 确认时间 ${hand.confirmedAt} ｜ 已同步至总部看板</div>
        </div>
        <button class="btn btn-primary" id="hd-view">查看完整交班报表</button>
      </div>
    </div>
    <div class="card mb-16">
      <div class="card-h"><h3>📝 本班营收汇总</h3></div>
      <div class="card-b">
        <div class="pay-grid">
          <div class="pay-box"><div class="p-l">本班接待人数</div><div class="p-v" style="color:#123a3f">${hand.serveCount} 人</div></div>
          <div class="pay-box cash"><div class="p-l">现金收入</div><div class="p-v">${fmtMoney(hand.cash)}</div></div>
          <div class="pay-box card"><div class="p-l">刷卡收入</div><div class="p-v">${fmtMoney(hand.card)}</div></div>
          <div class="pay-box member"><div class="p-l">会员卡收入</div><div class="p-v">${fmtMoney(hand.member)}</div></div>
        </div>
        <div class="pay-grid" style="margin-top:12px">
          <div class="pay-box mp"><div class="p-l">移动支付</div><div class="p-v">${fmtMoney(hand.mp)}</div></div>
          <div class="pay-box"><div class="p-l">营收合计</div><div class="p-v money">${fmtMoney(hand.revenue)}</div></div>
          <div class="pay-box"><div class="p-l">技师提成合计</div><div class="p-v" style="color:var(--red)">${fmtMoney(hand.commission)}</div></div>
          <div class="pay-box"><div class="p-l">账单数</div><div class="p-v">${hand.serveCount}</div></div>
        </div>
      </div>
    </div>
    <div class="grid g-2">
      <div class="card"><div class="card-h"><h3>✍️ 双方签字确认</h3></div>
        <div class="card-b"><div class="grid g-2">${sign(hand.openerSign, hand.opener, '交班人')}${sign(hand.closerSign, hand.closer, '接班人')}</div>
        ${hand.remark ? `<p class="muted" style="font-size:13px;margin-top:12px">备注：${esc(hand.remark)}</p>` : ''}</div></div>
      <div class="card"><div class="card-h"><h3>🌙 下一步</h3></div>
        <div class="card-b" style="line-height:2.2">
          <p>本班已结账封班，请下一班负责人在门店看板点击「开班打卡」开启新班次。</p>
          <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:8px">
            <button class="btn btn-primary" id="go-dash">前往门店看板</button>
            <button class="btn" id="go-list">查看历史交班记录</button>
          </div>
        </div></div>
    </div>`;
  $('#hd-view', el).onclick = () => handoverDetail(hand.id);
  $('#go-dash', el).onclick = () => location.hash = '#/store/dashboard';
  $('#go-list', el).onclick = () => location.hash = '#/store/handovers';
}

/* 会员充值弹窗 */
function rechargeDialog(id, el) {
  const m = openModal({ title: '会员充值',
    body: `<div class="form-row"><div class="form-item"><label>充值金额（元）</label><input type="number" min="1" id="rc-amt" value="1000"></div>
    <div class="form-item"><label>支付方式</label><select id="rc-pay"><option value="cash">现金</option><option value="card">刷卡</option><option value="mp">移动支付</option></select></div></div>
    <div style="display:flex;gap:8px;margin-bottom:6px">${[500, 1000, 3000, 5000, 10000].map(v => `<button class="btn btn-sm rc-quick" data-v="${v}">${v}</button>`).join('')}</div>
    <p class="muted" style="font-size:12.5px">满 3000 元赠 10%（如充 3000 到账 3300）。充值后自动重算会员等级。</p>`,
    footer: `<button class="btn" data-close>取消</button><button class="btn btn-gold" id="rc-ok">确认充值</button>` });
  m.el.querySelectorAll('.rc-quick').forEach(b => b.onclick = () => { $('#rc-amt', m.el).value = b.dataset.v; });
  $('#rc-ok', m.el).onclick = async () => {
    try {
      const r = await api.post(`/api/members/${id}/recharge`, { amount: Number($('#rc-amt', m.el).value), payMethod: $('#rc-pay', m.el).value });
      toast(`充值成功，到账 ${fmtMoney(r.recharge.amount + r.recharge.bonus)}（含赠 ${fmtMoney(r.recharge.bonus)}）`);
      closeModal(); Views.store.members(el);
    } catch (e) { toast(e.message, 'error'); }
  };
}

/* ============ 采购入库弹窗 ============ */
function purchaseDialog(el, items) {
  const suppliers = ['康源卫材', '沪杭医疗用品', '蕲春本草', '芳疗精油直供', '白云日化批发', '总部统采'];
  let lines = [{ materialId: items[0]?.id || '', qty: 1, unitCost: 0 }];
  const syncCost = () => lines.forEach(l => { const it = items.find(i => i.id === l.materialId); if (it && !(l.unitCost > 0)) l.unitCost = it.defaultCost; });
  syncCost();
  const draw = () => {
    $('#po-lines', m.el).innerHTML = lines.map((l, i) => {
      const it = items.find(x => x.id === l.materialId);
      return `<div class="rl-row">
        <select class="inp" data-i="${i}" data-k="materialId" style="flex:1">${items.map(x => `<option value="${x.id}" ${x.id === l.materialId ? 'selected' : ''}>${esc(x.name)}（${esc(x.unit)} · 现价 ${fmtMoney(x.defaultCost)} · 库存 ${fmtNum(x.qty)}）</option>`).join('')}</select>
        <input class="inp" type="number" min="0.01" step="1" data-i="${i}" data-k="qty" value="${l.qty}" style="width:110px" title="数量">
        <input class="inp" type="number" min="0" step="0.01" data-i="${i}" data-k="unitCost" value="${l.unitCost}" style="width:110px" title="实际采购单价">
        <button class="btn btn-sm btn-danger" data-del="${i}" type="button">删</button>
      </div>`;
    }).join('');
    const total = lines.reduce((a, l) => a + l.qty * l.unitCost, 0);
    $('#po-total', m.el).textContent = '合计金额：' + fmtMoney(Math.round(total * 100) / 100);
    m.el.querySelectorAll('[data-k]').forEach(inp => inp.onchange = () => {
      const i = Number(inp.dataset.i);
      lines[i][inp.dataset.k] = inp.dataset.k === 'materialId' ? inp.value : Number(inp.value);
      if (inp.dataset.k === 'materialId') lines[i].unitCost = items.find(x => x.id === inp.value)?.defaultCost || 0;
      draw();
    });
    m.el.querySelectorAll('[data-del]').forEach(b => b.onclick = () => { lines.splice(Number(b.dataset.del), 1); draw(); });
  };
  const m = openModal({ title: '采购入库', size: 'lg',
    body: `<div class="form-row one"><div class="form-item"><label>供应商</label>
      <input class="inp" id="po-sup" list="sup-list" value="${suppliers[0]}">
      <datalist id="sup-list">${suppliers.map(s => `<option value="${s}">`).join('')}</datalist></div></div>
      <label class="muted" style="font-size:12.5px">采购明细（实际单价将写入库存流水并用于成本核算）</label>
      <div id="po-lines" style="display:flex;flex-direction:column;gap:8px;margin:8px 0"></div>
      <button class="btn btn-sm" id="po-add" type="button">＋ 添加品项</button>
      <div class="recipe-sum" id="po-total" style="margin-top:10px"></div>`,
    footer: `<button class="btn" data-close>取消</button><button class="btn btn-gold" id="po-ok">确认入库</button>` });
  $('#po-add', m.el).onclick = () => { lines.push({ materialId: items[0]?.id, qty: 1, unitCost: items[0]?.defaultCost || 0 }); draw(); };
  draw();
  $('#po-ok', m.el).onclick = async () => {
    try {
      const r = await api.post('/api/purchase-orders', { supplier: $('#po-sup', m.el).value.trim(), lines });
      toast(`入库成功，共 ${r.lines.length} 项 ${fmtMoney(r.totalAmount)}`);
      closeModal(); Views.store.inventory(el);
    } catch (e) { toast(e.message, 'error'); }
  };
}

/* ============ 盘点弹窗（系统数自动带出，录入实盘数） ============ */
function checkDialog(el, items) {
  const m = openModal({ title: '库存盘点', size: 'xl',
    body: `<p class="muted mb-16" style="font-size:12.5px">系统账面数量已自动带出，请填写实盘数量；存在差异的品项确认后将一次过账（盘盈入库/盘亏出库），并生成盘点凭证。</p>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>耗材</th><th class="num">账面数量</th><th class="num" style="width:170px">实盘数量</th><th class="num">差异</th></tr></thead>
    <tbody>${items.map(i => `
      <tr><td><b>${esc(i.name)}</b> <span class="muted">${esc(i.unit)}</span></td>
      <td class="num" id="sys-${i.id}">${fmtNum(i.qty)}</td>
      <td class="num"><input class="inp ck-qty" data-id="${i.id}" data-sys="${i.qty}" type="number" min="0" step="0.01" value="${i.qty}" style="width:130px;text-align:right"></td>
      <td class="num" id="diff-${i.id}"></td></tr>`).join('')}
    </tbody></table></div>
    <div class="form-row one" style="margin-top:12px"><div class="form-item"><label>盘点备注</label><input class="inp" id="ck-remark" placeholder="如：月度盘点 / 节前盘点"></div></div>`,
    footer: `<button class="btn" data-close>取消</button><button class="btn btn-primary" id="ck-ok">确认盘点并过账差异</button>` });
  const refresh = () => m.el.querySelectorAll('.ck-qty').forEach(inp => {
    const diff = Number(inp.value) - Number(inp.dataset.sys);
    const cell = $('#diff-' + inp.dataset.id, m.el);
    cell.innerHTML = diff === 0 ? '<span class="muted">—</span>'
      : `<b class="${diff < 0 ? 'qty-neg' : 'qty-pos'}">${diff > 0 ? '+' : ''}${fmtNum(Math.round(diff * 100) / 100)}</b>`;
  });
  m.el.querySelectorAll('.ck-qty').forEach(inp => inp.oninput = refresh);
  refresh();
  $('#ck-ok', m.el).onclick = async () => {
    const lines = [...m.el.querySelectorAll('.ck-qty')].map(inp => ({ materialId: inp.dataset.id, actualQty: Number(inp.value) }));
    try {
      await api.post('/api/stock-checks', { lines, remark: $('#ck-remark', m.el).value.trim() });
      toast('盘点完成，差异已过账'); closeModal(); Views.store.inventory(el);
    } catch (e) { toast(e.message, 'error'); }
  };
}

/* ============ 报损弹窗 ============ */
function lossDialog(el, items) {
  const avail = items.filter(i => i.qty > 0);
  if (!avail.length) return toast('当前所有耗材账面库存均为 0，无可报损品项', 'error');
  let lines = [{ materialId: avail[0].id, qty: 1 }];
  const m = openModal({ title: '耗材报损', size: 'lg',
    body: `<div class="form-row one"><div class="form-item"><label><span class="req">*</span>报损原因</label>
      <input class="inp" id="ls-reason" placeholder="如：过期报废 / 包装破损 / 操作洒漏 / 受潮变质"></div></div>
      <div id="ls-lines" style="display:flex;flex-direction:column;gap:8px"></div>
      <button class="btn btn-sm" id="ls-add" type="button" style="margin-top:8px">＋ 添加报损品项</button>
      <div class="recipe-sum" id="ls-sum" style="margin-top:10px"></div>`,
    footer: `<button class="btn" data-close>取消</button><button class="btn btn-danger" id="ls-ok">确认报损出库</button>` });
  const draw = () => {
    $('#ls-lines', m.el).innerHTML = lines.map((l, i) => {
      const it = items.find(x => x.id === l.materialId);
      return `<div class="rl-row">
        <select class="inp" data-i="${i}" data-k="materialId" style="flex:1">${avail.map(x => `<option value="${x.id}" ${x.id === l.materialId ? 'selected' : ''}>${esc(x.name)}（库存 ${fmtNum(x.qty)} ${esc(x.unit)}）</option>`).join('')}</select>
        <input class="inp" type="number" min="0.01" step="1" data-i="${i}" data-k="qty" value="${l.qty}" style="width:130px">
        <span class="muted" style="width:34px">${esc(it.unit)}</span>
        <button class="btn btn-sm btn-danger" data-del="${i}" type="button">删</button></div>`;
    }).join('');
    const total = lines.reduce((a, l) => a + l.qty * (items.find(x => x.id === l.materialId)?.defaultCost || 0), 0);
    $('#ls-sum', m.el).innerHTML = `报损成本合计：<b class="money red">${fmtMoney(Math.round(total * 100) / 100)}</b>（报损不可超过账面库存）`;
    m.el.querySelectorAll('[data-k]').forEach(inp => inp.onchange = () => {
      const i = Number(inp.dataset.i);
      lines[i][inp.dataset.k] = inp.dataset.k === 'materialId' ? inp.value : Number(inp.value);
      draw();
    });
    m.el.querySelectorAll('[data-del]').forEach(b => b.onclick = () => { lines.splice(Number(b.dataset.del), 1); draw(); });
  };
  $('#ls-add', m.el).onclick = () => { lines.push({ materialId: avail[0].id, qty: 1 }); draw(); };
  draw();
  $('#ls-ok', m.el).onclick = async () => {
    const reason = $('#ls-reason', m.el).value.trim();
    if (!reason) return toast('请填写报损原因', 'error');
    try {
      const r = await api.post('/api/stock-losses', { reason, lines });
      toast(`报损已出库，共 ${fmtMoney(r.totalAmount)}`); closeModal(); Views.store.inventory(el);
    } catch (e) { toast(e.message, 'error'); }
  };
}

/* ============ 新建跨店调拨 ============ */
function newTransferDialog(el, stores, items) {
  const sid = App.session.storeId;
  const others = stores.filter(s => s.id !== sid);
  let lines = [{ materialId: items[0]?.id, qty: 1 }];
  const m = openModal({ title: '发起跨店调拨', size: 'lg',
    body: `<div class="form-row"><div class="form-item"><label><span class="req">*</span>调入门店</label>
      <select id="tr-to" class="inp">${others.map(s => `<option value="${s.id}">${esc(s.name)}（${esc(s.city)}）</option>`).join('')}</select></div>
      <div class="form-item"><label>调拨事由</label><input class="inp" id="tr-reason" placeholder="如：门店应急调剂 / 活动备货支援"></div></div>
      <label class="muted" style="font-size:12.5px">发起后立即从本店出账在途，对方确认后入账</label>
      <div id="tr-lines" style="display:flex;flex-direction:column;gap:8px;margin:8px 0"></div>
      <button class="btn btn-sm" id="tr-add" type="button">＋ 添加调拨品项</button>`,
    footer: `<button class="btn" data-close>取消</button><button class="btn btn-gold" id="tr-ok">发起调拨（本店出账）</button>` });
  const draw = () => {
    $('#tr-lines', m.el).innerHTML = lines.map((l, i) => {
      const it = items.find(x => x.id === l.materialId);
      return `<div class="rl-row">
        <select class="inp" data-i="${i}" data-k="materialId" style="flex:1">${items.map(x => `<option value="${x.id}" ${x.id === l.materialId ? 'selected' : ''}>${esc(x.name)}（本店库存 ${fmtNum(x.qty)} ${esc(x.unit)}）</option>`).join('')}</select>
        <input class="inp" type="number" min="0.01" step="1" data-i="${i}" data-k="qty" value="${l.qty}" style="width:130px">
        <span class="muted" style="width:34px">${esc(it.unit)}</span>
        <button class="btn btn-sm btn-danger" data-del="${i}" type="button">删</button></div>`;
    }).join('');
    m.el.querySelectorAll('[data-k]').forEach(inp => inp.onchange = () => {
      const i = Number(inp.dataset.i);
      lines[i][inp.dataset.k] = inp.dataset.k === 'materialId' ? inp.value : Number(inp.value);
      draw();
    });
    m.el.querySelectorAll('[data-del]').forEach(b => b.onclick = () => { lines.splice(Number(b.dataset.del), 1); draw(); });
  };
  $('#tr-add', m.el).onclick = () => { lines.push({ materialId: items[0]?.id, qty: 1 }); draw(); };
  draw();
  $('#tr-ok', m.el).onclick = async () => {
    try {
      await api.post('/api/inventory-transfers', { toStoreId: $('#tr-to', m.el).value, reason: $('#tr-reason', m.el).value.trim(), lines });
      toast('调拨已发起，本店已出账，等待对方确认'); closeModal(); Views.store.transfers(el);
    } catch (e) { toast(e.message, 'error'); }
  };
}

/* ============ 途中取消调拨 ============ */
function cancelTransferDialog(id, el) {
  const m = openModal({ title: `取消调拨 ${id}`,
    body: `<p style="font-size:13.5px;line-height:1.8">该调拨尚在途中，取消后货物将<b>原路回补本店库存</b>，调入方无法再确认。<br>已经确认入账的调拨不能取消。</p>
    <div class="form-row one" style="margin-top:10px"><div class="form-item"><label>取消原因</label><input class="inp" id="tc-reason" placeholder="如：对方已自行采购 / 发货有误"></div></div>`,
    footer: `<button class="btn" data-close>再想想</button><button class="btn btn-danger" id="tc-ok">确认取消并回补</button>` });
  $('#tc-ok', m.el).onclick = async () => {
    try {
      await api.post(`/api/inventory-transfers/${id}/cancel`, { reason: $('#tc-reason', m.el).value.trim() });
      toast('调拨已取消，库存已回补本店'); closeModal(); Views.store.transfers(el);
    } catch (e) { toast(e.message, 'error'); }
  };
}
