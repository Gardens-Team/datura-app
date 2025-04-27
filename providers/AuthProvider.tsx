import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { router, useSegments } from 'expo-router';
import { AppState, Alert } from 'react-native';
import { TouchableWithoutFeedback, View } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { isAuthenticated, logout } from '@/services/auth-service';
import * as LocalAuthentication from 'expo-local-authentication';
import * as Crypto from 'expo-crypto';

const TIMEOUT_DURATION = 30 * 60 * 1000; // 30 minutes
const PASSCODE_HASH_KEY = 'user_passcode_hash'; // Key for storing user's global passcode hash

interface AuthContextType {
  isLoggedIn: boolean;
  isLoading: boolean;
  signOut: () => Promise<void>;
  checkAuthStatus: () => Promise<boolean>;
}

interface GardenAuthContextType {
  authenticate: () => Promise<boolean>;
  authenticateWithPasscode: (passcode: string) => Promise<boolean>;
}

const AuthContext = createContext<AuthContextType | null>(null);
const GardenAuthContext = createContext<GardenAuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [lastActivity, setLastActivity] = useState(Date.now());
  const segments = useSegments();

  // Check authentication on mount
  useEffect(() => {
    checkAuthStatus();
  }, []);

  // Handle routing based on authentication state
  useEffect(() => {
    if (isLoading) return;

    const inAuthGroup = segments[0] === 'auth' || segments[0] === 'register';
    
    if (isLoggedIn && inAuthGroup) {
      // Redirect to home if logged in but on auth screen
      router.replace('/(tabs)/home');
    } else if (!isLoggedIn && !inAuthGroup) {
      // Redirect to auth if not logged in and not on auth screen
      router.replace('/auth');
    }
  }, [isLoggedIn, isLoading, segments]);

  // Use AppState to handle background timeout
  useEffect(() => {
    let backgroundTime = 0;
    const subscription = AppState.addEventListener('change', nextState => {
      if (nextState !== 'active') {
        backgroundTime = Date.now();
      } else {
        const elapsed = Date.now() - backgroundTime;
        if (elapsed > TIMEOUT_DURATION && isLoggedIn) {
          signOut();
        } else {
          // If coming back to the app but less than timeout, check auth status
          checkAuthStatus();
        }
      }
    });
    return () => subscription.remove();
  }, [isLoggedIn]);

  // Check if user is authenticated
  const checkAuthStatus = useCallback(async (): Promise<boolean> => {
    setIsLoading(true);
    try {
      const authenticated = await isAuthenticated();
      setIsLoggedIn(authenticated);
      return authenticated;
    } catch (error) {
      console.error('Auth check error:', error);
      setIsLoggedIn(false);
      return false;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const signOut = useCallback(async (): Promise<void> => {
    try {
      await logout();
      setIsLoggedIn(false);
      router.replace('/auth');
    } catch (error) {
      console.error('Logout error:', error);
    }
  }, []);

  // Authenticate using device biometrics or device passcode
  const authenticate = useCallback(async (): Promise<boolean> => {
    try {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Authenticate',
        disableDeviceFallback: false, // Allow device passcode fallback
      });
      if (!result.success) {
        console.log('Device authentication failed or cancelled.');
        // Optionally show an alert or handle cancellation
        // Alert.alert('Authentication Failed', result.error === 'user_cancel' ? 'Authentication cancelled.' : 'Could not verify identity.');
      }
      return result.success;
    } catch (error) {
      console.error('Biometric/Device Authentication error:', error);
      Alert.alert('Authentication Error', 'An error occurred during authentication.');
      return false;
    }
  }, []);

  // Authenticate using the user's global 6-digit passcode
  const authenticateWithPasscode = useCallback(async (passcode: string): Promise<boolean> => {
    if (passcode.length !== 6) {
      console.warn('Attempted passcode authentication with invalid length.');
      return false; // Or throw an error
    }
    try {
      const storedHash = await SecureStore.getItemAsync(PASSCODE_HASH_KEY);
      if (!storedHash) {
        console.error('No global passcode hash found in secure store.');
        // This case means the user likely hasn't set up a passcode yet.
        // Depending on UX, might want to prompt setup or just fail.
        Alert.alert('Passcode Not Set', 'No application passcode has been set up.');
        return false;
      }

      const enteredHash = await Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256,
        passcode
      );

      const success = storedHash === enteredHash;
      if (!success) {
         console.log('Global passcode authentication failed: Mismatch.');
         // Alert.alert('Incorrect Passcode', 'The passcode entered is incorrect.');
      }
      return success;

    } catch (error) {
      console.error('Passcode Authentication error:', error);
      Alert.alert('Authentication Error', 'An error occurred while verifying the passcode.');
      return false;
    }
  }, []);

  return (
    <AuthContext.Provider
      value={{ 
        isLoggedIn, 
        isLoading, 
        signOut, 
        checkAuthStatus
      }}
    >
      <GardenAuthContext.Provider 
        value={{ authenticate, authenticateWithPasscode }}
      >
        <TouchableWithoutFeedback onPressIn={() => setLastActivity(Date.now())}>
          <View style={{ flex: 1 }}>{children}</View>
        </TouchableWithoutFeedback>
      </GardenAuthContext.Provider>
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

export function useGardenAuth() {
  const context = useContext(GardenAuthContext);
  if (!context) {
    throw new Error('useGardenAuth must be used within an AuthProvider');
  }
  return context;
} 