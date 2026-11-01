import { Camera, Map, Marker, type CameraRef } from '@maplibre/maplibre-react-native';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Poster } from '@/components/events';
import { SearchAndChips } from '@/components/header';
import { Card, Txt } from '@/components/ui';
import { useApp } from '@/lib/app-state';
import { rangeFor, tileWhen } from '@/lib/dates';
import { CAT, HOME, type PEvent } from '@/lib/model';
import { usePalette } from '@/lib/theme';

// Free OpenFreeMap tiles (no key, no usage fees)
const STYLE = { light: 'https://tiles.openfreemap.org/styles/positron', dark: 'https://tiles.openfreemap.org/styles/dark' };

export default function MapScreen() {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const { filters, search, dataVersion, origin } = useApp();
  const [events, setEvents] = useState<PEvent[]>([]);
  const [sel, setSel] = useState<PEvent | null>(null);
  const cam = useRef<CameraRef>(null);

  const load = useCallback(async () => {
    const [a, b] = rangeFor(filters.when);
    const list = await search(a, b, 500).catch(() => [] as PEvent[]);
    setEvents(list);
    const placed = list.filter((e) => e.lat != null && e.lng != null);
    if (placed.length > 1) {
      const lngs = placed.map((e) => e.lng!), lats = placed.map((e) => e.lat!);
      cam.current?.fitBounds([Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)], { padding: { top: 60, bottom: 220, left: 50, right: 50 }, duration: 600 });
    } else if (placed.length === 1) cam.current?.flyTo({ center: [placed[0].lng!, placed[0].lat!], zoom: 13, duration: 600 });
  }, [search, filters.when]);
  useEffect(() => { load(); }, [load, dataVersion]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const placed = events.filter((e) => e.lat != null && e.lng != null);
  return (
    <View style={{ flex: 1, backgroundColor: p.bg }}>
      <View style={{ paddingTop: insets.top + 8, paddingHorizontal: 16, paddingBottom: 10, backgroundColor: p.bg, zIndex: 2 }}>
        <SearchAndChips />
      </View>
      <Map style={{ flex: 1 }} mapStyle={STYLE[p.scheme]} logo={false} attribution attributionPosition={{ bottom: 8, left: 8 }} compass={false} onPress={() => setSel(null)}>
        <Camera ref={cam} initialViewState={{ center: [HOME.lng, HOME.lat], zoom: 11.5 }} />
        {placed.map((e) => (
          <Marker key={e.id} id={e.id} lngLat={[e.lng!, e.lat!]} anchor="bottom" onPress={() => setSel(e)}>
            <View accessibilityRole="button" accessibilityLabel={e.title}
              style={{ width: 36, height: 36, borderRadius: 18, borderBottomLeftRadius: 4, transform: [{ rotate: '-45deg' }], backgroundColor: p.cat[e.category],
                borderWidth: 3, borderColor: '#fff', alignItems: 'center', justifyContent: 'center', elevation: 4, shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 4 }}>
              <Text style={{ transform: [{ rotate: '45deg' }], fontSize: 15 }}>{CAT[e.category]?.emoji}</Text>
            </View>
          </Marker>
        ))}
        {origin?.mine && (
          <Marker id="me" lngLat={[origin.lng, origin.lat]}>
            <View style={{ width: 18, height: 18, borderRadius: 9, backgroundColor: p.focus, borderWidth: 3, borderColor: '#fff' }} />
          </Marker>
        )}
      </Map>
      <View style={{ position: 'absolute', left: 12, right: 12, bottom: 12 }}>
        {sel ? (
          <Pressable onPress={() => router.push({ pathname: '/event/[id]', params: { id: sel.id } })} accessibilityRole="link">
            <Card style={{ flexDirection: 'row', gap: 14, alignItems: 'center', padding: 12 }}>
              <Poster e={sel} size="square" style={{ width: 76, aspectRatio: 1 }} />
              <View style={{ flex: 1 }}>
                <Txt v="smallBold" color={p.cat[sel.category]}>{tileWhen(sel)}</Txt>
                <Txt v="h3" numberOfLines={2}>{sel.title}</Txt>
                {sel.location_name ? <Txt v="small" numberOfLines={1}>{sel.location_name}</Txt> : null}
              </View>
            </Card>
          </Pressable>
        ) : (
          <View style={{ alignSelf: 'center', backgroundColor: p.surface, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8, elevation: 3 }}>
            <Txt v="smallBold">{placed.length} event{placed.length === 1 ? '' : 's'} on the map{events.length - placed.length ? `, ${events.length - placed.length} without an address` : ''}</Txt>
          </View>
        )}
      </View>
    </View>
  );
}
