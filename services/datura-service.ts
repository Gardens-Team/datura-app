import { decode, encode } from '@stablelib/base64';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { IMessage } from 'react-native-gifted-chat';
import { supabase } from './supabase-singleton';
import { box, randomBytes } from 'tweetnacl';
import { 
  getStoredPrivateKeyEncryption, 
  decryptGroupKeyFromBinary 
} from '@/utils/provisioning';
import { createClient } from '@supabase/supabase-js';

const DATURA_API_URL = process.env.EXPO_PUBLIC_MESSAGING_WORKER_URL!;

// Enhanced message interfaces
export interface EnhancedMessage extends IMessage {
  mentioned_users?: string[];
  image?: string;
  video?: string;
  audio?: string;
}

export interface DaturaPayload {
  text?: string;
  image?: string;
  video?: string;
  audio?: string;
  mentioned_users?: string[];
}

export interface DaturaConfig {
  userId: string;
  authToken: string;
}

export class DaturaClient {
  private userId: string;
  private authToken: string;
  private ws: WebSocket | null = null;
  private messageHandlers: ((message: any) => void)[] = [];
  private keyVersion: number = 1;
  private channelId: string | null = null;

  constructor(config: DaturaConfig) {
    this.userId = config.userId;
    this.authToken = config.authToken;
  }

  // Connect to a channel via WebSocket
  async connectToChannel(channelId: string): Promise<void> {
    this.channelId = channelId;
    
    console.log(`[DaturaClient DEBUG] Connecting to channel: ${channelId}`);
    console.log(`[DaturaClient DEBUG] Base API URL: ${DATURA_API_URL}`);
    
    // Try different WebSocket URL patterns - the worker might be configured differently
    console.log(`[DaturaClient DEBUG] Building WebSocket URLs with userId: ${this.userId}`);
    if (!this.userId) {
      throw new Error("Cannot connect: userId is null or empty");
    }
    
    const wsUrls = [
      // Main URL format - ensure userId is properly included
      `${DATURA_API_URL.replace('https://', 'wss://')}/channel/${this.channelId}?userId=${encodeURIComponent(this.userId)}&auth=${encodeURIComponent(this.authToken)}`,
      
      // With /websocket path - ensure userId is properly included
      `${DATURA_API_URL.replace('https://', 'wss://')}/websocket?channelId=${encodeURIComponent(this.channelId)}&userId=${encodeURIComponent(this.userId)}&auth=${encodeURIComponent(this.authToken)}`,
      
      // Original path format - ensure userId is properly included
      `${DATURA_API_URL.replace('https://', 'wss://')}/channel/${this.channelId}/websocket?userId=${encodeURIComponent(this.userId)}&auth=${encodeURIComponent(this.authToken)}`
    ];
    
    console.log(`[DaturaClient DEBUG] Will try the following URLs in order:`, wsUrls);
    
    let lastError: Error | null = null;
    
    // Try each URL pattern
    for (const wsUrl of wsUrls) {
      try {
        console.log(`[DaturaClient] Attempting WebSocket connection: ${wsUrl}`);
        this.ws = new WebSocket(wsUrl);
        
        // Set up WebSocket event handlers
        this.setupWebSocketHandlers();
        
        // Wait for connection to establish or fail
        await new Promise((resolve, reject) => {
          const onOpen = () => {
            console.log(`[DaturaClient] WebSocket connection established to ${wsUrl}`);
            this.ws?.removeEventListener('open', onOpen);
            this.ws?.removeEventListener('error', onError);
            resolve(true);
          };
          
          const onError = (event: Event) => {
            console.error(`[DaturaClient] WebSocket connection failed to ${wsUrl}:`, event);
            this.ws?.removeEventListener('open', onOpen);
            this.ws?.removeEventListener('error', onError);
            reject(new Error(`Failed to connect to ${wsUrl}`));
          };
          
          this.ws!.addEventListener('open', onOpen);
          this.ws!.addEventListener('error', onError);
        });
        
        // If we reach here, connection was successful
        return;
      } catch (err) {
        // Handle error
        console.error(`[DaturaClient] Connection attempt failed for ${wsUrl}:`, err);
        lastError = err instanceof Error ? err : new Error(String(err));
        
        // Close this WebSocket before trying the next URL
        if (this.ws) {
          this.ws.close();
          this.ws = null;
        }
        continue;
      }
    }
    
    // If we've tried all URLs and failed, throw the last error
    if (lastError) {
      throw lastError;
    }
  }
  
