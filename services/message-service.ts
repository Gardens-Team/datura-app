import { supabase } from './supabase-singleton';
import { IMessage } from 'react-native-gifted-chat';
import { decode, encode } from '@stablelib/base64';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { Garden } from './garden-service';
import { useCallback, useState } from 'react';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import * as SQLite from 'expo-sqlite';
import { box } from 'tweetnacl';
import { decryptGroupKeyFromBinary, getStoredPrivateKey } from '@/utils/provisioning';

// Enhanced IMessage interface to support mentions
export interface EnhancedIMessage extends IMessage {
  mentioned_users?: string[];
}

// Extended message interface with garden and encryption support
export interface ExtendedMessage extends EnhancedIMessage {
  garden?: Garden;
  recipient?: Recipient;
  ciphertext?: string;
  replyTo?: string;
}

// Recipient interface for direct messages
export interface Recipient {
  _id: string;
  name: string;
  avatar?: string;
}

// Message row from database
export interface MessageRow {
  id: string;
  ciphertext: string;
  created_at: string;
  channel_id: string;
  garden_id: string;
  sender_id: string;
  message_type: string;
  nonce: string | null;
  sync_status: string;
}

// Cache for user data to avoid redundant lookups
const userCache: Record<string, { username: string, avatar: string }> = {};

// Ensure we have the messages table in local SQLite
async function ensureLocalStorage() {
  try {
    const db = await SQLite.openDatabaseAsync('gardens.db');
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY NOT NULL,
        ciphertext TEXT NOT NULL,
        created_at TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        garden_id TEXT NOT NULL,
        sender_id TEXT NOT NULL,
        message_type TEXT,
        nonce TEXT,
        sync_status TEXT
      );
    `);
    return db;
  } catch (e) {
    console.error('[MessageService] Failed to setup local database:', e);
    throw e;
  }
}

// React hook that returns helpers bound to Supabase Realtime
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

  // Fetch user data for message display
  const fetchUserData = useCallback(async (userId: string) => {
    // Return from cache if available
    if (userCache[userId]) {
      return userCache[userId];
    }

    try {
      const { data, error } = await supabase
        .from('users')
        .select('username, profile_pic')
        .eq('id', userId)
        .single();

      if (error) throw error;

      const userData = {
        username: data?.username || 'Unknown User',
        avatar: data?.profile_pic || ''
      };

      // Update cache
      userCache[userId] = userData;
      return userData;
    } catch (e) {
      console.error('[MessageService] Error fetching user data:', e);
      return { username: 'Unknown User', avatar: '' };
    }
  }, []);

  // fetch & decrypt messages from Supabase
  const fetchMessages = useCallback(async (channelId: string, groupKey?: string): Promise<EnhancedIMessage[]> => {
    console.log(`[MessageService] fetchMessages for channel ${channelId}`);
    
    // Get key if not provided
    let resolvedKey = groupKey;
    if (!resolvedKey) {
      resolvedKey = await getKeyForChannel(channelId);
      console.log(`[MessageService] ${resolvedKey ? 'Retrieved' : 'Failed to get'} key from storage`);
    } else {
      console.log('[MessageService] Using provided key for fetchMessages');
    }
    
    // Fetch messages from Supabase
    const { data: rows, error } = await supabase
      .from('messages')
      .select('*')
      .eq('channel_id', channelId)
      .order('created_at', { ascending: false })
      .limit(50);
      
    if (error) {
      console.error('[MessageService] Error fetching messages:', error);
      return [];
    }
    
    console.log(`[MessageService] Retrieved ${rows?.length || 0} rows from Supabase`);

    // If no rows, return empty array
    if (!rows || rows.length === 0) return [];

    // Get unique sender IDs to fetch user data efficiently
    const senderIds = [...new Set(rows.map(row => row.sender_id as string))];
    
    // Prefetch user data for all senders
    const userPromises = senderIds.map(id => fetchUserData(id));
    await Promise.all(userPromises);

    return Promise.all(rows.map(async (row) => {
      let payloadStr = '[Encrypted]';
      let decryptionSuccess = false;
      
      if (resolvedKey) {
        try { 
          payloadStr = decryptMessage(row.ciphertext, resolvedKey); 
          decryptionSuccess = true;
        } catch (e) {
          console.error('[MessageService] Decryption error:', e);
        }
      } else {
        console.warn('[MessageService] No key available for decryption');
      }
      
      let payload: any = {};
      try { 
        payload = JSON.parse(payloadStr); 
        console.log(`[MessageService] Message type: ${row.message_type}, has content:`, 
          payload.text ? 'text' : '',
          payload.image ? 'image' : '',
          payload.audio ? 'audio' : '',
          payload.video ? 'video' : ''
        );
      } catch (e) {
        console.warn('[MessageService] JSON parse error, payload:', payloadStr);
      }

      // Get user data for sender
      const userData = await fetchUserData(row.sender_id);

      return {
        _id: row.id,
        text: payload.text || '',
        createdAt: new Date(row.created_at),
        user: { 
          _id: row.sender_id,
          name: userData.username,
          avatar: userData.avatar
        },
        image: payload.image,
        video: payload.video,
        audio: payload.audio,
        mentioned_users: payload.mentioned_users,
        sent: true,
        received: true,
      } as EnhancedIMessage;
    }));
  }, [getKeyForChannel, fetchUserData]);

  // insert message to Supabase with realtime sync
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

    const payload = { 
      text: msg.text || '', 
      image: msg.image, 
      video: msg.video, 
      audio: msg.audio, 
      mentioned_users: msg.mentioned_users 
    };
    const ciphertext = encryptMessage(JSON.stringify(payload), resolvedKey);
    let messageType: string = 'Text';
    if (msg.image) messageType = 'Image';
    else if (msg.video) messageType = 'Video';
    else if (msg.audio) messageType = 'Audio';

    const messageId = Crypto.randomUUID();
    const messageData = {
      id: messageId,
      ciphertext,
      created_at: new Date().toISOString(),
      channel_id: channelId,
      garden_id: msg.garden?.id || '00000000-0000-0000-0000-000000000000',
      sender_id: msg.user._id,
      message_type: messageType,
      nonce: null,
      sync_status: 'sent',
    };

    // Insert to Supabase first
    const { error } = await supabase
      .from('messages')
      .insert(messageData);

    if (error) {
      console.error('[MessageService] Failed to send message to Supabase:', error);
      throw error;
    }

    // Then save to local SQLite for offline access
    try {
      const db = await ensureLocalStorage();
      await db.runAsync(
        `INSERT INTO messages (id,ciphertext,created_at,channel_id,garden_id,sender_id,message_type,nonce,sync_status)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        [
          messageId,
          ciphertext,
          messageData.created_at,
          channelId,
          messageData.garden_id,
          messageData.sender_id,
          messageType,
          null,
          'sent'
        ]
      );
    } catch (e) {
      console.error('[MessageService] Failed to save message locally:', e);
      // Continue even if local save fails
    }

    return messageId;
  }, [getKeyForChannel]);

  return { fetchMessages, sendMessage, fetchUserData };
}

