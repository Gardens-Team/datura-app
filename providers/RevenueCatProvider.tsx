import React, { useEffect } from 'react';
import Purchases from 'react-native-purchases';
import { Platform } from 'react-native';

const RC_API_KEY =
  Platform.OS === 'ios'
    ? process.env.EXPO_PUBLIC_RC_IOS_KEY! // appl_...
    : process.env.EXPO_PUBLIC_RC_ANDROID_KEY!; // goog_...

export function RevenueCatProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    Purchases.configure({ apiKey: RC_API_KEY, appUserID: null });
    Purchases.setLogLevel(Purchases.LOG_LEVEL.DEBUG); // optional
  }, []);

  return <>{children}</>;
}
