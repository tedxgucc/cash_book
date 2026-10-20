// Small SVG chart builders shared by the app's graph panels, the PDF report and the Excel export.
// Every function returns an SVG string and takes a theme (CBCharts.themes.dark or .light).
window.CBCharts = (() => {
  // Categorical colors are checked for color-blind separation. Slot 1 is TEDx red.
  // More than 7 items fold into a grey "Other" slice, so colors never repeat.
  const themes = {
    dark: {
      fg: '#F5F2F1', muted: '#A69B9F', dim: '#6E6468', rule: '#2C2528', surface: '#151113',
      font: "'JetBrains Mono',ui-monospace,Menlo,Consolas,monospace",
      series: ['#F0284A', '#3987e5', '#199e70', '#9085e9', '#c98500', '#008300', '#d55181'],
      other: '#6E6468', prev: '#5A5054', cur: '#F0284A', good: '#3BD38A', bad: '#FF5A6E'
    },
    light: {
      fg: '#0B090A', muted: '#5E5558', dim: '#9A9093', rule: '#E6E0E1', surface: '#FFFFFF',
      font: 'Arial,Helvetica,sans-serif',
      series: ['#E0002A', '#2a78d6', '#1baf7a', '#6250d6', '#eda100', '#008300', '#e87ba4'],
      other: '#B5ACAF', prev: '#C9C1C3', cur: '#E0002A', good: '#1A8F5A', bad: '#C8102E'
    }
  };

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
  const fmt = n => (Math.round(n) || 0).toLocaleString('en-US');
  const compact = n => { const a = Math.abs(n); return a >= 1e6 ? (n / 1e6).toFixed(2).replace(/\.?0+$/, '') + 'M' : a >= 1e4 ? Math.round(n / 1e3) + 'K' : fmt(n); };
  const svg = (W, H, body, T, label) => `<svg xmlns="http://www.w3.org/2000/svg" class="chart" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(label)}" font-family="${esc(T.font)}">${body}</svg>`;
  // Inline style so the app's own 'svg text' CSS can't shrink or recolor these labels.
  const txt = (x, y, s, T, o = {}) => `<text x="${x}" y="${y}" text-anchor="${o.anchor || 'middle'}" style="fill:${o.fill || T.muted};font-size:${o.size || 11}px;${o.weight ? `font-weight:${o.weight};` : ''}font-family:${T.font.replace(/"/g, "'")}">${esc(s)}</text>`;

  // Keep the biggest items and fold the rest into "Other". Colors follow the item, not its rank.
  function fold(items, T, max = 7) {
    const pos = items.filter(i => i.value > 0).sort((a, b) => b.value - a.value);
    const keep = pos.length > max ? pos.slice(0, max - 1) : pos;
    const out = keep.map((it, i) => ({...it, color: it.color || T.series[i % T.series.length]}));
    if (pos.length > max) out.push({label: `Other (${pos.length - keep.length})`, value: pos.slice(max - 1).reduce((s, i) => s + i.value, 0), color: T.other});
    return out;
  }

  // Bar with rounded data-end, anchored square on the baseline.
  function barPath(x, y, w, h, r = 4, dir = 'up') {
    r = Math.max(0, Math.min(r, w / 2, h));
    if (h <= 0) return '';
    if (dir === 'right') return `M${x},${y}h${w - r}a${r},${r} 0 0 1 ${r},${r}v${h - 2 * r}a${r},${r} 0 0 1 -${r},${r}h-${w - r}z`;
    return `M${x},${y + h}v-${h - r}a${r},${r} 0 0 1 ${r},-${r}h${w - 2 * r}a${r},${r} 0 0 1 ${r},${r}v${h - r}z`;
  }

  function donut(items, T, o = {}) {
    const S = o.size || 220, R = S / 2 - 4, r = R * (o.hole || .62), cx = S / 2, cy = S / 2;
    const total = items.reduce((s, i) => s + i.value, 0);
    let body = '';
    if (!total) body = `<circle cx="${cx}" cy="${cy}" r="${(R + r) / 2}" fill="none" stroke="${T.rule}" stroke-width="${R - r}"/>`;
    else if (items.length === 1) body = `<circle cx="${cx}" cy="${cy}" r="${(R + r) / 2}" fill="none" stroke="${items[0].color}" stroke-width="${R - r}"><title>${esc(items[0].label)}: ${fmt(items[0].value)}</title></circle>`;
    else {
      let a = -Math.PI / 2;
      items.forEach(it => {
        const da = it.value / total * Math.PI * 2, b = a + da, big = da > Math.PI ? 1 : 0;
        const p = (rad, ang) => `${cx + rad * Math.cos(ang)},${cy + rad * Math.sin(ang)}`;
        body += `<path d="M${p(R, a)}A${R},${R} 0 ${big} 1 ${p(R, b)}L${p(r, b)}A${r},${r} 0 ${big} 0 ${p(r, a)}Z" fill="${it.color}" stroke="${T.surface}" stroke-width="2" stroke-linejoin="round"><title>${esc(it.label)}: ${fmt(it.value)} (${Math.round(it.value / total * 100)}%)</title></path>`;
        a = b;
      });
    }
    if (o.center != null) body += txt(cx, cy + (o.sub ? 2 : 7), o.center, T, {fill: T.fg, size: o.centerSize || 22, weight: 700});
    if (o.sub) body += txt(cx, cy + 20, o.sub, T, {size: 11});
    return svg(S, S, body, T, o.label || 'Donut chart');
  }

  // Donut with its legend drawn inside the same SVG (used where HTML isn't available, e.g. Excel).
  function donutCard(items, T, o = {}) {
    const S = o.size || 190, W = o.w || 560, rowH = 24, total = items.reduce((s, i) => s + i.value, 0) || 1;
    const H = Math.max(S, items.length * rowH + 12);
    let g = `<g transform="translate(0,${(H - S) / 2})">${donut(items, T, {size: S, center: o.center, sub: o.sub, centerSize: 18})}</g>`;
    const lx = S + 24, y0 = (H - items.length * rowH) / 2;
    items.forEach((it, i) => {
      const y = y0 + i * rowH;
      g += `<rect x="${lx}" y="${y + 5}" width="11" height="11" rx="2" fill="${it.color}"/>`;
      g += txt(lx + 18, y + 15, trunc(it.label, 30), T, {anchor: 'start', fill: T.fg, size: 12});
      g += txt(W - 48, y + 15, fmt(it.value), T, {anchor: 'end', fill: T.fg, size: 12, weight: 600});
      g += txt(W - 2, y + 15, Math.round(it.value / total * 100) + '%', T, {anchor: 'end', size: 11});
    });
    return svg(W, H, g, T, o.label || 'Donut chart');
  }

  // Legend as HTML rows: swatch, name, value, share.
  function legend(items, o = {}) {
    const total = items.reduce((s, i) => s + i.value, 0) || 1;
    return `<div class="cb-legend">${items.map(i => `<div class="cb-lg-row"><i style="background:${i.color}"></i><span class="cb-lg-l">${esc(i.label)}</span><span class="cb-lg-v">${fmt(i.value)}</span><span class="cb-lg-p">${Math.round(i.value / total * 100)}%</span></div>`).join('')}${o.total ? `<div class="cb-lg-row cb-lg-tot"><i></i><span class="cb-lg-l">Total</span><span class="cb-lg-v">${fmt(total)}</span><span class="cb-lg-p">100%</span></div>` : ''}</div>`;
  }

  // Grouped vertical bars. cats: ['Jan', ...]; series: [{name, color, values: [...]}]
  function bars(cats, series, T, o = {}) {
    const W = o.w || 620, H = o.h || 250, top = 26, bot = 34, left = 46, right = 8;
    const all = series.flatMap(s => s.values);
    const max = Math.max(1, ...all), min = Math.min(0, ...all);
    const nice = niceMax(max);
    const y = v => top + (nice - v) / (nice - min) * (H - top - bot);
    let g = '';
    for (let i = 0; i <= 4; i++) { const v = min + (nice - min) * i / 4, yy = y(v); g += `<line x1="${left}" x2="${W - right}" y1="${yy}" y2="${yy}" stroke="${T.rule}" stroke-width="1"/>` + txt(left - 6, yy + 4, compact(v), T, {anchor: 'end', size: 10}); }
    const gw = (W - left - right) / Math.max(1, cats.length), inner = gw * .72, bw = Math.min(46, (inner - (series.length - 1) * 2) / series.length);
    const used = bw * series.length + (series.length - 1) * 2;
    cats.forEach((c, ci) => {
      const gx = left + ci * gw + (gw - used) / 2;
      series.forEach((s, si) => {
        const v = s.values[ci] || 0, x = gx + si * (bw + 2), y0 = y(0), yv = y(Math.max(0, v)), h = Math.abs(y(v) - y0);
        const d = v >= 0 ? barPath(x, yv, bw, h) : `M${x},${y0}h${bw}v${h}h-${bw}z`;
        if (d) g += `<path d="${d}" fill="${s.colors?.[ci] || s.color}"><title>${esc(s.name)} · ${esc(c)}: ${fmt(v)}</title></path>`;
        if (o.labels !== false && series.length <= 2 && v) g += txt(x + bw / 2, yv - 5, compact(v), T, {fill: T.fg, size: 10, weight: 600});
      });
      g += txt(left + ci * gw + gw / 2, H - 12, c, T, {size: 11});
    });
    return svg(W, H, g, T, o.label || 'Bar chart');
  }

  // Horizontal bars with an optional thinner "last year" bar under each row.
  function hbars(rows, T, o = {}) {
    const W = o.w || 620, lw = o.labelW || 150, vw = 70, rowH = rows.some(r => r.prev != null) ? 30 : 22;
    const H = Math.max(rowH, rows.length * rowH) + 6;
    const max = Math.max(1, ...rows.map(r => Math.max(r.value, r.prev || 0)));
    const sx = v => v / max * (W - lw - vw - 8);
    let g = '';
    rows.forEach((r, i) => {
      const y = 4 + i * rowH, hasPrev = r.prev != null;
      g += txt(lw - 8, y + 13, trunc(r.label, 22), T, {anchor: 'end', fill: T.fg, size: 12});
      const w = sx(r.value);
      if (w > 0) g += `<path d="${barPath(lw, y + 3, w, 12, 3, 'right')}" fill="${r.color || T.cur}"><title>${esc(r.label)}: ${fmt(r.value)}</title></path>`;
      g += txt(lw + w + 6, y + 13, compact(r.value), T, {anchor: 'start', fill: T.fg, size: 11, weight: 600});
      if (hasPrev) { const pw = sx(r.prev); if (pw > 0) g += `<path d="${barPath(lw, y + 17, pw, 6, 2, 'right')}" fill="${T.prev}"><title>Last year: ${fmt(r.prev)}</title></path>`; g += txt(lw + pw + 6, y + 23, r.prev ? compact(r.prev) : '—', T, {anchor: 'start', size: 9}); }
    });
    return svg(W, H, g, T, o.label || 'Ranked bars');
  }

  function waterfall(steps, T, o = {}) {
    const W = o.w || 620, H = o.h || 250, top = 28, bot = 38, left = 8;
    const max = Math.max(1, ...steps.map(s => Math.max(s.from, s.to))), min = Math.min(0, ...steps.map(s => Math.min(s.from, s.to)));
    const y = v => top + (max - v) / (max - min) * (H - top - bot);
    const bw = (W - left * 2) / steps.length;
    let g = `<line x1="0" x2="${W}" y1="${y(0)}" y2="${y(0)}" stroke="${T.rule}"/>`;
    steps.forEach((s, i) => {
      const x = left + i * bw + bw * .2, w = bw * .6, y1 = y(Math.max(s.from, s.to)), y2 = y(Math.min(s.from, s.to));
      g += `<rect x="${x}" y="${y1}" width="${w}" height="${Math.max(2, y2 - y1)}" rx="3" fill="${s.color}"><title>${esc(s.label)}: ${fmt(s.to - s.from)}</title></rect>`;
      const label = s.delta ? '−' + compact(Math.abs(s.to - s.from)) : compact(s.to);
      g += txt(x + w / 2, y1 - 8, label, T, {fill: T.fg, size: 11, weight: 700});
      g += txt(x + w / 2, H - 14, s.label, T, {size: 11});
      if (i < steps.length - 1) { const nx = left + (i + 1) * bw + bw * .2; g += `<line x1="${x + w}" x2="${nx}" y1="${y(s.to)}" y2="${y(s.to)}" stroke="${T.dim}" stroke-dasharray="3 3"/>`; }
    });
    return svg(W, H, g, T, o.label || 'Waterfall');
  }

  function ring(pct, T, o = {}) {
    const S = o.size || 140, R = S / 2 - 12, C = 2 * Math.PI * R, col = pct > .8 ? T.good : pct > .5 ? '#C98500' : T.bad;
    const body = `<circle cx="${S / 2}" cy="${S / 2}" r="${R}" fill="none" stroke="${T.rule}" stroke-width="14"/><circle cx="${S / 2}" cy="${S / 2}" r="${R}" fill="none" stroke="${col}" stroke-width="14" stroke-dasharray="${C * pct} ${C}" transform="rotate(-90 ${S / 2} ${S / 2})" stroke-linecap="round"/>` + txt(S / 2, S / 2 + 8, Math.round(pct * 100) + '%', T, {fill: T.fg, size: 24, weight: 700});
    return svg(S, S, body, T, o.label || 'Coverage');
  }

  function niceMax(v) { const p = Math.pow(10, Math.floor(Math.log10(v))), m = v / p; return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p; }
  function trunc(s, n) { s = String(s ?? ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; }
  const url = s => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(s);

  // Rasterize an SVG string to a PNG data URL (for Excel, which can't show SVG).
  function toPng(s, scale = 2) {
    return new Promise((res, rej) => {
      const m = s.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/), W = +m[1], H = +m[2];
      const img = new Image();
      img.onload = () => { const c = document.createElement('canvas'); c.width = W * scale; c.height = H * scale; const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(img, 0, 0, c.width, c.height); res({data: c.toDataURL('image/png'), w: W, h: H}); };
      img.onerror = rej; img.src = url(s);
    });
  }

  return {themes, fold, donut, donutCard, legend, bars, hbars, waterfall, ring, url, toPng, esc, fmt, compact};
})();
