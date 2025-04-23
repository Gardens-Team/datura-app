import * as SQLite from 'expo-sqlite';
import { ShapeStream, Shape } from '@electric-sql/client';
import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';
import { decryptGroupKeyFromBinary, getStoredPrivateKey } from '@/utils/provisioning';
import { encode, decode } from '@stablelib/base64';
import { box } from 'tweetnacl';
import { supabase } from './supabase-singleton';

// --- ENV -------------------------------------------------------------------
const ELECTRIC_URL = process.env.EXPO_PUBLIC_ELECTRIC_URL as string; // e.g. http://localhost:3000

// --- TYPES -----------------------------------------------------------------
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
  [key: string]: any;
}

// --- INTERNAL STATE --------------------------------------------------------
let db: SQLite.SQLiteDatabase | null = null;
let shape: Shape | null = null;
let ready = false;

// --- INITIALISATION --------------------------------------------------------
export async function initSync() {
  if (ready) return;

  // 1️⃣ open / create local SQLite db
  db = await SQLite.openDatabaseAsync('gardens.db');
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
    
    CREATE TABLE IF NOT EXISTS channels (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      garden_id TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS memberships (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL,
      garden_id TEXT NOT NULL,
      passcode_hash TEXT,
      encrypted_group_key TEXT NOT NULL,
      biometrics_enabled INTEGER DEFAULT 0,
      created_at TEXT NOT NULL
    );
  `);

  // 2️⃣ create Electric ShapeStream (full table)
  const stream = new ShapeStream({
    url: `${ELECTRIC_URL}/v1/shape`,
    params: {
      table: 'messages',
      replica: 'full',
    },
  });

  shape = new Shape(stream);
  // Do not block on remote replication; mark ready immediately. Remote rows
  // will sync in background via Electric. This prevents UI from hanging when
  // offline or when the Electric server is unreachable.
  ready = true;
}

// --- HELPERS ----------------------------------------------------------------
/**
 * Create or update a channel in the local database 
 * Ensures channel data is available for query joins
 */
export async function ensureChannelExists(id: string, channelId: string, name: string, gardenId: string) {
  await initSync();
  
  try {
    // First check if already exists
    const existing = await db!.getFirstAsync<{id: string}>(
      'SELECT id FROM channels WHERE id = ?',
      [channelId]
    );
    
    if (!existing) {
      console.log(`[ElectricSQL] Adding channel ${channelId} to local DB`);
      await db!.runAsync(
        `INSERT INTO channels (id, name, garden_id, created_at)
         VALUES (?, ?, ?, ?)`,
        [
          channelId,
          name,
          gardenId,
          new Date().toISOString()
        ]
      );
    }
  } catch (e) {
    console.warn('[ElectricSQL] Error ensuring channel exists:', e);
  }
}

export async function insertMessage(row: MessageRow) {
  await initSync();
  await db!.runAsync(
    `INSERT INTO messages (id,ciphertext,created_at,channel_id,garden_id,sender_id,message_type,nonce,sync_status)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [ row.id, row.ciphertext, row.created_at, row.channel_id, row.garden_id, row.sender_id, row.message_type, row.nonce, row.sync_status ]
  );
  // Also persist to remote Supabase for true sync (skip seeded dev data)
  if (row.sync_status !== 'seeded') {
    try {
      // Validate UUIDs before insert
      if (!row.id || row.id.trim() === '') {
        console.warn('[ElectricSQL] Skipping remote insert - invalid message ID');
        return;
      }
      
      // Ensure garden_id is valid (if it's expected to be a UUID)
      if (!row.garden_id || row.garden_id.trim() === '') {
        console.warn('[ElectricSQL] Missing garden_id - setting to placeholder for remote insert');
        row.garden_id = '00000000-0000-0000-0000-000000000000';
      }
      
      const { error: remoteError } = await supabase
        .from('messages')
        .insert({
          id: row.id,
          ciphertext: row.ciphertext,
          created_at: row.created_at,
          channel_id: row.channel_id,
          garden_id: row.garden_id,
          sender_id: row.sender_id,
          message_type: row.message_type,
          nonce: row.nonce,
          sync_status: row.sync_status,
        });
      if (remoteError) console.error('[ElectricSQL] Remote persistence failed:', remoteError);
    } catch (e) {
      console.error('[ElectricSQL] Error pushing to Supabase:', e);
    }
  }
}

