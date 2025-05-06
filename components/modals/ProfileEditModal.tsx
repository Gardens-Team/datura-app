import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Alert,
  ActivityIndicator
} from 'react-native';
import { useColorScheme } from 'react-native';
import { Colors } from '@/constants/Colors';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@/services/supabase-singleton';
import { saveUserProfile } from '@/services/database-service';

// Friend item component for friend list
const FriendItem = ({ 
  friend, 
  onRemove,
  colors 
}: { 
  friend: string; 
  onRemove: () => void;
  colors: any;
}) => (
  <View style={[styles.friendItem, { backgroundColor: colors.border }]}>
    <Text style={[styles.friendItemText, { color: colors.text }]}>{friend}</Text>
    <TouchableOpacity onPress={onRemove} style={styles.removeFriendButton}>
      <Ionicons name="close-circle" size={20} color={colors.error} />
    </TouchableOpacity>
  </View>
);

// Interface for profile data
interface ProfileEditProps {
  visible: boolean;
  onClose: () => void;
  userData: {
    id: string;
    username?: string;
    handle?: string | null;
    bio?: string | null;
    profile_pic?: string | null;
  };
  friends?: string[];
  onUpdateSuccess: () => void;
}

export default function ProfileEditModal({
  visible,
  onClose,
  userData,
  friends = [],
  onUpdateSuccess
}: ProfileEditProps) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const isDark = colorScheme === 'dark';

  // Form state
  const [displayName, setDisplayName] = useState(userData.handle || '');
  const [username, setUsername] = useState(userData.username || '');
  const [bio, setBio] = useState(userData.bio || '');
  const [friendsList, setFriendsList] = useState<string[]>(friends);
  const [newFriend, setNewFriend] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errors, setErrors] = useState<{[key: string]: string}>({});

  // Update state when props change
  useEffect(() => {
    if (visible) {
      setDisplayName(userData.handle || '');
      setUsername(userData.username || '');
      setBio(userData.bio || '');
      setFriendsList(friends);
      setErrors({});
    }
  }, [visible, userData, friends]);

  // Add friend to the list
  const handleAddFriend = () => {
    if (!newFriend.trim()) return;
    
    // Validate if already at max friends
    if (friendsList.length >= 5) {
      setErrors({...errors, friends: 'Maximum 5 friends allowed'});
      return;
    }

    // Check if friend already exists in list
    if (friendsList.includes(newFriend.trim())) {
      setErrors({...errors, friends: 'This username is already in your friends list'});
      return;
    }

    setFriendsList([...friendsList, newFriend.trim()]);
    setNewFriend('');
    setErrors({...errors, friends: ''});
  };

  // Remove friend from list
  const handleRemoveFriend = (index: number) => {
    const updatedFriends = [...friendsList];
    updatedFriends.splice(index, 1);
    setFriendsList(updatedFriends);
    setErrors({...errors, friends: ''});
  };

  // Form validation
  const validateForm = () => {
    const newErrors: {[key: string]: string} = {};
    
    if (!username.trim()) {
      newErrors.username = 'Username is required';
    } else if (username.length < 3) {
      newErrors.username = 'Username must be at least 3 characters';
    }

    if (bio && bio.length > 300) {
      newErrors.bio = 'Bio must be less than 300 characters';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  // Submit form data
  const handleSubmit = async () => {
    if (!validateForm()) return;

    setIsSubmitting(true);
    try {
      // Update user data in Supabase
      const { error } = await supabase
        .from('users')
        .update({
          username: username.trim(),
          handle: displayName.trim(),
          bio: bio.trim(),
          // In a real app, you'd save friends to a separate table or in user metadata
        })
        .eq('id', userData.id);

      if (error) throw error;

      // Also update local SQLite database
      try {
        await saveUserProfile(
          userData.id, 
          username.trim(), 
          userData.profile_pic || '',
          // You might want to extend saveUserProfile to handle more fields
        );
      } catch (dbError) {
        console.error('Failed to update local database:', dbError);
        // Continue even if local DB update fails
      }

      // Call the success callback
      onUpdateSuccess();
      onClose();
      Alert.alert('Success', 'Profile updated successfully');
    } catch (error) {
      console.error('Error updating profile:', error);
      Alert.alert('Update Error', 'Failed to update profile. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      animationType="slide"
      transparent={true}
      visible={visible}
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardAvoidView}
      >
        <View style={[styles.centeredView, { backgroundColor: isDark ? 'rgba(0,0,0,0.5)' : 'rgba(0,0,0,0.2)' }]}>
          <View style={[styles.modalView, { backgroundColor: colors.background }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>Edit Profile</Text>
              <TouchableOpacity onPress={onClose} style={styles.closeButton}>
                <Ionicons name="close" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>

            <ScrollView 
              style={styles.formContainer}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.formContentContainer}
            >
              {/* Display Name */}
              <View style={styles.inputGroup}>
                <Text style={[styles.inputLabel, { color: colors.text }]}>Display Name</Text>
                <TextInput
                  style={[
                    styles.textInput,
                    { 
                      backgroundColor: isDark ? '#1e1e1e' : '#f0f0f0',
                      color: colors.text,
                      borderColor: errors.displayName ? colors.error : colors.border
                    }
                  ]}
                  placeholder="Your display name"
                  placeholderTextColor={colors.secondaryText}
                  value={displayName}
                  onChangeText={setDisplayName}
                />
                {errors.displayName && (
                  <Text style={[styles.errorText, { color: colors.error }]}>{errors.displayName}</Text>
                )}
              </View>

              {/* Username */}
              <View style={styles.inputGroup}>
                <Text style={[styles.inputLabel, { color: colors.text }]}>Username</Text>
                <TextInput
                  style={[
                    styles.textInput,
                    { 
                      backgroundColor: isDark ? '#1e1e1e' : '#f0f0f0',
                      color: colors.text,
                      borderColor: errors.username ? colors.error : colors.border
                    }
                  ]}
                  placeholder="Your username"
                  placeholderTextColor={colors.secondaryText}
                  value={username}
                  onChangeText={setUsername}
                />
                {errors.username && (
                  <Text style={[styles.errorText, { color: colors.error }]}>{errors.username}</Text>
                )}
              </View>

              {/* Bio */}
              <View style={styles.inputGroup}>
                <Text style={[styles.inputLabel, { color: colors.text }]}>Bio</Text>
                <TextInput
                  style={[
                    styles.textArea,
                    { 
                      backgroundColor: isDark ? '#1e1e1e' : '#f0f0f0',
                      color: colors.text,
                      borderColor: errors.bio ? colors.error : colors.border
                    }
                  ]}
                  placeholder="Tell others about yourself"
                  placeholderTextColor={colors.secondaryText}
                  value={bio}
                  onChangeText={setBio}
                  multiline
                  numberOfLines={4}
                  textAlignVertical="top"
                />
                <Text style={[styles.characterCount, { color: colors.secondaryText }]}>
                  {bio.length}/300
                </Text>
                {errors.bio && (
                  <Text style={[styles.errorText, { color: colors.error }]}>{errors.bio}</Text>
                )}
              </View>

              {/* Friends */}
              <View style={styles.inputGroup}>
                <Text style={[styles.inputLabel, { color: colors.text }]}>Friends (Max 5)</Text>
                
                {/* Friend input and add button */}
                <View style={styles.friendInputContainer}>
                  <TextInput
                    style={[
                      styles.friendInput,
                      { 
                        backgroundColor: isDark ? '#1e1e1e' : '#f0f0f0',
                        color: colors.text,
                        borderColor: errors.friends ? colors.error : colors.border
                      }
                    ]}
                    placeholder="Enter username"
                    placeholderTextColor={colors.secondaryText}
                    value={newFriend}
                    onChangeText={setNewFriend}
                    onSubmitEditing={handleAddFriend}
                  />
                  <TouchableOpacity 
                    style={[
                      styles.addFriendButton, 
                      { backgroundColor: colors.primary }
                    ]}
                    onPress={handleAddFriend}
                    disabled={friendsList.length >= 5 || !newFriend.trim()}
                  >
                    <Ionicons name="add" size={24} color="#fff" />
                  </TouchableOpacity>
                </View>
                
                {errors.friends && (
                  <Text style={[styles.errorText, { color: colors.error }]}>{errors.friends}</Text>
                )}

                {/* Friends list */}
                <View style={styles.friendsList}>
                  {friendsList.map((friend, index) => (
                    <FriendItem
                      key={index}
                      friend={friend}
                      onRemove={() => handleRemoveFriend(index)}
                      colors={colors}
                    />
                  ))}
                </View>
                
                <Text style={[styles.friendsCount, { color: colors.secondaryText }]}>
                  {friendsList.length}/5 friends
                </Text>
              </View>
            </ScrollView>

            {/* Submit button */}
            <TouchableOpacity
              style={[
                styles.submitButton,
                { backgroundColor: colors.primary },
                isSubmitting && { opacity: 0.7 }
              ]}
              onPress={handleSubmit}
              disabled={isSubmitting}
            >
              {isSubmitting ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={styles.submitButtonText}>Save Changes</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  keyboardAvoidView: {
    flex: 1,
  },
  centeredView: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalView: {
    width: '90%',
    maxHeight: '80%',
    borderRadius: 20,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
  },
  closeButton: {
    padding: 5,
  },
  formContainer: {
    width: '100%',
  },
  formContentContainer: {
    paddingBottom: 20,
  },
  inputGroup: {
    marginBottom: 20,
  },
  inputLabel: {
    fontSize: 16,
    fontWeight: '500',
    marginBottom: 8,
  },
  textInput: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
  },
  textArea: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    minHeight: 100,
  },
  characterCount: {
    fontSize: 12,
    alignSelf: 'flex-end',
    marginTop: 4,
  },
  friendInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  friendInput: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    marginRight: 10,
  },
  addFriendButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
  friendsList: {
    marginTop: 10,
  },
  friendItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    marginVertical: 4,
  },
  friendItemText: {
    fontSize: 16,
  },
  removeFriendButton: {
    padding: 2,
  },
  friendsCount: {
    fontSize: 12,
    alignSelf: 'flex-end',
    marginTop: 4,
  },
  errorText: {
    fontSize: 12,
    marginTop: 4,
  },
  submitButton: {
    width: '100%',
    padding: 15,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
  },
  submitButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
}); 