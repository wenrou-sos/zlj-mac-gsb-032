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
ensureSchema(db);
syncCounters();

/* 旧库兼容：补齐库存核算相关表与字段 */
function ensureSchema(d) {
  const tables = ['materials', 'recipes', 'stockBalances', 'stockMovements', 'purchaseOrders',
    'stockChecks', 'stockLosses', 'inventoryTransfers', 'inventoryAlerts'];
  for (const t of tables) if (!Array.isArray(d[t])) d[t] = [];
  if (!d.inventoryPolicy || typeof d.inventoryPolicy !== 'object') d.inventoryPolicy = { shortageMode: 'strict', updatedAt: null };
  if (!['strict', 'negative'].includes(d.inventoryPolicy.shortageMode)) d.inventoryPolicy.shortageMode = 'strict';
}

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
    material: 'materials',
    purchaseOrder: 'purchaseOrders', stockCheck: 'stockChecks', stockLoss: 'stockLosses',
    inventoryTransfer: 'inventoryTransfers', stockMovement: 'stockMovements',
    inventoryAlert: 'inventoryAlerts',
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
    statusName: o.status === 'canceled' ? '已撤销' : o.status === 'reversed' ? '已冲正' : '正常',
  };
}

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

/* ---------------- 库存核算 ---------------- */
/* 有效账单：未撤销/未冲正（历史账单缺字段时视为有效） */
function isValidOrder(o) { return !o.status || o.status === 'valid'; }
function getMaterial(id) { return db.materials.find(m => m.id === id); }
function materialUnitCost(id, override) {
  if (Number(override) > 0) return Number(override);
  return getMaterial(id)?.defaultCost || 0;
}
function getBalance(storeId, materialId) {
  let b = db.stockBalances.find(x => x.storeId === storeId && x.materialId === materialId);
  if (!b) { b = { storeId, materialId, qty: 0 }; db.stockBalances.push(b); }
  return b;
}
/* 登记一条库存流水并更新余额；delta 正负分别代表入/出 */
function postMovement(storeId, materialId, delta, mv) {
  const b = getBalance(storeId, materialId);
  b.qty = Math.round((b.qty + delta) * 100) / 100;
  db.stockMovements.push({
    id: nextId('stockMovement', 'MV', 7),
    refType: mv.refType, refId: mv.refId || null,
    storeId, materialId,
    direction: delta >= 0 ? 'in' : 'out',
    qty: Math.round(Math.abs(delta) * 100) / 100,
    unitCost: materialUnitCost(materialId, mv.unitCost),
    balanceAfter: b.qty,
    operator: mv.operator || '', remark: mv.remark || '',
    createdAt: mv.createdAt || nowLocal(),
  });
  return b;
}
/* 当前生效配方（数组） */
function getRecipeLines(serviceId) {
  return (db.recipes.find(r => r.serviceId === serviceId)?.lines || []);
}
/* 开单时固化配方快照：后续修改配方/成本均不影响历史 */
function buildRecipeSnapshot(serviceId) {
  return getRecipeLines(serviceId).map(l => {
    const m = getMaterial(l.materialId);
    return { materialId: l.materialId, materialName: m?.name || l.materialId, unit: m?.unit || '', qty: Number(l.qty), unitCost: m?.defaultCost || 0 };
  });
}
function snapshotCost(snap) { return Math.round(snap.reduce((a, l) => a + l.qty * l.unitCost, 0) * 100) / 100; }
/* 按快照检查库存是否充足，返回缺口清单 */
function shortageList(storeId, snapshot) {
  return snapshot
    .filter(l => (getBalance(storeId, l.materialId)?.qty || 0) < l.qty)
    .map(l => ({ materialId: l.materialId, materialName: l.materialName, unit: l.unit, need: l.qty, have: getBalance(storeId, l.materialId)?.qty || 0, gap: l.qty - (getBalance(storeId, l.materialId)?.qty || 0) }));
}
function storeNameOf(id) { return db.stores.find(s => s.id === id)?.name || id; }
function materialNameOf(id) { return getMaterial(id)?.name || id; }
const MOVE_META = {
  init: { label: '期初建账', dir: 'in' },
  purchase: { label: '采购入库', dir: 'in' },
  consume: { label: '项目耗用', dir: 'out' },
  consume_reverse: { label: '冲正回补', dir: 'in' },
  check: { label: '盘点调整', dir: 'both' },
  loss: { label: '报损', dir: 'out' },
  transfer_out: { label: '调拨调出', dir: 'out' },
  transfer_in: { label: '调拨入库', dir: 'in' },
  transfer_cancel: { label: '调拨取消回补', dir: 'in' },
};
function movementView(x) {
  return {
    ...x,
    typeName: MOVE_META[x.refType]?.label || x.refType,
    materialName: materialNameOf(x.materialId),
    spec: getMaterial(x.materialId)?.spec || '',
    storeName: storeNameOf(x.storeId),
  };
}
function transferView(t) {
  return {
    ...t,
    fromStoreName: storeNameOf(t.fromStoreId), toStoreName: storeNameOf(t.toStoreId),
    lineViews: t.lines.map(l => ({ ...l, materialName: materialNameOf(l.materialId), unit: getMaterial(l.materialId)?.unit || '', spec: getMaterial(l.materialId)?.spec || '' })),
    statusName: { draft: '草稿', in_transit: '待调入确认', confirmed: '已完成', canceled: '已取消' }[t.status] || t.status,
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
  const orders = db.orders.filter(o => o.businessDate >= from && o.businessDate <= to && isValidOrder(o));
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
    trend.push({ date: d, revenue: db.orders.filter(o => o.businessDate === d && isValidOrder(o)).reduce((a, o) => a + o.amount, 0) });
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
  const so = db.orders.filter(o => o.shiftId === shift.id && isValidOrder(o));
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
  const orders = db.orders.filter(o => o.businessDate >= from && o.businessDate <= to && o.storeId === storeId && isValidOrder(o));
  const todayOrders = db.orders.filter(o => o.storeId === storeId && o.businessDate === to && isValidOrder(o));
  const openShift = shiftView(db.shifts.find(s => s.storeId === storeId && s.status === 'open'));

  const trend = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = daysAgoStr(i);
    const dayO = db.orders.filter(o => o.storeId === storeId && o.businessDate === d && isValidOrder(o));
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
    materials: db.materials, recipes: db.recipes, inventoryPolicy: db.inventoryPolicy,
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
  const orders = db.orders.filter(o => o.shiftId === s.id && isValidOrder(o));
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
  const orders = db.orders.filter(o => o.shiftId === h.shiftId && isValidOrder(o)).map(orderView)
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
  const mem = body.memberId ? db.members.find(x => x.id === body.memberId) : null;
  const rate = mem ? memberLevel(mem).discount : 1;
  const amount = Math.round(svc.price * rate);
  const cm = calcCommission(svc.id, tech.levelId, amount);
  const storeId = user.role === 'store' ? user.storeId : (body.storeId || null);
  const snapshot = buildRecipeSnapshot(svc.id);
  const materialCost = snapshotCost(snapshot);
  const stock = snapshot.map(l => ({ ...l, stockQty: storeId ? (getBalance(storeId, l.materialId)?.qty || 0) : null }));
  const shortage = storeId ? shortageList(storeId, snapshot) : [];
  json(res, {
    price: svc.price, discountRate: rate, amount, commission: cm.value, basis: cm.basis, balance: mem ? mem.balance : null,
    materials: stock, materialCost, shortage, shortageMode: db.inventoryPolicy.shortageMode,
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
  const now = nowLocal();
  // 按当时配方快照核算耗材（固化成本与用量，后续配方/成本调整不影响本单）
  const materialSnapshot = buildRecipeSnapshot(svc.id);
  const materialCost = snapshotCost(materialSnapshot);
  const shortage = shortageList(storeId, materialSnapshot);
  let negativeAlert = null;
  if (shortage.length) {
    if (db.inventoryPolicy.shortageMode === 'strict') {
      return fail(res, `耗材库存不足，禁止开单：${shortage.map(x => `${x.materialName}（缺 ${x.gap}${x.unit}）`).join('、')}。请先采购入库或向其他门店申请调拨`);
    }
    negativeAlert = {
      id: nextId('inventoryAlert', 'AL', 6), storeId, orderId: null, type: 'negative',
      content: `负库存开单：${shortage.map(x => `${x.materialName}缺${x.gap}${x.unit}`).join('、')}`,
      detail: shortage, handled: 0, createdAt: now,
    };
  }
  const order = {
    id: nextId('order', 'O', 7), orderNo: `${todayStr().replace(/-/g, '')}${String(db.counters.order).padStart(5, '0').slice(-5)}`,
    storeId, shiftId: shift.id, serviceId: svc.id, techId: tech.id, memberId,
    price: svc.price, discountRate, amount, payMethod, techCommission: cm.value,
    duration: svc.duration, createdAt: now, businessDate: todayStr(),
    status: 'valid', stockDeducted: 1, stockReversed: 0,
    materialSnapshot, materialCost,
  };
  db.orders.push(order);
  if (memberId) {
    const mem = db.members.find(x => x.id === memberId);
    mem.balance -= amount; mem.totalConsume += amount;
  }
  // 按快照逐品项扣减库存（负库存模式下允许扣成负数）
  materialSnapshot.forEach(l => {
    postMovement(storeId, l.materialId, -l.qty, {
      refType: 'consume', refId: order.id, unitCost: l.unitCost,
      operator: user.name, remark: `${svc.name}（账单 ${order.orderNo}）耗用`, createdAt: now,
    });
  });
  if (negativeAlert) { negativeAlert.orderId = order.id; db.inventoryAlerts.push(negativeAlert); }
  save();
  json(res, { ...order, commissionBasis: cm.basis, payMethodName: payLabel(payMethod), negativeAlert });
}, { auth: true });

/* ===== 账单撤销 / 冲正（库存只回补一次） ===== */
r('POST', /^\/api\/orders\/(\w+)\/reverse$/, async (req, res, p, user, m, body) => {
  const o = db.orders.find(x => x.id === m[1]);
  if (!o) return fail(res, '账单不存在', 404);
  if (user.role === 'store' && o.storeId !== user.storeId) return fail(res, '无权冲正他店账单', 403);
  if (!isValidOrder(o)) return fail(res, '该账单已撤销/冲正，不能重复操作', 409);
  if (o.businessDate !== todayStr()) return fail(res, '仅可冲正当日账单，历史账单已封账', 403);
  const now = nowLocal();
  o.status = body.reason && /错|误|录错/.test(body.reason) ? 'canceled' : 'reversed';
  o.reverseReason = body.reason || '门店冲正';
  o.reversedAt = now;
  o.reversedBy = user.name;
  // 回补库存：仅回补一次（以 stockReversed 幂等标记保护，重复调用在入口即被拦截）
  if (o.stockDeducted && !o.stockReversed && Array.isArray(o.materialSnapshot)) {
    o.materialSnapshot.forEach(l => {
      postMovement(o.storeId, l.materialId, l.qty, {
        refType: 'consume_reverse', refId: o.id, unitCost: l.unitCost,
        operator: user.name, remark: `${o.orderNo} ${o.status === 'canceled' ? '撤销' : '冲正'}回补`, createdAt: now,
      });
    });
    o.stockReversed = 1;
  }
  // 会员卡支付的账单冲正，余额原路退回
  if (o.payMethod === 'member' && o.memberId) {
    const mem = db.members.find(x => x.id === o.memberId);
    if (mem) mem.balance += o.amount;
  }
  save();
  json(res, orderView(o));
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
    const os = db.orders.filter(o => o.techId === t.id && o.businessDate >= from && o.businessDate <= to && isValidOrder(o));
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

/* ====================================================================== */
/* ==================== 项目耗材与门店库存核算 ========================== */
/* ====================================================================== */

/* ----- 耗材档案（总部维护采购成本） ----- */
r('GET', /^\/api\/materials$/, async (req, res) => {
  json(res, db.materials.map(m => {
    const storesHolding = db.stockBalances.filter(b => b.materialId === m.id);
    const totalQty = storesHolding.reduce((a, b) => a + b.qty, 0);
    return { ...m, totalQty: Math.round(totalQty * 100) / 100 };
  }));
}, { auth: true });
r('POST', /^\/api\/materials$/, async (req, res, p, user, m, body) => {
  if (!body.name || !body.unit) return fail(res, '耗材名称与计量单位必填');
  const cost = Number(body.defaultCost);
  if (!(cost >= 0)) return fail(res, '采购成本需为不小于 0 的数字');
  const mat = {
    id: nextId('material', 'MA', 3), name: String(body.name).trim(),
    spec: body.spec || '', unit: String(body.unit).trim(),
    category: body.category || '其他耗材', defaultCost: cost, active: 1,
  };
  db.materials.push(mat);
  save(); json(res, mat);
}, { auth: true, role: 'hq' });
r('PUT', /^\/api\/materials\/(\w+)$/, async (req, res, p, user, m, body) => {
  const mat = db.materials.find(x => x.id === m[1]);
  if (!mat) return fail(res, '耗材不存在', 404);
  ['name', 'spec', 'unit', 'category'].forEach(k => { if (body[k] !== undefined) mat[k] = body[k]; });
  if (body.defaultCost !== undefined) {
    const cost = Number(body.defaultCost);
    if (!(cost >= 0)) return fail(res, '采购成本需为不小于 0 的数字');
    mat.defaultCost = cost;   // 调价只影响后续采购/开单，历史账单快照不变
  }
  if (body.active !== undefined) mat.active = Number(body.active) ? 1 : 0;
  save(); json(res, mat);
}, { auth: true, role: 'hq' });

/* ----- 服务项目配方（总部维护标准耗用） ----- */
r('GET', /^\/api\/recipes$/, async (req, res) => {
  const recipes = db.services.map(v => {
    const r = db.recipes.find(x => x.serviceId === v.id);
    const lines = (r?.lines || []).map(l => {
      const mat = getMaterial(l.materialId);
      return { materialId: l.materialId, materialName: mat?.name || l.materialId, spec: mat?.spec || '', unit: mat?.unit || '', qty: l.qty, unitCost: mat?.defaultCost || 0 };
    });
    return {
      serviceId: v.id, serviceName: v.name, category: v.category, active: v.active,
      lines, updatedAt: r?.updatedAt || null,
      costPerOrder: snapshotCost(lines),
    };
  });
  json(res, { recipes, materials: db.materials });
}, { auth: true });
r('PUT', /^\/api\/recipes\/(\w+)$/, async (req, res, p, user, m, body) => {
  const svc = db.services.find(v => v.id === m[1]);
  if (!svc) return fail(res, '服务项目不存在', 404);
  if (!Array.isArray(body.lines)) return fail(res, '配方明细格式不正确');
  const lines = [];
  for (const l of body.lines) {
    const mat = getMaterial(l.materialId);
    if (!mat) return fail(res, `耗材不存在：${l.materialId}`);
    const qty = Number(l.qty);
    if (!(qty > 0)) return fail(res, `「${mat.name}」用量需大于 0`);
    if (!lines.some(x => x.materialId === mat.id)) lines.push({ materialId: mat.id, qty });
  }
  let r = db.recipes.find(x => x.serviceId === svc.id);
  if (!r) { r = { serviceId: svc.id, lines: [], updatedAt: null }; db.recipes.push(r); }
  r.lines = lines; r.updatedAt = nowLocal();   // 仅影响之后开单，历史账单保留各自快照
  save(); json(res, { serviceId: svc.id, lines: r.lines, updatedAt: r.updatedAt });
}, { auth: true, role: 'hq' });

/* ----- 缺货策略（总部配置：禁止开单 / 允许负库存预警） ----- */
r('GET', /^\/api\/inventory-policy$/, async (req, res) => json(res, db.inventoryPolicy), { auth: true });
r('PUT', /^\/api\/inventory-policy$/, async (req, res, p, user, m, body) => {
  if (!['strict', 'negative'].includes(body.shortageMode)) return fail(res, '策略取值无效');
  db.inventoryPolicy.shortageMode = body.shortageMode;
  db.inventoryPolicy.updatedAt = nowLocal();
  save(); json(res, db.inventoryPolicy);
}, { auth: true, role: 'hq' });

/* ----- 门店库存查询（含低库存/缺货、在途调入） ----- */
const LOW_QTY_BY_UNIT = { ml: 200 };
function stockLevel(qty, unit) {
  if (qty <= 0) return 'out';
  if (qty < (LOW_QTY_BY_UNIT[unit] || 50)) return 'low';
  return 'ok';
}
r('GET', /^\/api\/stores\/(\w+)\/inventory$/, async (req, res, p, user, m) => {
  const sid = m[1];
  if (user.role === 'store' && user.storeId !== sid) return fail(res, '无权查看他店库存', 403);
  if (!db.stores.find(s => s.id === sid)) return fail(res, '门店不存在', 404);
  const items = db.materials.filter(x => x.active).map(mat => {
    const b = getBalance(sid, mat.id);
    return { ...mat, qty: b.qty, amount: Math.round(b.qty * mat.defaultCost * 100) / 100, level: stockLevel(b.qty, mat.unit) };
  }).sort((a, b) => a.id.localeCompare(b.id));
  const incoming = db.inventoryTransfers
    .filter(t => t.toStoreId === sid && t.status === 'in_transit')
    .flatMap(t => t.lines.map(l => ({ ...l, transferId: t.id, fromStoreName: storeNameOf(t.fromStoreId), materialName: materialNameOf(l.materialId) })));
  json(res, {
    policy: db.inventoryPolicy, items, incoming,
    summary: {
      skuCount: items.length,
      outCount: items.filter(i => i.level === 'out').length,
      lowCount: items.filter(i => i.level === 'low').length,
      totalAmount: Math.round(items.reduce((a, i) => a + i.amount, 0) * 100) / 100,
      openAlerts: db.inventoryAlerts.filter(a => a.storeId === sid && !a.handled).length,
    },
  });
}, { auth: true });

/* ----- 采购入库 ----- */
r('GET', /^\/api\/purchase-orders$/, async (req, res, p, user) => {
  let list = db.purchaseOrders;
  if (user.role === 'store') list = list.filter(x => x.storeId === user.storeId);
  else if (p.query.storeId) list = list.filter(x => x.storeId === p.query.storeId);
  json(res, list.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 200).map(po => ({
    ...po, storeName: storeNameOf(po.storeId),
    lineViews: po.lines.map(l => ({ ...l, materialName: materialNameOf(l.materialId), unit: getMaterial(l.materialId)?.unit || '' })),
  })));
}, { auth: true });
r('POST', /^\/api\/purchase-orders$/, async (req, res, p, user, m, body) => {
  const storeId = user.role === 'store' ? user.storeId : (body.storeId || null);
  if (!storeId) return fail(res, '请选择门店');
  if (!Array.isArray(body.lines) || !body.lines.length) return fail(res, '请填写采购明细');
  const lines = [];
  for (const l of body.lines) {
    const mat = getMaterial(l.materialId);
    if (!mat) return fail(res, `耗材不存在：${l.materialId}`);
    const qty = Number(l.qty);
    if (!(qty > 0)) return fail(res, `「${mat.name}」采购数量需大于 0`);
    const unitCost = l.unitCost !== undefined && l.unitCost !== '' ? Number(l.unitCost) : mat.defaultCost;
    if (!(unitCost >= 0)) return fail(res, `「${mat.name}」采购成本无效`);
    lines.push({ materialId: mat.id, qty, unitCost, amount: Math.round(qty * unitCost * 100) / 100 });
  }
  const now = nowLocal();
  const po = {
    id: nextId('purchaseOrder', 'PO', 6), storeId, supplier: String(body.supplier || '').trim() || '总部统采',
    operator: user.name, lines, totalAmount: Math.round(lines.reduce((a, l) => a + l.amount, 0) * 100) / 100,
    createdAt: now,
  };
  db.purchaseOrders.push(po);
  lines.forEach(l => postMovement(storeId, l.materialId, l.qty, {
    refType: 'purchase', refId: po.id, unitCost: l.unitCost,
    operator: user.name, remark: `采购入库 · ${po.supplier}`, createdAt: now,
  }));
  save(); json(res, po);
}, { auth: true });

/* ----- 盘点（系统数自动取账面，录入实盘数，差异经审批后一次过账） ----- */
r('GET', /^\/api\/stock-checks$/, async (req, res, p, user) => {
  let list = db.stockChecks;
  if (user.role === 'store') list = list.filter(x => x.storeId === user.storeId);
  else if (p.query.storeId) list = list.filter(x => x.storeId === p.query.storeId);
  json(res, list.slice().sort((a, b) => b.confirmedAt.localeCompare(a.confirmedAt)).slice(0, 100).map(ck => ({
    ...ck, storeName: storeNameOf(ck.storeId),
    lineViews: ck.lines.map(l => ({ ...l, materialName: materialNameOf(l.materialId), unit: getMaterial(l.materialId)?.unit || '', diffAmount: Math.round(l.diff * getMaterial(l.materialId).defaultCost * 100) / 100 })),
  })));
}, { auth: true });
r('POST', /^\/api\/stock-checks$/, async (req, res, p, user, m, body) => {
  const storeId = user.role === 'store' ? user.storeId : (body.storeId || null);
  if (!storeId) return fail(res, '请选择门店');
  if (!Array.isArray(body.lines) || !body.lines.length) return fail(res, '请录入盘点明细');
  const lines = [];
  for (const l of body.lines) {
    const mat = getMaterial(l.materialId);
    if (!mat) return fail(res, `耗材不存在：${l.materialId}`);
    const actualQty = Number(l.actualQty);
    if (!(actualQty >= 0)) return fail(res, `「${mat.name}」实盘数量无效`);
    const systemQty = getBalance(storeId, mat.id).qty;
    const diff = Math.round((actualQty - systemQty) * 100) / 100;
    lines.push({ materialId: mat.id, systemQty, actualQty, diff });
  }
  const now = nowLocal();
  const ck = {
    id: nextId('stockCheck', 'CK', 6), storeId, status: 'closed',
    operator: user.name, remark: String(body.remark || ''),
    lines, createdAt: now, confirmedAt: now,
  };
  db.stockChecks.push(ck);
  lines.filter(l => l.diff !== 0).forEach(l => postMovement(storeId, l.materialId, l.diff, {
    refType: 'check', refId: ck.id, operator: user.name,
    remark: `盘点${l.diff > 0 ? '盘盈' : '盘亏'}调整${ck.remark ? ' · ' + ck.remark : ''}`, createdAt: now,
  }));
  save(); json(res, ck);
}, { auth: true });

/* ----- 报损 ----- */
r('GET', /^\/api\/stock-losses$/, async (req, res, p, user) => {
  let list = db.stockLosses;
  if (user.role === 'store') list = list.filter(x => x.storeId === user.storeId);
  else if (p.query.storeId) list = list.filter(x => x.storeId === p.query.storeId);
  json(res, list.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 100).map(ls => ({
    ...ls, storeName: storeNameOf(ls.storeId),
    lineViews: ls.lines.map(l => ({ ...l, materialName: materialNameOf(l.materialId), unit: getMaterial(l.materialId)?.unit || '' })),
  })));
}, { auth: true });
r('POST', /^\/api\/stock-losses$/, async (req, res, p, user, m, body) => {
  const storeId = user.role === 'store' ? user.storeId : (body.storeId || null);
  if (!storeId) return fail(res, '请选择门店');
  if (!body.reason) return fail(res, '请填写报损原因');
  if (!Array.isArray(body.lines) || !body.lines.length) return fail(res, '请填写报损明细');
  const lines = [];
  for (const l of body.lines) {
    const mat = getMaterial(l.materialId);
    if (!mat) return fail(res, `耗材不存在：${l.materialId}`);
    const qty = Number(l.qty);
    if (!(qty > 0)) return fail(res, `「${mat.name}」报损数量需大于 0`);
    const have = getBalance(storeId, mat.id).qty;
    if (qty > have) return fail(res, `「${mat.name}」账面仅剩 ${have}${mat.unit}，不能超量报损`);
    lines.push({ materialId: mat.id, qty, unitCost: mat.defaultCost, amount: Math.round(qty * mat.defaultCost * 100) / 100 });
  }
  const now = nowLocal();
  const ls = {
    id: nextId('stockLoss', 'LS', 6), storeId, reason: String(body.reason).trim(),
    operator: user.name, lines,
    totalAmount: Math.round(lines.reduce((a, l) => a + l.amount, 0) * 100) / 100,
    createdAt: now,
  };
  db.stockLosses.push(ls);
  lines.forEach(l => postMovement(storeId, l.materialId, -l.qty, {
    refType: 'loss', refId: ls.id, operator: user.name,
    remark: `报损 · ${ls.reason}`, createdAt: now,
  }));
  save(); json(res, ls);
}, { auth: true });

/* ----- 库存流水 ----- */
r('GET', /^\/api\/stock-movements$/, async (req, res, p, user) => {
  let list = db.stockMovements;
  if (user.role === 'store') list = list.filter(x => x.storeId === user.storeId);
  else if (p.query.storeId) list = list.filter(x => x.storeId === p.query.storeId);
  if (p.query.materialId) list = list.filter(x => x.materialId === p.query.materialId);
  if (p.query.type) list = list.filter(x => x.refType === p.query.type);
  if (p.query.from) list = list.filter(x => x.createdAt.slice(0, 10) >= p.query.from);
  if (p.query.to) list = list.filter(x => x.createdAt.slice(0, 10) <= p.query.to);
  json(res, list.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id)).slice(0, 300).map(movementView));
}, { auth: true });

