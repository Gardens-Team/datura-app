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
  ScrollView,
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
  const [selectedAuthMethod, setSelectedAuthMethod] = useState<'biometrics' | 'passcode' | null>(null);
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
      
      // Pass the selected auth method and passcode to the service function
      const result = await createGardenWithMembership({
        name,
        creatorId,
        description,
        tags,
        logo: logo || undefined,
        authMethod: selectedAuthMethod, // Pass selected method
        passcode: selectedAuthMethod === 'passcode' ? passcode : undefined, // Pass passcode only if selected
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

  const isSecurityStepComplete = () => {
    if (!selectedAuthMethod) return false;
    if (selectedAuthMethod === 'biometrics') return true;
    if (selectedAuthMethod === 'passcode') return passcode.length === 6;
    return false;
  };

  const steps = [
    {
      title: 'Details',
      component: (
        <View style={styles.stepContainer}>
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
        <View style={styles.stepContainer}>
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
      title: 'Security',
      component: (
        <ScrollView 
          style={styles.stepContainer} 
          contentContainerStyle={styles.scrollContentContainer}
          keyboardShouldPersistTaps="handled" // Allow taps outside TextInput
        >
          <Text style={[styles.securityTitle, { color: colors.text }]}>
            Secure Your Garden
          </Text>
          <Text style={[styles.securityDescription, { color: colors.secondaryText, marginBottom: 30 }]}>
            Choose how you want to protect access. This is required.
          </Text>

          <View style={styles.authSelectionContainer}>
            {/* Biometrics Card */}
            <TouchableOpacity
              style={[
                styles.authCard,
                { borderColor: selectedAuthMethod === 'biometrics' ? colors.primary : colors.border },
                !hasBiometricHardware && { opacity: 0.5, backgroundColor: colors.border },
              ]}
              onPress={() => hasBiometricHardware && setSelectedAuthMethod('biometrics')}
              disabled={!hasBiometricHardware}
            >
              <Ionicons name="finger-print" size={40} color={selectedAuthMethod === 'biometrics' ? colors.primary : colors.text} />
              <Text style={[styles.authCardTitle, { color: selectedAuthMethod === 'biometrics' ? colors.primary : colors.text }]}>
                Biometrics
              </Text>
              <Text style={[styles.authCardDescription, { color: colors.secondaryText }]}>
                Fingerprint or Face ID
              </Text>
            </TouchableOpacity>

            {/* Passcode Card */}
            <TouchableOpacity
              style={[
                styles.authCard,
                { borderColor: selectedAuthMethod === 'passcode' ? colors.primary : colors.border }
              ]}
              onPress={() => setSelectedAuthMethod('passcode')}
            >
              <Ionicons name="keypad" size={40} color={selectedAuthMethod === 'passcode' ? colors.primary : colors.text} />
              <Text style={[styles.authCardTitle, { color: selectedAuthMethod === 'passcode' ? colors.primary : colors.text }]}>
                Passcode
              </Text>
              <Text style={[styles.authCardDescription, { color: colors.secondaryText }]}>
                6-digit code
              </Text>
            </TouchableOpacity>
          </View>

          {/* Conditional Passcode Setup */}
          {selectedAuthMethod === 'passcode' && (
            <View style={styles.passcodeSetupContainer}>
              <Text style={[styles.label, { color: colors.text, textAlign: 'center' }]}>Enter a 6-digit passcode</Text>
              <PasscodeDigits />
              <PasscodeKeypad />
            </View>
          )}

          {selectedAuthMethod === 'biometrics' && hasBiometricHardware && (
             <Text style={[styles.confirmationText, { color: colors.primary }]}>
              Biometric authentication enabled. Your device will prompt you when needed.
            </Text>
          )}
           {!hasBiometricHardware && selectedAuthMethod === 'biometrics' && (
             <Text style={[styles.confirmationText, { color: colors.error }]}>
               Biometrics not available on this device. Please choose Passcode.
            </Text>
          )}


          <TouchableOpacity
            style={[
              styles.primaryButton,
              { backgroundColor: colors.primary },
              !isSecurityStepComplete() && { opacity: 0.5 }
            ]}
            onPress={() => setCurrentStep(3)}
            disabled={!isSecurityStepComplete()}
          >
            <Text style={[styles.buttonText, { color: colors.accent }]}>Next</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.backButton} onPress={() => setCurrentStep(1)}>
            <Ionicons name="arrow-back" size={20} color={colors.primary} />
            <Text style={[styles.backText, { color: colors.primary }]}>Back</Text>
          </TouchableOpacity>
        </ScrollView>
      ),
    },
    {
      title: 'Finish',
      component: (
        <View style={styles.stepContainer}>
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
            Your garden will be created with the following security:
            {selectedAuthMethod === 'biometrics' ? "\n• Biometric authentication" : ""}
            {selectedAuthMethod === 'passcode' ? "\n• Passcode protection" : ""}
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

           <TouchableOpacity style={styles.backButton} onPress={() => setCurrentStep(2)}>
            <Ionicons name="arrow-back" size={20} color={colors.primary} />
            <Text style={[styles.backText, { color: colors.primary }]}>Back</Text>
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

        {/* Pass the current step content directly */}
        <View style={styles.contentContainer}>
          <Stepper steps={steps} currentStep={currentStep} colors={colors} />
        </View>

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
    padding: 4, // Easier to tap
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
  },
  contentContainer: {
    flex: 1,
    paddingTop: 16, // Give stepper some space
  },
  stepContainer: {
    flex: 1,
    paddingHorizontal: 20,
    paddingBottom: 20, // Space for buttons at the bottom
  },
  scrollContentContainer: { // Style for ScrollView content
    paddingBottom: 40, // Ensure space below buttons when scrolling
  },
  label: {
    marginTop: 16, // Consistent spacing
    marginBottom: 8,
    fontSize: 14,
    fontWeight: '500',
  },
  input: {
    borderWidth: 1,
    borderRadius: 8, // Slightly more rounded
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    marginBottom: 10, // Space below inputs
  },
  primaryButton: {
    marginTop: 24, // More space above buttons
    paddingVertical: 14, // Slightly smaller padding
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center', // Center content vertically
    minHeight: 48, // Ensure tappable height
  },
  secondaryButton: {
    marginTop: 12,
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5, // Slightly thicker border
    minHeight: 48,
  },
  secondaryButtonText: {
    fontSize: 16,
    fontWeight: '500',
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '600',
  },
  passcodeContent: { // Re-purposed for passcode setup area
    width: '100%',
    alignItems: 'center',
    marginTop: 20, // Space above passcode setup
  },
  securityTitle: {
    fontSize: 22, // Slightly smaller title
    fontWeight: '600', // Less bold
    marginBottom: 8,
    textAlign: 'center', // Center align titles
  },
  securityDescription: {
    fontSize: 15, // Slightly smaller description
    textAlign: 'center',
    marginBottom: 20,
    lineHeight: 21, // Adjust line height
  },
  loading: {
    marginVertical: 24,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 16, // Consistent spacing
    alignSelf: 'center',
    padding: 8, // Make it easier to tap
  },
  backText: {
    marginLeft: 4,
    fontSize: 15,
    fontWeight: '500',
  },
  logoPicker: {
    width: 100, // Slightly smaller logo
    height: 100,
    borderRadius: 50,
    borderWidth: 1.5, // Thinner border
    borderStyle: 'dashed',
    justifyContent: 'center',
    alignItems: 'center',
    alignSelf: 'center',
    marginVertical: 16, // More vertical space
  },
  logoImage: {
    width: 100,
    height: 100,
    borderRadius: 50,
  },
  tagsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 8,
    marginBottom: 8, // Space below tags
  },
  tagChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10, // More horizontal padding
    paddingVertical: 5, // More vertical padding
    borderRadius: 16,
    marginRight: 6,
    marginBottom: 6, // Consistent spacing
  },
  removeIcon: { 
    marginLeft: 6 // More space for remove icon
  },
  passcodeDisplay: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginVertical: 20, // Adjusted spacing
  },
  passcodeDigit: {
    width: 18, // Smaller digits
    height: 18,
    borderRadius: 9,
    borderWidth: 1.5, // Thicker border
    marginHorizontal: 6, // Adjusted spacing
  },
  keypadContainer: {
    width: '100%',
    maxWidth: 280, // Slightly smaller keypad
    alignSelf: 'center', // Center keypad
    marginTop: 10, // Space above keypad
  },
  keypadRow: {
    flexDirection: 'row',
    justifyContent: 'space-around', // Space out keys evenly
    marginBottom: 12, // Adjusted spacing
  },
  keypadButton: {
    width: 65, // Smaller keys
    height: 65,
    borderRadius: 32.5,
    justifyContent: 'center',
    alignItems: 'center',
  },
  keypadText: {
    fontSize: 26, // Smaller text
    fontWeight: '400', // Normal weight
  },
  authSelectionContainer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    width: '100%',
    marginBottom: 20,
  },
  authCard: {
    width: '45%', // Adjust width for spacing
    aspectRatio: 1, // Make cards square
    borderWidth: 1.5,
    borderRadius: 12,
    padding: 15,
    alignItems: 'center',
    justifyContent: 'center', // Center content
  },
  authCardTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginTop: 10,
    marginBottom: 4,
  },
  authCardDescription: {
    fontSize: 13,
    textAlign: 'center',
  },
  passcodeSetupContainer: {
    width: '100%',
    alignItems: 'center',
    marginTop: 10, // Add space when keypad appears
  },
  confirmationText: {
    marginTop: 15,
    fontSize: 14,
    textAlign: 'center',
    fontWeight: '500',
  }
}); 