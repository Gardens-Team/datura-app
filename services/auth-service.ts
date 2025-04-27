// 1. Create a new auth-service.ts file

import { encode, decode } from '@stablelib/base64';
import * as SecureStore from 'expo-secure-store';
import { getStoredPrivateKeySigning } from '@/utils/provisioning';
import { supabase } from './supabase-singleton';
import { sign } from 'tweetnacl';

// Function to request a challenge from server
export async function requestAuthChallenge(userId: string): Promise<string> {
  try {
    const { data, error } = await supabase.rpc('generate_auth_challenge', { 
      input_user_id: userId 
    });
    
    if (error) throw new Error(`Failed to get challenge: ${error.message}`);
    if (!data) throw new Error('Invalid challenge response');
    
    return data;
  } catch (error) {
    console.error('Error requesting auth challenge:', error);
    throw error;
  }
}

// Function to sign a challenge with the user's private key
export async function signChallenge(challenge: string): Promise<string> {
  try {
    console.log('Starting to sign challenge:', challenge.substring(0, 8) + '...');
    
    // Get stored Ed25519 private key
    const privateKeyBase64 = await getStoredPrivateKeySigning();
    if (!privateKeyBase64) {
      console.error('No private signing key available in secure storage');
      throw new Error('No private signing key available');
    }
    
    console.log('Retrieved private key, length:', privateKeyBase64.length);
    
    // Convert challenge to Uint8Array
    const messageBytes = new TextEncoder().encode(challenge);
    console.log('Challenge converted to bytes, length:', messageBytes.length);
    
    // Convert private key from Base64 to Uint8Array
    const privateKeyBytes = decode(privateKeyBase64);
    console.log('Private key decoded to bytes, length:', privateKeyBytes.length);
    
    if (privateKeyBytes.length !== 64) {
      console.warn('Warning: privateKeyBytes length is not 64 bytes, actual length:', privateKeyBytes.length);
    }
    
    // Sign the message using tweetnacl
    // Note: tweetnacl expects a 64-byte secretKey (private key)
    const signature = sign.detached(messageBytes, privateKeyBytes);
    console.log('Signature generated successfully, length:', signature.length);
    
    // Return base64 encoded signature
    const encodedSignature = encode(signature);
    console.log('Signature encoded to base64, length:', encodedSignature.length);
    
    return encodedSignature;
  } catch (error) {
    console.error('Error signing challenge:', error);
    if (error instanceof Error) {
      console.error('Error details:', error.message, error.stack);
    }
    throw new Error('Failed to sign authentication challenge');
  }
}

// Function to perform the full authentication flow
export async function authenticateWithPublicKey(userId: string): Promise<boolean> {
  try {
    console.log('Starting authentication flow for user:', userId);
    
    // 1. Request challenge from server using RPC
    console.log('Step 1: Requesting challenge from server...');
    const challenge = await requestAuthChallenge(userId);
    console.log('Challenge received:', challenge.substring(0, 8) + '...');
    
    // 2. Sign the challenge
    console.log('Step 2: Signing challenge...');
    const signature = await signChallenge(challenge);
    console.log('Signature created, length:', signature.length);
    
    // 3. Verify with server using Edge Function
    console.log('Step 3: Sending challenge verification via direct HTTP...');
    const isVerified = await verifyAuthChallengeDirectHttp(userId, challenge, signature);
    
    console.log('Verification result:', isVerified);
    
    if (isVerified) {
      console.log('Authentication successful, storing session info');
      // Store successful authentication
      await SecureStore.setItemAsync('auth_timestamp', Date.now().toString());
      await SecureStore.setItemAsync('auth_user_id', userId);
      return true;
    }
    
    console.log('Authentication failed, server returned unverified status');
    return false;
  } catch (error) {
    console.error('Authentication error:', error);
    if (error instanceof Error) {
      console.error('Error details:', error.message, error.stack);
    }
    return false;
  }
}

// Function to check if user is authenticated
export async function isAuthenticated(): Promise<boolean> {
  try {
    const timestamp = await SecureStore.getItemAsync('auth_timestamp');
    const userId = await SecureStore.getItemAsync('auth_user_id');
    
    if (!timestamp || !userId) return false;
    
    // Check if authentication has expired (24 hours)
    const authTime = parseInt(timestamp);
    const now = Date.now();
    const expiry = 24 * 60 * 60 * 1000; // 24 hours
    
    if (now - authTime > expiry) {
      // Re-authenticate if expired
      return await authenticateWithPublicKey(userId);
    }
    
    return true;
  } catch (error) {
    console.error('Error checking authentication:', error);
    return false;
  }
}

// Function to perform actual login
export async function loginWithUsername(username: string): Promise<boolean> {
  try {
    console.log('Starting login process for username:', username);
    
    // 1. Look up user ID from username
    console.log('Looking up user ID from username...');
    const { data: user, error } = await supabase
      .from('users')
      .select('id')
      .eq('username', username)
      .single();
    
    if (error) {
      console.error('User lookup error:', error);
      throw new Error('User not found');
    }
    
    if (!user || !user.id) {
      console.error('User not found for username:', username);
      throw new Error('User not found');
    }
    
    console.log('User found, ID:', user.id);
    
    // 2. Use the public key authentication flow
    console.log('Starting public key authentication...');
    const isAuthenticated = await authenticateWithPublicKey(user.id);
    console.log('Authentication result:', isAuthenticated);
    
    // 3. If successful, store session info
    if (isAuthenticated) {
      console.log('Storing session info for user');
      await SecureStore.setItemAsync('local_user_id', user.id);
      await SecureStore.setItemAsync('username', username);
      console.log('Login completed successfully');
    } else {
      console.log('Authentication failed, not storing session');
    }
    
    return isAuthenticated;
  } catch (error) {
    console.error('Login error:', error);
    if (error instanceof Error) {
      console.error('Error details:', error.message, error.stack);
    }
    return false;
  }
}

// Function to logout
export async function logout(): Promise<void> {
  await SecureStore.deleteItemAsync('auth_timestamp');
  await SecureStore.deleteItemAsync('auth_user_id');
  await SecureStore.deleteItemAsync('local_user_id');
  await SecureStore.deleteItemAsync('username');
}

// Add this function to your auth-service.ts
export async function verifyAuthChallengeDirectHttp(
  userId: string, 
  challenge: string, 
  signature: string
): Promise<boolean> {
  try {
    const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL; // Replace with your project URL
    const supabaseKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY; // Replace with your anon key
    
    const response = await fetch(`${supabaseUrl}/functions/v1/verify-auth-challenge`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${supabaseKey}`
      },
      body: JSON.stringify({
        user_id: userId,
        challenge: challenge,
        signature: signature
      })
    });
    
    console.log('HTTP Status:', response.status);
    console.log('Response headers:', JSON.stringify(response.headers));
    
    const responseText = await response.text();
    console.log('Raw response:', responseText);
    
    let data;
    try {
      data = JSON.parse(responseText);
    } catch (e) {
      console.error('Failed to parse JSON response:', e);
      return false;
    }
    
    return data?.verified === true;
  } catch (error) {
    console.error('Direct HTTP request error:', error);
    return false;
  }
}