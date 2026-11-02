// Local organizations the calendar follows. Members suggest new ones; Phoenix leaders preview, approve,
// pause or run them. Approved organizations' events are imported automatically every 6 hours.
import * as WebBrowser from 'expo-web-browser';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Badge } from '@/components/events';
import { Button, Card, Field, Txt, useToast } from '@/components/ui';
import { useApp } from '@/lib/app-state';
import { fmtDay } from '@/lib/dates';
import { errText } from '@/lib/model';
import { listSources, previewSource, runSource, setSourceStatus, suggestSource, type Preview, type Source } from '@/lib/sources';
import { usePalette } from '@/lib/theme';
import { router } from 'expo-router';

const ago = (iso: string | null) => {
  if (!iso) return 'not yet';
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  return m < 60 ? `${Math.max(1, m)} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
};

export default function Sources() {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const { user, canTpc } = useApp();
  const [list, setList] = useState<Source[] | null>(null);
  const [f, setF] = useState({ name: '', website: '', feed: '', note: '' });
  const [busy, setBusy] = useState<string | null>(null);
  const [previews, setPreviews] = useState<Record<string, Preview>>({});

  const load = useCallback(() => { listSources().then(setList).catch((e) => { toast(errText(e), false); setList([]); }); }, [toast]);
  useEffect(load, [load]);

  const submit = async () => {
    if (!user) { router.push('/sign-in'); return; }
    if (f.name.trim().length < 2) return toast('Add the organization’s name', false);
    if (!/\./.test(f.website)) return toast('Add their website or events page', false);
    setBusy('add');
    try {
      const s = await suggestSource({ name: f.name, website: f.website, feed_url: f.feed, note: f.note, active: canTpc });
      setF({ name: '', website: '', feed: '', note: '' });
      if (s.status === 'active') {
        toast(`Added ${s.name}. Importing its events…`);
        runSource(s.id).then((r) => toast(`${s.name}: ${r}`), (e) => toast(`${s.name}: ${errText(e)}`, false)).finally(load);
      } else toast('Thanks! Phoenix leaders will take a look.');
      load();
    } catch (e) { toast(errText(e), false); } finally { setBusy(null); }
  };

  const preview = async (s: Source) => {
    setBusy(`pv${s.id}`);
    try { const r = await previewSource(s.website, s.feed_url); setPreviews((x) => ({ ...x, [s.id]: r })); }
    catch (e) { toast(errText(e), false); } finally { setBusy(null); }
  };
  const status = async (s: Source, next: Source['status']) => {
    setBusy(`st${s.id}`);
    try {
      await setSourceStatus(s.id, next);
      if (next === 'active') { toast(`Approved ${s.name}. Importing its events…`); toast(`${s.name}: ${await runSource(s.id)}`); }
      else toast(next === 'paused' ? `Paused ${s.name}` : next === 'rejected' ? 'Suggestion declined' : 'Updated');
      load();
    } catch (e) { toast(errText(e), false); load(); } finally { setBusy(null); }
  };
  const run = async (s: Source) => {
    setBusy(`run${s.id}`);
    try { toast(`${s.name}: ${await runSource(s.id)}`); } catch (e) { toast(errText(e), false); } finally { setBusy(null); load(); }
  };

  const groups: [string, Source[]][] = [
    ['Waiting for review', (list ?? []).filter((s) => s.status === 'suggested')],
    ['Calendars we follow', (list ?? []).filter((s) => s.status === 'active')],
    ['Paused', (list ?? []).filter((s) => s.status === 'paused')],
  ];

  const Row = ({ s }: { s: Source }) => {
    const pv = previews[s.id];
    return (
      <Card style={{ marginBottom: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Txt v="h3" style={{ flex: 1 }}>{s.name}</Txt>
          {s.status === 'suggested' && <Badge label="Suggested" />}
        </View>
        <Txt v="small" color={p.focus} numberOfLines={1} onPress={() => WebBrowser.openBrowserAsync(s.website)}>{s.website.replace(/^https?:\/\/(www\.)?/, '')}</Txt>
        {s.note ? <Txt v="small" style={{ marginTop: 4 }}>{s.note}</Txt> : null}
        {s.suggested_by_username && s.status === 'suggested' ? <Txt v="small" style={{ marginTop: 4 }}>Suggested by @{s.suggested_by_username}</Txt> : null}
        {canTpc && s.status !== 'suggested' && (
          <Txt v="small" style={{ marginTop: 6 }}>
            {s.last_error ? `⚠️ Last check ${ago(s.last_run_at)}: ${s.last_error}` : s.last_run_at ? `Checked ${ago(s.last_run_at)} · ${s.last_count ?? 0} events${s.last_method ? ` · ${s.last_method}` : ''}` : 'Not checked yet'}
          </Txt>
        )}
        {pv && (
          <View style={{ marginTop: 10, padding: 12, borderRadius: 12, backgroundColor: p.soft }}>
            {pv.error ? <Txt v="small">⚠️ {pv.error}</Txt> : (
              <>
                <Txt v="bold">Found {pv.count} upcoming event{pv.count === 1 ? '' : 's'}{pv.method ? ` (${pv.method})` : ''}</Txt>
                {(pv.sample ?? []).map((e, i) => <Txt key={i} v="small" numberOfLines={1}>• {fmtDay(e.starts_at)}: {e.title}</Txt>)}
              </>
            )}
          </View>
        )}
        {canTpc && (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
            {s.status === 'suggested' && <>
              <Button small kind="ghost" title="Preview" busy={busy === `pv${s.id}`} onPress={() => preview(s)} />
              <Button small title="Approve" busy={busy === `st${s.id}`} onPress={() => status(s, 'active')} />
              <Button small kind="quiet" title="Decline" onPress={() => status(s, 'rejected')} />
            </>}
            {s.status === 'active' && <>
              <Button small kind="ghost" title="Check now" busy={busy === `run${s.id}`} onPress={() => run(s)} />
              <Button small kind="quiet" title="Pause" onPress={() => Alert.alert(`Pause ${s.name}?`, 'New events stop coming in. Events already imported stay on the calendar.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Pause', onPress: () => status(s, 'paused') }])} />
            </>}
            {s.status === 'paused' && <Button small kind="ghost" title="Resume" busy={busy === `st${s.id}`} onPress={() => status(s, 'active')} />}
          </View>
        )}
      </Card>
    );
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: p.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 40 }}>
        <Txt style={{ fontSize: 17 }}>We bring in events from local organizations’ own calendars automatically, so you don’t have to check a dozen websites.</Txt>

        <Card style={{ marginTop: 16 }}>
          <Txt v="h3" style={{ marginBottom: 10 }}>{canTpc ? 'Add an organization' : 'Suggest an organization'}</Txt>
          <Field label="Organization" value={f.name} onChangeText={(t) => setF({ ...f, name: t })} placeholder="Howard County Library" maxLength={120} />
          <Field label="Their events page" value={f.website} onChangeText={(t) => setF({ ...f, website: t })} placeholder="https://…/events" autoCapitalize="none" keyboardType="url" maxLength={500} />
          <Field label="Calendar feed link" hint="(optional, iCal or “Add to calendar” link)" value={f.feed} onChangeText={(t) => setF({ ...f, feed: t })} autoCapitalize="none" keyboardType="url" maxLength={500} />
          <Field label="Why they’re a good fit" hint="(optional)" value={f.note} onChangeText={(t) => setF({ ...f, note: t })} multiline maxLength={1000} />
          <Button title={canTpc ? 'Add and import' : 'Send suggestion'} busy={busy === 'add'} onPress={submit} />
          {!canTpc && <Txt v="small" style={{ marginTop: 8 }}>Phoenix leaders review suggestions before their events appear.</Txt>}
        </Card>

        {list === null ? <ActivityIndicator style={{ marginTop: 30 }} color={p.ink} /> : groups.map(([title, items]) => items.length ? (
          <View key={title} style={{ marginTop: 22 }}>
            <Txt v="h2" style={{ marginBottom: 10 }}>{title}</Txt>
            {items.map((s) => <Row key={s.id} s={s} />)}
          </View>
        ) : null)}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
