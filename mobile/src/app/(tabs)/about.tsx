import Constants from 'expo-constants';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Tile } from '@/components/events';
import { DonateCard } from '@/components/donate';
import { TopBar } from '@/components/header';
import { Button, Card, Txt } from '@/components/ui';
import { useApp } from '@/lib/app-state';
import { KINDS, myApplications, pendingApplications, type AppKind, type Application } from '@/lib/applications';
import { CATS, type PEvent } from '@/lib/model';
import { sb } from '@/lib/supabase';
import { F, POSTER, R, usePalette } from '@/lib/theme';

export default function About() {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const { setFilters, user, role, rsvps, isAdmin } = useApp();
  const [shifts, setShifts] = useState<PEvent[]>([]);
  const [apps, setApps] = useState<Partial<Record<AppKind, Application>>>({});
  const [waiting, setWaiting] = useState(0);
  const mine = [...rsvps].filter(([, k]) => k === 'volunteer').length;

  // Upcoming official volunteer events, your applications, and (for admins) what's waiting for review
  useFocusEffect(useCallback(() => {
    void sb.from('phoenix_events').select('*').eq('is_tpc', true).eq('status', 'published').gte('starts_at', new Date().toISOString())
      .order('starts_at').limit(10).then(({ data }) => setShifts((data ?? []) as PEvent[]));
    if (user) void myApplications(user.id).then(setApps).catch(() => {});
    if (isAdmin) void pendingApplications().then((l) => setWaiting(l.length)).catch(() => {});
  }, [user, isAdmin]));
  const status = (k: AppKind) => {
    const a = apps[k];
    if (k === 'organizer' && (role === 'organizer' || isAdmin)) return 'You’re an organizer ✓';
    if (k === 'moderator' && (role === 'moderator' || isAdmin)) return 'You’re a moderator ✓';
    if (!a) return null;
    return a.status === 'pending' ? 'Application sent · waiting for review' : a.status === 'approved' ? 'Approved ✓' : 'Not approved this time';
  };
  return (
    <ScrollView style={{ flex: 1, backgroundColor: p.bg }} contentContainerStyle={{ padding: 16, paddingTop: insets.top + 4, paddingBottom: 40 }}>
      <TopBar />
      <Txt v="display" style={{ marginTop: 14 }}>The Phoenix Catalyst</Txt>
      <Txt style={{ fontSize: 19, lineHeight: 28, marginTop: 12 }}>We strengthen mental, physical, emotional, and environmental well-being through community-driven events. Bringing color back into the world one community at a time.</Txt>
      <Txt v="small" style={{ fontSize: 16, marginTop: 10 }}>We picture neighborhoods where people know and support one another, local spaces thrive, and home is where you truly thrive.</Txt>

      {/* Donations sit right under the mission so supporters see them first */}
      <View style={{ marginTop: 20 }}><DonateCard /></View>

      {/* Volunteer hub */}
      <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 26 }}>
        <Txt v="h2">Volunteer opportunities</Txt>
        {shifts.length ? <Txt v="smallBold" color={p.focus} onPress={() => { setFilters({ tpc: true, when: 'upcoming' }); router.push('/'); }}>See all</Txt> : null}
      </View>
      {mine ? <Txt v="small" style={{ marginTop: 4 }}>You’re signed up for {mine} shift{mine === 1 ? '' : 's'}. They’re in My events.</Txt> : null}
      {shifts.length ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -16, marginTop: 12 }} contentContainerStyle={{ paddingHorizontal: 16, gap: 14 }}>
          {shifts.map((e) => <Tile key={e.id} e={e} />)}
        </ScrollView>
      ) : <Card style={{ marginTop: 12 }}><Txt v="small">No volunteer events are scheduled right now. Apply below and we’ll let you know when the next one is up.</Txt></Card>}

      <Txt v="h2" style={{ marginTop: 26 }}>Get involved</Txt>
      <View style={{ gap: 10, marginTop: 12 }}>
        {(Object.keys(KINDS) as AppKind[]).map((k) => {
          const st = status(k);
          const done = !!st && !st.startsWith('Not');
          return (
            <Card key={k} style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
              <Text style={{ fontSize: 30 }}>{KINDS[k].emoji}</Text>
              <View style={{ flex: 1 }}>
                <Txt v="h3">{KINDS[k].title}</Txt>
                <Txt v="small">{st ?? KINDS[k].blurb}</Txt>
              </View>
              {!done && <Button small title="Apply" onPress={() => (user ? router.push({ pathname: '/apply/[kind]', params: { kind: k } }) : router.push('/sign-in'))} />}
            </Card>
          );
        })}
        {isAdmin && (
          <Button kind="quiet" icon="group" title={waiting ? `Review applications (${waiting})` : 'Review applications'} onPress={() => router.push('/applications')} />
        )}
        <Button kind="ghost" icon="add" title="Suggest a local organization’s calendar" onPress={() => router.push('/sources')} />
        <Button kind="quiet" icon="help" title="Questions & answers" onPress={() => router.push('/faq')} />
        <Button kind="quiet" icon="gavel" title="Community rules" onPress={() => router.push('/rules')} />
      </View>

      <Txt v="h2" style={{ marginTop: 26 }}>What we do</Txt>
      <View style={{ gap: 12, marginTop: 12 }}>
        {CATS.filter((c) => c.pillar).map((c) => {
          const [hi, mid, lo] = POSTER[c.key];
          return (
            <LinearGradient key={c.key} colors={[hi, mid, lo]} start={{ x: 1, y: 0 }} end={{ x: 0, y: 1 }} style={{ borderRadius: R.lg, padding: 18, overflow: 'hidden' }}>
              <Text style={{ position: 'absolute', right: -12, bottom: -18, fontSize: 110, opacity: 0.2 }}>{c.emoji}</Text>
              <Text style={{ fontSize: 28 }}>{c.emoji}</Text>
              <Text style={{ fontFamily: F.display, fontSize: 21, color: '#fff', marginTop: 8 }}>{c.pillar}</Text>
              <Text style={{ fontFamily: F.body, fontSize: 15, lineHeight: 21, color: 'rgba(255,255,255,.88)', marginTop: 4 }}>{c.blurb}</Text>
            </LinearGradient>
          );
        })}
      </View>

      <View style={{ flexDirection: 'row', gap: 10, marginTop: 18 }}>
        <Button style={{ flex: 1 }} title="Volunteer events" onPress={() => { setFilters({ tpc: true, when: 'upcoming' }); router.push('/'); }} />
        <Button style={{ flex: 1 }} kind="ghost" title="Share an event" onPress={() => router.push('/add')} />
      </View>


      <Card style={{ marginTop: 16 }}>
        <Txt v="h3">How posting works</Txt>
        <Txt v="small" style={{ fontSize: 15, marginTop: 6 }}>Anyone with an account can post events, and they go live right away. Volunteer moderators review posts and remove anything that isn’t a real community event. If something looks wrong, open the event and tap Report a problem.</Txt>
      </Card>
      <Txt v="small" center style={{ marginTop: 18 }}>Bring color back into your world.</Txt>
      <Txt v="small" center style={{ marginTop: 4 }}>App version {Constants.expoConfig?.version ?? 'dev'}</Txt>
    </ScrollView>
  );
}
