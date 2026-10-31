import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.0';
import { SUPABASE_URL, SUPABASE_KEY, CALENDAR_FN, USERNAME_LOGIN_FN, DONATE_LINKS, HOME } from './config.js';
import { readPoster, compressImage } from './ocr.js';

const sb = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });

const CATS = [
  { key: 'environmental', label: 'Environmental', pillar: 'Environmental Well-Being' },
  { key: 'community', label: 'Community', pillar: 'Community Support & Local Connection' },
  { key: 'wellness', label: 'Physical wellness', pillar: 'Physical Wellness & Active Engagement' },
  { key: 'mental', label: 'Mental & emotional', pillar: 'Mental & Emotional Well-Being' },
  { key: 'arts', label: 'Arts & fun' },
  { key: 'other', label: 'Other' },
];
const CAT = Object.fromEntries(CATS.map((c) => [c.key, c]));
const TAGS = [
  ['family', 'Family friendly'], ['kids', 'Kids'], ['teens', 'Teens'], ['seniors', 'Seniors'], ['outdoor', 'Outdoors'], ['indoor', 'Indoors'],
  ['accessible', 'Accessible'], ['pets', 'Pets welcome'], ['volunteer', 'Volunteering'], ['fitness', 'Fitness'], ['nature', 'Nature'],
  ['food', 'Food'], ['music', 'Music'], ['learning', 'Learning'], ['social', 'Social'], ['faith', 'Faith'],
];
const TAG = Object.fromEntries(TAGS);
const COSTS = [['free', 'Free'], ['donation', 'By donation'], ['paid', 'Paid']];
const WHENS = [['upcoming', 'Upcoming'], ['today', 'Today'], ['weekend', 'This weekend'], ['week', 'Next 7 days'], ['month', 'Next 30 days']];
const RADII = [[null, 'Any distance'], [2, 'Within 2 mi'], [5, 'Within 5 mi'], [10, 'Within 10 mi'], [25, 'Within 25 mi']];

const state = {
  user: null, username: null, role: null,
  month: firstOfMonth(new Date()), day: null,
  filters: loadFilters(), loc: null, rsvps: new Map(),
};

/* ---------- small helpers ---------- */
const $ = (sel, root = document) => root.querySelector(sel);
const h = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const main = () => $('#main');
const isMod = () => ['admin', 'moderator'].includes(state.role);
const canTpc = () => ['admin', 'organizer'].includes(state.role);
function firstOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function dayKey(d) { const x = new Date(d); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; }
const fmtDay = (d) => new Date(d).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
const fmtShort = (d) => new Date(d).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
const fmtTime = (d) => new Date(d).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
function whenText(e) {
  if (e.all_day) return e.ends_at && dayKey(e.ends_at) !== dayKey(e.starts_at) ? `${fmtShort(e.starts_at)} to ${fmtShort(e.ends_at)}` : 'All day';
  const end = e.ends_at ? `–${fmtTime(e.ends_at)}` : '';
  return dayKey(e.ends_at || e.starts_at) === dayKey(e.starts_at) ? `${fmtTime(e.starts_at)}${end}` : `${fmtShort(e.starts_at)} ${fmtTime(e.starts_at)} to ${fmtShort(e.ends_at)} ${fmtTime(e.ends_at)}`;
}
const posterUrl = (p) => (p ? sb.storage.from('phoenix-posters').getPublicUrl(p).data.publicUrl : '');
function store(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch { /* storage unavailable */ } }
function recall(key, fallback) { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; } }
function loadFilters() { return { when: 'upcoming', cats: [], tags: [], cost: [], tpc: false, q: '', radius: null, ...recall('pe.filters', {}) }; }
function saveFilters() { store('pe.filters', state.filters); }

let toastTimer;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 3600);
}
const FRIENDLY = {
  phoenix_rate_limited: 'You’ve added 20 events today. You can add more tomorrow.',
  phoenix_event_unavailable: 'This event is no longer available.',
  phoenix_volunteer_full: 'All volunteer spots are filled. You can still mark yourself as going.',
  phoenix_volunteer_tpc_only: 'Volunteer sign-ups are only for Phoenix Catalyst events.',
  phoenix_sign_in_required: 'Sign in first.',
  phoenix_user_not_found: 'No account has that username.',
  phoenix_cannot_change_own_role: 'Ask another admin to change your own role.',
  dragonfly_username_taken: 'That username is taken. Try another.',
  dragonfly_username_invalid: 'Usernames are 3–30 letters, numbers, dots, dashes or underscores.',
  invalid_credentials: 'That username or password didn’t match.',
};
function errText(err) {
  const m = err?.message || String(err || '');
  for (const k of Object.keys(FRIENDLY)) if (m.includes(k)) return FRIENDLY[k];
  if (/Invalid login credentials/i.test(m)) return FRIENDLY.invalid_credentials;
  if (/Email not confirmed/i.test(m)) return 'Confirm your email first. Check your inbox for the link.';
  if (/duplicate key|already exists/i.test(m)) return 'That’s already done.';
  if (/Failed to fetch|NetworkError/i.test(m)) return 'Can’t reach the server. Check your connection and try again.';
  return m || 'Something went wrong. Try again.';
}
function busy(btn, on, label) {
  if (!btn) return;
  if (on) { btn.dataset.label = btn.textContent; btn.textContent = label || 'Working…'; btn.disabled = true; }
  else { btn.textContent = btn.dataset.label || btn.textContent; btn.disabled = false; }
}

/* ---------- dialog ---------- */
function openDialog(html, onMount) {
  const d = $('#dialog');
  d.innerHTML = html;
  d.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => d.close()));
  if (!d.open) d.showModal();
  onMount?.(d);
  return d;
}
function confirmDialog(title, body, okLabel = 'Confirm', danger = false) {
  return new Promise((resolve) => {
    openDialog(`<h2>${h(title)}</h2><p>${h(body)}</p><div class="row"><button class="btn ${danger ? 'danger' : ''}" data-ok>${h(okLabel)}</button><button class="btn ghost" data-close>Cancel</button></div>`, (d) => {
      d.addEventListener('close', () => resolve(false), { once: true });
      $('[data-ok]', d).addEventListener('click', () => { resolve(true); d.close(); });
    });
  });
}

