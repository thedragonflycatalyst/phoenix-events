import { AtkinsonHyperlegible_400Regular, AtkinsonHyperlegible_700Bold } from '@expo-google-fonts/atkinson-hyperlegible';
import { BricolageGrotesque_700Bold, BricolageGrotesque_800ExtraBold } from '@expo-google-fonts/bricolage-grotesque';
import { useFonts } from 'expo-font';
import * as Notifications from 'expo-notifications';
import { router, Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ToastProvider } from '@/components/ui';
import { AppProvider, useApp } from '@/lib/app-state';
import { F, usePalette } from '@/lib/theme';

// Links like phoenix:///scan open on top of the tabs, so Back always has somewhere to go
export const unstable_settings = { initialRouteName: '(tabs)' };

SplashScreen.preventAutoHideAsync().catch(() => {});

function Shell() {
  const p = usePalette();
  const { ready } = useApp();
  const [fontsLoaded] = useFonts({ BricolageGrotesque_700Bold, BricolageGrotesque_800ExtraBold, AtkinsonHyperlegible_400Regular, AtkinsonHyperlegible_700Bold });

  useEffect(() => { SystemUI.setBackgroundColorAsync(p.bg).catch(() => {}); }, [p.bg]);
  useEffect(() => { if (fontsLoaded && ready) SplashScreen.hideAsync().catch(() => {}); }, [fontsLoaded, ready]);

  // Tapping a reminder opens its event
  useEffect(() => {
    const go = (r: Notifications.NotificationResponse | null) => {
      const id = r?.notification.request.content.data?.eventId;
      if (typeof id === 'string') router.push({ pathname: '/event/[id]', params: { id } });
    };
    go(Notifications.getLastNotificationResponse());
    const sub = Notifications.addNotificationResponseReceivedListener(go);
    return () => sub.remove();
  }, []);

  if (!fontsLoaded || !ready) return null;
  const header = {
    headerStyle: { backgroundColor: p.bg }, headerTintColor: p.ink, headerShadowVisible: false,
    headerTitleStyle: { fontFamily: F.displayBold, color: p.ink }, contentStyle: { backgroundColor: p.bg },
  };
  return (
    <>
      <StatusBar style={p.scheme === 'dark' ? 'light' : 'dark'} />
      <Stack screenOptions={header}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="event/[id]" options={{ title: '', headerTransparent: true, headerStyle: { backgroundColor: 'transparent' } }} />
        <Stack.Screen name="edit/[id]" options={{ title: 'Edit event' }} />
        <Stack.Screen name="sign-in" options={{ title: '', presentation: 'formSheet', sheetAllowedDetents: [0.92], sheetGrabberVisible: true, headerShown: false }} />
        <Stack.Screen name="filters" options={{ title: '', presentation: 'formSheet', sheetAllowedDetents: [0.75, 0.95], sheetGrabberVisible: true, headerShown: false }} />
        <Stack.Screen name="comments/[id]" options={{ title: '', presentation: 'formSheet', sheetAllowedDetents: [0.72, 0.95], sheetGrabberVisible: true, headerShown: false }} />
        <Stack.Screen name="scan" options={{ headerShown: false, presentation: 'fullScreenModal', animation: 'fade_from_bottom', statusBarStyle: 'light' }} />
        <Stack.Screen name="account" options={{ title: 'Account' }} />
        <Stack.Screen name="moderate" options={{ title: 'Review posts' }} />
        <Stack.Screen name="admin" options={{ title: 'Team roles' }} />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AppProvider>
        <ToastProvider>
          <Shell />
        </ToastProvider>
      </AppProvider>
    </SafeAreaProvider>
  );
}