// Basic encryption using the group key
function encryptMessage(text: string, key: string): string {
  // This is a simple implementation - should be replaced with proper encryption
  try {
    console.log('[MessageService] Encrypting message, size:', text.length, 
      'contains media:', text.includes('data:image'), text.includes('data:audio'));
    
    // In a real implementation, you'd use proper crypto libraries
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
    const decoded = new TextDecoder().decode(decode(ciphertext));
    
    // Log info about the decoded content
    const isMedia = decoded.includes('data:image') || 
                   decoded.includes('data:audio') || 
                   decoded.includes('data:video');
    
    console.log('[MessageService] Decrypted message, size:', decoded.length, 
      'contains media:', isMedia,
      'sample:', isMedia ? '[MEDIA CONTENT]' : decoded.substring(0, Math.min(20, decoded.length)) + '...');
    
    return decoded;
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
  try {
    // Read the file as base64
    const response = await fetch(uri);
    const blob = await response.blob();
    
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = reader.result as string;
        // Return the base64 string directly
        resolve(base64);
      };
      reader.onerror = (error) => reject(error);
      reader.readAsDataURL(blob);
    });
  } catch (error) {
    console.error('Error converting audio to base64:', error);
    throw error;
  }
}

// Convert image to base64 instead of uploading to storage
export async function uploadImageMessage(
  uri: string, 
  channelId: string
): Promise<string> {
  try {
    // Read the file as base64
    const response = await fetch(uri);
    const blob = await response.blob();
    
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = reader.result as string;
        // Return the base64 string directly
        resolve(base64);
      };
      reader.onerror = (error) => reject(error);
      reader.readAsDataURL(blob);
    });
  } catch (error) {
    console.error('Error converting image to base64:', error);
    throw error;
  }
}

/**
 * Subscribe to live message updates for a channel using Supabase Realtime.
 * Decrypts new rows and invokes callback with IMessage array.
 * Returns an unsubscribe function.
 */