/* ---------- accounts (shared Dragonfly account system) ---------- */
async function loadMe() {
  const { data: { session } } = await sb.auth.getSession();
  state.user = session?.user ?? null;
  state.username = null; state.role = null; state.rsvps = new Map();
  if (state.user) {
    const [p, r, rs] = await Promise.all([
      sb.from('dragonfly_profiles').select('username').eq('user_id', state.user.id).maybeSingle(),
      sb.from('phoenix_roles').select('role').eq('user_id', state.user.id).maybeSingle(),
      sb.from('phoenix_rsvps').select('event_id,kind').eq('user_id', state.user.id),
    ]);
    state.username = p.data?.username ?? state.user.email;
    state.role = r.data?.role ?? null;
    (rs.data ?? []).forEach((x) => state.rsvps.set(x.event_id, x.kind));
  }
  renderAccount();
}
function renderAccount() {
  const el = $('#account');
  if (!state.user) { el.innerHTML = '<button class="btn small" id="signin">Sign in</button>'; $('#signin').onclick = () => authDialog(); return; }
  el.innerHTML = `<button class="btn small quiet" id="me">@${h(state.username)}</button>`;
  $('#me').onclick = () => openDialog(`<h2>@${h(state.username)}</h2>
    <p class="muted">${state.role ? `You’re a${state.role === 'admin' ? 'n' : ''} ${h(state.role)} for The Phoenix Catalyst. ` : ''}This is your Dragonfly account, the same one you use across Dragonfly apps.</p>
    <div class="row">
      <a class="btn quiet" href="#/mine" data-close>My events</a>
      ${isMod() ? '<a class="btn quiet" href="#/moderate" data-close>Review posts</a>' : ''}
      ${state.role === 'admin' ? '<a class="btn quiet" href="#/admin" data-close>Team roles</a>' : ''}
      <button class="btn ghost" id="signout">Sign out</button>
    </div>`, (d) => { $('#signout', d).onclick = async () => { await sb.auth.signOut(); d.close(); toast('Signed out'); }; });
}
function requireUser(why) {
  if (state.user) return true;
  authDialog(why);
  return false;
}
function authDialog(why = '', mode = 'in') {
  const redirect = location.origin + location.pathname;
  const inForm = `<form id="authf" novalidate>
      <label class="field"><span>Username or email</span><input type="text" name="id" autocomplete="username" required autocapitalize="none"></label>
      <label class="field"><span>Password</span><input type="password" name="pw" autocomplete="current-password" required></label>
      <p class="error" id="autherr" role="alert"></p>
      <div class="row"><button class="btn" type="submit">Sign in</button><button class="btn ghost" type="button" id="toup">Create an account</button></div>
      <p class="small" style="margin-top:12px"><button type="button" class="btn small quiet" id="forgot">Forgot password</button></p>
    </form>`;
  const upForm = `<form id="authf" novalidate>
      <label class="field"><span>Email</span><input type="email" name="email" autocomplete="email" required></label>
      <label class="field"><span>Username</span><input type="text" name="username" autocomplete="username" pattern="[A-Za-z0-9][A-Za-z0-9_.\\-]{2,29}" required autocapitalize="none"></label>
      <label class="field"><span>Password</span><input type="password" name="pw" autocomplete="new-password" minlength="8" required></label>
      <p class="small muted">One account works across all Dragonfly apps. Your username can’t be changed later.</p>
      <p class="error" id="autherr" role="alert"></p>
      <div class="row"><button class="btn" type="submit">Create account</button><button class="btn ghost" type="button" id="toin">I have an account</button></div>
    </form>`;
  openDialog(`<h2>${mode === 'in' ? 'Sign in' : 'Create your account'}</h2>${why ? `<p class="muted">${h(why)}</p>` : ''}${mode === 'in' ? inForm : upForm}`, (d) => {
    const f = $('#authf', d), err = $('#autherr', d), btn = f.querySelector('[type=submit]');
    $('#toup', d)?.addEventListener('click', () => authDialog(why, 'up'));
    $('#toin', d)?.addEventListener('click', () => authDialog(why, 'in'));
    $('#forgot', d)?.addEventListener('click', async () => {
      const email = f.id.value.trim();
      if (!email.includes('@')) { err.textContent = 'Enter your account email above, then press Forgot password.'; return; }
      const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: redirect });
      err.textContent = ''; if (error) err.textContent = errText(error); else toast('Check your email for a reset link');
    });
    f.addEventListener('submit', async (ev) => {
      ev.preventDefault(); err.textContent = ''; busy(btn, true);
      try {
        if (mode === 'in') {
          const id = f.id.value.trim(), pw = f.pw.value;
          if (!id || !pw) throw new Error('Enter your username or email and password.');
          if (id.includes('@')) {
            const { error } = await sb.auth.signInWithPassword({ email: id, password: pw });
            if (error) throw error;
          } else {
            const res = await fetch(USERNAME_LOGIN_FN, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: SUPABASE_KEY }, body: JSON.stringify({ username: id, password: pw }) });
            const body = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(body.error || 'invalid_credentials');
            const { error } = await sb.auth.setSession({ access_token: body.access_token, refresh_token: body.refresh_token });
            if (error) throw error;
          }
          d.close(); toast('Signed in');
        } else {
          const email = f.email.value.trim(), username = f.username.value.trim(), pw = f.pw.value;
          if (!f.checkValidity()) throw new Error(pw.length < 8 ? 'Use at least 8 characters for your password.' : 'Check your email and username.');
          const { data: free } = await sb.rpc('dragonfly_username_available', { wanted: username });
          if (free === false) throw new Error('dragonfly_username_taken');
          const { data, error } = await sb.auth.signUp({ email, password: pw, options: { data: { username }, emailRedirectTo: redirect } });
          if (error) throw error;
          if (data.session) { d.close(); toast('Welcome!'); }
          else openDialog(`<h2>Confirm your email</h2><p>We sent a link to <b>${h(email)}</b>. Open it on this device to finish signing up.</p><button class="btn" data-close>OK</button>`);
        }
      } catch (e) { err.textContent = errText(e); } finally { busy(btn, false); }
    });
  });
}
function newPasswordDialog() {
  openDialog(`<h2>Choose a new password</h2><form id="npf"><label class="field"><span>New password</span><input type="password" name="pw" minlength="8" autocomplete="new-password" required></label>
    <p class="error" id="nperr" role="alert"></p><button class="btn" type="submit">Save password</button></form>`, (d) => {
    $('#npf', d).addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const pw = ev.target.pw.value;
      if (pw.length < 8) { $('#nperr', d).textContent = 'Use at least 8 characters.'; return; }
      const { error } = await sb.auth.updateUser({ password: pw });
      if (error) $('#nperr', d).textContent = errText(error); else { d.close(); toast('Password saved'); }
    });
  });
}

/* ---------- data ---------- */
function rangeFor(f) {
  const now = new Date(), today = startOfDay(now);
  switch (f.when) {
    case 'today': return [now, addDays(today, 1)];
    case 'weekend': {
      const dow = today.getDay();
      const sat = dow === 0 ? addDays(today, -1) : addDays(today, 6 - dow);
      return [dow === 0 || dow === 6 ? now : sat, addDays(sat, 2)];
    }
    case 'week': return [now, addDays(today, 8)];
    case 'month': return [now, addDays(today, 31)];
    default: return [now, null];
  }
}
async function origin() {
  if (!state.filters.radius) return null;
  if (state.loc) return state.loc;
  state.loc = await new Promise((res) => {
    if (!navigator.geolocation) return res(null);
    navigator.geolocation.getCurrentPosition((p) => res({ lat: p.coords.latitude, lng: p.coords.longitude, mine: true }), () => res(null), { timeout: 8000, maximumAge: 600000 });
  });
  if (!state.loc) { state.loc = { ...HOME, mine: false }; toast(`Measuring distance from ${HOME.name}. Allow location for distances from you.`); }
  return state.loc;
}
async function search(from, to, limit = 300) {
  const f = state.filters, o = await origin();
  const { data, error } = await sb.rpc('phoenix_search_events', {
    p_from: from.toISOString(), p_to: to ? to.toISOString() : null,
    p_categories: f.cats.length ? f.cats : null, p_tags: f.tags.length ? f.tags : null, p_cost: f.cost.length ? f.cost : null,
    p_tpc_only: !!f.tpc, p_q: f.q || null,
    p_lat: o?.lat ?? null, p_lng: o?.lng ?? null, p_radius_mi: f.radius ?? null, p_limit: limit,
  });
  if (error) throw error;
  return data;
}
function activeFilterCount() {
  const f = state.filters;
  return f.cats.length + f.tags.length + f.cost.length + (f.tpc ? 1 : 0) + (f.q ? 1 : 0) + (f.radius ? 1 : 0);
}

/* ---------- views ---------- */
function evRow(e) {
  const rs = state.rsvps.get(e.id);
  return `<a class="ev" data-cat="${h(e.category)}" href="#/event/${e.id}">
    <span class="bar"></span>
    <span class="body">
      <span class="t">${h(e.title)}</span>
      <span class="meta">${h(whenText(e))}${e.location_name ? ` at ${h(e.location_name)}` : ''}</span>
      <span class="badges">
        ${e.is_tpc ? '<span class="badge tpc">Phoenix Catalyst</span>' : ''}
        ${e.cost !== 'free' ? `<span class="badge">${h(Object.fromEntries(COSTS)[e.cost])}</span>` : '<span class="badge">Free</span>'}
        ${rs ? `<span class="badge">${rs === 'volunteer' ? 'You’re volunteering' : 'You’re going'}</span>` : ''}
        ${e.going_count ? `<span class="badge">${e.going_count} going</span>` : ''}
      </span>
    </span>
    ${e.poster_path ? `<img class="thumb" src="${h(posterUrl(e.poster_path))}" alt="" loading="lazy">` : '<span class="nothumb"></span>'}
  </a>`;
}

