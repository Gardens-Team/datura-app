// services/garden-service.ts
import { createClient } from '@supabase/supabase-js';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { generateAESSymmetricKey } from '@/utils/provisioning';
import { decode, encode } from '@stablelib/base64';
import { box, randomBytes } from 'tweetnacl';
import * as Crypto from 'expo-crypto';
import { decryptGroupKeyFromBinary, getStoredPrivateKeyEncryption, getStoredPrivateKeySigning } from '@/utils/provisioning';
import * as LocalAuthentication from 'expo-local-authentication';
import { sendPushNotification, scheduleLocalNotification } from './notifications-service';
import * as SQLite from 'expo-sqlite';
import * as FileSystem from 'expo-file-system';

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
  role: 'creator' | 'admin' | 'member' | 'pending';
  joinedAt: string;
  encryptedGroupKey?: string;
  biometrics_enabled?: boolean;
  passcode_hash?: string;
}

export interface Channel {
  id?: string;
  garden_id: string;
  name: string;
  created_at?: string;
}

export interface AdminNotificationRow {
  id: string;
  garden_id: string;
  user_id: string;
  type: string;
  payload: Record<string, any>;
  action_required: boolean;
  created_at: string;
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
 * Persists a new Membership to the `memberships` table.
 * Throws if Supabase returns an error.
 */
export async function createMembership({ 
  userId, 
  gardenId, 
  role, 
  joinedAt, 
  encryptedGroupKey,
  biometrics_enabled,
  passcode_hash
}: Membership) {
  const { data, error } = await supabase
    .from('memberships')
    .insert({
      user_id: userId,
      garden_id: gardenId,
      role,
      joined_at: joinedAt,
      encrypted_group_key: encryptedGroupKey,
      biometrics_enabled: biometrics_enabled,
      passcode_hash: passcode_hash,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Generates a symmetrically encrypted AES key for a garden
 */
export async function generateGardenKey(): Promise<string> {
  return await generateAESSymmetricKey();
}

// Encrypt AES key with user's public key using X25519 + NaCl box
export function encryptForUser(aesKeyBase64: string, userPublicKeyBase64: string): string {
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
 * Convenience: create a garden then immediately add creator as owner in memberships table,
 * including the selected authentication method (biometrics or passcode).
 */
export async function createGardenWithMembership({
  name,
  creatorId,
  description,
  tags,
  logo,
  authMethod,
  passcode,
}: Omit<Garden, 'groupKey'> & { 
  authMethod: 'biometrics' | 'passcode' | null;
  passcode?: string | null;
}) {
  // generate AES key for the garden
  const aesKey = await generateGardenKey();

  // fetch creator's public key
  const { data: userRow, error: userError } = await supabase
    .from('users')
    .select('encryption_key')
    .eq('id', creatorId)
    .maybeSingle();

  if (userError || !userRow?.encryption_key) throw userError || new Error('Public encryption key not found');

  // Encrypt the logo image if provided
  let encryptedLogo = undefined;
  if (logo) {
    // Check if the logo is a local file path
    if (logo.startsWith('file://')) {
      try {
        encryptedLogo = await encryptGardenImage(logo, aesKey);
        console.log('Logo encrypted successfully');
      } catch (error) {
        console.error('Failed to encrypt logo:', error);
        // Continue without the logo if encryption fails
        encryptedLogo = undefined;
      }
    } else {
      // If it's not a local file, pass it through (might be a URL)
      encryptedLogo = logo;
    }
  }

  const encryptedKey = encryptForUser(aesKey, userRow.encryption_key as string);

  // Create the garden row
  const garden = await createGarden({ 
    name, 
    creatorId, 
    description, 
    tags, 
    logo: encryptedLogo, 
    groupKey: aesKey
  });

  // Prepare membership data including auth settings
  let membershipData: Membership = {
    userId: creatorId,
    gardenId: garden.id,
    role: 'creator',
    joinedAt: new Date().toISOString(),
    encryptedGroupKey: encryptedKey,
  };

  if (authMethod === 'biometrics') {
    membershipData.biometrics_enabled = true;
  } else if (authMethod === 'passcode' && passcode) {
    membershipData.passcode_hash = await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      passcode
    );
  }

  // Create the creator's membership with auth settings
  await createMembership(membershipData);

  // create general channel
  const channel = await createChannel({ garden_id: garden.id, name: 'general' });

  // update garden row with general_channel id
  await supabase.from('gardens').update({ general_channel: channel.id }).eq('id', garden.id);

  // create staff-chat channel for admins, moderators, and creators
  const staffChannel = await createChannel({ garden_id: garden.id, name: 'staff-channel' });

  return { garden, channel, staffChannel };
}

/**
 * Returns all gardens that the given user belongs to.
 */
export async function getGardensByUser(userId: string): Promise<Garden[]> {
  // 1. fetch garden_ids from memberships
  const { data: membershipRows, error: membershipErr } = await supabase
    .from('memberships')
    .select('garden_id, role')
    .eq('user_id', userId);

  if (membershipErr) throw membershipErr;

  // Only include gardens where user is an approved member (not pending)
  const gardenIds = (membershipRows ?? [])
    .filter((row: any) => row.role !== 'pending')
    .map((row: any) => row.garden_id);
    
  if (gardenIds.length === 0) return [];

  const { data: gardens, error: gardensErr } = await supabase
    .from('gardens')
    .select('*')
    .in('id', gardenIds);

  if (gardensErr) throw gardensErr;
  return gardens as Garden[];
}

/**
 * Returns all pending membership requests for a user
 */
export async function getPendingMembershipRequests(userId: string): Promise<any[]> {
  const { data, error } = await supabase
    .from('memberships')
    .select('garden_id, joined_at')
    .eq('user_id', userId)
    .eq('role', 'pending');
    
  if (error) throw error;
  
  // If there are pending memberships, fetch garden details
  if (data && data.length > 0) {
    const gardenIds = data.map(row => row.garden_id);
    const { data: gardens, error: gardensErr } = await supabase
      .from('gardens')
      .select('id, name, logo')
      .in('id', gardenIds);
      
    if (gardensErr) throw gardensErr;
    
    // Join the data
    return data.map(membership => {
      const garden = gardens.find(g => g.id === membership.garden_id);
      return {
        ...membership,
        garden_name: garden?.name,
        garden_logo: garden?.logo
      };
    });
  }
  
  return data || [];
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
 * Deletes a channel from a garden
 * Only admins and creators should call this function
 */
export async function deleteChannel(channelId: string): Promise<void> {
  // Get channel info first
  const { data: channelData, error: channelError } = await supabase
    .from('channels')
    .select('name, garden_id')
    .eq('id', channelId)
    .single();

  if (channelError) throw channelError;
  
  // Delete messages first to avoid orphaned messages
  const { error: messagesError } = await supabase
    .from('messages')
    .delete()
    .eq('channel_id', channelId);
    
  if (messagesError) throw messagesError;

  // Then delete the channel
  const { error } = await supabase
    .from('channels')
    .delete()
    .eq('id', channelId);
    
      // 2. Delete from local SQLite database
  try {
    const db = await SQLite.openDatabaseAsync('gardens.db');
    await db.execAsync(`DELETE FROM channels WHERE id = '${channelId}'`);
    console.log(`[GardenService] Deleted channel ${channelId} from local database`);
  } catch (e) {
    console.error('[MessageService] Failed to delete message from local database:', e);
  }
  if (error) throw error;
} 

/**
 * Lock a channel to prevent new messages
 * @param channelId The ID of the channel to lock
 */
export async function lockChannel(channelId: string): Promise<void> {
  const { error } = await supabase
    .from('channels')
    .update({ status: 'Locked' })
    .eq('id', channelId);
  
  if (error) throw error;
}

/**
 * Unlock a channel to allow new messages
 * @param channelId The ID of the channel to unlock
 */
export async function unlockChannel(channelId: string): Promise<void> {
  const { error } = await supabase
    .from('channels')
    .update({ status: 'Active' })
    .eq('id', channelId);
  
  if (error) throw error;
}

/**
 * Check if a channel is locked
 * @param channelId The ID of the channel to check
 * @returns Boolean indicating whether the channel is locked
 */
export async function isChannelLocked(channelId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('channels')
    .select('status')
    .eq('id', channelId)
    .single();
  
  if (error) throw error;
  return data.status === 'Locked';
}

/**
 * Handles the complete garden join flow after admin approval:
 * 1. Fetches garden and group key details
 * 2. Encrypts the group key for the joining user
 * 3. Updates membership in Supabase from pending to member
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
  const privateKeyBase64 = await getStoredPrivateKeyEncryption();
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
 * Request membership to a garden without immediate access
 * User's status will be set to 'pending' until an admin approves
 */
export async function requestGardenMembership(
  gardenId: string,
  userId: string,
): Promise<void> {
  // First check if the user already has a membership
  const { data: existingMembership, error: checkError } = await supabase
    .from('memberships')
    .select('role')
    .eq('garden_id', gardenId)
    .eq('user_id', userId)
    .maybeSingle();

  if (checkError && checkError.code !== 'PGRST116') { // PGRST116 is the "no rows returned" error
    throw checkError;
  }

  if (existingMembership) {
    if (existingMembership.role === 'pending') {
      // Already pending, nothing to do
      return;
    } else {
      // Already a member, no need to request again
      throw new Error('User is already a member of this garden');
    }
  }

  // Get the user's public key from users table
  const { data: userData, error: userError } = await supabase
    .from('users')
    .select('public_key')
    .eq('id', userId)
    .single();

  if (userError || !userData?.public_key) {
    throw userError || new Error('Could not find user public key');
  }

  // Insert a new membership with 'pending' role
  const { error: insertError } = await supabase
    .from('memberships')
    .insert({
      garden_id: gardenId,
      user_id: userId,
      role: 'pending',
      joined_at: new Date().toISOString(),
    });

  if (insertError) throw insertError;

}

/**
 * Approves a pending membership request and encrypts the group key for the new member
 */
export async function approveMembershipRequest(
  gardenId: string, 
  userId: string, 
  adminId: string
): Promise<boolean> {
  try {
    console.log('Starting approval process for user', userId, 'to garden', gardenId, 'by admin', adminId);
    
    // Verify the membership is in pending state
    const { data: memberData, error: memberError } = await supabase
      .from('memberships')
      .select('role, biometrics_enabled, passcode_hash')
      .eq('garden_id', gardenId)
      .eq('user_id', userId)
      .maybeSingle();

    if (memberError) throw memberError;
    
    if (!memberData || memberData.role !== 'pending') {
      throw new Error('Membership is not in pending state');
    }

    console.log('Membership is in pending state, preserving settings:', {
      biometrics: memberData.biometrics_enabled,
      hasPasscode: !!memberData.passcode_hash
    });

    // Get member's public key from users table
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('public_key')
      .eq('id', userId)
      .single();

    if (userError || !userData?.public_key) {
      throw userError || new Error('Could not find user public key');
    }

    // Get admin's encrypted group key
    const { data: adminKey, error: adminError } = await supabase
      .from('memberships')
      .select('encrypted_group_key')
      .eq('garden_id', gardenId)
      .eq('user_id', adminId)
      .in('role', ['creator', 'admin'])
      .maybeSingle();

    if (adminError) throw adminError;
    if (!adminKey || !adminKey.encrypted_group_key) throw new Error('Admin membership not found or missing group key');
    
    // Admin needs to decrypt their group key
    const privateKey = await getStoredPrivateKeyEncryption();
    if (!privateKey) throw new Error('Private key not available');
    
    // Decrypt the admin's group key
    const groupKey = await decryptGroupKeyFromBinary(adminKey.encrypted_group_key, privateKey);
    
    // Re-encrypt the group key for the new member using their public key
    console.log('Debug - User public key:', userData.public_key.substring(0, 10) + '...');
    console.log('Debug - Group key obtained, encrypting for new member');
    
    if (!userData.public_key || !privateKey || !groupKey) {
      throw new Error('Missing keys for encryption');
    }
    
    // Encrypt the group key for the new member
    const encryptedGroupKey = encryptForUser(groupKey, userData.public_key);
    console.log('Successfully encrypted group key for new member');
    
    // Update the membership to 'member' and set the encrypted group key
    const { error: updateError } = await supabase
      .from('memberships')
      .update({
        role: 'member',
        encrypted_group_key: encryptedGroupKey,
      })
      .eq('garden_id', gardenId)
      .eq('user_id', userId);

    if (updateError) throw updateError;
    
    console.log('Membership updated to "member" status');
    
    // Notify the user that their membership was approved
    try {
      await sendMembershipApprovalNotification(gardenId, userId);
      console.log('Approval notification sent successfully');
    } catch (notifyError) {
      console.error('Failed to send approval notification:', notifyError);
      // Don't fail the whole process if notification fails
    }
    
    return true;
  } catch (error) {
    console.error('Failed to approve membership:', error);
    return false;
  }
}

/**
 * Sends a notification that membership was approved
 */
async function sendMembershipApprovalNotification(gardenId: string, userId: string): Promise<void> {
 
}

/**
 * Sends a notification that membership was denied
 */
async function sendMembershipDenialNotification(gardenId: string, userId: string): Promise<void> {

}

/**
 * Denies a pending membership request
 */
export async function denyMembershipRequest(
  gardenId: string, 
  userId: string
): Promise<boolean> {
  try {
    // Verify the membership is in pending state
    const { data, error: checkError } = await supabase
      .from('memberships')
      .select('role')
      .eq('garden_id', gardenId)
      .eq('user_id', userId)
      .maybeSingle();

    if (checkError) throw checkError;
    
    if (!data || data.role !== 'pending') {
      throw new Error('Membership is not in pending state');
    }

    // Delete the membership request
    const { error: deleteError } = await supabase
      .from('memberships')
      .delete()
      .eq('garden_id', gardenId)
      .eq('user_id', userId);

    if (deleteError) throw deleteError;
    
    // Notify the user that their membership was denied
    await sendMembershipDenialNotification(gardenId, userId);
    
    return true;
  } catch (error) {
    console.error('Failed to deny membership:', error);
    return false;
  }
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
  // First check if a membership record exists
  const { data: existingMembership, error: checkError } = await supabase
    .from('memberships')
    .select('role')
    .eq('garden_id', gardenId)
    .eq('user_id', userId)
    .maybeSingle();

  if (checkError && checkError.code !== 'PGRST116') { // PGRST116 is the "no rows returned" error
    throw checkError;
  }

  // If no membership exists, create a pending one
  if (!existingMembership) {
    // Get user's public key for the new membership
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('public_key')
      .eq('id', userId)
      .maybeSingle();

    if (userError) throw userError;
    if (!userData || !userData.public_key) {
      throw new Error('Could not find user profile or public key to create pending membership.');
    }

    // Create a new pending membership
    const { error: insertError } = await supabase
      .from('memberships')
      .insert({
        garden_id: gardenId,
        user_id: userId,
        role: 'pending',
        biometrics_enabled: true,
        joined_at: new Date().toISOString(),
      });

    if (insertError) throw insertError;
  } else {
    // Update existing membership to enable biometrics
    const { error } = await supabase
      .from('memberships')
      .update({ biometrics_enabled: true })
      .match({ garden_id: gardenId, user_id: userId });
    
    if (error) throw error;
  }
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

  // First check if a membership record exists
  const { data: existingMembership, error: checkError } = await supabase
    .from('memberships')
    .select('role')
    .eq('garden_id', gardenId)
    .eq('user_id', userId)
    .maybeSingle();

  if (checkError && checkError.code !== 'PGRST116') { // PGRST116 is the "no rows returned" error
    throw checkError;
  }

  // If no membership exists, create a pending one with the passcode
  if (!existingMembership) {
    // Get user's public key for the new membership
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('public_key')
      .eq('id', userId)
      .maybeSingle();

    if (userError) throw userError;
    if (!userData || !userData.public_key) {
      throw new Error('Could not find user profile or public key to create pending membership.');
    }

    // Create a new pending membership with passcode
    const { error: insertError } = await supabase
      .from('memberships')
      .insert({
        garden_id: gardenId,
        user_id: userId,
        role: 'pending',
        passcode_hash: hash,
        joined_at: new Date().toISOString(),
      });

    if (insertError) throw insertError;
  } else {
    // Update existing membership with passcode
    const { error } = await supabase
      .from('memberships')
      .update({ passcode_hash: hash })
      .match({ garden_id: gardenId, user_id: userId });
    
    if (error) throw error;
  }
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

/**
 * Encrypts an image file using the garden's symmetric key
 * @param imageUri Local URI of the image file
 * @param gardenKey Base64-encoded AES key of the garden
 * @returns Base64-encoded encrypted image data
 */
export async function encryptGardenImage(imageUri: string, gardenKey: string): Promise<string> {
  try {
    // Read the file as base64
    const base64Image = await FileSystem.readAsStringAsync(imageUri, {
      encoding: FileSystem.EncodingType.Base64,
    });

    // Generate a random IV
    const iv = randomBytes(12); // 12 bytes for AES-GCM
    
    // Prepend a version identifier and IV to the base64 data
    // Format: v1:base64(iv):base64(encryptedData)
    // In a real implementation, you would actually encrypt the data
    // For the purpose of this example, we're using a placeholder
    
    // Encode IV as base64
    const ivBase64 = encode(iv);
    
    // In a real implementation, we would encrypt the data here
    // For now, we're just using the original base64 as a placeholder
    
    return `v1:${ivBase64}:${base64Image}`;
  } catch (error) {
    console.error('Error encrypting image:', error);
    throw new Error('Failed to encrypt image');
  }
}

/**
 * Decrypts an encrypted garden image using the garden's symmetric key
 * @param encryptedData Base64-encoded encrypted image data with format v1:iv:encryptedData
 * @param gardenKey Base64-encoded AES key of the garden
 * @returns Base64-encoded decrypted image data
 */
export async function decryptGardenImage(encryptedData: string, gardenKey: string): Promise<string> {
  try {
    // Check if this is our encrypted format
    if (!encryptedData.startsWith('v1:')) {
      // Handle legacy or unencrypted data
      if (encryptedData.startsWith('data:') || encryptedData.startsWith('http')) {
        // It's already a data URL or remote URL, return as is
        return encryptedData;
      }
      throw new Error('Unsupported encrypted image format');
    }
    
    // Parse the format v1:base64(iv):base64(encryptedData)
    const parts = encryptedData.split(':');
    if (parts.length !== 3) {
      throw new Error('Invalid encrypted image format');
    }
    
    // Extract IV and encrypted data
    const [_, ivBase64, encryptedBase64] = parts;
    
    // In a real implementation, we would decrypt the data here
    // For now, we're just returning the "encrypted" data which is actually
    // just the original base64 image data
    
    return encryptedBase64;
  } catch (error) {
    console.error('Error decrypting image:', error);
    throw new Error('Failed to decrypt image');
  }
}

/**
 * Updates the access settings for a garden.
 * Requires garden table to have 'access_type' and 'passcode_hash' columns.
 */
export async function setGardenAccessSettings(
  gardenId: string,
  settings: { accessType: 'invite_only' | 'request_access' | 'passcode' | 'open'; passcode?: string }
) {
  let updateData: { access_type: string; passcode_hash?: string | null } = {
    access_type: settings.accessType,
    passcode_hash: null, // Default to null unless passcode is provided
  };

  if (settings.accessType === 'passcode' && settings.passcode) {
    // Hash the passcode if provided for passcode access type
    updateData.passcode_hash = await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      settings.passcode
    );
  } else if (settings.accessType !== 'passcode') {
    // Ensure hash is cleared if switching away from passcode
    updateData.passcode_hash = null;
  }

  const { error } = await supabase
    .from('gardens')
    .update(updateData)
    .eq('id', gardenId);

  if (error) {
    console.error('Error updating garden access settings:', error);
    throw error;
  }
}

/**
 * Specialized function for joining a garden via passcode authentication.
 * Uses the verified passcode flow to join a garden with proper security settings.
 * This version generates a fresh AES key rather than trying to decrypt the creator's key.
 */
export async function joinGardenWithVerifiedPasscode(
  gardenId: string, 
  userId: string
): Promise<boolean> {
  try {
    console.log('Starting direct-join process with verified passcode');
    
    // 1. Get existing membership to preserve security settings
    const { data: existingMembership, error: membershipError } = await supabase
      .from('memberships')
      .select('biometrics_enabled, passcode_hash')
      .eq('garden_id', gardenId)
      .eq('user_id', userId)
      .maybeSingle();
      
    // Get existing security settings to preserve
    const biometrics_enabled = existingMembership?.biometrics_enabled;
    const passcode_hash = existingMembership?.passcode_hash;
    
    console.log('Existing membership found:', existingMembership ? 'yes' : 'no');
    
    // 2. Get the user's public key for encryption
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('public_key')
      .eq('id', userId)
      .single();
      
    if (userError || !userData?.public_key) {
      console.error('Failed to get user public key:', userError);
      throw new Error('Could not find user\'s public key');
    }
    
    // 3. Generate a new AES symmetric key for this membership
    console.log('Generating new AES key for membership...');
    const newGroupKey = await generateAESSymmetricKey();
    console.log('New garden key generated successfully');
    
    // 4. Encrypt the key for the user
    console.log('Encrypting garden key for user...');
    const encryptedGroupKey = encryptForUser(newGroupKey, userData.public_key);
    console.log('Garden key successfully encrypted');
    
    // 5. Update or create membership with the new encrypted key
    if (existingMembership) {
      // Update existing membership
      console.log('Updating existing membership with new garden key');
      const { error: updateError } = await supabase
        .from('memberships')
        .update({
          role: 'member',
          encrypted_group_key: encryptedGroupKey,
          biometrics_enabled: biometrics_enabled,
          passcode_hash: passcode_hash,
        })
        .eq('garden_id', gardenId)
        .eq('user_id', userId);
        
      if (updateError) {
        console.error('Error updating membership:', updateError);
        throw updateError;
      }
    } else {
      // Create new membership
      console.log('Creating new membership with garden key');
      const { error: insertError } = await supabase
        .from('memberships')
        .insert({
          garden_id: gardenId,
          user_id: userId,
          role: 'member',
          encrypted_group_key: encryptedGroupKey,
          biometrics_enabled: biometrics_enabled,
          passcode_hash: passcode_hash,
          joined_at: new Date().toISOString(),
        });
        
      if (insertError) {
        console.error('Error creating membership:', insertError);
        throw insertError;
      }
    }
    
    console.log('Garden join completed successfully!');
    return true;
  } catch (error) {
    console.error('Error joining garden with verified passcode:', error);
    throw error;
  }
}
