// In-app applications to volunteer, organize events, or help moderate.
import * as Crypto from 'expo-crypto';
import { File } from 'expo-file-system';
import { sb } from './supabase';

export type Resume = { path: string; name: string; size: number | null };
export const RESUME_TYPES = ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/plain', 'application/rtf', 'image/jpeg', 'image/png', 'image/heic'];
export const RESUME_MAX = 10 * 1024 * 1024;

/** Uploads a resume to the applicant's private folder (only they and Phoenix admins can open it). */
export async function uploadResume(userId: string, file: { uri: string; name: string; mimeType?: string; size?: number }): Promise<Resume> {
  const type = file.mimeType && RESUME_TYPES.includes(file.mimeType) ? file.mimeType : 'application/pdf';
  const ext = (file.name.split('.').pop() ?? 'pdf').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5) || 'pdf';
  const path = `${userId}/${Crypto.randomUUID()}.${ext}`;
  const bytes = await new File(file.uri).arrayBuffer();
  if (bytes.byteLength > RESUME_MAX) throw new Error('resume_too_big');
  const { error } = await sb.storage.from('phoenix-resumes').upload(path, bytes, { contentType: type });
  if (error) throw error;
  return { path, name: file.name.slice(0, 120), size: bytes.byteLength };
}

/** A short-lived link to open a resume (admins, or the applicant themself). */
export async function resumeLink(path: string) {
  const { data, error } = await sb.storage.from('phoenix-resumes').createSignedUrl(path, 600);
  if (error || !data?.signedUrl) throw error ?? new Error('resume_missing');
  return data.signedUrl;
}

export type AppKind = 'volunteer' | 'organizer' | 'moderator';
export type AppStatus = 'pending' | 'approved' | 'declined' | 'withdrawn';
export type Application = {
  id: string; user_id: string; username: string | null; kind: AppKind; answers: Record<string, unknown>;
  status: AppStatus; review_note: string | null; created_at: string; reviewed_at: string | null;
};

export const KINDS: Record<AppKind, { title: string; emoji: string; blurb: string; grants?: string }> = {
  volunteer: { title: 'Volunteer', emoji: '🌱', blurb: 'Help at clean-ups, plantings, food drives and wellness days. Pick what fits your schedule.' },
  organizer: { title: 'Event organizer', emoji: '🔥', blurb: 'Plan and lead official Phoenix Catalyst events and volunteer shifts.', grants: 'Lets you post official Phoenix events and see who signed up.' },
  moderator: { title: 'App moderator', emoji: '🛡️', blurb: 'Keep the community calendar trustworthy: review new posts, reports and comments.', grants: 'Lets you hide or remove posts and comments that break the rules.' },
};

/** The newest application of each kind for the signed-in person. */
export async function myApplications(userId: string): Promise<Partial<Record<AppKind, Application>>> {
  const { data } = await sb.from('phoenix_applications').select('*').eq('user_id', userId).order('created_at', { ascending: false });
  const out: Partial<Record<AppKind, Application>> = {};
  for (const a of (data ?? []) as Application[]) if (!out[a.kind] && a.status !== 'withdrawn') out[a.kind] = a;
  return out;
}

export async function submitApplication(userId: string, kind: AppKind, answers: Record<string, unknown>) {
  const { error } = await sb.from('phoenix_applications').insert({ user_id: userId, kind, answers });
  if (error) throw error;
}

export async function withdrawApplication(id: string) {
  const { error } = await sb.rpc('phoenix_withdraw_application', { p_id: id });
  if (error) throw error;
}

/** Admins: everything waiting for review, oldest first. */
export async function pendingApplications(): Promise<Application[]> {
  const { data, error } = await sb.from('phoenix_applications').select('*').eq('status', 'pending').order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as Application[];
}

export async function reviewApplication(id: string, approve: boolean, note: string) {
  const { error } = await sb.rpc('phoenix_review_application', { p_id: id, p_approve: approve, p_note: note || null });
  if (error) throw error;
}
