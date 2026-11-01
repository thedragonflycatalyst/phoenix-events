// A day's appointments, opened from the home-screen widget: every phone calendar plus Phoenix events.
import * as Calendar from 'expo-calendar';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Card, Icon, Txt } from '@/components/ui';
import { useApp } from '@/lib/app-state';
import { F, R, usePalette } from '@/lib/theme';
import { loadAgenda, onDay, type AgendaItem } from '@/widget/agenda';
import { refreshCalendarWidget } from '@/widget/refresh';

const parse = (k: string) => { const [y, m, d] = (k || '').split('-').map(Number); return y && m && d ? new Date(y, m - 1, d) : new Date(); };
const time = (d: Date) => d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

export default function DayScreen() {
  const { date } = useLocalSearchParams<{ date: string }>();
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const { setFilters } = useApp();
  const day = parse(date);
  const [items, setItems] = useState<AgendaItem[] | null>(null);
  const [canRead, setCanRead] = useState(true);

  const load = useCallback(async () => {
    const perm = await Calendar.getCalendarPermissions().catch(() => null);
    setCanRead(!!perm?.granted);
    const s = new Date(day); s.setHours(0, 0, 0, 0);
    const e = new Date(s); e.setDate(e.getDate() + 1);
    setItems(onDay(await loadAgenda(s, e), day));
  }, [date]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, [load]);

  const allow = async () => {
    const r = await Calendar.requestCalendarPermissions();
    if (r.granted) { refreshCalendarWidget(); void load(); } else if (!r.canAskAgain) void Linking.openSettings();
  };
  const open = (it: AgendaItem) => {
    if (it.source === 'phoenix') router.push(it.uri.replace('phoenix://', '') as never);
    else void Linking.openURL(it.uri).catch(() => {});
  };
  const findEvents = () => { setFilters({ when: `day:${date}` }); router.dismissTo('/'); };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: p.bg }} contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 30 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <View>
          <Txt v="kicker" color={p.focus}>{day.toLocaleDateString(undefined, { weekday: 'long' })}</Txt>
          <Txt v="h1">{day.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}</Txt>
        </View>
        <Pressable onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} hitSlop={10} accessibilityLabel="Close"><Icon name="close" color={p.muted} /></Pressable>
      </View>

      {!canRead && (
        <Card style={{ marginTop: 16 }}>
          <Txt v="bold">See your other calendars here</Txt>
          <Txt v="small" style={{ marginTop: 4 }}>Allow calendar access to show Google, Outlook and the other calendars on your phone, here and in the widget.</Txt>
          <Button small title="Allow calendar access" style={{ alignSelf: 'flex-start', marginTop: 10 }} onPress={allow} />
        </Card>
      )}

      {items === null ? <ActivityIndicator style={{ marginTop: 30 }} color={p.ink} /> : items.length === 0 ? (
        <Card style={{ marginTop: 16, alignItems: 'center', paddingVertical: 28 }}>
          <Txt style={{ fontSize: 36 }}>🌤️</Txt>
          <Txt v="h3" style={{ marginTop: 6 }}>Nothing planned</Txt>
          <Txt v="small" center style={{ marginTop: 4 }}>Want to find something to do?</Txt>
        </Card>
      ) : (
        <View style={{ gap: 10, marginTop: 16 }}>
          {items.map((it) => (
            <Pressable key={it.key} onPress={() => open(it)} accessibilityRole="button"
              style={({ pressed }) => ({ flexDirection: 'row', gap: 12, padding: 14, borderRadius: R.md, backgroundColor: p.surface, opacity: pressed ? 0.8 : 1 })}>
              <View style={{ width: 5, borderRadius: 3, backgroundColor: it.color }} />
              <View style={{ flex: 1 }}>
                <Txt v="bold" style={{ fontSize: 16 }}>{it.title}</Txt>
                <Txt v="small">{it.allDay ? 'All day' : `${time(it.start)}${it.end ? ` – ${time(it.end)}` : ''}`}{it.where ? ` · ${it.where}` : ''}</Txt>
                <Txt v="small" style={{ fontFamily: F.bodyBold, marginTop: 2 }}>{it.source === 'phoenix' ? '🔥 ' : ''}{it.calendar}</Txt>
              </View>
              <Icon name="chevron_right" color={p.muted} />
            </Pressable>
          ))}
        </View>
      )}
      <Button kind="ghost" icon="search" title="Find community events this day" style={{ marginTop: 18 }} onPress={findEvents} />
    </ScrollView>
  );
}
