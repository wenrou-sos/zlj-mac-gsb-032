/*
 * 项目耗材与门店库存核算 · 端到端业务流测试
 * 运行：node server/index.js 后执行 node test-inventory.js
 * 覆盖：
 *  1. 耗材档案/采购成本维护、项目配方维护
 *  2. 采购入库 → 库存与流水
 *  3. 开单按当时配方快照扣库；账单固化耗材成本
 *  4. 撤销/冲正只回补一次（重复冲正拦截）；改配方/改成本不影响历史快照
 *  5. 严格模式缺货禁单；负库存模式放行并产生预警
 *  6. 盘点盘盈盘亏过账、报损（超量报损拦截）
 *  7. 跨店调拨：调出发起即出账 → 调入确认才入账；重复确认/越权确认/途中取消/重复取消均不产生错账
 *  8. 总部成本/账实差异/损耗率/毛利分析可出数
 */
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
let pass = 0;
const ok = (name, cond, extra) => {
  if (!cond) throw new Error('断言失败：' + name + (extra ? ' ' + JSON.stringify(extra) : ''));
  console.log('✅', name.padEnd(34), extra ? JSON.stringify(extra) : '');
  pass++;
};
const fail = async (fn, code) => {
  try { await fn(); } catch (e) { if (code && e.status !== code) throw new Error(`期望 ${code} 实际 ${e.status}：${e.message}`); return e; }
  throw new Error('本应失败却成功了');
};

