import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider } from '@/components/ThemeProvider';
import { AuthProvider } from '@/providers/AuthProvider';
import { RevenueCatProvider } from '@/providers/RevenueCatProvider';
import { useEffect, useRef } from 'react';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { registerForPushNotifications } from '@/services/notifications-service';
import { supabase } from '@/services/supabase-singleton';
import { useCurrentUser } from '@/hooks/useCurrentUser';

// Set up notification handling
function useNotificationObserver() {
  const { user } = useCurrentUser();
  const notificationListener = useRef<Notifications.EventSubscription>();
  const responseListener = useRef<Notifications.EventSubscription>();

  useEffect(() => {
    const registerDeviceForPushNotifications = async () => {
      if (!user) return;
      
      // Register for push notifications and get the token
      // This now automatically persists the token to the user's record
      await registerForPushNotifications(user.id);
    };
    
    registerDeviceForPushNotifications();
    
    // This listener is fired whenever a notification is received while the app is foregrounded
    notificationListener.current = Notifications.addNotificationReceivedListener(notification => {
      console.log('Notification received in foreground!', notification);
      // You can update UI state here if needed
    });

    // This listener is fired whenever a user taps on or interacts with a notification
    responseListener.current = Notifications.addNotificationResponseReceivedListener(response => {
      const { data } = response.notification.request.content;
      
      // Handle notification data to navigate user to correct screen
      if (data?.type === 'membership_approved' && data?.gardenId) {
        router.push(`/garden/${data.gardenId}`);
      }
      // Add other notification type handling as needed
    });

    return () => {
      if (notificationListener.current) {
        Notifications.removeNotificationSubscription(notificationListener.current);
      }
      if (responseListener.current) {
        Notifications.removeNotificationSubscription(responseListener.current);
      }
    };
  }, [user]);
}

// Load Google Fonts
export default function RootLayout() {

  useNotificationObserver();
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