function chipRow(items, selected, attr, withColor = false) {
  return items.map(([k, label]) => `<button type="button" class="chip" data-${attr}="${h(k)}" ${withColor ? `data-cat="${h(k)}"` : ''} aria-pressed="${selected.includes(k)}">${withColor ? '<span class="dot"></span>' : ''}${h(label)}</button>`).join('');
}
function filtersHtml(compact = false) {
  const f = state.filters, n = activeFilterCount();
  return `<div class="filters ${recall('pe.filtersOpen', false) ? '' : 'collapsed'}" id="filters">
    <form class="searchbar" id="qform" role="search"><input type="search" name="q" value="${h(f.q)}" placeholder="Search yoga, food drive, trail…" aria-label="Search events"><button class="btn" type="submit">Search</button></form>
    ${compact ? '' : `<div class="chips" role="group" aria-label="When">${WHENS.map(([k, l]) => `<button type="button" class="chip" data-when="${k}" aria-pressed="${f.when === k && !state.day}">${l}</button>`).join('')}</div>`}
    <div class="chips" role="group" aria-label="Type of event">${chipRow(CATS.map((c) => [c.key, c.label]), f.cats, 'cat-f', true)}</div>
    <button type="button" class="btn small quiet filter-toggle" id="ftoggle">${n ? `More filters (${n} on)` : 'More filters'}</button>
    <div class="more">
      <h3>Good for</h3><div class="chips wrap">${chipRow(TAGS, f.tags, 'tag')}</div>
      <h3>Cost</h3><div class="chips wrap">${chipRow(COSTS, f.cost, 'cost')}</div>
      <h3>Distance</h3><div class="chips wrap">${RADII.map(([k, l]) => `<button type="button" class="chip" data-radius="${k ?? ''}" aria-pressed="${f.radius === k}">${l}</button>`).join('')}</div>
      <label class="check"><input type="checkbox" id="tpconly" ${f.tpc ? 'checked' : ''}> Only Phoenix Catalyst volunteer events</label>
      ${n ? '<button type="button" class="btn small ghost" id="fclear">Clear filters</button>' : ''}
    </div>
  </div>`;
}
function wireFilters(root, rerender) {
  const f = state.filters;
  const toggle = (arr, v) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  root.querySelector('#qform').addEventListener('submit', (e) => { e.preventDefault(); f.q = e.target.q.value.trim(); saveFilters(); rerender(); });
  root.querySelector('#ftoggle')?.addEventListener('click', () => { const el = $('#filters'); el.classList.toggle('collapsed'); store('pe.filtersOpen', !el.classList.contains('collapsed')); });
  root.querySelectorAll('[data-when]').forEach((b) => b.onclick = () => { f.when = b.dataset.when; state.day = null; saveFilters(); rerender(); });
  root.querySelectorAll('[data-cat-f]').forEach((b) => b.onclick = () => { f.cats = toggle(f.cats, b.dataset.catF); saveFilters(); rerender(); });
  root.querySelectorAll('[data-tag]').forEach((b) => b.onclick = () => { f.tags = toggle(f.tags, b.dataset.tag); saveFilters(); rerender(); });
  root.querySelectorAll('[data-cost]').forEach((b) => b.onclick = () => { f.cost = toggle(f.cost, b.dataset.cost); saveFilters(); rerender(); });
  root.querySelectorAll('[data-radius]').forEach((b) => b.onclick = () => { f.radius = b.dataset.radius ? Number(b.dataset.radius) : null; saveFilters(); rerender(); });
  root.querySelector('#tpconly').onchange = (e) => { f.tpc = e.target.checked; saveFilters(); rerender(); };
  root.querySelector('#fclear')?.addEventListener('click', () => { Object.assign(f, { cats: [], tags: [], cost: [], tpc: false, q: '', radius: null }); saveFilters(); rerender(); });
}

function monthHtml(events) {
  const m = state.month, start = addDays(m, -m.getDay()), today = dayKey(new Date());
  const byDay = new Map();
  for (const e of events) {
    let d = startOfDay(e.starts_at); const last = startOfDay(e.ends_at || e.starts_at);
    for (let i = 0; i < 14 && d <= last; i++, d = addDays(d, 1)) {
      const k = dayKey(d); if (!byDay.has(k)) byDay.set(k, []); byDay.get(k).push(e.category);
    }
  }
  const order = CATS.map((c) => c.key);
  let cells = '';
  for (let i = 0; i < 42; i++) {
    const d = addDays(start, i), k = dayKey(d), cats = (byDay.get(k) || []).sort((a, b) => order.indexOf(a) - order.indexOf(b));
    const label = `${fmtDay(d)}: ${cats.length ? `${cats.length} event${cats.length > 1 ? 's' : ''}` : 'no events'}`;
    cells += `<button type="button" class="day ${d.getMonth() !== m.getMonth() ? 'out' : ''} ${k === today ? 'today' : ''} ${k < today ? 'past' : ''} ${cats.length >= 5 ? 'full' : ''}"
      data-day="${k}" aria-pressed="${state.day === k}" aria-label="${h(label)}"><span class="n">${d.getDate()}</span>
      <span class="bands">${cats.slice(0, 5).map((c) => `<i data-cat="${h(c)}"></i>`).join('')}</span></button>`;
  }
  return `<div class="month">
    <div class="month-head"><button type="button" id="prevm" aria-label="Previous month">‹</button>
      <h2>${m.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</h2>
      <button type="button" id="nextm" aria-label="Next month">›</button></div>
    <div class="dow" aria-hidden="true">${['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((x) => `<span>${x}</span>`).join('')}</div>
    <div class="days">${cells}</div>
    <div class="legend">${CATS.slice(0, 5).map((c) => `<span data-cat="${c.key}"><i></i>${h(c.label)}</span>`).join('')}</div>
  </div>`;
}

async function viewCalendar() {
  const root = main();
  root.innerHTML = `<div class="hello"><h1>Bring color back into your world</h1><p>Local events near you, shared by neighbors and The Phoenix Catalyst.</p></div>
    <div class="home"><aside id="side"></aside><section id="list" aria-live="polite"><p class="muted">Loading events…</p></section></div>`;
  const draw = async () => {
    const m = state.month, gridStart = addDays(m, -m.getDay()), gridEnd = addDays(gridStart, 42);
    let monthEvents = [], listEvents = [], failed = null;
    try {
      const listRange = state.day ? [new Date(`${state.day}T00:00:00`), addDays(new Date(`${state.day}T00:00:00`), 1)] : rangeFor(state.filters);
      [monthEvents, listEvents] = await Promise.all([search(gridStart, gridEnd, 500), search(listRange[0], listRange[1])]);
    } catch (e) { failed = e; }
    $('#side').innerHTML = monthHtml(monthEvents) + filtersHtml();
    wireFilters($('#side'), draw);
    $('#prevm').onclick = () => { state.month = new Date(m.getFullYear(), m.getMonth() - 1, 1); draw(); };
    $('#nextm').onclick = () => { state.month = new Date(m.getFullYear(), m.getMonth() + 1, 1); draw(); };
    document.querySelectorAll('.day').forEach((b) => b.onclick = () => { state.day = state.day === b.dataset.day ? null : b.dataset.day; draw(); });
    const list = $('#list');
    if (failed) { list.innerHTML = `<div class="empty"><h2>Couldn’t load events</h2><p>${h(errText(failed))}</p><button class="btn" id="retry">Try again</button></div>`; $('#retry').onclick = draw; return; }
    const heading = state.day ? fmtDay(`${state.day}T12:00:00`) : Object.fromEntries(WHENS)[state.filters.when];
    if (!listEvents.length) {
      list.innerHTML = `<h2 style="margin-bottom:12px">${h(heading)}</h2><div class="empty"><h2>Nothing here yet</h2>
        <p>${activeFilterCount() ? 'Try fewer filters, or share' : 'Share'} an event you know about. A photo of a flyer works.</p>
        <a class="btn" href="#/add">Add an event</a></div>`;
      return;
    }
    const groups = new Map();
    for (const e of listEvents) { const k = dayKey(e.starts_at) < dayKey(new Date()) ? dayKey(new Date()) : dayKey(e.starts_at); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(e); }
    list.innerHTML = `<h2 style="margin-bottom:12px">${h(heading)}${state.day ? ' <button class="btn small quiet" id="clearday">Show all upcoming</button>' : ''}</h2>` +
      [...groups].map(([k, evs]) => `<div class="daygroup"><h3>${k === dayKey(new Date()) ? 'Today' : h(fmtDay(`${k}T12:00:00`))}</h3>${evs.map(evRow).join('')}</div>`).join('');
    $('#clearday')?.addEventListener('click', () => { state.day = null; draw(); });
  };
  await draw();
}

