import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.0';
import { SUPABASE_URL, SUPABASE_KEY, CALENDAR_FN, USERNAME_LOGIN_FN, HOME, CAMPAIGN } from './config.js?v=26';
import { phase, parseProgress, progressUrlAllowed, bannerHtml } from './campaign.js?v=26';
import { readPoster, compressImage } from './ocr.js?v=26';
import { FAQ, RULES } from './faq.js?v=26';

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
  filters: loadFilters(), loc: null, rsvps: new Map(), blocked: new Set(),
};

/* ---------- small helpers ---------- */
const $ = (sel, root = document) => root.querySelector(sel);
const h = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const main = () => $('#main');
const isAdmin = () => ['owner', 'admin'].includes(state.role);
const isMod = () => ['owner', 'admin', 'moderator'].includes(state.role);
const canTpc = () => ['owner', 'admin', 'organizer'].includes(state.role);
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
// Every visit starts on Everything; only the distance setting is remembered
function loadFilters() { const r = recall('pe.filters', {}); return { when: 'upcoming', cats: [], tags: [], cost: [], tpc: false, q: '', radius: r.radius ?? null, near: r.near ?? null }; }
function saveFilters() { store('pe.filters', state.filters); }

let toastTimer;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 3600);
}
const FRIENDLY = {
  phoenix_banned: 'Your account can’t post, comment or RSVP right now because a moderator suspended it. Reply to any Phoenix email if you think this is a mistake.',
  phoenix_cannot_ban_leader: 'Leaders can only be suspended by someone above them, and the owner can’t be suspended.',
  phoenix_cannot_ban_self: 'You can’t suspend yourself.',
  phoenix_owner_locked: 'The owner’s role can’t be changed.',
  phoenix_owner_only: 'Only the owner can make or remove admins.',
  phoenix_tpc_claim: 'Only Phoenix Catalyst leaders can post events hosted by The Phoenix Catalyst. Remove that from the host, name or description.',
  phoenix_applications_one_open: 'You already have an application waiting for review.',
  phoenix_application_closed: 'That application was already reviewed.',
  phoenix_comment_rate_limited: 'You’re commenting a lot. Take a short break and try again.',
  phoenix_comment_unavailable: 'That comment is no longer available.',
  phoenix_not_allowed: 'You don’t have permission to do that.',
  resume_too_big: 'That file is over 10 MB. Try a PDF version.',
  duplicate_event: 'This event is already on the calendar. Search for it instead of posting it again.',
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
  email_already_registered: 'That email already has a Dragonfly account. Choose “I have an account” and sign in with it.',
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

/* ---------- safety: blocking and suspending ---------- */
async function loadBlocks() {
  if (!state.user) { state.blocked = new Set(); return; }
  const { data } = await sb.from('phoenix_blocks').select('blocked');
  state.blocked = new Set((data || []).map((r) => r.blocked));
}
const notBlocked = (list) => (list || []).filter((e) => !state.blocked?.has(e.created_by));
async function blockPerson(userId, username, done) {
  const name = `@${username || 'this person'}`;
  if (!(await confirmDialog(`Block ${name}?`, 'You won’t see their posts or comments anymore. They aren’t told. You can unblock them from your account.', 'Block', true))) return;
  const { error } = await sb.from('phoenix_blocks').insert({ blocked: userId });
  if (error && !/duplicate key/.test(error.message)) return toast(errText(error));
  state.blocked.add(userId); toast(`${name} blocked`); done?.();
}
function suspendDialog(username, done) {
  if (!username) return;
  openDialog(`<h2>Suspend @${h(username)}?</h2>
    <p>They won’t be able to post, comment, RSVP, report or apply, and their current posts and comments are hidden. You can lift it from Review posts.</p>
    <div class="row"><button class="btn small" data-days="7">7 days</button><button class="btn small" data-days="30">30 days</button><button class="btn small danger" data-days="">Until lifted</button><button class="btn small ghost" data-close>Cancel</button></div>`, (d) => {
    d.querySelectorAll('[data-days]').forEach((b) => b.addEventListener('click', async () => {
      const days = b.dataset.days ? Number(b.dataset.days) : null;
      const { error } = await sb.rpc('phoenix_ban_user', { p_username: username, p_reason: 'Broke the community guidelines', p_days: days, p_hide_content: true });
      d.close();
      if (error) return toast(errText(error));
      toast(`@${username} suspended${days ? ` for ${days} days` : ''}. Their posts and comments are hidden.`); done?.();
    }));
  });
}

/* ---------- accounts (shared Dragonfly account system) ---------- */
async function loadMe() {
  const { data: { session } } = await sb.auth.getSession();
  state.user = session?.user ?? null;
  state.username = null; state.role = null; state.rsvps = new Map(); state.avatar = null; state.blocked = new Set();
  if (state.user) {
    const [p, r, rs] = await Promise.all([
      sb.from('dragonfly_profiles').select('username').eq('user_id', state.user.id).maybeSingle(),
      sb.from('phoenix_roles').select('role').eq('user_id', state.user.id).maybeSingle(),
      sb.from('phoenix_rsvps').select('event_id,kind').eq('user_id', state.user.id),
    ]);
    state.username = p.data?.username ?? state.user.email;
    state.avatar = await avatarUrl(state.user.id);
    state.role = r.data?.role ?? null;
    (rs.data ?? []).forEach((x) => state.rsvps.set(x.event_id, x.kind));
    await loadBlocks();
  }
  renderAccount();
}
/* ---------- shared Dragonfly account (same picture, email and password in every Dragonfly app) ---------- */
const AVATAR_BUCKET = 'dragonfly-avatars';
const avatarPath = (uid) => `${uid}/avatar.jpg`;
async function avatarUrl(uid) {
  const { data } = await sb.storage.from(AVATAR_BUCKET).createSignedUrl(avatarPath(uid), 3600);
  if (!data?.signedUrl) return null;
  const head = await fetch(data.signedUrl, { method: 'HEAD' }).catch(() => null);
  return head?.ok ? data.signedUrl : null;
}
const avatarHtml = (size) => (state.avatar
  ? `<img src="${h(state.avatar)}" alt="" width="${size}" height="${size}" style="width:${size}px;height:${size}px;border-radius:50%;object-fit:cover">`
  : `<span style="font-size:${Math.round(size * 0.42)}px">${h((state.username || '?').replace(/^@/, '').charAt(0).toUpperCase())}</span>`);
// Square-crop to 256px JPEG under the bucket's 30 KB limit, like the Uploader
async function avatarBlob(file) {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const side = Math.min(bmp.width, bmp.height);
  const c = document.createElement('canvas'); c.width = 256; c.height = 256;
  c.getContext('2d').drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, 256, 256);
  for (const q of [0.85, 0.75, 0.65, 0.55, 0.45, 0.35]) {
    const b = await new Promise((r) => c.toBlob(r, 'image/jpeg', q));
    if (b && b.size <= 30000) return b;
  }
  throw new Error('That picture is too detailed to save. Try another one.');
}
async function reauth(password) {
  const { error } = await sb.auth.signInWithPassword({ email: state.user.email, password });
  if (error) throw new Error('Your current password didn’t match.');
}
function codeDialog({ title, body, type, email, done }) {
  openDialog(`<h2>${h(title)}</h2><p>${body}</p><form id="codef"><label class="field"><span>Code from the email</span><input type="text" name="code" inputmode="numeric" autocomplete="one-time-code" required></label>
    <p class="error" id="codeerr" role="alert"></p><div class="row"><button class="btn" type="submit">Confirm</button><button class="btn ghost" type="button" data-close>Later</button></div></form>`, (d) => {
    $('#codef', d).addEventListener('submit', async (ev) => {
      ev.preventDefault(); const btn = ev.target.querySelector('[type=submit]'); busy(btn, true);
      const { error } = await sb.auth.verifyOtp({ email, token: ev.target.code.value.trim(), type });
      busy(btn, false);
      if (error) { $('#codeerr', d).textContent = 'That code didn’t work. Check the newest email and try again.'; return; }
      d.close(); done?.();
    });
  });
}
function renderAccount() {
  const el = $('#account');
  if (!state.user) { el.innerHTML = '<button class="btn small" id="signin">Sign in</button>'; $('#signin').onclick = () => authDialog(); return; }
  el.innerHTML = `<button class="avatar" id="me" aria-label="Your account, @${h(state.username)}" style="overflow:hidden;padding:0">${avatarHtml(38)}</button>`;
  $('#me').onclick = accountDialog;
}
function accountDialog() {
  const verified = !!state.user.email_confirmed_at;
  openDialog(`<div style="text-align:center">
      <button type="button" id="pic" class="avatar" style="width:96px;height:96px;margin:0 auto;overflow:hidden;padding:0" aria-label="Change profile picture">${avatarHtml(96)}</button>
      <input type="file" id="picfile" accept="image/*" class="hidden">
      <h2 style="margin:12px 0 2px">${h(state.username)}</h2><p class="muted small" style="margin:0">${h(state.user.email)}</p></div>
    ${verified ? '' : `<p class="panel"><b>Your email isn’t confirmed yet.</b> <button class="btn small quiet" id="resend" type="button">Send a new code</button></p>`}
    <div class="row" style="justify-content:center;margin:10px 0">
      <button class="btn small quiet" id="picbtn" type="button">Change picture</button>
      ${state.avatar ? '<button class="btn small quiet" id="picdel" type="button">Remove picture</button>' : ''}
      <button class="btn small quiet" id="chemail" type="button">Change email</button>
      <button class="btn small quiet" id="chpw" type="button">Change password</button>
    </div>
    <form id="acctf" class="hidden"></form>
    <p class="error" id="accterr" role="alert"></p>
    <div class="row" style="justify-content:center">
      <a class="btn small quiet" href="#/mine" data-close>My events</a>
      ${isMod() ? '<a class="btn small quiet" href="#/moderate" data-close>Review posts</a>' : ''}
      ${isAdmin() ? '<a class="btn small quiet" href="#/admin" data-close>Team roles</a><a class="btn small quiet" href="#/applications" data-close>Applications</a>' : ''}${canTpc() ? '<a class="btn small quiet" href="#/sources" data-close>Local organizations</a>' : ''}
      <button class="btn small ghost" id="signout" type="button">Sign out</button>
    </div>
    <details class="panel" id="blockedwrap"><summary><b>Blocked people</b></summary><div id="blockedlist" class="small muted">Loading…</div></details>
    <p class="small muted" style="text-align:center;margin-top:12px">Signed-in devices, data export and account deletion are in the Phoenix and Uploader apps.</p>`, (d) => {
    const paintBlocked = async () => {
      const box = $('#blockedlist', d);
      const ids = [...(state.blocked || [])];
      if (!ids.length) { box.textContent = 'You haven’t blocked anyone.'; return; }
      const { data } = await sb.from('dragonfly_profiles').select('user_id,username').in('user_id', ids);
      const names = new Map((data || []).map((x) => [x.user_id, x.username]));
      box.innerHTML = ids.map((id) => `<div class="row" style="justify-content:space-between;align-items:center"><b>@${h(names.get(id) || 'unknown')}</b><button type="button" class="btn small quiet" data-unblock="${id}">Unblock</button></div>`).join('');
      box.querySelectorAll('[data-unblock]').forEach((b) => b.onclick = async () => {
        const { error } = await sb.from('phoenix_blocks').delete().eq('blocked', b.dataset.unblock);
        if (error) return toast(errText(error));
        state.blocked.delete(b.dataset.unblock); toast('Unblocked'); paintBlocked(); route();
      });
    };
    $('#blockedwrap', d).addEventListener('toggle', (ev) => { if (ev.target.open) paintBlocked(); });
    const err = $('#accterr', d), form = $('#acctf', d);
    const fail = (e) => { err.textContent = errText(e); };
    const pick = () => $('#picfile', d).click();
    $('#pic', d).onclick = pick; $('#picbtn', d).onclick = pick;
    $('#picfile', d).onchange = async (e) => {
      const file = e.target.files[0]; if (!file) return;
      try {
        const blob = await avatarBlob(file);
        const { error } = await sb.storage.from(AVATAR_BUCKET).upload(avatarPath(state.user.id), blob, { contentType: 'image/jpeg', upsert: true });
        if (error) throw error;
        state.avatar = await avatarUrl(state.user.id); renderAccount(); accountDialog(); toast('Picture updated');
      } catch (x) { fail(x); }
    };
    $('#picdel', d)?.addEventListener('click', async () => {
      const { error } = await sb.storage.from(AVATAR_BUCKET).remove([avatarPath(state.user.id)]);
      if (error) return fail(error);
      state.avatar = null; renderAccount(); accountDialog(); toast('Picture removed');
    });
    $('#resend', d)?.addEventListener('click', async () => {
      const { error } = await sb.auth.resend({ type: 'signup', email: state.user.email });
      if (error) return fail(error);
      codeDialog({ title: 'Confirm your email', body: `Enter the code sent to <b>${h(state.user.email)}</b>.`, type: 'signup', email: state.user.email, done: () => { toast('Email confirmed'); loadMe(); } });
    });
    $('#chemail', d).onclick = () => {
      form.classList.remove('hidden'); err.textContent = '';
      form.innerHTML = `<label class="field"><span>New email</span><input type="email" name="email" required autocomplete="email"></label>
        <label class="field"><span>Current password</span><input type="password" name="pw" required autocomplete="current-password"></label><button class="btn" type="submit">Change email</button>`;
      form.onsubmit = async (ev) => {
        ev.preventDefault(); const next = form.email.value.trim();
        try { await reauth(form.pw.value); const { error } = await sb.auth.updateUser({ email: next }); if (error) throw error;
          codeDialog({ title: 'Confirm your new email', body: `Enter the code sent to <b>${h(next)}</b>. If your old address also gets an email, confirm that one too.`, type: 'email_change', email: next, done: () => { toast('Email updated'); loadMe(); } });
        } catch (x) { fail(x); }
      };
    };
    $('#chpw', d).onclick = () => {
      form.classList.remove('hidden'); err.textContent = '';
      form.innerHTML = `<label class="field"><span>Current password</span><input type="password" name="pw" required autocomplete="current-password"></label>
        <label class="field"><span>New password (8+ characters)</span><input type="password" name="next" minlength="8" required autocomplete="new-password"></label>
        <label class="field"><span>Confirm new password</span><input type="password" name="again" required autocomplete="new-password"></label><button class="btn" type="submit">Change password</button>`;
      form.onsubmit = async (ev) => {
        ev.preventDefault();
        if (form.next.value.length < 8) return fail(new Error('Use at least 8 characters.'));
        if (form.next.value !== form.again.value) return fail(new Error('The new passwords don’t match.'));
        try { await reauth(form.pw.value); const { error } = await sb.auth.updateUser({ password: form.next.value }); if (error) throw error;
          form.classList.add('hidden'); toast('Password changed'); } catch (x) { fail(x); }
      };
    };
    $('#signout', d).onclick = async () => { await sb.auth.signOut(); d.close(); toast('Signed out'); };
  });
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
      <p class="small muted">Your username can’t be changed later.</p>
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
      err.textContent = ''; if (error) { err.textContent = errText(error); return; }
      openDialog(`<h2>Reset password</h2><p>Enter the code we emailed to <b>${h(email)}</b> and choose a new password.</p>
        <form id="rf"><label class="field"><span>Code from the email</span><input type="text" name="code" inputmode="numeric" autocomplete="one-time-code" required></label>
        <label class="field"><span>New password (8+ characters)</span><input type="password" name="pw" minlength="8" autocomplete="new-password" required></label>
        <p class="error" id="rerr" role="alert"></p><button class="btn" type="submit">Save new password</button></form>`, (rd) => {
        $('#rf', rd).addEventListener('submit', async (ev) => {
          ev.preventDefault(); const f2 = ev.target, e2 = $('#rerr', rd);
          if (f2.pw.value.length < 8) { e2.textContent = 'Use at least 8 characters.'; return; }
          const { error: ve } = await sb.auth.verifyOtp({ email, token: f2.code.value.trim(), type: 'recovery' });
          if (ve) { e2.textContent = 'That code didn’t work. Check the newest email and try again.'; return; }
          const { error: ue } = await sb.auth.updateUser({ password: f2.pw.value });
          if (ue) { e2.textContent = errText(ue); return; }
          rd.close(); toast('Password changed. You’re signed in.');
        });
      });
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
          if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) throw new Error('email_already_registered');
          if (data.session) { d.close(); toast('Welcome!'); }
          else codeDialog({ title: 'Confirm your email', body: `We sent a code to <b>${h(email)}</b>. Enter it to finish creating your account.`, type: 'signup', email, done: () => toast('Welcome! 🔥') });
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
async function lookupZip(zip) {
  if (!/^\d{5}$/.test(zip)) return null;
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=us&addressdetails=1&postalcode=${zip}`, { headers: { 'Accept-Language': 'en' } });
    const [hit] = await r.json();
    if (!hit) return null;
    const a = hit.address || {};
    const town = a.city || a.town || a.village || a.hamlet || a.suburb || a.county || String(hit.display_name || '').split(',')[0];
    return { zip, lat: Number(hit.lat), lng: Number(hit.lon), label: town ? `${zip} (${town})` : zip };
  } catch { return null; }
}
const originLabel = () => (state.filters.near ? state.filters.near.label : state.loc?.mine === false ? HOME.name : 'your location');
async function origin() {
  if (!state.filters.radius) return null;
  if (state.filters.near) return { ...state.filters.near, mine: false };
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
  // Hide posts from people you've blocked
  return notBlocked(data);
}
function activeFilterCount() {
  const f = state.filters;
  return f.cats.length + f.tags.length + f.cost.length + (f.tpc ? 1 : 0) + (f.q ? 1 : 0) + (f.radius ? 1 : 0);
}

/* ---------- views ---------- */
const EMOJI = { environmental: '🌿', community: '🤝', wellness: '🏃', mental: '🧘', arts: '🎨', other: '✨' };
const COST = { ...Object.fromEntries(COSTS), check: 'See details' };
const SVG = {
  search: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
  sliders: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/></svg>',
  share: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V3M7 8l5-5 5 5"/><path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/></svg>',
  cal: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>',
};
const monShort = (d) => new Date(d).toLocaleDateString(undefined, { month: 'short' });
const dowShort = (d) => new Date(d).toLocaleDateString(undefined, { weekday: 'short' });
function relDay(d) {
  const k = dayKey(d), t = startOfDay(new Date());
  if (k <= dayKey(t)) return 'Today';
  if (k === dayKey(addDays(t, 1))) return 'Tomorrow';
  if (k < dayKey(addDays(t, 7))) return new Date(d).toLocaleDateString(undefined, { weekday: 'long' });
  return new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
const tileWhen = (e) => (e.all_day ? `${relDay(e.starts_at)}, all day` : `${relDay(e.starts_at)} at ${fmtTime(e.starts_at)}`);

// Every event is a poster: the real flyer photo, or a generated poster in its pillar's color
function cover(e, withAlt = false) {
  const art = e.poster_path
    ? `<img src="${h(posterUrl(e.poster_path))}" alt="${withAlt ? `Poster for ${h(e.title)}` : ''}" loading="lazy">${e.is_tpc ? '<span class="tpc">Phoenix Catalyst</span>' : ''}`
    : `<div class="gen" aria-hidden="true"><span class="ghost">${EMOJI[e.category] || '✨'}</span><span class="glyph">${EMOJI[e.category] || '✨'}</span><span class="ptitle">${h(e.title)}</span></div>`;
  return `<div class="cover" data-cat="${h(e.category)}">${art}<span class="stamp" aria-hidden="true"><small>${h(monShort(e.starts_at))}</small><b>${new Date(e.starts_at).getDate()}</b></span></div>`;
}
function tile(e) {
  return `<a class="tile" data-cat="${h(e.category)}" href="#/event/${e.id}">${cover(e)}
    <div class="when">${h(tileWhen(e))}</div><div class="t">${h(e.title)}</div>${e.location_name ? `<div class="where">${h(e.location_name)}</div>` : ''}</a>`;
}
function evRow(e) {
  const rs = state.rsvps.get(e.id);
  return `<a class="ticket" data-cat="${h(e.category)}" href="#/event/${e.id}">
    <span class="date" aria-hidden="true"><small>${h(dowShort(e.starts_at))}</small><b>${new Date(e.starts_at).getDate()}</b></span>
    <span class="body"><span class="t">${h(e.title)}</span>
      <span class="meta">${h(whenText(e))}${e.location_name ? `, ${h(e.location_name)}` : ''}</span>
      <span class="badges">${e.is_tpc ? '<span class="badge tpc">Phoenix Catalyst</span>' : ''}${e.is_youth ? '<span class="badge">Youth event</span>' : ''}${e.repeat_yearly ? '<span class="badge">Every year</span>' : ''}<span class="badge">${h(COST[e.cost])}</span>
        ${rs ? `<span class="badge me">${rs === 'volunteer' ? 'Volunteering' : 'Going'}</span>` : ''}${e.going_count ? `<span class="badge">${e.going_count} going</span>` : ''}</span></span>
    <span class="thumb">${cover(e)}</span></a>`;
}
function spotlight(e) {
  const left = e.volunteer_slots ? Math.max(0, e.volunteer_slots - e.volunteer_count) : null;
  return `<a class="spot" data-cat="${h(e.category)}" href="#/event/${e.id}">${cover(e)}<div>
    <div class="kicker">Volunteer with The Phoenix Catalyst</div><div class="t">${h(e.title)}</div>
    <div class="muted small">${h(tileWhen(e))}${e.location_name ? `, ${h(e.location_name)}` : ''}</div>
    ${e.volunteer_slots ? `<div class="meter" aria-hidden="true"><i style="width:${Math.min(100, Math.round(100 * e.volunteer_count / e.volunteer_slots))}%"></i></div>
      <div class="small muted" style="margin-top:4px">${left ? `${left} of ${e.volunteer_slots} spots open` : 'All spots filled'}</div>`
      : `<div class="small muted" style="margin-top:6px">${e.volunteer_count} volunteer${e.volunteer_count === 1 ? '' : 's'} signed up</div>`}
  </div></a>`;
}

function chipRow(items, selected, attr) {
  return items.map(([k, label]) => `<button type="button" class="chip" data-${attr}="${h(k)}" aria-pressed="${selected.includes(k)}">${h(label)}</button>`).join('');
}
function catChips() {
  const f = state.filters;
  const where = f.radius ? `<p class="small muted" style="margin:0 0 6px">📍 Within ${f.radius} mi of ${h(originLabel())} · <a href="#" id="fwhere" style="font-weight:700;color:var(--ink)">Change</a></p>` : '';
  return `${where}<div class="chips" role="group" aria-label="Type of event">
    <button type="button" class="chip" data-quick="all" aria-pressed="${!f.cats.length && !f.tpc}"><span class="e">✨</span>Everything</button>
    <button type="button" class="chip" data-quick="tpc" data-cat="wellness" aria-pressed="${f.tpc}"><span class="e">🔥</span>Volunteer</button>
    ${CATS.slice(0, 5).map((c) => `<button type="button" class="chip" data-cat="${c.key}" data-cat-f="${c.key}" aria-pressed="${f.cats.includes(c.key)}"><span class="e">${EMOJI[c.key]}</span>${h(c.label)}</button>`).join('')}
  </div>`;
}
function filterCount() { return activeFilterCount() - state.filters.cats.length - (state.filters.tpc ? 1 : 0) - (state.filters.q ? 1 : 0) + (state.filters.when !== 'upcoming' ? 1 : 0); }
function searchRow() {
  const n = filterCount();
  return `<div class="searchrow"><form class="search" id="qform" role="search">${SVG.search}<input type="search" name="q" value="${h(state.filters.q)}" placeholder="Yoga, food drive, trail…" aria-label="Search events"></form>
    <button type="button" class="btn quiet iconbtn fbtn" id="fopen" aria-label="Filters${n ? `, ${n} on` : ''}">${SVG.sliders}${n ? `<b>${n}</b>` : ''}</button></div>`;
}
function wireQuick(root, rerender) {
  const f = state.filters;
  const toggle = (arr, v) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  root.querySelector('#qform').addEventListener('submit', (e) => { e.preventDefault(); f.q = e.target.q.value.trim(); saveFilters(); rerender(); });
  root.querySelector('#qform input').addEventListener('search', (e) => { if (!e.target.value && f.q) { f.q = ''; saveFilters(); rerender(); } });
  root.querySelectorAll('[data-cat-f]').forEach((b) => b.onclick = () => { f.cats = toggle(f.cats, b.dataset.catF); saveFilters(); rerender(); });
  root.querySelector('[data-quick=all]').onclick = () => { f.cats = []; f.tpc = false; saveFilters(); rerender(); };
  root.querySelector('[data-quick=tpc]').onclick = () => { f.tpc = !f.tpc; saveFilters(); rerender(); };
  root.querySelector('#fopen').onclick = () => filterSheet(rerender);
  root.querySelector('#fwhere')?.addEventListener('click', (e) => { e.preventDefault(); filterSheet(rerender); });
}
function filterSheet(rerender) {
  const draft = JSON.parse(JSON.stringify(state.filters));
  const toggle = (arr, v) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  const paint = (d) => {
    d.querySelectorAll('[data-when]').forEach((b) => b.setAttribute('aria-pressed', draft.when === b.dataset.when));
    d.querySelectorAll('[data-tag]').forEach((b) => b.setAttribute('aria-pressed', draft.tags.includes(b.dataset.tag)));
    d.querySelectorAll('[data-cost]').forEach((b) => b.setAttribute('aria-pressed', draft.cost.includes(b.dataset.cost)));
    d.querySelectorAll('[data-radius]').forEach((b) => b.setAttribute('aria-pressed', String(draft.radius ?? '') === b.dataset.radius));
    d.querySelectorAll('[data-from]').forEach((b) => b.setAttribute('aria-pressed', String(useZip) === b.dataset.from));
    $('#zipwrap', d).classList.toggle('hidden', !useZip);
  };
  let useZip = !!state.filters.near;
  openDialog(`<div class="sheet"><h2>Filters</h2>
    <h3>When</h3><div class="chips wrap">${WHENS.map(([k, l]) => `<button type="button" class="chip" data-when="${k}">${l}</button>`).join('')}</div>
    <h3>Distance</h3><div class="chips wrap">${RADII.map(([k, l]) => `<button type="button" class="chip" data-radius="${k ?? ''}">${l}</button>`).join('')}</div>
    <h3>Measure from</h3><div class="chips wrap"><button type="button" class="chip" data-from="false">📍 My location</button><button type="button" class="chip" data-from="true">ZIP code</button></div>
    <div id="zipwrap" class="hidden"><input type="text" id="zip" inputmode="numeric" maxlength="5" placeholder="21044" aria-label="ZIP code" value="${h(state.filters.near?.zip || '')}" style="max-width:160px;font-weight:700;letter-spacing:2px">
      <p class="small muted" style="margin-top:6px">${state.filters.near ? `Using ${h(state.filters.near.label)}` : 'Distances are measured from the center of this ZIP code.'}</p></div>
    <p class="error" id="ziperr" role="alert"></p>
    <h3>Good for</h3><div class="chips wrap">${chipRow(TAGS, [], 'tag')}</div>
    <h3>Cost</h3><div class="chips wrap">${chipRow(COSTS, [], 'cost')}</div>
    <div class="foot"><button type="button" class="btn ghost" id="freset">Reset</button><button type="button" class="btn" id="fapply">Show events</button></div></div>`, (d) => {
    paint(d);
    d.querySelectorAll('[data-when]').forEach((b) => b.onclick = () => { draft.when = b.dataset.when; paint(d); });
    d.querySelectorAll('[data-tag]').forEach((b) => b.onclick = () => { draft.tags = toggle(draft.tags, b.dataset.tag); paint(d); });
    d.querySelectorAll('[data-cost]').forEach((b) => b.onclick = () => { draft.cost = toggle(draft.cost, b.dataset.cost); paint(d); });
    d.querySelectorAll('[data-radius]').forEach((b) => b.onclick = () => { draft.radius = b.dataset.radius ? Number(b.dataset.radius) : null; paint(d); });
    d.querySelectorAll('[data-from]').forEach((b) => b.onclick = () => { useZip = b.dataset.from === 'true'; paint(d); if (useZip) $('#zip', d).focus(); });
    $('#zip', d).oninput = (e) => { e.target.value = e.target.value.replace(/\D/g, '').slice(0, 5); };
    $('#freset', d).onclick = () => { Object.assign(draft, { when: 'upcoming', tags: [], cost: [], radius: null, near: null }); useZip = false; $('#zip', d).value = ''; paint(d); };
    $('#fapply', d).onclick = async (ev) => {
      const err = $('#ziperr', d); err.textContent = '';
      draft.near = null;
      if (useZip) {
        const zip = $('#zip', d).value;
        if (!/^\d{5}$/.test(zip)) { err.textContent = 'Enter a 5-digit ZIP code.'; return; }
        if (state.filters.near?.zip === zip) draft.near = state.filters.near;
        else {
          busy(ev.currentTarget, true, 'Finding…');
          draft.near = await lookupZip(zip);
          busy(ev.currentTarget, false);
          if (!draft.near) { err.textContent = 'We couldn’t find that ZIP code. Check it and try again.'; return; }
        }
        if (!draft.radius) draft.radius = 10;
      }
      Object.assign(state.filters, draft); state.day = null; saveFilters(); d.close(); rerender();
    };
  });
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

function greeting() {
  const hr = new Date().getHours();
  const part = hr < 5 ? 'Up late' : hr < 12 ? 'Good morning' : hr < 17 ? 'Good afternoon' : 'Good evening';
  return state.username && !state.username.includes('@') ? `${part}, ${state.username}` : part;
}

/* ---------- year-end campaign banner (behind CAMPAIGN.enabled, off by default) ---------- */
async function campaignProgress() {
  if (!progressUrlAllowed(CAMPAIGN.progress_url)) return null;
  try {
    const r = await fetch(CAMPAIGN.progress_url, { headers: { accept: 'application/json' } });
    return r.ok ? parseProgress(await r.json(), CAMPAIGN) : null;
  } catch { return null; }
}
async function paintCampaign(slot) {
  if (!slot || phase(CAMPAIGN) === 'off' || phase(CAMPAIGN) === 'before') return;
  slot.innerHTML = bannerHtml(CAMPAIGN, await campaignProgress());
  slot.querySelector('[data-campaign-give]')?.addEventListener('click', () => {
    const give = $('#give');
    if (give) { give.scrollIntoView({ behavior: 'smooth', block: 'start' }); give.querySelector('input')?.focus({ preventScroll: true }); }
    else { state.scrollToGive = true; location.hash = '#/about'; }
  });
}

async function viewCalendar() {
  const root = main();
  root.innerHTML = `<div class="greet"><p style="margin:0 0 6px">${h(greeting())}</p><h1>Bring color back into your world</h1><p id="sub">Finding what’s happening near you…</p></div>
    <div id="campaign"></div><div id="top"></div><div id="feed"></div>`;
  paintCampaign($('#campaign'));
  const draw = async () => {
    const m = state.month, gridStart = addDays(m, -m.getDay()), gridEnd = addDays(gridStart, 42), now = new Date();
    let monthEvents = [], listEvents = [], week = [], spot = null, failed = null;
    try {
      const listRange = state.day ? [new Date(`${state.day}T00:00:00`), addDays(new Date(`${state.day}T00:00:00`), 1)] : rangeFor(state.filters);
      let sp;
      [monthEvents, listEvents, week, sp] = await Promise.all([
        search(gridStart, gridEnd, 500), search(listRange[0], listRange[1]), search(now, addDays(startOfDay(now), 8), 12),
        sb.from('phoenix_events').select('*').eq('is_tpc', true).eq('status', 'published').gte('starts_at', now.toISOString()).order('starts_at').limit(1),
      ]);
      spot = sp.data?.[0] ?? null;
    } catch (e) { failed = e; }
    $('#top').innerHTML = searchRow() + catChips();
    wireQuick($('#top'), draw);
    const feed = $('#feed');
    if (failed) { feed.innerHTML = `<div class="empty"><div class="big">🌧️</div><h2>Couldn’t load events</h2><p>${h(errText(failed))}</p><button class="btn" id="retry">Try again</button></div>`; $('#retry').onclick = draw; return; }
    $('#sub').textContent = week.length ? `${week.length}${week.length === 12 ? '+' : ''} thing${week.length === 1 ? '' : 's'} happening this week, shared by neighbors and The Phoenix Catalyst.` : 'Local events shared by neighbors and The Phoenix Catalyst.';
    const heading = state.day ? fmtDay(`${state.day}T12:00:00`) : state.filters.when === 'upcoming' ? 'Coming up' : Object.fromEntries(WHENS)[state.filters.when];
    const list = listEvents.length
      ? listEvents.map(evRow).join('')
      : `<div class="empty"><div class="big">🌱</div><h2>Nothing here yet</h2><p>${activeFilterCount() || state.day ? 'Try fewer filters, or share' : 'Be the first to share'} an event you know about. A photo of a flyer works.</p><a class="btn" href="#/add">Add an event</a></div>`;
    feed.innerHTML = `${!state.day && week.length ? `<div class="section-h"><h2>This week</h2></div><div class="rail">${week.map(tile).join('')}</div>` : ''}
      ${!state.day && spot && !state.filters.tpc ? spotlight(spot) : ''}
      <div class="home" style="margin-top:8px">
        <aside id="side">${monthHtml(monthEvents)}</aside>
        <section aria-live="polite"><div class="section-h"><h2>${h(heading)}</h2>${state.day ? '<button class="btn small quiet" id="clearday">Show all</button>' : ''}</div>${list}</section>
      </div>`;
    $('#prevm').onclick = () => { state.month = new Date(m.getFullYear(), m.getMonth() - 1, 1); draw(); };
    $('#nextm').onclick = () => { state.month = new Date(m.getFullYear(), m.getMonth() + 1, 1); draw(); };
    document.querySelectorAll('.day').forEach((b) => b.onclick = () => { state.day = state.day === b.dataset.day ? null : b.dataset.day; draw(); });
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

/* ---------- hearts, comments and profile pictures ---------- */
const picCache = new Map();
// Signed links to other people's shared Dragonfly pictures (signed-in viewers only), kept for the session
function picFor(uid) {
  if (!state.user) return Promise.resolve(null);
  if (uid === state.user.id && state.avatar) return Promise.resolve(state.avatar);
  if (!picCache.has(uid)) picCache.set(uid, sb.storage.from(AVATAR_BUCKET).createSignedUrl(avatarPath(uid), 3600).then(({ data }) => data?.signedUrl ?? null, () => null));
  return picCache.get(uid);
}
const PFP_COLORS = ['var(--env)', 'var(--com)', 'var(--well)', 'var(--mind)', 'var(--arts)', 'var(--other)'];
/** Someone's picture: their colored initial right away, swapped for their profile picture once it loads. */
function pfp(uid, name, size = 34) {
  const n = String(name || '?').replace(/^@/, '');
  let hash = 7; for (const ch of n) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return `<span class="pfp" data-uid="${h(uid)}" aria-hidden="true" style="width:${size}px;height:${size}px;background:${PFP_COLORS[hash % PFP_COLORS.length]};font-size:${Math.round(size * 0.44)}px">${h(n.charAt(0).toUpperCase())}</span>`;
}
function hydratePfps(root) {
  root.querySelectorAll('.pfp[data-uid]:not([data-done])').forEach(async (el) => {
    el.dataset.done = '1';
    const url = await picFor(el.dataset.uid);
    if (!url) return;
    const img = new Image(); img.alt = '';
    img.onload = () => { el.textContent = ''; el.appendChild(img); };
    img.src = url;
  });
}
function timeAgo(iso) {
  const sec = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (sec < 60) return 'now';
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h`;
  if (sec < 604800) return `${Math.floor(sec / 86400)}d`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
const compact = (n) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}K` : String(n));
const COMMENT_COLS = 'id,event_id,user_id,username,parent_id,body,like_count,reply_count,created_at';

async function wireSocial(e) {
  const heart = $('#heart'), hc = $('#hc'), cc = $('#cc'), list = $('#clist'), form = $('#cform'), replyBox = $('#replyto');
  let soc = { likes: 0, comments: 0, liked: false };
  const paintSoc = () => {
    hc.textContent = compact(soc.likes); cc.textContent = compact(soc.comments);
    heart.setAttribute('aria-pressed', String(soc.liked));
    heart.setAttribute('aria-label', `${soc.liked ? 'Unlike' : 'Like'} this event, ${soc.likes} hearts`);
  };
  sb.rpc('phoenix_event_social', { p_event: e.id }).then(({ data }) => { if (data?.[0]) { soc = { ...data[0] }; paintSoc(); } });
  heart.onclick = async () => {
    if (!requireUser('Sign in to heart events.')) return;
    const like = !soc.liked;
    soc = { ...soc, liked: like, likes: Math.max(0, soc.likes + (like ? 1 : -1)) }; paintSoc();
    const { error } = like
      ? await sb.from('phoenix_event_likes').insert({ event_id: e.id, user_id: state.user.id })
      : await sb.from('phoenix_event_likes').delete().eq('event_id', e.id).eq('user_id', state.user.id);
    if (error && !/duplicate key/.test(error.message)) toast(errText(error));
  };

  let items = [], liked = new Set(), replyTo = null;
  const open = new Set();
  const item = (c, reply) => {
    const mine = c.user_id === state.user?.id, on = liked.has(c.id);
    return `<li class="cmt${reply ? ' reply' : ''}">${pfp(c.user_id, c.username, reply ? 26 : 34)}<div class="cbody">
      <div class="cmeta"><b>@${h(c.username || 'neighbor')}</b>${mine ? ' · you' : ''} <span class="muted">· ${h(timeAgo(c.created_at))}</span></div>
      <p>${h(c.body)}</p>
      <div class="cacts"><button type="button" class="linkbtn" data-reply="${c.id}">Reply</button>${mine ? `<button type="button" class="linkbtn" data-del="${c.id}">Delete</button>` : isMod() ? `<button type="button" class="linkbtn" data-rm="${c.id}">Remove</button>` : ''}${state.user && !mine ? `<button type="button" class="linkbtn" data-report="${c.id}">Report</button><button type="button" class="linkbtn" data-block="${c.id}">Block</button>` : ''}${!mine && isMod() ? `<button type="button" class="linkbtn danger" data-ban="${c.id}">Suspend</button>` : ''}</div></div>
      <button type="button" class="cheart" data-like="${c.id}" aria-pressed="${on}" aria-label="${on ? 'Unlike' : 'Like'} comment, ${c.like_count} hearts"><span class="heart">♥</span><span>${c.like_count ? compact(c.like_count) : ''}</span></button></li>`;
  };
  const paint = () => {
    soc.comments = items.length; paintSoc();
    // Newest conversations first; replies stay in order under their comment
    const tops = items.filter((c) => !c.parent_id).reverse();
    list.innerHTML = tops.length ? `<ul class="cmts">${tops.map((t) => {
      const reps = items.filter((r) => r.parent_id === t.id);
      return item(t) + (reps.length ? (open.has(t.id) ? reps.map((r) => item(r, true)).join('')
        : `<li class="cmt reply"><button type="button" class="linkbtn" data-open="${t.id}">── View ${reps.length} repl${reps.length === 1 ? 'y' : 'ies'}</button></li>`) : '');
    }).join('')}</ul>` : '<p class="muted">No comments yet. Ask a question, share a tip, or tell people you’ll be there.</p>';
    hydratePfps(list);
  };
  const load = async () => {
    const { data, error } = await sb.from('phoenix_comments').select(COMMENT_COLS).eq('event_id', e.id).order('created_at', { ascending: true }).limit(500);
    if (error) { list.innerHTML = `<p class="error">${h(errText(error))}</p>`; return; }
    items = data; liked = new Set();
    if (state.user && items.length) {
      const { data: mine } = await sb.from('phoenix_comment_likes').select('comment_id').eq('user_id', state.user.id).in('comment_id', items.map((c) => c.id));
      (mine || []).forEach((m) => liked.add(m.comment_id));
    }
    paint();
  };
  list.onclick = async (ev) => {
    const b = ev.target.closest('button'); if (!b) return;
    const d = b.dataset;
    if (d.open) { open.add(d.open); paint(); return; }
    const c = items.find((x) => x.id === (d.like || d.reply || d.del || d.rm || d.report || d.block || d.ban)); if (!c) return;
    if (d.like) {
      if (!requireUser('Sign in to heart comments.')) return;
      const like = !liked.has(c.id);
      if (like) liked.add(c.id); else liked.delete(c.id);
      c.like_count = Math.max(0, c.like_count + (like ? 1 : -1)); paint();
      const { error } = like
        ? await sb.from('phoenix_comment_likes').insert({ comment_id: c.id, user_id: state.user.id })
        : await sb.from('phoenix_comment_likes').delete().eq('comment_id', c.id).eq('user_id', state.user.id);
      if (error && !/duplicate key/.test(error.message)) load();
    } else if (d.reply) {
      if (!requireUser('Sign in to reply.')) return;
      replyTo = c; replyBox.hidden = false;
      replyBox.innerHTML = `Replying to <b>@${h(c.username || 'neighbor')}</b> <button type="button" class="linkbtn" id="noreply">Cancel</button>`;
      $('#noreply').onclick = () => { replyTo = null; replyBox.hidden = true; };
      form?.body.focus();
    } else if (d.del) {
      if (!(await confirmDialog('Delete your comment?', 'Replies to it will be deleted too.', 'Delete', true))) return;
      const { error } = await sb.from('phoenix_comments').delete().eq('id', c.id);
      if (error) toast(errText(error)); else load();
    } else if (d.rm) {
      if (!(await confirmDialog('Remove this comment?', 'It and its replies will be hidden from everyone.', 'Remove', true))) return;
      const { error } = await sb.rpc('phoenix_remove_comment', { p_comment: c.id });
      if (error) toast(errText(error)); else { toast('Comment removed'); load(); }
    } else if (d.block) {
      await blockPerson(c.user_id, c.username, load);
    } else if (d.ban) {
      suspendDialog(c.username, load);
    } else if (d.report) {
      const { error } = await sb.from('phoenix_flags').insert({ event_id: e.id, user_id: state.user.id, reason: `Comment by @${c.username || 'neighbor'}: “${c.body.slice(0, 300)}”` });
      toast(error ? (/duplicate/.test(error.message) ? 'You already reported this event. Moderators will review it.' : errText(error)) : 'Report sent to moderators');
    }
  };
  if (form) {
    form.body.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); form.requestSubmit(); } });
    form.onsubmit = async (ev) => {
      ev.preventDefault();
      const body = form.body.value.trim(); if (!body) return;
      if (!(await agreeToRules())) return;
      const btn = form.querySelector('[type=submit]'); busy(btn, true, 'Posting…');
      try {
        const { data, error } = await sb.from('phoenix_comments').insert({ event_id: e.id, user_id: state.user.id, body, parent_id: replyTo ? (replyTo.parent_id || replyTo.id) : null }).select(COMMENT_COLS).single();
        if (error) throw error;
        items.push(data); if (data.parent_id) open.add(data.parent_id);
        form.body.value = ''; replyTo = null; replyBox.hidden = true; paint();
      } catch (err) { toast(errText(err)); } finally { busy(btn, false); }
    };
  } else $('#csignin')?.addEventListener('click', () => authDialog('Sign in to comment.'));
  hydratePfps(document.querySelector('.composer') || document.body);
  await load();
}

async function viewEvent(id) {
  const root = main();
  root.innerHTML = '<p class="muted pad">Loading…</p>';
  const { data: e, error } = await sb.from('phoenix_events').select('*').eq('id', id).maybeSingle();
  if (error || !e) { root.innerHTML = `<div class="empty detail"><h2>Event not found</h2><p>It may have been removed.</p><a class="btn" href="#/">Back to calendar</a></div>`; return; }
  const mine = state.user && e.created_by === state.user.id, rs = state.rsvps.get(e.id);
  const full = e.volunteer_slots && e.volunteer_count >= e.volunteer_slots;
  const place = [e.location_name, e.address].filter(Boolean).join(', ');
  document.title = `${e.title} · The Phoenix Catalyst`;
  const ico = (d) => `<span class="ico"><svg viewBox="0 0 24 24" aria-hidden="true">${d}</svg></span>`;
  const host = e.is_tpc ? 'Hosted by The Phoenix Catalyst' : e.organizer ? `Hosted by ${e.organizer}` : CAT[e.category]?.label;
  root.innerHTML = `<article class="detail" data-cat="${h(e.category)}">
    <a href="#/" class="back">‹ Calendar</a>
    ${e.status !== 'published' ? `<p class="panel error">This event is ${h(e.status)} and only visible to you${isMod() ? ' and moderators' : ''}.</p>` : ''}
    <div class="hero ${e.poster_path ? '' : 'gen'}">${e.poster_path ? `<div class="backdrop" style="background-image:url('${h(posterUrl(e.poster_path))}')"></div>` : ''}${cover(e, true)}</div>
    <header class="ehead"><div class="kicker">${EMOJI[e.category] || ''} ${h(host)}</div><h1>${h(e.title)}</h1></header>
    <div class="facts">
      <div>${ico('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>')}<span><b>${h(fmtDay(e.starts_at))}</b><br><span class="muted">${h(whenText(e))}</span></span></div>
      ${place ? `<div>${ico('<path d="M12 21s-7-6.2-7-12a7 7 0 0 1 14 0c0 5.8-7 12-7 12z"/><circle cx="12" cy="9" r="2.5"/>')}<span><b>${h(e.location_name || e.address)}</b><br>${e.location_name && e.address ? `<span class="muted">${h(e.address)}</span><br>` : ''}<a target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place)}">Get directions</a></span></div>` : ''}
      <div>${ico('<path d="M3 9a2 2 0 0 0 0 4v5h18v-5a2 2 0 0 0 0-4V6H3z"/><path d="M14 6v12" stroke-dasharray="2 2"/>')}<span><b>${h(COST[e.cost])}</b>${e.tags.length ? `<br><span class="muted">Good for ${e.tags.map((t) => h(TAG[t].toLowerCase())).join(', ')}</span>` : ''}</span></div>
      <div>${ico('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6 6 0 0 1 3.5 6"/>')}<span><b>${e.going_count ? `${e.going_count} neighbor${e.going_count === 1 ? '' : 's'} going` : 'Be the first to say you’re going'}</b>${e.is_tpc ? `<br><span class="muted">${e.volunteer_count}${e.volunteer_slots ? ` of ${e.volunteer_slots}` : ''} volunteer spots filled</span>` : ''}</span></div>
    </div>
    ${e.is_youth ? `<div class="panel" style="margin-top:16px"><b>🧒 Youth event${e.chaperone_ratio ? ` · ${h(e.chaperone_ratio)}` : ''}</b><p class="small muted" style="margin:4px 0 0">Youth event: approved adult chaperones supervise at this ratio. Volunteers here must be 18+ and cleared by the team.</p></div>` : ''}
    ${e.description ? `<h2 style="margin:22px 0 8px">About</h2><p class="desc">${h(e.description)}</p>` : ''}
    ${e.source === 'import' ? `<p class="small muted">From ${h(e.organizer || 'the organizer')}’s public calendar. Times and details can change, so check their page before you go.</p>` : ''}
    ${e.url ? `<p><a target="_blank" rel="noopener nofollow" href="${h(e.url)}">${e.source === 'import' ? `Open on ${h(e.organizer || 'their')} calendar` : 'More info from the organizer'}</a></p>` : ''}
    <div class="rsvpbar">
      ${e.is_tpc ? `<button class="btn ${rs === 'volunteer' ? 'on' : 'glow'}" id="vol" ${full && rs !== 'volunteer' ? 'disabled' : ''}>${rs === 'volunteer' ? '✓ Volunteering' : full ? 'Spots full' : '🔥 Volunteer'}</button>` : ''}
      <button class="btn ${rs === 'going' ? 'on' : e.is_tpc ? 'quiet' : 'glow'}" id="going">${rs === 'going' ? '✓ Going' : 'I’m going'}</button>
      <button class="btn quiet iconbtn" id="addcal" aria-label="Add to calendar">${SVG.cal}</button>
      <button class="btn quiet iconbtn" id="share" aria-label="Share">${SVG.share}</button>
    </div>
    ${e.status === 'published' ? `<div class="social"><button type="button" class="btn quiet" id="heart" aria-pressed="false" aria-label="Like this event"><span class="heart" aria-hidden="true">♥</span> <span id="hc">0</span></button>
      <a class="btn quiet" href="#comments" id="tocomments"><span aria-hidden="true">💬</span> <span id="cc">0</span> comments</a></div>` : ''}
    <p class="small muted">Posted by @${h(e.created_by_username || 'neighbor')}${e.source === 'poster' ? ' from a poster photo' : ''}. Details can change, so check with the organizer.</p>
    <div class="actions">
      ${mine || isMod() || (e.is_tpc && canTpc()) ? `<a class="btn small quiet" href="#/edit/${e.id}">Edit</a>` : ''}
      ${mine || isAdmin() ? '<button class="btn small danger" id="del">Delete</button>' : ''}
      ${!mine ? '<button class="btn small quiet" id="flag">Report a problem</button>' : ''}
      ${!mine && state.user ? '<button class="btn small quiet" id="blockposter">Block poster</button>' : ''}
      ${!mine && isMod() ? '<button class="btn small danger" id="banposter">Suspend poster</button>' : ''}
    </div>
    ${isMod() ? `<div class="panel"><h3>Moderation</h3><p class="small muted">${e.reviewed_at ? `Reviewed ${h(fmtShort(e.reviewed_at))}` : 'Not reviewed yet'}. Status: ${h(e.status)}.</p>
      <div class="row">
        ${!e.reviewed_at ? '<button class="btn small" data-mod="ok">Looks good</button>' : ''}
        ${e.status !== 'published' ? '<button class="btn small quiet" data-mod="published">Restore</button>' : ''}
        ${e.status === 'published' ? '<button class="btn small quiet" data-mod="hidden">Hide</button>' : ''}
        ${e.status !== 'removed' ? '<button class="btn small danger" data-mod="removed">Remove</button>' : ''}
      </div></div>` : ''}
    ${e.is_tpc && canTpc() ? '<div class="panel" id="roster"><h3>Volunteers</h3><p class="muted small">Loading…</p></div>' : ''}
    ${e.status === 'published' ? `<section class="panel comments" id="comments" aria-labelledby="ctitle"><h2 id="ctitle">Comments</h2>
      <div id="clist"><p class="muted small">Loading…</p></div>
      <p class="small" id="replyto" hidden></p>
      ${state.user ? `<form id="cform" class="composer">${pfp(state.user.id, state.username, 36)}<textarea name="body" maxlength="500" rows="1" placeholder="Add a comment…" aria-label="Add a comment"></textarea><button class="btn small" type="submit">Post</button></form>`
        : '<button type="button" class="btn ghost" id="csignin">Sign in to comment</button>'}
    </section>` : ''}
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
  $('#blockposter')?.addEventListener('click', () => blockPerson(e.created_by, e.created_by_username, () => { location.hash = '#/'; }));
  $('#banposter')?.addEventListener('click', () => suspendDialog(e.created_by_username, () => viewEvent(e.id)));
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
  if (e.status === 'published') {
    $('#tocomments').onclick = (ev) => { ev.preventDefault(); $('#comments').scrollIntoView({ behavior: 'smooth' }); };
    wireSocial(e);
  }
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

