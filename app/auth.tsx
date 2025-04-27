import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TextInput, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from 'react-native';
import { router } from 'expo-router';
import Logo from '@/components/Logo';
import { loginWithUsername } from '@/services/auth-service';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/providers/AuthProvider';

export default function AuthScreen() {
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const [username, setUsername] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const { isLoggedIn, checkAuthStatus } = useAuth();

  // Check if already logged in on component mount
  useEffect(() => {
    const checkSession = async () => {
      const isAuth = await checkAuthStatus();
      if (isAuth) {
        // Redirect to tabs directly
        router.replace("/(tabs)" as any);
      }
    };
    
    checkSession();
  }, []);

  const handleLogin = async () => {
    if (!username.trim()) {
      Alert.alert('Error', 'Please enter a username');
      return;
    }

    try {
      setIsLoading(true);
      const success = await loginWithUsername(username);
      
      if (success) {
        // First update auth context
        await checkAuthStatus();
        console.log("Login successful, navigating to tabs...");
        
        // Then navigate to tabs directly - not to a specific tab
        router.replace("/(tabs)" as any);
      } else {
        Alert.alert(
          'Authentication Failed',
          'Could not authenticate with your device key. Please ensure you\'re using your registered device.',
          [{ text: 'OK' }]
        );
      }
    } catch (error) {
      console.error('Login error:', error);
      Alert.alert(
        'Login Error',
        'An error occurred during login. Please try again.',
        [{ text: 'OK' }]
      );
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top, backgroundColor: colors.background }]}>
      <View style={styles.content}>
        <View style={styles.logoContainer}>
          <Logo size={120} />
          <Text style={[styles.title, { color: colors.text }]}>Datura</Text>
          <Text style={[styles.subtitle, { color: colors.secondaryText }]}>
            Secure Messaging
          </Text>
        </View>

        <View style={styles.formContainer}>
          <Text style={[styles.formLabel, { color: colors.text }]}>Username</Text>
          <TextInput
            style={[styles.input, { 
              backgroundColor: colorScheme === 'dark' ? '#2c2c2e' : '#f2f2f7',
              color: colors.text,
              borderColor: colors.border
            }]}
            placeholder="Enter your username"
            placeholderTextColor={colors.secondaryText}
            autoCapitalize="none"
            autoCorrect={false}
            value={username}
            onChangeText={setUsername}
            editable={!isLoading}
          />
          
          <Button
            onPress={handleLogin}
            isLoading={isLoading}
            disabled={isLoading || !username.trim()}
            style={styles.loginButton}
          >
            Login with Device Key
          </Button>
          
          <Button
            variant="ghost"
            onPress={() => router.push('/register')}
            disabled={isLoading}
          >
            Don't have an account? Register
          </Button>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 24,
    paddingBottom: 48,
  },
  logoContainer: {
    alignItems: 'center',
    marginTop: 48,
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    marginTop: 24,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 18,
    fontWeight: '500',
  },
  formContainer: {
    width: '100%',
    marginTop: 60,
    paddingHorizontal: 16,
  },
  formLabel: {
    fontSize: 16,
    fontWeight: '500',
    marginBottom: 8,
  },
  input: {
    width: '100%',
    height: 48,
    borderRadius: 8,
    paddingHorizontal: 16,
    marginBottom: 24,
    borderWidth: 1,
    fontSize: 16,
  },
  loginButton: {
    marginBottom: 16,
  }
});