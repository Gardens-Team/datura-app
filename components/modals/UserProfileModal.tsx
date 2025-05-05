import React from 'react';
import {
  Modal,
  View,
  Image,
  TouchableOpacity,
  Text,
  StyleSheet,
  ColorSchemeName,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '@/constants/Colors';
import { router } from 'expo-router'; // Import router for navigation

// Re-define ChannelUser locally or import if it's shared
interface ChannelUser {
  id: string;
  username: string;
  displayName: string | null;
  profile_pic: string;
  status: 'online' | 'idle' | 'offline';
  role?: string;
}

interface UserProfileModalProps {
  isVisible: boolean;
  user: ChannelUser | null;
  onClose: () => void;
  navigateToDM: (userId: string) => void; // Function to navigate to DM
  colorScheme: ColorSchemeName;
}

export function UserProfileModal({
  isVisible,
  user,
  onClose,
  navigateToDM,
  colorScheme,
}: UserProfileModalProps) {
  const colors = Colors[colorScheme ?? 'light'];

  if (!isVisible || !user) {
    return null;
  }

  const handleViewProfile = () => {
    if (user?.id) {
      onClose(); // Close the modal first
      router.push(`/user/${user.id}`);
    }
  };

  const handleSendMessage = () => {
    if (user?.id) {
      navigateToDM(user.id);
      // onClose(); // navigateToDM likely handles closing
    }
  };

  return (
    <Modal
      visible={isVisible}
      transparent={true}
      animationType="fade"
      onRequestClose={onClose}
    >
      <TouchableOpacity
        style={styles.modalOverlay}
        activeOpacity={1}
        onPress={onClose} // Close when clicking overlay
      >
        {/* Prevent clicks inside the card from closing the modal */}
        <TouchableOpacity activeOpacity={1} style={[
          styles.profileCard,
          { backgroundColor: colorScheme === 'dark' ? '#2C2C2E' : 'white' }
        ]}>
          <View style={styles.profileHeader}>
            <Image
              source={{ uri: user.profile_pic || 'https://via.placeholder.com/100' }}
              style={styles.profileAvatar}
            />
            <View style={styles.profileInfo}>
              <Text style={[styles.profileName, { color: colors.text }]}>
                {user.displayName || user.username}
              </Text>
              <View style={styles.profileStatus}>
                <View style={[
                  styles.statusDot,
                  { backgroundColor: user.status === 'online' ? '#4CAF50' :
                                    user.status === 'idle' ? '#FF9800' : '#9E9E9E' }
                ]} />
                <Text style={[styles.statusText, { color: colors.secondaryText }]}>
                  {user.status === 'online' ? 'Online' :
                  user.status === 'idle' ? 'Idle' : 'Offline'}
                </Text>
              </View>
              {user.role && (
                <View style={[styles.roleBadge, {
                  backgroundColor: user.role === 'admin' || user.role === 'creator' ? colors.primary : colors.secondaryText
                }]}>
                  <Text style={styles.roleText}>
                    {user.role.charAt(0).toUpperCase() + user.role.slice(1)}
                  </Text>
                </View>
              )}
            </View>
          </View>

          <View style={styles.profileActions}>
            <TouchableOpacity
              style={[styles.actionButton, { backgroundColor: colors.primary }]}
              onPress={handleViewProfile}
            >
              <Ionicons name="person" size={18} color="white" />
              <Text style={styles.actionText}>View Profile</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.actionButton, { backgroundColor: colors.primary }]}
              onPress={handleSendMessage}
            >
              <Ionicons name="chatbubble" size={18} color="white" />
              <Text style={styles.actionText}>Send Message</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  profileCard: {
    width: '90%',
    maxWidth: 340,
    borderRadius: 12,
    // padding: 16, // Removed padding here, handled by sections
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
    overflow: 'hidden', // Clip content to rounded corners
  },
  profileHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16, // Add padding to the header section
    // marginBottom: 16, // Removed margin, spacing handled by action padding
  },
  profileAvatar: {
    width: 60,
    height: 60,
    borderRadius: 30,
    marginRight: 16,
  },
  profileInfo: {
    flex: 1,
  },
  profileName: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 4,
  },
  profileStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  statusText: {
    fontSize: 12,
  },
  roleBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
    marginTop: 4, // Added margin top for spacing
  },
  roleText: {
    color: 'white',
    fontSize: 11,
    fontWeight: '500',
  },
  profileActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    // marginTop: 8, // Removed margin
    paddingHorizontal: 16,
    paddingVertical: 12, // Adjusted padding
    borderTopWidth: 1,
    borderTopColor: 'rgba(0,0,0,0.1)', // Add separator line
    gap: 12, // Added gap between buttons
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10, // Increased padding
    paddingHorizontal: 12,
    borderRadius: 20,
    flex: 1,
  },
  actionText: {
    color: 'white',
    fontWeight: '500',
    marginLeft: 8, // Increased margin
    fontSize: 14, // Slightly larger text
  },
}); 