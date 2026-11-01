import { router } from 'expo-router';
import { Image } from 'expo-image';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useApp } from '@/lib/app-state';
import { CATS } from '@/lib/model';
import { F, R, usePalette } from '@/lib/theme';
import { Chip, Icon, Txt } from './ui';

export function TopBar() {
  const p = usePalette();
  const { user, username } = useApp();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Image source={require('../../assets/icon.png')} style={{ width: 34, height: 34, borderRadius: 10 }} accessibilityIgnoresInvertColors />
        <Text style={{ fontFamily: F.displayBold, fontSize: 18, color: p.ink }}>Phoenix <Text style={{ color: p.muted }}>Community</Text></Text>
      </View>
      {user ? (
        <Pressable accessibilityLabel={`Your account, ${username}`} onPress={() => router.push('/mine')}
          style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: p.ink, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontFamily: F.display, fontSize: 17, color: p.bg }}>{(username ?? '?').charAt(0).toUpperCase()}</Text>
        </Pressable>
      ) : (
        <Pressable onPress={() => router.push('/sign-in')} style={{ backgroundColor: p.ink, borderRadius: R.pill, paddingHorizontal: 16, height: 38, justifyContent: 'center' }}>
          <Text style={{ fontFamily: F.bodyBold, color: p.bg }}>Sign in</Text>
        </Pressable>
      )}
    </View>
  );
}

/** Search field, filter button and category chips — shared by Explore and Map. */
export function SearchAndChips() {
  const p = usePalette();
  const { filters, setFilters } = useApp();
  const extra = filters.tags.length + filters.cost.length + (filters.radius ? 1 : 0) + (filters.when !== 'upcoming' ? 1 : 0);
  const toggleCat = (k: string) => setFilters({ cats: filters.cats.includes(k) ? filters.cats.filter((x) => x !== k) : [...filters.cats, k] });
  return (
    <View>
      <View style={{ flexDirection: 'row', gap: 10, marginBottom: 12 }}>
        <View style={{ flex: 1, justifyContent: 'center' }}>
          <View style={{ position: 'absolute', left: 16, zIndex: 1 }}><Icon name="search" size={20} color={p.muted} /></View>
          <TextInput
            defaultValue={filters.q} placeholder="Yoga, food drive, trail…" placeholderTextColor={p.muted} returnKeyType="search"
            accessibilityLabel="Search events" clearButtonMode="while-editing"
            onSubmitEditing={(e) => setFilters({ q: e.nativeEvent.text.trim() })}
            onChangeText={(t) => { if (!t && filters.q) setFilters({ q: '' }); }}
            style={{ height: 50, borderRadius: R.pill, paddingLeft: 46, paddingRight: 16, backgroundColor: p.surface, borderWidth: 1, borderColor: p.line, color: p.ink, fontFamily: F.body, fontSize: 17 }}
          />
        </View>
        <Pressable accessibilityLabel={`Filters${extra ? `, ${extra} on` : ''}`} onPress={() => router.push('/filters')}
          style={{ width: 50, height: 50, borderRadius: 25, backgroundColor: p.soft, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="tune" />
          {extra > 0 && (
            <View style={{ position: 'absolute', top: -2, right: -2, minWidth: 20, height: 20, borderRadius: 10, backgroundColor: p.cat.wellness, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 }}>
              <Text style={{ fontFamily: F.bodyBold, fontSize: 12, color: '#fff' }}>{extra}</Text>
            </View>
          )}
        </Pressable>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -16 }} contentContainerStyle={{ paddingHorizontal: 16, gap: 8, paddingBottom: 4 }}>
        <Chip label="Everything" emoji="✨" selected={!filters.cats.length && !filters.tpc} onPress={() => setFilters({ cats: [], tpc: false })} />
        <Chip label="Volunteer" emoji="🔥" selected={filters.tpc} color={p.cat.wellness} onPress={() => setFilters({ tpc: !filters.tpc })} />
        {CATS.slice(0, 5).map((c) => (
          <Chip key={c.key} label={c.label} emoji={c.emoji} color={p.cat[c.key]} selected={filters.cats.includes(c.key)} onPress={() => toggleCat(c.key)} />
        ))}
      </ScrollView>
    </View>
  );
}

export function SectionTitle({ children, right }: { children: string; right?: React.ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 26, marginBottom: 12 }}>
      <Txt v="h1">{children}</Txt>{right}
    </View>
  );
}
