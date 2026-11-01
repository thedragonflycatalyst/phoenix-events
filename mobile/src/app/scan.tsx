// Live flyer scanner: works like a QR scanner. Point the camera at a poster and,
// once it reads a name and a date, it asks whether to add the event.
import { CameraView, useCameraPermissions } from 'expo-camera';
import { File } from 'expo-file-system';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { router, useIsFocused } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, AppState, Easing, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Icon } from '@/components/ui';
import { useApp } from '@/lib/app-state';
import { fmtShort, fmtTime } from '@/lib/dates';
import type { PosterGuess } from '@/lib/ocr/parse';
import { looksLikeEvent, setPendingScan, type Scan } from '@/lib/ocr/pending';
import { readPoster, shrinkPhoto } from '@/lib/ocr/read';
import { addScanToPhoneCalendar } from '@/lib/phone';
import { F, R, usePalette } from '@/lib/theme';

const GAP_MS = 600; // pause between reads so the phone stays cool
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const forget = (uri: string) => { try { new File(uri).delete(); } catch { /* already gone */ } };

const whenOf = (g: PosterGuess) => {
  if (!g.start) return '';
  const day = fmtShort(g.start);
  if (g.allDay) return day;
  return `${day} · ${fmtTime(g.start)}${g.end ? `–${fmtTime(g.end)}` : ''}`;
};

