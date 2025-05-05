import { Stack } from 'expo-router';
import { useColorScheme } from 'react-native';
import { Colors } from '@/constants/Colors';
import React, { createContext, useState, useContext, useEffect, useRef } from 'react';
import { DaturaClient, getDaturaClient, getGroupKeyForChannel } from '@/services/datura-service';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { MMKV } from 'react-native-mmkv';

// Initialize MMKV storage
const mmkvStorage = new MMKV({
  id: 'datura-client-storage',
  encryptionKey: 'datura-secret-key'
});

// Define storage keys
const STORAGE_KEYS = {
  ACTIVE_CHANNEL_ID: 'active-channel-id',
  GROUP_KEYS: 'group-keys', // Will store as JSON object { channelId: groupKey }
  USER_ID: 'user-id',
  CHANNEL_STATES: 'channel-states', // Will store connection states for multiple channels
  CHANNEL_MESSAGES: 'channel-messages', // Will store decrypted messages for channels
};

// Define types for persisted data
interface StoredChannelState {
  channelId: string;
  isConnected: boolean;
  lastConnected: number;
}

// Create Datura context
interface DaturaContextType {
  daturaClient: DaturaClient | null;
  loading: boolean;
  error: Error | null;
  initializeClient: (channelId: string) => Promise<DaturaClient | null>;
  getGroupKey: (channelId: string) => string | null;
  storeGroupKey: (channelId: string, key: string) => void;
  activeChannelId: string | null;
  storeMessages: (channelId: string, messages: any[]) => void;
  getStoredMessages: (channelId: string) => any[];
}

const DaturaContext = createContext<DaturaContextType>({
  daturaClient: null,
  loading: false,
  error: null,
  initializeClient: async () => null,
  getGroupKey: () => null,
  storeGroupKey: () => {},
  activeChannelId: null,
  storeMessages: () => {},
  getStoredMessages: () => []
});

// Hook to use the Datura context
export const useDatura = () => useContext(DaturaContext);

// Helper functions for storage
const getStoredGroupKeys = (): Record<string, string> => {
  const keysJson = mmkvStorage.getString(STORAGE_KEYS.GROUP_KEYS);
  if (keysJson) {
    try {
      return JSON.parse(keysJson);
    } catch (e) {
      console.error('[DaturaProvider] Failed to parse stored group keys:', e);
    }
  }
  return {};
};

const storeGroupKey = (channelId: string, key: string): void => {
  const keys = getStoredGroupKeys();
  keys[channelId] = key;
  mmkvStorage.set(STORAGE_KEYS.GROUP_KEYS, JSON.stringify(keys));
};

const getStoredChannelStates = (): StoredChannelState[] => {
  const statesJson = mmkvStorage.getString(STORAGE_KEYS.CHANNEL_STATES);
  if (statesJson) {
    try {
      return JSON.parse(statesJson);
    } catch (e) {
      console.error('[DaturaProvider] Failed to parse stored channel states:', e);
    }
  }
  return [];
};

const updateChannelState = (channelId: string, isConnected: boolean): void => {
  const states = getStoredChannelStates();
  const existingIndex = states.findIndex(s => s.channelId === channelId);
  
  if (existingIndex >= 0) {
    states[existingIndex] = {
      ...states[existingIndex],
      isConnected,
      lastConnected: Date.now()
    };
  } else {
    states.push({
      channelId,
      isConnected,
      lastConnected: Date.now()
    });
  }
  
  mmkvStorage.set(STORAGE_KEYS.CHANNEL_STATES, JSON.stringify(states));
};

// Helper functions for message storage
const getStoredMessages = (channelId: string): any[] => {
  const key = `${STORAGE_KEYS.CHANNEL_MESSAGES}-${channelId}`;
  const messagesJson = mmkvStorage.getString(key);
  if (messagesJson) {
    try {
      return JSON.parse(messagesJson);
    } catch (e) {
      console.error('[DaturaProvider] Failed to parse stored messages:', e);
    }
  }
  return [];
};

