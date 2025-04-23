import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Dimensions, Alert, Animated, Easing } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from 'react-native';
import { router } from 'expo-router';
import Logo from '@/components/Logo';
import { useAuth } from '@/providers/AuthProvider';
import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import { Button } from '@/components/ui/Button';

const PASSCODE_KEY = 'user_passcode';
const FINGERPRINT_SIZE = 120;

export default function AuthScreen() {
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const { authenticate, authenticateWithPasscode } = useAuth();
  const [isBiometricSupported, setIsBiometricSupported] = useState(false);
  const [hasPasscode, setHasPasscode] = useState(false);
  const [showPasscode, setShowPasscode] = useState(false);
  const [passcode, setPasscode] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [pulseAnim] = useState(new Animated.Value(1));

  useEffect(() => {
    checkAuthMethods();
  }, []);

  useEffect(() => {
    // Trigger biometric authentication immediately when supported
    if (isBiometricSupported && !showPasscode) {
      handleAuthenticate();
    } else if (hasPasscode && !isBiometricSupported) {
      // If biometrics not supported but passcode exists, show passcode UI
      setShowPasscode(true);
    }
  }, [isBiometricSupported, hasPasscode]);

  useEffect(() => {
    // Start pulsing animation when not loading
    if (!isLoading) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1.1,
            duration: 1000,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 1000,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
        ])
      ).start();
    } else {
      // Stop animation when loading
      pulseAnim.setValue(1);
    }
  }, [isLoading]);

  const checkAuthMethods = async () => {
    try {
      // Check if passcode exists first
      const savedPasscode = await SecureStore.getItemAsync(PASSCODE_KEY);
      setHasPasscode(!!savedPasscode);

      // Then check biometric support
      const [compatible, enrolled] = await Promise.all([
        LocalAuthentication.hasHardwareAsync(),
        LocalAuthentication.isEnrolledAsync()
      ]);
      
      const isBiometricsAvailable = compatible && enrolled;
      setIsBiometricSupported(isBiometricsAvailable);

      // If no authentication methods available, go to registration
      if (!isBiometricsAvailable && !savedPasscode) {
        router.push('/register');
      }
    } catch (error) {
      console.error('Auth methods check error:', error);
      // Check if passcode exists as fallback
      const savedPasscode = await SecureStore.getItemAsync(PASSCODE_KEY);
      if (savedPasscode) {
        setHasPasscode(true);
      } else {
        router.push('/register');
      }
    }
  };

  const handleAuthenticate = async () => {
    if (!isBiometricSupported && !hasPasscode) {
      router.push('/register');
      return;
    }

    try {
      setIsLoading(true);

      // Attempt biometric authentication if supported
      if (isBiometricSupported) {
        await authenticate();
        // If we get here and aren't redirected, biometrics failed or were cancelled
      }
      
      // If we're still here and have a passcode, show the passcode UI
      if (hasPasscode) {
        setShowPasscode(true);
      } else {
        Alert.alert(
          'Authentication Failed',
          'No authentication methods available.',
          [
            { 
              text: 'Set Up Account', 
              onPress: () => router.push('/register')
            }
          ]
        );
      }
    } catch (error) {
      console.error('Authentication error:', error);
      if (hasPasscode) {
        setShowPasscode(true);
      } else {
        router.push('/register');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handlePasscodeInput = async (digit: string) => {
    if (passcode.length < 6) {
      const newPasscode = passcode + digit;
      setPasscode(newPasscode);
      if (newPasscode.length === 6) {
        await handlePasscodeSubmit(newPasscode);
      }
    }
  };

  const handlePasscodeSubmit = async (code: string) => {
    try {
      setIsLoading(true);
      const success = await authenticateWithPasscode(code);
      if (!success) {
        setPasscode('');
        Alert.alert(
          'Incorrect Passcode',
          'Please try again',
          [{ text: 'OK' }]
        );
      }
    } catch (error) {
      console.error('Passcode validation error:', error);
      setPasscode('');
      Alert.alert(
        'Error',
        'Failed to validate passcode. Please try again.',
        [{ text: 'OK' }]
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleBackspace = () => {
    setPasscode(prev => prev.slice(0, -1));
  };

  const renderDialpad = () => {
    const numbers = [
      ['1', '2', '3'],
      ['4', '5', '6'],
      ['7', '8', '9'],
      ['cancel', '0', '⌫']
    ];

    return (
      <View style={styles.dialpad}>
        {numbers.map((row, rowIndex) => (
          <View key={rowIndex} style={styles.dialpadRow}>
            {row.map((num, colIndex) => {
              const isSpecialButton = num === 'cancel' || num === '⌫';
              return (
                <Button
                  key={`${rowIndex}-${colIndex}`}
                  variant={isSpecialButton ? 'secondary' : 'default'}
                  size="lg"
                  style={[
                    styles.dialpadButton,
                    isSpecialButton && { backgroundColor: colors.border }
                  ]}
                  disabled={isLoading}
                  onPress={() => {
                    if (num === '⌫') {
                      handleBackspace();
                    } else if (num === 'cancel') {
                      setShowPasscode(false);
                      setPasscode('');
                    } else {
                      handlePasscodeInput(num);
                    }
                  }}
                >
                  {num === 'cancel' ? 'Back to Fingerprint' : num}
                </Button>
              );
            })}
          </View>
        ))}
      </View>
    );
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

        {showPasscode ? (
          <View style={styles.passcodeContainer}>
            <Text style={[styles.passcodeTitle, { color: colors.text }]}>
              Enter 6-digit Passcode
            </Text>
            <View style={styles.dotsContainer}>
              {[...Array(6)].map((_, i) => (
                <View
                  key={i}
                  style={[
                    styles.dot,
                    { 
                      backgroundColor: i < passcode.length ? colors.primary : 'transparent',
                      borderColor: colors.border 
                    }
                  ]}
                />
              ))}
            </View>
            {renderDialpad()}
          </View>
        ) : (
          <View style={styles.authButtons}>
            <Animated.View style={[
              styles.fingerprintContainer,
              {
                transform: [{ scale: pulseAnim }],
              }
            ]}>
              <Button
                size="icon"
                style={[
                  styles.fingerprintButton,
                  { backgroundColor: colors.primary }
                ]}
                onPress={handleAuthenticate}
                isLoading={isLoading}
              >
                {!isLoading && (
                  <Ionicons 
                    name="finger-print"
                    size={FINGERPRINT_SIZE / 2}
                    color={colors.accent}
                  />
                )}
              </Button>
              <Text style={[styles.fingerprintText, { color: colors.secondaryText }]}>
                Touch to unlock
              </Text>
            </Animated.View>
            
            {hasPasscode && (
              <Button
                variant="ghost"
                onPress={() => setShowPasscode(true)}
                disabled={isLoading}
              >
                Use Passcode Instead
              </Button>
            )}
            
            <Button
              variant="ghost"
              onPress={() => router.push('/register')}
              disabled={isLoading}
            >
              Don't have an account? Register
            </Button>
          </View>
        )}
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
  authButtons: {
    width: '100%',
    alignItems: 'center',
    gap: 16,
  },
  fingerprintContainer: {
    alignItems: 'center',
    gap: 16,
    marginBottom: 24,
  },
  fingerprintButton: {
    width: FINGERPRINT_SIZE,
    height: FINGERPRINT_SIZE,
    borderRadius: FINGERPRINT_SIZE / 2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  fingerprintText: {
    fontSize: 16,
    fontWeight: '500',
  },
  passcodeContainer: {
    width: '100%',
    alignItems: 'center',
    gap: 24,
  },
  passcodeTitle: {
    fontSize: 20,
    fontWeight: '600',
  },
  dotsContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 12,
  },
  dot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 1,
  },
  dialpad: {
    width: '100%',
    maxWidth: 300,
    aspectRatio: 4/5,
    gap: 12,
  },
  dialpadRow: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  dialpadButton: {
    flex: 1,
    height: 64,
    borderRadius: 12,
  },
});
