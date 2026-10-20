// TEDxGUC Cashbook — Supabase backend adapter.
// The app talks to a small "window.claude.use(name)" interface (db, user, assets, downloads, sample).
// This file provides that interface on top of Supabase, so the app code stays the same.
(() => {
  const cfg = window.CASHBOOK_CONFIG || {};
  const configured = cfg.supabaseUrl && !cfg.supabaseUrl.includes('YOUR-PROJECT') && cfg.supabaseAnonKey && !cfg.supabaseAnonKey.includes('YOUR-ANON');
  const sb = configured ? window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey) : null;
  let session = null, member = null, team = null;

  /* ---------------- login screen ---------------- */
  const css = `
  .gate{position:fixed;inset:0;z-index:100;background:var(--ink);display:grid;place-items:center;padding:24px max(16px,env(safe-area-inset-left,0px))}
  .gate-card{width:min(400px,100%);display:grid;gap:14px;background:var(--stage);border:1px solid var(--rule);border-radius:14px;padding:28px;position:relative;overflow:hidden}
  .gate-card::before{content:"";position:absolute;width:260px;height:260px;right:-120px;top:-120px;border-radius:50%;background:var(--red);opacity:.9}
  .gate-card > *{position:relative}
  .gate-card img{height:28px;width:auto;justify-self:start}
  .gate-card h1{font-family:var(--display);font-size:28px;font-weight:900;font-variation-settings:"wdth" 75;margin:6px 0 0}
  .gate-msg{font-size:13px;min-height:18px;color:var(--muted)}
  .gate-msg.err{color:var(--bad)}
  .gate-row{display:flex;gap:8px;flex-wrap:wrap}`;
  function gate(html) {
    window.hideSplash?.();
    let g = document.getElementById('gate');
    if (!g) {
      const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
      g = document.createElement('div'); g.id = 'gate'; g.className = 'gate'; document.body.appendChild(g);
    }
    const logo = document.querySelector(document.documentElement.hasAttribute('data-light') ? '.brand img.lg-l' : '.brand img.lg-d')?.src || '';
    g.innerHTML = `<div class="gate-card" role="dialog" aria-labelledby="gateT"><img src="${logo}" alt="TEDxGUC"><h1 id="gateT">Cashbook</h1>${html}</div>`;
    return g;
  }
  function showLogin(msg = '', err = false) {
    const g = gate(`
      <div class="muted" style="font-size:14px">Sign in with the email the curator added to the team list.</div>
      <div class="field"><label for="gEmail">Email</label><input class="inp" id="gEmail" type="email" autocomplete="email"></div>
      <div class="field"><label for="gPass">Password</label><input class="inp" id="gPass" type="password" autocomplete="current-password"></div>
      <div class="gate-row"><button class="btn red" id="gIn" type="button">Sign in</button><button class="btn ghost" id="gUp" type="button">First time? Create account</button></div>
      <div class="gate-msg ${err ? 'err' : ''}" id="gMsg">${msg}</div>`);
    const say = (m, e) => { const el = g.querySelector('#gMsg'); el.textContent = m; el.className = 'gate-msg' + (e ? ' err' : ''); };
    const creds = () => ({ email: g.querySelector('#gEmail').value.trim().toLowerCase(), password: g.querySelector('#gPass').value });
    g.querySelector('#gIn').onclick = async () => {
      const c = creds(); if (!c.email || !c.password) return say('Enter your email and password.', true);
      say('Signing in…');
      const { error } = await sb.auth.signInWithPassword(c);
      if (error) say(error.message === 'Invalid login credentials' ? 'Wrong email or password. First time here? Use Create account.' : error.message, true);
      else location.reload();
    };
    g.querySelector('#gUp').onclick = async () => {
      const c = creds(); if (!c.email || c.password.length < 8) return say('Enter your email and a password of at least 8 characters.', true);
      say('Creating your account…');
      const { data, error } = await sb.auth.signUp(c);
      if (error) return say(error.message, true);
      if (data.session) location.reload();
      else say('Account created. Check your email to confirm it, then sign in. (Admins: turn off "Confirm email" in Supabase to skip this.)');
    };
    g.querySelector('#gPass').onkeydown = e => { if (e.key === 'Enter') g.querySelector('#gIn').click(); };
  }
  function showDenied(email) {
    const g = gate(`<div style="font-size:15px"><b>${email.replace(/</g, '&lt;')}</b> is not on the team list yet.</div>
      <div class="muted" style="font-size:14px">Ask an admin to add this email in Supabase → Table Editor → team_members, then reload this page.</div>
      <div class="gate-row"><button class="btn red" id="gRe" type="button">Reload</button><button class="btn ghost" id="gOut" type="button">Use another account</button></div>`);
    g.querySelector('#gRe').onclick = () => location.reload();
    g.querySelector('#gOut').onclick = async () => { await sb.auth.signOut(); location.reload(); };
  }
  // The team check itself failed (offline, project paused, database error), so don't claim "not on the list".
  function showLookupError(email, err) {
    const msg = String(err?.message || err?.code || 'unknown error').replace(/</g, '&lt;');
    const g = gate(`<div style="font-size:15px">Couldn't check whether <b>${email.replace(/</g, '&lt;')}</b> is on the team list.</div>
      <div class="muted" style="font-size:14px">The database didn't answer properly: <code>${msg}</code>. Check your connection, and check the Supabase project isn't paused.</div>
      <div class="gate-row"><button class="btn red" id="gRe" type="button">Try again</button><button class="btn ghost" id="gOut" type="button">Use another account</button></div>`);
    g.querySelector('#gRe').onclick = () => location.reload();
    g.querySelector('#gOut').onclick = async () => { await sb.auth.signOut(); location.reload(); };
  }
  function showSetup() {
    gate(`<div style="font-size:15px">This copy isn't connected to a database yet.</div>
      <div class="muted" style="font-size:14px">Open <b>config.js</b> and paste your Supabase Project URL and anon key. The README walks through it.</div>`);
  }

  /* ---------------- startup ---------------- */
  const ready = (async () => {
    if (!sb) { showSetup(); return false; }
    const { data } = await sb.auth.getSession();
    session = data.session;
    if (!session) { showLogin(); return false; }
    const email = (session.user.email || '').toLowerCase();
    const { data: row, error: rowErr } = await sb.from('team_members').select('email,name,role,is_admin').eq('email', email).maybeSingle();
    if (rowErr) { showLookupError(email, rowErr); return false; }
    if (!row) { showDenied(email); return false; }
    member = row;
    // sign-out button in the header
    const bar = document.querySelector('header .bar'), anchor = document.getElementById('settingsBtn');
    if (bar && anchor) {
      const b = document.createElement('button');
      b.id = 'signOutBtn'; b.className = 'btn sm ghost'; b.type = 'button'; b.textContent = 'Sign out'; b.title = email;
      b.onclick = async () => { await sb.auth.signOut(); location.reload(); };
      bar.insertBefore(b, anchor);
    }
    return true;
  })();
  if (sb) sb.auth.onAuthStateChange(ev => { if (ev === 'SIGNED_OUT') location.reload(); });

  /* ---------------- db ---------------- */
  const err = e => ({ code: e?.code === '42501' || /row-level security/i.test(e?.message || '') ? 'invalid_argument' : 'unavailable', message: e?.message || String(e) });
  const snap = (id, data) => ({ id, exists: data != null, data: () => data ?? undefined, metadata: { fromCache: false, hasPendingWrites: false } });
  const listeners = {}, channels = {}, timers = {};
  const bump = table => { clearTimeout(timers[table]); timers[table] = setTimeout(() => listeners[table]?.forEach(f => f()), 120); };
  function watch(table, run) {
    (listeners[table] ||= new Set()).add(run);
    if (!channels[table]) channels[table] = sb.channel('rt-' + table).on('postgres_changes', { event: '*', schema: 'public', table }, () => bump(table)).subscribe();
    run();
    return () => listeners[table].delete(run);
  }
  setInterval(() => Object.keys(listeners).forEach(bump), 30000); // safety net if live updates drop
  const newId = () => 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  function docRef(table, id) {
    return {
      id, path: table + '/' + id,
      async get() {
        const { data, error } = await sb.from(table).select('data').eq('id', id).maybeSingle();
        if (error) throw err(error);
        return snap(id, data?.data);
      },
      async set(d) {
        const row = { id, data: d, updated_at: new Date().toISOString() };
        let res;
        if (table === 'activity') { row.at = d.at || row.updated_at; res = await sb.from(table).insert(row); }
        else res = await sb.from(table).upsert(row);
        if (res.error) throw err(res.error);
        bump(table);
      },
      async update(d) { const cur = await this.get(); if (!cur.exists) throw { code: 'invalid_argument', message: 'Not found' }; await this.set({ ...cur.data(), ...d }); },
      async delete() { const { error } = await sb.from(table).delete().eq('id', id); if (error) throw err(error); bump(table); },
      onSnapshot(next, onErr) { const run = async () => { try { next(await this.get()); } catch (e) { onErr?.(e); } }; return watch(table, run); },
      collection() { throw new TypeError('Sub-collections are not used by this app'); },
    };
  }
  function query(table, opts = {}) {
    return {
      path: table,
      where() { return this; },
      orderBy(field, dir) { return query(table, { ...opts, order: [field, dir] }); },
      limit(n) { return query(table, { ...opts, limit: n }); },
      async get() {
        let q = sb.from(table).select('id,data');
        if (opts.order) q = q.order(table === 'activity' && opts.order[0] === 'at' ? 'at' : 'id', { ascending: opts.order[1] !== 'desc' });
        q = q.limit(opts.limit || 1000);
        const { data, error } = await q;
        if (error) throw err(error);
        const docs = data.map(r => snap(r.id, r.data));
        return { docs, size: docs.length, empty: !docs.length, docChanges: () => [], metadata: { fromCache: false, hasPendingWrites: false } };
      },
      onSnapshot(next, onErr) { const run = async () => { try { next(await this.get()); } catch (e) { onErr?.(e); } }; return watch(table, run); },
      doc(id) { return docRef(table, id || newId()); },
      async add(d) { const r = docRef(table, newId()); await r.set(d); return r; },
    };
  }
  const db = {
    collection: p => query(p),
    doc: p => { const [t, id] = p.split('/'); return docRef(t, id); },
  };

  /* ---------------- user ---------------- */
  async function loadTeam() {
    if (team) return team;
    const { data } = await sb.from('team_members').select('email,name,role,is_admin');
    team = Object.fromEntries((data || []).map(r => [r.email, r]));
    return team;
  }
  const user = {
    id: async () => member.email,
    me: async () => ({ id: member.email, name: member.name, avatarUrl: '', color: '#EB0028', email: member.email, isOwner: !!member.is_admin, canEdit: true }),
    name: async () => member.name,
    email: async () => member.email,
    isOwner: async () => !!member.is_admin,
    canEdit: async () => true,
    can: async () => true,
    async profiles(ids) {
      const t = await loadTeam();
      const list = Array.isArray(ids) ? ids : [ids];
      return Object.fromEntries(list.map(id => [id, { id, name: t[id]?.name || id || '', avatarUrl: '', color: '#EB0028', email: id, isMe: id === member.email, guest: false }]));
    },
    search: async () => Object.values(await loadTeam()).map(r => ({ id: r.email, name: r.name })),
  };

  /* ---------------- receipts ---------------- */
  const signed = new Map();
  const assets = {
    async upload(file) {
      const safe = (file.name || 'receipt').replace(/[^\w.-]+/g, '_').slice(-60);
      const path = `${new Date().getFullYear()}/${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}-${safe}`;
      const { error } = await sb.storage.from('receipts').upload(path, file, { contentType: file.type || 'application/octet-stream' });
      if (error) throw { code: 'upload_failed', message: error.message };
      return { id: path, url: '', sizeBytes: file.size, contentType: file.type };
    },
    async list() { return { assets: [], usage: {} }; },
    async delete(id) { await sb.storage.from('receipts').remove([id]); return { deleted: true }; },
  };
  // Private receipts: swap placeholders for short-lived signed links after each render.
  window.hydrateReceipts = async (root = document) => {
    const els = [...root.querySelectorAll('[data-rid],[data-rid-img]')];
    for (const el of els) {
      const id = el.dataset.rid || el.dataset.ridImg;
      let url = signed.get(id);
      if (!url) {
        const { data } = await sb.storage.from('receipts').createSignedUrl(id, 3600);
        url = data?.signedUrl || ''; if (url) { signed.set(id, url); setTimeout(() => signed.delete(id), 50 * 60 * 1000); }
      }
      if (!url) continue;
      if (el.dataset.ridImg) el.src = url; else el.href = url;
    }
  };

  /* ---------------- downloads ---------------- */
  const downloads = {
    async save({ filename, data }) {
      const blob = data instanceof Blob ? data : new Blob([data]);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = filename; document.body.appendChild(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
      return { status: 'saved' };
    },
  };

  /* ---------------- Ask AI (Edge Function) ---------------- */
  async function sample(input, opts = {}) {
    const prompt = typeof input === 'string' ? input : input.map(m => m.content).join('\n\n');
    const { data, error } = await sb.functions.invoke('ask', { body: { prompt } });
    if (error) {
      let msg = error.message;
      try { msg = (await error.context?.json())?.error || msg; } catch {}
      throw { code: 'unavailable', message: msg, text: /not found|Failed to send/i.test(msg) ? 'Ask AI is not set up yet. Deploy the "ask" function (see README).' : 'Ask AI could not answer: ' + msg };
    }
    opts.onText?.({ text: data.text, delta: data.text });
    return { text: data.text, truncated: false };
  }

  const caps = { db, user, assets, downloads, sample };
  window.claude = {
    use: async name => (await ready) ? (caps[name] ?? null) : new Promise(() => {}),
  };
})();
