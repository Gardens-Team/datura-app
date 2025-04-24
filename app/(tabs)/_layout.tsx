import { View, StyleSheet, TouchableOpacity, Image, Animated, Platform, Text } from 'react-native';
import { Tabs, usePathname, useRouter } from 'expo-router';
import { useColorScheme } from 'react-native';
import { Colors } from '@/constants/Colors';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCallback, useRef, useState, useEffect } from 'react';
import { TabBar } from '@/components/ui/TabBar';
import { CreateGroupModal } from '@/components/modals/CreateGroupModal';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { getGardensByUser, Garden, decryptGardenImage, getGroupKeyForGarden } from '@/services/garden-service';
import { useFocusEffect } from 'expo-router';
import { getStoredPrivateKey } from '@/utils/provisioning';

export interface UserProfile {
  id: string;
  username: string;
  profile_pic: string;
  publicKey: string;
}

const PANEL_WIDTH = 72; // Width of the server list panel
const SPRING_CONFIG = {
  damping: 15,
  mass: 0.6,
  stiffness: 150,
};

export default function TabLayout() {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const insets = useSafeAreaInsets();
  const [isOpen, setIsOpen] = useState(false);
  const translateX = useRef(new Animated.Value(0)).current;
  const pathname = usePathname();
  const isNotificationsScreen = pathname.includes('/notifications');
  const [showCreate, setShowCreate] = useState(false);
  const router = useRouter();
  const { user } = useCurrentUser();
  const [gardens, setGardens] = useState<Garden[]>([]);
  const [decryptedLogos, setDecryptedLogos] = useState<Record<string, string>>({});
  
  // Determine if we're on the profile screen
  const isProfileScreen = pathname.includes('/profile');
  
  // Hide panel when on profile screen
  useEffect(() => {
    if (isProfileScreen && isOpen) {
      Animated.spring(translateX, {
        toValue: -PANEL_WIDTH,
        useNativeDriver: true,
        ...SPRING_CONFIG,
      }).start();
      setIsOpen(false);
    }
  }, [isProfileScreen, isOpen, translateX]);

  const togglePanel = useCallback(() => {
    // Don't allow panel opening on profile screen
    if (isProfileScreen) return;
    // Or notifications screen
    if (isNotificationsScreen) return;
    
    const toValue = isOpen ? -PANEL_WIDTH : 0;
    Animated.spring(translateX, {
      toValue,
      useNativeDriver: true,
      ...SPRING_CONFIG,
    }).start();
    setIsOpen(!isOpen);
  }, [isOpen, translateX, isProfileScreen, isNotificationsScreen]);

  // Decrypt garden logos
  const decryptGardenLogos = useCallback(async (gardensToDecrypt: Garden[]) => {
    if (!gardensToDecrypt.length) return;
    
    try {
      const privateKeyBase64 = await getStoredPrivateKey();
      if (!privateKeyBase64) {
        console.error('Private key not available for logo decryption');
        return;
      }
      
      const decryptedLogoMap: Record<string, string> = {};
      
      for (const garden of gardensToDecrypt) {
        if (garden.id && garden.logo && !garden.logo.startsWith('file://')) {
          try {
            // Get the garden key for decryption
            const groupKeyBase64 = await getGroupKeyForGarden(garden.id);
            
            // Decrypt the logo
            const base64Data = await decryptGardenImage(garden.logo, groupKeyBase64);
            
            if (base64Data) {
              // Create a data URL from the base64 image
              const dataUrl = `data:image/png;base64,${base64Data}`;
              decryptedLogoMap[garden.id] = dataUrl;
            }
          } catch (error) {
            console.error(`Failed to decrypt logo for garden ${garden.id}:`, error);
          }
        }
      }
      
      setDecryptedLogos(decryptedLogoMap);
    } catch (error) {
      console.error('Error decrypting garden logos:', error);
    }
  }, []);

  const fetchGardens = useCallback(async () => {
    if (!user) return;
    try {
      const g = await getGardensByUser(user.id);
      setGardens(g);
      // Decrypt logos after fetching gardens
      decryptGardenLogos(g);
    } catch (err) {
      console.error('Failed to fetch gardens', err);
    }
  }, [user, decryptGardenLogos]);

  useFocusEffect(
    useCallback(() => {
      fetchGardens();
    }, [fetchGardens])
  );

  function refetchGardens() {
    fetchGardens();
  }

  return (
      <View style={styles.container}>
        {/* Main Content with Tabs */}
        <Animated.View 
          style={[
            styles.content,
            {
              transform: [{ translateX: isProfileScreen || isNotificationsScreen ? new Animated.Value(0) : translateX }],
              paddingBottom: 49 + insets.bottom,
              marginLeft: isProfileScreen || isNotificationsScreen ? 0 : undefined,
            }
          ]}
        >
          <Tabs
            screenOptions={{
              headerStyle: {
                backgroundColor: colors.background,
              },
              headerTintColor: colors.text,
              headerShadowVisible: false,
              tabBarStyle: { display: 'none' },
            }}
          >
            <Tabs.Screen
              name="home"
              options={{
                headerShown: false,
                headerLeft: () => (
                  <TouchableOpacity onPress={togglePanel} style={styles.headerButton}>
                    <Ionicons name="menu" size={24} color={colors.text} />
                  </TouchableOpacity>
                ),
              }}
            />
            <Tabs.Screen
              name="notifications"
              options={{
                title: 'Notifications',
                headerLeft: () => (
                  <TouchableOpacity onPress={togglePanel} style={styles.headerButton}>
                    <Ionicons name="notifications-outline" size={24} color={colors.text} />
                  </TouchableOpacity>
                ),
              }}
            />
            <Tabs.Screen
              name="profile"
              options={{
                title: 'Profile',
                headerLeft: () => null,
              }}
            />
          </Tabs>
        </Animated.View>

        {/* Left Panel - Server List */}
        {!isProfileScreen && !isNotificationsScreen && (
          <Animated.View 
            style={[
              styles.serverPanel, 
              { 
                backgroundColor: colors.surface,
                paddingTop: insets.top,
                transform: [{ translateX }]
              }
            ]}
          >
            {/* App Logo / Home Button */}
            <TouchableOpacity 
              style={[styles.serverButton, { backgroundColor: colors.primary }]}
              onPress={togglePanel}
            >
              <Image 
                source={require('@/assets/images/icon.png')}
                style={styles.logo}
              />
            </TouchableOpacity>

            <View style={[styles.serverDivider, { backgroundColor: colors.border }]} />

            {/* Gardens icons */}
            {gardens.map((g) => (
              <TouchableOpacity key={g.id} style={[styles.serverButton, { backgroundColor: colors.border }]}
                onPress={() => router.push(`/garden/${g.id}` as const)}>
                {g.id && decryptedLogos[g.id] ? (
                  <Image 
                    source={{ uri: decryptedLogos[g.id] }} 
                    style={styles.gardenIcon}
                    onError={() => {
                      console.error(`Failed to load decrypted garden logo for ${g.id}`);
                    }}
                  />
                ) : (
                  <Text style={{ color: colors.text, fontWeight: '600', fontSize: 16 }}>
                    {g.name.charAt(0).toUpperCase()}
                  </Text>
                )}
              </TouchableOpacity>
            ))}

            {/* Add new garden */}
            <TouchableOpacity
              style={[styles.serverButton, { backgroundColor: colors.border }]}
              onPress={() => setShowCreate(true)}
            >
              <Ionicons name="add-circle-outline" size={24} color={colors.text} />
            </TouchableOpacity>
          </Animated.View>
        )}

        {/* Custom Tab Bar */}
        <TabBar />

        {user && (
        <CreateGroupModal
          visible={showCreate}
          onClose={() => setShowCreate(false)}
          creatorId={user.id}
          onSuccess={() => refetchGardens()} // Define this function
        />
      )}
      </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  serverPanel: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: PANEL_WIDTH,
    alignItems: 'center',
    paddingVertical: 8,
    zIndex: 200,
  },
  content: {
    flex: 1,
    zIndex: 1,
  },
  serverButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
    marginVertical: 4,
  },
  logo: {
    width: 32,
    height: 32,
    borderRadius: 16,
  },
  serverDivider: {
    height: 2,
    width: 32,
    marginVertical: 8,
  },
  headerButton: {
    marginLeft: 16,
    padding: 8,
  },
  gardenIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
  },
});
