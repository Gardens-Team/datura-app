import React, { useState, useEffect, useCallback } from 'react';
import { SafeAreaView, View, Text, StyleSheet, Platform, Image } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from 'react-native';
import { GiftedChat, IMessage, Avatar } from 'react-native-gifted-chat';
import { useMessageService, subscribeToChannel } from '@/services/message-service';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@/services/supabase-singleton';

export default function DirectMessageScreen() {
  const { id: peerId } = useLocalSearchParams<{ id: string }>();
  const { user } = useCurrentUser();
  const { fetchMessages, sendMessage } = useMessageService();
  const [messages, setMessages] = useState<IMessage[]>([]);
  const [peerProfile, setPeerProfile] = useState<{ username: string, profile_pic: string } | null>(null);
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  
  // Fetch peer user profile info
  useEffect(() => {
    const fetchPeerProfile = async () => {
      if (!peerId) return;
      
      try {
        const { data, error } = await supabase
          .from('users')
          .select('username, profile_pic')
          .eq('id', peerId)
          .single();
          
        if (error) {
          console.error('Error fetching peer profile:', error);
          return;
        }
        
        if (data) {
          setPeerProfile({
            username: data.username,
            profile_pic: data.profile_pic
          });
        }
      } catch (err) {
        console.error('Failed to fetch peer profile:', err);
      }
    };
    
    fetchPeerProfile();
  }, [peerId]);
  
  // Fetch messages and set up subscription
  useEffect(() => {
    let unsub: (() => void) | undefined;
    
    const setupMessaging = async () => {
      if (!peerId) return;
      
      try {
        // Load initial messages
        const msgs = await fetchMessages(peerId);
        
        // Attach user profile info to messages
        const enrichedMsgs = await enrichMessagesWithProfiles(msgs);
        setMessages(enrichedMsgs);
        
        // Subscribe to new messages
        unsub = await subscribeToChannel(peerId, async (newMsgs: IMessage[]) => {
          const enrichedNewMsgs = await enrichMessagesWithProfiles(newMsgs);
          setMessages(prev => GiftedChat.append(prev, enrichedNewMsgs));
        });
      } catch (error) {
        console.error('Error setting up messaging:', error);
      }
    };
    
    setupMessaging();
    
    return () => {
      if (unsub) unsub();
    };
  }, [peerId]);
  
  // Helper function to add profile info to messages
  const enrichMessagesWithProfiles = async (msgs: IMessage[]): Promise<IMessage[]> => {
    if (!msgs.length) return msgs;
    
    // Get unique user IDs from messages
    const userIds = [...new Set(msgs.map(m => m.user._id.toString()))];
    
    try {
      // Fetch profiles for all users in the messages
      const { data, error } = await supabase
        .from('users')
        .select('id, username, profile_pic')
        .in('id', userIds);
        
      if (error) {
        console.error('Error fetching message user profiles:', error);
        return msgs;
      }
      
      // Create a map of user profiles
      const userProfiles = (data || []).reduce((acc, user) => {
        acc[user.id] = { username: user.username, profile_pic: user.profile_pic };
        return acc;
      }, {} as Record<string, { username: string, profile_pic: string }>);
      
      // Enrich each message with user profile data
      return msgs.map(msg => {
        const userId = msg.user._id.toString();
        const profile = userProfiles[userId];
        
        if (profile) {
          return {
            ...msg,
            user: {
              ...msg.user,
              name: profile.username || msg.user.name,
              avatar: profile.profile_pic || msg.user.avatar
            }
          };
        }
        
        return msg;
      });
    } catch (err) {
      console.error('Failed to enrich messages with profiles:', err);
      return msgs;
    }
  };
  
  // Send message handler
  const onSend = useCallback(async (newMsgs: IMessage[] = []) => {
    if (!user || !peerId) return;
    
    // Add the messages to the UI immediately
    setMessages(prev => GiftedChat.append(prev, newMsgs));
    
    // Send the message
    try {
      const m = newMsgs[0];
      await sendMessage(peerId, m);
    } catch (error) {
      console.error('Error sending message:', error);
    }
  }, [peerId, user, sendMessage]);
  
  // Custom avatar renderer to handle missing profile pics with reduced spacing
  const renderAvatar = (props: any) => {
    const { currentMessage } = props;
    const avatar = currentMessage.user.avatar;
    
    return (
      <Avatar
        {...props}
        containerStyle={{ marginRight: 2 }}
        imageStyle={{ borderRadius: 20 }}
        renderAvatar={() => 
          avatar ? (
            <Image 
              source={{ uri: avatar }} 
              style={{ width: 36, height: 36, borderRadius: 18 }}
            />
          ) : (
            <View style={{
              width: 36, 
              height: 36, 
              borderRadius: 18,
              backgroundColor: '#CCCCCC',
              justifyContent: 'center',
              alignItems: 'center'
            }}>
              <Text style={{ fontSize: 16, fontWeight: 'bold', color: '#666666' }}>
                {currentMessage.user.name?.charAt(0) || '?'}
              </Text>
            </View>
          )
        }
      />
    );
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>  
      <View style={[styles.header, { backgroundColor: colors.background }]}>  
        <Ionicons name="arrow-back" size={24} color={colors.text} onPress={() => router.back()} />
        <View style={styles.headerTitle}>
          {peerProfile?.profile_pic && (
            <Image 
              source={{ uri: peerProfile.profile_pic }} 
              style={styles.headerAvatar} 
            />
          )}
          <Text style={[styles.title, { color: colors.text }]}>
            {peerProfile?.username || peerId}
          </Text>
        </View>
        <View style={{ width: 24 }} />
      </View>

      <GiftedChat
        messages={messages}
        onSend={onSend}
        user={{
          _id: user!.id,
          name: user!.username,
          avatar: user!.profile_pic,
        }}
        renderAvatar={renderAvatar}
        renderUsernameOnMessage
        showAvatarForEveryMessage
        infiniteScroll
        keyboardShouldPersistTaps="handled"
        placeholder="Type a message..."
        timeTextStyle={{ left: { color: colors.secondaryText }, right: { color: colors.secondaryText } }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { 
    flex: 1 
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
  },
  headerTitle: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerAvatar: {
    width: 30,
    height: 30,
    borderRadius: 15,
    marginRight: 8,
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
  },
});
