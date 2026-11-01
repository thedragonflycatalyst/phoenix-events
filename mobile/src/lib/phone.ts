// Phone integrations: the device calendar and event reminders.
import * as Calendar from 'expo-calendar';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { whenText } from './dates';
import type { PEvent } from './model';
import { recall, shareUrl, store } from './supabase';

const endOf = (e: PEvent) => new Date(e.ends_at ?? new Date(new Date(e.starts_at).getTime() + 3600e3).toISOString());
const placeOf = (e: PEvent) => [e.location_name, e.address].filter(Boolean).join(', ');

type Saved = Record<string, string>; // phoenix event id -> phone calendar event id

/** Adds the event straight into the phone's own calendar. Returns false if the person declined access. */
export async function addToPhoneCalendar(e: PEvent): Promise<'added' | 'already' | 'denied' | 'no-calendar'> {
  const saved = recall<Saved>('pe.phoneCal', {});
  if (saved[e.id]) return 'already';
  const { status } = await Calendar.requestCalendarPermissions();
  if (status !== 'granted') return 'denied';
  const cals = await Calendar.getCalendars();
  const writable = cals.filter((c) => c.allowsModifications);
  const target = writable.find((c) => c.isPrimary) ?? writable[0];
  if (!target) return 'no-calendar';
  const created = await target.createEvent({
    title: e.title,
    startDate: new Date(e.starts_at),
    endDate: endOf(e),
    allDay: e.all_day,
    location: placeOf(e) || undefined,
    notes: [e.description, e.organizer ? `Hosted by ${e.organizer}` : '', `Phoenix Community: ${shareUrl(e.id)}`].filter(Boolean).join('\n\n'),
    timeZone: e.timezone || 'America/New_York',
    alarms: [{ relativeOffset: -60 }],
  });
  store('pe.phoneCal', { ...saved, [e.id]: created.id });
  return 'added';
}
export const isInPhoneCalendar = (id: string) => !!recall<Saved>('pe.phoneCal', {})[id];

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
});

/** Schedules a reminder the evening before (or 2 hours before for same-day events). */
export async function scheduleReminder(e: PEvent): Promise<boolean> {
  try {
    const perm = await Notifications.getPermissionsAsync();
    const granted = perm.granted || (await Notifications.requestPermissionsAsync()).granted;
    if (!granted) return false;
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('reminders', { name: 'Event reminders', importance: Notifications.AndroidImportance.DEFAULT });
    }
    await cancelReminder(e.id);
    const start = new Date(e.starts_at);
    const dayBefore = new Date(start); dayBefore.setDate(dayBefore.getDate() - 1); dayBefore.setHours(18, 0, 0, 0);
    const twoHours = new Date(start.getTime() - 2 * 3600e3);
    const when = e.all_day ? dayBefore : dayBefore.getTime() > Date.now() ? dayBefore : twoHours;
    if (when.getTime() <= Date.now() + 60e3) return false;
    const id = await Notifications.scheduleNotificationAsync({
      content: {
        title: e.all_day || when === dayBefore ? `Tomorrow: ${e.title}` : `Soon: ${e.title}`,
        body: [whenText(e), e.location_name].filter(Boolean).join(' · '),
        data: { eventId: e.id },
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: when, channelId: 'reminders' },
    });
    store('pe.reminders', { ...recall<Saved>('pe.reminders', {}), [e.id]: id });
    return true;
  } catch { return false; }
}
export async function cancelReminder(eventId: string) {
  const all = recall<Saved>('pe.reminders', {});
  if (!all[eventId]) return;
  await Notifications.cancelScheduledNotificationAsync(all[eventId]).catch(() => {});
  delete all[eventId];
  store('pe.reminders', all);
}

/** Adds a just-scanned flyer to the phone's calendar (no account needed). */
export async function addScanToPhoneCalendar(g: { title: string; start: Date; end: Date | null; allDay: boolean; place: string; notes: string }): Promise<'added' | 'denied' | 'no-calendar'> {
  const { status } = await Calendar.requestCalendarPermissions();
  if (status !== 'granted') return 'denied';
  const writable = (await Calendar.getCalendars()).filter((c) => c.allowsModifications);
  const target = writable.find((c) => c.isPrimary) ?? writable[0];
  if (!target) return 'no-calendar';
  await target.createEvent({
    title: g.title || 'Event from a flyer',
    startDate: g.start,
    endDate: g.end ?? new Date(g.start.getTime() + (g.allDay ? 0 : 3600e3)),
    allDay: g.allDay,
    location: g.place || undefined,
    notes: g.notes || undefined,
    alarms: [{ relativeOffset: -60 }],
  });
  return 'added';
}
