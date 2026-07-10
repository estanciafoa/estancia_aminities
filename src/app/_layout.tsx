import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { AppState, useColorScheme } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { autoCheckoutStale } from '@/services/auto-checkout';
import { flushLogs } from '@/services/log-queue';
import { AUTO_SYNC_INTERVAL_MS, autoSyncIfDue } from '@/services/sheets';

export default function RootLayout() {
  const colorScheme = useColorScheme();

  // Background sync: flush any queued attendance logs on launch, periodically,
  // and whenever the app returns to the foreground.
  useEffect(() => {
    const tick = () => {
      autoCheckoutStale();
      flushLogs();
    };
    tick();
    const interval = setInterval(tick, 15000);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') tick();
    });
    return () => {
      clearInterval(interval);
      sub.remove();
    };
  }, []);

  // Auto-refresh subscription data every hour (and on launch / foreground).
  // Best-effort and self-throttling; the manual Admin sync still works anytime.
  useEffect(() => {
    autoSyncIfDue();
    const interval = setInterval(() => autoSyncIfDue(), AUTO_SYNC_INTERVAL_MS);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') autoSyncIfDue();
    });
    return () => {
      clearInterval(interval);
      sub.remove();
    };
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="index" />
          <Stack.Screen name="admin" />
          <Stack.Screen name="inside" />
          <Stack.Screen name="checkin" />
          <Stack.Screen name="checkout" />
          <Stack.Screen name="family" />
          <Stack.Screen name="student" />
          <Stack.Screen name="guest" />
          <Stack.Screen name="defaulters" />
          <Stack.Screen name="export" />
          <Stack.Screen name="pay" />
          <Stack.Screen name="collections" />
        </Stack>
        <StatusBar style="light" />
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}
