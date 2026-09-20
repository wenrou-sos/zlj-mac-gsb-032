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

/* ---------------- 耗材档案 ---------------- */
const MATERIALS = [
  { id: 'MA001', name: '一次性泡脚袋', spec: '加厚 65×55cm', unit: '个', category: '一次性耗材', defaultCost: 0.35 },
  { id: 'MA002', name: '一次性毛巾', spec: '纯棉 30×60cm', unit: '条', category: '一次性耗材', defaultCost: 0.60 },
  { id: 'MA003', name: '一次性床单', spec: '无纺布 80×180cm', unit: '张', category: '一次性耗材', defaultCost: 1.20 },
  { id: 'MA004', name: '艾草泡脚包', spec: '复方艾草 30g/包', unit: '包', category: '药浴耗材', defaultCost: 2.50 },
  { id: 'MA005', name: '生姜泡脚包', spec: '生姜红花 30g/包', unit: '包', category: '药浴耗材', defaultCost: 2.80 },
  { id: 'MA006', name: '基础按摩油', spec: '润肤基础油 1000ml', unit: 'ml', category: '精油药油', defaultCost: 0.12 },
  { id: 'MA007', name: '艾草精油', spec: '蕲艾精油 100ml', unit: 'ml', category: '精油药油', defaultCost: 0.25 },
  { id: 'MA008', name: 'SPA 复方精油', spec: '植物舒缓复方 100ml', unit: 'ml', category: '精油药油', defaultCost: 0.90 },
  { id: 'MA009', name: '热石能量精油', spec: '火山热石专用 100ml', unit: 'ml', category: '精油药油', defaultCost: 0.45 },
  { id: 'MA010', name: '刮痧活血油', spec: '红花刮痧油 100ml', unit: 'ml', category: '精油药油', defaultCost: 0.15 },
  { id: 'MA011', name: '消毒酒精', spec: '75% 医用 500ml', unit: 'ml', category: '消毒用品', defaultCost: 0.05 },
  { id: 'MA012', name: '一次性棉片', spec: '脱脂棉 6×6cm', unit: '片', category: '消毒用品', defaultCost: 0.10 },
  { id: 'MA013', name: '一次性修脚刀片', spec: '不锈钢灭菌装', unit: '片', category: '工具耗材', defaultCost: 1.80 },
  { id: 'MA014', name: '一次性采耳工具包', spec: '采耳棒+鹅毛棒套装', unit: '套', category: '工具耗材', defaultCost: 2.20 },
  { id: 'MA015', name: '陈年艾条', spec: '五年陈 18×200mm', unit: '根', category: '调理耗材', defaultCost: 1.60 },
  { id: 'MA016', name: '耳烛', spec: '香薰蜂蜡耳烛', unit: '对', category: '调理耗材', defaultCost: 3.50 },
];

/* 每个服务项目的标准耗用配方（开单时按此快照扣库） */
const RECIPE_DEFS = [
  { serviceId: 'V01', lines: [{ materialId: 'MA001', qty: 1 }, { materialId: 'MA002', qty: 1 }, { materialId: 'MA004', qty: 1 }, { materialId: 'MA006', qty: 10 }] },
  { serviceId: 'V02', lines: [{ materialId: 'MA001', qty: 1 }, { materialId: 'MA002', qty: 1 }, { materialId: 'MA005', qty: 1 }, { materialId: 'MA006', qty: 15 }] },
  { serviceId: 'V03', lines: [{ materialId: 'MA001', qty: 1 }, { materialId: 'MA002', qty: 1 }, { materialId: 'MA004', qty: 2 }, { materialId: 'MA011', qty: 20 }, { materialId: 'MA012', qty: 2 }] },
  { serviceId: 'V04', lines: [{ materialId: 'MA003', qty: 1 }, { materialId: 'MA002', qty: 1 }, { materialId: 'MA006', qty: 20 }] },
  { serviceId: 'V05', lines: [{ materialId: 'MA003', qty: 1 }, { materialId: 'MA002', qty: 2 }, { materialId: 'MA006', qty: 15 }] },
  { serviceId: 'V06', lines: [{ materialId: 'MA002', qty: 1 }, { materialId: 'MA006', qty: 10 }, { materialId: 'MA007', qty: 5 }] },
  { serviceId: 'V07', lines: [{ materialId: 'MA003', qty: 1 }, { materialId: 'MA002', qty: 2 }, { materialId: 'MA008', qty: 30 }] },
  { serviceId: 'V08', lines: [{ materialId: 'MA003', qty: 1 }, { materialId: 'MA002', qty: 2 }, { materialId: 'MA009', qty: 25 }, { materialId: 'MA008', qty: 10 }] },
  { serviceId: 'V09', lines: [{ materialId: 'MA003', qty: 1 }, { materialId: 'MA002', qty: 1 }, { materialId: 'MA015', qty: 2 }] },
  { serviceId: 'V10', lines: [{ materialId: 'MA002', qty: 1 }, { materialId: 'MA012', qty: 2 }, { materialId: 'MA010', qty: 15 }] },
  { serviceId: 'V11', lines: [{ materialId: 'MA002', qty: 1 }, { materialId: 'MA014', qty: 1 }] },
  { serviceId: 'V12', lines: [{ materialId: 'MA002', qty: 1 }, { materialId: 'MA013', qty: 1 }] },
];

