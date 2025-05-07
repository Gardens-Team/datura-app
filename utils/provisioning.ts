import { box, setPRNG, sign } from 'tweetnacl';
import { encode, decode } from '@stablelib/base64';
import * as SecureStore from 'expo-secure-store';
import { getRandomValues } from 'expo-crypto';

// Setup the PRNG for TweetNaCl
setPRNG((x, n) => {
  const randomBytes = getRandomValues(new Uint8Array(n));
  for (let i = 0; i < n; i++) {
    x[i] = randomBytes[i];
  }
});

export interface KeyPairEncryption {
  publicKeyEncryption: string;
  privateKeyEncryption: string;
}

export interface KeyPairSigning {
  publicKeySigning: string;
  privateKeySigning: string;
}

const PRIVATE_KEY_ENCRYPTION = 'datura_private_encryption';
const PUBLIC_KEY_ENCRYPTION = 'datura_public_encryption';
const PRIVATE_KEY_SIGNING = 'datura_private_signing';
const PUBLIC_KEY_SIGNING = 'datura_public_signing';

export async function generateEncryptionKeyPair(): Promise<KeyPairEncryption> {
  try {
    // Generate X25519 keypair using tweetnacl
    const keyPair = box.keyPair();
    
    // Convert to base64 strings for storage
    const keys = {
      publicKey: encode(keyPair.publicKey),
      privateKey: encode(keyPair.secretKey)
    };

    // Store private key securely
    await SecureStore.setItemAsync(PRIVATE_KEY_ENCRYPTION, keys.privateKey);
    await SecureStore.setItemAsync(PUBLIC_KEY_ENCRYPTION, keys.publicKey);

    console.log('Key Generation Success:', {
      publicKeyLength: keys.publicKey.length,
      publicKeySample: `${keys.publicKey.substring(0, 10)}...${keys.publicKey.substring(keys.publicKey.length - 10)}`,
      timestamp: new Date().toISOString()
    });

    return {
      publicKeyEncryption: keys.publicKey,
      privateKeyEncryption: keys.privateKey,
    };
  } catch (error) {
    console.error('Key Generation Error:', error);
    throw error;
  }
}

export async function generateSigningKeyPair(): Promise<KeyPairSigning> {
  try {
    // Generate X25519 keypair using tweetnacl
    const keyPair = sign.keyPair();
    
    // Convert to base64 strings for storage
    const keys = {
      publicKey: encode(keyPair.publicKey),
      privateKey: encode(keyPair.secretKey)
    };

    // Store private key securely
    await SecureStore.setItemAsync(PRIVATE_KEY_SIGNING, keys.privateKey);
    await SecureStore.setItemAsync(PUBLIC_KEY_SIGNING, keys.publicKey);

    console.log('Key Generation Success:', {
      publicKeyLength: keys.publicKey.length,
      publicKeySample: `${keys.publicKey.substring(0, 10)}...${keys.publicKey.substring(keys.publicKey.length - 10)}`,
      timestamp: new Date().toISOString()
    });

    return {
      publicKeySigning: keys.publicKey,
      privateKeySigning: keys.privateKey,
    };
  } catch (error) {
    console.error('Key Generation Error:', error);
    throw error;
  }
}

export async function getStoredPrivateKeyEncryption(): Promise<string | null> {
  return await SecureStore.getItemAsync(PRIVATE_KEY_ENCRYPTION);
}

export async function getStoredPrivateKeySigning(): Promise<string | null> {
  return await SecureStore.getItemAsync(PRIVATE_KEY_SIGNING);
}

export async function clearStoredKeys(): Promise<void> {
  await SecureStore.deleteItemAsync(PRIVATE_KEY_ENCRYPTION);
  await SecureStore.deleteItemAsync(PUBLIC_KEY_ENCRYPTION);
  await SecureStore.deleteItemAsync(PRIVATE_KEY_SIGNING);
  await SecureStore.deleteItemAsync(PUBLIC_KEY_SIGNING);
}

// Utility function to convert stored base64 keys back to Uint8Array for tweetnacl
export function getKeyPairFromBase64(publicKey: string, privateKey: string): { publicKey: Uint8Array; secretKey: Uint8Array } {
  return {
    publicKey: decode(publicKey),
    secretKey: decode(privateKey)
  };
}

export async function generateAESSymmetricKey(): Promise<string> {
  try {
    // Generate 32 bytes (256 bits) for AES-256
    const randomBytes = getRandomValues(new Uint8Array(32)); 
    
    // Convert to base64 string
    const symmetricKey = encode(randomBytes);
    
    console.log('AES Key Generation Success:', {
      keyLength: symmetricKey.length,
      keySample: `${symmetricKey.substring(0, 10)}...${symmetricKey.substring(symmetricKey.length - 10)}`,
      timestamp: new Date().toISOString()
    });
    
    return symmetricKey;
  } catch (error) {
    console.error('AES Key Generation Error:', error);
    throw error;
  }
}

export function decryptGroupKeyFromBinary(
  decodedPayload: Uint8Array, 
  privateKeyBase64: string
): string {
  const nonce = decodedPayload.slice(0, box.nonceLength);
  const epk = decodedPayload.slice(box.nonceLength, box.nonceLength + box.publicKeyLength);
  const cipher = decodedPayload.slice(box.nonceLength + box.publicKeyLength);
  
  const priv = decode(privateKeyBase64);
  const shared = box.before(epk, priv);
  const plain = box.open.after(cipher, nonce, shared);
  
  if (!plain) throw new Error('Decryption failed');
  return encode(plain);
}

export async function generateRotationKeyMaterial(): Promise<string> {
  const newKey = await generateAESSymmetricKey();
  return newKey;
}