const CLAIMS_TPC = /phoenix\s*catalyst/i;
function eventForm(e = {}, note = '') {
  const tags = e.tags || [];
  // Only Phoenix leaders can mark a flyer's "Hosted by The Phoenix Catalyst"; for leaders it turns on the official switch
  if (!e.id && CLAIMS_TPC.test(e.organizer || '')) {
    if (canTpc()) e = { ...e, is_tpc: true };
    else { e = { ...e, organizer: '' }; note = `${note ? `${note}<br>` : ''}This flyer says it’s hosted by The Phoenix Catalyst. Only Phoenix leaders can post official Phoenix events, so the host was left blank.`; }
  }
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
    ${canTpc() ? `<div class="panel"><label class="check"><input type="checkbox" name="repeat_yearly" ${e.repeat_yearly ? 'checked' : ''}> 🔁 Repeats every year (next year's date is added once this one starts)</label>
      <label class="check"><input type="checkbox" name="is_tpc" ${e.is_tpc ? 'checked' : ''}> Official Phoenix Catalyst volunteer event</label>
      <label class="field"><span>Volunteer spots <span class="muted small">(blank for unlimited)</span></span><input type="number" name="slots" min="1" max="1000" value="${h(e.volunteer_slots)}"></label>
      <label class="check"><input type="checkbox" name="is_youth" ${e.is_youth ? 'checked' : ''}> 🧒 Youth event (kids and teens, supervised by approved adult chaperones)</label>
      <label class="field"><span>Chaperone ratio <span class="muted small">(required for youth events)</span></span><input type="text" name="chaperone_ratio" maxlength="80" placeholder="1 adult per 8 kids" value="${h(e.chaperone_ratio)}"></label></div>` : ''}
    <p class="error" id="formerr" role="alert"></p>
    <div class="row"><button class="btn" type="submit">${e.id ? 'Save changes' : 'Post event'}</button><a class="btn ghost" href="${e.id ? `#/event/${e.id}` : '#/'}">Cancel</a></div>
  </form>`;
}

/** Asks whether a similar event already on the calendar is the same one: 'post', 'open' or 'cancel'. */
function dupeDialog(dupe) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    openDialog(`<h2>Already on the calendar?</h2><p>“${h(dupe.title)}” on ${h(fmtShort(dupe.starts_at))} at ${h(fmtTime(dupe.starts_at))}${dupe.location_name ? ` at ${h(dupe.location_name)}` : ''} looks like the same event.</p>
      <div class="row"><button class="btn" data-v="open">Open it</button><button class="btn ghost" data-v="post">It’s different, post</button><button class="btn ghost" data-close>Cancel</button></div>`, (d) => {
      d.addEventListener('close', () => finish('cancel'), { once: true });
      d.querySelectorAll('[data-v]').forEach((b) => b.addEventListener('click', () => { finish(b.dataset.v); d.close(); }));
    });
  });
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
    if (!existing && !(await agreeToRules())) return;
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
    if (canTpc()) {
      row.is_tpc = !!f.is_tpc?.checked; row.volunteer_slots = f.slots?.value ? Number(f.slots.value) : null; row.repeat_yearly = !!f.repeat_yearly?.checked;
      row.is_youth = row.is_tpc && !!f.is_youth?.checked; row.chaperone_ratio = row.is_youth ? f.chaperone_ratio.value.trim() || null : null;
      if (row.is_youth && !row.chaperone_ratio) { err.textContent = 'Add the chaperone ratio for this youth event, like 1 adult per 8 kids.'; f.chaperone_ratio.focus(); return; }
    }
    if (!canTpc() && (CLAIMS_TPC.test(row.organizer || '') || CLAIMS_TPC.test(row.title))) { err.textContent = FRIENDLY.phoenix_tpc_claim; f.organizer.focus(); return; }
    busy(btn, true, 'Saving…');
    try {
      // Safeguard: check for the same event before uploading anything
      if (!existing) {
        const { data: dupes } = await sb.rpc('phoenix_find_duplicates', { p_title: title, p_starts_at: row.starts_at, p_address: row.address });
        const dupe = dupes?.[0];
        if (dupe) {
          const choice = await dupeDialog(dupe);
          if (choice === 'open') { location.hash = `#/event/${dupe.id}`; return; }
          if (choice !== 'post') { busy(btn, false); return; }
        }
      }
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
    root.innerHTML = `<div class="empty detail"><h2>Share an event</h2><p>Sign in to post events. It’s free.</p><button class="btn" id="si">Sign in or create an account</button></div>`;
    $('#si').onclick = () => authDialog('Sign in to add events.');
    return;
  }
  root.innerHTML = `<div class="detail"><h1>Add an event</h1>
    <p class="muted" style="margin-top:8px">Saw a flyer? Snap it and we’ll fill in what we can. Events go live right away. Volunteer moderators look things over.</p>
    <div class="choose">
      <label class="hero-opt"><input type="file" accept="image/*" capture="environment" id="snap"><span class="e">📸</span><b>Snap a poster</b><span class="muted">Point your camera at a flyer. We’ll fill in the details.</span></label>
      <label><input type="file" accept="image/*" id="pick"><span class="e">🖼️</span><b>Upload a photo</b><span class="muted">Pick a flyer from your photos</span></label>
      <button type="button" id="manual"><span class="e">✍️</span><b>Type it in</b><span class="muted">Yoga in the park, a food drive, movie night…</span></button>
    </div><div id="work"></div></div>`;
  const work = $('#work');
  $('#manual').onclick = () => { work.innerHTML = eventForm(); wireEventForm(null); work.scrollIntoView({ behavior: 'smooth' }); };
  const onFile = async (file) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) { toast('Choose a photo.'); return; }
    const poster = await compressImage(file).catch(() => null);
    if (!poster) { toast('That photo couldn’t be opened. Try another.'); return; }
    const preview = URL.createObjectURL(poster);
    const status = (title, note, bar) => { work.innerHTML = `<div class="scanprev"><img src="${preview}" alt="Your poster photo"><div><b>${title}</b>
      <p class="small muted">${note}</p>${bar ? '<progress id="prog" max="1" value="0"></progress>' : ''}</div></div>`; };
    status('Reading the flyer carefully…', 'Only what’s printed on the flyer is copied. Anything unclear is left for you to fill in.');
    work.scrollIntoView({ behavior: 'smooth' });
    let found = await aiFlyer(poster, () => status('Checking the event online…', 'Looking for the organizer’s page to confirm the place and details.'));
    if (!found) {
      status('Reading the poster…', 'This runs on your phone and is free. The first scan downloads the reader, so it can take a moment.', true);
      try { found = await readPoster(poster, (p) => { const pr = $('#prog'); if (pr) pr.value = p; }); } catch (e) { toast(errText(e)); found = {}; }
    }
    const pre = {
      title: found.title, category: found.category, location_name: found.location_name, address: found.address, url: found.url, cost: found.cost, organizer: found.organizer || '',
      description: found.description, all_day: !!found.allDay,
      starts_at: found.start ? found.start.toISOString() : null, ends_at: found.end ? found.end.toISOString() : null,
    };
    const got = [found.title && 'name', found.start && 'date', found.location_name || found.address ? 'place' : ''].filter(Boolean);
    const checked = found.summary ? `<p class="small ${found.verification?.status === 'confirmed' ? '' : 'muted'}">${h(found.summary)}</p>${(found.verification?.sources ?? []).slice(0, 2).map((x) => `<a class="small" href="${h(x.url)}" target="_blank" rel="noopener">${h(x.title || x.url)}</a>`).join('<br>')}` : '<p class="small muted">Check everything below. Posters can be tricky to read.</p>';
    work.innerHTML = `<div class="scanprev"><img src="${preview}" alt="Your poster photo"><div><b>${got.length ? `Found the ${got.join(', ')}` : 'We couldn’t read much from this one'}</b>
      ${checked}</div></div>` + eventForm(pre);
    wireEventForm(null, { poster });
  };
  $('#snap').onchange = (e) => onFile(e.target.files[0]);
  $('#pick').onchange = (e) => onFile(e.target.files[0]);
}

