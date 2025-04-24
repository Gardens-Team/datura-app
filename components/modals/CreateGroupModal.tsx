import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  Modal,
  ActivityIndicator,
  Image,
  Pressable,
  Alert,
} from 'react-native';
import { useColorScheme } from 'react-native';
import { Colors } from '@/constants/Colors';
import { Ionicons } from '@expo/vector-icons';
import { Stepper } from '@/components/Stepper';
import { createGardenWithMembership, generateGardenKey, encryptGardenImage } from '@/services/garden-service';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import * as LocalAuthentication from 'expo-local-authentication';

interface CreateGroupModalProps {
  visible: boolean;
  onClose: () => void;
  /**
   * UUID of the currently authenticated user. Obtained from your auth system or Supabase.
   */
  creatorId: string;
  /**
   * Callback fired after the garden has been successfully created & subscription purchased.
   */
  onSuccess?: () => void;
}

export function CreateGroupModal({ visible, onClose, creatorId, onSuccess }: CreateGroupModalProps) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const router = useRouter();

  const [currentStep, setCurrentStep] = useState(0);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [logo, setLogo] = useState<string | null>(null);
  const { user } = useCurrentUser();
  const [passcode, setPasscode] = useState('');
  const [enableBiometrics, setEnableBiometrics] = useState(false);
  const [hasBiometricHardware, setHasBiometricHardware] = useState(false);
  const [loading, setLoading] = useState(false);

  // Check if device has biometric hardware
  useEffect(() => {
    async function checkBiometrics() {
      const hasHardware = await LocalAuthentication.hasHardwareAsync();
      setHasBiometricHardware(hasHardware);
    }
    checkBiometrics();
  }, []);

  async function pickImage() {
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: "images",
      quality: 0.8,
    });
    if (!res.canceled) {
      setLogo(res.assets[0].uri);
      console.log('Selected image URI:', res.assets[0].uri);
    }
  }

  function addTag() {
    const trimmed = tagInput.trim();
    if (trimmed && tags.length < 5 && !tags.includes(trimmed)) {
      setTags([...tags, trimmed]);
      setTagInput('');
    }
  }

  // Function to handle passcode button press
  const handlePasscodePress = (num: string) => {
    if (passcode.length < 6) {
      setPasscode(prev => prev + num);
    }
  };

  // Function to handle backspace
  const handleBackspace = () => {
    setPasscode(prev => prev.slice(0, -1));
  };

  async function handleCreateGarden() {
    try {
      setLoading(true);
      
      // 1. Create the garden with the logo
      const result = await createGardenWithMembership({
        name,
        creatorId,
        description,
        tags,
        logo: logo || undefined,
      });
      
      const gardenId = result.garden.id;
      
      // Reset state and close modal
      setLoading(false);
      onSuccess?.();
      onClose();
      
      // Navigate to the new garden
      router.push(`/garden/${gardenId}` as const);
    } catch (err) {
      setLoading(false);
      console.error('Garden creation error:', err);
      Alert.alert('Error', 'Failed to create garden. Please try again.');
    }
  }

  const PasscodeDigits = () => {
    return (
      <View style={styles.passcodeDisplay}>
        {[...Array(6)].map((_, i) => (
          <View 
            key={i} 
            style={[
              styles.passcodeDigit, 
              { borderColor: colors.primary },
              i < passcode.length && { backgroundColor: colors.primary }
            ]}
          />
        ))}
      </View>
    );
  };

  const PasscodeKeypad = () => {
    const numbers = [
      ['1', '2', '3'],
      ['4', '5', '6'],
      ['7', '8', '9'],
      ['', '0', 'del']
    ];

    return (
      <View style={styles.keypadContainer}>
        {numbers.map((row, rowIndex) => (
          <View key={`row-${rowIndex}`} style={styles.keypadRow}>
            {row.map((num, colIndex) => (
              <TouchableOpacity
                key={`key-${rowIndex}-${colIndex}`}
                style={[
                  styles.keypadButton,
                  { backgroundColor: colorScheme === 'dark' ? '#333' : '#f0f0f0' },
                  num === '' && { backgroundColor: 'transparent' }
                ]}
                onPress={() => {
                  if (num === 'del') {
                    handleBackspace();
                  } else if (num !== '') {
                    handlePasscodePress(num);
                  }
                }}
                disabled={num === ''}
              >
                {num === 'del' ? (
                  <Ionicons name="backspace" size={24} color={colors.text} />
                ) : (
                  <Text style={[styles.keypadText, { color: colors.text }]}>{num}</Text>
                )}
              </TouchableOpacity>
            ))}
          </View>
        ))}
      </View>
    );
  };

  const steps = [
    {
      title: 'Details',
      component: (
        <View>
          <Text style={[styles.label, { color: colors.text }]}>Garden Name</Text>
          <TextInput
            placeholder="My Awesome Garden"
            value={name}
            onChangeText={setName}
            placeholderTextColor={colors.secondaryText}
            style={[styles.input, { borderColor: colors.border, color: colors.text }]}
          />

          <Text style={[styles.label, { color: colors.text }]}>Description</Text>
          <TextInput
            placeholder="Describe your garden community"
            value={description}
            onChangeText={setDescription}
            placeholderTextColor={colors.secondaryText}
            style={[styles.input, { borderColor: colors.border, color: colors.text, height: 90 }]}
            multiline
          />

          <TouchableOpacity 
            style={[
              styles.primaryButton, 
              { backgroundColor: colors.primary },
              !name.trim() && { opacity: 0.5 }
            ]} 
            onPress={() => setCurrentStep(1)} 
            disabled={!name.trim()}
          >
            <Text style={[styles.buttonText, { color: colors.accent }]}>Next</Text>
          </TouchableOpacity>
        </View>
      ),
    },
    {
      title: 'Customize',
      component: (
        <View style={styles.subscriptionContainer}>
          {/* Logo */}
          <Text style={[styles.label, { color: colors.text }]}>Logo</Text>
          <TouchableOpacity style={[styles.logoPicker, { borderColor: colors.border }]} onPress={pickImage}>
            {logo ? (
              <Image source={{ uri: logo }} style={styles.logoImage} />
            ) : (
              <Ionicons name="camera" size={32} color={colors.secondaryText} />
            )}
          </TouchableOpacity>

          {/* Tags */}
          <Text style={[styles.label, { color: colors.text }]}>Tags (max 5)</Text>
          <View style={styles.tagsContainer}>
            {tags.map((t) => (
              <View key={t} style={[styles.tagChip, { backgroundColor: colors.surface }]}>
                <Text style={{ color: colors.text }}>{t}</Text>
                <Ionicons
                  name="close"
                  size={14}
                  color={colors.secondaryText}
                  style={styles.removeIcon}
                  onPress={() => setTags(tags.filter(tag => tag !== t))}
                />
              </View>
            ))}
          </View>
          <TextInput
            placeholder="Add tag and press enter"
            value={tagInput}
            onChangeText={setTagInput}
            onSubmitEditing={addTag}
            placeholderTextColor={colors.secondaryText}
            style={[styles.input, { borderColor: colors.border, color: colors.text }]}
          />

          <TouchableOpacity style={[styles.primaryButton, { backgroundColor: colors.primary }]} onPress={() => setCurrentStep(2)}>
            <Text style={[styles.buttonText, { color: colors.accent }]}>Next</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.backButton} onPress={() => setCurrentStep(0)}>
            <Ionicons name="arrow-back" size={20} color={colors.primary} />
            <Text style={[styles.backText, { color: colors.primary }]}>Back</Text>
          </TouchableOpacity>
        </View>
      ),
    },
    {
      title: 'Biometrics',
      component: (
        <View style={styles.securityContainer}>
          <View style={styles.biometricsContent}>
            <Ionicons 
              name="finger-print" 
              size={120} 
              color={colors.primary}
              style={styles.biometricIcon}
            />
            
            <Text style={[styles.securityTitle, { color: colors.text }]}>
              Enable Biometric Access
            </Text>
            
            <Text style={[styles.securityDescription, { color: colors.secondaryText }]}>
              {hasBiometricHardware 
                ? "Use your fingerprint or face recognition for quick access to your garden"
                : "Your device doesn't support biometric authentication"}
            </Text>
            
            <TouchableOpacity
              style={[
                styles.primaryButton, 
                { 
                  backgroundColor: hasBiometricHardware ? colors.primary : colors.border,
                  marginTop: 40
                }
              ]}
              onPress={() => {
                setEnableBiometrics(true);
                setCurrentStep(3);
              }}
              disabled={!hasBiometricHardware}
            >
              <Text style={[styles.buttonText, { color: hasBiometricHardware ? colors.accent : colors.secondaryText }]}>
                Enable Biometrics
              </Text>
            </TouchableOpacity>
            
            <TouchableOpacity
              style={[styles.secondaryButton, { borderColor: colors.primary }]}
              onPress={() => {
                setEnableBiometrics(false);
                setCurrentStep(3);
              }}
            >
              <Text style={[styles.secondaryButtonText, { color: colors.primary }]}>
                {hasBiometricHardware ? "Skip This Step" : "Continue"}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      ),
    },
    {
      title: 'Passcode',
      component: (
        <View style={styles.securityContainer}>
          <View style={styles.passcodeContent}>
            <Text style={[styles.securityTitle, { color: colors.text }]}>
              Create Passcode
            </Text>
            
            <Text style={[styles.securityDescription, { color: colors.secondaryText }]}>
              Set a 6-digit passcode to protect access to your garden
            </Text>
            
            <PasscodeDigits />
            <PasscodeKeypad />
            
            <TouchableOpacity
              style={[
                styles.primaryButton, 
                { 
                  backgroundColor: colors.primary,
                  opacity: passcode.length === 6 ? 1 : 0.5
                }
              ]}
              onPress={() => setCurrentStep(4)}
              disabled={passcode.length !== 6}
            >
              <Text style={[styles.buttonText, { color: colors.accent }]}>
                Set Passcode
              </Text>
            </TouchableOpacity>
            
            <TouchableOpacity
              style={[styles.secondaryButton, { borderColor: colors.primary }]}
              onPress={() => {
                setPasscode('');
                setCurrentStep(4);
              }}
            >
              <Text style={[styles.secondaryButtonText, { color: colors.primary }]}>
                Skip Passcode
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      ),
    },
    {
      title: 'Finish',
      component: (
        <View style={styles.subscriptionContainer}>
          <Ionicons 
            name="checkmark-circle" 
            size={100} 
            color={colors.primary}
            style={{ alignSelf: 'center', marginBottom: 20 }}
          />
          
          <Text style={[styles.securityTitle, { color: colors.text, textAlign: 'center' }]}>
            Ready to Create Your Garden!
          </Text>
          
          <Text style={[styles.securityDescription, { color: colors.secondaryText, textAlign: 'center', marginBottom: 40 }]}>
            Your garden will be created with the following security settings:
            {enableBiometrics ? "\n• Biometric authentication enabled" : ""}
            {passcode.length === 6 ? "\n• Passcode protection enabled" : ""}
            {!enableBiometrics && passcode.length !== 6 ? "\n• No security features enabled" : ""}
          </Text>
          
          <TouchableOpacity
            style={[styles.primaryButton, { backgroundColor: colors.primary }]}
            onPress={handleCreateGarden}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color={colors.accent} />
            ) : (
              <Text style={[styles.buttonText, { color: colors.accent }]}>Create Garden</Text>
            )}
          </TouchableOpacity>
        </View>
      ),
    }
  ];

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        {/* Header */}
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <TouchableOpacity onPress={onClose} style={styles.closeButton}>
            <Ionicons name="close" size={24} color={colors.text} />
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: colors.text }]}>Create Garden</Text>
          <View style={{ width: 24 }} />
        </View>

        <Stepper steps={steps} currentStep={currentStep} colors={colors} />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  closeButton: {
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
  },
  label: {
    marginTop: 24,
    marginBottom: 8,
    fontSize: 14,
    fontWeight: '500',
  },
  input: {
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
  },
  primaryButton: {
    marginTop: 20,
    paddingVertical: 16,
    borderRadius: 8,
    alignItems: 'center',
  },
  secondaryButton: {
    marginTop: 12,
    paddingVertical: 16,
    borderRadius: 8,
    alignItems: 'center',
    borderWidth: 1,
  },
  secondaryButtonText: {
    fontSize: 16,
    fontWeight: '500',
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '600',
  },
  subscriptionContainer: {
    flex: 1,
    justifyContent: 'center',
    paddingTop: 24,
    paddingHorizontal: 16,
  },
  securityContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  biometricsContent: {
    width: '100%',
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  passcodeContent: {
    width: '100%',
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  biometricIcon: {
    marginBottom: 24,
  },
  securityTitle: {
    fontSize: 24,
    fontWeight: '700',
    marginBottom: 12,
  },
  securityDescription: {
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 20,
    lineHeight: 22,
  },
  subtitle: {
    fontSize: 20,
    fontWeight: '700',
    textAlign: 'center',
  },
  description: {
    fontSize: 14,
    textAlign: 'center',
    marginTop: 8,
  },
  loading: {
    marginVertical: 24,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 24,
    alignSelf: 'center',
  },
  backText: {
    marginLeft: 4,
    fontSize: 16,
    fontWeight: '500',
  },
  logoPicker: {
    width: 120,
    height: 120,
    borderRadius: 60,
    borderWidth: 2,
    borderStyle: 'dashed',
    justifyContent: 'center',
    alignItems: 'center',
    alignSelf: 'center',
    marginVertical: 12,
  },
  logoImage: {
    width: 120,
    height: 120,
    borderRadius: 60,
  },
  tagsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 8,
  },
  tagChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 16,
    marginRight: 4,
    marginBottom: 4,
  },
  removeIcon: { 
    marginLeft: 4 
  },
  // Passcode styles
  passcodeDisplay: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginVertical: 24,
  },
  passcodeDigit: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1,
    margin: 8,
  },
  keypadContainer: {
    width: '100%',
    maxWidth: 300,
    marginBottom: 20,
  },
  keypadRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  keypadButton: {
    width: 70,
    height: 70,
    borderRadius: 35,
    justifyContent: 'center',
    alignItems: 'center',
  },
  keypadText: {
    fontSize: 28,
    fontWeight: '500',
  },
}); 