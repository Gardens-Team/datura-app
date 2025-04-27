import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  Image,
  ScrollView,
  Dimensions,
  Alert,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { useColorScheme } from 'react-native';
import { Colors } from '@/constants/Colors';
import { Ionicons } from '@expo/vector-icons';
import QRCode from 'react-native-qrcode-svg';
import * as Clipboard from 'expo-clipboard';
import * as Linking from 'expo-linking';
import * as MediaLibrary from 'expo-media-library';
import * as FileSystem from 'expo-file-system';
import ViewShot from 'react-native-view-shot';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import * as ImagePicker from 'expo-image-picker';

// Import the logo
const daturaLogo = require('@/assets/images/icon.png');

interface AddFriendsModalProps {
  visible: boolean;
  onClose: () => void;
}

export function AddFriendsModal({ visible, onClose }: AddFriendsModalProps) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const [activeTab, setActiveTab] = useState<'myQR' | 'scanQR'>('myQR');
  const [qrImageUri, setQrImageUri] = useState<string | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const qrCodeRef = useRef<ViewShot>(null);
  const { user } = useCurrentUser();

  const generateUserQRValue = () => {
    // In a real app, this would include the user's ID or a special token
    return `datura://add-friend/${user?.id || Math.random().toString(36).substring(2, 15)}`;
  };

  // Function to capture QR code as image
  const captureQRCode = async () => {
    if (qrCodeRef.current && typeof qrCodeRef.current.capture === 'function') {
      try {
        const uri = await qrCodeRef.current.capture();
        setQrImageUri(uri);
        return uri;
      } catch (error) {
        console.error('Error capturing QR code:', error);
        return null;
      }
    }
    return null;
  };

  // Function to download QR code to device
  const downloadQRCode = async () => {
    try {
      setIsDownloading(true);
      
      // Capture QR code if not already done
      const uri = qrImageUri || await captureQRCode();
      if (!uri) {
        throw new Error('Failed to capture QR code');
      }
      
      // Create a timestamp-based filename
      const timestamp = Date.now();
      const filename = `qr-friend-${timestamp}.jpg`;
      const fileDir = FileSystem.documentDirectory || FileSystem.cacheDirectory;
      const path = fileDir + filename;
      
      // Copy the captured image to a file
      await FileSystem.copyAsync({
        from: uri,
        to: path
      });
      
      // Get permissions for media library based on platform
      if (Platform.OS === 'ios') {
        const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (status !== 'granted') {
          Alert.alert("Permission Denied", "Cannot save to your photo library without permission");
          setIsDownloading(false);
          return;
        }
        
        // Save to Camera Roll
        await MediaLibrary.saveToLibraryAsync(path);
        
        Alert.alert(
          "Download Complete", 
          "QR code saved to your Photos",
          [{ text: "OK" }]
        );
      } else {
        // For Android, use MediaLibrary
        const { status } = await MediaLibrary.requestPermissionsAsync();
        if (status !== 'granted') {
          Alert.alert("Permission Denied", "Cannot save to your media library without permission");
          setIsDownloading(false);
          return;
        }
        
        // Save file to media library
        await MediaLibrary.saveToLibraryAsync(path);
        
        Alert.alert(
          "Download Complete", 
          "QR code saved to your gallery",
          [{ text: "OK" }]
        );
      }
      
      // Clean up the temp file
      await FileSystem.deleteAsync(path, { idempotent: true });
      
    } catch (error) {
      console.error('Download failed:', error);
      Alert.alert('Error', 'Failed to download QR code to your device.');
    } finally {
      setIsDownloading(false);
    }
  };

  // Function to copy friend link to clipboard
  const copyFriendLink = async () => {
    const url = generateUserQRValue();
    await Clipboard.setStringAsync(url);
    Alert.alert('Link Copied', 'Friend invite link copied to clipboard.');
  };

  // Branded QR Card Component
  const BrandedQRCard = () => (
    <View style={[styles.qrCard, { backgroundColor: colorScheme === 'dark' ? '#222' : 'white' }]}>
      <View style={styles.qrCardHeader}>
        <Text style={[styles.qrCardTitle, { color: colors.text }]}>Friend Invitation</Text>
      </View>
      
      <View style={styles.qrCodeContainer}>
        <QRCode 
          value={generateUserQRValue()} 
          size={200} 
          logo={user?.profile_pic || daturaLogo}
          logoSize={60}
          logoBackgroundColor="white"
          logoBorderRadius={10}
        />
      </View>
      
      <View style={styles.qrUserInfo}>
        <Image 
          source={{ uri: user?.profile_pic || 'https://via.placeholder.com/40' }} 
          style={styles.qrUserAvatar} 
        />
        <Text style={[styles.qrInviteText, { color: colors.secondaryText }]}>
          Message {user?.username || 'User'}
        </Text>
      </View>

      {/* Datura branding inside the card */}
      <View style={styles.qrBrandingDivider} />
      <View style={styles.qrBranding}>
        <Image 
          source={daturaLogo} 
          style={styles.qrBrandingLogo} 
          resizeMode="contain"
        />
        <Text style={[styles.qrBrandingText, { color: colors.secondaryText }]}>
          Powered by Datura
        </Text>
      </View>
    </View>
  );

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={false}
      onRequestClose={onClose}
    >
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        {/* Header */}
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <TouchableOpacity onPress={onClose} style={styles.backButton}>
            <Ionicons name="arrow-back" size={24} color={colors.text} />
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: colors.text }]}>Add Friends</Text>
          <View style={styles.headerRight} />
        </View>

        {/* Content */}
        <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
          {/* Share Options */}
          <View style={styles.shareOptions}>
            <View style={styles.shareOption}>
              <TouchableOpacity 
                style={[styles.shareIconButton, { backgroundColor: colors.surface }]}
                onPress={downloadQRCode}
              >
                <Ionicons name="download-outline" size={26} color={colors.secondaryText} />
              </TouchableOpacity>
              <Text style={[styles.shareText, { color: colors.secondaryText }]}>Download QR</Text>
            </View>

            <View style={styles.shareOption}>
              <TouchableOpacity 
                style={[styles.shareIconButton, { backgroundColor: colors.surface }]}
                onPress={copyFriendLink}
              >
                <Ionicons name="link-outline" size={26} color={colors.secondaryText} />
              </TouchableOpacity>
              <Text style={[styles.shareText, { color: colors.secondaryText }]}>Copy Link</Text>
            </View>

            <View style={styles.shareOption}>
              <TouchableOpacity 
                style={[styles.shareIconButton, { backgroundColor: colors.surface }]}
                onPress={() => setActiveTab('myQR')}
              >
                <Ionicons name="qr-code-outline" size={26} color={colors.secondaryText} />
              </TouchableOpacity>
              <Text style={[styles.shareText, { color: colors.secondaryText }]}>Show QR</Text>
            </View>
          </View>

          {/* Username Search */}
          <TouchableOpacity 
            style={[styles.usernameButton, { backgroundColor: colors.surface }]}
          >
            <Ionicons name="at" size={24} color={colors.secondaryText} />
            <Text style={[styles.usernameText, { color: colors.text }]}>Add by Username</Text>
            <Ionicons name="chevron-forward" size={20} color={colors.secondaryText} />
          </TouchableOpacity>

          {/* QR Code Section */}
          <View style={[styles.qrContainer, { backgroundColor: colors.surface }]}>
            {/* Tabs */}
            <View style={styles.tabs}>
              <TouchableOpacity 
                style={[
                  styles.tab, 
                  activeTab === 'myQR' && [styles.activeTab, { borderBottomColor: colors.primary }]
                ]}
                onPress={() => setActiveTab('myQR')}
              >
                <Text 
                  style={[
                    styles.tabText, 
                    { color: activeTab === 'myQR' ? colors.text : colors.secondaryText }
                  ]}
                >
                  My QR Code
                </Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={[
                  styles.tab, 
                  activeTab === 'scanQR' && [styles.activeTab, { borderBottomColor: colors.primary }]
                ]}
                onPress={() => setActiveTab('scanQR')}
              >
                <Text 
                  style={[
                    styles.tabText, 
                    { color: activeTab === 'scanQR' ? colors.text : colors.secondaryText }
                  ]}
                >
                  Scan QR Code
                </Text>
              </TouchableOpacity>
            </View>

            {/* QR Content */}
            {activeTab === 'myQR' ? (
              <View style={styles.qrContent}>
                <ViewShot ref={qrCodeRef} options={{ format: 'jpg', quality: 0.9 }}>
                  <BrandedQRCard />
                </ViewShot>
                
                <View style={styles.qrActionButtons}>
                  <TouchableOpacity 
                    onPress={copyFriendLink}
                    style={[styles.qrActionButton, { backgroundColor: colors.border }]}
                  >
                    <Ionicons name="copy-outline" size={20} color={colors.text} />
                    <Text style={[styles.qrActionButtonText, { color: colors.text }]}>Copy Link</Text>
                  </TouchableOpacity>
                  
                  <TouchableOpacity 
                    onPress={downloadQRCode}
                    style={[styles.qrActionButton, { backgroundColor: colors.primary }]}
                    disabled={isDownloading}
                  >
                    {isDownloading ? (
                      <ActivityIndicator size="small" color="white" />
                    ) : (
                      <>
                        <Ionicons name="download-outline" size={20} color="white" />
                        <Text style={[styles.qrActionButtonText, { color: 'white' }]}>Save to Device</Text>
                      </>
                    )}
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <View style={styles.qrContent}>
                <Image
                  source={require('@/assets/images/empty-messages.svg')}
                  style={styles.qrScanImage}
                  resizeMode="contain"
                />
                <Text style={[styles.qrText, { color: colors.text }]}>
                  Tap to scan a friend's QR code
                </Text>
                <TouchableOpacity 
                  style={[styles.scanButton, { backgroundColor: colors.primary }]}
                >
                  <Text style={styles.scanButtonText}>Scan QR Code</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>

          {/* Extra Space */}
          <View style={styles.extraSpace} />
        </ScrollView>
      </View>
      
      {/* Download Progress Modal */}
      {isDownloading && (
        <View style={styles.downloadProgressOverlay}>
          <View style={[styles.downloadProgressContent, { backgroundColor: colors.surface }]}>
            <ActivityIndicator size="large" color={colors.primary} style={styles.downloadProgressIndicator} />
            <Text style={[styles.downloadProgressText, { color: colors.text }]}>
              Saving QR code...
            </Text>
          </View>
        </View>
      )}
    </Modal>
  );
}

