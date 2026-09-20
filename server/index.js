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
  const orders = db.orders.filter(o => o.businessDate >= from && o.businessDate <= to);
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
  const so = db.orders.filter(o => o.shiftId === shift.id);
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
  const orders = db.orders.filter(o => o.businessDate >= from && o.businessDate <= to && o.storeId === storeId);
  const todayOrders = db.orders.filter(o => o.storeId === storeId && o.businessDate === to);
  const openShift = shiftView(db.shifts.find(s => s.storeId === storeId && s.status === 'open'));

  const trend = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = daysAgoStr(i);
    const dayO = db.orders.filter(o => o.storeId === storeId && o.businessDate === d);
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
  const orders = db.orders.filter(o => o.shiftId === s.id);
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
  const orders = db.orders.filter(o => o.shiftId === h.shiftId).map(orderView)
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
  json(res, { price: svc.price, discountRate: rate, amount, commission: cm.value, basis: cm.basis, balance: mem ? mem.balance : null });
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
  const order = {
    id: nextId('order', 'O', 7), orderNo: `${todayStr().replace(/-/g, '')}${String(db.counters.order).padStart(5, '0').slice(-5)}`,
    storeId, shiftId: shift.id, serviceId: svc.id, techId: tech.id, memberId,
    price: svc.price, discountRate, amount, payMethod, techCommission: cm.value,
    duration: svc.duration, createdAt: now, businessDate: todayStr(),
  };
  db.orders.push(order);
  if (memberId) {
    const mem = db.members.find(x => x.id === memberId);
    mem.balance -= amount; mem.totalConsume += amount;
  }
  save();
  json(res, { ...order, commissionBasis: cm.basis, payMethodName: payLabel(payMethod) });
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
    const os = db.orders.filter(o => o.techId === t.id && o.businessDate >= from && o.businessDate <= to);
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
