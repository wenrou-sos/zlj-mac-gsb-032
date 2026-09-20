/* jsdom 集成测试：真实执行前端脚本 + 真实后端接口（总部会话） */
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

(async () => {
  const files = ['js/api.js', 'js/ui.js', 'js/charts.js', 'js/signature.js', 'js/hq.js', 'js/store.js', 'js/app.js'];
  const inline = files.map(f => `<script>${fs.readFileSync(path.join('public', f), 'utf8')}</script>`).join('');
  const dom = new JSDOM(`<!DOCTYPE html><html><body><div id="app"></div>${inline}</body></html>`, {
    url: 'http://localhost:3000/#/login', pretendToBeVisual: true, runScripts: 'dangerously',
  });
  const { window } = dom;
  // jsdom 无 fetch，接 Node fetch 并补全相对 URL
  window.fetch = (p, opt) => fetch(new URL(p, 'http://localhost:3000').href, opt);
  window.HTMLCanvasElement.prototype.getContext = function () {
    return new Proxy({}, { get: () => () => { } });
  };
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  // app.js 在脚本执行时 readyState 为 loading，等待 DOMContentLoaded（jsdom 会真实派发）
  await new Promise(res => window.document.addEventListener('DOMContentLoaded', res));
  await sleep(300);
  const $ = (sel) => window.document.querySelector(sel);
  const html = () => $('#app').innerHTML;
  const docHtml = () => window.document.body.innerHTML;

  if (!$('.login-card')) throw new Error('登录页未渲染');
  console.log('✅ 登录页渲染，门店下拉数量：', $('#login-store')?.options?.length);

  $('#login-user').value = 'hq'; $('#login-pwd').value = '123456';
  $('#login-btn').click();
  await sleep(700);
  if (!window.location.hash.includes('/hq/dashboard')) throw new Error('登录后未跳转：' + window.location.hash);
  await sleep(1000);
  if (!html().includes('全品牌总营收') || !html().includes('各门店营收排行') || !html().includes('会员充值总额')) throw new Error('总部看板内容缺失');
  if (html().includes('加载失败')) throw new Error('看板渲染报错');
  if (window.document.querySelectorAll('svg').length < 2) throw new Error('图表 SVG 未渲染，实际 ' + window.document.querySelectorAll('svg').length);
  if (window.document.querySelectorAll('circle').length < 5) throw new Error('环形图扇区未渲染');
  console.log('✅ 总部看板（KPI / 排行 / 趋势面积图 / 品类环形图）');

  const checks = [
    ['#/hq/stores', '门店列表'],
    ['#/hq/services', '服务项目目录'],
    ['#/hq/membership', '会员等级与折扣体系'],
    ['#/hq/commission', '项目专项提成规则'],
    ['#/hq/technicians', '技师档案'],
    ['#/hq/transfers', '技师跨店调动记录'],
    ['#/hq/orders', '全部门店账单流水'],
    ['#/hq/handovers', '全品牌交班记录'],
    ['#/hq/recharges', '会员充值流水'],
  ];
  for (const [hash, expect] of checks) {
    window.location.hash = hash;
    window.dispatchEvent(new window.Event('hashchange'));
    await sleep(750);
    if (html().includes('加载失败')) throw new Error(hash + ' 渲染报错');
    if (!html().includes(expect)) throw new Error(hash + ' 缺少「' + expect + '」');
    console.log('✅', expect);
  }

  // 技师档案弹窗（含培训考核/调动记录）
  window.location.hash = '#/hq/technicians';
  window.dispatchEvent(new window.Event('hashchange'));
  await sleep(750);
  const btn = [...window.document.querySelectorAll('[data-view]')][0];
  btn.click();
  await sleep(700);
  if (!$('.modal')) throw new Error('技师档案弹窗未打开');
  if (!docHtml().includes('培训与考核记录')) throw new Error('档案缺少培训考核模块');
  // 新增一条考核记录
  $('#add-train')?.click();
  await sleep(200);
  if (!$('.modal #x-topic')) throw new Error('添加考核弹窗异常');
  $('#x-topic').value = 'jsdom专项考核'; $('#x-score').value = '96';
  $('#x-ok').click();
  await sleep(700);
  if (docHtml().includes('jsdom专项考核') && docHtml().includes('合格')) console.log('✅ 技师档案弹窗 + 培训考核新增');
  else throw new Error('培训考核新增后未刷新');
  $('.modal-x').click();
  await sleep(200);

  // 新增项目
  window.location.hash = '#/hq/services';
  window.dispatchEvent(new window.Event('hashchange'));
  await sleep(700);
  $('#add-svc').click();
  await sleep(200);
  if (!$('.modal #f-name')) throw new Error('新增项目弹窗异常');
  $('#f-name').value = 'jsdom测试项目'; $('#f-price').value = '99'; $('#f-duration').value = '40';
  $('#ok').click();
  await sleep(700);
  if (html().includes('jsdom测试项目')) console.log('✅ 新增项目并即时刷新列表');
  else throw new Error('新增项目后列表未刷新');

  console.log('\n🎉 总部端全部页面集成测试通过');
  process.exit(0);
})().catch(e => { console.error('❌', e.message); process.exit(1); });
