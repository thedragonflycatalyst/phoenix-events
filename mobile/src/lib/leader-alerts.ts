// Phone notifications for Phoenix admins when new applications are waiting for review.
// Runs in the background about every 15 minutes (Android decides the exact timing) and whenever the app opens.
import * as BackgroundTask from 'expo-background-task';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';
import { KINDS, type AppKind } from './applications';
import { recall, sb, store } from './supabase';

const TASK = 'phoenix-leader-alerts';
const SEEN = 'pe.seenApplications';
const SEEN_BOT = 'pe.seenBotHides';
const VERB: Record<AppKind, string> = { volunteer: 'wants to volunteer', organizer: 'applied to organize events', moderator: 'applied to moderate' };

/** Notifies about applications the admin hasn't been told about yet. Returns how many were new. */
export async function checkPendingApplications(): Promise<number> {
  const { data: auth } = await sb.auth.getSession();
  const uid = auth.session?.user.id;
  if (!uid) return 0;
  const { data: me } = await sb.from('phoenix_roles').select('role').eq('user_id', uid).maybeSingle();
  if (me?.role !== 'admin' && me?.role !== 'owner') return 0;
  const { data } = await sb.from('phoenix_applications').select('id,kind,username').eq('status', 'pending').order('created_at');
  const pending = (data ?? []) as { id: string; kind: AppKind; username: string | null }[];
  const seen = new Set(recall<string[]>(SEEN, []));
  const fresh = pending.filter((a) => !seen.has(a.id));
  store(SEEN, pending.map((a) => a.id)); // only remember what's still waiting
  if (!fresh.length) return 0;
  if (!(await Notifications.getPermissionsAsync()).granted) return fresh.length;
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('leaders', { name: 'Applications to review', importance: Notifications.AndroidImportance.HIGH });
  }
  const one = fresh[0];
  await Notifications.scheduleNotificationAsync({
    content: fresh.length === 1
      ? { title: `New ${KINDS[one.kind].title.toLowerCase()} application`, body: `@${one.username ?? 'Someone'} ${VERB[one.kind]}. Tap to review.`, data: { url: '/applications' } }
      : { title: `${fresh.length} new applications`, body: `${pending.length} waiting for review in The Phoenix Catalyst app. Tap to review.`, data: { url: '/applications' } },
    trigger: Platform.OS === 'android' ? { channelId: 'leaders' } : null,
  });
  return fresh.length;
}

/** Notifies moderators and admins when Phoenix Bot hid something that's waiting for a human. */
export async function checkBotHides(): Promise<number> {
  const { data, error } = await sb.rpc('phoenix_bot_queue');
  if (error || !data) return 0;
  const hidden = (data as { review_id: string; verdict: string; target_kind: string; reason: string | null }[]).filter((b) => b.verdict === 'hide');
  const seen = new Set(recall<string[]>(SEEN_BOT, []));
  const fresh = hidden.filter((b) => !seen.has(b.review_id));
  store(SEEN_BOT, hidden.map((b) => b.review_id));
  if (!fresh.length || !(await Notifications.getPermissionsAsync()).granted) return fresh.length;
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('moderation', { name: 'Posts Phoenix Bot hid', importance: Notifications.AndroidImportance.HIGH });
  }
  const one = fresh[0];
  await Notifications.scheduleNotificationAsync({
    content: fresh.length === 1
      ? { title: `Phoenix Bot hid a ${one.target_kind}`, body: `${one.reason ?? 'It looked like a problem.'} Tap to clear it or confirm.`, data: { url: '/moderate' } }
      : { title: `Phoenix Bot hid ${fresh.length} posts`, body: 'They wait for you in Review posts. Tap to review.', data: { url: '/moderate' } },
    trigger: Platform.OS === 'android' ? { channelId: 'moderation' } : null,
  });
  return fresh.length;
}

TaskManager.defineTask(TASK, async () => {
  try { await checkBotHides(); await checkPendingApplications(); return BackgroundTask.BackgroundTaskResult.Success; }
  catch { return BackgroundTask.BackgroundTaskResult.Failed; }
});

/** Turns the background check on for admins and off for everyone else. */
export async function setLeaderAlerts(isAdmin: boolean) {
  try {
    const on = await TaskManager.isTaskRegisteredAsync(TASK);
    if (!isAdmin) { if (on) await BackgroundTask.unregisterTaskAsync(TASK); return; }
    const perm = await Notifications.getPermissionsAsync();
    if (!perm.granted && perm.canAskAgain) await Notifications.requestPermissionsAsync();
    if (!on) await BackgroundTask.registerTaskAsync(TASK, { minimumInterval: 15 });
    await checkPendingApplications();
    await checkBotHides();
  } catch { /* background tasks unavailable (e.g. emulator without Play services) */ }
}
