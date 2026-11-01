import { useCallback, useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Button, Card, Chip, Empty, Field, Txt, useToast } from '@/components/ui';
import { useApp } from '@/lib/app-state';
import { errText } from '@/lib/model';
import { sb } from '@/lib/supabase';
import { usePalette } from '@/lib/theme';

const ROLES: [string, string][] = [['moderator', 'Moderator'], ['organizer', 'Organizer'], ['admin', 'Admin'], ['none', 'No role']];

export default function Admin() {
  const p = usePalette();
  const toast = useToast();
  const { role } = useApp();
  const [list, setList] = useState<{ username: string | null; role: string }[]>([]);
  const [uname, setUname] = useState('');
  const [pick, setPick] = useState('moderator');
  const load = useCallback(async () => { const { data } = await sb.rpc('phoenix_list_roles'); setList(data ?? []); }, []);
  useEffect(() => { load(); }, [load]);
  if (role !== 'admin') return <View style={{ flex: 1, backgroundColor: p.bg, padding: 16 }}><Empty emoji="🔒" title="Admins only" /></View>;
  const save = async () => {
    const { error } = await sb.rpc('phoenix_set_role', { p_username: uname.trim(), p_role: pick });
    if (error) toast(errText(error), false); else { toast('Role saved'); setUname(''); load(); }
  };
  return (
    <ScrollView style={{ flex: 1, backgroundColor: p.bg }} contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
      <Txt v="small" style={{ fontSize: 16, marginBottom: 16 }}>Moderators review community posts. Organizers post official volunteer events and see volunteer lists. Admins can do everything.</Txt>
      <Card>
        <Field label="Username" value={uname} onChangeText={setUname} autoCapitalize="none" autoCorrect={false} />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>{ROLES.map(([k, l]) => <Chip key={k} label={l} selected={pick === k} onPress={() => setPick(k)} />)}</View>
        <Button title="Save role" onPress={save} disabled={!uname.trim()} />
      </Card>
      <Txt v="h2" style={{ marginTop: 22, marginBottom: 8 }}>Team</Txt>
      {list.map((r, i) => <Txt key={i} style={{ paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: p.line }}>@{r.username} <Txt v="small">· {r.role}</Txt></Txt>)}
    </ScrollView>
  );
}
