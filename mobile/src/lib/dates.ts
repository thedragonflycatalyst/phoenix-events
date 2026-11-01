import type { PEvent } from './model';

export const startOfDay = (d: Date | string) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
export const addDays = (d: Date | string, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
export const firstOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1);
export const dayKey = (d: Date | string) => {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
};
export const fromKey = (k: string) => new Date(`${k}T12:00:00`);

export const fmtDay = (d: Date | string) => new Date(d).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
export const fmtShort = (d: Date | string) => new Date(d).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
export const fmtTime = (d: Date | string) => new Date(d).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
export const monShort = (d: Date | string) => new Date(d).toLocaleDateString(undefined, { month: 'short' });
export const dowShort = (d: Date | string) => new Date(d).toLocaleDateString(undefined, { weekday: 'short' });

export function relDay(d: Date | string) {
  const k = dayKey(d), t = startOfDay(new Date());
  if (k <= dayKey(t)) return 'Today';
  if (k === dayKey(addDays(t, 1))) return 'Tomorrow';
  if (k < dayKey(addDays(t, 7))) return new Date(d).toLocaleDateString(undefined, { weekday: 'long' });
  return new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function whenText(e: Pick<PEvent, 'starts_at' | 'ends_at' | 'all_day'>) {
  if (e.all_day) return e.ends_at && dayKey(e.ends_at) !== dayKey(e.starts_at) ? `${fmtShort(e.starts_at)} to ${fmtShort(e.ends_at)}` : 'All day';
  const end = e.ends_at ? `–${fmtTime(e.ends_at)}` : '';
  if (!e.ends_at || dayKey(e.ends_at) === dayKey(e.starts_at)) return `${fmtTime(e.starts_at)}${end}`;
  return `${fmtShort(e.starts_at)} ${fmtTime(e.starts_at)} to ${fmtShort(e.ends_at)} ${fmtTime(e.ends_at)}`;
}
export const tileWhen = (e: PEvent) => (e.all_day ? `${relDay(e.starts_at)}, all day` : `${relDay(e.starts_at)} at ${fmtTime(e.starts_at)}`);

export function rangeFor(when: string): [Date, Date | null] {
  const now = new Date(), today = startOfDay(now);
  switch (when) {
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

export function greeting(name?: string | null) {
  const hr = new Date().getHours();
  const part = hr < 5 ? 'Up late' : hr < 12 ? 'Good morning' : hr < 17 ? 'Good afternoon' : 'Good evening';
  return name && !name.includes('@') ? `${part}, ${name}` : part;
}
