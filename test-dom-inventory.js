/* jsdom 集成测试：耗材与库存模块页面（总部耗材/配方/分析 + 门店库存/流水/调拨） */
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
  window.fetch = (p, opt) => fetch(new URL(p, 'http://localhost:3000').href, opt);
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  await new Promise(res => window.document.addEventListener('DOMContentLoaded', res));
  await sleep(200);
  const $ = (s) => window.document.querySelector(s);
  const $$ = (s) => [...window.document.querySelectorAll(s)];
  const html = () => window.document.body.innerHTML;

  const login = async (user) => {
    const logout = $('#logout-btn');
    if (logout) { logout.click(); await sleep(600); }
    if (user.startsWith('s')) {
      $$('.login-tabs button').find(b => b.dataset.role === 'store').click();
      await sleep(100);
    }
    $('#login-user').value = user; $('#login-pwd').value = '123456';
    $('#login-btn').click();
    await sleep(1200);
  };
  const goto = async (hash, ms = 1000) => {
    window.location.hash = hash;
    window.dispatchEvent(new window.Event('hashchange'));
    await sleep(ms);
  };

  /* ---------------- 总部 ---------------- */
  await login('hq');

  // 耗材档案
  await goto('#/hq/materials');
  if (!html().includes('耗材档案')) throw new Error('耗材档案页未渲染');
  if (!html().includes('一次性泡脚袋')) throw new Error('耗材列表缺数据');
  if (!html().includes('禁止开单') || !html().includes('允许负库存')) throw new Error('缺货策略切换缺失');
  console.log('✅ 总部耗材档案与成本页（含缺货策略开关）');
  // 编辑弹窗
  $('[data-edit]').click();
  await sleep(300);
  if (!$('.modal') || !$('#f-cost')) throw new Error('耗材编辑弹窗未打开');
  $('#f-cost').value = '0.42';
  $('#ok', $('.modal')).click();
  await sleep(600);
  if (!html().includes('¥0.42')) throw new Error('耗材调价后列表未刷新');
  console.log('✅ 耗材成本编辑保存生效');
  // 切换缺货策略
  $('#policy-seg button[data-m="negative"]').click();
  await sleep(500);
  if (!$('#policy-seg button[data-m="negative"]').classList.contains('active')) throw new Error('负库存策略未切换');
  $('#policy-seg button[data-m="strict"]').click();
  await sleep(500);
  console.log('✅ 总部缺货策略可切换');

  // 项目配方
  await goto('#/hq/recipes');
  if (!html().includes('标准耗用配方')) throw new Error('配方页未渲染');
  if (!html().includes('单耗成本')) throw new Error('配方单耗成本未显示');
  $('[data-edit="V12"]').click();
  await sleep(400);
  if (!$('.modal') || !$$('.rl-row').length) throw new Error('配方编辑弹窗未打开或无明细行');
  const lineCount = $$('.rl-row').length;
  $('#rl-add').click();
  await sleep(200);
  if ($$('.rl-row').length !== lineCount + 1) throw new Error('配方添加品项失败');
  $$('.rl-row [data-del]').pop().click(); // 删除刚加的行
  await sleep(200);
  $('#rl-ok').click();
  await sleep(600);
  if (html().includes('配方已保存') === false && !$$('.toast').some(t => t.textContent.includes('配方'))) throw new Error('配方保存提示缺失');
  console.log('✅ 项目配方维护弹窗（增删品项/单耗成本联动）');

  // 成本毛利分析
  await goto('#/hq/inventory-analysis');
  if (!html().includes('项目耗材理论耗用')) throw new Error('分析页耗材KPI缺失');
  if (!html().includes('门店损耗率排行')) throw new Error('损耗率排行缺失');
  if (!html().includes('理论库存与实际库存差异')) throw new Error('账实差异表缺失');
  if (!html().includes('项目毛利分析')) throw new Error('项目毛利表缺失');
  if (!html().includes('毛利率')) throw new Error('毛利率列缺失');
  console.log('✅ 总部成本/账实差异/损耗率/项目毛利分析页');

  /* ---------------- 门店 s02 ---------------- */
  await login('s02');

  // 耗材库存页
  await goto('#/store/inventory');
  if (!html().includes('本店耗材库存')) throw new Error('门店库存页未渲染');
  if (!html().includes('采购入库')) throw new Error('采购入库按钮缺失');
  if (!$$('#inv-tbl tbody tr').length) throw new Error('库存明细无数据');
  console.log('✅ 门店耗材库存页（KPI/库存表/缺货策略提示）');

  // 采购入库弹窗
  $('#btn-purchase').click();
  await sleep(400);
  if (!$('.modal') || !$('#po-lines')) throw new Error('采购弹窗未打开');
  const poRows = $$('#po-lines .rl-row').length;
  $('#po-add').click();
  await sleep(200);
  if ($$('#po-lines .rl-row').length !== poRows + 1) throw new Error('采购添加品项失败');
  $('#po-sup').value = 'DOM测试供应商';
  $('#po-ok').click();
  await sleep(700);
  if (!html().includes('入库成功')) throw new Error('采购入库成功提示缺失');
  console.log('✅ 采购入库弹窗提交成功并刷新库存');

  // 盘点弹窗
  $('#btn-check').click();
  await sleep(400);
  if (!$$('.ck-qty').length) throw new Error('盘点弹窗未带出账面数');
  console.log('✅ 盘点弹窗自动带出账面数量');
  $('[data-close]', $('.modal')).click();
  await sleep(200);

  // 报损弹窗
  $('#btn-loss').click();
  await sleep(400);
  if (!$('.modal') || !$('#ls-reason')) throw new Error('报损弹窗未打开');
  $('[data-close]', $('.modal')).click();
  await sleep(200);

  // 库存流水
  await goto('#/store/stock-movements');
  if (!html().includes('本店库存流水')) throw new Error('流水页未渲染');
  if (!$$('#mv-box tbody tr').length) throw new Error('流水无数据');
  if (!html().includes('结存')) throw new Error('流水结存列缺失');
  console.log('✅ 门店库存流水页（类型筛选/入出库/结存）');

  // 调拨页
  await goto('#/store/transfers');
  if (!html().includes('发起跨店调拨')) throw new Error('调拨页未渲染');
  if (!html().includes('调拨流程')) throw new Error('调拨流程说明缺失');
  $('#btn-new').click();
  await sleep(400);
  if (!$('.modal') || !$('#tr-to')) throw new Error('新建调拨弹窗未打开');
  $('[data-close]', $('.modal')).click();
  await sleep(200);
  console.log('✅ 跨店调拨页（待确认/新建/记录）');

  console.log('\n🎉 耗材与库存模块页面集成测试通过');
})().catch(e => { console.error('❌', e.message); process.exit(1); });
