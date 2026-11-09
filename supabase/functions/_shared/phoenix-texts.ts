// Phoenix event texts: wording, timing and reply parsing. Pure, so it's tested (phoenix-texts.test.ts).
// Owner, Nov 9 2026: like the Coach app's reminders, for people who RSVP'd or signed up to volunteer.
// Wording matches what was registered with the carriers (thedragonflycatalyst.org/phoenix-catalyst/sms-terms).

export type Stage = 'main' | 'dayof';
export type Reply = 'confirm' | 'cant_go' | 'stop' | 'start' | 'help' | 'other';

export const BRAND = 'The Phoenix Catalyst';
export const CONFIRM_REPLY = 'Perfect! See you there 😁';
export const CANT_GO_REPLY = "That's too bad, thanks for letting us know! We've opened your spot for someone else.";
export const VOLUNTEER_CANT_GO_REPLY = "That's too bad, thanks for letting us know! We've opened your volunteer spot for someone else.";
export const NOTHING_TO_CONFIRM = "Thanks! We couldn't find an upcoming event for you in the next few days. You can check your events in The Phoenix Catalyst app.";
export const AUTOMATED_REPLY = 'Thanks! This number is automated, so please message us in The Phoenix Catalyst app or email thephoenixcatalyst@outlook.com.';

/** Parts of a date-time in a time zone */
function parts(d: Date, tz: string) {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', hour12: false });
  const o: Record<string, number> = {};
  for (const p of f.formatToParts(d)) if (p.type !== 'literal') o[p.type] = Number(p.value);
  return { y: o.year, m: o.month, d: o.day, h: o.hour % 24, mi: o.minute };
}

/** The instant that is y-m-d h:mi on the wall clock in tz */
export function zoned(y: number, m: number, d: number, h: number, mi: number, tz: string): Date {
  let t = Date.UTC(y, m - 1, d, h, mi);
  for (let i = 0; i < 3; i++) {
    const p = parts(new Date(t), tz);
    const diff = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi) - Date.UTC(y, m - 1, d, h, mi);
    if (diff === 0) break;
    t -= diff;
  }
  return new Date(t);
}

/**
 * When to send. main: 9:00 AM the day before (or right away if they signed up after that and it's still 3+ hours off).
 * dayof: 8:00 AM on the day, only if the event starts at 10:00 AM or later. null = don't send.
 */
export function sendAt(stage: Stage, start: Date, tz: string, now: Date, allDay = false): Date | null {
  const s = parts(start, tz);
  if (stage === 'main') {
    const prev = new Date(Date.UTC(s.y, s.m - 1, s.d) - 86400_000);
    const at = zoned(prev.getUTCFullYear(), prev.getUTCMonth() + 1, prev.getUTCDate(), 9, 0, tz);
    if (at > now) return at;
    return start.getTime() - now.getTime() >= 3 * 3600_000 ? now : null;
  }
  if (allDay || s.h < 10) return null;
  const at = zoned(s.y, s.m, s.d, 8, 0, tz);
  return at > now ? at : null;
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function when(start: Date, tz: string) {
  const p = parts(start, tz);
  const dow = DAYS[new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay()];
  const time = `${p.h % 12 || 12}:${String(p.mi).padStart(2, '0')} ${p.h < 12 ? 'AM' : 'PM'}`;
  return { day: `${dow}, ${MONTHS[p.m - 1]} ${p.d}`, time };
}
const clip = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, n - 1).trimEnd()}…`);

export type EventInfo = { title: string; start: Date; tz: string; place?: string | null; allDay?: boolean; volunteer?: boolean };

/** No emoji in reminders, so they stay one plain text segment */
export function reminderText(stage: Stage, e: EventInfo): string {
  const title = clip(e.title.trim(), 45);
  const w = when(e.start, e.tz);
  if (stage === 'dayof') return `${BRAND}: See you today at ${w.time} for ${title}!`;
  const at = e.allDay ? w.day : `${w.day} at ${w.time}`;
  const place = e.place ? ` at ${clip(e.place.trim(), 35)}` : '';
  const role = e.volunteer ? 'Your volunteer shift for ' : '';
  return `${BRAND}: Reminder: ${role}${title} is tomorrow, ${at}${place}. Reply CONFIRM, or CANT GO if you can't make it. Reply STOP to opt out.`;
}

/** What a reply means. STOP/START/HELP words are Twilio's (it answers those itself); we only record them. */
export function parseReply(body: string): Reply {
  const t = body.toUpperCase().replace(/[’'`]/g, '').replace(/[^A-Z ]/g, ' ').replace(/\s+/g, ' ').trim();
  if (/^(STOP|STOPALL|UNSUBSCRIBE|CANCEL|END|QUIT|REVOKE|OPTOUT)$/.test(t)) return 'stop';
  if (/^(START|UNSTOP)$/.test(t)) return 'start';
  if (/^(HELP|INFO)$/.test(t)) return 'help';
  if (/^(CONFIRM|CONFIRMED|C|YES|Y|YEP|YEAH|IM IN|ILL BE THERE|SEE YOU THERE)$/.test(t)) return 'confirm';
  if (/^(CANT GO|CANNOT GO|CANT MAKE IT|CANNOT MAKE IT|NOT GOING|NO|N|CANT COME|CANT)$/.test(t)) return 'cant_go';
  return 'other';
}

/** US numbers only, as +1XXXXXXXXXX, or null */
export function normPhone(s: string | null | undefined): string | null {
  const d = (s ?? '').replace(/[^0-9]/g, '');
  const ten = d.length === 11 && d.startsWith('1') ? d.slice(1) : d;
  return /^[2-9][0-9]{9}$/.test(ten) ? `+1${ten}` : null;
}

/** Twilio request signature: base64 HMAC-SHA1 of the URL plus sorted form params */
export async function twilioSignature(token: string, url: string, params: Record<string, string>): Promise<string> {
  const data = url + Object.keys(params).sort().map((k) => k + params[k]).join('');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(token), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data)));
  return btoa(String.fromCharCode(...sig));
}

/** Constant-time string compare for signatures */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let x = 0;
  for (let i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return x === 0;
}

export const twiml = (msg?: string) =>
  `<?xml version="1.0" encoding="UTF-8"?><Response>${msg ? `<Message>${msg.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</Message>` : ''}</Response>`;
