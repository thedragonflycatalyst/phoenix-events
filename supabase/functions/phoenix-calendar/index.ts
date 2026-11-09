import { createClient } from 'npm:@supabase/supabase-js@2.57.0';

// Public iCalendar (RFC 5545) feeds for The Phoenix Catalyst community calendar.
//   ?event=<uuid>      one event (download / add to calendar)
//   ?feed=all | tpc    subscribable public feeds
//   ?token=<hex>       a user's private feed of events they're going to / volunteering at
// Calendar apps can't send auth headers, so this function checks the token itself.
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS' };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const APP_URL = Deno.env.get('PHOENIX_APP_URL') ?? 'https://thedragonflycatalyst.github.io/phoenix-events/';
const CATEGORY: Record<string, string> = { environmental: 'Environmental', community: 'Community', wellness: 'Physical Wellness', mental: 'Mental & Emotional', arts: 'Arts & Culture', other: 'Other' };

const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const utc = (d: string) => new Date(d).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const ymd = (d: string, tz: string) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(d)).replace(/-/g, '');
function fold(line: string): string {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const out: string[] = []; let cur = ''; let len = 0;
  for (const ch of line) {
    const n = new TextEncoder().encode(ch).length;
    if (len + n > (out.length ? 74 : 75)) { out.push(cur); cur = ''; len = 0; }
    cur += ch; len += n;
  }
  out.push(cur);
  return out.join('\r\n ');
}

type Ev = { id: string; title: string; description: string | null; starts_at: string; ends_at: string | null; all_day: boolean; timezone: string;
  location_name: string | null; address: string | null; lat: number | null; lng: number | null; category: string; organizer: string | null;
  url: string | null; is_tpc: boolean; updated_at: string; status: string };

function vevent(e: Ev): string[] {
  const link = `${APP_URL}#/event/${e.id}`;
  const desc = [e.description ?? '', e.organizer ? `Hosted by: ${e.organizer}` : '', e.url ? `More info: ${e.url}` : '', `Community calendar: ${link}`].filter(Boolean).join('\n\n');
  const loc = [e.location_name, e.address].filter(Boolean).join(', ');
  const L = ['BEGIN:VEVENT', `UID:${e.id}@phoenix-catalyst-events`, `DTSTAMP:${utc(e.updated_at)}`];
  if (e.all_day) {
    const start = ymd(e.starts_at, e.timezone);
    const endBase = new Date(e.ends_at ?? e.starts_at); endBase.setUTCDate(endBase.getUTCDate() + 1);
    L.push(`DTSTART;VALUE=DATE:${start}`, `DTEND;VALUE=DATE:${ymd(endBase.toISOString(), e.timezone)}`);
  } else {
    L.push(`DTSTART:${utc(e.starts_at)}`, `DTEND:${utc(e.ends_at ?? new Date(new Date(e.starts_at).getTime() + 3600_000).toISOString())}`);
  }
  L.push(`SUMMARY:${esc((e.is_tpc ? '🔥 ' : '') + e.title)}`, `DESCRIPTION:${esc(desc)}`, `URL:${link}`, `CATEGORIES:${esc(CATEGORY[e.category] ?? 'Community')}`);
  if (loc) L.push(`LOCATION:${esc(loc)}`);
  if (e.lat != null && e.lng != null) L.push(`GEO:${e.lat};${e.lng}`);
  if (e.status !== 'published') L.push('STATUS:CANCELLED');
  L.push('END:VEVENT');
  return L;
}

function calendar(name: string, events: Ev[]): string {
  const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//The Phoenix Catalyst//Community Events//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    `X-WR-CALNAME:${esc(name)}`, 'X-WR-TIMEZONE:America/New_York', 'REFRESH-INTERVAL;VALUE=DURATION:PT6H', 'X-PUBLISHED-TTL:PT6H'];
  for (const e of events) L.push(...vevent(e));
  L.push('END:VCALENDAR');
  return L.map(fold).join('\r\n') + '\r\n';
}

const COLS = 'id,title,description,starts_at,ends_at,all_day,timezone,location_name,address,lat,lng,category,organizer,url,is_tpc,updated_at,status';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'GET' && req.method !== 'HEAD') return new Response('', { status: 405, headers: cors });
  const u = new URL(req.url);
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const since = new Date(Date.now() - 30 * 86400_000).toISOString();
  let name = 'Phoenix Catalyst Community Events';
  let events: Ev[] = [];
  let filename = 'phoenix-events.ics';
  try {
    const eventId = u.searchParams.get('event');
    const feed = u.searchParams.get('feed');
    const token = u.searchParams.get('token');
    if (eventId) {
      if (!UUID.test(eventId)) return new Response('Not found', { status: 404, headers: cors });
      const { data } = await admin.from('phoenix_events').select(COLS).eq('id', eventId).eq('status', 'published').maybeSingle();
      if (!data) return new Response('Not found', { status: 404, headers: cors });
      events = [data as Ev]; filename = 'event.ics';
    } else if (token) {
      if (!/^[0-9a-f]{48}$/.test(token)) return new Response('Not found', { status: 404, headers: cors });
      const { data: t } = await admin.from('phoenix_calendar_tokens').select('user_id').eq('token', token).maybeSingle();
      if (!t) return new Response('Not found', { status: 404, headers: cors });
      const { data } = await admin.from('phoenix_rsvps').select(`phoenix_events!inner(${COLS})`).eq('user_id', t.user_id)
        .gte('phoenix_events.starts_at', since).limit(500);
      // removed events stay in the feed as CANCELLED so calendars drop them
      events = (data ?? []).map((r: any) => r.phoenix_events as Ev);
      name = 'My Phoenix Catalyst Events';
    } else if (feed === 'all' || feed === 'tpc') {
      let q = admin.from('phoenix_events').select(COLS).eq('status', 'published').gte('starts_at', since).order('starts_at').limit(1000);
      if (feed === 'tpc') { q = q.eq('is_tpc', true); name = 'The Phoenix Catalyst Volunteer Events'; }
      const { data, error } = await q;
      if (error) throw error;
      events = (data ?? []) as Ev[];
    } else {
      return new Response('Use ?event=, ?feed=all, ?feed=tpc or ?token=', { status: 400, headers: cors });
    }
  } catch {
    return new Response('Calendar temporarily unavailable', { status: 503, headers: cors });
  }
  return new Response(calendar(name, events), { headers: { ...cors, 'Content-Type': 'text/calendar; charset=utf-8',
    'Content-Disposition': `inline; filename="${filename}"`, 'Cache-Control': 'public, max-age=300' } });
});
