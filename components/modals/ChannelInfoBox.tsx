import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated, // Keep Animated if needed, but not used in this simple version
  ColorSchemeName,
  Pressable, // Use Pressable for the overlay
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '@/constants/Colors';

interface ChannelInfoBoxProps {
  isVisible: boolean;
  onClose: () => void;
  position: { top: number; right: number };
  colorScheme: ColorSchemeName;
}

export function ChannelInfoBox({
  isVisible,
  onClose,
  position,
  colorScheme,
}: ChannelInfoBoxProps) {
  const colors = Colors[colorScheme ?? 'light'];

  if (!isVisible) {
    return null;
  }

  return (
    // Use Pressable for the full overlay to catch taps outside the box
    <Pressable style={styles.infoBoxOverlay} onPress={onClose}>
      <View
        style={[
          styles.infoBox,
          {
            backgroundColor: colorScheme === 'dark' ? '#2C2C2E' : '#FFFFFF',
            top: position.top,
            right: position.right,
          },
        ]}
        // Prevent taps inside the box from closing it
        onTouchStart={(e) => e.stopPropagation()}
      >
        <View style={styles.infoBoxHeader}>
          <Ionicons name="lock-closed" size={18} color={colors.primary} />
          <Text style={[styles.infoBoxTitle, { color: colors.text }]}>
            End-to-End Encrypted
          </Text>
        </View>

        <Text style={[styles.infoBoxText, { color: colors.text }]}>
          Messages in this channel are end-to-end encrypted. Only members of this garden can read them.
        </Text>

        <Text style={[styles.infoBoxText, { color: colors.secondaryText, fontSize: 12, marginTop: 4 }]}>
          Encryption keys are stored locally on your device.
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  infoBoxOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 1000,
    backgroundColor: 'transparent', // Overlay is transparent
  },
  infoBox: {
    position: 'absolute',
    width: 250,
    borderRadius: 12,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
    zIndex: 1001,
  },
  infoBoxHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  infoBoxTitle: {
    fontSize: 15,
    fontWeight: '600',
    marginLeft: 8,
  },
  infoBoxText: {
    fontSize: 13,
    lineHeight: 18,
    // marginBottom: 8, // Removed default margin
  },
});
