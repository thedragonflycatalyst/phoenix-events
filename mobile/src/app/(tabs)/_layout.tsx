import { NativeTabs } from 'expo-router/native-tabs';
import { F, usePalette } from '@/lib/theme';

// Real system tab bar: Material 3 on Android, the native tab bar on iPhone
export default function TabsLayout() {
  const p = usePalette();
  return (
    <NativeTabs
      backgroundColor={p.surface}
      tintColor={p.ink}
      iconColor={p.muted}
      indicatorColor={p.soft}
      rippleColor={p.soft}
      labelStyle={{ fontFamily: F.bodyBold, color: p.muted }}>
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Label>Explore</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'sparkles', selected: 'sparkles' }} md={{ default: 'explore', selected: 'explore' }} />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="map">
        <NativeTabs.Trigger.Label>Map</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'map', selected: 'map.fill' }} md="map" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="add">
        <NativeTabs.Trigger.Label>Add</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'plus.circle', selected: 'plus.circle.fill' }} md="add_circle" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="mine">
        <NativeTabs.Trigger.Label>My events</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'bookmark', selected: 'bookmark.fill' }} md={{ default: 'bookmark_border', selected: 'bookmark' }} />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="about">
        <NativeTabs.Trigger.Label>Phoenix</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'flame', selected: 'flame.fill' }} md="local_fire_department" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