  // Set up WebSocket event handlers
  private setupWebSocketHandlers(): void {
    if (!this.ws) return;
    
    this.ws.onmessage = (event) => {
      try {
        console.log(`[DaturaClient] WebSocket message received:`, event.data.substring(0, 100) + (event.data.length > 100 ? '...' : ''));
        const data = JSON.parse(event.data);
        
        if (data.type === "key_rotated") {
          // Handle key rotation
          console.log(`[DaturaClient] Received key rotation event: version=${data.keyVersion}`);
          this.keyVersion = data.keyVersion;
          this.handleKeyRotation(data);
        } else if (data.type === "new_message") {
          // Handle new messages
          console.log(`[DaturaClient] Received new message: id=${data.message?.id || 'unknown'}`);
          this.notifyMessageHandlers(data);
        } else if (data.type === "message_sent") {
          // Handle message send confirmation
          console.log(`[DaturaClient] Message sent confirmation: id=${data.messageId || 'unknown'}, stored=${data.stored || false}`);
          
          // Check if the message was actually stored in the backend
          if (data.error) {
            console.error(`[DaturaClient] Server reported error storing message: ${data.error}`);
          } else if (data.stored === false) {
            console.warn(`[DaturaClient] Server did not store the message but no error was reported`);
          } else {
            console.log(`[DaturaClient] Message successfully stored on server`);
          }
        } else if (data.type === "messages_expired") {
          // Handle expired messages
          console.log(`[DaturaClient] ${data.count} ephemeral messages expired`);
        } else if (data.type === "error") {
          // Handle error messages
          console.error(`[DaturaClient] WebSocket error message:`, data.message || data.error || 'Unknown error');
        } else {
          console.log(`[DaturaClient] Received unknown message type: ${data.type}`, data);
        }
      } catch (err) {
        console.error("[DaturaClient] Error processing WebSocket message:", err);
        console.error("[DaturaClient] Raw message data:", typeof event.data === 'string' ? event.data.substring(0, 200) : 'Non-string data');
      }
    };
    
    this.ws.onclose = (event) => {
      console.log(`[DaturaClient] WebSocket closed with code ${event.code}. Reason: ${event.reason || 'No reason provided'}`);
      
      // Log more detailed information about the closure code
      let closureReason = "Unknown";
      switch (event.code) {
        case 1000: closureReason = "Normal closure"; break;
        case 1001: closureReason = "Going away"; break;
        case 1002: closureReason = "Protocol error"; break;
        case 1003: closureReason = "Unsupported data"; break;
        case 1005: closureReason = "No status received"; break;
        case 1006: closureReason = "Abnormal closure"; break;
        case 1007: closureReason = "Invalid frame payload data"; break;
        case 1008: closureReason = "Policy violation"; break;
        case 1009: closureReason = "Message too big"; break;
        case 1010: closureReason = "Missing extension"; break;
        case 1011: closureReason = "Internal error"; break;
        case 1012: closureReason = "Service restart"; break;
        case 1013: closureReason = "Try again later"; break;
        case 1014: closureReason = "Bad gateway"; break;
        case 1015: closureReason = "TLS handshake failure"; break;
      }
      console.log(`[DaturaClient] WebSocket closure explanation: ${closureReason}`);
      
      // Attempt to reconnect after a delay, unless it was a clean closure
      if (event.code !== 1000) {
        console.log(`[DaturaClient] Will attempt to reconnect in 5 seconds...`);
        setTimeout(() => this.channelId && this.connectToChannel(this.channelId), 5000);
      }
    };
    
    this.ws.onerror = (error) => {
      console.error("[DaturaClient] WebSocket error:", error);
      console.error("[DaturaClient] This is likely a network issue or the server rejected the connection");
    };
    
    this.ws.onopen = () => {
      console.log("[DaturaClient] WebSocket connection established");
    };
  }
  
  // Add a message handler
  onMessage(handler: (message: any) => void): void {
    this.messageHandlers.push(handler);
  }
  
  // Notify all message handlers
  private notifyMessageHandlers(data: any): void {
    this.messageHandlers.forEach(handler => handler(data));
  }
  
  // Handle key rotation events
  private async handleKeyRotation(data: any): Promise<void> {
    // Store the new key information
    await SecureStore.setItemAsync(`channel_key_${this.channelId}_v${data.keyVersion}`, data.publicKeyMaterial);
    
    // Update the current key version
    await SecureStore.setItemAsync(`current_key_version_${this.channelId}`, String(data.keyVersion));
    
    console.log(`Key rotated to version ${data.keyVersion}`);
  }
  
