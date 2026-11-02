// Organizations whose events the calendar imports automatically, and suggestions from members.
import { sb } from './supabase';

export type Source = {
  id: string; name: string; website: string; feed_url: string | null; category: string; note: string | null;
  status: 'suggested' | 'active' | 'paused' | 'rejected'; suggested_by: string | null; suggested_by_username: string | null;
  last_run_at: string | null; last_ok_at: string | null; last_count: number | null; last_method: string | null; last_error: string | null;
  created_at: string;
};
export type Preview = { method?: string; count?: number; sample?: { title: string; starts_at: string; location: string | null }[]; error?: string };

const clean = (u: string) => { const t = u.trim(); return t && !/^https?:\/\//i.test(t) ? `https://${t}` : t; };

export async function listSources() {
  const { data, error } = await sb.from('phoenix_sources').select('*').order('status').order('name');
  if (error) throw error;
  return (data ?? []) as Source[];
}

/** Members suggest; leaders' additions go live right away (the database decides). */
export async function suggestSource(s: { name: string; website: string; feed_url?: string; note?: string; active?: boolean }) {
  const { data, error } = await sb.from('phoenix_sources').insert({
    name: s.name.trim(), website: clean(s.website), feed_url: s.feed_url?.trim() ? clean(s.feed_url) : null,
    note: s.note?.trim() || null, ...(s.active ? { status: 'active' } : {}),
  }).select('*').single();
  if (error) throw error.code === '23505' ? new Error('That website is already on the list.') : error;
  return data as Source;
}

export async function setSourceStatus(id: string, status: Source['status']) {
  const { error } = await sb.from('phoenix_sources').update({ status }).eq('id', id);
  if (error) throw error;
}

async function call(body: Record<string, unknown>) {
  const { data, error } = await sb.functions.invoke('phoenix-import', { body });
  if (error) throw error;
  return data as Record<string, unknown>;
}
/** Reads a website without saving anything, so a leader can see what it would add. */
export const previewSource = (website: string, feed?: string | null) => call({ preview: clean(website), feed: feed || undefined }) as Promise<Preview>;
/** Imports one source now; returns e.g. "12 added, 3 updated". */
export async function runSource(id: string) {
  const r = (await call({ source_id: id })) as { results?: { added?: number; updated?: number; error?: string }[] };
  const x = r.results?.[0];
  if (!x) throw new Error('Nothing to import');
  if (x.error) throw new Error(x.error);
  return `${x.added ?? 0} added, ${x.updated ?? 0} updated`;
}
