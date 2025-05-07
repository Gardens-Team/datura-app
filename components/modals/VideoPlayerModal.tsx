import React from 'react';
import { Modal, View, TouchableOpacity, Text, StyleSheet, ColorSchemeName } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Video, ResizeMode } from 'expo-av';
import { Colors } from '@/constants/Colors'; // Assuming Colors is accessible

interface VideoPlayerModalProps {
  isVisible: boolean;
  uri: string | null;
  onClose: () => void;
  onDownload: (uri: string, type: 'image' | 'video') => Promise<void>;
  colorScheme: ColorSchemeName;
}

export function VideoPlayerModal({
  isVisible,
  uri,
  onClose,
  onDownload,
  colorScheme,
}: VideoPlayerModalProps) {
  const colors = Colors[colorScheme ?? 'light'];

  if (!isVisible || !uri) {
    return null;
  }

  const handleDownloadPress = () => {
    if (uri) {
      onDownload(uri, 'video');
      onClose();
    }
  };

  return (
    <Modal visible={isVisible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <TouchableOpacity style={styles.modalClose} onPress={onClose}>
          <Ionicons name="close-circle" size={36} color="white" />
        </TouchableOpacity>

        <Video
          source={{ uri: uri }}
          style={styles.videoModalPlayer}
          useNativeControls
          resizeMode={ResizeMode.CONTAIN}
          isLooping
          shouldPlay
        />

        <TouchableOpacity
          style={styles.modalDownload}
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

const styles = StyleSheet.create({
  modalOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.9)', justifyContent: 'center', alignItems: 'center', zIndex: 1002,
  },
  videoModalPlayer: {
    width: '100%',
    height: '80%', // Adjusted height to prevent overlap
  },
  modalClose: {
    position: 'absolute',
    top: 40,
    right: 20,
    zIndex: 1003,
  },
  modalDownload: {
    position: 'absolute',
    bottom: 40,
    alignSelf: 'center',
    zIndex: 1003,
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