/* ---------- careful flyer reading (AI read + web check on phoenix-scan; null falls back to the free reader) ---------- */
const FIELD_NAMES = { title: 'name', start: 'start time', end: 'end time', location_name: 'place', address: 'address', url: 'link', organizer: 'organizer', cost: 'cost', category: 'category', description: 'details' };
const flyerDate = (v) => { const m = String(v || '').match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/); return m ? new Date(+m[1], m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0)) : null; };
const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
function mergeFlyer(g, e) {
  const out = { ...g };
  if (e.start) { out.start = flyerDate(e.start); out.allDay = e.all_day ?? e.start.length === 10; out.startText = e.start; }
  if (e.end) { out.end = flyerDate(e.end); out.endText = e.end; }
  for (const k of ['title', 'location_name', 'address', 'url', 'organizer', 'description', 'cost', 'category']) if (e[k]) out[k] = e[k];
  return out;
}
async function aiFlyer(blob, onChecking) {
  if (!state.user) return null;
  try {
    const image = await new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1]); r.onerror = no; r.readAsDataURL(blob); });
    const read = await sb.functions.invoke('phoenix-scan', { body: { step: 'read', image } });
    if (read.error || !read.data?.event) return null;
    let g = mergeFlyer({ cost: 'free', category: 'community' }, read.data.event);
    const unclear = read.data.unclear || [];
    if (read.data.is_event === false || !g.title) return { ...g, summary: '' };
    onChecking?.();
    const event = { ...read.data.event };
    const ver = await sb.functions.invoke('phoenix-scan', { body: { step: 'verify', event } });
    const v = ver.data?.verification;
    if (ver.error || !v) return { ...g, summary: unclear.length ? `Couldn’t read the ${unclear.map((f) => FIELD_NAMES[f] || f).join(', ')} clearly, so fill ${unclear.length > 1 ? 'those' : 'that'} in.` : '' };
    const fixes = v.fixes || {};
    const filled = Object.keys(fixes).filter((k) => k !== 'all_day' && fixes[k]);
    g = mergeFlyer(g, fixes);
    const site = hostOf(v.sources?.[0]?.url);
    const left = unclear.filter((f) => !filled.includes(f)).map((f) => FIELD_NAMES[f] || f);
    const look = left.length ? ` Couldn’t read the ${left.join(', ')} clearly on the flyer, so fill ${left.length > 1 ? 'those' : 'that'} in.` : '';
    const fill = filled.length ? ` Filled in the ${filled.map((f) => FIELD_NAMES[f] || f).join(', ')} from ${site}.` : '';
    const summary = v.status === 'conflict' ? `Check this: ${(v.conflicts || []).map((c) => `${FIELD_NAMES[c.field] || c.field}: flyer says “${c.flyer}”, ${site || 'the web'} says “${c.web}”`).join('; ')}.${fill}${look}`
      : v.status === 'confirmed' ? `✓ Matches ${site}.${fill}${look}`
      : v.status === 'partly' ? `Partly confirmed on ${site}.${fill}${look}`
      : `Couldn’t find this event online, so double-check the details against the flyer.${look}`;
    return { ...g, verification: v, summary };
  } catch { return null; }
}

