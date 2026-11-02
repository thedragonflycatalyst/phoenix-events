import RNDateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { File } from 'expo-file-system';
import { Image } from 'expo-image';
import * as Crypto from 'expo-crypto';
import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Platform, Pressable, ScrollView, Switch, View } from 'react-native';
import { useApp } from '@/lib/app-state';
import { addDays, dayKey } from '@/lib/dates';
import { geocode } from '@/lib/geo';
import { CATS, COSTS, errText, TAGS, type PEvent } from '@/lib/model';
import { addToPhoneCalendar } from '@/lib/phone';
import { fmtShort, fmtTime } from '@/lib/dates';
import { sb } from '@/lib/supabase';
import { F, R, usePalette } from '@/lib/theme';
import { Button, Card, Chip, Field, Icon, Txt, useToast } from './ui';

export type Draft = Partial<Pick<PEvent, 'title' | 'category' | 'location_name' | 'address' | 'organizer' | 'cost' | 'url' | 'description' | 'is_tpc' | 'is_youth' | 'chaperone_ratio' | 'volunteer_slots' | 'all_day'>> & {
  tags?: string[]; start?: Date | null; end?: Date | null;
};

function DateTimeField({ label, value, mode, onChange, optional }: { label: string; value: Date | null; mode: 'date' | 'time'; onChange: (d: Date | null) => void; optional?: boolean }) {
  const p = usePalette();
  const text = value ? (mode === 'date' ? value.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) : value.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })) : optional ? 'Optional' : 'Choose';
  const open = () => DateTimePickerAndroid.open({ value: value ?? new Date(), mode, is24Hour: false, onChange: (ev, d) => { if (ev.type === 'set' && d) onChange(d); } });
  return (
    <View style={{ flex: 1, marginBottom: 16 }}>
      <Txt v="bold" style={{ marginBottom: 6, fontSize: 15 }}>{label}</Txt>
      {Platform.OS === 'ios' ? (
        value ? <RNDateTimePicker value={value} mode={mode} display="compact" onChange={(_, d) => d && onChange(d)} style={{ alignSelf: 'flex-start' }} />
          : <Button small kind="ghost" title="Add" onPress={() => onChange(new Date())} style={{ alignSelf: 'flex-start' }} />
      ) : (
        <Pressable onPress={open} accessibilityRole="button" accessibilityLabel={`${label}: ${text}`}
          style={{ minHeight: 50, borderWidth: 1.5, borderColor: p.line, borderRadius: R.sm, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: p.surface }}>
          <Txt color={value ? p.ink : p.muted}>{text}</Txt>
          {optional && value ? <Pressable hitSlop={10} onPress={() => onChange(null)} accessibilityLabel={`Clear ${label}`}><Icon name="close" size={18} color={p.muted} /></Pressable>
            : <Icon name={mode === 'date' ? 'calendar_month' : 'schedule'} size={18} color={p.muted} />}
        </Pressable>
      )}
    </View>
  );
}

/** Shared add/edit form. `poster` is a local photo to upload when posting. */
type Dupe = { id: string; title: string; starts_at: string; location_name: string | null };

/** Asks whether a similar event already on the calendar is the same one. Resolves 'post' to carry on. */
function confirmNotDuplicate(dupe: Dupe): Promise<'post' | 'open' | 'cancel'> {
  const when = `${fmtShort(dupe.starts_at)} at ${fmtTime(dupe.starts_at)}`;
  return new Promise((resolve) => Alert.alert(
    'Already on the calendar?',
    `“${dupe.title}” on ${when}${dupe.location_name ? ` at ${dupe.location_name}` : ''} looks like the same event.`,
    [
      { text: 'Cancel', style: 'cancel', onPress: () => resolve('cancel') },
      { text: 'Open it', onPress: () => resolve('open') },
      { text: 'It’s different, post', onPress: () => resolve('post') },
    ],
    { cancelable: true, onDismiss: () => resolve('cancel') },
  ));
}

