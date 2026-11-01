import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TopBar } from '@/components/header';
import { Button, Card, Txt } from '@/components/ui';
import { useApp } from '@/lib/app-state';
import { CATS, DONATE_LINKS } from '@/lib/model';
import { F, POSTER, R, usePalette } from '@/lib/theme';

export default function About() {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const { setFilters } = useApp();
  const links = Object.entries(DONATE_LINKS).filter(([, u]) => u);
  return (
    <ScrollView style={{ flex: 1, backgroundColor: p.bg }} contentContainerStyle={{ padding: 16, paddingTop: insets.top + 4, paddingBottom: 40 }}>
      <TopBar />
      <Txt v="display" style={{ marginTop: 14 }}>The Phoenix Catalyst</Txt>
      <Txt style={{ fontSize: 19, lineHeight: 28, marginTop: 12 }}>We strengthen mental, physical, emotional, and environmental well-being through community-driven events. Bringing color back into the world one community at a time.</Txt>
      <Txt v="small" style={{ fontSize: 16, marginTop: 10 }}>We picture neighborhoods where people know and support one another, local spaces thrive, and home is where you truly thrive.</Txt>

      <View style={{ gap: 12, marginTop: 22 }}>
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

      <Card style={{ marginTop: 22 }}>
        <Txt v="h2">Support our work</Txt>
        <Txt v="small" style={{ fontSize: 16, marginTop: 6 }}>The Phoenix Catalyst is a Maryland 501(c)(3) nonprofit. This app is free for everyone, and donations keep it running.</Txt>
        {links.length ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 }}>
            {links.map(([k, u]) => <Button key={k} kind={k === 'custom' ? 'ghost' : 'solid'} title={k === 'custom' ? 'Other amount' : `$${k}`} onPress={() => WebBrowser.openBrowserAsync(u)} style={{ minWidth: 76 }} />)}
          </View>
        ) : <Txt v="bold" style={{ marginTop: 12 }}>Online donations are opening soon.</Txt>}
      </Card>

      <Card style={{ marginTop: 16 }}>
        <Txt v="h3">How posting works</Txt>
        <Txt v="small" style={{ fontSize: 15, marginTop: 6 }}>Anyone with an account can post events, and they go live right away. Volunteer moderators review posts and remove anything that isn’t a real community event. If something looks wrong, open the event and tap Report a problem.</Txt>
      </Card>
      <Txt v="small" center style={{ marginTop: 18 }}>Bring color back into your world.</Txt>
    </ScrollView>
  );
}
