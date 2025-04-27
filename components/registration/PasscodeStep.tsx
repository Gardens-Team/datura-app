import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, Pressable, Alert } from 'react-native';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as Crypto from 'expo-crypto';

interface PasscodeStepProps {
  onComplete: (passwordHash: string) => void;
  onBack: () => void;
}

const PASSCODE_LENGTH = 6;
const PASSCODE_KEY = 'datura_passcode';

// Hash passcode using SHA-256
async function hashPasscode(passcode: string): Promise<string> {
  const hash = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    passcode
  );
  return hash;
}

export function PasscodeStep({ onComplete, onBack }: PasscodeStepProps) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const [passcode, setPasscode] = useState<string>('');
  const [confirmPasscode, setConfirmPasscode] = useState<string>('');
  const [isConfirming, setIsConfirming] = useState(false);
  const router = useRouter();

  const handleDigitPress = useCallback((digit: string) => {
    if (isConfirming) {
      if (confirmPasscode.length < PASSCODE_LENGTH) {
        const newConfirmPasscode = confirmPasscode + digit;
        setConfirmPasscode(newConfirmPasscode);
      }
    } else {
      if (passcode.length < PASSCODE_LENGTH) {
        const newPasscode = passcode + digit;
        setPasscode(newPasscode);
      }
    }
  }, [passcode, confirmPasscode, isConfirming]);

  const handleEnter = useCallback(() => {
    const currentCode = isConfirming ? confirmPasscode : passcode;
    if (currentCode.length === PASSCODE_LENGTH) {
      if (isConfirming) {
        if (confirmPasscode === passcode) {
          // Save the passcode locally
          SecureStore.setItemAsync(PASSCODE_KEY, passcode).then(async () => {
            console.log("Passcode saved:", await SecureStore.getItemAsync(PASSCODE_KEY));
            
            // Hash the passcode for database storage
            const passwordHash = await hashPasscode(passcode);
            
            // Pass the hash to the parent component
            onComplete(passwordHash);
          });
        } else {
          Alert.alert(
            'Passcodes do not match',
            'Please try again',
            [{ text: 'OK', onPress: () => {
              setConfirmPasscode('');
              setIsConfirming(false);
              setPasscode('');
            }}]
          );
        }
      } else {
        setIsConfirming(true);
      }
    }
  }, [passcode, confirmPasscode, isConfirming, onComplete]);

  const handleBackspace = useCallback(() => {
    if (isConfirming) {
      if (confirmPasscode.length > 0) {
        setConfirmPasscode(prev => prev.slice(0, -1));
      }
    } else {
      if (passcode.length > 0) {
        setPasscode(prev => prev.slice(0, -1));
      }
    }
  }, [isConfirming, passcode, confirmPasscode]);

  const renderDots = useCallback(() => {
    const code = isConfirming ? confirmPasscode : passcode;
    return Array(PASSCODE_LENGTH).fill(0).map((_, index) => (
      <View
        key={index}
        style={[
          styles.dot,
          {
            backgroundColor: index < code.length ? colors.text : 'transparent',
            borderColor: colors.text
          }
        ]}
      />
    ));
  }, [passcode, confirmPasscode, isConfirming, colors]);

  const renderDigit = useCallback((digit: string) => (
    <Pressable
      key={digit}
      style={[styles.digitButton, { borderColor: colors.border }]}
      onPress={() => handleDigitPress(digit)}
    >
      <Text style={[styles.digitText, { color: colors.text }]}>{digit}</Text>
    </Pressable>
  ), [handleDigitPress, colors]);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={onBack} style={styles.backButton}>
          <MaterialCommunityIcons name="arrow-left" size={24} color={colors.text} />
        </Pressable>
        <Text style={[styles.title, { color: colors.text }]}>
          {isConfirming ? 'Confirm Passcode' : 'Create Passcode'}
        </Text>
      </View>

      <Text style={[styles.subtitle, { color: colors.text }]}>
        {isConfirming
          ? 'Please enter your passcode again to confirm'
          : 'Enter a 6-digit passcode for backup authentication'}
      </Text>

      <View style={styles.dotsContainer}>
        {renderDots()}
      </View>

      <View style={styles.keypad}>
        {[['1', '2', '3'], ['4', '5', '6'], ['7', '8', '9']].map((row, i) => (
          <View key={i} style={styles.row}>
            {row.map(digit => renderDigit(digit))}
          </View>
        ))}
        <View style={styles.row}>
          <Pressable
            style={[styles.digitButton, { borderColor: colors.border }]}
            onPress={handleBackspace}
          >
            <MaterialCommunityIcons name="backspace-outline" size={24} color={colors.text} />
          </Pressable>
          {renderDigit('0')}
          <Pressable
            style={[
              styles.digitButton, 
              { 
                borderColor: colors.border,
                backgroundColor: (isConfirming ? confirmPasscode : passcode).length === PASSCODE_LENGTH ? colors.primary : colors.border
              }
            ]}
            onPress={handleEnter}
          >
            <MaterialCommunityIcons name="keyboard-return" size={24} color={colors.accent} />
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 20,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
  },
  backButton: {
    padding: 8,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginLeft: 12,
  },
  subtitle: {
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 40,
  },
  dotsContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginBottom: 40,
  },
  dot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 1,
    marginHorizontal: 8,
  },
  keypad: {
    flex: 1,
    justifyContent: 'flex-end',
    marginBottom: 40,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: 20,
  },
  digitButton: {
    width: 75,
    height: 75,
    borderRadius: 40,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  digitText: {
    fontSize: 32,
    fontWeight: '500',
  },
}); 