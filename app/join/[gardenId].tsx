import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  Image,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  Alert,
  Pressable,
  Modal,
  SafeAreaView,
  Button,
} from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import {
  enableGardenBiometrics,
  setGardenPasscode,
  joinGarden,
  requestGardenMembership,
  decryptGardenImage,
  getGroupKeyForGarden,
  joinGardenWithVerifiedPasscode,
} from '@/services/garden-service';
import { supabase } from '@/services/supabase-singleton';
import * as Linking from 'expo-linking';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useAuth } from '@/providers/AuthProvider';
import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import { getStoredPrivateKey } from '@/utils/provisioning';
import { registerForPushNotifications } from '@/services/notifications-service';
import * as Crypto from 'expo-crypto';

// Keep only the imports we need for the authentication modal
const PASSCODE_KEY = 'user_passcode';
const FINGERPRINT_SIZE = 100; // Increased size for better visibility

// Define types for the security setup method
type SecurityMethod = 'biometrics' | 'passcode' | null;

export default function JoinGardenScreen() {
  const { gardenId } = useLocalSearchParams<{ gardenId: string }>();
  const { user } = useCurrentUser();
  const [garden, setGarden] = useState<any>(null);
  const [step, setStep] = useState(1); // Step 1: Welcome, Step 2: Security, Step 3: Request, Step 4: Pending
  const [passcode, setPasscode] = useState('');
  const [loading, setLoading] = useState(false);
  const [biometricsEnabled, setBiometricsEnabled] = useState(false); // Tracks if biometrics were successfully enabled in this session
  const [passcodeSet, setPasscodeSet] = useState(false); // Tracks if passcode was successfully set in this session
  const [biometricsAvailable, setBiometricsAvailable] = useState(false); // Tracks if device hardware is compatible and enrolled
  const [securityMethod, setSecurityMethod] = useState<SecurityMethod>(null); // Tracks user choice in Step 2
  const [securitySetupComplete, setSecuritySetupComplete] = useState(false); // Tracks if either biometrics or passcode setup is done
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const [decryptedLogoUri, setDecryptedLogoUri] = useState<string | null>(null);
  const [requestSent, setRequestSent] = useState(false);
  
  // Log garden ID from route params
  useEffect(() => {
    console.log('Garden ID from route params:', gardenId);
  }, [gardenId]);
  
  // Auth modal states
  const [showAuthModal, setShowAuthModal] = useState(false);
  const { authenticate, authenticateWithPasscode } = useAuth();

  // Check if biometrics are available
  useEffect(() => {
    async function checkBiometrics() {
      try {
        const [compatible, enrolled] = await Promise.all([
          LocalAuthentication.hasHardwareAsync(),
          LocalAuthentication.isEnrolledAsync()
        ]);
        setBiometricsAvailable(compatible && enrolled);
      } catch (error) {
        console.error('Biometrics check error:', error);
        setBiometricsAvailable(false);
      }
    }
    checkBiometrics();
  }, []);

  // Fetch garden metadata
  useEffect(() => {
    async function fetchGarden() {
      try {
        const { data, error } = await supabase
          .from('gardens')
          .select('*')  // Select all columns to get complete garden data
          .eq('id', gardenId)
          .single();
          
        if (error) {
          console.error('Error fetching garden data:', error);
          return;
        }
        
        console.log('Garden data fetched:', data);
        setGarden(data);
        
        // Try to decrypt the garden logo if it exists
        if (data?.logo) {
          // Skip local file paths
          if (data.logo.startsWith('file://')) {
            console.warn('Garden has local file logo that is not accessible:', data.logo);
            return;
          }
          
          try {
            // Get the garden's creator membership to access the group key
            const { data: creatorMembership, error: membershipError } = await supabase
              .from('memberships')
              .select('encrypted_group_key')
              .eq('garden_id', gardenId)
              .eq('role', 'creator')
              .single();
              
            if (membershipError || !creatorMembership?.encrypted_group_key) {
              console.error('Could not find creator membership:', membershipError);
              return;
            }
            
            // Get user's private key
            const privateKeyBase64 = await getStoredPrivateKey();
            if (!privateKeyBase64) {
              console.error('Private key not available for logo decryption');
              return;
            }
            
            // A real implementation would decrypt the encrypted_group_key with the user's private key
            // For demonstration, we'll use a direct approach to get the garden key
            const groupKeyBase64 = await getGroupKeyForGarden(gardenId);
            
            // Decrypt the logo
            const base64Data = await decryptGardenImage(data.logo, groupKeyBase64);
            if (base64Data) {
              // Create a data URL from the base64 image
              const dataUrl = `data:image/png;base64,${base64Data}`;
              console.log('Setting decrypted logo URI');
              setDecryptedLogoUri(dataUrl);
            } else {
              console.error('Decryption returned empty data');
            }
          } catch (decryptError) {
            console.error('Error decrypting garden logo:', decryptError);
          }
        } else {
          console.log('Garden has no logo');
        }
      } catch (error) {
        console.error('Failed to fetch garden data:', error);
      }
    }
    
    if (gardenId) {
      fetchGarden();
    }
  }, [gardenId]);
  
  // Debug garden data
  useEffect(() => {
    if (garden) {
      console.log('Garden state updated:', garden);
      if (garden.logo) {
        console.log('Garden logo URL:', garden.logo);
        // Check if this is a local file path that won't work for other users
        if (garden.logo.startsWith('file://')) {
          console.warn('Garden logo is using a local file path which is not accessible to other users', {
            gardenId: garden.id,
            gardenName: garden.name,
            logoUrl: garden.logo
          });
        }
        try {
          // Validate that the logo URL is properly formatted
          new URL(garden.logo);
        } catch (e) {
          console.error('Invalid garden logo URL format:', e);
        }
      } else {
        console.log('No garden logo available');
      }
    }
  }, [garden]);

  // Step 1: Welcome & logos
  const Step1 = () => {
    console.log('Garden state:', garden);
    console.log('Decrypted logo URI:', decryptedLogoUri ? 'Available' : 'Not available');
    
    return (
    <View style={styles.stepContainer}>
      <Text style={[styles.title, { color: colors.text }]}>You're invited!</Text>
      <View style={styles.logosRow}>
        {user?.profile_pic ? (
          <Image source={{ uri: user.profile_pic }} style={styles.avatar} />
        ) : (
          <View style={[styles.avatar, { backgroundColor: colors.primary, justifyContent: 'center', alignItems: 'center' }]}>
            <Ionicons name="person" size={32} color="white" />
          </View>
        )}
        <Text style={[styles.arrow, { color: colors.text }]}>➔</Text>
        {decryptedLogoUri ? (
          <Image 
            source={{ uri: decryptedLogoUri }} 
            style={styles.avatar}
            onLoadStart={() => console.log('Garden logo loading started')}
            onLoad={() => console.log('Decrypted garden logo loaded successfully')}
            onError={(e) => {
              console.error('Failed to load decrypted garden image:', e.nativeEvent.error);
              // If there's an error loading the decrypted image, fall back to the initials
              setDecryptedLogoUri(null);
            }} 
          />
        ) : (
          <View style={[styles.avatar, { backgroundColor: colors.secondaryText, justifyContent: 'center', alignItems: 'center' }]}>
            <Text style={{ color: 'white', fontSize: 24, fontWeight: '600' }}>
              {garden?.name?.charAt(0) ?? '?'}
            </Text>
          </View>
        )}
      </View>
      <Text style={[styles.subtitle, { color: colors.secondaryText }]}>Join {garden?.name || 'Garden'}</Text>
      <TouchableOpacity
        style={[styles.button, { backgroundColor: colors.primary }]}
        onPress={() => {
          // Always go to Step 2 (Security Setup)
          setStep(2);
        }}
      >
        <Text style={styles.buttonText}>Next</Text>
      </TouchableOpacity>
    </View>
  );
};

// --- Combined Step 2: Setup Security (Biometrics or Passcode) ---
const Step2 = () => {
  const [step2Loading, setStep2Loading] = useState(false);

  // Function to handle Biometrics setup
  const handleEnableBiometrics = useCallback(async () => {
    if (!user) {
      Alert.alert('Error', 'User not found.');
      return;
    }

    setStep2Loading(true);
    try {
      // Authenticate with biometrics
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Authenticate to setup biometric access',
        disableDeviceFallback: false, // Allow fallback to device passcode if biometrics fail/aren't set
      });

      if (result.success) {
        try {
          // Enable biometrics in the backend (creates/updates membership)
          await enableGardenBiometrics(gardenId!, user.id);
          setBiometricsEnabled(true); // Track success for this session
          setSecuritySetupComplete(true); // Mark security as complete
          console.log('Biometrics enabled successfully');
        } catch (error) {
          console.error('Error enabling biometrics in backend:', error);
          Alert.alert('Error', 'Could not enable biometrics. Please try again or use a passcode.');
          setBiometricsEnabled(false);
          setSecuritySetupComplete(false);
        }
      } else {
        Alert.alert(
          'Authentication Failed',
          'Unable to verify biometrics. You can try again or use a passcode.',
          [{ text: 'OK', style: 'default' }]
        );
        setSecuritySetupComplete(false);
      }
    } catch (error) {
      console.error('Biometrics Authentication error:', error);
      Alert.alert(
        'Authentication Error',
        'An error occurred during biometric authentication. Please try again or use a passcode.',
        [{ text: 'OK' }]
      );
      setSecuritySetupComplete(false);
    } finally {
      setStep2Loading(false);
    }
  }, [gardenId, user]);

  // Function to handle Passcode setup
  const handleSetPasscode = useCallback(async () => {
    if (passcode.length !== 6) {
      Alert.alert('Invalid Passcode', 'Please enter a 6-digit passcode');
      return;
    }
    if (!user) {
      Alert.alert('Error', 'User not found.');
      return;
    }

    setStep2Loading(true);
    try {
      // Set passcode in the backend (creates/updates membership)
      await setGardenPasscode(gardenId!, user.id, passcode);
      setPasscodeSet(true); // Track success for this session
      setSecuritySetupComplete(true); // Mark security as complete
      console.log('Passcode set successfully');
    } catch (error) {
      console.error('Passcode setup error:', error);
      Alert.alert('Error', 'Failed to set passcode. Please try again.');
      setPasscodeSet(false);
      setSecuritySetupComplete(false);
    } finally {
      setStep2Loading(false);
    }
  }, [gardenId, user, passcode]);

  // Function to render the Dialpad (moved from old Step 3)
  const renderDialpad = () => {
    const numbers = [
      ['1', '2', '3'],
      ['4', '5', '6'],
      ['7', '8', '9'],
      ['', '0', 'DEL']
    ];

    return (
      <View style={styles.dialpadContainer}>
        {numbers.map((row, rowIndex) => (
          <View key={`row-${rowIndex}`} style={styles.dialpadRow}>
            {row.map((num, colIndex) => (
              <Pressable
                key={`key-step2-${rowIndex}-${colIndex}`}
                style={({pressed}) => [
                  styles.dialpadKey,
                  {
                    backgroundColor: pressed
                      ? colors.primary + '30'
                      : colorScheme === 'dark' ? '#2C2C2E' : '#F2F2F7',
                    opacity: num === '' ? 0 : 1
                  }
                ]}
                onPress={() => {
                  if (num === 'DEL') {
                    setPasscode(prev => prev.slice(0, -1));
                  } else if (passcode.length < 6) {
                    setPasscode(prev => prev + num);
                  }
                }}
                disabled={num === '' || step2Loading || securitySetupComplete} // Disable dialpad after setup complete
              >
                {num === 'DEL' ? (
                  <Ionicons name="backspace-outline" size={24} color={colors.text} />
                ) : (
                  <Text style={[styles.dialpadKeyText, { color: colors.text }]}>{num}</Text>
                )}
              </Pressable>
            ))}
          </View>
        ))}
      </View>
    );
  };

  return (
    <View style={styles.stepContainer}>
      <Text style={[styles.title, { color: colors.text }]}>Setup Security</Text>
      <Text style={[styles.subtitle, { color: colors.secondaryText }]}>
        Secure access to this garden using Biometrics or a Passcode.
      </Text>

      {/* Security Method Choice */}
      {!securityMethod && !securitySetupComplete && (
        <View style={styles.choiceContainer}>
          {biometricsAvailable && (
            <TouchableOpacity
              style={[styles.button, { backgroundColor: colors.primary }]}
              onPress={() => setSecurityMethod('biometrics')}
              disabled={step2Loading}
            >
              <Text style={styles.buttonText}>Use Biometrics</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={[styles.button, { backgroundColor: biometricsAvailable ? colors.accent : colors.primary }]}
            onPress={() => setSecurityMethod('passcode')}
            disabled={step2Loading}
          >
            <Text style={styles.buttonText}>Set Passcode</Text>
          </TouchableOpacity>
          {/* Option to go back to Step 1 */}
           <TouchableOpacity
            style={[styles.buttonOutlined, { borderColor: colors.primary, marginTop: 12 }]}
            onPress={() => setStep(1)}
            disabled={step2Loading}
          >
            <Text style={[styles.buttonTextOutlined, { color: colors.primary }]}>Back</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Biometrics Setup UI */}
      {securityMethod === 'biometrics' && !securitySetupComplete && (
        <View style={styles.securityMethodContainer}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Enable Biometrics</Text>
          <View style={styles.biometricsContainer}>
            <View style={[styles.fingerprintCircle, {
              backgroundColor: colors.primary + '15'
            }]}>
              <View style={styles.fingerprintInnerContainer}>
                <Ionicons name="finger-print" size={FINGERPRINT_SIZE} color={colors.primary} />
                <View style={[styles.fingerprintPulse, { borderColor: colors.primary + '50' }]} />
                <View style={[styles.fingerprintPulse, styles.fingerprintPulse2, { borderColor: colors.primary + '30' }]} />
              </View>
            </View>
            <Text style={[styles.fingerprintText, { color: colors.secondaryText }]}>
              Tap button below to Authenticate
            </Text>
          </View>

          <TouchableOpacity
            style={[styles.button, { backgroundColor: colors.primary }]}
            onPress={handleEnableBiometrics}
            disabled={step2Loading}
          >
            {step2Loading ? <ActivityIndicator color="white" /> : <Text style={styles.buttonText}>Enable Biometrics</Text>}
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.buttonOutlined, { borderColor: colors.primary }]}
            onPress={() => setSecurityMethod(null)} // Go back to choice
            disabled={step2Loading}
          >
            <Text style={[styles.buttonTextOutlined, { color: colors.primary }]}>Choose Other Method</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Passcode Setup UI */}
      {securityMethod === 'passcode' && !securitySetupComplete && (
        <View style={styles.securityMethodContainer}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Set Passcode</Text>
          <Text style={[styles.subtitle, { color: colors.secondaryText, marginBottom: 10 }]}>
            Create a 6-digit passcode
          </Text>

          <View style={styles.passcodeDotsContainer}>
            {[...Array(6)].map((_, index) => (
              <View
                key={`dot-${index}`}
                style={[
                  styles.passcodeDot,
                  {
                    backgroundColor: index < passcode.length ? colors.primary : 'transparent',
                    borderColor: colors.primary
                  }
                ]}
              />
            ))}
          </View>

          {renderDialpad()}

          <TouchableOpacity
            style={[
              styles.button,
              {
                backgroundColor: passcode.length === 6 ? colors.primary : colors.secondaryText,
                marginTop: 24
              }
            ]}
            onPress={handleSetPasscode}
            disabled={step2Loading || passcode.length !== 6}
          >
            {step2Loading ? <ActivityIndicator color="white" /> : <Text style={styles.buttonText}>Set Passcode</Text>}
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.buttonOutlined, { borderColor: colors.primary }]}
            onPress={() => {
              setPasscode(''); // Clear passcode input
              setSecurityMethod(null); // Go back to choice
            }}
            disabled={step2Loading}
          >
            <Text style={[styles.buttonTextOutlined, { color: colors.primary }]}>Choose Other Method</Text>
          </TouchableOpacity>
        </View>
      )}

       {/* Confirmation and Continue Button */}
      {securitySetupComplete && (
        <View style={styles.confirmationContainer}>
           <Ionicons
             name={biometricsEnabled ? "finger-print" : "lock-closed"}
             size={60}
             color={colors.success}
             style={{ marginBottom: 16 }}
           />
          <Text style={[styles.sectionTitle, { color: colors.text, marginBottom: 8 }]}>
            {biometricsEnabled ? 'Biometrics Enabled' : 'Passcode Set'}
          </Text>
          <Text style={[styles.subtitle, { color: colors.secondaryText }]}>
            Your security method is ready.
          </Text>
          <TouchableOpacity
            style={[styles.button, { backgroundColor: colors.primary, marginTop: 24 }]}
            onPress={() => setStep(3)} // Proceed to Step 3 (Request Join)
          >
            <Text style={styles.buttonText}>Continue</Text>
          </TouchableOpacity>
         {/* Optional: Allow changing method even after completion? Maybe not needed. */}
         {/* <TouchableOpacity
            style={[styles.buttonOutlined, { borderColor: colors.primary, marginTop: 12 }]}
             onPress={() => {
               setSecuritySetupComplete(false);
               setSecurityMethod(null);
               setPasscode('');
               setBiometricsEnabled(false);
               setPasscodeSet(false);
             }}
           >
             <Text style={[styles.buttonTextOutlined, { color: colors.primary }]}>Change Method</Text>
           </TouchableOpacity> */}
        </View>
      )}
    </View>
  );
};

