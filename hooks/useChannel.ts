import { useEffect, useState, useCallback } from 'react';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useDatura } from '@/app/garden/_layout';
import type { IMessage } from 'react-native-gifted-chat';
import { encryptMessage, decryptMessage } from '@/services/datura-service';
import * as Crypto from 'expo-crypto';

export function useChannel(channelId: string) {
  const { user } = useCurrentUser();
  const {
    daturaClient,
    loading: isStoreLoading,
    error: storeError,
    initializeClient,
    getGroupKey,
    storeGroupKey,
    storeMessages,
    getStoredMessages
  } = useDatura();

  const [isInitialized, setIsInitialized] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [messages, setMessages] = useState<IMessage[]>([]);
  const [groupKey, setGroupKey] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  // Initialize the channel and connection
  useEffect(() => {
    if (!channelId || !user?.id) return;

    let mounted = true;
    console.log(`[useChannel] Initializing channel ${channelId}`);

    const initialize = async () => {
      try {
        // Try to get existing group key first
        let key = getGroupKey(channelId);
        if (key) {
          console.log(`[useChannel] Using existing group key for channel ${channelId}`);
          setGroupKey(key);
        }

        // Initialize the client
        const client = await initializeClient(channelId);
        
        if (!mounted) return;

        if (client) {
          // Make sure channel ID is set
          client.setChannelId(channelId);
          
          // If we don't have a key yet, try to get it now
          if (!key) {
            key = getGroupKey(channelId);
            if (key) {
              console.log(`[useChannel] Retrieved group key after initialization`);
              setGroupKey(key);
            } else {
              console.warn(`[useChannel] Failed to get group key for channel ${channelId}`);
            }
          }

          // Check connection state
          setIsConnected(client.isConnected());
          
          // Load existing messages
          const storedMessages = getStoredMessages(channelId);
          if (storedMessages && storedMessages.length > 0) {
            console.log(`[useChannel] Loaded ${storedMessages.length} messages from storage`);
            setMessages(storedMessages);
          }

          setIsInitialized(true);
        } else {
          setError(new Error(`Failed to initialize client for channel ${channelId}`));
        }
      } catch (err) {
        console.error('[useChannel] Initialization error:', err);
        if (mounted) {
          setError(err instanceof Error ? err : new Error('Unknown initialization error'));
        }
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    };

    initialize();

    return () => {
      mounted = false;
    };
  }, [channelId, user?.id, initializeClient, getGroupKey]);

  // Listen for connection changes
  useEffect(() => {
    if (!daturaClient || !isInitialized) return;

    const connectionCheckInterval = setInterval(() => {
      const connected = daturaClient.isConnected();
      setIsConnected(connected);
    }, 3000);

    return () => {
      clearInterval(connectionCheckInterval);
    };
  }, [daturaClient, isInitialized]);

  // Set up message subscription
  useEffect(() => {
    if (!daturaClient || !isInitialized || !groupKey) return;

    console.log(`[useChannel] Setting up message handler for channel ${channelId}`);
    const processedMessageIds = new Set<string>();

    const messageHandler = (data: any) => {
      if (data.type === 'new_message') {
        console.log('[useChannel] Received new message');
        
        const msg = data.message;
        
        // Skip if already processed this message ID
        if (msg && msg.id && processedMessageIds.has(msg.id)) {
          console.log(`[useChannel] Already processed message ${msg.id}, skipping`);
          return;
        }
        
        // Add to processed set to avoid duplicates
        if (msg && msg.id) {
          processedMessageIds.add(msg.id);
        }

        if (msg && groupKey) {
          try {
            // Decrypt the message
            const decrypted = decryptMessage(msg.ciphertext, groupKey);
            const payload = JSON.parse(decrypted);
            
            // Create GiftedChat message format
            const message: IMessage = {
              _id: msg.id || Crypto.randomUUID(),
              text: payload.text || '',
              createdAt: new Date(msg.timestamp || Date.now()),
              user: {
                _id: msg.senderId || 'unknown',
                name: payload.username || 'Unknown',
                avatar: payload.profile_pic,
              },
              image: payload.image,
              video: payload.video,
              audio: payload.audio,
            };

            setMessages(prev => {
              // Check for duplicates
              if (prev.some(m => m._id === message._id)) {
                return prev;
              }
              
              // Add new message
              const updated = [message, ...prev];
              
              // Store updated messages
              storeMessages(channelId, updated);
              
              return updated;
            });
          } catch (err) {
            console.error('[useChannel] Error processing message:', err);
          }
        }
      } else if (data.type === 'history_loaded') {
        console.log(`[useChannel] Received message history: ${data.messages?.length || 0} messages`);
        if (data.messages && Array.isArray(data.messages) && data.messages.length > 0) {
          processMessageHistory(data.messages);
        }
      }
    };

    daturaClient.onMessage(messageHandler);
    
    // Request message history
    daturaClient.getMessageHistory(30).catch(err => {
      console.error('[useChannel] Error requesting message history:', err);
    });

    return () => {
      // No explicit cleanup needed as the client handles this
      console.log('[useChannel] Cleaning up message handler');
    };
  }, [daturaClient, isInitialized, groupKey, channelId, storeMessages]);

  // Process message history
  const processMessageHistory = useCallback((historyMessages: any[]) => {
    if (!groupKey || !historyMessages || historyMessages.length === 0) return;
    
    console.log(`[useChannel] Processing ${historyMessages.length} history messages`);
    
    setIsLoading(true);
    
    try {
      const processedMessages = historyMessages
        .map((msg: any) => {
          if (!msg.ciphertext) {
            console.warn('[useChannel] Message missing ciphertext:', msg.id);
            return null;
          }
          
          try {
            // Decrypt message content
            const decrypted = decryptMessage(msg.ciphertext, groupKey);
            let payload;
            
            try {
              payload = JSON.parse(decrypted);
            } catch (parseError) {
              console.warn(`[useChannel] Failed to parse JSON for message ${msg.id}:`, parseError);
              payload = { text: decrypted }; // Use the raw decrypted text as fallback
            }
            
            return {
              _id: msg.id || Crypto.randomUUID(),
              text: payload.text || '',
              createdAt: new Date(msg.timestamp || Date.now()),
              user: {
                _id: msg.senderId || 'unknown',
                name: payload.username || 'Unknown',
                avatar: payload.profile_pic,
              },
              image: payload.image,
              video: payload.video,
              audio: payload.audio,
            } as IMessage;
          } catch (decryptError) {
            console.error(`[useChannel] Failed to decrypt message ${msg.id}:`, decryptError);
            return null;
          }
        })
        .filter((msg): msg is IMessage => msg !== null);
      
      // Remove duplicates by _id
      const uniqueMessages = processedMessages.filter((msg, index, self) => 
        index === self.findIndex(m => m._id === msg._id)
      );
      
      setMessages(prevMessages => {
        // Merge with existing messages, avoiding duplicates
        const existingIds = new Set(prevMessages.map(m => m._id));
        const newMessages = uniqueMessages.filter(m => !existingIds.has(m._id));
        
        if (newMessages.length === 0) {
          return prevMessages;
        }
        
        // Sort by date (newest first)
        const merged = [...prevMessages, ...newMessages].sort((a, b) => 
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );
        
        // Store updated messages
        storeMessages(channelId, merged);
        
        return merged;
      });
    } catch (error) {
      console.error('[useChannel] Error processing message history:', error);
    } finally {
      setIsLoading(false);
    }
  }, [groupKey, channelId, storeMessages]);

  // Send a message
  const sendMessage = useCallback(async (messageText: string) => {
    if (!daturaClient || !groupKey || !user) {
      console.error('[useChannel] Cannot send message: missing client, group key, or user');
      return false;
    }
    
    try {
      // Create message payload
      const payload = {
        text: messageText,
        senderId: user.id,
        username: user.username,
        profile_pic: user.profile_pic,
        timestamp: new Date().toISOString(),
      };
      
      // Encrypt the payload
      const ciphertext = encryptMessage(JSON.stringify(payload), groupKey);
      
      // Generate a unique ID for optimistic updates
      const messageId = Crypto.randomUUID();
      
      // Send through WebSocket
      await daturaClient.sendMessage(ciphertext, {
        messageType: 'Text',
        senderId: user.id,
        username: user.username
      });
      
      console.log('[useChannel] Message sent successfully');
      return true;
    } catch (err) {
      console.error('[useChannel] Failed to send message:', err);
      setError(err instanceof Error ? err : new Error('Failed to send message'));
      return false;
    }
  }, [daturaClient, groupKey, user]);

  // Send a media message (image, audio, video)
  const sendMediaMessage = useCallback(async (
    mediaType: 'image' | 'audio' | 'video',
    mediaBase64: string
  ) => {
    if (!daturaClient || !groupKey || !user) {
      console.error('[useChannel] Cannot send media: missing client, group key, or user');
      return false;
    }
    
    try {
      // Create message payload with media
      const payload: Record<string, any> = {
        text: '',
        senderId: user.id,
        username: user.username,
        profile_pic: user.profile_pic,
        timestamp: new Date().toISOString(),
      };
      
      // Add media content to payload
      payload[mediaType] = mediaBase64;
      
      // Encrypt the payload
      const ciphertext = encryptMessage(JSON.stringify(payload), groupKey);
      
      // Send through WebSocket
      await daturaClient.sendMessage(ciphertext, {
        messageType: mediaType === 'image' ? 'Image' : mediaType === 'audio' ? 'Audio' : 'Video',
        senderId: user.id,
        username: user.username
      });
      
      console.log(`[useChannel] ${mediaType} message sent successfully`);
      return true;
    } catch (err) {
      console.error(`[useChannel] Failed to send ${mediaType}:`, err);
      setError(err instanceof Error ? err : new Error(`Failed to send ${mediaType}`));
      return false;
    }
  }, [daturaClient, groupKey, user]);

  const refreshMessages = useCallback(async () => {
    if (!daturaClient || !isInitialized) {
      console.warn('[useChannel] Cannot refresh messages: not initialized');
      return;
    }
    
    setIsLoading(true);
    
    try {
      const historyMessages = await daturaClient.getMessageHistory(30);
      if (historyMessages && historyMessages.length > 0) {
        processMessageHistory(historyMessages);
      } else {
        console.log('[useChannel] No messages returned from history request');
      }
    } catch (err) {
      console.error('[useChannel] Error refreshing messages:', err);
      setError(err instanceof Error ? err : new Error('Failed to refresh messages'));
    } finally {
      setIsLoading(false);
    }
  }, [daturaClient, isInitialized, processMessageHistory]);

  return {
    isLoading: isLoading || isStoreLoading,
    error: error || storeError,
    isInitialized,
    isConnected,
    messages,
    sendMessage,
    sendMediaMessage,
    refreshMessages
  };
} 