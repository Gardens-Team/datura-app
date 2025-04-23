import React, { useEffect, useState, useRef } from 'react';
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
  Modal
} from 'react-native';
import { useLocalSearchParams, router, useNavigation } from 'expo-router';
import { getChannelsByGarden, Channel, Garden as GardenType } from '@/services/garden-service';
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

export default function GardenScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [channels, setChannels] = useState<Channel[]>([]);
  const [garden, setGarden] = useState<GardenType | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [menuVisible, setMenuVisible] = useState(false);
  const [qrModalVisible, setQRModalVisible] = useState(false);
  const [notificationEnabled, setNotificationEnabled] = useState(true);
  const [isCreatorOrAdmin, setIsCreatorOrAdmin] = useState(false);
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const insets = useSafeAreaInsets();
  const { user } = useCurrentUser();
  const navigation = useNavigation();
  const menuRef = useRef(null);
  
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
        
        // Check if user is creator or admin
        if (user && data) {
          const isCreator = data.creator_id === user.id;
          // You would check for admin status here if you have that data
          // For now we'll just use creator status
          setIsCreatorOrAdmin(isCreator);
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

  // Group channels by category (for now we have just one group)
  const channelGroups = {
    'Channels': filteredChannels,
  };

  // Render each channel in Slack-like style
  const renderChannel = ({ item }: { item: Channel }) => (
    <TouchableOpacity 
      style={styles.channelRow} 
      onPress={() => router.push(`/garden/channel/${item.id}` as const)}
    >
      <Ionicons 
        name="chatbubble" 
        size={18} 
        color={colors.secondaryText} 
        style={styles.channelIcon}
      />
      <Text style={[styles.channelName, { color: colors.text }]}>
        {item.name}
      </Text>
    </TouchableOpacity>
  );

  // Render each channel group with header
  const renderChannelGroup = (title: string, data: Channel[]) => (
    <View style={styles.channelGroup}>
      <View style={styles.groupHeader}>
        <Text style={[styles.groupTitle, { color: colors.secondaryText }]}>
          {title.toUpperCase()}
        </Text>
        <TouchableOpacity>
          <Ionicons name="add" size={20} color={colors.secondaryText} />
        </TouchableOpacity>
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

  return (
    <GardenAuthProvider gardenId={id as string}>
      <SafeAreaView
        style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}
      >
        <StatusBar barStyle={colorScheme === 'dark' ? 'light-content' : 'dark-content'} />
        
        {/* Header with Garden info */}
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <View style={styles.gardenInfo}>
            {garden?.logo ? (
              <Image source={{ uri: garden.logo }} style={styles.gardenLogo} />
            ) : (
              <View style={[styles.gardenLogo, { backgroundColor: colors.primary }]}>
                <Text style={styles.gardenInitial}>
                  {garden?.name?.charAt(0).toUpperCase() || '?'}
                </Text>
              </View>
            )}
            <Text style={[styles.gardenName, { color: colors.text }]}>
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
          
          {/* Menu dropdown */}
          {menuVisible && (
            <View style={[
              styles.menuDropdown, 
              { 
                backgroundColor: colorScheme === 'dark' ? '#333' : '#fff',
                shadowColor: '#000',
                shadowOpacity: 0.2,
                shadowOffset: { width: 0, height: 2 },
                shadowRadius: 8,
                elevation: 3,
              }
            ]}>
              <TouchableOpacity 
                style={styles.menuItem}
                onPress={() => {
                  setMenuVisible(false);
                  setQRModalVisible(true);
                }}
              >
                <Ionicons name="qr-code-outline" size={20} color={colors.primary} />
                <Text style={[styles.menuItemText, { color: colors.text }]}>Show Invite QR</Text>
              </TouchableOpacity>
              
              <TouchableOpacity 
                style={styles.menuItem}
                onPress={() => {
                  setNotificationEnabled(!notificationEnabled);
                  // Here you would update notification settings in database
                  setMenuVisible(false);
                }}
              >
                <Ionicons 
                  name={notificationEnabled ? "notifications-outline" : "notifications-off-outline"} 
                  size={20} 
                  color={colors.primary} 
                />
                <Text style={[styles.menuItemText, { color: colors.text }]}>
                  Notifications: {notificationEnabled ? 'On' : 'Off'}
                </Text>
              </TouchableOpacity>
              
              {isCreatorOrAdmin && (
                <TouchableOpacity 
                  style={styles.menuItem}
                  onPress={() => {
                    // Navigate to settings or open settings modal
                    setMenuVisible(false);
                    // router.push(`/garden/settings/${id}` as const);
                    alert('Settings coming soon');
                  }}
                >
                  <Ionicons name="settings-outline" size={20} color={colors.primary} />
                  <Text style={[styles.menuItemText, { color: colors.text }]}>Settings</Text>
                </TouchableOpacity>
              )}
            </View>
          )}
          
          {/* Backdrop for closing menu */}
          {menuVisible && (
            <TouchableOpacity 
              style={styles.backdrop}
              onPress={() => setMenuVisible(false)}
            />
          )}
        </View>
        
        {/* Search channels */}
        <View style={[styles.searchContainer, { backgroundColor: colors.surface }]}>
          <Ionicons name="search" size={18} color={colors.secondaryText} />
          <TextInput
            style={[styles.searchInput, { color: colors.text }]}
            placeholder="Search channels"
            placeholderTextColor={colors.secondaryText}
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
        </View>
        
        {/* Channel list */}
        {loading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={colors.primary} />
          </View>
        ) : (
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            style={styles.flex}
            keyboardVerticalOffset={insets.top + 44}
          >
            <FlatList
              data={Object.entries(channelGroups)}
              keyExtractor={([title]) => title}
              renderItem={({ item: [title, data] }) => renderChannelGroup(title, data)}
              style={styles.flex}
              contentContainerStyle={[styles.contentContainer, { paddingBottom: 16 + insets.bottom }]}
            />
          </KeyboardAvoidingView>
        )}
        
        {/* Bottom user section like in Slack */}
        <View
          style={[
            styles.userSection,
            { backgroundColor: colors.surface, paddingBottom: insets.bottom + 12 },
          ]}
        >
          <View style={styles.currentUser}>
            <View style={styles.onlineIndicator} />
            <Image 
              source={{ uri: user?.profile_pic || 'https://via.placeholder.com/40' }} 
              style={styles.userAvatar} 
            />
            <Text style={[styles.userName, { color: colors.text }]}>
              {user?.username || 'User'}
            </Text>
          </View>
        </View>
        
        {/* QR Code Invite Modal */}
        {qrModalVisible && (
          <Modal visible transparent animationType="fade">
            <View style={styles.backdrop}>
              <View style={[styles.menuDropdown, { width: 260, alignItems: 'center' }]}>  
                <QRCode value={Linking.createURL(`/join/${id}` as string)} size={200} />
                <TouchableOpacity onPress={() => {
                  const url = Linking.createURL(`/join/${id}`);
                  Clipboard.setString(url);
                }} style={styles.menuItem}>
                  <Text style={[styles.menuItemText, { color: colors.text }]}>Copy Link</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setQRModalVisible(false)} style={styles.menuItem}>
                  <Text style={[styles.menuItemText, { color: colors.text }]}>Close</Text>
                </TouchableOpacity>
              </View>
            </View>
          </Modal>
        )}
      </SafeAreaView>
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
  },
  gardenInfo: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  gardenLogo: {
    width: 28,
    height: 28,
    borderRadius: 6,
    justifyContent: 'center',
    alignItems: 'center',
  },
  gardenInitial: {
    fontSize: 16,
    fontWeight: 'bold',
    color: 'white',
  },
  gardenName: {
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 8,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    height: 36,
    borderRadius: 8,
    marginHorizontal: 16,
    marginVertical: 12,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    paddingHorizontal: 8,
    height: '100%',
  },
  contentContainer: {
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  channelGroup: {
    marginBottom: 20,
  },
  groupHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  groupTitle: {
    fontSize: 12,
    fontWeight: '600',
  },
  channelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 4,
    borderRadius: 4,
  },
  channelIcon: {
    marginRight: 8,
  },
  channelName: {
    fontSize: 15,
    fontWeight: '500',
  },
  userSection: {
    padding: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(0,0,0,0.1)',
  },
  currentUser: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  userAvatar: {
    width: 24,
    height: 24,
    borderRadius: 4,
  },
  userName: {
    marginLeft: 8,
    fontWeight: '500',
    fontSize: 14,
  },
  onlineIndicator: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#2BAC76',
    position: 'absolute',
    left: 0,
    bottom: 0,
    zIndex: 1,
    borderWidth: 1,
    borderColor: 'white',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: { 
    fontSize: 18, 
    fontWeight: '700', 
    marginBottom: 12 
  },
  menuButton: {
    padding: 8,
  },
  menuDropdown: {
    position: 'absolute',
    top: 50,
    right: 16,
    borderRadius: 8,
    padding: 8,
    width: 220,
    zIndex: 10,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 6,
  },
  menuItemText: {
    fontSize: 15,
    marginLeft: 12,
  },
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 5,
  },
});