/* ----- 跨店调拨：调出方发起 → 调入方确认；途中可由调出方取消；操作全部幂等 ----- */
r('GET', /^\/api\/inventory-transfers$/, async (req, res, p, user) => {
  let list = db.inventoryTransfers;
  if (user.role === 'store') list = list.filter(t => t.fromStoreId === user.storeId || t.toStoreId === user.storeId);
  if (p.query.status) list = list.filter(t => t.status === p.query.status);
  json(res, list.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(transferView));
}, { auth: true });
r('POST', /^\/api\/inventory-transfers$/, async (req, res, p, user, m, body) => {
  const fromStoreId = user.role === 'store' ? user.storeId : (body.fromStoreId || null);
  const toStoreId = body.toStoreId;
  if (!fromStoreId) return fail(res, '请选择调出门店');
  if (!db.stores.find(s => s.id === toStoreId)) return fail(res, '调入门店不存在');
  if (fromStoreId === toStoreId) return fail(res, '调入门店不能与调出门店相同');
  if (!Array.isArray(body.lines) || !body.lines.length) return fail(res, '请填写调拨明细');
  const lines = [];
  for (const l of body.lines) {
    const mat = getMaterial(l.materialId);
    if (!mat) return fail(res, `耗材不存在：${l.materialId}`);
    const qty = Number(l.qty);
    if (!(qty > 0)) return fail(res, `「${mat.name}」调拨数量需大于 0`);
    const available = getBalance(fromStoreId, mat.id).qty
      - db.inventoryTransfers.filter(t => t.fromStoreId === fromStoreId && t.status === 'in_transit')
        .reduce((a, t) => a + t.lines.filter(x => x.materialId === mat.id).reduce((z, x) => z + x.qty, 0), 0)
      + (lines.find(x => x.materialId === mat.id)?.qty || 0);
    if (qty > available) return fail(res, `「${mat.name}」可用库存不足（账面 ${getBalance(fromStoreId, mat.id).qty}${mat.unit}，另有在途占用）`);
    lines.push({ materialId: mat.id, qty });
  }
  const now = nowLocal();
  const t = {
    id: nextId('inventoryTransfer', 'IT', 6), fromStoreId, toStoreId, lines,
    reason: String(body.reason || '').trim(), status: 'in_transit',
    operator: user.name, confirmer: null,
    createdAt: now, confirmedAt: null, canceledAt: null, cancelReason: null,
  };
  db.inventoryTransfers.push(t);
  // 发起即从调出方出账（货物在途），确认后才进入调入方账面
  lines.forEach(l => postMovement(fromStoreId, l.materialId, -l.qty, {
    refType: 'transfer_out', refId: t.id, operator: user.name,
    remark: `调出至${storeNameOf(toStoreId)}（待确认）`, createdAt: now,
  }));
  save(); json(res, transferView(t));
}, { auth: true });
r('POST', /^\/api\/inventory-transfers\/(\w+)\/confirm$/, async (req, res, p, user, m) => {
  const t = db.inventoryTransfers.find(x => x.id === m[1]);
  if (!t) return fail(res, '调拨单不存在', 404);
  if (t.status === 'confirmed') return fail(res, '该调拨单已确认入账，请勿重复确认', 409);
  if (t.status === 'canceled') return fail(res, '该调拨单已在途中取消，不能确认', 409);
  if (user.role === 'store' && t.toStoreId !== user.storeId) return fail(res, '仅调入门店可以确认收货', 403);
  const now = nowLocal();
  t.status = 'confirmed'; t.confirmedAt = now; t.confirmer = user.name;
  t.lines.forEach(l => postMovement(t.toStoreId, l.materialId, l.qty, {
    refType: 'transfer_in', refId: t.id, operator: user.name,
    remark: `由${storeNameOf(t.fromStoreId)}调入`, createdAt: now,
  }));
  save(); json(res, transferView(t));
}, { auth: true });
r('POST', /^\/api\/inventory-transfers\/(\w+)\/cancel$/, async (req, res, p, user, m, body) => {
  const t = db.inventoryTransfers.find(x => x.id === m[1]);
  if (!t) return fail(res, '调拨单不存在', 404);
  if (t.status === 'canceled') return fail(res, '该调拨单已取消，请勿重复操作', 409);
  if (t.status === 'confirmed') return fail(res, '调拨已确认入账，不能取消，请改走反向调拨', 409);
  if (user.role === 'store' && t.fromStoreId !== user.storeId) return fail(res, '仅调出门店可以在途中取消', 403);
  const now = nowLocal();
  t.status = 'canceled'; t.canceledAt = now; t.cancelReason = String(body.reason || '').trim() || '调出方取消';
  // 取消时把在途货物原路回补调出方（与发起时的出库一一对应，重复取消在入口即被拦截）
  t.lines.forEach(l => postMovement(t.fromStoreId, l.materialId, l.qty, {
    refType: 'transfer_cancel', refId: t.id, operator: user.name,
    remark: `取消调拨回补（${t.cancelReason}）`, createdAt: now,
  }));
  save(); json(res, transferView(t));
}, { auth: true });

