import React, { useState } from 'react';
import { View, Text, TextInput, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from 'react-native';

interface UsernameStepProps {
  onNext: (username: string) => void;
}

export function UsernameStep({ onNext }: UsernameStepProps) {
  const [username, setUsername] = useState('');
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];

  const handleNext = () => {
    if (username.length < 3) {
      Alert.alert('Invalid Username', 'Username must be at least 3 characters long');
      return;
    }
    if (!/^[a-zA-Z0-9_]+$/.test(username)) {
      Alert.alert('Invalid Username', 'Username can only contain letters, numbers, and underscores');
      return;
    }
    onNext(username);
  };

  return (
    <View style={styles.container}>
      <Text style={[styles.title, { color: colors.text }]}>Choose Your Username</Text>
      <Text style={[styles.subtitle, { color: colors.secondaryText }]}>
        This will be your unique identifier in the app
      </Text>
      
      <TextInput
        style={[styles.input, { 
          color: colors.text,
          borderColor: colors.border,
          backgroundColor: colors.surface
        }]}
        placeholder="Enter username"
        placeholderTextColor={colors.secondaryText}
        value={username}
        onChangeText={setUsername}
        autoCapitalize="none"
        autoCorrect={false}
        maxLength={20}
      />
      
      <Text style={[styles.hint, { color: colors.secondaryText }]}>
        3-20 characters, letters, numbers, and underscores only
      </Text>

      <TouchableOpacity 
        style={[styles.button, { backgroundColor: colors.primary }]}
        onPress={handleNext}
      >
        <Text style={[styles.buttonText, { color: colors.accent }]}>
          Continue
        </Text>
      </TouchableOpacity>
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
    marginBottom: 24,
  },
  input: {
    height: 50,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 16,
    fontSize: 16,
    marginBottom: 8,
  },
  hint: {
    fontSize: 14,
    marginBottom: 32,
  },
  button: {
    paddingVertical: 16,
    borderRadius: 8,
    alignItems: 'center',
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '600',
  },
}); 