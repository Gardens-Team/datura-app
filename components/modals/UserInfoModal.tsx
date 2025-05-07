import { Ionicons } from "@expo/vector-icons";
import { Colors } from "@/constants/Colors";
import { router } from 'expo-router'; // Import router for navigation
import {
    Modal,
    View,
    Image,
    TouchableOpacity,
    Text,
    StyleSheet,
    ColorSchemeName,
  } from 'react-native';

  export const renderProfileModal = (profileUser: any, profileModalVisible: boolean, navigateToDM: (userId: string) => void, setProfileModalVisible: (visible: boolean) => void, colorScheme: ColorSchemeName) => {
    if (!profileUser) return null;
    const colors = Colors[colorScheme ?? 'light'];
    return (
      <Modal
        visible={profileModalVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setProfileModalVisible(false)}
      >
        <TouchableOpacity 
          style={styles.modalOverlay} 
          activeOpacity={1} 
          onPress={() => setProfileModalVisible(false)}
        >
          <View style={[
            styles.profileCard,
            { backgroundColor: colorScheme === 'dark' ? '#2C2C2E' : 'white' }
          ]}>
            <View style={styles.profileHeader}>
              <Image 
                source={{ uri: profileUser.avatar || 'https://via.placeholder.com/100' }} 
                style={styles.profileAvatar} 
              />
              <View style={styles.profileInfo}>
                <Text style={[styles.profileName, { color: colors.text }]}>
                  {profileUser.username}
                </Text>
                <View style={styles.profileStatus}>
                  <View style={[
                    styles.statusDot,
                    { backgroundColor: profileUser.status === 'online' ? '#4CAF50' : 
                                      profileUser.status === 'idle' ? '#FF9800' : '#9E9E9E' }
                  ]} />
                  <Text style={[styles.statusText, { color: colors.secondaryText }]}>
                    {profileUser.status === 'online' ? 'Online' : 
                    profileUser.status === 'idle' ? 'Idle' : 'Offline'}
                  </Text>
                </View>
                {profileUser.role && (
                  <View style={[styles.roleBadge, { 
                    backgroundColor: profileUser.role === 'admin' ? '#7B1FA2' : 
                                    profileUser.role === 'creator' ? '#D32F2F' : '#607D8B'
                  }]}>
                    <Text style={styles.roleText}>
                      {profileUser.role.charAt(0).toUpperCase() + profileUser.role.slice(1)}
                    </Text>
                  </View>
                )}
              </View>
            </View>
            
            <View style={styles.profileActions}>
              <TouchableOpacity 
                style={[styles.actionButton, { backgroundColor: colors.primary }]}
                onPress={() => navigateToDM(profileUser.id)}
              >
                <Ionicons name="chatbubble" size={18} color="white" />
                <Text style={styles.actionText}>Send Message</Text>
              </TouchableOpacity>
            </View>
          </View>
        </TouchableOpacity>
      </Modal>
    );
  };

export const styles = StyleSheet.create({
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