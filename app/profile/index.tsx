import React, { useMemo } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  ScrollView, 
  TouchableOpacity, 
  Linking,
  ActivityIndicator,
  FlatList
} from 'react-native';
import { Image } from 'expo-image';
import { useColorScheme } from 'react-native';
import { Colors } from '@/constants/Colors';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useUserCreatorGardens } from '@/hooks/useUserCreatorGardens';
import { useRouter } from 'expo-router';
import { Garden } from '@/services/garden-service';

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
  const { user, loading: userLoading } = useCurrentUser();
  const router = useRouter();

  // Cast the user data to the more complete type
  const fullUser = user as FullUserProfile | null;

  // Fetch creator gardens using the new hook
  const { 
    gardens,
    decryptedLogos,
    loading: gardensLoading,
    error: gardensError,
  } = useUserCreatorGardens(fullUser?.id);

  // Shuffle and limit gardens once when data is loaded
  const displayedGardens = useMemo(() => {
    if (gardens && gardens.length > 0) {
      return shuffleArray(gardens).slice(0, 8); // Shuffle and take max 8
    }
    return [];
  }, [gardens]);

  // Combined loading state
  const isLoading = userLoading || gardensLoading;

  // Random color for banner - would be user-selected in a real app
  const bannerColor = '#3b82f6';

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

  // Helper to render each garden item in the grid
  const renderGardenItem = ({ item }: { item: Garden }) => {
    const logoUri = item.id ? decryptedLogos[item.id] : null;
    const initials = item.name ? item.name.charAt(0).toUpperCase() : '?';

    return (
      <TouchableOpacity 
        style={styles.myGardensItem}
        onPress={() => item.id && router.push(`/garden/${item.id}`)} // Navigate to garden page
      >
        {logoUri ? (
          <Image source={{ uri: logoUri }} style={styles.myGardensLogo} />
        ) : (
          <View style={[styles.myGardensLogo, styles.myGardensInitials, { backgroundColor: colors.primary + '30' }]}>
            <Text style={[styles.initialsText, { color: colors.primary }]}>{initials}</Text>
          </View>
        )}
      </TouchableOpacity>
    );
  };

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
        <View style={styles.profilePictureContainer}>
          <Image 
            source={{ uri: fullUser.profile_pic || `https://api.dicebear.com/9.x/identicon/svg?seed=${fullUser.username}` }}
            style={styles.profilePicture}
          />
          <View style={styles.statusIndicator} />
        </View>
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
        >
          <Ionicons name="pencil" size={16} color={colors.text} />
          <Text style={[styles.editButtonText, { color: colors.text }]}>
            Edit Profile
          </Text>
        </TouchableOpacity>
      </View>

      {/* My Gardens Section */}
      <View style={[styles.myGardensContainer, { backgroundColor: isDark ? '#2b2d31' : '#f2f3f5', borderColor: colors.border }]}>
        <Text style={[styles.sectionTitle, { color: colors.text, marginBottom: 12 }]}>My Gardens</Text> 
        {gardensError && (
          <Text style={{ color: colors.error }}>Error loading gardens.</Text>
        )}
        {!gardensError && displayedGardens.length > 0 && (
          <FlatList
            data={displayedGardens}
            renderItem={renderGardenItem}
            keyExtractor={(item) => item.id || Math.random().toString()}
            numColumns={4}
            columnWrapperStyle={styles.myGardensGrid}
            scrollEnabled={false}
          />
        )}
        {!gardensError && displayedGardens.length === 0 && !gardensLoading && (
          <Text style={{ color: colors.secondaryText, textAlign: 'center' }}> 
You haven't created any gardens yet.
          </Text>
        )}
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

      {/* Friends Section */}
      <View style={styles.sectionContainer}>
        <View style={styles.sectionTitleRow}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Your Friends</Text>
          <Ionicons name="chevron-forward" size={18} color={colors.secondaryText} />
        </View>
        
        <View style={styles.friendsContainer}>
          {[1, 2, 3, 4, 5].map((friend, index) => (
            <View 
              key={index} 
              style={[
                styles.friendAvatar, 
                { backgroundColor: `hsl(${index * 50}, 70%, 60%)` }
              ]} 
            />
          ))}
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
  },
  profilePicture: {
    width: 80,
    height: 80,
    borderRadius: 40,
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
    justifyContent: 'space-between', // Distribute items evenly
    marginBottom: 10, // Add space between rows
  },
  myGardensItem: {
    // Calculate width based on numColumns and spacing
    // Example for 4 columns with some spacing:
    width: '20%', // Reduced from 22%
    aspectRatio: 1, // Make items square
    alignItems: 'center',
    justifyContent: 'center',
  },
  myGardensLogo: {
    width: '100%',
    height: '100%',
    borderRadius: 6, // Reduced border radius slightly to match smaller size
  },
  myGardensInitials: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  initialsText: {
    fontSize: 18, // Reduced from 24
    fontWeight: '600',
  },
  myGardensContainer: {
    marginHorizontal: 16,
    borderRadius: 8,
    padding: 16,
    borderWidth: 1,
    marginBottom: 20, // Match sectionContainer margin
  },
});

