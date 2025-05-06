import { Stack } from 'expo-router';
import { useColorScheme } from 'react-native';
import { Colors } from '@/constants/Colors';
import React, { createContext, useState, useContext, useEffect, useRef, useCallback } from 'react';
import { DaturaClient } from '@/services/messaging-service';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useDaturaStore } from '@/stores/client.store';

// Create Datura context
interface DaturaContextType {
  daturaClient: DaturaClient | null;
  loading: boolean;
  error: Error | null;
  initializeClient: (channelId: string) => Promise<DaturaClient | null>;
  getGroupKey: (channelId: string) => string | null;
  storeGroupKey: (channelId: string, key: string) => void;
  activeChannelId: string | null;
}

const DaturaContext = createContext<DaturaContextType>({
  daturaClient: null,
  loading: false,
  error: null,
  initializeClient: async () => null,
  getGroupKey: () => null,
  storeGroupKey: () => {},
  activeChannelId: null,
});

// Hook to use the Datura context
export const useDatura = () => useContext(DaturaContext);

// Datura Provider component
function DaturaProvider({ children }: { children: React.ReactNode }) {
  // Use the Zustand store
  const { 
    activeClients,
    activeChannelId, 
    initializeClient: storeInitializeClient,
    getGroupKey: storeGetGroupKey,
    storeGroupKey: storeSetGroupKey,
    setActiveChannel,
    loading: storeLoading,
    error: storeError,
    clearError
  } = useDaturaStore();
  
  const [daturaClient, setDaturaClient] = useState<DaturaClient | null>(
    activeChannelId && activeClients[activeChannelId] 
      ? activeClients[activeChannelId].client 
      : null
  );
  
  const { user } = useCurrentUser();
  const reconnectInterval = useRef<NodeJS.Timeout | null>(null);

  // Function to initialize a client for a specific channel
  const initializeClient = useCallback(async (channelId: string): Promise<DaturaClient | null> => {
    if (!user) return null;
    
    try {
      // Use the store's initializeClient method
      const client = await storeInitializeClient(channelId);
      
      if (client) {
        // Update local state
        setDaturaClient(client);
      }
      
      return client;
    } catch (err) {
      console.error("[DaturaProvider] Failed to initialize Datura client:", err);
      return null;
    }
  }, [user, storeInitializeClient]);

  // Setup reconnection mechanism
  useEffect(() => {
    // Clear any existing interval
    if (reconnectInterval.current) {
      clearInterval(reconnectInterval.current);
    }
    
    // Set up periodic connection check
    if (activeChannelId && activeClients[activeChannelId]) {
      reconnectInterval.current = setInterval(() => {
        const connection = activeClients[activeChannelId];
        if (connection && connection.client && !connection.isConnected) {
          console.log('[DaturaProvider] Attempting to reconnect to channel:', activeChannelId);
          connection.client.reconnect();
        }
      }, 10000); // Check every 10 seconds
    }
    
    return () => {
      if (reconnectInterval.current) {
        clearInterval(reconnectInterval.current);
      }
    };
  }, [activeClients, activeChannelId]);

  // Sync daturaClient when activeChannelId changes
  useEffect(() => {
    if (activeChannelId && activeClients[activeChannelId]) {
      setDaturaClient(activeClients[activeChannelId].client);
    } else {
      setDaturaClient(null);
    }
  }, [activeChannelId, activeClients]);

  // Context value
  const contextValue = {
    daturaClient,
    loading: storeLoading,
    error: storeError,
    initializeClient,
    getGroupKey: storeGetGroupKey,
    storeGroupKey: storeSetGroupKey,
    activeChannelId,
  };

  return (
    <DaturaContext.Provider value={contextValue}>
      {children}
    </DaturaContext.Provider>
  );
}

export default function GardenLayout() {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  return (
    <DaturaProvider>
      <Stack screenOptions={{
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.text,
        headerShadowVisible: false,
        animation: 'slide_from_right',
        gestureEnabled: true,
        gestureDirection: 'horizontal',
      }}>
        <Stack.Screen name="[id]" options={{ headerShown: false, gestureEnabled: false }} />
        <Stack.Screen name="channel/[id]" options={{ headerShown: false, gestureEnabled: true }} />
      </Stack>
    </DaturaProvider>
  );
} 