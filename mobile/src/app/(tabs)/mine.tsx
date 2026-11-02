import * as Clipboard from 'expo-clipboard';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Linking, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ticket } from '@/components/events';
import { SectionTitle, TopBar } from '@/components/header';
import { Avatar } from '@/components/avatar';
import { Button, Card, Empty, Icon, Txt, useToast } from '@/components/ui';
import { useApp } from '@/lib/app-state';
import { dayKey } from '@/lib/dates';
import { errText, type PEvent, type RsvpKind } from '@/lib/model';
import { CALENDAR_FN, sb } from '@/lib/supabase';
import { usePalette } from '@/lib/theme';

export default function Mine() {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const app = useApp();
  const [going, setGoing] = useState<{ e: PEvent; kind: RsvpKind }[] | null>(null);
  const [posted, setPosted] = useState<PEvent[]>([]);
  const [token, setToken] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!app.user) return;
    const [rs, ps, tk] = await Promise.all([
      sb.from('phoenix_rsvps').select('kind, phoenix_events(*)').eq('user_id', app.user.id),
      sb.from('phoenix_events').select('*').eq('created_by', app.user.id).order('starts_at', { ascending: false }).limit(100),
      sb.rpc('phoenix_calendar_token'),
    ]);
    const today = dayKey(new Date());
    type Row = { kind: RsvpKind; phoenix_events: PEvent | null };
    setGoing(((rs.data ?? []) as unknown as Row[]).filter((r) => r.phoenix_events && dayKey(r.phoenix_events.ends_at || r.phoenix_events.starts_at) >= today)
      .map((r) => ({ e: r.phoenix_events!, kind: r.kind })).sort((a, b) => a.e.starts_at.localeCompare(b.e.starts_at)));
    setPosted((ps.data ?? []) as PEvent[]);
    setToken(tk.data ?? null);
  }, [app.user]);
  useFocusEffect(useCallback(() => { load(); }, [load, app.dataVersion]));

  if (!app.user) {
    return (
      <ScrollView style={{ flex: 1, backgroundColor: p.bg }} contentContainerStyle={{ padding: 16, paddingTop: insets.top + 4 }}>
        <TopBar />
        <Txt v="display" style={{ marginTop: 14, marginBottom: 20 }}>My events</Txt>
        <Empty emoji="🎟️" title="Keep track of your plans" body="Sign in to RSVP, volunteer, get reminders and put events in your calendar."
          action={<Button title="Sign in" onPress={() => router.push('/sign-in')} />} />
        <Feeds />
      </ScrollView>
    );
  }

  const feed = token ? `${CALENDAR_FN}?token=${token}` : null;
  return (
    <ScrollView style={{ flex: 1, backgroundColor: p.bg }} contentContainerStyle={{ padding: 16, paddingTop: insets.top + 4, paddingBottom: 40 }}>
      <TopBar />
      <Txt v="display" style={{ marginTop: 14 }}>My events</Txt>
      <Pressable onPress={() => router.push('/account')} accessibilityRole="button" accessibilityLabel="Account settings" style={{ marginTop: 14 }}>
        <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
          <Avatar size={52} />
          <View style={{ flex: 1 }}>
            <Txt v="h3">{app.username}</Txt>
            <Txt v="small">{app.role ? `Phoenix ${app.role} · ` : ''}Picture, email, password and devices</Txt>
          </View>
          <Icon name="chevron_right" color={p.muted} />
        </Card>
      </Pressable>

      <SectionTitle>Going & volunteering</SectionTitle>
      {going === null ? null : going.length ? going.map(({ e, kind }) => <Ticket key={e.id} e={e} rsvp={kind} />) : (
        <Empty emoji="🌱" title="No plans yet" body="Find something to do and tap I’m going." action={<Button title="Explore events" onPress={() => router.push('/')} />} />
      )}

      {feed && (
        <Card style={{ marginTop: 20 }}>
          <Txt v="h3">Sync with any calendar app</Txt>
          <Txt v="small" style={{ marginVertical: 6 }}>Subscribe once and every event you join shows up in Google, Outlook or Apple Calendar on all your devices, with updates and cancellations.</Txt>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
            <Button small kind="quiet" title="Google" onPress={() => Linking.openURL(`https://calendar.google.com/calendar/render?cid=${encodeURIComponent(feed.replace(/^https:/, 'webcal:'))}`)} />
            <Button small kind="quiet" title="Outlook" onPress={() => Linking.openURL(`https://outlook.live.com/calendar/0/addfromweb?url=${encodeURIComponent(feed)}&name=${encodeURIComponent('My Phoenix Events')}`)} />
            <Button small kind="quiet" title="Copy link" onPress={async () => { await Clipboard.setStringAsync(feed); toast('Link copied'); }} />
          </View>
          <Txt v="small" style={{ marginTop: 10 }}>This link is private to you.</Txt>
          <Button small kind="ghost" title="Make a new link" style={{ alignSelf: 'flex-start', marginTop: 8 }} onPress={() => Alert.alert('Make a new calendar link?', 'Your old link will stop working.', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Make new link', onPress: async () => { const { error } = await sb.rpc('phoenix_calendar_token', { rotate: true }); if (error) toast(errText(error), false); else { toast('New link ready'); load(); } } },
          ])} />
        </Card>
      )}

      <SectionTitle>You posted</SectionTitle>
      {posted.length ? posted.map((e) => <Ticket key={e.id} e={e} />) : <Txt v="small">Events you add show up here.</Txt>}

      {(app.isMod || app.isAdmin) && (
        <Card style={{ marginTop: 20, gap: 10 }}>
          <Txt v="h3">Team tools</Txt>
          {app.isMod && <Button kind="quiet" icon="shield_person" title="Review community posts" onPress={() => router.push('/moderate')} />}
          {app.isAdmin && <Button kind="quiet" icon="group" title="Team roles" onPress={() => router.push('/admin')} />}
          {app.isAdmin && <Button kind="quiet" icon="person" title="Review applications" onPress={() => router.push('/applications')} />}
        </Card>
      )}
      <Feeds />
      <Button kind="ghost" icon="logout" title="Sign out" style={{ marginTop: 24 }} onPress={async () => { await app.signOut(); toast('Signed out'); }} />
      <Txt v="small" center style={{ marginTop: 10 }}>One Dragonfly account works across all Dragonfly apps.</Txt>
    </ScrollView>
  );
}

function Feeds() {
  const toast = useToast();
  const row = (label: string, url: string, name: string) => (
    <View style={{ marginTop: 12 }}>
      <Txt v="bold">{label}</Txt>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6 }}>
        <Button small kind="quiet" title="Google" onPress={() => Linking.openURL(`https://calendar.google.com/calendar/render?cid=${encodeURIComponent(url.replace(/^https:/, 'webcal:'))}`)} />
        <Button small kind="quiet" title="Outlook" onPress={() => Linking.openURL(`https://outlook.live.com/calendar/0/addfromweb?url=${encodeURIComponent(url)}&name=${encodeURIComponent(name)}`)} />
        <Button small kind="quiet" title="Copy link" onPress={async () => { await Clipboard.setStringAsync(url); toast('Link copied'); }} />
      </View>
    </View>
  );
  return (
    <Card style={{ marginTop: 20 }}>
      <Txt v="h3">Community calendars anyone can follow</Txt>
      {row('All community events', `${CALENDAR_FN}?feed=all`, 'Phoenix Community Events')}
      {row('Phoenix Catalyst volunteer events', `${CALENDAR_FN}?feed=tpc`, 'Phoenix Catalyst Volunteer Events')}
    </Card>
  );
}
