import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { addDays, dayKey, dowShort, firstOfMonth, fmtDay, monShort, tileWhen, whenText } from '@/lib/dates';
import { CAT, CATS, COST, type PEvent, type RsvpKind } from '@/lib/model';
import { posterUrl } from '@/lib/supabase';
import { F, POSTER, R, usePalette, type Cat } from '@/lib/theme';
import { Card, Icon, Press, Txt } from './ui';

const open = (id: string) => router.push({ pathname: '/event/[id]', params: { id } });

/** Every event is a poster: the real flyer photo, or a generated gig poster in its pillar's color. */
export function Poster({ e, style, size = 'tile', insetTop = 0, stamp = true }: { e: PEvent; style?: StyleProp<ViewStyle>; size?: 'hero' | 'tile' | 'thumb' | 'square'; insetTop?: number; stamp?: boolean }) {
  const [hi, mid, lo] = POSTER[e.category] ?? POSTER.other;
  const emoji = CAT[e.category]?.emoji ?? '✨';
  const uri = posterUrl(e.poster_path);
  const small = size === 'thumb' || size === 'square';
  return (
    <View style={[styles.poster, size === 'thumb' && { borderRadius: R.sm }, size === 'square' && { borderRadius: R.md }, style]}>
      <LinearGradient colors={[hi, mid, lo]} locations={[0, 0.45, 1]} start={{ x: 1, y: 0 }} end={{ x: 0.1, y: 1 }} style={StyleSheet.absoluteFill} />
      {uri ? (
        <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="cover" transition={200} accessibilityLabel={size === 'hero' ? `Poster for ${e.title}` : undefined} />
      ) : (
        <View style={[StyleSheet.absoluteFill, { padding: small ? 10 : 16, paddingTop: (small ? 10 : 16) + insetTop, justifyContent: size === 'thumb' ? 'center' : 'space-between', alignItems: size === 'thumb' ? 'center' : 'flex-start' }]}>
          {size !== 'thumb' && <Text style={[styles.ghost, size === 'hero' && { fontSize: 190 }]}>{emoji}</Text>}
          <Text style={{ fontSize: size === 'hero' ? 40 : small ? 26 : 32 }}>{emoji}</Text>
          {size !== 'thumb' && size !== 'hero' && (
            <Text numberOfLines={4} style={[styles.ptitle, size === 'square' && { fontSize: 18, lineHeight: 19 }]}>{e.title}</Text>
          )}
        </View>
      )}
      {!small && stamp && (
        <View style={[styles.stamp, { top: 12 + insetTop }]} accessible={false}>
          <Text style={styles.stampMon}>{monShort(e.starts_at)}</Text>
          <Text style={styles.stampDay}>{new Date(e.starts_at).getDate()}</Text>
        </View>
      )}
      {!small && uri && e.is_tpc && <View style={styles.tpc}><Text style={styles.tpcText}>Phoenix Catalyst</Text></View>}
    </View>
  );
}

export function Tile({ e }: { e: PEvent }) {
  const p = usePalette();
  return (
    <Press onPress={() => open(e.id)} style={{ width: 236 }} accessibilityRole="link" accessibilityLabel={`${e.title}, ${tileWhen(e)}`}>
      <Poster e={e} />
      <Txt v="smallBold" color={p.cat[e.category]} style={{ marginTop: 10 }}>{tileWhen(e)}</Txt>
      <Txt v="h3" numberOfLines={2}>{e.title}</Txt>
      {e.location_name ? <Txt v="small" numberOfLines={1}>{e.location_name}</Txt> : null}
    </Press>
  );
}

function Badge({ label, tone }: { label: string; tone?: 'ink' | 'good' }) {
  const p = usePalette();
  const bg = tone === 'ink' ? p.ink : tone === 'good' ? `${p.good}2e` : p.soft;
  const fg = tone === 'ink' ? p.bg : tone === 'good' ? p.good : p.muted;
  return <View style={{ backgroundColor: bg, borderRadius: R.pill, paddingHorizontal: 9, paddingVertical: 3 }}><Text style={{ fontFamily: F.bodyBold, fontSize: 12, color: fg }}>{label}</Text></View>;
}

