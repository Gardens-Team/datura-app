import React, { useState, useEffect, useCallback, useRef } from 'react';
import { 
  SafeAreaView, 
  View, 
  Text, 
  StyleSheet, 
  TouchableOpacity, 
  Image,
  TextInput,
  Keyboard,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Alert
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from 'react-native';
import { GiftedChat, IMessage, Bubble, InputToolbar, Composer, Send } from 'react-native-gifted-chat';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@/services/supabase-singleton';
import * as Crypto from 'expo-crypto';
import ParsedText from 'react-native-parsed-text';
import { FlashList } from '@shopify/flash-list';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { 
  DaturaClient, 
  getDaturaClient, 
  encryptMessage, 
  decryptMessage, 
  createMessageFromPayload,
  uploadMediaAsBase64 
} from '@/services/datura-service';
import * as SecureStore from 'expo-secure-store';

// Interface for our DM chat message
interface DMMessage extends IMessage {
  pending?: boolean;
  error?: boolean;
  conversationId?: string;
  messageType?: string;
  read?: boolean;
}

export default function DirectMessageScreen() {
  const router = useRouter();
  const { id: recipientId } = useLocalSearchParams<{ id: string }>();
  const { user } = useCurrentUser();
  const [messages, setMessages] = useState<DMMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [recipientProfile, setRecipientProfile] = useState<{ username: string, profile_pic: string, publicKey: string } | null>(null);
  const [inputText, setInputText] = useState('');
  const [mentionSearchTerm, setMentionSearchTerm] = useState<string | null>(null);
  const [mentionedUsers, setMentionedUsers] = useState<string[]>([]);
  const [mentionSuggestions, setMentionSuggestions] = useState<any[]>([]);
  const [userProfiles, setUserProfiles] = useState<Record<string, any>>({});
  const [onlineStatus, setOnlineStatus] = useState<'online' | 'offline'>('offline');
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const inputRef = useRef<TextInput>(null);
  const flashListRef = useRef<FlashList<DMMessage>>(null);
  const [daturaClient, setDaturaClient] = useState<DaturaClient | null>(null);
  const [dmChannelId, setDmChannelId] = useState<string | null>(null);
  const [groupKey, setGroupKey] = useState<string | null>(null);

  // Check if this is a valid DM session
  useEffect(() => {
    if (!recipientId || !user) {
      router.replace('/');
      return;
    }
  }, [recipientId, user, router]);

  // Fetch recipient profile info
  useEffect(() => {
    const fetchRecipientProfile = async () => {
      if (!recipientId) return;
      
      try {
        const { data, error } = await supabase
          .from('users')
          .select('id, username, profile_pic, public_key')
          .eq('id', recipientId)
          .single();
          
        if (error) {
          console.error('Error fetching recipient profile:', error);
          return;
        }
        
        if (data) {
          setRecipientProfile({
            username: data.username,
            profile_pic: data.profile_pic,
            publicKey: data.public_key
          });
          
          // Add to user profiles for mentions
          setUserProfiles(prev => ({
            ...prev,
            [data.id]: {
              id: data.id,
              username: data.username,
              avatar: data.profile_pic
            }
          }));

          // Get or create DM channel ID
          const channelId = await getOrCreateDmChannel(data.id);
          setDmChannelId(channelId);
        }
      } catch (err) {
        console.error('Failed to fetch recipient profile:', err);
      }
    };
    
    fetchRecipientProfile();
  }, [recipientId, user]);

  // Create or get a DM channel ID (deterministic based on the participants)
  const getOrCreateDmChannel = async (otherUserId: string): Promise<string> => {
    if (!user) return '';
    
    // Sort user IDs to ensure same channel regardless of who initiates
    const sortedIds = [user.id, otherUserId].sort();
    const channelName = `dm-${sortedIds[0]}-${sortedIds[1]}`;
    
    try {
      // Check if channel exists
      const { data, error } = await supabase
        .from('channels')
        .select('id')
        .eq('name', channelName)
        .single();
      
      if (data) {
        return data.id;
      }
      
      // Create channel if it doesn't exist
      const { data: newChannel, error: createError } = await supabase
        .from('channels')
        .insert({
          name: channelName,
          garden_id: null, // DMs don't belong to a garden
          created_by: user.id,
          is_dm: true,
          dm_participants: sortedIds
        })
        .select('id')
        .single();
      
      if (createError) {
        console.error('Error creating DM channel:', createError);
        return '';
      }
      
      return newChannel.id;
    } catch (err) {
      console.error('Error in getOrCreateDmChannel:', err);
      return '';
    }
  };

  // Get or generate a shared key for this DM
  const getDmKey = async (channelId: string): Promise<string | null> => {
    try {
      // Check if we already have this key stored
      const storedKey = await SecureStore.getItemAsync(`dm_key_${channelId}`);
      if (storedKey) {
        return storedKey;
      }
      
      // Generate a new key if we don't have one
      const newKey = Crypto.randomUUID(); // Simple key for demo purposes
      await SecureStore.setItemAsync(`dm_key_${channelId}`, newKey);
      
      return newKey;
    } catch (err) {
      console.error('Error getting DM key:', err);
      return null;
    }
  };
  
  // Initialize Datura client when we have the channel ID
  useEffect(() => {
    if (!dmChannelId || !user) return;
    
    const initializeDaturaClient = async () => {
      try {
        // Get the encryption key for this DM
        const key = await getDmKey(dmChannelId);
        setGroupKey(key);
        
        // Initialize the Datura client
        const client = await getDaturaClient(dmChannelId);
        
        if (client) {
          setDaturaClient(client);
          
          // Set up message handlers for real-time updates
          client.onMessage((data) => {
            if (data.type === 'new_message' && key) {
              // Process new message
              const msg = data.message;
              
              try {
                // Decrypt the message
                const decrypted = decryptMessage(msg.ciphertext, key);
                const payload = JSON.parse(decrypted);
                
                // Create message object
                const newMessage = createMessageFromPayload(msg, payload);
                
                // Mark as read automatically since we're viewing it
                markMessageAsRead(newMessage._id.toString());
                
                // Add to messages state
                setMessages(prev => GiftedChat.append(prev, [newMessage as DMMessage]));
                
                // Update user profile if needed
                fetchUserProfile(msg.senderId);
              } catch (err) {
                console.error('Error processing incoming message:', err);
              }
            }
          });
          
          // Fetch initial messages
          fetchDaturaMessages(client, key);
        }
      } catch (err) {
        console.error('Error initializing Datura client:', err);
        // Fall back to regular Supabase messages
        fetchMessages();
      }
    };
    
    initializeDaturaClient();
    
    return () => {
      if (daturaClient) {
        daturaClient.disconnect();
      }
    };
  }, [dmChannelId, user]);
  
  // Fetch messages using Datura client
  const fetchDaturaMessages = async (client: DaturaClient, key: string | null) => {
    if (!client || !key) return;
    
    setLoading(true);
    
    try {
      const messageHistory = await client.getMessageHistory();
      console.log(`Retrieved ${messageHistory.length} messages from Datura`);
      
      if (messageHistory.length === 0) {
        setLoading(false);
        return;
      }
      
      // Decrypt all messages
      const decryptedMessages: DMMessage[] = [];
      
      for (const msg of messageHistory) {
        try {
          // Decrypt the message
          const payloadStr = decryptMessage(msg.ciphertext, key);
          const payload = JSON.parse(payloadStr);
          
          // Create DMMessage object
          const message: DMMessage = {
            _id: msg.id,
            text: payload.text || '',
            createdAt: new Date(msg.timestamp),
            user: {
              _id: msg.senderId,
              name: 'Loading...', // Will update with profile
              avatar: ''
            },
            read: true, // Assume read for simplicity
            messageType: 'Text',
            image: payload.image,
            video: payload.video,
            audio: payload.audio
          };
          
          decryptedMessages.push(message);
          
          // Fetch sender profile if needed
          fetchUserProfile(msg.senderId);
        } catch (err) {
          console.error(`Error decrypting message ${msg.id}:`, err);
        }
      }
      
      // Sort by timestamp (newest first)
      decryptedMessages.sort((a, b) => 
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
      
      setMessages(decryptedMessages);
    } catch (err) {
      console.error('Error fetching Datura messages:', err);
      // Fall back to regular Supabase messages
      fetchMessages();
    } finally {
      setLoading(false);
    }
  };
  
  // Fetch sender profile
  const fetchUserProfile = async (userId: string) => {
    // Skip if we already have this profile
    if (userProfiles[userId]) return;
    
    try {
      const { data, error } = await supabase
        .from('users')
        .select('id, username, profile_pic')
        .eq('id', userId)
        .single();
      
      if (error) {
        console.error('Error fetching user profile:', error);
        return;
      }
      
      if (data) {
        // Update user profiles
        setUserProfiles(prev => ({
          ...prev,
          [userId]: {
            id: data.id,
            username: data.username,
            avatar: data.profile_pic
          }
        }));
        
        // Update messages with this user
        setMessages(prev => prev.map(msg => 
          msg.user._id === userId 
            ? {
                ...msg,
                user: {
                  ...msg.user,
                  name: data.username,
                  avatar: data.profile_pic
                }
              }
            : msg
        ));
      }
    } catch (err) {
      console.error('Error in fetchUserProfile:', err);
    }
  };

  // Send a message using Datura
  const sendDaturaMessage = async (text: string) => {
    if (!text.trim() || !user || !daturaClient || !groupKey) {
      // Fall back to regular send method
      sendMessage(text);
      return;
    }
    
    // Clear input
    setInputText('');
    Keyboard.dismiss();
    
    // Generate a temporary message ID
    const messageId = Crypto.randomUUID();
    
    // Create a temporary message to show immediately
    const tempMessage: DMMessage = {
      _id: messageId,
      text,
      createdAt: new Date(),
      user: {
        _id: user.id,
        name: user.username,
        avatar: user.profile_pic
      },
      pending: true,
      read: false
    };
    
    // Add to messages immediately
    setMessages(previousMessages => GiftedChat.append(previousMessages, [tempMessage]));
    
    try {
      setSending(true);
      
      // Prepare the message payload
      const payload = {
        text,
        mentioned_users: mentionedUsers.length > 0 ? mentionedUsers : undefined
      };
      
      // Encrypt the payload
      const encryptedPayload = encryptMessage(JSON.stringify(payload), groupKey);
      
      // Send via Datura with correct message type capitalization
      const messageId = await daturaClient.sendMessage(encryptedPayload, { messageType: 'Text' });
      
      // Update message to remove pending state
      setMessages(prev => prev.map(msg => 
        msg._id === tempMessage._id 
          ? { ...msg, _id: messageId, pending: false }
          : msg
      ));
    } catch (err) {
      console.error('Error sending Datura message:', err);
      
      // Mark as error
      setMessages(prev => prev.map(msg => 
        msg._id === tempMessage._id 
          ? { ...msg, pending: false, error: true }
          : msg
      ));
      
      Alert.alert('Error', 'Failed to send message. Please try again.');
    } finally {
      setSending(false);
    }
  };

  // Mark a message as read
  const markMessageAsRead = useCallback(async (messageId: string) => {
    try {
      // Update in Supabase for existing conversations
      const { error } = await supabase
        .from('conversations')
        .update({ read: true })
        .eq('id', messageId);
      
      if (error) {
        console.error('Error marking message as read:', error);
      }
    } catch (err) {
      console.error('Error in markMessageAsRead:', err);
    }
  }, []);

  // Function to fetch initial messages (legacy Supabase method)
  const fetchMessages = useCallback(async () => {
    if (!user || !recipientId) return;
    
    setLoading(true);
    try {
      // Fetch conversations using multiple filters
      const query = supabase
        .from('conversations')
        .select('*')
        .or(
          `sender_id.eq.${user.id},recipient_id.eq.${user.id}`
        );
      
      // Add additional filter
      const { data, error } = await query
        .or(
          `and(sender_id.eq.${recipientId},recipient_id.eq.${user.id}),and(sender_id.eq.${user.id},recipient_id.eq.${recipientId})`
        )
        .order('created_at', { ascending: false })
        .limit(50);
        
      if (error) {
        console.error('Error fetching messages:', error);
        setLoading(false);
        return;
      }
      
      if (!data || data.length === 0) {
        setLoading(false);
        return;
      }
      
      // Transform to Gifted Chat format
      const transformedMessages: DMMessage[] = data.map((msg: any) => {
        // Determine if the current user is the sender
        const isSentByMe = msg.sender_id === user.id;
        
        return {
          _id: msg.id,
          text: msg.text || '',
          createdAt: new Date(msg.created_at),
          user: {
            _id: isSentByMe ? user.id : msg.sender_id,
            name: isSentByMe ? user.username : recipientProfile?.username || 'User',
            avatar: isSentByMe ? user.profile_pic : recipientProfile?.profile_pic
          },
          read: msg.read,
          messageType: msg.message_type,
          conversationId: msg.id
        };
      });
      
      setMessages(transformedMessages);
    } catch (err) {
      console.error('Error in fetchMessages:', err);
    } finally {
      setLoading(false);
    }
  }, [user, recipientId, recipientProfile]);

  // Set up Supabase realtime subscription (legacy method)
  useEffect(() => {
    if (!user || !recipientId || daturaClient) return;
    
    const setupRealtimeSubscription = async () => {
      // Fetch initial messages
      await fetchMessages();
      
      // Create channel for new messages
      const channel = supabase
        .channel(`dm_${user.id}_${recipientId}`)
        .on('postgres_changes', { 
          event: 'INSERT', 
          schema: 'public', 
          table: 'conversations',
          filter: `or(and(sender_id=eq.${user.id},recipient_id=eq.${recipientId}),and(sender_id=eq.${recipientId},recipient_id=eq.${user.id}))` 
        }, (payload) => {
          console.log('New message received:', payload);
          
          const newMsg = payload.new;
          const isSentByMe = newMsg.sender_id === user.id;
          
          const message: DMMessage = {
            _id: newMsg.id,
            text: newMsg.text || '',
            createdAt: new Date(newMsg.created_at),
            user: {
              _id: isSentByMe ? user.id : newMsg.sender_id,
              name: isSentByMe ? user.username : recipientProfile?.username || 'User',
              avatar: isSentByMe ? user.profile_pic : recipientProfile?.profile_pic
            },
            read: newMsg.read,
            messageType: newMsg.message_type,
            conversationId: newMsg.id
          };
          
          // Add new message to state
          setMessages(previousMessages => GiftedChat.append(previousMessages, [message]));
          
          // Mark as read if sent by the other person
          if (!isSentByMe) {
            markMessageAsRead(newMsg.id);
          }
        })
        .subscribe((status) => {
          console.log(`Realtime subscription status: ${status}`);
        });
      
      // Cleanup function
      return () => {
        channel.unsubscribe();
      };
    };
    
    const unsubscribe = setupRealtimeSubscription();
    
    return () => {
      (async () => {
        const unsub = await unsubscribe;
        if (unsub) unsub();
      })();
    };
  }, [user, recipientId, fetchMessages, recipientProfile, daturaClient, markMessageAsRead]);

  // Legacy send message function
  const sendMessage = async (text: string) => {
    if (!text.trim() || !user || !recipientId || !recipientProfile) return;
    
    // Clear input
    setInputText('');
    Keyboard.dismiss();
    
    // Generate a unique ID for this message
    const messageId = Crypto.randomUUID();
    
    // Create a temporary message to show immediately
    const tempMessage: DMMessage = {
      _id: messageId,
      text,
      createdAt: new Date(),
      user: {
        _id: user.id,
        name: user.username,
        avatar: user.profile_pic
      },
      pending: true,
      read: false
    };
    
    // Add to messages immediately
    setMessages(previousMessages => GiftedChat.append(previousMessages, [tempMessage]));
    
    // Send to Supabase
    try {
      setSending(true);
      
      const { error } = await supabase
        .from('conversations')
        .insert({
          id: messageId,
          sender_id: user.id,
          recipient_id: recipientId,
          sender_key: user.publicKey,
          recipient_key: recipientProfile.publicKey,
          text,
          read: false,
          message_type: 'Text'
        });
      
      if (error) {
        console.error('Error sending message:', error);
        
        // Mark as error
        setMessages(prev => prev.map(msg => 
          msg._id === messageId 
            ? { ...msg, pending: false, error: true }
            : msg
        ));
      } else {
        // Update message to remove pending state
        setMessages(prev => prev.map(msg => 
          msg._id === messageId 
            ? { ...msg, pending: false }
            : msg
        ));
      }
    } catch (err) {
      console.error('Error in sendMessage:', err);
      
      // Mark as error
      setMessages(prev => prev.map(msg => 
        msg._id === messageId 
          ? { ...msg, pending: false, error: true }
          : msg
      ));
    } finally {
      setSending(false);
    }
  };

  // Handle mentions
  const handleInputChange = (text: string) => {
    setInputText(text);
    
    // Check for mention patterns
    const lastWord = text.split(' ').pop() || '';
    if (lastWord.startsWith('@') && lastWord.length > 1) {
      const searchTerm = lastWord.substring(1).toLowerCase();
      setMentionSearchTerm(searchTerm);
      fetchMentionSuggestions(searchTerm);
    } else {
      setMentionSearchTerm(null);
      setMentionSuggestions([]);
    }
  };

  // Fetch mention suggestions
  const fetchMentionSuggestions = async (searchTerm: string) => {
    try {
      const { data, error } = await supabase
        .from('users')
        .select('id, username, profile_pic')
        .ilike('username', `%${searchTerm}%`)
        .limit(5);
      
      if (error) {
        console.error('Error fetching mention suggestions:', error);
        return;
      }
      
      setMentionSuggestions(data || []);
      
      // Update user profiles for rendering mentions
      if (data) {
        const newProfiles = data.reduce((acc, user) => {
          acc[user.id] = {
            id: user.id,
            username: user.username,
            avatar: user.profile_pic
          };
          return acc;
        }, {} as Record<string, any>);
        
        setUserProfiles(prev => ({
          ...prev,
          ...newProfiles
        }));
      }
    } catch (err) {
      console.error('Error in fetchMentionSuggestions:', err);
    }
  };

  // Apply mention selection
  const applyMention = (user: any) => {
    // Get the current text and replace the mention pattern
    const words = inputText.split(' ');
    const lastWordIndex = words.length - 1;
    
    if (words[lastWordIndex]?.startsWith('@')) {
      words[lastWordIndex] = `@${user.username}`;
      const newText = words.join(' ') + ' ';
      setInputText(newText);
      
      // Add to mentioned users list
      setMentionedUsers(prev => [...prev, user.id]);
    }
    
    // Clear suggestions
    setMentionSearchTerm(null);
    setMentionSuggestions([]);
    
    // Focus the input again
    if (inputRef.current) {
      inputRef.current.focus();
    }
  };

  // Send button handler
  const handleSendPress = () => {
    if (daturaClient && groupKey) {
      sendDaturaMessage(inputText);
    } else {
      sendMessage(inputText);
    }
  };

  // Custom bubble component with ParsedText for mentions
  const renderBubble = (props: any) => {
    return (
      <Bubble
        {...props}
        wrapperStyle={{
          left: {
            backgroundColor: colors.surface,
            borderRadius: 16,
            paddingHorizontal: 2,
            marginBottom: 4
          },
          right: {
            backgroundColor: colors.primary,
            borderRadius: 16,
            paddingHorizontal: 2,
            marginBottom: 4
          }
        }}
        textStyle={{
          left: {
            color: colors.text,
            fontFamily: 'Inter',
            padding: 0
          },
          right: {
            color: 'white',
            fontFamily: 'Inter',
            padding: 0
          }
        }}
        renderMessageText={(messageTextProps) => {
          const { currentMessage } = messageTextProps;
          const mentionTextStyle = {
            fontWeight: '600' as const,
            color: props.position === 'left' ? colors.primary : '#E0F7FA'
          };
          
          return (
            <View style={{padding: 10}}>
              <ParsedText
                style={{
                  color: props.position === 'left' ? colors.text : 'white',
                  fontSize: 15,
                  lineHeight: 20,
                  fontFamily: 'Inter'
                }}
                parse={[
                  // Match @mentions
                  {
                    pattern: /@(\w+)/,
                    style: mentionTextStyle,
                    onPress: (matchingString: string) => {
                      const username = matchingString.substring(1);
                      console.log(`Mention pressed: ${username}`);
                      // Handle mention press
                    }
                  },
                  // Match URLs
                  {
                    type: 'url',
                    style: {
                      textDecorationLine: 'underline',
                      color: props.position === 'left' ? colors.primary : '#E0F7FA'
                    },
                    onPress: (url: string) => {
                      console.log(`URL pressed: ${url}`);
                      // Handle URL press
                    }
                  }
                ]}
              >
                {currentMessage.text}
              </ParsedText>
              
              {/* Message status (sent/read) */}
              {props.position === 'right' && (
                <View style={styles.messageStatus}>
                  {(currentMessage as DMMessage).pending ? (
                    <Ionicons name="time-outline" size={12} color="rgba(255,255,255,0.7)" />
                  ) : (currentMessage as DMMessage).error ? (
                    <Ionicons name="alert-circle-outline" size={12} color="rgba(255,0,0,0.7)" />
                  ) : (currentMessage as DMMessage).read ? (
                    <Ionicons name="checkmark-done-outline" size={12} color="rgba(255,255,255,0.7)" />
                  ) : (
                    <Ionicons name="checkmark-outline" size={12} color="rgba(255,255,255,0.7)" />
                  )}
                </View>
              )}
            </View>
          );
        }}
      />
    );
  };

  // Custom input toolbar
  const renderInputToolbar = (props: any) => {
    return (
      <View style={[styles.inputContainer, { backgroundColor: colors.background }]}>
        {/* Mention suggestions */}
        {mentionSuggestions.length > 0 && (
          <View style={[styles.mentionSuggestions, { backgroundColor: colors.surface }]}>
            {mentionSuggestions.map((user) => (
              <TouchableOpacity 
                key={user.id} 
                style={styles.mentionItem}
                onPress={() => applyMention(user)}
              >
                <Image 
                  source={{ uri: user.profile_pic || 'https://via.placeholder.com/40' }} 
                  style={styles.mentionAvatar}
                />
                <Text style={[styles.mentionUsername, { color: colors.text }]}>
                  {user.username}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
        
        <View style={styles.inputRow}>
          <TextInput
            ref={inputRef}
            style={[styles.input, { 
              backgroundColor: colors.surface,
              color: colors.text,
              borderColor: colors.border
            }]}
            placeholder="Message..."
            placeholderTextColor={colors.secondaryText}
            multiline
            value={inputText}
            onChangeText={handleInputChange}
          />
          
          <TouchableOpacity 
            style={[styles.sendButton, 
              { 
                backgroundColor: inputText.trim() ? colors.primary : colors.border,
                opacity: inputText.trim() ? 1 : 0.5
              }
            ]}
            onPress={handleSendPress}
            disabled={!inputText.trim() || sending}
          >
            {sending ? (
              <ActivityIndicator size="small" color="white" />
            ) : (
              <Ionicons name="send" size={18} color="white" />
            )}
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  // Render loading state
  if (loading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={[styles.header, { backgroundColor: colors.background }]}>
          <Ionicons name="arrow-back" size={24} color={colors.text} onPress={() => router.back()} />
          <View style={{ width: 24 }} />
        </View>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  // Custom message component
  const renderMessage = (props: any) => {
    const { currentMessage, previousMessage, nextMessage } = props;
    const isSameSender = previousMessage && 
                          previousMessage.user._id === currentMessage.user._id;
    const showAvatar = !isSameSender || 
                       !previousMessage || 
                       (new Date(currentMessage.createdAt).getTime() - 
                        new Date(previousMessage.createdAt).getTime() > 300000);
    
    const marginBottom = nextMessage && 
                          nextMessage.user._id === currentMessage.user._id ? 2 : 10;
                          
    return (
      <View 
        style={[
          styles.messageContainer,
          { marginBottom },
          props.position === 'left' ? styles.leftMessageContainer : styles.rightMessageContainer
        ]}
      >
        {props.position === 'left' && showAvatar && (
          <Image 
            source={{ uri: currentMessage.user.avatar || 'https://via.placeholder.com/40' }}
            style={styles.avatar}
          />
        )}
        
        {props.position === 'left' && !showAvatar && (
          <View style={styles.avatarPlaceholder} />
        )}
        
        <View style={[
          styles.messageContent,
          props.position === 'left' ? { marginLeft: 2 } : { marginRight: 2 }
        ]}>
          {showAvatar && props.position === 'left' && (
            <Text style={[styles.messageSender, { color: colors.secondaryText }]}>
              {currentMessage.user.name}
            </Text>
          )}
          
          {renderBubble(props)}
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <KeyboardAvoidingView 
        style={styles.keyboardView} 
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
      >
        {/* Header */}
        <View style={[styles.header, { backgroundColor: colors.background }]}>  
          <TouchableOpacity onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={24} color={colors.text} />
          </TouchableOpacity>
          
          <View style={styles.headerTitle}>
            {recipientProfile?.profile_pic && (
              <Image 
                source={{ uri: recipientProfile.profile_pic }} 
                style={styles.headerAvatar} 
              />
            )}
            <View style={styles.headerInfo}>
              <Text style={[styles.title, { color: colors.text }]}>
                {recipientProfile?.username || 'User'}
              </Text>
              <Text style={[styles.subtitle, { color: colors.secondaryText }]}>
                {onlineStatus === 'online' ? 'Online' : 'Offline'}
              </Text>
            </View>
          </View>
          
          <TouchableOpacity>
            <Ionicons name="call-outline" size={24} color={colors.text} />
          </TouchableOpacity>
        </View>

        {/* Chat messages */}
        <GiftedChat
          messages={messages}
          user={{
            _id: user?.id || '',
            name: user?.username || '',
            avatar: user?.profile_pic || '',
          }}
          renderBubble={renderBubble}
          renderInputToolbar={() => null}
          renderMessage={renderMessage}
          inverted={true}
          minInputToolbarHeight={0}
          maxComposerHeight={100}
          alwaysShowSend
          keyboardShouldPersistTaps="handled"
        />
        
        {/* Custom input toolbar at the bottom */}
        {renderInputToolbar({})}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { 
    flex: 1,
  },
  keyboardView: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(0,0,0,0.1)',
  },
  headerTitle: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerInfo: {
    marginLeft: 8,
  },
  headerAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
  },
  title: {
    fontSize: 16,
    fontWeight: '600',
  },
  subtitle: {
    fontSize: 12,
    marginTop: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  inputContainer: {
    padding: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(0,0,0,0.1)',
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  input: {
    flex: 1,
    borderRadius: 20,
    paddingHorizontal: 15,
    paddingVertical: 10,
    marginRight: 8,
    minHeight: 40,
    maxHeight: 100,
    borderWidth: StyleSheet.hairlineWidth,
  },
  sendButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  mentionSuggestions: {
    borderRadius: 8,
    marginBottom: 8,
    maxHeight: 200,
  },
  mentionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(0,0,0,0.1)',
  },
  mentionAvatar: {
    width: 30,
    height: 30,
    borderRadius: 15,
    marginRight: 10,
  },
  mentionUsername: {
    fontSize: 14,
    fontWeight: '500',
  },
  messageContainer: {
    flexDirection: 'row',
    marginVertical: 1,
    paddingHorizontal: 10,
  },
  leftMessageContainer: {
    justifyContent: 'flex-start',
  },
  rightMessageContainer: {
    justifyContent: 'flex-end',
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    marginRight: 4,
  },
  avatarPlaceholder: {
    width: 32,
    marginRight: 4,
  },
  messageContent: {
    flex: 1,
    maxWidth: '80%',
  },
  messageSender: {
    fontSize: 12,
    marginBottom: 2,
    marginLeft: 12,
  },
  messageStatus: {
    alignSelf: 'flex-end',
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
  }
});
