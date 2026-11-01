// Application form: volunteer, event organizer, or app moderator.
import * as DocumentPicker from 'expo-document-picker';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Switch, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Card, Chip, Empty, Field, Icon, Txt, useToast } from '@/components/ui';
import { useApp } from '@/lib/app-state';
import { KINDS, RESUME_MAX, RESUME_TYPES, submitApplication, uploadResume, type AppKind } from '@/lib/applications';
import { errText } from '@/lib/model';
import { usePalette } from '@/lib/theme';

const INTERESTS = ['Clean-ups & planting', 'Food & donation drives', 'Wellness & fitness days', 'Mental health & support', 'Arts & family fun', 'Setup & teardown', 'Outreach & flyers', 'Photos & social media', 'Driving & deliveries'];
const WHEN = ['Weekday mornings', 'Weekday afternoons', 'Weeknights', 'Saturdays', 'Sundays'];

const RULES: Record<AppKind, string> = {
  volunteer: 'I’ll treat everyone with respect, follow event leaders’ safety instructions, and let the team know if I can’t make a shift.',
  organizer: 'I’ll only post official Phoenix events that the team has agreed to, keep sign-up details private, and follow The Phoenix Catalyst’s safety and conduct guidelines.',
  moderator: 'I’ll review posts and comments fairly, never use moderator tools for personal disputes, and keep reporters’ and members’ information private.',
};

