/**
 * 悦足堂 · HTTP 服务（零依赖）
 * 提供 REST API 与静态站点。
 * Handler 统一签名: (req, res, p, user, m, body)，其中 p={ query }，m=路径正则匹配
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const crypto = require('crypto');
const { load, save, nowLocal, fmtDate } = require('./db');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const db = load();
syncCounters();

/* ---------------- 工具 ---------------- */
function json(res, data, code = 200) {
  const body = JSON.stringify(data);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}
function fail(res, msg, code = 400) { json(res, { error: msg }, code); }
function readBody(req) {
  return new Promise((resolve) => {
    let buf = '';
    req.on('data', c => { buf += c; if (buf.length > 2e6) req.destroy(); });
    req.on('end', () => {
      if (!buf) return resolve({});
      try { resolve(JSON.parse(buf)); } catch { resolve({}); }
    });
  });
}
function nextId(key, prefix, len = 4) {
  db.counters[key] = (db.counters[key] || 0) + 1;
  return `${prefix}${String(db.counters[key]).padStart(len, '0')}`;
}
/* 启动时根据已有数据校准各序列计数器，避免新建 ID 与种子数据冲突 */
function syncCounters() {
  const tableKey = {
    member: 'members', recharge: 'recharges', tech: 'technicians',
    training: 'trainings', transfer: 'transfers',
    shift: 'shifts', handover: 'handovers',
    order: 'orders', commissionRule: 'commissionRules', user: 'users',
    purchase: 'purchases', stocktake: 'stocktakes', damage: 'damageReports',
    stockTransfer: 'stockTransfers', inventoryAlert: 'inventoryAlerts',
  };
  for (const [key, tableName] of Object.entries(tableKey)) {
    let max = db.counters[key] || 0;
    for (const row of db[tableName] || []) {
      const num = Number(String(row.id || '').replace(/^\D+/, ''));
      if (Number.isFinite(num) && num > max) max = num;
    }
    db.counters[key] = max;
  }
}
function genToken() { return crypto.randomBytes(24).toString('hex'); }
function todayStr() { return fmtDate(new Date()); }
function daysAgoStr(n) { const d = new Date(); d.setDate(d.getDate() - n); return fmtDate(d); }

function enrichTech(t) {
  const level = db.techLevels.find(l => l.id === t.levelId);
  const store = db.stores.find(s => s.id === t.storeId);
  const specialties = db.techSpecialties
    .filter(x => x.techId === t.id)
    .map(x => db.services.find(v => v.id === x.serviceId))
    .filter(Boolean);
  return { ...t, levelName: level?.name, commissionRate: level?.commissionRate, storeName: store?.name, city: store?.city, specialties };
}
function memberLevel(m) { return db.memberLevels.find(l => l.id === m.levelId); }
function enrichMember(m) {
  const store = db.stores.find(s => s.id === m.storeId);
  const lv = memberLevel(m);
  return { ...m, levelName: lv?.name, discount: lv?.discount, storeName: store?.name };
}
function payLabel(p) { return { cash: '现金', card: '刷卡', member: '会员卡', mp: '移动支付' }[p] || p; }
function orderView(o) {
  return {
    ...o,
    serviceName: db.services.find(v => v.id === o.serviceId)?.name,
    techName: db.technicians.find(t => t.id === o.techId)?.name,
    memberName: o.memberId ? db.members.find(x => x.id === o.memberId)?.name : null,
    storeName: db.stores.find(s => s.id === o.storeId)?.name,
    payMethodName: payLabel(o.payMethod),
    reversedLabel: o.reversed ? `已冲正${o.reversedAt ? ' · ' + o.reversedAt.slice(5, 16) : ''}` : '',
  };
}
/* 有效账单（未冲正），营收/交班/看板口径统一 */
function effectiveOrders(list) { return list.filter(o => !o.reversed); }

/* 提成：规则（项目+等级，固定金额/比例）> 等级标准比例 */
function calcCommission(serviceId, levelId, amount) {
  const rule = db.commissionRules.find(r => r.active && r.serviceId === serviceId && r.levelId === levelId);
  const level = db.techLevels.find(l => l.id === levelId);
  if (rule && rule.type === 'fixed') return { value: rule.value, basis: `规则「${rule.name}」固定提成` };
  if (rule && rule.type === 'rate') return { value: Math.round(amount * rule.value), basis: `规则「${rule.name}」比例 ${(rule.value * 100).toFixed(0)}%` };
  return { value: Math.round(amount * level.commissionRate), basis: `${level.name}标准比例 ${(level.commissionRate * 100).toFixed(0)}%` };
}
function applyMemberLevel(m) {
  m.levelId = [...db.memberLevels].reverse().find(l => m.totalRecharge >= l.threshold).id;
}

/* ---------------- 耗材库存核算 ---------------- */
const r2n = (n) => Math.round(n * 100) / 100;
const r4n = (n) => Math.round(n * 10000) / 10000;
function materialOf(id) { return db.materials.find(x => x.id === id); }
function activeRecipeOf(serviceId) { return db.recipes.find(r => r.serviceId === serviceId); }
/* 开单时点的配方快照：后续总部改配方/调价均不影响历史账单 */
function recipeSnapshotOf(serviceId) {
  const rp = activeRecipeOf(serviceId);
  if (!rp) return null;
  return {
    version: rp.version,
    items: rp.items.map(it => {
      const m = materialOf(it.materialId);
      return { materialId: it.materialId, name: m?.name || it.materialId, unit: m?.unit || '', qty: it.qty, unitCost: it.unitCost };
    }),
  };
}
function shortPolicy(storeId) { return db.inventoryConfig?.storePolicies?.[storeId] || db.inventoryConfig?.shortPolicy || 'strict'; }
function stockRec(storeId, materialId) {
  let rec = db.stockRecords.find(r => r.storeId === storeId && r.materialId === materialId);
  if (!rec) {
    rec = { storeId, materialId, qty: 0, inTransit: 0, avgCost: materialOf(materialId)?.standardCost || 0 };
    db.stockRecords.push(rec);
  }
  return rec;
}
function stockIn(rec, qty, cost) {
  const oldQty = rec.qty, oldAvg = rec.avgCost ?? cost;
  if (oldQty > 0 && qty > 0) rec.avgCost = r2n((oldQty * oldAvg + qty * cost) / (oldQty + qty));
  else if (qty > 0) rec.avgCost = cost;
  rec.qty = r4n(oldQty + qty);
}
function stockOut(rec, qty) { rec.qty = r4n(rec.qty - qty); }
function pushLedger(e) {
  const rec = stockRec(e.storeId, e.materialId);
  db.stockLedger.push({
    id: nextId('stockLedger', 'SL', 8),
    time: e.time || nowLocal(), storeId: e.storeId, materialId: e.materialId,
    type: e.type, qty: e.qty, unitCost: e.unitCost ?? rec.avgCost ?? 0,
    balanceAfter: rec.qty, refType: e.refType || null, refId: e.refId || null,
    orderId: e.orderId, serviceId: e.serviceId, toStoreId: e.toStoreId, fromStoreId: e.fromStoreId,
    remark: e.remark || '',
  });
}
/* 预警：负库存 / 低于安全库存，同店同耗材同类未处理不重复产生；恢复后自动解除 */
function refreshAlerts(storeId, materialId) {
  const rec = stockRec(storeId, materialId), m = materialOf(materialId);
  db.inventoryAlerts.filter(a => a.storeId === storeId && a.materialId === materialId && !a.resolved).forEach(a => {
    if ((a.type === 'negative' && rec.qty >= 0) || (a.type === 'low_stock' && rec.qty >= m.safetyStock)) a.resolved = 1;
  });
  if (rec.qty < 0) {
    if (!db.inventoryAlerts.some(a => a.storeId === storeId && a.materialId === materialId && a.type === 'negative' && !a.resolved))
      db.inventoryAlerts.push({ id: nextId('inventoryAlert', 'IA', 5), storeId, materialId, type: 'negative', qty: rec.qty, createdAt: nowLocal(), resolved: 0, remark: '开单扣减导致负库存' });
  } else if (rec.qty < m.safetyStock) {
    if (!db.inventoryAlerts.some(a => a.storeId === storeId && a.materialId === materialId && a.type === 'low_stock' && !a.resolved))
      db.inventoryAlerts.push({ id: nextId('inventoryAlert', 'IA', 5), storeId, materialId, type: 'low_stock', qty: rec.qty, safetyStock: m.safetyStock, createdAt: nowLocal(), resolved: 0, remark: '库存低于安全库存' });
  }
}
/* 开单前校验库存：返回缺失明细；strict 策略下前端/开单接口据此拦截 */
function shortItems(storeId, snapshot) {
  const miss = [];
  for (const it of snapshot.items) {
    const rec = stockRec(storeId, it.materialId);
    if (rec.qty < it.qty - 1e-9) miss.push({ materialId: it.materialId, name: it.name, unit: it.unit, need: it.qty, have: rec.qty, gap: r4n(it.qty - rec.qty) });
  }
  return miss;
}
/* 开单成功后按快照扣减（允许负库存时继续扣并预警） */
function consumeForOrder(order, snapshot, time) {
  let materialCost = 0;
  snapshot.items.forEach(it => {
    const rec = stockRec(order.storeId, it.materialId);
    stockOut(rec, it.qty);
    materialCost += it.qty * it.unitCost;
    pushLedger({ time: time || order.createdAt, storeId: order.storeId, materialId: it.materialId, type: 'consume', qty: -it.qty, unitCost: it.unitCost, refType: 'order', refId: order.id, orderId: order.id, serviceId: order.serviceId, remark: `${order.orderNo} 服务耗用` });
    refreshAlerts(order.storeId, it.materialId);
  });
  return r2n(materialCost);
}
/* 冲正回补：幂等保护由调用方（order.reversed）保证，仅回补一次 */
function revertOrderStock(order, time) {
  const snapshot = order.recipeSnapshot;
  if (!snapshot) return 0;
  let materialCost = 0;
  snapshot.items.forEach(it => {
    const rec = stockRec(order.storeId, it.materialId);
    stockIn(rec, it.qty, it.unitCost);
    materialCost += it.qty * it.unitCost;
    pushLedger({ time, storeId: order.storeId, materialId: it.materialId, type: 'consume_revert', qty: it.qty, unitCost: it.unitCost, refType: 'order', refId: order.id, orderId: order.id, serviceId: order.serviceId, remark: `${order.orderNo} 冲正回补（仅一次）` });
    refreshAlerts(order.storeId, it.materialId);
  });
  return r2n(materialCost);
}
function materialView(m) {
  return { ...m, recipeCount: db.recipes.filter(rp => rp.items.some(it => it.materialId === m.id)).length };
}
function stockRowView(rec) {
  const m = materialOf(rec.materialId);
  return {
    ...rec,
    materialName: m?.name, spec: m?.spec, unit: m?.unit, category: m?.category,
    standardCost: m?.standardCost, safetyStock: m?.safetyStock,
    stockValue: r2n(rec.qty * (rec.avgCost ?? m?.standardCost ?? 0)),
    status: rec.qty < 0 ? 'negative' : rec.qty < m.safetyStock ? 'low' : 'ok',
  };
}

