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
  uploadAudioMessage,
  uploadImageMessage,
  ExtendedMessage,
  useMessageService,
  subscribeToChannel,
  getGroupKeyForChannel,
} from '@/services/message-service';
import { Channel, Garden } from '@/services/garden-service';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useEffect as useDebugEffect } from 'react';
import * as Sharing from 'expo-sharing';
import AdminNotification from '@/components/AdminNotification';

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
  avatar: string;
  status: 'online' | 'idle' | 'offline';
  role?: string;
}

// Fix the garden member structure to match what Supabase returns
interface SupabaseUserData {
  id: string;
  username: string;
  profile_pic: string;
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
  } | null;
}

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
  
  const styles = {
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
    duration: {
      marginLeft: 12,
      fontSize: 14,
      color: '#8E8E93',
      ...(audioStyle?.duration || {})
    }
  };
  
  return (
    <View style={styles.container}>
      <View style={styles.wrapper}>
        <TouchableOpacity style={styles.playPauseButton} onPress={handlePlayPause}>
          <Ionicons
            name={isPlaying ? 'pause' : 'play'}
            size={20}
            color="white"
          />
        </TouchableOpacity>
        <Text style={styles.duration}>
          {isPlaying ? formatTime(position) : formatTime(duration)}
        </Text>
      </View>
    </View>
  );
};

