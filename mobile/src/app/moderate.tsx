import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Ticket } from '@/components/events';
import { Button, Card, Empty, Txt, useToast } from '@/components/ui';
import { useApp } from '@/lib/app-state';
import { fmtShort } from '@/lib/dates';
import { errText, type PEvent } from '@/lib/model';
import { sb } from '@/lib/supabase';
import { usePalette } from '@/lib/theme';

type Flag = { flag_id: string; event_id: string; title: string; reason: string; flagged_by: string | null; created_at: string };

export default function Moderate() {
  const p = usePalette();
  const toast = useToast();
  const { isMod, bump } = useApp();
  const [queue, setQueue] = useState<PEvent[]>([]);
  const [flags, setFlags] = useState<Flag[]>([]);
  const load = useCallback(async () => {
    const [q, f] = await Promise.all([
      sb.from('phoenix_events').select('*').is('reviewed_at', null).order('created_at', { ascending: false }).limit(100),
      sb.rpc('phoenix_open_flags'),
    ]);
    setQueue((q.data ?? []) as PEvent[]); setFlags((f.data ?? []) as Flag[]);
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  const act = async (fn: () => PromiseLike<{ error: { message: string } | null }>, msg: string) => {
    const { error } = await fn();
    if (error) toast(errText(error), false); else { toast(msg); bump(); load(); }
  };
  if (!isMod) return <View style={{ flex: 1, backgroundColor: p.bg, padding: 16 }}><Empty emoji="🛡️" title="For volunteer moderators" body="Ask a Phoenix Catalyst admin if you’d like to help review posts." /></View>;
  return (
    <ScrollView style={{ flex: 1, backgroundColor: p.bg }} contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
      <Txt v="small" style={{ fontSize: 16, marginBottom: 16 }}>Posts go live right away. Check that each one is real, local and kind. Hide anything unclear and remove spam or harmful posts.</Txt>
      <Txt v="h2" style={{ marginBottom: 10 }}>Reports ({flags.length})</Txt>
      {flags.length ? flags.map((f) => (
        <Card key={f.flag_id} style={{ marginBottom: 10 }}>
          <Txt v="h3">{f.title}</Txt>
          <Txt v="small" style={{ marginVertical: 4 }}>“{f.reason}” by @{f.flagged_by || 'unknown'}, {fmtShort(f.created_at)}</Txt>
          <Button small kind="quiet" title="Mark handled" style={{ alignSelf: 'flex-start' }}
            onPress={() => act(() => sb.from('phoenix_flags').update({ resolved_at: new Date().toISOString() }).eq('id', f.flag_id), 'Report handled')} />
        </Card>
      )) : <Txt v="small" style={{ marginBottom: 10 }}>No open reports.</Txt>}
      <Txt v="h2" style={{ marginTop: 18, marginBottom: 10 }}>Not reviewed yet ({queue.length})</Txt>
      {queue.length ? queue.map((e) => (
        <View key={e.id} style={{ marginBottom: 8 }}>
          <Ticket e={e} />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: -4, marginBottom: 8, alignItems: 'center' }}>
            <Button small title="Looks good" onPress={() => act(() => sb.from('phoenix_events').update({ reviewed_at: new Date().toISOString() }).eq('id', e.id), 'Marked reviewed')} />
            <Button small kind="quiet" title="Hide" onPress={() => act(() => sb.from('phoenix_events').update({ status: 'hidden' }).eq('id', e.id), 'Hidden')} />
            <Button small kind="danger" title="Remove" onPress={() => act(() => sb.from('phoenix_events').update({ status: 'removed' }).eq('id', e.id), 'Removed')} />
            <Txt v="small">by @{e.created_by_username || '?'}{e.status !== 'published' ? ` · ${e.status}` : ''}</Txt>
          </View>
        </View>
      )) : <Txt v="small">You’re all caught up.</Txt>}
    </ScrollView>
  );
}