export async function subscribeToChannel(
  channelId: string,
  callback: (msgs: EnhancedIMessage[]) => void
): Promise<() => void> {
  // retrieve user ID from storage
  const userId = await SecureStore.getItemAsync('local_user_id');
  if (!userId) throw new Error('No user ID in SecureStore');
  
  // fetch group key for this user & channel
  const key = await getGroupKeyForChannel(channelId, userId);
  if (!key) {
    console.error('[MessageService] Failed to get group key for subscription');
  }
  
  // Fetch user data
  const getUserData = async (senderId: string) => {
    if (userCache[senderId]) {
      return userCache[senderId];
    }

    try {
      const { data, error } = await supabase
        .from('users')
        .select('username, profile_pic')
        .eq('id', senderId)
        .single();

      if (error) throw error;

      const userData = {
        username: data?.username || 'Unknown User',
        avatar: data?.profile_pic || ''
      };

      userCache[senderId] = userData;
      return userData;
    } catch (e) {
      console.error('[MessageService] Error fetching user data:', e);
      return { username: 'Unknown User', avatar: '' };
    }
  };
  
  // First get all existing messages to initialize the UI
  const { data: existingMessages, error: fetchError } = await supabase
    .from('messages')
    .select('*')
    .eq('channel_id', channelId)
    .order('created_at', { ascending: false })
    .limit(50);
    
  if (fetchError) {
    console.error('[MessageService] Error fetching initial messages:', fetchError);
  } else {
    console.log(`[MessageService] Subscription initialized with ${existingMessages?.length || 0} existing messages`);
  
    // Process the initial messages
    if (existingMessages && existingMessages.length > 0) {
      const processedMessages = await Promise.all(existingMessages.map(async (row) => {
        let payloadStr = '[Encrypted]';
        if (key) {
          try { 
            payloadStr = decryptMessage(row.ciphertext, key); 
          } catch (e) {
            console.error('[MessageService] Decryption error for initial message:', e);
          }
        }
        
        let payload: any = {};
        try { 
          payload = JSON.parse(payloadStr); 
        } catch (e) {
          console.error('[MessageService] JSON parse error for initial message:', e);
        }
        
        // Get user data for sender
        const userData = await getUserData(row.sender_id);
        
        return {
          _id: row.id,
          text: payload.text || '',
          createdAt: new Date(row.created_at),
          user: { 
            _id: row.sender_id,
            name: userData.username,
            avatar: userData.avatar
          },
          image: payload.image,
          video: payload.video,
          audio: payload.audio,
          mentioned_users: payload.mentioned_users,
          sent: true,
          received: true,
        } as EnhancedIMessage;
      }));
      
      // Send the initial batch of messages
      callback(processedMessages);
    }
  }
  
  // Subscribe to realtime updates with Supabase Realtime
  const subscription = supabase
    .channel(`messages:${channelId}`)
    .on('postgres_changes', 
      { 
        event: 'INSERT', 
        schema: 'public', 
        table: 'messages',
        filter: `channel_id=eq.${channelId}`
      }, 
      async (payload) => {
        console.log('[MessageService] Realtime new message received:', payload.new.id);
        
        const row = payload.new as MessageRow;
        
        // Log the ciphertext directly from the payload
        console.log('[MessageService] Realtime ciphertext (raw): ', row.ciphertext);
        console.log('[MessageService] Realtime ciphertext type:', typeof row.ciphertext);
        
        // ** No normalization needed if ciphertext column is TEXT **
        const ciphertext = row.ciphertext;
        
        // Process the new message
        let payloadStr = '[Encrypted]';
        if (key && ciphertext) { // Use direct ciphertext
          try { 
            payloadStr = decryptMessage(ciphertext, key); // Use direct ciphertext
          } catch (e) {
            console.error('[MessageService] Decryption error for realtime message:', e);
          }
        } else if (!key) {
          console.warn('[MessageService] Cannot decrypt realtime message: Missing key');
        } else {
          console.warn('[MessageService] Cannot decrypt realtime message: Missing or invalid ciphertext');
        }
        
        let msgPayload: any = {};
        try { 
          msgPayload = JSON.parse(payloadStr); 
        } catch (e) {
          console.error('[MessageService] JSON parse error for realtime message:', e);
        }
        
        // Get user data for sender
        const userData = await getUserData(row.sender_id);
        
        const message: EnhancedIMessage = {
          _id: row.id,
          text: msgPayload.text || '',
          createdAt: new Date(row.created_at),
          user: { 
            _id: row.sender_id,
            name: userData.username,
            avatar: userData.avatar
          },
          image: msgPayload.image,
          video: msgPayload.video,
          audio: msgPayload.audio,
          mentioned_users: msgPayload.mentioned_users,
          sent: true,
          received: true,
        };
        
        // Add to local SQLite for offline access
        try {
          const db = await ensureLocalStorage();
          await db.runAsync(
            `INSERT OR IGNORE INTO messages (id,ciphertext,created_at,channel_id,garden_id,sender_id,message_type,nonce,sync_status)
             VALUES (?,?,?,?,?,?,?,?,?)`,
            [
              row.id,
              row.ciphertext,
              row.created_at,
              row.channel_id,
              row.garden_id,
              row.sender_id,
              row.message_type,
              row.nonce,
              'received'
            ]
          );
        } catch (e) {
          console.error('[MessageService] Failed to save realtime message locally:', e);
        }
        
        // Send the single new message
        callback([message]);
      }
    )
    .subscribe((status) => {
      console.log(`[MessageService] Supabase Realtime subscription status:`, status);
    });
  
  // Return unsubscribe function
  return () => {
    console.log('[MessageService] Unsubscribing from channel messages');
    subscription.unsubscribe();
  };
}

