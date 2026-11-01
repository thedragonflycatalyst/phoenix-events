// Home-screen calendar widget: month grid with dots on busy days; tap a day to see its appointments.
import { FlexWidget, ListWidget, TextWidget } from 'react-native-android-widget';
import { dayKey, onDay, type AgendaItem } from './agenda';

type Hex = `#${string}`;
export type WidgetState = { y: number; m: number; sel: string };
type Pal = { bg: Hex; card: Hex; ink: Hex; muted: Hex; line: Hex; accent: Hex; today: Hex; onAccent: Hex };

export const LIGHT: Pal = { bg: '#f4f1f7', card: '#ffffff', ink: '#1b1622', muted: '#6a6176', line: '#e3dce9', accent: '#7357ee', today: '#ef5a26', onAccent: '#ffffff' };
export const DARK: Pal = { bg: '#120e17', card: '#1d1724', ink: '#f4f1f7', muted: '#a69cb2', line: '#2c2436', accent: '#a68dff', today: '#ff7a4d', onAccent: '#120e17' };

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WD = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

/** First and last day shown in the month grid (6 weeks, starting Sunday). */
export function gridRange(y: number, m: number) {
  const first = new Date(y, m, 1);
  const start = new Date(y, m, 1 - first.getDay());
  const end = new Date(start); end.setDate(start.getDate() + 42);
  return { start, end };
}

const timeOf = (d: Date) => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).replace(':00', '').replace(' ', '').toLowerCase();
const parseKey = (k: string) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };

