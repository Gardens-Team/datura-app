import React, { useState, useEffect } from 'react';
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
} from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import {
  enableGardenBiometrics,
  setGardenPasscode,
  joinGarden,
  requestGardenMembership,
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

// Keep only the imports we need for the authentication modal
const PASSCODE_KEY = 'user_passcode';
const FINGERPRINT_SIZE = 100; // Increased size for better visibility

export default function JoinGardenScreen() {
  const { gardenId } = useLocalSearchParams<{ gardenId: string }>();
  const { user } = useCurrentUser();
  const [garden, setGarden] = useState<any>(null);
  const [step, setStep] = useState(1);
  const [passcode, setPasscode] = useState('');
  const [loading, setLoading] = useState(false);
  const [biometricsEnabled, setBiometricsEnabled] = useState(false);
  const [biometricsAvailable, setBiometricsAvailable] = useState(false);
  const [isBiometricsSkipped, setIsBiometricsSkipped] = useState(false);
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  
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
      const { data } = await supabase
        .from('gardens')
        .select('name, logo')
        .eq('id', gardenId)
        .single();
      setGarden(data);
    }
    fetchGarden();
  }, [gardenId]);

  // Step 1: Welcome & logos
  const Step1 = () => (
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
        {garden?.logo ? (
          <Image source={{ uri: garden.logo }} style={styles.avatar} />
        ) : (
          <View style={[styles.avatar, { backgroundColor: colors.secondaryText, justifyContent: 'center', alignItems: 'center' }]}>
            <Text style={{ color: 'white', fontSize: 24, fontWeight: '600' }}>
              {garden?.name?.charAt(0) ?? '?'}
            </Text>
          </View>
        )}
      </View>
      <Text style={[styles.subtitle, { color: colors.secondaryText }]}>Join {garden?.name}</Text>
      <TouchableOpacity
        style={[styles.button, { backgroundColor: colors.primary }]}
        onPress={() => {
          // Skip biometrics step if not available
          if (!biometricsAvailable) {
            setIsBiometricsSkipped(true);
            setStep(3); // Go directly to passcode step
          } else {
            setStep(2); // Go to biometrics step
          }
        }}
      >
        <Text style={styles.buttonText}>Next</Text>
      </TouchableOpacity>
    </View>
  );

  // Step 2: Setup biometrics with enhanced fingerprint UI
  const Step2 = () => (
    <View style={styles.stepContainer}>
      <Text style={[styles.title, { color: colors.text }]}>Enable Biometrics</Text>
      <Text style={[styles.subtitle, { color: colors.secondaryText }]}>
        Use your fingerprint or face recognition to quickly access this garden
      </Text>
      
      <View style={styles.biometricsContainer}>
        <View style={[styles.fingerprintCircle, { 
          backgroundColor: biometricsEnabled ? colors.success : colors.primary + '15'
        }]}>
          {biometricsEnabled ? (
            <Ionicons name="checkmark" size={60} color="white" />
          ) : (
            <View style={styles.fingerprintInnerContainer}>
              <Ionicons name="finger-print" size={FINGERPRINT_SIZE} color={colors.primary} />
              {/* Pulse animation effect */}
              <View style={[styles.fingerprintPulse, { borderColor: colors.primary + '50' }]} />
              <View style={[styles.fingerprintPulse, styles.fingerprintPulse2, { borderColor: colors.primary + '30' }]} />
            </View>
          )}
        </View>
        
        <Text style={[styles.fingerprintText, { color: colors.secondaryText }]}>
          {biometricsEnabled ? 'Biometrics Enabled' : 'Tap to Authenticate'}
        </Text>
      </View>
      
      <TouchableOpacity
        style={[styles.button, { 
          backgroundColor: biometricsEnabled ? colors.secondaryText : colors.primary 
        }]}
        onPress={async () => {
          setLoading(true);
          try {
            if (user) {
              // First check if device supports biometrics
              const isBiometricSupported = await LocalAuthentication.hasHardwareAsync();
              
              if (!isBiometricSupported) {
                Alert.alert(
                  'Not Supported',
                  'Biometric authentication is not supported on this device.',
                  [{ text: 'Skip', onPress: () => {
                    setIsBiometricsSkipped(true);
                    setStep(3);
                  }}]
                );
                return;
              }
              
              // Check if biometrics are enrolled
              const isEnrolled = await LocalAuthentication.isEnrolledAsync();
              if (!isEnrolled) {
                Alert.alert(
                  'No Biometrics Found',
                  'Please set up fingerprint or face recognition in your device settings first.',
                  [{ text: 'Skip', onPress: () => {
                    setIsBiometricsSkipped(true);
                    setStep(3);
                  }}]
                );
                return;
              }
              
              // Authenticate with biometrics
              try {
                const result = await LocalAuthentication.authenticateAsync({
                  promptMessage: 'Authenticate to setup biometric access',
                  disableDeviceFallback: false,
                });
                
                if (result.success) {
                  await enableGardenBiometrics(gardenId, user.id);
                  setBiometricsEnabled(true);
                } else {
                  Alert.alert(
                    'Authentication Failed',
                    'Unable to verify biometrics. You can try again or skip.',
                    [
                      { text: 'Try Again', style: 'default' },
                      { 
                        text: 'Skip', 
                        onPress: () => {
                          setIsBiometricsSkipped(true);
                          setStep(3);
                        } 
                      }
                    ]
                  );
                }
              } catch (error) {
                console.error('Authentication error:', error);
                Alert.alert(
                  'Authentication Error',
                  'An error occurred during biometric authentication.',
                  [{ 
                    text: 'Skip', 
                    onPress: () => {
                      setIsBiometricsSkipped(true);
                      setStep(3);
                    } 
                  }]
                );
              }
            }
          } catch (error) {
            console.error('Biometrics error:', error);
            Alert.alert('Biometrics Error', 'Unable to enable biometrics. You can still use a passcode.');
          } finally {
            setLoading(false);
          }
        }}
        disabled={loading || biometricsEnabled}
      >
        {loading ? (
          <ActivityIndicator color="white" />
        ) : (
          <Text style={styles.buttonText}>
            {biometricsEnabled ? "Continue to Passcode" : "Enable Biometrics"}
          </Text>
        )}
      </TouchableOpacity>
      
      {biometricsEnabled ? (
        <TouchableOpacity
          style={[styles.button, { backgroundColor: colors.primary, marginTop: 12 }]}
          onPress={() => setStep(3)}
        >
          <Text style={styles.buttonText}>Continue</Text>
        </TouchableOpacity>
      ) : (
        <TouchableOpacity
          style={[styles.buttonOutlined, { borderColor: colors.primary }]}
          onPress={() => {
            setIsBiometricsSkipped(true);
            setStep(3);
          }}
        >
          <Text style={[styles.buttonTextOutlined, { color: colors.primary }]}>Skip</Text>
        </TouchableOpacity>
      )}
    </View>
  );

  // Step 3: Setup passcode with dialpad UI
  const Step3 = () => {
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
                  key={`key-${rowIndex}-${colIndex}`}
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
                  disabled={num === ''}
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
        <Text style={[styles.title, { color: colors.text }]}>Set Passcode</Text>
        <Text style={[styles.subtitle, { color: colors.secondaryText }]}>
          Create a 6-digit passcode to secure your garden access
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
          onPress={async () => {
            if (passcode.length !== 6) {
              Alert.alert('Invalid Passcode', 'Please enter a 6-digit passcode');
              return;
            }
            
            setLoading(true);
            try {
              if (user) {
                await setGardenPasscode(gardenId, user.id, passcode);
                setStep(4);
              }
            } catch (error) {
              console.error('Passcode error:', error);
              Alert.alert('Error', 'Failed to set passcode. Please try again.');
            } finally {
              setLoading(false);
            }
          }}
          disabled={loading || passcode.length !== 6}
        >
          {loading ? (
            <ActivityIndicator color="white" />
          ) : (
            <Text style={styles.buttonText}>Set Passcode</Text>
          )}
        </TouchableOpacity>
        
        {!isBiometricsSkipped && (
          <TouchableOpacity
            style={[styles.buttonOutlined, { borderColor: colors.primary, marginTop: 12 }]}
            onPress={() => setStep(2)}
          >
            <Text style={[styles.buttonTextOutlined, { color: colors.primary }]}>Back</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  };

  // Step 4: Submit membership request
  const Step4 = () => (
    <View style={styles.stepContainer}>
      <Text style={[styles.title, { color: colors.text }]}>Join {garden?.name || 'Garden'}</Text>
      <Text style={[styles.subtitle, { color: colors.secondaryText, marginBottom: 24 }]}>
        Request to join this garden. Garden admins will review your request.
      </Text>
      <TouchableOpacity
        style={[styles.button, { backgroundColor: colors.primary }]}
        onPress={async () => {
          setLoading(true);
          try {
            if (user) {
              // Check if user has completed authentication setup
              const hasCompletedSetup = (biometricsEnabled || isBiometricsSkipped) && passcode.length === 6;
              
              if (!hasCompletedSetup) {
                Alert.alert(
                  'Setup Required',
                  'Please complete the passcode setup before requesting to join the garden.',
                  [
                    { 
                      text: 'Go Back', 
                      onPress: () => setStep(3)
                    }
                  ]
                );
                return;
              }
              
              try {
                // Request membership
                await requestGardenMembership(gardenId, user.id, user.publicKey);
                // Move to the final pending step
                setStep(5);
              } catch (error) {
                console.error('Membership request failed', error);
                Alert.alert('Error', error instanceof Error ? error.message : 'Failed to request garden membership');
              }
            } else {
              // If no user is logged in, show authentication UI
              setShowAuthModal(true);
            }
          } catch (e) {
            console.error('Process error:', e);
            Alert.alert('Error', e instanceof Error ? e.message : 'An unexpected error occurred');
          } finally {
            setLoading(false);
          }
        }}
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
            // Go back to previous step
            setStep(3);
          }
        }}
      >
        <Text style={[styles.buttonTextOutlined, { color: colors.primary }]}>
          {user ? "Back" : "Sign In"}
        </Text>
      </TouchableOpacity>
    </View>
  );

  // Step 5: Membership Pending
  const Step5 = () => (
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
            // After authentication, move to biometrics setup
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
                  key={`key-${rowIndex}-${colIndex}`}
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

  // Render current step
  return (
    <View style={[styles.container, { paddingTop: insets.top, backgroundColor: colors.background }]}>      
      {step === 1 && <Step1 />}
      {step === 2 && <Step2 />}
      {step === 3 && <Step3 />}
      {step === 4 && <Step4 />}
      {step === 5 && <Step5 />}
      
      <AuthModal />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { 
    flex: 1, 
    justifyContent: 'center', 
    alignItems: 'center' 
  },
  stepContainer: { 
    width: '80%', 
    alignItems: 'center' 
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
});
