/* UI 工具：DOM、格式化、toast、弹窗、表格 */
const $ = (sel, root = document) => root.querySelector(sel);
const h = (html) => { const t = document.createElement('template'); t.innerHTML = String(html).trim(); return t.content.firstElementChild; };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtMoney = (n) => '¥' + Number(n || 0).toLocaleString('zh-CN');
const fmtNum = (n) => Number(n || 0).toLocaleString('zh-CN');
const payName = (p) => ({ cash: '现金', card: '刷卡', member: '会员卡', mp: '移动支付' }[p] || p);
const payTag = (p) => {
  const map = { cash: 'tag-green', card: 'tag-blue', member: 'tag-gold', mp: 'tag-gray' };
  return `<span class="tag ${map[p] || 'tag-gray'}">${payName(p)}</span>`;
};
const statusTag = (s) => ({
  active: '<span class="tag tag-green">在职</span>',
  leave: '<span class="tag tag-gold">休假</span>',
  left: '<span class="tag tag-gray">已离职</span>',
  open: '<span class="tag tag-blue">进行中</span>',
  closed: '<span class="tag tag-gray">已交班</span>',
}[s] || s);

let toastTimer = null;
function toast(msg, type = 'success') {
  let el = $('.toast');
  if (!el) { el = h(`<div class="toast"></div>`); document.body.appendChild(el); }
  const icon = type === 'error' ? '⚠️' : type === 'success' ? '✅' : 'ℹ️';
  el.innerHTML = `<span>${icon}</span><span>${esc(msg)}</span>`;
  el.className = 'toast show ' + type;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast'; }, 2400);
}

/* 模态弹窗 */
let modalEl = null;
function openModal({ title, body, footer, size = '', onClose }) {
  closeModal();
  modalEl = h(`
    <div class="modal-mask show">
      <div class="modal ${size}">
        <div class="modal-h"><h3>${esc(title)}</h3><button class="modal-x" data-close>×</button></div>
        <div class="modal-b"></div>
        <div class="modal-f" style="display:none"></div>
      </div>
    </div>`);
  const mb = $('.modal-b', modalEl);
  const mf = $('.modal-f', modalEl);
  if (typeof body === 'string') mb.innerHTML = body;
  else if (body instanceof Node) mb.appendChild(body);
  if (footer) {
    mf.style.display = 'flex';
    if (typeof footer === 'string') mf.innerHTML = footer;
    else if (footer instanceof Node) mf.appendChild(footer);
  }
  $('[data-close]', modalEl).onclick = () => closeModal();
  modalEl.addEventListener('mousedown', (e) => { if (e.target === modalEl) closeModal(); });
  document.body.appendChild(modalEl);
  modalEl._onClose = onClose;
  return { el: modalEl, body: mb, footer: mf };
}
function closeModal() {
  if (modalEl) { modalEl._onClose?.(); modalEl.remove(); modalEl = null; }
}
function confirmBox(msg, onOk, okText = '确认') {
  const m = openModal({
    title: '操作确认',
    body: `<p style="padding:6px 2px;font-size:14px;line-height:1.7">${msg}</p>`,
    footer: `<button class="btn" data-close>取消</button><button class="btn btn-danger" id="cfm-ok">${esc(okText)}</button>`,
  });
  $('#cfm-ok', m.el).onclick = async () => {
    try { await onOk(); closeModal(); } catch (e) { toast(e.message, 'error'); }
  };
}

/* 确认弹窗（同步等待） */
function confirmAsync(msg, okText = '确认', danger = true) {
  return new Promise((resolve) => {
    const m = openModal({
      title: '操作确认',
      body: `<p style="padding:6px 2px;font-size:14px;line-height:1.7">${msg}</p>`,
      footer: `<button class="btn" data-c="0">取消</button><button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-c="1">${esc(okText)}</button>`,
    });
    m.el.querySelectorAll('[data-c]').forEach(b => b.onclick = () => { closeModal(); resolve(b.dataset.c === '1'); });
  });
}

function loading() { return `<div class="loading"><div class="spin"></div>数据加载中…</div>`; }
function emptyBox(text = '暂无数据') { return `<div class="empty"><span class="e-ico">📭</span>${esc(text)}</div>`; }

function debounce(fn, ms = 300) {
  let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

/* 门店选项 */
function storeOptions(stores, selected, allLabel) {
  return (allLabel ? `<option value="">${allLabel}</option>` : '') +
    stores.map(s => `<option value="${s.id}" ${s.id === selected ? 'selected' : ''}>${esc(s.name)}</option>`).join('');
}
function storeName(id) {
  return App.ctx?.stores?.find(s => s.id === id)?.name || id || '-';
}
