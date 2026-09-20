/* jsdom 集成测试：门店端核心流程（开单 → 签字交班） */
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

(async () => {
  const files = ['js/api.js', 'js/ui.js', 'js/charts.js', 'js/signature.js', 'js/hq.js', 'js/store.js', 'js/inventory.js', 'js/store-inventory.js', 'js/app.js'];
  const inline = files.map(f => `<script>${fs.readFileSync(path.join('public', f), 'utf8')}</script>`).join('');
  const dom = new JSDOM(`<!DOCTYPE html><html><body><div id="app"></div>${inline}</body></html>`, {
    url: 'http://localhost:3000/#/login', pretendToBeVisual: true, runScripts: 'dangerously',
  });
  const { window } = dom;
  window.fetch = (p, opt) => fetch(new URL(p, 'http://localhost:3000').href, opt);
  // 签字板 stub（jsdom 无 canvas 2d）
  window.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;signed-pad';
  window.HTMLCanvasElement.prototype.getContext = () => ({
    scale() { }, beginPath() { }, moveTo() { }, lineTo() { }, stroke() { }, clearRect() { },
  });
  // 在签字板上模拟一次手写笔画（使 initSignature 的 empty 标志变为 false）
  const drawOn = (c) => {
    c.dispatchEvent(new window.MouseEvent('mousedown', { clientX: 10, clientY: 10, bubbles: true }));
    c.dispatchEvent(new window.MouseEvent('mousemove', { clientX: 30, clientY: 30, bubbles: true }));
    c.dispatchEvent(new window.MouseEvent('mouseup', { bubbles: true }));
  };
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  await new Promise(res => window.document.addEventListener('DOMContentLoaded', res));
  await sleep(200);
  const $ = (s) => window.document.querySelector(s);
  const $$ = (s) => [...window.document.querySelectorAll(s)];
  const docHtml = () => window.document.body.innerHTML;

  // 门店登录（s02）
  $('#login-user').value = 's02'; $('#login-pwd').value = '123456';
  $('#login-btn').click();
  await sleep(1200);
  if (!window.location.hash.includes('/store/dashboard')) throw new Error('门店登录跳转失败: ' + window.location.hash);
  if (!docHtml().includes('当前班次进行中')) throw new Error('门店看板缺少当前班次信息');
  console.log('✅ 门店看板（当前班次/支付汇总）');

  // 上钟开单页
  window.location.hash = '#/store/orders';
  window.dispatchEvent(new window.Event('hashchange'));
  await sleep(900);
  if (!$('#o-svc')) throw new Error('开单表单未渲染');
  $('#o-svc').selectedIndex = 2; $('#o-svc').dispatchEvent(new window.Event('change'));
  $('#o-tech').selectedIndex = 1; $('#o-tech').dispatchEvent(new window.Event('change'));
  await sleep(600);
  if (!$('#quote').textContent.includes('实付金额')) throw new Error('金额试算异常: ' + $('#quote').textContent);
  console.log('✅ 开单金额试算：' + $('#quote').textContent.replace(/\s+/g, ' ').slice(0, 80));
  // 提交散客单（现金）
  $('#o-pay').value = 'cash';
  $('#o-submit').click();
  await sleep(800);
  if (!docHtml().includes('本班账单实时列表')) throw new Error('账单列表缺失');
  await sleep(300);
  console.log('✅ 上钟开单成功，账单已入本班列表');

  // 会员单：选第一位会员（开单提交后页面会重渲染，需重新选择项目/技师/会员）
  if ($('#o-member').options.length > 1) {
    $('#o-svc').selectedIndex = 1; $('#o-svc').dispatchEvent(new window.Event('change'));
    $('#o-tech').selectedIndex = 1; $('#o-tech').dispatchEvent(new window.Event('change'));
    $('#o-member').selectedIndex = 1; $('#o-member').dispatchEvent(new window.Event('change'));
    await sleep(600);
    const quoteText = $('#quote').textContent;
    if (!quoteText.includes('会员折扣')) throw new Error('会员折扣未体现');
    $('#o-submit').click();
    await sleep(800);
    console.log('✅ 会员卡扣款开单（自动折扣）');
  }

  // 交班结算页
  window.location.hash = '#/store/handover';
  window.dispatchEvent(new window.Event('hashchange'));
  await sleep(900);
  if (!docHtml().includes('交接班签字确认')) throw new Error('交班页未渲染');
  const before = docHtml();
  if (!before.includes('现金收入') || !before.includes('刷卡收入') || !before.includes('会员卡收入')) throw new Error('交班报表支付分类缺失');
  if (!before.includes('本班技师上钟明细') && !before.includes('本班暂无上钟记录')) throw new Error('上钟明细缺失');
  console.log('✅ 交班报表（接待人数/现金/刷卡/会员卡/明细）');

  // 不签字直接提交 → 应被拦截
  $('#c-closer').value = '接班人测试';
  $('#c-ok').click();
  await sleep(400);
  const toastErr = $$('.toast').some(t => t.textContent.includes('手写签字'));
  if (!toastErr) throw new Error('未签字未被拦截');
  console.log('✅ 未手写签字时禁止交班');

  // 双方在签字板上签名后提交
  drawOn($('#sign1')); drawOn($('#sign2'));
  await sleep(100);
  $('#c-ok').click();
  await sleep(1000);
  if (!docHtml().includes('已完成交班') || !docHtml().includes('双方签字确认')) throw new Error('交班完成页未展示');
  console.log('✅ 双方签字完成交班，展示完成页与双签名');

  // 去看板：当前无进行中班次
  $('#go-dash').click();
  await sleep(1000);
  if (!docHtml().includes('当前无进行中的班次')) throw new Error('交班后看板状态未更新');
  console.log('✅ 交班后看板状态更新（等待开下一班）');

  // 历史记录可见新记录
  window.location.hash = '#/store/handovers';
  window.dispatchEvent(new window.Event('hashchange'));
  await sleep(900);
  const rows = $$('table tbody tr');
  if (!rows.length) throw new Error('历史交班记录为空');
  if (!docHtml().includes('接班人测试')) throw new Error('最新交接记录未出现');
  console.log('✅ 历史交班记录含双方签字条目');

  console.log('\n🎉 门店端核心流程集成测试通过');
  process.exit(0);
})().catch(e => { console.error('❌', e.message); process.exit(1); });
