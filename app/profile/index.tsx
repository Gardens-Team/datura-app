import React from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  Image, 
  ScrollView, 
  TouchableOpacity, 
  Linking
} from 'react-native';
import { useColorScheme } from 'react-native';
import { Colors } from '@/constants/Colors';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

// Placeholder user data - will be replaced with Supabase data
const USER = {
  username: 'GardenUser',
  handle: 'gardenuser',
  bio: "I'm not a champagne socialist\nI'm a anti-social angry motorist",
  avatar: 'https://api.dicebear.com/9.x/identicon/svg?backgroundColor=00acc1,1e88e5,5e35b1',
  website: 'https://gardenuser.substack.com/',
  playing: {
    name: 'Gardens',
    time: '12:34:56'
  },
  memberSince: 'Jul 20, 2022',
  friends: [1, 2, 3, 4, 5], // Will be replaced with actual friend data
  note: ''
};

export default function ProfileScreen() {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const insets = useSafeAreaInsets();
  const isDark = colorScheme === 'dark';

  // Random color for banner - would be user-selected in a real app
  const bannerColor = '#3b82f6';

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
            source={{ uri: USER.avatar }}
            style={styles.profilePicture}
            defaultSource={{ uri: USER.avatar }}
          />
          <View style={styles.statusIndicator} />
        </View>
      </View>

      {/* Username & Edit Button */}
      <View style={styles.userInfoContainer}>
        <View style={styles.usernameContainer}>
          <Text style={[styles.username, { color: colors.text }]}>
            {USER.username} <Ionicons name="chevron-down" size={20} color={colors.text} />
          </Text>
          <Text style={[styles.handle, { color: colors.secondaryText }]}>
            {USER.handle} • <Text style={{ color: '#3b82f6' }}>Online</Text>
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

      {/* Gardens Promo Card */}
      <View style={[styles.promoCard, { backgroundColor: isDark ? '#2b2d31' : '#f2f3f5', borderColor: colors.border }]}>
        <View style={styles.promoContent}>
          <Text style={[styles.promoTitle, { color: colors.text }]}>
            Check out {USER.username}'s Gardens
          </Text>
          
          <View style={styles.gardenLogos}>
            {/* Sample garden logos - will be dynamic based on user's gardens */}
            <View style={[styles.gardenLogo, { backgroundColor: '#4ade80' }]} />
            <View style={[styles.gardenLogo, { backgroundColor: '#f472b6' }]} />
            <View style={[styles.gardenLogo, { backgroundColor: '#60a5fa' }]} />
          </View>
        </View>
        <TouchableOpacity style={styles.closeButton}>
          <Ionicons name="close" size={20} color={colors.secondaryText} />
        </TouchableOpacity>
      </View>

      {/* About Me */}
      <View style={styles.sectionContainer}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>About Me</Text>
        <Text style={[styles.bioText, { color: colors.text }]}>{USER.bio}</Text>
        
        {USER.website && (
          <TouchableOpacity 
            style={styles.websiteContainer} 
            onPress={() => Linking.openURL(USER.website)}
          >
            <Text style={[styles.websiteText, { color: '#3b82f6' }]}>{USER.website}</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Member Since */}
      <View style={styles.sectionContainer}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Member Since</Text>
        <View style={styles.memberSinceContainer}>
          <Ionicons name="leaf-outline" size={18} color={colors.secondaryText} />
          <Text style={[styles.memberSinceText, { color: colors.text }]}>{USER.memberSince}</Text>
        </View>
      </View>

      {/* Friends Section */}
      <View style={styles.sectionContainer}>
        <View style={styles.sectionTitleRow}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Your Friends</Text>
          <Ionicons name="chevron-forward" size={18} color={colors.secondaryText} />
        </View>
        
        <View style={styles.friendsContainer}>
          {USER.friends.map((friend, index) => (
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
            {USER.note || "Click to add a note"}
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
});

