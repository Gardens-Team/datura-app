import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  Image,
  StatusBar,
  SafeAreaView,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Modal,
  Alert,
  TouchableWithoutFeedback,
} from 'react-native';
import { useLocalSearchParams, router, useNavigation } from 'expo-router';
import { getChannelsByGarden, createChannel, deleteChannel, lockChannel, unlockChannel, isChannelLocked, Channel, Garden as GardenType, decryptGardenImage, getGroupKeyForGarden } from '@/services/garden-service';
import { useColorScheme } from 'react-native';
import { Colors } from '@/constants/Colors';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '@/services/supabase-singleton';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { GardenAuthProvider } from '@/components/GardenAuthProvider';
import QRCode from 'react-native-qrcode-svg';
import * as Clipboard from 'expo-clipboard';
import * as Linking from 'expo-linking';
import * as Sharing from 'expo-sharing';
import ViewShot from 'react-native-view-shot';
import { getStoredPrivateKeyEncryption } from '@/utils/provisioning';
import { useHeaderHeight } from '@react-navigation/elements';

export default function GardenScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [channels, setChannels] = useState<Channel[]>([]);
  const [garden, setGarden] = useState<GardenType | null>(null);
  const [decryptedLogoUri, setDecryptedLogoUri] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingChannel, setLoadingChannel] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [menuVisible, setMenuVisible] = useState(false);
  const [qrModalVisible, setQRModalVisible] = useState(false);
  const [notificationEnabled, setNotificationEnabled] = useState(true);
  const [isCreatorOrAdmin, setIsCreatorOrAdmin] = useState(false);
  const [qrImageUri, setQrImageUri] = useState<string | null>(null);
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const insets = useSafeAreaInsets();
  const { user } = useCurrentUser();
  const navigation = useNavigation();
  const menuRef = useRef(null);
  const qrCodeRef = useRef<ViewShot>(null);
  const [createChannelModalVisible, setCreateChannelModalVisible] = useState(false);
  const [newChannelName, setNewChannelName] = useState('');
  const [newChannelGroup, setNewChannelGroup] = useState<'Everyone'|'Staff'>('Everyone');
  const [channelToDelete, setChannelToDelete] = useState<Channel | null>(null);
  const [deletingChannel, setDeletingChannel] = useState(false);
  const [selectedChannel, setSelectedChannel] = useState<Channel | null>(null);
  const [channelActionModalVisible, setChannelActionModalVisible] = useState(false);
  const [channelLockStatus, setChannelLockStatus] = useState<Record<string, boolean>>({});
  const [updatingLockStatus, setUpdatingLockStatus] = useState(false);
  const headerHeight = useHeaderHeight();
  
  // Set the title in the header
  useEffect(() => {
    // Fetch garden details
    async function fetchGardenDetails() {
      try {
        const { data, error } = await supabase
          .from('gardens')
          .select('*')
          .eq('id', id)
          .single();
          
        if (error) throw error;
        setGarden(data as GardenType);
        
        // Decrypt garden logo if it exists
        if (data?.logo) {
          try {
            // Skip local file paths 
            if (data.logo.startsWith('file://')) {
              console.warn('Garden has local file logo that is not accessible:', data.logo);
            } else {
              // Get the garden's creator membership to access the group key
              const groupKeyBase64 = await getGroupKeyForGarden(id as string);
              
              // Get user's private key
              const privateKeyBase64 = await getStoredPrivateKeyEncryption();
              if (!privateKeyBase64) {
                console.error('Private key not available for logo decryption');
                return;
              }
              
              // Decrypt the logo
              const base64Data = await decryptGardenImage(data.logo, groupKeyBase64);
              if (base64Data) {
                // Create a data URL from the base64 image
                const dataUrl = `data:image/png;base64,${base64Data}`;
                console.log('Setting decrypted logo URI in garden screen');
                setDecryptedLogoUri(dataUrl);
              }
            }
          } catch (decryptError) {
            console.error('Error decrypting garden logo:', decryptError);
          }
        }
        
        // Check if user is creator or admin
        if (user && data) {
          // creator, admin, or moderator roles can see the system feed
          let hasAdminAccess = data.creator === user.id;
          if (!hasAdminAccess) {
            const { data: membership, error: memErr } = await supabase
              .from('memberships')
              .select('role')
              .eq('garden_id', data.id)
              .eq('user_id', user.id)
              .single();
            if (!memErr && membership && ['admin', 'moderator'].includes(membership.role)) {
              hasAdminAccess = true;
            }
          }
          setIsCreatorOrAdmin(hasAdminAccess);
        }
        
        // Set the navigation title
        if (navigation.setOptions) {
          navigation.setOptions({
            title: data?.name || 'Garden',
          });
        }
      } catch (error) {
        console.error('Error fetching garden:', error);
      }
    }
    
    fetchGardenDetails();
  }, [id, navigation, user]);

  // Fetch channels
  useEffect(() => {
    async function fetchChannels() {
      setLoading(true);
      try {
        const channelData = await getChannelsByGarden(id as string);
        setChannels(channelData);
      } catch (error) {
        console.error('Error fetching channels:', error);
      } finally {
        setLoading(false);
      }
    }
    
    fetchChannels();
  }, [id]);

  // Filter channels based on search query
  const filteredChannels = searchQuery 
    ? channels.filter(c => c.name.toLowerCase().includes(searchQuery.toLowerCase()))
    : channels;

  // Separate channels into Everyone and Staff groups
  const everyoneChannels = filteredChannels.filter(c => !c.name.startsWith('staff-'));
  const staffChannels = filteredChannels.filter(c => c.name.startsWith('staff-'));
  
  // Only show staff channels to creators and admins
  const channelGroups: Record<string, Channel[]> = { 'Everyone': everyoneChannels };
  if (isCreatorOrAdmin) channelGroups['Staff'] = staffChannels;

  // Function to handle channel deletion
  const handleDeleteChannel = useCallback(async () => {
    if (!channelToDelete) return;

    try {
      setDeletingChannel(true);
      await deleteChannel(channelToDelete.id as string);
      
      // Update the channels list
      const updatedChannels = await getChannelsByGarden(id as string);
      setChannels(updatedChannels);
      setChannelToDelete(null);
    } catch (error) {
      console.error('Error deleting channel:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to delete channel';
      Alert.alert('Error', errorMessage);
    } finally {
      setDeletingChannel(false);
    }
  }, [channelToDelete, id]);

  // Show delete confirmation dialog
  const confirmDeleteChannel = (channel: Channel) => {
    // Set the channel to delete and show confirmation
    setChannelToDelete(channel);
    Alert.alert(
      'Delete Channel',
      `Are you sure you want to delete the channel "${channel.name}"? This action cannot be undone.`,
      [
        {
          text: 'Cancel',
          style: 'cancel',
          onPress: () => setChannelToDelete(null)
        },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: handleDeleteChannel
        }
      ]
    );
  };

  // Function to lock or unlock a channel
  const toggleChannelLock = useCallback(async (channel: Channel) => {
    if (!channel.id) return;

    try {
      setUpdatingLockStatus(true);
      const isLocked = channelLockStatus[channel.id] || false;
      
      if (isLocked) {
        await unlockChannel(channel.id);
      } else {
        await lockChannel(channel.id);
      }
      
      // Update the lock status in our state
      setChannelLockStatus(prev => ({
        ...prev,
        [channel.id as string]: !isLocked
      }));
      
      // Close the action modal
      setChannelActionModalVisible(false);
      
    } catch (error) {
      console.error('Error toggling channel lock:', error);
      Alert.alert('Error', 'Failed to update channel status');
    } finally {
      setUpdatingLockStatus(false);
    }
  }, [channelLockStatus]);

  // Fetch channel lock status when channels are loaded
  useEffect(() => {
    async function fetchChannelLockStatus() {
      const lockStatus: Record<string, boolean> = {};
      
      for (const channel of channels) {
        if (channel.id) {
          try {
            const isLocked = await isChannelLocked(channel.id);
            lockStatus[channel.id] = isLocked;
          } catch (error) {
            console.error(`Error fetching lock status for channel ${channel.id}:`, error);
          }
        }
      }
      
      setChannelLockStatus(lockStatus);
    }
    
    if (channels.length > 0) {
      fetchChannelLockStatus();
    }
  }, [channels]);
  
  // Open channel action menu
  const openChannelActionMenu = (channel: Channel) => {
    setSelectedChannel(channel);
    setChannelActionModalVisible(true);
  };

  // Render each channel in Slack-like style
  const renderChannel = ({ item }: { item: Channel }) => (
    <TouchableOpacity 
      style={styles.channelRow} 
      onPress={() => router.push(`/garden/channel/${item.id}` as const)}
    >
      {/* Channel icon - show lock if channel is locked */}
      <Ionicons 
        name={channelLockStatus[item.id as string] ? "lock-closed" : "chatbubble-ellipses-outline"}
        size={18} 
        color={colors.secondaryText} 
        style={styles.channelIcon}
      />
      
      {/* Channel name */}
      <Text style={[styles.channelName, { color: colors.text }]}>
        {item.name.replace(/^staff-/, '')}
      </Text>
      
      {/* Action menu for admins */}
      {isCreatorOrAdmin && (
        <TouchableOpacity 
          style={styles.channelActionButton}
          onPress={(e) => {
            e.stopPropagation();
            openChannelActionMenu(item);
          }}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons 
            name="ellipsis-vertical" 
            size={18} 
            color={colors.secondaryText} 
          />
        </TouchableOpacity>
      )}
    </TouchableOpacity>
  );

  // Render each channel group with header
  const renderChannelGroup = (title: string, data: Channel[]) => (
    <View style={styles.channelGroup}>
      <View style={styles.groupHeader}>
        <Text style={[styles.groupTitle, { color: colors.secondaryText }]}>
          {title.toUpperCase()}
        </Text>
      </View>
      <FlatList
        data={data}
        keyExtractor={(c) => c.id || c.name}
        renderItem={renderChannel}
        scrollEnabled={false}
        ItemSeparatorComponent={() => <View style={{ height: 2 }} />}
      />
    </View>
  );

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

  // Function to share QR code
  const shareQRCode = async () => {
    const uri = qrImageUri || await captureQRCode();
    if (uri) {
      try {
        await Sharing.shareAsync(`file://${uri}`);
      } catch (error) {
        console.error('Error sharing QR code:', error);
      }
    }
  };

  // Branded QR Card Component
  const BrandedQRCard = () => (
    <View style={[styles.qrCard, { backgroundColor: colorScheme === 'dark' ? '#222' : 'white' }]}>
      <View style={styles.qrCardHeader}>
        <Text style={[styles.qrCardTitle, { color: colors.text }]}>Garden Invitation</Text>
      </View>
      
      <View style={styles.qrCodeContainer}>
        <QRCode 
          value={Linking.createURL(`/join/${id}` as string)} 
          size={200} 
          logo={decryptedLogoUri ? { uri: decryptedLogoUri } : undefined}
          logoSize={50}
          logoBackgroundColor="white"
        />
      </View>
      
      <View style={styles.qrLogosRow}>
        <Image 
          source={{ uri: user?.profile_pic || 'https://via.placeholder.com/40' }} 
          style={styles.qrUserAvatar} 
        />
        <View style={styles.qrArrow}>
          <Ionicons name="arrow-forward" size={20} color={colors.primary} />
        </View>
        {decryptedLogoUri ? (
          <Image 
            source={{ uri: decryptedLogoUri }} 
            style={styles.qrGardenLogo} 
          />
        ) : (
          <View style={[styles.qrGardenLogo, { backgroundColor: colors.primary, justifyContent: 'center', alignItems: 'center' }]}>
            <Text style={{ color: 'white', fontSize: 16, fontWeight: '600' }}>
              {garden?.name?.charAt(0).toUpperCase() || '?'}
            </Text>
          </View>
        )}
      </View>
      
      <Text style={[styles.qrInviteText, { color: colors.secondaryText }]}>
        Join {user?.username || 'User'} in {garden?.name || 'Garden'}
      </Text>
    </View>
  );

  // Function to create a channel
  const handleCreateChannel = useCallback(async () => {
    if (!newChannelName.trim()) return;
    
    try {
      setLoadingChannel(true);
      const name = newChannelGroup === 'Staff' ? `staff-${newChannelName}` : newChannelName;
      
      await createChannel({ garden_id: id as string, name });
      setCreateChannelModalVisible(false);
      setNewChannelName('');
      
      // Refresh channel list
      const updatedChannels = await getChannelsByGarden(id as string);
      setChannels(updatedChannels);
    } catch (error) {
      console.error('Error creating channel:', error);
      Alert.alert('Error', 'Failed to create channel');
    } finally {
      setLoadingChannel(false);
    }
  }, [id, newChannelName, newChannelGroup]);

  return (
    <GardenAuthProvider gardenId={id as string}>
      <KeyboardAvoidingView 
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.flex}
        keyboardVerticalOffset={headerHeight}
      >
        <SafeAreaView
          style={[styles.container, { backgroundColor: colors.background, paddingTop: 0 }]}
        >
          <StatusBar barStyle={colorScheme === 'dark' ? 'light-content' : 'dark-content'} />
          
          {/* Header with Garden info */}
          <View style={[styles.header, { borderBottomColor: colors.border, marginTop: insets.top }]}>
            <View style={styles.gardenInfo}>
              <TouchableOpacity 
                onPress={() => router.back()}
                style={styles.backButtonContainer}
              >
                <Ionicons name="arrow-back" size={24} color={colors.text} />
              </TouchableOpacity>
              {decryptedLogoUri ? (
                <Image source={{ uri: decryptedLogoUri }} style={styles.gardenLogo} />
              ) : (
                <View style={[styles.gardenLogo, { backgroundColor: colors.primary }]}>
                  <Text style={styles.gardenInitial}>
                    {garden?.name?.charAt(0).toUpperCase() || '?'}
                  </Text>
                </View>
              )}
              <Text style={[styles.gardenName, { color: colors.text }]} numberOfLines={1}>
                {garden?.name || 'Loading...'}
              </Text>
            </View>
            
            {/* Three-dot menu button */}
            <TouchableOpacity 
              ref={menuRef}
              onPress={() => setMenuVisible(true)} 
              style={styles.menuButton}
            >
              <Ionicons name="ellipsis-vertical" size={24} color={colors.text} />
            </TouchableOpacity>
          </View>

          {/* Search channels */}
          <View style={[styles.searchContainer, { backgroundColor: colors.surface }]}>
            <Ionicons name="search" size={18} color={colors.secondaryText} style={styles.searchIcon}/>
            <TextInput
              style={[styles.searchInput, { color: colors.text }]}
              placeholder="Search channels"
              placeholderTextColor={colors.secondaryText}
              value={searchQuery}
              onChangeText={setSearchQuery}
            />
          </View>
          
          {/* Create Channel button for staff */}
          {isCreatorOrAdmin && (
            <TouchableOpacity 
              style={styles.addChannelButton} 
              onPress={() => setCreateChannelModalVisible(true)}
            >
              <Ionicons name="add-outline" size={20} color={colors.primary} />
              <Text style={[styles.addChannelText, { color: colors.primary }]}>Create Channel</Text>
            </TouchableOpacity>
          )}
          
          {/* Channel list */}
          <View style={styles.listContainer}> 
            {loading ? (
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color={colors.primary} />
              </View>
            ) : (
              <FlatList
                data={Object.entries(channelGroups).filter(([, data]) => data.length > 0)}
                keyExtractor={([title]) => title}
                renderItem={({ item: [title, data] }) => renderChannelGroup(title, data)}
                style={styles.flex}
                contentContainerStyle={[styles.contentContainer, { paddingBottom: 16 }]}
                ListEmptyComponent={
                  <View style={styles.emptyListContainer}>
                    <Text style={[styles.emptyListText, { color: colors.secondaryText }]}>
                      No channels found.
                    </Text>
                  </View>
                }
              />
            )}
          </View>
          
          {/* Bottom user section like in Slack */}
          <View
            style={[
              styles.userSection,
              { backgroundColor: colors.surface, paddingBottom: insets.bottom > 0 ? insets.bottom : 12, borderTopColor: colors.border },
            ]}
          >
            <View style={styles.currentUser}>
              <Image 
                source={{ uri: user?.profile_pic || 'https://via.placeholder.com/40' }} 
                style={styles.userAvatar} 
              />
              <Text style={[styles.userName, { color: colors.text }]} numberOfLines={1}>
                {user?.username || 'User'}
              </Text>
              <View style={[styles.onlineIndicator, { borderColor: colors.surface }]} />
            </View>
          </View>

          {/* Menu dropdown (Rendered outside SafeAreaView for positioning) */}
          {menuVisible && (
            <View style={StyleSheet.absoluteFill} pointerEvents="box-none"> 
              <TouchableWithoutFeedback onPress={() => setMenuVisible(false)}>
                <View style={styles.backdropTransparent} />
              </TouchableWithoutFeedback>
              <View style={[
                styles.menuDropdown, 
                { 
                  top: insets.top + 50,
                  backgroundColor: colorScheme === 'dark' ? '#333' : '#fff',
                  shadowColor: '#000',
                  shadowOpacity: 0.2,
                  shadowOffset: { width: 0, height: 2 },
                  shadowRadius: 8,
                  elevation: 5,
                }
              ]}>
                <TouchableOpacity 
                  style={styles.menuItem}
                  onPress={() => {
                    setMenuVisible(false);
                    setQRModalVisible(true);
                  }}
                >
                  <Ionicons name="qr-code-outline" size={20} color={colors.primary} style={styles.menuIcon}/>
                  <Text style={[styles.menuItemText, { color: colors.text }]}>Show Invite QR</Text>
                </TouchableOpacity>
                
                <TouchableOpacity 
                  style={styles.menuItem}
                  onPress={() => {
                    setNotificationEnabled(!notificationEnabled);
                    setMenuVisible(false);
                  }}
                >
                  <Ionicons 
                    name={notificationEnabled ? "notifications-outline" : "notifications-off-outline"} 
                    size={20} 
                    color={colors.primary} 
                    style={styles.menuIcon}
                  />
                  <Text style={[styles.menuItemText, { color: colors.text }]}>
                    Notifications: {notificationEnabled ? 'On' : 'Off'}
                  </Text>
                </TouchableOpacity>
                
                {isCreatorOrAdmin && (
                  <TouchableOpacity 
                    style={styles.menuItem}
                    onPress={() => {
                      setMenuVisible(false);
                      router.push(`/settings/${id}` as const);
                    }}
                  >
                    <Ionicons name="settings-outline" size={20} color={colors.primary} style={styles.menuIcon}/>
                    <Text style={[styles.menuItemText, { color: colors.text }]}>Settings</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          )}

        </SafeAreaView>
      </KeyboardAvoidingView>

      {/* QR Code Invite Modal */}
      {qrModalVisible && (
        <Modal 
          visible={qrModalVisible} 
          transparent 
          animationType="fade"
          onRequestClose={() => setQRModalVisible(false)}
        >
          <View style={styles.backdrop}>
            <View style={[styles.qrModalContainer, { backgroundColor: colorScheme === 'dark' ? '#333' : '#fff' }]}>
              <ViewShot ref={qrCodeRef} options={{ format: 'jpg', quality: 0.9 }}>
                <BrandedQRCard />
              </ViewShot>
              
              <View style={styles.qrModalButtons}>
                <TouchableOpacity 
                  onPress={() => {
                    const url = Linking.createURL(`/join/${id}`);
                    Clipboard.setStringAsync(url);
                    Alert.alert('Link Copied', 'Invite link copied to clipboard.');
                  }} 
                  style={[styles.qrButton, { backgroundColor: colors.border }]}
                >
                  <Ionicons name="copy-outline" size={20} color={colors.text} />
                  <Text style={[styles.qrButtonText, { color: colors.text }]}>Copy Link</Text>
                </TouchableOpacity>
                
                <TouchableOpacity 
                  onPress={shareQRCode} 
                  style={[styles.qrButton, { backgroundColor: colors.primary }]}
                >
                  <Ionicons name="share-outline" size={20} color="white" />
                  <Text style={[styles.qrButtonText, { color: 'white' }]}>Share QR</Text>
                </TouchableOpacity>
              </View>
              
              <TouchableOpacity 
                onPress={() => setQRModalVisible(false)} 
                style={styles.closeButton}
              >
                <Ionicons name="close-circle" size={36} color={colors.secondaryText} />
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      )}
      
      {/* Create Channel Modal */}
      {createChannelModalVisible && (
        <Modal 
          visible={createChannelModalVisible} 
          transparent 
          animationType="slide" 
          onRequestClose={() => setCreateChannelModalVisible(false)}
        >
          <View style={styles.backdrop}>
            <View style={[styles.modalContainer, { backgroundColor: colors.surface }]}>  
              <Text style={[styles.modalTitle, { color: colors.text }]}>Create Channel</Text>
              
              <TextInput
                style={[styles.modalInput, { borderColor: colors.border, color: colors.text }]}
                placeholder="Channel Name"
                placeholderTextColor={colors.secondaryText}
                value={newChannelName}
                onChangeText={setNewChannelName}
              />
              
              <View style={styles.modalGroupSelector}>
                <Text style={[styles.modalSectionTitle, { color: colors.text }]}>Channel Group:</Text>
                <View style={styles.modalGroupOptions}>
                  <TouchableOpacity 
                    style={[
                      styles.groupOptionButton,
                      newChannelGroup === 'Everyone' && 
                      { backgroundColor: colors.primary + '20', borderColor: colors.primary }
                    ]}
                    onPress={() => setNewChannelGroup('Everyone')}
                  >
                    <Text 
                      style={[
                        styles.groupOptionText,
                        newChannelGroup === 'Everyone' ? 
                        { color: colors.primary, fontWeight: '600' } : 
                        { color: colors.text }
                      ]}
                    >
                      Everyone
                    </Text>
                  </TouchableOpacity>
                  
                  <TouchableOpacity 
                    style={[
                      styles.groupOptionButton,
                      newChannelGroup === 'Staff' && 
                      { backgroundColor: colors.primary + '20', borderColor: colors.primary }
                    ]}
                    onPress={() => setNewChannelGroup('Staff')}
                  >
                    <Text 
                      style={[
                        styles.groupOptionText,
                        newChannelGroup === 'Staff' ? 
                        { color: colors.primary, fontWeight: '600' } : 
                        { color: colors.text }
                      ]}
                    >
                      Staff Only
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
              
              {newChannelGroup === 'Staff' && (
                <Text style={[styles.helperText, { color: colors.secondaryText }]}>
                  Staff channels are only visible to admins and moderators
                </Text>
              )}
              
              <View style={styles.modalButtons}>
                <TouchableOpacity
                  style={[
                    styles.button, 
                    { 
                      backgroundColor: colors.primary,
                      opacity: newChannelName.trim() ? 1 : 0.5
                    }
                  ]}
                  onPress={handleCreateChannel}
                  disabled={!newChannelName.trim() || loadingChannel}
                >
                  {loadingChannel ? (
                    <ActivityIndicator size="small" color="white" />
                  ) : (
                    <Text style={styles.buttonText}>Create</Text>
                  )}
                </TouchableOpacity>
                
                <TouchableOpacity
                  style={[styles.buttonOutlined, { borderColor: colors.primary }]}
                  onPress={() => setCreateChannelModalVisible(false)}
                  disabled={loadingChannel}
                >
                  <Text style={[styles.buttonTextOutlined, { color: colors.primary }]}>Cancel</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      )}
      
      {/* Channel Action Modal */}
      <Modal
        visible={channelActionModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setChannelActionModalVisible(false)}
      >
        <TouchableOpacity 
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setChannelActionModalVisible(false)}
        >
          <View style={[
            styles.actionModalContainer, 
            { backgroundColor: colorScheme === 'dark' ? '#333' : '#fff' }
          ]}>
            {selectedChannel && (
              <>
                <Text style={[styles.actionModalTitle, { color: colors.text }]}>
                  #{selectedChannel.name}
                </Text>
                
                <TouchableOpacity 
                  style={styles.actionModalItem}
                  onPress={() => {
                    setChannelActionModalVisible(false);
                    router.push(`/garden/channel/${selectedChannel.id}` as const);
                  }}
                >
                  <Ionicons name="chatbubble-outline" size={22} color={colors.primary} />
                  <Text style={[styles.actionModalItemText, { color: colors.text }]}>
                    Open Channel
                  </Text>
                </TouchableOpacity>
                
                <TouchableOpacity 
                  style={styles.actionModalItem}
                  onPress={() => toggleChannelLock(selectedChannel)}
                  disabled={updatingLockStatus}
                >
                  {updatingLockStatus ? (
                    <ActivityIndicator size="small" color={colors.primary} />
                  ) : (
                    <Ionicons 
                      name={channelLockStatus[selectedChannel.id as string] ? "lock-open-outline" : "lock-closed-outline"} 
                      size={22} 
                      color={colors.primary} 
                    />
                  )}
                  <Text style={[styles.actionModalItemText, { color: colors.text }]}>
                    {channelLockStatus[selectedChannel.id as string] ? "Unlock Channel" : "Lock Channel"}
                  </Text>
                </TouchableOpacity>
                
                <TouchableOpacity 
                  style={styles.actionModalItem}
                  onPress={() => {
                    setChannelActionModalVisible(false);
                    confirmDeleteChannel(selectedChannel);
                  }}
                >
                  <Ionicons name="trash-outline" size={22} color={colors.error} />
                  <Text style={[styles.actionModalItemText, { color: colors.error }]}>
                    Delete Channel
                  </Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </TouchableOpacity>
      </Modal>
    </GardenAuthProvider>
  );
}

const styles = StyleSheet.create({
  container: { 
    flex: 1,
  },
  flex: {
    flex: 1,
  },
  listContainer: {
    flex: 1, 
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  gardenInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 8,
  },
  gardenLogo: {
    width: 32,
    height: 32,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
  },
  gardenInitial: {
    fontSize: 16,
    fontWeight: 'bold',
    color: 'white',
  },
  gardenName: {
    fontSize: 17,
    fontWeight: '600',
    flexShrink: 1,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    height: 40,
    borderRadius: 8,
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.light.border,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    height: '100%',
  },
  contentContainer: {
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  channelGroup: {
    marginBottom: 16,
  },
  groupHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
    paddingHorizontal: 4,
  },
  groupTitle: {
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  channelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 6,
    marginBottom: 2,
  },
  channelIcon: {
    marginRight: 10,
  },
  channelName: {
    fontSize: 16,
    fontWeight: '500',
    flex: 1,
  },
  userSection: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  currentUser: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  userAvatar: {
    width: 32,
    height: 32,
    borderRadius: 8,
    marginRight: 10,
  },
  userName: {
    marginLeft: 0,
    fontWeight: '500',
    fontSize: 15,
    flex: 1,
  },
  onlineIndicator: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#2BAC76',
    position: 'absolute',
    left: 26,
    bottom: -1,
    zIndex: 1,
    borderWidth: 2,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 40,
  },
  emptyListContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  emptyListText: {
    fontSize: 16,
    textAlign: 'center',
  },
  menuButton: {
    padding: 8,
    marginLeft: 4,
  },
  menuDropdown: {
    position: 'absolute',
    right: 16,
    borderRadius: 10,
    paddingVertical: 8,
    width: 240,
    zIndex: 100,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  menuIcon: {
    marginRight: 12,
    width: 20,
    textAlign: 'center',
  },
  menuItemText: {
    fontSize: 16,
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  backdropTransparent: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    zIndex: 99,
    backgroundColor: 'rgba(0,0,0,0.1)',
  },
  qrModalContainer: {
    width: '90%',
    maxWidth: 340,
    borderRadius: 16,
    alignItems: 'center',
    padding: 20,
    overflow: 'hidden',
  },
  qrCard: {
    width: '100%',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    marginBottom: 8,
  },
  qrCardHeader: {
    marginBottom: 16,
  },
  qrCardTitle: {
    fontSize: 20,
    fontWeight: '600',
    textAlign: 'center',
  },
  qrCodeContainer: {
    padding: 16,
    backgroundColor: 'white',
    borderRadius: 12,
    marginBottom: 16,
  },
  qrLogosRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  qrUserAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: 'white',
  },
  qrGardenLogo: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: 'white',
  },
  qrArrow: {
    marginHorizontal: 10,
  },
  qrInviteText: {
    textAlign: 'center',
    fontSize: 14,
  },
  qrModalButtons: {
    flexDirection: 'row',
    marginTop: 16,
    width: '100%',
    justifyContent: 'space-between',
    gap: 10,
  },
  qrButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    paddingHorizontal: 10,
    borderRadius: 8,
    flex: 1,
  },
  qrButtonText: {
    marginLeft: 8,
    fontWeight: '500',
    fontSize: 15,
  },
  closeButton: {
    position: 'absolute',
    top: 12,
    right: 12,
  },
  addChannelButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  addChannelText: {
    marginLeft: 8,
    fontSize: 16,
    fontWeight: '500',
  },
  modalContainer: {
    width: '90%',
    maxWidth: 400,
    borderRadius: 12,
    padding: 20,
    alignSelf: 'center',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 16,
    textAlign: 'center',
  },
  modalInput: {
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 16,
    fontSize: 15,
  },
  modalGroupSelector: {
    marginVertical: 12,
  },
  modalSectionTitle: {
    fontSize: 14,
    fontWeight: '500',
    marginBottom: 8,
  },
  modalGroupOptions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  groupOptionButton: {
    flex: 1,
    padding: 12,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: '#ccc',
    alignItems: 'center',
    justifyContent: 'center',
  },
  groupOptionText: {
    fontSize: 14,
  },
  helperText: {
    fontSize: 12,
    fontStyle: 'italic',
    marginTop: 4,
    marginBottom: 16,
    textAlign: 'center',
  },
  modalButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
    gap: 12,
  },
  button: {
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 8,
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '600',
    color: 'white',
  },
  buttonOutlined: {
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 8,
    borderWidth: 1.5,
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonTextOutlined: {
    fontSize: 16,
    fontWeight: '600',
  },
  backButtonContainer: {
    padding: 8,
    marginRight: 4,
  },
  channelActionButton: {
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  actionModalContainer: {
    width: '80%',
    maxWidth: 300,
    borderRadius: 12,
    paddingTop: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
    overflow: 'hidden',
  },
  actionModalTitle: {
    fontSize: 17,
    fontWeight: '600',
    marginBottom: 8,
    textAlign: 'center',
    paddingHorizontal: 16,
  },
  actionModalItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(0, 0, 0, 0.1)',
  },
  actionModalItemText: {
    fontSize: 16,
    marginLeft: 16,
  },
});
