// Graph panels, the branded Excel export and the PDF report.
// index.html calls CB.init(api) once, then CB.graphs(c) on every render.
window.CB = (() => {
  let A = null; // app internals handed over by index.html
  const C = window.CBCharts, DARK = C.themes.dark, LIGHT = C.themes.light;
  const APP_LIGHT = {...LIGHT, font: DARK.font}; // the app's light mode: light colors, app font
  const {esc, fmt, compact} = C;
  const $ = (s, r = document) => r.querySelector(s);
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const LOGO = {tedx: 'assets/tedxguc-logo.png', guc: 'assets/guc-logo.png'};

  /* ---------- libraries, loaded only when needed ---------- */
  const LIBS = {
    exceljs: 'https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js',
    jspdf: 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
    h2c: 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js'
  };
  const loading = {};
  const lib = k => loading[k] ||= new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = LIBS[k]; s.onload = res;
    s.onerror = () => { delete loading[k]; s.remove(); rej(new Error('Could not load a library. Check your internet connection.')); };
    document.head.appendChild(s);
  });
  const dataUrl = async path => { const b = await (await fetch(path)).blob(); return new Promise(r => { const f = new FileReader(); f.onload = () => r(f.result); f.readAsDataURL(b); }); };

  /* ---------- data ---------- */
  const emptyYear = y => ({year: y, gross: 0, vat: 0, net: 0, spBank: 0, spCash: 0, other: 0, inKind: 0, sponsors: new Map()});
  function season(y) {
    const c = A.calc(y), Y = c.years[y] || emptyYear(y);
    const has = [...A.S.allEntries.values()].some(e => A.yearOf(e) === y) || [...A.S.sponsors.values()].some(r => +r.year === y);
    return {y, c, Y, has, spent: c.cashOut + c.bankOut, sponsorNet: Y.spBank + Y.spCash};
  }
  function compare(cur, prev) {
    const r = (label, a, b, goodUp = true, count = false) => ({label, cur: a, prev: b, goodUp, count});
    return [
      r('Gross income', cur.Y.gross, prev.Y.gross), r('VAT removed', cur.Y.vat, prev.Y.vat, false), r('Net income', cur.Y.net, prev.Y.net),
      r('Sponsorship (after VAT)', cur.sponsorNet, prev.sponsorNet), r('Other income', cur.Y.other, prev.Y.other), r('In-kind sponsorship (est.)', cur.Y.inKind, prev.Y.inKind),
      r('Cash spent', cur.c.cashOut, prev.c.cashOut, false), r('Bank spent', cur.c.bankOut, prev.c.bankOut, false), r('Total spent', cur.spent, prev.spent, false),
      r('Closing balance (cash + bank)', cur.c.total, prev.c.total), r('Number of sponsors', cur.Y.sponsors.size, prev.Y.sponsors.size, true, true)
    ];
  }
  function monthly(c, only) { // only: 'cash' or 'bank' to look at one money source
    const m = {};
    c.done.forEach(e => {
      if (e.transferId || !e.date || (only && !e.kind.startsWith(only))) return;
      const inc = e.kind === 'cashIn' || e.kind === 'bankIn';
      if (inc && A.catOf(e) === 'opening') return;
      const k = String(e.date).slice(0, 7); if (!/^\d{4}-\d{2}$/.test(k)) return;
      const r = m[k] ||= {in: 0, out: 0}; r[inc ? 'in' : 'out'] += +e.amount || 0;
    });
    const keys = Object.keys(m).sort().slice(-12), multi = new Set(keys.map(k => k.slice(0, 4))).size > 1;
    return {keys, cats: keys.map(k => MONTHS[+k.slice(5) - 1] + (multi ? ` '${k.slice(2, 4)}` : '')), inV: keys.map(k => m[k].in), outV: keys.map(k => m[k].out)};
  }
  const phaseList = c => A.S.settings.phases.map(n => c.phases[n]).filter(Boolean).concat(Object.values(c.phases).filter(p => !A.S.settings.phases.includes(p.name)));
  const phaseItems = (c, T) => phaseList(c).map((p, i) => ({label: p.name, value: p.total, color: T.series[i % T.series.length]})).filter(i => i.value > 0);
  const sourceItems = (Y, T) => [
    {label: 'Sponsors · bank (after VAT)', value: Y.spBank, color: T.series[0]},
    {label: 'Sponsors · cash', value: Y.spCash, color: T.series[1]},
    {label: 'Other income', value: Y.other, color: T.series[2]},
    {label: 'In-kind (estimated)', value: Y.inKind, color: T.series[4]}
  ].filter(i => i.value > 0);
  const sponsorItems = (Y, T) => C.fold([...Y.sponsors.values()].map(s => ({label: s.name, value: s.gross || s.inKind})), T);
  const TP = {money: 'Paid', 'in-kind': 'In-kind', both: 'Paid + in-kind', pledged: 'Pledged'};
  const delta = (a, b) => { const d = a - b; return {d, pct: b ? d / Math.abs(b) : null}; };

  /* ---------- in-app graph panels ---------- */
  const donutBlock = (items, T, center, sub, empty) => items.length
    ? `<div class="cb-donut">${C.donut(items, T, {size: 200, center, sub, centerSize: 26})}${C.legend(items, {total: true})}</div>`
    : `<div class="empty">${empty}</div>`;

  let lastC = null;
  // Draw each chart at its panel's real width so labels stay readable on phones.
  const wOf = (sel, def) => { const w = $(sel)?.clientWidth || 0; return w > 0 ? Math.max(300, Math.min(w, 1100)) : def; };
  function graphs(c) {
    if (!A || !$('#gMonthly')) return;
    lastC = c;
    const T = document.documentElement.hasAttribute('data-light') ? APP_LIGHT : DARK, S = A.S, y = S.season, cur = season(y), prev = season(y - 1);
    const m = monthly(c);
    $('#gMonthly').innerHTML = m.keys.length
      ? C.bars(m.cats, [{name: 'Money in', color: T.series[2], values: m.inV}, {name: 'Money out', color: T.cur, values: m.outV}], T, {w: wOf('#gMonthly', 620), h: 250, labels: m.keys.length <= 6, label: 'Money in and out by month'})
        + `<div class="legend"><span><i style="background:${T.series[2]}"></i>Money in (before VAT)</span><span><i style="background:${T.cur}"></i>Money out</span></div>`
      : '<div class="empty">Entries with a date show up here by month.</div>';
    const ph = phaseItems(c, T);
    $('#gPhase').innerHTML = donutBlock(ph, T, compact(ph.reduce((s, i) => s + i.value, 0)), 'EGP spent', 'No spending recorded yet.');
    const src = sourceItems(cur.Y, T);
    $('#gSource').innerHTML = donutBlock(src, T, compact(cur.Y.net + cur.Y.inKind), 'EGP in', 'No income recorded yet.');
    $('#gYoYCap').textContent = `${y - 1} vs ${y}`;
    const cats = ['Gross income', 'Net income', 'Total spent', 'Balance'];
    $('#gYoY').innerHTML = C.bars(cats, [
      {name: String(y - 1), color: T.prev, values: [prev.Y.gross, prev.Y.net, prev.spent, prev.c.total]},
      {name: String(y), color: T.cur, values: [cur.Y.gross, cur.Y.net, cur.spent, cur.c.total]}
    ], T, {w: wOf('#gYoY', 620), h: 250, label: 'This season vs last season'})
      + `<div class="legend"><span><i style="background:${T.prev}"></i>${y - 1}</span><span><i style="background:${T.cur}"></i>${y}</span></div>`
      + (prev.has ? '' : `<div class="muted" style="font-size:13px;margin-top:6px">No entries for ${y - 1} in the cashbook, so last season shows as zero.</div>`);

    // sponsors tab (follows the year picked there)
    const sy = S.year || y, SY = c.years[sy] || emptyYear(sy), PY = c.years[sy - 1] || emptyYear(sy - 1);
    const share = sponsorItems(SY, T);
    $('#gSpShare').innerHTML = donutBlock(share, T, String(SY.sponsors.size), 'sponsors', `No sponsors for ${sy} yet.`);
    $('#gSpShareCap').textContent = `${sy} · by amount given`;
    const top = [...SY.sponsors.values()].sort((a, b) => (b.gross || b.inKind) - (a.gross || a.inKind)).slice(0, 8);
    $('#gSpTop').innerHTML = top.length
      ? C.hbars(top.map(s => ({label: s.name, value: s.gross || s.inKind, prev: (PY.sponsors.get(s.key)?.gross || PY.sponsors.get(s.key)?.inKind || 0)})), T, {w: wOf('#gSpTop', 620), labelW: wOf('#gSpTop', 620) < 480 ? 100 : 150, label: 'Top sponsors vs last year'})
        + `<div class="legend"><span><i style="background:${T.cur}"></i>${sy}</span><span><i style="background:${T.prev}"></i>${sy - 1}</span></div>`
      : `<div class="empty">No sponsors for ${sy} yet.</div>`;
    $('#gSpTopCap').textContent = `${sy} vs ${sy - 1}`;
    $('#gSpYoY').innerHTML = C.bars(wOf('#gSpYoY', 1100) < 600 ? ['Gross', 'VAT', 'Net', 'Spons.', 'Other', 'In-kind'] : ['Gross', 'VAT', 'Net', 'Sponsorship', 'Other income', 'In-kind'], [
      {name: String(sy - 1), color: T.prev, values: [PY.gross, PY.vat, PY.net, PY.spBank + PY.spCash, PY.other, PY.inKind]},
      {name: String(sy), color: T.cur, values: [SY.gross, SY.vat, SY.net, SY.spBank + SY.spCash, SY.other, SY.inKind]}
    ], T, {w: wOf('#gSpYoY', 1100), h: 250, labels: wOf('#gSpYoY', 1100) >= 600, label: 'Income this year vs last year'})
      + `<div class="legend"><span><i style="background:${T.prev}"></i>${sy - 1}</span><span><i style="background:${T.cur}"></i>${sy}</span></div>`;
    $('#gSpYoYCap').textContent = `${sy - 1} vs ${sy}`;
  }

  /* ---------- Excel ---------- */
  const X = {red: 'FFEB0028', ink: 'FF0B090A', fg: 'FFFFFFFF', soft: 'FFF7F4F4', rule: 'FFE6E0E1', muted: 'FF6E6468', good: 'FF1A8F5A', bad: 'FFC8102E', head: 'FFF1ECEC'};
  const MONEY = '#,##0;[Red]-#,##0;"–"', PCT = '0%';
  const fill = argb => ({type: 'pattern', pattern: 'solid', fgColor: {argb}});
  const font = (o = {}) => ({name: 'Arial', size: 10, color: {argb: X.ink}, ...o});
  const thin = {style: 'thin', color: {argb: X.rule}};
  const sum = arr => arr.reduce((s, v) => s + (+v || 0), 0);

  async function excel(seasonY) {
    A.toast('Building the Excel file…');
    await lib('exceljs');
    const S = A.S, y = seasonY || S.season, cur = season(y), prev = season(y - 1), c = cur.c;
    const wb = new ExcelJS.Workbook();
    wb.creator = 'TEDxGUC Cashbook'; wb.created = new Date(); wb.title = `TEDxGUC Cashbook ${y}`;
    wb.calcProperties = {fullCalcOnLoad: true}; // Excel recalculates every formula when the file opens
    const [tedx, guc] = await Promise.all([dataUrl(LOGO.tedx), dataUrl(LOGO.guc)]);
    const IMG = {tedx: wb.addImage({base64: tedx, extension: 'png'}), guc: wb.addImage({base64: guc, extension: 'png'})};
    const today = new Date().toLocaleDateString('en-GB', {day: 'numeric', month: 'long', year: 'numeric'});
    const pic = async (ws, svg, col, row, maxW) => { const p = await C.toPng(svg, 2); const k = Math.min(1, maxW / p.w); ws.addImage(wb.addImage({base64: p.data, extension: 'png'}), {tl: {col, row}, ext: {width: p.w * k, height: p.h * k}, editAs: 'oneCell'}); return p.h * k; };

    const sheet = (name, widths, title, sub, landscape = true) => {
      const ws = wb.addWorksheet(name, {views: [{showGridLines: false}], properties: {tabColor: {argb: X.red}}});
      ws.columns = widths.map(w => ({width: w}));
      ws.pageSetup = {paperSize: 9, orientation: landscape ? 'landscape' : 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: {left: .4, right: .4, top: .5, bottom: .6, header: .2, footer: .3}};
      ws.headerFooter = {oddFooter: `&L&8TEDxGUC Cashbook · Season ${y}&R&8Page &P of &N`};
      const n = widths.length;
      ws.getRow(1).height = 50; ws.getRow(2).height = 4; ws.getRow(3).height = 26; ws.getRow(4).height = 16;
      for (let i = 1; i <= n; i++) ws.getCell(2, i).fill = fill(X.red);
      ws.addImage(IMG.tedx, {tl: {col: .15, row: .45}, ext: {width: 166, height: 30}, editAs: 'oneCell'});
      const px = widths.map(w => w * 7 + 5), total = sum(px); let x = total - 122, ci = 0;
      while (ci < px.length - 1 && x >= px[ci]) { x -= px[ci]; ci++; }
      ws.addImage(IMG.guc, {tl: {col: ci + x / px[ci], row: .08}, ext: {width: 120, height: 58}, editAs: 'oneCell'});
      ws.mergeCells(3, 1, 3, n); Object.assign(ws.getCell(3, 1), {value: title, font: font({size: 16, bold: true}), alignment: {vertical: 'middle'}});
      ws.mergeCells(4, 1, 4, n); Object.assign(ws.getCell(4, 1), {value: sub, font: font({size: 9, color: {argb: X.muted}})});
      return ws;
    };
    const band = (ws, r, n, text, color = X.red, from = 1) => {
      ws.mergeCells(r, from, r, from + n - 1); const cell = ws.getCell(r, from);
      Object.assign(cell, {value: text, font: font({bold: true, size: 10, color: {argb: X.fg}}), fill: fill(color), alignment: {vertical: 'middle', indent: 1}});
      ws.getRow(r).height = 21;
    };
    const head = (ws, r, labels, from = 1, rightFrom = 1) => {
      labels.forEach((l, i) => { if (l == null) return; const cell = ws.getCell(r, from + i); Object.assign(cell, {value: l, font: font({bold: true, size: 9, color: {argb: X.muted}}), fill: fill(X.head), border: {bottom: {style: 'thin', color: {argb: X.ink}}}, alignment: {vertical: 'middle', horizontal: i >= rightFrom ? 'right' : 'left', wrapText: true}}); });
      ws.getRow(r).height = labels.some(l => l && String(l).length > 14) ? 30 : 20;
    };
    const row = (ws, r, vals, o = {}) => {
      vals.forEach((v, i) => {
        if (v === undefined) return;
        const cell = ws.getCell(r, (o.from || 1) + i), isNum = typeof v === 'number' || (v && v.formula);
        cell.value = v; cell.font = font({bold: !!o.bold, italic: !!o.italic, color: {argb: o.color || X.ink}});
        cell.border = {bottom: o.total ? {style: 'medium', color: {argb: X.ink}} : thin};
        if (o.total) { cell.border.top = {style: 'thin', color: {argb: X.ink}}; cell.fill = fill(X.soft); }
        else if (o.stripe) cell.fill = fill(X.soft);
        if (isNum) { cell.numFmt = o.fmts?.[i] || MONEY; cell.alignment = {horizontal: 'right', vertical: 'top'}; }
        else cell.alignment = {vertical: 'top', wrapText: !!o.wrap};
      });
    };
    const colL = n => { let s = ''; while (n) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = (n - m - 1) / 26; } return s; };
    const F = (formula, result) => ({formula, result});

    /* Summary */
    const ws = sheet('Summary', [34, 15, 15, 15, 15, 15, 15, 3, 12, 12, 12, 12, 12, 12, 12], `Season ${y} · Financial summary`, `Prepared ${today} from the live TEDxGUC Cashbook · All amounts in Egyptian pounds (EGP) · Compared with season ${y - 1}`);
    let r = 6;
    band(ws, r++, 7, `KEY FIGURES · SEASON ${y}`);
    head(ws, r, ['Item', 'Amount (EGP)', 'What it means'], 1, 1); ws.getCell(r, 3).alignment = {horizontal: 'left'}; ws.mergeCells(r, 3, r, 7); r++;
    const plannedOut = c.plannedOut;
    const key = [
      ['Cash in', c.cashIn, 'All cash collected this season (includes the opening cash balance).'],
      ['Cash out', c.cashOut, 'All cash spent.'],
      ['Cash in hand', c.cashBal, `Cash in minus cash out. Held by the curator${c.curator ? ` (${c.curator})` : ''}.`, true],
      ['Bank in (before VAT)', c.bankIn, 'Everything deposited in the bank account.'],
      [`VAT removed (${S.settings.taxRate}%)`, c.tax, 'VAT on bank deposits. This money is not ours to spend.'],
      ['Bank out', c.bankOut, 'Payments made from the bank account.'],
      ['Bank balance', c.bankBal, 'Bank in, minus VAT, minus bank out.', true],
      ['Total available', c.total, 'Cash in hand plus bank balance.', true],
      ['Planned, not paid yet', plannedOut, 'Spending entered as planned. Not included in the figures above.'],
      ['Owed to members', c.owed, 'Members who paid from their own pocket and still need reimbursing.']
    ];
    key.forEach(([l, v, m, strong], i) => {
      row(ws, r, [l, v, m], {bold: strong, stripe: i % 2 === 1}); ws.mergeCells(r, 3, r, 7);
      ws.getCell(r, 3).font = font({size: 9, color: {argb: X.muted}}); ws.getCell(r, 3).alignment = {wrapText: true, vertical: 'top'};
      if (strong) { ws.getCell(r, 1).font = font({bold: true}); ws.getCell(r, 2).font = font({bold: true, color: {argb: v < 0 ? X.bad : X.ink}}); }
      r++;
    });
    r++;
    band(ws, r++, 7, `THIS SEASON VS LAST SEASON · ${y} compared with ${y - 1}`);
    head(ws, r++, ['Measure', String(y - 1), String(y), 'Change', 'Change %', 'Direction'], 1, 1);
    compare(cur, prev).forEach((m, i) => {
      const {d, pct} = delta(m.cur, m.prev), good = d === 0 ? null : (d > 0) === m.goodUp;
      const fm = m.count ? '0' : MONEY;
      row(ws, r, [m.label, m.prev, m.cur, F(`C${r}-B${r}`, d), F(`IF(B${r}=0,"",(C${r}-B${r})/ABS(B${r}))`, pct == null ? '' : pct), d === 0 ? 'No change' : (d > 0 ? '▲ Up' : '▼ Down') + (good ? ' (good)' : ' (watch)')], {stripe: i % 2 === 1, fmts: [null, fm, fm, m.count ? '+0;-0;0' : '+#,##0;-#,##0;0', '+0%;-0%;0%']});
      ws.getCell(r, 6).font = font({size: 9, bold: true, color: {argb: good == null ? X.muted : good ? X.good : X.bad}});
      ws.getCell(r, 4).font = ws.getCell(r, 5).font = font({color: {argb: good == null ? X.muted : good ? X.good : X.bad}});
      r++;
    });
    if (!prev.has) { ws.mergeCells(r, 1, r, 7); Object.assign(ws.getCell(r, 1), {value: `No entries for ${y - 1} are in the cashbook yet, so last season shows as zero.`, font: font({italic: true, size: 9, color: {argb: X.muted}})}); r++; }
    r++;
    band(ws, r++, 7, 'SPENDING BY PHASE');
    head(ws, r++, ['Phase', 'Budget', 'From cash', 'From bank', 'Total spent', 'Left in budget', '% of budget'], 1, 1);
    const p0 = r, phs = phaseList(c);
    phs.forEach((p, i) => {
      const b = +S.settings.budgets?.[p.name] || 0;
      row(ws, r, [p.name, b || '', p.cash, p.bank, F(`C${r}+D${r}`, p.total), b ? F(`B${r}-E${r}`, b - p.total) : '', b ? F(`E${r}/B${r}`, p.total / b) : ''], {stripe: i % 2 === 1, fmts: [null, MONEY, MONEY, MONEY, MONEY, MONEY, PCT]});
      if (b && p.total > b) ws.getCell(r, 7).font = font({bold: true, color: {argb: X.bad}});
      r++;
    });
    if (phs.length) {
      const L = r - 1;
      row(ws, r, ['Total', F(`SUM(B${p0}:B${L})`, sum(phs.map(p => +S.settings.budgets?.[p.name] || 0))), F(`SUM(C${p0}:C${L})`, sum(phs.map(p => p.cash))), F(`SUM(D${p0}:D${L})`, sum(phs.map(p => p.bank))), F(`SUM(E${p0}:E${L})`, sum(phs.map(p => p.total))), '', ''], {bold: true, total: true});
      r++;
    }
    r++;
    band(ws, r++, 7, 'HOW TO READ THIS FILE', X.ink);
    [
      'Summary: this page. The headline numbers for the season and how they compare with last season.',
      'Ledger: every entry, one per row. Use the filter arrows in the header row to show one type, member or phase. The totals row only adds up the rows you can see.',
      'Cash book: the classic side-by-side layout (cash in, cash out, bank in, bank out) with running totals and balances at the bottom.',
      'Sponsors: every sponsor per season, what they paid, the VAT removed and any in-kind value.',
      'Team: what each member brought in and spent, money owed to them, and how much of their spending has a fatora (invoice).',
      'Income by year: total income for every season, so you can compare years.',
      `VAT: ${S.settings.taxRate}% is removed from bank deposits. "Net" means after VAT. Amounts in red are negative.`
    ].forEach(t => { ws.mergeCells(r, 1, r, 7); Object.assign(ws.getCell(r, 1), {value: '•  ' + t, font: font({size: 9}), alignment: {wrapText: true, vertical: 'top'}}); ws.getRow(r).height = 26; r++; });
    // charts on the right
    let ry = 5;
    const addTitle = (row0, t) => { ws.mergeCells(row0, 9, row0, 15); Object.assign(ws.getCell(row0, 9), {value: t, font: font({bold: true, size: 11})}); };
    addTitle(ry + 1, `${y - 1} vs ${y}`);
    await pic(ws, C.bars(['Gross income', 'Net income', 'Total spent', 'Balance'], [{name: String(y - 1), color: LIGHT.prev, values: [prev.Y.gross, prev.Y.net, prev.spent, prev.c.total]}, {name: String(y), color: LIGHT.cur, values: [cur.Y.gross, cur.Y.net, cur.spent, cur.c.total]}], LIGHT, {w: 560, h: 240}) .replace('</svg>', `<rect x="60" y="4" width="10" height="10" rx="2" fill="${LIGHT.prev}"/><text x="76" y="13" font-size="11" fill="${LIGHT.muted}">${y - 1}</text><rect x="120" y="4" width="10" height="10" rx="2" fill="${LIGHT.cur}"/><text x="136" y="13" font-size="11" fill="${LIGHT.muted}">${y}</text></svg>`), 8.2, ry + 1.4, 560);
    const ph = phaseItems(c, LIGHT);
    if (ph.length) { addTitle(ry + 19, 'Spending by phase'); await pic(ws, C.donutCard(ph, LIGHT, {center: compact(sum(ph.map(i => i.value))), sub: 'EGP spent'}), 8.2, ry + 19.4, 560); }
    const src = sourceItems(cur.Y, LIGHT);
    if (src.length) { addTitle(ry + 34, 'Where the income came from'); await pic(ws, C.donutCard(src, LIGHT, {center: compact(cur.Y.net + cur.Y.inKind), sub: 'EGP in'}), 8.2, ry + 34.4, 560); }

    /* Ledger */
    const lg = sheet('Ledger', [6, 12, 17, 36, 20, 14, 14, 14, 12, 14, 9, 30], `Season ${y} · Ledger`, 'Every paid or received entry. Filter with the arrows in the header row; the totals row adds up only the rows you can see.');
    const kindOrder = {cashIn: 0, cashOut: 1, bankIn: 2, bankOut: 3};
    const all = [...A.calc(y).all].sort((a, b) => (kindOrder[a.kind] - kindOrder[b.kind]) || ((+a.order || 0) - (+b.order || 0)));
    const doneE = all.filter(e => e.status !== 'planned'), planE = all.filter(e => e.status === 'planned');
    const LH = ['#', 'Date', 'Type', 'Description', 'Member / party', 'Phase', 'Money in', 'Money out', 'VAT', 'Net effect', 'Fatora', 'Note'];
    r = 6; head(lg, r, LH, 1, 6); [2, 3, 4, 5, 6, 11, 12].forEach(i => lg.getCell(r, i).alignment = {horizontal: 'left', vertical: 'middle'});
    lg.views = [{state: 'frozen', ySplit: 6, showGridLines: false}];
    const ledgerRows = (list, startRow, planned) => {
      let rr = startRow;
      list.forEach((e, i) => {
        const inc = e.kind === 'cashIn' || e.kind === 'bankIn', a = +e.amount || 0, v = A.vatOf(e);
        const who = e.kind.startsWith('cash') ? (e.member || e.counterparty || '') : (e.counterparty || e.member || '');
        const type = A.KIND[e.kind] + (e.transferId ? ' (transfer)' : inc && A.catOf(e) === 'opening' ? ' (opening)' : '');
        row(lg, rr, [i + 1, e.date || '', type, e.desc || (e.kind === 'bankIn' ? 'Deposit from ' + (e.counterparty || 'unknown') : e.counterparty || ''), who, e.phase || 'General', inc ? a : '', inc ? '' : a, v || '', planned ? '' : F(`N(G${rr})-N(H${rr})-N(I${rr})`, (inc ? a : -a) - v), e.kind === 'cashOut' ? (e.fatora || 'Not set') : '', e.note || ''], {stripe: i % 2 === 1, italic: planned, color: planned ? X.muted : X.ink, fmts: ['0']});
        lg.getCell(rr, 3).font = font({bold: true, size: 9, italic: planned, color: {argb: inc ? X.good : X.bad}});
        if (e.kind === 'cashOut' && e.fatora !== 'Yes') lg.getCell(rr, 11).font = font({bold: true, color: {argb: X.bad}});
        rr++;
      });
      return rr;
    };
    r = ledgerRows(doneE, 7, false);
    const L1 = r - 1;
    if (doneE.length) {
      lg.autoFilter = {from: {row: 6, column: 1}, to: {row: L1, column: 12}};
      const tot = col => doneE.reduce((s, e) => { const inc = e.kind === 'cashIn' || e.kind === 'bankIn', a = +e.amount || 0; return s + (col === 'G' ? (inc ? a : 0) : col === 'H' ? (inc ? 0 : a) : col === 'I' ? A.vatOf(e) : (inc ? a : -a) - A.vatOf(e)); }, 0);
      row(lg, r, ['', '', '', `Total (${doneE.length} entries)`, '', '', ...['G', 'H', 'I', 'J'].map(cl => F(`SUBTOTAL(109,${cl}7:${cl}${L1})`, tot(cl))), '', ''], {bold: true, total: true});
      r += 2;
    } else { lg.mergeCells(r, 1, r, 12); lg.getCell(r, 1).value = 'No entries yet.'; r += 2; }
    if (planE.length) {
      band(lg, r++, 12, `PLANNED · not paid yet (${planE.length})`, X.ink);
      head(lg, r++, LH, 1, 6);
      const p1 = r; r = ledgerRows(planE, r, true);
      row(lg, r, ['', '', '', 'Total planned', '', '', F(`SUM(G${p1}:G${r - 1})`, sum(planE.filter(e => e.kind.endsWith('In')).map(e => e.amount))), F(`SUM(H${p1}:H${r - 1})`, sum(planE.filter(e => e.kind.endsWith('Out')).map(e => e.amount))), '', '', '', ''], {bold: true, total: true});
    }

    /* Cash book (side by side) */
    const cb = sheet('Cash book', [12, 26, 12, 2, 13, 12, 28, 12, 8, 2, 13, 24, 11, 2, 13, 24], `Season ${y} · Cash book`, 'Cash and bank side by side, the way the team keeps it. Totals and balances are formulas, so they update if you edit a number.');
    const by = k => doneE.filter(e => e.kind === k);
    const phIdx = n => { const i = S.settings.phases.indexOf(n || 'General'); return i < 0 ? 99 : i; };
    const ci = by('cashIn'), co = by('cashOut').sort((a, b) => phIdx(a.phase) - phIdx(b.phase) || (+a.order || 0) - (+b.order || 0)), bi = by('bankIn'), bo = by('bankOut');
    r = 6;
    band(cb, r, 3, 'CASH IN', X.ink, 1); band(cb, r, 5, 'CASH OUT', X.red, 5); band(cb, r, 3, 'BANK IN', X.ink, 11); band(cb, r, 2, 'BANK OUT', X.red, 15); r++;
    head(cb, r, ['Amount', 'Description', 'With', null, 'Phase', 'Amount', 'Description', 'By', 'Fatora', null, 'Amount', 'From', 'VAT', null, 'Amount', 'To'], 1, 99);
    [1, 6, 11, 13, 15].forEach(i => cb.getCell(r, i).alignment = {horizontal: 'right', vertical: 'middle'});
    cb.views = [{state: 'frozen', ySplit: 7, showGridLines: false}];
    r++;
    const n = Math.max(ci.length, co.length, bi.length, bo.length, 1), d0 = r;
    let lastPh = null;
    for (let i = 0; i < n; i++, r++) {
      const st = {stripe: i % 2 === 1};
      if (ci[i]) row(cb, r, [+ci[i].amount || 0, ci[i].desc || '', ci[i].member || ''], st);
      if (co[i]) {
        const p = co[i].phase || 'General';
        row(cb, r, [p !== lastPh ? p : '', +co[i].amount || 0, co[i].desc || '', co[i].member || '', co[i].fatora || '—'], {...st, from: 5});
        if (p !== lastPh) cb.getCell(r, 5).font = font({bold: true, size: 9, color: {argb: X.red}});
        if (co[i].fatora !== 'Yes') cb.getCell(r, 9).font = font({bold: true, color: {argb: X.bad}});
        lastPh = p;
      }
      if (bi[i]) row(cb, r, [+bi[i].amount || 0, bi[i].counterparty || bi[i].desc || '', A.vatOf(bi[i]) || 0], {...st, from: 11});
      if (bo[i]) row(cb, r, [+bo[i].amount || 0, bo[i].counterparty || bo[i].desc || ''], {...st, from: 15});
    }
    const dL = r - 1, S_ = (cl, v) => F(`SUM(${cl}${d0}:${cl}${dL})`, v);
    row(cb, r, [S_('A', c.cashIn), 'Total cash in', ''], {bold: true, total: true});
    row(cb, r, ['', S_('F', c.cashOut), 'Total cash out', '', ''], {bold: true, total: true, from: 5});
    row(cb, r, [S_('K', c.bankIn), 'Total bank in', S_('M', c.tax)], {bold: true, total: true, from: 11});
    row(cb, r, [S_('O', c.bankOut), 'Total bank out'], {bold: true, total: true, from: 15});
    const tr = r; r += 2;
    band(cb, r, 3, 'CASH BALANCE', X.ink, 1); band(cb, r, 6, 'BANK BALANCE', X.ink, 11); r++;
    const bal = [
      [['Cash in', F(`A${tr}`, c.cashIn)], ['Bank in (before VAT)', F(`K${tr}`, c.bankIn)]],
      [['Cash out', F(`F${tr}`, c.cashOut)], [`VAT removed (${S.settings.taxRate}%)`, F(`M${tr}`, c.tax)]],
      [['Cash in hand', F(`A${tr}-F${tr}`, c.cashBal), true], ['Bank after VAT', F(`K${tr}-M${tr}`, c.bankNet)]],
      [null, ['Bank out', F(`O${tr}`, c.bankOut)]],
      [null, ['Bank balance', F(`K${tr}-M${tr}-O${tr}`, c.bankBal), true]]
    ];
    const b0 = r;
    bal.forEach(([cl, bk]) => {
      if (cl) { row(cb, r, [cl[0], '', cl[1]], {bold: !!cl[2], total: !!cl[2]}); cb.mergeCells(r, 1, r, 2); }
      row(cb, r, [bk[0], '', '', '', '', bk[1]], {bold: !!bk[2], total: !!bk[2], from: 11}); cb.mergeCells(r, 11, r, 15);
      r++;
    });
    r++;
    band(cb, r, 3, 'TOTAL AVAILABLE (cash in hand + bank balance)', X.red, 1);
    row(cb, r, [F(`C${b0 + 2}+P${b0 + 4}`, c.total)], {bold: true, from: 4}); cb.mergeCells(r, 4, r, 6);
    cb.getCell(r, 4).font = font({bold: true, size: 13}); cb.getCell(r, 4).alignment = {horizontal: 'left', vertical: 'middle'};

    /* Sponsors */
    const sp = sheet('Sponsors', [30, 15, 14, 12, 14, 16, 10, 44, 3, 12, 12, 12, 12, 12, 12], 'Sponsors by season', `Sponsorship for every season. VAT (${S.settings.taxRate}%) is removed from bank deposits only. In-kind values are estimates, not cash.`);
    r = 6;
    const yearsDesc = Object.keys(c.years).map(Number).sort((a, b) => b - a);
    for (const yy of yearsDesc) {
      const YY = c.years[yy], list = [...YY.sponsors.values()].sort((a, b) => b.gross - a.gross || b.inKind - a.inKind || a.name.localeCompare(b.name));
      band(sp, r++, 8, `SEASON ${yy} · ${list.length} sponsor${list.length === 1 ? '' : 's'}`, yy === y ? X.red : X.ink);
      head(sp, r++, ['Sponsor', 'Type', 'Gross', 'VAT', 'Net', 'In-kind / pledged', 'Payments', 'Notes'], 1, 2);
      sp.getCell(r - 1, 8).alignment = {horizontal: 'left'};
      const s0 = r;
      list.forEach((s, i) => { row(sp, r, [s.name, TP[s.type] || s.type, s.gross, s.vat, s.net, s.inKind, s.payments, s.notes || ''], {stripe: i % 2 === 1, wrap: true, fmts: [null, null, MONEY, MONEY, MONEY, MONEY, '0;-0;"–"']}); sp.getCell(r, 8).font = font({size: 9, color: {argb: X.muted}}); r++; });
      if (list.length) {
        const sL = r - 1, T_ = (cl, v) => F(`SUM(${cl}${s0}:${cl}${sL})`, v);
        row(sp, r, ['Total', '', T_('C', sum(list.map(s => s.gross))), T_('D', sum(list.map(s => s.vat))), T_('E', sum(list.map(s => s.net))), T_('F', sum(list.map(s => s.inKind))), T_('G', sum(list.map(s => s.payments))), ''], {bold: true, total: true, fmts: [null, null, MONEY, MONEY, MONEY, MONEY, '0']});
        r++;
      } else { sp.mergeCells(r, 1, r, 8); sp.getCell(r, 1).value = 'No sponsors recorded.'; sp.getCell(r, 1).font = font({italic: true, color: {argb: X.muted}}); r++; }
      r++;
    }
    const share = sponsorItems(cur.Y, LIGHT);
    if (share.length) { sp.mergeCells(6, 10, 6, 15); Object.assign(sp.getCell(6, 10), {value: `Sponsor share ${y}`, font: font({bold: true, size: 11})}); await pic(sp, C.donutCard(share, LIGHT, {center: String(cur.Y.sponsors.size), sub: 'sponsors'}), 9.2, 6.4, 520); }

    /* Team */
    const tm = sheet('Team', [22, 22, 15, 15, 18, 16, 16, 14], `Season ${y} · Team wallets`, `All team cash is held by the curator${c.curator ? `, ${c.curator}` : ''}. Fatora coverage is the share of each member's cash-out that has an invoice.`, false);
    r = 6; head(tm, r++, ['Member', 'Role', 'Brought in', 'Spent', 'Own pocket, to reimburse', 'Without fatora', 'With fatora', 'Fatora coverage'], 1, 2);
    const ms = Object.values(c.members), m0 = r;
    ms.forEach((m, i) => {
      const role = (m.name === c.curator ? 'Curator' : '') + ((S.settings.roles || {})[m.name] ? (m.name === c.curator ? ' · ' : '') + S.settings.roles[m.name] : '');
      row(tm, r, [m.name + (m.name === c.curator ? ' ★' : ''), role, m.collected, m.spent, m.owed, m.missAmt, m.fYes, F(`IF(D${r}=0,"",G${r}/D${r})`, m.spent ? m.fYes / m.spent : '')], {stripe: i % 2 === 1, fmts: [null, null, MONEY, MONEY, MONEY, MONEY, MONEY, PCT]});
      const cov = m.spent ? m.fYes / m.spent : 1;
      tm.getCell(r, 8).font = font({bold: true, color: {argb: cov > .8 ? X.good : cov > .5 ? 'FFB07400' : X.bad}});
      r++;
    });
    if (ms.length) { const mL = r - 1, T_ = (cl, v) => F(`SUM(${cl}${m0}:${cl}${mL})`, v); row(tm, r, ['Total', '', T_('C', sum(ms.map(m => m.collected))), T_('D', sum(ms.map(m => m.spent))), T_('E', sum(ms.map(m => m.owed))), T_('F', sum(ms.map(m => m.missAmt))), T_('G', sum(ms.map(m => m.fYes))), F(`IF(D${r}=0,"",G${r}/D${r})`, c.outTotal ? c.fYesAmt / c.outTotal : '')], {bold: true, total: true, fmts: [null, null, MONEY, MONEY, MONEY, MONEY, MONEY, PCT]}); }

    /* Income by year */
    const iy = sheet('Income by year', [10, 15, 14, 15, 18, 16, 15, 15, 11, 14], 'Income by year', 'Every season side by side. "Net" is after VAT. The last column compares net income with the season before.');
    r = 6; head(iy, r++, ['Season', 'Gross income', 'VAT removed', 'Net income', 'Sponsorship via bank (after VAT)', 'Sponsorship in cash', 'Other income', 'In-kind (est.)', 'Sponsors', 'Net vs year before'], 1, 1);
    const asc = [...yearsDesc].reverse();
    asc.forEach((yy, i) => {
      const YY = c.years[yy], pv = c.years[asc[i - 1]];
      row(iy, r, [yy, YY.gross, YY.vat, YY.net, YY.spBank, YY.spCash, YY.other, YY.inKind, YY.sponsors.size, i ? F(`IF(D${r - 1}=0,"",(D${r}-D${r - 1})/ABS(D${r - 1}))`, pv?.net ? (YY.net - pv.net) / Math.abs(pv.net) : '') : ''], {stripe: i % 2 === 1, bold: yy === y, fmts: ['0', MONEY, MONEY, MONEY, MONEY, MONEY, MONEY, MONEY, '0', '+0%;-0%;0%']});
      iy.getCell(r, 1).alignment = {horizontal: 'left'};
      r++;
    });
    r++;
    iy.mergeCells(r, 1, r, 10); Object.assign(iy.getCell(r, 1), {value: 'Net income by season', font: font({bold: true, size: 11})});
    await pic(iy, C.bars(asc.map(String), [{name: 'Net income', color: LIGHT.prev, colors: asc.map(v => v === y ? LIGHT.cur : LIGHT.prev), values: asc.map(v => c.years[v].net)}], LIGHT, {w: 620, h: 240}), .2, r + .4, 620);

    const buf = await wb.xlsx.writeBuffer();
    await A.offerFile(`TEDxGUC_Cashbook_${y}.xlsx`, new Blob([buf], {type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));
  }

  /* ---------- PDF report ---------- */
  const CSS = `
.cb-donut{display:grid;grid-template-columns:minmax(120px,190px) minmax(0,1fr);gap:20px;align-items:center}
.cb-donut svg{width:100%;height:auto;max-width:200px}
@media (max-width:520px){.cb-donut{grid-template-columns:1fr;justify-items:center}.cb-donut .cb-legend{width:100%}}
.cb-legend{display:grid;gap:6px;font-size:13px;min-width:0}
.cb-lg-row{display:grid;grid-template-columns:10px minmax(0,1fr) auto 38px;gap:8px;align-items:center}
.cb-lg-row i{width:10px;height:10px;border-radius:2px}
.cb-lg-l{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cb-lg-v,.cb-lg-p{font-variant-numeric:tabular-nums;text-align:right}
.cb-lg-p{color:var(--muted,#6E6468);font-size:12px}
.cb-lg-tot{border-top:1px solid var(--rule,#E6E0E1);padding-top:6px;font-weight:700}
.rp-overlay{position:fixed;inset:0;z-index:80;background:#241E20;overflow:auto;-webkit-overflow-scrolling:touch}
.rp-bar{position:sticky;top:0;z-index:2;display:flex;gap:12px;align-items:center;justify-content:space-between;flex-wrap:wrap;padding:12px max(16px,env(safe-area-inset-left,0px));padding-top:max(12px,env(safe-area-inset-top,0px));background:#0B090A;border-bottom:1px solid #2C2528;color:#F5F2F1}
.rp-bar b{font-size:16px}.rp-bar .lbl{margin-left:10px}
.rp-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.rp-pages{display:grid;justify-content:center;gap:20px;padding:20px 16px 60px}
.rp-page{width:794px;height:1123px;background:#fff;color:#0B090A;font-family:Archivo,"Helvetica Neue",Arial,sans-serif;font-size:12.5px;line-height:1.45;padding:34px 46px 26px;display:flex;flex-direction:column;box-shadow:0 8px 30px rgba(0,0,0,.45);overflow:hidden;position:relative}
.rp-page *{box-sizing:border-box;font-variation-settings:normal!important;letter-spacing:normal;text-wrap:wrap}
.rp-head{display:flex;align-items:center;justify-content:space-between;gap:16px;padding-bottom:12px;border-bottom:3px solid #EB0028}
.rp-head .rp-tedx{height:26px;width:auto}.rp-head .rp-guc{height:54px;width:auto}
.rp-head .rp-mid{font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:#6E6468;text-align:center}
.rp-body{flex:1;min-height:0;overflow:hidden;padding-top:18px;display:flex;flex-direction:column;gap:16px}
.rp-foot{display:flex;justify-content:space-between;font-size:9.5px;color:#8C8387;border-top:1px solid #E6E0E1;padding-top:8px;margin-top:10px}
.rp-cover{position:relative;overflow:hidden;background:#0B090A;color:#fff;border-radius:10px;padding:24px 28px 22px;min-height:150px}
.rp-cover .dot{position:absolute;width:300px;height:300px;border-radius:50%;background:#EB0028;left:-90px;top:-120px}
.rp-cover .ring{position:absolute;width:240px;height:240px;border-radius:50%;border:10px solid #EB0028;right:-80px;bottom:-130px;opacity:.9}
.rp-cover > div{position:relative}
.rp-cover .k{font-size:11px;letter-spacing:.16em;text-transform:uppercase;opacity:.9}
.rp-cover h1{font-size:40px;line-height:1;margin:8px 0 8px;font-weight:900}
.rp-cover p{margin:0;opacity:.85;font-size:12.5px;max-width:52ch}
.rp-h2{display:flex;align-items:baseline;justify-content:space-between;gap:10px;margin:0 0 8px}
.rp-h2 h2{font-size:16px;font-weight:800;margin:0;display:flex;align-items:center;gap:8px}
.rp-h2 h2::before{content:"";width:9px;height:9px;background:#EB0028;border-radius:2px;display:inline-block}
.rp-h2 span{font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:#8C8387}
.rp-section{font-size:24px;font-weight:900;margin:6px 0 14px;line-height:1.05}
.rp-section small{display:block;font-size:11px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:#EB0028;margin-bottom:4px}
.rp-kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}
.rp-kpi{border:1px solid #E6E0E1;border-radius:8px;padding:10px 12px;display:grid;gap:2px}
.rp-kpi.hot{background:#EB0028;border-color:#EB0028;color:#fff}
.rp-kpi.dark{background:#0B090A;border-color:#0B090A;color:#fff}
.rp-kpi .l{font-size:9.5px;letter-spacing:.1em;text-transform:uppercase;opacity:.75}
.rp-kpi b{font-size:21px;font-weight:800;font-variant-numeric:tabular-nums;line-height:1.15}
.rp-kpi b small{font-size:10px;font-weight:600;margin-left:3px;opacity:.75}
.rp-kpi .s{font-size:10px;opacity:.75}
.rp-tbl{width:100%;border-collapse:collapse;font-size:11.5px}
.rp-tbl th{text-align:left;font-size:9px;letter-spacing:.08em;text-transform:uppercase;color:#6E6468;font-weight:700;padding:6px 8px;border-bottom:1.5px solid #0B090A;background:#F7F4F4}
.rp-tbl td{padding:4px 8px;border-bottom:1px solid #EEE9EA;font-variant-numeric:tabular-nums}
.rp-tbl .r{text-align:right}
.rp-tbl tr.tot td{font-weight:800;border-top:1.5px solid #0B090A;border-bottom:0;background:#F7F4F4}
.rp-tbl tr:nth-child(even) td{background:#FBFAFA}
.rp-up{color:#1A8F5A;font-weight:700}.rp-down{color:#C8102E;font-weight:700}.rp-flat{color:#8C8387}
.rp-two{display:grid;grid-template-columns:1fr 1fr;gap:22px;align-items:start}
.rp-chart img{display:block;width:100%;height:auto}
.rp-lg{display:flex;gap:16px;font-size:10.5px;color:#5E5558;margin-top:4px}
.rp-lg i{display:inline-block;width:9px;height:9px;border-radius:2px;margin-right:5px;vertical-align:-1px}
.rp-note{font-size:10.5px;color:#6E6468;margin:0}
.rp-don{display:grid;grid-template-columns:150px minmax(0,1fr);gap:28px;align-items:center}
.rp-don img{width:150px;height:150px}
.rp-don .cb-legend{max-width:440px}
.rp-don .cb-legend{font-size:11px;gap:5px;--muted:#6E6468;--rule:#E6E0E1}
.rp-sign{display:grid;grid-template-columns:1fr 1fr 1fr;gap:24px;margin-top:auto;padding-top:20px}
.rp-sign div{border-top:1px solid #0B090A;padding-top:6px;font-size:10px;color:#6E6468}
.rp-pill{display:inline-block;padding:1px 7px;border-radius:999px;font-size:9.5px;font-weight:700;background:#F1ECEC;color:#5E5558}
.rp-pill.bad{background:#FDE5E9;color:#C8102E}.rp-pill.good{background:#E3F4EB;color:#1A8F5A}
.rp-busy{position:fixed;inset:0;z-index:90;display:grid;place-items:center;background:rgba(11,9,10,.7);color:#fff;font-weight:700}
`;

  const img = (svg, w, h, alt) => `<img src="${C.url(svg)}" width="${w}" height="${h}" alt="${esc(alt)}">`;
  const moneyCell = v => `${v < 0 ? '−' : ''}${fmt(Math.abs(v))}`;
  const deltaCell = (m) => {
    const {d, pct} = delta(m.cur, m.prev);
    if (!d) return '<span class="rp-flat">– no change</span>';
    const good = (d > 0) === m.goodUp, cls = good ? 'rp-up' : 'rp-down';
    return `<span class="${cls}">${d > 0 ? '▲' : '▼'} ${m.count ? Math.abs(d) : compact(Math.abs(d))}${pct != null ? ` · ${Math.abs(Math.round(pct * 100))}%` : ''}</span>`;
  };
  const kpi = (l, v, s, cls = '', unit = 'EGP') => `<div class="rp-kpi ${cls}"><span class="l">${esc(l)}</span><b>${typeof v === 'number' ? moneyCell(v) : esc(v)}${unit ? `<small>${unit}</small>` : ''}</b>${s ? `<span class="s">${esc(s)}</span>` : ''}</div>`;
  const h2 = (t, cap = '') => `<div class="rp-h2"><h2>${esc(t)}</h2><span>${esc(cap)}</span></div>`;
  const lg2 = (a, b) => `<div class="rp-lg"><span><i style="background:${LIGHT.prev}"></i>${a}</span><span><i style="background:${LIGHT.cur}"></i>${b}</span></div>`;

  /* ---------- shared report pieces ---------- */
  const TITLES = {full: 'Financial Report', cash: 'Cash Report', bank: 'Bank Report', uni: 'Sponsorship Report'};
  const FILES = {full: 'Financial_Report', cash: 'Cash_Report', bank: 'Bank_Report', uni: 'Sponsorship_Report'};
  const todayStr = () => new Date().toLocaleDateString('en-GB', {day: 'numeric', month: 'long', year: 'numeric'});
  const dateCell = d => { const t = d ? new Date(d + 'T00:00:00') : null; return t && !isNaN(t) ? t.toLocaleDateString('en-GB', {day: 'numeric', month: 'short'}) : '—'; };
  // Collects report blocks. A section title waits and joins the next block, so it never sits alone at a page bottom.
  function blocks() {
    const B = []; let pend = '';
    return {
      B,
      push: b => { if (pend) { b.html = pend + b.html; pend = ''; } B.push(b); },
      section: (n, t) => { pend = `<h1 class="rp-section"><small>Section ${n}</small>${t}</h1>`; }
    };
  }
  const coverHtml = (y, title, text) => `<div class="rp-cover"><div class="dot"></div><div class="ring"></div><div><div class="k">TEDxGUC · Season ${y}</div><h1>${esc(title)}</h1><p>${text}</p></div></div>`;
  const signHtml = (roles = ['Prepared by', 'Reviewed by (Curator)', 'Date']) => ({html: `<div class="rp-sign">${roles.map(r => `<div>${esc(r)}</div>`).join('')}</div>`, sign: true});
  const cmpTable = (rows, y, prevHas, title = 'Compared with last season') => h2(title, `${y - 1} vs ${y}`) + `<table class="rp-tbl"><thead><tr><th>Measure</th><th class="r">${y - 1}</th><th class="r">${y}</th><th class="r">Change</th></tr></thead><tbody>${rows.map(m => `<tr><td>${esc(m.label)}</td><td class="r">${m.count ? m.prev : moneyCell(m.prev)}</td><td class="r"><b>${m.count ? m.cur : moneyCell(m.cur)}</b></td><td class="r">${deltaCell(m)}</td></tr>`).join('')}</tbody></table>` + (prevHas ? '' : `<p class="rp-note" style="margin-top:6px">No entries for ${y - 1} are in the cashbook yet, so last season shows as zero.</p>`);
  const cmpRow = (label, cur, prev, goodUp = true, count = false) => ({label, cur, prev, goodUp, count});
  const cmpChart = (cats, prevV, curV, y) => `<div class="rp-chart">${img(C.bars(cats, [{name: String(y - 1), color: LIGHT.prev, values: prevV}, {name: String(y), color: LIGHT.cur, values: curV}], LIGHT, {w: 700, h: 170}), 700, 170, 'Comparison with last season')}${lg2(y - 1, y)}</div>`;
  // Long lists split into chunks so each piece fits on a page.
  function listBlocks(push, title, cap, head, rows, total, chunk = 20) {
    if (!rows.length) { push({html: h2(title, cap) + '<p class="rp-note">Nothing recorded.</p>'}); return; }
    for (let i = 0; i < rows.length; i += chunk) {
      const last = i + chunk >= rows.length;
      push({html: (i ? h2(title + ' (continued)') : h2(title, cap)) + `<table class="rp-tbl"><thead><tr>${head}</tr></thead><tbody>${rows.slice(i, i + chunk).join('')}${last && total ? total : ''}</tbody></table>`});
    }
  }
  // Spending by phase for one money source ('cash', 'bank' or 'total'), as donut + table.
  function phaseBlock(c, key, label) {
    const T = LIGHT, phs = phaseList(c), items = phs.map((p, i) => ({label: p.name, value: p[key], color: T.series[i % T.series.length]})).filter(i => i.value > 0);
    const tot = sum(items.map(i => i.value));
    if (!items.length) return h2('Spending by phase', label) + '<p class="rp-note">No spending recorded yet.</p>';
    return h2('Spending by phase', label) + `<div class="rp-two" style="grid-template-columns:150px 1fr"><div>${img(C.donut(items, T, {size: 150, center: compact(tot), sub: 'EGP spent', centerSize: 18}), 150, 150, 'Spending by phase')}</div>
      <table class="rp-tbl"><thead><tr><th>Phase</th><th class="r">Spent</th><th class="r">Share</th></tr></thead><tbody>${items.map(i => `<tr><td><i style="display:inline-block;width:9px;height:9px;border-radius:2px;margin-right:7px;background:${i.color}"></i>${esc(i.label)}</td><td class="r">${fmt(i.value)}</td><td class="r">${Math.round(i.value / tot * 100)}%</td></tr>`).join('')}<tr class="tot"><td>Total</td><td class="r">${fmt(tot)}</td><td class="r">100%</td></tr></tbody></table></div>`;
  }
  function monthlyBlock(c, only, title) {
    const T = LIGHT, m = monthly(c, only);
    if (!m.keys.length) return null;
    return {html: h2(title, 'By month, from entry dates') + `<div class="rp-chart">${img(C.bars(m.cats, [{name: 'In', color: T.series[2], values: m.inV}, {name: 'Out', color: T.cur, values: m.outV}], T, {w: 700, h: 190, labels: m.keys.length <= 6}), 700, 190, title)}<div class="rp-lg"><span><i style="background:${T.series[2]}"></i>Money in${only === 'cash' ? '' : ' (before VAT)'}</span><span><i style="background:${T.cur}"></i>Money out</span></div></div>`};
  }
  const kindLabel = e => e.transferId ? 'Transfer' : A.catOf(e) === 'opening' ? 'Opening balance' : A.catOf(e) === 'sponsor' ? 'Sponsor' : 'Other income';

  // Money sponsors paid in a season (no in-kind), split into bank and cash.
  function sponsorMoney(y) {
    const map = new Map();
    [...A.S.allEntries.values()].forEach(e => {
      if (A.yearOf(e) !== y || e.status === 'planned' || e.transferId || (e.kind !== 'bankIn' && e.kind !== 'cashIn') || A.catOf(e) !== 'sponsor') return;
      const name = A.sponsorOf(e), key = name.toLowerCase();
      const s = map.get(key) || {key, name, bank: 0, cash: 0, vat: 0, payments: 0};
      const a = +e.amount || 0;
      if (e.kind === 'bankIn') { s.bank += a; s.vat += A.vatOf(e); } else s.cash += a;
      s.payments++; map.set(key, s);
    });
    const list = [...map.values()].map(s => ({...s, total: s.bank + s.cash})).sort((a, b) => b.total - a.total);
    return {list, map, bank: sum(list.map(s => s.bank)), cash: sum(list.map(s => s.cash)), vat: sum(list.map(s => s.vat)), total: sum(list.map(s => s.total)), count: list.length};
  }

  /* ---------- cash report ---------- */
  function cashBlocks(y) {
    const S = A.S, cur = season(y), prev = season(y - 1), c = cur.c, pc = prev.c, T = LIGHT;
    const {B, push, section} = blocks();
    const cashOther = cc => sum(cc.done.filter(e => e.kind === 'cashIn' && !e.transferId && A.catOf(e) === 'other').map(e => e.amount));
    const cov = c.outTotal ? c.fYesAmt / c.outTotal : 1;
    push({html: coverHtml(y, 'Cash Report', `Prepared ${todayStr()}. All cash collected and spent this season, held by ${c.curator ? `the curator, ${esc(c.curator)}` : 'the curator'}. Amounts in EGP.`)});
    push({html: `<div class="rp-kpis">${kpi('Cash in', c.cashIn, 'All cash collected')}${kpi('Cash out', c.cashOut, `${c.done.filter(e => e.kind === 'cashOut').length} payments`)}${kpi('Cash in hand', c.cashBal, 'Cash in − cash out', 'hot')}${kpi(`In ${c.curator || 'curator'}'s box`, c.box, 'Includes money owed back', 'dark')}</div>`});
    push({html: `<div class="rp-kpis">${kpi('Sponsorship in cash', cur.Y.spCash, 'Paid by sponsors in cash')}${kpi('Other cash income', cashOther(c), 'Tickets, merch…')}${kpi('Owed to members', c.owed, 'Paid from own pocket')}${kpi('Fatora coverage', Math.round(cov * 100) + '%', `${c.missing.length} cash-outs missing one`, '', '')}</div>`});
    push({html: cmpTable([
      cmpRow('Cash in', c.cashIn, pc.cashIn), cmpRow('Sponsorship in cash', cur.Y.spCash, prev.Y.spCash), cmpRow('Other cash income', cashOther(c), cashOther(pc)),
      cmpRow('Cash out', c.cashOut, pc.cashOut, false), cmpRow('Cash in hand', c.cashBal, pc.cashBal),
      cmpRow('Number of cash payments', c.done.filter(e => e.kind === 'cashOut').length, pc.done.filter(e => e.kind === 'cashOut').length, false, true)
    ], y, prev.has) + cmpChart(['Cash in', 'Cash out', 'Cash in hand'], [pc.cashIn, pc.cashOut, pc.cashBal], [c.cashIn, c.cashOut, c.cashBal], y)});
    section(1, 'Where the cash went');
    push({html: phaseBlock(c, 'cash', 'Cash only')});
    const mb = monthlyBlock(c, 'cash', 'Cash in vs cash out'); if (mb) push(mb);
    section(2, 'Cash entries');
    const ins = c.done.filter(e => e.kind === 'cashIn'), outs = c.done.filter(e => e.kind === 'cashOut');
    listBlocks(push, 'Cash in', `${ins.length} entries`, '<th>Date</th><th>Description</th><th>Collected by</th><th>Type</th><th class="r">Amount</th>',
      ins.map(e => `<tr><td>${dateCell(e.date)}</td><td>${esc(e.desc || '—')}</td><td>${esc(e.member || '—')}</td><td><span class="rp-pill">${kindLabel(e)}</span></td><td class="r">${fmt(e.amount)}</td></tr>`),
      `<tr class="tot"><td colspan="4">Total cash in</td><td class="r">${fmt(c.cashIn)}</td></tr>`);
    listBlocks(push, 'Cash out', `${outs.length} payments`, '<th>Date</th><th>Description</th><th>Phase</th><th>Paid by</th><th>Fatora</th><th class="r">Amount</th>',
      outs.map(e => `<tr><td>${dateCell(e.date)}</td><td>${esc(e.desc || '—')}${e.paidFrom === 'pocket' && !e.reimbursed ? ' <span class="rp-pill">own pocket</span>' : ''}</td><td>${esc(e.phase || 'General')}</td><td>${esc(e.member || '—')}</td><td>${e.fatora === 'Yes' ? '<span class="rp-pill good">Yes</span>' : `<span class="rp-pill bad">${esc(e.fatora || 'Not set')}</span>`}</td><td class="r">${fmt(e.amount)}</td></tr>`),
      `<tr class="tot"><td colspan="5">Total cash out</td><td class="r">${fmt(c.cashOut)}</td></tr>`);
    section(3, 'Team &amp; invoices');
    teamBlocks(push, c);
    const plannedCash = c.planned.filter(e => e.kind === 'cashOut');
    if (plannedCash.length) push({html: h2('Planned cash spending, not paid yet', `${fmt(sum(plannedCash.map(e => e.amount)))} EGP`) + `<table class="rp-tbl"><thead><tr><th>Item</th><th>Phase</th><th class="r">Amount</th></tr></thead><tbody>${plannedCash.slice(0, 10).map(e => `<tr><td>${esc(e.desc || '—')}</td><td>${esc(e.phase || 'General')}</td><td class="r">${+e.amount ? fmt(e.amount) : '<span class="rp-flat">no amount yet</span>'}</td></tr>`).join('')}</tbody></table>`});
    push(signHtml());
    return B;
  }

  /* ---------- bank report ---------- */
  function bankBlocks(y) {
    const S = A.S, cur = season(y), prev = season(y - 1), c = cur.c, pc = prev.c, T = LIGHT;
    const {B, push, section} = blocks();
    const ins = c.done.filter(e => e.kind === 'bankIn'), outs = c.done.filter(e => e.kind === 'bankOut');
    const bankOther = cc => sum(cc.done.filter(e => e.kind === 'bankIn' && !e.transferId && A.catOf(e) === 'other').map(e => e.amount));
    const bankSp = cc => sum(cc.done.filter(e => e.kind === 'bankIn' && !e.transferId && A.catOf(e) === 'sponsor').map(e => e.amount));
    push({html: coverHtml(y, 'Bank Report', `Prepared ${todayStr()}. Every deposit and payment on the bank account this season. ${S.settings.taxRate}% VAT is removed from deposits. Amounts in EGP.`)});
    push({html: `<div class="rp-kpis">${kpi('Bank in (before VAT)', c.bankIn, `${ins.length} deposits`)}${kpi(`VAT removed (${S.settings.taxRate}%)`, c.tax, 'Not ours to spend')}${kpi('Bank out', c.bankOut, `${outs.length} payments`)}${kpi('Bank balance', c.bankBal, 'After VAT and payments', 'hot')}</div>`});
    push({html: `<div class="rp-kpis">${kpi('Sponsor deposits', bankSp(c), 'Before VAT')}${kpi('Other deposits', bankOther(c), 'Non-sponsor income')}${kpi('Bank after VAT', c.bankNet, 'Before payments')}${kpi('Planned bank spend', sum(c.planned.filter(e => e.kind === 'bankOut').map(e => e.amount)), 'Not paid yet', 'dark')}</div>`});
    push({html: cmpTable([
      cmpRow('Bank in (before VAT)', c.bankIn, pc.bankIn), cmpRow('Sponsor deposits', bankSp(c), bankSp(pc)), cmpRow('VAT removed', c.tax, pc.tax, false),
      cmpRow('Bank after VAT', c.bankNet, pc.bankNet), cmpRow('Bank out', c.bankOut, pc.bankOut, false), cmpRow('Bank balance', c.bankBal, pc.bankBal),
      cmpRow('Number of deposits', ins.length, pc.done.filter(e => e.kind === 'bankIn').length, true, true)
    ], y, prev.has) + cmpChart(['Bank in', 'After VAT', 'Bank out', 'Balance'], [pc.bankIn, pc.bankNet, pc.bankOut, pc.bankBal], [c.bankIn, c.bankNet, c.bankOut, c.bankBal], y)});
    section(1, 'Bank movement');
    const steps = [
      {label: 'Bank in', from: 0, to: c.bankIn, color: T.fg},
      {label: `VAT ${S.settings.taxRate}%`, from: c.bankIn, to: c.bankIn - c.tax, color: '#8E0B22', delta: true},
      {label: 'After VAT', from: 0, to: c.bankNet, color: T.fg},
      {label: 'Bank out', from: c.bankNet, to: c.bankBal, color: T.cur, delta: true},
      {label: 'Bank balance', from: 0, to: c.bankBal, color: c.bankBal < 0 ? T.bad : T.good}
    ];
    push({html: h2('From deposits to balance', 'Before VAT → after payments') + `<div class="rp-chart">${img(C.waterfall(steps, T, {w: 700, h: 190}), 700, 190, 'Bank waterfall')}</div>`});
    push({html: phaseBlock(c, 'bank', 'Bank payments only')});
    const mb = monthlyBlock(c, 'bank', 'Deposits vs payments'); if (mb) push(mb);
    section(2, 'Bank entries');
    listBlocks(push, 'Deposits', `${ins.length} deposits`, '<th>Date</th><th>From</th><th>Type</th><th class="r">Gross</th><th class="r">VAT</th><th class="r">Net</th>',
      ins.map(e => { const v = A.vatOf(e); return `<tr><td>${dateCell(e.date)}</td><td>${esc(e.counterparty || e.desc || '—')}</td><td><span class="rp-pill">${kindLabel(e)}</span></td><td class="r">${fmt(e.amount)}</td><td class="r">${v ? fmt(v) : '—'}</td><td class="r">${fmt(e.amount - v)}</td></tr>`; }),
      `<tr class="tot"><td colspan="3">Total deposits</td><td class="r">${fmt(c.bankIn)}</td><td class="r">${fmt(c.tax)}</td><td class="r">${fmt(c.bankNet)}</td></tr>`);
    listBlocks(push, 'Payments', `${outs.length} payments`, '<th>Date</th><th>To</th><th>Description</th><th>Phase</th><th class="r">Amount</th>',
      outs.map(e => `<tr><td>${dateCell(e.date)}</td><td>${esc(e.counterparty || '—')}</td><td>${esc(e.desc || '—')}</td><td>${esc(e.phase || 'General')}</td><td class="r">${fmt(e.amount)}</td></tr>`),
      `<tr class="tot"><td colspan="4">Total payments</td><td class="r">${fmt(c.bankOut)}</td></tr>`);
    push(signHtml());
    return B;
  }

  /* ---------- university (sponsorship) report ---------- */
  function uniBlocks(y) {
    const S = A.S, T = LIGHT, cur = sponsorMoney(y), prev = sponsorMoney(y - 1);
    const {B, push, section} = blocks();
    push({html: coverHtml(y, 'Sponsorship Report', `Prepared ${todayStr()} for the German University in Cairo. The number of sponsors and the money they paid this season, received in the bank and in cash. Goods and services given in kind are not included. Amounts in EGP.`)});
    push({html: `<div class="rp-kpis">${kpi('Number of sponsors', String(cur.count), 'Sponsors who paid money', 'hot', '')}${kpi('Total sponsorship', cur.total, 'Bank + cash', 'dark')}${kpi('Received in bank', cur.bank, `Before ${S.settings.taxRate}% VAT`)}${kpi('Received in cash', cur.cash, 'Handed to the curator')}</div>`});
    push({html: `<p class="rp-note">Bank amounts are what sponsors deposited. ${S.settings.taxRate}% VAT on those deposits is ${fmt(cur.vat)} EGP, so the bank keeps ${fmt(cur.bank - cur.vat)} EGP after VAT.</p>`});
    const avg = s => s.count ? s.total / s.count : 0;
    push({html: cmpTable([
      cmpRow('Number of sponsors', cur.count, prev.count, true, true), cmpRow('Sponsorship received in bank', cur.bank, prev.bank), cmpRow('Sponsorship received in cash', cur.cash, prev.cash),
      cmpRow('Total sponsorship', cur.total, prev.total), cmpRow('Average per sponsor', Math.round(avg(cur)), Math.round(avg(prev)))
    ], y, prev.count > 0) + cmpChart(['In bank', 'In cash', 'Total'], [prev.bank, prev.cash, prev.total], [cur.bank, cur.cash, cur.total], y)});
    section(1, 'Sponsors');
    const share = C.fold(cur.list.map(s => ({label: s.name, value: s.total})), T);
    push({html: h2('Share of sponsorship money', `${y} · bank + cash`) + `<div class="rp-don">${share.length ? img(C.donut(share, T, {size: 150, center: String(cur.count), sub: 'sponsors', centerSize: 20}), 150, 150, 'Sponsor share') + C.legend(share, {}) : '<p class="rp-note">No sponsorship money recorded yet.</p>'}</div>`});
    const split = [{label: 'Received in bank', value: cur.bank, color: T.series[0]}, {label: 'Received in cash', value: cur.cash, color: T.series[1]}].filter(i => i.value > 0);
    if (split.length) push({html: h2('Bank vs cash', String(y)) + `<div class="rp-don">${img(C.donut(split, T, {size: 150, center: compact(cur.total), sub: 'EGP', centerSize: 18}), 150, 150, 'Bank vs cash') + C.legend(split, {total: true})}</div>`});
    listBlocks(push, 'Sponsor list', `${cur.count} sponsors in ${y}`, `<th>#</th><th>Sponsor</th><th class="r">Bank</th><th class="r">Cash</th><th class="r">Total</th><th class="r">${y - 1} total</th>`,
      cur.list.map((s, i) => `<tr><td>${i + 1}</td><td><b>${esc(s.name)}</b></td><td class="r">${s.bank ? fmt(s.bank) : '—'}</td><td class="r">${s.cash ? fmt(s.cash) : '—'}</td><td class="r"><b>${fmt(s.total)}</b></td><td class="r">${prev.map.get(s.key) ? fmt(prev.map.get(s.key).bank + prev.map.get(s.key).cash) : '<span class="rp-flat">new</span>'}</td></tr>`),
      `<tr class="tot"><td></td><td>Total (${cur.count} sponsors)</td><td class="r">${fmt(cur.bank)}</td><td class="r">${fmt(cur.cash)}</td><td class="r">${fmt(cur.total)}</td><td class="r">${fmt(prev.total)}</td></tr>`, 18);
    push(signHtml(['Prepared by', 'TEDxGUC Curator', 'Date']));
    return B;
  }

  function teamBlocks(push, c) {
    const ms = Object.values(c.members), cov = c.outTotal ? c.fYesAmt / c.outTotal : 1;
    push({html: h2('Team wallets', c.curator ? `Curator: ${c.curator}` : 'No curator set') + `<table class="rp-tbl"><thead><tr><th>Member</th><th class="r">Brought in</th><th class="r">Spent</th><th class="r">To reimburse</th><th class="r">No fatora</th><th class="r">Coverage</th></tr></thead><tbody>${ms.map(mm => { const cv = mm.spent ? mm.fYes / mm.spent : null; return `<tr><td><b>${esc(mm.name)}</b>${mm.name === c.curator ? ' <span class="rp-pill">curator</span>' : ''}</td><td class="r">${fmt(mm.collected)}</td><td class="r">${fmt(mm.spent)}</td><td class="r">${mm.owed ? fmt(mm.owed) : '—'}</td><td class="r">${mm.missAmt ? fmt(mm.missAmt) : '—'}</td><td class="r">${cv == null ? '<span class="rp-flat">—</span>' : `<span class="rp-pill ${cv > .8 ? 'good' : cv > .5 ? '' : 'bad'}">${Math.round(cv * 100)}%</span>`}</td></tr>`; }).join('')}</tbody></table>`});
    const miss = c.missing.slice(0, 8);
    push({html: h2('Invoice (fatora) coverage', 'Cash-out with a fatora') + `<div class="rp-two" style="grid-template-columns:150px 1fr"><div>${img(C.ring(cov, LIGHT, {size: 140}), 140, 140, 'Fatora coverage')}<p class="rp-note" style="margin-top:6px">${fmt(c.fYesAmt)} of ${fmt(c.outTotal)} EGP has a fatora.</p></div>
      <div>${miss.length ? `<table class="rp-tbl"><thead><tr><th>Still missing a fatora${c.missing.length > 8 ? ` (top 8 of ${c.missing.length})` : ''}</th><th>Member</th><th class="r">Amount</th></tr></thead><tbody>${miss.map(([, e]) => `<tr><td>${esc(e.desc || '—')}</td><td>${esc(e.member || '—')}</td><td class="r">${fmt(e.amount)}</td></tr>`).join('')}</tbody></table>` : '<p class="rp-note"><b>Every cash-out has a fatora.</b></p>'}</div></div>`});
    if (c.pocketOpen.length) push({html: h2('Waiting for reimbursement', `${fmt(c.owed)} EGP`) + `<table class="rp-tbl"><thead><tr><th>Member</th><th>For</th><th class="r">Amount</th></tr></thead><tbody>${c.pocketOpen.slice(0, 8).map(([, e]) => `<tr><td>${esc(e.member || '—')}</td><td>${esc(e.desc || '')}</td><td class="r">${fmt(e.amount)}</td></tr>`).join('')}</tbody></table>`});
  }

  const reportBlocks = (y, type) => (type === 'cash' ? cashBlocks : type === 'bank' ? bankBlocks : type === 'uni' ? uniBlocks : fullBlocks)(y);

  // Full financial report: everything.
  function fullBlocks(y) {
    const S = A.S, cur = season(y), prev = season(y - 1), c = cur.c, Y = cur.Y, T = LIGHT;
    const today = new Date().toLocaleDateString('en-GB', {day: 'numeric', month: 'long', year: 'numeric'});
    const B = [];
    let pend = ''; // a section title waits here and joins the next block, so it never sits alone at a page bottom
    const push = b => { if (pend) { b.html = pend + b.html; pend = ''; } B.push(b); };
    const cov = c.outTotal ? c.fYesAmt / c.outTotal : 1;
    const sps = [...Y.sponsors.values()].sort((a, b) => b.gross - a.gross || b.inKind - a.inKind);

    // 1 · Summary
    push({html: `<div class="rp-cover"><div class="dot"></div><div class="ring"></div><div><div class="k">TEDxGUC · Season ${y}</div><h1>Financial Report</h1><p>Prepared ${today} from the live TEDxGUC Cashbook. All amounts are in Egyptian pounds (EGP)${prev.has ? `, compared with season ${y - 1}` : ''}.</p></div></div>`});
    push({html: `<div class="rp-kpis">${kpi('Total available', c.total, 'Cash in hand + bank balance', 'hot')}${kpi('Cash in hand', c.cashBal, c.curator ? `Held by ${c.curator}` : 'Held by the curator')}${kpi('Bank balance', c.bankBal, `After ${S.settings.taxRate}% VAT and payments`)}${kpi('Net income', Y.net, 'Income after VAT', 'dark')}</div>`});
    push({html: `<div class="rp-kpis">${kpi('Total spent', cur.spent, `Cash ${compact(c.cashOut)} · bank ${compact(c.bankOut)}`)}${kpi('Sponsors', String(Y.sponsors.size), `${sps.filter(s => s.payments).length} paid · ${sps.filter(s => s.type === 'in-kind' || s.type === 'both').length} in-kind`, '', '')}${kpi('Fatora coverage', Math.round(cov * 100) + '%', `${c.missing.length} cash-outs missing one`, '', '')}${kpi('Planned, unpaid', c.plannedOut, 'Not in the figures above')}</div>`});
    const rows = compare(cur, prev);
    push({html: h2(`Season at a glance`, `${y - 1} vs ${y}`) + `<table class="rp-tbl"><thead><tr><th>Measure</th><th class="r">${y - 1}</th><th class="r">${y}</th><th class="r">Change</th></tr></thead><tbody>${rows.map(m => `<tr><td>${esc(m.label)}</td><td class="r">${m.count ? m.prev : moneyCell(m.prev)}</td><td class="r"><b>${m.count ? m.cur : moneyCell(m.cur)}</b></td><td class="r">${deltaCell(m)}</td></tr>`).join('')}</tbody></table>` + (prev.has ? '' : `<p class="rp-note" style="margin-top:6px">No entries for ${y - 1} are in the cashbook yet, so last season shows as zero.</p>`)});
    push({html: `<div class="rp-chart">${img(C.bars(['Gross income', 'Net income', 'Total spent', 'Closing balance'], [{name: String(y - 1), color: T.prev, values: [prev.Y.gross, prev.Y.net, prev.spent, prev.c.total]}, {name: String(y), color: T.cur, values: [Y.gross, Y.net, cur.spent, c.total]}], T, {w: 700, h: 170}), 700, 170, 'Season comparison')}${lg2(y - 1, y)}</div>`});

    // 2 · Money
    pend = `<h1 class="rp-section"><small>Section 1</small>Money</h1>`;
    const steps = [
      {label: 'Bank in', from: 0, to: c.bankIn, color: T.fg},
      {label: `VAT ${S.settings.taxRate}%`, from: c.bankIn, to: c.bankIn - c.tax, color: '#8E0B22', delta: true},
      {label: 'After VAT', from: 0, to: c.bankNet, color: T.fg},
      {label: 'Bank out', from: c.bankNet, to: c.bankBal, color: T.cur, delta: true},
      {label: 'Bank balance', from: 0, to: c.bankBal, color: c.bankBal < 0 ? T.bad : T.good}
    ];
    push({html: h2('Bank: from deposits to balance', 'Before VAT → after payments') + `<div class="rp-chart">${img(C.waterfall(steps, T, {w: 700, h: 190}), 700, 190, 'Bank waterfall')}</div>`});
    push({html: `<div class="rp-two"><div>${h2('Cash', 'All held by the curator')}<table class="rp-tbl"><tbody><tr><td>Cash in</td><td class="r">${moneyCell(c.cashIn)}</td></tr><tr><td>Cash out</td><td class="r">${moneyCell(c.cashOut)}</td></tr><tr class="tot"><td>Cash in hand</td><td class="r">${moneyCell(c.cashBal)}</td></tr><tr><td>Owed to members (own pocket)</td><td class="r">${moneyCell(c.owed)}</td></tr></tbody></table></div><div>${h2('Bank', `${S.settings.taxRate}% VAT on deposits`)}<table class="rp-tbl"><tbody><tr><td>Bank in (before VAT)</td><td class="r">${moneyCell(c.bankIn)}</td></tr><tr><td>VAT removed</td><td class="r">−${fmt(c.tax)}</td></tr><tr><td>Bank out</td><td class="r">−${fmt(c.bankOut)}</td></tr><tr class="tot"><td>Bank balance</td><td class="r">${moneyCell(c.bankBal)}</td></tr></tbody></table></div></div>`});
    const ph = phaseItems(c, T), phs = phaseList(c);
    push({html: h2('Spending by phase', 'Cash + bank') + `<div class="rp-two" style="grid-template-columns:150px 1fr"><div>${ph.length ? img(C.donut(ph, T, {size: 150, center: compact(cur.spent), sub: 'EGP spent', centerSize: 18}), 150, 150, 'Spending by phase') : '<p class="rp-note">No spending recorded yet.</p>'}</div>
      <table class="rp-tbl"><thead><tr><th>Phase</th><th class="r">Budget</th><th class="r">Spent</th><th class="r">Share</th><th class="r">Budget used</th></tr></thead><tbody>${phs.map(p => { const b = +S.settings.budgets?.[p.name] || 0, u = b ? p.total / b : null; const col = ph.find(i => i.label === p.name)?.color; return `<tr><td><i style="display:inline-block;width:9px;height:9px;border-radius:2px;margin-right:7px;background:${col || 'transparent'}"></i>${esc(p.name)}</td><td class="r">${b ? fmt(b) : '—'}</td><td class="r">${fmt(p.total)}</td><td class="r">${cur.spent ? Math.round(p.total / cur.spent * 100) + '%' : '—'}</td><td class="r">${u == null ? '<span class="rp-flat">no budget</span>' : `<span class="rp-pill ${u > 1 ? 'bad' : u > .85 ? '' : 'good'}">${Math.round(u * 100)}%</span>`}</td></tr>`; }).join('')}</tbody></table></div>`});
    const m = monthly(c);
    if (m.keys.length) push({html: h2('Money in vs money out', 'By month, from entry dates') + `<div class="rp-chart">${img(C.bars(m.cats, [{name: 'Money in', color: T.series[2], values: m.inV}, {name: 'Money out', color: T.cur, values: m.outV}], T, {w: 700, h: 200, labels: m.keys.length <= 6}), 700, 200, 'Monthly flow')}<div class="rp-lg"><span><i style="background:${T.series[2]}"></i>Money in (before VAT)</span><span><i style="background:${T.cur}"></i>Money out</span></div></div>`});

    // 3 · Sponsors & income
    pend = `<h1 class="rp-section"><small>Section 2</small>Sponsors &amp; income</h1>`;
    const PY = prev.Y;
    push({html: `<div class="rp-kpis">${kpi('Gross income', Y.gross, prev.has ? `${y - 1}: ${compact(PY.gross)}` : 'Before VAT')}${kpi('VAT removed', Y.vat, `${S.settings.taxRate}% on bank deposits`)}${kpi('Net income', Y.net, prev.has ? `${y - 1}: ${compact(PY.net)}` : 'What the team keeps', 'hot')}${kpi('In-kind (est.)', Y.inKind, 'Goods and services, not cash')}</div>`});
    const share = sponsorItems(Y, T), src = sourceItems(Y, T);
    push({html: `<div>${h2('Sponsor share', `${y} · by amount`)}<div class="rp-don">${share.length ? img(C.donut(share, T, {size: 150, center: String(Y.sponsors.size), sub: 'sponsors', centerSize: 20}), 150, 150, 'Sponsor share') + C.legend(share, {}) : '<p class="rp-note">No sponsors yet.</p>'}</div></div>`});
    push({html: `<div>${h2('Where the income came from', String(y))}<div class="rp-don">${src.length ? img(C.donut(src, T, {size: 150, center: compact(Y.net + Y.inKind), sub: 'EGP', centerSize: 18}), 150, 150, 'Income sources') + C.legend(src, {}) : '<p class="rp-note">No income yet.</p>'}</div></div>`});
    const top = sps.slice(0, 8);
    if (top.length) push({html: h2('Top sponsors vs last year', `${y} vs ${y - 1}`) + `<div class="rp-chart">${(() => { const s = C.hbars(top.map(x => ({label: x.name, value: x.gross || x.inKind, prev: PY.sponsors.get(x.key)?.gross || PY.sponsors.get(x.key)?.inKind || 0})), T, {w: 700, labelW: 170}); const h = +s.match(/viewBox="0 0 [\d.]+ ([\d.]+)"/)[1]; return img(s, 700, h, 'Top sponsors'); })()}<div class="rp-lg"><span><i style="background:${T.cur}"></i>${y}</span><span><i style="background:${T.prev}"></i>${y - 1}</span></div></div>`});
    const asc = Object.keys(c.years).map(Number).sort((a, b) => a - b).slice(-6);
    push({html: h2('Net income by season', 'After VAT') + `<div class="rp-chart">${img(C.bars(asc.map(String), [{name: 'Net income', color: T.prev, colors: asc.map(v => v === y ? T.cur : T.prev), values: asc.map(v => c.years[v].net)}], T, {w: 700, h: 160}), 700, 160, 'Net income by season')}</div>`});
    push({html: h2('Sponsor list', `${sps.length} sponsors in ${y}${sps.length > 14 ? ' · top 14 shown, full list in the Excel file' : ''}`) + (sps.length ? `<table class="rp-tbl"><thead><tr><th>Sponsor</th><th>Type</th><th class="r">Gross</th><th class="r">VAT</th><th class="r">Net</th><th class="r">In-kind</th><th class="r">${y - 1} gross</th></tr></thead><tbody>${sps.slice(0, 14).map(s => `<tr><td><b>${esc(s.name)}</b></td><td><span class="rp-pill">${TP[s.type] || s.type}</span></td><td class="r">${s.gross ? fmt(s.gross) : '—'}</td><td class="r">${s.vat ? fmt(s.vat) : '—'}</td><td class="r">${s.net ? fmt(s.net) : '—'}</td><td class="r">${s.inKind ? fmt(s.inKind) : '—'}</td><td class="r">${PY.sponsors.get(s.key)?.gross ? fmt(PY.sponsors.get(s.key).gross) : '<span class="rp-flat">new</span>'}</td></tr>`).join('')}<tr class="tot"><td>Total</td><td></td><td class="r">${fmt(sum(sps.map(s => s.gross)))}</td><td class="r">${fmt(sum(sps.map(s => s.vat)))}</td><td class="r">${fmt(sum(sps.map(s => s.net)))}</td><td class="r">${fmt(sum(sps.map(s => s.inKind)))}</td><td class="r">${fmt(sum([...PY.sponsors.values()].map(s => s.gross)))}</td></tr></tbody></table>` : '<p class="rp-note">No sponsors recorded.</p>')});

    // 4 · Team & compliance
    pend = `<h1 class="rp-section"><small>Section 3</small>Team &amp; invoices</h1>`;
    const ms = Object.values(c.members);
    push({html: h2('Team wallets', c.curator ? `Curator: ${c.curator}` : 'No curator set') + `<table class="rp-tbl"><thead><tr><th>Member</th><th class="r">Brought in</th><th class="r">Spent</th><th class="r">To reimburse</th><th class="r">No fatora</th><th class="r">Coverage</th></tr></thead><tbody>${ms.map(mm => { const cv = mm.spent ? mm.fYes / mm.spent : null; return `<tr><td><b>${esc(mm.name)}</b>${mm.name === c.curator ? ' <span class="rp-pill">curator</span>' : ''}</td><td class="r">${fmt(mm.collected)}</td><td class="r">${fmt(mm.spent)}</td><td class="r">${mm.owed ? fmt(mm.owed) : '—'}</td><td class="r">${mm.missAmt ? fmt(mm.missAmt) : '—'}</td><td class="r">${cv == null ? '<span class="rp-flat">—</span>' : `<span class="rp-pill ${cv > .8 ? 'good' : cv > .5 ? '' : 'bad'}">${Math.round(cv * 100)}%</span>`}</td></tr>`; }).join('')}</tbody></table>`});
    const miss = c.missing.slice(0, 8);
    push({html: h2('Invoice (fatora) coverage', 'Cash-out with a fatora') + `<div class="rp-two" style="grid-template-columns:150px 1fr"><div>${img(C.ring(cov, T, {size: 140}), 140, 140, 'Fatora coverage')}<p class="rp-note" style="margin-top:6px">${fmt(c.fYesAmt)} of ${fmt(c.outTotal)} EGP has a fatora.</p></div>
      <div>${miss.length ? `<table class="rp-tbl"><thead><tr><th>Still missing a fatora${c.missing.length > 8 ? ` (top 8 of ${c.missing.length})` : ''}</th><th>Member</th><th class="r">Amount</th></tr></thead><tbody>${miss.map(([, e]) => `<tr><td>${esc(e.desc || '—')}</td><td>${esc(e.member || '—')}</td><td class="r">${fmt(e.amount)}</td></tr>`).join('')}</tbody></table>` : '<p class="rp-note"><b>Every cash-out has a fatora.</b></p>'}</div></div>`});
    if (c.pocketOpen.length) push({html: h2('Waiting for reimbursement', `${fmt(c.owed)} EGP`) + `<table class="rp-tbl"><thead><tr><th>Member</th><th>For</th><th class="r">Amount</th></tr></thead><tbody>${c.pocketOpen.slice(0, 8).map(([, e]) => `<tr><td>${esc(e.member || '—')}</td><td>${esc(e.desc || '')}</td><td class="r">${fmt(e.amount)}</td></tr>`).join('')}</tbody></table>`});
    if (c.planned.length) push({html: h2('Planned spending, not paid yet', `${fmt(c.plannedOut)} EGP`) + `<table class="rp-tbl"><thead><tr><th>Item</th><th>Phase</th><th class="r">Amount</th></tr></thead><tbody>${c.planned.filter(e => e.kind.endsWith('Out')).sort((a, b) => b.amount - a.amount).slice(0, 8).map(e => `<tr><td>${esc(e.desc || '—')}</td><td>${esc(e.phase || 'General')}</td><td class="r">${+e.amount ? fmt(e.amount) : '<span class="rp-flat">no amount yet</span>'}</td></tr>`).join('')}</tbody></table>`});
    push({html: `<div class="rp-sign"><div>Prepared by</div><div>Reviewed by (Curator)</div><div>Date</div></div>`, sign: true});
    return B;
  }

  function pageShell(y, type) {
    const p = document.createElement('div'); p.className = 'rp-page';
    p.innerHTML = `<header class="rp-head"><img class="rp-tedx" src="${LOGO.tedx}" alt="TEDxGUC"><div class="rp-mid">${TITLES[type]}<br>Season ${y}</div><img class="rp-guc" src="${LOGO.guc}" alt="German University in Cairo"></header><div class="rp-body"></div><footer class="rp-foot"><span>TEDxGUC Cashbook · For the TEDxGUC team</span><span class="pn"></span></footer>`;
    return p;
  }
  async function layout(host, y, type) {
    host.innerHTML = '';
    let page = null, body = null;
    const next = () => { page = pageShell(y, type); host.appendChild(page); body = page.querySelector('.rp-body'); };
    next();
    for (const b of reportBlocks(y, type)) {
      if (b.page && body.children.length) next();
      const el = document.createElement('div'); el.innerHTML = b.html; el.style.minWidth = '0';
      if (b.sign) el.style.marginTop = 'auto';
      body.appendChild(el);
      await Promise.all([...el.querySelectorAll('img')].map(i => i.complete ? 0 : new Promise(r => { i.onload = i.onerror = r; })));
      if (body.scrollHeight > body.clientHeight + 1 && body.children.length > 1) { el.remove(); next(); body.appendChild(el); }
    }
    const pages = [...host.querySelectorAll('.rp-page')];
    pages.forEach((p, i) => p.querySelector('.pn').textContent = `Page ${i + 1} of ${pages.length}`);
    return pages;
  }

  let overlay, rpSeason, rpType = 'full';
  function ensureOverlay() {
    if (overlay) return;
    overlay = document.createElement('div'); overlay.className = 'rp-overlay'; overlay.hidden = true;
    overlay.setAttribute('role', 'dialog'); overlay.setAttribute('aria-modal', 'true'); overlay.setAttribute('aria-label', 'Financial report');
    overlay.innerHTML = `<div class="rp-bar"><div><b id="rpTitle">Financial report</b><span class="lbl" id="rpMeta"></span></div><div class="rp-actions"><select class="inp" id="rpType" aria-label="Report type"><option value="full">Full financial report</option><option value="cash">Cash report</option><option value="bank">Bank report</option><option value="uni">University report (sponsors)</option></select><select class="inp" id="rpSeason" aria-label="Report season"></select><button class="btn sm" id="rpXlsx" type="button">Excel</button><button class="btn sm red" id="rpPdf" type="button">Download PDF</button><button class="icon-btn" id="rpClose" type="button" aria-label="Close report">✕</button></div></div><div class="rp-pages" id="rpPages"></div>`;
    document.body.appendChild(overlay);
    $('#rpClose').onclick = closeReport;
    $('#rpPdf').onclick = () => pdf();
    $('#rpXlsx').onclick = () => excel(rpSeason).catch(err);
    $('#rpSeason').onchange = e => { rpSeason = +e.target.value; draw(); };
    $('#rpType').onchange = e => { rpType = e.target.value; draw(); };
    window.addEventListener('resize', fit);
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && !overlay.hidden) closeReport(); });
  }
  function fit() { if (!overlay || overlay.hidden) return; const z = Math.min(1, (window.innerWidth - 32) / 794); overlay.querySelectorAll('#rpPages .rp-page').forEach(p => p.style.zoom = z); }
  async function draw() {
    const host = $('#rpPages');
    host.querySelectorAll('.rp-page').forEach(p => p.style.zoom = 1);
    try { await document.fonts?.ready; } catch {}
    const pages = await layout(host, rpSeason, rpType);
    $('#rpTitle').textContent = TITLES[rpType];
    $('#rpMeta').textContent = `Season ${rpSeason} · ${pages.length} pages`;
    fit();
  }
  async function openReport(type) {
    if (!A) return;
    ensureOverlay();
    if (TITLES[type]) rpType = type;
    $('#rpType').value = rpType;
    const S = A.S;
    rpSeason = S.season;
    const seasons = [...new Set([S.season, ...[...S.allEntries.values()].map(A.yearOf)])].filter(Boolean).sort((a, b) => b - a);
    $('#rpSeason').innerHTML = seasons.map(y => `<option value="${y}">Season ${y}</option>`).join('');
    $('#rpSeason').value = String(rpSeason);
    overlay.hidden = false; document.documentElement.style.overflow = 'hidden';
    await draw();
    $('#rpPdf').focus();
  }
  function closeReport() { overlay.hidden = true; document.documentElement.style.overflow = ''; }

  async function pdf() {
    const btn = $('#rpPdf'); btn.disabled = true;
    const busy = document.createElement('div'); busy.className = 'rp-busy'; busy.textContent = 'Creating the PDF…'; document.body.appendChild(busy);
    const host = document.createElement('div');
    host.style.cssText = 'position:absolute;left:0;top:0;width:794px;z-index:-1;pointer-events:none';
    document.body.appendChild(host);
    try {
      await Promise.all([lib('jspdf'), lib('h2c')]);
      const pages = await layout(host, rpSeason, rpType);
      const {jsPDF} = window.jspdf, doc = new jsPDF({unit: 'mm', format: 'a4', compress: true});
      doc.setProperties({title: `TEDxGUC ${TITLES[rpType]} ${rpSeason}`, author: 'TEDxGUC', creator: 'TEDxGUC Cashbook'});
      for (let i = 0; i < pages.length; i++) {
        busy.textContent = `Creating the PDF… page ${i + 1} of ${pages.length}`;
        const canvas = await html2canvas(pages[i], {scale: 2, backgroundColor: '#ffffff', useCORS: true, logging: false, scrollX: 0, scrollY: -window.scrollY, windowWidth: 1200});
        if (i) doc.addPage();
        doc.addImage(canvas.toDataURL('image/jpeg', .92), 'JPEG', 0, 0, 210, 297);
      }
      await A.offerFile(`TEDxGUC_${FILES[rpType]}_${rpSeason}.pdf`, doc.output('blob'));
    } catch (e) { err(e); }
    finally { host.remove(); busy.remove(); btn.disabled = false; }
  }
  const err = e => { console.error(e); A.toast('Could not create the file: ' + (e?.message || 'unknown error')); };

  function init(api) {
    A = api;
    const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    let t = 0, lastW = window.innerWidth;
    window.addEventListener('resize', () => { clearTimeout(t); t = setTimeout(() => { if (lastC && window.innerWidth !== lastW) { lastW = window.innerWidth; graphs(lastC); } }, 200); });
  }
  return {init, lib, graphs, refresh: () => lastC && graphs(lastC), excel: y => excel(y).catch(err), openReport: t => openReport(t)};
})();
