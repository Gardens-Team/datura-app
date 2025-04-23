import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  Image,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import {
  enableGardenBiometrics,
  setGardenPasscode,
  acceptInvite,
} from '@/services/garden-service';
import { supabase } from '@/services/supabase-singleton';
import * as Linking from 'expo-linking';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function JoinGardenScreen() {
  const { gardenId, token } = useLocalSearchParams<{ gardenId: string; token?: string }>();
  const { user } = useCurrentUser();
  const [garden, setGarden] = useState<any>(null);
  const [step, setStep] = useState(1);
  const [passcode, setPasscode] = useState('');
  const [loading, setLoading] = useState(false);
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];

  // Fetch garden metadata
  useEffect(() => {
    async function fetchGarden() {
      const { data } = await supabase
        .from('gardens')
        .select('name, logo')
        .eq('id', gardenId)
        .single();
      setGarden(data);
    }
    fetchGarden();
  }, [gardenId]);

  // Step 1: Welcome & logos
  const Step1 = () => (
    <View style={styles.stepContainer}>
      <Text style={[styles.title, { color: colors.text }]}>You're invited!</Text>
      <View style={styles.logosRow}>
        <Image source={{ uri: user?.profile_pic || '' }} style={styles.avatar} />
        <Text style={[styles.arrow, { color: colors.text }]}>➔</Text>
        <Image source={{ uri: garden?.logo || '' }} style={styles.avatar} />
      </View>
      <Text style={[styles.subtitle, { color: colors.secondaryText }]}>Join {garden?.name}</Text>
      <TouchableOpacity
        style={[styles.button, { backgroundColor: colors.primary }]}
        onPress={() => setStep(2)}
      >
        <Text style={styles.buttonText}>Next</Text>
      </TouchableOpacity>
    </View>
  );

  // Step 2: Setup biometrics & passcode
  const Step2 = () => (
    <View style={styles.stepContainer}>
      <Text style={[styles.title, { color: colors.text }]}>Secure Your Access</Text>
      <TouchableOpacity
        style={[styles.button, { backgroundColor: colors.primary }]}
        onPress={async () => {
          if (user) await enableGardenBiometrics(gardenId, user.id);
        }}
      >
        <Text style={styles.buttonText}>Enable Biometrics</Text>
      </TouchableOpacity>
      <TextInput
        placeholder="Set a passcode"
        placeholderTextColor={colors.secondaryText}
        style={[styles.input, { color: colors.text, borderColor: colors.border }]}
        secureTextEntry
        value={passcode}
        onChangeText={setPasscode}
      />
      <TouchableOpacity
        style={[styles.button, { backgroundColor: colors.primary }]}
        onPress={async () => {
          setLoading(true);
          if (user) await setGardenPasscode(gardenId, user.id, passcode);
          setLoading(false);
          setStep(3);
        }}
        disabled={loading}
      >
        {loading ? <ActivityIndicator color="white" /> : <Text style={styles.buttonText}>Next</Text>}
      </TouchableOpacity>
    </View>
  );

  // Step 3: E2EE info & accept
  const Step3 = () => {
    const deepLink = Linking.createURL(`/join/${gardenId}`, { queryParams: { token } });
    return (
      <View style={styles.stepContainer}>
        <Text style={[styles.title, { color: colors.text }]}>Encrypted Group</Text>
        <Text style={[styles.subtitle, { color: colors.secondaryText }]}>Your messages are end-to-end encrypted.</Text>
        <TouchableOpacity
          style={[styles.button, { backgroundColor: colors.primary }]}
          onPress={async () => {
            setLoading(true);
            if (token && user) {
              await acceptInvite(token, user.id);
              router.replace(`/garden/${gardenId}` as const);
            }
          }}
        >
          <Text style={styles.buttonText}>Join Garden</Text>
        </TouchableOpacity>
      </View>
    );
  };

  // Render current step
  return (
    <View style={[styles.container, { paddingTop: insets.top, backgroundColor: colors.background }]}>      
      {step === 1 && <Step1 />}
      {step === 2 && <Step2 />}
      {step === 3 && <Step3 />}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  stepContainer: { width: '80%', alignItems: 'center' },
  title: { fontSize: 24, fontWeight: '600', marginBottom: 16 },
  subtitle: { fontSize: 16, textAlign: 'center', marginBottom: 24 },
  logosRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  avatar: { width: 64, height: 64, borderRadius: 32 },
  arrow: { marginHorizontal: 12, fontSize: 24 },
  input: { width: '100%', borderWidth: 1, borderRadius: 8, padding: 12, marginBottom: 16 },
  button: { width: '100%', padding: 12, borderRadius: 8, alignItems: 'center', marginBottom: 12 },
  buttonText: { color: 'white', fontSize: 16, fontWeight: '600' },
});
