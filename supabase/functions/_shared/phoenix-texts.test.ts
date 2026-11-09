import nodeAssert from 'node:assert/strict';
const assert = (c: unknown, m?: string) => nodeAssert.ok(c, m);
const assertEquals = (a: unknown, b: unknown, m?: string) => nodeAssert.deepStrictEqual(a, b, m);
import { safeEqual, normPhone, parseReply, reminderText, sendAt, twilioSignature, twiml, zoned } from './phoenix-texts.ts';

const tz = 'America/New_York';

Deno.test('zoned handles EST and EDT', () => {
  assertEquals(zoned(2026, 11, 14, 9, 0, tz).toISOString(), '2026-11-14T14:00:00.000Z');
  assertEquals(zoned(2026, 7, 4, 9, 0, tz).toISOString(), '2026-07-04T13:00:00.000Z');
});

Deno.test('main reminder: 9 AM the day before, or now if signed up late with 3+ hours to go', () => {
  const start = zoned(2026, 11, 14, 9, 0, tz); // Sat 9 AM
  assertEquals(sendAt('main', start, tz, new Date('2026-11-10T12:00:00Z'))?.toISOString(), '2026-11-13T14:00:00.000Z');
  const late = new Date('2026-11-13T20:00:00Z');
  assertEquals(sendAt('main', start, tz, late)?.toISOString(), late.toISOString());
  assertEquals(sendAt('main', start, tz, new Date('2026-11-14T12:30:00Z')), null); // 1.5 h before: too late
  // month boundary: Dec 1 event → Nov 30 at 9 AM
  assertEquals(sendAt('main', zoned(2026, 12, 1, 18, 0, tz), tz, new Date('2026-11-20T12:00:00Z'))?.toISOString(), '2026-11-30T14:00:00.000Z');
});

Deno.test('day-of note only for events at 10 AM or later, not all-day ones', () => {
  const now = new Date('2026-11-10T12:00:00Z');
  assertEquals(sendAt('dayof', zoned(2026, 11, 14, 9, 0, tz), tz, now), null);
  assertEquals(sendAt('dayof', zoned(2026, 11, 14, 13, 0, tz), tz, now)?.toISOString(), '2026-11-14T13:00:00.000Z');
  assertEquals(sendAt('dayof', zoned(2026, 11, 14, 13, 0, tz), tz, now, true), null);
});

Deno.test('reminder text: registered sample shape, one segment, no emoji', () => {
  const t = reminderText('main', { title: 'Park Cleanup', start: zoned(2026, 11, 14, 9, 0, tz), tz, place: 'Lake Kittamaqundi' });
  assertEquals(t, "The Phoenix Catalyst: Reminder: Park Cleanup is tomorrow, Sat, Nov 14 at 9:00 AM at Lake Kittamaqundi. Reply CONFIRM, or CANT GO if you can't make it. Reply STOP to opt out.");
  const v = reminderText('main', { title: 'A very long community garden planting and mulching day for everyone', start: zoned(2026, 11, 14, 9, 0, tz), tz, place: 'Wilde Lake Park Amphitheater and Boat Launch', volunteer: true });
  assert(v.includes('Your volunteer shift for'));
  assert(v.length <= 306, String(v.length)); // at most two plain segments
  assert(!/[^\x00-\x7F…]/.test(v));
  assertEquals(reminderText('dayof', { title: 'Food Drive', start: zoned(2026, 11, 14, 13, 30, tz), tz }), 'The Phoenix Catalyst: See you today at 1:30 PM for Food Drive!');
});

Deno.test('replies', () => {
  for (const s of ['CONFIRM', 'confirm!', 'Yes', 'y', "I'll be there"]) assertEquals(parseReply(s), 'confirm', s);
  for (const s of ["CAN'T GO", 'cant go', 'Can’t make it', 'not going', 'No']) assertEquals(parseReply(s), 'cant_go', s);
  for (const s of ['STOP', 'cancel', 'Unsubscribe']) assertEquals(parseReply(s), 'stop', s);
  assertEquals(parseReply('start'), 'start');
  assertEquals(parseReply('help'), 'help');
  assertEquals(parseReply('what time does it start?'), 'other');
});

Deno.test('phones', () => {
  assertEquals(normPhone('(410) 555-0134'), '+14105550134');
  assertEquals(normPhone('+1 410 555 0134'), '+14105550134');
  assertEquals(normPhone('555-0134'), null);
  assertEquals(normPhone('+44 20 7946 0958'), null);
});

Deno.test('Twilio signature (HMAC-SHA1 of URL + sorted params)', async () => {
  // Synthetic token; expected value cross-checked with Python's hmac/hashlib
  const sig = await twilioSignature('12345', 'https://mycompany.com/myapp.php?foo=1&bar=2',
    { CallSid: 'CA1234567890ABCDE', Caller: '+12349013030', Digits: '1234', From: '+12349013030', To: '+18005551212' });
  assertEquals(sig, '0/KCTR6DLpKmkAf8muzZqo1nDgQ=');
  assert(safeEqual('abc', 'abc') && !safeEqual('abc', 'abd') && !safeEqual('abc', 'ab'));
  assertEquals(twiml('a & b'), '<?xml version="1.0" encoding="UTF-8"?><Response><Message>a &amp; b</Message></Response>');
});
