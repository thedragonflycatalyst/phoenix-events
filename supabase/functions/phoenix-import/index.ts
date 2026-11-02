// phoenix-import: pulls upcoming events from local organizations' websites into the Phoenix calendar.
//
// For each active source it tries, in order: the source's own calendar feed (iCal), a WordPress
// "The Events Calendar" API, a Timely calendar's iCal export, an iCal feed the page advertises, then
// schema.org Event data on the page and on up to 20 linked event pages. Events land through
// phoenix_import_events(), which skips anything already on the calendar and updates events it imported before.
//
// Called by: the 6-hourly cron job (x-cron-secret header), or a signed-in admin/organizer from the app:
//   POST {}                          → import every active source
//   POST {source_id}                 → import one source now
//   POST {preview: "https://…"}      → read a website without saving (used to check a suggestion)
import { createClient } from "jsr:@supabase/supabase-js@2";

const URL_ = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const UA = "Mozilla/5.0 (compatible; PhoenixCommunityCalendar/1.0; +https://thedragonflycatalyst.github.io/phoenix-events/)";
const DAYS_AHEAD = 120;
const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "authorization, apikey, content-type, x-cron-secret" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "content-type": "application/json" } });

type Item = {
  uid: string; title: string; description?: string | null; starts_at: string; ends_at?: string | null; all_day?: boolean;
  location_name?: string | null; address?: string | null; lat?: number | null; lng?: number | null; url?: string | null;
  organizer?: string | null; category?: string; cost?: string; tags?: string[];
};

// ---------- small helpers ----------
const ENT: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", hellip: "…" };
const decode = (s: string) => s.replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e) => {
  if (e[0] === "#") { const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) ? String.fromCodePoint(n) : m; }
  return ENT[e.toLowerCase()] ?? m;
});
const text = (html?: string | null) => html ? decode(html.replace(/<(br|\/p|\/div|\/li)[^>]*>/gi, "\n").replace(/<[^>]+>/g, " ")).replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n\n").trim() : "";
const clip = (s: string | null | undefined, n: number) => { const t = (s ?? "").trim(); return t.length > n ? t.slice(0, n - 1).trimEnd() + "…" : t; };

async function get(url: string, accept = "text/html,application/xhtml+xml,text/calendar,application/json;q=0.9,*/*;q=0.8") {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 20000);
  try {
    const r = await fetch(url, { headers: { "user-agent": UA, accept }, redirect: "follow", signal: ctl.signal });
    if (!r.ok) return null;
    const body = await r.text();
    return { body: body.slice(0, 4_000_000), type: r.headers.get("content-type") ?? "", url: r.url };
  } catch { return null; } finally { clearTimeout(t); }
}

const CATS: [string, RegExp][] = [
  ["environmental", /clean[- ]?up|tree|plant(ing)?|garden|recycl|nature|watershed|stream|park clean|earth|compost|trail work/i],
  ["mental", /mental|meditat|mindful|grief|support group|anxiety|wellbeing|well-being|stress/i],
  ["wellness", /yoga|fitness|workout|run\b|5k|walk|bike|swim|skat|zumba|tai chi|pilates|health|aquatic|exercise|sport/i],
  ["arts", /art\b|arts|music|concert|movie|film|theat|dance|craft|paint|poetry|book|jazz|band|choir|gallery|festival/i],
];
const TAGS: [string, RegExp][] = [
  ["kids", /kid|child|toddler|preschool|tween/i], ["family", /family|families|all ages/i], ["teens", /teen|youth/i],
  ["seniors", /senior|50\+|55\+|older adult/i], ["music", /music|concert|band|jazz|choir/i], ["food", /food|dinner|lunch|breakfast|tasting|market|grocer/i],
  ["fitness", /yoga|fitness|workout|run\b|5k|zumba|pilates|swim|exercise/i], ["nature", /nature|bird|trail|garden|wildlife/i],
  ["outdoor", /outdoor|park|lakefront|trail|field/i], ["learning", /class|workshop|lecture|seminar|lesson|tour/i], ["volunteer", /volunteer/i],
];
function classify(i: Item) {
  const hay = `${i.title} ${i.description ?? ""}`;
  i.category = CATS.find(([, re]) => re.test(i.title))?.[0] ?? CATS.find(([, re]) => re.test(hay))?.[0];
  i.tags = TAGS.filter(([, re]) => re.test(hay)).map(([t]) => t).slice(0, 6);
  if (!i.cost) i.cost = /\bfree\b/i.test(hay) && !/free (parking|shuttle)/i.test(hay) ? "free" : "check";
  return i;
}

