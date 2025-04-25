import React, { useEffect, useState } from 'react';
import { 
  View, 
  Text, 
  FlatList, 
  StyleSheet, 
  TouchableOpacity, 
  ActivityIndicator, 
  Image 
} from 'react-native';
import { useColorScheme } from 'react-native';
import { Colors } from '@/constants/Colors';
import { supabase } from '@/services/supabase-singleton';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { approveMembershipRequest, denyMembershipRequest } from '@/services/garden-service';

// Notification type definitions
interface Notification {
  id: string;
  type: string;
  user_id: string;
  title?: string;
  body?: string;
  created_at: string;
  read: boolean;
  data?: any;
  payload?: any;
}

// Convert payload or data from string if needed
function parseNotificationData(notification: Notification) {
  try {
    if (notification.payload && typeof notification.payload === 'string') {
      notification.payload = JSON.parse(notification.payload);
    }
    if (notification.data && typeof notification.data === 'string') {
      notification.data = JSON.parse(notification.data);
    }
    return notification;
  } catch (e) {
    console.error('Error parsing notification data', e);
    return notification;
  }
}

export default function NotificationsScreen() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const { user } = useCurrentUser();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];

  // Load notifications
  useEffect(() => {
    fetchNotifications();
  }, [user]);

  async function fetchNotifications() {
    if (!user) return;
    
    console.log('[NotificationsScreen] Fetching notifications for user:', user.id);
    setLoading(true);
    try {
      // Fetch user notifications
      const { data, error } = await supabase
        .from('notifications')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });
        
      if (error) {
        console.error('[NotificationsScreen] Error fetching notifications:', error);
        throw error;
      }
      
      console.log(`[NotificationsScreen] Retrieved ${data?.length || 0} notifications`);
      if (data && data.length > 0) {
        console.log('[NotificationsScreen] First notification:', JSON.stringify(data[0]));
      }
      
      // Process each notification
      const processedData = (data || []).map(parseNotificationData);
      setNotifications(processedData);
    } catch (error) {
      console.error('Error fetching notifications:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  const handleRefresh = () => {
    setRefreshing(true);
    fetchNotifications();
  };

  const markAsRead = async (notificationId: string) => {
    try {
      await supabase
        .from('notifications')
        .update({ read: true })
        .eq('id', notificationId);
        
      // Update local state
      setNotifications(prevState => 
        prevState.map(n => 
          n.id === notificationId ? { ...n, read: true } : n
        )
      );
    } catch (error) {
      console.error('Error marking notification as read:', error);
    }
  };
  
  // Handle membership request approval
  const handleApproveMembership = async (userId: string, gardenId: string, notificationId: string) => {
    try {
      if (!user) return;
      
      const success = await approveMembershipRequest(gardenId, userId, user.id);
      if (success) {
        // Mark notification as read
        await markAsRead(notificationId);
        // Refresh notifications
        fetchNotifications();
      }
    } catch (error) {
      console.error('Error approving membership:', error);
    }
  };
  
  // Handle membership request denial
  const handleDenyMembership = async (userId: string, gardenId: string, notificationId: string) => {
    try {
      const success = await denyMembershipRequest(gardenId, userId);
      if (success) {
        // Mark notification as read
        await markAsRead(notificationId);
        // Refresh notifications
        fetchNotifications();
      }
    } catch (error) {
      console.error('Error denying membership:', error);
    }
  };

  // Render a membership request notification
  const renderMembershipRequest = (notification: Notification) => {
    const { payload } = notification;
    if (!payload || !payload.userId || !payload.gardenId) return null;
    
    return (
      <View style={[
        styles.membershipRequestContainer,
        { backgroundColor: colors.surface, borderLeftColor: colors.primary }
      ]}>
        <View style={styles.userInfo}>
          {payload.profilePic ? (
            <Image source={{ uri: payload.profilePic }} style={styles.userAvatar} />
          ) : (
            <View style={[styles.userAvatar, { backgroundColor: colors.primary }]}>
              <Text style={styles.userInitial}>{payload.username?.[0]?.toUpperCase() || '?'}</Text>
            </View>
          )}
          <View style={styles.userDetails}>
            <Text style={[styles.username, { color: colors.text }]}>{payload.username}</Text>
            <Text style={[styles.requestText, { color: colors.secondaryText }]}>
              requested to join your garden
            </Text>
          </View>
        </View>
        
        <View style={styles.actionButtons}>
          <TouchableOpacity
            style={[styles.denyButton, { backgroundColor: colors.error + '20', borderColor: colors.error }]}
            onPress={() => handleDenyMembership(payload.userId, payload.gardenId, notification.id)}
          >
            <Text style={[styles.buttonText, { color: colors.error }]}>Deny</Text>
          </TouchableOpacity>
          
          <TouchableOpacity
            style={[styles.approveButton, { backgroundColor: colors.success }]}
            onPress={() => handleApproveMembership(payload.userId, payload.gardenId, notification.id)}
          >
            <Text style={[styles.buttonText, { color: 'white' }]}>Approve</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };
  
  // Render a standard notification
  const renderStandardNotification = (notification: Notification) => {
    const { title, body, data } = notification;
    
    return (
      <TouchableOpacity
        style={[
          styles.standardNotification,
          { backgroundColor: colors.surface, borderLeftWidth: notification.read ? 0 : 4, borderLeftColor: colors.primary }
        ]}
        onPress={() => {
          markAsRead(notification.id);
          // Navigate if needed
          if (data?.gardenId) {
            router.push(`/garden/${data.gardenId}`);
          }
        }}
      >
        <View style={styles.notificationContent}>
          <Ionicons 
            name={notification.read ? "notifications-outline" : "notifications"} 
            size={24} 
            color={notification.read ? colors.secondaryText : colors.primary} 
          />
          <View style={styles.notificationText}>
            <Text style={[styles.notificationTitle, { color: colors.text }]}>
              {title || 'New Notification'}
            </Text>
            <Text style={[styles.notificationBody, { color: colors.secondaryText }]}>
              {body || 'You have a new notification'}
            </Text>
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  // Render different notification types
  const renderNotification = ({ item }: { item: Notification }) => {
    switch (item.type) {
      case 'membership_request':
        return renderMembershipRequest(item);
      default:
        return renderStandardNotification(item);
    }
  };

  if (loading && !refreshing) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <FlatList
        data={notifications}
        renderItem={renderNotification}
        keyExtractor={item => item.id}
        contentContainerStyle={styles.list}
        refreshing={refreshing}
        onRefresh={handleRefresh}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Ionicons name="notifications-off-outline" size={48} color={colors.secondaryText} />
            <Text style={[styles.emptyText, { color: colors.secondaryText }]}>
              No notifications yet
            </Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  list: {
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  membershipRequestContainer: {
    borderRadius: 6,
    paddingVertical: 12,
    paddingHorizontal: 12,
    marginBottom: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  userInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  userAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  userInitial: {
    color: 'white',
    fontSize: 20,
    fontWeight: '600',
  },
  userDetails: {
    marginLeft: 12,
    flex: 1,
  },
  username: {
    fontSize: 16,
    fontWeight: '600',
  },
  requestText: {
    fontSize: 14,
  },
  actionButtons: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  approveButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    marginLeft: 8,
  },
  denyButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
  },
  buttonText: {
    fontWeight: '600',
  },
  standardNotification: {
    borderRadius: 6,
    paddingVertical: 12,
    paddingHorizontal: 12,
    marginBottom: 8,
  },
  notificationContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  notificationText: {
    marginLeft: 12,
    flex: 1,
  },
  notificationTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },
  notificationBody: {
    fontSize: 14,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 48,
  },
  emptyText: {
    fontSize: 16,
    marginTop: 12,
  },
});