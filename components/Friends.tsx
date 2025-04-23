import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Platform,
} from 'react-native';
import { useColorScheme } from 'react-native';
import { Colors } from '@/constants/Colors';
import { Ionicons } from '@expo/vector-icons';
import { AddFriendsModal } from '@/components/modals/AddFriendsModal';

export function Friends() {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const [showAddFriendsModal, setShowAddFriendsModal] = useState(false);

  return (
    <View 
      style={[
        styles.container,
        {
          backgroundColor: colors.background,
          borderBottomColor: colors.border,
        }
      ]}
    >
      <View style={styles.headerRow}>
        <Text style={[styles.header, { color: colors.text }]}>Messages</Text>
        <TouchableOpacity 
          style={[styles.searchButton, { backgroundColor: colors.surface }]}
          onPress={() => {/* TODO: Implement search */}}
        >
          <Ionicons name="search" size={20} color={colors.secondaryText} />
        </TouchableOpacity>
      </View>
      <TouchableOpacity 
        style={[styles.addFriendsButton, { backgroundColor: colors.surface }]}
        onPress={() => setShowAddFriendsModal(true)}
      >
        <Ionicons name="person-add" size={20} color="#000000" style={styles.iconStyle} />
        <Text style={styles.addFriendsText}>
          Add Friends
        </Text>
      </TouchableOpacity>

      {/* Add Friends Modal */}
      <AddFriendsModal
        visible={showAddFriendsModal}
        onClose={() => setShowAddFriendsModal(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 16,
    paddingTop: 0,
    paddingBottom: 8,
    zIndex: 1,
    borderBottomWidth: StyleSheet.hairlineWidth,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: {
          width: 0,
          height: 2,
        },
        shadowOpacity: 0.1,
        shadowRadius: 2,
      },
      android: {
        elevation: 3,
      },
    }),
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 0,
    paddingBottom: 2,
  },
  header: {
    fontSize: 24,
    fontWeight: 'bold',
    letterSpacing: -0.5,
  },
  searchButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addFriendsButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    height: 38,
    width: '100%',
    borderRadius: 6,
    marginTop: 6,
    marginBottom: 2,
  },
  addFriendsText: {
    fontSize: 15,
    fontWeight: '500',
    color: '#000000',
  },
  iconStyle: {
    marginRight: 4,
  }
}); 