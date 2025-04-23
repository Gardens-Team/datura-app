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
  TextStyle
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
import { Audio, AVPlaybackStatus } from 'expo-av';
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
} from '@/services/message-service';
import { Channel, Garden } from '@/services/garden-service';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useEffect as useDebugEffect } from 'react';

// Custom interface for the recording state
interface RecordingState {
  isRecording: boolean;
  isDoneRecording: boolean;
  recordingDuration: number;
  recordingUri: string | null;
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
  const [channel, setChannel] = useState<Channel | null>(null);
  const [garden, setGarden] = useState<Garden | null>(null);
  
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

  // --- Initial load + live subscription ------------------------------
  useEffect(() => {
    let unsub: () => void;
    (async () => {
      setIsLoading(true);
      try {
        const initialMsgs = await fetchMessages(id as string, undefined);
        setMessages(initialMsgs);
      } catch (e) {
        console.error('Failed to load messages:', e);
      } finally {
        setIsLoading(false);
      }
      unsub = await subscribeToChannel(id as string, newMsgs => {
        setMessages(prev => GiftedChat.append(prev, newMsgs));
      });
    })();
    return () => unsub?.();
  }, [id]);

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
      Alert.alert('Error', 'Failed to send audio message');
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
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        quality: 0.8,
      });
      
      if (!result.canceled && result.assets[0].uri) {
        setIsLoading(true);
        
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
      Alert.alert('Error', 'Failed to send image');
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
    return (
      <MessageAudio
        currentMessage={props.currentMessage}
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

  // Render custom header
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
        
        <TouchableOpacity style={styles.headerInfo}>
          <Ionicons name="information-circle-outline" size={24} color={colors.primary} />
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <SafeAreaView
      style={[
        styles.container,
        { backgroundColor: colorScheme === 'dark' ? '#000000' : '#FFFFFF', paddingTop: insets.top },
      ]}
    >
      <StatusBar barStyle={colorScheme === 'dark' ? 'light-content' : 'dark-content'} />
      
      {/* Debug: show loading/key state */}
      <View style={{ position: 'absolute', top: 100, right: 20, backgroundColor: 'rgba(0,0,0,0.5)', padding: 8, zIndex: 999 }}>
        <Text style={{color: 'white', fontSize: 10}}>
          {isLoading ? 'LOADING' : `READY (${messages.length})`}
          {groupKey ? ' [KEY OK]' : ' [NO KEY]'}
        </Text>
      </View>
      
      {/* Custom Header */}
      {renderHeader()}
      
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
  channelName: {
    fontSize: 16,
    fontWeight: '600',
  },
  gardenName: {
    fontSize: 12,
    marginTop: 2,
  },
  headerInfo: {
    padding: 4,
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
});

