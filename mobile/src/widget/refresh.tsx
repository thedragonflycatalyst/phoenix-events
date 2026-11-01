// Asks Android to redraw the calendar widget after something changes in the app (an RSVP, a post).
import { Platform } from 'react-native';
import { requestWidgetUpdate } from 'react-native-android-widget';
import { gridRange, CalendarWidget, DARK, LIGHT } from './CalendarWidget';
import { dayKey, loadAgenda } from './agenda';
import { WIDGET_NAME } from './task';

export function refreshCalendarWidget() {
  if (Platform.OS !== 'android') return;
  const d = new Date();
  const state = { y: d.getFullYear(), m: d.getMonth(), sel: dayKey(d) };
  const { start, end } = gridRange(state.y, state.m);
  void requestWidgetUpdate({
    widgetName: WIDGET_NAME,
    renderWidget: async (info) => {
      const items = await loadAgenda(start, end).catch(() => []);
      return { light: <CalendarWidget state={state} items={items} pal={LIGHT} height={info.height} />, dark: <CalendarWidget state={state} items={items} pal={DARK} height={info.height} /> };
    },
  }).catch(() => {});
}