const storeMessages = (channelId: string, messages: any[]): void => {
  if (!channelId || !messages || messages.length === 0) return;
  
  try {
    // Create a unique key for this channel's messages
    const key = `${STORAGE_KEYS.CHANNEL_MESSAGES}-${channelId}`;
    
    // Store only the most recent 100 messages to prevent storage issues
    const messagesToStore = messages.slice(0, 100);
    
    // Store the messages
    mmkvStorage.set(key, JSON.stringify(messagesToStore));
    console.log(`[DaturaProvider] Stored ${messagesToStore.length} messages for channel ${channelId}`);
  } catch (e) {
    console.error('[DaturaProvider] Error storing messages:', e);
  }
};

// Datura Provider component
function DaturaProvider({ children }: { children: React.ReactNode }) {
  const [daturaClient, setDaturaClient] = useState<DaturaClient | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [activeChannelId, setActiveChannelId] = useState<string | null>(
    mmkvStorage.getString(STORAGE_KEYS.ACTIVE_CHANNEL_ID) || null
  );
  const { user } = useCurrentUser();
  const reconnectInterval = useRef<NodeJS.Timeout | null>(null);

  // Store user ID when available
  useEffect(() => {
    if (user?.id) {
      mmkvStorage.set(STORAGE_KEYS.USER_ID, user.id);
    }
  }, [user?.id]);

  // Function to initialize a client for a specific channel
  const initializeClient = async (channelId: string): Promise<DaturaClient | null> => {
    if (!user) return null;
    
    setLoading(true);
    setError(null);
    
    try {
      // Store the active channel ID
      mmkvStorage.set(STORAGE_KEYS.ACTIVE_CHANNEL_ID, channelId);
      setActiveChannelId(channelId);
      
      // Try to get a client
      const client = await getDaturaClient(channelId);
      
      if (client) {
      setDaturaClient(client);
        updateChannelState(channelId, true);
        
        // Fetch and store group key if not already stored
        const groupKeys = getStoredGroupKeys();
        if (!groupKeys[channelId] && user.id) {
          try {
            const key = await getGroupKeyForChannel(channelId, user.id);
            if (key) {
              storeGroupKey(channelId, key);
            }
          } catch (keyError) {
            console.error('[DaturaProvider] Failed to fetch group key:', keyError);
          }
        }
      }
      
      return client;
    } catch (err) {
      console.error("[DaturaProvider] Failed to initialize Datura client:", err);
      updateChannelState(channelId, false);
      setError(err instanceof Error ? err : new Error('Unknown error'));
      return null;
    } finally {
      setLoading(false);
    }
  };

  // Get stored group key for a channel
  const getGroupKey = (channelId: string): string | null => {
    const keys = getStoredGroupKeys();
    return keys[channelId] || null;
  };

  // Setup reconnection mechanism
  useEffect(() => {
    // Clear any existing interval
    if (reconnectInterval.current) {
      clearInterval(reconnectInterval.current);
    }
    
    // Set up periodic connection check
    if (activeChannelId) {
      reconnectInterval.current = setInterval(() => {
        if (daturaClient && !daturaClient.isConnected()) {
          console.log('[DaturaProvider] Attempting to reconnect to channel:', activeChannelId);
          
          // Use the proper setter method
          daturaClient.setChannelId(activeChannelId);
          daturaClient.reconnect();
        }
      }, 10000); // Check every 10 seconds
    }
    
    return () => {
      if (reconnectInterval.current) {
        clearInterval(reconnectInterval.current);
      }
    };
  }, [daturaClient, activeChannelId]);

  // Cleanup function
  useEffect(() => {
    return () => {
      if (daturaClient) {
        // Mark as disconnected in storage
        if (activeChannelId) {
          updateChannelState(activeChannelId, false);
        }
        daturaClient.disconnect();
      }
    };
  }, [daturaClient, activeChannelId]);

  // Context value
  const contextValue = {
    daturaClient,
    loading,
    error,
    initializeClient,
    getGroupKey,
    storeGroupKey,
    activeChannelId,
    storeMessages,
    getStoredMessages
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