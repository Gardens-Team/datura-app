// services/garden-service.ts
import { createClient } from '@supabase/supabase-js';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { generateAESSymmetricKey } from '@/utils/provisioning';
import { decode, encode } from '@stablelib/base64';
import { box, randomBytes } from 'tweetnacl';
import * as Crypto from 'expo-crypto';
import { decryptGroupKeyFromBinary, getStoredPrivateKey } from '@/utils/provisioning';
import * as LocalAuthentication from 'expo-local-authentication';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.EXPO_PUBLIC_SUPABASE_KEY!;

// Initialize a Supabase client instance.
const supabase = createClient(supabaseUrl, supabaseKey);

export interface Garden {
  id?: string;
  name: string;
  creatorId: string;
  groupKey: string;
  description?: string;
  tags?: string[];
  logo?: string;
}

export interface Membership {
  userId: string;
  gardenId: string;
  role: string;
  joinedAt: string;
  encryptedGroupKey: string;
}

export interface Channel {
  id?: string;
  garden_id: string;
  name: string;
  created_at?: string;
}

/**
 * Persists a new Garden to the `gardens` table.
 * Throws if Supabase returns an error.
 */
export async function createGarden({ name, creatorId, groupKey, description, tags, logo }: Garden) {
  const { data, error } = await supabase
    .from('gardens')
    .insert({
      name,
      creator: creatorId,
      description,
      tags,
      logo: logo,
      created_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Persists a new Garden to the `gardens` table.
 * Throws if Supabase returns an error.
 */
export async function createMembership({ userId, gardenId, role, joinedAt, encryptedGroupKey }: Membership) {
  const { data, error } = await supabase
    .from('memberships')
    .insert({
      user_id: userId,
      garden_id: gardenId,
      role,
      joined_at: joinedAt,
      encrypted_group_key: encryptedGroupKey,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

// Encrypt AES key with user's public key using X25519 + NaCl box
function encryptForUser(aesKeyBase64: string, userPublicKeyBase64: string): string {
  const publicKey = decode(userPublicKeyBase64);
  const ephemeral = box.keyPair();
  const nonce = randomBytes(box.nonceLength);
  const shared = box.before(publicKey, ephemeral.secretKey);
  const cipher = box.after(decode(aesKeyBase64), nonce, shared);
  // package: nonce + epk + cipher => base64
  const payload = new Uint8Array(nonce.length + ephemeral.publicKey.length + cipher.length);
  payload.set(nonce, 0);
  payload.set(ephemeral.publicKey, nonce.length);
  payload.set(cipher, nonce.length + ephemeral.publicKey.length);
  return encode(payload);
}

/**
 * Convenience: create a garden then immediately add creator as owner in memberships table.
 */
export async function createGardenWithMembership({ name, creatorId, description, tags, logo }: Omit<Garden, 'groupKey'>) {
  // generate AES key for the garden
  const aesKey = await generateAESSymmetricKey();

  // fetch creator's public key
  const { data: userRow, error: userError } = await supabase
    .from('users')
    .select('public_key')
    .eq('id', creatorId)
    .single();

  if (userError || !userRow?.public_key) throw userError || new Error('Public key not found');

  const encryptedKey = encryptForUser(aesKey, userRow.public_key as string);

  const garden = await createGarden({ name, creatorId, description, tags, logo, groupKey: aesKey });

  await createMembership({
    userId: creatorId,
    gardenId: garden.id,
    role: 'creator',
    joinedAt: new Date().toISOString(),
    encryptedGroupKey: encryptedKey,
  });

  // create general channel
  const channel = await createChannel({ garden_id: garden.id, name: 'general' });

  // update garden row with general_channel id
  await supabase.from('gardens').update({ general_channel: channel.id }).eq('id', garden.id);

  return { garden, channel };
}

/**
 * Returns all gardens that the given user belongs to.
 */
export async function getGardensByUser(userId: string): Promise<Garden[]> {
  // 1. fetch garden_ids from memberships
  const { data: membershipRows, error: membershipErr } = await supabase
    .from('memberships')
    .select('garden_id')
    .eq('user_id', userId);

  if (membershipErr) throw membershipErr;

  const gardenIds = (membershipRows ?? []).map((row: any) => row.garden_id);
  if (gardenIds.length === 0) return [];

  const { data: gardens, error: gardensErr } = await supabase
    .from('gardens')
    .select('*')
    .in('id', gardenIds);

  if (gardensErr) throw gardensErr;
  return gardens as Garden[];
}

export async function createChannel({ garden_id, name }: Channel) {
  const { data, error } = await supabase
    .from('channels')
    .insert({ garden_id, name, created_at: new Date().toISOString() })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function getChannelsByGarden(gardenId: string): Promise<Channel[]> {
  const { data, error } = await supabase
    .from('channels')
    .select('*')
    .eq('garden_id', gardenId);
  if (error) throw error;
  return data as Channel[];
}

/**
 * Handles the complete garden join flow:
 * 1. Fetches garden and group key details
 * 2. Encrypts the group key for the joining user
 * 3. Creates a membership in Supabase
 * 4. Creates local SQLite membership record
 * 5. Syncs all channels for the garden
 */
export async function joinGarden(gardenId: string, userId: string): Promise<void> {
  // 1️⃣ Fetch the creator's encrypted group key
  const { data: creatorMembership, error: cmErr } = await supabase
    .from('memberships')
    .select('encrypted_group_key')
    .eq('garden_id', gardenId)
    .eq('role', 'creator')
    .single();
  if (cmErr || !creatorMembership?.encrypted_group_key) {
    throw cmErr || new Error('Unable to retrieve encrypted group key');
  }

  // 2️⃣ Decrypt the group key using the current user's private key
  const privateKeyBase64 = await getStoredPrivateKey();
  if (!privateKeyBase64) {
    throw new Error('Missing private key for decryption');
  }
  const encryptedPayload = creatorMembership.encrypted_group_key as string;

  // Parse the database payload: hex-encoded or base64
  let payloadBytes: Uint8Array;
  if (encryptedPayload.startsWith('\\x')) {
    const hexBody = encryptedPayload.slice(2);
    const bytePairs = hexBody.match(/.{1,2}/g)!;
    payloadBytes = new Uint8Array(bytePairs.map(h => parseInt(h, 16)));
  } else {
    payloadBytes = decode(encryptedPayload);
  }
  const aesKeyBase64 = decryptGroupKeyFromBinary(payloadBytes, privateKeyBase64);

  // 3️⃣ Fetch joining user's public key
  const { data: userRow, error: urErr } = await supabase
    .from('users')
    .select('public_key')
    .eq('id', userId)
    .single();
  if (urErr || !userRow?.public_key) {
    throw urErr || new Error('Cannot fetch user public key');
  }
  const newEncryptedKey = encryptForUser(aesKeyBase64, userRow.public_key as string);

  // 4️⃣ Create membership with encrypted key
  await createMembership({
    userId,
    gardenId,
    role: 'member',
    joinedAt: new Date().toISOString(),
    encryptedGroupKey: newEncryptedKey,
  });
}

/**
 * Get the group key for the creator of a garden
 */
export async function getGroupKeyForGarden(gardenId: string): Promise<string> {
  const { data, error } = await supabase
    .from('memberships')
    .select('encrypted_group_key')
    .eq('garden_id', gardenId)
    .eq('role', 'creator')
    .single();
  if (error) throw error;
  return data.encrypted_group_key as string;
}

/**
 * Retrieves an invite record by token.
 */
export async function getInviteByToken(token: string) {
  const { data, error } = await supabase
    .from('invites')
    .select('*')
    .eq('token', token)
    .single();
  if (error || !data) throw error || new Error('Invite not found');
  return data;
}

export async function acceptInvite(token: string, userId: string): Promise<string> {
  // Fetch the invite record
  const invite = await getInviteByToken(token);
  // Mark as used
  await supabase
    .from('invites')
    .update({ used_by: userId, used_at: new Date().toISOString() })
    .eq('token', token);
  // Join the garden
  await joinGarden(invite.garden_id, userId);
  return invite.garden_id;
}

/**
 * Enable biometrics requirement for a garden membership
 */
export async function enableGardenBiometrics(gardenId: string, userId: string): Promise<void> {
  const { error } = await supabase
    .from('memberships')
    .update({ biometrics_enabled: true })
    .match({ garden_id: gardenId, user_id: userId });
  if (error) throw error;
}

/**
 * Set or update a passcode for a garden membership
 */
export async function setGardenPasscode(
  gardenId: string,
  userId: string,
  passcode: string
): Promise<void> {
  // Hash the passcode with SHA-256
  const hash = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    passcode
  );
  const { error } = await supabase
    .from('memberships')
    .update({ passcode_hash: hash })
    .match({ garden_id: gardenId, user_id: userId });
  if (error) throw error;
}

/**
 * Prompt device biometrics for unlocking a garden
 */
export async function authenticateForGarden(gardenId: string): Promise<boolean> {
  const hasHardware = await LocalAuthentication.hasHardwareAsync();
  if (!hasHardware) return false;
  const result = await LocalAuthentication.authenticateAsync({
    promptMessage: 'Unlock garden',
  });
  return result.success;
}

/**
 * Verify passcode against stored hash for a membership
 */
export async function verifyGardenPasscode(
  gardenId: string,
  userId: string,
  passcode: string
): Promise<boolean> {
  const { data, error } = await supabase
    .from('memberships')
    .select('passcode_hash')
    .match({ garden_id: gardenId, user_id: userId })
    .single();
  if (error || !data?.passcode_hash) return false;
  const hash = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    passcode
  );
  return data.passcode_hash === hash;
}
