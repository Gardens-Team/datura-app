import { View, StyleSheet, TouchableOpacity, Image, Text } from 'react-native';
import { Tabs, usePathname, useRouter } from 'expo-router';
import { useColorScheme } from 'react-native';
import { Colors } from '@/constants/Colors';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCallback, useState, useEffect } from 'react';
import { TabBar } from '@/components/ui/TabBar';
import { CreateGroupModal } from '@/components/modals/CreateGroupModal';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { getGardensByUser, Garden, decryptGardenImage, getGroupKeyForGarden } from '@/services/garden-service';
import { useFocusEffect } from 'expo-router';
import { getStoredPrivateKeyEncryption } from '@/utils/provisioning';

// Interface for a Datura message
export interface UserProfile {
	id: string;
	username: string;
	display_name: string;
	profile_pic: string;
	publicKey: string;
	cover_photo: string;
	bio: string;
	status: string;
}

export default function TabLayout() {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const isNotificationsScreen = pathname.includes('/notifications');
  const isSettingsScreen = pathname.includes('/settings');
  const router = useRouter();
  const { user } = useCurrentUser();
  // Determine if we're on the profile screen
  const isProfileScreen = pathname.includes('/profile');

  return (
    <View style={styles.container}>
      {/* Main Content with Tabs */}
      <View style={styles.content}>
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
            }}
          />
          <Tabs.Screen
            name="notifications"
            options={{
              headerShown: false,
              title: 'Notifications',
            }}
          />
          <Tabs.Screen
            name="discover"
            options={{
              headerShown: false,
              title: 'Discover',
            }}
          />
          <Tabs.Screen
            name="profile"
            options={{
              headerShown: false,
              title: 'Profile',
            }}
          />
        </Tabs>
      </View>

      {/* Custom Tab Bar */}
      <TabBar />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
    zIndex: 1,
    paddingBottom: 49,
  },
  headerButton: {
    marginLeft: 16,
    padding: 8,
  },
});
