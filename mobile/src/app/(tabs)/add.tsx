import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { EventForm, type Draft } from '@/components/event-form';
import { TopBar } from '@/components/header';
import { Button, Card, Empty, Icon, Txt, useToast } from '@/components/ui';
import { useApp } from '@/lib/app-state';
import { readPoster } from '@/lib/ocr/read';
import { F, POSTER, R, usePalette } from '@/lib/theme';
import { LinearGradient } from 'expo-linear-gradient';

type Mode = { kind: 'choose' } | { kind: 'reading'; uri: string } | { kind: 'form'; draft: Draft; poster?: string; found?: string };

export default function Add() {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const { user } = useApp();
  const [mode, setMode] = useState<Mode>({ kind: 'choose' });
  const [formKey, setFormKey] = useState(0);
  useFocusEffect(useCallback(() => () => { /* keep work in progress when switching tabs */ }, []));

  if (!user) {
    return (
      <View style={{ flex: 1, backgroundColor: p.bg, padding: 16, paddingTop: insets.top + 4 }}>
        <TopBar />
        <View style={{ marginTop: 30 }}>
          <Empty emoji="📸" title="Share an event" body="Sign in to post events. One free account works across all Dragonfly apps."
            action={<Button title="Sign in or create an account" onPress={() => router.push('/sign-in')} />} />
        </View>
      </View>
    );
  }

  const fromPhoto = async (camera: boolean) => {
    const perm = camera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return toast(camera ? 'Allow camera access in Settings to snap flyers' : 'Allow photo access in Settings to pick flyers', false);
    const res = camera
      ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1 })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
    if (res.canceled || !res.assets[0]) return;
    // Shrink before reading and uploading: long edge 1600px, JPEG
    const a = res.assets[0];
    const resize = (a.width ?? 0) >= (a.height ?? 0) ? { width: Math.min(1600, a.width || 1600) } : { height: Math.min(1600, a.height || 1600) };
    const small = await ImageManipulator.manipulateAsync(a.uri, [{ resize }], { compress: 0.82, format: ImageManipulator.SaveFormat.JPEG });
    setMode({ kind: 'reading', uri: small.uri });
    try {
      const g = await readPoster(small.uri);
      const got = [g.title && 'name', g.start && 'date', (g.location_name || g.address) && 'place'].filter(Boolean) as string[];
      setMode({
        kind: 'form', poster: small.uri,
        found: got.length ? `Found the ${got.join(', ')}. Check everything below.` : 'We couldn’t read much from this one. Fill in the details below.',
        draft: { title: g.title, category: g.category, start: g.start, end: g.end, all_day: g.allDay, location_name: g.location_name, address: g.address, url: g.url, cost: g.cost, description: g.description },
      });
    } catch {
      setMode({ kind: 'form', poster: small.uri, found: 'We couldn’t read this photo. Fill in the details below.', draft: {} });
    }
    setFormKey((k) => k + 1);
  };

  if (mode.kind === 'reading') {
    return (
      <View style={{ flex: 1, backgroundColor: p.bg, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 }}>
        <ActivityIndicator size="large" color={p.ink} />
        <Txt v="h2" center>Reading the flyer…</Txt>
        <Txt v="small" center>This happens on your phone and is free.</Txt>
      </View>
    );
  }
  if (mode.kind === 'form') {
    return (
      <View style={{ flex: 1, backgroundColor: p.bg, paddingTop: insets.top }}>
        <EventForm key={formKey} initial={mode.draft} poster={mode.poster}
          header={(
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <Txt v="h1">New event</Txt>
              <Button small kind="quiet" icon="close" title="Start over" onPress={() => setMode({ kind: 'choose' })} />
            </View>
          )}
          note={mode.found} />
      </View>
    );
  }

  const [hi, mid, lo] = POSTER.arts;
  return (
    <ScrollView style={{ flex: 1, backgroundColor: p.bg }} contentContainerStyle={{ padding: 16, paddingTop: insets.top + 4, paddingBottom: 40 }}>
      <TopBar />
      <Txt v="display" style={{ marginTop: 14 }}>Add an event</Txt>
      <Txt v="small" style={{ fontSize: 16, marginTop: 8, marginBottom: 20 }}>Saw a flyer? Snap it and we’ll fill in the details. Events go live right away.</Txt>
      <Pressable onPress={() => fromPhoto(true)} accessibilityRole="button" accessibilityLabel="Snap a flyer with your camera"
        style={({ pressed }) => ({ borderRadius: R.lg, overflow: 'hidden', minHeight: 190, transform: [{ scale: pressed ? 0.98 : 1 }] })}>
        <LinearGradient colors={[hi, mid, lo]} start={{ x: 1, y: 0 }} end={{ x: 0, y: 1 }} style={{ flex: 1, padding: 20, justifyContent: 'flex-end', minHeight: 190 }}>
          <Text style={{ position: 'absolute', right: -10, top: -6, fontSize: 120, opacity: 0.22 }}>📸</Text>
          <Text style={{ fontSize: 34 }}>📸</Text>
          <Text style={{ fontFamily: F.display, fontSize: 28, color: '#fff', marginTop: 10 }}>Snap a flyer</Text>
          <Text style={{ fontFamily: F.body, fontSize: 16, color: 'rgba(255,255,255,.85)' }}>Point your camera at a poster</Text>
        </LinearGradient>
      </Pressable>
      <View style={{ flexDirection: 'row', gap: 12, marginTop: 12 }}>
        <Option emoji="🖼️" title="From photos" body="Pick a flyer you saved" onPress={() => fromPhoto(false)} />
        <Option emoji="✍️" title="Type it in" body="Yoga, food drive, movie night…" onPress={() => { setMode({ kind: 'form', draft: {} }); setFormKey((k) => k + 1); }} />
      </View>
      <Card style={{ marginTop: 20, flexDirection: 'row', gap: 12, alignItems: 'center' }}>
        <Icon name="info" color={p.muted} />
        <Txt v="small" style={{ flex: 1 }}>Flyers are read on your phone with no cost. Always check the details before posting.</Txt>
      </Card>
    </ScrollView>
  );
}

function Option({ emoji, title, body, onPress }: { emoji: string; title: string; body: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => ({ flex: 1, transform: [{ scale: pressed ? 0.97 : 1 }] })}>
      <Card style={{ minHeight: 150, justifyContent: 'flex-end' }}>
        <Text style={{ fontSize: 28, marginBottom: 'auto' }}>{emoji}</Text>
        <Txt v="h3" style={{ marginTop: 12 }}>{title}</Txt>
        <Txt v="small">{body}</Txt>
      </Card>
    </Pressable>
  );
}
