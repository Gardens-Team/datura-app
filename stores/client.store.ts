import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { DaturaClient } from '@/services/messaging-service';
import * as SecureStore from 'expo-secure-store';
import { MMKV } from 'react-native-mmkv';

// Create a storage instance for non-sensitive data
const storage = new MMKV();

// Interface for an active channel connection
interface ChannelConnection {
  channelId: string;
  client: DaturaClient;
  lastUsed: number;
  isConnected: boolean;
}

// Main store interface
interface DaturaStore {
  // State
  activeChannelId: string | null;
  activeClients: Record<string, ChannelConnection>;
  groupKeys: Record<string, string>;
  loading: boolean;
  error: Error | null;
  
  // Actions
  initializeClient: (channelId: string) => Promise<DaturaClient | null>;
  getGroupKey: (channelId: string) => string | null;
  storeGroupKey: (channelId: string, key: string) => void;
  setActiveChannel: (channelId: string | null) => void;
  clearError: () => void;
  cleanup: () => void;
}

// Create the persisted store
export const useDaturaStore = create<DaturaStore>()(
  persist(
    (set, get) => ({
      // Initial state
      activeChannelId: null,
      activeClients: {},
      groupKeys: {},
      loading: false,
      error: null,
      
      // Initialize a Datura client for a channel
      initializeClient: async (channelId: string) => {
        const { activeClients } = get();
        
        // Check if we already have an active client for this channel
        if (activeClients[channelId]) {
          const existingClient = activeClients[channelId];
          
          // If client exists but isn't connected, reconnect it
          if (!existingClient.isConnected && existingClient.client) {
            try {
              existingClient.client.reconnect();
              
              // Update the store with reconnected client
              set(state => ({
                activeClients: {
                  ...state.activeClients,
                  [channelId]: {
                    ...existingClient,
                    lastUsed: Date.now(),
                    isConnected: true
                  }
                },
                activeChannelId: channelId
              }));
              
              return existingClient.client;
            } catch (err) {
              console.error(`[DaturaStore] Failed to reconnect client for channel ${channelId}:`, err);
              // Continue to create a new client
            }
          } else {
            // Update the last used timestamp
            set(state => ({
              activeClients: {
                ...state.activeClients,
                [channelId]: {
                  ...existingClient,
                  lastUsed: Date.now()
                }
              },
              activeChannelId: channelId
            }));
            
            return existingClient.client;
          }
        }
        
        // No existing client, create a new one
        set({ loading: true, error: null });
        
        try {
          // Get userId from SecureStore
          const userId = await SecureStore.getItemAsync('local_user_id');
          if (!userId) {
            throw new Error('User ID not found in secure storage');
          }
          
          // Import dynamically to avoid circular dependencies
          const { getDaturaClient } = await import('@/services/messaging-service');
          
          // Create a new client
          const client = await getDaturaClient(channelId);
          
          if (!client) {
            throw new Error('Failed to initialize Datura client');
          }
          
          // Store the new client
          set(state => ({
            activeClients: {
              ...state.activeClients,
              [channelId]: {
                channelId,
                client,
                lastUsed: Date.now(),
                isConnected: true
              }
            },
            activeChannelId: channelId,
            loading: false
          }));
          
          return client;
        } catch (error) {
          console.error('[DaturaStore] Error initializing client:', error);
          set({ 
            error: error instanceof Error ? error : new Error(String(error)),
            loading: false 
          });
          return null;
        }
      },
      
      // Get a group key for a channel
      getGroupKey: (channelId: string) => {
        return get().groupKeys[channelId] || null;
      },
      
      // Store a group key for a channel
      storeGroupKey: (channelId: string, key: string) => {
        set(state => ({
          groupKeys: {
            ...state.groupKeys,
            [channelId]: key
          }
        }));
      },
      
      // Set the active channel
      setActiveChannel: (channelId: string | null) => {
        set({ activeChannelId: channelId });
      },
      
      // Clear any errors
      clearError: () => {
        set({ error: null });
      },
      
      // Cleanup function to disconnect inactive clients
      cleanup: () => {
        const { activeClients } = get();
        const now = Date.now();
        const inactiveThreshold = 15 * 60 * 1000; // 15 minutes
        
        const updatedClients: Record<string, ChannelConnection> = {};
        
        Object.entries(activeClients).forEach(([channelId, connection]) => {
          if (now - connection.lastUsed > inactiveThreshold) {
            // Disconnect inactive client
            connection.client.disconnect();
          } else {
            // Keep active clients
            updatedClients[channelId] = connection;
          }
        });
        
        set({ activeClients: updatedClients });
      }
    }),
    {
      name: 'datura-storage',
      storage: createJSONStorage(() => ({
        setItem: (name, value) => {
          storage.set(name, value);
        },
        getItem: (name) => {
          const value = storage.getString(name);
          return value ? value : null;
        },
        removeItem: (name) => {
          storage.delete(name);
        },
      })),
      // Only persist certain parts of the state
      partialize: (state) => ({
        groupKeys: state.groupKeys,
        // Don't persist clients as they cannot be serialized
      }),
    }
  )
);

// Schedule cleanup every 5 minutes
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    useDaturaStore.getState().cleanup();
  }, 5 * 60 * 1000);
}