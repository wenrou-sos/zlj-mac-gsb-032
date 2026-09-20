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
    ${(d.kpi.stockAlerts || d.kpi.transfersIn) ? `<div class="card mb-16" style="border-color:#e6d6ad;background:linear-gradient(120deg,#fdf9ee,#f6faf9)">
      <div class="card-b" style="display:flex;align-items:center;gap:16px;flex-wrap:wrap">
        <span style="font-size:13px">📦 <b>库存待办：</b></span>
        <a href="#/store/stock-transfers" class="tag tag-blue" style="text-decoration:none;padding:5px 12px">🚚 ${d.kpi.transfersIn || 0} 笔调入待确认${d.kpi.transfersOut ? ` ｜ ${d.kpi.transfersOut} 笔调出在途` : ''}</a>
        <a href="#/store/inventory" class="tag tag-gold" style="text-decoration:none;padding:5px 12px">⚠️ ${d.kpi.stockAlerts} 条库存预警待处理</a>
      </div></div>` : ''}
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
            <div class="p-l">金额与耗材试算</div>
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
    const sum = (pm) => list.filter(o => o.payMethod === pm).reduce((a, o) => a + o.amount, 0);
    $('#live-sum', el).textContent = `${list.length} 单 · 营收 ${fmtMoney(list.reduce((a, o) => a + o.amount, 0))}`;
    $('#order-list', el).innerHTML = list.length ? `
      <table class="tbl"><thead><tr><th>时间</th><th>项目</th><th>技师</th><th>会员</th><th class="num">实付</th><th class="num">耗材</th><th>支付</th><th class="num">技师提成</th><th></th></tr></thead>
      <tbody>${list.map(o => `
        <tr style="${o.reversed ? 'opacity:.55' : ''}"><td class="nowrap muted">${o.createdAt.slice(11, 16)}</td><td>${esc(o.serviceName)}${o.reversed ? '<br><span class="tag tag-red">已冲正</span>' : ''}</td><td>${esc(o.techName)}</td>
        <td>${o.memberName ? esc(o.memberName) : '<span class="muted">散客</span>'}</td>
        <td class="num money">${fmtMoney(o.amount)}</td>
        <td class="num muted">${o.materialCost ? fmtMoney(o.materialCost) : '—'}</td>
        <td>${payTag(o.payMethod)}</td>
        <td class="num">${fmtMoney(o.techCommission)}</td>
        <td class="nowrap">${o.reversed ? `<span class="muted" title="${esc(o.reverseReason || '')}">${o.reversedAt ? o.reversedAt.slice(5, 16) : ''}</span>` : `<button class="btn btn-sm btn-danger" data-rev="${o.id}">冲正</button>`}</td></tr>`).join('')}
        <tr style="background:#fafcfb;font-weight:600"><td colspan="4" class="right">本班合计（有效单）</td>
        <td class="num money">${fmtMoney(list.filter(o => !o.reversed).reduce((a, o) => a + o.amount, 0))}</td>
        <td class="num muted">${fmtMoney(list.filter(o => !o.reversed).reduce((a, o) => a + (o.materialCost || 0), 0))}</td>
        <td style="font-size:12px"><span class="muted">现</span>${fmtMoney(sum('cash'))} <span class="muted">卡</span>${fmtMoney(sum('card'))} <span class="muted">会</span>${fmtMoney(sum('member'))} <span class="muted">移</span>${fmtMoney(sum('mp'))}</td>
        <td class="num red">${fmtMoney(list.filter(o => !o.reversed).reduce((a, o) => a + o.techCommission, 0))}</td><td></td></tr>
      </tbody></table>` : emptyBox('本班暂无账单');
    el.querySelectorAll('[data-rev]').forEach(b => b.onclick = async () => {
      if (!(await confirmAsync('确定冲正该账单？<br>• 会员单将退回卡内余额<br>• 耗材库存按当时配方快照<b>回补一次</b><br>• 冲正后不能撤销、不能重复冲正', '确认冲正'))) return;
      try {
        const r = await api.post(`/api/orders/${b.dataset.rev}/reverse`, { reason: '门店端账单冲正' });
        toast(`冲正成功，库存已回补 ${fmtMoney(r.restoredMaterialCost || 0)}`); reloadList();
      } catch (e) { toast(e.message, 'error'); }
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
      const recipeHtml = q.recipeItems.length ? `
        <div style="margin-top:6px;border-top:1px dashed var(--line);padding-top:6px">
          <div class="muted" style="font-size:12px">标准耗用配方${q.recipeVersion ? `（v${q.recipeVersion} 快照）` : ''}：</div>
          ${q.recipeItems.map(it => `<div style="display:flex;justify-content:space-between;gap:8px;font-size:12.5px">
            <span>${esc(it.name)} × ${it.qty}${esc(it.unit)} ${it.enough ? '' : '<span class="tag tag-red" style="margin-left:4px">缺 ' + (it.stockQty < 0 ? it.stockQty : '存' + it.stockQty) + '</span>'}</span>
            <span class="muted">库存 ${it.stockQty}${esc(it.unit)} ｜ ${fmtMoney(it.qty * it.unitCost)}</span></div>`).join('')}
        </div>` : '<div class="muted" style="font-size:12px;margin-top:4px">该项目未配置耗材配方，开单不扣库存</div>';
      const shortHtml = q.short.length ? `
        <div style="margin-top:6px;padding:7px 9px;border-radius:8px;background:${q.shortPolicy === 'strict' ? 'var(--red-light)' : 'var(--gold-light)'};color:${q.shortPolicy === 'strict' ? 'var(--red)' : '#9a7622'};font-size:12.5px">
          ${q.shortPolicy === 'strict' ? '⛔ 总部策略：库存不足，禁止开单。缺口：' : '⚠️ 总部策略：允许负库存开单并预警。缺口：'}
          ${q.short.map(x => `${esc(x.name)} ${x.have}/${x.need}${esc(x.unit)}`).join('；')}
        </div>` : '';
      $('#quote', el).innerHTML = `
        挂牌价 <b>${fmtMoney(q.price)}</b>${q.discountRate < 1 ? ` ｜ 会员折扣 <b style="color:var(--gold)">${(q.discountRate * 10).toFixed(1)}折</b>` : ''}<br>
        实付金额 <b class="money" style="font-size:16px">${fmtMoney(q.amount)}</b> ｜ 技师提成 <b style="color:var(--red)">${fmtMoney(q.commission)}</b><br>
        耗材成本 <b>${fmtMoney(q.materialCost)}</b> ｜ 单笔毛利 <b style="color:var(--jade)">${fmtMoney(q.grossProfit)}</b>
        ${recipeHtml}${shortHtml}
        <span class="muted" style="font-size:12px">提成依据：${esc(q.basis)}</span>${memberId ? `<br><span class="muted">会员卡余额 ${fmtMoney(q.balance)}</span>` : ''}`;
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
        toast(`开单成功：${fmtMoney(r.amount)}（提成 ${fmtMoney(r.techCommission)}）`);
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
