// hooks/useCurrentUser.ts
import { useState, useEffect } from 'react';
import { getCurrentUser } from '@/services/database-service';
import { UserProfile } from '@/app/(tabs)/_layout'; // Import from layout
import * as SecureStore from 'expo-secure-store';

export function useCurrentUser() {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  async function fetchUser() {
    setLoading(true);
    try {
      const userData = await getCurrentUser() as UserProfile;
      if (userData && userData.id) {
        setUser(userData);
        // Store the user ID for services to use
        await SecureStore.setItemAsync('local_user_id', userData.id);
        console.log(`[useCurrentUser] Stored user ID ${userData.id} in SecureStore`);
      } else {
        console.warn('[useCurrentUser] No user data found');
      }
    } catch (error) {
      console.error("Error fetching user:", error);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchUser();
  }, []);

  return { user, loading, refetchUser: fetchUser };
}