function materialById(id) { return MATERIALS.find(m => m.id === id); }
/* 开单时的配方快照：固化耗材名称、单位、用量、当时采购成本 */
function recipeSnapshotFor(serviceId) {
  const def = RECIPE_DEFS.find(r => r.serviceId === serviceId);
  if (!def) return [];
  return def.lines.map(l => {
    const m = materialById(l.materialId);
    return { materialId: m.id, materialName: m.name, unit: m.unit, qty: l.qty, unitCost: m.defaultCost };
  });
}

const SURNAMES = ['王', '李', '张', '刘', '陈', '杨', '赵', '黄', '周', '吴', '徐', '孙', '马', '朱', '胡', '郭', '何', '林', '罗', '郑'];
const GIVEN = ['芳', '伟', '静', '秀英', '磊', '敏', '艳', '勇', '娟', '涛', '霞', '明', '超', '秀兰', '刚', '桂英', '建华', '文', '云', '志强', '雪梅', '佳', '欣怡', '鹏', '婷'];
const CERTS = ['足部按摩师（中级）', '保健按摩师（高级）', '中医康复理疗师', '反射疗法师', 'SPA 理疗师认证', '泰式按摩认证'];
const TRAIN_TOPICS = ['新员工岗前培训', '足底反射区进阶', '肩颈调理专项', '服务礼仪与话术', '泰式古法复训', '艾灸安全操作', '会员营销实训'];

const STORE_FACTOR = { S01: 1.35, S02: 1.2, S03: 1.05, S04: 1.15, S05: 0.95, S06: 1.0 };

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
    materials: [],
    recipes: [],
    inventoryPolicy: { shortageMode: 'strict', updatedAt: null },
    stockBalances: [],
    stockMovements: [],
    purchaseOrders: [],
    stockChecks: [],
    stockLosses: [],
    inventoryTransfers: [],
    inventoryAlerts: [],
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
          const materialSnapshot = recipeSnapshotFor(svc.id);
          const materialCost = materialSnapshot.reduce((a, l) => a + l.qty * l.unitCost, 0);
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
            status: 'valid', stockDeducted: 1, stockReversed: 0,
            materialSnapshot, materialCost,
          };
          db.orders.push(order);
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

  db.meta.orderCount = db.orders.length;

  /* ---------- 耗材与库存初始化 ---------- */
  seedInventory(db, id, seq, { STORES, MATERIALS, RECIPE_DEFS, materialById, recipeSnapshotFor, today, fmtDate, pad, ri, pick, rand });

  return db;
}

