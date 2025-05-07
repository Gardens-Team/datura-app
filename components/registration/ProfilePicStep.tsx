import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image } from 'react-native';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';

interface ProfilePicStepProps {
  onNext: (profilePic: string) => void;
  onBack: () => void;
}

export function ProfilePicStep({ onNext, onBack }: ProfilePicStepProps) {
  const [image, setImage] = useState<string | null>(null);
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];

  const pickImage = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    
    if (status !== 'granted') {
      alert('Sorry, we need camera roll permissions to make this work!');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images', 'videos', 'livePhotos'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 1,
      base64: true
    });

    if (!result.canceled && result.assets[0].base64) {
      setImage(`data:image/jpeg;base64,${result.assets[0].base64}`);
    }
  };

  const handleNext = () => {
    if (image) {
      onNext(image);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={[styles.title, { color: colors.text }]}>Add Profile Picture</Text>
      <Text style={[styles.subtitle, { color: colors.secondaryText }]}>
        Choose a profile picture to personalize your account
      </Text>

      <TouchableOpacity 
        style={[styles.imageContainer, { borderColor: colors.border }]} 
        onPress={pickImage}
      >
        {image ? (
          <Image source={{ uri: image }} style={styles.image} />
        ) : (
          <View style={[styles.placeholder, { backgroundColor: colors.surface }]}>
            <Ionicons name="camera" size={40} color={colors.secondaryText} />
            <Text style={[styles.placeholderText, { color: colors.secondaryText }]}>
              Tap to choose photo
            </Text>
          </View>
        )}
      </TouchableOpacity>

      <View style={styles.buttonContainer}>
        <TouchableOpacity 
          style={[styles.button, styles.backButton, { borderColor: colors.primary }]} 
          onPress={onBack}
        >
          <Text style={[styles.buttonText, { color: colors.primary }]}>Back</Text>
        </TouchableOpacity>

        <TouchableOpacity 
          style={[
            styles.button, 
            { backgroundColor: colors.primary, opacity: image ? 1 : 0.5 }
          ]} 
          onPress={handleNext}
          disabled={!image}
        >
          <Text style={[styles.buttonText, { color: colors.accent }]}>Continue</Text>
        </TouchableOpacity>
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
  imageContainer: {
    width: 200,
    height: 200,
    borderRadius: 100,
    alignSelf: 'center',
    marginBottom: 32,
    borderWidth: 2,
    overflow: 'hidden',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  placeholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeholderText: {
    marginTop: 8,
    fontSize: 14,
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