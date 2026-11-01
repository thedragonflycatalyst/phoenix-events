// Hearts and comments on events (light, TikTok-style). Data lives in Supabase with row-level security.
import { sb } from './supabase';

export type Comment = {
  id: string; event_id: string; user_id: string; username: string | null; parent_id: string | null;
  body: string; like_count: number; reply_count: number; created_at: string;
};
export type Social = { likes: number; comments: number; liked: boolean };

export async function eventSocial(eventId: string): Promise<Social> {
  const { data } = await sb.rpc('phoenix_event_social', { p_event: eventId });
  const row = (data as Social[] | null)?.[0];
  return row ?? { likes: 0, comments: 0, liked: false };
}

export async function setEventLike(eventId: string, userId: string, like: boolean) {
  const q = like
    ? sb.from('phoenix_event_likes').insert({ event_id: eventId, user_id: userId })
    : sb.from('phoenix_event_likes').delete().eq('event_id', eventId).eq('user_id', userId);
  const { error } = await q;
  if (error && !/duplicate key/i.test(error.message)) throw error;
}

/** All visible comments for an event (oldest first) and which ones the viewer hearted. */
export async function listComments(eventId: string, userId?: string): Promise<{ comments: Comment[]; liked: Set<string> }> {
  const { data, error } = await sb.from('phoenix_comments')
    .select('id,event_id,user_id,username,parent_id,body,like_count,reply_count,created_at')
    .eq('event_id', eventId).order('created_at', { ascending: true }).limit(500);
  if (error) throw error;
  const comments = (data ?? []) as Comment[];
  const liked = new Set<string>();
  if (userId && comments.length) {
    const { data: mine } = await sb.from('phoenix_comment_likes').select('comment_id').eq('user_id', userId).in('comment_id', comments.map((c) => c.id));
    (mine ?? []).forEach((m: { comment_id: string }) => liked.add(m.comment_id));
  }
  return { comments, liked };
}

export async function addComment(eventId: string, userId: string, body: string, parentId: string | null) {
  const { data, error } = await sb.from('phoenix_comments')
    .insert({ event_id: eventId, user_id: userId, body: body.trim(), parent_id: parentId })
    .select('id,event_id,user_id,username,parent_id,body,like_count,reply_count,created_at').single();
  if (error) throw error;
  return data as Comment;
}

export async function setCommentLike(commentId: string, userId: string, like: boolean) {
  const q = like
    ? sb.from('phoenix_comment_likes').insert({ comment_id: commentId, user_id: userId })
    : sb.from('phoenix_comment_likes').delete().eq('comment_id', commentId).eq('user_id', userId);
  const { error } = await q;
  if (error && !/duplicate key/i.test(error.message)) throw error;
}

export async function deleteComment(id: string) {
  const { error } = await sb.from('phoenix_comments').delete().eq('id', id);
  if (error) throw error;
}

/** Moderators hide a comment and its replies (kept for the record). */
export async function removeComment(id: string) {
  const { error } = await sb.rpc('phoenix_remove_comment', { p_comment: id });
  if (error) throw error;
}

/** Sends a comment to the moderators' review queue for its event. */
export async function reportComment(c: Comment, userId: string) {
  const reason = `Comment by @${c.username ?? 'neighbor'}: “${c.body.slice(0, 300)}”`;
  const { error } = await sb.from('phoenix_flags').insert({ event_id: c.event_id, user_id: userId, reason });
  if (error) throw error;
}

export function timeAgo(iso: string, now = Date.now()) {
  const s = Math.max(0, (now - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 604800) return `${Math.floor(s / 86400)}d`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export const compact = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}K` : String(n));