/* ---------------- 库存种子：期初库存 + 45 天采购/耗用/报损/盘点/调拨事件按时间重放 ---------------- */
function seedInventory(db, id, seq, h) {
  const { STORES, MATERIALS, RECIPE_DEFS, materialById, recipeSnapshotFor, today, fmtDate, pad, ri, pick, rand } = h;
  const tsAt = (d, h0 = 9, h1 = 21) => `${fmtDate(d)} ${pad(ri(h0, h1))}:${pad(ri(0, 59))}:${pad(ri(0, 59))}`;

  db.materials = MATERIALS.map(m => ({ ...m, active: 1 }));
  db.recipes = RECIPE_DEFS.map(def => ({
    serviceId: def.serviceId,
    lines: def.lines.map(l => ({ materialId: l.materialId, qty: l.qty })),
    updatedAt: '2026-08-01 00:00:00',
  }));
  db.inventoryPolicy = { shortageMode: 'strict', updatedAt: null };

  for (const s of STORES) for (const m of MATERIALS) db.stockBalances.push({ storeId: s.id, materialId: m.id, qty: 0 });
  const bal = (storeId, materialId) => db.stockBalances.find(b => b.storeId === storeId && b.materialId === materialId);
  let mvSeq = 0;
  const events = [];
  const pushEv = (ts, kind, fn, tie) => events.push({ ts, kind, fn, tie });

  // 1) 期初库存：按本店 45 天实际耗材耗用量设置（保证重放过程不出现无意义的历史负库存）
  const initDate = new Date(today.getTime() - 46 * 864e5);
  const consumed = {}; // storeId|materialId -> qty
  db.orders.forEach(o => (o.materialSnapshot || []).forEach(l => {
    const k = `${o.storeId}|${l.materialId}`;
    consumed[k] = (consumed[k] || 0) + l.qty;
  }));
  const inits = [];
  for (const s of STORES) for (const m of MATERIALS) {
    const used = consumed[`${s.id}|${m.id}`] || 0;
    const qty = Math.round(used * (0.9 + rand() * 0.35) + (used > 0 ? ri(20, 120) : ri(0, 30)));
    if (qty > 0) inits.push({ storeId: s.id, materialId: m.id, qty });
  }
  pushEv(`${fmtDate(initDate)} 08:00:00`, 'init', (apply) => {
    inits.forEach(x => apply(x.storeId, x.materialId, x.qty, { refType: 'init', operator: db.stores.find(s => s.id === x.storeId).manager, remark: '期初建账库存' }));
  }, 0);

  // 2) 采购 / 报损 / 盘点计划（具体数量在重放时按当时账面生成）
  const SUPPLIERS = ['康源卫材', '沪杭医疗用品', '蕲春本草', '芳疗精油直供', '白云日化批发'];
  const checkPlans = [];
  for (let d = 45; d >= 1; d--) {
    const day = new Date(today.getTime() - d * 864e5);
    for (const s of STORES) {
      if (ri(1, 9) <= 1) {
        const chosen = [...MATERIALS].sort(() => rand() - 0.5).slice(0, ri(2, 4));
        const ts = tsAt(day, 9, 11);
        pushEv(ts, 'purchase', (apply) => {
          const po = { id: `PO__${s.id}_${d}`, storeId: s.id, supplier: pick(SUPPLIERS), operator: s.manager, lines: [], totalAmount: 0, createdAt: ts };
          chosen.forEach(m => {
            const pack = m.category === '一次性耗材' ? 500 : m.category === '消毒用品' ? 800 : m.unit === 'ml' ? 1000 : 100;
            const qty = ri(2, 5) * pack;
            const cost = Math.round(m.defaultCost * (0.92 + rand() * 0.16) * 100) / 100;
            po.lines.push({ materialId: m.id, qty, unitCost: cost, amount: Math.round(qty * cost * 100) / 100 });
          });
          po.totalAmount = Math.round(po.lines.reduce((a, l) => a + l.amount, 0) * 100) / 100;
          db.purchaseOrders.push(po);
          po.lines.forEach(l => apply(s.id, l.materialId, l.qty, { refType: 'purchase', refId: po.id, unitCost: l.unitCost, operator: s.manager, remark: `采购入库 · ${po.supplier}` }));
        }, 1);
      }
      if (ri(1, 11) === 1) {
        const chosen = [...MATERIALS].sort(() => rand() - 0.5).slice(0, ri(1, 2));
        const reason = pick(['过期报废', '包装破损', '操作洒漏', '受潮变质']);
        const ts = tsAt(day, 19, 21);
        pushEv(ts, 'loss', (apply) => {
          const ls = { id: `LS__${s.id}_${d}`, storeId: s.id, lines: [], totalAmount: 0, reason, operator: s.manager, createdAt: ts };
          chosen.forEach(m => {
            const qty = Math.min(ri(2, 12), Math.max(0, Math.floor(bal(s.id, m.id).qty)));
            if (qty <= 0) return;
            ls.lines.push({ materialId: m.id, qty, unitCost: m.defaultCost, amount: Math.round(qty * m.defaultCost * 100) / 100 });
          });
          if (!ls.lines.length) return;
          ls.totalAmount = Math.round(ls.lines.reduce((a, l) => a + l.amount, 0) * 100) / 100;
          db.stockLosses.push(ls);
          ls.lines.forEach(l => apply(s.id, l.materialId, -l.qty, { refType: 'loss', refId: ls.id, unitCost: l.unitCost, operator: s.manager, remark: `报损 · ${reason}` }));
        }, 3);
      }
      if (d === (10 + STORES.indexOf(s) * 5) % 38 + 1) {
        checkPlans.push({ day, s });
      }
    }
    if (ri(1, 6) === 1) {
      const from = pick(STORES), to = pick(STORES.filter(x => x.id !== from.id));
      const m = pick(MATERIALS);
      const ts1 = tsAt(day, 13, 15), ts2 = tsAt(day, 16, 18);
      pushEv(ts1, 'transfer', (apply) => {
        const qty = ri(5, 25);
        if (bal(from.id, m.id).qty < qty + 5) return; // 当时库存不足则该笔调拨不成立
        const trId = id('inventoryTransfer', 'IT', 6);
        db.inventoryTransfers.push({
          id: trId, fromStoreId: from.id, toStoreId: to.id,
          lines: [{ materialId: m.id, qty }], reason: pick(['门店应急调剂', '新店补给', '活动备货支援']),
          status: 'confirmed', operator: from.manager, confirmer: to.manager,
          createdAt: ts1, confirmedAt: ts2, canceledAt: null, cancelReason: null,
        });
        apply(from.id, m.id, -qty, { refType: 'transfer_out', refId: trId, operator: from.manager, remark: `调出至${to.name}` });
        pushEv(ts2, 'transfer-in', (a2) => a2(to.id, m.id, qty, { refType: 'transfer_in', refId: trId, operator: to.manager, remark: `由${from.name}调入` }), 2);
      }, 1);
    }
  }
  // 盘点事件（账面数取重放当时余额）
  for (const p of checkPlans) {
    const ts = tsAt(p.day, 19, 20);
    const chosen = [...MATERIALS].sort(() => rand() - 0.5).slice(0, ri(5, 8));
    pushEv(ts, 'check', (apply) => {
      const ck = { id: `CK__${p.s.id}_${fmtDate(p.day)}`, storeId: p.s.id, status: 'closed', operator: p.s.manager, remark: pick(['月度盘点', '周度抽盘', '节前盘点']), lines: [], createdAt: ts, confirmedAt: ts };
      chosen.forEach(m => {
        const systemQty = bal(p.s.id, m.id).qty;
        const actualQty = Math.max(0, Math.round((systemQty + ri(-6, 4)) * 100) / 100);
        const diff = Math.round((actualQty - systemQty) * 100) / 100;
        ck.lines.push({ materialId: m.id, systemQty, actualQty, diff });
      });
      const adj = ck.lines.filter(l => l.diff !== 0);
      if (!adj.length) return;
      db.stockChecks.push(ck);
      adj.forEach(l => apply(p.s.id, l.materialId, l.diff, { refType: 'check', refId: ck.id, operator: p.s.manager, remark: `盘点${l.diff > 0 ? '盘盈' : '盘亏'}调整` }));
    }, 2);
  }

  // 3) 历史订单耗材耗用（每笔账单按自己的配方快照出库）
  db.orders.forEach(o => {
    if (!o.materialSnapshot || !o.materialSnapshot.length) return;
    const svc = db.services.find(v => v.id === o.serviceId);
    pushEv(o.createdAt, 'consume', (apply) => {
      o.materialSnapshot.forEach(l => apply(o.storeId, l.materialId, -l.qty, {
        refType: 'consume', refId: o.id, unitCost: l.unitCost, operator: '上钟录单', remark: `${svc?.name || o.serviceId}（账单 ${o.orderNo}）耗用`,
      }));
    }, 4);
  });

  // 4) 按时间重放（同时间按 init < purchase/transfer < check/transfer-in < loss < consume 排序）
  events.sort((a, b) => a.ts.localeCompare(b.ts) || a.tie - b.tie);
  const apply = (storeId, materialId, delta, mv) => {
    const b = bal(storeId, materialId);
    b.qty = Math.round((b.qty + delta) * 100) / 100;
    db.stockMovements.push({
      id: `MV${String(++mvSeq).padStart(7, '0')}`,
      refType: mv.refType, refId: mv.refId || null,
      storeId, materialId, direction: delta >= 0 ? 'in' : 'out',
      qty: Math.round(Math.abs(delta) * 100) / 100,
      unitCost: materialById(materialId) ? materialUnitCostSeed(materialById(materialId), mv.unitCost) : 0,
      balanceAfter: b.qty, operator: mv.operator || '', remark: mv.remark || '', createdAt: mv.createdAt,
    });
  };
  function materialUnitCostSeed(m, override) { return Number(override) > 0 ? Number(override) : m.defaultCost; }
  events.forEach(e => e.fn((storeId, materialId, delta, mv) =>
    apply(storeId, materialId, delta, { ...mv, createdAt: mv.createdAt || e.ts })));

  // 5) 今日：一笔待调入方确认的在途调拨样例（S01 → S02）
  {
    const m = MATERIALS[0], from = STORES[0], to = STORES[1];
    const qty = 30;
    const trId = id('inventoryTransfer', 'IT', 6);
    const ts = `${fmtDate(today)} ${pad(ri(9, 12))}:${pad(ri(0, 59))}:${pad(ri(0, 59))}`;
    db.inventoryTransfers.push({
      id: trId, fromStoreId: from.id, toStoreId: to.id,
      lines: [{ materialId: m.id, qty }], reason: '陆家嘴周末活动备货支援',
      status: 'in_transit', operator: from.manager, confirmer: null,
      createdAt: ts, confirmedAt: null, canceledAt: null, cancelReason: null,
    });
    apply(from.id, m.id, -qty, { refType: 'transfer_out', refId: trId, operator: from.manager, remark: `调出至${to.name}（待确认）`, createdAt: ts });
  }

  // 6) 统一编号（采购/盘点/报损占位 ID 换成正式号）
  let poSeq = 0, ckSeq = 0, lsSeq = 0;
  const remap = (arr, prefix, seqRef, len, key) => {
    arr.forEach((x, i) => { const old = x.id; x.id = `${prefix}${String(i + 1).padStart(len, '0')}`; seqRef.value = i + 1; db.stockMovements.filter(mv => mv.refId === old).forEach(mv => { mv.refId = x.id; }); });
  };
  db.purchaseOrders.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  db.stockChecks.sort((a, b) => a.confirmedAt.localeCompare(b.confirmedAt));
  db.stockLosses.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const poRef = { value: 0 }, ckRef = { value: 0 }, lsRef = { value: 0 };
  remap(db.purchaseOrders, 'PO', poRef, 6);
  remap(db.stockChecks, 'CK', ckRef, 6);
  remap(db.stockLosses, 'LS', lsRef, 6);
  db.counters.purchaseOrder = poRef.value;
  db.counters.stockCheck = ckRef.value;
  db.counters.stockLoss = lsRef.value;
  db.counters.inventoryTransfer = db.inventoryTransfers.length;
  db.counters.stockMovement = db.stockMovements.length;
  db.counters.inventoryAlert = 0;
  db.counters.material = MATERIALS.length;
  db.counters.recipe = 0;
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