/* ---------- event page ---------- */
function googleLink(e) {
  const d = (x) => new Date(x).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const dates = e.all_day ? `${dayKey(e.starts_at).replace(/-/g, '')}/${dayKey(addDays(e.ends_at || e.starts_at, 1)).replace(/-/g, '')}`
    : `${d(e.starts_at)}/${d(e.ends_at || new Date(new Date(e.starts_at).getTime() + 3600e3))}`;
  const p = new URLSearchParams({ action: 'TEMPLATE', text: e.title, dates, details: `${e.description || ''}\n\n${shareUrl(e)}`.trim(), location: [e.location_name, e.address].filter(Boolean).join(', ') });
  return `https://calendar.google.com/calendar/render?${p}`;
}
function outlookLink(e, host = 'outlook.live.com') {
  const p = new URLSearchParams({ path: '/calendar/action/compose', rru: 'addevent', subject: e.title, startdt: new Date(e.starts_at).toISOString(),
    enddt: new Date(e.ends_at || new Date(new Date(e.starts_at).getTime() + 3600e3)).toISOString(), allday: String(!!e.all_day),
    body: `${e.description || ''}\n\n${shareUrl(e)}`.trim(), location: [e.location_name, e.address].filter(Boolean).join(', ') });
  return `https://${host}/calendar/0/deeplink/compose?${p}`;
}
const shareUrl = (e) => `${location.origin}${location.pathname}#/event/${e.id}`;
const webcal = (u) => u.replace(/^https:/, 'webcal:');
function subscribeLinks(feedUrl, name) {
  return `<div class="row">
    <a class="btn quiet" target="_blank" rel="noopener" data-sub href="https://calendar.google.com/calendar/render?cid=${encodeURIComponent(webcal(feedUrl))}">Google Calendar</a>
    <a class="btn quiet" data-sub href="${h(webcal(feedUrl))}">Apple Calendar</a>
    <a class="btn quiet" target="_blank" rel="noopener" data-sub href="https://outlook.live.com/calendar/0/addfromweb?url=${encodeURIComponent(feedUrl)}&name=${encodeURIComponent(name)}">Outlook</a>
    <button type="button" class="btn quiet" data-copy="${h(feedUrl)}">Copy link</button>
  </div>`;
}
function wireCopy(root) {
  root.querySelectorAll('[data-copy]').forEach((b) => b.onclick = async () => {
    try { await navigator.clipboard.writeText(b.dataset.copy); toast('Link copied'); } catch { prompt('Copy this link:', b.dataset.copy); }
  });
  root.querySelectorAll('[data-sub]').forEach((a) => a.addEventListener('click', () => store('pe.subscribed', true)));
}
async function addToCalendarDialog(e) {
  let mine = '';
  if (state.user) {
    const { data: token } = await sb.rpc('phoenix_calendar_token');
    if (token) mine = `<h3 style="margin-top:16px">Every event you join, automatically</h3>
      <p class="small muted">Subscribe once. Events you mark Going or Volunteer appear on their own, and updates or cancellations sync too.</p>
      ${subscribeLinks(`${CALENDAR_FN}?token=${token}`, 'My Phoenix Catalyst Events')}`;
  }
  openDialog(`<h2>Add to your calendar</h2>
    <h3>Just this event</h3>
    <div class="row" style="margin-top:8px">
      <a class="btn quiet" target="_blank" rel="noopener" href="${h(googleLink(e))}">Google</a>
      <a class="btn quiet" href="${h(`${CALENDAR_FN}?event=${e.id}`)}">Apple / iCal</a>
      <a class="btn quiet" target="_blank" rel="noopener" href="${h(outlookLink(e))}">Outlook.com</a>
      <a class="btn quiet" target="_blank" rel="noopener" href="${h(outlookLink(e, 'outlook.office.com'))}">Outlook (work/school)</a>
    </div>${mine}
    <div class="row" style="margin-top:16px"><button class="btn ghost" data-close>Done</button></div>`, wireCopy);
}

