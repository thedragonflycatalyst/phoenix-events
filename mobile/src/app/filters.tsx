import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Button, Chip, Txt } from '@/components/ui';
import { useApp, type Filters } from '@/lib/app-state';
import { COSTS, RADII, TAGS, WHENS } from '@/lib/model';
import { usePalette } from '@/lib/theme';

export default function FiltersSheet() {
  const p = usePalette();
  const { filters, setFilters } = useApp();
  const [d, setD] = useState<Filters>(filters);
  const toggle = (k: 'tags' | 'cost', v: string) => setD((x) => ({ ...x, [k]: x[k].includes(v) ? x[k].filter((y) => y !== v) : [...x[k], v] }));
  const Group = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <View style={{ marginTop: 20 }}><Txt v="h3" style={{ marginBottom: 10 }}>{title}</Txt><View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{children}</View></View>
  );
  return (
    <View style={{ flex: 1, backgroundColor: p.bg }}>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 120 }}>
        <Txt v="h1">Filters</Txt>
        <Group title="When">{WHENS.map(([k, l]) => <Chip key={k} label={l} selected={d.when === k} onPress={() => setD({ ...d, when: k })} />)}</Group>
        <Group title="Good for">{TAGS.map(([k, l]) => <Chip key={k} label={l} selected={d.tags.includes(k)} onPress={() => toggle('tags', k)} />)}</Group>
        <Group title="Cost">{COSTS.map(([k, l]) => <Chip key={k} label={l} selected={d.cost.includes(k)} onPress={() => toggle('cost', k)} />)}</Group>
        <Group title="Distance">{RADII.map(([k, l]) => <Chip key={String(k)} label={l} selected={d.radius === k} onPress={() => setD({ ...d, radius: k })} />)}</Group>
      </ScrollView>
      <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', gap: 10, padding: 16, paddingBottom: 28, backgroundColor: p.bg, borderTopWidth: 1, borderTopColor: p.line }}>
        <Button style={{ flex: 1 }} kind="ghost" title="Reset" onPress={() => setD({ ...d, when: 'upcoming', tags: [], cost: [], radius: null })} />
        <Button style={{ flex: 2 }} title="Show events" onPress={() => { setFilters(d); router.back(); }} />
      </View>
    </View>
  );
}
