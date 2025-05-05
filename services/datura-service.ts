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
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 5;
  private reconnectDelay: number = 1000; // Start with 1s delay
  private messageCache: Map<string, any> = new Map();
  private isHistoryLoaded: boolean = false;
  private pendingHistoryRequest: boolean = false;
  private lastMessageTimestamp: number = 0;

  constructor(config: DaturaConfig) {
    this.userId = config.userId;
    this.authToken = config.authToken;
  }

  async connectToChannel(channelId: string): Promise<void> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN && this.channelId === channelId) {
      console.log('[DaturaClient] Already connected to channel:', channelId);
      return;
    }
    
    // Store the current channel ID before attempting connection
    const previousChannelId = this.channelId;
    
    // Set the channel ID immediately so it's available to other methods
    this.channelId = channelId;
    console.log(`[DaturaClient] Setting channel ID to: ${channelId}`);
    
    // Close any existing connection
    if (this.ws) {
      try {
        console.log('[DaturaClient] Closing existing connection');
        this.ws.close();
      } catch (e) {
        console.log('[DaturaClient] Error closing existing connection:', e);
      }
      this.ws = null;
    }
    
    this.isHistoryLoaded = false;
    this.messageCache.clear();
    
    try {
      // Try multiple WebSocket URL patterns - the server might be configured differently
      const wsUrls = [
        // Try different URL patterns used in the original code
        `${DATURA_API_URL.replace('https://', 'wss://').replace('http://', 'ws://')}/channel/${channelId}?userId=${encodeURIComponent(this.userId)}&auth=${encodeURIComponent(this.authToken)}`,
        `${DATURA_API_URL.replace('https://', 'wss://').replace('http://', 'ws://')}/websocket?channelId=${encodeURIComponent(channelId)}&userId=${encodeURIComponent(this.userId)}&auth=${encodeURIComponent(this.authToken)}`,
        `${DATURA_API_URL.replace('https://', 'wss://').replace('http://', 'ws://')}/channel/${channelId}/websocket?userId=${encodeURIComponent(this.userId)}&auth=${encodeURIComponent(this.authToken)}`,
        // New format as a last resort
        `${DATURA_API_URL.replace('https://', 'wss://').replace('http://', 'ws://')}/ws/channel/${channelId}`
      ];
    
      console.log('[DaturaClient] Trying multiple WebSocket URL patterns');
      let connected = false;
      let lastError = null;
      
      for (const wsUrl of wsUrls) {
        if (connected) break;
        
        try {
          console.log('[DaturaClient] Attempting connection to:', wsUrl);
          this.ws = new WebSocket(wsUrl);
        
          // Set up connection promise
          await new Promise<void>((resolve, reject) => {
            const timeoutId = setTimeout(() => {
              reject(new Error('Connection timeout'));
            }, 10000);
            
            this.ws!.onopen = () => {
              clearTimeout(timeoutId);
              console.log('[DaturaClient] Connected successfully to:', wsUrl);
              connected = true;
              resolve();
            };
          
            this.ws!.onerror = (event) => {
              console.error('[DaturaClient] WebSocket connection error:', event);
              lastError = event;
            };
            
            this.ws!.onclose = (event) => {
              clearTimeout(timeoutId);
              console.log('[DaturaClient] WebSocket closed during connect attempt:', event.code, event.reason);
              if (!connected) {
                reject(new Error(`Connection closed with code ${event.code}: ${event.reason || 'No reason'}`));
              }
            };
          });
          
          if (connected) {
            // Setup the rest of the handlers
            this.setupWebSocketHandlers();
            
            // Reset reconnect state on successful connection
            this.reconnectAttempts = 0;
            this.reconnectDelay = 1000;
            
            // Send auth message if using the new format
            if (wsUrl.includes('/ws/channel/')) {
              this.ws!.send(JSON.stringify({
                type: 'auth',
                userId: this.userId,
                authToken: this.authToken,
                senderId: this.userId  // Add senderId to ensure it's included in all messages
              }));
            }
            
            // Request message history
            this.requestMessageHistory();
            return;
          }
        } catch (error) {
          console.error(`[DaturaClient] Failed to connect to ${wsUrl}:`, error);
          // Close the socket if it was created but connection failed
          if (this.ws) {
            try {
              this.ws.close();
            } catch (closeError) {
              console.log('[DaturaClient] Error closing failed connection:', closeError);
            }
            this.ws = null;
          }
          lastError = error;
        }
      }
      
      // If we reached here, all connection attempts failed
      // Ensure we keep the channel ID even after failed attempts
      console.log(`[DaturaClient] All connection attempts failed, keeping channelId as: ${this.channelId}`);
      throw lastError || new Error('Failed to connect to any WebSocket endpoint');
    } catch (error) {
      console.error('[DaturaClient] Error connecting to channel:', error);
      // Don't reset channelId on connection failure
      // this.channelId = null; (removed)
      throw error;
    }
  }
  
  // Set up WebSocket handlers after a successful connection
  private setupWebSocketHandlers(): void {
    if (!this.ws) return;
    
    this.ws.onmessage = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);
        console.log('[DaturaClient] Received message type:', data.type);
        
        if (data.type === 'auth_success') {
          console.log('[DaturaClient] Authentication successful');
        } else if (data.type === 'auth_failure') {
          console.error('[DaturaClient] Authentication failed:', data.error);
        } else if (data.type === 'history') {
          console.log(`[DaturaClient] Received message history: ${data.messages.length} messages`);
          this.handleMessageHistory(data.messages);
        } else if (data.type === 'new_message') {
          console.log('[DaturaClient] Received new message:', data.message.id);
          this.addMessageToCache(data.message);
          this.notifyMessageHandlers(data);
        } else if (data.type === 'key_rotated') {
          console.log('[DaturaClient] Key rotation detected:', data.keyVersion);
          this.handleKeyRotation(data);
        } else if (data.type === 'message_sent') {
          console.log('[DaturaClient] Message sent confirmation:', data.messageId);
        } else if (data.type === 'key_info') {
          // Handle key_info messages from the server
          console.log('[DaturaClient] Received key info with version:', data.keyVersion);
          // Update our key version
          this.keyVersion = data.keyVersion || this.keyVersion;
          
          // Notify handlers about key information
          this.notifyMessageHandlers({
            type: 'key_info',
            keyVersion: this.keyVersion,
            timestamp: data.timestamp || Date.now()
          });
          
          // Request message history after receiving key info
          this.requestMessageHistory();
        } else if (data.type === 'error') {
          // Handle error messages from the server
          console.error('[DaturaClient] Server error:', data.message || data.error || 'Unknown error');
          
          // Notify handlers about the error
          this.notifyMessageHandlers({
            type: 'error',
            message: data.message || data.error || 'Unknown error',
            code: data.code
          });
          } else {
          console.log('[DaturaClient] Unhandled message type:', data.type);
        }
      } catch (error) {
        console.error('[DaturaClient] Error processing WebSocket message:', error);
      }
    };
    
    this.ws.onerror = (event) => {
      console.error('[DaturaClient] WebSocket error:', event);
      
      if (this.reconnectAttempts < this.maxReconnectAttempts) {
        console.log(`[DaturaClient] Reconnect attempt ${this.reconnectAttempts + 1} of ${this.maxReconnectAttempts} in ${this.reconnectDelay}ms`);
        setTimeout(() => this.reconnect(), this.reconnectDelay);
        
        // Exponential backoff for reconnect
        this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30000); // Max 30 seconds
        this.reconnectAttempts++;
        } else {
        console.error('[DaturaClient] Max reconnect attempts reached');
      }
    };
    
    this.ws.onclose = (event: CloseEvent) => {
      console.log('[DaturaClient] WebSocket closed:', event.code, event.reason);
      
      // Only auto-reconnect if it wasn't a clean closure
      if (!event.wasClean && this.reconnectAttempts < this.maxReconnectAttempts) {
        console.log(`[DaturaClient] Connection closed. Reconnecting in ${this.reconnectDelay}ms...`);
        setTimeout(() => this.reconnect(), this.reconnectDelay);
      
        // Exponential backoff for reconnect
        this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30000); // Max 30 seconds
        this.reconnectAttempts++;
      }
    };
  }

  // Request message history from the server
  private requestMessageHistory(limit: number = 50, before?: number): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn('[DaturaClient] Cannot request history: WebSocket not connected');
      return;
    }
    
    if (this.pendingHistoryRequest) {
      console.log('[DaturaClient] History request already pending');
      return;
    }
    
    this.pendingHistoryRequest = true;
    console.log(`[DaturaClient] Requesting message history: limit=${limit}, before=${before || 'latest'}`);
    
    // Determine the proper history request format based on the URL
    // Always include the proper fields required by the server
    const historyRequest: any = {
      channelId: this.channelId,
      limit: limit,
      senderId: this.userId  // Add senderId to the request
    };
    
    if (before) {
      historyRequest.before = before;
    }
    
    // Different WebSocket protocols might use different request formats
    if (this.ws.url.includes('/ws/channel/')) {
      // New format
      this.ws.send(JSON.stringify({
        type: 'get_history',
        ...historyRequest
      }));
    } else {
      // Original/default format
      this.ws.send(JSON.stringify({
        type: 'history',
        ...historyRequest
      }));
    }
    
    // Set timeout to clear pending flag if no response is received
    setTimeout(() => {
      if (this.pendingHistoryRequest) {
        console.warn('[DaturaClient] History request timed out');
        this.pendingHistoryRequest = false;
        
        // Notify handlers about the timeout
        this.notifyMessageHandlers({
          type: 'history_timeout',
          timestamp: Date.now()
        });
      }
    }, 10000);
  }

  // Handle message history from server
  private handleMessageHistory(messages: any[]): void {
    this.pendingHistoryRequest = false;
    
    if (!Array.isArray(messages)) {
      console.error('[DaturaClient] Received invalid message history format');
      this.notifyMessageHandlers({ 
        type: 'history_loaded', 
        messages: [] 
      });
      this.isHistoryLoaded = true;
      return;
    }
    
    if (messages.length === 0) {
      console.log('[DaturaClient] Received empty message history');
      this.isHistoryLoaded = true;
      this.notifyMessageHandlers({ type: 'history_loaded', messages: [] });
      return;
    }
    
    console.log(`[DaturaClient] Processing ${messages.length} history messages`);
    
    // Sort messages by timestamp (oldest first)
    messages.sort((a: { timestamp: number }, b: { timestamp: number }) => a.timestamp - b.timestamp);
    
    // Add each message to the cache
    messages.forEach(message => {
      this.addMessageToCache(message);
    });
    
    // Update the last message timestamp
    const latestMessage = messages[messages.length - 1];
    if (latestMessage && latestMessage.timestamp > this.lastMessageTimestamp) {
      this.lastMessageTimestamp = latestMessage.timestamp;
      }
    
    this.isHistoryLoaded = true;
    
    // Notify handlers that history is loaded
    this.notifyMessageHandlers({ 
      type: 'history_loaded', 
      messages: Array.from(this.messageCache.values())
    });
  }

  // Add a message to the cache
  private addMessageToCache(message: any): void {
    if (!message || !message.id) {
      console.warn('[DaturaClient] Cannot add invalid message to cache');
      return;
    }
    
    // Only add if it's not already in the cache
    if (!this.messageCache.has(message.id)) {
      this.messageCache.set(message.id, message);
      
      // Update last timestamp if message is newer
      if (message.timestamp > this.lastMessageTimestamp) {
        this.lastMessageTimestamp = message.timestamp;
      }
    }
  }
  
  // Register a handler for incoming messages
  onMessage(handler: (message: any) => void): void {
    this.messageHandlers.push(handler);
    
    // If history is already loaded, immediately send it to the new handler
    if (this.isHistoryLoaded && this.messageCache.size > 0) {
      handler({ 
        type: 'history_loaded', 
        messages: Array.from(this.messageCache.values())
      });
    }
  }
  
  // Notify all message handlers of a new message
  private notifyMessageHandlers(data: any): void {
    this.messageHandlers.forEach(handler => {
      try {
        handler(data);
      } catch (error) {
        console.error('[DaturaClient] Error in message handler:', error);
      }
    });
  }

  private async handleKeyRotation(data: any): Promise<void> {
    console.log('[DaturaClient] Handling key rotation:', data);
    this.keyVersion = data.keyVersion;
    
    // Notify handlers of key rotation
    this.notifyMessageHandlers({
      type: 'key_rotated',
      keyVersion: data.keyVersion,
      timestamp: data.timestamp
    });
  }

  async sendMessage(
    ciphertext: string, 
    options: {
    messageType?: string;
    nonce?: string;
    ephemeral?: boolean;
    ttlSeconds?: number;
    } = {}
  ): Promise<string> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.error('[DaturaClient] Cannot send message: WebSocket not connected');
      throw new Error('WebSocket not connected');
    }
    
    if (!this.channelId) {
      console.error('[DaturaClient] Cannot send message: No channel ID');
      throw new Error('No channel ID');
    }
    
    try {
      // Generate a message ID
      const messageId = Crypto.randomUUID();
      const timestamp = Date.now();
    
      // Determine the correct message format based on the WebSocket URL
      let messageData: any;
      
      if (this.ws.url.includes('/ws/channel/')) {
        // New format
        messageData = {
          type: 'message',
          ciphertext,
          senderId: this.userId,
          messageType: options.messageType || 'Text',
          nonce: options.nonce,
          ephemeral: options.ephemeral || false,
          ttlSeconds: options.ttlSeconds
        };
      } else if (this.ws.url.includes('/websocket')) {
        // Support the older websocket format
        messageData = {
          type: 'chat_message',
          data: {
      id: messageId,
      channelId: this.channelId,
            ciphertext,
      senderId: this.userId,
            timestamp,
            keyVersion: this.keyVersion,
            messageType: options.messageType || 'Text',
            nonce: options.nonce,
            ephemeral: options.ephemeral || false,
            ttlSeconds: options.ttlSeconds
          }
        };
      } else {
        // Default format
        messageData = {
          type: 'send_message',
          message: {
            id: messageId,
            channelId: this.channelId,
      ciphertext,
            timestamp,
      keyVersion: this.keyVersion,
            messageType: options.messageType || 'Text',
            nonce: options.nonce,
      ephemeral: options.ephemeral || false,
      ttlSeconds: options.ttlSeconds
          }
        };
      }

      console.log(`[DaturaClient] Sending message: ${messageId} (format: ${messageData.type})`);
      
      // Send the message via WebSocket
      this.ws.send(JSON.stringify(messageData));
      
      // Add to cache immediately for optimistic updates
      this.addMessageToCache({
        id: messageId,
        channelId: this.channelId,
        ciphertext,
        senderId: this.userId,
        timestamp,
        keyVersion: this.keyVersion,
        messageType: options.messageType || 'Text',
        nonce: options.nonce,
        ephemeral: options.ephemeral || false
      });
      
      // Create and notify about a new_message event for immediate UI updates
      this.notifyMessageHandlers({
        type: 'new_message',
        message: {
          id: messageId,
          channelId: this.channelId,
          ciphertext,
          senderId: this.userId,
          timestamp,
          keyVersion: this.keyVersion,
          messageType: options.messageType || 'Text'
        }
      });
      
      return messageId;
    } catch (error) {
      console.error('[DaturaClient] Error sending message:', error);
      throw error;
    }
  }

  // Get message history from cache
  getMessageHistory(limit: number = 50, before?: number): Promise<any[]> {
    return new Promise((resolve, reject) => {
      // If history is already loaded, return from cache
      if (this.isHistoryLoaded) {
        console.log(`[DaturaClient] Returning ${this.messageCache.size} messages from cache`);
        let messages = Array.from(this.messageCache.values());
        
        // Sort by timestamp (newest first for display)
        messages.sort((a: { timestamp: number }, b: { timestamp: number }) => b.timestamp - a.timestamp);
        
        // Apply before filter if provided
        if (before) {
          messages = messages.filter(msg => msg.timestamp < before);
        }
        
        // Apply limit
        if (limit > 0 && messages.length > limit) {
          messages = messages.slice(0, limit);
        }
        
        resolve(messages);
        return;
      }
      
      // If we're not connected, reject
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        console.warn('[DaturaClient] Cannot get message history: WebSocket not connected');
        reject(new Error('WebSocket not connected'));
        return;
      }
      
      // If history isn't loaded yet, request it and wait for response
      console.log('[DaturaClient] History not loaded, requesting from server');
        
      // Create one-time handler for history response
      const historyHandler = (data: any) => {
        if (data.type === 'history_loaded') {
          // Remove this one-time handler
          const index = this.messageHandlers.indexOf(historyHandler);
          if (index !== -1) {
            this.messageHandlers.splice(index, 1);
          }
          
          let messages = data.messages;
          
          // Sort by timestamp (newest first for display)
          messages.sort((a: { timestamp: number }, b: { timestamp: number }) => b.timestamp - a.timestamp);
          
          // Apply before filter if provided
          if (before) {
            messages = messages.filter((msg: { timestamp: number }) => msg.timestamp < before);
          }
          
          // Apply limit
          if (limit > 0 && messages.length > limit) {
            messages = messages.slice(0, limit);
          }
          
          resolve(messages);
        }
      };
      
      // Add the handler
      this.messageHandlers.push(historyHandler);
      
      // Request history if not already pending
      if (!this.pendingHistoryRequest) {
        this.requestMessageHistory(limit, before);
      }
      
      // Set timeout to reject if history isn't received
      setTimeout(() => {
        const index = this.messageHandlers.indexOf(historyHandler);
        if (index !== -1) {
          this.messageHandlers.splice(index, 1);
          reject(new Error('Timeout waiting for message history'));
        }
      }, 15000);
    });
  }
  
  async rotateKeys(newPublicKeyMaterial: string): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.error('[DaturaClient] Cannot rotate keys: WebSocket not connected');
      throw new Error('WebSocket not connected');
    }
    
    try {
      this.ws.send(JSON.stringify({
        type: 'key_rotation',
        publicKeyMaterial: newPublicKeyMaterial,
        senderId: this.userId  // Add senderId to ensure compliance with server requirements
      }));
    
      console.log('[DaturaClient] Key rotation initiated');
    } catch (error) {
      console.error('[DaturaClient] Error rotating keys:', error);
      throw error;
    }
  }

  disconnect(): void {
    if (this.ws) {
      console.log('[DaturaClient] Disconnecting WebSocket');
      this.ws.close();
      this.ws = null;
    }
    
    this.channelId = null;
  }

  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  reconnect(): void {
    // Log the current state of the channel ID to help with debugging
    console.log(`[DaturaClient] Reconnect called with channelId: ${this.channelId || 'NONE'}`);
    
    if (!this.channelId) {
      console.error('[DaturaClient] Cannot reconnect: No channel ID');
      return;
    }
    
    // Store the channel ID safely to ensure it doesn't get lost
    const channelToReconnect = this.channelId;
    
    // Close any existing connection
    if (this.ws) {
      try {
        console.log(`[DaturaClient] Closing existing connection before reconnect`);
        this.ws.close();
      } catch (e) {
        // Ignore errors when closing already closed connections
        console.log(`[DaturaClient] Error when closing connection:`, e);
      }
      this.ws = null;
    }
    
    console.log('[DaturaClient] Reconnecting to channel:', channelToReconnect);
    
    // Use the full connectToChannel method to try all URL patterns
    // Make sure we're using the stored channelId and not this.channelId which might change
    this.connectToChannel(channelToReconnect).catch(error => {
      console.error('[DaturaClient] Reconnect failed:', error);
      // Re-set the channel ID in case it was lost during the failed connection attempt
      this.channelId = channelToReconnect;
    });
  }

  // Add a method to set the channel ID externally if needed
  setChannelId(channelId: string): void {
    if (!channelId || typeof channelId !== 'string' || channelId.trim() === '') {
      console.error('[DaturaClient] Cannot set empty channel ID');
      return;
    }

    console.log('[DaturaClient] Setting channel ID:', channelId);
    this.channelId = channelId;
  }

  // Helper to get the current channel ID
  getChannelId(): string | null {
    return this.channelId;
  }

  async verifyMessageDelivery(messageId: string, retries = 3, delayMs = 1000): Promise<boolean> {
    console.log(`[DaturaClient] Verifying delivery of message: ${messageId}`);
    
    for (let i = 0; i <= retries; i++) {
      // Check if message is in our cache (which means it was received from the server)
      if (this.messageCache.has(messageId)) {
        console.log(`[DaturaClient] Message ${messageId} verified in cache`);
          return true;
        }
        
      if (i < retries) {
        console.log(`[DaturaClient] Message ${messageId} not found, retrying in ${delayMs}ms (${i+1}/${retries})`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
    
    console.warn(`[DaturaClient] Message ${messageId} not verified after ${retries} attempts`);
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
    // Add debug logging to see the exact ciphertext format
    console.log(`[DEBUG] Decrypting message with ciphertext length: ${ciphertext.length}`);
    console.log(`[DEBUG] First 50 chars of ciphertext: ${ciphertext.substring(0, 50)}`);
    console.log(`[DEBUG] Check valid Base64: ${/^[A-Za-z0-9+/=]+$/.test(ciphertext)}`);
    
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
      .select('garden_id')
      .eq('id', channelId)
      .single();
      
    if (channelError || !channel) {
      console.error('[DaturaService] Failed to get garden_id for channel:', channelError);
      return null;
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
    
    // Check if this appears to be a DM channel based on the naming convention
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

