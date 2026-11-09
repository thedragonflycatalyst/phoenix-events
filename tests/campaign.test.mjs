import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CAMPAIGN } from '../config.js';
import { phase, summarizeDonations, parseProgress, progressUrlAllowed, bannerHtml, usd } from '../campaign.js';

const on = { ...CAMPAIGN, enabled: true };
const LIVE = new Date('2026-12-10T12:00:00-05:00');
const BEFORE = new Date('2026-11-30T23:00:00-05:00');
const AFTER = new Date('2027-01-02T12:00:00-05:00');

test('feature flag is off by default and an off campaign renders nothing', () => {
  assert.equal(CAMPAIGN.enabled, false);
  assert.equal(phase(CAMPAIGN, LIVE), 'off');
  assert.equal(bannerHtml(CAMPAIGN, { raised_cents: 1000, donors: 1 }, LIVE), '');
});

test('the goal comes from the one setting (goal_cents)', () => {
  assert.equal(CAMPAIGN.goal_cents, 500000);
  const html = bannerHtml({ ...on, goal_cents: 700000 }, { raised_cents: 10000, donors: 2 }, LIVE);
  assert.match(html, /\$100 raised of \$7,000/);
});

test('phases: before, live, after; bad config is off', () => {
  assert.equal(phase(on, BEFORE), 'before');
  assert.equal(phase(on, LIVE), 'live');
  assert.equal(phase(on, AFTER), 'after');
  assert.equal(bannerHtml(on, null, BEFORE), '');
  assert.equal(phase({ ...on, goal_cents: 0 }, LIVE), 'off');
  assert.equal(phase({ ...on, ends_at: on.starts_at }, LIVE), 'off');
  assert.equal(phase({ ...on, enabled: 'true' }, LIVE), 'off');
});

test('progress total counts only Phoenix donation records', () => {
  const rows = [
    { ledger: 'phoenix', category: 'Donations', amount_cents: 2500, donor_key: 'A@x.org', date: '2026-12-01T10:00:00-05:00' },
    { ledger: 'phoenix', category: 'Donations', amount_cents: 1000, donor_key: 'a@x.org', date: '2026-12-02' },
    { ledger: 'phoenix', category: 'Donations', amount_cents: 5000, donor_key: 'b@x.org', date: '2026-12-03' },
    { ledger: 'phoenix', category: 'Donations', amount_cents: -1000, donor_key: 'b@x.org', date: '2026-12-04' }, // refund
    { ledger: 'dragonfly', category: 'Donations', amount_cents: 99900, donor_key: 'c@x.org', date: '2026-12-05' },
    { ledger: 'dragonfly', category: 'Sales', amount_cents: 12000, donor_key: 'd@x.org', date: '2026-12-05' },
    { ledger: 'phoenix', category: 'Grants', amount_cents: 40000, donor_key: 'e@x.org', date: '2026-12-05' },
    { ledger: 'phoenix', category: 'Donations', amount_cents: 7000, donor_key: 'f@x.org', date: '2026-11-30' }, // before start
    { ledger: 'phoenix', category: 'Donations', amount_cents: 7000, donor_key: 'g@x.org', date: '2027-01-01T00:00:01-05:00' }, // after end
    { ledger: 'phoenix', category: 'Donations', amount_cents: '500', donor_key: 'h@x.org', date: '2026-12-06' }, // not an integer
    null,
  ];
  assert.deepEqual(summarizeDonations(rows, on), { ledger: 'phoenix', campaign: on.id, raised_cents: 7500, donors: 2 });
  assert.deepEqual(summarizeDonations([], on), { ledger: 'phoenix', campaign: on.id, raised_cents: 0, donors: 0 });
});

