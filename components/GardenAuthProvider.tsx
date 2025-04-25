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

// Define the duration in milliseconds (e.g., 15 minutes)
const GARDEN_AUTH_VALIDITY_DURATION_MS = 15 * 60 * 1000; // 900000

export function GardenAuthProvider({ gardenId, children }: GardenAuthProviderProps) {
  const { user } = useCurrentUser();
  const [authorized, setAuthorized] = useState(false);

  useEffect(() => {
    async function checkAuth() {
      // Check SecureStore for a recent authorization timestamp
      const item = await SecureStore.getItemAsync(`garden_auth_${gardenId}`);
      if (item) {
        const { timestamp } = JSON.parse(item);
        // Use the constant here
        if (Date.now() - timestamp < GARDEN_AUTH_VALIDITY_DURATION_MS) {
          setAuthorized(true);
          return; // Authorized based on recent timestamp
        }
      }
      
      // If no recent timestamp, user is not authorized yet.
      // The GardenAuthModal will be displayed.
      setAuthorized(false);
    }
    
    if (user) { // Only run check if user is loaded
      checkAuth();
    } else {
      // If user is not loaded, we can assume not authorized for the garden yet.
      // This prevents potential flashes of content before user data is available.
      setAuthorized(false);
    }

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

  if (!user) {
    // Optionally show a loading indicator while user is loading
    // Or simply return null/empty view
    return null; 
  }

  if (!authorized) {
    return (
      <GardenAuthModal
        visible={!authorized}
        gardenId={gardenId}
        gardenName="" // TODO: Fetch and pass actual garden name
        onSuccess={handleSuccess}
        onCancel={handleCancel}
      />
    );
  }
  
  return <>{children}</>;
} 