async function viewEdit(id) {
  if (!requireUser('Sign in to edit events.')) { location.hash = '#/'; return; }
  const { data: e } = await sb.from('phoenix_events').select('*').eq('id', id).maybeSingle();
  if (!e || (e.created_by !== state.user.id && !isMod() && !(e.is_tpc && canTpc()))) { main().innerHTML = '<div class="empty detail"><h2>You can’t edit this event</h2><a class="btn" href="#/">Back to calendar</a></div>'; return; }
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
    $('#mapfilters').innerHTML = searchRow() + catChips();
    wireQuick($('#mapfilters'), draw);
    let events = [];
    try { const [a, b] = rangeFor(state.filters); events = await search(a, b, 500); } catch (e) { toast(errText(e)); }
    layer.clearLayers();
    const placed = events.filter((e) => e.lat != null && e.lng != null);
    for (const e of placed) {
      const icon = L.divIcon({ className: '', html: `<div class="pin" data-cat="${h(e.category)}"><span>${EMOJI[e.category] || '✨'}</span></div>`, iconSize: [30, 30], iconAnchor: [15, 30], popupAnchor: [0, -26] });
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
    ${isAdmin() ? '<p><a class="btn quiet" href="#/applications">Review applications</a></p>' : ''}
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
  const [q, flags, bans, bot] = await Promise.all([
    sb.from('phoenix_events').select('*').is('reviewed_at', null).order('created_at', { ascending: false }).limit(100),
    sb.rpc('phoenix_open_flags'),
    sb.rpc('phoenix_list_bans'),
    sb.rpc('phoenix_bot_queue'),
  ]);
  const botItems = bot.data || [];
  root.innerHTML = `<div class="detail"><h1>Review posts</h1>
    <p class="muted" style="margin-top:8px">Community posts go live right away. Check that each one is real, local, and kind. Hide anything unclear and remove spam or harmful posts.</p>
    <h2 style="margin:20px 0 4px">Phoenix Bot (${botItems.length})</h2>
    <p class="small muted" style="margin:0 0 10px">Phoenix Bot checks every new post and comment. It hides obvious problems until you decide, and asks about anything it isn’t sure of.</p>
    ${botItems.length ? `<ul class="list-plain">${botItems.map((b) => `<li><span class="small" style="font-weight:700;color:${b.verdict === 'hide' ? 'var(--danger, #c42b20)' : 'inherit'}">${b.verdict === 'hide' ? 'Hidden by Phoenix Bot' : 'Phoenix Bot isn’t sure'} · ${b.target_kind}</span>
      <br>${b.event_id ? `<a href="#/event/${b.event_id}"><b>${h(b.target_kind === 'event' ? b.title || '' : `On “${b.title || 'an event'}”`)}</b></a>` : `<b>${h(b.title || '')}</b>`}
      ${b.body ? `<br><span class="small">${h(String(b.body).slice(0, 300))}</span>` : ''}
      <br><span class="small muted">by @${h(b.username || '?')} · ${h(fmtShort(b.created_at))}${b.reason ? ` · Why: ${h(b.reason)}` : ''}</span>
      <br><button class="btn small" data-bot="${b.review_id}" data-d="cleared">${b.verdict === 'hide' ? 'It’s fine, put it back' : 'It’s fine'}</button> <button class="btn small danger" data-bot="${b.review_id}" data-d="confirmed">Remove it</button></li>`).join('')}</ul>` : '<p class="muted">Nothing from Phoenix Bot to check.</p>'}
    <h2 style="margin:20px 0 10px">Reports from users (${(flags.data || []).length})</h2>
    ${(flags.data || []).length ? `<ul class="list-plain">${flags.data.map((f) => `<li><a href="#/event/${f.event_id}"><b>${h(f.title)}</b></a>
      <br><span class="small">“${h(f.reason)}” by @${h(f.flagged_by || 'unknown')}, ${h(fmtShort(f.created_at))}</span>
      <br><button class="btn small quiet" data-resolve="${f.flag_id}">Mark handled</button></li>`).join('')}</ul>` : '<p class="muted">No open reports.</p>'}
    <h2 style="margin:20px 0 10px">Suspended accounts (${(bans.data || []).length})</h2>
    ${(bans.data || []).length ? `<ul class="list-plain">${bans.data.map((b) => `<li><b>@${h(b.username || 'unknown')}</b> <span class="small muted">${b.until ? `until ${h(fmtShort(b.until))}` : 'until lifted'}${b.reason ? ` · ${h(b.reason)}` : ''}</span> <button class="btn small quiet" data-lift="${h(b.username || '')}">Lift</button></li>`).join('')}</ul>` : '<p class="muted">No one is suspended.</p>'}
    <form id="banf" class="row"><input type="text" name="u" placeholder="Username" autocapitalize="none" required style="flex:1;min-width:160px"><button class="btn small danger" type="submit">Suspend</button></form>
    <p class="small muted">Suspended people can still read the calendar but can’t post, comment, RSVP, report or apply.</p>
    <h2 style="margin:20px 0 10px">Not reviewed yet (${(q.data || []).length})</h2>
    ${(q.data || []).length ? q.data.map((e) => `${evRow(e)}<div class="row" style="margin:-2px 0 14px">
      <button class="btn small" data-ok="${e.id}">Looks good</button><button class="btn small quiet" data-st="${e.id}" data-v="hidden">Hide</button>
      <button class="btn small danger" data-st="${e.id}" data-v="removed">Remove</button><span class="small muted">by @${h(e.created_by_username || '?')}${e.status !== 'published' ? ` · ${h(e.status)}` : ''}</span></div>`).join('')
      : '<p class="muted">You’re all caught up.</p>'}</div>`;
  root.querySelectorAll('[data-bot]').forEach((b) => b.onclick = async () => {
    const { error } = await sb.rpc('phoenix_bot_decide', { p_review: b.dataset.bot, p_decision: b.dataset.d });
    if (error) toast(errText(error)); else { toast(b.dataset.d === 'cleared' ? 'Cleared' : 'Removed'); viewModerate(); }
  });
  root.querySelectorAll('[data-lift]').forEach((b) => b.onclick = async () => {
    const { error } = await sb.rpc('phoenix_unban_user', { p_username: b.dataset.lift });
    if (error) toast(errText(error)); else { toast('Suspension lifted'); viewModerate(); }
  });
  $('#banf', root).addEventListener('submit', (ev) => { ev.preventDefault(); suspendDialog(ev.target.u.value.trim().replace(/^@/, ''), viewModerate); });
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
  if (!isAdmin()) { root.innerHTML = '<div class="empty detail"><h2>Admins only</h2></div>'; return; }
  const owner = state.role === 'owner';
  const { data, error } = await sb.rpc('phoenix_list_roles');
  const LABEL = { owner: 'Owner', admin: 'Admin', organizer: 'Organizer', moderator: 'Moderator', none: 'No role' };
  const opts = owner ? ['moderator', 'organizer', 'admin', 'none'] : ['moderator', 'organizer', 'none'];
  root.innerHTML = `<div class="detail"><h1>Team roles</h1>
    <p class="muted" style="margin-top:8px">${owner ? 'You’re the owner. You can make people moderators, organizers or admins. Nobody can change your role.' : 'You can make people moderators or organizers. Only the owner can make or remove admins.'}</p>
    <p class="muted">Moderators review posts, reports and comments. Organizers post official Phoenix events and see volunteer lists. Admins can also give roles and review applications.</p>
    <div class="panel"><form id="rolef" class="row"><input type="text" name="u" placeholder="Username" required style="flex:1;min-width:160px" autocapitalize="none" list="people" autocomplete="off">
      <datalist id="people"></datalist>
      <select name="r" style="width:auto">${opts.map((k) => `<option value="${k}">${LABEL[k]}</option>`).join('')}</select>
      <button class="btn" type="submit">Save role</button></form><p class="error" id="roleerr" role="alert"></p></div>
    ${error ? `<p class="error">${h(errText(error))}</p>` : `<ul class="list-plain">${data.map((r) => `<li>@${h(r.username)} · <b>${h(LABEL[r.role] ?? r.role)}</b>${r.role !== 'owner' && (owner || r.role !== 'admin') ? ` <button class="btn small quiet" data-pick="${h(r.username)}">Change</button>` : ''}</li>`).join('')}</ul>`}</div>`;
  const form = $('#rolef');
  form.u.addEventListener('input', async () => {
    const q = form.u.value.trim().replace(/^@/, '');
    if (q.length < 2) return;
    const { data: ppl } = await sb.rpc('phoenix_find_people', { p_query: q });
    $('#people').innerHTML = (ppl ?? []).map((x) => `<option value="${h(x.username)}">${h(LABEL[x.role] ?? x.role)}</option>`).join('');
  });
  root.querySelectorAll('[data-pick]').forEach((b) => b.addEventListener('click', () => { form.u.value = b.dataset.pick; form.r.focus(); }));
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const { error: e2 } = await sb.rpc('phoenix_set_role', { p_username: form.u.value.trim().replace(/^@/, ''), p_role: form.r.value });
    if (e2) $('#roleerr').textContent = errText(e2); else { toast('Role saved'); viewAdmin(); }
  });
}