export default function ChannelScreen() {
  const { id } = useLocalSearchParams<{ id: string }>(); // channel id
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const { user } = useCurrentUser();
  const { fetchMessages, sendMessage } = useMessageService();

  // States
  const [messages, setMessages] = useState<IMessage[]>([]);
  const [groupKey, setGroupKey] = useState<string | null>(null);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(true);
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
          .select('id, username, profile_pic')
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

  // --- Initial load + live subscription ------------------------------
  useEffect(() => {
    let unsub: () => void;
    (async () => {
      setIsLoading(true);
      try {
        // First get the key for this channel
        if (user) {
          const key = await getGroupKeyForChannel(id as string, user.id);
          setGroupKey(key || null);
          setDebugInfo(key ? `KEY: ${key.substring(0, 5)}...` : 'NO KEY');
        }
        
        const initialMsgs = await fetchMessages(id as string, groupKey || undefined);
        setMessages(initialMsgs);
      } catch (e) {
        console.error('Failed to load messages:', e);
        setDebugInfo(`ERROR: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        setIsLoading(false);
      }
      unsub = await subscribeToChannel(id as string, newMsgs => {
        setMessages(prev => GiftedChat.append(prev, newMsgs));
      });
    })();
    return () => unsub?.();
  }, [id, user]);

  // Manual function to force key refresh if needed
  const refreshKey = async () => {
    if (!user || !id) return;
    
    try {
      setDebugInfo('Refreshing key...');
      setIsLoading(true);
      const key = await getGroupKeyForChannel(id as string, user.id);
      setGroupKey(key || null);
      setDebugInfo(key ? `KEY: ${key.substring(0, 5)}...` : 'NO KEY');
      
      // Re-fetch messages with new key
      const refreshedMsgs = await fetchMessages(id as string, key || undefined);
      setMessages(refreshedMsgs);
    } catch (e) {
      console.error('Failed to refresh key:', e);
      setDebugInfo(`ERROR: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setIsLoading(false);
    }
  };

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
    if (!recording.recordingUri || !user) return;
    
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

      const audioUrl = await uploadAudioMessage(recording.recordingUri, id as string);
      
      // Create the message with audio content
      const audioMessage: ExtendedMessage = {
        _id: String(Date.now()),
        text: '',
        createdAt: new Date(),
        user: {
          _id: user.id,
          name: user.username,
          avatar: user.profile_pic,
        },
        audio: audioUrl,
      };
      
      // Send to backend and update local state
      await sendMessage(id as string, audioMessage, groupKey!);
      setMessages(previousMessages => 
        GiftedChat.append(previousMessages, [audioMessage] as IMessage[])
      );
      
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
    if (!user) return;
    
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
        
        // Upload the image
        const imageUrl = await uploadImageMessage(result.assets[0].uri, id as string);
        
        // Create and send the message
        const imageMessage: ExtendedMessage = {
          _id: String(Date.now()),
          text: '',
          createdAt: new Date(),
          user: {
            _id: user.id,
            name: user.username,
            avatar: user.profile_pic,
          },
          image: imageUrl,
        };
        
        await sendMessage(id as string, imageMessage, groupKey!);
        setMessages(previousMessages => 
          GiftedChat.append(previousMessages, [imageMessage] as IMessage[])
        );
      }
    } catch (error) {
      console.error('Failed to send image message', error);
      Alert.alert('Error', 'Failed to send image. Please try a smaller or compressed image.');
    } finally {
      setIsLoading(false);
    }
  };

  // Send a text message
  const onSend = useCallback(async (newMessages: IMessage[] = []) => {
    if (!user) return;
    
    try {
    setMessages(prev => GiftedChat.append(prev, newMessages));
    const m = newMessages[0];
      
      // Create the extended message with user details
      const extendedMsg: ExtendedMessage = {
        ...m,
        user: {
          _id: user.id,
          name: user.username,
          avatar: user.profile_pic,
        },
      };
      
      await sendMessage(id as string, extendedMsg, groupKey!);
    } catch (error) {
      console.error('Failed to send message:', error);
      // Remove the optimistically added message
      setMessages(prev => prev.filter(msg => msg._id !== newMessages[0]._id));
      Alert.alert('Error', 'Failed to send message');
    }
  }, [groupKey, id, user, sendMessage]);

  // Customize bubble component
  const renderBubble = (props: any) => {
    return (
      <Bubble
        {...props}
        wrapperStyle={{
          left: {
            backgroundColor: colorScheme === 'dark' ? '#2C2C2E' : '#F2F2F7',
          },
          right: {
            backgroundColor: colors.primary,
          },
        }}
        tickStyle={{ color: colors.secondaryText }}
        textStyle={{
          left: { color: colors.text },
          right: { color: 'white' },
        }}
      />
    );
  };
  
  // Customize message text
  const renderMessageText = (props: any) => {
    return (
      <MessageText
        {...props}
        textStyle={{
          left: { color: colors.text },
          right: { color: 'white' },
        }}
      />
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
  
  // Custom input toolbar
  const renderInputToolbar = (props: any) => {
    // If in recording mode, show recording controls
    if (recording.isRecording) {
      return (
        <View style={[styles.recordingContainer, { backgroundColor: colorScheme === 'dark' ? '#1C1C1E' : '#F2F2F7' }]}>
          <View style={styles.recordingInfo}>
            <View style={styles.recordingIndicator} />
            <Text style={[styles.recordingText, { color: colors.text }]}>
              Recording {formatTime(recording.recordingDuration)}
            </Text>
          </View>
          <View style={styles.recordingActions}>
            <TouchableOpacity style={styles.cancelButton} onPress={cancelRecording}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.sendButton} onPress={stopRecording}>
              <Text style={styles.sendText}>Done</Text>
            </TouchableOpacity>
          </View>
        </View>
      );
    }
    
    // If recording is done, show preview with send button
    if (recording.isDoneRecording && recording.recordingUri) {
  return (
        <View style={[styles.recordingContainer, { backgroundColor: colorScheme === 'dark' ? '#1C1C1E' : '#F2F2F7' }]}>
          <View style={styles.recordingInfo}>
            <Ionicons name="mic" size={20} color={colors.primary} />
            <Text style={[styles.recordingText, { color: colors.text }]}>
              Audio message ({formatTime(recording.recordingDuration)})
            </Text>
          </View>
          <View style={styles.recordingActions}>
            <TouchableOpacity style={styles.cancelButton} onPress={cancelRecording}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.sendButton} onPress={sendAudioMessage}>
              <Text style={styles.sendText}>Send</Text>
      </TouchableOpacity>
          </View>
        </View>
      );
    }
    
    // Normal input toolbar
    return (
      <InputToolbar
        {...props}
        containerStyle={{
          backgroundColor: colorScheme === 'dark' ? '#1C1C1E' : '#F2F2F7',
          borderTopWidth: 1,
          borderTopColor: colorScheme === 'dark' ? '#38383A' : '#C7C7CC',
          paddingHorizontal: 8,
        }}
        primaryStyle={{ alignItems: 'center' }}
      />
    );
  };
  
  // Format recording time
  const formatTime = (seconds: number): string => {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
  };
  
  // Custom composer component
  const renderComposer = (props: any) => {
    return (
      <Composer
        {...props}
        textInputStyle={{
          color: colors.text,
          backgroundColor: colorScheme === 'dark' ? '#2C2C2E' : '#FFFFFF',
          borderRadius: 20,
          paddingHorizontal: 12,
          paddingTop: 8,
          paddingBottom: 8,
          marginRight: 4,
          marginLeft: 0,
        }}
        placeholder="Message"
        placeholderTextColor={colors.secondaryText}
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
        <View style={[
          styles.sendButtonContainer,
          { backgroundColor: props.text ? colors.primary : 'transparent' }
        ]}>
          <Ionicons
            name="send"
            size={20}
            color={props.text ? 'white' : colors.secondaryText}
          />
        </View>
      </Send>
    );
  };
  
  // Render actions button (attachments, etc)
  const renderActions = (props: any) => {
    return (
      <Actions
        {...props}
        containerStyle={styles.actionsContainer}
        icon={() => (
          <View style={styles.actionsIconContainer}>
            <Ionicons name="add-circle" size={24} color={colors.primary} />
          </View>
        )}
        options={{
          'Send Image': handlePickImage,
          'Record Audio': startRecording,
          'Cancel': () => {},
        }}
        optionTintColor={colors.text}
      />
    );
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
    
    return (
      <MessageAudio
        currentMessage={{...props.currentMessage, audio: audioSource}}
        audioStyle={{
          container: {
            backgroundColor: 'transparent',
            marginTop: 6,
          },
          wrapper: {
            backgroundColor: 'transparent',
          },
          playPauseButton: {
            backgroundColor: props.position === 'left' ? '#007AFF' : 'white',
            borderRadius: 20,
            width: 40,
            height: 40,
            alignItems: 'center',
            justifyContent: 'center',
          },
          duration: {
            color: props.position === 'left' ? '#8E8E93' : 'rgba(255, 255, 255, 0.7)',
          },
        }}
      />
    );
  };

  // Function to download/share media
  async function handleDownload(uri: string, type: 'image' | 'video') {
    try {
      let base64Data = uri;
      // If data URI, strip prefix
      if (uri.startsWith('data:')) {
        base64Data = uri.split(',')[1];
      }
      const ext = type === 'image' ? '.jpg' : '.mp4';
      const filename = `media-${Date.now()}${ext}`;
      const path = FileSystem.cacheDirectory + filename;
      // Write base64 to file
      await FileSystem.writeAsStringAsync(path, base64Data, { encoding: FileSystem.EncodingType.Base64 });
      // Share it
      await Sharing.shareAsync(path);
    } catch (e) {
      console.error('Download failed:', e);
      Alert.alert('Error', 'Failed to download media.');
    }
  }

  // Custom render for image messages
  const renderMessageImage = (props: any) => {
    try {
      const imageSource = props.currentMessage.image;
      if (!imageSource) return null;

      return (
        <View style={{ position: 'relative', marginVertical: 4 }}>
          {/* Download button */}
          <Pressable
            style={{ position: 'absolute', top: 6, right: 6, zIndex: 2, padding: 4 }}
            onPress={() => handleDownload(imageSource, 'image')}
          >
            <Ionicons name="download-outline" size={24} color="white" />
          </Pressable>

          {/* Image thumbnail with press to open */}
          <Pressable onPress={() => setSelectedImage(imageSource)}>
            <Image
              source={{ uri: imageSource }}
              style={{ width: 200, height: 150, borderRadius: 13 }}
              resizeMode="cover"
            />
          </Pressable>
        </View>
      );
    } catch (e) {
      console.warn('Image render error:', e);
      return null;
    }
  };

  // Custom render for video messages
  const renderMessageVideo = (props: any) => {
    if (!props.currentMessage.video) return null;
    const videoSource = props.currentMessage.video;
    return (
      <View style={{ position: 'relative', marginVertical: 4 }}>
        <TouchableOpacity
          style={{ position: 'absolute', top: 6, right: 6, zIndex: 1 }}
          onPress={() => handleDownload(videoSource, 'video')}
        >
          <Ionicons name="download-outline" size={24} color="white" />
        </TouchableOpacity>
        <Video
          source={{ uri: videoSource }}
          style={{ width: 200, height: 150, borderRadius: 13 }}
          useNativeControls
          resizeMode={ResizeMode.COVER}
        />
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
  const renderDrawer = () => {
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
  };

  // Toggle info dropdown with type-safe implementation
  const toggleInfoBox = () => {
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
  };

  // Info box component - replaces the modal
  const renderInfoBox = () => {
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
  };

  // Updated render header function
  const renderHeader = () => {
    return (
      <View style={[styles.header, { backgroundColor: colorScheme === 'dark' ? '#1C1C1E' : '#FFFFFF' }]}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={24} color={colors.primary} />
        </TouchableOpacity>
        
        <View style={styles.headerCenter}>
          <Text style={[styles.channelName, { color: colors.text }]}>
            #{channel?.name || 'Channel'}
          </Text>
          <Text style={[styles.gardenName, { color: colors.secondaryText }]}>
            {garden?.name || 'Garden'}
          </Text>
        </View>
        
        <View style={styles.headerRightButtons}>
          <TouchableOpacity style={styles.hamburgerButton} onPress={openDrawer}>
            <Ionicons name="menu" size={22} color={colors.primary} />
          </TouchableOpacity>
          
          <TouchableOpacity 
            ref={infoButtonRef}
            style={styles.headerInfo} 
            onPress={toggleInfoBox}
          >
            <Ionicons name="information-circle-outline" size={22} color={colors.primary} />
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  // Improve the debug display with more info and a refresh button
  const renderDebugInfo = () => (
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
  );

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
                // Refresh messages after action
                fetchMessages(id as string, groupKey || undefined)
                  .then(msgs => setMessages(msgs));
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

  return (
    <SafeAreaView
      style={[
        styles.container,
        { backgroundColor: colorScheme === 'dark' ? '#000000' : '#FFFFFF', paddingTop: insets.top },
      ]}
    >
      <StatusBar barStyle={colorScheme === 'dark' ? 'light-content' : 'dark-content'} />
      
      {/* Debug info */}
      {renderDebugInfo()}
      
      {/* Custom Header */}
      {renderHeader()}
      
      {/* Render drawer */}
      {renderDrawer()}
      
      {/* Render info dropdown box */}
      {renderInfoBox()}
      
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
          </View>
        </Modal>
      )}
      
      {isLoading && messages.length === 0 ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.flex}
          keyboardVerticalOffset={insets.top + (Platform.OS === 'ios' ? 60 : 90)}
        >
          <GiftedChat
            messages={messages}
            onSend={onSend}
            user={{
              _id: user?.id || 'unknown',
              name: user?.username || 'Unknown User',
              avatar: user?.profile_pic,
            }}
            renderBubble={renderBubble}
            renderMessageText={renderMessageText}
            renderDay={renderDay}
            renderInputToolbar={renderInputToolbar}
            renderComposer={renderComposer}
            renderSend={renderSend}
            renderActions={renderActions}
            renderMessageAudio={renderMessageAudio}
            renderMessageImage={renderMessageImage}
            renderMessageVideo={renderMessageVideo}
            renderSystemMessage={renderSystemMessage}
            maxComposerHeight={120}
            minComposerHeight={36}
            keyboardShouldPersistTaps="handled"
            messagesContainerStyle={{ paddingBottom: insets.bottom }}
            scrollToBottomComponent={() => (
              <View style={{
                backgroundColor: colors.primary,
                width: 36,
                height: 36,
                borderRadius: 18,
                justifyContent: 'center',
                alignItems: 'center',
              }}>
                <Ionicons name="chevron-down" size={24} color="white" />
    </View>
            )}
            scrollToBottomStyle={{
              right: 10,
              bottom: 10,
            }}
            infiniteScroll
            isTyping={typingUsers.length > 0}
            onInputTextChanged={setInputText}
            bottomOffset={insets.bottom + 10}
            textInputProps={{
              multiline: true,
              returnKeyType: 'default',
              enablesReturnKeyAutomatically: true,
              keyboardAppearance: colorScheme,
            }}
            timeTextStyle={{
              left: { color: colors.secondaryText },
              right: { color: 'rgba(255, 255, 255, 0.7)' },
            }}
            parsePatterns={(linkStyle: TextStyle | undefined) => [
              { type: 'url', style: { ...(linkStyle || {}), color: colors.primary }, onPress: (url: string) => Linking.openURL(url) },
              { type: 'phone', style: { ...(linkStyle || {}), color: colors.primary }, onPress: (phone: string) => Linking.openURL(`tel:${phone}`) },
              { type: 'email', style: { ...(linkStyle || {}), color: colors.primary }, onPress: (email: string) => Linking.openURL(`mailto:${email}`) },
              { pattern: /#(\w+)/, style: { ...(linkStyle || {}), color: colors.primary } },
              { pattern: /@(\w+)/, style: { ...(linkStyle || {}), color: colors.primary } },
            ]}
          />
        </KeyboardAvoidingView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
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
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.1)',
  },
  backButton: {
    padding: 4,
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
  },
  headerRightButtons: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  hamburgerButton: {
    padding: 4,
    marginRight: 8,
  },
  headerInfo: {
    padding: 4,
  },
  channelName: {
    fontSize: 16,
    fontWeight: '600',
  },
  gardenName: {
    fontSize: 12,
    marginTop: 2,
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
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(0,0,0,0.1)',
  },
  recordingInfo: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  recordingIndicator: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: 'red',
    marginRight: 8,
  },
  recordingText: {
    fontSize: 14,
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
    color: 'red',
    fontSize: 14,
    fontWeight: '500',
  },
  sendButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: '#007AFF',
    borderRadius: 16,
  },
  sendText: {
    color: 'white',
    fontSize: 14,
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
    width: 10,
    height: 10,
    borderRadius: 5,
    position: 'absolute',
    bottom: 0,
    right: 0,
    borderWidth: 1,
    borderColor: 'white',
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
});

