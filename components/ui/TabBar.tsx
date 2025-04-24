import React from 'react';
import { View, StyleSheet, TouchableOpacity, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, usePathname } from 'expo-router';

const tabs = [
  {
    name: 'home',
    label: 'Home',
    icon: 'home',
    path: '/(tabs)/home' as const,
  },
  {
    name: 'notifications',
    label: 'Notifications',
    icon: 'notifications-outline',
    path: '/(tabs)/notifications' as const,
  },
  {
    name: 'profile',
    label: 'Profile',
    icon: 'person',
    path: '/profile' as const,
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
            onPress={() => {
              if (tab.path === '/(tabs)/home' || '/notifications' || tab.path === '/profile') {
                router.push(tab.path);
              } else {
                console.error(`Invalid path: ${tab.path}`);
              }
            }}
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