/**
 * Fetch and decrypt the group key for a specific channel
 * Gets garden_id from channel, then fetches key from memberships
 */
export async function getGroupKeyForChannel(channelId: string, userId: string): Promise<string | null> {
  console.log(`[MessageService] Getting group key for channel ${channelId}`);

  try {
    // 1. Get garden_id for the channel
    const { data: channel, error: channelError } = await supabase
      .from('channels')
      .select('garden_id')
      .eq('id', channelId)
      .single();
      
    if (channelError || !channel) {
      console.error('[MessageService] Failed to get garden_id for channel:', channelError);
      return null;
    }
    
    // 2. Get encrypted key from memberships
    const { data: membership, error: membershipError } = await supabase
      .from('memberships')
      .select('encrypted_group_key, user_id, garden_id')
      .eq('garden_id', channel.garden_id)
      .eq('user_id', userId)
      .single();
      
    if (membershipError || !membership) {
      console.error('[MessageService] Membership not found or missing key:', membershipError);
      return null;
    }
    
    console.log(`[MessageService] Found membership for garden ${membership.garden_id} and user ${membership.user_id}`);
    
    // Handle encrypted_group_key which may be stored as bytea in Postgres
    // but delivered as base64 in REST API
    if (!membership.encrypted_group_key) {
      console.error('[MessageService] Membership row is missing encrypted key data');
      return null;
    }

    if (typeof membership.encrypted_group_key === 'object') {
      console.log('[MessageService] Key appears to be binary data type:', typeof membership.encrypted_group_key);
    } else {
      console.log('[MessageService] Key appears to be string format, length:', 
        membership.encrypted_group_key.length,
        'sample:', membership.encrypted_group_key.slice(0, 10) + '...');
    }

    // Simplify: convert stored hex or base64 to raw bytes and decrypt directly
    const keyStr = membership.encrypted_group_key as string;
    let payloadBytes: Uint8Array;
    if (keyStr.startsWith('\\x')) {
      // Hex representation of ascii Base64 payload
      const hexBody = keyStr.slice(2);
      // Convert hex pairs to character codes, then to string
      const base64Str = hexBody.match(/.{1,2}/g)!
        .map(h => String.fromCharCode(parseInt(h, 16)))
        .join('');
      payloadBytes = decode(base64Str);
    } else {
      // Already base64
      payloadBytes = decode(keyStr);
    }
    
    // Fetch private key Base64
    const privateKeyBase64 = await getStoredPrivateKey();
    if (!privateKeyBase64) {
      console.error('[MessageService] No private key in SecureStore');
      return null;
    }
    
    // Decrypt the binary payload
    try {
      const plainKey = decryptGroupKeyFromBinary(payloadBytes, privateKeyBase64);
      console.log('[MessageService] Successfully decrypted group key');
      
      // Log a sample of the decrypted key for debugging
      if (plainKey) {
        console.log('[MessageService] Decrypted key format: base64 string, length:', 
          plainKey.length, 
          'sample:', plainKey.substring(0, 8) + '...' + plainKey.substring(plainKey.length - 8));
      }
      
      return plainKey;
    } catch (e) {
      console.error('[MessageService] Direct binary decryption failed:', e);
      return null;
    }
  } catch (e) {
    console.error('[MessageService] Error getting group key:', e);
    return null;
  }
}

/**
 * Delete a message by its ID
 */
export async function deleteMessage(messageId: string): Promise<void> {
  // 1. Delete from Supabase
  const { error } = await supabase
    .from('messages')
    .delete()
    .eq('id', messageId);
  if (error) throw error;
  
  // 2. Delete from local SQLite database
  try {
    const db = await SQLite.openDatabaseAsync('gardens.db');
    await db.execAsync(`DELETE FROM messages WHERE id = '${messageId}'`);
    console.log(`[MessageService] Deleted message ${messageId} from local database`);
  } catch (e) {
    console.error('[MessageService] Failed to delete message from local database:', e);
  }
} 