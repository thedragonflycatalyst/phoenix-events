// Everything on the person's calendars for a date range: the phone's own calendars
// (Google, Outlook, Samsung and any other account synced to the phone) plus Phoenix events they're going to.
import * as Calendar from 'expo-calendar';
import { sb } from '@/lib/supabase';

export type AgendaItem = {
  key: string; title: string; start: Date; end: Date | null; allDay: boolean; where: string;
  color: string; source: 'phone' | 'phoenix'; uri: string; calendar: string;
};

const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export { dayKey };
const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, '');
const withTimeout = <T,>(p: Promise<T>, ms: number, fallback: T) => Promise.race([p, new Promise<T>((r) => setTimeout(() => r(fallback), ms))]);

async function phoneItems(from: Date, to: Date): Promise<AgendaItem[]> {
  const perm = await Calendar.getCalendarPermissions().catch(() => null);
  if (!perm?.granted) return [];
  const cals = await Calendar.getCalendars().catch(() => []);
  if (!cals.length) return [];
  const byId = new Map(cals.map((c) => [c.id, c]));
  const events = await Calendar.listEvents(cals.map((c) => c.id), from, to).catch(() => []);
  return events.map((e) => {
    const cal = byId.get(e.calendarId ?? '');
    return {
      key: `p:${e.id}:${String(e.startDate)}`, title: e.title || '(No title)',
      start: new Date(e.startDate), end: e.endDate ? new Date(e.endDate) : null, allDay: !!e.allDay,
      where: e.location ?? '', color: cal?.color || '#7357ee', source: 'phone' as const,
      uri: `content://com.android.calendar/events/${e.id}`, calendar: cal?.title ?? '',
    };
  });
}

async function phoenixItems(from: Date, to: Date): Promise<AgendaItem[]> {
  const { data: auth } = await sb.auth.getSession();
  const uid = auth.session?.user.id;
  if (!uid) return [];
  const { data } = await sb.from('phoenix_rsvps')
    .select('kind, e:phoenix_events!inner(id,title,starts_at,ends_at,all_day,location_name,status)')
    .eq('user_id', uid).gte('e.starts_at', from.toISOString()).lt('e.starts_at', to.toISOString());
  type Row = { kind: string; e: { id: string; title: string; starts_at: string; ends_at: string | null; all_day: boolean; location_name: string | null; status: string } };
  return ((data ?? []) as unknown as Row[]).filter((r) => r.e.status === 'published').map((r) => ({
    key: `x:${r.e.id}`, title: r.e.title, start: new Date(r.e.starts_at), end: r.e.ends_at ? new Date(r.e.ends_at) : null,
    allDay: r.e.all_day, where: r.e.location_name ?? '', color: '#ef5a26', source: 'phoenix' as const,
    uri: `phoenix:///event/${r.e.id}`, calendar: r.kind === 'volunteer' ? 'Phoenix · volunteering' : 'Phoenix · going',
  }));
}

/** All items from `from` up to `to`, sorted, with Phoenix events not repeated when they're also in the phone calendar. */
export async function loadAgenda(from: Date, to: Date): Promise<AgendaItem[]> {
  const [phone, phoenix] = await Promise.all([
    withTimeout(phoneItems(from, to), 5000, []),
    withTimeout(phoenixItems(from, to).catch(() => []), 5000, []),
  ]);
  const seen = new Set(phoenix.map((p) => `${norm(p.title)}|${p.start.getTime()}`));
  const merged = [...phoenix, ...phone.filter((p) => !seen.has(`${norm(p.title)}|${p.start.getTime()}`))];
  return merged.sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.start.getTime() - b.start.getTime());
}

/** Items that touch a given day (multi-day events show on each day they cover). */
export const onDay = (items: AgendaItem[], day: Date) => {
  const s = new Date(day); s.setHours(0, 0, 0, 0);
  const e = new Date(s); e.setDate(e.getDate() + 1);
  return items.filter((i) => i.start < e && (i.end ?? i.start) >= s && !(i.allDay && i.end && i.end <= s));
};
