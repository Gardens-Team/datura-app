import React, { createContext, useContext, useEffect, useState } from 'react';
import { router } from 'expo-router';
import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import { AppState } from 'react-native';
import { TouchableWithoutFeedback, View } from 'react-native';
import { supabase } from '@/services/supabase-singleton';
import * as Crypto from 'expo-crypto';

const PASSCODE_KEY = 'datura_passcode';
const USER_ID_KEY = 'local_user_id';
const TIMEOUT_DURATION = 30 * 1000; // 30 seconds

interface AuthContextType {
  isAuthenticated: boolean;
  authenticate: () => Promise<void>;
  signOut: () => void;
  authenticateWithPasscode: (passcode: string) => Promise<boolean>;
}

const AuthContext = createContext<AuthContextType | null>(null);

// Function to hash passcode using SHA-256
async function hashPasscode(passcode: string): Promise<string> {
  const hash = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    passcode
  );
  return hash;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [lastActivity, setLastActivity] = useState(Date.now());

  // Use AppState to only sign out when app moves to background for too long
  useEffect(() => {
    let backgroundTime = 0;
    const subscription = AppState.addEventListener('change', nextState => {
      if (nextState !== 'active') {
        backgroundTime = Date.now();
      } else {
        const elapsed = Date.now() - backgroundTime;
        if (elapsed > TIMEOUT_DURATION) {
          signOut();
        }
      }
    });
    return () => subscription.remove();
  }, []);

  // Verify user exists in Supabase and has matching credentials
  const verifyUserInSupabase = async (userId: string, passcodeHash: string): Promise<boolean> => {
    try {
      if (!userId) {
        console.log("No user ID found in secure storage");
        return false;
      }

      // Query Supabase for the user
      const { data, error } = await supabase
        .from('users')
        .select('id, passcode_hash')
        .eq('id', userId)
        .single();

      if (error || !data) {
        console.error("Error fetching user from Supabase:", error);
        return false;
      }

      // Check if the password hash matches
      return data.passcode_hash === passcodeHash;
    } catch (error) {
      console.error("Error verifying user:", error);
      return false;
    }
  };

  const authenticate = async () => {
    try {
      // First check if biometric authentication is available
      const hasHardware = await LocalAuthentication.hasHardwareAsync();
      const isEnrolled = await LocalAuthentication.isEnrolledAsync();

      if (hasHardware && isEnrolled) {
        // Try biometric authentication
        const result = await LocalAuthentication.authenticateAsync({
          promptMessage: 'Authenticate to access Gardens',
          fallbackLabel: 'Use passcode',
          cancelLabel: 'Cancel',
          disableDeviceFallback: true, // We'll handle fallback ourselves
        });

        if (result.success) {
          // Get the saved passcode to verify with Supabase
          const userId = await SecureStore.getItemAsync(USER_ID_KEY);
          const savedPasscode = await SecureStore.getItemAsync(PASSCODE_KEY);
          
          if (userId && savedPasscode) {
            const passcodeHash = await hashPasscode(savedPasscode);
            const isVerified = await verifyUserInSupabase(userId, passcodeHash);
            
            if (isVerified) {
              setIsAuthenticated(true);
              setLastActivity(Date.now());
              router.replace("/");
              return;
            } else {
              // User exists locally but not in Supabase or credentials don't match
              console.log("User verification with Supabase failed");
              router.replace('/auth');
              return;
            }
          } else {
            // No user credentials stored locally
            console.log("No user credentials found locally");
            router.replace('/auth');
            return;
          }
        }
      }

      // If we get here, either biometrics failed or aren't available
      // The auth screen will handle showing the passcode UI
      console.log("Biometric auth not available or failed - UI should show passcode fallback");
      
    } catch (error) {
      console.error('Authentication error:', error);
      // Still don't throw, let the UI handle the fallback
    }
  };

  const authenticateWithPasscode = async (passcode: string): Promise<boolean> => {
    try {
      const userId = await SecureStore.getItemAsync(USER_ID_KEY);
      
      if (!userId) {
        console.log("No user ID found in secure storage");
        return false;
      }
      
      const passcodeHash = await hashPasscode(passcode);
      
      // Verify with Supabase
      const isVerified = await verifyUserInSupabase(userId, passcodeHash);
      
      if (isVerified) {
        console.log("Authentication success, redirecting...");
        
        // Save passcode locally for future biometric auth
        await SecureStore.setItemAsync(PASSCODE_KEY, passcode);
        
        setIsAuthenticated(true);
        setLastActivity(Date.now());
        
        // Use the correct path to the tabs
        setTimeout(() => {
          console.log("Navigating to tabs...");
          router.replace("/(tabs)/home" as const);  // Use exact path to tabs with parentheses
        }, 300);
        
        return true;
      }
      
      console.log("Passcode verification failed");
      return false;
    } catch (error) {
      console.error('Passcode authentication error:', error);
      return false;
    }
  };

  const signOut = () => {
    setIsAuthenticated(false);
    router.replace('/auth');
  };

  return (
    <AuthContext.Provider
      value={{ isAuthenticated, authenticate, signOut, authenticateWithPasscode }}
    >
      <TouchableWithoutFeedback onPressIn={() => setLastActivity(Date.now())}>
        <View style={{ flex: 1 }}>{children}</View>
      </TouchableWithoutFeedback>
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
} 