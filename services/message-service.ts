import { supabase } from './supabase-singleton';
import { IMessage } from 'react-native-gifted-chat';
import { decode, encode } from '@stablelib/base64';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { Garden } from './garden-service';
import { insertMessage, getMessagesForChannel, getGroupKeyForChannel, subscribeMessages, MessageRow } from '@/services/sync-service';
import { useCallback, useState, useEffect } from 'react';
import { useCurrentUser } from '@/hooks/useCurrentUser';

// Extended message interface with garden and encryption support
export interface ExtendedMessage extends IMessage {
  garden?: Garden;
  recipient?: Recipient;
  ciphertext?: string;
}

// Recipient interface for direct messages
export interface Recipient {
  _id: string;
  name: string;
  avatar?: string;
}

// React hook that returns helpers bound to SyncProvider
export function useMessageService() {
  const { user } = useCurrentUser();
  const [keyCache, setKeyCache] = useState<Record<string, string>>({});

  // Helper to get key (from cache or fetch)
  const getKeyForChannel = useCallback(async (channelId: string) => {
    // Return from cache if available
    if (keyCache[channelId]) {
      console.log('[MessageService] Using cached key for channel', channelId);
      return keyCache[channelId];
    }

    // Get user ID - try context then storage
    let userId = user?.id;
    
    if (userId) {
      console.log('[MessageService] Using userId from context:', userId);
      // Ensure it's also saved to SecureStore for future use
      await SecureStore.setItemAsync('local_user_id', userId);
    } else {
      // Fallback to storage
      const storedId = await SecureStore.getItemAsync('local_user_id');
      userId = storedId || undefined;
      if (!userId) {
        console.error('[MessageService] No user id available from context or storage');
        return undefined; 
      }
      console.log('[MessageService] Using userId from SecureStore:', userId);
    }

    // Fetch key
    console.log('[MessageService] Fetching key for channel', channelId, 'with user', userId);
    const key = await getGroupKeyForChannel(channelId, userId);
    if (key) {
      console.log('[MessageService] Caching key for channel', channelId);
      // Update cache
      setKeyCache(prev => ({ ...prev, [channelId]: key }));
      return key;
    }
    console.warn('[MessageService] No key available for channel', channelId);
    return undefined;
  }, [user, keyCache]);

  // fetch & decrypt
  const fetchMessages = useCallback(async (channelId: string, groupKey?: string): Promise<IMessage[]> => {
    console.log(`[MessageService] fetchMessages for channel ${channelId}`);
    
    // Get key if not provided
    let resolvedKey = groupKey;
    if (!resolvedKey) {
      resolvedKey = await getKeyForChannel(channelId);
      console.log(`[MessageService] ${resolvedKey ? 'Retrieved' : 'Failed to get'} key from storage`);
    }
    
    const rows = await getMessagesForChannel(channelId);
    console.log(`[MessageService] retrieved ${rows.length} rows from sync`);

    return rows.map((row: any) => {
      let payloadStr = '[Encrypted]';
      if (resolvedKey) {
        try { payloadStr = decryptMessage(row.ciphertext, resolvedKey); } catch (e) {
          console.error('[MessageService] Decryption error:', e);
        }
      }
      let payload: any = {};
      try { payload = JSON.parse(payloadStr); } catch (e) {
        console.warn('[MessageService] JSON parse error, payload:', payloadStr);
      }

      return {
        _id: row.id,
        text: payload.text || '',
        createdAt: new Date(row.created_at),
        user: { _id: row.sender_id },
        image: payload.image,
        video: payload.video,
        audio: payload.audio,
        sent: true,
        received: true,
      } as IMessage;
    });
  }, [getKeyForChannel]);

  // insert local => sync
  const sendMessage = useCallback(async (channelId: string, msg: ExtendedMessage, groupKey?: string) => {
    console.log(`[MessageService] sendMessage to channel ${channelId}`);
    if (!msg.text && !msg.image && !msg.video && !msg.audio) throw new Error('Empty message');

    // Get key if not provided
    let resolvedKey = groupKey;
    if (!resolvedKey) {
      resolvedKey = await getKeyForChannel(channelId);
      if (resolvedKey === undefined) {
        throw new Error('Cannot send message: encryption key not available');
      }
    }

    const payload = { text: msg.text || '', image: msg.image, video: msg.video, audio: msg.audio };
    const ciphertext = encryptMessage(JSON.stringify(payload), resolvedKey);
    let messageType: string = 'Text';
    if (msg.image) messageType = 'Image';
    else if (msg.video) messageType = 'Video';
    else if (msg.audio) messageType = 'Audio';

    await insertMessage({
      id: Crypto.randomUUID(),
      ciphertext,
      created_at: new Date().toISOString(),
      channel_id: channelId,
      garden_id: msg.garden?.id || '00000000-0000-0000-0000-000000000000',
      sender_id: msg.user._id,
      message_type: messageType,
      nonce: null,
      sync_status: 'pending',
    } as any);
  }, [getKeyForChannel]);

  return { fetchMessages, sendMessage };
}

