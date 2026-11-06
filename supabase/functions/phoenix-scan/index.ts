// phoenix-scan: reads an event flyer with an AI vision model, then checks the event on the web.
//
// POST { step: "read", image: base64 JPEG }             → { event, unclear }
// POST { step: "verify", event }                        → { event, verification }
// Server checks (x-cron-secret) may pass image_url instead of image and skip the daily limit.
// Authorization: a signed-in Dragonfly session. Each person gets DAILY_LIMIT reads and DAILY_LIMIT checks per 24 hours.
// Needs the ANTHROPIC_API_KEY secret; without it answers { error: "not_configured" } and the app uses its
// on-phone reader instead.
//
// Rule for both steps: nothing is invented. A field the flyer doesn't show clearly stays empty and is listed in
// `unclear`; the web check only fills or corrects a field when a source it found says so, and names that source.
import { createClient } from "jsr:@supabase/supabase-js@2";

const DAILY_LIMIT = 25;
const MAX_IMAGE = 2_500_000; // base64 characters (about 1.8 MB)
const READ_MODEL = Deno.env.get("PHOENIX_SCAN_MODEL") ?? "claude-sonnet-5-5";
const VERIFY_MODEL = Deno.env.get("PHOENIX_VERIFY_MODEL") ?? "claude-haiku-5-5";
const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "authorization, apikey, content-type, x-client-info, x-cron-secret",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "content-type": "application/json", "cache-control": "no-store" } });

const CATEGORIES = ["environmental", "community", "wellness", "mental", "arts", "other"];
const COSTS = ["free", "paid", "donation"];
const FIELDS = ["title", "start", "end", "location_name", "address", "url", "organizer", "cost", "category", "description"];

const EVENT_PROPS = {
  title: { type: "string", description: "The event's name exactly as printed (fix ALL CAPS to Title Case). Empty if unreadable." },
  start: { type: "string", description: "Local start as YYYY-MM-DDTHH:MM (or YYYY-MM-DD when no time is shown). Empty if no date is shown." },
  end: { type: "string", description: "Local end as YYYY-MM-DDTHH:MM, or empty." },
  all_day: { type: "boolean" },
  location_name: { type: "string", description: "Venue name as printed, e.g. 'Lake Kittamaqundi'. Empty if not shown." },
  address: { type: "string", description: "Street address as printed (street, city, state, ZIP). Empty if not shown." },
  url: { type: "string", description: "A web address printed on the flyer (as printed, e.g. example.org/events), or empty." },
  organizer: { type: "string", description: "Who is hosting, as printed." },
  cost: { type: "string", enum: COSTS },
  category: { type: "string", enum: CATEGORIES },
  description: { type: "string", description: "Two or three sentences using only the flyer's own words and facts. Empty if the flyer has none." },
};

const READ_TOOL = {
  name: "record_flyer",
  description: "Record the event printed on the flyer.",
  input_schema: {
    type: "object",
    properties: {
      is_event: { type: "boolean", description: "False when the photo is not an event flyer." },
      ...EVENT_PROPS,
      date_sure: { type: "boolean", description: "True only when month and day are printed and any weekday shown matches." },
      unclear: { type: "array", items: { type: "string", enum: FIELDS }, description: "Fields that are blurry, cut off or ambiguous on the flyer." },
    },
    required: ["is_event", "title", "start", "date_sure", "unclear"],
  },
};

const VERIFY_TOOL = {
  name: "record_check",
  description: "Record what the web says about this event.",
  input_schema: {
    type: "object",
    properties: {
      status: { type: "string", enum: ["confirmed", "partly", "not_found", "conflict"], description: "confirmed: a source matches name, date and place. partly: some fields confirmed. not_found: no source found. conflict: a source disagrees with the flyer." },
      fixes: {
        type: "object",
        description: "Only fields a source states clearly and that are missing or wrong in the flyer reading. Omit everything else.",
        properties: EVENT_PROPS,
      },
      fix_sources: {
        type: "object",
        description: "For every field in fixes, the URL of the page about THIS event that states it.",
        additionalProperties: { type: "string" },
      },
      conflicts: {
        type: "array",
        items: { type: "object", properties: { field: { type: "string", enum: FIELDS }, flyer: { type: "string" }, web: { type: "string" } }, required: ["field", "flyer", "web"] },
      },
      sources: {
        type: "array",
        items: { type: "object", properties: { title: { type: "string" }, url: { type: "string" } }, required: ["url"] },
        description: "The pages used, most useful first (at most 3).",
      },
      note: { type: "string", description: "One short sentence for the person posting, e.g. what was confirmed." },
    },
    required: ["status", "sources"],
  },
};

type Msg = { role: string; content: unknown };

