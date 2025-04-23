import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  Image,
  ScrollView,
  Dimensions,
} from 'react-native';
import { useColorScheme } from 'react-native';
import { Colors } from '@/constants/Colors';
import { Ionicons } from '@expo/vector-icons';

// Simple QR code display component that doesn't require external dependencies
function SimpleQRCode({ value, size = 180 }: { value: string, size?: number }) {
  // In a real app, we would use react-native-qrcode-svg
  // This is a simplified placeholder UI
  return (
    <View style={{ width: size, height: size, backgroundColor: 'white', padding: 12 }}>
      <View style={{ flex: 1, borderWidth: 1, borderColor: '#000' }}>
        <View style={{ padding: 16, flex: 1 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <View style={styles.qrCorner} />
            <View style={styles.qrCorner} />
          </View>
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="qr-code" size={size/2} color="#000" />
            <Text style={{ fontSize: 10, marginTop: 4, color: '#000' }}>
              Scan to add friend
            </Text>
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <View style={styles.qrCorner} />
            <View style={styles.qrCorner} />
          </View>
        </View>
      </View>
    </View>
  );
}

interface AddFriendsModalProps {
  visible: boolean;
  onClose: () => void;
}

export function AddFriendsModal({ visible, onClose }: AddFriendsModalProps) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const [activeTab, setActiveTab] = useState<'myQR' | 'scanQR'>('myQR');

  const generateUserQRValue = () => {
    // In a real app, this would include the user's ID or a special token
    return `datura://add-friend/${Math.random().toString(36).substring(2, 15)}`;
  };

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
              <TouchableOpacity style={[styles.shareIconButton, { backgroundColor: colors.surface }]}>
                <Ionicons name="share-outline" size={26} color={colors.secondaryText} />
              </TouchableOpacity>
              <Text style={[styles.shareText, { color: colors.secondaryText }]}>Share Invite</Text>
            </View>

            <View style={styles.shareOption}>
              <TouchableOpacity style={[styles.shareIconButton, { backgroundColor: colors.surface }]}>
                <Ionicons name="link-outline" size={26} color={colors.secondaryText} />
              </TouchableOpacity>
              <Text style={[styles.shareText, { color: colors.secondaryText }]}>Copy Link</Text>
            </View>

            <View style={styles.shareOption}>
              <TouchableOpacity style={[styles.shareIconButton, { backgroundColor: colors.surface }]}>
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
                <View style={[styles.qrBox, { borderColor: colors.border }]}>
                  <SimpleQRCode
                    value={generateUserQRValue()}
                    size={180}
                  />
                </View>
                <Text style={[styles.qrText, { color: colors.text }]}>
                  Share this QR code with friends to connect
                </Text>
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
  qrBox: {
    backgroundColor: 'white',
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 16,
  },
  qrCorner: {
    width: 20, 
    height: 20, 
    borderWidth: 4, 
    borderColor: '#000',
    margin: 8,
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
  extraSpace: {
    height: 40,
  },
}); 