/* ---------- applications: volunteer, organize, moderate ---------- */
const KINDS = {
  volunteer: { title: 'Volunteer', emoji: '🌱', blurb: 'Help at clean-ups, plantings, food drives and wellness days. Pick what fits your schedule.' },
  organizer: { title: 'Event organizer', emoji: '🔥', blurb: 'Plan and lead official Phoenix Catalyst events and volunteer shifts.', grants: 'Lets you post official Phoenix events and see who signed up.' },
  moderator: { title: 'App moderator', emoji: '🛡️', blurb: 'Keep the community calendar trustworthy: review new posts, reports and comments.', grants: 'Lets you hide or remove posts and comments that break the rules.' },
};
const APPLY_TERMS = {
  volunteer: 'I’ll treat everyone with respect, follow event leaders’ safety instructions, and let the team know if I can’t make a shift.',
  organizer: 'I’ll only post official Phoenix events that the team has agreed to, keep sign-up details private, and follow The Phoenix Catalyst’s safety and conduct guidelines.',
  moderator: 'I’ll review posts and comments fairly, never use moderator tools for personal disputes, and keep reporters’ and members’ information private.',
};
const INTERESTS = ['Clean-ups & planting', 'Food & donation drives', 'Wellness & fitness days', 'Mental health & support', 'Arts & family fun', 'Setup & teardown', 'Outreach & flyers', 'Photos & social media', 'Driving & deliveries'];
const FREE_WHEN = ['Weekday mornings', 'Weekday afternoons', 'Weeknights', 'Saturdays', 'Sundays'];
const RESUME_TYPES = ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/plain', 'application/rtf', 'image/jpeg', 'image/png', 'image/heic'];
const RESUME_EXT = '.pdf,.doc,.docx,.txt,.rtf,.jpg,.jpeg,.png,.heic';
const RESUME_MAX = 10 * 1024 * 1024;

