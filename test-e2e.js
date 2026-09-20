const base = 'http://localhost:3000';
async function api(method, path, body, token) {
  const opt = { method, headers: { 'Content-Type': 'application/json' } };
  if (token) opt.headers.Authorization = 'Bearer ' + token;
  if (body) opt.body = JSON.stringify(body);
  const res = await fetch(base + path, opt);
  const data = await res.json().catch(() => null);
  if (!res.ok) throw Object.assign(new Error(data?.error || res.status), { data, status: res.status });
  return data;
}
const log = (k, v) => console.log(k.padEnd(14), typeof v === 'object' ? JSON.stringify(v) : v);
(async () => {
  const hq = (await api('POST', '/api/login', { username: 'hq', password: '123456' })).token;
  const s = await api('POST', '/api/login', { username: 's05', password: '123456' });
  const st = s.token, sid = s.user.storeId;

  // 总部操作
  const svc = await api('POST', '/api/services', { name: '生姜足道', duration: 70, price: 158, category: '足疗' }, hq);
  log('总部新增项目', `${svc.id} ¥${svc.price}`);
  const rule = await api('POST', '/api/commission-rules', { serviceId: svc.id, levelId: 'L2', type: 'fixed', value: 45, name: '生姜足道中级固定提成' }, hq);
  log('总部新增提成规则', rule.id);

  // 门店：开卡充值
  const mem = await api('POST', '/api/members', { name: '测试会员', phone: '13900009999', initAmount: 3000, payMethod: 'card' }, st);
  log('开卡', { id: mem.id, level: mem.levelName, balance: mem.balance });
  const found = (await api('GET', '/api/members?q=13900009999', null, st))[0];
  const rc = await api('POST', `/api/members/${found.id}/recharge`, { amount: 500, payMethod: 'cash' }, st);
  log('再充500', { balance: rc.member.balance });

  // 入职
  const tech = await api('POST', '/api/technicians', { name: '测试技师', phone: '13700009999', levelId: 'L2', specialties: ['V01', svc.id], trainings: [{ topic: '岗前培训', score: 92, cert: '高级证' }] }, st);
  log('入职登记', { id: tech.id, store: tech.storeName, specs: tech.specialties.length });

  // 散客单 —— 应命中专项固定提成 45
  const o1 = await api('POST', '/api/orders', { serviceId: svc.id, techId: tech.id, payMethod: 'cash' }, st);
  log('散客单', { amount: o1.amount, commission: o1.techCommission, basis: o1.commissionBasis });

  // 会员单
  const o2 = await api('POST', '/api/orders', { serviceId: 'V01', techId: tech.id, memberId: mem.id }, st);
  log('会员单', { amount: o2.amount, pay: o2.payMethod, commission: o2.techCommission });

  // 业绩
  const perf = await api('GET', `/api/stores/${sid}/tech-performance?from=2026-09-01&to=2026-09-19`, null, st);
  const mine = perf.rows.find(r => r.techId === tech.id);
  log('本店技师业绩', { orders: mine.orderCount, commission: mine.commission });

  // 调动
  const tr = await api('POST', `/api/technicians/${tech.id}/transfer`, { toStoreId: 'S06', reason: '测试调动' }, st);
  log('调动到', tr.tech.storeName);
  try {
    await api('POST', '/api/orders', { serviceId: 'V01', techId: tech.id, payMethod: 'cash' }, st);
    console.log('❌ 调走后竟然还能录单');
  } catch (e) { log('跨店保护生效', e.message); }

  // 交班签字
  const open = (await api('GET', '/api/shifts?status=open', null, st)).find(x => x.storeId === sid);
  const hd = await api('POST', `/api/shifts/${open.id}/close`, { closer: '夜班小李', openerSign: 'data:image/png;a', closerSign: 'data:image/png;b' }, st);
  log('交班完成', { id: hd.id, count: hd.serveCount, revenue: hd.revenue, cash: hd.cash, member: hd.member });
  const detail = await api('GET', `/api/handovers/${hd.id}`, null, st);
  log('交班明细账单数', detail.orders.length);
  try {
    await api('POST', `/api/shifts/${open.id}/close`, { closer: 'x', openerSign: 'a', closerSign: 'b' }, st);
    console.log('❌ 重复交班未被拦截');
  } catch (e) { log('重复交班拦截', e.message); }

  // 总部看板反映新数据
  const dash = await api('GET', '/api/hq/dashboard?days=45', null, hq);
  log('总部看板', { revenue: dash.kpi.totalRevenue, orders: dash.kpi.totalOrders, stores: dash.storeRank.length });

  console.log('\n✅ 全部业务流程通过');
})().catch(e => { console.error('❌', e.message); process.exit(1); });