async function viewEvent(id) {
  const root = main();
  root.innerHTML = '<p class="muted pad">Loading…</p>';
  const { data: e, error } = await sb.from('phoenix_events').select('*').eq('id', id).maybeSingle();
  if (error || !e) { root.innerHTML = `<div class="empty detail"><h2>Event not found</h2><p>It may have been removed.</p><a class="btn" href="#/">Back to calendar</a></div>`; return; }
  const mine = state.user && e.created_by === state.user.id, rs = state.rsvps.get(e.id);
  const full = e.volunteer_slots && e.volunteer_count >= e.volunteer_slots;
  const place = [e.location_name, e.address].filter(Boolean).join(', ');
  document.title = `${e.title} · Phoenix Community Calendar`;
  root.innerHTML = `<article class="detail" data-cat="${h(e.category)}">
    <p><a href="#/" class="small">Back to calendar</a></p>
    ${e.status !== 'published' ? `<p class="panel error">This event is ${h(e.status)} and only visible to you${isMod() ? ' and moderators' : ''}.</p>` : ''}
    <h1>${h(e.title)}</h1>
    <div class="stripe"></div>
    <p class="muted">${h(CAT[e.category]?.label)}${e.is_tpc ? ' · Hosted by The Phoenix Catalyst' : e.organizer ? ` · Hosted by ${h(e.organizer)}` : ''}</p>
    <div class="facts">
      <div><svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg><span><b>${h(fmtDay(e.starts_at))}</b><br>${h(whenText(e))}</span></div>
      ${place ? `<div><svg viewBox="0 0 24 24"><path d="M12 21s-7-6.2-7-12a7 7 0 0 1 14 0c0 5.8-7 12-7 12z"/><circle cx="12" cy="9" r="2.5"/></svg><span>${h(place)}<br><a target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place)}">Get directions</a></span></div>` : ''}
      <div><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M9 9.5a3 3 0 1 1 3 3v2M12 17.5v.5"/></svg><span>${h(Object.fromEntries(COSTS)[e.cost])}${e.tags.length ? ` · ${e.tags.map((t) => h(TAG[t])).join(', ')}` : ''}</span></div>
      <div><svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6 6 0 0 1 3.5 6"/></svg><span>${e.going_count} going${e.is_tpc ? ` · ${e.volunteer_count}${e.volunteer_slots ? ` of ${e.volunteer_slots}` : ''} volunteers` : ''}</span></div>
    </div>
    <div class="actions">
      ${e.is_tpc ? `<button class="btn ${rs === 'volunteer' ? '' : 'ghost'}" id="vol" ${full && rs !== 'volunteer' ? 'disabled' : ''}>${rs === 'volunteer' ? 'You’re volunteering' : full ? 'Volunteer spots full' : 'Volunteer'}</button>` : ''}
      <button class="btn ${rs === 'going' ? '' : 'ghost'}" id="going">${rs === 'going' ? 'You’re going' : 'I’m going'}</button>
      <button class="btn quiet" id="addcal">Add to calendar</button>
      <button class="btn quiet" id="share">Share</button>
    </div>
    ${e.poster_path ? `<img class="poster" src="${h(posterUrl(e.poster_path))}" alt="Poster for ${h(e.title)}">` : ''}
    ${e.description ? `<h2 style="margin:18px 0 8px">About this event</h2><p class="desc">${h(e.description)}</p>` : ''}
    ${e.url ? `<p><a target="_blank" rel="noopener nofollow" href="${h(e.url)}">More info on the organizer’s site</a></p>` : ''}
    <p class="small muted">Posted by @${h(e.created_by_username || 'neighbor')}${e.source === 'poster' ? ' from a poster photo' : ''}. Details can change, so check with the organizer.</p>
    <div class="actions">
      ${mine || isMod() ? `<a class="btn small quiet" href="#/edit/${e.id}">Edit</a>` : ''}
      ${mine || state.role === 'admin' ? '<button class="btn small danger" id="del">Delete</button>' : ''}
      ${!mine ? '<button class="btn small quiet" id="flag">Report a problem</button>' : ''}
    </div>
    ${isMod() ? `<div class="panel"><h3>Moderation</h3><p class="small muted">${e.reviewed_at ? `Reviewed ${h(fmtShort(e.reviewed_at))}` : 'Not reviewed yet'}. Status: ${h(e.status)}.</p>
      <div class="row">
        ${!e.reviewed_at ? '<button class="btn small" data-mod="ok">Looks good</button>' : ''}
        ${e.status !== 'published' ? '<button class="btn small quiet" data-mod="published">Restore</button>' : ''}
        ${e.status === 'published' ? '<button class="btn small quiet" data-mod="hidden">Hide</button>' : ''}
        ${e.status !== 'removed' ? '<button class="btn small danger" data-mod="removed">Remove</button>' : ''}
      </div></div>` : ''}
    ${e.is_tpc && canTpc() ? '<div class="panel" id="roster"><h3>Volunteers</h3><p class="muted small">Loading…</p></div>' : ''}
  </article>`;

  const rsvp = async (kind, btn) => {
    if (!requireUser('Sign in to RSVP and get reminders on your calendar.')) return;
    busy(btn, true);
    try {
      if (state.rsvps.get(e.id) === kind) {
        const { error } = await sb.from('phoenix_rsvps').delete().eq('event_id', e.id).eq('user_id', state.user.id);
        if (error) throw error; state.rsvps.delete(e.id); toast(kind === 'volunteer' ? 'Volunteer sign-up canceled' : 'Removed from your events');
      } else {
        const { error } = await sb.from('phoenix_rsvps').upsert({ event_id: e.id, user_id: state.user.id, kind }, { onConflict: 'event_id,user_id' });
        if (error) throw error; state.rsvps.set(e.id, kind);
        toast(kind === 'volunteer' ? 'Thank you for volunteering!' : 'You’re going!');
        if (!recall('pe.subscribed', false)) setTimeout(() => addToCalendarDialog(e), 400);
      }
      await viewEvent(e.id);
    } catch (err) { toast(errText(err)); busy(btn, false); }
  };
  $('#going').onclick = (ev) => rsvp('going', ev.currentTarget);
  $('#vol')?.addEventListener('click', (ev) => rsvp('volunteer', ev.currentTarget));
  $('#addcal').onclick = () => addToCalendarDialog(e);
  $('#share').onclick = async () => {
    const data = { title: e.title, text: `${e.title} · ${fmtShort(e.starts_at)} ${e.all_day ? '' : fmtTime(e.starts_at)}`.trim(), url: shareUrl(e) };
    try { if (navigator.share) await navigator.share(data); else { await navigator.clipboard.writeText(data.url); toast('Link copied'); } } catch { /* share canceled */ }
  };
  $('#del')?.addEventListener('click', async () => {
    if (!(await confirmDialog('Delete this event?', 'It will be removed from everyone’s calendar. This can’t be undone.', 'Delete event', true))) return;
    const { error } = await sb.from('phoenix_events').delete().eq('id', e.id);
    if (error) return toast(errText(error));
    if (e.poster_path) await sb.storage.from('phoenix-posters').remove([e.poster_path]);
    toast('Event deleted'); location.hash = '#/';
  });
  $('#flag')?.addEventListener('click', () => {
    if (!requireUser('Sign in to report a problem.')) return;
    openDialog(`<h2>Report a problem</h2><form id="flagf"><label class="field"><span>What’s wrong?</span>
      <textarea name="reason" maxlength="500" required placeholder="Wrong date, spam, canceled, inappropriate…"></textarea></label>
      <p class="error" id="flagerr" role="alert"></p><div class="row"><button class="btn" type="submit">Send report</button><button class="btn ghost" type="button" data-close>Cancel</button></div></form>`, (d) => {
      $('#flagf', d).addEventListener('submit', async (ev) => {
        ev.preventDefault(); const reason = ev.target.reason.value.trim();
        if (!reason) { $('#flagerr', d).textContent = 'Tell the moderators what’s wrong.'; return; }
        const { error } = await sb.from('phoenix_flags').insert({ event_id: e.id, user_id: state.user.id, reason });
        if (error) $('#flagerr', d).textContent = /duplicate/.test(error.message) ? 'You already reported this event. Moderators will review it.' : errText(error);
        else { d.close(); toast('Report sent to moderators'); }
      });
    });
  });
  document.querySelectorAll('[data-mod]').forEach((b) => b.onclick = async () => {
    const v = b.dataset.mod;
    const patch = v === 'ok' ? { reviewed_at: new Date().toISOString() } : { status: v };
    const { error } = await sb.from('phoenix_events').update(patch).eq('id', e.id);
    if (error) return toast(errText(error));
    toast(v === 'ok' ? 'Marked reviewed' : v === 'published' ? 'Restored' : v === 'hidden' ? 'Hidden' : 'Removed');
    viewEvent(e.id);
  });
  if ($('#roster')) {
    const { data, error: rerr } = await sb.rpc('phoenix_event_volunteers', { p_event: e.id });
    $('#roster').innerHTML = `<h3>Volunteers</h3>${rerr ? `<p class="error">${h(errText(rerr))}</p>` : data.length
      ? `<ul class="list-plain">${data.map((v) => `<li>@${h(v.username || 'unknown')} <span class="muted small">signed up ${h(fmtShort(v.signed_up_at))}</span></li>`).join('')}</ul>`
      : '<p class="muted">No volunteers yet. Share the event to spread the word.</p>'}`;
  }
}

/* ---------- add / edit ---------- */
function localDate(iso) { return iso ? dayKey(iso) : ''; }
function localTime(iso) { if (!iso) return ''; const d = new Date(iso); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; }

function eventForm(e = {}, note = '') {
  const tags = e.tags || [];
  return `<form class="event" id="evf" novalidate>
    ${note ? `<p class="panel">${note}</p>` : ''}
    <label class="field"><span>Event name</span><input type="text" name="title" maxlength="140" required value="${h(e.title)}"></label>
    <label class="field"><span>Type of event</span><select name="category">${CATS.map((c) => `<option value="${c.key}" ${(e.category || 'community') === c.key ? 'selected' : ''}>${h(c.label)}</option>`).join('')}</select></label>
    <div class="grid2">
      <label class="field"><span>Date</span><input type="date" name="date" required value="${h(localDate(e.starts_at))}"></label>
      <label class="field"><span>End date <span class="muted small">(optional)</span></span><input type="date" name="enddate" value="${h(e.ends_at && localDate(e.ends_at) !== localDate(e.starts_at) ? localDate(e.ends_at) : '')}"></label>
    </div>
    <label class="check"><input type="checkbox" name="allday" ${e.all_day ? 'checked' : ''}> All day</label>
    <div class="grid2" id="times">
      <label class="field"><span>Starts</span><input type="time" name="start" value="${h(e.all_day ? '' : localTime(e.starts_at))}"></label>
      <label class="field"><span>Ends</span><input type="time" name="end" value="${h(e.all_day ? '' : localTime(e.ends_at))}"></label>
    </div>
    <label class="field"><span>Place name</span><input type="text" name="location_name" maxlength="200" placeholder="Centennial Park" value="${h(e.location_name)}"></label>
    <label class="field"><span>Address</span><input type="text" name="address" maxlength="300" placeholder="Street, city" value="${h(e.address)}" autocomplete="street-address"></label>
    <label class="field"><span>Hosted by</span><input type="text" name="organizer" maxlength="140" placeholder="Columbia Association" value="${h(e.organizer)}"></label>
    <label class="field"><span>Cost</span><select name="cost">${COSTS.map(([k, l]) => `<option value="${k}" ${(e.cost || 'free') === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    <fieldset class="field" style="border:0;padding:0;margin:0 0 14px"><legend style="font-weight:700;margin-bottom:6px">Good for</legend>
      <div class="chips wrap">${TAGS.map(([k, l]) => `<label class="chip"><input type="checkbox" name="tags" value="${k}" ${tags.includes(k) ? 'checked' : ''} style="accent-color:var(--ink)"> ${l}</label>`).join('')}</div></fieldset>
    <label class="field"><span>Link <span class="muted small">(optional)</span></span><input type="url" name="url" maxlength="500" placeholder="https://" value="${h(e.url)}"></label>
    <label class="field"><span>Details</span><textarea name="description" maxlength="5000">${h(e.description)}</textarea></label>
    ${canTpc() ? `<div class="panel"><label class="check"><input type="checkbox" name="is_tpc" ${e.is_tpc ? 'checked' : ''}> Official Phoenix Catalyst volunteer event</label>
      <label class="field"><span>Volunteer spots <span class="muted small">(blank for unlimited)</span></span><input type="number" name="slots" min="1" max="1000" value="${h(e.volunteer_slots)}"></label></div>` : ''}
    <p class="error" id="formerr" role="alert"></p>
    <div class="row"><button class="btn" type="submit">${e.id ? 'Save changes' : 'Post event'}</button><a class="btn ghost" href="${e.id ? `#/event/${e.id}` : '#/'}">Cancel</a></div>
  </form>`;
}

async function geocode(q) {
  if (!q) return null;
  try {
    const u = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=us&q=${encodeURIComponent(q)}`;
    const r = await fetch(u, { headers: { 'Accept-Language': 'en' } });
    const [hit] = await r.json();
    return hit ? { lat: Number(hit.lat), lng: Number(hit.lon) } : null;
  } catch { return null; }
}

