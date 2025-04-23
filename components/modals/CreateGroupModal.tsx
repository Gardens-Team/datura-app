import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  Modal,
  ActivityIndicator,
  Image,
} from 'react-native';
import { useColorScheme } from 'react-native';
import { Colors } from '@/constants/Colors';
import { Ionicons } from '@expo/vector-icons';
import { Stepper } from '@/components/Stepper';
import { createGardenWithMembership, enableGardenBiometrics, setGardenPasscode } from '@/services/garden-service';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { useCurrentUser } from '@/hooks/useCurrentUser';

interface CreateGroupModalProps {
  visible: boolean;
  onClose: () => void;
  /**
   * UUID of the currently authenticated user. Obtained from your auth system or Supabase.
   */
  creatorId: string;
  /**
   * Callback fired after the garden has been successfully created & subscription purchased.
   */
  onSuccess?: () => void;
}

export function CreateGroupModal({ visible, onClose, creatorId, onSuccess }: CreateGroupModalProps) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const router = useRouter();

  const [currentStep, setCurrentStep] = useState(0);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [logo, setLogo] = useState<string | null>(null);
  const { user } = useCurrentUser();
  const [passcode, setPasscode] = useState('');
  const [loadingAuth, setLoadingAuth] = useState(false);

  async function pickImage() {
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: "images",
      quality: 0.8,
    });
    if (!res.canceled) {
      setLogo(res.assets[0].uri);
    }
  }

  function addTag() {
    const trimmed = tagInput.trim();
    if (trimmed && tags.length < 5 && !tags.includes(trimmed)) {
      setTags([...tags, trimmed]);
      setTagInput('');
    }
  }

  async function handleCreateGarden() {
    try {
      const { garden } = await createGardenWithMembership({
        name,
        creatorId,
        description,
        tags,
        logo: logo || undefined,
      });
      onSuccess?.();
      onClose();
      router.push(`/garden/${garden.id}` as const);
    } catch (err) {
      console.error(err);
      alert('Failed to create garden');
    }
  }

  const steps = [
    {
      title: 'Details',
      component: (
        <View>
          <Text style={[styles.label, { color: colors.text }]}>Garden Name</Text>
          <TextInput
            placeholder="My Awesome Garden"
            value={name}
            onChangeText={setName}
            placeholderTextColor={colors.secondaryText}
            style={[styles.input, { borderColor: colors.border, color: colors.text }]}
          />

          <Text style={[styles.label, { color: colors.text }]}>Description</Text>
          <TextInput
            placeholder="Describe your garden community"
            value={description}
            onChangeText={setDescription}
            placeholderTextColor={colors.secondaryText}
            style={[styles.input, { borderColor: colors.border, color: colors.text, height: 90 }]}
            multiline
          />

          <TouchableOpacity style={[styles.primaryButton, { backgroundColor: colors.primary }]} onPress={() => setCurrentStep(1)} disabled={!name.trim()}>
            <Text style={[styles.buttonText, { color: colors.accent }]}>Next</Text>
          </TouchableOpacity>
        </View>
      ),
    },
    {
      title: 'Customize',
      component: (
        <View style={styles.subscriptionContainer}>
          {/* Logo */}
          <Text style={[styles.label, { color: colors.text }]}>Logo</Text>
          <TouchableOpacity style={[styles.logoPicker, { borderColor: colors.border }]} onPress={pickImage}>
            {logo ? (
              <Image source={{ uri: logo }} style={styles.logoImage} />
            ) : (
              <Ionicons name="camera" size={32} color={colors.secondaryText} />
            )}
          </TouchableOpacity>

          {/* Tags */}
          <Text style={[styles.label, { color: colors.text }]}>Tags (max 5)</Text>
          <View style={styles.tagsContainer}>
            {tags.map((t) => (
              <View key={t} style={[styles.tagChip, { backgroundColor: colors.surface }]}>\
                <Text style={{ color: colors.text }}>{t}</Text>
                <Ionicons
                  name="close"
                  size={14}
                  color={colors.secondaryText}
                  style={styles.removeIcon}
                  onPress={() => setTags(tags.filter(tag => tag !== t))}
                />
              </View>
            ))}
          </View>
          <TextInput
            placeholder="Add tag and press enter"
            value={tagInput}
            onChangeText={setTagInput}
            onSubmitEditing={addTag}
            placeholderTextColor={colors.secondaryText}
            style={[styles.input, { borderColor: colors.border, color: colors.text }]}
          />

          <TouchableOpacity style={[styles.primaryButton, { backgroundColor: colors.primary }]} onPress={() => setCurrentStep(2)} disabled={!name.trim()}>
            <Text style={[styles.buttonText, { color: colors.accent }]}>Next</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.backButton} onPress={() => setCurrentStep(0)}>
            <Ionicons name="arrow-back" size={20} color={colors.primary} />
            <Text style={[styles.backText, { color: colors.primary }]}>Back</Text>
          </TouchableOpacity>
        </View>
      ),
    },
    {
      title: 'Security',
      component: (
        <View>
          <Text style={[styles.label, { color: colors.text }]}>Secure Your Garden Access</Text>
          <TouchableOpacity
            style={[styles.primaryButton, { backgroundColor: colors.primary }]}
            onPress={async () => {
              if (user) await enableGardenBiometrics(user.id, '');
            }}
            disabled={!user}
          >
            <Text style={[styles.buttonText, { color: colors.accent }]}>Enable Biometrics</Text>
          </TouchableOpacity>
          <TextInput
            placeholder="6-digit passcode"
            placeholderTextColor={colors.secondaryText}
            style={[styles.input, { borderColor: colors.border, color: colors.text }]}
            secureTextEntry
            keyboardType="number-pad"
            maxLength={6}
            value={passcode}
            onChangeText={setPasscode}
          />
          <TouchableOpacity
            style={[styles.primaryButton, { backgroundColor: colors.primary }]}
            onPress={async () => {
              setLoadingAuth(true);
              if (user) await setGardenPasscode(user.id, user.id, passcode);
              setLoadingAuth(false);
              setCurrentStep(3);
            }}
            disabled={passcode.length !== 6 || loadingAuth}
          >
            {loadingAuth ? <ActivityIndicator color="white" /> : <Text style={[styles.buttonText, { color: colors.accent }]}>Next</Text>}
          </TouchableOpacity>
        </View>
      ),
    },
    {
      title: 'Finish',
      component: (
        <View style={styles.subscriptionContainer}>
          <Text style={[styles.label, { color: colors.text }]}>All Set!</Text>
          <TouchableOpacity
            style={[styles.primaryButton, { backgroundColor: colors.primary }]}
            onPress={handleCreateGarden}
            disabled={!name.trim()}
          >
            <Text style={[styles.buttonText, { color: colors.accent }]}>Create Garden</Text>
          </TouchableOpacity>
        </View>
      ),
    }
  ];

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        {/* Header */}
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <TouchableOpacity onPress={onClose} style={styles.closeButton}>
            <Ionicons name="close" size={24} color={colors.text} />
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: colors.text }]}>Create Garden</Text>
          <View style={{ width: 24 }} />
        </View>

        <Stepper steps={steps} currentStep={currentStep} colors={colors} />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  closeButton: {
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
  },
  label: {
    marginTop: 24,
    marginBottom: 8,
    fontSize: 14,
    fontWeight: '500',
  },
  input: {
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
  },
  primaryButton: {
    marginTop: 32,
    paddingVertical: 16,
    borderRadius: 8,
    alignItems: 'center',
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '600',
  },
  subscriptionContainer: {
    flex: 1,
    justifyContent: 'center',
    paddingTop: 24,
  },
  subtitle: {
    fontSize: 20,
    fontWeight: '700',
    textAlign: 'center',
  },
  description: {
    fontSize: 14,
    textAlign: 'center',
    marginTop: 8,
  },
  loading: {
    marginVertical: 24,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 24,
    alignSelf: 'center',
  },
  backText: {
    marginLeft: 4,
    fontSize: 16,
    fontWeight: '500',
  },
  logoPicker: {
    width: 120,
    height: 120,
    borderRadius: 60,
    borderWidth: 2,
    borderStyle: 'dashed',
    justifyContent: 'center',
    alignItems: 'center',
    alignSelf: 'center',
    marginVertical: 12,
  },
  logoImage: {
    width: 120,
    height: 120,
    borderRadius: 60,
  },
  tagsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 8,
  },
  tagChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 16,
    marginRight: 4,
    marginBottom: 4,
  },
  removeIcon: { marginLeft: 4 },
}); 