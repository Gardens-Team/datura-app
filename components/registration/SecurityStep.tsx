import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from 'react-native';
import { generateEncryptionKeyPair, generateSigningKeyPair } from '@/utils/provisioning';
import { Ionicons } from '@expo/vector-icons';
import { createClient } from '@supabase/supabase-js'
import * as Crypto from 'expo-crypto';
import { saveUserProfile } from '@/services/database-service';
import { router } from 'expo-router';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

interface SecurityStepProps {
  onComplete: () => void;
  onBack: () => void;
  username: string;
  profilePic: string;
  passwordHash: string;
  publicKeyEncryption: string;
  publicKeySigning: string;
}

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.EXPO_PUBLIC_SUPABASE_KEY!

const supabase = createClient(supabaseUrl, supabaseKey)


export function SecurityStep({ onComplete, onBack, username, profilePic, passwordHash}: SecurityStepProps) {
  const [isGenerating, setIsGenerating] = useState(false);
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  
  // Check if we already have a password hash, which means we're returning
  // from the passcode step and should complete the user creation
  useEffect(() => {
    if (passwordHash) {
      completeUserCreation();
    }
  }, [passwordHash]);
  
  const completeUserCreation = async () => {
    if (!passwordHash) {
      // If no password hash yet, just proceed to passcode step
      onComplete();
      return;
    }
    
    setIsGenerating(true);
    try {
      const keyPairEncryption = await generateEncryptionKeyPair();
      const keyPairSigning = await generateSigningKeyPair();
      
      // Generate a single UUID
      const userId = Crypto.randomUUID();

      // Create user in Supabase with public key and password hash
      await createUser({
        id: userId,
        username,
        profilePic,
        publicKeyEncryption: keyPairEncryption.publicKeyEncryption,
        publicKeySigning: keyPairSigning.publicKeySigning,
        passwordHash: passwordHash,
      });

      // Save locally
      await saveUserProfile(userId, username, profilePic);

      // Navigate directly to the home tab
      router.replace('/(tabs)/home' as const);
    } catch (error) {
      console.error('Error in security setup:', error);
      alert('Failed to complete security setup. Please try again.');
      onComplete(); // Still move to next step to try passcode again
    } finally {
      setIsGenerating(false);
    }
  };

  const handleGenerateKeys = async () => {
    // If we already have a password hash, use it to complete account creation
    if (passwordHash) {
      await completeUserCreation();
    } else {
      // Otherwise move to passcode step first
      onComplete();
    }
  };

  async function createUser(userData: { 
    id: string;
    username: string; 
    profilePic: string; 
    publicKeyEncryption: string; 
    publicKeySigning: string; 
    passwordHash: string;
  }) {
    console.log("Supabase URL:", supabaseUrl);
    console.log("About to insert user to Supabase");
    const { error } = await supabase
      .from('users')
      .insert({
        id: userData.id,
        username: userData.username,
        profile_pic: userData.profilePic,
        encryption_key: userData.publicKeyEncryption,
        signing_key: userData.publicKeySigning,
        passcode_hash: userData.passwordHash,
        created_at: new Date().toISOString(),
      });

    if (error) {
      console.error('Error creating user:', error);
      throw new Error('Failed to create user');
    }
    console.log("Completed insert attempt");
  }

  return (
    <View style={styles.container}>
      <Text style={[styles.title, { color: colors.text }]}>Security Setup</Text>
      <Text style={[styles.subtitle, { color: colors.secondaryText }]}>
        We'll generate your encryption keys to keep your messages secure
      </Text>

      <View style={styles.content}>
        <View style={[styles.infoBox, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Ionicons name="shield-checkmark" size={40} color={colors.primary} />
          <Text style={[styles.infoTitle, { color: colors.text }]}>End-to-End Encryption</Text>
          <Text style={[styles.infoText, { color: colors.secondaryText }]}>
            Your messages will be encrypted using X25519 keys and can only be read by their intended recipients
          </Text>
        </View>

        {isGenerating ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={[styles.loadingText, { color: colors.text }]}>
              Generating Security Keys...
            </Text>
          </View>
        ) : (
          <View style={styles.buttonContainer}>
            <TouchableOpacity 
              style={[styles.button, styles.backButton, { borderColor: colors.primary }]} 
              onPress={onBack}
            >
              <Text style={[styles.buttonText, { color: colors.primary }]}>Back</Text>
            </TouchableOpacity>

            <TouchableOpacity 
              style={[styles.button, { backgroundColor: colors.primary }]} 
              onPress={handleGenerateKeys}
            >
              <Text style={[styles.buttonText, { color: colors.accent }]}>Generate Keys</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 24,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    marginBottom: 32,
  },
  content: {
    flex: 1,
    justifyContent: 'space-between',
  },
  infoBox: {
    padding: 24,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
  },
  infoTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginTop: 16,
    marginBottom: 8,
  },
  infoText: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  loadingContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 32,
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
  },
  buttonContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 16,
  },
  button: {
    flex: 1,
    paddingVertical: 16,
    borderRadius: 8,
    alignItems: 'center',
  },
  backButton: {
    backgroundColor: 'transparent',
    borderWidth: 1,
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '600',
  },
}); 