// --- Step 3 (formerly Step 4): Submit membership request ---
const Step3 = () => {
  const [gardenPasscode, setGardenPasscode] = useState('');
  const [gardenPasscodeError, setGardenPasscodeError] = useState<string | null>(null);
  const [isVerifyingPasscode, setIsVerifyingPasscode] = useState(false);
  const accessType = garden?.access_type || 'request_access'; // Default to "apply" for backward compatibility
  const [isProvisioning, setIsProvisioning] = useState(false);
  const [provisioningProgress, setProvisioningProgress] = useState(0);

  // Handle direct join for open gardens
  useEffect(() => {
    if (accessType === 'open' && user) {
      handleOpenAccess();
    }
  }, [accessType, user]);

  // Handle open access - automatically join the garden
  const handleOpenAccess = async () => {
    if (!user) return;
    
    setLoading(true);
    try {
      console.log('Auto-joining open access garden', gardenId);
      await joinGarden(gardenId, user.id);
      router.replace(`/garden/${gardenId}`);
    } catch (error) {
      console.error('Failed to auto-join open garden:', error);
      Alert.alert('Error', 'Failed to join garden. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // Handle standard application request
  const handleRequestAccess = async () => {
    if (!user) return;
    
    setLoading(true);
    try {
      // Check if user has completed authentication setup
      const hasCompletedSetup = biometricsEnabled || passcodeSet;
      
      if (!hasCompletedSetup) {
        Alert.alert(
          'Setup Required',
          'Please complete the security setup before requesting to join the garden.',
          [{ text: 'Go Back', onPress: () => setStep(2) }]
        );
        return;
      }
      
      // Register for push notifications to ensure we have push tokens
      await registerForPushNotifications(user.id);
      
      // Request membership
      await requestGardenMembership(gardenId, user.id);
      
      // Move to pending screen
      setStep(4);
    } catch (error) {
      console.error('Membership request failed', error);
      Alert.alert('Error', error instanceof Error ? error.message : 'Failed to request garden membership');
    } finally {
      setLoading(false);
    }
  };

  // Modified passcode verification and join flow
  const handlePasscodeSubmit = async () => {
    if (!user || gardenPasscode.length !== 6) return;

    setIsVerifyingPasscode(true);
    try {
      // Hash the entered passcode for comparison
      const hashedPasscode = await Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256,
        gardenPasscode
      );

      // Fetch the garden's stored passcode hash
      const { data, error } = await supabase
        .from('gardens')
        .select('passcode_hash')
        .eq('id', gardenId)
        .single();

      if (error) throw error;

      // Compare the hashes
      if (data?.passcode_hash === hashedPasscode) {
        setIsVerifyingPasscode(false);
        
        // Show key provisioning UI
        setIsProvisioning(true);
        
        // Simulate progress updates (real progress is hard to track for crypto operations)
        const timer = setInterval(() => {
          setProvisioningProgress(prev => {
            const newProgress = prev + (Math.random() * 15);
            return newProgress > 95 ? 95 : newProgress;
          });
        }, 400);
        
        try {
          // Use our new specialized function
          await joinGardenWithVerifiedPasscode(gardenId, user.id);
          
          // Set to 100% complete
          clearInterval(timer);
          setProvisioningProgress(100);
          
          // Short delay to show 100% completion before navigating
          setTimeout(() => {
            router.replace(`/garden/${gardenId}`);
          }, 500);
        } catch (error) {
          clearInterval(timer);
          setIsProvisioning(false);
          console.error('Failed to join garden with verified passcode:', error);
          Alert.alert('Error', 'Failed to provision garden keys. Please try again.');
        }
      } else {
        // Incorrect passcode
        setGardenPasscodeError('Incorrect passcode. Please try again.');
        setGardenPasscode('');
        setIsVerifyingPasscode(false);
      }
    } catch (error) {
      console.error('Passcode verification error:', error);
      setGardenPasscodeError('Failed to verify passcode. Please try again.');
      setIsVerifyingPasscode(false);
    }
  };

  // Render garden passcode input UI
  const renderGardenPasscodeInput = () => {
    return (
      <View style={styles.passcodeContainer}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Garden Passcode</Text>
        <Text style={[styles.subtitle, { color: colors.secondaryText, marginBottom: 10 }]}>
          Enter the 6-digit passcode provided by the garden admin
        </Text>

        {gardenPasscodeError && (
          <Text style={[styles.errorText, { color: colors.error, marginBottom: 10 }]}>
            {gardenPasscodeError}
          </Text>
        )}

        <View style={styles.passcodeDotsContainer}>
          {[...Array(6)].map((_, index) => (
            <View
              key={`gkey-step3-${index}`}
              style={[
                styles.passcodeDot,
                {
                  backgroundColor: index < gardenPasscode.length ? colors.primary : 'transparent',
                  borderColor: colors.primary
                }
              ]}
            />
          ))}
        </View>

        <View style={styles.dialpadContainer}>
          {[
            ['1', '2', '3'],
            ['4', '5', '6'],
            ['7', '8', '9'],
            ['', '0', 'DEL']
          ].map((row, rowIndex) => (
            <View key={`grow-${rowIndex}`} style={styles.dialpadRow}>
              {row.map((num, colIndex) => (
                <Pressable
                  key={`gkey-step3-${rowIndex}-${colIndex}`}
                  style={({pressed}) => [
                    styles.dialpadKey,
                    {
                      backgroundColor: pressed
                        ? colors.primary + '30'
                        : colorScheme === 'dark' ? '#2C2C2E' : '#F2F2F7',
                      opacity: num === '' ? 0 : 1
                    }
                  ]}
                  onPress={() => {
                    if (num === 'DEL') {
                      setGardenPasscode(prev => prev.slice(0, -1));
                      setGardenPasscodeError(null);
                    } else if (gardenPasscode.length < 6) {
                      setGardenPasscode(prev => prev + num);
                      setGardenPasscodeError(null);
                    }
                  }}
                  disabled={num === '' || isVerifyingPasscode}
                >
                  {num === 'DEL' ? (
                    <Ionicons name="backspace-outline" size={24} color={colors.text} />
                  ) : (
                    <Text style={[styles.dialpadKeyText, { color: colors.text }]}>{num}</Text>
                  )}
                </Pressable>
              ))}
            </View>
          ))}
        </View>

        <TouchableOpacity
          style={[
            styles.button,
            {
              backgroundColor: gardenPasscode.length === 6 ? colors.primary : colors.secondaryText,
              marginTop: 24
            }
          ]}
          onPress={handlePasscodeSubmit}
          disabled={isVerifyingPasscode || gardenPasscode.length !== 6}
        >
          {isVerifyingPasscode ? <ActivityIndicator color="white" /> : <Text style={styles.buttonText}>Submit Passcode</Text>}
        </TouchableOpacity>
      </View>
    );
  };

  // Show loading indicator while setting up auto-join
  if (accessType === 'open' && loading) {
    return (
      <View style={styles.centeredContainer}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={[styles.subtitle, { color: colors.secondaryText, marginTop: 16 }]}>
          Joining garden...
        </Text>
      </View>
    );
  }

  // Add key provisioning UI that shows when isProvisioning is true
  if (isProvisioning) {
    return (
      <View style={styles.stepContainer}>
        <View style={styles.provisioningContainer}>
          <View style={[styles.provisioningCircle, { backgroundColor: colors.primary + '20' }]}>
            <Ionicons name="key" size={80} color={colors.primary} />
          </View>
          
          {/* Progress indicator */}
          <View style={styles.progressContainer}>
            <View 
              style={[
                styles.progressBar, 
                { backgroundColor: colors.border }
              ]}
            >
              <View 
                style={[
                  styles.progressBarFill, 
                  { 
                    backgroundColor: colors.primary,
                    width: `${provisioningProgress}%` 
                  }
                ]}
              />
            </View>
            <Text style={[styles.progressText, { color: colors.secondaryText }]}>
              {Math.round(provisioningProgress)}%
            </Text>
          </View>
        </View>
        
        <Text style={[styles.title, { color: colors.text }]}>Provisioning Secure Keys</Text>
        <Text style={[styles.subtitle, { color: colors.secondaryText }]}>
          Creating encrypted access keys for this garden. Please wait...
        </Text>
      </View>
    );
  }

  // Handle different UI based on access type
  if (accessType === 'passcode') {
    return (
      <View style={styles.stepContainer}>
        <Text style={[styles.title, { color: colors.text }]}>Join {garden?.name || 'Garden'}</Text>
        <Text style={[styles.subtitle, { color: colors.secondaryText, marginBottom: 16 }]}>
          This garden requires a passcode to join
        </Text>
        {renderGardenPasscodeInput()}
        <TouchableOpacity
          style={[styles.buttonOutlined, { borderColor: colors.primary, marginTop: 12 }]}
          onPress={() => setStep(2)}
        >
          <Text style={[styles.buttonTextOutlined, { color: colors.primary }]}>Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // Default UI for 'apply' access type
  return (
    <View style={styles.stepContainer}>
      <Text style={[styles.title, { color: colors.text }]}>Join {garden?.name || 'Garden'}</Text>
      <Text style={[styles.subtitle, { color: colors.secondaryText, marginBottom: 24 }]}>
        Request to join this garden. Garden admins will review your request.
      </Text>
      <TouchableOpacity
        style={[styles.button, { backgroundColor: colors.primary }]}
        onPress={handleRequestAccess}
        disabled={loading}
      >
        {loading
          ? <ActivityIndicator color="white" />
          : <Text style={styles.buttonText}>Request to Join</Text>
        }
      </TouchableOpacity>
      
      <TouchableOpacity
        style={[styles.buttonOutlined, { borderColor: colors.primary, marginTop: 12 }]}
        onPress={() => {
          if (!user) {
            // Redirect to auth screen if user not authenticated
            router.push('/auth');
          } else {
            // Go back to previous step (Security Setup)
            setStep(2);
          }
        }}
      >
        <Text style={[styles.buttonTextOutlined, { color: colors.primary }]}>
          {user ? "Back" : "Sign In"}
        </Text>
      </TouchableOpacity>
    </View>
  );
};

// --- Step 4 (formerly Step 5): Membership Pending ---
const Step4 = () => (
  <View style={styles.stepContainer}>
    <View style={styles.pendingContainer}>
      <View style={[styles.pendingCircle, { backgroundColor: colors.primary + '20' }]}>
        <Ionicons name="hourglass-outline" size={80} color={colors.primary} />
      </View>
    </View>
    
    <Text style={[styles.title, { color: colors.text }]}>Membership Pending</Text>
    <Text style={[styles.subtitle, { color: colors.secondaryText }]}>
      Your request to join {garden?.name || 'this garden'} has been sent. Garden admins will review your request and you'll be notified when approved.
    </Text>
    
    <TouchableOpacity
      style={[styles.button, { backgroundColor: colors.primary, marginTop: 24 }]}
      onPress={() => router.replace('/(tabs)/home')}
    >
      <Text style={styles.buttonText}>Return to Gardens</Text>
    </TouchableOpacity>
  </View>
);

// Auth Modal Component for inline authentication
const AuthModal = () => {
  const [authLoading, setAuthLoading] = useState(false);
  const [authPasscode, setAuthPasscode] = useState('');
  const [showPasscodeInput, setShowPasscodeInput] = useState(false);
  
  // Check if biometrics are available
  const [biometricsAvailable, setBiometricsAvailable] = useState(false);

  useEffect(() => {
    async function checkBiometrics() {
      try {
        const [compatible, enrolled] = await Promise.all([
          LocalAuthentication.hasHardwareAsync(),
          LocalAuthentication.isEnrolledAsync()
        ]);
        setBiometricsAvailable(compatible && enrolled);
      } catch (error) {
        console.error('Biometrics check error:', error);
      }
    }
    checkBiometrics();
  }, []);

  // Handle biometric authentication
  const handleBiometricAuth = async () => {
    try {
      setAuthLoading(true);
      await authenticate();
      
      // Give a small delay for auth context to update
      setTimeout(async () => {
        // We need to check if user is now available after authentication
        const updatedUser = user;
        
        if (updatedUser) {
          setShowAuthModal(false);
          
          // After authentication, we need to set up biometrics and passcode first
          // Redirect to step 2 to set those up before joining
          setStep(2);
        } else {
          // If authentication didn't result in a user, show passcode input
          setShowPasscodeInput(true);
        }
      }, 500);
    } catch (error) {
      console.error('Authentication error:', error);
      // If biometrics fail, show passcode input
      setShowPasscodeInput(true);
    } finally {
      setAuthLoading(false);
    }
  };

  // Handle passcode input
  const handlePasscodeInput = (digit: string) => {
    if (authPasscode.length < 6) {
      const newPasscode = authPasscode + digit;
      setAuthPasscode(newPasscode);
      if (newPasscode.length === 6) {
        handlePasscodeSubmit(newPasscode);
      }
    }
  };

  // Handle passcode submission
  const handlePasscodeSubmit = async (code: string) => {
    try {
      setAuthLoading(true);
      const success = await authenticateWithPasscode(code);
      
      // Give a small delay for auth context to update
      setTimeout(async () => {
        // Re-check user after authentication
        const updatedUser = user;
        
        if (success && updatedUser) {
          setShowAuthModal(false);
          // After authentication, move to security setup
          setStep(2);
        } else {
          setAuthPasscode('');
          Alert.alert('Incorrect Passcode', 'Please try again');
        }
      }, 500);
    } catch (error) {
      console.error('Passcode validation error:', error);
      setAuthPasscode('');
      Alert.alert('Error', 'Failed to validate passcode');
    } finally {
      setAuthLoading(false);
    }
  };

  const renderAuthDialpad = () => {
    const numbers = [
      ['1', '2', '3'],
      ['4', '5', '6'],
      ['7', '8', '9'],
      ['', '0', 'DEL']
    ];
    
    return (
      <View style={styles.dialpadContainer}>
        {numbers.map((row, rowIndex) => (
          <View key={`row-${rowIndex}`} style={styles.dialpadRow}>
            {row.map((num, colIndex) => (
              <Pressable
                key={`key-auth-${rowIndex}-${colIndex}`}
                style={({pressed}) => [
                  styles.dialpadKey,
                  { 
                    backgroundColor: pressed 
                      ? colors.primary + '30'
                      : colorScheme === 'dark' ? '#2C2C2E' : '#F2F2F7',
                    opacity: num === '' ? 0 : 1
                  }
                ]}
                onPress={() => {
                  if (num === 'DEL') {
                    setAuthPasscode(prev => prev.slice(0, -1));
                  } else if (num !== '') {
                    handlePasscodeInput(num);
                  }
                }}
                disabled={num === '' || authLoading}
              >
                {num === 'DEL' ? (
                  <Ionicons name="backspace-outline" size={24} color={colors.text} />
                ) : (
                  <Text style={[styles.dialpadKeyText, { color: colors.text }]}>{num}</Text>
                )}
              </Pressable>
            ))}
          </View>
        ))}
      </View>
    );
  };

  return (
    <Modal
      visible={showAuthModal}
      animationType="slide"
      transparent
      onRequestClose={() => setShowAuthModal(false)}
    >
      <View style={styles.modalContainer}>
        <View style={[styles.modalContent, { backgroundColor: colors.background }]}>
          <View style={styles.modalHeader}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>Authentication Required</Text>
            <TouchableOpacity
              style={styles.closeButton}
              onPress={() => setShowAuthModal(false)}
            >
              <Ionicons name="close" size={24} color={colors.secondaryText} />
            </TouchableOpacity>
          </View>
          
          <Text style={[styles.modalSubtitle, { color: colors.secondaryText }]}>
            Please authenticate to join {garden?.name}
          </Text>
          
          {showPasscodeInput ? (
            // Passcode input UI
            <View style={styles.authPasscodeContainer}>
              <Text style={[styles.authPasscodeTitle, { color: colors.text }]}>
                Enter 6-digit Passcode
              </Text>
              
              <View style={styles.passcodeDotsContainer}>
                {[...Array(6)].map((_, index) => (
                  <View 
                    key={`dot-${index}`} 
                    style={[
                      styles.passcodeDot, 
                      { 
                        backgroundColor: index < authPasscode.length ? colors.primary : 'transparent',
                        borderColor: colors.primary 
                      }
                    ]} 
                  />
                ))}
              </View>
              
              {renderAuthDialpad()}
              
              <View style={styles.modalFooter}>
                <TouchableOpacity
                  style={styles.modalTextButton}
                  onPress={() => {
                    setShowPasscodeInput(false);
                    setAuthPasscode('');
                  }}
                  disabled={authLoading}
                >
                  <Text style={{ color: colors.primary }}>Back to Biometrics</Text>
                </TouchableOpacity>
                
                <TouchableOpacity
                  style={styles.modalTextButton}
                  onPress={() => {
                    setShowAuthModal(false);
                    router.push('/register');
                  }}
                >
                  <Text style={{ color: colors.primary }}>Create Account</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            // Biometric authentication UI
            <View style={styles.authBiometricContainer}>
              <TouchableOpacity
                style={[styles.fingerprintCircle, { backgroundColor: colors.primary }]}
                onPress={handleBiometricAuth}
                disabled={authLoading || !biometricsAvailable}
              >
                {authLoading ? (
                  <ActivityIndicator color="white" size="large" />
                ) : (
                  <Ionicons name="finger-print" size={FINGERPRINT_SIZE/2} color="white" />
                )}
              </TouchableOpacity>
              
              <Text style={[styles.fingerprintText, { color: colors.secondaryText }]}>
                Touch to authenticate
              </Text>
              
              <View style={styles.modalFooter}>
                <TouchableOpacity
                  style={styles.modalTextButton}
                  onPress={() => setShowPasscodeInput(true)}
                  disabled={authLoading}
                >
                  <Text style={{ color: colors.primary }}>Use Passcode</Text>
                </TouchableOpacity>
                
                <TouchableOpacity
                  style={styles.modalTextButton}
                  onPress={() => {
                    setShowAuthModal(false);
                    router.push('/register');
                  }}
                >
                  <Text style={{ color: colors.primary }}>Create Account</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
};

const renderCurrentStep = () => {
  switch (step) {
    case 1:
      return <Step1 />;
    case 2:
      return <Step2 />;
    case 3:
      return <Step3 />;
    case 4:
      return <Step4 />;
    default:
      return null;
  }
};

return (
  <SafeAreaView style={styles.container}>
    {renderCurrentStep()}
    <AuthModal />
  </SafeAreaView>
);
}

const styles = StyleSheet.create({
  container: { 
    flex: 1, 
    justifyContent: 'center', 
    alignItems: 'center' 
  },
  stepContainer: { 
    width: '90%', // Wider for better layout on various screens
    maxWidth: 500, // Max width for larger screens/tablets
    alignItems: 'center',
    paddingHorizontal: 16, // Add some horizontal padding
  },
  title: { 
    fontSize: 24, 
    fontWeight: '600', 
    marginBottom: 16 
  },
  subtitle: { 
    fontSize: 16, 
    textAlign: 'center', 
    marginBottom: 24 
  },
  logosRow: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    marginBottom: 16 
  },
  avatar: { 
    width: 64, 
    height: 64, 
    borderRadius: 32 
  },
  arrow: { 
    marginHorizontal: 12, 
    fontSize: 24 
  },
  input: { 
    width: '100%', 
    borderWidth: 1, 
    borderRadius: 8, 
    padding: 12, 
    marginBottom: 16 
  },
  button: { 
    width: '100%', 
    padding: 12, 
    borderRadius: 8, 
    alignItems: 'center', 
    marginBottom: 12 
  },
  buttonOutlined: {
    width: '100%',
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 12,
    borderWidth: 1,
  },
  buttonText: { 
    color: 'white', 
    fontSize: 16, 
    fontWeight: '600' 
  },
  buttonTextOutlined: {
    fontSize: 16,
    fontWeight: '600'
  },
  biometricsContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 24,
  },
  fingerprintCircle: {
    width: FINGERPRINT_SIZE * 1.6,
    height: FINGERPRINT_SIZE * 1.6,
    borderRadius: FINGERPRINT_SIZE * 0.8,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  fingerprintInnerContainer: {
    position: 'relative',
    justifyContent: 'center',
    alignItems: 'center',
  },
  fingerprintPulse: {
    position: 'absolute',
    width: FINGERPRINT_SIZE * 1.2,
    height: FINGERPRINT_SIZE * 1.2,
    borderRadius: FINGERPRINT_SIZE * 0.6,
    borderWidth: 2,
    opacity: 0.7,
  },
  fingerprintPulse2: {
    width: FINGERPRINT_SIZE * 1.4,
    height: FINGERPRINT_SIZE * 1.4,
    borderRadius: FINGERPRINT_SIZE * 0.7,
    opacity: 0.4,
  },
  fingerprintText: {
    fontSize: 16,
    marginTop: 12,
    fontWeight: '500',
  },
  passcodeDotsContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginVertical: 24,
  },
  passcodeDot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 1,
    marginHorizontal: 10,
  },
  dialpadContainer: {
    width: '100%',
    marginTop: 12,
  },
  dialpadRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: 16,
  },
  dialpadKey: {
    width: 70,
    height: 70,
    borderRadius: 35,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  dialpadKeyText: {
    fontSize: 28,
    fontWeight: '500',
  },
  // Pending membership styles
  pendingContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 24,
  },
  pendingCircle: {
    width: 160,
    height: 160,
    borderRadius: 80,
    justifyContent: 'center',
    alignItems: 'center',
  },
  // Auth modal styles
  modalContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  modalContent: {
    width: '90%',
    maxWidth: 400,
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
  },
  modalHeader: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '600',
  },
  modalSubtitle: {
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 24,
  },
  closeButton: {
    padding: 4,
  },
  modalFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
    marginTop: 20,
  },
  modalTextButton: {
    padding: 8,
  },
  authBiometricContainer: {
    alignItems: 'center',
    width: '100%',
  },
  authPasscodeContainer: {
    alignItems: 'center',
    width: '100%',
  },
  authPasscodeTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 16,
  },
  successContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  successTitle: {
    fontSize: 24,
    fontWeight: '600',
    marginBottom: 16,
  },
  successMessage: {
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 24,
  },
  // Styles for Step 2 (Security Setup)
  choiceContainer: {
    width: '100%',
    alignItems: 'center',
    marginTop: 20,
  },
  securityMethodContainer: {
    width: '100%',
    alignItems: 'center',
    marginTop: 20,
  },
  confirmationContainer: {
    width: '100%',
    alignItems: 'center',
    marginTop: 30,
    paddingVertical: 20,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '600',
    marginBottom: 16,
    textAlign: 'center',
  },
  passcodeContainer: {
    width: '100%',
    alignItems: 'center',
    marginTop: 20,
  },
  errorText: {
    fontSize: 16,
    fontWeight: '500',
    marginBottom: 10,
  },
  centeredContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  // Provisioning styles
  provisioningContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 24,
  },
  provisioningCircle: {
    width: 160,
    height: 160,
    borderRadius: 80,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
  },
  progressContainer: {
    width: '80%',
    marginTop: 20,
    alignItems: 'center',
  },
  progressBar: {
    width: '100%',
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    borderRadius: 4,
  },
  progressText: {
    marginTop: 8,
    fontSize: 14,
    fontWeight: '600',
  },
});