async function myApplications() {
  if (!state.user) return {};
  const { data } = await sb.from('phoenix_applications').select('*').eq('user_id', state.user.id).order('created_at', { ascending: false });
  const out = {};
  for (const a of data || []) if (!out[a.kind] && a.status !== 'withdrawn') out[a.kind] = a;
  return out;
}
function appStatus(kind, a) {
  if (kind === 'organizer' && canTpc()) return 'You’re an organizer ✓';
  if (kind === 'moderator' && isMod()) return 'You’re a moderator ✓';
  if (!a) return null;
  return a.status === 'pending' ? 'Application sent · waiting for review' : a.status === 'approved' ? 'Approved ✓' : 'Not approved this time';
}

async function viewApply(kind) {
  const root = main();
  if (!KINDS[kind]) kind = 'volunteer';
  const info = KINDS[kind];
  if (!state.user) {
    root.innerHTML = `<div class="empty detail"><h2>Sign in to apply</h2><p>It’s free and takes a minute.</p><button class="btn" id="si">Sign in</button></div>`;
    $('#si').onclick = () => authDialog('Sign in to apply.');
    return;
  }
  document.title = `Apply: ${info.title} · The Phoenix Catalyst`;
  const chipBoxes = (name, list) => `<div class="chips wrap">${list.map((x) => `<label class="chip"><input type="checkbox" name="${name}" value="${h(x)}" style="accent-color:var(--ink)"> ${h(x)}</label>`).join('')}</div>`;
  root.innerHTML = `<div class="detail apply"><a href="#/about" class="back">‹ Phoenix</a>
    <div style="font-size:2.6rem" aria-hidden="true">${info.emoji}</div><h1>${h(info.title)}</h1>
    <p style="margin-top:8px;font-size:1.1rem">${h(info.blurb)}</p>${info.grants ? `<p class="small muted">${h(info.grants)}</p>` : ''}
    <form id="appf" novalidate>
      <div class="panel">
        <label class="field"><span>Your name</span><input type="text" name="name" maxlength="120" autocomplete="name" required></label>
        <label class="field"><span>Phone <span class="muted small">(optional, for event-day updates)</span></span><input type="tel" name="phone" maxlength="40" autocomplete="tel"></label>
        <p class="small muted" style="margin-top:-6px">We’ll also use the email on your account${state.user.email ? ` (${h(state.user.email)})` : ''}.</p>
        <label class="check"><input type="checkbox" name="adult" checked> I’m 18 or older</label>
        <p class="small muted" id="minor" hidden>Volunteers, organizers and moderators must be 18 or older. You’re still welcome at our events with a parent or guardian, and at youth events where our approved chaperones supervise.</p>
      </div>
      ${kind === 'volunteer' ? `<div class="panel"><fieldset style="border:0;padding:0;margin:0"><legend><h3>How would you like to help?</h3></legend>${chipBoxes('interests', INTERESTS)}</fieldset>
        <fieldset style="border:0;padding:0;margin:10px 0 0"><legend><h3>When are you usually free?</h3></legend>${chipBoxes('availability', FREE_WHEN)}</fieldset></div>` : ''}
      <div class="panel">
        ${kind !== 'volunteer' ? `<label class="field"><span>${kind === 'organizer' ? 'Events or groups you’ve organized' : 'Moderation or community experience'}</span><textarea name="experience" maxlength="2000" required></textarea></label>` : ''}
        ${kind === 'organizer' ? '<label class="field"><span>Events you’d love to lead <span class="muted small">(optional)</span></span><textarea name="events" maxlength="2000"></textarea></label>' : ''}
        ${kind === 'moderator' ? '<label class="field"><span>Hours a week you can give <span class="muted small">(optional)</span></span><input type="text" name="hours" maxlength="40" placeholder="About 2"></label>' : ''}
        <label class="field"><span>${kind === 'volunteer' ? 'Anything you’d like us to know?' : 'Why do you want to help?'} <span class="muted small">(optional)</span></span><textarea name="about" maxlength="2000"></textarea></label>
        <label class="field"><span>How did you hear about us? <span class="muted small">(optional)</span></span><input type="text" name="heard" maxlength="200"></label>
        <label class="field"><span>Resume <span class="muted small">(optional · PDF, Word or photo, up to 10 MB)</span></span><input type="file" name="resume" accept="${RESUME_EXT}"></label>
      </div>
      <label class="check agree"><input type="checkbox" name="agree" required> <span>${h(APPLY_TERMS[kind])}</span></label>
      <p class="error" id="apperr" role="alert"></p>
      <div class="row"><button class="btn" type="submit">Send application</button><a class="btn ghost" href="#/about">Cancel</a></div>
      <p class="small muted">Only Phoenix Catalyst admins can see your application.</p>
    </form></div>`;
  const f = $('#appf'), err = $('#apperr');
  f.adult.onchange = () => { $('#minor').hidden = f.adult.checked; };
  f.resume.onchange = () => {
    const file = f.resume.files[0];
    err.textContent = file && file.size > RESUME_MAX ? FRIENDLY.resume_too_big : '';
  };
  f.addEventListener('submit', async (ev) => {
    ev.preventDefault(); err.textContent = '';
    const val = (n) => (f[n]?.value || '').trim();
    const picked = (n) => [...f.querySelectorAll(`[name=${n}]:checked`)].map((x) => x.value);
    if (val('name').length < 2) { err.textContent = 'Add your name.'; f.name.focus(); return; }
    if (kind === 'volunteer' && !picked('interests').length) { err.textContent = 'Pick at least one way you’d like to help.'; return; }
    if (kind !== 'volunteer' && val('experience').length < 10) { err.textContent = 'Tell us a little about your experience.'; f.experience.focus(); return; }
    const file = f.resume.files[0];
    if (file && file.size > RESUME_MAX) { err.textContent = FRIENDLY.resume_too_big; return; }
    if (!f.adult.checked) { err.textContent = 'You need to be 18 or older to apply.'; return; }
    if (!f.agree.checked) { err.textContent = 'Please agree to the guidelines.'; return; }
    const btn = f.querySelector('[type=submit]'); busy(btn, true, 'Sending…');
    let uploaded = null;
    try {
      const answers = { name: val('name'), phone: val('phone') || null, email: state.user.email ?? null, adult: f.adult.checked, about: val('about') || null, heard: val('heard') || null, agreed: APPLY_TERMS[kind] };
      if (kind === 'volunteer') Object.assign(answers, { interests: picked('interests'), availability: picked('availability') });
      if (kind === 'organizer') Object.assign(answers, { experience: val('experience'), events: val('events') || null });
      if (kind === 'moderator') Object.assign(answers, { experience: val('experience'), hours: val('hours') || null });
      if (file) {
        busy(btn, true, 'Uploading resume…');
        const ext = (file.name.split('.').pop() || 'pdf').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5) || 'pdf';
        const type = RESUME_TYPES.includes(file.type) ? file.type : 'application/pdf';
        const path = `${state.user.id}/${crypto.randomUUID()}.${ext}`;
        const { error: upErr } = await sb.storage.from('phoenix-resumes').upload(path, file, { contentType: type });
        if (upErr) throw upErr;
        uploaded = path;
        answers.resume = { path, name: file.name.slice(0, 120), size: file.size };
      }
      busy(btn, true, 'Sending…');
      const { error } = await sb.from('phoenix_applications').insert({ user_id: state.user.id, kind, answers });
      if (error) throw error;
      toast('Application sent! The team will get back to you here.');
      location.hash = '#/about';
    } catch (e2) {
      if (uploaded) await sb.storage.from('phoenix-resumes').remove([uploaded]);
      err.textContent = errText(e2); busy(btn, false);
    }
  });
}

