// Blocking (hide someone for yourself) and banning (moderators suspend an account).
import { sb } from './supabase';

export async function myBlocks(): Promise<Set<string>> {
  const { data } = await sb.from('phoenix_blocks').select('blocked');
  return new Set((data ?? []).map((r: { blocked: string }) => r.blocked));
}

export async function blockUser(userId: string) {
  const { error } = await sb.from('phoenix_blocks').insert({ blocked: userId });
  if (error && !/duplicate key/i.test(error.message)) throw error;
}

export async function unblockUser(userId: string) {
  const { error } = await sb.from('phoenix_blocks').delete().eq('blocked', userId);
  if (error) throw error;
}

/** Blocked people with their usernames, for the account screen. */
export async function blockedPeople(): Promise<{ id: string; username: string | null }[]> {
  const { data } = await sb.from('phoenix_blocks').select('blocked');
  const ids = (data ?? []).map((r: { blocked: string }) => r.blocked);
  if (!ids.length) return [];
  const { data: ppl } = await sb.from('dragonfly_profiles').select('user_id,username').in('user_id', ids);
  const names = new Map((ppl ?? []).map((p: { user_id: string; username: string }) => [p.user_id, p.username]));
  return ids.map((id) => ({ id, username: names.get(id) ?? null }));
}

export async function banUser(username: string, reason: string, days: number | null, hideContent = true) {
  const { data, error } = await sb.rpc('phoenix_ban_user', { p_username: username, p_reason: reason || null, p_days: days, p_hide_content: hideContent });
  if (error) throw error;
  return data as string;
}

export async function unbanUser(username: string) {
  const { error } = await sb.rpc('phoenix_unban_user', { p_username: username });
  if (error) throw error;
}

export type Ban = { username: string | null; reason: string | null; banned_at: string; until: string | null };
export async function listBans(): Promise<Ban[]> {
  const { data } = await sb.rpc('phoenix_list_bans');
  return (data ?? []) as Ban[];
}

/** Am I suspended? Returns the end date (null = indefinite) or false. */
export async function myBan(userId: string): Promise<{ until: string | null; reason: string | null } | false> {
  const { data } = await sb.from('phoenix_bans').select('until,reason').eq('user_id', userId).maybeSingle();
  if (!data || (data.until && new Date(data.until) < new Date())) return false;
  return data;
}
