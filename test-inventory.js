/* 耗材库存核算 · 后端业务流 API 测试（需先 npm start）
   覆盖：配方快照扣减、冲正仅回补一次、严格/负库存策略、调拨两阶段确认、途中取消、重复确认拦截、盘点/报损、总部分析 */
const base = 'http://localhost:3000';
let pass = 0;
async function api(method, path, body, token) {
  const opt = { method, headers: { 'Content-Type': 'application/json' } };
  if (token) opt.headers.Authorization = 'Bearer ' + token;
  if (body) opt.body = JSON.stringify(body);
  const res = await fetch(base + path, opt);
  const data = await res.json().catch(() => null);
  if (!res.ok) throw Object.assign(new Error(data?.error || res.status), { data, status: res.status });
  return data;
}
const ok = (cond, msg) => { if (!cond) throw new Error('断言失败：' + msg); console.log('  ✅', msg); pass++; };

(async () => {
  const hqLogin = await api('POST', '/api/login', { username: 'hq', password: '123456' });
  const hq = hqLogin.token;

  // 为隔离测试：新建两家门店
  const A = await api('POST', '/api/stores', { name: '库存测试甲店', city: '测试城' }, hq);
  const B = await api('POST', '/api/stores', { name: '库存测试乙店', city: '测试城' }, hq);
  const users = await import('node:fs');

  // 用总部账号代操作（hq 可指定 storeId 开单/出入库）
  console.log('\n[1] 总部维护耗材与配方');
  const mat = await api('POST', '/api/materials', { name: '测试精油X', unit: '瓶', category: '精油', standardCost: 10, safetyStock: 5 }, hq);
  ok(mat.id && mat.standardCost === 10, '新增耗材 ' + mat.id);
  const svc = await api('POST', '/api/services', { name: '测试足道Q', duration: 30, price: 100, category: '足疗' }, hq);
  // 配方：1 瓶 X + 2 条 P05
  const rp = await api('PUT', '/api/recipes/' + svc.id, { items: [{ materialId: mat.id, qty: 1 }, { materialId: 'P05', qty: 2 }] }, hq);
  ok(rp.version === 1 && Math.abs(rp.cost - 12.4) < 1e-6, `配方 v1 成本 ¥${rp.cost}（10 + 2*1.2）`);

  // 技师（甲店）
  const tech = await api('POST', '/api/technicians', { name: '库存测试技师', levelId: 'L2', storeId: A.id }, hq);

  console.log('\n[2] 严格策略 + 无库存 => 禁止开单');
  await api('PUT', '/api/inventory-config', { shortPolicy: 'strict', storePolicies: { [A.id]: 'strict', [B.id]: 'strict' } }, hq);
  await api('POST', '/api/shifts', { storeId: A.id, shiftCode: 'day' }, hq).catch(() => {});
  let blocked = false;
  try { await api('POST', '/api/orders', { storeId: A.id, serviceId: svc.id, techId: tech.id, payMethod: 'cash' }, hq); }
  catch (e) { blocked = /库存不足/.test(e.message); }
  ok(blocked, '库存不足时开单被策略拦截');

  console.log('\n[3] 采购入库后开单，按快照扣减');
  await api('POST', '/api/purchases', { storeId: A.id, supplier: '测试供应商', items: [{ materialId: mat.id, qty: 10, unitCost: 12 }, { materialId: 'P05', qty: 20, unitCost: 1 }] }, hq);
  const stock1 = (await api('GET', '/api/stock?storeId=' + A.id, null, hq)).find(r => r.materialId === mat.id);
  ok(Math.abs(stock1.qty - 10) < 1e-6 && Math.abs(stock1.avgCost - 12) < 1e-6, '入库 10 瓶，移动平均成本 ¥12');
  const quote = await api('POST', '/api/orders/quote', { storeId: A.id, serviceId: svc.id, techId: tech.id }, hq);
  ok(quote.short.length === 0 && Math.abs(quote.materialCost - 12.4) < 1e-6, `试算耗材成本 ¥${quote.materialCost}`);
  const order = await api('POST', '/api/orders', { storeId: A.id, serviceId: svc.id, techId: tech.id, payMethod: 'cash' }, hq);
  ok(order.recipeSnapshot && order.recipeSnapshot.version === 1, '账单带配方快照 v1');
  const stock2 = (await api('GET', '/api/stock?storeId=' + A.id, null, hq)).find(r => r.materialId === mat.id);
  ok(Math.abs(stock2.qty - 9) < 1e-6, '开单后库存 10 → 9');
  const consLedger = await api('GET', '/api/stock-ledger?storeId=' + A.id + '&type=consume', null, hq);
  ok(consLedger.length === 2, '产生两条耗用流水（X 与 P05）');

  console.log('\n[4] 总部事后改配方（v2、成本变化）不影响历史账单');
  await api('PUT', '/api/recipes/' + svc.id, { items: [{ materialId: mat.id, qty: 3 }, { materialId: 'P05', qty: 1 }] }, hq);
  const histOrder = (await api('GET', '/api/orders?storeId=' + A.id, null, hq)).find(o => o.id === order.id);
  ok(histOrder.recipeSnapshot.version === 1 && histOrder.materialCost === order.materialCost, '历史账单仍为 v1 快照与原成本');

  console.log('\n[5] 冲正：只回补一次，重复冲正被拒');
  const rev = await api('POST', `/api/orders/${order.id}/reverse`, { reason: '客人投诉免单' }, hq);
  ok(Math.abs(rev.restoredMaterialCost - 12.4) < 1e-6, `回补耗材成本 ¥${rev.restoredMaterialCost}`);
  const stock3 = (await api('GET', '/api/stock?storeId=' + A.id, null, hq)).find(r => r.materialId === mat.id);
  ok(Math.abs(stock3.qty - 10) < 1e-6, '冲正后库存 9 → 10');
  let doubleRev = false;
  try { await api('POST', `/api/orders/${order.id}/reverse`, {}, hq); } catch (e) { doubleRev = /已冲正|重复/.test(e.message); }
  ok(doubleRev, '重复冲正被拦截');
  const stock3b = (await api('GET', '/api/stock?storeId=' + A.id, null, hq)).find(r => r.materialId === mat.id);
  ok(Math.abs(stock3b.qty - 10) < 1e-6, '库存未被二次回补');
  const revertLedger = await api('GET', '/api/stock-ledger?storeId=' + A.id + '&type=consume_revert', null, hq);
  ok(revertLedger.length === 2, '冲正回补流水各一条');

  console.log('\n[6] 负库存策略：允许开单并产生负库存预警');
  await api('PUT', '/api/inventory-config', { shortPolicy: 'negative', storePolicies: { [A.id]: 'negative', [B.id]: 'negative' } }, hq);
  // 配方已改为 3 瓶/单；连续开 4 单：10 瓶 → -2
  for (let i = 0; i < 4; i++) await api('POST', '/api/orders', { storeId: A.id, serviceId: svc.id, techId: tech.id, payMethod: 'mp' }, hq);
  const stock4 = (await api('GET', '/api/stock?storeId=' + A.id, null, hq)).find(r => r.materialId === mat.id);
  ok(stock4.qty < 0, `负库存形成：现存 ${stock4.qty}`);
  const alerts = await api('GET', '/api/inventory-alerts?storeId=' + A.id, null, hq);
  ok(alerts.some(a => a.type === 'negative' && a.materialId === mat.id), '产生负库存预警');
  // 切回严格：负库存下继续开单应被拦
  await api('PUT', '/api/inventory-config', { shortPolicy: 'strict', storePolicies: { [A.id]: 'strict', [B.id]: 'strict' } }, hq);
  let blocked2 = false;
  try { await api('POST', '/api/orders', { storeId: A.id, serviceId: svc.id, techId: tech.id, payMethod: 'cash' }, hq); }
  catch (e) { blocked2 = /库存不足/.test(e.message); }
  ok(blocked2, '切回严格策略后负库存门店开单再次被拦');

  console.log('\n[7] 跨店调拨：发起→在途→确认入账；重复确认/途中取消');
  await api('PUT', '/api/inventory-config', { shortPolicy: 'negative', storePolicies: { [A.id]: 'negative', [B.id]: 'negative' } }, hq);
  await api('POST', '/api/purchases', { storeId: A.id, items: [{ materialId: 'P01', qty: 50, unitCost: 6 }] }, hq);
  const tBefore = (await api('GET', '/api/stock?storeId=' + A.id, null, hq)).find(r => r.materialId === 'P01');
  const tr = await api('POST', '/api/stock-transfers', { fromStoreId: A.id, toStoreId: B.id, materialId: 'P01', qty: 20, remark: '测试调拨' }, hq);
  ok(tr.status === 'in_transit', '发起后状态为在途');
  const tAfter = (await api('GET', '/api/stock?storeId=' + A.id, null, hq)).find(r => r.materialId === 'P01');
  ok(Math.abs(tAfter.qty - (tBefore.qty - 20)) < 1e-6 && tAfter.inTransit === 20, '调出方现存 -20、在途 +20');
  const bBefore = (await api('GET', '/api/stock?storeId=' + B.id, null, hq)).find(r => r.materialId === 'P01');
  const bBeforeQty = bBefore?.qty || 0;
  // 乙店门店账号不能由 hq 模拟；用 hq 确认（hq 不受门店限制）
  const done = await api('POST', `/api/stock-transfers/${tr.id}/confirm`, {}, hq);
  ok(done.status === 'done', '调入方确认后完成');
  const bAfter = (await api('GET', '/api/stock?storeId=' + B.id, null, hq)).find(r => r.materialId === 'P01');
  ok(Math.abs(bAfter.qty - (bBeforeQty + 20)) < 1e-6, '调入方入库 +20');
  const tAfter2 = (await api('GET', '/api/stock?storeId=' + A.id, null, hq)).find(r => r.materialId === 'P01');
  ok(tAfter2.inTransit === 0, '调出方在途清零');
  let dupConfirm = false;
  try { await api('POST', `/api/stock-transfers/${tr.id}/confirm`, {}, hq); } catch (e) { dupConfirm = /重复|已确认/.test(e.message); }
  ok(dupConfirm, '重复确认被拦截');

  // 途中取消：发起 → 取消 → 库存回补；不能再确认
  const tr2 = await api('POST', '/api/stock-transfers', { fromStoreId: A.id, toStoreId: B.id, materialId: 'P01', qty: 10 }, hq);
  const cBefore = (await api('GET', '/api/stock?storeId=' + A.id, null, hq)).find(r => r.materialId === 'P01');
  await api('POST', `/api/stock-transfers/${tr2.id}/cancel`, { reason: '对方临时不要了' }, hq);
  const cAfter = (await api('GET', '/api/stock?storeId=' + A.id, null, hq)).find(r => r.materialId === 'P01');
  ok(Math.abs(cAfter.qty - (cBefore.qty + 10)) < 1e-6 && cAfter.inTransit === 0, '途中取消后现存回补、在途清零');
  let confirmCanceled = false, doubleCancel = false;
  try { await api('POST', `/api/stock-transfers/${tr2.id}/confirm`, {}, hq); } catch (e) { confirmCanceled = /取消/.test(e.message); }
  try { await api('POST', `/api/stock-transfers/${tr2.id}/cancel`, {}, hq); } catch (e) { doubleCancel = /已取消/.test(e.message); }
  ok(confirmCanceled, '已取消的调拨不能确认');
  ok(doubleCancel, '不能重复取消');

  // 库存不足时发起调拨被拒（即使负库存策略）
  let overTransfer = false;
  try { await api('POST', '/api/stock-transfers', { fromStoreId: A.id, toStoreId: B.id, materialId: 'P01', qty: 99999 }, hq); }
  catch (e) { overTransfer = /不足/.test(e.message); }
  ok(overTransfer, '库存不足禁止发起调拨');
  let selfTransfer = false;
  try { await api('POST', '/api/stock-transfers', { fromStoreId: A.id, toStoreId: A.id, materialId: 'P01', qty: 1 }, hq); }
  catch (e) { selfTransfer = /相同/.test(e.message); }
  ok(selfTransfer, '不能调拨给本店');

  console.log('\n[8] 盘点与报损');
  const beforeSK = (await api('GET', '/api/stock?storeId=' + B.id, null, hq)).find(r => r.materialId === 'P01');
  const sk = await api('POST', '/api/stocktakes', { storeId: B.id, items: [{ materialId: 'P01', actualQty: beforeSK.qty - 3 }] }, hq);
  const skRow = sk.items.find(i => i.materialId === 'P01');
  ok(skRow.diffQty === -3, `盘亏 3（账面 ${skRow.bookQty} → 实存 ${skRow.actualQty}）`);
  const afterSK = (await api('GET', '/api/stock?storeId=' + B.id, null, hq)).find(r => r.materialId === 'P01');
  ok(Math.abs(afterSK.qty - (beforeSK.qty - 3)) < 1e-6, '盘点调整后账面=实存');
  const dm = await api('POST', '/api/damage-reports', { storeId: B.id, materialId: 'P01', qty: 2, reason: '包装破损' }, hq);
  ok(dm.amount > 0, `报损金额 ¥${dm.amount}`);

  console.log('\n[9] 流水账实一致');
  const rows = await api('GET', '/api/stock?storeId=' + B.id, null, hq);
  const ledger = await api('GET', '/api/stock-ledger?storeId=' + B.id, null, hq);
  const sum = {};
  ledger.forEach(l => { sum[l.materialId] = (sum[l.materialId] || 0) + l.qty; });
  let consistent = rows.every(r => Math.abs((sum[r.materialId] || 0) - r.qty) < 1e-6);
  ok(consistent, '乙店全部耗材：流水合计 = 现存量');

  console.log('\n[10] 总部分析接口');
  const ana = await api('GET', '/api/hq/inventory-analysis?days=45', null, hq);
  ok(ana.totals.revenue > 0 && ana.totals.materialCost > 0, `整体毛利 ¥${ana.totals.grossProfit}（耗材成本 ¥${ana.totals.materialCost}）`);
  ok(ana.projectProfit.some(p => p.materialCost > 0), '项目毛利表含耗材成本');
  ok(ana.storeLoss.length >= 2, '门店损耗率排行已生成');
  ok(ana.storeVariance.some(v => v.stocktakeCount > 0), '理论/实际盘点差异有数据');
  ok(ana.materialCosts.some(m => m.purchaseAmount > 0), '耗材成本分析有采购数据');

  console.log(`\n✅ 库存核算业务流全部通过（${pass} 条断言）`);
  void users;
})().catch(e => { console.error('❌', e.message); process.exit(1); });
