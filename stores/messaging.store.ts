import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { MMKV } from 'react-native-mmkv'
import { DaturaClient, getDaturaClient } from '@/services/datura-service'

// Reuse your existing MMKV instance
const mmkvStorage = new MMKV({
  id: 'datura-client-storage',
  encryptionKey: 'datura-secret-key'
})

// Create custom storage for Zustand using MMKV
const mmkvStorageAdapter = {
  getItem: (name: string) => {
    const value = mmkvStorage.getString(name)
    return value ?? null
  },
  setItem: (name: string, value: string) => {
    mmkvStorage.set(name, value)
  },
  removeItem: (name: string) => {
    mmkvStorage.delete(name)
  }
}

// Define your store's state type
interface DaturaState {
  daturaClient: DaturaClient | null
  activeChannelId: string | null
  groupKeys: Record<string, string>
  channelMessages: Record<string, any[]>
  loading: boolean
  error: Error | null
  
  // Actions
  initializeClient: (channelId: string, userId: string) => Promise<DaturaClient | null>
  storeGroupKey: (channelId: string, key: string) => void
  getGroupKey: (channelId: string) => string | null
  storeMessages: (channelId: string, messages: any[]) => void
  getStoredMessages: (channelId: string) => any[]
}

// Create the Zustand store with persist middleware
export const useDaturaStore = create<DaturaState>()(
  persist(
    (set, get) => ({
      daturaClient: null,
      activeChannelId: null,
      groupKeys: {},
      channelMessages: {},
      loading: false,
      error: null,
      
      initializeClient: async (channelId, userId) => {
        set({ loading: true, error: null })
        
        try {
          // Store the active channel ID
          set({ activeChannelId: channelId })
          
          // Try to get a client
          const client = await getDaturaClient(channelId)
          
          if (client) {
            set({ daturaClient: client })
            // No need to update connection state here as it's tracked in the store
            return client
          }
          
          return null
        } catch (err) {
          console.error("[DaturaStore] Failed to initialize Datura client:", err)
          set({ error: err instanceof Error ? err : new Error('Unknown error') })
          return null
        } finally {
          set({ loading: false })
        }
      },
      
      storeGroupKey: (channelId, key) => {
        set((state) => ({
          groupKeys: {
            ...state.groupKeys,
            [channelId]: key
          }
        }))
      },
      
      getGroupKey: (channelId) => {
        return get().groupKeys[channelId] || null
      },
      
      storeMessages: (channelId, messages) => {
        if (!channelId || !messages || messages.length === 0) return
        
        // Store only the most recent 100 messages to prevent storage issues
        const messagesToStore = messages.slice(0, 100)
        
        set((state) => ({
          channelMessages: {
            ...state.channelMessages,
            [channelId]: messagesToStore
          }
        }))
        
        console.log(`[DaturaStore] Stored ${messagesToStore.length} messages for channel ${channelId}`)
      },
      
      getStoredMessages: (channelId) => {
        return get().channelMessages[channelId] || []
      }
    }),
    {
      name: 'datura-store',
      storage: createJSONStorage(() => mmkvStorageAdapter),
      partialize: (state) => ({
        // Only persist these fields, exclude the client object itself
        activeChannelId: state.activeChannelId,
        groupKeys: state.groupKeys,
        channelMessages: state.channelMessages
      })
    }
  )
)