// Basic encryption using the group key
function encryptMessage(text: string, key: string): string {
  // This is a simple implementation - should be replaced with proper encryption
  try {
    // In a real implementation, you'd use proper crypto libraries
    // This is just a demonstration
    return encode(new TextEncoder().encode(text));
  } catch (e) {
    console.error('Encryption failed:', e);
    return text;
  }
}

// Basic decryption using the group key
function decryptMessage(ciphertext: string, key: string): string {
  // This is a simple implementation - should be replaced with proper decryption
  try {
    // In a real implementation, you'd use proper crypto libraries
    // This is just a demonstration
    return new TextDecoder().decode(decode(ciphertext));
  } catch (e) {
    console.error('Decryption failed:', e);
    return '[Decryption failed]';
  }
}

// Upload audio file to storage and return the URL
export async function uploadAudioMessage(
  uri: string, 
  channelId: string
): Promise<string> {
  const filename = `${Crypto.randomUUID()}.m4a`;
  const filePath = `audio/${channelId}/${filename}`;
  
  const response = await fetch(uri);
  const blob = await response.blob();
  
  const { data, error } = await supabase.storage
    .from('message_media')
    .upload(filePath, blob);
    
  if (error) throw error;
  
  // Get public URL
  const { data: publicUrl } = supabase.storage
    .from('message_media')
    .getPublicUrl(filePath);
    
  return publicUrl.publicUrl;
}

// Similar functions for other media types
export async function uploadImageMessage(
  uri: string, 
  channelId: string
): Promise<string> {
  const filename = `${Crypto.randomUUID()}.jpg`;
  const filePath = `images/${channelId}/${filename}`;
  
  const response = await fetch(uri);
  const blob = await response.blob();
  
  const { data, error } = await supabase.storage
    .from('message_media')
    .upload(filePath, blob);
    
  if (error) throw error;
  
  // Get public URL
  const { data: publicUrl } = supabase.storage
    .from('message_media')
    .getPublicUrl(filePath);
    
  return publicUrl.publicUrl;
}

/**
 * Subscribe to live message updates for a channel.
 * Decrypts new rows and invokes callback with IMessage array.
 * Returns an unsubscribe function.
 */
export async function subscribeToChannel(
  channelId: string,
  callback: (msgs: IMessage[]) => void
): Promise<() => void> {
  // retrieve user ID from storage
  const userId = await SecureStore.getItemAsync('local_user_id');
  if (!userId) throw new Error('No user ID in SecureStore');
  // fetch group key for this user & channel
  const key = await getGroupKeyForChannel(channelId, userId);
  // subscribe to low-level rows
  const unsub = await subscribeMessages(channelId, (rows: MessageRow[]) => {
    const msgs: IMessage[] = rows.map(row => {
      let payloadStr = '[Encrypted]';
      if (key) {
        try { payloadStr = decryptMessage(row.ciphertext, key); } catch {}
      }
      let payload: any = {};
      try { payload = JSON.parse(payloadStr); } catch {}
      return {
        _id: row.id,
        text: payload.text || '',
        createdAt: new Date(row.created_at),
        user: { _id: row.sender_id },
        image: payload.image,
        video: payload.video,
        audio: payload.audio,
        sent: true,
        received: true,
      } as IMessage;
    });
    callback(msgs);
  });
  return unsub;
} 