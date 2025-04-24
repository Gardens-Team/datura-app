import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Image,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from 'react-native';
import { 
  approveMembershipRequest, 
  denyMembershipRequest 
} from '@/services/garden-service';
import { useCurrentUser } from '@/hooks/useCurrentUser';

interface AdminNotificationProps {
  type: string;
  userId: string;
  username: string;
  profilePic?: string;
  timestamp: string;
  actionRequired?: boolean;
  gardenId: string;
  onAction?: () => void;
}

export default function AdminNotification({
  type,
  userId,
  username,
  profilePic,
  timestamp,
  actionRequired = false,
  gardenId,
  onAction,
}: AdminNotificationProps) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const [loading, setLoading] = useState(false);
  const [actionTaken, setActionTaken] = useState(false);
  const { user } = useCurrentUser();
  
  // Format the timestamp
  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp);
    return date.toLocaleString();
  };

  const handleApprove = async () => {
    if (!user) return;
    
    setLoading(true);
    try {
      await approveMembershipRequest(gardenId, userId, user.id);
      setActionTaken(true);
      Alert.alert('Success', `${username} has been approved to join the garden`);
      if (onAction) onAction();
    } catch (error) {
      console.error('Failed to approve:', error);
      Alert.alert('Error', error instanceof Error ? error.message : 'Failed to approve');
    } finally {
      setLoading(false);
    }
  };

  const handleDeny = async () => {
    if (!user) return;
    
    setLoading(true);
    try {
      await denyMembershipRequest(gardenId, userId);
      setActionTaken(true);
      Alert.alert('Success', `${username}'s request has been denied`);
      if (onAction) onAction();
    } catch (error) {
      console.error('Failed to deny:', error);
      Alert.alert('Error', error instanceof Error ? error.message : 'Failed to deny');
    } finally {
      setLoading(false);
    }
  };

  const renderNotificationContent = () => {
    switch (type) {
      case 'membership_request':
        return (
          <View style={styles.notificationContent}>
            <View style={styles.userInfo}>
              {profilePic ? (
                <Image source={{ uri: profilePic }} style={styles.avatar} />
              ) : (
                <View style={[styles.avatar, { backgroundColor: colors.primary, justifyContent: 'center', alignItems: 'center' }]}>
                  <Ionicons name="person" size={24} color="white" />
                </View>
              )}
              <View style={styles.userText}>
                <Text style={[styles.username, { color: colors.text }]}>{username}</Text>
                <Text style={[styles.message, { color: colors.secondaryText }]}>
                  has requested to join this garden
                </Text>
                <Text style={[styles.timestamp, { color: colors.secondaryText }]}>
                  {formatTime(timestamp)}
                </Text>
              </View>
            </View>
            
            {actionRequired && !actionTaken && (
              <View style={styles.actionButtons}>
                <TouchableOpacity 
                  style={[styles.actionButton, styles.approveButton, { backgroundColor: colors.success }]}
                  onPress={handleApprove}
                  disabled={loading}
                >
                  {loading ? (
                    <ActivityIndicator size="small" color="white" />
                  ) : (
                    <>
                      <Ionicons name="checkmark" size={16} color="white" />
                      <Text style={styles.actionButtonText}>Approve</Text>
                    </>
                  )}
                </TouchableOpacity>
                
                <TouchableOpacity 
                  style={[styles.actionButton, styles.denyButton, { backgroundColor: colors.error }]}
                  onPress={handleDeny}
                  disabled={loading}
                >
                  {loading ? (
                    <ActivityIndicator size="small" color="white" />
                  ) : (
                    <>
                      <Ionicons name="close" size={16} color="white" />
                      <Text style={styles.actionButtonText}>Deny</Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
            )}
            
            {actionTaken && (
              <View style={styles.completedContainer}>
                <Text style={[styles.completedText, { color: colors.success }]}>
                  Action completed
                </Text>
              </View>
            )}
          </View>
        );
        
      default:
        return (
          <View style={styles.notificationContent}>
            <Text style={[styles.message, { color: colors.text }]}>
              Unknown notification type: {type}
            </Text>
          </View>
        );
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: actionTaken ? colors.background : colors.primary + '10' }]}>
      <View style={styles.notificationHeader}>
        <Ionicons 
          name={type === 'membership_request' ? 'person-add' : 'notifications'} 
          size={20} 
          color={colors.primary} 
        />
        <Text style={[styles.notificationType, { color: colors.primary }]}>
          {type === 'membership_request' ? 'Membership Request' : 'Notification'}
        </Text>
      </View>
      
      {renderNotificationContent()}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 12,
    overflow: 'hidden',
    marginBottom: 16,
    padding: 16,
  },
  notificationHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  notificationType: {
    fontWeight: '600',
    fontSize: 14,
    marginLeft: 8,
  },
  notificationContent: {
    width: '100%',
  },
  userInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    marginRight: 12,
  },
  userText: {
    flex: 1,
  },
  username: {
    fontWeight: '600',
    fontSize: 16,
    marginBottom: 2,
  },
  message: {
    fontSize: 14,
    marginBottom: 4,
  },
  timestamp: {
    fontSize: 12,
  },
  actionButtons: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
    justifyContent: 'center',
  },
  approveButton: {
    minWidth: 100,
  },
  denyButton: {
    minWidth: 100,
  },
  actionButtonText: {
    color: 'white',
    fontWeight: '500',
    marginLeft: 4,
  },
  completedContainer: {
    alignItems: 'flex-end',
    marginTop: 8,
  },
  completedText: {
    fontStyle: 'italic',
  },
}); 