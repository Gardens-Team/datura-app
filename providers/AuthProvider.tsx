import React, { createContext, useContext, useEffect, useState } from 'react';
import { router } from 'expo-router';
import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import { AppState } from 'react-native';
import { TouchableWithoutFeedback, View } from 'react-native';

const PASSCODE_KEY = 'user_passcode';
const TIMEOUT_DURATION = 30 * 1000; // 30 seconds

interface AuthContextType {
  isAuthenticated: boolean;
  authenticate: () => Promise<void>;
  signOut: () => void;
  authenticateWithPasscode: (passcode: string) => Promise<boolean>;
}

const AuthContext = createContext<AuthContextType | null>(null);

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
          setIsAuthenticated(true);
          setLastActivity(Date.now());
          router.replace("/");
          return;
        }
      }

      // If we get here, either biometrics failed or aren't available
      // The auth screen will handle showing the passcode UI
      
      // We don't immediately fail here - the auth screen should handle
      // showing the passcode fallback UI
      console.log("Biometric auth not available or failed - UI should show passcode fallback");
      
      // DO NOT throw an error here, let the UI handle the fallback
      
    } catch (error) {
      console.error('Authentication error:', error);
      // Still don't throw, let the UI recover
    }
  };

  const authenticateWithPasscode = async (passcode: string): Promise<boolean> => {
    try {
      const savedPasscode = await SecureStore.getItemAsync(PASSCODE_KEY);
      console.log("Auth attempt - Saved passcode:", savedPasscode);
      console.log("Auth attempt - Entered passcode:", passcode);
      console.log("Auth attempt - Match?", savedPasscode === passcode);
      
      if (!savedPasscode) {
        console.log("No passcode found in secure storage");
        return false;
      }
      
      if (savedPasscode === passcode) {
        console.log("Authentication success, redirecting...");
        setIsAuthenticated(true);
        setLastActivity(Date.now());
        
        // Use the correct path to the tabs
        setTimeout(() => {
          console.log("Navigating to tabs...");
          router.replace("/(tabs)/home" as const);  // Use exact path to tabs with parentheses
        }, 300);
        
        return true;
      }
      
      console.log("Passcode mismatch");
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