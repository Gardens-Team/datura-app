// services/garden-service.ts
import { createClient } from '@supabase/supabase-js';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { generateAESSymmetricKey } from '@/utils/provisioning';
import { decode, encode } from '@stablelib/base64';
import { box, randomBytes } from 'tweetnacl';
import * as Crypto from 'expo-crypto';
import { decryptGroupKeyFromBinary, getStoredPrivateKey } from '@/utils/provisioning';
import * as LocalAuthentication from 'expo-local-authentication';
import { sendPushNotification, scheduleLocalNotification } from './notifications-service';

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
 * Convenience: create a garden then immediately add creator as owner in memberships table.
 */
export async function createGardenWithMembership({ name, creatorId, description, tags, logo }: Omit<Garden, 'groupKey'>) {
  // generate AES key for the garden
  const aesKey = await generateGardenKey();

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

  // create admin channel for membership approvals and admin notifications
  const adminChannel = await createChannel({ garden_id: garden.id, name: 'admin-feed' });

  return { garden, channel };
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
 * Request membership to a garden without immediate access
 * User's status will be set to 'pending' until an admin approves
 */
export async function requestGardenMembership(
  gardenId: string,
  userId: string,
  publicKey: string,
): Promise<void> {
  // First check if the user already has a membership
  const { data: existingMembership, error: checkError } = await supabase
    .from('memberships')
    .select('role')
    .eq('garden_id', gardenId)
    .eq('user_id', userId)
    .single();

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

  // Insert a new membership with 'pending' role
  const { error: insertError } = await supabase
    .from('memberships')
    .insert({
      garden_id: gardenId,
      user_id: userId,
      role: 'pending',
      public_key: publicKey,
      joined_at: new Date().toISOString(),
    });

  if (insertError) throw insertError;

  // Notify admins about the new membership request
  await notifyAdminsAboutRequest(gardenId, userId);
}

/**
 * Notifies garden admins about new membership request
 */
async function notifyAdminsAboutRequest(gardenId: string, userId: string): Promise<void> {
  try {
    // Get the user's profile information
    const { data: userProfile, error: userError } = await supabase
      .from('users')
      .select('username, profile_pic')
      .eq('id', userId)
      .single();

    if (userError) throw userError;

    // Get all admins of the garden
    const { data: admins, error: adminsError } = await supabase
      .from('memberships')
      .select('user_id')
      .eq('garden_id', gardenId)
      .in('role', ['creator', 'admin']);

    if (adminsError) throw adminsError;

    // Get garden name for notification
    const { data: garden, error: gardenError } = await supabase
      .from('gardens')
      .select('name, creator')
      .eq('id', gardenId)
      .single();

    if (gardenError) throw gardenError;

    // Get admin feed channel ID
    const { data: adminChannel, error: channelError } = await supabase
      .from('channels')
      .select('id')
      .eq('garden_id', gardenId)
      .eq('name', 'Admin Feed')
      .single();

    if (channelError && channelError.code !== 'PGRST116') throw channelError;

    // If admin channel doesn't exist, create it
    let adminChannelId = adminChannel?.id;
    if (!adminChannelId) {
      const { data: newChannel, error: createError } = await supabase
        .from('channels')
        .insert({
          garden_id: gardenId,
          name: 'Admin Feed',
          description: 'Administrative notifications and approvals',
          created_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (createError) throw createError;
      adminChannelId = newChannel.id;
    }

    // Create a system message for the membership request
    const messageData = {
      type: 'membership_request',
      userId: userId,
      username: userProfile.username,
      profilePic: userProfile.profile_pic,
      timestamp: new Date().toISOString(),
      actionRequired: true,
      gardenId: gardenId,
    };

    // ----------------------------
    // 1️⃣ Persist notification rows for every admin/creator
    // ----------------------------
    const adminIds: string[] = admins.map(a => a.user_id);

    // Ensure garden creator also receives the notification
    if (garden?.creator && !adminIds.includes(garden.creator)) {
      adminIds.push(garden.creator);
    }

    const rows = adminIds.map(id => ({
      user_id: id,
      garden_id: gardenId,
      channel_id: adminChannelId,
      payload: JSON.stringify(messageData),
      type: 'membership_request',
      created_at: new Date().toISOString(),
    }));

    const { error: notifErr } = await supabase
      .from('notifications')
      .insert(rows);
    if (notifErr) throw notifErr;

    // ----------------------------
    // 2️⃣ Send push notifications to all admins/creator
    // ----------------------------
    const { data: adminProfiles } = await supabase
      .from('users')
      .select('push_tokens')
      .in('id', adminIds);

    const tokens = (adminProfiles || [])
      .flatMap((p: any) => p.push_tokens ?? [])
      .filter((t: string, idx: number, arr: string[]) => t && arr.indexOf(t) === idx);

    if (tokens.length > 0) {
      await sendPushNotification(
        tokens,
        'New Membership Request',
        `${userProfile.username} requested to join ${garden.name}`,
        { type: 'membership_request', gardenId }
      );
    }

  } catch (error) {
    console.error('Failed to notify admins:', error);
    // Don't throw here to prevent breaking the membership request flow
  }
}

/**
 * Sends a notification that membership was approved
 */
async function sendMembershipApprovalNotification(gardenId: string, userId: string): Promise<void> {
  try {
    // Get user's device tokens for push notifications
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('username, push_tokens')
      .eq('id', userId)
      .single();

    if (userError) throw userError;

    // Get garden info
    const { data: garden, error: gardenError } = await supabase
      .from('gardens')
      .select('name, creator')
      .eq('id', gardenId)
      .single();

    if (gardenError) throw gardenError;

    // Add notification to user's notifications table
    const { error: notificationError } = await supabase
      .from('notifications')
      .insert({
        user_id: userId,
        title: 'Membership Approved',
        body: `Your request to join ${garden.name} has been approved. You now have access to the garden.`,
        type: 'membership_approved',
        data: JSON.stringify({ gardenId, gardenName: garden.name }),
        created_at: new Date().toISOString(),
        read: false,
      });

    if (notificationError) throw notificationError;

    // If user has push tokens, send push notification
    if (user.push_tokens && user.push_tokens.length > 0) {
      // Send the push notification using our service
      await sendPushNotification(
        user.push_tokens,
        'Membership Approved',
        `Your request to join ${garden.name} has been approved.`,
        { type: 'membership_approved', gardenId }
      );
    } else {
      // If no push tokens available, schedule a local notification they'll see when they open the app
      await scheduleLocalNotification(
        'Membership Approved',
        `Your request to join ${garden.name} has been approved.`,
        { type: 'membership_approved', gardenId }
      );
    }
  } catch (error) {
    console.error('Failed to send membership approval notification:', error);
    // Don't throw to prevent breaking the approval flow
  }
}

/**
 * Sends a notification that membership was denied
 */
async function sendMembershipDenialNotification(gardenId: string, userId: string): Promise<void> {
  try {
    // Get user's device tokens for push notifications
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('username, push_tokens')
      .eq('id', userId)
      .single();

    if (userError) throw userError;

    // Get garden info
    const { data: garden, error: gardenError } = await supabase
      .from('gardens')
      .select('name, creator')
      .eq('id', gardenId)
      .single();

    if (gardenError) throw gardenError;

    // Add notification to user's notifications table
    const { error: notificationError } = await supabase
      .from('notifications')
      .insert({
        user_id: userId,
        title: 'Membership Denied',
        body: `Your request to join ${garden.name} was not approved.`,
        type: 'membership_denied',
        data: JSON.stringify({ gardenId, gardenName: garden.name }),
        created_at: new Date().toISOString(),
        read: false,
      });

    if (notificationError) throw notificationError;

    // If user has push tokens, send push notification
    if (user.push_tokens && user.push_tokens.length > 0) {
      // This would call your push notification service
      console.log(`Sending push notifications to ${user.username} for membership denial`);
      // await sendPushNotification(user.push_tokens, {
      //   title: 'Membership Request',
      //   body: `Your request to join ${garden.name} was not approved.`,
      //   data: { type: 'membership_denied', gardenId }
      // });
    }
  } catch (error) {
    console.error('Failed to send membership denial notification:', error);
    // Don't throw to prevent breaking the denial flow
  }
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
    // Get member's public key
    const { data: memberData, error: memberError } = await supabase
      .from('memberships')
      .select('public_key, role')
      .eq('garden_id', gardenId)
      .eq('user_id', userId)
      .single();

    if (memberError) throw memberError;
    
    if (memberData.role !== 'pending') {
      throw new Error('Membership is not in pending state');
    }

    // Get admin's encrypted group key
    const { data: adminKey, error: adminError } = await supabase
      .from('memberships')
      .select('encrypted_group_key')
      .eq('garden_id', gardenId)
      .eq('user_id', adminId)
      .in('role', ['creator', 'admin'])
      .single();

    if (adminError) throw adminError;
    
    // Admin needs to decrypt their group key
    const privateKey = await getStoredPrivateKey();
    if (!privateKey) throw new Error('Private key not available');
    
    // Decrypt the admin's group key
    const groupKey = await decryptGroupKeyFromBinary(adminKey.encrypted_group_key, privateKey);
    
    // Re-encrypt the group key for the new member using their public key
    const memberPublicKeyUint8 = decode(memberData.public_key);
    const adminSecretKeyUint8 = decode(privateKey);
    const groupKeyUint8 = decode(groupKey);
    
    // Generate ephemeral keypair for the encryption
    const ephemeralKeyPair = box.keyPair();
    
    // Encrypt the group key for the new member
    const nonce = randomBytes(box.nonceLength);
    const encryptedGroupKey = box(
      groupKeyUint8,
      nonce,
      memberPublicKeyUint8,
      adminSecretKeyUint8
    );
    
    // Format the encrypted key with the nonce
    const encryptedKeyWithNonce = new Uint8Array(nonce.length + encryptedGroupKey.length);
    encryptedKeyWithNonce.set(nonce);
    encryptedKeyWithNonce.set(encryptedGroupKey, nonce.length);
    
    // Update the membership to 'member' and set the encrypted group key
    const { error: updateError } = await supabase
      .from('memberships')
      .update({
        role: 'member',
        encrypted_group_key: encode(encryptedKeyWithNonce),
        updated_at: new Date().toISOString(),
      })
      .eq('garden_id', gardenId)
      .eq('user_id', userId);

    if (updateError) throw updateError;
    
    // Notify the user that their membership was approved
    await sendMembershipApprovalNotification(gardenId, userId);
    
    return true;
  } catch (error) {
    console.error('Failed to approve membership:', error);
    return false;
  }
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
      .single();

    if (checkError) throw checkError;
    
    if (data.role !== 'pending') {
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
