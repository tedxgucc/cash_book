// Paperwork tab: fills the GUC "Expense Approval Request" form and the TEDxGUC memo
// from four inputs (name, date, amount, justification) and saves both as one PDF.
// index.html calls PW.init(api) once.
window.PW = (() => {
  let A = null;
  const $ = (s, r = document) => r.querySelector(s);
  const LOGO = {tedx: 'assets/tedxguc-logo.png', guc: 'assets/guc-logo.png'};
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
  const fmt = n => (+n || 0).toLocaleString('en-US', {maximumFractionDigits: 2});
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const parse = v => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v || ''); return m ? {y: +m[1], m: +m[2], d: +m[3]} : null; };
  const dateShort = v => { const p = parse(v); return p ? `${String(p.d).padStart(2, '0')} / ${String(p.m).padStart(2, '0')} / ${p.y}` : ''; };
  const dateLong = v => { const p = parse(v); return p ? `${p.d} ${MONTHS[p.m - 1]} ${p.y}` : ''; };
  // PDF libraries, loaded the first time someone downloads.
  const LIBS = {
    jspdf: 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
    h2c: 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js'
  };
  const ready = {jspdf: () => window.jspdf, h2c: () => window.html2canvas};
  const loading = {};
  const lib = k => ready[k]() ? Promise.resolve() : loading[k] ||= new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = LIBS[k]; s.onload = res;
    s.onerror = () => { delete loading[k]; s.remove(); rej(new Error('Could not load the PDF tools. Check your internet connection.')); };
    document.head.appendChild(s);
  });
  const amountOf = v => { const n = parseFloat(String(v || '').replace(/[^\d.]/g, '')); return isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 0; };

  /* ---------- amount in words: 12500 -> "Twelve thousand five hundred" ---------- */
  const ONES = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
  const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
  const under1000 = n => {
    const h = Math.floor(n / 100), r = n % 100, out = [];
    if (h) out.push(ONES[h] + ' hundred');
    if (r) out.push(r < 20 ? ONES[r] : TENS[Math.floor(r / 10)] + (r % 10 ? '-' + ONES[r % 10] : ''));
    return out.join(' and ');
  };
  function words(n) {
    let whole = Math.floor(n); const pt = Math.round((n - whole) * 100);
    if (!whole && !pt) return 'Zero';
    const parts = [];
    [[1e9, 'billion'], [1e6, 'million'], [1e3, 'thousand'], [1, '']].forEach(([v, name]) => {
      const k = Math.floor(whole / v); whole %= v;
      if (k) parts.push(under1000(k) + (name ? ' ' + name : ''));
    });
    let s = parts.join(' ') + ' Egyptian pounds';
    if (pt) s += ` and ${under1000(pt)} piastres`;
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  /* ---------- memo text ---------- */
  const sentence = s => { s = s.trim().replace(/\s+/g, ' '); if (!s) return ''; s = s.charAt(0).toUpperCase() + s.slice(1); return /[.!?]$/.test(s) ? s : s + '.'; };
  const defaultSubject = v => `Request for approval of an expense of EGP ${fmt(amountOf(v.amount))}`;
  function templateMemo(v) {
    const amt = amountOf(v.amount);
    return [
      `On behalf of the TEDxGUC team, we kindly request your approval of an expense of EGP ${fmt(amt)} (${words(amt)}).`,
      `This amount is needed for the following purpose: ${sentence(v.just) || '[justification]'}`,
      `This expense is necessary for the preparation and delivery of TEDxGUC's activities, and the requested amount reflects the expected cost. The full details are in the attached Expense Approval Request form, and all supporting invoices (fatora) will be submitted to the Student Activity Office once payment is made.`,
      `We would be grateful for your approval of this request at your earliest convenience.`
    ].join('\n\n');
  }

  /* ---------- state ---------- */
  const st = {type: 'expense', name: '', date: ymd(new Date()), amount: '', just: '', subject: '', memo: '', memoEdited: false, subjectEdited: false};
  // Sponsor approval (SAO Sponsorship Agreement). booth: 'guc' or 'private'.
  const blankSp = () => ({name: '', start: '', end: '', category: '', booth: 'guc', fees: '', desc: ''});
  st.sp = blankSp();
  const DRAFT = 'tedx-paperwork';
  const saveDraft = () => { try { localStorage.setItem(DRAFT, JSON.stringify(st)); } catch {} };
  const loadDraft = () => { try { const d = JSON.parse(localStorage.getItem(DRAFT) || '{}'); Object.assign(st, d); st.sp = {...blankSp(), ...(d.sp || {})}; } catch {} };

  /* ---------- the two pages ---------- */
  const line = (v, w, cls = '') => `<span class="pw-ln ${cls}" style="min-width:${w}px">${v ? esc(v) : '&nbsp;'}</span>`;
  function expensePage(v) {
    const amt = amountOf(v.amount);
    return `<div class="pw-page pw-exp">
      <img class="pw-exp-logo" src="${LOGO.guc}" alt="German University in Cairo">
      <div class="pw-exp-title">Expense Approval Request<br>Active Working Group</div>
      <div class="pw-box">Group Data</div>
      <div class="pw-rows">
        <div><b>Requested Date:</b> ${line(dateShort(v.date), 200)}</div>
        <div><b>Group Name:</b> ${line('TedxGUC', 150)}</div>
        <div class="pw-pair"><span><b>Requested by:</b> ${line(v.name, 170)}</span><span>Signature: ${line('', 130)}.</span></div>
        <div class="pw-pair"><span><b>Academic Advisor</b>: ${line('Dr. Manar Mansour', 170)}</span><span>Signature: ${line('', 130)}.</span></div>
        <div class="pw-pair"><span><b>Authorized by</b>: 1- ${line('', 160)}</span><span>2- ${line('', 160)}</span></div>
        <div><b>Request Amount:</b> ${line(amt ? `EGP ${fmt(amt)}` : '', 210)}</div>
        <div><b>Justification</b><i>:</i></div>
        <div class="pw-just">${esc(v.just).replace(/\n/g, '<br>')}</div>
      </div>
      <div class="pw-box">Financial Data</div>
      <div class="pw-fin">
        <div>Available Balance:${line('', 210)}</div><div>Attachment:</div>
        <div>Requested Amount: ${line('', 210)}</div><div>1: Memo</div>
        <div>Remaining Balance: ${line('', 210)}</div><div>2:</div>
        <div>Account Number: ${line('', 230)}</div><div>3:</div>
        <div>Analysis: ${line('', 240)}</div><div>4:</div>
      </div>
      <div class="pw-pair pw-sig"><span>Prepared By: ${line('', 140)}</span><span>Reviewed By: ${line('', 130)}</span></div>
      <div class="pw-pair pw-sig"><span>Authorized by:1- ${line('', 140)}</span><span>2- ${line('', 150)}</span></div>
    </div>`;
  }
  // Pale TED-style "x" in the corner of the memo.
  const X_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 490"><path fill="#FCE9EC" d="M0 0h135l105 160L345 0h135L308 250l172 240H345L240 330 135 490H0l172-240z"/></svg>`;
  const X_URL = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(X_SVG);
  function memoPage(v) {
    const paras = (v.memo || '').split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
    const body = paras.length ? paras.map(p => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('') : '<p class="pw-ph">[Write the memo here.]</p>';
    const sig = n => `<div><div class="pw-k">Approved by</div><div class="pw-sl"></div><b>${n}</b><div class="pw-sd">Date:&nbsp; ____ / ____ / ________</div></div>`;
    return `<div class="pw-page pw-memo">
      <img class="pw-x" src="${X_URL}" alt="">
      <div class="pw-top"></div>
      <header><img class="pw-tedx" src="${LOGO.tedx}" alt="TEDxGUC"><img class="pw-guc" src="${LOGO.guc}" alt="German University in Cairo"></header>
      <div class="pw-rule"></div>
      <h1>MEMORANDUM</h1>
      <div class="pw-sub">Official correspondence &nbsp;·&nbsp; TEDxGUC</div>
      <table class="pw-meta"><tr><th>To</th><td>Student Activity Office</td></tr><tr><th>From</th><td>TEDxGUC Team</td></tr><tr><th>Date</th><td>${esc(dateLong(v.date))}</td></tr><tr><th>Subject</th><td>${esc(v.subject)}</td></tr></table>
      <div class="pw-body"><p>Dear Student Activity Office,</p>${body}</div>
      <div class="pw-regards">Kind regards,<br><b>TEDxGUC Team</b></div>
      <div class="pw-sigs"><div class="pw-k2">Signatures</div><div class="pw-sg">${sig('Dr. Manar Mansour')}${sig('Mr. Yehia Al Razaz')}${sig('Dr. Ehab Abo El Kheir')}</div></div>
      <footer><b>TEDxGUC</b> &nbsp;·&nbsp; Ideas Worth Spreading &nbsp;·&nbsp; German University in Cairo</footer>
      <div class="pw-bot"></div>
    </div>`;
  }
  const values = () => ({...st, subject: st.subject || defaultSubject(st), memo: st.memoEdited ? st.memo : templateMemo(st)});

  /* ---------- sponsorship agreement (one page) ---------- */
  // Plain CSS tick boxes: the PDF tool draws SVG images of them as solid black squares.
  const BOX = on => `<span class="pw-cb">${on ? '<span class="pw-tick"></span>' : ''}</span>`;
  const BOOTH = {guc: 'GUC Booth', private: 'Private Booth/Truck'};
  function sponsorPage(sp) {
    const fees = amountOf(sp.fees), b = BOX(false);
    const td = (html, o = {}) => `<td${o.c ? ` colspan="${o.c}"` : ''}${o.r ? ` rowspan="${o.r}"` : ''}${o.cls ? ` class="${o.cls}"` : ''}>${html}</td>`;
    const v = s => `<span class="pw-val">${esc(s)}</span>`;
    return `<div class="pw-page pw-spa"><table>
      <colgroup><col style="width:97px"><col style="width:22px"><col style="width:130px"><col style="width:57px"><col style="width:75px"><col style="width:73px"><col style="width:107px"><col style="width:79px"></colgroup>
      <tr style="height:72px">${td(`<img class="pw-spa-logo" src="${LOGO.guc}" alt="German University in Cairo">`, {c: 2})}${td('Sponsorship Agreement', {c: 4})}${td('Student Activities Office', {c: 2})}</tr>
      <tr style="height:42px">${td('AWG Name')}${td('TedxGUC', {c: 3})}${td('Sponsor<br>Name')}${td(v(sp.name), {c: 3})}</tr>
      <tr style="height:54px">${td('Start Date')}${td(v(dateShort(sp.start)), {c: 3})}${td('End Date')}${td(v(dateShort(sp.end)), {c: 2})}${td(`<div class="pw-bt"><div>Booth Type</div><div>${v(BOOTH[sp.booth] || '')}</div></div>`, {cls: 'pw-np'})}</tr>
      <tr style="height:76px">${td('Agreed Fees')}${td(v(fees ? `EGP ${fmt(fees)}` : ''), {c: 4})}${td('Clinic Approval', {c: 3, cls: 'pw-l'})}</tr>
      <tr style="height:62px">${td('Sponsor<br>Description')}${td(v(sp.desc), {c: 7, cls: 'pw-l'})}</tr>
      <tr style="height:36px">${td('Sponsor Booth')}${td(BOX(sp.booth === 'guc'))}${td('GUC Booth', {c: 3})}${td(BOX(sp.booth === 'private'))}${td('Private Booth/Truck', {c: 2})}</tr>
      <tr style="height:62px">${td('Sponsor<br>Category')}${td(v(sp.category), {c: 7, cls: 'pw-l'})}</tr>
      <tr>${td('Needed Services', {c: 8})}</tr>
      <tr>${td('Agreed Service', {c: 2})}${td('Marketing Service', {c: 4})}${td('Logistics “by the Sponsors”', {c: 2})}</tr>
      <tr>${td('ONSPOT')}${td(b)}${td('MPC Coverage', {c: 2})}${td(b)}${td('Design Must be attached as Hard Copy', {r: 4})}${td('Truck')}${td(b)}</tr>
      <tr>${td('Social Media')}${td(b)}${td('ON SPOT Mail', {c: 2})}${td(b)}${td('Refrigerator')}${td(b)}</tr>
      <tr>${td('Booth')}${td(b)}${td('Flyer Distribution', {c: 2})}${td(b)}${td('Grill')}${td(b)}</tr>
      <tr>${td('')}${td(b)}${td('Posters in Boxes', {c: 2})}${td(b)}${td('Coffee Machine')}${td(b)}</tr>
      <tr>${td('')}${td(b)}${td('Technical Service', {c: 2})}${td('Marketing Materials', {c: 2})}${td('Display<br>Refrigerator', {r: 2})}${td(b, {r: 2})}</tr>
      <tr>${td('Others')}${td(b)}${td('Electricity')}${td(b)}${td('Banners')}${td(b)}</tr>
      <tr>${td('Specify', {c: 2, r: 2})}${td('Electricity Mustn’t Exceed 6KW', {c: 2})}${td('Posters')}${td(b)}${td('Others')}${td(b)}</tr>
      <tr>${td('Electricity Can’t Exceed 1.5KW Per Device', {c: 2})}${td('Flyers')}${td(b)}${td('Specify', {c: 2})}</tr>
      <tr style="height:34px">${td('Signatures', {c: 7})}${td('Office<br>Review')}</tr>
      <tr style="height:64px">${td('Dr. Manar Mansour', {c: 2, cls: 'pw-nm'})}${td('Academic Advisor', {c: 3})}${td('', {c: 2, cls: 'pw-sgn'})}${td('')}</tr>
      <tr style="height:64px">${td('Mr. Yehia Al Razzaz', {c: 2, cls: 'pw-nm'})}${td('Youth welfare Director', {c: 3})}${td('', {c: 2, cls: 'pw-sgn'})}${td('<div class="pw-cm">Comments</div>', {cls: 'pw-np pw-top-al'})}</tr>
      <tr style="height:64px">${td('Dr. Ehab Abu El kheir', {c: 2, cls: 'pw-nm'})}${td('GUC Vice President', {c: 3})}${td('', {c: 2, cls: 'pw-sgn'})}${td('')}</tr>
    </table></div>`;
  }

  /* ---------- UI ---------- */
  const CSS = `
.pw-grid{display:grid;grid-template-columns:minmax(0,5fr) minmax(0,7fr);gap:20px;align-items:start}
@media (max-width:900px){.pw-grid{grid-template-columns:1fr}}
.pw-form{display:grid;gap:14px}
.pw-form textarea{resize:vertical}
.pw-hint{font-size:12px;color:var(--muted)}
.pw-acts{display:flex;gap:8px;flex-wrap:wrap}
.pw-prev{display:grid;gap:14px;justify-items:center}
.pw-prev .pw-frame{width:100%;overflow:hidden;border-radius:6px;box-shadow:0 4px 18px rgba(0,0,0,.35)}
.pw-page{width:794px;height:1123px;background:#fff;color:#111;position:relative;overflow:hidden;box-sizing:border-box;transform-origin:0 0}
.pw-page *{box-sizing:border-box;letter-spacing:normal}
.pw-ln{display:inline-block;border-bottom:1px solid #111;padding:0 4px;line-height:1.15;vertical-align:baseline}
/* expense form */
.pw-exp{font-family:"Times New Roman",Times,serif;font-size:16px;padding:70px 110px 60px 120px}
.pw-exp-logo{position:absolute;left:64px;top:66px;width:212px}
.pw-exp-title{margin:110px 0 30px;text-align:center;font-size:27px;font-weight:700;font-style:italic;line-height:1.2}
.pw-box{border:3px solid #111;border-right-width:5px;border-bottom-width:5px;padding:4px 10px;font:italic 700 22px "Bookman Old Style","Book Antiqua",Georgia,serif;margin:0 0 22px -10px}
.pw-rows{display:grid;gap:20px;margin:0 0 34px 10px}
.pw-pair{display:grid;grid-template-columns:335px 1fr;align-items:baseline;white-space:nowrap}
.pw-just{min-height:52px;margin-top:-12px;font-size:15.5px;line-height:1.45;white-space:normal;word-break:break-word}
.pw-fin{display:grid;grid-template-columns:400px 1fr;row-gap:14px;margin:0 0 30px 10px}
.pw-sig{margin:0 0 0 66px;padding-bottom:34px;grid-template-columns:270px 1fr}
/* memo */
.pw-memo{font-family:Arial,"Helvetica Neue",Helvetica,sans-serif;padding:0 84px;display:flex;flex-direction:column}
.pw-x{position:absolute;right:30px;bottom:80px;width:490px;height:490px}
.pw-memo>*:not(.pw-x){position:relative}
.pw-top,.pw-bot{position:absolute!important;left:0;right:0;height:11px}
.pw-top{top:0;background:#EB0028}.pw-bot{bottom:0;background:#A3001C}
.pw-memo header{display:flex;justify-content:space-between;align-items:center;margin-top:56px;height:74px}
.pw-tedx{width:232px;margin-left:8px}.pw-guc{width:150px}
.pw-rule{height:2px;background:#EB0028;margin:24px 0 26px}
.pw-memo h1{margin:0;font-size:41px;line-height:1;font-weight:800;letter-spacing:.06em!important;color:#111}
.pw-sub{color:#EB0028;font-weight:700;font-size:14px;letter-spacing:.12em!important;margin:6px 0 20px}
.pw-meta{width:100%;border-collapse:collapse;font-size:16px!important}
.pw-meta th{width:140px;text-align:left;color:#EB0028;font-size:14px;letter-spacing:.2em!important;text-transform:uppercase;padding:9px 8px}
.pw-meta td{padding:9px 0;color:#111}
.pw-meta tr{border-bottom:1px solid #DDD}
.pw-body{margin-top:24px;font-size:15.5px;line-height:1.6;flex:1;min-height:0;overflow:hidden}
.pw-body p{margin:0 0 13px}
.pw-ph{color:#777;font-style:italic}
.pw-regards{font-size:16px;line-height:1.5;margin:14px 0 22px}
.pw-sigs{border-top:1px solid #CFCFCF;padding-top:12px}
.pw-k2{font-weight:700;font-size:14px;letter-spacing:.2em!important}
.pw-sg{display:grid;grid-template-columns:repeat(3,1fr);gap:18px;padding:0 10px}
.pw-k{color:#EB0028;font-weight:700;font-size:11px;letter-spacing:.2em!important;text-transform:uppercase;margin-top:14px}
.pw-sl{border-bottom:1.5px solid #111;height:52px;margin-bottom:9px}
.pw-sg b{font-size:15px}
.pw-sd{color:#666;font-size:13px;margin-top:5px}
.pw-memo footer{text-align:center;color:#666;font-size:13px;margin:70px 0 30px}
.pw-memo footer b{color:#EB0028}
/* sponsorship agreement */
.pw-spa{font-family:Calibri,Carlito,"Segoe UI",Arial,sans-serif;font-size:12.5px;font-weight:700;padding:118px 0 0 77px}
.pw-spa table{width:640px;font-size:12.5px;border-collapse:collapse;table-layout:fixed;border:3px solid #000;border-left-width:5px}
.pw-spa td{border:1.5px solid #000;text-align:center;vertical-align:middle;padding:2px 4px;line-height:1.2;height:22px;overflow:hidden;word-wrap:break-word}
.pw-spa td.pw-l{text-align:left;padding-left:8px}
.pw-spa td.pw-np{padding:0}
.pw-spa td.pw-nm{white-space:nowrap;font-size:12px;padding:2px}
.pw-spa td.pw-sgn{border-color:#BBB #BBB #BBB #000}
.pw-spa td.pw-top-al{vertical-align:top}
.pw-spa-logo{width:108px;display:block;margin:0 auto}
.pw-cb{display:block;width:13px;height:13px;border:1.4px solid #000;background:#fff;margin:0 auto;position:relative}
.pw-tick{position:absolute;left:3.5px;top:0;width:4.5px;height:8.5px;border:solid #000;border-width:0 2px 2px 0;transform:rotate(45deg)}
.pw-val{font-weight:400;font-size:13.5px}
.pw-bt{display:grid;grid-template-rows:28px 24px}
.pw-bt>div{display:grid;place-items:center}
.pw-bt>div:first-child{border-bottom:1.5px solid #000}
.pw-bt .pw-val{font-size:10.5px;line-height:1.1}
.pw-cm{border-bottom:1.5px solid #000;padding:8px 0}
`;

  function scale() {
    document.querySelectorAll('.pw-frame').forEach(f => {
      const p = f.firstElementChild; if (!p) return;
      const k = f.clientWidth / 794; p.style.transform = `scale(${k})`; f.style.height = 1123 * k + 'px';
    });
  }
  let t = 0;
  function preview() {
    clearTimeout(t);
    t = setTimeout(() => {
      const sp = st.type === 'sponsor';
      $('#pwExpForm').hidden = $('#pwExpPrev').hidden = sp;
      $('#pwSpForm').hidden = $('#pwSpPrev').hidden = !sp;
      if (sp) $('#pwPrevSp').innerHTML = sponsorPage(st.sp);
      else { const v = values(); $('#pwPrevExp').innerHTML = expensePage(v); $('#pwPrevMemo').innerHTML = memoPage(v); }
      scale(); if (!sp) fitCheck();
    }, 80);
  }
  // Warn when the memo text is too long for one page.
  function fitCheck() {
    const b = $('#pwPrevMemo .pw-body'); if (!b) return;
    $('#pwFit').hidden = b.scrollHeight <= b.clientHeight + 1;
  }
  function syncInputs() {
    $('#pwName').value = st.name; $('#pwDate').value = st.date; $('#pwAmount').value = st.amount; $('#pwJust').value = st.just;
    $('#pwSubject').value = st.subjectEdited ? st.subject : defaultSubject(st);
    $('#pwMemo').value = st.memoEdited ? st.memo : templateMemo(st);
    $('#pwWords').textContent = amountOf(st.amount) ? words(amountOf(st.amount)) : '';
    $('#pwType').value = st.type;
    const sp = st.sp;
    $('#pwSpName').value = sp.name; $('#pwSpStart').value = sp.start; $('#pwSpEnd').value = sp.end;
    $('#pwSpCat').value = sp.category; $('#pwSpBooth').value = sp.booth; $('#pwSpFees').value = sp.fees; $('#pwSpDesc').value = sp.desc;
    $('#pwSpWords').textContent = amountOf(sp.fees) ? words(amountOf(sp.fees)) : '';
  }
  const SP_FIELDS = {pwSpName: 'name', pwSpStart: 'start', pwSpEnd: 'end', pwSpCat: 'category', pwSpBooth: 'booth', pwSpFees: 'fees', pwSpDesc: 'desc'};
  function onInput(e) {
    const id = e.target.id, val = e.target.value;
    if (id === 'pwType') { st.type = val === 'sponsor' ? 'sponsor' : 'expense'; saveDraft(); preview(); return; }
    if (SP_FIELDS[id]) {
      st.sp[SP_FIELDS[id]] = val;
      $('#pwSpWords').textContent = amountOf(st.sp.fees) ? words(amountOf(st.sp.fees)) : '';
      saveDraft(); preview(); return;
    }
    if (id === 'pwName') st.name = val;
    if (id === 'pwDate') st.date = val;
    if (id === 'pwAmount') st.amount = val;
    if (id === 'pwJust') st.just = val;
    if (id === 'pwSubject') { st.subject = val; st.subjectEdited = !!val.trim(); }
    if (id === 'pwMemo') { st.memo = val; st.memoEdited = true; }
    if (id !== 'pwSubject' && !st.subjectEdited) $('#pwSubject').value = defaultSubject(st);
    if (id !== 'pwMemo' && !st.memoEdited) $('#pwMemo').value = templateMemo(st);
    $('#pwWords').textContent = amountOf(st.amount) ? words(amountOf(st.amount)) : '';
    saveDraft(); preview();
  }
  const check = () => {
    if (st.type === 'sponsor') {
      const s = st.sp, miss = [!s.name.trim() && 'the sponsor name', !parse(s.start) && 'the start date', !parse(s.end) && 'the end date', !s.category.trim() && 'the category', !amountOf(s.fees) && 'the amount'].filter(Boolean);
      if (miss.length) { A.toast('Add ' + miss.join(', ') + ' first.'); return false; }
      if (s.end < s.start) { A.toast('The end date is before the start date.'); return false; }
      return true;
    }
    const miss = [!st.name.trim() && 'your name', !parse(st.date) && 'the date', !amountOf(st.amount) && 'the amount', !st.just.trim() && 'the justification'].filter(Boolean);
    if (miss.length) { A.toast('Add ' + miss.join(', ') + ' first.'); return false; }
    return true;
  };

  /* ---------- Claude writes the memo ---------- */
  let ctl = null;
  async function writeWithClaude() {
    if (!check()) return;
    if (!A.S.sample) { A.toast('Ask Claude is not available. The standard memo text is used instead.'); return; }
    const amt = amountOf(st.amount), btn = $('#pwClaude');
    const prompt = `Write the body of a short, formal memo from the TEDxGUC team (a student-run TEDx event at the German University in Cairo) to the university's Student Activity Office, asking them to approve an expense.

Facts (use only these, do not invent vendors, dates, quantities or numbers):
- Amount: EGP ${fmt(amt)} (${words(amt)})
- Requested by: ${st.name}
- Date: ${dateLong(st.date)}
- Justification from the team: """${st.just.trim()}"""

Rules:
- 2 to 4 short paragraphs, about 120 to 200 words in total, clear and polite English.
- Explain what the money is for and why it is needed for the event, based on the justification.
- Mention that the attached Expense Approval Request form has the details and that invoices (fatora) will be submitted after payment.
- End by asking for their approval.
- Do NOT include a greeting ("Dear ...") or a sign-off ("Kind regards"); the template already has them.
- Plain text only, no markdown, no bullet points.

Reply in exactly this format:
SUBJECT: <a subject line under 12 words>

<memo body>`;
    ctl?.abort(); ctl = new AbortController();
    btn.disabled = true; btn.textContent = 'Writing…';
    try {
      const r = await A.S.sample(prompt, {signal: ctl.signal, modelTier: 'default'});
      let text = String(r.text || '').trim();
      const m = /^SUBJECT:\s*(.+)\n+/i.exec(text);
      if (m) { st.subject = m[1].trim().replace(/^["']|["']$/g, ''); st.subjectEdited = true; text = text.slice(m[0].length).trim(); }
      text = text.replace(/^dear[^\n]*\n+/i, '').replace(/\n+(kind regards|best regards|sincerely)[\s\S]*$/i, '').replace(/\*\*/g, '').trim();
      if (text) { st.memo = text; st.memoEdited = true; }
      syncInputs(); saveDraft(); preview(); A.toast('Memo written. Read it over and edit anything you like.');
    } catch (e) {
      if (e?.name !== 'AbortError' && e?.code !== 'aborted') A.toast(e?.text || 'Claude could not write the memo. The standard text is still there.');
    } finally { btn.disabled = false; btn.textContent = 'Write the memo with Claude'; }
  }

  /* ---------- PDF ---------- */
  async function pdf() {
    if (!check()) return;
    const sp = st.type === 'sponsor', btn = $(sp ? '#pwSpPdf' : '#pwPdf'); btn.disabled = true;
    const busy = document.createElement('div'); busy.className = 'rp-busy'; busy.textContent = 'Creating the PDF…'; document.body.appendChild(busy);
    const host = document.createElement('div');
    host.style.cssText = 'position:absolute;left:0;top:0;width:794px;z-index:-1;pointer-events:none';
    document.body.appendChild(host);
    try {
      await Promise.all([lib('jspdf'), lib('h2c')]);
      const v = values();
      host.innerHTML = sp ? sponsorPage(st.sp) : expensePage(v) + memoPage(v);
      await Promise.all([...host.querySelectorAll('img')].map(i => i.complete ? 0 : new Promise(r => { i.onload = i.onerror = r; })));
      try { await document.fonts?.ready; } catch {}
      const {jsPDF} = window.jspdf, doc = new jsPDF({unit: 'mm', format: 'a4', compress: true});
      doc.setProperties({title: sp ? `TEDxGUC Sponsorship Agreement ${st.sp.name}` : `TEDxGUC Expense Approval ${dateShort(v.date)}`, author: 'TEDxGUC', creator: 'TEDxGUC Cashbook'});
      const pages = [...host.querySelectorAll('.pw-page')];
      for (let i = 0; i < pages.length; i++) {
        const canvas = await html2canvas(pages[i], {scale: 2, backgroundColor: '#ffffff', useCORS: true, logging: false, scrollX: 0, scrollY: -window.scrollY, windowWidth: 1200});
        if (i) doc.addPage();
        doc.addImage(canvas.toDataURL('image/jpeg', .92), 'JPEG', 0, 0, 210, 297);
      }
      const safe = s => s.trim().replace(/\s+/g, '_').replace(/[^\w-]/g, '');
      const file = sp ? `TEDxGUC_Sponsorship_Agreement_${safe(st.sp.name) || 'Sponsor'}_${st.sp.start}.pdf`
        : `TEDxGUC_Expense_Approval_${st.date}_${safe(st.name.split(/\s+/)[0] || '') || 'Request'}.pdf`;
      await A.offerFile(file, doc.output('blob'));
    } catch (e) { console.error(e); A.toast('Could not create the PDF: ' + (e?.message || 'unknown error')); }
    finally { host.remove(); busy.remove(); btn.disabled = false; }
  }

  function render() {
    const sec = $('#tab-paperwork'); if (!sec) return;
    sec.innerHTML = `
      <div class="panel-h" style="margin:0"><h2>Paperwork</h2><span class="lbl">University forms, filled in and ready to print and sign</span></div>
      <div class="pw-grid">
        <div class="pw-form">
        <div class="panel pw-form">
          <div class="field"><label for="pwType">Choose your paper type</label>
            <select class="inp" id="pwType"><option value="expense">Expense approval (form + memo)</option><option value="sponsor">Sponsor approval (sponsorship agreement)</option></select></div>
        </div>
        <div class="panel pw-form" id="pwSpForm" hidden>
          <div class="panel-h" style="margin:0"><h2>Sponsor details</h2></div>
          <div class="field"><label for="pwSpName">Sponsor name</label><input class="inp" id="pwSpName" list="sponsorList" placeholder="e.g. Pepsi"></div>
          <div class="row2">
            <div class="field"><label for="pwSpStart">Start date</label><input class="inp" id="pwSpStart" type="date"></div>
            <div class="field"><label for="pwSpEnd">End date</label><input class="inp" id="pwSpEnd" type="date"></div>
          </div>
          <div class="row2">
            <div class="field"><label for="pwSpCat">Category</label><input class="inp" id="pwSpCat" list="pwCats" placeholder="e.g. Food &amp; Beverages"><datalist id="pwCats"><option value="Food &amp; Beverages"><option value="Telecommunications"><option value="Banking &amp; Finance"><option value="Technology"><option value="Fashion &amp; Retail"><option value="Education"><option value="Media"><option value="Health &amp; Beauty"></datalist></div>
            <div class="field"><label for="pwSpBooth">Booth type</label><select class="inp" id="pwSpBooth"><option value="guc">GUC booth (university)</option><option value="private">Private booth / truck</option></select></div>
          </div>
          <div class="field"><label for="pwSpFees">Agreed amount (EGP)</label><input class="inp num" id="pwSpFees" inputmode="decimal" placeholder="e.g. 50,000"><span class="pw-hint" id="pwSpWords"></span></div>
          <div class="field"><label for="pwSpDesc">Sponsor description (optional)</label><input class="inp" id="pwSpDesc" placeholder="e.g. Soft drinks sponsor for the main event"></div>
          <span class="pw-hint">The Needed Services boxes, Clinic Approval and signatures are left for the office to fill in.</span>
          <div class="pw-acts" style="border-top:1px solid var(--rule);padding-top:14px">
            <button class="btn red" id="pwSpPdf" type="button">Download PDF</button>
            <button class="btn ghost" id="pwSpClear" type="button">Start a new agreement</button>
          </div>
        </div>
        <div class="panel pw-form" id="pwExpForm">
          <div class="panel-h" style="margin:0"><h2>1 · Your request</h2></div>
          <div class="row2">
            <div class="field"><label for="pwName">Your name</label><input class="inp" id="pwName" list="pwPeople" placeholder="Requested by" autocomplete="name"><datalist id="pwPeople"></datalist></div>
            <div class="field"><label for="pwDate">Date</label><input class="inp" id="pwDate" type="date"></div>
          </div>
          <div class="field"><label for="pwAmount">Requested amount (EGP)</label><input class="inp num" id="pwAmount" inputmode="decimal" placeholder="e.g. 12,500"><span class="pw-hint" id="pwWords"></span></div>
          <div class="field"><label for="pwJust">Justification</label><textarea class="inp" id="pwJust" rows="4" placeholder="What is the money for? e.g. Printing 20 roll-up banners and the stage backdrop for the main event on 15 November"></textarea></div>
          <div class="panel-h" style="margin:6px 0 0"><h2>2 · The memo</h2><span class="lbl">Filled in for you, edit freely</span></div>
          <div class="field"><label for="pwSubject">Subject</label><input class="inp" id="pwSubject"></div>
          <div class="field"><label for="pwMemo">Memo text</label><textarea class="inp" id="pwMemo" rows="10"></textarea>
            <span class="pw-hint">"Dear Student Activity Office" and "Kind regards, TEDxGUC Team" are added for you. Leave an empty line between paragraphs.</span>
            <span class="pw-hint" id="pwFit" hidden style="color:var(--bad)">The memo is too long for one page. Shorten it a little.</span></div>
          <div class="pw-acts">
            <button class="btn" id="pwClaude" type="button">Write the memo with Claude</button>
            <button class="btn ghost" id="pwReset" type="button">Use standard text</button>
          </div>
          <div class="pw-acts" style="border-top:1px solid var(--rule);padding-top:14px">
            <button class="btn red" id="pwPdf" type="button">Download PDF (form + memo)</button>
            <button class="btn ghost" id="pwClear" type="button">Start a new request</button>
          </div>
        </div>
        </div>
        <div class="pw-prev" id="pwExpPrev">
          <div class="lbl" style="justify-self:start">Preview · page 1 of 2 · Expense Approval Request</div>
          <div class="pw-frame" id="pwPrevExp"></div>
          <div class="lbl" style="justify-self:start">Page 2 of 2 · Memo</div>
          <div class="pw-frame" id="pwPrevMemo"></div>
        </div>
        <div class="pw-prev" id="pwSpPrev" hidden>
          <div class="lbl" style="justify-self:start">Preview · Sponsorship Agreement</div>
          <div class="pw-frame" id="pwPrevSp"></div>
        </div>
      </div>`;
    $('#pwPeople').innerHTML = (A.S.settings?.members || []).map(m => `<option value="${esc(m)}">`).join('');
    sec.addEventListener('input', onInput);
    $('#pwClaude').onclick = writeWithClaude;
    $('#pwReset').onclick = () => { st.memoEdited = st.subjectEdited = false; st.memo = st.subject = ''; syncInputs(); saveDraft(); preview(); };
    $('#pwClear').onclick = () => { Object.assign(st, {name: st.name, date: ymd(new Date()), amount: '', just: '', subject: '', memo: '', memoEdited: false, subjectEdited: false}); syncInputs(); saveDraft(); preview(); };
    $('#pwPdf').onclick = $('#pwSpPdf').onclick = pdf;
    $('#pwSpClear').onclick = () => { st.sp = blankSp(); syncInputs(); saveDraft(); preview(); };
    syncInputs(); preview();
  }

  function init(api) {
    A = api;
    const s = document.createElement('style'); s.textContent = CSS; document.head.appendChild(s);
    loadDraft();
    render();
    window.addEventListener('resize', () => { clearTimeout(init.t); init.t = setTimeout(scale, 120); });
  }
  // The tab starts hidden, so the preview is measured again when it's opened.
  const shown = () => { const dl = $('#pwPeople'); if (dl && A) dl.innerHTML = (A.S.settings?.members || []).map(m => `<option value="${esc(m)}">`).join(''); preview(); };
  return {init, shown};
})();