export default function ScanScreen() {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const { user } = useApp();
  const focused = useIsFocused();
  const [perm, requestPerm] = useCameraPermissions();
  const cam = useRef<CameraView>(null);
  const [ready, setReady] = useState(false);
  const [torch, setTorch] = useState(false);
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');
  const [found, setFound] = useState<(Scan & { sure: boolean }) | null>(null);
  const [manual, setManual] = useState(false);
  const [saved, setSaved] = useState<'idle' | 'busy' | 'added' | 'denied' | 'no-calendar'>('idle');
  const busy = useRef(false);

  useEffect(() => { const s = AppState.addEventListener('change', (st) => setAppActive(st === 'active')); return () => s.remove(); }, []);
  useEffect(() => { if (perm && !perm.granted && perm.canAskAgain) requestPerm(); }, [perm, requestPerm]);

  const live = !!perm?.granted && focused && appActive && !found;

  /** Takes a quiet still from the preview and reads it on the phone. */
  const grab = async (): Promise<Scan | null> => {
    const shot = await cam.current?.takePictureAsync({ quality: 0.7, shutterSound: false });
    if (!shot) return null;
    const small = await shrinkPhoto(shot.uri, shot.width, shot.height);
    if (small !== shot.uri) forget(shot.uri);
    try { return { uri: small, guess: await readPoster(small) }; } catch { forget(small); return null; }
  };

  // The scanning loop: keep reading frames until one looks like an event
  useEffect(() => {
    if (!live || !ready) return;
    let stop = false;
    void (async () => {
      while (!stop) {
        await sleep(GAP_MS);
        if (stop || busy.current) continue;
        busy.current = true;
        try {
          const scan = await grab();
          if (!scan) continue;
          if (!stop && looksLikeEvent(scan.guess)) {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
            setSaved('idle'); setFound({ ...scan, sure: true }); stop = true;
          } else forget(scan.uri);
        } catch { /* camera busy or closing; try the next frame */ } finally { busy.current = false; }
      }
    })();
    return () => { stop = true; };
  }, [live, ready]);

  // Shutter: read this exact photo even if it doesn't look like an event
  const snapNow = async () => {
    if (busy.current) return;
    busy.current = true; setManual(true);
    try {
      const scan = await grab();
      if (scan) { setSaved('idle'); setFound({ ...scan, sure: looksLikeEvent(scan.guess) }); }
    } finally { busy.current = false; setManual(false); }
  };

  const fromPhotos = async () => {
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
    const a = res.canceled ? undefined : res.assets[0];
    if (!a) return;
    setManual(true);
    try {
      const small = await shrinkPhoto(a.uri, a.width, a.height);
      const guess = await readPoster(small).catch(() => null);
      if (guess) { setSaved('idle'); setFound({ uri: small, guess, sure: looksLikeEvent(guess) }); }
    } finally { setManual(false); }
  };

  const close = () => { if (found) forget(found.uri); if (router.canGoBack()) router.back(); else router.replace('/'); };
  const rescan = () => { if (found) forget(found.uri); setFound(null); };
  const post = () => {
    if (!found) return;
    if (!user) { router.push('/sign-in'); return; }
    setPendingScan({ uri: found.uri, guess: found.guess });
    setFound(null);
    router.dismissTo('/add');
  };
  const toPhone = async () => {
    if (!found?.guess.start) return;
    setSaved('busy');
    const g = found.guess;
    const r = await addScanToPhoneCalendar({
      title: g.title, start: g.start as Date, end: g.end, allDay: g.allDay,
      place: [g.location_name, g.address].filter(Boolean).join(', '), notes: [g.description, g.url].filter(Boolean).join('\n\n'),
    }).catch(() => 'no-calendar' as const);
    setSaved(r);
    if (r === 'added') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  };

  if (!perm) return <View style={{ flex: 1, backgroundColor: '#000' }} />;
  if (!perm.granted) {
    return (
      <View style={{ flex: 1, backgroundColor: p.bg, padding: 24, paddingTop: insets.top + 24, justifyContent: 'center', gap: 14 }}>
        <Text style={{ fontSize: 48, textAlign: 'center' }}>📷</Text>
        <Text style={[st.h, { color: p.ink, textAlign: 'center' }]}>Let Phoenix use the camera</Text>
        <Text style={[st.body, { color: p.muted, textAlign: 'center' }]}>The scanner reads flyers right on your phone. Nothing is uploaded unless you post the event.</Text>
        <Button title={perm.canAskAgain ? 'Allow camera' : 'Open Settings'} onPress={() => (perm.canAskAgain ? requestPerm() : Linking.openSettings())} />
        <Button kind="ghost" title="Not now" onPress={close} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <CameraView ref={cam} style={StyleSheet.absoluteFill} facing="back" active={live} enableTorch={torch} animateShutter={false}
        onCameraReady={() => setReady(true)} onMountError={() => setReady(false)} />

      {/* Top controls */}
      <View style={[st.row, { position: 'absolute', top: insets.top + 8, left: 16, right: 16, justifyContent: 'space-between' }]}>
        <RoundBtn icon="close" label="Close scanner" onPress={close} />
        <Text style={st.title}>Scan a flyer</Text>
        <RoundBtn icon={torch ? 'flash_on' : 'flash_off'} label={torch ? 'Turn flashlight off' : 'Turn flashlight on'} onPress={() => setTorch((t) => !t)} />
      </View>

      {!found && <Viewfinder scanning={live && ready} />}

      {/* Bottom controls while scanning */}
      {!found && (
        <View style={{ position: 'absolute', left: 0, right: 0, bottom: insets.bottom + 24, alignItems: 'center', gap: 18 }}>
          <View style={st.pill}>
            {manual ? <ActivityIndicator color="#fff" size="small" /> : <View style={st.dot} />}
            <Text style={st.pillText}>{manual ? 'Reading…' : 'Point at an event flyer'}</Text>
          </View>
          <View style={[st.row, { gap: 36 }]}>
            <RoundBtn icon="photo_library" label="Pick a flyer from your photos" onPress={fromPhotos} />
            <Pressable onPress={snapNow} accessibilityRole="button" accessibilityLabel="Take the photo now" style={({ pressed }) => [st.shutter, { transform: [{ scale: pressed ? 0.92 : 1 }] }]}>
              <View style={st.shutterIn} />
            </Pressable>
            <View style={{ width: 48 }} />
          </View>
        </View>
      )}

      {/* "Looks like an event!" sheet */}
      {found && (
        <View style={[st.sheet, { backgroundColor: p.bg, paddingBottom: insets.bottom + 18 }]}>
          <View style={[st.row, { gap: 14, alignItems: 'flex-start' }]}>
            <Image source={{ uri: found.uri }} style={{ width: 76, height: 96, borderRadius: R.md }} contentFit="cover" accessibilityLabel="The flyer" />
            <View style={{ flex: 1, gap: 3 }}>
              <Text style={[st.kicker, { color: found.sure ? p.good : p.muted }]}>{found.sure ? 'LOOKS LIKE AN EVENT' : 'COULDN’T FIND A DATE'}</Text>
              <Text style={[st.h, { color: p.ink }]} numberOfLines={2}>{found.guess.title || 'Untitled event'}</Text>
              {!!found.guess.start && <Text style={[st.body, { color: p.ink }]}>{whenOf(found.guess)}</Text>}
              {!!(found.guess.location_name || found.guess.address) && <Text style={[st.body, { color: p.muted }]} numberOfLines={2}>{[found.guess.location_name, found.guess.address].filter(Boolean).join(', ')}</Text>}
            </View>
          </View>
          <Text style={[st.body, { color: p.ink, marginTop: 16, fontFamily: F.bodyBold }]}>{found.sure ? 'Add it to the calendar?' : 'Want to fill in the details yourself?'}</Text>
          <View style={{ gap: 10, marginTop: 12 }}>
            <Button icon="add" title={user ? (found.sure ? 'Add to Phoenix calendar' : 'Fill in the details') : 'Sign in to post it'} onPress={post} />
            {found.sure && (
              <Button kind="ghost" icon={saved === 'added' ? 'check' : 'calendar_month'} busy={saved === 'busy'} disabled={saved === 'added'}
                title={{ idle: 'Just add it to my phone calendar', busy: 'Adding…', added: 'Added to your phone calendar', denied: 'Allow calendar access in Settings', 'no-calendar': 'No phone calendar found' }[saved]}
                onPress={toPhone} />
            )}
            <Button kind="quiet" icon="document_scanner" title="Keep scanning" onPress={rescan} />
          </View>
        </View>
      )}
    </View>
  );
}

function RoundBtn({ icon, label, onPress }: { icon: 'close' | 'flash_on' | 'flash_off' | 'photo_library'; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} hitSlop={8}
      style={({ pressed }) => [st.round, { opacity: pressed ? 0.7 : 1 }]}>
      <Icon name={icon} color="#fff" />
    </Pressable>
  );
}

