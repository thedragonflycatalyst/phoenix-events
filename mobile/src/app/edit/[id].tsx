import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { EventForm } from '@/components/event-form';
import { Empty } from '@/components/ui';
import { useApp } from '@/lib/app-state';
import type { PEvent } from '@/lib/model';
import { sb } from '@/lib/supabase';
import { usePalette } from '@/lib/theme';

export default function EditEvent() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const p = usePalette();
  const { user, isMod, canTpc } = useApp();
  const [e, setE] = useState<PEvent | null | undefined>(undefined);
  useEffect(() => { sb.from('phoenix_events').select('*').eq('id', id).maybeSingle().then(({ data }) => setE((data as PEvent) ?? null)); }, [id]);
  if (e === undefined) return <View style={{ flex: 1, backgroundColor: p.bg, justifyContent: 'center' }}><ActivityIndicator color={p.ink} /></View>;
  if (!e || (e.created_by !== user?.id && !isMod && !(e.is_tpc && canTpc))) return <View style={{ flex: 1, backgroundColor: p.bg, padding: 16 }}><Empty emoji="🔒" title="You can’t edit this event" /></View>;
  return (
    <EventForm existing={e} initial={{
      title: e.title, category: e.category, start: new Date(e.starts_at), end: e.ends_at ? new Date(e.ends_at) : null, all_day: e.all_day,
      location_name: e.location_name ?? '', address: e.address ?? '', organizer: e.organizer ?? '', cost: e.cost, tags: e.tags, url: e.url ?? '',
      description: e.description ?? '', is_tpc: e.is_tpc, volunteer_slots: e.volunteer_slots,
    }} />
  );
}
