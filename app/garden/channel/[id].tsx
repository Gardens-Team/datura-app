import React, { useCallback, useEffect, useState, useRef } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  Text,
  ActivityIndicator,
  Platform,
  StatusBar,
  SafeAreaView,
  KeyboardAvoidingView,
  Keyboard,
  Image,
  Pressable,
  Alert,
  Linking,
  TextStyle,
  Modal,
  ScrollView,
  Animated,
  FlatList,
  TextInput,
  LayoutAnimation,
  Dimensions,
  findNodeHandle,
  UIManager,
} from 'react-native';
import {
  GiftedChat,
  Bubble,
  MessageText,
  Day,
  InputToolbar,
  Composer,
  Send,
  Actions,
  IMessage,
  Avatar,
  Message as MessageComponent,
  User as ChatUser,
} from 'react-native-gifted-chat';
import { Audio, AVPlaybackStatus, ResizeMode, Video } from 'expo-av';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system';
import { useLocalSearchParams, router, useNavigation } from 'expo-router';
import { useColorScheme } from 'react-native';
import { Colors } from '@/constants/Colors';
import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as SecureStore from 'expo-secure-store';
import { supabase } from '@/services/supabase-singleton';
import { 
  DaturaClient,
  getDaturaClient, 
  batchDecryptMessages, 
  encryptMessage,
  decryptMessage,
  uploadMediaAsBase64,
  createMessageFromPayload,
  EnhancedMessage,
} from '@/services/datura-service';
import { Channel, Garden, isChannelLocked as checkChannelLocked } from '@/services/garden-service';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import * as Sharing from 'expo-sharing';
import AdminNotification from '@/components/AdminNotification';
import { useTheme } from '@react-navigation/native';
import ParsedText from 'react-native-parsed-text';
import * as Crypto from 'expo-crypto';
import * as MediaLibrary from 'expo-media-library';
import { getLinkPreview } from 'link-preview-js';
import { useDatura } from '../_layout';
import { LinearGradient } from 'expo-linear-gradient';

// Custom interface for the recording state
interface RecordingState {
  isRecording: boolean;
  isDoneRecording: boolean;
  recordingDuration: number;
  recordingUri: string | null;
}

// Fix the Channel type first by extending it to include description
interface ChannelWithDescription extends Channel {
  description?: string;
}

// Add interface for user data structure
interface ChannelUser {
  id: string;
  username: string;
  displayName: string | null;
  avatar: string;
  status: 'online' | 'idle' | 'offline';
  role?: string;
}

// Fix the garden member structure to match what Supabase returns
interface SupabaseUserData {
  id: string;
  username: string;
  profile_pic: string;
  displayName: string | null; // Make it required but nullable
}

// Add interface for membership data that matches the selected fields
interface Membership {
  user_id: string;
  role: string;
  channels: string[] | null;
}

// Add interface for the garden member with nested user
interface GardenMember {
  id: string;
  user_id: string;
  users: {
    id: string;
    username: string;
    profile_pic: string;
    displayName: string | null;
  } | null;
}

// --- Link Preview Component ---
interface LinkPreviewProps {
  url: string;
}

// Define a simple type for the preview data, or use 'any'
interface PreviewData {
  url?: string;
  title?: string;
  description?: string;
  images?: string[];
  // Add other potential fields from link-preview-js if needed
}

function LinkPreview({ url }: LinkPreviewProps) {
  const [previewData, setPreviewData] = useState<PreviewData | null>(null); // Use defined type or any
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];

  useEffect(() => {
    let isMounted = true;
    const fetchPreview = async () => {
      setLoading(true);
      setError(null);
      try {
        // Important: Client-side fetching might fail due to CORS
        const data = await getLinkPreview(url, {
           headers: { // Add headers to potentially mimic browser
             'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/100.0.4896.127 Safari/537.36',
             'Accept-Language': 'en-US,en;q=0.9',
             'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
           },
           timeout: 5000 // 5 second timeout
        });
        if (isMounted) {
          setPreviewData(data);
        }
      } catch (e: any) {
        console.warn(`[LinkPreview] Failed for ${url}:`, e.message || e);
        if (isMounted) {
           // Handle specific errors if needed, e.g., e.message contains 'CORS'
           setError('Could not load preview');
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    fetchPreview();

    return () => {
      isMounted = false; // Prevent state updates on unmounted component
    };
  }, [url]);

  const handlePress = () => {
    Linking.openURL(url).catch(err => console.error("Couldn't load page", err));
  };

  if (loading) {
    return (
      <View style={[styles.linkPreviewContainer, { backgroundColor: colors.background + '80'}]}>
        <ActivityIndicator size="small" color={colors.primary} />
        <Text style={[styles.linkPreviewUrl, { color: colors.secondaryText }]}>Loading preview...</Text>
      </View>
    );
  }

  if (error || !previewData || (!previewData.title && !previewData.description)) {
    // Fallback: Don't render anything here, the link is already in the main text
    // Optionally, render a small error indicator?
    return null; 
  }

  // Render the preview "bubble"
  return (
    <TouchableOpacity onPress={handlePress} style={[styles.linkPreviewContainer, { backgroundColor: colors.border + '30' }]}>
      {previewData.images && previewData.images.length > 0 && (
        <Image source={{ uri: previewData.images[0] }} style={styles.linkPreviewImage} resizeMode="cover" />
      )}
      <View style={styles.linkPreviewTextContainer}>
        {previewData.title && (
          <Text style={[styles.linkPreviewTitle, { color: colors.text }]} numberOfLines={2}>
            {previewData.title}
          </Text>
        )}
        {previewData.description && (
          <Text style={[styles.linkPreviewDescription, { color: colors.secondaryText }]} numberOfLines={3}>
            {previewData.description}
          </Text>
        )}
        <Text style={[styles.linkPreviewUrl, { color: colors.secondaryText }]} numberOfLines={1}>
           {previewData.url || url} // Display the URL from preview data or the original
        </Text>
      </View>
    </TouchableOpacity>
  );
}
// --- End Link Preview Component ---

// Custom MessageAudio component since it's not exported from gifted-chat
const MessageAudio = ({ currentMessage, audioStyle }: { currentMessage: IMessage, audioStyle?: any }) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackInstance, setPlaybackInstance] = useState<Audio.Sound | null>(null);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  
  useEffect(() => {
    return () => {
      if (playbackInstance) {
        playbackInstance.unloadAsync();
      }
    };
  }, [playbackInstance]);
  
  const handlePlayPause = async () => {
    if (!currentMessage.audio) return;
    
    try {
      if (isPlaying) {
        // Pause the audio
        if (playbackInstance) {
          await playbackInstance.pauseAsync();
          setIsPlaying(false);
        }
      } else {
        // Play the audio
        if (playbackInstance) {
          await playbackInstance.playAsync();
          setIsPlaying(true);
        } else {
          // Load the audio if not loaded yet
          const { sound } = await Audio.Sound.createAsync(
            { uri: currentMessage.audio },
            { shouldPlay: true },
            onPlaybackStatusUpdate
          );
          setPlaybackInstance(sound);
          setIsPlaying(true);
        }
      }
    } catch (error) {
      console.error('Error playing audio:', error);
    }
  };
  
  const onPlaybackStatusUpdate = (status: any) => {
    if (!status.isLoaded) return;
    
    setPosition(status.positionMillis);
    setDuration(status.durationMillis || 0);
    
    if (status.didJustFinish) {
      setIsPlaying(false);
      setPosition(0);
    }
  };
  
  const formatTime = (milliseconds: number) => {
    const totalSeconds = Math.floor(milliseconds / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };
  
  const audioStyles = {
    container: {
      backgroundColor: 'transparent',
      marginTop: 6,
      ...(audioStyle?.container || {})
    },
    wrapper: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      backgroundColor: 'transparent',
      padding: 8,
      ...(audioStyle?.wrapper || {})
    },
    playPauseButton: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: '#007AFF',
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
      ...(audioStyle?.playPauseButton || {})
    },
    playIcon: {
      ...(audioStyle?.playIcon || {}),
    },
    pauseIcon: {
      ...(audioStyle?.pauseIcon || {}),
    },
    duration: {
      marginLeft: 12,
      fontSize: 14,
      color: '#8E8E93',
      ...(audioStyle?.duration || {})
    }
  };
  
  return (
    <View style={audioStyles.container}>
      <View style={audioStyles.wrapper}>
        <TouchableOpacity style={audioStyles.playPauseButton} onPress={handlePlayPause}>
          <Ionicons 
            name={isPlaying ? 'pause' : 'play'} 
            size={24} 
            color="white" 
            style={isPlaying ? audioStyles.pauseIcon : audioStyles.playIcon}
          />
        </TouchableOpacity>
        <Text style={audioStyles.duration}>
          {formatTime(position)} / {formatTime(duration)}
        </Text>
      </View>
    </View>
  );
};

// Create a MessageSkeleton component
const MessageSkeleton = () => {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const bgColor = colorScheme === 'dark' ? '#2A2A2C' : '#F2F2F7';
  const highlightColor = colorScheme === 'dark' ? '#3A3A3C' : '#E5E5EA';
  
  return (
    <View style={styles.skeletonContainer}>
      {[1, 2, 3, 4, 5].map(i => (
        <View key={i} style={[styles.skeletonMessage, { backgroundColor: bgColor }]}>
          <View style={styles.skeletonAvatar} />
          <View style={styles.skeletonContent}>
            <View style={[styles.skeletonName, { backgroundColor: highlightColor }]} />
            <View style={[styles.skeletonText, { backgroundColor: highlightColor }]} />
          </View>
        </View>
      ))}
    </View>
  );
};