// ---------- iCal ----------
function icsDate(v: string, params: string): { iso: string; allDay: boolean } | null {
  const m = v.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s, z] = m;
  if (!h) return { iso: `${y}-${mo}-${d}T12:00:00-05:00`, allDay: true };
  if (z) return { iso: `${y}-${mo}-${d}T${h}:${mi}:${s ?? "00"}Z`, allDay: false };
  // Floating or TZID time: treat as Eastern (all sources are local); resolve the right offset for that date.
  const raw = params.match(/TZID=["']?([^;:"']+)/i)?.[1] ?? "America/New_York";
  const tz = /^(EST5EDT|US\/Eastern|Eastern Standard Time|America\/New_York)$/i.test(raw) ? "America/New_York" : raw;
  return { iso: zoned(`${y}-${mo}-${d}T${h}:${mi}:${s ?? "00"}`, tz), allDay: false };
}
function zoned(local: string, tz: string) {
  try {
    const guess = new Date(local + "Z");
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(guess);
    const g = Object.fromEntries(parts.map((p) => [p.type, p.value]));
    const asTz = Date.UTC(+g.year, +g.month - 1, +g.day, +g.hour % 24, +g.minute, +g.second);
    return new Date(guess.getTime() - (asTz - guess.getTime())).toISOString();
  } catch { return new Date(local + "-05:00").toISOString(); }
}
// Next occurrences of a repeating event (DAILY/WEEKLY/MONTHLY/YEARLY with INTERVAL, BYDAY, UNTIL, COUNT).
// Returns at most 4 dates (within 21 days for daily/weekly series). Times keep the series' local wall-clock time.
function expand(firstIso: string, rule: string): string[] {
  const r = Object.fromEntries(rule.split(";").map((kv) => kv.split("=") as [string, string]));
  const freq = r.FREQ, step = Math.max(1, Number(r.INTERVAL) || 1);
  const until = r.UNTIL ? Date.parse(r.UNTIL.replace(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2}))?Z?$/, (_m, y, mo, d, h = "23", mi = "59", s = "59") => `${y}-${mo}-${d}T${h}:${mi}:${s}Z`)) : Infinity;
  const count = r.COUNT ? Number(r.COUNT) : Infinity;
  const days = r.BYDAY ? r.BYDAY.split(",").map((d) => ["SU", "MO", "TU", "WE", "TH", "FR", "SA"].indexOf(d.slice(-2))) : null;
  const first = new Date(firstIso); const now = Date.now() - 6 * 3600e3, horizon = Date.now() + (freq === "DAILY" || freq === "WEEKLY" ? 21 : DAYS_AHEAD) * 864e5;
  const out: string[] = []; let n = 0;
  const local = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(d).replace(", ", "T").replace(/T24/, "T00");
  const time = local(first).slice(11);
  const at = (d: Date) => zoned(`${d.toISOString().slice(0, 10)}T${time}`, "America/New_York");
  const day0 = new Date(`${local(first).slice(0, 10)}T00:00:00Z`);
  // Long-running series: skip ahead to today, keeping the series' rhythm (not possible with COUNT, which counts from the start)
  const since = Math.floor((Date.now() - day0.getTime()) / 864e5);
  const i0 = since <= 0 || count !== Infinity ? 0 : freq === "DAILY" ? since - (since % step) : freq === "WEEKLY" ? since - (since % (7 * step)) : since;
  for (let i = i0; i < i0 + 800 && out.length < 4; i++) {
    const d = new Date(day0.getTime() + i * 864e5);
    const diffDays = i, wk = Math.floor(diffDays / 7);
    let hit = false;
    if (freq === "DAILY") hit = diffDays % step === 0;
    else if (freq === "WEEKLY") hit = wk % step === 0 && (days ? days.includes(d.getUTCDay()) : d.getUTCDay() === day0.getUTCDay());
    else if (freq === "MONTHLY") { const m = (d.getUTCFullYear() - day0.getUTCFullYear()) * 12 + d.getUTCMonth() - day0.getUTCMonth(); hit = m % step === 0 && (days && r.BYDAY ? matchNth(d, r.BYDAY) : d.getUTCDate() === day0.getUTCDate()); }
    else if (freq === "YEARLY") hit = (d.getUTCFullYear() - day0.getUTCFullYear()) % step === 0 && d.getUTCMonth() === day0.getUTCMonth() && d.getUTCDate() === day0.getUTCDate();
    else break;
    if (!hit) continue;
    const iso = at(d); const t = Date.parse(iso);
    if (t > until || n >= count) break;
    n++;
    if (t > horizon) break;
    if (t >= now) out.push(iso);
  }
  return out;
}
function matchNth(d: Date, byday: string) {
  return byday.split(",").some((b) => {
    const m = b.match(/^([+-]?\d)?(SU|MO|TU|WE|TH|FR|SA)$/); if (!m) return false;
    if (["SU", "MO", "TU", "WE", "TH", "FR", "SA"].indexOf(m[2]) !== d.getUTCDay()) return false;
    if (!m[1]) return true;
    const nth = Number(m[1]); const dim = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    return nth > 0 ? Math.ceil(d.getUTCDate() / 7) === nth : Math.ceil((dim - d.getUTCDate() + 1) / 7) === -nth;
  });
}

