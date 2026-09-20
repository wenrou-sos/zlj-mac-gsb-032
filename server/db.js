/**
 * 悦足堂 · 数据层（零依赖 JSON 持久化）
 * 启动时若 data/db.json 不存在则生成确定性种子数据。
 */
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

/* ---------------- 工具 ---------------- */
function pad(n) { return String(n).padStart(2, '0'); }
function fmtDate(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function fmtTime(d) { return `${pad(d.getHours())}:${pad(d.getMinutes())}`; }
function parseDate(s) { return new Date(s + 'T00:00:00'); }
function nowLocal() {
  const d = new Date();
  return `${fmtDate(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
// 确定性伪随机（mulberry32）
function rng(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(20260919);
function ri(min, max) { return Math.floor(rand() * (max - min + 1)) + min; }
function pick(arr) { return arr[Math.floor(rand() * arr.length)]; }

/* ---------------- 基础数据 ---------------- */
const STORES = [
  { id: 'S01', name: '旗舰店·外滩中心店', city: '上海', address: '黄浦区中山东一路 18 号 3F', phone: '021-6321-8801', manager: '周敏', opened: '2021-05-18' },
  { id: 'S02', name: '陆家嘴金融城店', city: '上海', address: '浦东新区世纪大道 100 号 L2', phone: '021-5835-2210', manager: '林海', opened: '2022-03-12' },
  { id: 'S03', name: '静安寺嘉里店', city: '上海', address: '静安区南京西路 1515 号 4F', phone: '021-6288-7766', manager: '苏晴', opened: '2022-09-01' },
  { id: 'S04', name: '国贸 CBD 店', city: '北京', address: '朝阳区建国门外大街 1 号 B1', phone: '010-6505-1188', manager: '赵鹏', opened: '2021-11-20' },
  { id: 'S05', name: '天河城店', city: '广州', address: '天河区天河路 208 号 5F', phone: '020-3880-9900', manager: '陈嘉怡', opened: '2023-01-15' },
  { id: 'S06', name: '南山科技园店', city: '深圳', address: '南山区科技园深南大道 9988 号 3F', phone: '0755-8650-3322', manager: '何俊', opened: '2023-06-08' },
];

const SERVICES = [
  { id: 'V01', name: '经典足道', duration: 60, price: 128, category: '足疗', commissionFixed: null, active: 1 },
  { id: 'V02', name: '养生足道', duration: 75, price: 168, category: '足疗', commissionFixed: null, active: 1 },
  { id: 'V03', name: '本草泡脚+足底拔罐', duration: 90, price: 218, category: '足疗', commissionFixed: null, active: 1 },
  { id: 'V04', name: '中式推拿', duration: 60, price: 188, category: '推拿', commissionFixed: null, active: 1 },
  { id: 'V05', name: '泰式古法按摩', duration: 90, price: 288, category: '推拿', commissionFixed: null, active: 1 },
  { id: 'V06', name: '肩颈深度调理', duration: 45, price: 138, category: '推拿', commissionFixed: null, active: 1 },
  { id: 'V07', name: 'SPA 精油舒缓', duration: 90, price: 328, category: 'SPA', commissionFixed: null, active: 1 },
  { id: 'V08', name: '热石能量 SPA', duration: 105, price: 398, category: 'SPA', commissionFixed: null, active: 1 },
  { id: 'V09', name: '艾灸温养', duration: 60, price: 198, category: '调理', commissionFixed: null, active: 1 },
  { id: 'V10', name: '刮痧排毒', duration: 40, price: 118, category: '调理', commissionFixed: null, active: 1 },
  { id: 'V11', name: '采耳', duration: 30, price: 88, category: '特色', commissionFixed: null, active: 1 },
  { id: 'V12', name: '修脚护理', duration: 30, price: 68, category: '特色', commissionFixed: null, active: 1 },
];

const TECH_LEVELS = [
  { id: 'L1', name: '初级技师', commissionRate: 0.25 },
  { id: 'L2', name: '中级技师', commissionRate: 0.30 },
  { id: 'L3', name: '高级技师', commissionRate: 0.35 },
  { id: 'L4', name: '金牌技师', commissionRate: 0.40 },
];

const MEMBER_LEVELS = [
  { id: 'ML1', name: '银卡会员', threshold: 0, discount: 0.95 },
  { id: 'ML2', name: '金卡会员', threshold: 3000, discount: 0.88 },
  { id: 'ML3', name: '铂金会员', threshold: 8000, discount: 0.82 },
  { id: 'ML4', name: '至尊会员', threshold: 20000, discount: 0.75 },
];

const SHIFT_DEFS = [
  { code: 'day', name: '白班', start: '10:00', end: '18:00' },
  { code: 'night', name: '晚班', start: '18:00', end: '02:00' },
];

const SURNAMES = ['王', '李', '张', '刘', '陈', '杨', '赵', '黄', '周', '吴', '徐', '孙', '马', '朱', '胡', '郭', '何', '林', '罗', '郑'];
const GIVEN = ['芳', '伟', '静', '秀英', '磊', '敏', '艳', '勇', '娟', '涛', '霞', '明', '超', '秀兰', '刚', '桂英', '建华', '文', '云', '志强', '雪梅', '佳', '欣怡', '鹏', '婷'];
const CERTS = ['足部按摩师（中级）', '保健按摩师（高级）', '中医康复理疗师', '反射疗法师', 'SPA 理疗师认证', '泰式按摩认证'];
const TRAIN_TOPICS = ['新员工岗前培训', '足底反射区进阶', '肩颈调理专项', '服务礼仪与话术', '泰式古法复训', '艾灸安全操作', '会员营销实训'];

const STORE_FACTOR = { S01: 1.35, S02: 1.2, S03: 1.05, S04: 1.15, S05: 0.95, S06: 1.0 };

/* ---------------- 耗材档案 & 标准耗用配方（总部维护） ---------------- */
const MATERIALS = [
  { id: 'P01', name: '养生泡脚药包', spec: '本草配方 / 包', unit: '包', category: '泡脚药材', standardCost: 6.0, safetyStock: 30, active: 1 },
  { id: 'P02', name: '生姜泡脚粉', spec: '40g 独立装 / 包', unit: '包', category: '泡脚药材', standardCost: 3.5, safetyStock: 40, active: 1 },
  { id: 'P03', name: '艾草精油', spec: '500ml / 瓶', unit: '瓶', category: '精油', standardCost: 48.0, safetyStock: 8, active: 1 },
  { id: 'P04', name: 'SPA 按摩精油', spec: '1000ml / 瓶', unit: '瓶', category: '精油', standardCost: 78.0, safetyStock: 6, active: 1 },
  { id: 'P05', name: '一次性足浴毛巾', spec: '独立包装 / 条', unit: '条', category: '一次性耗材', standardCost: 1.2, safetyStock: 200, active: 1 },
  { id: 'P06', name: '一次性床单', spec: '防水 SMS / 张', unit: '张', category: '一次性耗材', standardCost: 2.8, safetyStock: 100, active: 1 },
  { id: 'P07', name: '一次性修脚工具套装', spec: '已灭菌 / 套', unit: '套', category: '一次性耗材', standardCost: 5.0, safetyStock: 30, active: 1 },
  { id: 'P08', name: '艾灸条', spec: '五年陈 / 根', unit: '根', category: '理疗用品', standardCost: 4.0, safetyStock: 40, active: 1 },
  { id: 'P09', name: '刮痧油 + 刮痧板', spec: '单人份 / 套', unit: '套', category: '理疗用品', standardCost: 3.0, safetyStock: 30, active: 1 },
  { id: 'P10', name: '采耳工具消毒包', spec: '一次性 / 份', unit: '份', category: '理疗用品', standardCost: 2.5, safetyStock: 40, active: 1 },
];

// 每个服务项目的标准耗用配方：materialId -> 单次标准用量（支持两位小数）
const RECIPE_DEFS = {
  V01: [['P02', 1], ['P05', 1]],
  V02: [['P01', 1], ['P05', 1]],
  V03: [['P01', 2], ['P05', 2], ['P09', 0.5]],
  V04: [['P03', 0.05], ['P06', 1]],
  V05: [['P03', 0.08], ['P06', 1]],
  V06: [['P03', 0.04], ['P06', 1]],
  V07: [['P04', 0.1], ['P03', 0.03], ['P06', 1]],
  V08: [['P04', 0.12], ['P03', 0.04], ['P06', 1]],
  V09: [['P08', 2], ['P05', 1]],
  V10: [['P09', 1], ['P06', 1]],
  V11: [['P10', 1]],
  V12: [['P07', 1]],
};
const buildRecipes = () => Object.entries(RECIPE_DEFS).map(([serviceId, items]) => ({
  serviceId, version: 1,
  items: items.map(([materialId, qty]) => {
    const m = MATERIALS.find(x => x.id === materialId);
    return { materialId, qty, unitCost: m.standardCost };
  }),
  updatedAt: nowLocal(),
}));
const r4 = (n) => Math.round(n * 10000) / 10000;
const r2 = (n) => Math.round(n * 100) / 100;

/* ---------------- 种子生成 ---------------- */
function buildSeed() {
  const db = {
    meta: { brand: '悦足堂', generatedAt: nowLocal(), historyDays: 45 },
    counters: {},
    stores: STORES,
    services: SERVICES,
    techLevels: TECH_LEVELS,
    memberLevels: MEMBER_LEVELS,
    shiftDefs: SHIFT_DEFS,
    commissionRules: [],
    users: [],
    technicians: [],
    techSpecialties: [],
    trainings: [],
    transfers: [],
    members: [],
    recharges: [],
    orders: [],
    shifts: [],
    handovers: [],
    materials: MATERIALS,
    recipes: buildRecipes(),
    stockRecords: [],
    stockLedger: [],
    purchases: [],
    stocktakes: [],
    damageReports: [],
    stockTransfers: [],
    inventoryAlerts: [],
    inventoryConfig: { shortPolicy: 'strict' }, // strict=禁止开单；negative=允许负库存并预警
  };
  const seq = (key) => { db.counters[key] = (db.counters[key] || 0) + 1; return db.counters[key]; };
  const id = (key, prefix, len = 4) => `${prefix}${String(seq(key)).padStart(len, '0')}`;

  // 账号：总部 2 个 + 每门店 1 个店长
  db.users.push({ id: 'U0001', username: 'hq', password: '123456', name: '总部运营', role: 'hq', storeId: null, active: 1 });
  db.users.push({ id: 'U0002', username: 'boss', password: '123456', name: '品牌总监', role: 'hq', storeId: null, active: 1 });
  STORES.forEach((s, i) => {
    db.users.push({ id: `U${String(i + 10).padStart(4, '0')}`, username: `s${s.id.slice(1)}`, password: '123456', name: s.manager, role: 'store', storeId: s.id, active: 1 });
  });

  // 技师：每店 8~12 人
  let techNo = 0;
  for (const s of STORES) {
    const count = ri(8, 12);
    for (let k = 0; k < count; k++) {
      techNo++;
      const tId = `T${String(techNo).padStart(4, '0')}`;
      const name = pick(SURNAMES) + pick(GIVEN);
      const level = pick(['L1', 'L1', 'L2', 'L2', 'L2', 'L3', 'L3', 'L4']);
      const monthsAgo = ri(2, 40);
      const hire = new Date(); hire.setMonth(hire.getMonth() - monthsAgo);
      const statusRoll = rand();
      const status = statusRoll < 0.06 ? 'leave' : 'active';
      const tech = {
        id: tId, name, gender: rand() > 0.25 ? '女' : '男', age: ri(21, 46),
        phone: `1${pick(['38', '39', '35', '36', '58', '88'])}${String(ri(10000000, 99999999)).slice(0, 8)}`,
        levelId: level, storeId: s.id, status,
        hireDate: fmtDate(hire), leaveDate: status === 'leave' ? fmtDate(new Date(Date.now() - ri(3, 20) * 864e5)) : null,
        remark: status === 'leave' ? pick(['家中有事请长假', '身体调理中', '返乡休假']) : '',
      };
      db.technicians.push(tech);
      // 擅长项目 2~4 个
      const n = ri(2, 4);
      const svcs = [...SERVICES].sort(() => rand() - 0.5).slice(0, n);
      svcs.forEach(v => db.techSpecialties.push({ techId: tId, serviceId: v.id }));
      // 培训考核 1~3 条
      const tn = ri(1, 3);
      for (let j = 0; j < tn; j++) {
        const td = new Date(hire.getTime() + ri(0, 40) * 864e5);
        if (td > Date.now()) continue;
        const score = ri(72, 99);
        db.trainings.push({
          id: id('training', 'TR'), techId: tId, topic: pick(TRAIN_TOPICS),
          trainDate: fmtDate(td), score,
          result: score >= 60 ? 'pass' : 'fail',
          cert: score >= 90 && rand() > 0.5 ? pick(CERTS) : null,
        });
      }
    }
  }

  // 一次跨店调动样例（发生在 40 天前，便于“调动记录”有数据）
  const moved = db.technicians.find(t => t.storeId === 'S02');
  if (moved) {
    const td = new Date(); td.setDate(td.getDate() - 40);
    moved.storeId = 'S03';
    db.transfers.push({
      id: id('transfer', 'TF'), techId: moved.id, techName: moved.name,
      fromStoreId: 'S02', toStoreId: 'S03',
      transferDate: fmtDate(td), reason: '门店人力调配 · 旺季支援',
    });
  }

  // 会员：60 人，归属各店；按累计充值确定等级
  const MEMBER_SURN = ['沈', '韩', '曹', '邓', '许', '萧', '冯', '宋', '唐', '韩', '蒋', '卢', '姚', '邹', '熊'];
  for (let i = 0; i < 60; i++) {
    const store = pick(STORES);
    const totalRecharge = pick([500, 1000, 1500, 2000, 3000, 5000, 8000, 12000, 20000]);
    const level = [...MEMBER_LEVELS].reverse().find(l => totalRecharge >= l.threshold).id;
    const reg = new Date(); reg.setDate(reg.getDate() - ri(5, 44));
    const mId = `M${String(i + 1).padStart(4, '0')}`;
    db.members.push({
      id: mId, name: pick(MEMBER_SURN) + pick(GIVEN), phone: `1${pick(['38', '39', '35', '88'])}${String(ri(10000000, 99999999)).slice(0, 8)}`,
      levelId: level, storeId: store.id, balance: 0, totalRecharge, totalConsume: 0,
      regDate: fmtDate(reg),
    });
  }
  // 充值记录（每会员 1~3 笔），并初始化余额
  let paySeq = 0;
  for (const m of db.members) {
    const times = ri(1, 3);
    let charged = 0;
    for (let j = 0; j < times; j++) {
      const amt = pick([500, 1000, 2000, 3000, 5000]);
      const bonus = amt >= 3000 ? Math.round(amt * 0.1) : 0;
      charged += amt + bonus;
      const rd = new Date(parseDate(m.regDate).getTime() + j * 5 * 864e5 + ri(0, 3) * 864e5);
      db.recharges.push({
        id: `RC${String(++paySeq).padStart(5, '0')}`, memberId: m.id, storeId: m.storeId,
        amount: amt, bonus, payMethod: pick(['cash', 'card', 'mp']),
        createdAt: `${fmtDate(rd)} ${pad(ri(10, 22))}:${pad(ri(0, 59))}:00`,
      });
    }
    // 用消费消耗一部分余额（先给满，后面订单再扣）
    m.balance = charged;
    m.totalRecharge = charged;
  }
  // 重算会员等级（按含赠的累计充值）
  for (const m of db.members) {
    m.levelId = [...MEMBER_LEVELS].reverse().find(l => m.totalRecharge >= l.threshold).id;
  }

  // 提成标准覆盖规则：默认按技师等级比例提成；指定项目可用固定金额覆盖
  let crSeq = 0;
  db.commissionRules = [
    { id: `CR${String(++crSeq).padStart(3, '0')}`, name: '金牌·热石能量 SPA 专项补贴', serviceId: 'V08', levelId: 'L4', type: 'fixed', value: 180, active: 1 },
    { id: `CR${String(++crSeq).padStart(3, '0')}`, name: '高级·泰式古法专项', serviceId: 'V05', levelId: 'L3', type: 'fixed', value: 110, active: 1 },
    { id: `CR${String(++crSeq).padStart(3, '0')}`, name: '初级·采耳固定提成', serviceId: 'V11', levelId: 'L1', type: 'fixed', value: 25, active: 1 },
  ];

  /* ---------- 45 天历史班次 + 订单 ---------- */
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const DAYS = 45;
  let orderSeq = 0, shiftSeq = 0, handSeq = 0;
  const seedConsumes = []; // 历史订单的耗材耗用计划（时间序）
  const techsByStore = Object.fromEntries(STORES.map(s => [s.id, db.technicians.filter(t => t.storeId === s.id && t.status === 'active')]));
  const specialtiesByTech = {};
  db.techSpecialties.forEach(sp => { (specialtiesByTech[sp.techId] ||= []).push(sp.serviceId); });

  for (let d = DAYS - 1; d >= 1; d--) {
    const day = new Date(today.getTime() - d * 864e5);
    const dateStr = fmtDate(day);
    for (const s of STORES) {
      for (const sd of SHIFT_DEFS) {
        const shiftId = `SH${String(++shiftSeq).padStart(6, '0')}`;
        const startDt = new Date(day); const [sh, sm] = sd.start.split(':').map(Number);
        startDt.setHours(sh, sm, 0, 0);
        const endDt = new Date(startDt); endDt.setHours(...sd.end.split(':').map(Number), 0, 0);
        if (sd.code === 'night') endDt.setDate(endDt.getDate() + 1);

        const factor = STORE_FACTOR[s.id];
        const baseCount = sd.code === 'day' ? 7 : 11;
        let n = Math.round((baseCount + ri(-3, 4)) * factor);
        n = Math.max(2, n);

        const shift = {
          id: shiftId, storeId: s.id, shiftCode: sd.code, shiftName: sd.name,
          businessDate: dateStr, startTime: `${dateStr} ${sd.start}:00`,
          endTime: `${fmtDate(endDt)} ${sd.end}:00`,
          opener: pick([s.manager, '值班店长']), status: 'closed',
          openedAt: `${dateStr} ${sd.start}:00`, closedAt: `${dateStr} ${sd.end === '02:00' ? '23:59' : sd.end}:00`,
        };
        db.shifts.push(shift);

        let cash = 0, card = 0, member = 0, mp = 0, revenue = 0, commission = 0;
        for (let k = 0; k < n; k++) {
          const svc = pick(SERVICES);
          const techs = techsByStore[s.id];
          let tech = pick(techs);
          // 70% 概率选擅长该项目的技师
          const good = techs.filter(t => (specialtiesByTech[t.id] || []).includes(svc.id));
          if (good.length && rand() < 0.7) tech = pick(good);
          const level = TECH_LEVELS.find(l => l.id === tech.levelId);
          const price = svc.price;
          const useMember = rand() < 0.45;
          let memberId = null, discount = 1, paid = price, payMethod;
          if (useMember) {
            const ml = pick(db.members.filter(m => m.storeId === s.id));
            if (ml && ml.balance >= price * 0.75) {
              memberId = ml.id;
              discount = MEMBER_LEVELS.find(l => l.id === ml.levelId).discount;
              paid = Math.round(price * discount);
              ml.balance -= paid; ml.totalConsume += paid;
              payMethod = 'member';
            } else {
              payMethod = pick(['cash', 'card', 'mp']);
            }
          } else {
            payMethod = pick(['cash', 'card', 'mp']);
          }
          if (!payMethod) payMethod = pick(['cash', 'card', 'mp']);
          const techCommission = Math.round(paid * level.commissionRate);
          // 下单时间落在班次区间内
          const spanStart = startDt.getTime();
          const span = endDt.getTime() - spanStart - 10 * 60000;
          const ot = new Date(spanStart + rand() * span);
          const order = {
            id: `O${String(++orderSeq).padStart(7, '0')}`,
            orderNo: `${dateStr.replace(/-/g, '')}${String(orderSeq).slice(-5)}`,
            storeId: s.id, shiftId, serviceId: svc.id,
            techId: tech.id, memberId,
            price, discountRate: discount, amount: paid,
            payMethod, techCommission,
            duration: svc.duration,
            createdAt: `${fmtDate(ot)} ${fmtTime(ot)}:00`,
            businessDate: dateStr,
          };
          db.orders.push(order);
          const recipe = db.recipes.find(rp => rp.serviceId === svc.id);
          let materialCost = 0;
          if (recipe) {
            const snapItems = recipe.items.map(it => {
              const mat = MATERIALS.find(x => x.id === it.materialId);
              materialCost += it.qty * it.unitCost;
              return { materialId: it.materialId, name: mat.name, unit: mat.unit, qty: it.qty, unitCost: it.unitCost };
            });
            order.recipeVersion = recipe.version;
            order.materialCost = r2(materialCost);
            order.recipeSnapshot = { version: recipe.version, items: snapItems };
            snapItems.forEach(it => seedConsumes.push({
              time: order.createdAt, storeId: s.id, orderId: order.id, serviceId: svc.id,
              materialId: it.materialId, qty: it.qty, unitCost: it.unitCost,
            }));
          } else {
            order.materialCost = 0;
          }
          revenue += paid; commission += techCommission;
          if (payMethod === 'cash') cash += paid;
          else if (payMethod === 'card') card += paid;
          else if (payMethod === 'member') member += paid;
          else if (payMethod === 'mp') mp += paid;
        }

        db.handovers.push({
          id: `HD${String(++handSeq).padStart(6, '0')}`,
          shiftId, storeId: s.id, businessDate: dateStr, shiftName: sd.name,
          serveCount: n, cash, card, member, mp, revenue, commission,
          opener: shift.opener, closer: s.manager,
          openerSign: `seed-sign-${shift.opener}`, closerSign: `seed-sign-${s.manager}`,
          confirmedAt: shift.closedAt, remark: '',
        });
      }
    }
  }

  /* ---------- 今日：每店一个进行中的白班（可继续录单、交接） ---------- */
  const todayStr = fmtDate(today);
  const tomorrowStr = fmtDate(new Date(today.getTime() + 864e5));
  for (const s of STORES) {
    const shiftId = `SH${String(++shiftSeq).padStart(6, '0')}`;
    db.shifts.push({
      id: shiftId, storeId: s.id, shiftCode: 'day', shiftName: '白班',
      businessDate: todayStr, startTime: `${todayStr} 10:00:00`,
      endTime: `${todayStr} 18:00:00`,
      opener: s.manager, status: 'open',
      openedAt: `${todayStr} 10:00:00`, closedAt: null,
    });
  }

  /* ---------- 耗材库存：期初、采购、耗用、盘点、报损、调拨样例 ---------- */
  buildInventorySeed(db, id, seq, STORES, MATERIALS, seedConsumes, today, DAYS);

  db.meta.orderCount = db.orders.length;
  return db;
}

/* ---------------- 耗材库存种子 ---------------- */
function buildInventorySeed(db, id, seq, STORES, MATERIALS, seedConsumes, today, DAYS) {
  const dayStr = (offset) => { const d = new Date(today.getTime() - offset * 864e5); return fmtDate(d); };
  const dayTime = (offset, hhmmss) => `${dayStr(offset)} ${hhmmss}`;
  const skey = (sid, mid) => `${sid}|${mid}`;
  const matOf = Object.fromEntries(MATERIALS.map(m => [m.id, m]));

  // 库存账（现存量 + 在途），移动平均成本
  const records = {};
  const avgCost = {};
  const getRec = (sid, mid) => {
    const k = skey(sid, mid);
    if (!records[k]) records[k] = { storeId: sid, materialId: mid, qty: 0, inTransit: 0, avgCost: matOf[mid].standardCost };
    return records[k];
  };
  const avgOf = (sid, mid) => avgCost[skey(sid, mid)] ?? matOf[mid].standardCost;
  const applyIn = (sid, mid, qty, cost) => {
    const rec = getRec(sid, mid); const k = skey(sid, mid);
    const oldAvg = avgCost[k] ?? cost, oldQty = rec.qty;
    if (oldQty > 0) avgCost[k] = r2((oldQty * oldAvg + qty * cost) / (oldQty + qty));
    else avgCost[k] = cost;
    rec.avgCost = avgCost[k];
    rec.qty = r4(rec.qty + qty);
    return rec.qty;
  };
  const applyOut = (sid, mid, qty) => { const rec = getRec(sid, mid); rec.qty = r4(rec.qty - qty); return rec.qty; };
  let ledgerSeq = 0;
  const ledger = (time, sid, mid, type, qty, unitCost, refType, refId, extra = {}) => {
    db.stockLedger.push({
      id: `SL${String(++ledgerSeq).padStart(8, '0')}`, time, storeId: sid, materialId: mid,
      type, qty, unitCost, balanceAfter: getRec(sid, mid).qty, refType, refId, ...extra,
    });
  };

  const events = [];
  // 1) 期初库存（45 天前 08:00）：约 12~18 天用量，按标准成本 96 折计入
  const consumesByDay = {};
  seedConsumes.forEach(c => { (consumesByDay[c.time.slice(0, 10)] ||= []).push(c); });
  for (const s of STORES) {
    for (const m of MATERIALS) {
      const total = seedConsumes.filter(c => c.storeId === s.id && c.materialId === m.id).reduce((a, c) => a + c.qty, 0);
      const openQty = r2(total * (0.26 + rand() * 0.14) + m.safetyStock * 0.35);
      if (openQty <= 0) { getRec(s.id, m.id); continue; }
      const cost = r2(m.standardCost * 0.96);
      events.push({ time: dayTime(DAYS - 1, '08:00:00'), run: () => {
        applyIn(s.id, m.id, openQty, cost);
        ledger(dayTime(DAYS - 1, '08:00:00'), s.id, m.id, 'open', openQty, cost, null, null, { remark: '期初库存' });
      } });
    }
  }
  // 2) 采购计划：滚动预测未来 3 天用量，库存将低于安全线即补货；今天 09:00 再补一次
  for (const s of STORES) {
    let planned = {};
    MATERIALS.forEach(m => { planned[m.id] = getRec(s.id, m.id).qty; });
    let lastBuy = -99;
    for (let i = 0; i < DAYS; i++) {
      const needBuy = i - lastBuy >= 3;
      if (needBuy) {
        const items = [];
        MATERIALS.forEach(m => {
          let need = 0;
          for (let j = i; j < Math.min(DAYS, i + 3); j++) {
            (consumesByDay[dayStr(DAYS - 1 - j)] || []).forEach(c => { if (c.materialId === m.id) need += c.qty; });
          }
          if (planned[m.id] - need < m.safetyStock) {
            const raw = need * 1.1 + m.safetyStock - planned[m.id];
            const qty = Math.max(Math.ceil(raw), m.safetyStock >= 100 ? 10 : m.safetyStock >= 30 ? 5 : 2);
            items.push({ materialId: m.id, qty });
            planned[m.id] += qty;
          }
        });
        if (items.length) {
          const t = dayTime(DAYS - 1 - i, '09:00:00');
          events.push({ time: t, run: () => {
            const doc = { id: id('purchase', 'PR', 6), storeId: s.id, supplier: pick(['杭州本草堂供应链', '沪上康体用品批发', '粤美理疗耗材厂', '悦足堂集采中心']),
              items: [], totalCost: 0, createdAt: t, operator: s.manager, remark: '例行补货' };
            let total = 0;
            items.forEach(it => {
              const cost = r2(matOf[it.materialId].standardCost * (0.88 + rand() * 0.22));
              const amount = r2(cost * it.qty); total += amount;
              doc.items.push({ materialId: it.materialId, qty: it.qty, unitCost: cost, amount });
              applyIn(s.id, it.materialId, it.qty, cost);
              ledger(t, s.id, it.materialId, 'purchase_in', it.qty, cost, 'purchase', doc.id, { remark: doc.supplier });
            });
            doc.totalCost = r2(total);
            db.purchases.push(doc);
          } });
          lastBuy = i;
        }
      }
      (consumesByDay[dayStr(DAYS - 1 - i)] || []).forEach(c => { planned[c.materialId] -= c.qty; });
    }
  }
  // 3) 耗用（跟随历史订单时间）
  seedConsumes.forEach(c => events.push({ time: c.time, run: () => {
    applyOut(c.storeId, c.materialId, c.qty);
    ledger(c.time, c.storeId, c.materialId, 'consume', -c.qty, c.unitCost, 'order', c.orderId,
      { orderId: c.orderId, serviceId: c.serviceId });
  } }));
  // 4) 报损样例：12/6/1 天前晚间各一笔
  [12, 6, 1].forEach(off => {
    const s = pick(STORES), m = pick(MATERIALS);
    events.push({ time: dayTime(off, '20:10:00'), run: () => {
      const book = getRec(s.id, m.id).qty;
      const qty = Math.min(Math.max(1, Math.ceil(Math.max(book, 1) * 0.02)), Math.max(1, Math.floor(book)));
      if (!(book >= qty)) return;
      const cost = avgOf(s.id, m.id);
      const doc = { id: id('damage', 'DM', 6), storeId: s.id, materialId: m.id, qty, unitCost: cost, amount: r2(qty * cost),
        reason: pick(['临期/包装破损报损', '操作不慎打翻损毁', '开封后变质报损']), operator: s.manager, createdAt: dayTime(off, '20:10:00') };
      db.damageReports.push(doc);
      applyOut(s.id, m.id, qty);
      ledger(doc.createdAt, s.id, m.id, 'damage', -qty, cost, 'damage', doc.id, { remark: doc.reason });
    } });
  });
  // 5) 盘点：每店 10 天前、3 天前 20:30 全盘（约 25% 耗材出现小额差异）
  [10, 3].forEach(off => {
    STORES.forEach(s => {
      events.push({ time: dayTime(off, '20:30:00'), run: () => {
        const items = []; let lossCost = 0, gainCost = 0;
        MATERIALS.forEach(m => {
          const book = r2(getRec(s.id, m.id).qty);
          let actual = book;
          if (book >= 2 && rand() < 0.25) {
            const d = rand() < 0.72 ? -Math.ceil(Math.max(book, 1) * (0.01 + rand() * 0.04)) : Math.ceil(Math.max(book, 1) * 0.02);
            actual = Math.max(0, r2(book + d));
          }
          const diffQty = r2(actual - book);
          if (diffQty !== 0) {
            const cost = avgOf(s.id, m.id), diffCost = r2(diffQty * cost);
            if (diffQty < 0) { applyOut(s.id, m.id, -diffQty); lossCost += -diffCost; }
            else { applyIn(s.id, m.id, diffQty, cost); gainCost += diffCost; }
            ledger(dayTime(off, '20:30:00'), s.id, m.id, 'stocktake_adjust', diffQty, cost, 'stocktake', null,
              { remark: `盘点${diffQty < 0 ? '盘亏' : '盘盈'}调整` });
          }
          items.push({ materialId: m.id, bookQty: book, actualQty: actual, diffQty });
        });
        const doc = { id: id('stocktake', 'SK', 6), storeId: s.id, operator: s.manager, createdAt: dayTime(off, '20:30:00'),
          items, lossCost: r2(lossCost), gainCost: r2(gainCost), remark: '' };
        db.stocktakes.push(doc);
        items.forEach(it => { const row = db.stockLedger.find(l => l.type === 'stocktake_adjust' && l.time === doc.createdAt && l.storeId === s.id && l.materialId === it.materialId); if (row) row.refId = doc.id; });
      } });
    });
  });
  // 6) 跨店调拨样例：两笔已完成（6 天前 S01→S02、2 天前 S04→S05），一笔在途（今天 09:40 S02→S03）
  const mkTransferEvents = (off, fromId, toId, materialId, qty, status) => {
    const sFrom = STORES.find(x => x.id === fromId), sTo = STORES.find(x => x.id === toId);
    const ct = dayTime(off, '10:00:00');
    const docId = `ST${String(seq('stockTransfer')).padStart(6, '0')}`;
    const doc = { id: docId, fromStoreId: fromId, toStoreId: toId, materialId, qty, unitCost: 0,
      status: 'in_transit', createdAt: ct, createdBy: sFrom.manager, confirmedAt: null, confirmedBy: null,
      cancelledAt: null, cancelBy: null, remark: '门店间余缺调剂' };
    db.stockTransfers.push(doc);
    events.push({ time: ct, run: () => {
      let q = qty;
      while (q > 0 && getRec(fromId, materialId).qty < q) q -= 2;
      if (q <= 0) { doc.status = 'cancelled'; doc.cancelledAt = ct; doc.cancelBy = sFrom.manager; doc.remark = '发起时库存不足，自动取消'; return; }
      doc.qty = q; doc.unitCost = avgOf(fromId, materialId);
      getRec(fromId, materialId).inTransit += q;
      applyOut(fromId, materialId, q);
      ledger(ct, fromId, materialId, 'transfer_out', -q, doc.unitCost, 'stock_transfer', docId,
        { toStoreId: toId, remark: `调出至${sTo.name}` });
    } });
    if (status === 'done') {
      const ft = dayTime(off, '14:00:00');
      events.push({ time: ft, run: () => {
        if (doc.status === 'cancelled') return;
        const q = doc.qty;
        applyIn(toId, materialId, q, doc.unitCost);
        getRec(fromId, materialId).inTransit -= q;
        ledger(ft, toId, materialId, 'transfer_in', q, doc.unitCost, 'stock_transfer', docId,
          { fromStoreId: fromId, remark: `由${sFrom.name}调入` });
        doc.status = 'done'; doc.confirmedAt = ft; doc.confirmedBy = sTo.manager;
      } });
    }
  };
  mkTransferEvents(6, 'S01', 'S02', 'P05', 30, 'done');
  mkTransferEvents(2, 'S04', 'S05', 'P01', 12, 'done');
  mkTransferEvents(0, 'S02', 'S03', 'P01', 8, 'in_transit');

  // 按时间顺序回放
  events.sort((a, b) => a.time.localeCompare(b.time));
  events.forEach(e => e.run());

  db.stockRecords = Object.values(records);
  db.stockLedger.sort((a, b) => a.time.localeCompare(b.time) || a.id.localeCompare(b.id));

  // 7) 初始预警：低于安全库存
  db.stockRecords.forEach(r => {
    const m = matOf[r.materialId];
    if (r.qty < 0) db.inventoryAlerts.push({ id: id('inventoryAlert', 'IA', 5), storeId: r.storeId, materialId: r.materialId, type: 'negative', qty: r.qty, createdAt: nowLocal(), resolved: 0, remark: '开单扣减导致负库存' });
    else if (r.qty < m.safetyStock) db.inventoryAlerts.push({ id: id('inventoryAlert', 'IA', 5), storeId: r.storeId, materialId: r.materialId, type: 'low_stock', qty: r.qty, safetyStock: m.safetyStock, createdAt: nowLocal(), resolved: 0, remark: '库存低于安全库存' });
  });
}

/* ---------------- 加载 / 保存 ---------------- */
let db = null;
let saveTimer = null;

function load() {
  if (db) return db;
  try {
    if (fs.existsSync(DB_FILE)) {
      db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    } else {
      db = buildSeed();
      save(true);
    }
  } catch (e) {
    console.error('数据加载失败，重建种子：', e.message);
    db = buildSeed();
    save(true);
  }
  return db;
}

function save(sync = false) {
  if (!db) return;
  const doSave = () => {
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(DB_FILE, JSON.stringify(db));
    } catch (e) { console.error('保存失败：', e.message); }
  };
  if (sync) { clearTimeout(saveTimer); doSave(); return; }
  clearTimeout(saveTimer);
  saveTimer = setTimeout(doSave, 120);
}

function reseed() {
  db = buildSeed();
  save(true);
  return db;
}

module.exports = { load, save, reseed, nowLocal, fmtDate, parseDate, DB_FILE };

/* 直接执行：node server/db.js --reseed */
if (require.main === module && process.argv.includes('--reseed')) {
  const d = reseed();
  console.log('种子数据已重建：', {
    stores: d.stores.length, technicians: d.technicians.length,
    members: d.members.length, orders: d.orders.length,
    shifts: d.shifts.length, handovers: d.handovers.length,
    file: DB_FILE,
  });
}
