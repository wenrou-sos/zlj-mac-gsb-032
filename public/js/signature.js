/* 手写签字板（canvas，支持鼠标/触摸） */
function initSignature(canvas, { onChange } = {}) {
  const ctx = canvas.getContext('2d');
  let drawing = false, empty = true;

  function resize() {
    const ratio = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const data = empty ? null : canvas.toDataURL();
    canvas.width = rect.width * ratio;
    canvas.height = rect.height * ratio;
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2.2; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#123a3f';
    if (data) { const img = new Image(); img.onload = () => ctx.drawImage(img, 0, 0, rect.width, rect.height); img.src = data; }
  }
  function pos(e) {
    const rect = canvas.getBoundingClientRect();
    const t = e.touches ? e.touches[0] : e;
    return { x: t.clientX - rect.left, y: t.clientY - rect.top };
  }
  function start(e) {
    e.preventDefault();
    drawing = true; empty = false;
    const p = pos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y);
  }
  function move(e) {
    if (!drawing) return;
    e.preventDefault();
    const p = pos(e); ctx.lineTo(p.x, p.y); ctx.stroke();
  }
  function end() { drawing = false; onChange?.(isEmpty()); }
  function isEmpty() { return empty; }
  function clear() { ctx.clearRect(0, 0, canvas.width, canvas.height); empty = true; onChange?.(true); }
  function dataURL() { return empty ? null : canvas.toDataURL('image/png'); }

  canvas.addEventListener('mousedown', start);
  canvas.addEventListener('mousemove', move);
  window.addEventListener('mouseup', end);
  canvas.addEventListener('touchstart', start, { passive: false });
  canvas.addEventListener('touchmove', move, { passive: false });
  canvas.addEventListener('touchend', end);

  setTimeout(resize, 0);
  window.addEventListener('resize', resize);
  return { clear, dataURL, isEmpty };
}