/* ---------------- 鉴权 ---------------- */
const sessions = new Map();
function auth(req) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  return sessions.get(token) || null;
}
function requireAuth(req, res) {
  const u = auth(req);
  if (!u) { fail(res, '未登录或登录已过期', 401); return null; }
  return u;
}

/* ---------------- 聚合统计 ---------------- */
function hqDashboard(days) {
  const from = daysAgoStr(days - 1), to = todayStr();
  const orders = effectiveOrders(db.orders.filter(o => o.businessDate >= from && o.businessDate <= to));
  const byStore = Object.fromEntries(db.stores.map(s => [s.id, 0]));
  orders.forEach(o => { byStore[o.storeId] = (byStore[o.storeId] || 0) + o.amount; });
  const totalRevenue = orders.reduce((a, o) => a + o.amount, 0);
  const totalCommission = orders.reduce((a, o) => a + o.techCommission, 0);
  const recharges = db.recharges.filter(r => r.createdAt.slice(0, 10) >= from);
  const rechargeTotal = recharges.reduce((a, r) => a + r.amount, 0);
  const rechargeBonus = recharges.reduce((a, r) => a + (r.bonus || 0), 0);

  const storeRank = db.stores.map(s => ({
    storeId: s.id, name: s.name, city: s.city,
    revenue: byStore[s.id] || 0,
    orders: orders.filter(o => o.storeId === s.id).length,
  })).sort((a, b) => b.revenue - a.revenue);

  const catMap = {};
  orders.forEach(o => {
    const v = db.services.find(x => x.id === o.serviceId);
    const key = v?.category || '其他';
    if (!catMap[key]) catMap[key] = { category: key, revenue: 0, count: 0 };
    catMap[key].revenue += o.amount; catMap[key].count += 1;
  });
  const catShare = Object.values(catMap).sort((a, b) => b.revenue - a.revenue);

  const svcMap = {};
  orders.forEach(o => {
    if (!svcMap[o.serviceId]) svcMap[o.serviceId] = { serviceId: o.serviceId, name: '', revenue: 0, count: 0 };
    const row = svcMap[o.serviceId];
    row.name = db.services.find(v => v.id === o.serviceId)?.name || o.serviceId;
    row.revenue += o.amount; row.count += 1;
  });
  const serviceShare = Object.values(svcMap).sort((a, b) => b.revenue - a.revenue);

  const trend = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = daysAgoStr(i);
    trend.push({ date: d, revenue: db.orders.filter(o => o.businessDate === d).reduce((a, o) => a + o.amount, 0) });
  }

  const memberBalances = db.members.reduce((a, m) => a + m.balance, 0);
  return {
    range: { from, to, days },
    kpi: {
      totalRevenue, totalOrders: orders.length, avgTicket: orders.length ? Math.round(totalRevenue / orders.length) : 0,
      rechargeTotal, rechargeBonus, memberCount: db.members.length, memberBalances, totalCommission,
      storeCount: db.stores.length, activeTechCount: db.technicians.filter(t => t.status === 'active').length,
    },
    storeRank, catShare, serviceShare, trend,
  };
}

function shiftView(shift) {
  if (!shift) return null;
  const so = effectiveOrders(db.orders.filter(o => o.shiftId === shift.id));
  return {
    ...shift,
    serveCount: so.length,
    revenue: so.reduce((a, o) => a + o.amount, 0),
    cash: so.filter(o => o.payMethod === 'cash').reduce((a, o) => a + o.amount, 0),
    card: so.filter(o => o.payMethod === 'card').reduce((a, o) => a + o.amount, 0),
    member: so.filter(o => o.payMethod === 'member').reduce((a, o) => a + o.amount, 0),
    mp: so.filter(o => o.payMethod === 'mp').reduce((a, o) => a + o.amount, 0),
  };
}

function storeDashboard(storeId, days) {
  const from = daysAgoStr(days - 1), to = todayStr();
  const orders = effectiveOrders(db.orders.filter(o => o.businessDate >= from && o.businessDate <= to && o.storeId === storeId));
  const todayOrders = effectiveOrders(db.orders.filter(o => o.storeId === storeId && o.businessDate === to));
  const openShift = shiftView(db.shifts.find(s => s.storeId === storeId && s.status === 'open'));

  const trend = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = daysAgoStr(i);
    const dayO = effectiveOrders(db.orders.filter(o => o.storeId === storeId && o.businessDate === d));
    trend.push({ date: d, revenue: dayO.reduce((a, o) => a + o.amount, 0), orders: dayO.length });
  }
  const catMap = {};
  orders.forEach(o => {
    const key = db.services.find(x => x.id === o.serviceId)?.category || '其他';
    catMap[key] = (catMap[key] || 0) + o.amount;
  });
  const handovers = db.handovers.filter(h => h.storeId === storeId && h.businessDate >= from)
    .sort((a, b) => b.confirmedAt.localeCompare(a.confirmedAt));

  return {
    range: { from, to, days },
    kpi: {
      revenue: orders.reduce((a, o) => a + o.amount, 0),
      orders: orders.length,
      todayRevenue: todayOrders.reduce((a, o) => a + o.amount, 0),
      todayOrders: todayOrders.length,
      memberRecharge: db.recharges.filter(r => r.storeId === storeId && r.createdAt.slice(0, 10) >= from).reduce((a, r) => a + r.amount, 0),
      stockAlerts: db.inventoryAlerts.filter(a => a.storeId === storeId && !a.resolved).length,
      transfersIn: db.stockTransfers.filter(t => t.toStoreId === storeId && t.status === 'in_transit').length,
      transfersOut: db.stockTransfers.filter(t => t.fromStoreId === storeId && t.status === 'in_transit').length,
    },
    openShift,
    trend,
    catShare: Object.entries(catMap).map(([category, revenue]) => ({ category, revenue })).sort((a, b) => b.revenue - a.revenue),
    recentHandovers: handovers.slice(0, 8),
  };
}

/* ---------------- 路由表 ---------------- */
const routes = [];
const r = (method, pattern, handler, opts = {}) => routes.push({ method, pattern, handler, ...opts });

/* 认证 */
r('GET', /^\/api\/public\/stores$/, async (req, res) => {
  json(res, db.stores.map(s => ({ id: s.id, name: s.name, city: s.city, manager: s.manager })));
});
r('POST', /^\/api\/login$/, async (req, res, p, user, m, body) => {
  const u = db.users.find(x => x.username === body.username && x.password === body.password && x.active);
  if (!u) return fail(res, '账号或密码错误', 401);
  const token = genToken();
  const info = { id: u.id, username: u.username, name: u.name, role: u.role, storeId: u.storeId };
  sessions.set(token, info);
  const store = u.storeId ? db.stores.find(s => s.id === u.storeId) : null;
  json(res, { token, user: info, store });
});
r('POST', /^\/api\/logout$/, async (req, res) => {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  sessions.delete(token);
  json(res, { ok: true });
});
r('GET', /^\/api\/bootstrap$/, async (req, res, p, user) => {
  json(res, {
    user,
    store: user.storeId ? db.stores.find(s => s.id === user.storeId) : null,
    stores: db.stores, services: db.services, techLevels: db.techLevels,
    memberLevels: db.memberLevels, shiftDefs: db.shiftDefs,
    materials: db.materials, recipes: db.recipes, inventoryConfig: db.inventoryConfig,
  });
}, { auth: true });

/* ===== 总部看板 ===== */
r('GET', /^\/api\/hq\/dashboard$/, async (req, res, p, user) => {
  json(res, hqDashboard(Number(p.query.days) || 30));
}, { auth: true, role: 'hq' });

