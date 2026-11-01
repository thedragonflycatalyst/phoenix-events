import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, TextInput, View } from 'react-native';
import { Button, Chip, Txt } from '@/components/ui';
import { useApp, type Filters } from '@/lib/app-state';
import { lookupZip } from '@/lib/geo';
import { COSTS, RADII, TAGS, WHENS } from '@/lib/model';
import { F, R, usePalette } from '@/lib/theme';

export default function FiltersSheet() {
  const p = usePalette();
  const { filters, setFilters } = useApp();
  const [d, setD] = useState<Filters>(filters);
  const [useZip, setUseZip] = useState(!!filters.near);
  const [zip, setZip] = useState(filters.near?.zip ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const toggle = (k: 'tags' | 'cost', v: string) => setD((x) => ({ ...x, [k]: x[k].includes(v) ? x[k].filter((y) => y !== v) : [...x[k], v] }));
  const Group = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <View style={{ marginTop: 20 }}><Txt v="h3" style={{ marginBottom: 10 }}>{title}</Txt><View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{children}</View></View>
  );

  const apply = async () => {
    setErr('');
    let near = null;
    if (useZip) {
      if (!/^\d{5}$/.test(zip)) { setErr('Enter a 5-digit ZIP code.'); return; }
      if (filters.near?.zip === zip) near = filters.near;
      else {
        setBusy(true);
        near = await lookupZip(zip);
        setBusy(false);
        if (!near) { setErr('We couldn’t find that ZIP code. Check it and try again.'); return; }
      }
    }
    setFilters({ ...d, near, radius: useZip && !d.radius ? 10 : d.radius });
    router.back();
  };

  return (
    <View style={{ flex: 1, backgroundColor: p.bg }}>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 120 }} keyboardShouldPersistTaps="handled">
        <Txt v="h1">Filters</Txt>
        <Group title="When">{WHENS.map(([k, l]) => <Chip key={k} label={l} selected={d.when === k} onPress={() => setD({ ...d, when: k })} />)}</Group>
        <Group title="Distance">{RADII.map(([k, l]) => <Chip key={String(k)} label={l} selected={d.radius === k} onPress={() => setD({ ...d, radius: k })} />)}</Group>
        <Group title="Measure from">
          <Chip label="📍 My location" selected={!useZip} onPress={() => { setUseZip(false); setErr(''); }} />
          <Chip label="ZIP code" selected={useZip} onPress={() => setUseZip(true)} />
        </Group>
        {useZip && (
          <View style={{ marginTop: 12 }}>
            <TextInput
              value={zip} onChangeText={(t) => setZip(t.replace(/\D/g, '').slice(0, 5))} keyboardType="number-pad" maxLength={5} autoFocus={!filters.near}
              placeholder="21044" placeholderTextColor={p.muted} accessibilityLabel="ZIP code" returnKeyType="done" onSubmitEditing={apply}
              style={{ height: 50, width: 160, borderWidth: 1.5, borderColor: err ? p.danger : p.line, borderRadius: R.sm, paddingHorizontal: 14, color: p.ink, fontFamily: F.bodyBold, fontSize: 20, letterSpacing: 2, backgroundColor: p.surface }}
            />
            <Txt v="small" style={{ marginTop: 6 }}>{filters.near && filters.near.zip === zip ? `Using ${filters.near.label}` : 'Distances are measured from the center of this ZIP code.'}</Txt>
          </View>
        )}
        {err ? <Txt v="bold" color={p.danger} style={{ marginTop: 8 }} accessibilityLiveRegion="polite">{err}</Txt> : null}
        <Group title="Good for">{TAGS.map(([k, l]) => <Chip key={k} label={l} selected={d.tags.includes(k)} onPress={() => toggle('tags', k)} />)}</Group>
        <Group title="Cost">{COSTS.map(([k, l]) => <Chip key={k} label={l} selected={d.cost.includes(k)} onPress={() => toggle('cost', k)} />)}</Group>
      </ScrollView>
      <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', gap: 10, padding: 16, paddingBottom: 28, backgroundColor: p.bg, borderTopWidth: 1, borderTopColor: p.line }}>
        <Button style={{ flex: 1 }} kind="ghost" title="Reset" onPress={() => { setD({ ...d, when: 'upcoming', tags: [], cost: [], radius: null }); setUseZip(false); setZip(''); setErr(''); }} />
        <Button style={{ flex: 2 }} title="Show events" busy={busy} onPress={apply} />
      </View>
    </View>
  );
}