function wireEventForm(existing, extras = {}) {
  const f = $('#evf'), err = $('#formerr');
  const syncTimes = () => $('#times').classList.toggle('hidden', f.allday.checked);
  f.allday.onchange = syncTimes; syncTimes();
  f.addEventListener('submit', async (ev) => {
    ev.preventDefault(); err.textContent = '';
    const btn = f.querySelector('[type=submit]');
    const title = f.title.value.trim(), date = f.date.value;
    if (title.length < 2) { err.textContent = 'Add an event name.'; f.title.focus(); return; }
    if (!date) { err.textContent = 'Add the date.'; f.date.focus(); return; }
    const allDay = f.allday.checked || !f.start.value;
    const start = new Date(`${date}T${allDay ? '00:00' : f.start.value}`);
    let end = null;
    const endDate = f.enddate.value || date;
    if (allDay) { if (f.enddate.value) end = new Date(`${endDate}T00:00`); }
    else if (f.end.value) { end = new Date(`${endDate}T${f.end.value}`); if (end <= start && !f.enddate.value) end = addDays(end, 1); }
    if (end && end < start) { err.textContent = 'The end is before the start.'; return; }
    let url = f.url.value.trim();
    if (url && !/^https?:\/\//i.test(url)) url = `https://${url}`;
    const row = {
      title, category: f.category.value, starts_at: start.toISOString(), ends_at: end ? end.toISOString() : null, all_day: allDay,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York',
      location_name: f.location_name.value.trim() || null, address: f.address.value.trim() || null, organizer: f.organizer.value.trim() || null,
      cost: f.cost.value, tags: [...f.querySelectorAll('[name=tags]:checked')].map((x) => x.value), url: url || null,
      description: f.description.value.trim() || null,
    };
    if (canTpc()) { row.is_tpc = !!f.is_tpc?.checked; row.volunteer_slots = f.slots?.value ? Number(f.slots.value) : null; }
    busy(btn, true, 'Saving…');
    try {
      const where = row.address || row.location_name;
      const placeChanged = !existing || existing.address !== row.address || existing.location_name !== row.location_name;
      let unplaced = false;
      if (where && placeChanged) {
        const g = await geocode(row.address ? [row.address, row.location_name].filter(Boolean).join(', ') : row.location_name) || (row.address && await geocode(row.address));
        row.lat = g?.lat ?? null; row.lng = g?.lng ?? null; unplaced = !g;
      } else if (!where) { row.lat = null; row.lng = null; }
      if (extras.poster) {
        busy(btn, true, 'Uploading poster…');
        const path = `${state.user.id}/${crypto.randomUUID()}.jpg`;
        const { error: upErr } = await sb.storage.from('phoenix-posters').upload(path, extras.poster, { contentType: 'image/jpeg' });
        if (upErr) throw upErr;
        row.poster_path = path; row.source = 'poster';
      }
      let saved;
      if (existing) {
        const { data, error } = await sb.from('phoenix_events').update(row).eq('id', existing.id).select('id').single();
        if (error) throw error; saved = data;
      } else {
        const { data, error } = await sb.from('phoenix_events').insert(row).select('id').single();
        if (error) { if (row.poster_path) await sb.storage.from('phoenix-posters').remove([row.poster_path]); throw error; }
        saved = data;
      }
      toast(unplaced ? `${existing ? 'Saved' : 'Posted'}. We couldn’t find that place on the map.` : existing ? 'Saved' : 'Posted! Thanks for sharing.');
      location.hash = `#/event/${saved.id}`;
    } catch (e2) { err.textContent = errText(e2); busy(btn, false); }
  });
}

async function viewAdd() {
  const root = main();
  if (!state.user) {
    root.innerHTML = `<div class="empty detail"><h2>Share an event</h2><p>Sign in to post events. One free account works across Dragonfly apps.</p><button class="btn" id="si">Sign in or create an account</button></div>`;
    $('#si').onclick = () => authDialog('Sign in to add events.');
    return;
  }
  root.innerHTML = `<div class="detail"><h1>Add an event</h1>
    <p class="muted" style="margin-top:8px">Saw a flyer? Snap it and we’ll fill in what we can. Events go live right away. Volunteer moderators look things over.</p>
    <div class="choose">
      <label><input type="file" accept="image/*" capture="environment" id="snap"><b>Snap a poster</b><span class="muted">Use your camera</span></label>
      <label><input type="file" accept="image/*" id="pick"><b>Upload a photo</b><span class="muted">Pick a flyer from your photos</span></label>
      <button type="button" id="manual"><b>Type it in</b><span class="muted">Yoga in the park, a food drive, movie night…</span></button>
    </div><div id="work"></div></div>`;
  const work = $('#work');
  $('#manual').onclick = () => { work.innerHTML = eventForm(); wireEventForm(null); work.scrollIntoView({ behavior: 'smooth' }); };
  const onFile = async (file) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) { toast('Choose a photo.'); return; }
    const poster = await compressImage(file).catch(() => null);
    if (!poster) { toast('That photo couldn’t be opened. Try another.'); return; }
    const preview = URL.createObjectURL(poster);
    work.innerHTML = `<div class="scanprev"><img src="${preview}" alt="Your poster photo"><div><b>Reading the poster…</b>
      <p class="small muted">This runs on your phone and is free. The first scan downloads the reader, so it can take a moment.</p><progress id="prog" max="1" value="0"></progress></div></div>`;
    work.scrollIntoView({ behavior: 'smooth' });
    let found = {};
    try {
      found = await readPoster(poster, (p) => { const pr = $('#prog'); if (pr) pr.value = p; });
    } catch (e) { toast(errText(e)); }
    const pre = {
      title: found.title, category: found.category, location_name: found.location_name, address: found.address, url: found.url, cost: found.cost,
      description: found.description, all_day: !!found.allDay,
      starts_at: found.start ? found.start.toISOString() : null, ends_at: found.end ? found.end.toISOString() : null,
    };
    const got = [found.title && 'name', found.start && 'date', found.location_name || found.address ? 'place' : ''].filter(Boolean);
    work.innerHTML = `<div class="scanprev"><img src="${preview}" alt="Your poster photo"><div><b>${got.length ? `Found the ${got.join(', ')}` : 'We couldn’t read much from this one'}</b>
      <p class="small muted">Check everything below. Posters can be tricky to read.</p></div></div>` + eventForm(pre);
    wireEventForm(null, { poster });
  };
  $('#snap').onchange = (e) => onFile(e.target.files[0]);
  $('#pick').onchange = (e) => onFile(e.target.files[0]);
}

