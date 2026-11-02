// Team roles: the owner and admins give people roles. Only the owner can make or remove admins,
// and nobody can change the owner.
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Button, Card, Empty, Field, Txt, useToast } from '@/components/ui';
import { useApp } from '@/lib/app-state';
import { errText } from '@/lib/model';
import { sb } from '@/lib/supabase';
import { F, R, usePalette } from '@/lib/theme';

type Person = { username: string | null; role: string };
const LABEL: Record<string, string> = { owner: 'Owner', admin: 'Admin', organizer: 'Organizer', moderator: 'Moderator', none: 'No role' };
const WHAT: Record<string, string> = {
  moderator: 'Reviews community posts, reports and comments.',
  organizer: 'Posts official Phoenix events and sees volunteer lists.',
  admin: 'Everything above, plus giving roles and reviewing applications.',
  none: 'Regular member.',
};

export default function Admin() {
  const p = usePalette();
  const toast = useToast();
  const { role, isAdmin, username: me } = useApp();
  const isOwner = role === 'owner';
  const [team, setTeam] = useState<Person[]>([]);
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<Person[]>([]);
  const [picked, setPicked] = useState<Person | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => { const { data } = await sb.rpc('phoenix_list_roles'); setTeam((data ?? []) as Person[]); }, []);
  useEffect(() => { void load(); }, [load]);
  // Suggest usernames as the admin types
  useEffect(() => {
    const q = query.trim().replace(/^@/, '');
    if (q.length < 2) { setFound([]); return; }
    const t = setTimeout(() => { void sb.rpc('phoenix_find_people', { p_query: q }).then(({ data }) => setFound((data ?? []) as Person[])); }, 250);
    return () => clearTimeout(t);
  }, [query]);

  if (!isAdmin) return <View style={{ flex: 1, backgroundColor: p.bg, padding: 16 }}><Empty emoji="🔒" title="Admins only" /></View>;

  // What this person is allowed to give someone: admins can't touch admins, nobody touches the owner
  const choices = (target: Person) => {
    if (target.role === 'owner' || target.username === me) return [];
    if (!isOwner && target.role === 'admin') return [];
    return isOwner ? ['moderator', 'organizer', 'admin', 'none'] : ['moderator', 'organizer', 'none'];
  };
  const setRole = async (target: Person, next: string) => {
    if (!target.username || next === target.role) return;
    setBusy(true);
    const { error } = await sb.rpc('phoenix_set_role', { p_username: target.username, p_role: next });
    setBusy(false);
    if (error) return toast(errText(error), false);
    toast(next === 'none' ? `@${target.username} no longer has a role` : `@${target.username} is now ${LABEL[next].toLowerCase()}`);
    setPicked(null); setQuery(''); setFound([]); void load();
  };

  const Row = ({ person, onPress }: { person: Person; onPress?: () => void }) => (
    <Pressable onPress={onPress} disabled={!onPress} accessibilityRole="button"
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, opacity: pressed ? 0.7 : 1 })}>
      <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: p.soft, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ fontFamily: F.display, color: p.ink }}>{(person.username ?? '?').charAt(0).toUpperCase()}</Text>
      </View>
      <Txt v="bold" style={{ flex: 1 }}>@{person.username}</Txt>
      <View style={{ backgroundColor: person.role === 'owner' ? p.focus : p.soft, borderRadius: R.pill, paddingHorizontal: 10, paddingVertical: 4 }}>
        <Text style={{ fontFamily: F.bodyBold, fontSize: 13, color: person.role === 'owner' ? p.onAccent : p.ink }}>{LABEL[person.role] ?? person.role}</Text>
      </View>
    </Pressable>
  );

  return (
    <ScrollView style={{ flex: 1, backgroundColor: p.bg }} contentContainerStyle={{ padding: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
      <Txt v="small" style={{ fontSize: 16, marginBottom: 16 }}>
        {isOwner ? 'You’re the owner. You can make people moderators, organizers or admins. Nobody can change your role.' : 'You can make people moderators or organizers. Only the owner can make or remove admins.'}
      </Txt>

      <Card>
        <Field label="Find someone" value={query} onChangeText={(t) => { setQuery(t); setPicked(null); }} placeholder="Start typing a username" autoCapitalize="none" autoCorrect={false} />
        {!picked && found.map((f) => <Row key={f.username ?? ''} person={f} onPress={() => setPicked(f)} />)}
        {!picked && query.trim().length >= 2 && !found.length && <Txt v="small">No usernames start with “{query.trim()}”.</Txt>}
        {picked && (
          <View>
            <Row person={picked} />
            {choices(picked).length ? (
              <>
                <Txt v="bold" style={{ marginTop: 8, marginBottom: 8 }}>Give @{picked.username} a role</Txt>
                <View style={{ gap: 8 }}>
                  {choices(picked).map((k) => (
                    <Pressable key={k} onPress={() => setRole(picked, k)} disabled={busy} accessibilityRole="button"
                      style={({ pressed }) => ({ borderWidth: 1.5, borderColor: picked.role === k ? p.focus : p.line, borderRadius: R.md, padding: 12, opacity: pressed || busy ? 0.7 : 1 })}>
                      <Txt v="bold">{LABEL[k]}{picked.role === k ? ' · current' : ''}</Txt>
                      <Txt v="small">{WHAT[k]}</Txt>
                    </Pressable>
                  ))}
                </View>
              </>
            ) : <Txt v="small" style={{ marginTop: 6 }}>{picked.role === 'owner' ? 'The owner’s role can’t be changed.' : picked.username === me ? 'You can’t change your own role.' : 'Only the owner can change an admin’s role.'}</Txt>}
            <Button kind="ghost" small title="Pick someone else" style={{ alignSelf: 'flex-start', marginTop: 10 }} onPress={() => { setPicked(null); setQuery(''); }} />
          </View>
        )}
      </Card>

      <Txt v="h2" style={{ marginTop: 22, marginBottom: 4 }}>Team</Txt>
      <Txt v="small" style={{ marginBottom: 8 }}>Tap someone to change their role.</Txt>
      {team.map((t) => <Row key={t.username ?? ''} person={t} onPress={choices(t).length ? () => { setPicked(t); setQuery(t.username ?? ''); } : undefined} />)}
      {!team.length && <Txt v="small">No one has a role yet.</Txt>}
    </ScrollView>
  );
}