/* ===== 门店管理 ===== */
r('GET', /^\/api\/stores$/, async (req, res) => {
  json(res, db.stores.map(s => ({
    ...s,
    techCount: db.technicians.filter(t => t.storeId === s.id && t.status === 'active').length,
    memberCount: db.members.filter(m => m.storeId === s.id).length,
  })));
}, { auth: true });
r('POST', /^\/api\/stores$/, async (req, res, p, user, m, body) => {
  if (!body.name || !body.city) return fail(res, '门店名称与城市必填');
  const idNum = Math.max(0, ...db.stores.map(s => Number(s.id.slice(1)))) + 1;
  const store = { id: `S${String(idNum).padStart(2, '0')}`, name: body.name, city: body.city, address: body.address || '', phone: body.phone || '', manager: body.manager || '', opened: body.opened || todayStr() };
  db.stores.push(store); save();
  json(res, store);
}, { auth: true, role: 'hq' });
r('PUT', /^\/api\/stores\/(\w+)$/, async (req, res, p, user, m, body) => {
  const s = db.stores.find(x => x.id === m[1]);
  if (!s) return fail(res, '门店不存在', 404);
  ['name', 'city', 'address', 'phone', 'manager', 'opened'].forEach(k => { if (body[k] !== undefined) s[k] = body[k]; });
  save(); json(res, s);
}, { auth: true, role: 'hq' });

/* ===== 项目 / 定价 ===== */
r('GET', /^\/api\/services$/, async (req, res) => {
  json(res, db.services.map(v => ({
    ...v,
    sold30: db.orders.filter(o => o.serviceId === v.id && o.businessDate >= daysAgoStr(29)).length,
  })));
}, { auth: true });
r('POST', /^\/api\/services$/, async (req, res, p, user, m, body) => {
  if (!body.name || !(Number(body.price) > 0)) return fail(res, '项目名称与价格必填');
  const idNum = Math.max(0, ...db.services.map(v => Number(v.id.slice(1)))) + 1;
  const v = { id: `V${String(idNum).padStart(2, '0')}`, name: body.name, duration: Number(body.duration) || 60, price: Number(body.price), category: body.category || '其他', commissionFixed: body.commissionFixed ? Number(body.commissionFixed) : null, active: body.active === 0 ? 0 : 1 };
  db.services.push(v); save(); json(res, v);
}, { auth: true, role: 'hq' });
r('PUT', /^\/api\/services\/(\w+)$/, async (req, res, p, user, m, body) => {
  const v = db.services.find(x => x.id === m[1]);
  if (!v) return fail(res, '项目不存在', 404);
  if (body.name !== undefined) v.name = body.name;
  if (body.category !== undefined) v.category = body.category;
  if (body.duration !== undefined) v.duration = Number(body.duration);
  if (body.price !== undefined) v.price = Number(body.price);
  if (body.active !== undefined) v.active = Number(body.active);
  if (body.commissionFixed !== undefined) v.commissionFixed = body.commissionFixed ? Number(body.commissionFixed) : null;
  save(); json(res, v);
}, { auth: true, role: 'hq' });

/* ===== 会员体系 ===== */
r('GET', /^\/api\/member-levels$/, async (req, res) => json(res, db.memberLevels), { auth: true });
r('PUT', /^\/api\/member-levels\/(\w+)$/, async (req, res, p, user, m, body) => {
  const lv = db.memberLevels.find(x => x.id === m[1]);
  if (!lv) return fail(res, '等级不存在', 404);
  if (body.name) lv.name = body.name;
  if (body.threshold !== undefined && Number(body.threshold) >= 0) lv.threshold = Number(body.threshold);
  if (body.discount !== undefined && Number(body.discount) > 0 && Number(body.discount) <= 1) lv.discount = Number(body.discount);
  save(); json(res, lv);
}, { auth: true, role: 'hq' });

/* ===== 提成标准 ===== */
r('GET', /^\/api\/commission-rules$/, async (req, res) => {
  json(res, { levels: db.techLevels, rules: db.commissionRules, services: db.services });
}, { auth: true });
r('PUT', /^\/api\/tech-levels\/(\w+)$/, async (req, res, p, user, m, body) => {
  const lv = db.techLevels.find(x => x.id === m[1]);
  if (!lv) return fail(res, '技师等级不存在', 404);
  if (body.name) lv.name = body.name;
  if (body.commissionRate !== undefined) {
    const v = Number(body.commissionRate);
    if (!(v > 0 && v < 1)) return fail(res, '提成比例需在 0~1 之间');
    lv.commissionRate = v;
  }
  save(); json(res, lv);
}, { auth: true, role: 'hq' });
r('POST', /^\/api\/commission-rules$/, async (req, res, p, user, m, body) => {
  if (!body.serviceId || !body.levelId || !body.type || body.value === undefined) return fail(res, '请完整填写规则');
  if (db.commissionRules.some(x => x.serviceId === body.serviceId && x.levelId === body.levelId && x.active))
    return fail(res, '该项目+等级已有生效规则，请直接编辑');
  const rule = { id: nextId('commissionRule', 'CR', 3), name: body.name || '提成规则', serviceId: body.serviceId, levelId: body.levelId, type: body.type, value: Number(body.value), active: 1 };
  db.commissionRules.push(rule); save(); json(res, rule);
}, { auth: true, role: 'hq' });
r('PUT', /^\/api\/commission-rules\/(\w+)$/, async (req, res, p, user, m, body) => {
  const rule = db.commissionRules.find(x => x.id === m[1]);
  if (!rule) return fail(res, '规则不存在', 404);
  ['name', 'serviceId', 'levelId', 'type'].forEach(k => { if (body[k] !== undefined) rule[k] = body[k]; });
  if (body.value !== undefined) rule.value = Number(body.value);
  if (body.active !== undefined) rule.active = Number(body.active);
  save(); json(res, rule);
}, { auth: true, role: 'hq' });
r('DELETE', /^\/api\/commission-rules\/(\w+)$/, async (req, res, p, user, m) => {
  const i = db.commissionRules.findIndex(x => x.id === m[1]);
  if (i < 0) return fail(res, '规则不存在', 404);
  db.commissionRules.splice(i, 1); save(); json(res, { ok: true });
}, { auth: true, role: 'hq' });

