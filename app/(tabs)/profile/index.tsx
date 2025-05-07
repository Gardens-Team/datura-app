import React, { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  ScrollView, 
  TouchableOpacity, 
  Linking,
  ActivityIndicator,
  FlatList,
  Platform,
  Alert
} from 'react-native';
import { Image } from 'expo-image';
import { useColorScheme } from 'react-native';
import { Colors } from '@/constants/Colors';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useRouter } from 'expo-router';
import { Garden } from '@/services/garden-service';
import * as ImagePicker from 'expo-image-picker';
import { supabase } from '@/services/supabase-singleton';
import * as FileSystem from 'expo-file-system';
import { saveUserProfile } from '@/services/database-service';
import ProfileEditModal from '@/components/modals/ProfileEditModal';

// Define a more complete User Profile interface based on database schema
interface FullUserProfile {
  id: string;
  username: string;
  profile_pic: string | null; // Assuming profile_pic is the correct column name
  publicKey: string; // Assuming this is from the layout definition, might not be needed here
  handle?: string | null; // Optional fields
  bio?: string | null;
  website_url?: string | null;
  created_at?: string | null; // Assuming this is a timestamp string
}

// Function to shuffle an array (Fisher-Yates)
function shuffleArray<T>(array: T[]): T[] {
  let currentIndex = array.length, randomIndex;
  const newArray = [...array]; // Create a copy

  // While there remain elements to shuffle.
  while (currentIndex !== 0) {
    // Pick a remaining element.
    randomIndex = Math.floor(Math.random() * currentIndex);
    currentIndex--;

    // And swap it with the current element.
    [newArray[currentIndex], newArray[randomIndex]] = [
      newArray[randomIndex], newArray[currentIndex]];
  }

  return newArray;
}