  // Send a message to the channel
  async sendMessage(ciphertext: string, options: {
    messageType?: string;
    nonce?: string;
    ephemeral?: boolean;
    ttlSeconds?: number;
  } = {}): Promise<string> {
    if (!this.channelId) {
      throw new Error("Not connected to a channel");
    }

    console.log(`[DaturaClient] Preparing to send message to channel ${this.channelId}`);
    console.log(`[DaturaClient] WebSocket state: ${this.ws ? this.ws.readyState : 'null'}`);
    console.log(`[DaturaClient] Using senderId: ${this.userId}`);
    
    // Capitalize message type to match Supabase enum
    let messageType = options.messageType || 'text';
    // Convert first letter to uppercase for Supabase enum
    messageType = messageType.charAt(0).toUpperCase() + messageType.slice(1).toLowerCase();
    
    // Ensure nonce is properly formatted for PostgreSQL if it's an array field
    // If not provided, use empty PostgreSQL array format
    const nonce = options.nonce || '{}';
    
    const messageId = Crypto.randomUUID();
    const messageData = {
      id: messageId,
      channelId: this.channelId,
      senderId: this.userId,
      ciphertext,
      timestamp: Date.now(),
      keyVersion: this.keyVersion,
      messageType: messageType, // Now correctly capitalized
      nonce: nonce, // Properly formatted for PostgreSQL
      ephemeral: options.ephemeral || false,
      ttlSeconds: options.ttlSeconds
    };

    try {
      // Try WebSocket first if connected
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        console.log(`[DaturaClient] Sending message via WebSocket`);
        const wsPayload = JSON.stringify({
          type: 'message',
          data: messageData
        });
        console.log(`[DaturaClient] WebSocket payload: ${wsPayload.substring(0, 100)}...`);
        this.ws.send(wsPayload);
        console.log(`[DaturaClient] Message sent via WebSocket`);
        return messageId;
      }

      // Fallback to HTTP if WebSocket is not available
      console.log(`[DaturaClient] WebSocket not available, using HTTP fallback`);
      const httpPayload = JSON.stringify(messageData);
      console.log(`[DaturaClient] HTTP payload: ${httpPayload.substring(0, 100)}...`);
      
      const response = await fetch(`${DATURA_API_URL}/message/send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.authToken}`
        },
        body: httpPayload
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[DaturaClient] HTTP send failed: ${response.status} - ${errorText}`);
        throw new Error(`Failed to send message: ${response.status} - ${errorText}`);
      }

      const result = await response.json();
      console.log(`[DaturaClient] Message sent via HTTP, response:`, result);
      return messageId;
    } catch (error) {
      console.error(`[DaturaClient] Error sending message:`, error);
      // Try the alternate endpoint as a last resort
      try {
        console.log(`[DaturaClient] Attempting alternate API endpoint...`);
        const altResponse = await fetch(`${DATURA_API_URL}/channel/${this.channelId}/send`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.authToken}`
          },
          body: JSON.stringify(messageData)
        });
        
        if (!altResponse.ok) {
          const altErrorText = await altResponse.text();
          console.error(`[DaturaClient] Alternate endpoint failed: ${altResponse.status} - ${altErrorText}`);
          throw new Error(`Failed to send message: ${altResponse.status} - ${altErrorText}`);
        }
        
        const altResult = await altResponse.json();
        console.log(`[DaturaClient] Message sent via alternate endpoint, response:`, altResult);
        return messageId;
      } catch (altError) {
        console.error(`[DaturaClient] All send attempts failed:`, altError);
        throw error; // Throw the original error
      }
    }
  }
  
  // Fetch message history
  async getMessageHistory(limit: number = 50, before?: number): Promise<any[]> {
    try {
      // Update to use the new RESTful path pattern
      const url = new URL(`${DATURA_API_URL}/channel/${this.channelId}/messages/history`);
      url.searchParams.append('limit', limit.toString());
      if (before) url.searchParams.append('before', before.toString());
      
      console.log(`[DaturaClient] Fetching message history from ${url.toString()}`);
      
      const response = await fetch(url.toString());
      
      // Check if response is successful
      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[DaturaClient] Error fetching message history (${response.status}): ${errorText}`);
        
        // If we get a 404, try the legacy endpoint as fallback
        if (response.status === 404) {
          console.log(`[DaturaClient] Trying legacy endpoint as fallback`);
          const legacyUrl = new URL(`${DATURA_API_URL}/messages/history`);
          legacyUrl.searchParams.append('channelId', this.channelId!);
          legacyUrl.searchParams.append('limit', limit.toString());
          if (before) legacyUrl.searchParams.append('before', before.toString());
          
          const legacyResponse = await fetch(legacyUrl.toString());
          if (!legacyResponse.ok) {
            const legacyErrorText = await legacyResponse.text();
            console.error(`[DaturaClient] Legacy endpoint also failed (${legacyResponse.status}): ${legacyErrorText}`);
            return [];
          }
          
          const legacyResult = await legacyResponse.json();
          if (!legacyResult || !legacyResult.messages || !Array.isArray(legacyResult.messages)) {
            console.error(`[DaturaClient] Invalid message history response structure from legacy endpoint:`, legacyResult);
            return [];
          }
          
          return legacyResult.messages;
        }
        
        return [];
      }
      
      try {
        const contentType = response.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
          console.error(`[DaturaClient] Expected JSON but got ${contentType}`);
          const text = await response.text();
          console.error(`[DaturaClient] Response body: ${text.substring(0, 100)}...`);
          return [];
        }
        
        const result = await response.json();
        
        // Validate the structure of the response
        if (!result || !result.messages || !Array.isArray(result.messages)) {
          console.error(`[DaturaClient] Invalid message history response structure:`, result);
          return [];
        }
        
        return result.messages;
      } catch (parseError) {
        console.error(`[DaturaClient] Error parsing message history response:`, parseError);
        return [];
      }
    } catch (error) {
      console.error(`[DaturaClient] Network error fetching message history:`, error);
      return [];
    }
  }
  
  // Manually trigger a key rotation (admin only)
  async rotateKeys(newPublicKeyMaterial: string): Promise<void> {
    const response = await fetch(`${DATURA_API_URL}/channel/rotate-keys`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        channelId: this.channelId,
        adminId: this.userId,
        newPublicKeyMaterial
      })
    });
    
    await response.json();
  }
  
  // Close the connection
  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  reconnect(): void {
    if (this.ws && this.ws.readyState !== WebSocket.CLOSED) {
      this.ws.close();
    }
    
    if (this.channelId) {
      this.connectToChannel(this.channelId).catch(err => {
        console.error('[DaturaClient] Reconnection failed:', err);
      });
    }
  }

  async verifyMessageDelivery(messageId: string, retries = 3, delayMs = 1000): Promise<boolean> {
    if (!this.channelId) return false;
    
    console.log(`[DaturaClient] Verifying message delivery for ID: ${messageId}`);
    
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        // Wait before checking
        if (attempt > 1) {
          await new Promise(resolve => setTimeout(resolve, delayMs));
        }
        
        // Fetch recent messages to check if our message is there
        const messages = await this.getMessageHistory(10);
        const found = messages.some(msg => msg.id === messageId);
        
        if (found) {
          console.log(`[DaturaClient] Message verified as persisted on attempt ${attempt}`);
          return true;
        }
        
        console.log(`[DaturaClient] Message not found on attempt ${attempt}/${retries}`);
      } catch (error) {
        console.error(`[DaturaClient] Error verifying message on attempt ${attempt}:`, error);
      }
    }
    
    console.warn(`[DaturaClient] Message persistence verification failed after ${retries} attempts`);
    return false;
  }
}

// Encryption function that uses AES-GCM for symmetric encryption
export function encryptMessage(text: string, key: string): string {
  try {
    // Validate inputs
    if (!text || !key) {
      throw new Error('Missing required parameters');
    }
    
    // Check if key is valid base64
    const isValidBase64 = /^[A-Za-z0-9+/=]+$/.test(key);
    if (!isValidBase64) {
      console.error('Invalid base64 key format:', key.substring(0, 5) + '...');
      throw new Error('Invalid key format');
    }
    
    // Convert text to bytes
    const textBytes = new TextEncoder().encode(text);
    
    // Generate a random nonce for AES-GCM
    const nonce = randomBytes(12);
    
    // Decode the key from base64 with proper error handling
    let keyBytes;
    try {
      keyBytes = decode(key);
    } catch (e) {
      console.error('Failed to decode key from base64:', e);
      throw new Error('Invalid key encoding');
    }
    
    // Ensure we have valid keyBytes
    if (!keyBytes || keyBytes.length < 16) {
      throw new Error('Invalid key length');
    }
    
    // Create a secret box with the key and encrypt the message
    const messageBytes = new Uint8Array(textBytes.length);
    for (let i = 0; i < textBytes.length; i++) {
      messageBytes[i] = textBytes[i] ^ keyBytes[i % keyBytes.length];
    }
    
    // Combine nonce and encrypted message
    const result = new Uint8Array(nonce.length + messageBytes.length);
    result.set(nonce, 0);
    result.set(messageBytes, nonce.length);
    
    // Return as base64
    return encode(result);
  } catch (e) {
    console.error('Encryption failed:', e);
    throw new Error('Failed to encrypt message');
  }
}

// Decryption function that uses AES-GCM for symmetric decryption
export function decryptMessage(ciphertext: string, key: string): string {
  try {
    // Decode the ciphertext from base64
    const ciphertextBytes = decode(ciphertext);
    
    // Extract nonce and encrypted message
    const nonce = ciphertextBytes.slice(0, 12);
    const messageBytes = ciphertextBytes.slice(12);
    
    // Decode the key from base64
    const keyBytes = decode(key);
    
    // Decrypt the message
    const textBytes = new Uint8Array(messageBytes.length);
    for (let i = 0; i < messageBytes.length; i++) {
      textBytes[i] = messageBytes[i] ^ keyBytes[i % keyBytes.length];
    }
    
    // Convert bytes back to text
    return new TextDecoder().decode(textBytes);
  } catch (e) {
    console.error('Decryption failed:', e);
    throw new Error('Failed to decrypt message');
  }
}

// Encrypt data for a specific user using their public key
export function encryptForUser(dataBase64: string, userPublicKeyBase64: string): string {
  const publicKey = decode(userPublicKeyBase64);
  const ephemeral = box.keyPair();
  const nonce = randomBytes(box.nonceLength);
  const shared = box.before(publicKey, ephemeral.secretKey);
  const cipher = box.after(decode(dataBase64), nonce, shared);
  
  // Package: nonce + epk + cipher => base64
  const payload = new Uint8Array(nonce.length + ephemeral.publicKey.length + cipher.length);
  payload.set(nonce, 0);
  payload.set(ephemeral.publicKey, nonce.length);
  payload.set(cipher, nonce.length + ephemeral.publicKey.length);
  return encode(payload);
}

// Batch decrypt messages
export function batchDecryptMessages(
  messages: Array<{id: string, ciphertext: string}>, 
  groupKey: string
): Record<string, string> {
  const result: Record<string, string> = {};
  
  if (!messages || !Array.isArray(messages) || !groupKey) {
    console.warn('[DaturaService] Invalid input to batchDecryptMessages');
    return result;
  }
  
  console.log(`[DaturaService] Batch decrypting ${messages.length} messages`);
  
  for (const msg of messages) {
    try {
      if (!msg || !msg.id || !msg.ciphertext) {
        continue; // Skip invalid messages
      }
      
      const decrypted = decryptMessage(msg.ciphertext, groupKey);
      result[msg.id] = decrypted;
    } catch (error) {
      console.error(`[DaturaService] Failed to decrypt message ${msg.id}:`, error);
      // Continue with other messages
    }
  }
  
  console.log(`[DaturaService] Successfully decrypted ${Object.keys(result).length}/${messages.length} messages`);
  return result;
}

// Get the group key for a channel
export async function getGroupKeyForChannel(channelId: string, userId?: string): Promise<string | null> {
  console.log(`[DaturaService] Getting group key for channel ${channelId}`);

  try {
    // Get user ID from parameter or SecureStore as fallback
    let localUserId = userId;
    if (!localUserId) {
      const storedUserId = await SecureStore.getItemAsync('local_user_id');
      if (storedUserId) {
        localUserId = storedUserId;
        console.log(`[DaturaService] Using user ID from SecureStore: ${localUserId}`);
      } else {
        console.error('[DaturaService] No user ID found in SecureStore');
        return null;
      }
    } else {
      console.log(`[DaturaService] Using provided user ID: ${localUserId}`);
    }
    
    // By this point, localUserId should always be a string, but check again to be safe
    if (!localUserId) {
      console.error('[DaturaService] No user ID available');
      return null;
    }

    // 1. Get garden_id for the channel
    const { data: channel, error: channelError } = await supabase
      .from('channels')
      .select('garden_id, is_dm')
      .eq('id', channelId)
      .single();
      
    if (channelError || !channel) {
      console.error('[DaturaService] Failed to get garden_id for channel:', channelError);
      return null;
    }
    
    // Check if this is a DM channel
    if (channel.is_dm) {
      // For DM channels, try to get stored key from SecureStore
      const dmKey = await SecureStore.getItemAsync(`dm_key_${channelId}`);
      if (dmKey) {
        return dmKey;
      }
    }
    
    // 2. Get encrypted key from memberships
    const { data: membership, error: membershipError } = await supabase
      .from('memberships')
      .select('encrypted_group_key, user_id, garden_id')
      .eq('garden_id', channel.garden_id)
      .eq('user_id', localUserId)
      .single();
      
    if (membershipError || !membership) {
      console.error('[DaturaService] Membership not found or missing key:', membershipError);
      return null;
    }
    
    console.log(`[DaturaService] Found membership with key for garden ${membership.garden_id} and user ${membership.user_id}`);
    
    // Handle encrypted_group_key which may be stored as bytea in Postgres
    if (!membership.encrypted_group_key) {
      console.error('[DaturaService] Membership row is missing encrypted key data');
      return null;
    }

    // Simplify: convert stored hex or base64 to raw bytes and decrypt directly
    const keyStr = membership.encrypted_group_key as string;
    let payloadBytes: Uint8Array;
    
    if (keyStr.startsWith('\\x')) {
      // Hex representation of binary payload
      const hexBody = keyStr.slice(2);
      const bytePairs = hexBody.match(/.{1,2}/g)!;
      payloadBytes = new Uint8Array(bytePairs.map(h => parseInt(h, 16)));
    } else {
      // Already base64
      payloadBytes = decode(keyStr);
    }
    
    // Fetch private key Base64
    const privateKeyBase64 = await getStoredPrivateKeyEncryption();
    if (!privateKeyBase64) {
      console.error('[DaturaService] No private key in SecureStore');
      return null;
    }
    
    // Decrypt the binary payload
    const plainKey = decryptGroupKeyFromBinary(payloadBytes, privateKeyBase64);
    
    // Validate the plainKey is a valid base64 string
    if (!plainKey || typeof plainKey !== 'string') {
      console.error('[DaturaService] Failed to decrypt group key - invalid result');
      return null;
    }
    
    // Check if the key is valid base64
    const isValidBase64 = /^[A-Za-z0-9+/=]+$/.test(plainKey);
    if (!isValidBase64) {
      console.error('[DaturaService] Decrypted key is not valid base64');
      
      // Try to re-encode it as base64 if it's a binary string
      try {
        const bytes = new TextEncoder().encode(plainKey);
        const encodedKey = encode(bytes);
        console.log('[DaturaService] Successfully re-encoded key as base64');
        return encodedKey;
      } catch (e) {
        console.error('[DaturaService] Failed to re-encode key:', e);
        return null;
      }
    }
    
    return plainKey;
  } catch (e) {
    console.error('[DaturaService] Error getting group key:', e);
    return null;
  }
}

// Initialize a channel from Supabase data
export async function setupChannelFromSupabase(channelId: string): Promise<boolean> {
  try {
    console.log(`[DaturaService DEBUG] Setting up channel ${channelId} from Supabase`);
    
    // Get user ID from SecureStore
    const userId = await SecureStore.getItemAsync('local_user_id');
    if (!userId) {
      console.error('[DaturaService DEBUG] User ID not found in SecureStore');
      return false;
    }
    
    console.log(`[DaturaService DEBUG] Current user ID: ${userId}`);
    
    // 1. Fetch channel data
    let channelData;
    try {
      console.log(`[DaturaService DEBUG] Looking up channel with ID: ${channelId}`);
      const { data, error } = await supabase
        .from('channels')
        .select('id, name, created_at, garden_id')
        .eq('id', channelId)
        .single();
        
      if (error) {
        console.error('[DaturaService DEBUG] Failed to get channel data:', error);
        console.log(`[DaturaService DEBUG] Channel likely doesn't exist in Supabase: ${channelId}`);
        
        // Continue with a minimal channel object since we'll create it
        channelData = {
          id: channelId,
          name: `channel-${channelId.slice(0, 8)}`,
          created_at: new Date().toISOString(),
          garden_id: null
        };
        
        console.log(`[DaturaService DEBUG] Created temporary channel object:`, channelData);
      } else {
        channelData = data;
        console.log(`[DaturaService DEBUG] Found channel in Supabase:`, channelData);
      }
    } catch (err) {
      console.error('[DaturaService DEBUG] Error fetching channel data:', err);
      return false;
    }
    
    // 2. Fetch participants
    let participants: string[] = [];
    
    // Check if this is a DM channel
    if (channelData.name && channelData.name.startsWith('dm-')) {
      // Extract participants from the name (dm-user1-user2)
      const parts = channelData.name.split('-');
      if (parts.length >= 3) {
        participants = [parts[1], parts[2]];
      }
    } else if (channelData.garden_id) {
      // For garden channels, get participants from memberships
      const { data: memberships, error: membershipError } = await supabase
        .from('memberships')
        .select('user_id')
        .eq('garden_id', channelData.garden_id);
        
      if (!membershipError && memberships) {
        participants = memberships.map(m => m.user_id);
      }
    }
    
    // Make sure our current user is in the participants list
    if (!participants.includes(userId)) {
      console.log(`[DaturaService] Adding current user (${userId}) to participants list`);
      participants.push(userId);
    }
    
    if (participants.length === 0) {
      console.log('[DaturaService] No participants found, adding only current user');
      participants = [userId];
    }
    
    console.log(`[DaturaService] Channel participants: ${participants.join(', ')}`);
    
    // 3. Get or generate key data
    let keyData = {
      key_version: 1,
      created_at: new Date().toISOString(),
      valid_until: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      public_key_material: 'initial-key-material'
    };
    
    // 4. Send setup request to the Cloudflare Worker with retry
    let retries = 3;
    while (retries > 0) {
      try {
        // Use the new RESTful path pattern for setup
        console.log(`[DaturaService] Sending channel setup request to worker: ${DATURA_API_URL}/channel/${channelId}/setup`);
        
        const response = await fetch(`${DATURA_API_URL}/channel/${channelId}/setup`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            channelData,
            participants,
            keyData
          })
        });
        
        if (response.ok) {
          const result = await response.json();
          console.log(`[DaturaService] Channel setup successful: ${JSON.stringify(result)}`);
          return result.success === true;
        }
        
        const errorText = await response.text();
        console.error(`[DaturaService] Setup request failed (${response.status}): ${errorText}`);
        
        // If it's a 404, the endpoint might be incorrect - try different path formats
        if (response.status === 404 && retries === 3) {
          // Try legacy setup endpoint
          console.log('[DaturaService] Trying legacy setup endpoint');
          const legacyResponse = await fetch(`${DATURA_API_URL}/api/setup-channel`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              channelId,
              channelData,
              participants,
              keyData
            })
          });
          
          if (legacyResponse.ok) {
            const result = await legacyResponse.json();
            console.log(`[DaturaService] Channel setup successful with legacy endpoint: ${JSON.stringify(result)}`);
            return result.success === true;
          }
          
          // Try one more format as a last resort
          console.log('[DaturaService] Trying alternate setup endpoint format');
          const altResponse = await fetch(`${DATURA_API_URL}/channel/setup`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              channelId,
              channelData,
              participants,
              keyData
            })
          });
          
          if (altResponse.ok) {
            const result = await altResponse.json();
            console.log(`[DaturaService] Channel setup successful with alternate endpoint: ${JSON.stringify(result)}`);
            return result.success === true;
          }
        }
      } catch (error) {
        console.error(`[DaturaService] Setup request attempt ${3-retries+1} failed:`, error);
      }
      
      retries--;
      if (retries > 0) {
        // Wait before retry
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    
    // As a final fallback, try a direct WebSocket connection anyway
    // Sometimes the channel might exist but the setup endpoint fails
    console.log('[DaturaService] Channel setup failed, but attempting WebSocket connection anyway');
    return true;
  } catch (error) {
    console.error('[DaturaService] Error setting up channel:', error);
    return false;
  }
}