/* ===== 会员 ===== */
r('GET', /^\/api\/members$/, async (req, res, p, user) => {
  let list = db.members;
  if (user.role === 'store') list = list.filter(m => m.storeId === user.storeId);
  if (p.query.storeId && user.role === 'hq') list = list.filter(m => m.storeId === p.query.storeId);
  if (p.query.q) { const q = String(p.query.q).trim(); list = list.filter(m => m.name.includes(q) || m.phone.includes(q)); }
  json(res, list.map(enrichMember));
}, { auth: true });
r('POST', /^\/api\/members$/, async (req, res, p, user, m, body) => {
  if (!body.name || !body.phone) return fail(res, '姓名与手机号必填');
  if (db.members.some(x => x.phone === body.phone)) return fail(res, '该手机号已注册会员');
  const storeId = user.role === 'store' ? user.storeId : (body.storeId || null);
  if (!storeId) return fail(res, '请选择归属门店');
  const mem = { id: nextId('member', 'M'), name: body.name, phone: body.phone, levelId: 'ML1', storeId, balance: 0, totalRecharge: 0, totalConsume: 0, regDate: todayStr() };
  db.members.push(mem);
  if (Number(body.initAmount) > 0) {
    const amt = Number(body.initAmount);
    const bonus = amt >= 3000 ? Math.round(amt * 0.1) : 0;
    mem.balance = amt + bonus; mem.totalRecharge = amt + bonus;
    applyMemberLevel(mem);
    db.recharges.push({ id: nextId('recharge', 'RC', 5), memberId: mem.id, storeId, amount: amt, bonus, payMethod: body.payMethod || 'cash', createdAt: nowLocal() });
  }
  save(); json(res, enrichMember(mem));
}, { auth: true });
r('POST', /^\/api\/members\/(\w+)\/recharge$/, async (req, res, p, user, m, body) => {
  const mem = db.members.find(x => x.id === m[1]);
  if (!mem) return fail(res, '会员不存在', 404);
  if (user.role === 'store' && mem.storeId !== user.storeId) return fail(res, '不能为其他门店会员充值', 403);
  const amt = Number(body.amount);
  if (!(amt > 0)) return fail(res, '充值金额无效');
  const bonus = amt >= 3000 ? Math.round(amt * 0.1) : 0;
  mem.balance += amt + bonus; mem.totalRecharge += amt + bonus;
  applyMemberLevel(mem);
  const rec = { id: nextId('recharge', 'RC', 5), memberId: mem.id, storeId: mem.storeId, amount: amt, bonus, payMethod: body.payMethod || 'cash', createdAt: nowLocal() };
  db.recharges.push(rec); save();
  json(res, { member: enrichMember(mem), recharge: rec });
}, { auth: true });
r('GET', /^\/api\/members\/(\w+)\/recharges$/, async (req, res, p, user, m) => {
  const mem = db.members.find(x => x.id === m[1]);
  if (!mem) return fail(res, '会员不存在', 404);
  json(res, db.recharges.filter(x => x.memberId === mem.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
}, { auth: true });

/* ===== 技师 / 员工 ===== */
r('GET', /^\/api\/technicians$/, async (req, res, p, user) => {
  let list = db.technicians;
  if (user.role === 'store') list = list.filter(t => t.storeId === user.storeId);
  if (p.query.storeId) list = list.filter(t => t.storeId === p.query.storeId);
  if (p.query.status) list = list.filter(t => t.status === p.query.status);
  if (p.query.q) { const q = String(p.query.q).trim(); list = list.filter(t => t.name.includes(q) || t.phone.includes(q) || t.id.includes(q)); }
  json(res, list.map(enrichTech));
}, { auth: true });
r('GET', /^\/api\/technicians\/(\w+)$/, async (req, res, p, user, m) => {
  const t = db.technicians.find(x => x.id === m[1]);
  if (!t) return fail(res, '员工不存在', 404);
  if (user.role === 'store' && t.storeId !== user.storeId) return fail(res, '无权查看该员工', 403);
  json(res, {
    ...enrichTech(t),
    trainings: db.trainings.filter(x => x.techId === t.id).sort((a, b) => b.trainDate.localeCompare(a.trainDate)),
    transfers: db.transfers.filter(x => x.techId === t.id).sort((a, b) => b.transferDate.localeCompare(a.transferDate)),
  });
}, { auth: true });
r('POST', /^\/api\/technicians$/, async (req, res, p, user, m, body) => {
  if (!body.name || !body.levelId) return fail(res, '姓名与技师等级必填');
  const storeId = user.role === 'store' ? user.storeId : (body.storeId || null);
  if (!storeId) return fail(res, '请选择归属门店');
  const t = {
    id: nextId('tech', 'T'), name: body.name, gender: body.gender || '女', age: Number(body.age) || 25,
    phone: body.phone || '', levelId: body.levelId, storeId, status: 'active',
    hireDate: body.hireDate || todayStr(), leaveDate: null, remark: body.remark || '',
  };
  db.technicians.push(t);
  (body.specialties || []).filter(Boolean).forEach(sid => db.techSpecialties.push({ techId: t.id, serviceId: sid }));
  (body.trainings || []).filter(tr => tr && tr.topic).forEach(tr => {
    const score = Number(tr.score) || 0;
    db.trainings.push({ id: nextId('training', 'TR'), techId: t.id, topic: tr.topic, trainDate: tr.trainDate || todayStr(), score, result: score >= 60 ? 'pass' : 'fail', cert: tr.cert || null });
  });
  save(); json(res, enrichTech(t));
}, { auth: true });
r('POST', /^\/api\/technicians\/(\w+)\/trainings$/, async (req, res, p, user, m, body) => {
  const t = db.technicians.find(x => x.id === m[1]);
  if (!t) return fail(res, '员工不存在', 404);
  if (user.role === 'store' && t.storeId !== user.storeId) return fail(res, '无权操作', 403);
  if (!body.topic) return fail(res, '培训主题必填');
  const score = Number(body.score) || 0;
  const tr = { id: nextId('training', 'TR'), techId: t.id, topic: body.topic, trainDate: body.trainDate || todayStr(), score, result: score >= 60 ? 'pass' : 'fail', cert: body.cert || null };
  db.trainings.push(tr); save(); json(res, tr);
}, { auth: true });
r('POST', /^\/api\/technicians\/(\w+)\/specialties$/, async (req, res, p, user, m, body) => {
  const t = db.technicians.find(x => x.id === m[1]);
  if (!t) return fail(res, '员工不存在', 404);
  if (user.role === 'store' && t.storeId !== user.storeId) return fail(res, '无权操作', 403);
  db.techSpecialties = db.techSpecialties.filter(x => x.techId !== t.id);
  (body.serviceIds || []).forEach(sid => db.techSpecialties.push({ techId: t.id, serviceId: sid }));
  save(); json(res, enrichTech(t));
}, { auth: true });
r('POST', /^\/api\/technicians\/(\w+)\/transfer$/, async (req, res, p, user, m, body) => {
  const t = db.technicians.find(x => x.id === m[1]);
  if (!t) return fail(res, '员工不存在', 404);
  if (t.status !== 'active') return fail(res, '仅在职员工可调动');
  const target = db.stores.find(s => s.id === body.toStoreId);
  if (!target) return fail(res, '目标门店不存在');
  if (target.id === t.storeId) return fail(res, '目标门店与当前门店相同');
  const rec = { id: nextId('transfer', 'TF'), techId: t.id, techName: t.name, fromStoreId: t.storeId, toStoreId: target.id, transferDate: body.transferDate || todayStr(), reason: body.reason || '' };
  db.transfers.push(rec);
  t.storeId = target.id;
  save(); json(res, { tech: enrichTech(t), transfer: rec });
}, { auth: true });
r('POST', /^\/api\/technicians\/(\w+)\/leave$/, async (req, res, p, user, m, body) => {
  const t = db.technicians.find(x => x.id === m[1]);
  if (!t) return fail(res, '员工不存在', 404);
  if (t.status !== 'active') return fail(res, '员工当前状态不可离职');
  t.status = 'left';
  t.leaveDate = body.leaveDate || todayStr();
  t.remark = body.reason || t.remark;
  save(); json(res, enrichTech(t));
}, { auth: true });
r('GET', /^\/api\/transfers$/, async (req, res) => {
  json(res, db.transfers.slice().sort((a, b) => b.transferDate.localeCompare(a.transferDate)).map(t => ({
    ...t,
    fromStoreName: db.stores.find(s => s.id === t.fromStoreId)?.name,
    toStoreName: db.stores.find(s => s.id === t.toStoreId)?.name,
  })));
}, { auth: true });

/* ===== 班次 / 交班 ===== */
r('GET', /^\/api\/shifts$/, async (req, res, p, user) => {
  let list = db.shifts;
  if (user.role === 'store') list = list.filter(s => s.storeId === user.storeId);
  if (p.query.storeId && user.role === 'hq') list = list.filter(s => s.storeId === p.query.storeId);
  if (p.query.status) list = list.filter(s => s.status === p.query.status);
  json(res, list.slice().sort((a, b) => b.openedAt.localeCompare(a.openedAt)).slice(0, 100).map(shiftView));
}, { auth: true });
r('POST', /^\/api\/shifts$/, async (req, res, p, user, m, body) => {
  const storeId = user.role === 'store' ? user.storeId : body.storeId;
  if (!storeId) return fail(res, '请选择门店');
  if (db.shifts.some(s => s.storeId === storeId && s.status === 'open')) return fail(res, '该门店已有进行中的班次，请先完成交班');
  const def = db.shiftDefs.find(d => d.code === (body.shiftCode || 'day')) || db.shiftDefs[0];
  const endDate = def.end < def.start ? (() => { const x = new Date(); x.setDate(x.getDate() + 1); return fmtDate(x); })() : todayStr();
  const shift = {
    id: nextId('shift', 'SH', 6), storeId, shiftCode: def.code, shiftName: def.name,
    businessDate: todayStr(), startTime: `${todayStr} ${def.start}:00`, endTime: `${endDate} ${def.end}:00`,
    opener: body.opener || user.name, status: 'open', openedAt: nowLocal(), closedAt: null,
  };
  db.shifts.push(shift); save(); json(res, shift);
}, { auth: true });
r('POST', /^\/api\/shifts\/(\w+)\/close$/, async (req, res, p, user, m, body) => {
  const s = db.shifts.find(x => x.id === m[1]);
  if (!s) return fail(res, '班次不存在', 404);
  if (user.role === 'store' && s.storeId !== user.storeId) return fail(res, '无权操作该班次', 403);
  if (s.status === 'closed') return fail(res, '该班次已交班');
  if (!body.closer) return fail(res, '请填写接班人');
  if (!body.openerSign || !body.closerSign) return fail(res, '交班双方均需手写签字确认');
  const orders = effectiveOrders(db.orders.filter(o => o.shiftId === s.id));
  const sum = (pm) => orders.filter(o => o.payMethod === pm).reduce((a, o) => a + o.amount, 0);
  const hand = {
    id: nextId('handover', 'HD', 6),
    shiftId: s.id, storeId: s.storeId, businessDate: s.businessDate, shiftName: s.shiftName,
    serveCount: orders.length,
    cash: sum('cash'), card: sum('card'), member: sum('member'), mp: sum('mp'),
    revenue: orders.reduce((a, o) => a + o.amount, 0),
    commission: orders.reduce((a, o) => a + o.techCommission, 0),
    opener: body.opener || s.opener, closer: body.closer,
    openerSign: body.openerSign, closerSign: body.closerSign,
    confirmedAt: nowLocal(), remark: body.remark || '',
  };
  db.handovers.push(hand);
  s.status = 'closed'; s.closedAt = nowLocal();
  save(); json(res, hand);
}, { auth: true });
r('GET', /^\/api\/handovers$/, async (req, res, p, user) => {
  let list = db.handovers;
  if (user.role === 'store') list = list.filter(h => h.storeId === user.storeId);
  if (p.query.storeId && user.role === 'hq') list = list.filter(h => h.storeId === p.query.storeId);
  json(res, list.slice().sort((a, b) => b.confirmedAt.localeCompare(a.confirmedAt)).slice(0, 200).map(h => ({
    ...h, storeName: db.stores.find(s => s.id === h.storeId)?.name,
  })));
}, { auth: true });
r('GET', /^\/api\/handovers\/(\w+)$/, async (req, res, p, user, m) => {
  const h = db.handovers.find(x => x.id === m[1]);
  if (!h) return fail(res, '交接记录不存在', 404);
  if (user.role === 'store' && h.storeId !== user.storeId) return fail(res, '无权查看', 403);
  const orders = effectiveOrders(db.orders.filter(o => o.shiftId === h.shiftId)).map(orderView)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  json(res, { ...h, storeName: db.stores.find(s => s.id === h.storeId)?.name, orders });
}, { auth: true });

/* ===== 开单（上钟） ===== */
r('GET', /^\/api\/orders$/, async (req, res, p, user) => {
  let list = db.orders;
  if (user.role === 'store') list = list.filter(o => o.storeId === user.storeId);
  if (p.query.storeId) list = list.filter(o => o.storeId === p.query.storeId);
  if (p.query.shiftId) list = list.filter(o => o.shiftId === p.query.shiftId);
  if (p.query.date) list = list.filter(o => o.businessDate === p.query.date);
  if (p.query.techId) list = list.filter(o => o.techId === p.query.techId);
  json(res, list.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 300).map(orderView));
}, { auth: true });
r('POST', /^\/api\/orders\/quote$/, async (req, res, p, user, m, body) => {
  const svc = db.services.find(v => v.id === body.serviceId);
  const tech = db.technicians.find(t => t.id === body.techId);
  if (!svc || !tech) return fail(res, '请选择项目与技师');
  const storeId = user.role === 'store' ? user.storeId : (body.storeId || null);
  const mem = body.memberId ? db.members.find(x => x.id === body.memberId) : null;
  const rate = mem ? memberLevel(mem).discount : 1;
  const amount = Math.round(svc.price * rate);
  const cm = calcCommission(svc.id, tech.levelId, amount);
  const snapshot = recipeSnapshotOf(svc.id);
  const recipeItems = snapshot ? snapshot.items.map(it => {
    const rec = stockRec(storeId, it.materialId);
    return { materialId: it.materialId, name: it.name, unit: it.unit, qty: it.qty, unitCost: it.unitCost, stockQty: rec.qty, enough: rec.qty >= it.qty };
  }) : [];
  const materialCost = recipeItems.reduce((a, it) => a + it.qty * it.unitCost, 0);
  const miss = storeId ? shortItems(storeId, snapshot || { items: [] }) : [];
  const policy = storeId ? shortPolicy(storeId) : null;
  json(res, {
    price: svc.price, discountRate: rate, amount, commission: cm.value, basis: cm.basis,
    balance: mem ? mem.balance : null,
    recipeVersion: snapshot?.version || null, recipeItems, materialCost: r2n(materialCost),
    grossProfit: r2n(amount - cm.value - materialCost),
    short: miss, shortPolicy: policy,
  });
}, { auth: true });
r('POST', /^\/api\/orders$/, async (req, res, p, user, m, body) => {
  const storeId = user.role === 'store' ? user.storeId : (body.storeId || null);
  if (!storeId) return fail(res, '请选择门店');
  const svc = db.services.find(v => v.id === body.serviceId && v.active);
  if (!svc) return fail(res, '服务项目不存在或已下架');
  const tech = db.technicians.find(t => t.id === body.techId);
  if (!tech || tech.status !== 'active') return fail(res, '技师不存在或非在职状态');
  if (tech.storeId !== storeId) return fail(res, '该技师不属于本门店');

  const shift = body.shiftId
    ? db.shifts.find(s => s.id === body.shiftId)
    : db.shifts.find(s => s.storeId === storeId && s.status === 'open');
  if (!shift) return fail(res, '当前没有进行中的班次，请先开班');
  if (shift.status !== 'open') return fail(res, '该班次已交班，不能再录单');

  let memberId = null, discountRate = 1, amount = svc.price;
  if (body.memberId) {
    const mem = db.members.find(x => x.id === body.memberId);
    if (!mem) return fail(res, '会员不存在');
    if (mem.storeId !== storeId) return fail(res, '该会员不属于本门店');
    discountRate = memberLevel(mem).discount;
    amount = Math.round(svc.price * discountRate);
    if (mem.balance < amount) return fail(res, `会员卡余额不足（余额 ¥${mem.balance}，本单需 ¥${amount}）`);
    memberId = mem.id;
  }
  let payMethod = body.payMethod || 'cash';
  if (memberId) payMethod = 'member';
  if (!['cash', 'card', 'mp', 'member'].includes(payMethod)) return fail(res, '支付方式无效');

  const cm = calcCommission(svc.id, tech.levelId, amount);
  const snapshot = recipeSnapshotOf(svc.id);
  const miss = snapshot ? shortItems(storeId, snapshot) : [];
  const policy = shortPolicy(storeId);
  if (miss.length && policy === 'strict') {
    const detail = miss.map(x => `${x.name} 需 ${x.qty}${x.unit} / 现存 ${x.have}${x.unit}`).join('；');
    return fail(res, `耗材库存不足，总部策略为「禁止开单」：${detail}`);
  }
  const now = nowLocal();
  const order = {
    id: nextId('order', 'O', 7), orderNo: `${todayStr().replace(/-/g, '')}${String(db.counters.order).padStart(5, '0').slice(-5)}`,
    storeId, shiftId: shift.id, serviceId: svc.id, techId: tech.id, memberId,
    price: svc.price, discountRate, amount, payMethod, techCommission: cm.value,
    duration: svc.duration, createdAt: now, businessDate: todayStr(),
    reversed: 0, reversedAt: null, reverseReason: '',
    recipeVersion: snapshot?.version || null, recipeSnapshot: snapshot,
  };
  db.orders.push(order);
  // 按开单时点配方快照扣减门店库存（负库存策略下允许扣成负数并预警）
  order.materialCost = snapshot ? consumeForOrder(order, snapshot, now) : 0;
  if (memberId) {
    const mem = db.members.find(x => x.id === memberId);
    mem.balance -= amount; mem.totalConsume += amount;
  }
  save();
  const afterAlerts = miss.length && policy === 'negative'
    ? { allowedNegative: true, message: '库存已为负，系统已产生负库存预警，请尽快补货' }
    : null;
  json(res, { ...order, commissionBasis: cm.basis, payMethodName: payLabel(payMethod), stockWarning: afterAlerts });
}, { auth: true });

/* ===== 账单冲正（撤销）：库存仅回补一次，重复冲正无效 ===== */
r('POST', /^\/api\/orders\/(\w+)\/reverse$/, async (req, res, p, user, m, body) => {
  const order = db.orders.find(x => x.id === m[1]);
  if (!order) return fail(res, '账单不存在', 404);
  if (user.role === 'store' && order.storeId !== user.storeId) return fail(res, '无权冲正其他门店账单', 403);
  if (order.reversed) return fail(res, '该账单已冲正，库存已回补，不能重复操作');
  const now = nowLocal();
  order.reversed = 1; order.reversedAt = now; order.reverseReason = body.reason || '账单冲正';
  // 会员单退回卡内余额（独立余额变动，不进充值流水）
  if (order.memberId) {
    const mem = db.members.find(x => x.id === order.memberId);
    if (mem) { mem.balance += order.amount; mem.totalConsume = Math.max(0, mem.totalConsume - order.amount); }
  }
  const restoredCost = revertOrderStock(order, now);
  save();
  json(res, { ...orderView(order), restoredMaterialCost: restoredCost });
}, { auth: true });

/* ===== 门店看板 / 技师业绩 ===== */
r('GET', /^\/api\/stores\/(\w+)\/dashboard$/, async (req, res, p, user, m) => {
  if (user.role === 'store' && user.storeId !== m[1]) return fail(res, '无权查看该门店', 403);
  if (!db.stores.find(s => s.id === m[1])) return fail(res, '门店不存在', 404);
  json(res, storeDashboard(m[1], Number(p.query.days) || 30));
}, { auth: true });
r('GET', /^\/api\/stores\/(\w+)\/tech-performance$/, async (req, res, p, user, m) => {
  if (user.role === 'store' && user.storeId !== m[1]) return fail(res, '无权查看', 403);
  const from = p.query.from || daysAgoStr(29), to = p.query.to || todayStr();
  const rows = db.technicians.filter(t => t.storeId === m[1]).map(t => {
    const os = effectiveOrders(db.orders.filter(o => o.techId === t.id && o.businessDate >= from && o.businessDate <= to));
    return {
      techId: t.id, name: t.name, levelName: db.techLevels.find(l => l.id === t.levelId)?.name,
      status: t.status, orderCount: os.length, hours: Math.round(os.reduce((a, o) => a + o.duration, 0) / 60 * 10) / 10,
      revenue: os.reduce((a, o) => a + o.amount, 0), commission: os.reduce((a, o) => a + o.techCommission, 0),
    };
  }).sort((a, b) => b.commission - a.commission);
  json(res, { from, to, rows });
}, { auth: true });

/* ===== 充值流水（总部） ===== */
r('GET', /^\/api\/recharges$/, async (req, res, p) => {
  let list = db.recharges;
  if (p.query.storeId) list = list.filter(x => x.storeId === p.query.storeId);
  json(res, list.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 300).map(x => ({
    ...x,
    memberName: db.members.find(m => m.id === x.memberId)?.name,
    storeName: db.stores.find(s => s.id === x.storeId)?.name,
    payMethodName: payLabel(x.payMethod),
  })));
}, { auth: true, role: 'hq' });

