import { router, Stack, useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Platform, ScrollView, Share, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Poster } from '@/components/events';
import { Button, Card, Empty, Icon, Txt, useToast } from '@/components/ui';
import { useApp } from '@/lib/app-state';
import { fmtDay, fmtShort, whenText } from '@/lib/dates';
import { CAT, COST, errText, TAG, type PEvent, type RsvpKind } from '@/lib/model';
import { addToPhoneCalendar, cancelReminder, isInPhoneCalendar, scheduleReminder } from '@/lib/phone';
import { sb, shareUrl } from '@/lib/supabase';
import { F, R, usePalette } from '@/lib/theme';
import type { AndroidSymbol } from 'expo-symbols';

export default function EventScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const app = useApp();
  const [e, setE] = useState<PEvent | null | undefined>(undefined);
  const [busy, setBusy] = useState<string | null>(null);
  const [roster, setRoster] = useState<{ username: string | null; signed_up_at: string }[] | null>(null);
  const [inCal, setInCal] = useState(false);

  const load = useCallback(async () => {
    const { data } = await sb.from('phoenix_events').select('*').eq('id', id).maybeSingle();
    setE((data as PEvent) ?? null);
    setInCal(isInPhoneCalendar(id));
    if (data?.is_tpc && app.canTpc) {
      const r = await sb.rpc('phoenix_event_volunteers', { p_event: id });
      setRoster(r.data ?? []);
    }
  }, [id, app.canTpc]);
  useEffect(() => { load(); }, [load]);

  if (e === undefined) return <View style={{ flex: 1, backgroundColor: p.bg, justifyContent: 'center' }}><ActivityIndicator color={p.ink} /></View>;
  if (!e) return <View style={{ flex: 1, backgroundColor: p.bg, padding: 16, paddingTop: insets.top + 60 }}><Empty emoji="🔎" title="Event not found" body="It may have been removed." action={<Button title="Back" onPress={() => router.back()} />} /></View>;

  const c = p.cat[e.category];
  const rs = app.rsvps.get(e.id);
  const mine = app.user?.id === e.created_by;
  const full = !!e.volunteer_slots && e.volunteer_count >= e.volunteer_slots;
  const place = [e.location_name, e.address].filter(Boolean).join(', ');
  const host = e.is_tpc ? 'Hosted by The Phoenix Catalyst' : e.organizer ? `Hosted by ${e.organizer}` : CAT[e.category]?.label;

  const addCal = async () => {
    const r = await addToPhoneCalendar(e).catch(() => 'denied' as const);
    if (r === 'added') { setInCal(true); toast('Added to your calendar'); }
    else if (r === 'already') toast('Already in your calendar');
    else if (r === 'denied') toast('Allow calendar access in Settings to add events', false);
    else toast('No calendar found on this phone', false);
  };

  const rsvp = async (kind: RsvpKind) => {
    if (!app.user) { router.push('/sign-in'); return; }
    setBusy(kind);
    try {
      if (rs === kind) {
        const { error } = await sb.from('phoenix_rsvps').delete().eq('event_id', e.id).eq('user_id', app.user.id);
        if (error) throw error;
        app.setRsvp(e.id, null); await cancelReminder(e.id);
        toast(kind === 'volunteer' ? 'Volunteer sign-up canceled' : 'Removed from your events');
      } else {
        const { error } = await sb.from('phoenix_rsvps').upsert({ event_id: e.id, user_id: app.user.id, kind }, { onConflict: 'event_id,user_id' });
        if (error) throw error;
        app.setRsvp(e.id, kind);
        const reminded = await scheduleReminder(e);
        toast(kind === 'volunteer' ? 'Thank you for volunteering! 🔥' : reminded ? 'You’re going! We’ll remind you.' : 'You’re going!');
        if (!isInPhoneCalendar(e.id)) {
          Alert.alert('Add to your calendar?', `Put “${e.title}” in your phone’s calendar so it’s with the rest of your plans.`, [
            { text: 'Not now', style: 'cancel' }, { text: 'Add', onPress: addCal },
          ]);
        }
      }
      app.bump(); await load();
    } catch (err) { toast(errText(err), false); } finally { setBusy(null); }
  };

  const share = () => Share.share({ title: e.title, message: `${e.title} · ${fmtShort(e.starts_at)} ${e.all_day ? '' : whenText(e)}\n${shareUrl(e.id)}`, url: shareUrl(e.id) }).catch(() => {});
  const directions = () => {
    const q = encodeURIComponent(place);
    Linking.openURL(Platform.OS === 'ios' ? `maps:0,0?q=${q}` : `geo:0,0?q=${q}`).catch(() => Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${q}`));
  };

  const del = () => Alert.alert('Delete this event?', 'It will be removed from everyone’s calendar. This can’t be undone.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Delete', style: 'destructive', onPress: async () => {
      const { error } = await sb.from('phoenix_events').delete().eq('id', e.id);
      if (error) return toast(errText(error), false);
      if (e.poster_path) await sb.storage.from('phoenix-posters').remove([e.poster_path]);
      await cancelReminder(e.id); app.bump(); toast('Event deleted'); router.back();
    } },
  ]);

  const moderate = async (patch: Partial<PEvent>, msg: string) => {
    const { error } = await sb.from('phoenix_events').update(patch).eq('id', e.id);
    if (error) return toast(errText(error), false);
    toast(msg); app.bump(); load();
  };

  return (
    <View style={{ flex: 1, backgroundColor: p.bg }}>
      <Stack.Screen options={{ headerTintColor: e.poster_path ? '#fff' : '#fff' }} />
      <ScrollView contentContainerStyle={{ paddingBottom: 140 + insets.bottom }}>
        <Poster e={e} size="hero" style={{ borderRadius: 0, aspectRatio: e.poster_path ? 4 / 5 : 5 / 4, borderBottomLeftRadius: 28, borderBottomRightRadius: 28 }} />
        <View style={{ padding: 16 }}>
          {e.status !== 'published' && <Card style={{ marginBottom: 12 }}><Txt v="bold" color={p.danger}>This event is {e.status} and only visible to you{app.isMod ? ' and moderators' : ''}.</Txt></Card>}
          <Txt v="kicker" color={c}>{CAT[e.category]?.emoji} {host}</Txt>
          <Txt v="display" style={{ marginTop: 6 }}>{e.title}</Txt>

          <Card style={{ padding: 0, marginTop: 18 }}>
            <Fact icon="calendar_month" c={c} title={fmtDay(e.starts_at)} sub={whenText(e)} />
            {place ? <Fact icon="location_on" c={c} title={e.location_name || e.address || ''} sub={e.location_name && e.address ? e.address : undefined} action={{ label: 'Get directions', onPress: directions }} /> : null}
            <Fact icon="confirmation_number" c={c} title={COST[e.cost]} sub={e.tags.length ? `Good for ${e.tags.map((t) => TAG[t]?.toLowerCase()).join(', ')}` : undefined} />
            <Fact icon="group" c={c} last
              title={e.going_count ? `${e.going_count} neighbor${e.going_count === 1 ? '' : 's'} going` : 'Be the first to say you’re going'}
              sub={e.is_tpc ? `${e.volunteer_count}${e.volunteer_slots ? ` of ${e.volunteer_slots}` : ''} volunteer spots filled` : undefined} />
          </Card>

          {e.description ? <><Txt v="h2" style={{ marginTop: 24, marginBottom: 8 }}>About</Txt><Txt>{e.description}</Txt></> : null}
          {e.url ? <Button kind="ghost" small icon="public" title="More info from the organizer" style={{ alignSelf: 'flex-start', marginTop: 14 }} onPress={() => WebBrowser.openBrowserAsync(e.url!)} /> : null}
          <Txt v="small" style={{ marginTop: 18 }}>Posted by @{e.created_by_username || 'neighbor'}{e.source === 'poster' ? ' from a flyer photo' : ''}. Details can change, so check with the organizer.</Txt>

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 }}>
            {(mine || app.isMod) && <Button small kind="quiet" icon="edit" title="Edit" onPress={() => router.push({ pathname: '/edit/[id]', params: { id: e.id } })} />}
            {(mine || app.role === 'admin') && <Button small kind="danger" icon="delete" title="Delete" onPress={del} />}
            {!mine && <Button small kind="quiet" icon="flag" title="Report a problem" onPress={() => app.user ? setBusy('flag') : router.push('/sign-in')} />}
          </View>
          {busy === 'flag' && <FlagBox eventId={e.id} onDone={() => setBusy(null)} />}

          {app.isMod && (
            <Card style={{ marginTop: 16 }}>
              <Txt v="h3">Moderation</Txt>
              <Txt v="small" style={{ marginVertical: 6 }}>{e.reviewed_at ? `Reviewed ${fmtShort(e.reviewed_at)}` : 'Not reviewed yet'}. Status: {e.status}.</Txt>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {!e.reviewed_at && <Button small title="Looks good" onPress={() => moderate({ reviewed_at: new Date().toISOString() }, 'Marked reviewed')} />}
                {e.status !== 'published' && <Button small kind="quiet" title="Restore" onPress={() => moderate({ status: 'published' }, 'Restored')} />}
                {e.status === 'published' && <Button small kind="quiet" title="Hide" onPress={() => moderate({ status: 'hidden' }, 'Hidden')} />}
                {e.status !== 'removed' && <Button small kind="danger" title="Remove" onPress={() => moderate({ status: 'removed' }, 'Removed')} />}
              </View>
            </Card>
          )}
          {roster && (
            <Card style={{ marginTop: 16 }}>
              <Txt v="h3" style={{ marginBottom: 6 }}>Volunteers</Txt>
              {roster.length ? roster.map((v, i) => <Txt key={i} style={{ paddingVertical: 6 }}>@{v.username || 'unknown'} <Txt v="small">signed up {fmtShort(v.signed_up_at)}</Txt></Txt>)
                : <Txt v="small">No volunteers yet. Share the event to spread the word.</Txt>}
            </Card>
          )}
        </View>
      </ScrollView>

      {/* Action bar pinned to the bottom, like a ticket counter */}
      <View style={[styles.bar, { paddingBottom: insets.bottom + 10, backgroundColor: p.surface, borderTopColor: p.line }]}>
        {e.is_tpc && (
          <Button style={{ flex: 1 }} kind={rs === 'volunteer' ? 'on' : 'accent'} accent={c} busy={busy === 'volunteer'} disabled={full && rs !== 'volunteer'}
            title={rs === 'volunteer' ? '✓ Volunteering' : full ? 'Spots full' : '🔥 Volunteer'} onPress={() => rsvp('volunteer')} />
        )}
        <Button style={{ flex: 1 }} kind={rs === 'going' ? 'on' : e.is_tpc ? 'quiet' : 'accent'} accent={c} busy={busy === 'going'}
          title={rs === 'going' ? '✓ Going' : 'I’m going'} onPress={() => rsvp('going')} />
        <Button kind="quiet" icon={inCal ? 'event_available' : 'calendar_month'} onPress={addCal} />
        <Button kind="quiet" icon="share" onPress={share} />
      </View>
    </View>
  );
}

function Fact({ icon, c, title, sub, action, last }: { icon: AndroidSymbol; c: string; title: string; sub?: string; action?: { label: string; onPress: () => void }; last?: boolean }) {
  const p = usePalette();
  return (
    <View style={{ flexDirection: 'row', gap: 14, alignItems: 'center', padding: 14, borderBottomWidth: last ? 0 : 1, borderBottomColor: p.line }}>
      <View style={{ width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: `${c}26` }}><Icon name={icon} color={c} /></View>
      <View style={{ flex: 1 }}>
        <Txt v="bold">{title}</Txt>
        {sub ? <Txt v="small" style={{ fontSize: 15 }}>{sub}</Txt> : null}
        {action ? <Txt v="smallBold" color={c} onPress={action.onPress} style={{ marginTop: 2, textDecorationLine: 'underline' }}>{action.label}</Txt> : null}
      </View>
    </View>
  );
}

function FlagBox({ eventId, onDone }: { eventId: string; onDone: () => void }) {
  const p = usePalette();
  const toast = useToast();
  const { user } = useApp();
  const [reason, setReason] = useState('');
  const send = async () => {
    if (!reason.trim()) return toast('Tell the moderators what’s wrong', false);
    const { error } = await sb.from('phoenix_flags').insert({ event_id: eventId, user_id: user!.id, reason: reason.trim() });
    if (error) toast(/duplicate/.test(error.message) ? 'You already reported this. Moderators will review it.' : errText(error), false);
    else toast('Report sent to moderators');
    onDone();
  };
  return (
    <Card style={{ marginTop: 12 }}>
      <Txt v="bold" style={{ marginBottom: 6 }}>What’s wrong?</Txt>
      <TextInput value={reason} onChangeText={setReason} multiline maxLength={500} placeholder="Wrong date, spam, canceled…" placeholderTextColor={p.muted}
        style={{ minHeight: 90, borderWidth: 1.5, borderColor: p.line, borderRadius: R.sm, padding: 12, color: p.ink, fontFamily: F.body, fontSize: 16, textAlignVertical: 'top' }} />
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}><Button small title="Send report" onPress={send} /><Button small kind="ghost" title="Cancel" onPress={onDone} /></View>
    </Card>
  );
}

const styles = StyleSheet.create({
  bar: { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', gap: 8, paddingHorizontal: 12, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth },
});