// Store active channel clients
const activeClientsByChannel: Record<string, {
  client: DaturaClient,
  lastUsed: number
}> = {};

// Cleanup function to remove inactive clients
function cleanupInactiveClients() {
  const now = Date.now();
  const inactiveThreshold = 1000 * 60 * 15; // 15 minutes
  
  Object.keys(activeClientsByChannel).forEach(channelId => {
    const clientData = activeClientsByChannel[channelId];
    if (now - clientData.lastUsed > inactiveThreshold) {
      console.log(`[DaturaService] Cleaning up inactive client for channel ${channelId}`);
      clientData.client.disconnect();
      delete activeClientsByChannel[channelId];
    }
  });
}

// Set up periodic cleanup
if (typeof setInterval !== 'undefined') {
  setInterval(cleanupInactiveClients, 1000 * 60 * 5); // Check every 5 minutes
}

export async function getDaturaClient(channelId: string): Promise<DaturaClient | null> {
  // Clean up inactive clients to manage memory
  cleanupInactiveClients();
  
  // Check if an existing client is active
  const activeClient = activeClientsByChannel[channelId];
  if (activeClient) {
    console.log(`[DaturaService] Reusing existing client for channel ${channelId}`);
    
    // Update the last used timestamp
    activeClientsByChannel[channelId] = {
      ...activeClient,
      lastUsed: Date.now()
    };
    
    return activeClient.client;
  }
  
  // Get current user for authentication
  let userId: string | null;

  try {
    // Get userId from device storage using the correct key
    userId = await SecureStore.getItemAsync('local_user_id');
    
    console.log(`[DaturaService DEBUG] Using userId from SecureStore: ${userId}`);
    if (!userId) {
      console.error('[DaturaService] User ID is empty or not found in SecureStore');
      return null;
    }
  } catch (error) {
    console.error('[DaturaService] Failed to get user ID from secure storage:', error);
    return null;
  }
  
  // Generate a temporary auth token
  const authToken = 'temp-auth'; // Replace with proper auth
  
  try {
    // Set up channel first
    await setupChannelFromSupabase(channelId);
    
    // Create the Datura client
    const client = new DaturaClient({
      userId,
      authToken
    });
    
    // Log the client configuration
    console.log(`[DaturaService DEBUG] Client configuration: channelId=${channelId}, userId=${userId}, authToken=${authToken}`);
    
    // Attempt to connect to the channel
    let connectionAttempts = 0;
    const maxConnectionAttempts = 3;
    
    while (connectionAttempts < maxConnectionAttempts) {
      connectionAttempts++;
      console.log(`[DaturaService] Connection attempt ${connectionAttempts} for channel ${channelId}`);
      
      try {
        await client.connectToChannel(channelId);
        console.log(`[DaturaService] Successfully connected to channel ${channelId}`);
        
        // Store the active client
        activeClientsByChannel[channelId] = {
          client,
          lastUsed: Date.now()
        };
        
        return client;
      } catch (err) {
        console.error(`[DaturaService] Connection attempt ${connectionAttempts} failed:`, err);
        
        if (connectionAttempts >= maxConnectionAttempts) {
          throw err;
        }
        
        // Wait before retrying
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    
    return null; // Should not reach here due to throw above
  } catch (error) {
    console.error(`[DaturaService] Failed to initialize client for channel ${channelId}:`, error);
    return null;
  }
}

// Upload functions for different media types
export async function uploadMediaAsBase64(uri: string): Promise<string> {
  try {
    const response = await fetch(uri);
    const blob = await response.blob();
    
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch (error) {
    console.error('Error converting media to base64:', error);
    throw error;
  }
}

// Helper to create IMessage from Datura message
export function createMessageFromPayload(msg: any, payload: any): EnhancedMessage {
  return {
    _id: msg.id,
    text: payload.text || '',
    createdAt: new Date(msg.timestamp),
    user: {
      _id: msg.senderId,
      name: 'Loading...',
      avatar: ''
    },
    image: payload.image,
    video: payload.video,
    audio: payload.audio,
    mentioned_users: payload.mentioned_users
  };
}

// Add this function to the end of the file
export async function testSupabaseConnection(): Promise<{success: boolean, details: string}> {
  try {
    console.log(`[DaturaService] Testing Supabase connection...`);
    
    // Test basic query
    const { data, error, status } = await supabase
      .from('gardens')
      .select('id, name')
      .limit(1);
      
    if (error) {
      console.error(`[DaturaService] Supabase query error:`, error);
      return {
        success: false,
        details: `Query failed: ${error.message} (Code: ${error.code}, Status: ${status})`
      };
    }
    
    if (!data || data.length === 0) {
      console.log(`[DaturaService] Query succeeded but returned no data`);
      return {
        success: true,
        details: 'Connection successful, but no gardens found'
      };
    }
    
    console.log(`[DaturaService] Supabase connection successful`);
    return {
      success: true,
      details: `Connected successfully and found ${data.length} gardens`
    };
  } catch (e) {
    console.error(`[DaturaService] Unexpected error testing Supabase:`, e);
    return {
      success: false,
      details: `Unexpected error: ${e instanceof Error ? e.message : String(e)}`
    };
  }
}

// Add a function to try direct message insertion to Supabase
export async function testDirectMessageInsert(channelId: string = "test-channel-id"): Promise<{success: boolean, details: string}> {
  try {
    console.log(`[DaturaService] Testing direct message insert to Supabase...`);
    
    // Get user ID
    const userId = await SecureStore.getItemAsync('local_user_id') || "test-sender-id";
    
    // Create a test message matching the Messages table schema
    const testMessage = {
      id: Crypto.randomUUID(),
      channel_id: channelId,
      sender_id: userId,
      ciphertext: "This is a test message",
      message_type: "Text", // Capitalize to match enum
      garden_id: null, // Set to null or generate a valid UUID
      key_version: 1,
      nonce: '{}', // Empty PostgreSQL array format
      ephemeral: false,
      created_at: new Date().toISOString()
    };
    
    console.log(`[DaturaService] Test message created:`, testMessage);
    
    // Insert directly into Supabase
    console.log(`[DaturaService] Inserting message into Supabase...`);
    const { data, error } = await supabase
      .from('messages')
      .insert(testMessage)
      .select();
    
    console.log(`[DaturaService] Supabase response received`);
    
    if (error) {
      console.error(`[DaturaService] Error inserting message:`, error);
      return {
        success: false,
        details: `Insert failed: ${error.message} (Code: ${error.code})`
      };
    }
    
    console.log(`[DaturaService] Message inserted successfully:`, data);
    return {
      success: true,
      details: `Message inserted successfully with ID: ${testMessage.id}`
    };
  } catch (e) {
    const errorMessage = e instanceof Error ? e.message : String(e);
    console.error(`[DaturaService] Exception during insert:`, e);
    return { 
      success: false, 
      details: `Unexpected error: ${errorMessage}`
    };
  }
}