/* ============================================================
   ===== 耗材档案 / 配方 / 库存核算 =====
   ============================================================ */

/* 库存不足策略（总部配置） */
r('GET', /^\/api\/inventory-config$/, async (req, res) => json(res, db.inventoryConfig), { auth: true });
r('PUT', /^\/api\/inventory-config$/, async (req, res, p, user, m, body) => {
  if (!['strict', 'negative'].includes(body.shortPolicy)) return fail(res, '策略值无效');
  db.inventoryConfig.shortPolicy = body.shortPolicy;
  db.inventoryConfig.storePolicies = body.storePolicies || db.inventoryConfig.storePolicies || {};
  save(); json(res, db.inventoryConfig);
}, { auth: true, role: 'hq' });

/* 耗材档案（总部维护） */
r('GET', /^\/api\/materials$/, async (req, res) => {
  json(res, db.materials.map(materialView));
}, { auth: true });
r('POST', /^\/api\/materials$/, async (req, res, p, user, m, body) => {
  if (!body.name || !body.unit) return fail(res, '耗材名称与计量单位必填');
  if (!(Number(body.standardCost) >= 0)) return fail(res, '采购成本需为不小于 0 的数字');
  const idNum = Math.max(0, ...db.materials.map(x => Number(x.id.slice(1)))) + 1;
  const mat = {
    id: `P${String(idNum).padStart(2, '0')}`, name: body.name, spec: body.spec || '', unit: body.unit,
    category: body.category || '其他', standardCost: r2n(Number(body.standardCost)),
    safetyStock: Number(body.safetyStock) || 0, active: body.active === 0 ? 0 : 1,
  };
  db.materials.push(mat); save(); json(res, materialView(mat));
}, { auth: true, role: 'hq' });
r('PUT', /^\/api\/materials\/(\w+)$/, async (req, res, p, user, m, body) => {
  const mat = db.materials.find(x => x.id === m[1]);
  if (!mat) return fail(res, '耗材不存在', 404);
  if (body.name !== undefined) mat.name = body.name;
  if (body.spec !== undefined) mat.spec = body.spec;
  if (body.unit !== undefined) mat.unit = body.unit;
  if (body.category !== undefined) mat.category = body.category;
  if (body.standardCost !== undefined) {
    if (!(Number(body.standardCost) >= 0)) return fail(res, '采购成本无效');
    mat.standardCost = r2n(Number(body.standardCost));
  }
  if (body.safetyStock !== undefined) mat.safetyStock = Number(body.safetyStock) || 0;
  if (body.active !== undefined) mat.active = Number(body.active);
  save(); json(res, materialView(mat));
}, { auth: true, role: 'hq' });