async function viewEdit(id) {
  if (!requireUser('Sign in to edit events.')) { location.hash = '#/'; return; }
  const { data: e } = await sb.from('phoenix_events').select('*').eq('id', id).maybeSingle();
  if (!e || (e.created_by !== state.user.id && !isMod())) { main().innerHTML = '<div class="empty detail"><h2>You can’t edit this event</h2><a class="btn" href="#/">Back to calendar</a></div>'; return; }
  main().innerHTML = `<div class="detail"><h1>Edit event</h1>${eventForm(e)}</div>`;
  wireEventForm(e);
}

/* ---------- map ---------- */
let leafletLoading;
function loadLeaflet() {
  if (window.L) return Promise.resolve();
  leafletLoading ??= new Promise((resolve, reject) => {
    const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css'; document.head.appendChild(css);
    const s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js';
    s.onload = resolve; s.onerror = () => { leafletLoading = null; reject(new Error('The map couldn’t load. Check your connection.')); }; document.head.appendChild(s);
  });
  return leafletLoading;
}
async function viewMap() {
  const root = main();
  root.innerHTML = `<div id="mapfilters"></div><div id="map" role="region" aria-label="Map of events"></div><p class="small muted" id="mapnote"></p>`;
  try { await loadLeaflet(); } catch (e) { root.innerHTML = `<div class="empty"><h2>Map unavailable</h2><p>${h(errText(e))}</p></div>`; return; }
  const map = L.map('map', { scrollWheelZoom: true }).setView([HOME.lat, HOME.lng], 12);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' }).addTo(map);
  const layer = L.layerGroup().addTo(map);
  const draw = async () => {
    $('#mapfilters').innerHTML = filtersHtml();
    wireFilters($('#mapfilters'), draw);
    let events = [];
    try { const [a, b] = rangeFor(state.filters); events = await search(a, b, 500); } catch (e) { toast(errText(e)); }
    layer.clearLayers();
    const placed = events.filter((e) => e.lat != null && e.lng != null);
    for (const e of placed) {
      const icon = L.divIcon({ className: '', html: `<div class="pin" data-cat="${h(e.category)}"></div>`, iconSize: [22, 22], iconAnchor: [11, 22] });
      L.marker([e.lat, e.lng], { icon, title: e.title }).addTo(layer)
        .bindPopup(`<b>${h(e.title)}</b><br>${h(fmtShort(e.starts_at))} · ${h(whenText(e))}<br>${h(e.location_name || '')}<br><a href="#/event/${e.id}">See details</a>`);
    }
    if (state.loc?.mine) L.circleMarker([state.loc.lat, state.loc.lng], { radius: 7, color: '#fff', weight: 2, fillColor: '#5b4bc4', fillOpacity: 1 }).addTo(layer).bindPopup('You');
    if (placed.length) map.fitBounds(L.latLngBounds(placed.map((e) => [e.lat, e.lng])).pad(0.2), { maxZoom: 14 });
    const missing = events.length - placed.length;
    $('#mapnote').textContent = `${placed.length} event${placed.length === 1 ? '' : 's'} on the map${missing ? `, ${missing} without an address` : ''}.`;
  };
  await draw();
}

/* ---------- my events ---------- */
async function viewMine() {
  const root = main();
  const publicFeeds = `<div class="panel"><h2>Community calendars anyone can follow</h2>
    <h3 style="margin:12px 0 6px">All community events</h3>${subscribeLinks(`${CALENDAR_FN}?feed=all`, 'Phoenix Catalyst Community Events')}
    <h3 style="margin:12px 0 6px">Phoenix Catalyst volunteer events</h3>${subscribeLinks(`${CALENDAR_FN}?feed=tpc`, 'The Phoenix Catalyst Volunteer Events')}</div>`;
  if (!state.user) {
    root.innerHTML = `<div class="detail"><h1>My events</h1><div class="empty" style="margin-top:16px"><h2>Keep track of what you’re going to</h2>
      <p>Sign in to RSVP, volunteer, and have your events show up in your phone’s calendar.</p><button class="btn" id="si">Sign in</button></div>${publicFeeds}</div>`;
    $('#si').onclick = () => authDialog(); wireCopy(root); return;
  }
  root.innerHTML = '<p class="muted pad">Loading…</p>';
  const [rs, posted, tok] = await Promise.all([
    sb.from('phoenix_rsvps').select('kind, phoenix_events(*)').eq('user_id', state.user.id),
    sb.from('phoenix_events').select('*').eq('created_by', state.user.id).order('starts_at', { ascending: false }).limit(100),
    sb.rpc('phoenix_calendar_token'),
  ]);
  const now = dayKey(new Date());
  const upcoming = (rs.data || []).map((r) => r.phoenix_events).filter((e) => e && dayKey(e.ends_at || e.starts_at) >= now)
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const feed = tok.data ? `${CALENDAR_FN}?token=${tok.data}` : '';
  root.innerHTML = `<div class="detail"><h1>My events</h1>
    ${feed ? `<div class="panel"><h2>Put your events on your calendar</h2>
      <p class="muted">Subscribe once. Everything you mark Going or Volunteer appears in your calendar automatically and stays up to date.</p>
      ${subscribeLinks(feed, 'My Phoenix Catalyst Events')}
      <p class="small muted" style="margin-top:10px">This link is private to you. <button type="button" class="btn small quiet" id="rotate">Make a new link</button></p></div>` : ''}
    <h2 style="margin:20px 0 10px">Going and volunteering</h2>
    ${upcoming.length ? upcoming.map(evRow).join('') : '<div class="empty"><p>No upcoming plans yet.</p><a class="btn" href="#/">Find something to do</a></div>'}
    <h2 style="margin:20px 0 10px">Events you posted</h2>
    ${(posted.data || []).length ? posted.data.map(evRow).join('') : '<p class="muted">You haven’t posted any events yet. <a href="#/add">Add one</a>.</p>'}
    ${isMod() ? '<p style="margin-top:16px"><a class="btn quiet" href="#/moderate">Review community posts</a></p>' : ''}
    ${publicFeeds}</div>`;
  wireCopy(root);
  $('#rotate')?.addEventListener('click', async () => {
    if (!(await confirmDialog('Make a new calendar link?', 'Your old link will stop working. You’ll need to subscribe again with the new one.', 'Make new link'))) return;
    const { error } = await sb.rpc('phoenix_calendar_token', { rotate: true });
    if (error) toast(errText(error)); else { store('pe.subscribed', false); toast('New link ready'); viewMine(); }
  });
}