export function EventForm({ initial, existing, poster, header, note, phoneDefault = false, onPosted }: { initial: Draft; existing?: PEvent; poster?: string; header?: React.ReactNode; note?: string; phoneDefault?: boolean; onPosted?: () => void }) {
  const p = usePalette();
  const toast = useToast();
  const app = useApp();
  // Only Phoenix leaders can mark a flyer's "Hosted by The Phoenix Catalyst"; for leaders it turns on the official switch
  const claimsTpc = !existing && /phoenix\s*catalyst/i.test(initial.organizer ?? '');
  const [d, setD] = useState<Draft>(() => ({
    category: 'community', cost: 'free', tags: [], all_day: false, ...initial,
    ...(claimsTpc ? (app.canTpc ? { is_tpc: true } : { organizer: '' }) : {}),
  }));
  const tpcNote = claimsTpc && !app.canTpc ? 'This flyer says it’s hosted by The Phoenix Catalyst. Only Phoenix leaders can post official Phoenix events, so the host was left blank.' : '';
  const [busy, setBusy] = useState(false);
  const [alsoPhone, setAlsoPhone] = useState(phoneDefault);
  const set = (patch: Draft) => setD((x) => ({ ...x, ...patch }));

  // Date and times are edited separately but stored as one start/end
  const day = d.start ?? null;
  const withTime = (base: Date, t: Date) => { const x = new Date(base); x.setHours(t.getHours(), t.getMinutes(), 0, 0); return x; };

  const save = async () => {
    const title = (d.title ?? '').trim();
    if (title.length < 2) return toast('Add an event name', false);
    if (!d.start) return toast('Add the date', false);
    let start = new Date(d.start), end = d.end ? new Date(d.end) : null;
    if (d.all_day) { start.setHours(0, 0, 0, 0); if (end) end.setHours(0, 0, 0, 0); }
    if (end && !d.all_day && end <= start && dayKey(end) === dayKey(start)) end = addDays(end, 1);
    if (end && end < start) return toast('The end is before the start', false);
    let url = (d.url ?? '').trim();
    if (url && !/^https?:\/\//i.test(url)) url = `https://${url}`;
    const row: Record<string, unknown> = {
      title, category: d.category, starts_at: start.toISOString(), ends_at: end ? end.toISOString() : null, all_day: !!d.all_day,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York',
      location_name: d.location_name?.trim() || null, address: d.address?.trim() || null, organizer: d.organizer?.trim() || null,
      cost: d.cost, tags: d.tags ?? [], url: url || null, description: d.description?.trim() || null,
    };
    if (app.canTpc) {
      row.is_tpc = !!d.is_tpc; row.volunteer_slots = d.volunteer_slots || null;
      row.is_youth = !!d.is_tpc && !!d.is_youth; row.chaperone_ratio = row.is_youth ? d.chaperone_ratio?.trim() || null : null;
      if (row.is_youth && !row.chaperone_ratio) { toast('Add the chaperone ratio for this youth event, like 1 adult per 8 kids', false); return; }
    }
    setBusy(true);
    try {
      // Safeguard: check for the same event before uploading anything
      if (!existing) {
        const { data: dupes } = await sb.rpc('phoenix_find_duplicates', { p_title: title, p_starts_at: row.starts_at, p_address: row.address });
        const dupe = (dupes as Dupe[] | null)?.[0];
        if (dupe) {
          const choice = await confirmNotDuplicate(dupe);
          if (choice === 'open') { router.push({ pathname: '/event/[id]', params: { id: dupe.id } }); return; }
          if (choice === 'cancel') return;
        }
      }
      const where = (row.address || row.location_name) as string | null;
      const placeChanged = !existing || existing.address !== row.address || existing.location_name !== row.location_name;
      let unplaced = false;
      if (where && placeChanged) {
        const g = (await geocode([row.address, row.location_name].filter(Boolean).join(', '))) ?? (row.address ? await geocode(row.address as string) : null);
        row.lat = g?.lat ?? null; row.lng = g?.lng ?? null; unplaced = !g;
      } else if (!where) { row.lat = null; row.lng = null; }
      if (poster && app.user) {
        const path = `${app.user.id}/${Crypto.randomUUID()}.jpg`;
        const bytes = await new File(poster).arrayBuffer();
        const { error } = await sb.storage.from('phoenix-posters').upload(path, bytes, { contentType: 'image/jpeg' });
        if (error) throw error;
        row.poster_path = path; row.source = 'poster';
      }
      let id = existing?.id;
      if (existing) {
        const { error } = await sb.from('phoenix_events').update(row).eq('id', existing.id);
        if (error) throw error;
      } else {
        const { data, error } = await sb.from('phoenix_events').insert(row).select('id').single();
        if (error) { if (row.poster_path) await sb.storage.from('phoenix-posters').remove([row.poster_path as string]); throw error; }
        id = data.id;
      }
      let phoneNote = '';
      if (!existing && alsoPhone && id) {
        const r = await addToPhoneCalendar({ ...(row as unknown as PEvent), id }).catch(() => 'no-calendar' as const);
        phoneNote = r === 'added' || r === 'already' ? ' Added to your phone calendar too.' : r === 'denied' ? ' Allow calendar access to add it to your phone.' : '';
      }
      app.bump();
      toast((unplaced ? `${existing ? 'Saved' : 'Posted'}. We couldn’t find that place on the map.` : existing ? 'Saved' : 'Posted! Thanks for sharing. 🔥') + phoneNote);
      // Open the new event on top of the tabs so Back returns to the app instead of closing it
      if (existing) router.back(); else { onPosted?.(); router.push({ pathname: '/event/[id]', params: { id: id! } }); }
    } catch (err) { toast(errText(err), false); } finally { setBusy(false); }
  };

  const toggleTag = (k: string) => set({ tags: d.tags?.includes(k) ? d.tags.filter((x) => x !== k) : [...(d.tags ?? []), k] });
  return (
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 16, paddingBottom: 60 }} style={{ backgroundColor: p.bg }}>
      {header}
      {note ? <Card style={{ marginBottom: 14, flexDirection: 'row', gap: 10, alignItems: 'center' }}><Txt style={{ fontSize: 22 }}>✨</Txt><Txt v="bold" style={{ flex: 1 }}>{note}</Txt></Card> : null}
      {tpcNote ? <Card style={{ marginBottom: 14, flexDirection: 'row', gap: 10, alignItems: 'center' }}><Icon name="shield_person" color={p.muted} /><Txt v="small" style={{ flex: 1 }}>{tpcNote}</Txt></Card> : null}
      {poster && <Image source={{ uri: poster }} style={{ width: '100%', aspectRatio: 4 / 5, borderRadius: R.lg, marginBottom: 16 }} contentFit="cover" accessibilityLabel="Your flyer photo" />}
      <Card style={{ marginBottom: 14 }}>
        <Field label="Event name" value={d.title ?? ''} onChangeText={(t) => set({ title: t })} maxLength={140} />
        <Txt v="bold" style={{ marginBottom: 8, fontSize: 15 }}>Type of event</Txt>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {CATS.map((c) => <Chip key={c.key} label={c.label} emoji={c.emoji} color={p.cat[c.key]} selected={d.category === c.key} onPress={() => set({ category: c.key })} />)}
        </View>
      </Card>
      <Card style={{ marginBottom: 14 }}>
        <Txt v="h3" style={{ marginBottom: 12 }}>When</Txt>
        <DateTimeField label="Date" mode="date" value={day} onChange={(v) => v && set({ start: d.start ? withTime(v, d.start) : (() => { const x = new Date(v); x.setHours(12, 0, 0, 0); return x; })(), end: d.end ? withTime(v, d.end) : null })} />
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <Txt v="bold">All day</Txt>
          <Switch value={!!d.all_day} onValueChange={(v) => set({ all_day: v })} trackColor={{ true: p.focus, false: p.line }} thumbColor="#fff" />
        </View>
        {!d.all_day && (
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <DateTimeField label="Starts" mode="time" value={d.start ?? null} onChange={(t) => t && set({ start: withTime(d.start ?? new Date(), t) })} />
            <DateTimeField label="Ends" mode="time" optional value={d.end ?? null} onChange={(t) => set({ end: t ? withTime(d.start ?? new Date(), t) : null })} />
          </View>
        )}
      </Card>
      <Card style={{ marginBottom: 14 }}>
        <Txt v="h3" style={{ marginBottom: 12 }}>Where</Txt>
        <Field label="Place name" placeholder="Centennial Park" value={d.location_name ?? ''} onChangeText={(t) => set({ location_name: t })} maxLength={200} />
        <Field label="Address" placeholder="Street, city" value={d.address ?? ''} onChangeText={(t) => set({ address: t })} maxLength={300} autoComplete="street-address" />
        <Field label="Hosted by" placeholder="Columbia Association" value={d.organizer ?? ''} onChangeText={(t) => set({ organizer: t })} maxLength={140} />
      </Card>
      <Card style={{ marginBottom: 14 }}>
        <Txt v="h3" style={{ marginBottom: 10 }}>Details</Txt>
        <Txt v="bold" style={{ marginBottom: 8, fontSize: 15 }}>Cost</Txt>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
          {COSTS.map(([k, l]) => <Chip key={k} label={l} selected={d.cost === k} onPress={() => set({ cost: k })} />)}
        </View>
        <Txt v="bold" style={{ marginBottom: 8, fontSize: 15 }}>Good for</Txt>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
          {TAGS.map(([k, l]) => <Chip key={k} label={l} selected={!!d.tags?.includes(k)} onPress={() => toggleTag(k)} />)}
        </View>
        <Field label="Link" hint="(optional)" placeholder="https://" value={d.url ?? ''} onChangeText={(t) => set({ url: t })} autoCapitalize="none" keyboardType="url" maxLength={500} />
        <Field label="More about it" multiline value={d.description ?? ''} onChangeText={(t) => set({ description: t })} maxLength={5000} />
      </Card>
      {app.canTpc && (
        <Card style={{ marginBottom: 14 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <View style={{ flex: 1 }}><Txt v="bold">🔥 Official Phoenix Catalyst event</Txt><Txt v="small">Shows the Volunteer button and spot count</Txt></View>
            <Switch value={!!d.is_tpc} onValueChange={(v) => set({ is_tpc: v })} trackColor={{ true: p.cat.wellness, false: p.line }} thumbColor="#fff" />
          </View>
          {d.is_tpc && <View style={{ marginTop: 14 }}><Field label="Volunteer spots" hint="(blank for unlimited)" keyboardType="number-pad" value={d.volunteer_slots ? String(d.volunteer_slots) : ''}
            onChangeText={(t) => set({ volunteer_slots: t ? Math.max(1, Math.min(1000, Number(t.replace(/\D/g, '')) || 1)) : null })} /></View>}
          {d.is_tpc && (
            <View style={{ marginTop: 6 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <View style={{ flex: 1 }}><Txt v="bold">🧒 Youth event</Txt><Txt v="small">For kids and teens, supervised by approved adult chaperones</Txt></View>
                <Switch value={!!d.is_youth} onValueChange={(v) => set({ is_youth: v })} trackColor={{ true: p.cat.wellness, false: p.line }} thumbColor="#fff" accessibilityLabel="Youth event" />
              </View>
              {d.is_youth && <View style={{ marginTop: 14 }}><Field label="Chaperone ratio" placeholder="1 adult per 8 kids" value={d.chaperone_ratio ?? ''} onChangeText={(t) => set({ chaperone_ratio: t })} maxLength={80} /></View>}
            </View>
          )}
        </Card>
      )}
      {!existing && (
        <Card style={{ marginBottom: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <View style={{ flex: 1 }}>
            <Txt v="bold">Also add to my phone calendar</Txt>
            <Txt v="small">With a reminder an hour before.</Txt>
          </View>
          <Switch value={alsoPhone} onValueChange={setAlsoPhone} trackColor={{ true: p.focus, false: p.line }} thumbColor="#fff" accessibilityLabel="Also add to my phone calendar" />
        </Card>
      )}
      <Button title={existing ? 'Save changes' : 'Post event'} busy={busy} onPress={save} />
      <Txt v="small" center style={{ marginTop: 10, fontFamily: F.body }}>Posts go live right away. Volunteer moderators look things over.</Txt>
    </ScrollView>
  );
}