/* 标准耗用配方：按服务项目维护；修改只升版本、改后成本，历史账单快照不受影响 */
r('GET', /^\/api\/recipes$/, async (req, res, p) => {
  const list = db.recipes.map(rp => ({
    ...rp,
    serviceName: db.services.find(v => v.id === rp.serviceId)?.name,
    servicePrice: db.services.find(v => v.id === rp.serviceId)?.price,
    cost: r2n(rp.items.reduce((a, it) => a + it.qty * it.unitCost, 0)),
  }));
  json(res, { recipes: list, materials: db.materials, services: db.services });
}, { auth: true });
r('PUT', /^\/api\/recipes\/(\w+)$/, async (req, res, p, user, m, body) => {
  const service = db.services.find(v => v.id === m[1]);
  if (!service) return fail(res, '服务项目不存在', 404);
  const items = (body.items || []).filter(it => it && it.materialId && Number(it.qty) > 0)
    .map(it => {
      const mat = materialOf(it.materialId);
      if (!mat) throw new Error('耗材不存在：' + it.materialId);
      return { materialId: it.materialId, qty: r4n(Number(it.qty)), unitCost: mat.standardCost };
    });
  let rp = db.recipes.find(x => x.serviceId === service.id);
  if (!rp) { rp = { serviceId: service.id, version: 0, items: [], updatedAt: nowLocal() }; db.recipes.push(rp); }
  rp.items = items; rp.version += 1; rp.updatedAt = nowLocal();
  save();
  json(res, { ...rp, serviceName: service.name, cost: r2n(items.reduce((a, it) => a + it.qty * it.unitCost, 0)) });
}, { auth: true, role: 'hq' });

/* 门店库存台账 */
r('GET', /^\/api\/stock$/, async (req, res, p, user) => {
  let storeId = user.role === 'store' ? user.storeId : (p.query.storeId || '');
  const rows = db.stockRecords
    .filter(r => !storeId || r.storeId === storeId)
    .filter(r => p.query.materialId ? r.materialId === p.query.materialId : true)
    .map(stockRowView)
    .sort((a, b) => (a.storeId + a.category + a.materialId).localeCompare(b.storeId + b.category + b.materialId));
  json(res, rows.map(r => ({ ...r, storeName: db.stores.find(s => s.id === r.storeId)?.name })));
}, { auth: true });

/* 库存流水（门店看本店，总部可按门店/耗材/类型过滤） */
r('GET', /^\/api\/stock-ledger$/, async (req, res, p, user) => {
  let list = db.stockLedger;
  if (user.role === 'store') list = list.filter(l => l.storeId === user.storeId);
  else if (p.query.storeId) list = list.filter(l => l.storeId === p.query.storeId);
  if (p.query.materialId) list = list.filter(l => l.materialId === p.query.materialId);
  if (p.query.type) list = list.filter(l => l.type === p.query.type);
  if (p.query.from) list = list.filter(l => l.time.slice(0, 10) >= p.query.from);
  if (p.query.to) list = list.filter(l => l.time.slice(0, 10) <= p.query.to);
  const rows = list.slice().sort((a, b) => b.time.localeCompare(a.time) || b.id.localeCompare(a.id)).slice(0, 500).map(l => ({
    ...l,
    materialName: materialOf(l.materialId)?.name, unit: materialOf(l.materialId)?.unit,
    storeName: db.stores.find(s => s.id === l.storeId)?.name,
    typeName: {
      open: '期初', purchase_in: '采购入库', consume: '服务耗用', consume_revert: '冲正回补',
      stocktake_adjust: '盘点调整', damage: '报损', transfer_out: '调出', transfer_in: '调入',
      transfer_cancel: '调拨撤销',
    }[l.type] || l.type,
  }));
  json(res, rows);
}, { auth: true });

/* 采购入库（门店） */
r('POST', /^\/api\/purchases$/, async (req, res, p, user, m, body) => {
  const storeId = user.role === 'store' ? user.storeId : (body.storeId || null);
  if (!storeId) return fail(res, '请选择门店');
  const raw = (body.items || []).filter(x => x && x.materialId && Number(x.qty) > 0 && Number(x.unitCost) >= 0);
  if (!raw.length) return fail(res, '请至少填写一条采购明细');
  const now = nowLocal();
  const doc = { id: nextId('purchase', 'PR', 6), storeId, supplier: body.supplier || '', items: [], totalCost: 0, createdAt: now, operator: user.name, remark: body.remark || '' };
  raw.forEach(x => {
    const qty = r4n(Number(x.qty)), cost = r2n(Number(x.unitCost));
    const amount = r2n(qty * cost);
    doc.items.push({ materialId: x.materialId, qty, unitCost: cost, amount });
    const rec = stockRec(storeId, x.materialId);
    stockIn(rec, qty, cost);
    pushLedger({ time: now, storeId, materialId: x.materialId, type: 'purchase_in', qty, unitCost: cost, refType: 'purchase', refId: doc.id, remark: doc.supplier || '采购入库' });
    refreshAlerts(storeId, x.materialId);
  });
  doc.totalCost = r2n(doc.items.reduce((a, it) => a + it.amount, 0));
  db.purchases.push(doc); save();
  json(res, doc);
}, { auth: true });
r('GET', /^\/api\/purchases$/, async (req, res, p, user) => {
  let list = db.purchases;
  if (user.role === 'store') list = list.filter(x => x.storeId === user.storeId);
  else if (p.query.storeId) list = list.filter(x => x.storeId === p.query.storeId);
  json(res, list.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 200).map(d => ({
    ...d, storeName: db.stores.find(s => s.id === d.storeId)?.name,
    items: d.items.map(it => ({ ...it, materialName: materialOf(it.materialId)?.name, unit: materialOf(it.materialId)?.unit })),
  })));
}, { auth: true });

/* 盘点（门店）：录入实存，自动生成盘盈/盘亏调整流水 */
r('POST', /^\/api\/stocktakes$/, async (req, res, p, user, m, body) => {
  const storeId = user.role === 'store' ? user.storeId : (body.storeId || null);
  if (!storeId) return fail(res, '请选择门店');
  const raw = (body.items || []).filter(x => x && x.materialId);
  if (!raw.length) return fail(res, '请填写盘点明细');
  const now = nowLocal();
  const doc = { id: nextId('stocktake', 'SK', 6), storeId, operator: user.name, createdAt: now, items: [], lossCost: 0, gainCost: 0, remark: body.remark || '' };
  raw.forEach(x => {
    const rec = stockRec(storeId, x.materialId);
    const bookQty = r2n(rec.qty), actualQty = Math.max(0, r2n(Number(x.actualQty)));
    const diffQty = r2n(actualQty - bookQty);
    doc.items.push({ materialId: x.materialId, bookQty, actualQty, diffQty });
    if (diffQty !== 0) {
      const cost = rec.avgCost ?? materialOf(x.materialId)?.standardCost ?? 0;
      const diffCost = r2n(diffQty * cost);
      if (diffQty < 0) { stockOut(rec, -diffQty); doc.lossCost += -diffCost; }
      else { stockIn(rec, diffQty, cost); doc.gainCost += diffCost; }
      pushLedger({ time: now, storeId, materialId: x.materialId, type: 'stocktake_adjust', qty: diffQty, unitCost: cost, refType: 'stocktake', refId: doc.id, remark: `盘点${diffQty < 0 ? '盘亏' : '盘盈'}调整` });
      refreshAlerts(storeId, x.materialId);
    }
  });
  doc.lossCost = r2n(doc.lossCost); doc.gainCost = r2n(doc.gainCost);
  db.stocktakes.push(doc); save();
  json(res, doc);
}, { auth: true });
r('GET', /^\/api\/stocktakes$/, async (req, res, p, user) => {
  let list = db.stocktakes;
  if (user.role === 'store') list = list.filter(x => x.storeId === user.storeId);
  else if (p.query.storeId) list = list.filter(x => x.storeId === p.query.storeId);
  json(res, list.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 100).map(d => ({
    ...d, storeName: db.stores.find(s => s.id === d.storeId)?.name,
    items: d.items.map(it => ({ ...it, materialName: materialOf(it.materialId)?.name, unit: materialOf(it.materialId)?.unit })),
  })));
}, { auth: true });