/** A ticket stub: perforated date edge, details, and a small poster. */
export function Ticket({ e, rsvp }: { e: PEvent; rsvp?: RsvpKind }) {
  const p = usePalette();
  const c = p.cat[e.category];
  return (
    <Press onPress={() => open(e.id)} accessibilityRole="link" accessibilityLabel={`${e.title}, ${fmtDay(e.starts_at)}, ${whenText(e)}`} style={{ marginBottom: 12 }}>
      <Card style={{ padding: 0, flexDirection: 'row', overflow: 'hidden', minHeight: 96 }}>
        <View style={[styles.stub, { borderRightColor: p.line }]}>
          <Text style={{ fontFamily: F.bodyBold, fontSize: 13, color: c }}>{dowShort(e.starts_at)}</Text>
          <Text style={{ fontFamily: F.display, fontSize: 28, lineHeight: 30, color: c }}>{new Date(e.starts_at).getDate()}</Text>
        </View>
        <View style={[styles.notch, { top: -9, backgroundColor: p.bg }]} />
        <View style={[styles.notch, { bottom: -9, backgroundColor: p.bg }]} />
        <View style={{ flex: 1, paddingVertical: 12, paddingHorizontal: 14, gap: 2 }}>
          <Txt v="h3" numberOfLines={2}>{e.title}</Txt>
          <Txt v="small" numberOfLines={1}>{whenText(e)}{e.location_name ? `, ${e.location_name}` : ''}</Txt>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
            {e.is_tpc && <Badge label="Phoenix Catalyst" tone="ink" />}
            <Badge label={COST[e.cost]} />
            {rsvp && <Badge label={rsvp === 'volunteer' ? 'Volunteering' : 'Going'} tone="good" />}
            {e.going_count > 0 && <Badge label={`${e.going_count} going`} />}
          </View>
        </View>
        <Poster e={e} size="thumb" style={{ width: 64, margin: 8, marginLeft: 0, aspectRatio: undefined }} />
      </Card>
    </Press>
  );
}

/** The next Phoenix Catalyst volunteer event, with a spots-filled meter. */
export function Spotlight({ e }: { e: PEvent }) {
  const p = usePalette();
  const c = p.cat[e.category];
  const pct = e.volunteer_slots ? Math.min(100, Math.round((100 * e.volunteer_count) / e.volunteer_slots)) : 0;
  const left = e.volunteer_slots ? Math.max(0, e.volunteer_slots - e.volunteer_count) : null;
  return (
    <Press onPress={() => open(e.id)} accessibilityRole="link" accessibilityLabel={`Volunteer: ${e.title}`}>
      <Card style={{ flexDirection: 'row', gap: 16, alignItems: 'center', padding: 14 }}>
        <Poster e={e} size="square" style={{ width: 104, aspectRatio: 1 }} />
        <View style={{ flex: 1 }}>
          <Txt v="kicker" color={c}>🔥 Volunteer with us</Txt>
          <Txt v="h2" numberOfLines={2} style={{ marginVertical: 2 }}>{e.title}</Txt>
          <Txt v="small" numberOfLines={2}>{tileWhen(e)}{e.location_name ? `, ${e.location_name}` : ''}</Txt>
          {e.volunteer_slots ? (
            <>
              <View style={{ height: 8, borderRadius: 4, backgroundColor: p.soft, marginTop: 10, overflow: 'hidden' }}>
                <View style={{ width: `${pct}%`, height: '100%', backgroundColor: c, borderRadius: 4 }} />
              </View>
              <Txt v="small" style={{ marginTop: 4 }}>{left ? `${left} of ${e.volunteer_slots} spots open` : 'All spots filled'}</Txt>
            </>
          ) : <Txt v="small" style={{ marginTop: 6 }}>{e.volunteer_count} volunteer{e.volunteer_count === 1 ? '' : 's'} signed up</Txt>}
        </View>
      </Card>
    </Press>
  );
}

