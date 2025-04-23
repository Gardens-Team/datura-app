import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  ActivityIndicator,
  TextInput,
  Alert,
  Platform,
} from 'react-native';
import { useColorScheme } from 'react-native';
import { Colors } from '@/constants/Colors';
import { Ionicons } from '@expo/vector-icons';
import * as LocalAuthentication from 'expo-local-authentication';
import { authenticateForGarden, verifyGardenPasscode } from '@/services/garden-service';
import { useCurrentUser } from '@/hooks/useCurrentUser';

interface GardenAuthModalProps {
  visible: boolean;
  gardenId: string;
  gardenName: string;
  onSuccess: () => void;
  onCancel: () => void;
}

export function GardenAuthModal({
  visible,
  gardenId,
  gardenName,
  onSuccess,
  onCancel,
}: GardenAuthModalProps) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  
  const [loading, setLoading] = useState(true);
  const [authenticating, setAuthenticating] = useState(false);
  const [hasBiometrics, setHasBiometrics] = useState(false);
  const [showPasscode, setShowPasscode] = useState(false);
  const [passcode, setPasscode] = useState('');
  const { user } = useCurrentUser();
  
  useEffect(() => {
    // Check for biometric hardware on mount
    async function checkBiometrics() {
      try {
        setLoading(true);
        const compatible = await LocalAuthentication.hasHardwareAsync();
        setHasBiometrics(compatible);
        
        // Try authenticating immediately if visible
        if (visible && compatible) {
          tryBiometricAuth();
        } else {
          setShowPasscode(true);
        }
      } catch (error) {
        console.error('Failed to check biometrics:', error);
        setShowPasscode(true);
      } finally {
        setLoading(false);
      }
    }
    
    checkBiometrics();
  }, [visible]);
  
  const tryBiometricAuth = async () => {
    try {
      setAuthenticating(true);
      const isAuthenticated = await authenticateForGarden(gardenId);
      
      if (isAuthenticated) {
        onSuccess();
        return;
      }
      
      // If biometric auth failed, show passcode input
      setShowPasscode(true);
    } catch (error) {
      console.error('Authentication error:', error);
      setShowPasscode(true);
    } finally {
      setAuthenticating(false);
    }
  };
  
  const handlePasscodeSubmit = async () => {
    if (passcode.length !== 6) {
      Alert.alert('Error', 'Passcode must be 6 digits');
      return;
    }
    const trimmed = passcode.trim();
    if (!trimmed) {
      Alert.alert('Error', 'Please enter a passcode');
      return;
    }
    
    try {
      setAuthenticating(true);
      const isValid = await verifyGardenPasscode(gardenId, user!.id, trimmed);
      
      if (isValid) {
        onSuccess();
      } else {
        Alert.alert('Error', 'Invalid passcode. Please try again.');
        setPasscode('');
      }
    } catch (error) {
      console.error('Passcode verification error:', error);
      Alert.alert('Error', 'Failed to verify passcode. Please try again.');
    } finally {
      setAuthenticating(false);
    }
  };
  
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
    >
      <View style={styles.overlay}>
        <View style={[styles.modalContainer, { backgroundColor: colors.background }]}>
          <View style={styles.header}>
            <Text style={[styles.headerTitle, { color: colors.text }]}>
              Unlock Garden
            </Text>
            <TouchableOpacity style={styles.closeButton} onPress={onCancel}>
              <Ionicons name="close" size={24} color={colors.text} />
            </TouchableOpacity>
          </View>
          
          <View style={styles.content}>
            <View style={[styles.lockIcon, { backgroundColor: colors.surface }]}>
              <Ionicons 
                name={hasBiometrics ? "finger-print" : "lock-closed"} 
                size={48} 
                color={colors.primary} 
              />
            </View>
            
            <Text style={[styles.gardenName, { color: colors.text }]}>
              {gardenName}
            </Text>
            
            <Text style={[styles.description, { color: colors.secondaryText }]}>
              Authenticate to access this encrypted garden
            </Text>
            
            {loading ? (
              <ActivityIndicator size="large" color={colors.primary} style={styles.loader} />
            ) : showPasscode ? (
              <View style={styles.passcodeContainer}>
                <TextInput
                  style={[styles.passcodeInput, { 
                    backgroundColor: colorScheme === 'dark' ? '#1C1C1E' : '#F2F2F7',
                    color: colors.text
                  }]}
                  placeholder="Enter 6-digit passcode"
                  placeholderTextColor={colors.secondaryText}
                  secureTextEntry
                  value={passcode}
                  onChangeText={setPasscode}
                  keyboardType="number-pad"
                  maxLength={6}
                  autoFocus
                />
                
                <TouchableOpacity
                  style={[
                    styles.submitButton,
                    { backgroundColor: colors.primary },
                    authenticating && { opacity: 0.7 }
                  ]}
                  onPress={handlePasscodeSubmit}
                  disabled={authenticating}
                >
                  {authenticating ? (
                    <ActivityIndicator color="white" size="small" />
                  ) : (
                    <Text style={styles.submitButtonText}>Unlock</Text>
                  )}
                </TouchableOpacity>
                
                {hasBiometrics && (
                  <TouchableOpacity
                    style={styles.biometricsButton}
                    onPress={tryBiometricAuth}
                    disabled={authenticating}
                  >
                    <Ionicons 
                      name="finger-print" 
                      size={24} 
                      color={colors.primary}
                      style={styles.biometricsIcon}
                    />
                    <Text style={[styles.biometricsText, { color: colors.primary }]}>
                      Use Biometrics Instead
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            ) : (
              <TouchableOpacity
                style={[
                  styles.biometricsButton,
                  { marginTop: 24 },
                  authenticating && { opacity: 0.7 }
                ]}
                onPress={tryBiometricAuth}
                disabled={authenticating}
              >
                {authenticating ? (
                  <ActivityIndicator color={colors.primary} size="small" />
                ) : (
                  <>
                    <Ionicons 
                      name="finger-print" 
                      size={24} 
                      color={colors.primary}
                      style={styles.biometricsIcon}
                    />
                    <Text style={[styles.biometricsText, { color: colors.primary }]}>
                      Authenticate with Biometrics
                    </Text>
                  </>
                )}
              </TouchableOpacity>
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContainer: {
    width: '85%',
    maxWidth: 350,
    borderRadius: 16,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(0,0,0,0.1)',
    position: 'relative',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
  },
  closeButton: {
    position: 'absolute',
    right: 16,
    width: 24,
    height: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: {
    padding: 24,
    alignItems: 'center',
  },
  lockIcon: {
    width: 96,
    height: 96,
    borderRadius: 48,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  gardenName: {
    fontSize: 20,
    fontWeight: '600',
    marginBottom: 8,
    textAlign: 'center',
  },
  description: {
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 20,
    paddingHorizontal: 16,
  },
  loader: {
    marginTop: 20,
  },
  passcodeContainer: {
    width: '100%',
  },
  passcodeInput: {
    height: 48,
    borderRadius: 8,
    paddingHorizontal: 12,
    fontSize: 16,
    marginBottom: 16,
    width: '100%',
  },
  submitButton: {
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  submitButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
  biometricsButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
  },
  biometricsIcon: {
    marginRight: 8,
  },
  biometricsText: {
    fontSize: 16,
    fontWeight: '500',
  },
}); 