export async function getMessagesForChannel(channelId: string): Promise<MessageRow[]> {
  await initSync();
  
  // Check if we have any messages for this channel
  const existingCount = await db!.getFirstAsync<{count: number}>(
    'SELECT COUNT(*) as count FROM messages WHERE channel_id = ?',
    [channelId],
  );
  
  console.log(`[ElectricSQL] Channel ${channelId} has ${existingCount?.count || 0} messages`);
  
  // If empty and in development, seed with a welcome message
  if ((!existingCount || existingCount.count === 0) && Constants.expoConfig?.extra?.EXPO_PUBLIC_ENV === 'development') {
    console.log('[ElectricSQL] Adding welcome message to empty channel');
    const welcomeMsg = {
      id: `welcome-${Date.now()}`,
      ciphertext: 'V2VsY29tZSB0byB0aGUgY2hhbm5lbCE=', // base64 "Welcome to the channel!"
      created_at: new Date().toISOString(),
      channel_id: channelId,
      garden_id: '',
      sender_id: 'system',
      message_type: 'Text',
      nonce: null,
      sync_status: 'seeded',
    };
    await insertMessage(welcomeMsg);
  }
  
  // Get messages and return
  const messages = await db!.getAllAsync<MessageRow>(
    'SELECT * FROM messages WHERE channel_id = ? ORDER BY created_at DESC',
    [channelId],
  );
  console.log(`[ElectricSQL] Returning ${messages.length} messages`);
  return messages;
}

/**
 * Subscribe to live message updates for a channel.
 * Returns an unsubscribe callback.
 */
export async function subscribeMessages(
  channelId: string,
  cb: (rows: MessageRow[]) => void
): Promise<() => void> {
  await initSync();
  if (!shape) return () => {};
  const unsub = shape.subscribe(({ rows }) => {
    const filtered = (rows as MessageRow[]).filter(r => r.channel_id === channelId);
    cb(filtered);
  });
  return unsub;
}

// --- Group Key Management --------------------------------------------------
/**
 * Fetch and decrypt the group key for a specific channel
 * Gets garden_id from channel, then fetches key from memberships
 */
export async function getGroupKeyForChannel(channelId: string, userId: string): Promise<string | null> {
  await initSync();
  
  console.log(`[ElectricSQL] Getting group key for channel ${channelId}`);

  try {
    // 1. Get garden_id for the channel
    const { data: channel, error: channelError } = await supabase
      .from('channels')
      .select('garden_id')
      .eq('id', channelId)
      .single();
      
    if (channelError || !channel) {
      console.error('[ElectricSQL] Failed to get garden_id for channel:', channelError);
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
      console.error('[ElectricSQL] Membership not found or missing key:', membershipError);
      return null;
    }
    
    console.log(`[ElectricSQL] Found membership for garden ${membership.garden_id} and user ${membership.user_id}`);
    
    // Handle encrypted_group_key which may be stored as bytea in Postgres
    // but delivered as base64 in REST API
    if (!membership.encrypted_group_key) {
      console.error('[ElectricSQL] Membership row is missing encrypted key data');
      return null;
    }

    if (typeof membership.encrypted_group_key === 'object') {
      console.log('[ElectricSQL] Key appears to be binary data type:', typeof membership.encrypted_group_key);
    } else {
      console.log('[ElectricSQL] Key appears to be string format, length:', 
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
      console.error('[ElectricSQL] No private key in SecureStore');
      return null;
    }
    
    // Decrypt the binary payload
    try {
      const plainKey = decryptGroupKeyFromBinary(payloadBytes, privateKeyBase64);
      console.log('[ElectricSQL] Successfully decrypted group key');
      return plainKey;
    } catch (e) {
      console.error('[ElectricSQL] Direct binary decryption failed:', e);
      return null;
    }
  } catch (e) {
    console.error('[ElectricSQL] Error getting group key:', e);
    return null;
  }
}
