import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { AppState, useColorScheme } from 'react-native';

import { flushLogs } from '@/services/log-queue';

export default function RootLayout() {
  const colorScheme = useColorScheme();

  // Background sync: flush any queued attendance logs on launch, periodically,
  // and whenever the app returns to the foreground.
  useEffect(() => {
    flushLogs();
    const interval = setInterval(() => {
      flushLogs();
    }, 15000);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') flushLogs();
    });
    return () => {
      clearInterval(interval);
      sub.remove();
    };
  }, []);

  return (
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
        <Stack.Screen name="export" />
      </Stack>
      <StatusBar style="light" />
    </ThemeProvider>
  );
}
