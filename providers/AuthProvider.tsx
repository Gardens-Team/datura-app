import React, { createContext, useContext, useEffect, useState } from 'react';
import { router, useSegments } from 'expo-router';
import { AppState } from 'react-native';
import { TouchableWithoutFeedback, View } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { isAuthenticated, logout } from '@/services/auth-service';

const TIMEOUT_DURATION = 30 * 60 * 1000; // 30 minutes

interface AuthContextType {
  isLoggedIn: boolean;
  isLoading: boolean;
  signOut: () => Promise<void>;
  checkAuthStatus: () => Promise<boolean>;
}

const AuthContext = createContext<AuthContextType | null>(null);

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
  const checkAuthStatus = async (): Promise<boolean> => {
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
  };

  const signOut = async (): Promise<void> => {
    try {
      await logout();
      setIsLoggedIn(false);
      router.replace('/auth');
    } catch (error) {
      console.error('Logout error:', error);
    }
  };

  return (
    <AuthContext.Provider
      value={{ 
        isLoggedIn, 
        isLoading, 
        signOut, 
        checkAuthStatus 
      }}
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