function parseIcs(body: string, base_: string): Item[] {
  const lines = body.replace(/\r?\n[ \t]/g, "").split(/\r?\n/);
  const out: Item[] = []; let ev: Record<string, { v: string; p: string }> | null = null;
  const un = (s: string) => s.replace(/\\n/gi, "\n").replace(/\\([,;\\])/g, "$1");
  for (const line of lines) {
    if (line === "BEGIN:VEVENT") { ev = {}; continue; }
    if (line === "END:VEVENT" && ev) {
      const st = ev.DTSTART && icsDate(ev.DTSTART.v, ev.DTSTART.p);
      const en = ev.DTEND && icsDate(ev.DTEND.v, ev.DTEND.p);
      if (st && ev.SUMMARY && ev.STATUS?.v !== "CANCELLED") {
        const uid = ev.UID?.v ?? `${ev.SUMMARY.v}|${st.iso}`;
        const len = en && !st.allDay ? Date.parse(en.iso) - Date.parse(st.iso) : 0;
        const costType = ev["X-COST-TYPE"]?.v?.toLowerCase();
        const base: Item = {
          uid, title: un(ev.SUMMARY.v), description: clip(text(un(ev.DESCRIPTION?.v ?? "")), 4000) || null,
          starts_at: st.iso, ends_at: en && !st.allDay ? en.iso : null, all_day: st.allDay,
          location_name: ev.LOCATION ? clip(un(ev.LOCATION.v).split(/\n|, (?=\d)/)[0], 200) : null,
          address: ev.LOCATION ? clip(un(ev.LOCATION.v).replace(/\n/g, ", "), 300) : null,
          url: ev.URL?.v ? new URL(ev.URL.v, base_).href : null,
          cost: costType === "free" ? "free" : costType === "paid" ? "paid" : undefined,
        };
        if (ev.RRULE && !ev["RECURRENCE-ID"]) {
          // Repeating series: only the next few dates, so daily sessions don't flood the calendar
          const ex = new Set((ev.EXDATE?.v ?? "").split(",").map((d) => d.slice(0, 8)));
          for (const s0 of expand(st.iso, ev.RRULE.v)) {
            if (ex.has(s0.slice(0, 10).replace(/-/g, ""))) continue;
            const s1 = st.allDay ? `${s0.slice(0, 10)}T12:00:00-05:00` : s0;
            out.push({ ...base, uid: `${uid}|${s0.slice(0, 10)}`, starts_at: s1, ends_at: len ? new Date(Date.parse(s0) + len).toISOString() : null });
          }
          ev = null; continue;
        }
        out.push({ ...base, uid: uid + (ev["RECURRENCE-ID"] ? `|${ev["RECURRENCE-ID"].v}` : "") });
      }
      ev = null; continue;
    }
    if (!ev) continue;
    const i = line.indexOf(":"); if (i < 0) continue;
    const head = line.slice(0, i); const [name, ...ps] = head.split(";");
    ev[name.toUpperCase()] = { v: line.slice(i + 1), p: ps.join(";") };
  }
  return out;
}

// ---------- The Events Calendar (WordPress) ----------
async function tribe(origin: string): Promise<Item[] | null> {
  const start = new Date().toISOString().slice(0, 10);
  const r = await get(`${origin}/wp-json/tribe/events/v1/events?per_page=50&start_date=${start}`, "application/json");
  if (!r) return null;
  try {
    const j = JSON.parse(r.body); if (!Array.isArray(j.events)) return null;
    return j.events.map((e: Record<string, any>) => ({
      uid: `tribe:${e.id}`, title: text(e.title), description: clip(text(e.description), 4000) || null,
      starts_at: `${e.utc_start_date.replace(" ", "T")}Z`, ends_at: e.utc_end_date ? `${e.utc_end_date.replace(" ", "T")}Z` : null, all_day: !!e.all_day,
      location_name: e.venue?.venue ? text(e.venue.venue) : null,
      address: e.venue ? [e.venue.address, e.venue.city, e.venue.state, e.venue.zip].filter(Boolean).join(", ") || null : null,
      lat: e.venue?.geo_lat ? Number(e.venue.geo_lat) : null, lng: e.venue?.geo_lng ? Number(e.venue.geo_lng) : null,
      url: e.url ?? null, cost: e.cost ? (/free/i.test(e.cost) ? "free" : "paid") : undefined,
      organizer: e.organizer?.[0]?.organizer ? text(e.organizer[0].organizer) : null,
    }));
  } catch { return null; }
}