export default function ProfileScreen() {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const insets = useSafeAreaInsets();
  const isDark = colorScheme === 'dark';
  const { user, loading: userLoading, refetchUser } = useCurrentUser();
  const router = useRouter();
  const [isUploading, setIsUploading] = useState(false);
  const [imageUpdateKey, setImageUpdateKey] = useState(Date.now());
  const [isEditModalVisible, setIsEditModalVisible] = useState(false);
  const [friendsList, setFriendsList] = useState<string[]>([]);

  // Cast the user data to the more complete type
  const fullUser = user as FullUserProfile | null;

  // Combined loading state
  const isLoading = userLoading;

  // Random color for banner - would be user-selected in a real app
  const bannerColor = '#3b82f6';

  // --- Image Picker and Upload Logic --- 
  const handleChoosePhoto = useCallback(async () => {
    // Request permissions first
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission Required', 'Sorry, we need camera roll permissions to make this work!');
      return;
    }

    // Launch picker
    let result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images', 'livePhotos', 'videos'], // Allow all media types including GIFs
      aspect: [1, 1], // Square aspect ratio for profile pics
      allowsEditing: false,
      quality: 1.0, // Try a much lower quality
      base64: false, // We'll read the file manually for better control
    });

    if (!result.canceled && result.assets && result.assets.length > 0) {
      const uri = result.assets[0].uri;
      // Check if selected file is a GIF by file extension
      const isGif = uri.toLowerCase().endsWith('.gif');
      console.log(`Selected image: ${uri}, isGif: ${isGif}`);
      await uploadProfilePic(uri, isGif);
    }
  }, [fullUser]);

  // Convert image to base64
  const imageToBase64 = async (uri: string): Promise<string> => {
    try {
      const base64 = await FileSystem.readAsStringAsync(uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      return base64;
    } catch (error) {
      console.error("Error converting image to base64:", error);
      throw new Error('Failed to convert image');
    }
  };

  // Upload image directly to user profile without using Storage
  const uploadProfilePic = useCallback(async (uri: string, isGif = false) => {
    if (!fullUser?.id) {
      console.error("Error: fullUser.id is undefined or null");
      Alert.alert('Error', 'User ID not found. Cannot update picture.');
      return;
    }

    console.log(`Starting profile pic update for user: ${fullUser.id}`);
    console.log(`Image URI: ${uri.substring(0, 50)}...`);
    console.log(`Image type: ${isGif ? 'GIF' : 'Static Image'}`);
    
    setIsUploading(true);
    try {
      // Additional check for GIF based on extension if not already determined
      if (!isGif && uri.toLowerCase().includes('.gif')) {
        console.log('GIF detected by filename pattern check');
        isGif = true;
      }
      
      // Convert image to base64
      console.log('Converting image to base64...');
      const base64Image = await imageToBase64(uri);
      console.log(`Base64 conversion complete. Length: ${base64Image.length} chars`);
      
      // Check file size - base64 is ~33% larger than binary
      // GIFs can be larger, so adjust the size limit for GIFs
      const maxSizeKB = isGif ? 4000 : 2000; // Higher limits for all images to accommodate GIFs
      const approximateSizeInKB = Math.round((base64Image.length * 3) / 4 / 1024);
      console.log(`Approximate image size: ${approximateSizeInKB}KB, MaxSize: ${maxSizeKB}KB, IsGif: ${isGif}`);
      
      if (approximateSizeInKB > maxSizeKB) {
        console.log('Image too large, needs resizing');
        if (isGif) {
          throw new Error(`GIF too large (${approximateSizeInKB}KB). GIFs must be under ${maxSizeKB}KB. Please choose a smaller GIF.`);
        } else {
          throw new Error(`Image too large (${approximateSizeInKB}KB). Please choose a smaller image or resize it.`);
        }
      }
      
      // Create data URL with the correct MIME type
      const mimeType = isGif ? 'image/gif' : 'image/jpeg';
      const dataUrl = `data:${mimeType};base64,${base64Image}`;
      console.log(`Data URL created with mime type ${mimeType}: ${dataUrl.substring(0, 50)}...`);
      
      // DEBUGGING: Log the update attempt
      console.log('Attempting to update user profile with data URL...');
      
      // Update user profile in database directly with base64 data
      const { data, error: updateError } = await supabase
        .from('users')
        .update({ profile_pic: dataUrl })
        .eq('id', fullUser.id)
        .select('profile_pic'); // Return updated record to verify

      if (updateError) {
        console.error('Supabase update error:', updateError);
        throw updateError;
      }
      
      console.log('Database update result:', data);
      
      if (!data || data.length === 0) {
        console.warn('Update succeeded but no data returned');
      } else {
        console.log(`Profile updated with ${data[0].profile_pic.substring(0, 30)}...`);
        
        // Also update the local SQLite database
        try {
          await saveUserProfile(fullUser.id, fullUser.username, dataUrl);
          console.log('Local SQLite database updated with new profile picture');
        } catch (dbError) {
          console.error('Failed to update local database:', dbError);
          // Continue even if local DB update fails
        }
      }

      // Refetch user data to update UI
      console.log('Calling refetchUser to update UI...');
      await refetchUser();
      
      // Also directly fetch latest data from Supabase to ensure we have the most current data
      try {
        const { data: userData, error: userError } = await supabase
          .from('users')
          .select('*')
          .eq('id', fullUser.id)
          .single();
          
        if (userError) {
          console.error('Error fetching updated user data:', userError);
        } else if (userData) {
          console.log('Got fresh user data from Supabase, updating local state');
          // Save to local SQLite again with latest data
          await saveUserProfile(userData.id, userData.username, userData.profile_pic);
        }
      } catch (fetchError) {
        console.error('Failed to fetch fresh user data:', fetchError);
      }
      
      // Force image component to re-render by updating key
      setImageUpdateKey(Date.now());
      console.log('RefetchUser completed and image key updated');
      
      Alert.alert('Success', 'Profile picture updated!');

    } catch (error) {
      console.error("Error updating profile picture:", error);
      
      // More detailed error information
      if (error instanceof Error) {
        console.error('Error name:', error.name);
        console.error('Error message:', error.message);
        console.error('Error stack:', error.stack);
      }
      
      // Check for specific Supabase errors
      if (error && typeof error === 'object' && 'code' in error) {
        console.error('Supabase error code:', (error as any).code);
        console.error('Supabase error details:', (error as any).details);
        
        // Handle specific error cases
        if ((error as any).message?.includes('too large') || 
            (error as any).message?.includes('size') ||
            (error as any).code === '22001') {
          // String too long/column size exceeded
          Alert.alert('Error', 'Image too large for the database. Please choose a smaller image.');
          return;
        }
      }
      
      Alert.alert('Upload Error', error instanceof Error ? error.message : 'Could not update profile picture.');
    } finally {
      setIsUploading(false);
    }
  }, [fullUser, refetchUser]);

  // Let's also add a check for refetchUser function
  useEffect(() => {
    // Check if we can call refetchUser
    try {
      console.log('Verifying refetchUser function...');
      // Just log that it exists but don't actually call it
      if (typeof refetchUser === 'function') {
        console.log('refetchUser is a valid function');
      }
    } catch (err) {
      console.warn('Error with refetchUser:', err);
    }
  }, [refetchUser]);

  // Fetch friends data (this would typically come from an API)
  // In a real app, this would be from a friends database table
  useEffect(() => {
    // Simulate fetching friends list - in a real app, this would be an API call
    // For now we'll use some placeholder friends
    setFriendsList(['user1', 'user2', 'gardenlover', 'plantfriend']);
  }, []);

  // Handle edit profile modal
  const handleOpenEditModal = () => {
    setIsEditModalVisible(true);
  };

  const handleCloseEditModal = () => {
    setIsEditModalVisible(false);
  };

  // Handle profile update success
  const handleProfileUpdateSuccess = async () => {
    // Refresh user data
    await refetchUser();
  };

  if (isLoading) {
    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.text} />
      </View>
    );
  }

  if (!fullUser) {
    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background }]}>
        <Text style={{ color: colors.text }}>Could not load user profile.</Text>
      </View>
    );
  }

  const memberSinceDate = fullUser.created_at ? new Date(fullUser.created_at).toLocaleDateString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric'
  }) : 'N/A';

  return (
    <ScrollView 
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={{ paddingBottom: insets.bottom + 80 }}
      showsVerticalScrollIndicator={false}
    >
      {/* Banner & Profile Picture */}
      <View style={styles.bannerContainer}>
        <View style={[styles.banner, { backgroundColor: bannerColor }]}>
          <TouchableOpacity style={styles.addStatusButton}>
            <Ionicons name="add" size={20} color="#fff" />
            <Text style={styles.addStatusText}>Add Status</Text>
          </TouchableOpacity>
        </View>
        <TouchableOpacity 
          style={styles.profilePictureContainer}
          onPress={handleChoosePhoto}
        >
          <Image 
            source={{  uri: fullUser.profile_pic || `https://api.dicebear.com/9.x/identicon/svg?seed=${fullUser.username}` }}
            style={styles.profilePicture}
            key={`profile-image-${imageUpdateKey}`}
            cachePolicy="none"
            contentFit="cover"
            autoplay={true}
            recyclingKey={`profile-${imageUpdateKey}`}
            placeholder={Platform.OS === 'ios' ? {
              color: 'rgba(200, 200, 200, 0.5)'
            } : undefined}
            transition={200}
          />
          {isUploading && (
            <View style={styles.uploadOverlay}>
              <ActivityIndicator size="small" color="#fff" />
            </View>
          )}
          <View style={[styles.statusIndicator, isUploading && { opacity: 0 }]} />
        </TouchableOpacity>
      </View>

      {/* Username & Edit Button */}
      <View style={styles.userInfoContainer}>
        <View style={styles.usernameContainer}>
          <Text style={[styles.username, { color: colors.text }]}>
            {fullUser.username || 'N/A'} <Ionicons name="chevron-down" size={20} color={colors.text} />
          </Text>
          <Text style={[styles.handle, { color: colors.secondaryText }]}>
            {fullUser.handle || fullUser.username} • <Text style={{ color: '#3b82f6' }}>Online</Text>
          </Text>
        </View>

        <TouchableOpacity 
          style={[styles.editProfileButton, { borderColor: colors.border }]}
          onPress={handleOpenEditModal}
        >
          <Ionicons name="pencil" size={16} color={colors.text} />
          <Text style={[styles.editButtonText, { color: colors.text }]}>
            Edit Profile
          </Text>
        </TouchableOpacity>
      </View>

      {/* About Me */}
      <View style={styles.sectionContainer}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>About Me</Text>
        <Text style={[styles.bioText, { color: colors.text }]}>{fullUser.bio || 'No bio yet.'}</Text>
        
        {fullUser.website_url && (
          <TouchableOpacity 
            style={styles.websiteContainer} 
            onPress={() => fullUser.website_url && Linking.openURL(fullUser.website_url)}
          >
            <Text style={[styles.websiteText, { color: '#3b82f6' }]}>{fullUser.website_url}</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Member Since */}
      <View style={styles.sectionContainer}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Member Since</Text>
        <View style={styles.memberSinceContainer}>
          <Ionicons name="leaf-outline" size={18} color={colors.secondaryText} />
          <Text style={[styles.memberSinceText, { color: colors.text }]}>{memberSinceDate}</Text>
        </View>
      </View>

      {/* Note Section */}
      <View style={styles.sectionContainer}>
        <View style={styles.sectionTitleRow}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Note (only visible to you)</Text>
          <Ionicons name="create-outline" size={18} color={colors.secondaryText} />
        </View>
        <TouchableOpacity 
          style={[styles.noteContainer, { borderColor: colors.border }]}
        >
          <Text style={[styles.noteText, { color: colors.secondaryText }]}>
            {"Click to add a note"}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Profile Edit Modal */}
      {fullUser && (
        <ProfileEditModal
          visible={isEditModalVisible}
          onClose={handleCloseEditModal}
          userData={fullUser}
          friends={friendsList}
          onUpdateSuccess={handleProfileUpdateSuccess}
        />
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  bannerContainer: {
    height: 180,
    position: 'relative',
  },
  banner: {
    height: 120,
    width: '100%',
    justifyContent: 'flex-end',
    alignItems: 'flex-end',
    paddingBottom: 16,
    paddingRight: 16,
  },
  addStatusButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  addStatusText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '500',
    marginLeft: 4,
  },
  profilePictureContainer: {
    position: 'absolute',
    bottom: 0,
    left: 16,
    borderRadius: 50,
    borderWidth: 6,
    borderColor: '#121212',
    backgroundColor: '#121212',
  },
  profilePicture: {
    width: 80,
    height: 80,
    borderRadius: 40,
  },
  uploadOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  statusIndicator: {
    position: 'absolute',
    bottom: 2,
    right: 2,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#4ade80',
    borderWidth: 2,
    borderColor: '#121212',
  },
  userInfoContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    padding: 16,
    paddingBottom: 10,
  },
  usernameContainer: {
    flex: 1,
  },
  username: {
    fontSize: 20,
    fontWeight: 'bold',
    flexDirection: 'row',
    alignItems: 'center',
  },
  handle: {
    fontSize: 14,
    marginTop: 2,
  },
  editProfileButton: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  editButtonText: {
    fontSize: 14,
    fontWeight: '500',
    marginLeft: 4,
  },
  promoCard: {
    marginHorizontal: 16,
    borderRadius: 8,
    padding: 16,
    flexDirection: 'row',
    borderWidth: 1,
    marginBottom: 16,
  },
  promoContent: {
    flex:.9,
  },
  promoTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 12,
  },
  gardenLogos: {
    flexDirection: 'row',
    gap: 12,
  },
  gardenLogo: {
    width: 40,
    height: 40,
    borderRadius: 6,
  },
  closeButton: {
    flex: .1,
    alignItems: 'flex-end',
  },
  sectionContainer: {
    paddingHorizontal: 16,
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 8,
  },
  sectionTitleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  playingCard: {
    flexDirection: 'row',
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  gameIconContainer: {
    width: 50,
    height: 50,
    borderRadius: 5,
    backgroundColor: '#1f1f1f',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  gameInfo: {
    flex: 1,
  },
  gameName: {
    fontSize: 16,
    fontWeight: '500',
  },
  playingTimeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
  playingTime: {
    fontSize: 12,
    marginLeft: 4,
  },
  bioText: {
    fontSize: 14,
    lineHeight: 20,
  },
  websiteContainer: {
    marginTop: 8,
  },
  websiteText: {
    fontSize: 14,
  },
  memberSinceContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  memberSinceText: {
    fontSize: 14,
    marginLeft: 8,
  },
  friendsContainer: {
    flexDirection: 'row',
    gap: 8,
  },
  friendAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  friendInitial: {
    fontSize: 16,
    fontWeight: '600',
    color: '#ffffff',
  },
  noteContainer: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
  },
  noteText: {
    fontSize: 14,
  },
  myGardensGrid: {
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  myGardensItem: {
    width: '20%',
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  myGardensLogo: {
    width: '100%',
    height: '100%',
    borderRadius: 6,
  },
  myGardensInitials: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  initialsText: {
    fontSize: 18,
    fontWeight: '600',
  },
  myGardensContainer: {
    marginHorizontal: 16,
    borderRadius: 8,
    padding: 16,
    borderWidth: 1,
    marginBottom: 20,
  },
});