/* 报损（门店） */
r('POST', /^\/api\/damage-reports$/, async (req, res, p, user, m, body) => {
  const storeId = user.role === 'store' ? user.storeId : (body.storeId || null);
  if (!storeId) return fail(res, '请选择门店');
  const mat = materialOf(body.materialId);
  if (!mat) return fail(res, '耗材不存在', 404);
  const qty = r4n(Number(body.qty));
  if (!(qty > 0)) return fail(res, '报损数量需大于 0');
  if (!body.reason) return fail(res, '请填写报损原因');
  const now = nowLocal();
  const rec = stockRec(storeId, body.materialId);
  const cost = rec.avgCost ?? mat.standardCost;
  const doc = { id: nextId('damage', 'DM', 6), storeId, materialId: body.materialId, qty, unitCost: cost, amount: r2n(qty * cost), reason: body.reason, operator: user.name, createdAt: now };
  stockOut(rec, qty);
  pushLedger({ time: now, storeId, materialId: body.materialId, type: 'damage', qty: -qty, unitCost: cost, refType: 'damage', refId: doc.id, remark: body.reason });
  db.damageReports.push(doc);
  refreshAlerts(storeId, body.materialId);
  save(); json(res, doc);
}, { auth: true });
r('GET', /^\/api\/damage-reports$/, async (req, res, p, user) => {
  let list = db.damageReports;
  if (user.role === 'store') list = list.filter(x => x.storeId === user.storeId);
  else if (p.query.storeId) list = list.filter(x => x.storeId === p.query.storeId);
  if (p.query.from) list = list.filter(x => x.createdAt.slice(0, 10) >= p.query.from);
  if (p.query.to) list = list.filter(x => x.createdAt.slice(0, 10) <= p.query.to);
  json(res, list.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 200).map(d => ({
    ...d, materialName: materialOf(d.materialId)?.name, unit: materialOf(d.materialId)?.unit,
    storeName: db.stores.find(s => s.id === d.storeId)?.name,
  })));
}, { auth: true });

/* ===== 跨店调拨：调出方发起即扣减转在途，调入方确认后才正式入对方账 ===== */
r('POST', /^\/api\/stock-transfers$/, async (req, res, p, user, m, body) => {
  const fromStoreId = user.role === 'store' ? user.storeId : (body.fromStoreId || null);
  const toStoreId = body.toStoreId;
  if (!fromStoreId || !toStoreId) return fail(res, '请选择调入门店');
  if (fromStoreId === toStoreId) return fail(res, '调入门店不能与调出门店相同');
  if (!db.stores.find(s => s.id === toStoreId)) return fail(res, '调入门店不存在');
  const mat = materialOf(body.materialId);
  if (!mat) return fail(res, '耗材不存在', 404);
  const qty = r4n(Number(body.qty));
  if (!(qty > 0)) return fail(res, '调拨数量需大于 0');
  // 调拨始终要求可用库存充足（即使允许负库存开单），避免途中把库存调成负数
  const rec = stockRec(fromStoreId, body.materialId);
  if (rec.qty < qty - 1e-9) return fail(res, `可调出库存不足（现存 ${rec.qty}${mat.unit}，在途 ${rec.inTransit}${mat.unit}）`);
  const now = nowLocal();
  const doc = {
    id: nextId('stockTransfer', 'ST', 6), fromStoreId, toStoreId, materialId: body.materialId,
    qty, unitCost: rec.avgCost ?? mat.standardCost, status: 'in_transit',
    createdAt: now, createdBy: user.name, confirmedAt: null, confirmedBy: null,
    cancelledAt: null, cancelBy: null, remark: body.remark || '',
  };
  db.stockTransfers.push(doc);
  rec.inTransit = r4n(rec.inTransit + qty);
  stockOut(rec, qty);
  pushLedger({ time: now, storeId: fromStoreId, materialId: body.materialId, type: 'transfer_out', qty: -qty, unitCost: doc.unitCost, refType: 'stock_transfer', refId: doc.id, toStoreId, remark: `调出至${db.stores.find(s => s.id === toStoreId).name}` });
  refreshAlerts(fromStoreId, body.materialId);
  save(); json(res, doc);
}, { auth: true });
r('POST', /^\/api\/stock-transfers\/(\w+)\/confirm$/, async (req, res, p, user, m) => {
  const doc = db.stockTransfers.find(x => x.id === m[1]);
  if (!doc) return fail(res, '调拨单不存在', 404);
  if (user.role === 'store' && doc.toStoreId !== user.storeId) return fail(res, '只有调入门店可以确认收货', 403);
  if (doc.status === 'done') return fail(res, '该调拨单已确认入库，不能重复确认');
  if (doc.status === 'cancelled') return fail(res, '该调拨单已在途中取消，不能确认');
  const now = nowLocal();
  const recTo = stockRec(doc.toStoreId, doc.materialId);
  stockIn(recTo, doc.qty, doc.unitCost);
  const recFrom = stockRec(doc.fromStoreId, doc.materialId);
  recFrom.inTransit = r4n(Math.max(0, recFrom.inTransit - doc.qty));
  pushLedger({ time: now, storeId: doc.toStoreId, materialId: doc.materialId, type: 'transfer_in', qty: doc.qty, unitCost: doc.unitCost, refType: 'stock_transfer', refId: doc.id, fromStoreId: doc.fromStoreId, remark: `由${db.stores.find(s => s.id === doc.fromStoreId).name}调入` });
  refreshAlerts(doc.toStoreId, doc.materialId);
  doc.status = 'done'; doc.confirmedAt = now; doc.confirmedBy = user.name;
  save(); json(res, doc);
}, { auth: true });
r('POST', /^\/api\/stock-transfers\/(\w+)\/cancel$/, async (req, res, p, user, m, body) => {
  const doc = db.stockTransfers.find(x => x.id === m[1]);
  if (!doc) return fail(res, '调拨单不存在', 404);
  if (user.role === 'store' && doc.fromStoreId !== user.storeId) return fail(res, '只有调出方可以撤回调拨', 403);
  if (doc.status === 'done') return fail(res, '调拨已确认入库，不能取消');
  if (doc.status === 'cancelled') return fail(res, '调拨单已取消，不能重复取消');
  const now = nowLocal();
  const rec = stockRec(doc.fromStoreId, doc.materialId);
  rec.inTransit = r4n(Math.max(0, rec.inTransit - doc.qty));
  stockIn(rec, doc.qty, doc.unitCost);
  pushLedger({ time: now, storeId: doc.fromStoreId, materialId: doc.materialId, type: 'transfer_cancel', qty: doc.qty, unitCost: doc.unitCost, refType: 'stock_transfer', refId: doc.id, toStoreId: doc.toStoreId, remark: `取消调出至${db.stores.find(s => s.id === doc.toStoreId).name}，库存回补` });
  refreshAlerts(doc.fromStoreId, doc.materialId);
  doc.status = 'cancelled'; doc.cancelledAt = now; doc.cancelBy = user.name; doc.cancelReason = body.reason || '';
  save(); json(res, doc);
}, { auth: true });
r('GET', /^\/api\/stock-transfers$/, async (req, res, p, user) => {
  let list = db.stockTransfers;
  if (user.role === 'store') {
    list = list.filter(t => t.fromStoreId === user.storeId || t.toStoreId === user.storeId);
    if (p.query.scope === 'in') list = list.filter(t => t.toStoreId === user.storeId);
    if (p.query.scope === 'out') list = list.filter(t => t.fromStoreId === user.storeId);
    if (p.query.status) list = list.filter(t => t.status === p.query.status);
  } else {
    if (p.query.status) list = list.filter(t => t.status === p.query.status);
    if (p.query.storeId) list = list.filter(t => t.fromStoreId === p.query.storeId || t.toStoreId === p.query.storeId);
  }
  json(res, list.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(t => ({
    ...t,
    materialName: materialOf(t.materialId)?.name, unit: materialOf(t.materialId)?.unit,
    fromStoreName: db.stores.find(s => s.id === t.fromStoreId)?.name,
    toStoreName: db.stores.find(s => s.id === t.toStoreId)?.name,
    amount: r2n(t.qty * t.unitCost),
  })));
}, { auth: true });

/* 库存预警 */
r('GET', /^\/api\/inventory-alerts$/, async (req, res, p, user) => {
  let list = db.inventoryAlerts;
  if (user.role === 'store') list = list.filter(a => a.storeId === user.storeId);
  else if (p.query.storeId) list = list.filter(a => a.storeId === p.query.storeId);
  if (p.query.resolved !== undefined && p.query.resolved !== '') list = list.filter(a => String(a.resolved) === p.query.resolved);
  else list = list.filter(a => !a.resolved);
  json(res, list.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 200).map(a => ({
    ...a,
    materialName: materialOf(a.materialId)?.name, unit: materialOf(a.materialId)?.unit,
    storeName: db.stores.find(s => s.id === a.storeId)?.name,
    typeName: a.type === 'negative' ? '负库存' : '低库存',
  })));
}, { auth: true });
r('POST', /^\/api\/inventory-alerts\/(\w+)\/resolve$/, async (req, res, p, user, m) => {
  const a = db.inventoryAlerts.find(x => x.id === m[1]);
  if (!a) return fail(res, '预警不存在', 404);
  if (user.role === 'store' && a.storeId !== user.storeId) return fail(res, '无权操作', 403);
  a.resolved = 1; save(); json(res, { ok: true });
}, { auth: true });