export default function ChannelScreen() {
  // Import useDatura with destructuring to access all the functions we need
  const { id } = useLocalSearchParams<{ id: string }>(); // channel id
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const { user } = useCurrentUser();
  const { 
    initializeClient, 
    daturaClient: contextDaturaClient,
    getGroupKey,
    storeGroupKey
  } = useDatura();
  const [daturaClient, setDaturaClient] = useState<DaturaClient | null>(contextDaturaClient);

  // Keep setup variables as refs
  const initializationAttempted = useRef(false);
  const setupCompleted = useRef(false);

  // States
  const [messages, setMessages] = useState<IMessage[]>([]);
  const [groupKey, setGroupKey] = useState<string | null>(null);
  const [inputText, setInputText] = useState('');
  const [inputHeight, setInputHeight] = useState(36); // Initial composer height
  const [isLoading, setIsLoading] = useState(false);
  const [typingUsers, setTypingUsers] = useState<string[]>([]);
  const [channel, setChannel] = useState<ChannelWithDescription | null>(null);
  const [garden, setGarden] = useState<Garden | null>(null);
  const [debugInfo, setDebugInfo] = useState<string>('Loading...');
  
  // New state variables for drawer and info popup
  const [drawerVisible, setDrawerVisible] = useState(false);
  const [infoVisible, setInfoVisible] = useState(false);
  const drawerAnimation = useRef(new Animated.Value(300)).current;
  const [channelUsers, setChannelUsers] = useState<ChannelUser[]>([]);
  
  // New ref for info popover positioning
  const infoButtonRef = useRef<View>(null);
  const [infoPosition, setInfoPosition] = useState({ top: 0, right: 0 });
  
  // Recording state management
  const [recording, setRecording] = useState<RecordingState>({
    isRecording: false,
    isDoneRecording: false,
    recordingDuration: 0,
    recordingUri: null,
  });
  
  // Refs
  const recordingInstance = useRef<Audio.Recording | null>(null);
  const recordingTimer = useRef<NodeJS.Timeout | null>(null);

  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [selectedVideo, setSelectedVideo] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [isDownloading, setIsDownloading] = useState(false);
  const [channelLocked, setChannelLocked] = useState(false);
  const [replyTo, setReplyTo] = useState<IMessage | null>(null);
  const [profileModalVisible, setProfileModalVisible] = useState(false);
  const [profileUser, setProfileUser] = useState<ChannelUser | null>(null);
  const [userProfiles, setUserProfiles] = useState<Record<string, SupabaseUserData>>({});

  // Determine current user's role
  const currentMember = channelUsers.find(u => u.id === user?.id);
  const currentRole = currentMember?.role;
  const isAdminUser = currentRole === 'creator' || currentRole === 'admin' || currentRole === 'moderator';

  // Mention state
  const [mentionLoading, setMentionLoading] = useState(false);
  const [mentionSuggestions, setMentionSuggestions] = useState<ChannelUser[]>([]);
  const [currentTextInput, setCurrentTextInput] = useState('');
  const [mentionedUsers, setMentionedUsers] = useState<string[]>([]);
  const [mentionStartIndex, setMentionStartIndex] = useState<number>(-1);

  // Add a ref for the text input
  const textInputRef = useRef<TextInput>(null);

  // Add these state variables 
  const [initialLoading, setInitialLoading] = useState(false); // Changed from true
  const [refreshing, setRefreshing] = useState(false);

  // Add to the top of your component
  const [wsConnected, setWsConnected] = useState(false);

  // Add effect to monitor WebSocket connection
  useEffect(() => {
    if (!daturaClient) return;
    
    const checkInterval = setInterval(() => {
      const isConnected = daturaClient.isConnected();
      setWsConnected(isConnected);
      
      if (!isConnected) {
        console.log('[ChannelScreen] WebSocket disconnected, attempting reconnect');
        daturaClient.reconnect();
      }
    }, 5000);
    
    return () => clearInterval(checkInterval);
  }, [daturaClient]);

  // Fetch channel and garden info
  useEffect(() => {
    async function fetchChannelInfo() {
      try {
        // fetch channel row first
        const { data: channelData, error: channelError } = await supabase
          .from('channels')
          .select('*')
          .eq('id', id)
          .single();
          
        if (channelError) throw channelError;
        
        setChannel(channelData);
        
        // Check if the channel is locked
        try {
          const locked = await checkChannelLocked(id as string);
          setChannelLocked(locked);
        } catch (error) {
          console.error('Error checking channel lock status:', error);
        }
        
        // fetch related garden separately (no foreign key join required)
        if (channelData && channelData.garden_id) {
          const { data: gardenRow } = await supabase
            .from('gardens')
            .select('*')
            .eq('id', channelData.garden_id)
            .single();
          if (gardenRow) setGarden(gardenRow as Garden);
        }
        
        // Set navigation title
        if (navigation.setOptions) {
          navigation.setOptions({
            title: `#${channelData.name}`,
            headerShown: false // We'll create our own header
          });
        }
      } catch (error) {
        console.error('Error fetching channel details:', error);
      }
    }
    
    fetchChannelInfo();
  }, [id, navigation]);

  // Fetch users in this channel
  useEffect(() => {
    async function fetchChannelUsers() {
      if (!channel) return;
      
      try {
        // First, get all garden memberships
        const { data: memberships, error: membershipError } = await supabase
          .from('memberships')
          .select('user_id, role, channels')
          .eq('garden_id', channel.garden_id);
          
        if (membershipError) {
          throw membershipError;
        }
        
        if (!memberships || memberships.length === 0) {
          return;
        }
        
        // Filter memberships to those who have access to this channel
        const channelMembers = memberships.filter((member) => {
          // Check if the channels array includes this channel ID
          // If channels field is null/undefined, use empty array
          const channels = member.channels || [];
          return channels.includes(id) || channels.length === 0; // Include if explicitly added or if no channels specified (all access)
        });
        
        if (channelMembers.length === 0) {
          return;
        }
        
        // Get user IDs that have access to this channel
        const userIds = channelMembers.map(member => member.user_id);
        
        // Fetch user data for these users
        const { data: userData, error: userError } = await supabase
          .from('users')
          .select('id, username, profile_pic, display_name')
          .in('id', userIds);
          
        if (userError) {
          throw userError;
        }
        
        if (!userData) {
          return;
        }
        
        // Combine user data with roles
        const statuses = ['online', 'idle', 'offline'] as const;
        const formattedUsers = userData.map(user => {
          // Find the matching membership to get role
          const membership = channelMembers.find(member => member.user_id === user.id);
          
          return {
            id: user.id,
            username: user.username || 'Unknown',
            avatar: user.profile_pic || '',
            displayName: user.display_name || null,
            status: statuses[Math.floor(Math.random() * statuses.length)], // Random status for demo
            role: membership?.role || 'member'
          };
        });
        
        setChannelUsers(formattedUsers);
      } catch (error) {
        console.error('Error fetching channel users:', error);
      }
    }
    
    fetchChannelUsers();
  }, [channel, id]);

  // Fetch user profiles
  const profileRequestCache = useRef(new Set<string>());
  const fetchUserProfiles = useCallback(async (userIds: string[]) => {
    if (userIds.length === 0) return;
    
    // Filter out IDs we've already requested
    const newUserIds = userIds.filter(id => 
      id && !profileRequestCache.current.has(id) && !userProfiles[id]
    );
    
    if (newUserIds.length === 0) {
      console.log('[ChannelScreen] All user profiles already requested or cached');
      return;
    }
    
    console.log(`[ChannelScreen] Fetching profiles for ${newUserIds.length} users`);
    
    // Mark these IDs as requested even before the request completes
    newUserIds.forEach(id => profileRequestCache.current.add(id));
    
    try {
      const { data, error } = await supabase
        .from('users')  // Use the correct table name
        .select('id, username, profile_pic, display_name')
        .in('id', newUserIds);
        
      if (error) {
        console.error('[ChannelScreen] Error fetching user profiles:', error);
        return;
      }
      
      if (!data || data.length === 0) {
        console.log('[ChannelScreen] No user profiles found');
        return;
      }
      
      console.log(`[ChannelScreen] Found ${data.length} user profiles`);
      
      // Create a new object with just the new profiles
      const newProfiles: Record<string, SupabaseUserData> = {};
      data.forEach(profile => {
        newProfiles[profile.id] = {
          id: profile.id,
          username: profile.username,
          profile_pic: profile.profile_pic,
          displayName: profile.display_name
        };
      });
      
      // Update the profiles state with merged data
      setUserProfiles(prevProfiles => ({
        ...prevProfiles,
        ...newProfiles
      }));
      
    } catch (error) {
      console.error('[ChannelScreen] Error in profile fetch:', error);
    }
  }, [userProfiles]);

  // Function to fetch the group key for a channel (keep this to fix linter errors)
  const getGroupKeyForChannel = useCallback(async (channelId: string, userId: string): Promise<string | null> => {
    console.log(`[ChannelScreen] Getting group key for channel ${channelId} and user ${userId}`);

    try {
      // 1. Get garden_id for the channel
      const { data: channel, error: channelError } = await supabase
        .from('channels')
        .select('garden_id')
        .eq('id', channelId)
        .single();
        
      if (channelError || !channel) {
        console.error('[ChannelScreen] Failed to get garden_id for channel:', channelError);
        return null;
      }
      
      console.log(`[ChannelScreen] Found garden_id: ${channel.garden_id}`);
      
      // 2. Get encrypted key from memberships
      const { data: membership, error: membershipError } = await supabase
        .from('memberships')
        .select('encrypted_group_key, user_id, garden_id')
        .eq('garden_id', channel.garden_id)
        .eq('user_id', userId)
        .single();
        
      if (membershipError || !membership) {
        console.error('[ChannelScreen] Membership not found or missing key:', membershipError);
        return null;
      }
      
      console.log(`[ChannelScreen] Found membership with key: ${membership.encrypted_group_key ? 'present' : 'missing'}`);
      
      if (!membership.encrypted_group_key) {
        console.error('[ChannelScreen] Membership found but encrypted_group_key is null or empty');
        return null;
      }
      
      // Log the first few characters of the key for debugging
      const keyStr = membership.encrypted_group_key as string;
      console.log(`[ChannelScreen] Retrieved key: ${keyStr.substring(0, 5)}...`);
      
      // Handle PostgreSQL bytea format (\x followed by hex)
      if (keyStr.startsWith('\\x')) {
        // Convert hex to base64
        try {
          console.log('[ChannelScreen] Converting hex key to base64');
          const hexBody = keyStr.slice(2); // Remove \x prefix
          const bytePairs = hexBody.match(/.{1,2}/g) || [];
          const bytes = new Uint8Array(bytePairs.map(h => parseInt(h, 16)));
          
          // Convert to base64
          let base64Key = '';
          const binString = Array.from(bytes).map(b => String.fromCharCode(b)).join('');
          base64Key = btoa(binString);
          
          console.log(`[ChannelScreen] Converted key: ${base64Key.substring(0, 5)}...`);
          return base64Key;
        } catch (e) {
          console.error('[ChannelScreen] Error converting hex key:', e);
          return null;
        }
      }
      
      // Check if already a valid base64 string
      const isValidBase64 = /^[A-Za-z0-9+/=]+$/.test(keyStr);
      if (!isValidBase64) {
        console.error('[ChannelScreen] Key is not a valid base64 string');
        return null;
      }
      
      return keyStr;
    } catch (e) {
      console.error('[ChannelScreen] Error getting group key:', e);
      return null;
    }
  }, []);

  // Manual function to force key refresh if needed - define before it's used in setupMessageHandling
  const refreshKey = useCallback(async () => {
    if (!user || !id) return;
    
    try {
      setDebugInfo('Refreshing key...');
      setIsLoading(true);
      const key = await getGroupKeyForChannel(id as string, user.id);
      setGroupKey(key || null);
      setDebugInfo(key ? `KEY: ${key.substring(0, 5)}...` : 'NO KEY');
      
      // No need to re-fetch messages with the new key - the WebSocket handler will handle it
    } catch (e) {
      console.error('Failed to refresh key:', e);
      setDebugInfo(`ERROR: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setIsLoading(false);
    }
  }, [user, id, getGroupKeyForChannel]);

  // Add the removeDuplicateMessages helper function
  const removeDuplicateMessages = (messages: IMessage[]): IMessage[] => {
    const seen = new Set();
    return messages.filter(msg => {
      if (seen.has(msg._id)) {
        return false;
      }
      seen.add(msg._id);
      return true;
    });
  };

  // Fix the handleMessageHistory function to properly type parameters
  const handleMessageHistory = useCallback((historyMessages: any[]) => {
    if (!groupKey || !historyMessages.length) {
      setIsLoading(false);
      return;
    }

    console.log(`[ChannelScreen] Processing ${historyMessages.length} history messages`);
    
    // Process each message
    const processedMessages = historyMessages
      .filter(msg => msg && msg.ciphertext)
      .map(msg => {
        try {
          // Decrypt message content
          const decrypted = decryptMessage(msg.ciphertext, groupKey);
          let payload;
          
          try {
            payload = JSON.parse(decrypted);
          } catch (parseErr) {
            console.warn(`[ChannelScreen] Failed to parse JSON for message ${msg.id}:`, parseErr);
            payload = { text: '[Encrypted message]' };
          }
          
          return createMessageFromPayload(msg, payload);
        } catch (decryptErr) {
          console.error(`[ChannelScreen] Failed to decrypt message ${msg.id}:`, decryptErr);
          return null;
        }
      })
      .filter(Boolean);
    
    // Add to existing messages
    setMessages(prevMessages => {
      // Merge messages and remove duplicates
      const combinedMessages = GiftedChat.append(prevMessages, processedMessages as IMessage[]);
      const uniqueMessages = removeDuplicateMessages(combinedMessages);
      
      // Sort by createdAt descending (newest first)
      return uniqueMessages.sort((a: IMessage, b: IMessage) => 
        (new Date(b.createdAt).getTime()) - (new Date(a.createdAt).getTime())
      );
    });
    
    // Collect unique user IDs for profile fetching
    const userIds = historyMessages
      .map(msg => msg.senderId)
      .filter(id => id && id !== user?.id && id !== 'system');
    
    if (userIds.length > 0) {
      fetchUserProfiles([...new Set(userIds)]);
    }
    
    setIsLoading(false);
  }, [groupKey, user?.id, fetchUserProfiles]);

  // Update the setupMessageHandling function to fix the 'error' linter error
  const setupMessageHandling = useCallback(() => {
    if (!daturaClient || !groupKey) return () => {};
    
    console.log('[ChannelScreen] Setting up WebSocket message handling');
    
    const messageHandler = (data: any) => {
      try {
        if (data.type === 'new_message') {
          // Handle new real-time message
          const msg = data.message;
          console.log('[ChannelScreen] Received new message:', msg.id);
          
          // Decrypt and process the message
          const decrypted = decryptMessage(msg.ciphertext, groupKey);
          let payload;
          
          try {
            payload = JSON.parse(decrypted);
          } catch (parseError) {
            console.warn(`[ChannelScreen] Failed to parse JSON for message ${msg.id}:`, parseError);
            payload = { text: '[Encrypted message]' };
          }
          
          // Create and add the new message
          const newMessage = createMessageFromPayload(msg, payload);
          
          setMessages(prevMessages => {
            // Check if message already exists
            if (prevMessages.some(m => m._id === newMessage._id)) {
              return prevMessages;
            }
            return GiftedChat.append(prevMessages, [newMessage]);
          });
          
          // Fetch user profile if needed
          if (msg.senderId && msg.senderId !== user?.id && msg.senderId !== 'system') {
            fetchUserProfiles([msg.senderId]);
          }
        } 
        else if (data.type === 'history_loaded') {
          // Handle initial message history load
          console.log(`[ChannelScreen] Received message history: ${data.messages.length} messages`);
          handleMessageHistory(data.messages);
        }
        else if (data.type === 'key_rotated') {
          // Handle key rotation
          console.log('[ChannelScreen] Key rotation detected, refreshing key');
          refreshKey();
        }
        else if (data.type === 'key_info') {
          // Handle key information from server
          console.log('[ChannelScreen] Received key info:', data.keyVersion);
          // No need to do anything special here as the client will handle requesting history
        }
        else if (data.type === 'error') {
          // Handle error message from server
          console.error('[ChannelScreen] Server error:', data.message);
          setDebugInfo(`ERROR: ${data.message || 'Unknown server error'}`);
        }
        else if (data.type === 'history_timeout') {
          // Handle history request timeout
          console.warn('[ChannelScreen] History request timed out');
          setDebugInfo('History request timed out. Try refreshing.');
          setIsLoading(false);
        }
      } catch (err) {
        console.error('[ChannelScreen] Error processing WebSocket message:', err);
      }
    };
    
    daturaClient.onMessage(messageHandler);
    
    return () => {
      // No explicit cleanup needed as the client handles this
      console.log('[ChannelScreen] Cleaning up message handler');
    };
  }, [daturaClient, groupKey, user?.id, fetchUserProfiles, refreshKey, handleMessageHistory]);
  
  // Update the onSend function to match the DaturaClient sendMessage signature
  const onSend = useCallback((newMessages: IMessage[] = []) => {
    if (!daturaClient || !groupKey || !id) return;
    
    const message = newMessages[0];
    
    // Don't send empty messages
    if (!message.text || message.text.trim().length === 0) {
      console.log('[ChannelScreen] Not sending empty message');
      return;
    }
    
    console.log('[ChannelScreen] Sending message:', message.text);
    
    // Create message payload
    const payload = {
      text: message.text,
      senderId: user?.id,
      senderName: user?.username || 'Unknown User',
      timestamp: new Date().toISOString(),
    };
    
    // Encrypt the payload
    const ciphertext = encryptMessage(JSON.stringify(payload), groupKey);
    
    // Send through WebSocket
    daturaClient.sendMessage(ciphertext, {
      messageType: 'Text'
    }).then(messageId => {
      console.log('[ChannelScreen] Message sent successfully, ID:', messageId);
    }).catch(err => {
      console.error('[ChannelScreen] Failed to send message:', err);
    });
  }, [daturaClient, groupKey, id, user?.id, user?.username]);

  // Request permissions for audio recording
  useEffect(() => {
    (async () => {
      const { status } = await Audio.requestPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission required', 'Audio recording permission is required to send voice messages.');
      }
    })();
    
    // Configure audio session for recording
    Audio.setAudioModeAsync({
      allowsRecordingIOS: true,
      playsInSilentModeIOS: true,
    });
    
    return () => {
      // Clean up when unmounting
      if (recordingTimer.current) {
        clearInterval(recordingTimer.current);
      }
      if (recordingInstance.current) {
        recordingInstance.current.stopAndUnloadAsync();
      }
    };
  }, []);

  // Start recording audio message
  const startRecording = async () => {
    try {
      const recording = new Audio.Recording();
      // @ts-ignore - constant present at runtime but missing in types
      await recording.prepareToRecordAsync((Audio as any).RECORDING_OPTIONS_PRESET_HIGH_QUALITY);
      await recording.startAsync();
      recordingInstance.current = recording;
      
      setRecording({
        isRecording: true,
        isDoneRecording: false,
        recordingDuration: 0,
        recordingUri: null,
      });
      
      // Start a timer to track recording duration
      recordingTimer.current = setInterval(() => {
        setRecording(prev => ({
          ...prev,
          recordingDuration: prev.recordingDuration + 1
        }));
      }, 1000);
      
    } catch (error) {
      console.error('Failed to start recording', error);
      Alert.alert('Error', 'Failed to start recording audio message');
    }
  };
  
  // Stop recording and get the audio file
  const stopRecording = async () => {
    if (!recordingInstance.current) return;
    
    try {
      // Stop the timer
      if (recordingTimer.current) {
        clearInterval(recordingTimer.current);
        recordingTimer.current = null;
      }
      
      await recordingInstance.current.stopAndUnloadAsync();
      const uri = recordingInstance.current.getURI();
      
      if (!uri) {
        throw new Error('Recording failed: no audio file was created');
      }
      
      // Update state to show the audio message preview
      setRecording({
        isRecording: false,
        isDoneRecording: true,
        recordingDuration: recording.recordingDuration,
        recordingUri: uri,
      });
      
      // Reset recording instance
      recordingInstance.current = null;
      
    } catch (error) {
      console.error('Failed to stop recording', error);
      Alert.alert('Error', 'Failed to process audio recording');
      
      // Reset recording state
      setRecording({
        isRecording: false,
        isDoneRecording: false,
        recordingDuration: 0,
        recordingUri: null,
      });
    }
  };
  
  // Cancel recording
  const cancelRecording = async () => {
    if (recordingTimer.current) {
      clearInterval(recordingTimer.current);
      recordingTimer.current = null;
    }
    
    if (recordingInstance.current) {
      await recordingInstance.current.stopAndUnloadAsync();
      recordingInstance.current = null;
    }
    
    setRecording({
      isRecording: false,
      isDoneRecording: false,
      recordingDuration: 0,
      recordingUri: null,
    });
  };
  
  // Send the audio message
  const sendAudioMessage = async () => {
    if (!recording.recordingUri || !user || !daturaClient || !groupKey) return;
    
    try {
      setIsLoading(true);

      // Add file size check
      const fileInfo = await FileSystem.getInfoAsync(recording.recordingUri);
      if (fileInfo.exists && fileInfo.size > 5 * 1024 * 1024) { // 5MB limit
        Alert.alert(
          "File too large", 
          "Audio recording exceeds 5MB limit. Please record a shorter message.",
          [{ text: "OK" }]
        );
        setIsLoading(false);
        return;
      }

      // Convert to base64
      const audioBase64 = await uploadMediaAsBase64(recording.recordingUri);
      
      // Create the message with audio content
      const audioMessage: EnhancedMessage = {
        _id: Crypto.randomUUID(),
        text: '',
        createdAt: new Date(),
        user: {
          _id: user.id,
          name: user.username,
          avatar: user.profile_pic,
        },
        audio: audioBase64,
      };
      
      // Add to messages immediately for UI responsiveness
      setMessages(previousMessages => 
        GiftedChat.append(previousMessages, [audioMessage] as IMessage[])
      );
      
      // Encrypt and send via Datura
      const payload = {
        text: '',
        audio: audioBase64
      };
      
      const encryptedPayload = encryptMessage(JSON.stringify(payload), groupKey);
      await daturaClient.sendMessage(encryptedPayload, { messageType: 'Audio' });
      
      // Reset recording state
      setRecording({
        isRecording: false,
        isDoneRecording: false,
        recordingDuration: 0,
        recordingUri: null,
      });
    } catch (error) {
      console.error('Failed to send audio message', error);
      Alert.alert('Error', 'Failed to send audio message. Please try again with a shorter recording.');
    } finally {
      setIsLoading(false);
    }
  };
  
  // Pick and send an image
  const handlePickImage = async () => {
    if (!user || !daturaClient || !groupKey) return;
    
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    
    if (status !== 'granted') {
      Alert.alert('Permission required', 'Photo library permissions are needed to send images');
      return;
    }
    
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: "images",
        allowsEditing: true,
        quality: 0.6, // Lower quality for smaller file size
      });
      
      if (!result.canceled && result.assets[0].uri) {
        setIsLoading(true);
        
        // Add file size check
        const fileInfo = await FileSystem.getInfoAsync(result.assets[0].uri);
        if (fileInfo.exists && fileInfo.size > 5 * 1024 * 1024) { // 5MB limit
          Alert.alert(
            "File too large", 
            "Image exceeds 5MB limit. Please select a smaller image or use the compression option.",
            [{ text: "OK" }]
          );
          setIsLoading(false);
          return;
        }
        
        // Upload the image (convert to base64)
        const imageBase64 = await uploadMediaAsBase64(result.assets[0].uri);
        
        // Create and send the message
        const imageMessage: EnhancedMessage = {
          _id: Crypto.randomUUID(),
          text: '',
          createdAt: new Date(),
          user: {
            _id: user.id,
            name: user.username,
            avatar: user.profile_pic,
          },
          image: imageBase64,
        };
        
        // Add to messages immediately for UI responsiveness
        setMessages(previousMessages => 
          GiftedChat.append(previousMessages, [imageMessage] as IMessage[])
        );
        
        // Encrypt and send via Datura
        const payload = {
          text: '',
          image: imageBase64
        };
        
        const encryptedPayload = encryptMessage(JSON.stringify(payload), groupKey);
        await daturaClient.sendMessage(encryptedPayload, { messageType: 'Image' });
      }
    } catch (error) {
      console.error('Failed to send image message', error);
      Alert.alert('Error', 'Failed to send image. Please try a smaller or compressed image.');
    } finally {
      setIsLoading(false);
    }
  };

  // Delete a message
  const deleteMessage = async (messageId: string): Promise<void> => {
    // For now, we'll just remove it from the local state
    // In a real implementation, you would need to send a delete request to the server
    setMessages(prev => prev.filter(m => m._id !== messageId));
    
    // TODO: Implement server-side message deletion via Datura API when available
    console.log(`[ChannelScreen] Message deleted locally: ${messageId}`);
  };

  // Handle long press on message for reply or delete
  const handleLongPressMessage = useCallback((context: any, message: IMessage) => {
    const options: string[] = ['Reply'];
    const actions: Array<() => void> = [() => setReplyTo(message)];

    // Check delete permission
    const msgMember = channelUsers.find(u => u.id === message.user._id);
    const msgRole = msgMember?.role;
    const canDelete = message.user._id === user?.id || (isAdminUser && msgRole !== 'creator' && msgRole !== 'admin');
    if (canDelete) {
      options.push('Delete');
      actions.push(async () => {
        try {
          await deleteMessage(message._id as string);
        } catch (e) {
          console.error('Failed to delete message', e);
          Alert.alert('Error', 'Failed to delete message');
        }
      });
    }

    options.push('Cancel');
    actions.push(() => {});

    Alert.alert('Message Actions', '', options.map((opt, i) => ({ text: opt, onPress: actions[i], style: opt === 'Delete' ? 'destructive' : 'default' })), { cancelable: true });
  }, [channelUsers, isAdminUser, user]);

  // Add an effect to initialize channel and persist state
  useEffect(() => {
    if (!id || !user?.id) return;
    
    let mounted = true;
    console.log(`[ChannelScreen] Initialization effect running for channel ${id}`);
    
    const initialize = async () => {
      try {
        console.log(`[ChannelScreen] Initializing Datura client for channel ${id}`);
        const client = await initializeClient(id as string);
        
        if (!mounted) return;
      
        if (client) {
          setDaturaClient(client);
          console.log('[ChannelScreen] Datura client initialized successfully');
          
          // Explicitly set the channel ID to ensure it's correct
          console.log(`[ChannelScreen] Setting channel ID in newly initialized client: ${id}`);
          client.setChannelId(id as string);
          
          // Try to get the group key from context storage first
          let key = getGroupKey(id as string);
          
          if (!key) {
            try {
              console.log(`[ChannelScreen] Getting group key for channel ${id} and user ${user.id}`);
              key = await getGroupKeyForChannel(id as string, user.id);
              
              if (!mounted) return;
              
              if (key) {
                // Store the key in context storage
                storeGroupKey(id as string, key);
                console.log(`[ChannelScreen] Successfully stored group key for channel ${id}`);
              } else {
                console.warn(`[ChannelScreen] Failed to get group key for channel ${id}`);
              }
            } catch (e) {
              console.error('[ChannelScreen] Failed to get group key:', e);
              setDebugInfo(`ERROR: ${e instanceof Error ? e.message : String(e)}`);
            }
          } else {
            console.log(`[ChannelScreen] Using stored group key for channel ${id}`);
          }
          
          setGroupKey(key);
          setDebugInfo(key ? `KEY: ${key.substring(0, 5)}...` : 'NO KEY');
          
          // Verify that the channel ID is still set correctly
          const clientChannelId = client.getChannelId();
          console.log(`[ChannelScreen] Verification - Client's channel ID: ${clientChannelId}`);
          if (clientChannelId !== id) {
            console.warn(`[ChannelScreen] Channel ID mismatch after initialization. Re-setting to ${id}`);
            client.setChannelId(id as string);
          }
        } else {
          console.warn('[ChannelScreen] Failed to initialize Datura client');
        }
      } catch (error) {
        console.error('[ChannelScreen] Error initializing Datura client:', error);
      } finally {
        // Set loading to false after initialization is complete (success or failure)
        if (mounted) {
          setIsLoading(false);
        }
      }
    };
    
    initialize();
    
    // Cleanup function
    return () => {
      console.log(`[ChannelScreen] Cleaning up initialization effect for channel ${id}`);
      mounted = false;
    };
  }, [id, user?.id, initializeClient, getGroupKey, storeGroupKey, getGroupKeyForChannel]);
  
  // Add an effect to handle WebSocket reconnections
  useEffect(() => {
    if (!daturaClient || !id) return;
    
    // Force channelId to be correct on every mount/update
    console.log(`[ChannelScreen] Ensuring channel ID is set to: ${id}`);
    daturaClient.setChannelId(id as string);
    
    // Set up a periodic check for the WebSocket connection
    const checkInterval = setInterval(() => {
      const isConnected = daturaClient.isConnected();
      const currentChannelId = daturaClient.getChannelId();
      
      setWsConnected(isConnected);
      
      console.log(`[ChannelScreen] Connection check - Connected: ${isConnected}, ChannelID: ${currentChannelId}`);
      
      if (!isConnected) {
        console.log('[ChannelScreen] WebSocket disconnected, attempting reconnect');
        
        // Ensure channelId is set before reconnecting
        if (currentChannelId !== id) {
          console.log(`[ChannelScreen] Channel ID mismatch: current=${currentChannelId}, expected=${id}`);
          daturaClient.setChannelId(id as string);
        }
        
        daturaClient.reconnect();
      }
    }, 5000);
    
    return () => {
      console.log('[ChannelScreen] Cleaning up WebSocket reconnection interval');
      clearInterval(checkInterval);
    };
  }, [daturaClient, id]);

  // Set up message subscription when client and key are available
  useEffect(() => {
    if (!daturaClient || !groupKey || !setupCompleted.current) {
        return;
    }
    
    // Define the message subscription setup function inline
    const setupMessageSubscription = () => {
      console.log('[ChannelScreen] Setting up live subscription for channel', id);
      
      if (!daturaClient) {
        console.warn('[ChannelScreen] No Datura client available for real-time messages');
        return () => {}; // Return empty cleanup function
      }
      
      console.log('[ChannelScreen] Using Datura client for real-time messages');
      
      // Set up message handler
      daturaClient.onMessage((data) => {
        if (data.type === 'new_message') {
          console.log('[ChannelScreen] Received new message');
          
          // Process incoming message
          const msg = data.message;
          
          if (msg && groupKey) {
            try {
              // Decrypt the message
              const payloadStr = decryptMessage(msg.ciphertext, groupKey);
              const payload = JSON.parse(payloadStr);
              
              // Create message object
              const newMessage = createMessageFromPayload(msg, payload);
              
              // Add to messages state
              setMessages(prev => GiftedChat.append(prev, [newMessage]));
              
              // Fetch user profile for the sender
              if (msg.senderId) {
                fetchUserProfiles([msg.senderId]);
              }
            } catch (err) {
              console.error('[ChannelScreen] Error processing live message:', err);
            }
          }
        }
      });
      
      // Return cleanup function
      return () => {
        console.log('[ChannelScreen] Cleaning up message subscription');
      };
    };
    
    const unsubscribe = setupMessageSubscription();
        
    return unsubscribe;
  }, [daturaClient, groupKey, id, fetchUserProfiles, decryptMessage]);
  
  // Add a safety effect to clear loading state after a timeout
  useEffect(() => {
    if (isLoading) {
      // Set a timeout to clear loading state if it gets stuck
      const timer = setTimeout(() => {
        console.log('[ChannelScreen] Safety timeout: clearing loading state');
        setIsLoading(false);
      }, 10000); // 10 seconds timeout
      
      return () => clearTimeout(timer);
    }
  }, [isLoading]);
  
  // Remove the separate effect for getting the group key since we now do it in the initialization
  // effect

  // Handle avatar press
  const onAvatarPress = (avatarUser: any) => {
    const cu = channelUsers.find(u => u.id === avatarUser._id);
    if (cu) {
      if (cu.id === user?.id) {
        // Handle click on own avatar differently if needed
        return;
      }
      
      // First show the profile card
      setProfileUser(cu);
      setProfileModalVisible(true);
    }
  };

  // Navigation to DM from profile modal
  const navigateToDM = (userId: string) => {
    setProfileModalVisible(false);
    router.push(`/dm/${userId}`);
  };

  // Custom user avatar with online status indicator
  const renderAvatar = (props: any) => {
    const { currentMessage } = props;
    const cu = channelUsers.find(u => u.id === currentMessage.user._id);
    const userId = currentMessage.user._id.toString();
    const profile = userProfiles[userId];
    
    // Get profile picture from userProfiles if available
    const avatarUrl = profile?.profile_pic || currentMessage.user.avatar || '';
    
    return (
      <TouchableOpacity onPress={() => onAvatarPress(currentMessage.user)}>
        <View style={styles.avatarContainer}>
          {/* Use Image directly for better control and fallback */}
          {avatarUrl ? (
            <Image 
              source={{ uri: avatarUrl }} 
              style={styles.avatarImage} 
            />
          ) : (
            <View style={[styles.avatarFallback, { backgroundColor: colors.border }]}>
              <Text style={[styles.avatarFallbackText, { color: colors.text }]}>
                {profile?.username?.charAt(0).toUpperCase() || 
                 currentMessage.user.name?.charAt(0).toUpperCase() || 
                 '?'} 
              </Text>
            </View>
          )}
          {cu && (
            <View 
              style={[
                styles.statusIndicator, 
                { backgroundColor: cu.status === 'online' ? '#4CAF50' : 
                                      cu.status === 'idle' ? '#FF9800' : '#9E9E9E' }
              ]} 
            />
          )}
        </View>
      </TouchableOpacity>
    );
  };

  // Update the renderCustomView to show username from userProfiles
  const renderCustomView = (props: any) => {
    const { currentMessage } = props;
    const userId = currentMessage.user._id.toString();
    const profile = userProfiles[userId];
    const cu = channelUsers.find(u => u.id === currentMessage.user._id);
    const isCurrentUser = currentMessage.user._id === user?.id;
    
    // Don't show custom view for own messages
    if (isCurrentUser) return null;
    
    const displayName = profile?.username || cu?.username || currentMessage.user.name || 'User';
    
    return (
      <View style={[styles.customView, { alignSelf: 'flex-start' }]}>
        <Text style={[styles.username, { color: colors.primary }]}>
          {displayName}
        </Text>
        
        {currentMessage.replyTo && (
          <View style={styles.replyIndicator}>
            <Ionicons name="return-up-back" size={12} color={colors.secondaryText} />
            <Text style={styles.replyText} numberOfLines={1}>
              Replying to a message
            </Text>
          </View>
        )}
      </View>
    );
  };

  // Process text with quotes - ensure line is properly typed
  const processQuotes = (text: string) => {
    if (!text) return [];
    
    const lines = text.split('\n');
    const result: { text: string; isQuote: boolean }[] = [];
    
    lines.forEach((line: string) => {
      const quoteMatch = line.match(/^\s*>\s?(.*)/);
      if (quoteMatch) {
        result.push({ text: quoteMatch[1], isQuote: true });
      } else {
        result.push({ text: line, isQuote: false });
      }
    });
    
    return result;
  };

  // --- Render Message Text --- 
  const renderMessageText = (props: any) => {
    const { currentMessage } = props;
    const textColor = colors.text;
    const mentionColor = colors.primary;
    const linkColor = colors.primary;
    
    // Extract URL for potential preview rendering
    const detectedUrl = extractUrl(currentMessage.text);

    // Get lines that are quotes (start with >)
    const lines = currentMessage.text.split('\n');
    const hasQuotes = lines.some((line: string) => /^\s*>\s/.test(line));

    // Process text with quotes
    const processedText = processQuotes(currentMessage.text);

    if (hasQuotes) {
      // Render with custom quote blocks
      return (
        <View> 
          {processedText.map((item, index) => (
            <View key={index} style={componentStyles.quoteContainer}>
              <ParsedText
                style={[
                  { 
                    fontFamily: 'Inter',
                    fontSize: 15,
                    lineHeight: 20,
                    color: textColor,
                  },
                  item.isQuote ? { color: colors.secondaryText } : {}
                ]}
                parse={[
                  { // Mention highlighting
                    pattern: /@(\w+)/, 
                    style: { color: mentionColor, fontWeight: 'bold' },
                    onPress: (match: string) => {
                      const username = match.substring(1); 
                      const mentionedUser = channelUsers.find(u => u.username === username);
                      if (mentionedUser) {
                        setProfileUser(mentionedUser);
                        setProfileModalVisible(true);
                      }
                    }
                  },
                  { // Link styling (make clickable)
                    type: 'url',
                    style: { color: linkColor, textDecorationLine: 'underline' },
                    onPress: (url: string) => Linking.openURL(url).catch(err => console.error("Couldn't load page", err)),
                  },
                ]}
              >
                {item.text}
              </ParsedText>
            </View>
          ))}
          
          {/* Conditionally render the LinkPreview component below the text */}
          {detectedUrl && <LinkPreview url={detectedUrl} />}
        </View>
      );
    }

    // Default rendering for messages without quotes
    return (
      <View> 
        <ParsedText
          style={{ // Basic text style
            fontFamily: 'Inter',
            fontSize: 15,
            lineHeight: 20,
            color: textColor,
          }}
          parse={[
            { // Mention highlighting
              pattern: /@(\w+)/, 
              style: { color: mentionColor, fontWeight: 'bold' },
              onPress: (match: string) => {
                const username = match.substring(1); 
                const mentionedUser = channelUsers.find(u => u.username === username);
                if (mentionedUser) {
                  setProfileUser(mentionedUser);
                  setProfileModalVisible(true);
                }
              }
            },
            { // Link styling (make clickable)
              type: 'url',
              style: { color: linkColor, textDecorationLine: 'underline' },
              onPress: (url: string) => Linking.openURL(url).catch(err => console.error("Couldn't load page", err)),
            },
          ]}
        >
          {currentMessage.text}
        </ParsedText>
        
        {/* Conditionally render the LinkPreview component below the text */}
        {detectedUrl && <LinkPreview url={detectedUrl} />}
      </View>
    );
  };

  // Custom day separator
  const renderDay = (props: any) => {
    return (
      <Day
        {...props}
        textStyle={{
          color: colors.secondaryText,
          fontSize: 12,
        }}
        containerStyle={{
          marginTop: 16,
          marginBottom: 12,
        }}
      />
    );
  };
  
  // Improve renderMentionSuggestions for better visibility
  const renderMentionSuggestions = () => {
    if (mentionSuggestions.length === 0) return null;
    
    return (
      <View style={[styles.mentionSuggestions, { 
        backgroundColor: colorScheme === 'dark' ? '#1C1C1E' : '#FFFFFF',
        borderColor: colors.border,
        bottom: 50, // Adjusted to be closer to the input
        position: 'absolute',
        zIndex: 2
      }]}>
        <FlatList
          data={mentionSuggestions}
          keyExtractor={item => item.id}
          keyboardShouldPersistTaps="always"
          renderItem={({ item }) => (
            <TouchableOpacity 
              style={styles.mentionItem}
              onPress={() => handleSelectMention(item)}
            >
              <Image 
                source={{ uri: item.avatar || 'https://via.placeholder.com/32' }} 
                style={styles.mentionAvatar}
              />
              <Text style={[styles.mentionUsername, { color: colors.text }]}>
                @{item.username}
              </Text>
            </TouchableOpacity>
          )}
          ListEmptyComponent={
            mentionLoading ? (
              <ActivityIndicator color={colors.primary} size="small" />
            ) : (
              <Text style={[styles.emptyMention, { color: colors.secondaryText }]}>
                No users found
              </Text>
            )
          }
        />
      </View>
    );
  };
  
  // Custom composer with interactive quote rendering
  const renderComposer = (props: any) => {
    // Process text to detect quotes for interactive rendering
    const processInputWithQuotes = (text: string) => {
      if (!text) return [];
      
      const lines = text.split('\n');
      const result: { text: string; isQuote: boolean }[] = [];
      
      lines.forEach((line: string) => {
        const quoteMatch = line.match(/^\s*>\s?(.*)/);
        if (quoteMatch) {
          result.push({ text: line, isQuote: true });
        } else {
          result.push({ text: line, isQuote: false });
        }
      });
      
      return result;
    };

    const processedInput = processInputWithQuotes(inputText);
    const hasQuotes = processedInput.some(item => item.isQuote);

    // Use interactive input with quote rendering
    if (hasQuotes) {
      return (
        <View style={componentStyles.composerContainer}>
          <View style={componentStyles.composerInputWrapper}>
            <ScrollView style={{ maxHeight: Math.min(120, inputHeight) }}>
              {processedInput.map((item, index) => (
                <View key={index} style={item.isQuote ? componentStyles.inputQuoteContainer : {}}>
                  <Text style={[
                    componentStyles.composerText,
                    item.isQuote ? componentStyles.inputQuoteText : {}
                  ]}>
                    {item.text}
                  </Text>
                </View>
              ))}
              <TextInput
                ref={textInputRef}
                style={[
                  componentStyles.hiddenTextInput,
                  { height: Math.max(36, inputHeight) }
                ]}
                value={inputText}
                onChangeText={(text) => {
                  setInputText(text);
                  props.onTextChanged(text);
                  
                  // Animate height changes
                  LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
                }}
                onContentSizeChange={(e) => {
                  setInputHeight(Math.max(36, Math.min(120, e.nativeEvent.contentSize.height)));
                }}
                multiline={true}
                placeholder="Type a message..."
                placeholderTextColor={colors.secondaryText}
                {...props}
              />
            </ScrollView>
          </View>
        </View>
      );
    }

    // Default composer for non-quote text
    return (
      <TextInput
        ref={textInputRef}
        style={[
          componentStyles.composerInput,
          { 
            color: colors.text,
            backgroundColor: colorScheme === 'dark' ? '#1C1C1E' : '#F2F2F7',
            height: Math.max(36, inputHeight) 
          }
        ]}
        value={inputText}
        onChangeText={(text) => {
          setInputText(text);
          props.onTextChanged(text);
        }}
        onContentSizeChange={(e) => {
          setInputHeight(Math.max(36, Math.min(120, e.nativeEvent.contentSize.height)));
        }}
        placeholder="Type a message..."
        placeholderTextColor={colors.secondaryText}
        multiline={true}
        {...props}
      />
    );
  };
  
  // Custom send button
  const renderSend = (props: any) => {
    return (
      <Send
        {...props}
        disabled={!props.text}
        containerStyle={{
          justifyContent: 'center',
          alignItems: 'center',
          height: 44,
          width: 44,
        }}
      >
        {/* Show Mic icon if no text, Send icon if text */}
        {props.text.trim().length > 0 ? (
          <View style={[styles.sendButtonContainer, { 
            backgroundColor: colors.primary,
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 1 },
            shadowOpacity: 0.2,
            shadowRadius: 1.5,
            elevation: 2,
          }]}>
            <Ionicons name="send" size={18} color="white" />
          </View>
        ) : (
          <View style={[
            styles.sendButtonContainer,
            { 
              backgroundColor: colorScheme === 'dark' ? '#333333' : '#F5F5F7',
              borderColor: colorScheme === 'dark' ? '#444444' : '#E5E5EA',
              borderWidth: 1,
            }
          ]}> 
            <Ionicons name="mic" size={22} color={colors.primary} />
          </View>
        )}
      </Send>
    );
  };
  
  // Custom input toolbar
  const renderInputToolbar = (props: any) => {
    return (
      <View style={{ flex: 1, marginBottom: 0, paddingBottom: 0, position: 'relative' }}>
        {/* Position mention suggestions right above the input */}
        {mentionSuggestions.length > 0 && renderMentionSuggestions()}
        <InputToolbar
          {...props}
          containerStyle={[
            styles.inputToolbar,
            { 
              backgroundColor: colorScheme === 'dark' ? '#1C1C1E' : '#F2F2F7',
              borderTopColor: colors.border,
              marginBottom: 0,
              paddingBottom: 0,
              paddingTop: 0,
              position: 'absolute',
              bottom: 0,
              left: 0,
              right: 0
            }
          ]}
          primaryStyle={{
            alignItems: 'center',
            marginBottom: 0,
            paddingBottom: 0,
            paddingTop: 0,
            minHeight: 44
          }}
          accessoryStyle={{
            height: recording.isRecording ? 70 : 0
          }}
        />
      </View>
    );
  };
  
  // Format recording time
  const formatTime = (seconds: number): string => {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
  };
  
  // Custom render for messages with audio content
  const renderMessageAudio = (props: any) => {
    if (!props.currentMessage.audio) return null;
    
    // Add logging to debug audio content
    console.log('[Audio Renderer] Audio URL type:', typeof props.currentMessage.audio);
    console.log('[Audio Renderer] Audio URL starts with:', props.currentMessage.audio.substring(0, 30) + '...');
    
    // For data URLs, we need to ensure they're properly formatted
    let audioSource = props.currentMessage.audio;
    if (audioSource && !audioSource.startsWith('http') && !audioSource.startsWith('data:audio')) {
      // If it's base64 but missing the data:audio prefix, add it
      if (audioSource.startsWith('/9j/') || audioSource.startsWith('UklGR')) {
        audioSource = `data:audio/mp4;base64,${audioSource}`;
      } else if (audioSource.includes('base64')) {
        // It has base64 in it but might be missing proper formatting
        if (!audioSource.startsWith('data:')) {
          audioSource = `data:audio/mp4;${audioSource}`;
        }
      }
      console.log('[Audio Renderer] Reformatted audio URL:', audioSource.substring(0, 30) + '...');
    }
    
    // Define consistent styles independent of position
    const audioBackgroundColor = colorScheme === 'dark' ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)';
    const playButtonColor = colors.primary; // Use primary color for play button
    const durationColor = colors.secondaryText; // Use secondary text color

    return (
      <MessageAudio
        currentMessage={{...props.currentMessage, audio: audioSource}}
        audioStyle={{
          container: {
            backgroundColor: 'transparent', // Keep container transparent
            marginTop: 6,
          },
          wrapper: {
            backgroundColor: audioBackgroundColor, // Use consistent background
            borderRadius: 12,
            paddingVertical: 6,
            paddingHorizontal: 10,
          },
          playPauseButton: {
            backgroundColor: playButtonColor, // Use consistent play button color
            borderRadius: 20,
            width: 40,
            height: 40,
            alignItems: 'center',
            justifyContent: 'center',
          },
          playIcon: { marginLeft: 2 },
          pauseIcon: {},
          duration: {
            color: durationColor, // Use consistent duration color
            marginLeft: 10,
            fontSize: 13,
          },
        }}
      />
    );
  };

  // Function to download media directly to device
  async function handleDownload(uri: string, type: 'image' | 'video') {
    try {
      setIsDownloading(true);
      setDownloadProgress(0);
      
      // Show toast or alert that download is starting
      Alert.alert("Download Started", `Downloading ${type}...`);
      
      let base64Data = uri;
      // If data URI, strip prefix
      if (uri.startsWith('data:')) {
        base64Data = uri.split(',')[1];
      }
      
      const timestamp = Date.now();
      const ext = type === 'image' ? '.jpg' : '.mp4';
      const filename = `gardens-${timestamp}${ext}`;
      const fileDir = FileSystem.documentDirectory || FileSystem.cacheDirectory;
      const path = fileDir + filename;
      
      // Write base64 to file, tracking progress
      await FileSystem.writeAsStringAsync(path, base64Data, { 
        encoding: FileSystem.EncodingType.Base64 
      });
      
      // Get permissions for media library
      if (Platform.OS === 'ios') {
        // For iOS, we save to Camera Roll
        const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (status !== 'granted') {
          Alert.alert("Permission Denied", "Cannot save to your photo library without permission");
          setIsDownloading(false);
          return;
        }
        
        // Save to Camera Roll
        if (type === 'image') {
          await MediaLibrary.saveToLibraryAsync(path);
        } else {
          await MediaLibrary.saveToLibraryAsync(path);
        }
        
        Alert.alert(
          "Download Complete", 
          `${type === 'image' ? 'Image' : 'Video'} saved to your Photos`,
          [{ text: "OK" }]
        );
      } else {
        // For Android, we use MediaLibrary
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
          `${type === 'image' ? 'Image' : 'Video'} saved to your gallery`,
          [{ text: "OK" }]
        );
      }
      
      // Clean up the temp file
      await FileSystem.deleteAsync(path, { idempotent: true });
      
    } catch (e) {
      console.error('Download failed:', e);
      Alert.alert('Error', 'Failed to download media.');
    } finally {
      setIsDownloading(false);
    }
  }

  // Custom render for image messages
  const renderMessageImage = (props: any) => {
    if (!props.currentMessage.image) return null;

    // const isCurrentUser = props.currentMessage.user._id === user?.id;

    return (
      <View style={styles.mediaWrapper}> 
        <Pressable
          onPress={() => {
            setSelectedImage(props.currentMessage.image);
          }}
        >
          {/* Use a single container style, remove user/other distinction */}
          <View style={styles.mediaContainer}>
            <Image
              source={{ uri: props.currentMessage.image }}
              style={styles.messageImage} // Ensure styles.messageImage is suitable
              resizeMode="cover"
            />
          </View>
        </Pressable>
        
        {/* Keep download button logic (could be based on isCurrentUser if needed) */}
        {/* Example: { !isCurrentUser && ( ... ) } */}
        <TouchableOpacity
          style={styles.mediaDownloadButton}
          onPress={() => handleDownload(props.currentMessage.image, 'image')}
        >
          <View style={styles.downloadButtonInner}>
            <Ionicons name="download-outline" size={18} color="white" />
          </View>
        </TouchableOpacity>
      </View>
    );
  };

  // Custom render for video messages
  const renderMessageVideo = (props: any) => {
    if (!props.currentMessage.video) return null;

    // const isCurrentUser = props.currentMessage.user._id === user?.id;

    return (
      <View style={styles.mediaWrapper}>
        <TouchableOpacity 
          onPress={() => setSelectedVideo(props.currentMessage.video)}
          // Use a single container style, remove user/other distinction
          style={styles.mediaContainer} 
        >
          <Video
            source={{ uri: props.currentMessage.video }}
            style={styles.messageVideo} // Ensure styles.messageVideo is suitable
            resizeMode={ResizeMode.COVER}
            useNativeControls={false}
            isLooping={false}
            shouldPlay={false}
          />
          <View style={styles.videoPlayButton}>
            <Ionicons name="play-circle" size={42} color="white" />
          </View>
        </TouchableOpacity>
        
        {/* Keep download button logic */}
        {/* Example: { !isCurrentUser && ( ... ) } */}
        <TouchableOpacity 
          style={styles.mediaDownloadButton}
          onPress={() => handleDownload(props.currentMessage.video, 'video')}
        >
          <View style={styles.downloadButtonInner}>
            <Ionicons name="download-outline" size={18} color="white" />
          </View>
        </TouchableOpacity>
      </View>
    );
  };

  // Animation functions for drawer
  const openDrawer = () => {
    setDrawerVisible(true);
    Animated.timing(drawerAnimation, {
      toValue: 0,
      duration: 250,
      useNativeDriver: true,
    }).start();
  };

  const closeDrawer = () => {
    Animated.timing(drawerAnimation, {
      toValue: 300,
      duration: 250,
      useNativeDriver: true,
    }).start(() => {
      setDrawerVisible(false);
    });
  };

  // Drawer component
  const renderDrawer = useCallback(() => {
    if (!drawerVisible) return null;
    
    return (
      <View style={styles.drawerContainer}>
        <Pressable style={styles.drawerOverlay} onPress={closeDrawer} />
        <Animated.View 
          style={[
            styles.drawer, 
            { 
              backgroundColor: colorScheme === 'dark' ? '#1C1C1E' : '#FFFFFF',
              transform: [{ translateX: drawerAnimation }],
            }
          ]}
        >
          {/* Channel info section */}
          <View style={styles.drawerHeader}>
            <Text style={[styles.drawerTitle, { color: colors.text }]}>
              #{channel?.name || 'Channel'}
            </Text>
            <Text style={[styles.drawerSubtitle, { color: colors.secondaryText }]}>
              {channel?.description || 'No description'}
            </Text>
          </View>
          
          {/* Users section */}
          <View style={styles.drawerSection}>
            <Text style={[styles.sectionTitle, { color: colors.secondaryText }]}>
              MEMBERS ({channelUsers.length})
            </Text>
            <ScrollView style={styles.userList}>
              {channelUsers.map(user => (
                <View key={user.id} style={styles.userItem}>
                  <View style={styles.userAvatarContainer}>
                    <Image 
                      source={{ uri: user.avatar || 'https://via.placeholder.com/40' }} 
                      style={styles.userAvatar} 
                    />
                    <View style={[
                      styles.statusIndicator, 
                      { backgroundColor: user.status === 'online' ? '#2BAC76' : 
                                        user.status === 'idle' ? '#FFCC00' : '#8E8E93' }
                    ]} />
                  </View>
                  <Text style={[styles.userName, { color: colors.text }]}>
                    {user.username}
                  </Text>
                </View>
              ))}
            </ScrollView>
          </View>
        </Animated.View>
      </View>
    );
  }, [drawerVisible, colorScheme, drawerAnimation, channel?.name, channel?.description, channelUsers, colors.text, colors.secondaryText, closeDrawer]);

  // Toggle info dropdown with type-safe implementation
  const toggleInfoBox = useCallback(() => {
    if (!infoVisible && infoButtonRef.current) {
      // Measure the position of the info button to position the dropdown
      infoButtonRef.current.measure?.((x, y, width, height, pageX, pageY) => {
        setInfoPosition({
          top: pageY + height + 5,
          right: 10,
        });
        setInfoVisible(true);
      });
    } else {
      setInfoVisible(false);
    }
  }, [infoVisible]);

  // Info box component - replaces the modal
  const renderInfoBox = useCallback(() => {
    if (!infoVisible) return null;
    
    return (
      <View style={styles.infoBoxOverlay} onTouchStart={() => setInfoVisible(false)}>
        <Animated.View 
          style={[
            styles.infoBox, 
            { 
              backgroundColor: colorScheme === 'dark' ? '#2C2C2E' : '#FFFFFF',
              top: infoPosition.top,
              right: infoPosition.right,
            }
          ]}
          onTouchStart={(e) => e.stopPropagation()}
        >
          <View style={styles.infoBoxHeader}>
            <Ionicons name="lock-closed" size={18} color={colors.primary} />
            <Text style={[styles.infoBoxTitle, { color: colors.text }]}>
              End-to-End Encrypted
            </Text>
          </View>
          
          <Text style={[styles.infoBoxText, { color: colors.text }]}>
            Messages in this channel are end-to-end encrypted. Only members of this garden can read them.
          </Text>
          
          <Text style={[styles.infoBoxText, { color: colors.secondaryText, fontSize: 12, marginTop: 4 }]}>
            Encryption keys are stored locally on your device.
          </Text>
        </Animated.View>
      </View>
    );
  }, [infoVisible, colorScheme, infoPosition.top, infoPosition.right, colors.primary, colors.text, colors.secondaryText]);

  // Profile modal when clicking on avatar
  const renderProfileModal = () => {
    if (!profileUser) return null;
    
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

  // Updated render header function
  const renderHeader = useCallback(() => {
    return (
      <View style={[styles.header, { backgroundColor: colorScheme === 'dark' ? '#1C1C1E' : '#FFFFFF' }]}>
        <TouchableOpacity 
          style={styles.backButton} 
          onPress={() => router.back()}
        >
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        
        <View style={styles.headerCenter}>
          <View style={styles.headerTitleContainer}>
            <Text style={[styles.channelName, { color: colors.text }]}>
              #{channel?.name || 'Channel'}
            </Text>
            {channelLocked && (
              <Ionicons name="lock-closed" size={16} color={colors.text} style={styles.lockIcon} />
            )}
          </View>
          <Text style={[styles.gardenName, { color: colors.secondaryText }]}>
            {garden?.name || 'Garden'}
          </Text>
        </View>
        
        <View style={styles.headerRightButtons}>
          <TouchableOpacity style={styles.hamburgerButton} onPress={openDrawer}>
            <Ionicons name="menu" size={22} color={colors.primary} />
          </TouchableOpacity>
          
          {renderHeaderRight()}
        </View>
      </View>
    );
  }, [colorScheme, colors.text, colors.primary, colors.secondaryText, channel?.name, garden?.name, channelLocked]);

  // Improve the debug display with more info and a refresh button
  const renderDebugInfo = useCallback(() => (
    <View style={{ 
      position: 'absolute', 
      top: 100, 
      right: 10, 
      backgroundColor: 'rgba(0,0,0,0.8)', 
      padding: 8, 
      borderRadius: 4,
      zIndex: 999 
    }}>
      <TouchableOpacity onPress={refreshKey}>
        <Text style={{color: 'white', fontSize: 10}}>
          {isLoading ? 'LOADING' : `READY (${messages.length})`}
          {'\n'}
          {debugInfo}
        </Text>
      </TouchableOpacity>
    </View>
  ), [isLoading, messages.length, debugInfo, refreshKey]);

  // Custom render for system messages including admin notifications
  const renderSystemMessage = (props: any) => {
    try {
      // Check if this is a system notification message
      if (props.currentMessage.user?._id === 'system') {
        // Parse the content
        let notification;
        try {
          // If it's JSON content, parse it
          notification = JSON.parse(props.currentMessage.text);
        } catch (e) {
          // Not JSON, just use text as is
          return (
            <View style={{ 
              padding: 10, 
              backgroundColor: colorScheme === 'dark' ? '#2C2C2E' : '#F2F2F7',
              borderRadius: 8,
              margin: 10,
              alignItems: 'center'
            }}>
              <Text style={{ color: colors.secondaryText, fontStyle: 'italic' }}>
                {props.currentMessage.text}
              </Text>
            </View>
          );
        }
        
        // If it's a membership request notification, render AdminNotification component
        if (notification.type === 'membership_request') {
          const { type, userId, username, profilePic, timestamp, actionRequired } = notification;
          return (
            <AdminNotification 
              type={type}
              userId={userId}
              username={username}
              profilePic={profilePic}
              timestamp={timestamp}
              actionRequired={actionRequired}
              gardenId={channel?.garden_id || ''}
              onAction={() => {
                // Refresh message history after action
                if (daturaClient && groupKey) {
                  // Request new message history instead of calling loadMessages
                  console.log('[ChannelScreen] Requesting fresh message history after admin action');
                  daturaClient.getMessageHistory(50)
                    .then(historyMessages => {
                      handleMessageHistory(historyMessages);
                    })
                    .catch(error => {
                      console.error('[ChannelScreen] Error refreshing messages after admin action:', error);
                    });
                }
              }}
            />
          );
        }
        
        // Other system message types can be handled here
        return (
          <View style={{ 
            padding: 10, 
            backgroundColor: colorScheme === 'dark' ? '#2C2C2E' : '#F2F2F7',
            borderRadius: 8,
            margin: 10 
          }}>
            <Text style={{ color: colors.text }}>
              {typeof props.currentMessage.text === 'string' 
                ? props.currentMessage.text 
                : 'System Notification'}
            </Text>
          </View>
        );
      }
      
      // Not a system message, use default renderer
      return undefined;
    } catch (error) {
      console.error('Error rendering system message:', error);
      return null;
    }
  };

  // Add back the live subscription effect after we have the groupKey
  useEffect(() => {
    let unsub: (() => void) | undefined;
    
    if (groupKey && id) {
      // Set up live subscription for new messages
      (async () => {
        try {
          console.log(`[ChannelScreen] Setting up live subscription for channel ${id}`);
          
          // With daturaClient, we don't need this anymore - using setupMessageSubscription instead
          if (daturaClient) {
            console.log(`[ChannelScreen] Using Datura client for real-time messages`);
            return;
          }
          
          // If no Datura client, we should show a warning
          console.warn(`[ChannelScreen] No Datura client available for real-time messages`);
          
        } catch (e) {
          console.error('[ChannelScreen] Failed to setup subscription:', e);
        }
      })();
    }
    
    // Cleanup subscription on unmount
    return () => {
      if (unsub) {
        console.log('[ChannelScreen] Cleaning up message subscription');
        unsub();
      }
    };
  }, [id, groupKey, daturaClient]);
  
  // Add an initial effect to get the group key when user ID is available
  useEffect(() => {
    const getKey = async () => {
      if (!user || !id) return;
      
      try {
        console.log(`[ChannelScreen] Getting group key for channel ${id} and user ${user.id}`);
        const key = await getGroupKeyForChannel(id as string, user.id);
        setGroupKey(key || null);
        setDebugInfo(key ? `KEY: ${key.substring(0, 5)}...` : 'NO KEY');
      } catch (e) {
        console.error('[ChannelScreen] Failed to get group key:', e);
        setDebugInfo(`ERROR: ${e instanceof Error ? e.message : String(e)}`);
      }
    };
    
    getKey();
  }, [id, user, getGroupKeyForChannel]);

  // Slack style: Helper to check if the message is from the current user
  const isCurrentUser = (message: IMessage) => message.user._id === user?.id;

  // Slack style: Helper to get user profile (replace direct access if needed)
  const getUserProfile = (userId: string) => userProfiles[userId] || {};

  // Helper function to extract the first URL from text
  const extractUrl = (text: string): string | null => {
    if (!text) return null;
    // Simple regex for URL detection (adjust as needed for more complex cases)
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const matches = text.match(urlRegex);
    return matches ? matches[0] : null;
  };

  // Add styles for quote rendering inline at the component level
  // Create a local function that returns styles using the current colors and colorScheme
  const getComponentStyles = () => {
    // Get fresh references to theme values
    const currentColorScheme = colorScheme;
    const currentColors = colors;

    return {
      quoteContainer: {
        borderLeftWidth: 4,
        borderLeftColor: currentColors.primary + '80',
        backgroundColor: currentColorScheme === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.04)',
        paddingLeft: 10,
        paddingVertical: 6,
        borderRadius: 4,
        marginVertical: 4,
      },
      composerContainer: {
        flex: 1,
        marginLeft: 8,
        marginRight: 8,
        marginBottom: 5,
      },
      composerInputWrapper: {
        backgroundColor: currentColorScheme === 'dark' ? '#1C1C1E' : '#F2F2F7',
        borderRadius: 18,
        paddingHorizontal: 12,
        paddingVertical: 8,
        maxHeight: 120,
      },
      hiddenTextInput: {
        position: 'absolute',
        opacity: 0, 
        left: 0,
        right: 0,
        top: 0,
        height: '100%',
      },
      composerText: {
        color: currentColors.text,
        fontSize: 16,
        lineHeight: 20,
        fontFamily: 'Inter',
      },
      composerInput: {
        flex: 1,
        marginLeft: 8,
        paddingHorizontal: 12,
        paddingTop: 8,
        paddingBottom: 8,
        borderRadius: 18,
        fontFamily: 'Inter',
        fontSize: 16,
      },
      inputQuoteContainer: {
        borderLeftWidth: 4,
        borderLeftColor: currentColors.primary + '80',
        backgroundColor: currentColorScheme === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.04)',
        paddingLeft: 10,
        paddingVertical: 4,
        borderRadius: 4,
        marginVertical: 2,
      },
      inputQuoteText: {
        color: currentColors.secondaryText,
      },
    };
  };

  // Generate the styles once
  const componentStyles = getComponentStyles();

  // Add getMentionSuggestions function back
  const getMentionSuggestions = useCallback(async (searchTerm: string) => {
    console.log(`[Mention] Searching for users matching "${searchTerm}"`);
    setMentionLoading(true);
    
    try {
      // If we already have channel users, filter them locally
      if (channelUsers.length > 0) {
        console.log(`[Mention] Filtering ${channelUsers.length} channel users`);
        
        const filteredUsers = channelUsers.filter(
          channelUser => channelUser.username.toLowerCase().includes(searchTerm.toLowerCase()) && 
                  channelUser.id !== user?.id // Don't suggest the current user
        );
        console.log(`[Mention] Found ${filteredUsers.length} matching users`);
        setMentionSuggestions(filteredUsers);
        setMentionLoading(false);
        return;
      }
      
      // Otherwise, fetch users from Supabase
      console.log(`[Mention] Fetching users from Supabase matching "${searchTerm}"`);
      const { data, error } = await supabase
        .from('users')
        .select('id, username, profile_pic, display_name')
        .ilike('username', `%${searchTerm}%`)
        .not('id', 'eq', user?.id) // Don't show the current user
        .limit(5);
      
      if (error) {
        console.error('[Mention] Error fetching mention suggestions:', error);
        setMentionLoading(false);
        return;
      }
      
      if (data && data.length) {
        console.log(`[Mention] Found ${data.length} users from Supabase`);
        const formattedUsers = data.map(user => ({
          id: user.id,
          username: user.username || 'User',
          avatar: user.profile_pic || '',
          displayName: user.display_name || null,
          status: 'online' as const,
        }));
        
        setMentionSuggestions(formattedUsers);
      } else {
        console.log('[Mention] No users found');
        setMentionSuggestions([]);
      }
    } catch (error) {
      console.error('[Mention] Error getting mention suggestions:', error);
      setMentionSuggestions([]);
    } finally {
      setMentionLoading(false);
    }
  }, [channelUsers, user?.id]);

  // Add handleInputTextChanged back
  const handleInputTextChanged = useCallback((text: string) => {
    setCurrentTextInput(text);
    console.log(`[Mention] Input text changed: "${text}"`);
    
    // Check if user is typing a mention
    const lastAtSymbolIndex = text.lastIndexOf('@');
    if (lastAtSymbolIndex !== -1) {
      // Check if @ is at the start of the text or after a space
      if (lastAtSymbolIndex === 0 || text[lastAtSymbolIndex - 1] === ' ') {
        const query = text.substring(lastAtSymbolIndex + 1);
        console.log(`[Mention] Detected @ at index ${lastAtSymbolIndex}, query: "${query}"`);
        setMentionStartIndex(lastAtSymbolIndex);
        getMentionSuggestions(query);
        return;
      }
    }
    
    // If we're not currently typing a mention, clear suggestions
    if (mentionSuggestions.length > 0) {
      console.log('[Mention] Clearing suggestions');
      setMentionSuggestions([]);
      setMentionStartIndex(-1);
    }
  }, [getMentionSuggestions, mentionSuggestions.length]);

  // Add handleSelectMention back
  const handleSelectMention = useCallback((user: ChannelUser) => {
    if (mentionStartIndex === -1) return;
    
    // Replace the @query with @username
    const beforeMention = currentTextInput.substring(0, mentionStartIndex);
    const afterMention = currentTextInput.substring(mentionStartIndex + 1 + (currentTextInput.substring(mentionStartIndex + 1).split(' ')[0]).length);
    const newText = `${beforeMention}@${user.username} ${afterMention}`;
    
    // Update the text input
    setCurrentTextInput(newText);
    
    // Add user to mentioned users list
    setMentionedUsers(prev => [...prev.filter(id => id !== user.id), user.id]);
    
    // Clear suggestions
    setMentionSuggestions([]);
    setMentionStartIndex(-1);
  }, [mentionStartIndex, currentTextInput]);

  // Render reply preview above composer
  const renderAccessory = () => replyTo ? (
    <View style={[styles.replyPreview, { backgroundColor: colorScheme === 'dark' ? '#333' : '#f0f0f0' }]}>
      <TouchableOpacity onPress={() => setReplyTo(null)} style={styles.replyCancel}>
        <Ionicons name="close" size={16} color={colors.secondaryText} />
      </TouchableOpacity>
      <Text style={[styles.replyUsername, { color: colors.primary }]}>
        Replying to {replyTo.user.name}
      </Text>
      <Text numberOfLines={1} style={[styles.replyText, { color: colors.text }]}>
        {replyTo.text || 'Media...' }
      </Text>
    </View>
  ) : null;

  // Add specific debug useEffect for channel ID
  useEffect(() => {
    console.log('[ChannelScreen DEBUG] Current channel ID:', id);
    
    // Try to verify if this channel exists in Supabase
    const checkChannelExists = async () => {
      try {
        const { data, error } = await supabase
          .from('channels')
          .select('id, name, garden_id')
          .eq('id', id)
          .single();
          
        if (error) {
          console.error('[ChannelScreen DEBUG] Channel lookup error:', error);
          console.log('[ChannelScreen DEBUG] Channel may not exist in Supabase:', id);
        } else {
          console.log('[ChannelScreen DEBUG] Channel exists in Supabase:', data?.id);
          console.log('[ChannelScreen DEBUG] Channel name:', data?.name);
          console.log('[ChannelScreen DEBUG] Garden ID:', data?.garden_id);
        }
      } catch (err) {
        console.error('[ChannelScreen DEBUG] Error checking channel:', err);
      }
    };
    
    checkChannelExists();
  }, [id]);

  
  // Add the debug button to the header right
  const renderHeaderRight = useCallback(() => (
    <View style={{ flexDirection: 'row' }}>
      <TouchableOpacity 
        ref={infoButtonRef}
        onPress={toggleInfoBox}
      >
        <Ionicons 
          name={infoVisible ? "close-circle-outline" : "information-circle-outline"} 
          size={24} 
          color={colors.text} 
        />
      </TouchableOpacity>
    </View>
  ), [infoVisible, colors.text, toggleInfoBox]);

  return (
    <View
      style={[
        styles.container,
        { 
          backgroundColor: colorScheme === 'dark' ? '#000000' : '#FFFFFF',
          paddingTop: insets.top,
          paddingBottom: 0
        },
      ]}
    >
      <StatusBar barStyle={colorScheme === 'dark' ? 'light-content' : 'dark-content'} />
      
      {/* Debug info */}
      {renderDebugInfo()}
      
      {/* Custom Header */}
      {renderHeader()}
      
      {/* Channel locked banner */}
      {channelLocked && (
        <View style={[styles.lockedBanner, { backgroundColor: colors.error + '20' }]}>
          <Ionicons name="lock-closed" size={16} color={colors.error} />
          <Text style={[styles.lockedBannerText, { color: colors.error }]}>
            This channel has been locked. No new messages can be sent.
          </Text>
        </View>
      )}
      
      {/* Render drawer */}
      {renderDrawer()}
      
      {/* Render info dropdown box */}
      {renderInfoBox()}
      
      {/* Image Viewer Modal */}
      {selectedImage && (
        <Modal visible transparent animationType="fade" onRequestClose={() => setSelectedImage(null)}>
          <View style={styles.imageModalOverlay}>
            <TouchableOpacity style={styles.imageModalClose} onPress={() => setSelectedImage(null)}>
              <Ionicons name="close-circle" size={36} color="white" />
            </TouchableOpacity>
            
            <Image
              source={{ uri: selectedImage }}
              style={styles.imageModalImage}
              resizeMode="contain"
            />
            
            <TouchableOpacity 
              style={styles.imageModalDownload} 
              onPress={() => {
                handleDownload(selectedImage, 'image');
                setSelectedImage(null);
              }}
            >
              <View style={styles.modalDownloadContainer}>
                <Ionicons name="download-outline" size={24} color="white" />
                <Text style={styles.modalDownloadText}>Save</Text>
              </View>
            </TouchableOpacity>
          </View>
        </Modal>
      )}
      
      {/* Video Player Modal */}
      {selectedVideo && (
        <Modal visible transparent animationType="fade" onRequestClose={() => setSelectedVideo(null)}>
          <View style={styles.imageModalOverlay}>
            <TouchableOpacity style={styles.imageModalClose} onPress={() => setSelectedVideo(null)}>
              <Ionicons name="close-circle" size={36} color="white" />
            </TouchableOpacity>
            
            <Video
              source={{ uri: selectedVideo }}
              style={styles.videoModalPlayer}
              useNativeControls
              resizeMode={ResizeMode.CONTAIN}
              isLooping
              shouldPlay
            />
            
            <TouchableOpacity 
              style={styles.imageModalDownload} 
              onPress={() => {
                handleDownload(selectedVideo, 'video');
                setSelectedVideo(null);
              }}
            >
              <View style={styles.modalDownloadContainer}>
                <Ionicons name="download-outline" size={24} color="white" />
                <Text style={styles.modalDownloadText}>Save</Text>
              </View>
            </TouchableOpacity>
          </View>
        </Modal>
      )}
      
      {/* Download Progress Modal */}
      {isDownloading && (
        <Modal transparent animationType="fade">
          <View style={styles.downloadProgressOverlay}>
            <View style={styles.downloadProgressContent}>
              <ActivityIndicator size="large" color={colors.primary} />
              <Text style={[styles.downloadProgressText, { color: colors.text }]}>
                Downloading...
              </Text>
            </View>
          </View>
        </Modal>
      )}
      
      {/* Profile Modal */}
      {renderProfileModal()}
      
      {/* Always show chat UI, remove loading skeleton completely */}
      <View style={[styles.flex, { paddingBottom: 0, marginBottom: 0 }]}>
        {/* Connection indicator */}
        <View style={styles.connectionIndicator}>
          <View style={[
            styles.connectionDot, 
            { backgroundColor: wsConnected ? '#4CAF50' : '#F44336' }
          ]} />
        </View>
        
        {/* Custom Messages Container */}
        <FlatList
          data={messages}
          keyExtractor={item => item._id.toString()}
          renderItem={({ item }): React.ReactElement | null => { // Ensure return type includes null
            // System messages have their own renderer
            if (item.user._id === 'system') {
              const systemMessageElement = renderSystemMessage({ currentMessage: item });
              // Directly return the element or null if it's not a valid element
              return React.isValidElement(systemMessageElement) ? systemMessageElement : null;
            }

            const messageProps = {
              currentMessage: item,
              nextMessage: undefined, // Could potentially use next/prev messages for grouping like Slack later
              previousMessage: undefined,
              position: isCurrentUser(item) ? 'right' : 'left', // Add position back
              user: { // Keep gifted-chat's user structure for compatibility
                _id: user?.id || '',
                name: user?.username || '',
                avatar: user?.profile_pic || '',
              },
              // Remove position prop as it's not driving layout anymore
              // position: isCurrentUser(item) ? 'right' : 'left',
            };

            const profile = getUserProfile(item.user._id.toString());
            const currentUserCheck = isCurrentUser(item); // Get the result

            // Add this detailed log
            console.log(
              `[RenderItem Header Check] Msg ID: ${item._id}, ` +
              `Sender ID: ${item.user._id}, Current User ID: ${user?.id}, ` +
              `Is Current User: ${currentUserCheck}, ` +
              `Profile Exists: ${!!profile}, ` +
              `Profile DisplayName: ${profile?.displayName}, ` +
              `Profile Username: ${profile?.username}`
            );

            return (
              <View style={styles.slackMessageContainer}>
                {/* Avatar always on the left */}
                <View style={styles.slackAvatarWrapper}>
                  {renderAvatar(messageProps)}
                </View>

                {/* Content area */}
                <TouchableOpacity
                  style={styles.slackContentWrapper}
                  activeOpacity={0.8}
                  onLongPress={() => handleLongPressMessage(null, item)} // Pass context=null or adjust handler
                >
                  {/* Username/Timestamp Row (now always shown) */}
                  <View style={styles.slackHeaderRow}>
                    <Text style={[styles.slackUsername, { color: colors.text }]}>
                      {/* Render displayName if available, otherwise username */}
                      {profile.displayName ? profile.displayName : (profile.username || item.user.name || 'User')}
                    </Text>
                    {/* Timestamp removed as requested */}
                    {/* <Text style={[styles.slackTimestamp, { color: colors.secondaryText }]}>
                        {new Date(item.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                    </Text> */}
                  </View>

                  {/* Message Content (Text, Image, Video, Audio) */}
                  <View style={styles.slackMessageContent}>
                    {item.image ? renderMessageImage(messageProps) :
                     item.video ? renderMessageVideo(messageProps) :
                     item.audio ? renderMessageAudio(messageProps) :
                     renderMessageText(messageProps) // Use MessageText directly
                    }
                  </View>
                </TouchableOpacity>
              </View>
            );
          }}
          inverted={true}
          contentContainerStyle={styles.messagesContainer}
          // Add custom ListEmptyComponent for when there are no messages
          ListEmptyComponent={() => (
            <View style={styles.emptyContainer}>
              <Ionicons name="chatbubble-ellipses-outline" size={50} color={colors.secondaryText} />
              <Text style={[styles.emptyText, { color: colors.text }]}>
                No messages yet
              </Text>
              <Text style={[styles.emptySubtext, { color: colors.secondaryText }]}>
                Be the first to send a message!
              </Text>
            </View>
          )}
        />
        
        {/* Custom Input Bar */}
        <View style={[styles.inputContainer, { 
          backgroundColor: colorScheme === 'dark' ? '#1C1C1E' : '#F2F2F7',
          borderTopColor: colors.border,
        }]}>
          {mentionSuggestions.length > 0 && renderMentionSuggestions()}
          
          <View style={styles.inputRow}>
            {/* Attachment Button */}
            <TouchableOpacity 
              style={styles.attachButton}
              onPress={handlePickImage}
            >
              <Ionicons name="attach" size={24} color={colors.primary} />
            </TouchableOpacity>
            
            {/* Text Input */}
            <View style={[
              styles.textInputContainer, 
              { backgroundColor: colorScheme === 'dark' ? '#2A2A2C' : '#FFFFFF' }
            ]}>
              <TextInput
                style={[
                  styles.textInput,
                  { color: colors.text }
                ]}
                placeholder="Type a message... Use @ to mention"
                placeholderTextColor={colorScheme === 'dark' ? '#6E6E72' : '#A9A9AD'}
                multiline
                value={currentTextInput}
                onChangeText={handleInputTextChanged}
                selectionColor={colors.primary}
              />
            </View>
            
            {/* Send Button */}
            <TouchableOpacity 
              style={[
                styles.sendButton,
                {backgroundColor: currentTextInput.trim().length > 0 ? colors.primary : '#A0A0A8'}
              ]} 
              onPress={() => {
                if (currentTextInput.trim().length > 0) {
                  const messages = [{
                    _id: Crypto.randomUUID(),
                    text: currentTextInput,
                    createdAt: new Date(),
                    user: {
                      _id: user?.id || '',
                      name: user?.username || '',
                      avatar: user?.profile_pic || '',
                    },
                  }];
                  onSend(messages);
                }
              }}
              disabled={currentTextInput.trim().length === 0}
            >
              <Ionicons name="send" size={18} color="white" />
            </TouchableOpacity>
          </View>
          
          {/* Recording UI */}
          {recording.isRecording && (
            <View style={styles.recordingContainer}>
              <View style={styles.recordingInfo}>
                <View style={styles.recordingIndicator} />
                <Text style={[styles.recordingText, { color: colors.text }]}>
                  Recording: {formatTime(recording.recordingDuration)}
                </Text>
              </View>
              <View style={styles.recordingActions}>
                <TouchableOpacity style={styles.cancelButton} onPress={cancelRecording}>
                  <Text style={styles.cancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity 
                  style={[styles.sendButton, { backgroundColor: colors.primary }]} 
                  onPress={sendAudioMessage}
                >
                  <Text style={{ color: 'white', fontWeight: 'bold' }}>Send</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingBottom: 0,
  },
  flex: {
    flex: 1,
  },
  backBtn: {
    position: 'absolute',
    top: 40,
    left: 16,
    zIndex: 10,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Platform.OS === 'ios' ? 8 : 12, // Adjust padding for platforms
    paddingHorizontal: 12, // Consistent horizontal padding
    borderBottomWidth: 1,
    // Removed borderBottomColor here, apply dynamically
  },
  backButton: {
    padding: 8, // Increased touch target
    marginRight: 8, // Space between back and center
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center', // Center content vertically
    marginHorizontal: 8, // Space around center section
  },
  headerRightButtons: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  hamburgerButton: { // Renamed for clarity
    padding: 8, // Consistent touch target
    marginRight: 4, // Space between buttons
  },
  headerInfo: { // Renamed for clarity
    padding: 8, // Consistent touch target
  },
  channelName: {
    fontSize: 16,
    fontWeight: '600',
    fontFamily: 'Inter-Bold', // Use specific font
    marginRight: 4,
  },
  gardenName: {
    fontSize: 12,
    fontFamily: 'Inter', // Use specific font
    marginTop: 2,
    opacity: 0.8, // Softer appearance
  },
  sendButtonContainer: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  actionsContainer: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 4,
    marginRight: 4,
    marginBottom: 0,
  },
  actionsIconContainer: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recordingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16, // Consistent padding
    paddingVertical: 10, // Slightly less vertical padding
    marginTop: 8, // Add space above recording UI
    borderTopWidth: 1,
    // borderTopColor set dynamically
  },
  recordingInfo: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  recordingIndicator: {
    width: 10, // Smaller indicator
    height: 10,
    borderRadius: 5,
    backgroundColor: '#FF3B30', // Use standard red
    marginRight: 8,
    // Add animation?
  },
  recordingText: {
    fontSize: 14,
    fontFamily: 'Inter',
    opacity: 0.9,
    // color set dynamically
  },
  recordingActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  cancelButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginRight: 8,
  },
  cancelText: {
    fontSize: 14, // Slightly smaller
    fontWeight: '500',
    fontFamily: 'Inter-Bold',
    color: '#FF3B30', // Standard red
  },
  sendButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 4, // Align with bottom of input field
    // backgroundColor set dynamically
  },
  sendText: {
    color: 'white',
    fontSize: 15,
    fontWeight: '500',
  },
  drawerContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 1000,
  },
  drawerOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  drawer: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    width: 280,
    paddingTop: 50,
    borderLeftWidth: 1,
    borderLeftColor: 'rgba(0, 0, 0, 0.1)',
    zIndex: 1001,
  },
  drawerHeader: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0, 0, 0, 0.1)',
  },
  drawerTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 4,
  },
  drawerSubtitle: {
    fontSize: 14,
  },
  drawerSection: {
    padding: 16,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 12,
  },
  userList: {
    maxHeight: '85%',
  },
  userItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
  },
  userAvatarContainer: {
    position: 'relative',
    marginRight: 12,
  },
  userAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
  },
  statusIndicator: {
    position: 'absolute',
    width: 12, // Slightly larger
    height: 12,
    borderRadius: 6,
    borderWidth: 2, // Thicker border for contrast
    // borderColor set dynamically
    bottom: -2, // Adjust positioning
    right: -2,
    // backgroundColor set dynamically
  },
  userName: {
    fontSize: 14,
    fontWeight: '500',
  },
  infoBoxOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 1000,
    backgroundColor: 'transparent',
  },
  infoBox: {
    position: 'absolute',
    width: 250,
    borderRadius: 12,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
    zIndex: 1001,
  },
  infoBoxHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  infoBoxTitle: {
    fontSize: 15,
    fontWeight: '600',
    marginLeft: 8,
  },
  infoBoxText: {
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 8,
  },
  imageModalOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.9)', justifyContent: 'center', alignItems: 'center', zIndex: 1002,
  },
  imageModalImage: {
    width: '80%', height: '80%', resizeMode: 'contain',
  },
  imageModalClose: {
    position: 'absolute',
    top: 40,
    right: 20,
    zIndex: 1003,
  },
  imageModalDownload: {
    position: 'absolute',
    bottom: 40,
    left: 20,
    zIndex: 1003,
  },
  modalDownloadContainer: {
    position: 'absolute',
    bottom: 10,
    left: 10,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    borderRadius: 20,
    paddingVertical: 8,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalDownloadText: {
    color: 'white',
    marginLeft: 8,
    fontSize: 14,
    fontWeight: '500',
  },
  headerTitleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  lockIcon: {
    marginLeft: 6,
  },
  lockedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
    marginBottom: 6,
  },
  lockedBannerText: {
    marginLeft: 6,
    fontSize: 14,
    fontWeight: '500',
  },
  lockedContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    borderTopWidth: 1,
    borderTopColor: 'rgba(0,0,0,0.1)',
  },
  lockedText: {
    marginLeft: 8,
    fontSize: 14,
  },
  replyPreview: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 10,
    backgroundColor: '#f8f8f8',
    borderTopWidth: 1,
    borderTopColor: '#e0e0e0',
  },
  replyCancel: {
    padding: 8,
  },
  replyUsername: {
    fontWeight: 'bold',
    fontSize: 14,
    marginBottom: 2,
  },
  replyText: {
    fontSize: 14,
    color: '#555',
  },
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
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  profileHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
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
  },
  roleText: {
    color: 'white',
    fontSize: 11,
    fontWeight: '500',
  },
  profileActions: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 8,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 20,
    minWidth: 140,
  },
  actionText: {
    color: 'white',
    fontWeight: '500',
    marginLeft: 6,
  },
  avatarContainer: {
    marginRight: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarImage: {
    width: 36,
    height: 36,
    borderRadius: 18,
  },
  avatarFallback: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#CCC',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarFallbackText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#FFF',
  },
  customView: {
    marginBottom: 2,
  },
  username: {
    fontWeight: 'bold',
    fontSize: 13,
    marginBottom: 2,
    color: '#555',
  },
  replyIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: -2,
  },
  actionsWrapper: {
    backgroundColor: 'rgba(0, 0, 0, 0.05)',
    borderRadius: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  mediaWrapper: {
    position: 'relative',
    marginVertical: 4,
  },
  mediaContainer: {
    borderRadius: 13,
    overflow: 'hidden',
    marginTop: 4,
    marginBottom: 4,
  },
  mediaDownloadButton: {
    position: 'absolute',
    bottom: 8,
    left: 8,
    zIndex: 10,
  },
  downloadButtonInner: {
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 2,
    elevation: 3,
  },
  messageImageContainer: {
    borderRadius: 18,
    overflow: 'hidden',
    marginVertical: 4,
  },
  userImageContainer: {
    marginLeft: 60,
    borderTopRightRadius: 4, // Flatter corner on user side
  },
  otherImageContainer: {
    marginRight: 60,
    borderTopLeftRadius: 4, // Flatter corner on other side
  },
  messageImage: {
    // Adjust size constraints if needed for Slack style
    width: '100%', // Make image take available width in the container
    aspectRatio: 16 / 9, // Maintain aspect ratio, adjust as needed
    borderRadius: 8, // Slack uses softer corners
    marginTop: 4, // Space below username/timestamp
  },
  messageVideo: {
    // Adjust size constraints if needed for Slack style
    width: '100%',
    aspectRatio: 16 / 9,
    borderRadius: 8,
    marginTop: 4,
  },
  videoPlayButton: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    borderRadius: 13,
    overflow: 'hidden',
  },
  // Mention system styles
  mentionSuggestions: {
    position: 'absolute',
    bottom: 50, // Adjusted to be closer to the input
    left: 8,
    right: 8,
    maxHeight: 200,
    borderWidth: 1,
    borderRadius: 12,
    zIndex: 2,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 3,
  },
  mentionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderBottomWidth: 0.5,
    borderBottomColor: '#EEEEEE',
  },
  mentionAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    marginRight: 12,
  },
  mentionUsername: {
    fontSize: 14,
    fontWeight: '500',
    fontFamily: 'Inter-Medium',
  },
  emptyMention: {
    padding: 14,
    textAlign: 'center',
    fontFamily: 'Inter',
  },
  inputText: {
    fontFamily: 'Inter',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 10,
    marginRight: 6,
    marginLeft: 6,
    minHeight: 40,
    maxHeight: 100,
  },
  inputToolbar: {
    borderTopWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 0,
    paddingBottom: 0,
    marginBottom: 0,
    marginTop: 0,
  },
  messageContainer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginVertical: 4,
    paddingHorizontal: 10,
  },
  userMessageContainer: {
    justifyContent: 'flex-end',
  },
  otherMessageContainer: {
    justifyContent: 'flex-start',
  },
  inputContainer: {
    borderTopWidth: 1,
    borderTopColor: 'rgba(0,0,0,0.1)',
    paddingTop: 0,
    paddingBottom: 0,
    marginTop: 0,
    marginBottom: 0,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 8,
  },
  attachButton: {
    padding: 8,
    marginRight: 8,
  },
  textInputContainer: {
    flex: 1,
    borderRadius: 18,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginRight: 8,
  },
  textInput: {
    flex: 1,
    fontFamily: 'Inter',
    fontSize: 15,
    maxHeight: 100,
  },
  gray: {
    backgroundColor: '#A0A0A8',
  },
  videoModalPlayer: {
    width: '100%',
    height: '100%',
  },
  downloadProgressOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1005,
  },
  downloadProgressContent: {
    backgroundColor: 'white',
    padding: 20,
    borderRadius: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
    zIndex: 1006,
  },
  downloadProgressText: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 10,
  },
  // Slack Style Message Structure
  slackMessageContainer: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 6, // Adjust vertical spacing
    alignItems: 'flex-start',
  },
  slackAvatarWrapper: {
    marginRight: 8,
    paddingTop: 2, // Align avatar top with username/timestamp line
  },
  slackContentWrapper: {
    flex: 1, // Take remaining space
  },
  slackHeaderRow: {
    flexDirection: 'row',
    alignItems: 'baseline', // Align username and timestamp nicely
    marginBottom: 3,
  },
  slackUsername: {
    fontWeight: 'bold',
    fontSize: 14,
    marginRight: 8,
    fontFamily: 'Inter-Bold', // Example bold font
  },
  slackTimestamp: {
    fontSize: 12,
    fontFamily: 'Inter',
  },
  slackMessageContent: {
    // Container for the actual text/media
    // No background or border needed here as Bubble is gone
  },
  linkPreviewContainer: {
    marginTop: 5,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.1)',
    overflow: 'hidden',
    // backgroundColor is set dynamically based on state/theme
  },
  linkPreviewImage: {
    height: 120, // Adjust height as needed
    width: '100%',
  },
  linkPreviewTextContainer: {
    padding: 10,
  },
  linkPreviewTitle: {
    fontFamily: 'Inter-Bold',
    fontSize: 14,
    marginBottom: 3,
  },
  linkPreviewDescription: {
    fontFamily: 'Inter',
    fontSize: 13,
    marginBottom: 5,
  },
  linkPreviewUrl: {
    fontFamily: 'Inter',
    fontSize: 12,
  },
  loadingText: {
    fontSize: 16,
    fontWeight: '500',
    marginTop: 10,
  },
  loadingDebug: {
    fontSize: 12,
    fontWeight: '400',
    marginTop: 5,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 24,
    fontWeight: '600',
    marginBottom: 10,
  },
  emptySubtext: {
    fontSize: 16,
    fontWeight: '500',
    textAlign: 'center',
  },
  messagesContainer: {
    flexGrow: 1,
    paddingBottom: 0,
    marginBottom: 0,
  },
  skeletonContainer: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  skeletonMessage: {
    flexDirection: 'row',
    marginBottom: 16,
    padding: 12,
    borderRadius: 12,
  },
  skeletonAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#CCCCCC', 
  },
  skeletonContent: {
    flex: 1,
    marginLeft: 12,
  },
  skeletonName: {
    width: 100,
    height: 14,
    borderRadius: 7,
    marginBottom: 8,
  },
  skeletonText: {
    width: '80%',
    height: 16,
    borderRadius: 8,
  },
  loadingOverlay: {
    position: 'absolute',
    top: 8,
    right: 8,
    backgroundColor: 'rgba(0,0,0,0.1)',
    borderRadius: 20,
    padding: 8,
    zIndex: 10,
  },
  connectionIndicator: {
    position: 'absolute',
    top: 10,
    right: 10,
    zIndex: 5,
  },
  connectionDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: 'white',
  },
  // Add debug-related styles
  debugButton: {
    marginRight: 12,
    padding: 4,
  },
  debugModalOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  debugModalContent: {
    width: '90%',
    maxHeight: '80%',
    borderRadius: 12,
    padding: 16,
    elevation: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
  },
  debugModalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 16,
  },
  debugModalScrollView: {
    maxHeight: 300,
  },
  debugModalText: {
    fontFamily: 'monospace',
    marginBottom: 16,
  },
  debugButtonsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    marginTop: 16,
  },
  debugActionButton: {
    margin: 4,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  debugActionButtonText: {
    color: 'white',
  },
  debugCloseButton: {
    backgroundColor: '#666',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    alignSelf: 'center',
    marginTop: 16,
  },
  debugCloseButtonText: {
    color: 'white',
  },
});

