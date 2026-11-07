// Year-end campaign banner and progress bar ("Bring Color Back").
// Pure functions only (no DOM, no network), so they run the same in the browser and in `node --test`.
//
// Money rule: progress counts ONLY The Phoenix Catalyst's own donation records (ledger "phoenix",
// category "Donations"). Anything else is dropped, and a progress feed that is not explicitly the
// Phoenix ledger for this campaign is ignored (the banner then shows no numbers rather than wrong ones).

export const PHOENIX_LEDGER = 'phoenix';
export const DONATION_CATEGORY = 'Donations';

const isCount = (n) => Number.isInteger(n) && n >= 0;

export const usd = (cents) => new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'USD', maximumFractionDigits: cents % 100 ? 2 : 0,
}).format(cents / 100);

// Where the campaign is right now: 'off' (flag off or bad config), 'before', 'live' or 'after'.
export function phase(c, now = new Date()) {
  if (!c || c.enabled !== true) return 'off';
  const start = Date.parse(c.starts_at), end = Date.parse(c.ends_at);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || !isCount(c.goal_cents) || c.goal_cents === 0) return 'off';
  const t = now.getTime();
  return t < start ? 'before' : t > end ? 'after' : 'live';
}

// Reference total from raw ledger rows: { ledger, category, amount_cents, donor_key, date }.
// Refunds are negative rows on the same ledger, so they lower the total. Donors are counted once each.
export function summarizeDonations(rows, c) {
  const start = Date.parse(c.starts_at), end = Date.parse(c.ends_at);
  let raised = 0;
  const donors = new Set();
  for (const r of rows || []) {
    if (r?.ledger !== PHOENIX_LEDGER || r.category !== DONATION_CATEGORY) continue;
    if (!Number.isInteger(r.amount_cents)) continue;
    const t = Date.parse(r.date);
    if (!Number.isFinite(t) || t < start || t > end) continue;
    raised += r.amount_cents;
    if (r.amount_cents > 0 && r.donor_key) donors.add(String(r.donor_key).toLowerCase());
  }
  return { ledger: PHOENIX_LEDGER, campaign: c.id, raised_cents: Math.max(0, raised), donors: donors.size };
}

// Validates the public progress feed: { ledger: "phoenix", campaign: <id>, raised_cents, donors }.
// Returns null for anything else, including a feed from any non-Phoenix ledger.
export function parseProgress(json, c) {
  if (!json || typeof json !== 'object') return null;
  if (json.ledger !== PHOENIX_LEDGER || json.campaign !== c.id) return null;
  if (!isCount(json.raised_cents) || !isCount(json.donors)) return null;
  return { raised_cents: json.raised_cents, donors: json.donors };
}

// The progress feed may only be a Phoenix endpoint (path contains /phoenix), over https.
export function progressUrlAllowed(url) {
  if (!url) return false;
  try { const u = new URL(url); return u.protocol === 'https:' && /\/phoenix(?:[-/]|$)/i.test(u.pathname); } catch { return false; }
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

// Banner markup. progress is { raised_cents, donors } or null (unknown: no numbers shown).
// No countdowns and no urgency copy, by design.
export function bannerHtml(c, progress, now = new Date()) {
  const p = phase(c, now);
  if (p !== 'live' && p !== 'after') return '';
  const t = c.copy;
  if (p === 'after') {
    if (!progress || progress.donors === 0) return '';
    return `<section class="campaign" aria-labelledby="campaign-h"><h2 id="campaign-h">${esc(t.title)}</h2>
      <p class="campaign-line">${esc(t.after.replace('{count}', progress.donors).replace('{raised}', usd(progress.raised_cents)))}</p></section>`;
  }
  let meter = '';
  if (progress) {
    const pct = Math.min(100, Math.round((progress.raised_cents / c.goal_cents) * 100));
    const text = progress.donors === 0
      ? t.empty
      : `${usd(progress.raised_cents)} raised of ${usd(c.goal_cents)} · ${progress.donors} ${progress.donors === 1 ? 'supporter' : 'supporters'}`;
    meter = `<div class="campaign-bar" role="progressbar" aria-label="Campaign progress" aria-valuemin="0" aria-valuemax="${c.goal_cents / 100}" aria-valuenow="${Math.min(progress.raised_cents, c.goal_cents) / 100}" aria-valuetext="${esc(text)}"><span style="width:${pct}%"></span></div>
      <p class="campaign-progress">${esc(text)}</p>`;
  }
  return `<section class="campaign" aria-labelledby="campaign-h">
    <h2 id="campaign-h">${esc(t.title)}</h2>
    <p class="campaign-line">${esc(t.line)}</p>
    ${meter}
    <button type="button" class="btn glow" data-campaign-give>${esc(t.button)}</button>
    <p class="small campaign-fine">${esc(t.small)}</p>
  </section>`;
}
