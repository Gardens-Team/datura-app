import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  Modal,
  TextInput,
  Switch,
  Keyboard,
  Alert,
  Platform,
  Image,
  ScrollView
} from 'react-native';
import { useColorScheme } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SearchBar, Chip } from '@rneui/themed';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '@/constants/Colors';
import { supabase } from '@/services/supabase-singleton';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import * as Location from 'expo-location';
import Purchases from 'react-native-purchases';

// Dummy interests for now
const DUMMY_INTERESTS = [
  'Technology', 'Programming', 'Art', 'Music', 'Travel', 
  'Food', 'Fashion', 'Sports', 'Gaming', 'Fitness',
  'Reading', 'Writing', 'Photography', 'Film', 'Design',
  'Science', 'History', 'Politics', 'Philosophy', 'Nature'
];

interface DiscoveryPost {
  id: string;
  title: string;
  description: string;
  tags: string[];
  user_id: string;
  username?: string;
  profile_pic?: string;
  created_at: string;
  location?: {
    latitude: number;
    longitude: number;
  };
}

export default function DiscoverScreen() {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const router = useRouter();
  const { user } = useCurrentUser();
  
  // State
  const [search, setSearch] = useState('');
  const [isCreatingPost, setIsCreatingPost] = useState(false);
  const [discoveryPosts, setDiscoveryPosts] = useState<DiscoveryPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [hasProAccess, setHasProAccess] = useState(false);
  const [showPaywall, setShowPaywall] = useState(false);
  
  // Post creation state
  const [postTitle, setPostTitle] = useState('');
  const [postDescription, setPostDescription] = useState('');
  const [postTags, setPostTags] = useState<string[]>([]);
  const [includeLocation, setIncludeLocation] = useState(false);
  const [postLocation, setPostLocation] = useState<Location.LocationObject | null>(null);
  const [tagSearch, setTagSearch] = useState('');
  const [filteredTags, setFilteredTags] = useState<string[]>([]);
  
  const searchRef = useRef<any>(null);

  // Check subscription status on mount
  useEffect(() => {
    checkSubscriptionStatus();
    fetchDiscoveryPosts();
  }, []);

  // Check user's subscription status
  const checkSubscriptionStatus = async () => {
    if (!user) return;
    
    try {
      const customerInfo = await Purchases.getCustomerInfo();
      const hasAccess = customerInfo.entitlements.active.hasOwnProperty('datura_pro');
      setHasProAccess(hasAccess);
    } catch (error) {
      console.error('Error checking subscription status:', error);
    }
  };

  // Purchase subscription
  const handlePurchase = async () => {
    try {
      // Fetch available packages
      const offerings = await Purchases.getOfferings();
      
      if (offerings.current !== null && offerings.current.availablePackages.length > 0) {
        // For this example, we'll just use the first package found
        const selectedPackage = offerings.current.availablePackages[0];
        
        // Make the purchase
        const { customerInfo, productIdentifier } = await Purchases.purchasePackage(selectedPackage);
        
        // Check if the purchase was successful
        if (customerInfo.entitlements.active.hasOwnProperty('datura_pro')) {
          setHasProAccess(true);
          setShowPaywall(false);
          Alert.alert('Success', 'You now have access to Datura Pro features!');
        }
      } else {
        Alert.alert('Error', 'No offerings available');
      }
    } catch (error: any) {
      if (!error.userCancelled) {
        Alert.alert('Error', error.message);
      }
    }
  };

  // Start free trial
  const handleStartFreeTrial = async () => {
    try {
      // Fetch offerings with free trial packages
      const offerings = await Purchases.getOfferings();
      
      if (offerings.current !== null) {
        // Find a package with a free trial
        const trialPackage = offerings.current.availablePackages.find(
          pkg => pkg.packageType === Purchases.PACKAGE_TYPE.MONTHLY
        );
        
        if (trialPackage) {
          // Purchase the package with free trial
          const { customerInfo } = await Purchases.purchasePackage(trialPackage);
          
          // Check if the purchase was successful
          if (customerInfo.entitlements.active.hasOwnProperty('datura_pro')) {
            setHasProAccess(true);
            setShowPaywall(false);
            Alert.alert('Success', 'Your free trial has started!');
          }
        } else {
          Alert.alert('Error', 'No free trial packages available');
        }
      }
    } catch (error: any) {
      if (!error.userCancelled) {
        Alert.alert('Error', error.message);
      }
    }
  };

  // Fetch discovery posts
  const fetchDiscoveryPosts = async () => {
    setLoading(true);
    
    try {
      // Simple query without trying to join - since discovery already has the needed fields
      const { data, error } = await supabase
        .from('discovery')
        .select('*')
        .order('created_at', { ascending: false });
      
      if (error) {
        console.error('Error fetching discovery posts:', error);
        return;
      }
      
      // Transform the data to match our interface
      const formattedPosts: DiscoveryPost[] = data?.map((post: any) => ({
        id: post.id,
        title: post.title,
        description: post.description,
        tags: post.tags || [],
        user_id: post.user_id,
        // Use the profile_pic directly from the discovery table
        username: post.username || 'User', // Fallback if username not in discovery
        profile_pic: post.profile_pic,
        created_at: post.created_at,
        location: post.latitude && post.longitude 
          ? { latitude: post.latitude, longitude: post.longitude } 
          : undefined
      })) || [];
      
      setDiscoveryPosts(formattedPosts);
    } catch (err) {
      console.error('Error in fetchDiscoveryPosts:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  // Handle post creation
  const handleCreatePost = async () => {
    if (!user) {
      Alert.alert('Error', 'You must be logged in to create a post');
      return;
    }
    
    if (!postTitle.trim()) {
      Alert.alert('Error', 'Please enter a title for your post');
      return;
    }
    
    try {
      const newPost = {
        title: postTitle,
        description: postDescription,
        tags: postTags,
        user_id: user.id,
        latitude: includeLocation && postLocation ? postLocation.coords.latitude : null,
        longitude: includeLocation && postLocation ? postLocation.coords.longitude : null
      };
      
      // Changed from 'discovery' to 'discovery_posts'
      const { data, error } = await supabase
        .from('discovery')
        .insert(newPost)
        .select();
      
      if (error) {
        console.error('Error creating post:', error);
        Alert.alert('Error', 'Failed to create post. Please try again.');
        return;
      }
      
      // Reset form and close modal
      setPostTitle('');
      setPostDescription('');
      setPostTags([]);
      setIncludeLocation(false);
      setPostLocation(null);
      setIsCreatingPost(false);
      
      // Refresh posts
      fetchDiscoveryPosts();
      
      Alert.alert('Success', 'Your post has been created!');
    } catch (err) {
      console.error('Error in handleCreatePost:', err);
      Alert.alert('Error', 'An unexpected error occurred. Please try again.');
    }
  };

  // Request location permissions
  const requestLocationPermission = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      
      if (status !== 'granted') {
        Alert.alert('Permission Denied', 'Location permission is required to include your location.');
        setIncludeLocation(false);
        return;
      }
      
      const location = await Location.getCurrentPositionAsync({});
      setPostLocation(location);
    } catch (err) {
      console.error('Error getting location:', err);
      Alert.alert('Error', 'Failed to get location. Please try again.');
      setIncludeLocation(false);
    }
  };

  // Handle search filter
  const handleSearch = (text: string) => {
    setSearch(text);
  };

  // Filter tags when searching
  useEffect(() => {
    if (tagSearch) {
      const filtered = DUMMY_INTERESTS.filter(tag => 
        tag.toLowerCase().includes(tagSearch.toLowerCase())
      );
      setFilteredTags(filtered);
    } else {
      setFilteredTags([]);
    }
  }, [tagSearch]);

  // Add tag to post
  const addTag = (tag: string) => {
    if (!postTags.includes(tag)) {
      setPostTags([...postTags, tag]);
    }
    setTagSearch('');
    setFilteredTags([]);
  };

  // Remove tag from post
  const removeTag = (tag: string) => {
    setPostTags(postTags.filter(t => t !== tag));
  };

  // Filter posts based on search
  const filteredPosts = search 
    ? discoveryPosts.filter(post => 
        post.title.toLowerCase().includes(search.toLowerCase()) ||
        post.description.toLowerCase().includes(search.toLowerCase()) ||
        post.tags.some(tag => tag.toLowerCase().includes(search.toLowerCase()))
      )
    : discoveryPosts;

  // Handle post item press - show paywall or navigate to DM
  const handlePostPress = (post: DiscoveryPost) => {
    if (!hasProAccess) {
      setShowPaywall(true);
      return;
    }
    
    // Navigate to DM with the user
    router.push(`/dm/${post.user_id}`);
  };

  // Render post item - Improved design
  const renderPostItem = ({ item }: { item: DiscoveryPost }) => (
    <TouchableOpacity 
      style={[styles.postCard, { backgroundColor: colors.surface }]}
      onPress={() => handlePostPress(item)}
      activeOpacity={0.7}
    >
      <View style={styles.postHeader}>
        {item.profile_pic ? (
          <Image 
            source={{ uri: item.profile_pic }} 
            style={styles.profilePic} 
          />
        ) : (
          <View style={[styles.profilePic, { backgroundColor: colors.primary }]}>
            <Text style={{ color: '#fff', fontWeight: '600' }}>
              {item.username?.substring(0, 2).toUpperCase() || 'U'}
            </Text>
          </View>
        )}
        <View style={styles.postHeaderText}>
          <Text style={[styles.postTitle, { color: colors.text }]}>
            {item.title}
          </Text>
          <Text style={[styles.postUsername, { color: colors.secondaryText }]}>
            @{item.username || 'user'}
          </Text>
        </View>
        <TouchableOpacity 
          style={styles.connectButton}
          onPress={() => handlePostPress(item)}
        >
          <Ionicons name="chatbubble-outline" size={16} color={colors.primary} />
          <Text style={[styles.connectText, { color: colors.primary }]}>Connect</Text>
        </TouchableOpacity>
      </View>
      
      <Text style={[styles.postDescription, { color: colors.text }]}>
        {item.description}
      </Text>
      
      {item.tags.length > 0 && (
        <View style={styles.tagsContainer}>
          {item.tags.map(tag => (
            <Chip
              key={tag}
              title={tag}
              containerStyle={styles.chipContainer}
              titleStyle={{ fontSize: 12, color: colors.primary }}
              type="outline"
              buttonStyle={{ borderColor: colors.primary, borderWidth: 1 }}
            />
          ))}
        </View>
      )}
      
      {item.location && (
        <View style={styles.locationContainer}>
          <Ionicons name="location-outline" size={16} color={colors.secondaryText} />
          <Text style={[styles.locationText, { color: colors.secondaryText }]}>
            Location shared
          </Text>
        </View>
      )}
      
      <Text style={[styles.timeAgo, { color: colors.secondaryText }]}>
        {new Date(item.created_at).toLocaleDateString()}
      </Text>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { backgroundColor: colors.background }]}>
        <Text style={[styles.headerTitle, { color: colors.text }]}>
          Discover
        </Text>
        
        <TouchableOpacity 
          style={[styles.createButton, { backgroundColor: colors.primary }]}
          onPress={() => setIsCreatingPost(true)}
        >
          <Ionicons name="add" size={22} color="#fff" />
        </TouchableOpacity>
      </View>
      
      {/* Search Bar */}
      <View style={styles.searchWrapper}>
        <SearchBar
          ref={searchRef}
          placeholder="Search by title, description, or tags"
          onChangeText={handleSearch}
          value={search}
          platform={Platform.OS === 'ios' ? 'ios' : 'android'}
          containerStyle={[styles.searchContainer, { backgroundColor: colors.background }]}
          inputContainerStyle={[styles.searchInputContainer, { 
            backgroundColor: colors.surface,
            borderRadius: 20 
          }]}
          inputStyle={{ color: colors.text }}
          placeholderTextColor={colors.secondaryText}
          cancelButtonTitle="Cancel"
          onClear={() => setSearch('')}
        />

        {/* Category Pills */}
        <ScrollView 
          horizontal 
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.categoriesContainer}
        >
          {DUMMY_INTERESTS.slice(0, 8).map(category => (
            <TouchableOpacity 
              key={category} 
              style={[
                styles.categoryPill, 
                { 
                  backgroundColor: search === category ? colors.primary : colors.surface,
                  borderColor: colors.primary
                }
              ]}
              onPress={() => setSearch(category)}
            >
              <Text 
                style={[
                  styles.categoryText, 
                  { color: search === category ? '#fff' : colors.primary }
                ]}
              >
                {category}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>
      
      {/* Discovery Posts List */}
      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={filteredPosts}
          renderItem={renderPostItem}
          keyExtractor={item => item.id}
          contentContainerStyle={styles.listContent}
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            fetchDiscoveryPosts();
          }}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Ionicons name="search-outline" size={50} color={colors.secondaryText} />
              <Text style={[styles.emptyText, { color: colors.secondaryText }]}>
                No discovery posts found
              </Text>
            </View>
          }
        />
      )}
      
      {/* Create Post Modal */}
      <Modal
        visible={isCreatingPost}
        animationType="slide"
        transparent={false}
        onRequestClose={() => setIsCreatingPost(false)}
      >
        <SafeAreaView style={[styles.modalContainer, { backgroundColor: colors.background }]}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setIsCreatingPost(false)}>
              <Ionicons name="close-outline" size={28} color={colors.text} />
            </TouchableOpacity>
            <Text style={[styles.modalTitle, { color: colors.text }]}>
              Create Discovery Post
            </Text>
            <TouchableOpacity 
              onPress={handleCreatePost} 
              disabled={!postTitle.trim()}
              style={[styles.postButton, { opacity: postTitle.trim() ? 1 : 0.5 }]}
            >
              <Text style={styles.postButtonText}>Post</Text>
            </TouchableOpacity>
          </View>
          
          <View style={styles.modalBody}>
            <TextInput
              style={[styles.titleInput, { 
                color: colors.text, 
                borderColor: colors.border,
                backgroundColor: colors.surface
              }]}
              placeholder="Title"
              placeholderTextColor={colors.secondaryText}
              value={postTitle}
              onChangeText={setPostTitle}
              maxLength={100}
            />
            
            <TextInput
              style={[styles.descriptionInput, { 
                color: colors.text, 
                borderColor: colors.border,
                backgroundColor: colors.surface
              }]}
              placeholder="Description (optional)"
              placeholderTextColor={colors.secondaryText}
              value={postDescription}
              onChangeText={setPostDescription}
              multiline
              maxLength={500}
            />
            
            {/* Tags Section */}
            <Text style={[styles.sectionTitle, { color: colors.text }]}>
              Tags
            </Text>
            
            <View style={styles.tagsInputContainer}>
              <SearchBar
                placeholder="Search interests"
                onChangeText={setTagSearch}
                value={tagSearch}
                platform={Platform.OS === 'ios' ? 'ios' : 'android'}
                containerStyle={[styles.tagSearchContainer, { backgroundColor: colors.background }]}
                inputContainerStyle={[styles.tagSearchInputContainer, { 
                  backgroundColor: colors.surface,
                  borderRadius: 20
                }]}
                inputStyle={{ color: colors.text }}
                placeholderTextColor={colors.secondaryText}
              />
              
              {/* Selected Tags */}
              <View style={styles.selectedTagsContainer}>
                {postTags.map(tag => (
                  <Chip
                    key={tag}
                    title={tag}
                    containerStyle={styles.chipContainer}
                    onPress={() => removeTag(tag)}
                    icon={{
                      name: 'close',
                      type: 'ionicon',
                      size: 16,
                      color: colors.text
                    }}
                    type="outline"
                  />
                ))}
              </View>
              
              {/* Tag Suggestions */}
              {filteredTags.length > 0 && (
                <View style={[styles.suggestionsContainer, { backgroundColor: colors.surface }]}>
                  {filteredTags.slice(0, 5).map(tag => (
                    <TouchableOpacity 
                      key={tag} 
                      style={styles.suggestionItem}
                      onPress={() => addTag(tag)}
                    >
                      <Text style={[styles.suggestionText, { color: colors.text }]}>
                        {tag}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </View>
            
            {/* Location Toggle */}
            <View style={styles.locationToggle}>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>
                Add my location
              </Text>
              <Switch
                value={includeLocation}
                onValueChange={(value) => {
                  setIncludeLocation(value);
                  if (value && !postLocation) {
                    requestLocationPermission();
                  }
                }}
                trackColor={{ false: colors.border, true: colors.primary }}
                thumbColor="#fff"
              />
            </View>
            
            {includeLocation && postLocation && (
              <View style={styles.locationInfo}>
                <Ionicons name="location-outline" size={16} color={colors.secondaryText} />
                <Text style={[styles.locationText, { color: colors.secondaryText }]}>
                  Your location will be shared with this post
                </Text>
              </View>
            )}
          </View>
        </SafeAreaView>
      </Modal>
      
      {/* Paywall Modal */}
      <Modal
        visible={showPaywall}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowPaywall(false)}
      >
        <View style={styles.paywallOverlay}>
          <View style={[styles.paywallContainer, { backgroundColor: colors.background }]}>
            <View style={styles.paywallHeader}>
              <TouchableOpacity onPress={() => setShowPaywall(false)}>
                <Ionicons name="close-outline" size={28} color={colors.text} />
              </TouchableOpacity>
            </View>
            
            <View style={styles.paywallContent}>
              <Ionicons name="lock-closed" size={60} color={colors.primary} />
              
              <Text style={[styles.paywallTitle, { color: colors.text }]}>
                Upgrade to Datura Pro
              </Text>
              
              <Text style={[styles.paywallDescription, { color: colors.secondaryText }]}>
                Connect with users and chat securely with end-to-end encryption
              </Text>
              
              <View style={styles.paywallFeatures}>
                <View style={styles.featureItem}>
                  <Ionicons name="checkmark-circle" size={22} color={colors.success} />
                  <Text style={[styles.featureText, { color: colors.text }]}>
                    Unlimited secure chats
                  </Text>
                </View>
                
                <View style={styles.featureItem}>
                  <Ionicons name="checkmark-circle" size={22} color={colors.success} />
                  <Text style={[styles.featureText, { color: colors.text }]}>
                    Connect with users by interests
                  </Text>
                </View>
                
                <View style={styles.featureItem}>
                  <Ionicons name="checkmark-circle" size={22} color={colors.success} />
                  <Text style={[styles.featureText, { color: colors.text }]}>
                    End-to-end encrypted messages
                  </Text>
                </View>
              </View>
              
              <TouchableOpacity
                style={[styles.subscribeButton, { backgroundColor: colors.primary }]}
                onPress={handlePurchase}
              >
                <Text style={styles.subscribeButtonText}>
                  Subscribe Now
                </Text>
              </TouchableOpacity>
              
              <TouchableOpacity
                style={[styles.trialButton, { borderColor: colors.primary }]}
                onPress={handleStartFreeTrial}
              >
                <Text style={[styles.trialButtonText, { color: colors.primary }]}>
                  Start 7-Day Free Trial
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: 'bold',
  },
  createButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchWrapper: {
    marginBottom: 8,
  },
  searchContainer: {
    borderTopWidth: 0,
    borderBottomWidth: 0,
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  searchInputContainer: {
    borderRadius: 20,
  },
  listContent: {
    padding: 16,
    paddingTop: 8,
    paddingBottom: 100, // For tab bar
  },
  postCard: {
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    elevation: 2,
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.1,
    shadowRadius: 3.84,
  },
  postHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  profilePic: {
    width: 46,
    height: 46,
    borderRadius: 23,
    marginRight: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  postHeaderText: {
    flex: 1,
  },
  postTitle: {
    fontSize: 17,
    fontWeight: '600',
    marginBottom: 2,
  },
  postUsername: {
    fontSize: 12,
  },
  connectButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#8A8F82',
  },
  connectText: {
    fontSize: 12,
    fontWeight: '500',
    marginLeft: 4,
  },
  postDescription: {
    fontSize: 15,
    marginBottom: 16,
    lineHeight: 22,
    letterSpacing: 0.1,
  },
  timeAgo: {
    fontSize: 12,
    marginTop: 8,
    textAlign: 'right',
  },
  tagsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 8,
  },
  chipContainer: {
    marginRight: 8,
    marginBottom: 8,
  },
  locationContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  locationText: {
    fontSize: 12,
    marginLeft: 4,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
  },
  emptyText: {
    marginTop: 12,
    fontSize: 16,
    textAlign: 'center',
  },
  // Modal styles
  modalContainer: {
    flex: 1,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.1)',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '600',
  },
  postButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 16,
    backgroundColor: '#8A8F82',
  },
  postButtonText: {
    color: '#FFF',
    fontWeight: '600',
  },
  modalBody: {
    padding: 16,
  },
  titleInput: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    marginBottom: 16,
  },
  descriptionInput: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    fontSize: 14,
    height: 120,
    textAlignVertical: 'top',
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 12,
  },
  tagsInputContainer: {
    marginBottom: 20,
  },
  tagSearchContainer: {
    borderTopWidth: 0,
    borderBottomWidth: 0,
    padding: 0,
    marginBottom: 12,
  },
  tagSearchInputContainer: {
    borderRadius: 8,
    height: 40,
  },
  selectedTagsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 8,
  },
  suggestionsContainer: {
    borderRadius: 8,
    padding: 8,
    marginBottom: 16,
  },
  suggestionItem: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.05)',
  },
  suggestionText: {
    fontSize: 14,
  },
  locationToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  locationInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  // Paywall styles
  paywallOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  paywallContainer: {
    width: '90%',
    borderRadius: 16,
    overflow: 'hidden',
    maxHeight: '80%',
  },
  paywallHeader: {
    alignItems: 'flex-end',
    padding: 16,
  },
  paywallContent: {
    padding: 24,
    alignItems: 'center',
  },
  paywallTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    marginTop: 16,
    marginBottom: 8,
    textAlign: 'center',
  },
  paywallDescription: {
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 22,
  },
  paywallFeatures: {
    alignSelf: 'stretch',
    marginBottom: 32,
  },
  featureItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  featureText: {
    fontSize: 16,
    marginLeft: 12,
  },
  subscribeButton: {
    width: '100%',
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 12,
  },
  subscribeButtonText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '600',
  },
  trialButton: {
    width: '100%',
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    borderWidth: 1,
  },
  trialButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
  categoriesContainer: {
    paddingHorizontal: 16,
    paddingBottom: 12,
    flexDirection: 'row',
  },
  categoryPill: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    marginRight: 8,
    borderWidth: 1,
  },
  categoryText: {
    fontSize: 13,
    fontWeight: '500',
  },
});
