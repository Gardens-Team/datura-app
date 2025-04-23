import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import AdminNotification from '@/components/AdminNotification';
import { supabase } from '@/services/supabase-singleton';

// Configure how notifications appear when the app is in the foreground
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

// Helper: append token to user's push_tokens array (dedup)
async function persistPushToken(userId: string, token: string) {
  try {
    // Fetch current tokens
    const { data: userRow, error: fetchErr } = await supabase
      .from('users')
      .select('push_tokens')
      .eq('id', userId)
      .single();
    if (fetchErr) throw fetchErr;

    const existing: string[] = userRow?.push_tokens ?? [];
    if (existing.includes(token)) return; // already saved

    const updatedTokens = [...existing, token];

    const { error: updateErr } = await supabase
      .from('users')
      .update({ push_tokens: updatedTokens })
      .eq('id', userId);
    if (updateErr) throw updateErr;
  } catch (e) {
    console.error('Failed to persist push token:', e);
  }
}

// Function to check permissions and register for push notifications
export async function registerForPushNotifications(userId?: string) {
  if (!Device.isDevice) {
    console.log('Must use physical device for Push Notifications');
    return null;
  }

  // Set up a notification channel for Android
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Default',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#2BAC76',
    });

    // Garden notifications channel
    await Notifications.setNotificationChannelAsync('garden', {
      name: 'Garden Notifications',
      description: 'Notifications for garden memberships and activities',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#2BAC76',
    });
  }

  // Check permissions
  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;
  
  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }
  
  if (finalStatus !== 'granted') {
    console.log('Failed to get push token for push notification!');
    return null;
  }

  try {
    // Get the Expo push token
    const projectId = Constants?.expoConfig?.extra?.eas?.projectId ?? Constants?.easConfig?.projectId;
    if (!projectId) {
      throw new Error('Project ID not found - configure in app.json/eas.json');
    }
    
    const token = await Notifications.getExpoPushTokenAsync({
      projectId,
    });
    
    const tokenStr = token.data;
    if (userId) {
      await persistPushToken(userId, tokenStr);
    }
    return tokenStr;
  } catch (error) {
    console.error('Error getting push token:', error);
    return null;
  }
}

// Send notification to multiple tokens
export async function sendPushNotification(tokens: string[], title: string, body: string, data: any = {}) {
  if (!tokens || tokens.length === 0) {
    console.log('No push tokens to send to');
    return;
  }

  // Use fetch to send to Expo's notification service
  const messages = tokens.map(token => ({
    to: token,
    sound: 'default',
    title,
    body,
    data,
  }));

  try {
    await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Accept-encoding': 'gzip, deflate',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(messages.length > 1 ? messages : messages[0]),
    });
  } catch (error) {
    console.error('Error sending push notification:', error);
  }
}

// Schedule a local notification
export async function scheduleLocalNotification(title: string, body: string, data: any = {}) {
  await Notifications.scheduleNotificationAsync({
    content: {
      title,
      body,
      data,
    },
    trigger: null, // null means the notification appears immediately
  });
}