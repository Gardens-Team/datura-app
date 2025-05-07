import React from 'react';
import { Modal, View, Text, ActivityIndicator, StyleSheet, ColorSchemeName } from 'react-native';
import { Colors } from '@/constants/Colors'; // Assuming Colors is accessible

interface DownloadProgressModalProps {
  isVisible: boolean;
  colorScheme: ColorSchemeName;
}

export function DownloadProgressModal({ isVisible, colorScheme }: DownloadProgressModalProps) {
  const colors = Colors[colorScheme ?? 'light'];

  if (!isVisible) {
    return null;
  }

  return (
    <Modal visible={isVisible} transparent animationType="fade">
      <View style={styles.downloadProgressOverlay}>
        <View style={[styles.downloadProgressContent, { backgroundColor: colors.background }]}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={[styles.downloadProgressText, { color: colors.text }]}>
            Downloading...
          </Text>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  downloadProgressOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1005,
  },
  downloadProgressContent: {
    padding: 30, // Increased padding
    borderRadius: 10,
    alignItems: 'center', // Center items inside the box
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
    zIndex: 1006,
  },
  downloadProgressText: {
    fontSize: 16,
    fontWeight: '600',
    marginTop: 15, // Added space between indicator and text
  },
}); 