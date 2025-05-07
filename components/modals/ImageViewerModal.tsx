import React from 'react';
import { Modal, View, Image, TouchableOpacity, Text, StyleSheet, ColorSchemeName } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '@/constants/Colors'; // Assuming Colors is accessible

interface ImageViewerModalProps {
  isVisible: boolean;
  uri: string | null;
  onClose: () => void;
  onDownload: (uri: string, type: 'image' | 'video') => Promise<void>;
  colorScheme: ColorSchemeName; // Changed to ColorSchemeName
}

export function ImageViewerModal({
  isVisible,
  uri,
  onClose,
  onDownload,
  colorScheme,
}: ImageViewerModalProps) {
  const colors = Colors[colorScheme ?? 'light']; // Get theme colors

  if (!isVisible || !uri) {
    return null;
  }

  const handleDownloadPress = () => {
    if (uri) {
      onDownload(uri, 'image');
      onClose(); // Close modal after initiating download
    }
  };

  return (
    <Modal visible={isVisible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.imageModalOverlay}>
        <TouchableOpacity style={styles.imageModalClose} onPress={onClose}>
          <Ionicons name="close-circle" size={36} color="white" />
        </TouchableOpacity>

        <Image
          source={{ uri: uri }}
          style={styles.imageModalImage}
          resizeMode="contain"
        />

        <TouchableOpacity
          style={styles.imageModalDownload}
          onPress={handleDownloadPress}
        >
          <View style={styles.modalDownloadContainer}>
            <Ionicons name="download-outline" size={24} color="white" />
            <Text style={styles.modalDownloadText}>Save</Text>
          </View>
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

// Add the styles needed for this modal (extracted from the original file)
const styles = StyleSheet.create({
  imageModalOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.9)', justifyContent: 'center', alignItems: 'center', zIndex: 1002,
  },
  imageModalImage: {
    width: '80%', height: '80%', resizeMode: 'contain',
  },
  imageModalClose: {
    position: 'absolute',
    top: 40,
    right: 20,
    zIndex: 1003,
  },
  imageModalDownload: {
    position: 'absolute',
    bottom: 40,
    // Removed left: 20 to center it maybe? Let's test this. If not, revert to left: 20
    zIndex: 1003,
    alignSelf: 'center' // Try centering the button
  },
  modalDownloadContainer: {
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    borderRadius: 20,
    paddingVertical: 8,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalDownloadText: {
    color: 'white',
    marginLeft: 8,
    fontSize: 14,
    fontWeight: '500',
  },
}); 