/* ---------- moderation & admin ---------- */
async function viewModerate() {
  const root = main();
  if (!isMod()) { root.innerHTML = '<div class="empty detail"><h2>For volunteer moderators</h2><p>Ask a Phoenix Catalyst admin if you’d like to help review posts.</p></div>'; return; }
  root.innerHTML = '<p class="muted pad">Loading…</p>';
  const [q, flags] = await Promise.all([
    sb.from('phoenix_events').select('*').is('reviewed_at', null).order('created_at', { ascending: false }).limit(100),
    sb.rpc('phoenix_open_flags'),
  ]);
  root.innerHTML = `<div class="detail"><h1>Review posts</h1>
    <p class="muted" style="margin-top:8px">Community posts go live right away. Check that each one is real, local, and kind. Hide anything unclear and remove spam or harmful posts.</p>
    <h2 style="margin:20px 0 10px">Reports from users (${(flags.data || []).length})</h2>
    ${(flags.data || []).length ? `<ul class="list-plain">${flags.data.map((f) => `<li><a href="#/event/${f.event_id}"><b>${h(f.title)}</b></a>
      <br><span class="small">“${h(f.reason)}” by @${h(f.flagged_by || 'unknown')}, ${h(fmtShort(f.created_at))}</span>
      <br><button class="btn small quiet" data-resolve="${f.flag_id}">Mark handled</button></li>`).join('')}</ul>` : '<p class="muted">No open reports.</p>'}
    <h2 style="margin:20px 0 10px">Not reviewed yet (${(q.data || []).length})</h2>
    ${(q.data || []).length ? q.data.map((e) => `${evRow(e)}<div class="row" style="margin:-2px 0 14px">
      <button class="btn small" data-ok="${e.id}">Looks good</button><button class="btn small quiet" data-st="${e.id}" data-v="hidden">Hide</button>
      <button class="btn small danger" data-st="${e.id}" data-v="removed">Remove</button><span class="small muted">by @${h(e.created_by_username || '?')}${e.status !== 'published' ? ` · ${h(e.status)}` : ''}</span></div>`).join('')
      : '<p class="muted">You’re all caught up.</p>'}</div>`;
  root.querySelectorAll('[data-resolve]').forEach((b) => b.onclick = async () => {
    const { error } = await sb.from('phoenix_flags').update({ resolved_at: new Date().toISOString() }).eq('id', b.dataset.resolve);
    if (error) toast(errText(error)); else { toast('Report handled'); viewModerate(); }
  });
  root.querySelectorAll('[data-ok]').forEach((b) => b.onclick = async () => {
    const { error } = await sb.from('phoenix_events').update({ reviewed_at: new Date().toISOString() }).eq('id', b.dataset.ok);
    if (error) toast(errText(error)); else { toast('Marked reviewed'); viewModerate(); }
  });
  root.querySelectorAll('[data-st]').forEach((b) => b.onclick = async () => {
    const { error } = await sb.from('phoenix_events').update({ status: b.dataset.v }).eq('id', b.dataset.st);
    if (error) toast(errText(error)); else { toast(b.dataset.v === 'hidden' ? 'Hidden' : 'Removed'); viewModerate(); }
  });
}

async function viewAdmin() {
  const root = main();
  if (state.role !== 'admin') { root.innerHTML = '<div class="empty detail"><h2>Admins only</h2></div>'; return; }
  const { data, error } = await sb.rpc('phoenix_list_roles');
  root.innerHTML = `<div class="detail"><h1>Team roles</h1>
    <p class="muted" style="margin-top:8px">Moderators review community posts. Organizers post official volunteer events and see volunteer lists. Admins can do everything.</p>
    <div class="panel"><form id="rolef" class="row"><input type="text" name="u" placeholder="Username" required style="flex:1;min-width:160px" autocapitalize="none">
      <select name="r" style="width:auto"><option value="moderator">Moderator</option><option value="organizer">Organizer</option><option value="admin">Admin</option><option value="none">No role</option></select>
      <button class="btn" type="submit">Save role</button></form><p class="error" id="roleerr" role="alert"></p></div>
    ${error ? `<p class="error">${h(errText(error))}</p>` : `<ul class="list-plain">${data.map((r) => `<li>@${h(r.username)} · ${h(r.role)}</li>`).join('')}</ul>`}</div>`;
  $('#rolef').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const { error: e2 } = await sb.rpc('phoenix_set_role', { p_username: ev.target.u.value.trim(), p_role: ev.target.r.value });
    if (e2) $('#roleerr').textContent = errText(e2); else { toast('Role saved'); viewAdmin(); }
  });
}

/* ---------- about ---------- */
function viewAbout() {
  const links = Object.entries(DONATE_LINKS).filter(([, u]) => u);
  main().innerHTML = `<div class="detail">
    <h1>The Phoenix Catalyst</h1>
    <p style="margin-top:12px;font-size:1.1rem">We strengthen mental, physical, emotional, and environmental well-being through community-driven events. Bringing color back into the world one community at a time.</p>
    <p class="muted">We picture neighborhoods where people know and support one another, local spaces thrive, and home is where you truly thrive.</p>
    <div class="pillars">${CATS.filter((c) => c.pillar).map((c) => `<div class="pillar" data-cat="${c.key}"><h3>${h(c.pillar)}</h3><p class="small" style="margin:6px 0 0">${h({
      environmental: 'Cleanups, tree planting, trail care and nature outings that keep our shared spaces beautiful.',
      community: 'Food and donation drives, care visits, potlucks and swaps that rebuild ties between neighbors.',
      wellness: 'Walking and running groups, races, hikes and yoga that make movement accessible to everyone.',
      mental: 'Meditation, sound baths, journaling circles and awareness campaigns that support emotional resilience.' }[c.key])}</p></div>`).join('')}</div>
    <div class="row"><a class="btn" href="#/" id="seevol">See volunteer events</a><a class="btn ghost" href="#/add">Share a community event</a></div>
    <div class="panel" style="margin-top:20px"><h2>Support our work</h2>
      <p class="muted">The Phoenix Catalyst is a Maryland 501(c)(3) nonprofit. This app is free for everyone, and donations keep it running.</p>
      ${links.length ? `<div class="donate">${links.map(([k, u]) => `<a class="btn ${k === 'custom' ? 'ghost' : ''}" target="_blank" rel="noopener" href="${h(u)}">${k === 'custom' ? 'Other amount' : `$${k}`}</a>`).join('')}</div>`
        : '<p><b>Online donations are opening soon.</b></p>'}
    </div>
    <div class="panel"><h2>How posting works</h2>
      <p>Anyone with an account can post events, and they go live right away. Volunteer moderators review posts and remove anything that isn’t a real community event. If something looks wrong, open the event and choose Report a problem.</p></div>
  </div>`;
  $('#seevol').onclick = () => { Object.assign(state.filters, { tpc: true, when: 'upcoming' }); state.day = null; saveFilters(); };
}

/* ---------- router ---------- */
async function route() {
  const hash = location.hash.replace(/^#\/?/, '');
  const [page, id] = hash.split('/');
  document.title = 'Phoenix Community Calendar';
  const tab = { '': 'calendar', map: 'map', add: 'add', mine: 'mine', about: 'about' }[page] ?? '';
  document.querySelectorAll('.tabs a').forEach((a) => { if (a.dataset.tab === tab) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  window.scrollTo(0, 0);
  try {
    if (page === 'event' && id) await viewEvent(id);
    else if (page === 'edit' && id) await viewEdit(id);
    else if (page === 'map') await viewMap();
    else if (page === 'add') await viewAdd();
    else if (page === 'mine') await viewMine();
    else if (page === 'moderate') await viewModerate();
    else if (page === 'admin') await viewAdmin();
    else if (page === 'about') viewAbout();
    else await viewCalendar();
  } catch (e) {
    main().innerHTML = `<div class="empty"><h2>Something went wrong</h2><p>${h(errText(e))}</p><button class="btn" onclick="location.reload()">Reload</button></div>`;
  }
  if (page) main().focus({ preventScroll: true });
}

window.addEventListener('hashchange', route);
let lastUser;
sb.auth.onAuthStateChange((event, session) => {
  if (event === 'PASSWORD_RECOVERY') setTimeout(newPasswordDialog, 0);
  const uid = session?.user?.id ?? null;
  if (uid !== lastUser) { lastUser = uid; setTimeout(async () => { await loadMe(); route(); }, 0); }
});
await loadMe();
lastUser = state.user?.id ?? null;
route();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
