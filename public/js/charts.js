/* 纯 SVG 图表 */
let __chartSeq = 0;
const Charts = {
  PALETTE: ['#1f8a70', '#c8a04b', '#3c78c8', '#d05a4e', '#7c5fc4', '#3aa6a1', '#e08a3c', '#6b8f4e', '#b4567d', '#8a99a3'],

  /* 面积折线图：data = [{ date|label, revenue }] */
  areaLine(data, opts = {}) {
    const gid = 'ag' + (++__chartSeq);
    const w = 720, hgt = 260, pad = { l: 52, r: 16, t: 18, b: 30 };
    const iw = w - pad.l - pad.r, ih = hgt - pad.t - pad.b;
    const vals = data.map(d => d.value ?? d.revenue ?? 0);
    const max = Math.max(1, ...vals) * 1.12;
    const x = (i) => pad.l + (data.length === 1 ? iw / 2 : (i / (data.length - 1)) * iw);
    const y = (v) => pad.t + ih - (v / max) * ih;
    const pts = vals.map((v, i) => `${x(i)},${y(v)}`);
    const area = `M${pad.l},${pad.t + ih} L${pts.join(' L')} L${x(vals.length - 1)},${pad.t + ih} Z`;
    const line = 'M' + pts.join(' L');
    const grid = [0, .25, .5, .75, 1].map(g => {
      const gy = pad.t + ih - g * ih, val = Math.round(max * g);
      return `<line x1="${pad.l}" y1="${gy}" x2="${w - pad.r}" y2="${gy}" stroke="#eef2f1"/>
              <text x="${pad.l - 8}" y="${gy + 4}" text-anchor="end" font-size="11" fill="#9aa8ab">${val >= 10000 ? (val / 10000).toFixed(1) + 'w' : val}</text>`;
    }).join('');
    const step = Math.max(1, Math.ceil(data.length / 8));
    const labels = data.map((d, i) => (i % step === 0 || i === data.length - 1)
      ? `<text x="${x(i)}" y="${hgt - 9}" text-anchor="middle" font-size="11" fill="#9aa8ab">${esc((d.label || d.date || '').slice(5))}</text>` : '').join('');
    const dots = vals.map((v, i) => `<circle cx="${x(i)}" cy="${y(v)}" r="2.6" fill="#1f8a70"><title>${esc(data[i].label || data[i].date)}：${fmtMoney(v)}</title></circle>`).join('');
    return `<svg viewBox="0 0 ${w} ${hgt}" class="chart-box" preserveAspectRatio="xMidYMid meet">
      <defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#1f8a70" stop-opacity=".28"/><stop offset="100%" stop-color="#1f8a70" stop-opacity=".02"/>
      </linearGradient></defs>
      ${grid}<path d="${area}" fill="url(#${gid})"/><path d="${line}" fill="none" stroke="#1f8a70" stroke-width="2.4"/>${dots}${labels}
    </svg>`;
  },

  /* 环形图：data = [{ name, value }] */
  donut(data, opts = {}) {
    const size = 200, r = 78, c = 2 * Math.PI * r, cx = size / 2;
    const total = data.reduce((a, d) => a + d.value, 0) || 1;
    let offset = 0;
    const segs = data.map((d, i) => {
      const len = (d.value / total) * c;
      const seg = `<circle cx="${cx}" cy="${cx}" r="${r}" fill="none" stroke="${this.PALETTE[i % this.PALETTE.length]}"
        stroke-width="30" stroke-dasharray="${Math.max(0, len - 2)} ${c - Math.max(0, len - 2)}"
        stroke-dashoffset="${-offset}" transform="rotate(-90 ${cx} ${cx})"><title>${esc(d.name)}：${fmtMoney(d.value)} (${(d.value / total * 100).toFixed(1)}%)</title></circle>`;
      offset += len;
      return seg;
    }).join('');
    const center = `<text x="${cx}" y="${cx - 6}" text-anchor="middle" font-size="12" fill="#9aa8ab">${esc(opts.centerLabel || '合计')}</text>
      <text x="${cx}" y="${cx + 16}" text-anchor="middle" font-size="19" font-weight="700" fill="#152628">${opts.centerFmt ? opts.centerFmt(total) : fmtMoney(total)}</text>`;
    return `<svg viewBox="0 0 ${size} ${size}" style="width:${size}px;max-width:100%">${segs}${center}</svg>`;
  },

  legend(data, total, colors = this.PALETTE) {
    total = total || data.reduce((a, d) => a + d.value, 0) || 1;
    return `<div class="legend">${data.map((d, i) =>
      `<span><i class="dot" style="background:${colors[i % colors.length]}"></i>${esc(d.name)}
        <b style="color:#24343a">${fmtMoney(d.value)}</b>
        <span class="muted">(${(d.value / total * 100).toFixed(1)}%)</span></span>`).join('')}</div>`;
  },

  /* 横向排行条：data=[{ name, sub, value, extra }] */
  rankBars(data) {
    const max = Math.max(1, ...data.map(d => d.value));
    return data.map((d, i) => `
      <div class="rank-row">
        <div class="rank-no">${i + 1}</div>
        <div>
          <div>${esc(d.name)} <span class="muted" style="font-size:12px">${d.sub ? esc(d.sub) : ''}</span></div>
          <div class="rank-bar"><i style="width:${Math.max(2, d.value / max * 100)}%"></i><span>${d.value > 0 ? fmtMoney(d.value) : '—'}</span></div>
        </div>
        <div class="num money">${fmtMoney(d.value)}</div>
        <div class="num muted" style="font-size:12.5px">${d.extra || ''}</div>
      </div>`).join('');
  },
};
