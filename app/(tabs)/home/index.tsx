import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  ScrollView,
  Platform,
} from 'react-native';
import { useColorScheme } from 'react-native';
import { Colors } from '@/constants/Colors';
import { Chat } from '@/components/Chat';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

export default function HomeScreen() {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const insets = useSafeAreaInsets();

  return (
    <SafeAreaView 
      style={[
        styles.container, 
        { backgroundColor: colors.background }
      ]}
      edges={['right', 'left']}
    >
      <View style={styles.content}>
        {/* Chat Component with Header */}
        <Chat />
        
        {/* Main Scrollable Content */}
        <ScrollView 
          style={styles.scrollView}
          contentContainerStyle={styles.scrollViewContent}
          showsVerticalScrollIndicator={false}
        >
          {/* Empty State */}
          <View style={styles.emptyState}>
            <Image
              source={require('@/assets/images/empty-messages.svg')}
              style={styles.emptyStateImage}
              resizeMode="contain"
            />
            <View style={styles.emptyStateTextContainer}>
              <Text style={[styles.emptyStateTitle, { color: colors.text }]}>
                No Messages Yet
              </Text>
              <Text style={[styles.emptyStateSubtitle, { color: colors.secondaryText }]}>
                Connect with friends to start chatting
              </Text>
            </View>
            <TouchableOpacity
              style={[styles.emptyStateButton, { backgroundColor: colors.primary }]}
              onPress={() => {/* TODO: Implement add friends */}}
            >
              <Ionicons name="people" size={16} color="#FFFFFF" style={styles.buttonIcon} />
              <Text style={styles.emptyStateButtonText}>Find Friends</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  scrollViewContent: {
    flexGrow: 1,
    display: 'flex',
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingTop: 20,
    paddingBottom: 180, // Account for tab bar
    minHeight: 400,
  },
  emptyStateImage: {
    width: 140,
    height: 140,
    marginBottom: 16,
    opacity: 0.9,
  },
  emptyStateTextContainer: {
    alignItems: 'center',
    marginBottom: 20,
  },
  emptyStateTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    marginBottom: 6,
    textAlign: 'center',
  },
  emptyStateSubtitle: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 18,
  },
  emptyStateButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 20,
  },
  buttonIcon: {
    marginRight: 6,
  },
  emptyStateButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
});

