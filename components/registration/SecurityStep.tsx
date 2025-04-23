import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from 'react-native';
import { generateKeyPair } from '@/utils/provisioning';
import { Ionicons } from '@expo/vector-icons';
import { createClient } from '@supabase/supabase-js'
import * as Crypto from 'expo-crypto';
import { saveUserProfile } from '@/services/database-service';

interface SecurityStepProps {
  onComplete: () => void;
  onBack: () => void;
  username: string;
  profilePic: string;
}

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.EXPO_PUBLIC_SUPABASE_KEY!

const supabase = createClient(supabaseUrl, supabaseKey)

export function SecurityStep({ onComplete, onBack, username, profilePic }: SecurityStepProps) {
  const [isGenerating, setIsGenerating] = useState(false);
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];

  const handleGenerateKeys = async () => {
    setIsGenerating(true);
    try {
      const keyPair = await generateKeyPair();
      
      // Generate a single UUID
      const userId = Crypto.randomUUID();

      // Create user in your database with public key
      await createUser({
        id: userId,
        username,
        profilePic,
        publicKey: keyPair.publicKey
      });

      await saveUserProfile(userId, username, profilePic);

      onComplete();
    } catch (error) {
      console.error('Error in security setup:', error);
      alert('Failed to complete security setup. Please try again.');
    } finally {
      setIsGenerating(false);
    }
  };

  async function createUser(userData: { 
    id: string;
    username: string; 
    profilePic: string; 
    publicKey: string; 
  }) {
    console.log("Supabase URL:", supabaseUrl);
    console.log("About to insert user to Supabase");
    const { error } = await supabase
      .from('users')
      .insert({
        id: userData.id,
        username: userData.username,
        profile_pic: userData.profilePic,
        public_key: userData.publicKey,
        created_at: new Date().toISOString()
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