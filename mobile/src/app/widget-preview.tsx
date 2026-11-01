// Live preview of the home-screen calendar widget, tappable like the real one (also used by the emulator test).
import { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { WidgetPreview } from 'react-native-android-widget';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Txt } from '@/components/ui';
import { usePalette } from '@/lib/theme';
import { dayKey, loadAgenda, type AgendaItem } from '@/widget/agenda';
import { CalendarWidget, DARK, gridRange, LIGHT, type WidgetState } from '@/widget/CalendarWidget';

export default function WidgetPreviewScreen() {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const d = new Date();
  const [state, setState] = useState<WidgetState>({ y: d.getFullYear(), m: d.getMonth(), sel: dayKey(d) });
  const [items, setItems] = useState<AgendaItem[]>([]);
  useEffect(() => { const { start, end } = gridRange(state.y, state.m); void loadAgenda(start, end).then(setItems); }, [state.y, state.m]);
  return (
    <ScrollView style={{ flex: 1, backgroundColor: p.bg }} contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24, alignItems: 'center' }}>
      <Txt v="h2" style={{ alignSelf: 'flex-start' }}>Calendar widget</Txt>
      <Txt v="small" style={{ alignSelf: 'flex-start', marginBottom: 16 }}>Long-press your home screen, tap Widgets, and find Phoenix Calendar.</Txt>
      <View>
        <WidgetPreview width={330} height={360}
          renderWidget={() => <CalendarWidget state={state} items={items} pal={p.scheme === 'dark' ? DARK : LIGHT} height={360} />}
          onClick={({ clickAction, clickActionData }) => { if ((clickAction === 'DAY' || clickAction === 'NAV') && clickActionData) setState(clickActionData as WidgetState); }} />
      </View>
    </ScrollView>
  );
}