/** Month grid where each day fills with bands in the colors of its events. */
export function MonthGrid({ month, events, selected, onSelect, onMonth }: {
  month: Date; events: PEvent[]; selected: string | null; onSelect: (k: string | null) => void; onMonth: (d: Date) => void;
}) {
  const p = usePalette();
  const m = firstOfMonth(month), start = addDays(m, -m.getDay()), today = dayKey(new Date());
  const byDay = new Map<string, Cat[]>();
  for (const e of events) {
    let d = new Date(e.starts_at); d.setHours(0, 0, 0, 0);
    const last = new Date(e.ends_at || e.starts_at); last.setHours(0, 0, 0, 0);
    for (let i = 0; i < 14 && d <= last; i++, d = addDays(d, 1)) {
      const k = dayKey(d); byDay.set(k, [...(byDay.get(k) ?? []), e.category]);
    }
  }
  const order = CATS.map((c) => c.key);
  const cells = Array.from({ length: 42 }, (_, i) => addDays(start, i));
  return (
    <Card>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <Pressable accessibilityLabel="Previous month" onPress={() => onMonth(new Date(m.getFullYear(), m.getMonth() - 1, 1))} style={[styles.round, { backgroundColor: p.soft }]}><Icon name="chevron_left" /></Pressable>
        <Txt v="h2">{m.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</Txt>
        <Pressable accessibilityLabel="Next month" onPress={() => onMonth(new Date(m.getFullYear(), m.getMonth() + 1, 1))} style={[styles.round, { backgroundColor: p.soft }]}><Icon name="chevron_right" /></Pressable>
      </View>
      <View style={styles.row7}>{['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => <Txt key={i} v="small" center style={{ width: '14.28%' }}>{d}</Txt>)}</View>
      <View style={[styles.row7, { flexWrap: 'wrap' }]}>
        {cells.map((d) => {
          const k = dayKey(d), cats = (byDay.get(k) ?? []).sort((a, b) => order.indexOf(a) - order.indexOf(b)).slice(0, 5);
          const out = d.getMonth() !== m.getMonth(), isToday = k === today, past = k < today, sel = selected === k;
          return (
            <View key={k} style={{ width: '14.28%', padding: 2.5 }}>
              <Pressable
                accessibilityRole="button" accessibilityState={{ selected: sel }}
                accessibilityLabel={`${fmtDay(d)}: ${cats.length ? `${cats.length} event${cats.length > 1 ? 's' : ''}` : 'no events'}`}
                onPress={() => onSelect(sel ? null : k)}
                style={[styles.day, { backgroundColor: p.soft, opacity: out ? 0.3 : 1, borderColor: sel ? p.ink : 'transparent' }]}>
                <View style={{ flex: 1, flexDirection: 'column-reverse' }}>
                  {cats.map((c, i) => <View key={i} style={{ height: '20%', backgroundColor: p.cat[c], opacity: past ? 0.4 : 1 }} />)}
                </View>
                <View style={[styles.dayNum, isToday && { backgroundColor: p.ink }]}>
                  <Text style={{ fontFamily: F.bodyBold, fontSize: 12, color: isToday ? p.bg : cats.length >= 4 ? '#fff' : p.ink }}>{d.getDate()}</Text>
                </View>
              </Pressable>
            </View>
          );
        })}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 12 }}>
        {CATS.slice(0, 5).map((c) => (
          <View key={c.key} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: p.cat[c.key] }} /><Txt v="small">{c.label}</Txt>
          </View>
        ))}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  poster: { aspectRatio: 4 / 5, borderRadius: R.lg, overflow: 'hidden', backgroundColor: '#24174f' },
  ghost: { position: 'absolute', right: -28, bottom: 18, fontSize: 150, opacity: 0.2, transform: [{ rotate: '-14deg' }] },
  ptitle: { fontFamily: F.display, color: '#fff', fontSize: 30, lineHeight: 30, letterSpacing: -0.8, textShadowColor: 'rgba(0,0,0,.25)', textShadowRadius: 8 },
  stamp: { position: 'absolute', top: 12, right: 12, backgroundColor: 'rgba(255,255,255,.93)', borderRadius: 12, paddingHorizontal: 9, paddingVertical: 5, alignItems: 'center' },
  stampMon: { fontFamily: F.bodyBold, fontSize: 11, color: '#5c5368' },
  stampDay: { fontFamily: F.display, fontSize: 22, lineHeight: 24, color: '#120e17' },
  tpc: { position: 'absolute', left: 12, bottom: 12, backgroundColor: 'rgba(18,14,23,.8)', borderRadius: R.pill, paddingHorizontal: 10, paddingVertical: 5 },
  tpcText: { fontFamily: F.bodyBold, fontSize: 12, color: '#fff' },
  stub: { width: 64, alignItems: 'center', justifyContent: 'center', borderRightWidth: 2, borderStyle: 'dashed' },
  notch: { position: 'absolute', left: 55, width: 18, height: 18, borderRadius: 9 },
  round: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  row7: { flexDirection: 'row' },
  day: { aspectRatio: 1, borderRadius: 10, overflow: 'hidden', borderWidth: 2 },
  dayNum: { position: 'absolute', top: 3, left: 3, borderRadius: 8, paddingHorizontal: 5 },
});