const { width } = Dimensions.get('window');
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
  backButton: {
    padding: 8,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
  },
  headerRight: {
    width: 40,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
  },
  shareOptions: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: 24,
    marginTop: 8,
  },
  shareOption: {
    alignItems: 'center',
  },
  shareIconButton: {
    width: 60,
    height: 60,
    borderRadius: 30,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  shareText: {
    fontSize: 12,
    textAlign: 'center',
  },
  usernameButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    marginBottom: 24,
  },
  usernameText: {
    flex: 1,
    marginLeft: 12,
    fontSize: 16,
    fontWeight: '500',
  },
  qrContainer: {
    borderRadius: 12,
    overflow: 'hidden',
    marginBottom: 24,
  },
  tabs: {
    flexDirection: 'row',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#2C2F33',
  },
  tab: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
  },
  activeTab: {
    borderBottomWidth: 2,
  },
  tabText: {
    fontSize: 14,
    fontWeight: '500',
  },
  qrContent: {
    alignItems: 'center',
    padding: 24,
  },
  qrCard: {
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    width: '100%',
    maxWidth: 300,
  },
  qrCardHeader: {
    marginBottom: 12,
  },
  qrCardTitle: {
    fontSize: 18,
    fontWeight: '600',
    textAlign: 'center',
  },
  qrCodeContainer: {
    padding: 16,
    backgroundColor: 'white',
    borderRadius: 12,
    marginBottom: 16,
  },
  qrUserInfo: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  qrUserAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    marginRight: 10,
  },
  qrInviteText: {
    fontSize: 14,
  },
  qrActionButtons: {
    flexDirection: 'row',
    marginTop: 16,
    width: '100%',
    justifyContent: 'space-between',
    gap: 10,
  },
  qrActionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    paddingHorizontal: 10,
    borderRadius: 8,
    flex: 1,
  },
  qrActionButtonText: {
    marginLeft: 8,
    fontWeight: '500',
    fontSize: 15,
  },
  qrBox: {
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 16,
  },
  qrText: {
    textAlign: 'center',
    marginTop: 8,
    fontSize: 14,
    maxWidth: '80%',
  },
  qrScanImage: {
    width: 180,
    height: 180,
    marginBottom: 16,
  },
  scanButton: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
    marginTop: 20,
  },
  scanButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  qrBrandingDivider: {
    height: 1,
    width: '100%',
    opacity: 0.2,
    backgroundColor: '#2C2F33',
    marginVertical: 12,
  },
  qrBranding: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  qrBrandingLogo: {
    width: 20,
    height: 20,
    marginRight: 6,
  },
  qrBrandingText: {
    fontSize: 12,
    fontWeight: '500',
    opacity: 0.7,
  },
  extraSpace: {
    height: 40,
  },
  downloadProgressOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1000,
  },
  downloadProgressContent: {
    width: '80%',
    maxWidth: 280,
    borderRadius: 12,
    paddingVertical: 24,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  downloadProgressIndicator: {
    marginBottom: 16,
  },
  downloadProgressText: {
    fontSize: 16,
    textAlign: 'center',
  }
}); 