import React from 'react';
import { View, StyleSheet, TouchableOpacity, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, usePathname } from 'expo-router';

type TabPath = '/(tabs)/home' | '/(tabs)/notifications' | '/(tabs)/discover' | '/(tabs)/profile';

interface TabItem {
  name: string;
  label: string;
  icon: string;
  path: TabPath;
}

const tabs: TabItem[] = [
  {
    name: 'home',
    label: 'Home',
    icon: 'home',
    path: '/(tabs)/home',
  },
  {
    name: 'notifications',
    label: 'Notifications',
    icon: 'notifications',
    path: '/(tabs)/notifications',
  },
  {
    name: 'discover',
    label: 'Discover',
    icon: 'compass',
    path: '/(tabs)/discover',
  },
  {
    name: 'profile',
    label: 'Profile',
    icon: 'person',
    path: '/(tabs)/profile',
  },
];

export function TabBar() {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const pathname = usePathname();

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: colors.background,
          paddingBottom: insets.bottom,
          height: 49 + insets.bottom,
          borderTopColor: colors.border,
          borderTopWidth: StyleSheet.hairlineWidth,
          ...Platform.select({
            ios: {
              shadowColor: '#000',
              shadowOffset: {
                width: 0,
                height: -2,
              },
              shadowOpacity: 0.1,
              shadowRadius: 3,
            },
            android: {
              elevation: 16,
            },
          }),
        },
      ]}
    >
      {tabs.map((tab) => {
        const isActive = pathname.startsWith(tab.path);
        return (
          <TouchableOpacity
            key={tab.name}
            style={styles.tab}
            onPress={() => router.push(tab.path)}
          >
            <Ionicons
              name={tab.icon as any}
              size={24}
              color={isActive ? colors.primary : colors.secondaryText}
            />
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    zIndex: 999999,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
  },
}); 