/* ===== 总部库存与毛利分析 ===== */
r('GET', /^\/api\/hq\/inventory-analysis$/, async (req, res, p) => {
  const days = Number(p.query.days) || 30;
  const from = daysAgoStr(days - 1), to = todayStr();
  const storeFilter = p.query.storeId || '';
  const stores = db.stores.filter(s => !storeFilter || s.id === storeFilter);
  const storeIds = stores.map(s => s.id);
  const inRange = (t) => { const d = t.slice(0, 10); return d >= from && d <= to; };

  /* 1) 耗材成本：净耗用量/额（含冲正回补）、采购金额、报损、盘亏、期末库存货值 */
  const costMap = {};
  db.materials.forEach(m => { costMap[m.id] = { materialId: m.id, name: m.name, unit: m.unit, category: m.category, standardCost: m.standardCost, consumeQty: 0, consumeCost: 0, purchaseQty: 0, purchaseAmount: 0, damageCost: 0, lossCost: 0, gainCost: 0, endQty: 0, stockValue: 0 }; });
  db.stockLedger.filter(l => storeIds.includes(l.storeId) && inRange(l.time)).forEach(l => {
    const row = costMap[l.materialId]; if (!row) return;
    if (l.type === 'consume') { row.consumeQty += -l.qty; row.consumeCost += -l.qty * l.unitCost; }
    else if (l.type === 'consume_revert') { row.consumeQty -= l.qty; row.consumeCost -= l.qty * l.unitCost; }
    else if (l.type === 'purchase_in') { row.purchaseQty += l.qty; row.purchaseAmount += l.qty * l.unitCost; }
    else if (l.type === 'damage') { row.damageCost += -l.qty * l.unitCost; }
    else if (l.type === 'stocktake_adjust') { if (l.qty < 0) row.lossCost += -l.qty * l.unitCost; else row.gainCost += l.qty * l.unitCost; }
  });
  db.stockRecords.filter(r => storeIds.includes(r.storeId)).forEach(r => {
    const row = costMap[r.materialId]; if (!row) return;
    row.endQty += r.qty; row.stockValue += r.qty * (r.avgCost ?? materialOf(r.materialId)?.standardCost ?? 0);
  });
  const materialCosts = Object.values(costMap).map(x => ({
    ...x, consumeQty: r4n(x.consumeQty), consumeCost: r2n(x.consumeCost), purchaseQty: r4n(x.purchaseQty),
    purchaseAmount: r2n(x.purchaseAmount), damageCost: r2n(x.damageCost), lossCost: r2n(x.lossCost),
    gainCost: r2n(x.gainCost), endQty: r4n(x.endQty), stockValue: r2n(x.stockValue),
  })).sort((a, b) => b.consumeCost - a.consumeCost);

  /* 2) 理论库存 vs 实际库存差异：以区间内各店最近一次盘点为口径（盘盈/盘亏即理论与实际差异） */
  const storeVariance = stores.map(s => {
    const sks = db.stocktakes.filter(k => k.storeId === s.id && k.createdAt.slice(0, 10) >= from)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const latest = sks[0] || null;
    const periodLoss = sks.reduce((acc, k) => acc + k.lossCost, 0);
    const periodGain = sks.reduce((acc, k) => acc + k.gainCost, 0);
    const diffItems = latest ? latest.items.filter(i => i.diffQty !== 0).map(i => {
      const rec = db.stockRecords.find(r => r.storeId === s.id && r.materialId === i.materialId);
      return {
        materialId: i.materialId, materialName: materialOf(i.materialId)?.name, unit: materialOf(i.materialId)?.unit,
        bookQty: i.bookQty, actualQty: i.actualQty, diffQty: i.diffQty,
        diffCost: r2n(i.diffQty * (rec?.avgCost ?? 0)),
      };
    }) : [];
    return {
      storeId: s.id, storeName: s.name, stocktakeCount: sks.length,
      latestAt: latest?.createdAt || null, latestLoss: latest ? r2n(latest.lossCost) : 0, latestGain: latest ? r2n(latest.gainCost) : 0,
      periodLoss: r2n(periodLoss), periodGain: r2n(periodGain), diffItems,
    };
  });
  const matVarMap = {};
  db.stocktakes.filter(k => storeIds.includes(k.storeId) && k.createdAt.slice(0, 10) >= from).forEach(k => {
    k.items.forEach(i => {
      if (i.diffQty === 0) return;
      const row = matVarMap[i.materialId] || (matVarMap[i.materialId] = { materialId: i.materialId, name: materialOf(i.materialId)?.name, unit: materialOf(i.materialId)?.unit, diffQty: 0, lossCost: 0, gainCost: 0, times: 0 });
      row.diffQty += i.diffQty; row.times += 1;
      const rec = db.stockRecords.find(r => r.storeId === k.storeId && r.materialId === i.materialId);
      const c = i.diffQty * (rec?.avgCost ?? 0);
      if (c < 0) row.lossCost += -c; else row.gainCost += c;
    });
  });
  const materialVariance = Object.values(matVarMap).map(x => ({ ...x, diffQty: r4n(x.diffQty), lossCost: r2n(x.lossCost), gainCost: r2n(x.gainCost) }))
    .sort((a, b) => b.lossCost - a.lossCost);

  /* 3) 门店损耗率 = （报损 + 盘亏 - 盘盈）/ 理论耗材耗用成本 */
  const storeLoss = stores.map(s => {
    let consumeCost = 0, damage = 0, loss = 0, gain = 0;
    db.stockLedger.filter(l => l.storeId === s.id && inRange(l.time)).forEach(l => {
      if (l.type === 'consume') consumeCost += -l.qty * l.unitCost;
      else if (l.type === 'consume_revert') consumeCost -= l.qty * l.unitCost;
      else if (l.type === 'damage') damage += -l.qty * l.unitCost;
      else if (l.type === 'stocktake_adjust') { if (l.qty < 0) loss += -l.qty * l.unitCost; else gain += l.qty * l.unitCost; }
    });
    const netLoss = damage + loss - gain;
    return { storeId: s.id, storeName: s.name, consumeCost: r2n(consumeCost), damage: r2n(damage), stockLoss: r2n(loss), stockGain: r2n(gain), netLoss: r2n(netLoss), lossRate: consumeCost > 0 ? r4n(netLoss / consumeCost) : 0 };
  }).sort((a, b) => b.lossRate - a.lossRate);

  /* 4) 项目毛利：收入 - 技师提成 - 耗材成本（按开单时点快照成本） */
  const orders = effectiveOrders(db.orders.filter(o => storeIds.includes(o.storeId) && o.businessDate >= from && o.businessDate <= to));
  const svcMap = {};
  orders.forEach(o => {
    const row = svcMap[o.serviceId] || (svcMap[o.serviceId] = { serviceId: o.serviceId, name: db.services.find(v => v.id === o.serviceId)?.name, category: db.services.find(v => v.id === o.serviceId)?.category, count: 0, revenue: 0, commission: 0, materialCost: 0 });
    row.count += 1; row.revenue += o.amount; row.commission += o.techCommission; row.materialCost += o.materialCost || 0;
  });
  const projectProfit = Object.values(svcMap).map(x => {
    const gross = x.revenue - x.commission - x.materialCost;
    return { ...x, revenue: r2n(x.revenue), commission: r2n(x.commission), materialCost: r2n(x.materialCost), grossProfit: r2n(gross), margin: x.revenue > 0 ? r4n(gross / x.revenue) : 0 };
  }).sort((a, b) => b.grossProfit - a.grossProfit);
  const totalRev = orders.reduce((a, o) => a + o.amount, 0);
  const totalComm = orders.reduce((a, o) => a + o.techCommission, 0);
  const totalMat = orders.reduce((a, o) => a + (o.materialCost || 0), 0);
  const totals = {
    revenue: r2n(totalRev), commission: r2n(totalComm), materialCost: r2n(totalMat),
    grossProfit: r2n(totalRev - totalComm - totalMat),
    margin: totalRev > 0 ? r4n((totalRev - totalComm - totalMat) / totalRev) : 0,
    purchaseAmount: r2n(materialCosts.reduce((a, x) => a + x.purchaseAmount, 0)),
    stockValue: r2n(materialCosts.reduce((a, x) => a + x.stockValue, 0)),
    netLoss: r2n(storeLoss.reduce((a, x) => a + x.netLoss, 0)),
  };

  json(res, { range: { from, to, days }, totals, materialCosts, storeVariance, materialVariance, storeLoss, projectProfit });
}, { auth: true, role: 'hq' });

/* ---------------- 静态文件 ---------------- */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
};
function serveStatic(req, res, pathname) {
  const rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname.slice(1).split('?')[0]);
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(file, (err, data) => {
    if (err) {
      fs.readFile(path.join(PUBLIC_DIR, 'index.html'), (e2, idx) => {
        if (e2) { res.writeHead(404); res.end('Not Found'); }
        else { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(idx); }
      });
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
}

/* ---------------- 服务入口 ---------------- */
const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;
  try {
    if (pathname.startsWith('/api/')) {
      const route = routes.find(x => x.method === req.method && x.pattern.test(pathname));
      if (!route) return fail(res, '接口不存在', 404);
      let user = null;
      if (route.auth) {
        user = requireAuth(req, res);
        if (!user) return;
        if (route.role === 'hq' && user.role !== 'hq') return fail(res, '仅总部账号可操作', 403);
      }
      const body = ['POST', 'PUT', 'PATCH'].includes(req.method) ? await readBody(req) : {};
      const m = pathname.match(route.pattern);
      await route.handler(req, res, { query: parsed.query }, user, m, body);
    } else {
      serveStatic(req, res, pathname);
    }
  } catch (e) {
    console.error(e);
    fail(res, '服务器内部错误：' + e.message, 500);
  }
});

server.listen(PORT, () => {
  console.log(`悦足堂管理平台已启动: http://localhost:${PORT}`);
  console.log('总部账号 hq / 123456 ，门店账号 s01 / 123456');
});
