// Admins: review applications to volunteer, organize, or moderate.
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Card, Empty, Txt, useToast } from '@/components/ui';
import { useApp } from '@/lib/app-state';
import { KINDS, pendingApplications, reviewApplication, type Application } from '@/lib/applications';
import { errText } from '@/lib/model';
import { F, R, usePalette } from '@/lib/theme';

const LABELS: Record<string, string> = {
  name: 'Name', email: 'Email', phone: 'Phone', adult: '18 or older', interests: 'Wants to help with', availability: 'Free',
  experience: 'Experience', events: 'Would lead', hours: 'Hours a week', about: 'About', heard: 'Heard about us',
};
const show = (v: unknown) => (Array.isArray(v) ? v.join(', ') : typeof v === 'boolean' ? (v ? 'Yes' : 'No') : String(v));

export default function ApplicationsScreen() {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const { role } = useApp();
  const [list, setList] = useState<Application[] | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => { pendingApplications().then(setList).catch((e) => { toast(errText(e), false); setList([]); }); }, [toast]);
  useEffect(load, [load]);

  if (role !== 'admin') return <View style={{ flex: 1, backgroundColor: p.bg, padding: 16 }}><Empty emoji="🔒" title="Admins only" /></View>;

  const decide = async (a: Application, approve: boolean) => {
    setBusy(a.id + approve);
    try {
      await reviewApplication(a.id, approve, notes[a.id] ?? '');
      toast(approve ? `Approved @${a.username ?? 'applicant'}${a.kind !== 'volunteer' ? ` as ${KINDS[a.kind].title.toLowerCase()}` : ''}` : 'Declined');
      setList((l) => (l ?? []).filter((x) => x.id !== a.id));
    } catch (e) { toast(errText(e), false); } finally { setBusy(null); }
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: p.bg }} contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 40 }}>
      {list === null ? <ActivityIndicator style={{ marginTop: 40 }} color={p.ink} /> : list.length === 0 ? (
        <Empty emoji="📭" title="No applications waiting" body="New applications to volunteer, organize or moderate show up here." />
      ) : list.map((a) => (
        <Card key={a.id} style={{ marginBottom: 14 }}>
          <Txt v="kicker" color={p.focus}>{KINDS[a.kind].emoji} {KINDS[a.kind].title}</Txt>
          <Txt v="h2" style={{ marginTop: 2 }}>@{a.username ?? 'neighbor'}</Txt>
          <Txt v="small">Applied {new Date(a.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</Txt>
          <View style={{ marginTop: 10, gap: 6 }}>
            {Object.entries(a.answers).filter(([k, v]) => k !== 'agreed' && v !== null && v !== '' && !(Array.isArray(v) && !v.length)).map(([k, v]) => (
              <Txt key={k} style={{ fontSize: 15 }}><Txt v="bold" style={{ fontSize: 15 }}>{LABELS[k] ?? k}: </Txt>{show(v)}</Txt>
            ))}
            {a.answers.agreed ? <Txt v="small">✓ Agreed to the guidelines</Txt> : null}
          </View>
          <TextInput value={notes[a.id] ?? ''} onChangeText={(t) => setNotes((n) => ({ ...n, [a.id]: t }))} placeholder="Note to the applicant (optional)" placeholderTextColor={p.muted}
            maxLength={1000} multiline style={{ marginTop: 12, minHeight: 44, borderWidth: 1.5, borderColor: p.line, borderRadius: R.sm, padding: 10, fontFamily: F.body, fontSize: 15, color: p.ink }} />
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
            <Button style={{ flex: 1 }} title="Approve" busy={busy === a.id + true} onPress={() => decide(a, true)} />
            <Button style={{ flex: 1 }} kind="ghost" title="Decline" busy={busy === a.id + false} onPress={() => decide(a, false)} />
          </View>
        </Card>
      ))}
    </ScrollView>
  );
}