export function CalendarWidget({ state, items, pal, height }: { state: WidgetState; items: AgendaItem[]; pal: Pal; height: number }) {
  const { start } = gridRange(state.y, state.m);
  const todayKey = dayKey(new Date());
  const sel = parseKey(state.sel);
  const busy = new Map<string, Hex>();
  for (let i = 0; i < 42; i++) {
    const d = new Date(start); d.setDate(start.getDate() + i);
    const hits = onDay(items, d);
    if (hits.length) busy.set(dayKey(d), hits.some((h) => h.source === 'phoenix') ? pal.today : pal.accent);
  }
  const dayItems = onDay(items, sel);
  // The agenda gets a fixed share of the height (it scrolls when the day is busy); the month grid takes the rest
  const agendaH = Math.max(104, Math.round(height * 0.36));
  const nav = (dm: number) => {
    const d = new Date(state.y, state.m + dm, 1);
    const keepSel = d.getFullYear() === new Date().getFullYear() && d.getMonth() === new Date().getMonth() ? todayKey : dayKey(d);
    return { y: d.getFullYear(), m: d.getMonth(), sel: keepSel };
  };
  const selLabel = sel.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });

  return (
    <FlexWidget style={{ height: 'match_parent', width: 'match_parent', backgroundColor: pal.bg, borderRadius: 24, padding: 12, flexDirection: 'column' }}>
      {/* Header: month, arrows, scan */}
      <FlexWidget style={{ width: 'match_parent', flexDirection: 'row', alignItems: 'center', paddingHorizontal: 4 }}>
        <TextWidget text={`${MONTHS[state.m]} ${state.y}`} clickAction="OPEN_URI" clickActionData={{ uri: `phoenix:///day/${state.sel}` }}
          style={{ fontSize: 17, color: pal.ink, fontFamily: 'BricolageGrotesque_700Bold' }} />
        <FlexWidget style={{ flex: 1 }} />
        <TextWidget text="‹" clickAction="NAV" clickActionData={nav(-1)} style={{ fontSize: 22, color: pal.muted, paddingHorizontal: 10 }} />
        <TextWidget text="›" clickAction="NAV" clickActionData={nav(1)} style={{ fontSize: 22, color: pal.muted, paddingHorizontal: 10 }} />
        <FlexWidget clickAction="OPEN_URI" clickActionData={{ uri: 'phoenix:///scan' }}
          style={{ backgroundColor: pal.accent, borderRadius: 14, paddingHorizontal: 10, paddingVertical: 4, marginLeft: 4 }}>
          <TextWidget text="+ Scan" style={{ fontSize: 12, color: pal.onAccent, fontWeight: 'bold' }} />
        </FlexWidget>
      </FlexWidget>

      {/* Weekday letters */}
      <FlexWidget style={{ width: 'match_parent', flexDirection: 'row', marginTop: 6 }}>
        {WD.map((w, i) => (
          <FlexWidget key={`w${i}`} style={{ flex: 1, alignItems: 'center' }}>
            <TextWidget text={w} style={{ fontSize: 11, color: pal.muted, fontWeight: 'bold' }} />
          </FlexWidget>
        ))}
      </FlexWidget>

      {/* Month grid */}
      <FlexWidget style={{ width: 'match_parent', flex: 1, flexDirection: 'column' }}>
      {Array.from({ length: 6 }, (_, r) => (
        <FlexWidget key={`r${r}`} style={{ width: 'match_parent', flexDirection: 'row', flex: 1 }}>
          {Array.from({ length: 7 }, (_, c) => {
            const d = new Date(start); d.setDate(start.getDate() + r * 7 + c);
            const k = dayKey(d);
            const inMonth = d.getMonth() === state.m;
            const isSel = k === state.sel, isToday = k === todayKey;
            const dot = busy.get(k);
            return (
              <FlexWidget key={k} clickAction="DAY" clickActionData={{ y: state.y, m: state.m, sel: k }}
                style={{ flex: 1, height: 'match_parent', alignItems: 'center', justifyContent: 'center' }}>
                <FlexWidget style={{
                  width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center',
                  backgroundColor: isSel ? pal.accent : '#00000000', borderWidth: isToday && !isSel ? 2 : 0, borderColor: pal.today,
                }}>
                  <TextWidget text={String(d.getDate())} style={{ fontSize: 13, color: isSel ? pal.onAccent : inMonth ? pal.ink : pal.muted, fontWeight: isToday || isSel ? 'bold' : 'normal' }} />
                </FlexWidget>
                <TextWidget text="•" style={{ fontSize: 10, color: dot && !isSel ? dot : '#00000000' }} />
              </FlexWidget>
            );
          })}
        </FlexWidget>
      ))}
      </FlexWidget>

      {/* Agenda for the chosen day: scrolls inside the widget, "Open" pops out the full list */}
      <FlexWidget clickAction="OPEN_URI" clickActionData={{ uri: `phoenix:///day/${state.sel}` }}
        style={{ width: 'match_parent', height: agendaH, backgroundColor: pal.card, borderRadius: 16, padding: 10, marginTop: 6, flexDirection: 'column' }}>
        <FlexWidget style={{ width: 'match_parent', flexDirection: 'row', alignItems: 'center' }}>
          <TextWidget text={selLabel} style={{ fontSize: 13, color: pal.ink, fontWeight: 'bold' }} />
          <FlexWidget style={{ flex: 1 }} />
          <TextWidget text={dayItems.length ? `${dayItems.length} · Open ›` : 'Open ›'} style={{ fontSize: 12, color: pal.accent, fontWeight: 'bold' }} />
        </FlexWidget>
        {dayItems.length === 0 ? (
          <TextWidget text="Nothing planned. Tap to find events nearby." style={{ fontSize: 12, color: pal.muted, marginTop: 4 }} />
        ) : (
          <ListWidget style={{ height: 'match_parent', width: 'match_parent', marginTop: 2 }}>
            {dayItems.map((it) => (
              <FlexWidget key={it.key} clickAction="OPEN_URI" clickActionData={{ uri: it.uri }}
                style={{ width: 'match_parent', flexDirection: 'row', alignItems: 'center', paddingVertical: 4 }}>
                <FlexWidget style={{ width: 4, height: 18, borderRadius: 2, backgroundColor: (it.color.startsWith('#') ? it.color : pal.accent) as Hex, marginRight: 8 }} />
                <TextWidget text={it.allDay ? 'All day' : timeOf(it.start)} style={{ fontSize: 12, color: pal.muted, width: 52 }} />
                <FlexWidget style={{ flex: 1 }}>
                  <TextWidget text={it.title} truncate="END" maxLines={1} style={{ fontSize: 13, color: pal.ink }} />
                </FlexWidget>
              </FlexWidget>
            ))}
          </ListWidget>
        )}
      </FlexWidget>
    </FlexWidget>
  );
}