/** Corner brackets with a sweeping line, so it feels alive like a QR scanner. */
function Viewfinder({ scanning }: { scanning: boolean }) {
  const sweep = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!scanning) { sweep.stopAnimation(); return; }
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(sweep, { toValue: 1, duration: 1600, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.timing(sweep, { toValue: 0, duration: 1600, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [scanning, sweep]);
  const H = 400;
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}>
      <View style={{ width: '78%', height: H, maxWidth: 360 }}>
        {(['tl', 'tr', 'bl', 'br'] as const).map((c) => (
          <View key={c} style={[st.corner, {
            top: c[0] === 't' ? 0 : undefined, bottom: c[0] === 'b' ? 0 : undefined,
            left: c[1] === 'l' ? 0 : undefined, right: c[1] === 'r' ? 0 : undefined,
            borderTopWidth: c[0] === 't' ? 4 : 0, borderBottomWidth: c[0] === 'b' ? 4 : 0,
            borderLeftWidth: c[1] === 'l' ? 4 : 0, borderRightWidth: c[1] === 'r' ? 4 : 0,
            borderTopLeftRadius: c === 'tl' ? 22 : 0, borderTopRightRadius: c === 'tr' ? 22 : 0,
            borderBottomLeftRadius: c === 'bl' ? 22 : 0, borderBottomRightRadius: c === 'br' ? 22 : 0,
          }]} />
        ))}
        {scanning && (
          <Animated.View style={[st.line, { transform: [{ translateY: sweep.interpolate({ inputRange: [0, 1], outputRange: [16, H - 20] }) }] }]} />
        )}
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  title: { fontFamily: F.displayBold, fontSize: 18, color: '#fff', textShadowColor: 'rgba(0,0,0,.5)', textShadowRadius: 6 },
  round: { width: 48, height: 48, borderRadius: 24, backgroundColor: 'rgba(0,0,0,.45)', alignItems: 'center', justifyContent: 'center' },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: 'rgba(0,0,0,.55)', borderRadius: R.pill, paddingHorizontal: 18, paddingVertical: 10 },
  pillText: { fontFamily: F.bodyBold, fontSize: 16, color: '#fff' },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#5be3a0' },
  shutter: { width: 78, height: 78, borderRadius: 39, borderWidth: 4, borderColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  shutterIn: { width: 62, height: 62, borderRadius: 31, backgroundColor: '#fff' },
  corner: { position: 'absolute', width: 54, height: 54, borderColor: '#fff' },
  line: { position: 'absolute', left: 14, right: 14, height: 3, borderRadius: 2, backgroundColor: '#ff9a5c', shadowColor: '#ff9a5c', shadowOpacity: 0.9, shadowRadius: 10, elevation: 6 },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 20 },
  kicker: { fontFamily: F.bodyBold, fontSize: 12, letterSpacing: 1.2 },
  h: { fontFamily: F.displayBold, fontSize: 22 },
  body: { fontFamily: F.body, fontSize: 16, lineHeight: 22 },
});