/* ----- 库存预警（负库存开单自动产生） ----- */
r('GET', /^\/api\/inventory-alerts$/, async (req, res, p, user) => {
  let list = db.inventoryAlerts;
  if (user.role === 'store') list = list.filter(a => a.storeId === user.storeId);
  else if (p.query.storeId) list = list.filter(a => a.storeId === p.query.storeId);
  if (p.query.handled !== undefined) list = list.filter(a => String(a.handled) === p.query.handled);
  json(res, list.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 200).map(a => ({
    ...a, storeName: storeNameOf(a.storeId),
    orderNo: a.orderId ? db.orders.find(o => o.id === a.orderId)?.orderNo : null,
  })));
}, { auth: true });
r('POST', /^\/api\/inventory-alerts\/(\w+)\/handle$/, async (req, res, p, user, m) => {
  const a = db.inventoryAlerts.find(x => x.id === m[1]);
  if (!a) return fail(res, '预警不存在', 404);
  if (user.role === 'store' && a.storeId !== user.storeId) return fail(res, '无权处理他店预警', 403);
  a.handled = 1; a.handledAt = nowLocal(); a.handledBy = user.name;
  save(); json(res, a);
}, { auth: true });

/* ----- 总部库存分析：耗材成本 / 账实差异 / 门店损耗率 / 项目毛利 ----- */
r('GET', /^\/api\/hq\/inventory-analysis$/, async (req, res, p) => {
  const from = p.query.from || daysAgoStr(29), to = p.query.to || todayStr();
  const inRange = (x) => x.createdAt.slice(0, 10) >= from && x.createdAt.slice(0, 10) <= to;
  const mvs = db.stockMovements.filter(inRange);
  const orders = db.orders.filter(o => o.businessDate >= from && o.businessDate <= to && isValidOrder(o));

  /* 耗材成本表 */
  const materials = db.materials.map(mat => {
    const mv = mvs.filter(x => x.materialId === mat.id);
    const sumQty = (types, dir) => mv.filter(x => types.includes(x.refType) && x.direction === dir).reduce((a, x) => a + x.qty, 0);
    const sumAmt = (types, dir) => mv.filter(x => types.includes(x.refType) && x.direction === dir).reduce((a, x) => a + x.qty * x.unitCost, 0);
    const consumeQty = mv.filter(x => x.refType === 'consume').reduce((a, x) => a + x.qty, 0)
      - mv.filter(x => x.refType === 'consume_reverse').reduce((a, x) => a + x.qty, 0);
    const consumeAmt = mv.filter(x => x.refType === 'consume').reduce((a, x) => a + x.qty * x.unitCost, 0)
      - mv.filter(x => x.refType === 'consume_reverse').reduce((a, x) => a + x.qty * x.unitCost, 0);
    const endQty = db.stockBalances.filter(b => b.materialId === mat.id).reduce((a, b) => a + b.qty, 0);
    return {
      id: mat.id, name: mat.name, spec: mat.spec, unit: mat.unit, defaultCost: mat.defaultCost,
      purchaseQty: Math.round(sumQty(['purchase'], 'in') * 100) / 100,
      purchaseAmount: Math.round(sumAmt(['purchase'], 'in') * 100) / 100,
      consumeQty: Math.round(consumeQty * 100) / 100,
      consumeAmount: Math.round(consumeAmt * 100) / 100,
      lossAmount: Math.round(sumAmt(['loss'], 'out') * 100) / 100,
      endQty: Math.round(endQty * 100) / 100,
      endAmount: Math.round(endQty * mat.defaultCost * 100) / 100,
      shortageStoreCount: db.stockBalances.filter(b => b.materialId === mat.id && b.qty <= 0).length,
    };
  });

  /* 门店损耗率（报损+盘亏金额 / 项目耗材理论耗用金额） */
  const stores = db.stores.map(s => {
    const sm = mvs.filter(x => x.storeId === s.id);
    const amt = (types, dir) => sm.filter(x => types.includes(x.refType) && x.direction === dir).reduce((a, x) => a + x.qty * x.unitCost, 0);
    const purchaseAmount = amt(['purchase', 'transfer_in'], 'in');
    const lossAmount = amt(['loss'], 'out') + amt(['check'], 'out');
    const consumeAmount = sm.filter(x => x.refType === 'consume').reduce((a, x) => a + x.qty * x.unitCost, 0)
      - sm.filter(x => x.refType === 'consume_reverse').reduce((a, x) => a + x.qty * x.unitCost, 0);
    const endAmount = db.stockBalances.filter(b => b.storeId === s.id).reduce((a, b) => a + b.qty * (getMaterial(b.materialId)?.defaultCost || 0), 0);
    return {
      storeId: s.id, name: s.name, city: s.city,
      purchaseAmount: Math.round(purchaseAmount * 100) / 100,
      consumeAmount: Math.round(consumeAmount * 100) / 100,
      lossAmount: Math.round(lossAmount * 100) / 100,
      endAmount: Math.round(endAmount * 100) / 100,
      lossRate: consumeAmount > 0 ? lossAmount / consumeAmount : null,
      openAlertCount: db.inventoryAlerts.filter(a => a.storeId === s.id && !a.handled).length,
    };
  }).sort((a, b) => (b.lossRate || 0) - (a.lossRate || 0));

  /* 项目毛利（收入 − 耗材成本快照 − 技师提成） */
  const services = db.services.map(v => {
    const os = orders.filter(o => o.serviceId === v.id);
    const revenue = os.reduce((a, o) => a + o.amount, 0);
    const materialCost = os.reduce((a, o) => a + (o.materialCost || (o.materialSnapshot ? snapshotCost(o.materialSnapshot) : 0)), 0);
    const commission = os.reduce((a, o) => a + o.techCommission, 0);
    const grossProfit = revenue - materialCost - commission;
    return {
      serviceId: v.id, name: v.name, category: v.category, orders: os.length,
      revenue, materialCost: Math.round(materialCost * 100) / 100, commission,
      grossProfit: Math.round(grossProfit * 100) / 100,
      margin: revenue > 0 ? grossProfit / revenue : null,
      avgCostPerOrder: os.length ? Math.round(materialCost / os.length * 100) / 100 : 0,
    };
  }).filter(x => x.orders > 0 || db.recipes.some(r => r.serviceId === x.serviceId))
    .sort((a, b) => b.revenue - a.revenue);

  /* 账实差异：取每店每耗材最近一次盘点 */
  const varianceMap = new Map();
  db.stockChecks.slice().sort((a, b) => a.confirmedAt.localeCompare(b.confirmedAt)).forEach(ck => {
    ck.lines.forEach(l => {
      if (l.diff === 0) return;
      const mat = getMaterial(l.materialId);
      varianceMap.set(`${ck.storeId}|${l.materialId}`, {
        storeId: ck.storeId, storeName: storeNameOf(ck.storeId),
        materialId: l.materialId, materialName: mat?.name || l.materialId, unit: mat?.unit || '',
        systemQty: l.systemQty, actualQty: l.actualQty, diff: l.diff,
        diffAmount: Math.round(l.diff * (mat?.defaultCost || 0) * 100) / 100,
        checkedAt: ck.confirmedAt, checkId: ck.id,
      });
    });
  });
  const variance = [...varianceMap.values()].sort((a, b) => a.diff - b.diff).slice(0, 50);

  const alerts = db.inventoryAlerts.filter(a => !a.handled).slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 20)
    .map(a => ({ ...a, storeName: storeNameOf(a.storeId) }));

  json(res, {
    range: { from, to },
    summary: {
      purchaseAmount: materials.reduce((a, m) => a + m.purchaseAmount, 0),
      consumeAmount: materials.reduce((a, m) => a + m.consumeAmount, 0),
      lossAmount: materials.reduce((a, m) => a + m.lossAmount, 0),
      endAmount: materials.reduce((a, m) => a + m.endAmount, 0),
      revenue: services.reduce((a, s) => a + s.revenue, 0),
      grossProfit: services.reduce((a, s) => a + s.grossProfit, 0),
      openAlerts: alerts.length,
    },
    materials, stores, services, variance, alerts,
  });
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