// ---------- schema.org JSON-LD ----------
function ldEvents(html: string, base: string): Item[] {
  const out: Item[] = [];
  const visit = (n: any) => {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) { n.forEach(visit); return; }
    const t = ([] as string[]).concat(n["@type"] ?? []).join(" ");
    if (/Event\b/.test(t) && n.startDate && n.name) {
      const loc = Array.isArray(n.location) ? n.location[0] : n.location;
      const addr = loc?.address;
      const address = typeof addr === "string" ? addr : addr ? [addr.streetAddress, addr.addressLocality, addr.addressRegion, addr.postalCode].filter(Boolean).join(", ") : null;
      const offer = Array.isArray(n.offers) ? n.offers[0] : n.offers;
      const price = offer?.price != null ? Number(String(offer.price).replace(/[^0-9.]/g, "")) : NaN;
      const allDay = /^\d{4}-\d{2}-\d{2}$/.test(n.startDate);
      const iso = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d}T12:00:00-05:00` : /[zZ]|[+-]\d{2}:?\d{2}$/.test(d) ? new Date(d).toISOString() : zoned(d.slice(0, 19), "America/New_York");
      const url = n.url ? new URL(n.url, base).href : null;
      out.push({
        uid: `ld:${n["@id"] ?? url ?? n.name}|${n.startDate}`, title: text(n.name), description: clip(text(n.description), 4000) || null,
        starts_at: iso(n.startDate), ends_at: n.endDate && !allDay ? iso(n.endDate) : null, all_day: allDay,
        location_name: loc?.name ? text(loc.name) : null, address,
        lat: loc?.geo?.latitude ? Number(loc.geo.latitude) : null, lng: loc?.geo?.longitude ? Number(loc.geo.longitude) : null,
        url, organizer: (Array.isArray(n.organizer) ? n.organizer[0] : n.organizer)?.name ?? null,
        cost: Number.isFinite(price) ? (price === 0 ? "free" : "paid") : n.isAccessibleForFree === true ? "free" : undefined,
      });
    }
    for (const k of ["@graph", "itemListElement", "item", "subEvent", "event", "events"]) if (n[k]) visit(n[k]);
  };
  for (const m of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { visit(JSON.parse(m[1].trim())); } catch { /* skip bad block */ }
  }
  return out;
}

// Links on the page that look like individual event pages on the same site
function eventLinks(html: string, base: string) {
  const host = new URL(base).host; const seen = new Set<string>();
  for (const m of html.matchAll(/href=["']([^"'#]+)["']/gi)) {
    try {
      const u = new URL(decode(m[1]), base);
      if (u.host !== host || u.href === base) continue;
      if (/\/(events?|calendar)\/[^/?]+/i.test(u.pathname) && !/\/(category|tag|page|list|month|week|day|feed)\b/i.test(u.pathname)) seen.add(u.href.replace(/\/$/, "/"));
    } catch { /* ignore */ }
    if (seen.size >= 20) break;
  }
  return [...seen];
}

async function read(website: string, feed?: string | null): Promise<{ items: Item[]; method: string }> {
  if (feed) {
    const r = await get(feed);
    if (r && /BEGIN:VCALENDAR/.test(r.body)) return { items: parseIcs(r.body, feed), method: "ical" };
    if (r) { const ld = ldEvents(r.body, r.url); if (ld.length) return { items: ld, method: "feed page" }; }
  }
  const origin = new URL(website).origin;
  const t = await tribe(origin); if (t?.length) return { items: t, method: "events api" };
  const page = await get(website);
  if (!page) throw new Error("Couldn’t open the website");
  // Timely calendars (events.timely.fun/<slug>) publish an iCal export by calendar id
  const slug = page.url.match(/events\.time(?:ly\.fun|\.ly)\/([a-z0-9]{6,})/i)?.[1] ?? page.body.match(/events\.time(?:ly\.fun|\.ly)\/([a-z0-9]{6,})/i)?.[1];
  if (slug) {
    const tl = await get(`https://events.timely.fun/${slug}`);
    const id = tl?.body.match(/data-info="%7B%22id%22%3A(\d+)/)?.[1];
    if (id) {
      const r = await get(`https://timelyapp.time.ly/api/calendars/${id}/export?format=ics`, "text/calendar,*/*");
      if (r && /BEGIN:VCALENDAR/.test(r.body)) { const it = parseIcs(r.body, `https://events.timely.fun/${slug}`); if (it.length) return { items: it, method: "timely ical" }; }
    }
  }
  // An iCal link the page advertises
  const icsHref = page.body.match(/<link[^>]+type=["']text\/calendar["'][^>]*href=["']([^"']+)/i)?.[1]
    ?? page.body.match(/href=["']([^"']+(?:\.ics|[?&]ical=1)[^"']*)["']/i)?.[1]
    ?? page.body.match(/href=["'](webcal:[^"']+)["']/i)?.[1];
  if (icsHref) {
    const u = new URL(decode(icsHref).replace(/^webcal:/, "https:"), page.url).href;
    const r = await get(u, "text/calendar,*/*");
    if (r && /BEGIN:VCALENDAR/.test(r.body)) { const it = parseIcs(r.body, u); if (it.length) return { items: it, method: "ical" }; }
  }
  let items = ldEvents(page.body, page.url);
  if (items.length >= 3) return { items, method: "page data" };
  const links = eventLinks(page.body, page.url);
  const pages = await Promise.all(links.map((l) => get(l)));
  for (const p of pages) if (p) items = items.concat(ldEvents(p.body, p.url).map((i) => ({ ...i, url: i.url ?? p.url })));
  if (items.length) return { items, method: "event pages" };
  throw new Error("No event listings found on that page. Try its calendar or events page, or an iCal/“Add to calendar” link.");
}

function upcoming(items: Item[]) {
  const now = Date.now() - 6 * 3600e3, until = Date.now() + DAYS_AHEAD * 864e5; const seen = new Set<string>();
  return items.filter((i) => {
    const t = Date.parse(i.starts_at); const end = i.ends_at ? Date.parse(i.ends_at) : t;
    if (!Number.isFinite(t) || end < now || t > until || !i.title || seen.has(i.uid)) return false;
    seen.add(i.uid); return true;
  }).sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at)).map(classify).slice(0, 200);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const admin = createClient(URL_, SERVICE, { auth: { persistSession: false } });
  // Who's asking: the cron job, or a signed-in admin/organizer
  const given = req.headers.get("x-cron-secret");
  const cron = !!given && (await admin.rpc("phoenix_import_secret_ok", { p_secret: given })).data === true;
  if (!cron) {
    const auth = req.headers.get("authorization") ?? "";
    const user = createClient(URL_, ANON, { global: { headers: { authorization: auth } }, auth: { persistSession: false } });
    const { data } = await user.rpc("phoenix_has_role", { roles: ["admin", "organizer"] });
    if (data !== true) return json({ error: "Only Phoenix admins and organizers can run imports." }, 403);
  }
  const body = await req.json().catch(() => ({}));

  if (typeof body.preview === "string") {
    let u: URL; try { u = new URL(body.preview); if (!/^https?:$/.test(u.protocol)) throw 0; } catch { return json({ error: "That isn’t a web address." }, 400); }
    try {
      const { items, method } = await read(u.href, typeof body.feed === "string" ? body.feed : null);
      const list = upcoming(items);
      return json({ method, count: list.length, sample: list.slice(0, 8).map((i) => ({ title: i.title, starts_at: i.starts_at, location: i.location_name })) });
    } catch (e) { return json({ error: (e as Error).message }, 200); }
  }

  let q = admin.from("phoenix_sources").select("id,name,website,feed_url").eq("status", "active");
  if (typeof body.source_id === "string") q = admin.from("phoenix_sources").select("id,name,website,feed_url").eq("id", body.source_id).in("status", ["active", "suggested"]);
  const { data: sources, error } = await q;
  if (error) return json({ error: error.message }, 500);
  const results: Record<string, unknown>[] = [];
  for (const s of sources ?? []) {
    try {
      const { items, method } = await read(s.website, s.feed_url);
      const list = upcoming(items);
      const { data, error: e } = await admin.rpc("phoenix_import_events", { p_source: s.id, p_items: list, p_method: method });
      if (e) throw new Error(e.message);
      results.push({ source: s.name, method, found: list.length, ...(data as object) });
    } catch (e) {
      await admin.rpc("phoenix_import_failed", { p_source: s.id, p_error: (e as Error).message });
      results.push({ source: s.name, error: (e as Error).message });
    }
  }
  return json({ results });
});