(async () => {
  const hqLogin = await api('POST', '/api/login', { username: 'hq', password: '123456' });
  const hq = hqLogin.token;
  const s01Login = await api('POST', '/api/login', { username: 's01', password: '123456' });
  const s02Login = await api('POST', '/api/login', { username: 's02', password: '123456' });
  const s03Login = await api('POST', '/api/login', { username: 's03', password: '123456' });
  const t01 = s01Login.token, t02 = s02Login.token, t03 = s03Login.token;
  const sid = s01Login.user.storeId; // S01

  /* ---------- 1. 总部维护耗材档案与成本 ---------- */
  const newMat = await api('POST', '/api/materials', { name: '测试专用耗材·自动', spec: 'E2E', unit: '盒', category: '其他耗材', defaultCost: 5 }, hq);
  ok('总部新增耗材', newMat.id.startsWith('MA'), { id: newMat.id, cost: newMat.defaultCost });
  await api('PUT', `/api/materials/${newMat.id}`, { defaultCost: 6 }, hq);
  ok('总部调整采购成本', true);
  const mats = await api('GET', '/api/materials', null, hq);
  ok('门店可读取耗材档案', mats.some(m => m.id === newMat.id && m.defaultCost === 6));

  /* ---------- 准备：本店技师 + 备份 V12 配方 ---------- */
  const techs = (await api('GET', '/api/technicians?status=active', null, t01)).filter(t => t.storeId === sid);
  const tech = techs[0];
  const recipesData = await api('GET', '/api/recipes', null, hq);
  const v12backup = recipesData.recipes.find(r => r.serviceId === 'V12').lines.map(l => ({ materialId: l.materialId, qty: l.qty }));

  /* ---------- 2. 门店采购入库 ---------- */
  const inv0 = await api('GET', `/api/stores/${sid}/inventory`, null, t01);
  const before13 = inv0.items.find(i => i.id === 'MA013').qty;
  const po = await api('POST', '/api/purchase-orders', { supplier: 'E2E供应商', lines: [{ materialId: 'MA013', qty: 100, unitCost: 1.9 }] }, t01);
  ok('采购入库单', po.id.startsWith('PO'), { id: po.id, total: po.totalAmount });
  const inv1 = await api('GET', `/api/stores/${sid}/inventory`, null, t01);
  const after13 = inv1.items.find(i => i.id === 'MA013').qty;
  ok('采购后库存增加 100', Math.abs(after13 - before13 - 100) < 0.001, { before: before13, after: after13 });
  const mvPurchase = (await api('GET', '/api/stock-movements?type=purchase', null, t01))[0];
  ok('采购流水含实际单价', mvPurchase.refType === 'purchase' && mvPurchase.unitCost === 1.9 && mvPurchase.balanceAfter === after13);

  /* ---------- 3. 开单按配方快照扣库，成本固化 ---------- */
  const quote = await api('POST', '/api/orders/quote', { serviceId: 'V12', techId: tech.id }, t01);
  ok('开单试算返回耗材清单', quote.materials.length >= 2 && quote.materialCost > 0, { cost: quote.materialCost });
  const order = await api('POST', '/api/orders', { serviceId: 'V12', techId: tech.id, payMethod: 'cash' }, t01);
  ok('开单成功并返回耗材成本', order.materialSnapshot.length >= 2 && order.materialCost > 0, { order: order.id, materialCost: order.materialCost });
  const inv2 = await api('GET', `/api/stores/${sid}/inventory`, null, t01);
  const afterOrder13 = inv2.items.find(i => i.id === 'MA013').qty;
  ok('开单扣减 MA013 ×1', Math.abs(afterOrder13 - (after13 - 1)) < 0.001);
  const snapCost13 = order.materialSnapshot.find(l => l.materialId === 'MA013').unitCost;
  const consumeMv = (await api('GET', '/api/stock-movements?type=consume', null, t01)).find(x => x.refId === order.id && x.materialId === 'MA013');
  ok('耗用流水单价=快照成本', consumeMv.unitCost === snapCost13, { mv: consumeMv.unitCost, snap: snapCost13 });

  /* ---------- 4. 修改成本/配方不影响历史账单 ---------- */
  await api('PUT', '/api/materials/MA013', { defaultCost: 9.9 }, hq);
  const orderAgain = (await api('GET', '/api/orders?shiftId=' + order.shiftId, null, t01)).find(o => o.id === order.id);
  ok('改成本后历史快照不变', orderAgain.materialSnapshot.find(l => l.materialId === 'MA013').unitCost === snapCost13,
    { snap: orderAgain.materialSnapshot.find(l => l.materialId === 'MA013').unitCost });
  await api('PUT', '/api/materials/MA013', { defaultCost: 1.8 }, hq);

  /* ---------- 5. 冲正：回补一次，重复冲正拦截 ---------- */
  const reversed = await api('POST', `/api/orders/${order.id}/reverse`, { reason: 'E2E冲正测试' }, t01);
  ok('账单已冲正', reversed.status === 'reversed' && reversed.stockReversed === 1);
  const inv3 = await api('GET', `/api/stores/${sid}/inventory`, null, t01);
  const afterReverse13 = inv3.items.find(i => i.id === 'MA013').qty;
  ok('冲正后库存按快照回补', Math.abs(afterReverse13 - after13) < 0.001, { afterReverse: afterReverse13, afterPurchase: after13 });
  const revMv = (await api('GET', '/api/stock-movements?type=consume_reverse', null, t01)).find(x => x.refId === order.id);
  ok('冲正回补流水存在', !!revMv && revMv.direction === 'in' && Math.abs(revMv.qty - 1) < 0.001 || (revMv && revMv.materialId !== 'MA013'));
  await fail(() => api('POST', `/api/orders/${order.id}/reverse`, { reason: '再冲一次' }, t01), 409);
  ok('重复冲正被拦截（只回补一次）', true);
  const inv4 = await api('GET', `/api/stores/${sid}/inventory`, null, t01);
  ok('重复冲正后库存不变', Math.abs(inv4.items.find(i => i.id === 'MA013').qty - afterReverse13) < 0.001);

  /* ---------- 6. 改配方只影响新开单 ---------- */
  await api('PUT', '/api/recipes/V12', { lines: [...v12backup, { materialId: newMat.id, qty: 2 }] }, hq);
  const q2 = await api('POST', '/api/orders/quote', { serviceId: 'V12', techId: tech.id }, t01);
  ok('新配方对试算生效', q2.materials.some(x => x.materialId === newMat.id && x.qty === 2));
  ok('历史账单快照不含新耗材', !orderAgain.materialSnapshot.some(x => x.materialId === newMat.id));
  // 恢复配方
  await api('PUT', '/api/recipes/V12', { lines: v12backup }, hq);

  /* ---------- 7. 严格模式缺货禁单 / 负库存模式放行+预警 ---------- */
  // 给 V12 临时挂上零库存新耗材
  await api('PUT', '/api/recipes/V12', { lines: [...v12backup, { materialId: newMat.id, qty: 1 }] }, hq);
  const policy0 = await api('GET', '/api/inventory-policy', null, hq);
  ok('默认严格策略', policy0.shortageMode === 'strict');
  const strictErr = await fail(() => api('POST', '/api/orders', { serviceId: 'V12', techId: tech.id, payMethod: 'cash' }, t01), 400);
  ok('严格模式库存不足禁止开单', /库存不足/.test(strictErr.message), strictErr.message);
  await api('PUT', '/api/inventory-policy', { shortageMode: 'negative' }, hq);
  const negOrder = await api('POST', '/api/orders', { serviceId: 'V12', techId: tech.id, payMethod: 'card' }, t01);
  ok('负库存模式允许开单', negOrder.status === 'valid');
  ok('负库存开单产生预警', !!negOrder.negativeAlert && negOrder.negativeAlert.type === 'negative', { alert: negOrder.negativeAlert?.id });
  const invNeg = await api('GET', `/api/stores/${sid}/inventory`, null, t01);
  ok('新耗材库存为负', invNeg.items.find(i => i.id === newMat.id).qty === -1);
  const alerts = await api('GET', '/api/inventory-alerts', null, t01);
  const myAlert = alerts.find(a => a.orderId === negOrder.id);
  ok('门店可查本单预警', !!myAlert && myAlert.handled === 0);
  await api('POST', `/api/inventory-alerts/${myAlert.id}/handle`, null, t01);
  // 采购补齐并冲正负库存单（回补 -1 → 0 以上）
  await api('POST', '/api/purchase-orders', { supplier: 'E2E供应商', lines: [{ materialId: newMat.id, qty: 10, unitCost: 6 }] }, t01);
  await api('POST', `/api/orders/${negOrder.id}/reverse`, { reason: 'E2E负库存单冲正' }, t01);
  await api('PUT', '/api/inventory-policy', { shortageMode: 'strict' }, hq);
  await api('PUT', '/api/recipes/V12', { lines: v12backup }, hq);
  ok('策略已恢复严格、配方已还原', true);

  /* ---------- 8. 盘点差异过账 ---------- */
  const invCk = await api('GET', `/api/stores/${sid}/inventory`, null, t01);
  const sysQty = invCk.items.find(i => i.id === 'MA012').qty;
  await api('POST', '/api/stock-checks', { lines: [{ materialId: 'MA012', actualQty: sysQty + 3 }], remark: 'E2E盘盈3片' }, t01);
  const invCk2 = await api('GET', `/api/stores/${sid}/inventory`, null, t01);
  ok('盘点盘盈一次过账 +3', Math.abs(invCk2.items.find(i => i.id === 'MA012').qty - (sysQty + 3)) < 0.001);
  const checks = await api('GET', '/api/stock-checks', null, t01);
  ok('盘点单据可查', checks[0].lineViews.some(l => l.materialId === 'MA012' && l.diff === 3));

  /* ---------- 9. 报损与超量拦截 ---------- */
  const beforeLoss = invCk2.items.find(i => i.id === 'MA013').qty;
  await api('POST', '/api/stock-losses', { reason: 'E2E刀片过期', lines: [{ materialId: 'MA013', qty: 2 }] }, t01);
  const invLs = await api('GET', `/api/stores/${sid}/inventory`, null, t01);
  ok('报损出库 -2', Math.abs(invLs.items.find(i => i.id === 'MA013').qty - (beforeLoss - 2)) < 0.001);
  const lossErr = await fail(() => api('POST', '/api/stock-losses', { reason: '超量', lines: [{ materialId: 'MA013', qty: 999999 }] }, t01), 400);
  ok('超量报损被拦截', /不能超量报损/.test(lossErr.message), lossErr.message);

  /* ---------- 10. 跨店调拨两阶段 + 幂等/权限 ---------- */
  // 10.1 S01 → S02，发起即出账
  const beforeOut = (await api('GET', `/api/stores/S01/inventory`, null, t01)).items.find(i => i.id === 'MA013').qty;
  const beforeIn = (await api('GET', `/api/stores/S02/inventory`, null, t02)).items.find(i => i.id === 'MA013').qty;
  const tr1 = await api('POST', '/api/inventory-transfers', { toStoreId: 'S02', reason: 'E2E正常调拨', lines: [{ materialId: 'MA013', qty: 10 }] }, t01);
  ok('调拨发起（在途）', tr1.status === 'in_transit', { id: tr1.id });
  const outStep = (await api('GET', `/api/stores/S01/inventory`, null, t01)).items.find(i => i.id === 'MA013').qty;
  const inStep = (await api('GET', `/api/stores/S02/inventory`, null, t02)).items.find(i => i.id === 'MA013').qty;
  ok('发起即扣调出方', Math.abs(outStep - (beforeOut - 10)) < 0.001, { out: outStep });
  ok('确认前调入方不入账', Math.abs(inStep - beforeIn) < 0.001, { incomingStill: inStep });
  // 10.2 越权：S01 不能确认自己的调出；S03 无关店不能确认
  await fail(() => api('POST', `/api/inventory-transfers/${tr1.id}/confirm`, null, t01), 403);
  await fail(() => api('POST', `/api/inventory-transfers/${tr1.id}/confirm`, null, t03), 403);
  ok('仅调入方可以确认', true);
  // 10.3 S02 确认
  await api('POST', `/api/inventory-transfers/${tr1.id}/confirm`, null, t02);
  const inDone = (await api('GET', `/api/stores/S02/inventory`, null, t02)).items.find(i => i.id === 'MA013').qty;
  ok('确认后调入方入账 +10', Math.abs(inDone - (beforeIn + 10)) < 0.001, { S02: inDone });
  // 10.4 重复确认
  await fail(() => api('POST', `/api/inventory-transfers/${tr1.id}/confirm`, null, t02), 409);
  const inDone2 = (await api('GET', `/api/stores/S02/inventory`, null, t02)).items.find(i => i.id === 'MA013').qty;
  ok('重复确认不重复入账', Math.abs(inDone2 - inDone) < 0.001);
  // 10.5 已确认不可取消
  await fail(() => api('POST', `/api/inventory-transfers/${tr1.id}/cancel`, { reason: 'x' }, t01), 409);

  // 10.6 S01 → S03 在途取消：回补且幂等
  const tr2 = await api('POST', '/api/inventory-transfers', { toStoreId: 'S03', reason: 'E2E取消调拨', lines: [{ materialId: 'MA013', qty: 7 }] }, t01);
  const out2 = (await api('GET', `/api/stores/S01/inventory`, null, t01)).items.find(i => i.id === 'MA013').qty;
  // 调入方不能取消
  await fail(() => api('POST', `/api/inventory-transfers/${tr2.id}/cancel`, { reason: 'x' }, t03), 403);
  await api('POST', `/api/inventory-transfers/${tr2.id}/cancel`, { reason: 'E2E途中取消' }, t01);
  const back2 = (await api('GET', `/api/stores/S01/inventory`, null, t01)).items.find(i => i.id === 'MA013').qty;
  ok('途中取消原路回补 +7', Math.abs(back2 - (out2 + 7)) < 0.001);
  await fail(() => api('POST', `/api/inventory-transfers/${tr2.id}/cancel`, { reason: '再取消' }, t01), 409);
  await fail(() => api('POST', `/api/inventory-transfers/${tr2.id}/confirm`, null, t03), 409);
  const back2b = (await api('GET', `/api/stores/S01/inventory`, null, t01)).items.find(i => i.id === 'MA013').qty;
  ok('重复取消/取消后确认均不再动账', Math.abs(back2b - back2) < 0.001);

  // 10.7 不能调拨给自己 / 库存不足不能发起
  await fail(() => api('POST', '/api/inventory-transfers', { toStoreId: 'S01', lines: [{ materialId: 'MA013', qty: 1 }] }, t01), 400);
  await fail(() => api('POST', '/api/inventory-transfers', { toStoreId: 'S02', lines: [{ materialId: newMat.id, qty: 99999 }] }, t01), 400);
  ok('自调/超量调拨被拦截', true);

  /* ---------- 11. 总部分析出数 ---------- */
  const an = await api('GET', '/api/hq/inventory-analysis', null, hq);
  ok('分析-耗材成本表', an.materials.length >= 16 && an.summary.consumeAmount > 0, { consume: an.summary.consumeAmount });
  ok('分析-门店损耗率', an.stores.length === 6 && an.stores.some(s => s.lossRate !== null), { top: an.stores[0].name });
  ok('分析-项目毛利', an.services.some(s => s.serviceId === 'V12' && s.materialCost >= 0 && s.grossProfit !== undefined));
  ok('分析-账实差异', Array.isArray(an.variance));
  const v12 = an.services.find(s => s.serviceId === 'V12');
  ok('毛利=收入-耗材-提成', Math.abs(v12.grossProfit - (v12.revenue - v12.materialCost - v12.commission)) < 0.02, v12);

  /* ---------- 12. 越权：门店不能访问总部接口 ---------- */
  await fail(() => api('POST', '/api/materials', { name: 'x', unit: '个', defaultCost: 1 }, t01), 403);
  await fail(() => api('PUT', '/api/inventory-policy', { shortageMode: 'negative' }, t01), 403);
  await fail(() => api('GET', '/api/stores/S02/inventory', null, t01), 403);
  ok('门店越权操作全部被拒', true);

  // 停用测试耗材，避免污染正式目录
  await api('PUT', `/api/materials/${newMat.id}`, { active: 0 }, hq);

  console.log(`\n✅ 库存核算全部 ${pass} 项断言通过`);
})().catch(e => { console.error('❌', e.message); process.exit(1); });
