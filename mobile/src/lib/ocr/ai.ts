// Careful flyer reading: an AI model reads the photo (copying only what is printed), then checks the event
// on the web and fills in what a real source states, naming the source. Runs on the phoenix-scan function.
// Falls back to the free on-phone reader when offline, signed out, over the daily limit or unavailable.
import { File } from 'expo-file-system';
import { withWebDetails } from './enrich';
import type { PosterGuess } from './parse';
import { readPoster } from './read';
import { sb } from '@/lib/supabase';

export type Verification = {
  status: 'confirmed' | 'partly' | 'not_found' | 'conflict';
  sources: { title: string; url: string }[];
  conflicts: { field: string; flyer: string; web: string }[];
  filled: string[];
  note: string;
};
export type Flyer = PosterGuess & {
  detailsFrom?: string;
  /** Fields the AI couldn't read clearly on the flyer. */
  unclear?: string[];
  verification?: Verification;
  /** 'ai' when the careful reader was used, 'phone' for the on-phone fallback. */
  reader?: 'ai' | 'phone';
};
type Event = Partial<Record<'title' | 'start' | 'end' | 'location_name' | 'address' | 'url' | 'organizer' | 'cost' | 'category' | 'description', string>> & { all_day?: boolean };

const FIELD_NAMES: Record<string, string> = {
  title: 'name', start: 'start time', end: 'end time', location_name: 'place', address: 'address', url: 'link',
  organizer: 'organizer', cost: 'cost', category: 'category', description: 'details',
};
export const fieldName = (f: string) => FIELD_NAMES[f] ?? f;

/** "2026-11-14T10:00" or "2026-11-14" in the phone's own time zone. */
export function localDate(s?: string): Date | null {
  const m = s?.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] ?? 0), Number(m[5] ?? 0));
}
const iso = (d: Date | null, allDay: boolean) => {
  if (!d) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  const day = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  return allDay ? day : `${day}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

/** Merges fields from the AI into a guess. Empty fields never overwrite. */
export function merge(g: PosterGuess, e: Event): PosterGuess {
  const out = { ...g };
  const allDay = e.all_day ?? (!!e.start && e.start.length === 10);
  if (e.start) { out.start = localDate(e.start); out.allDay = allDay; }
  if (e.end) out.end = localDate(e.end);
  for (const k of ['title', 'location_name', 'address', 'url', 'organizer', 'description'] as const) if (e[k]) out[k] = e[k] as string;
  if (e.cost && ['free', 'paid', 'donation'].includes(e.cost)) out.cost = e.cost as PosterGuess['cost'];
  if (e.category) out.category = e.category as PosterGuess['category'];
  return out;
}

const EMPTY: PosterGuess = { title: '', start: null, end: null, allDay: false, dateSure: false, location_name: '', address: '', url: '', organizer: '', cost: 'free', category: 'community', description: '' };

/** Reads the flyer with the AI. Null when the careful reader isn't available, so the caller falls back. */
export async function aiRead(uri: string): Promise<{ guess: Flyer; isEvent: boolean } | null> {
  const { data: s } = await sb.auth.getSession();
  if (!s.session) return null;
  try {
    const image = await new File(uri).base64();
    const { data, error } = await sb.functions.invoke('phoenix-scan', { body: { step: 'read', image } });
    if (error || !data?.event) return null;
    const ev = data.event as Event;
    const guess: Flyer = { ...merge(EMPTY, ev), dateSure: data.date_sure === true && !!ev.start, unclear: (data.unclear as string[]) ?? [], reader: 'ai' };
    return { guess, isEvent: data.is_event !== false };
  } catch { return null; }
}

/** Checks the event on the web and applies what a named source states. Null when the check can't run. */
export async function aiVerify(g: Flyer): Promise<Flyer | null> {
  const event: Event = {
    title: g.title, start: iso(g.start, g.allDay), end: iso(g.end, g.allDay), location_name: g.location_name,
    address: g.address, url: g.url, organizer: g.organizer, cost: g.cost, category: g.category, description: g.description,
  };
  try {
    const { data, error } = await sb.functions.invoke('phoenix-scan', { body: { step: 'verify', event } });
    const v = data?.verification;
    if (error || !v) return null;
    const fixes = (v.fixes ?? {}) as Event;
    const filled = Object.keys(fixes).filter((k) => k !== 'all_day' && fixes[k as keyof Event]);
    const merged: Flyer = { ...g, ...merge(g, fixes) };
    // A date the web confirms is a sure date
    if (fixes.start || v.status === 'confirmed') merged.dateSure = !!merged.start;
    merged.unclear = (g.unclear ?? []).filter((f) => !filled.includes(f));
    const host = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
    const sources = (v.sources ?? []) as Verification['sources'];
    if (filled.includes('description') && sources[0]) merged.detailsFrom = host(sources[0].url);
    merged.verification = { status: v.status, sources, conflicts: v.conflicts ?? [], filled, note: v.note ?? '' };
    return merged;
  } catch { return null; }
}

/** The whole careful read: AI read, then web check; falls back to the on-phone reader. Reports each stage. */
export async function readFlyer(uri: string, onStage?: (stage: 'reading' | 'checking', partial?: Flyer) => void): Promise<Flyer> {
  onStage?.('reading');
  const ai = await aiRead(uri);
  if (!ai) {
    const g = await withWebDetails(await readPoster(uri));
    return { ...g, reader: 'phone' };
  }
  if (!ai.isEvent || !ai.guess.title) return ai.guess;
  onStage?.('checking', ai.guess);
  return (await aiVerify(ai.guess)) ?? ai.guess;
}

/** One line telling the person what was checked and what to look at. */
export function checkSummary(g: Flyer): string {
  const v = g.verification;
  const unclear = (g.unclear ?? []).map(fieldName);
  const look = unclear.length ? ` Couldn’t read the ${unclear.join(', ')} clearly on the flyer, so fill ${unclear.length > 1 ? 'those' : 'that'} in.` : '';
  if (!v) return g.reader === 'ai' ? `Read from the flyer.${look}` : '';
  const site = (() => { try { return new URL(v.sources[0]?.url ?? '').hostname.replace(/^www\./, ''); } catch { return ''; } })();
  const filled = v.filled.length ? ` Filled in the ${v.filled.map(fieldName).join(', ')} from ${site}.` : '';
  if (v.status === 'conflict') {
    const c = v.conflicts.map((x) => `${fieldName(x.field)}: flyer says “${x.flyer}”, ${site || 'the web'} says “${x.web}”`).join('; ');
    return `Check this: ${c}.${filled}${look}`;
  }
  if (v.status === 'confirmed') return `Matches ${site}.${filled}${look}`;
  if (v.status === 'partly') return `Partly confirmed on ${site}.${filled}${look}`;
  return `Couldn’t find this event online, so double-check the details against the flyer.${look}`;
}
