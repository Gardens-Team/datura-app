import React, { useState, useEffect } from 'react';
import { router } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { GardenAuthModal } from '@/components/modals/GardenAuthModal';
import { supabase } from '@/services/supabase-singleton';
import { useCurrentUser } from '@/hooks/useCurrentUser';

interface GardenAuthProviderProps {
  gardenId: string;
  children: React.ReactNode;
}

export function GardenAuthProvider({ gardenId, children }: GardenAuthProviderProps) {
  const { user } = useCurrentUser();
  const [authorized, setAuthorized] = useState(false);

  useEffect(() => {
    async function checkAuth() {
      // Auto-authorize creators who haven't set up auth yet
      if (user) {
        const { data: mem, error: memErr } = await supabase
          .from('memberships')
          .select('role')
          .match({ garden_id: gardenId, user_id: user.id })
          .single();
        // creators bypass auth entirely
        if (!memErr && mem?.role === 'creator') {
          setAuthorized(true);
          return;
        }
      }

      // existing SecureStore timestamp logic
      const item = await SecureStore.getItemAsync(`garden_auth_${gardenId}`);
      if (item) {
        const { timestamp } = JSON.parse(item);
        if (Date.now() - timestamp < 3600000) {
          setAuthorized(true);
          return;
        }
      }
      setAuthorized(false);
    }
    checkAuth();
  }, [gardenId, user]);

  const handleSuccess = async () => {
    await SecureStore.setItemAsync(
      `garden_auth_${gardenId}`,
      JSON.stringify({ timestamp: Date.now() })
    );
    setAuthorized(true);
  };

  const handleCancel = () => {
    router.replace('/');
  };

  if (!authorized) {
    return (
      <GardenAuthModal
        visible={!authorized}
        gardenId={gardenId}
        gardenName=""
        onSuccess={handleSuccess}
        onCancel={handleCancel}
      />
    );
  }
  return <>{children}</>;
} 