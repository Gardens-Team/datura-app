import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider } from '@/components/ThemeProvider';
import { AuthProvider } from '@/providers/AuthProvider';
import { RevenueCatProvider } from '@/providers/RevenueCatProvider';

export default function RootLayout() {
  return (
    <ThemeProvider>
      <RevenueCatProvider>
        <AuthProvider>
          <SafeAreaProvider>
            <StatusBar style="light" />
            <Stack screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: '#121212' },
              animation: 'fade',
            }}>
              <Stack.Screen name="index" />
              <Stack.Screen name="auth" />
              <Stack.Screen name="(tabs)" options={{ animation: 'fade' }} />
            </Stack>
          </SafeAreaProvider>
        </AuthProvider>
      </RevenueCatProvider>
    </ThemeProvider>
  );
}