const APP_LABELS = { name: 'Name', email: 'Email', phone: 'Phone', adult: '18 or older', interests: 'Wants to help with', availability: 'Free', experience: 'Experience', events: 'Would lead', hours: 'Hours a week', about: 'About', heard: 'Heard about us' };
const showAnswer = (v) => (Array.isArray(v) ? v.join(', ') : typeof v === 'boolean' ? (v ? 'Yes' : 'No') : String(v));

async function viewApplications() {
  const root = main();
  if (!isAdmin()) { root.innerHTML = '<div class="empty detail"><h2>Admins only</h2></div>'; return; }
  root.innerHTML = '<p class="muted pad">Loading…</p>';
  const { data, error } = await sb.from('phoenix_applications').select('*').eq('status', 'pending').order('created_at', { ascending: true });
  if (error) { root.innerHTML = `<div class="empty detail"><p class="error">${h(errText(error))}</p></div>`; return; }
  root.innerHTML = `<div class="detail"><h1>Applications</h1>
    ${data.length ? data.map((a) => `<div class="panel app" data-id="${a.id}">
      <div class="kicker">${KINDS[a.kind].emoji} ${h(KINDS[a.kind].title)}</div><h2>@${h(a.username || 'neighbor')}</h2>
      <p class="small muted">Applied ${h(fmtShort(a.created_at))}</p>
      <dl class="answers">${Object.entries(a.answers).filter(([k, v]) => k !== 'agreed' && k !== 'resume' && v !== null && v !== '' && !(Array.isArray(v) && !v.length))
        .map(([k, v]) => `<dt>${h(APP_LABELS[k] || k)}</dt><dd>${h(showAnswer(v))}</dd>`).join('')}</dl>
      ${a.answers.agreed ? '<p class="small muted">✓ Agreed to the guidelines</p>' : ''}
      ${a.answers.resume ? `<p><button type="button" class="btn small ghost" data-resume="${h(a.answers.resume.path)}">Open resume · ${h(a.answers.resume.name)}</button></p>` : ''}
      <label class="field"><span>Note to the applicant <span class="muted small">(optional)</span></span><textarea name="note" maxlength="1000"></textarea></label>
      <div class="row"><button class="btn" data-approve="1">Approve</button><button class="btn ghost" data-approve="0">Decline</button></div></div>`).join('')
      : '<div class="empty"><h2>No applications waiting</h2><p>New applications to volunteer, organize or moderate show up here.</p></div>'}</div>`;
  root.querySelectorAll('[data-resume]').forEach((b) => b.onclick = async () => {
    const win = window.open('', '_blank');
    const { data: link, error: e2 } = await sb.storage.from('phoenix-resumes').createSignedUrl(b.dataset.resume, 600);
    if (e2 || !link?.signedUrl) { win?.close(); toast(errText(e2 || new Error('That resume couldn’t be opened.'))); return; }
    if (win) win.location = link.signedUrl; else location.href = link.signedUrl;
  });
  root.querySelectorAll('[data-approve]').forEach((b) => b.onclick = async () => {
    const card = b.closest('.app'), approve = b.dataset.approve === '1';
    busy(b, true);
    const { error: e2 } = await sb.rpc('phoenix_review_application', { p_id: card.dataset.id, p_approve: approve, p_note: card.querySelector('[name=note]').value.trim() || null });
    if (e2) { toast(errText(e2)); busy(b, false); return; }
    toast(approve ? 'Approved' : 'Declined'); card.remove();
    if (!root.querySelector('.app')) viewApplications();
  });
}

/* ---------- about: volunteer hub, mission and donations ---------- */
/* ---------- community rules (same text as the app; agreed once before the first post or comment) ---------- */
const rulesHtml = () => `<p>${h(RULES.intro)}</p><ol class="panel" style="padding:14px 14px 14px 34px">${RULES.rules.map((r) => `<li style="margin:6px 0"><b>${h(r.title)}.</b> ${h(r.body)}</li>`).join('')}</ol><p class="small muted">${h(RULES.enforcement)}</p>`;
const rulesAgreed = () => { try { return Number(localStorage.getItem('pe.rulesAccepted') || 0) >= RULES.version; } catch { return false; } };
function agreeToRules() {
  if (rulesAgreed()) return Promise.resolve(true);
  return new Promise((done) => {
    const d = document.createElement('dialog');
    d.className = 'panel'; d.style.maxWidth = '640px';
    d.innerHTML = `<h2 style="margin-top:0">Community rules</h2>${rulesHtml()}<div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn" value="yes">I agree to the community rules</button><button class="btn ghost" value="no">Not now</button></div>`;
    d.querySelectorAll('button').forEach((b) => b.onclick = () => d.close(b.value));
    d.onclose = () => { const ok = d.returnValue === 'yes'; if (ok) { try { localStorage.setItem('pe.rulesAccepted', String(RULES.version)); } catch { /* private mode */ } } d.remove(); done(ok); };
    document.body.append(d); d.showModal();
  });
}
function viewRules() {
  document.title = 'Community rules · The Phoenix Catalyst';
  main().innerHTML = `<div class="detail"><h1>Community rules</h1>${rulesHtml()}</div>`;
}

function viewFaq() {
  document.title = 'Questions & answers · The Phoenix Catalyst';
  main().innerHTML = `<div class="detail"><h1>Questions &amp; answers</h1>${FAQ.map((s) => `<h2 style="margin-top:22px">${h(s.title)}</h2>${s.items.map((i) => `<details class="panel" style="margin:8px 0"><summary><b>${h(i.q)}</b></summary><p style="margin:10px 0 0">${h(i.a)}</p></details>`).join('')}`).join('')}
    <p class="small muted" style="margin-top:22px">Still have a question? Email <a href="mailto:ThePhoenixCatalyst@outlook.com">ThePhoenixCatalyst@outlook.com</a></p></div>`;
}

async function viewAbout() {
  const shifts = [...state.rsvps.values()].filter((k) => k === 'volunteer').length;
  main().innerHTML = `<div class="detail">
    <h1>The Phoenix Catalyst</h1>
    <p style="margin-top:12px;font-size:1.1rem">We strengthen mental, physical, emotional, and environmental well-being through community-driven events. Bringing color back into the world one community at a time.</p>
    <div id="campaign"></div>
    ${donateHtml()}
    <div class="sechead"><h2>Volunteer opportunities</h2><a href="#/" id="seevol" class="small">See all</a></div>
    ${shifts ? `<p class="small muted">You’re signed up for ${shifts} shift${shifts === 1 ? '' : 's'}. They’re in <a href="#/mine">My events</a>.</p>` : ''}
    <div id="volrail"><p class="muted small">Loading…</p></div>
    <h2 style="margin-top:26px">Get involved</h2>
    <div class="involve" id="involve"></div>
    <h2 style="margin-top:26px">What we do</h2>
    <p class="muted">We picture neighborhoods where people know and support one another, local spaces thrive, and home is where you truly thrive.</p>
    <div class="pillars">${CATS.filter((c) => c.pillar).map((c) => `<div class="pillar" data-cat="${c.key}"><span class="e" aria-hidden="true">${EMOJI[c.key]}</span><h3>${h(c.pillar)}</h3><p class="small" style="margin:0">${h({
      environmental: 'Cleanups, tree planting, trail care and nature outings that keep our shared spaces beautiful.',
      community: 'Food and donation drives, care visits, potlucks and swaps that rebuild ties between neighbors.',
      wellness: 'Walking and running groups, races, hikes and yoga that make movement accessible to everyone.',
      mental: 'Meditation, sound baths, journaling circles and awareness campaigns that support emotional resilience.' }[c.key])}</p></div>`).join('')}</div>
    <div class="row"><a class="btn ghost" href="#/add">Share a community event</a></div>
    <div class="panel"><h2>How posting works</h2>
      <p>Anyone with an account can post events, and they go live right away. Volunteer moderators review posts and remove anything that isn’t a real community event. If something looks wrong, open the event and choose Report a problem.</p></div>
  </div>`;
  $('#seevol').onclick = () => { Object.assign(state.filters, { tpc: true, when: 'upcoming' }); state.day = null; saveFilters(); };
  wireDonate($('#give'));
  paintCampaign($('#campaign'));
  if (state.scrollToGive) { state.scrollToGive = false; $('#give')?.scrollIntoView({ block: 'start' }); $('#give input')?.focus({ preventScroll: true }); }
  const [{ data: ev }, apps, pending] = await Promise.all([
    sb.from('phoenix_events').select('*').eq('is_tpc', true).eq('status', 'published').gte('starts_at', new Date().toISOString()).order('starts_at').limit(10),
    myApplications(),
    isAdmin() ? sb.from('phoenix_applications').select('id', { count: 'exact', head: true }).eq('status', 'pending') : Promise.resolve({ count: 0 }),
  ]);
  if (!$('#volrail')) return; // navigated away
  $('#volrail').innerHTML = ev?.length ? `<div class="rail">${ev.map(tile).join('')}</div>`
    : '<div class="panel"><p class="small muted" style="margin:0">No volunteer events are scheduled right now. Apply below and we’ll let you know when the next one is up.</p></div>';
  $('#involve').innerHTML = Object.entries(KINDS).map(([k, info]) => {
    const st = appStatus(k, apps[k]);
    const done = st && !st.startsWith('Not');
    return `<div class="panel gi"><span class="e" aria-hidden="true">${info.emoji}</span><div><h3>${h(info.title)}</h3><p class="small muted" style="margin:0">${h(st || info.blurb)}</p></div>
      ${done ? '' : `<a class="btn small" href="#/apply/${k}" aria-label="Apply: ${h(info.title)}">Apply</a>`}</div>`;
  }).join('') + (isAdmin() ? `<a class="btn quiet" href="#/applications">Review applications${pending.count ? ` (${pending.count})` : ''}</a>` : '')
    + '<a class="btn ghost" href="#/sources">Suggest a local organization’s calendar</a> <a class="btn quiet" href="#/faq">Questions &amp; answers</a> <a class="btn quiet" href="#/rules">Community rules</a>';
}

