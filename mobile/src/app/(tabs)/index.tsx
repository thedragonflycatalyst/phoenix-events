import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { FlatList, RefreshControl, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MonthGrid, Spotlight, Ticket, Tile } from '@/components/events';
import { SearchAndChips, SectionTitle, TopBar } from '@/components/header';
import { Button, Empty, Txt } from '@/components/ui';
import { useApp } from '@/lib/app-state';
import { addDays, firstOfMonth, fmtDay, fromKey, greeting, rangeFor, startOfDay } from '@/lib/dates';
import { errText, WHENS, type PEvent } from '@/lib/model';
import { sb } from '@/lib/supabase';
import { usePalette } from '@/lib/theme';

export default function Explore() {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const { username, filters, search, rsvps, dataVersion, activeFilterCount } = useApp();
  const [month, setMonth] = useState(() => firstOfMonth(new Date()));
  const [day, setDay] = useState<string | null>(null);
  const [data, setData] = useState<{ week: PEvent[]; list: PEvent[]; month: PEvent[]; spot: PEvent | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const now = new Date(), gridStart = addDays(month, -month.getDay());
      const listRange: [Date, Date | null] = day ? [startOfDay(fromKey(day)), addDays(startOfDay(fromKey(day)), 1)] : rangeFor(filters.when);
      const [week, list, monthEvents, spot] = await Promise.all([
        search(now, addDays(startOfDay(now), 8), 12),
        search(listRange[0], listRange[1]),
        search(gridStart, addDays(gridStart, 42), 500),
        sb.from('phoenix_events').select('*').eq('is_tpc', true).eq('status', 'published').gte('starts_at', now.toISOString()).order('starts_at').limit(1),
      ]);
      setData({ week, list, month: monthEvents, spot: (spot.data?.[0] as PEvent) ?? null });
      setError(null);
    } catch (e) { setError(errText(e)); }
  }, [search, filters.when, month, day]);

  useEffect(() => { load(); }, [load, dataVersion]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const heading = day ? fmtDay(fromKey(day)) : filters.when === 'upcoming' ? 'Coming up' : Object.fromEntries(WHENS)[filters.when];
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: p.bg }}
      contentContainerStyle={{ paddingTop: insets.top + 4, paddingHorizontal: 16, paddingBottom: 40 }}
      refreshControl={<RefreshControl refreshing={refreshing} tintColor={p.ink} colors={[p.focus]} progressBackgroundColor={p.surface}
        onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}>
      <TopBar />
      <View style={{ paddingTop: 12, paddingBottom: 18 }}>
        <Txt v="small" style={{ fontSize: 16, marginBottom: 6 }}>{greeting(username)}</Txt>
        <Txt v="display">Bring color back into your world</Txt>
        <Txt v="small" style={{ fontSize: 16, marginTop: 8 }}>
          {data?.week.length ? `${data.week.length}${data.week.length === 12 ? '+' : ''} thing${data.week.length === 1 ? '' : 's'} happening this week, shared by neighbors and The Phoenix Catalyst.` : 'Local events shared by neighbors and The Phoenix Catalyst.'}
        </Txt>
      </View>
      <SearchAndChips />

      {error ? (
        <View style={{ marginTop: 20 }}><Empty emoji="🌧️" title="Couldn’t load events" body={error} action={<Button title="Try again" onPress={load} />} /></View>
      ) : !data ? null : (
        <>
          {!day && data.week.length > 0 && (
            <>
              <SectionTitle>This week</SectionTitle>
              <FlatList
                horizontal data={data.week} keyExtractor={(e) => e.id} renderItem={({ item }) => <Tile e={item} />}
                showsHorizontalScrollIndicator={false} snapToInterval={250} decelerationRate="fast"
                style={{ marginHorizontal: -16 }} contentContainerStyle={{ paddingHorizontal: 16, gap: 14 }}
              />
            </>
          )}
          {!day && data.spot && !filters.tpc && <View style={{ marginTop: 22 }}><Spotlight e={data.spot} /></View>}
          <View style={{ marginTop: 22 }}>
            <MonthGrid month={month} events={data.month} selected={day} onSelect={setDay} onMonth={(d) => { setMonth(d); setDay(null); }} />
          </View>
          <SectionTitle right={day ? <Button small kind="quiet" title="Show all" onPress={() => setDay(null)} /> : undefined}>{heading}</SectionTitle>
          {data.list.length ? data.list.map((e) => <Ticket key={e.id} e={e} rsvp={rsvps.get(e.id)} />) : (
            <Empty emoji="🌱" title="Nothing here yet"
              body={`${activeFilterCount || day ? 'Try fewer filters, or share' : 'Be the first to share'} an event you know about. A photo of a flyer works.`}
              action={<Button title="Add an event" icon="add" onPress={() => router.push('/add')} />} />
          )}
        </>
      )}
    </ScrollView>
  );
}