async function claude(key: string, body: Record<string, unknown>): Promise<{ content: { type: string; name?: string; input?: Record<string, unknown> }[]; stop_reason: string }> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`ai ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return await res.json();
}

const str = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");
const when = (v: unknown) => { const s = str(v, 16); return /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/.test(s) ? s : ""; };
const link = (v: unknown) => {
  let s = str(v, 500);
  // Flyers print "columbiaassociation.org/events": make it a link
  if (/^(www\.)?[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}(\/\S*)?$/i.test(s)) s = `https://${s}`;
  return /^https?:\/\/[^\s]+$/i.test(s) ? s : "";
};

function clean(e: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  if ("title" in e) out.title = str(e.title, 140);
  if ("start" in e) out.start = when(e.start);
  if ("end" in e) out.end = when(e.end);
  if ("all_day" in e) out.all_day = e.all_day === true;
  if ("location_name" in e) out.location_name = str(e.location_name, 140);
  if ("address" in e) out.address = str(e.address, 240);
  if ("url" in e) out.url = link(e.url);
  if ("organizer" in e) out.organizer = str(e.organizer, 140);
  if ("cost" in e) out.cost = COSTS.includes(String(e.cost)) ? e.cost : "free";
  if ("category" in e) out.category = CATEGORIES.includes(String(e.category)) ? e.category : "community";
  if ("description" in e) out.description = str(e.description, 1200);
  return out;
}

function today() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", weekday: "long" }).format(new Date());
}

async function read(key: string, image: string) {
  const out = await claude(key, {
    model: READ_MODEL,
    max_tokens: 1500,
    tools: [READ_TOOL],
    tool_choice: { type: "auto" },
    system:
      "You read community event flyers for a public calendar. Answer only by calling record_flyer once. " +
      "Copy only what is printed. Never guess or fill in a venue, street, city, ZIP, time, price or description that is not on the flyer. " +
      "If a word or number is blurry, cut off or ambiguous, leave that field empty and list it in unclear. " +
      `Today is ${today()} (America/New_York). A date with no year is the next such date from today.`,
    messages: [{
      role: "user",
      content: [
        { type: "image", source: { type: "base64", media_type: "image/jpeg", data: image } },
        { type: "text", text: "Read this flyer and record the event." },
      ],
    }],
  });
  const call = out.content.find((c) => c.type === "tool_use" && c.name === "record_flyer");
  if (!call?.input) throw new Error("no_answer");
  const i = call.input;
  const unclear = Array.isArray(i.unclear) ? i.unclear.filter((f) => FIELDS.includes(String(f))).map(String) : [];
  return { is_event: i.is_event !== false, date_sure: i.date_sure === true, unclear, event: clean(i) };
}

// Events already on the Phoenix calendar from a trusted organization's own feed: free and exact.
// deno-lint-ignore no-explicit-any
async function fromOwnCalendar(admin: any, event: Record<string, unknown>) {
  const title = String(event.title ?? ""), start = String(event.start ?? "");
  if (title.length < 4 || !/^\d{4}-\d{2}-\d{2}/.test(start)) return null;
  const day = start.slice(0, 10);
  const { data } = await admin.from("phoenix_events")
    .select("title,starts_at,ends_at,location_name,address,url,organizer,description,phoenix_sources(name)")
    .eq("source", "import").eq("status", "published")
    .gte("starts_at", `${day}T00:00:00-05:00`).lt("starts_at", `${day}T23:59:59-04:00`).limit(50);
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const hit = (data ?? []).find((e: { title: string }) => norm(e.title) === norm(title) || norm(e.title).includes(norm(title)) || norm(title).includes(norm(e.title)));
  if (!hit) return null;
  const fixes: Record<string, unknown> = {};
  for (const k of ["address", "url"] as const) if (hit[k] && !event[k]) fixes[k] = hit[k];
  if (hit.location_name && !event.location_name) fixes.location_name = hit.location_name;
  if (hit.description && !event.description) fixes.description = String(hit.description).slice(0, 1200);
  const src = hit.url ? [{ title: `${hit.phoenix_sources?.name ?? hit.organizer ?? "Organizer"} calendar`, url: hit.url }] : [];
  return { status: "confirmed", fixes: clean(fixes), conflicts: [], sources: src, note: "Matched an event from the organizer's own calendar." };
}