/* ---------- donations: how often → how much → card or PayPal (same flow as the website) ---------- */
const GIVE_SITE = 'https://thedragonflycatalyst.org', GIVE_PAYPAL = 'ThePhoenixCatalyst@outlook.com';
function donateHtml() {
  const seg = [['once', 'One time'], ['month', 'Monthly'], ['year', 'Yearly']];
  return `<form class="panel give" id="give" novalidate>
    <p class="kicker">🔥 Donate · tax-deductible</p>
    <h2 style="margin:2px 0 6px">Keep our events free</h2>
    <p class="muted" style="margin:0">Every dollar goes to free community events: cleanup supplies, saplings, food drive logistics, and space for group workouts and mental health gatherings.</p>
    <fieldset><legend><span class="step">1</span> How often?</legend><div class="seg">${seg.map(([k, l], i) => `<label><input type="radio" name="freq" value="${k}" ${i ? '' : 'checked'}><span>${l}</span></label>`).join('')}</div></fieldset>
    <fieldset><legend><span class="step">2</span> How much?</legend><div class="amts">${['10', '25', '50'].map((a) => `<label><input type="radio" name="amt" value="${a}" ${a === '25' ? 'checked' : ''}><span>$${a}</span></label>`).join('')}<label><input type="radio" name="amt" value="custom"><span>Custom amount</span></label></div>
      <label class="field" id="custwrap" hidden><span class="sr-only">Amount in dollars</span><input type="number" name="custom" min="5" max="10000" step="1" inputmode="decimal" placeholder="Amount in dollars"></label></fieldset>
    <fieldset><legend><span class="step">3</span> How would you like to give?</legend>
      <p id="givesum" style="margin:0 0 10px"></p>
      <div class="row"><button class="btn glow" type="submit" value="card">Card, Google Pay or Apple Pay</button><button class="btn ghost" type="submit" value="paypal">PayPal</button></div>
      <p class="error" id="giveerr" role="alert"></p></fieldset>
    <p class="small muted" style="margin:0">Monthly and yearly gifts can be cancelled any time. PayPal repeat gifts need a PayPal login. Minimum $5. The Phoenix Catalyst Inc is a 501(c)(3) nonprofit (EIN 41-3050300); you’ll get an emailed receipt for your records. No goods or services are given in exchange for donations.</p>
    <p class="small" style="margin:8px 0 0"><a href="${GIVE_SITE}/phoenix-catalyst/receipts" target="_blank" rel="noopener">Look up past donations and download receipts →</a></p>
    <p class="small muted" style="margin:8px 0 0">A copy of the current financial statement of The Phoenix Catalyst Inc is available by writing to 7428 Oakland Mills Rd, Columbia, MD 21046. Documents and information submitted under the Maryland Solicitations Act are also available, for the cost of postage and copies, from the Maryland Secretary of State, State House, Annapolis, MD 21401, (410) 974-5534.</p>
  </form>`;
}
function wireDonate(f) {
  if (!f) return;
  const words = { once: 'one time', month: 'every month', year: 'every year' };
  const amount = () => {
    const v = f.amt.value === 'custom' ? Number(f.custom.value) : Number(f.amt.value);
    return Number.isFinite(v) && v >= 5 && v <= 10000 ? Math.round(v * 100) / 100 : null;
  };
  const update = () => {
    $('#custwrap', f).hidden = f.amt.value !== 'custom';
    const a = amount();
    $('#givesum', f).textContent = a ? `You’re giving $${a % 1 ? a.toFixed(2) : a} ${words[f.freq.value]}.` : 'Enter an amount of $5 or more.';
  };
  f.addEventListener('change', (e) => { update(); if (e.target.value === 'custom') f.custom.focus(); });
  f.addEventListener('input', update); update();
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('#giveerr', f); err.textContent = '';
    const a = amount(), freq = f.freq.value, how = e.submitter?.value || 'card';
    if (!a) { err.textContent = 'Enter an amount of $5 or more.'; return; }
    if (how === 'paypal') {
      const q = { business: GIVE_PAYPAL, currency_code: 'USD', no_shipping: '1', return: `${GIVE_SITE}/phoenix-catalyst/thank-you`, cancel_return: `${GIVE_SITE}/phoenix-catalyst#donate`, notify_url: `${GIVE_SITE}/api/paypal-ipn` };
      const url = freq === 'once'
        ? `https://www.paypal.com/donate/?${new URLSearchParams({ ...q, amount: a.toFixed(2), item_name: 'Donation to The Phoenix Catalyst', no_recurring: '1' })}`
        : `https://www.paypal.com/cgi-bin/webscr?${new URLSearchParams({ ...q, cmd: '_xclick-subscriptions', a3: a.toFixed(2), p3: '1', t3: freq === 'month' ? 'M' : 'Y', src: '1', item_name: `${freq === 'month' ? 'Monthly' : 'Yearly'} donation to The Phoenix Catalyst` })}`;
      location.href = url; return;
    }
    const btn = e.submitter; busy(btn, true, 'One moment…');
    try {
      const r = await fetch(`${GIVE_SITE}/api/donate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ amount: a, frequency: freq }) });
      const j = await r.json();
      if (!j.url) throw new Error(j.error || 'Card checkout isn’t available right now. Please try PayPal, or try again shortly.');
      location.href = j.url;
    } catch (x) { err.textContent = /fetch|network/i.test(x.message) ? 'Card checkout isn’t available right now. Please try PayPal, or try again shortly.' : x.message; busy(btn, false); }
  });
}

/* ---------- local organizations whose calendars we import ---------- */
async function viewSources() {
  const leader = canTpc();
  main().innerHTML = `<div class="detail"><h1>Local organizations</h1>
    <p>We bring in events from local organizations’ own calendars automatically, so you don’t have to check a dozen websites.</p>
    <form class="panel" id="srcf" novalidate><h2>${leader ? 'Add an organization' : 'Suggest an organization'}</h2>
      <label class="field"><span>Organization</span><input type="text" name="name" maxlength="120" placeholder="Howard County Library" required></label>
      <label class="field"><span>Their events page</span><input name="website" type="url" maxlength="500" placeholder="https://…/events" required></label>
      <label class="field"><span>Calendar feed link <span class="muted small">(optional, iCal or “Add to calendar” link)</span></span><input name="feed" type="url" maxlength="500"></label>
      <label class="field"><span>Why they’re a good fit <span class="muted small">(optional)</span></span><textarea name="note" maxlength="1000"></textarea></label>
      <p class="error" id="srcerr" role="alert"></p>
      <button class="btn" type="submit">${leader ? 'Add and import' : 'Send suggestion'}</button>
      ${leader ? '' : '<p class="small muted">Phoenix leaders review suggestions before their events appear.</p>'}</form>
    <div id="srclist"><p class="muted small">Loading…</p></div></div>`;
  const fix = (u) => { const t = (u || '').trim(); return t && !/^https?:\/\//i.test(t) ? `https://${t}` : t; };
  const ago = (iso) => { if (!iso) return 'not yet'; const m = Math.round((Date.now() - Date.parse(iso)) / 60000); return m < 60 ? `${Math.max(1, m)} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; };
  const invoke = async (body) => { const { data, error } = await sb.functions.invoke('phoenix-import', { body }); if (error) throw error; return data; };
  const run = async (s) => { const r = await invoke({ source_id: s.id }); const x = r.results?.[0]; if (x?.error) throw new Error(x.error); return `${x?.added ?? 0} added, ${x?.updated ?? 0} updated`; };
  const paint = async () => {
    const { data, error } = await sb.from('phoenix_sources').select('*').order('name');
    const box = $('#srclist'); if (!box) return;
    if (error) { box.innerHTML = `<p class="error">${h(errText(error))}</p>`; return; }
    const groups = [['Waiting for review', 'suggested'], ['Calendars we follow', 'active'], ['Paused', 'paused']];
    box.innerHTML = groups.map(([title, st]) => {
      const items = data.filter((s) => s.status === st); if (!items.length) return '';
      return `<h2 style="margin-top:22px">${title}</h2>` + items.map((s) => `<div class="panel" data-id="${s.id}">
        <h3 style="margin:0">${h(s.name)}${st === 'suggested' ? ' <span class="badge">Suggested</span>' : ''}</h3>
        <p class="small" style="margin:2px 0"><a href="${h(s.website)}" target="_blank" rel="noopener nofollow">${h(s.website.replace(/^https?:\/\/(www\.)?/, ''))}</a></p>
        ${s.note ? `<p class="small muted" style="margin:4px 0">${h(s.note)}</p>` : ''}
        ${st === 'suggested' && s.suggested_by_username ? `<p class="small muted" style="margin:4px 0">Suggested by @${h(s.suggested_by_username)}</p>` : ''}
        ${leader && st !== 'suggested' ? `<p class="small muted" style="margin:4px 0">${s.last_error ? `⚠️ Last check ${ago(s.last_run_at)}: ${h(s.last_error)}` : s.last_run_at ? `Checked ${ago(s.last_run_at)} · ${s.last_count ?? 0} events${s.last_method ? ` · ${h(s.last_method)}` : ''}` : 'Not checked yet'}</p>` : ''}
        <div class="pv"></div>
        ${leader ? `<div class="row">${st === 'suggested' ? '<button class="btn small ghost" data-act="preview">Preview</button><button class="btn small" data-act="active">Approve</button><button class="btn small quiet" data-act="rejected">Decline</button>'
          : st === 'active' ? '<button class="btn small ghost" data-act="run">Check now</button><button class="btn small quiet" data-act="paused">Pause</button>'
          : '<button class="btn small ghost" data-act="active">Resume</button>'}</div>` : ''}
      </div>`).join('');
    }).join('');
    box.onclick = async (ev) => {
      const b = ev.target.closest('[data-act]'); if (!b) return;
      const card = b.closest('[data-id]'); const s = data.find((x) => x.id === card.dataset.id); const act = b.dataset.act;
      busy(b, true, '…');
      try {
        if (act === 'preview') {
          const r = await invoke({ preview: s.website, feed: s.feed_url || undefined });
          $('.pv', card).innerHTML = `<div class="panel" style="background:var(--soft)">${r.error ? `⚠️ ${h(r.error)}` : `<b>Found ${r.count} upcoming event${r.count === 1 ? '' : 's'}${r.method ? ` (${h(r.method)})` : ''}</b>${(r.sample || []).map((e) => `<br><span class="small">• ${h(fmtDay(e.starts_at))}: ${h(e.title)}</span>`).join('')}`}</div>`;
          busy(b, false); return;
        }
        if (act === 'run') { toast(`${s.name}: ${await run(s)}`); }
        else {
          if (act === 'paused' && !confirm(`Pause ${s.name}? New events stop coming in; events already imported stay.`)) { busy(b, false); return; }
          const { error } = await sb.from('phoenix_sources').update({ status: act }).eq('id', s.id); if (error) throw error;
          toast(act === 'active' ? `Approved ${s.name}. Importing its events…` : act === 'paused' ? `Paused ${s.name}` : 'Suggestion declined');
          if (act === 'active') toast(`${s.name}: ${await run(s)}`);
        }
      } catch (x) { toast(errText(x)); }
      paint();
    };
  };
  $('#srcf').onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target, err = $('#srcerr'); err.textContent = '';
    if (!requireUser('Sign in to suggest an organization.')) return;
    if (f.name.value.trim().length < 2) { err.textContent = 'Add the organization’s name.'; return; }
    if (!/\./.test(f.website.value)) { err.textContent = 'Add their website or events page.'; return; }
    const btn = f.querySelector('[type=submit]'); busy(btn, true, 'Sending…');
    const { data: s, error } = await sb.from('phoenix_sources').insert({ name: f.name.value.trim(), website: fix(f.website.value), feed_url: f.feed.value.trim() ? fix(f.feed.value) : null, note: f.note.value.trim() || null, ...(leader ? { status: 'active' } : {}) }).select('*').single();
    busy(btn, false);
    if (error) { err.textContent = error.code === '23505' ? 'That website is already on the list.' : errText(error); return; }
    f.reset();
    if (s.status === 'active') { toast(`Added ${s.name}. Importing its events…`); run(s).then((r) => toast(`${s.name}: ${r}`), (x) => toast(`${s.name}: ${errText(x)}`)).finally(paint); }
    else toast('Thanks! Phoenix leaders will take a look.');
    paint();
  };
  paint();
}

/* ---------- router ---------- */
async function route() {
  const hash = location.hash.replace(/^#\/?/, '');
  const [page, id] = hash.split('/');
  document.title = 'The Phoenix Catalyst';
  const tab = { '': 'calendar', map: 'map', add: 'add', mine: 'mine', about: 'about', apply: 'about', sources: 'about', faq: 'about', rules: 'about' }[page] ?? '';
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
    else if (page === 'about') await viewAbout();
    else if (page === 'apply') await viewApply(id);
    else if (page === 'applications') await viewApplications();
    else if (page === 'sources') await viewSources();
    else if (page === 'faq') viewFaq();
    else if (page === 'rules') viewRules();
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