export default function ApplyScreen() {
  const { kind: raw } = useLocalSearchParams<{ kind: string }>();
  const kind = (raw in KINDS ? raw : 'volunteer') as AppKind;
  const info = KINDS[kind];
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const { user } = useApp();
  const [a, setA] = useState({
    name: '', phone: '', adult: true, interests: [] as string[], availability: [] as string[],
    about: '', experience: '', events: '', hours: '', heard: '', agree: false,
  });
  const [busy, setBusy] = useState(false);
  const [resume, setResume] = useState<DocumentPicker.DocumentPickerAsset | null>(null);
  const set = (patch: Partial<typeof a>) => setA((x) => ({ ...x, ...patch }));
  const toggle = (k: 'interests' | 'availability', v: string) => set({ [k]: a[k].includes(v) ? a[k].filter((x) => x !== v) : [...a[k], v] } as Partial<typeof a>);

  if (!user) {
    return <View style={{ flex: 1, backgroundColor: p.bg, padding: 16 }}><Empty emoji="🔐" title="Sign in to apply" body="One free account works across all Dragonfly apps." action={<Button title="Sign in" onPress={() => router.replace('/sign-in')} />} /></View>;
  }

  const pickResume = async () => {
    const r = await DocumentPicker.getDocumentAsync({ type: RESUME_TYPES, copyToCacheDirectory: true, multiple: false });
    const f = r.canceled ? null : r.assets[0];
    if (!f) return;
    if ((f.size ?? 0) > RESUME_MAX) return toast('That file is over 10 MB. Try a PDF version.', false);
    setResume(f);
  };

  const send = async () => {
    if (a.name.trim().length < 2) return toast('Add your name', false);
    if (kind === 'volunteer' && !a.interests.length) return toast('Pick at least one way you’d like to help', false);
    if (kind !== 'volunteer' && a.experience.trim().length < 10) return toast('Tell us a little about your experience', false);
    if (!a.agree) return toast('Please agree to the guidelines', false);
    setBusy(true);
    try {
      const answers: Record<string, unknown> = { name: a.name.trim(), phone: a.phone.trim() || null, email: user.email ?? null, adult: a.adult, about: a.about.trim() || null, heard: a.heard.trim() || null, agreed: RULES[kind] };
      if (kind === 'volunteer') Object.assign(answers, { interests: a.interests, availability: a.availability });
      if (kind === 'organizer') Object.assign(answers, { experience: a.experience.trim(), events: a.events.trim() || null });
      if (kind === 'moderator') Object.assign(answers, { experience: a.experience.trim(), hours: a.hours.trim() || null });
      if (resume) answers.resume = await uploadResume(user.id, { uri: resume.uri, name: resume.name, mimeType: resume.mimeType, size: resume.size });
      await submitApplication(user.id, kind, answers);
      toast('Application sent! The team will get back to you here in the app.');
      router.back();
    } catch (e) { toast(errText(e), false); } finally { setBusy(false); }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: p.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 40 }}>
        <Txt style={{ fontSize: 40 }}>{info.emoji}</Txt>
        <Txt v="display" style={{ marginTop: 4 }}>{info.title}</Txt>
        <Txt style={{ fontSize: 17, marginTop: 6 }}>{info.blurb}</Txt>
        {info.grants ? <Txt v="small" style={{ marginTop: 6 }}>{info.grants}</Txt> : null}

        <Card style={{ marginTop: 20 }}>
          <Field label="Your name" value={a.name} onChangeText={(t) => set({ name: t })} autoComplete="name" textContentType="name" />
          <Field label="Phone" hint="(optional, for event-day updates)" value={a.phone} onChangeText={(t) => set({ phone: t })} keyboardType="phone-pad" autoComplete="tel" />
          <Txt v="small" style={{ marginTop: -6, marginBottom: 12 }}>We’ll also use the email on your account{user.email ? ` (${user.email})` : ''}.</Txt>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Txt v="bold" style={{ flex: 1 }}>I’m 18 or older</Txt>
            <Switch value={a.adult} onValueChange={(v) => set({ adult: v })} trackColor={{ true: p.focus, false: p.line }} thumbColor="#fff" />
          </View>
          {!a.adult && <Txt v="small" style={{ marginTop: 6 }}>Welcome! Volunteers under 18 need a parent or guardian’s OK, and the team will reach out about that.</Txt>}
        </Card>

        {kind === 'volunteer' && (
          <Card style={{ marginTop: 14 }}>
            <Txt v="h3" style={{ marginBottom: 10 }}>How would you like to help?</Txt>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{INTERESTS.map((x) => <Chip key={x} label={x} selected={a.interests.includes(x)} onPress={() => toggle('interests', x)} />)}</View>
            <Txt v="h3" style={{ marginTop: 18, marginBottom: 10 }}>When are you usually free?</Txt>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{WHEN.map((x) => <Chip key={x} label={x} selected={a.availability.includes(x)} onPress={() => toggle('availability', x)} />)}</View>
          </Card>
        )}

        <Card style={{ marginTop: 14 }}>
          {kind !== 'volunteer' && (
            <Field label={kind === 'organizer' ? 'Events or groups you’ve organized' : 'Moderation or community experience'} value={a.experience} onChangeText={(t) => set({ experience: t })} multiline style={{ minHeight: 90, textAlignVertical: 'top' }} />
          )}
          {kind === 'organizer' && <Field label="Events you’d love to lead" hint="(optional)" value={a.events} onChangeText={(t) => set({ events: t })} multiline style={{ minHeight: 70, textAlignVertical: 'top' }} />}
          {kind === 'moderator' && <Field label="Hours a week you can give" hint="(optional)" value={a.hours} onChangeText={(t) => set({ hours: t })} placeholder="About 2" />}
          <Field label={kind === 'volunteer' ? 'Anything you’d like us to know?' : 'Why do you want to help?'} hint="(optional)" value={a.about} onChangeText={(t) => set({ about: t })} multiline style={{ minHeight: 80, textAlignVertical: 'top' }} />
          <Field label="How did you hear about us?" hint="(optional)" value={a.heard} onChangeText={(t) => set({ heard: t })} />
          <Txt v="bold" style={{ marginBottom: 6, fontSize: 15 }}>Resume <Txt v="small">(optional · PDF, Word or photo, up to 10 MB)</Txt></Txt>
          {resume ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 12, backgroundColor: p.soft }}>
              <Icon name="edit_note" color={p.focus} />
              <View style={{ flex: 1 }}>
                <Txt v="bold" numberOfLines={1}>{resume.name}</Txt>
                {resume.size ? <Txt v="small">{Math.max(1, Math.round(resume.size / 1024))} KB</Txt> : null}
              </View>
              <Button small kind="quiet" title="Remove" onPress={() => setResume(null)} />
            </View>
          ) : <Button kind="ghost" icon="download" title="Attach a resume" onPress={pickResume} style={{ alignSelf: 'flex-start' }} />}
        </Card>

        <Pressable onPress={() => set({ agree: !a.agree })} accessibilityRole="checkbox" accessibilityState={{ checked: a.agree }}
          style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start', marginTop: 16, padding: 4 }}>
          <View style={{ width: 24, height: 24, borderRadius: 6, borderWidth: 2, borderColor: a.agree ? p.focus : p.line, backgroundColor: a.agree ? p.focus : 'transparent', alignItems: 'center', justifyContent: 'center', marginTop: 2 }}>
            {a.agree && <Txt style={{ color: '#fff', fontSize: 15, lineHeight: 18 }}>✓</Txt>}
          </View>
          <Txt style={{ flex: 1, fontSize: 15 }}>{RULES[kind]}</Txt>
        </Pressable>

        <Button title="Send application" busy={busy} onPress={send} style={{ marginTop: 18 }} />
        <Txt v="small" center style={{ marginTop: 10 }}>Only Phoenix Catalyst admins can see your application.</Txt>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