async function verify(key: string, event: Record<string, unknown>) {
  const facts = FIELDS.filter((f) => event[f]).map((f) => `${f}: ${event[f]}`).join("\n");
  const missing = ["address", "location_name", "url", "end", "description"].filter((f) => !event[f]);
  const messages: Msg[] = [{
    role: "user",
    content:
      `A flyer was read as:\n${facts}\n\nSearch the web for this exact event (the organizer's own site, Facebook, Eventbrite, a city or library calendar). ` +
      (missing.length ? `The flyer does not give: ${missing.join(", ")}. Fill those in fixes from the event's own page when it states them (a full street address with city, state and ZIP; the event page's link). ` : "") +
      "Then call record_check once. Only put a field in fixes when a page you found states it plainly for this same event and date. " +
      "Use only a page about this specific event (not a general venue or organization page) for fixes, and give that page in fix_sources. " +
      "Never invent an address or details; if you find nothing for this event, status is not_found and fixes is empty.",
  }];
  const tools = [
    { type: "web_search_20250305", name: "web_search", max_uses: 3, user_location: { type: "approximate", city: "Columbia", region: "Maryland", country: "US", timezone: "America/New_York" } },
    VERIFY_TOOL,
  ];
  for (let turn = 0; turn < 4; turn++) {
    const out = await claude(key, { model: VERIFY_MODEL, max_tokens: 1500, tools, system: `Today is ${today()} (America/New_York).`, messages });
    const call = out.content.find((c) => c.type === "tool_use" && c.name === "record_check");
    if (call?.input) {
      const i = call.input;
      const sources = (Array.isArray(i.sources) ? i.sources : [])
        .map((s: Record<string, unknown>) => ({ title: str(s?.title, 140), url: link(s?.url) }))
        .filter((s: { url: string }) => s.url).slice(0, 3);
      const conflicts = (Array.isArray(i.conflicts) ? i.conflicts : [])
        .filter((c: Record<string, unknown>) => FIELDS.includes(String(c?.field)))
        .map((c: Record<string, unknown>) => ({ field: String(c.field), flyer: str(c.flyer, 240), web: str(c.web, 240) })).slice(0, 6);
      let status = ["confirmed", "partly", "not_found", "conflict"].includes(String(i.status)) ? String(i.status) : "not_found";
      // A fix without a source is not a check
      const fixes = sources.length ? clean((i.fixes ?? {}) as Record<string, unknown>) : {};
      const fixFrom = (i.fix_sources ?? {}) as Record<string, unknown>;
      for (const k of Object.keys(fixes)) {
        // Each fix needs the page that states it; a fix with no page behind it is dropped
        const from = link(fixFrom[k]);
        if (fixes[k] === "" || fixes[k] === undefined || !from) { delete fixes[k]; continue; }
        if (!sources.some((x: { url: string }) => x.url === from)) sources.unshift({ title: "", url: from });
      }
      if (!sources.length) status = "not_found";
      return { status, fixes, conflicts: sources.length ? conflicts : [], sources, note: str(i.note, 240) };
    }
    if (out.stop_reason !== "pause_turn") break;
    messages.push({ role: "assistant", content: out.content });
  }
  return { status: "not_found", fixes: {}, conflicts: [], sources: [], note: "" };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) return json({ error: "not_configured" }, 501);
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const given = req.headers.get("x-cron-secret");
  const system = !!given && (await admin.rpc("phoenix_import_secret_ok", { p_secret: given })).data === true;
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "bad_request" }, 400); }
  const step = body.step === "verify" ? "verify" : "read";
  if (system) {
    if (step === "read" && typeof body.image_url === "string" && /^https:\/\//.test(body.image_url)) {
      const r = await fetch(body.image_url);
      if (!r.ok) return json({ error: "bad_image" }, 400);
      const bytes = new Uint8Array(await r.arrayBuffer());
      let bin = ""; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      body.image = btoa(bin);
    }
  } else {
    const jwt = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data: me } = await admin.auth.getUser(jwt);
    if (!me?.user) return json({ error: "sign_in_required" }, 401);
    const since = new Date(Date.now() - 86_400_000).toISOString();
    const { count } = await admin.from("phoenix_ai_calls").select("id", { count: "exact", head: true })
    .eq("user_id", me.user.id).eq("kind", step === "read" ? "scan_read" : "scan_verify").gte("at", since);
    if ((count ?? 0) >= DAILY_LIMIT) return json({ error: "daily_limit" }, 429);
    await admin.from("phoenix_ai_calls").insert({ user_id: me.user.id, kind: step === "read" ? "scan_read" : "scan_verify" });
  }

  try {
    if (step === "read") {
      const image = typeof body.image === "string" ? body.image.replace(/^data:image\/\w+;base64,/, "") : "";
      if (!image || image.length > MAX_IMAGE || !/^[A-Za-z0-9+/=\s]+$/.test(image)) return json({ error: "bad_image" }, 400);
      return json(await read(key, image));
    }
    const event = clean((body.event ?? {}) as Record<string, unknown>);
    if (!event.title && !event.organizer) return json({ error: "nothing_to_check" }, 400);
    return json({ verification: (await fromOwnCalendar(admin, event)) ?? await verify(key, event) });
  } catch (e) {
    console.error("phoenix-scan", step, String(e).slice(0, 400));
    return json({ error: "ai_unavailable" }, 502);
  }
});
