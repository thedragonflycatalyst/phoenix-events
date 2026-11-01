// Runs in the background when the calendar widget is added, refreshed or tapped.
import type { WidgetTaskHandlerProps } from 'react-native-android-widget';
import { loadAgenda, dayKey } from './agenda';
import { CalendarWidget, DARK, gridRange, LIGHT, type WidgetState } from './CalendarWidget';

export const WIDGET_NAME = 'PhoenixCalendar';

const today = (): WidgetState => { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth(), sel: dayKey(d) }; };
const isState = (x: unknown): x is WidgetState => !!x && typeof x === 'object' && typeof (x as WidgetState).y === 'number' && typeof (x as WidgetState).m === 'number' && typeof (x as WidgetState).sel === 'string';

export async function widgetTaskHandler(props: WidgetTaskHandlerProps) {
  const { widgetInfo, widgetAction, clickAction, clickActionData, renderWidget } = props;
  if (widgetInfo.widgetName !== WIDGET_NAME || widgetAction === 'WIDGET_DELETED') return;
  // Tapping a day or an arrow carries the new view; every other refresh shows today
  const state = widgetAction === 'WIDGET_CLICK' && (clickAction === 'DAY' || clickAction === 'NAV') && isState(clickActionData) ? clickActionData : today();
  const { start, end } = gridRange(state.y, state.m);
  const items = await loadAgenda(start, end).catch(() => []);
  const h = widgetInfo.height;
  renderWidget({
    light: <CalendarWidget state={state} items={items} pal={LIGHT} height={h} />,
    dark: <CalendarWidget state={state} items={items} pal={DARK} height={h} />,
  });
}