test('progress feed is accepted only from the Phoenix ledger for this campaign', () => {
  const ok = { ledger: 'phoenix', campaign: on.id, raised_cents: 12345, donors: 3 };
  assert.deepEqual(parseProgress(ok, on), { raised_cents: 12345, donors: 3 });
  assert.equal(parseProgress({ ...ok, ledger: 'dragonfly' }, on), null);
  assert.equal(parseProgress({ ...ok, ledger: undefined }, on), null);
  assert.equal(parseProgress({ ...ok, campaign: 'other' }, on), null);
  assert.equal(parseProgress({ ...ok, raised_cents: -1 }, on), null);
  assert.equal(parseProgress({ ...ok, donors: 1.5 }, on), null);
  assert.equal(parseProgress(null, on), null);
  assert.equal(parseProgress('x', on), null);
});

test('progress URL must be an https Phoenix endpoint', () => {
  assert.equal(progressUrlAllowed(''), false);
  assert.equal(progressUrlAllowed('https://example.org/api/phoenix/campaign-progress'), true);
  assert.equal(progressUrlAllowed('https://example.org/api/phoenix-campaign'), true);
  assert.equal(progressUrlAllowed('http://example.org/api/phoenix/campaign'), false);
  assert.equal(progressUrlAllowed('https://example.org/api/books/summary'), false);
  assert.equal(progressUrlAllowed('https://example.org/api/dragonfly/phoenixish'), false);
  assert.equal(progressUrlAllowed('not a url'), false);
});

test('no Dragonfly account, key or secret is referenced by the campaign code or settings', () => {
  const sources = [readFileSync(new URL('../campaign.js', import.meta.url), 'utf8'), JSON.stringify(CAMPAIGN)];
  for (const src of sources) {
    assert.doesNotMatch(src, /dragonfly/i, 'Dragonfly reference in campaign code or settings');
    assert.doesNotMatch(src, /\b(sk|rk|pk)_(live|test)_[A-Za-z0-9]+/, 'Stripe key in campaign code or settings');
    assert.doesNotMatch(src, /whsec_|acct_[A-Za-z0-9]{8,}|plink_|service_role/i, 'Stripe account, webhook secret or service key');
  }
});

test('live banner: text equivalent for the progress bar, copy, no countdown', () => {
  const html = bannerHtml(on, { raised_cents: 125000, donors: 18 }, LIVE);
  assert.match(html, /role="progressbar"/);
  assert.match(html, /aria-valuemin="0" aria-valuemax="5000" aria-valuenow="1250"/);
  assert.match(html, /aria-valuetext="\$1,250 raised of \$5,000 · 18 supporters"/);
  assert.match(html, /<p class="campaign-progress">\$1,250 raised of \$5,000 · 18 supporters<\/p>/);
  assert.match(html, /Help us find our first 75 supporters by Dec 31\./);
  assert.match(html, /Give to Bring Color Back/);
  assert.match(html, /Any amount from \$5\. The calendar stays free either way\./);
  assert.match(html, /style="width:25%"/);
  assert.doesNotMatch(html, /countdown|days left|hours left|only \d+ left|last chance/i);
});

test('progress bar caps at 100% and singular supporter', () => {
  const html = bannerHtml(on, { raised_cents: 900000, donors: 1 }, LIVE);
  assert.match(html, /width:100%/);
  assert.match(html, /aria-valuenow="5000"/);
  assert.match(html, /1 supporter"/);
});

test('empty state and unknown progress', () => {
  assert.match(bannerHtml(on, { raised_cents: 0, donors: 0 }, LIVE), /Be our first supporter\./);
  const unknown = bannerHtml(on, null, LIVE);
  assert.doesNotMatch(unknown, /progressbar|raised/);
  assert.match(unknown, /Give to Bring Color Back/);
});

test('after the campaign: thank-you line, no give button', () => {
  const html = bannerHtml(on, { raised_cents: 512000, donors: 80 }, AFTER);
  assert.match(html, /Thank you\. 80 neighbors raised \$5,120 in December\./);
  assert.doesNotMatch(html, /data-campaign-give/);
  assert.equal(bannerHtml(on, null, AFTER), '');
});

test('copy is escaped', () => {
  const html = bannerHtml({ ...on, copy: { ...on.copy, title: '<img src=x onerror=alert(1)>' } }, null, LIVE);
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;img/);
});

test('usd formatting', () => {
  assert.equal(usd(500000), '$5,000');
  assert.equal(usd(1050), '$10.50');
});
