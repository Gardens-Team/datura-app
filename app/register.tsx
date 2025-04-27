import React, { useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from 'react-native';
import { router } from 'expo-router';
import { Stepper } from '@/components/Stepper';
import { UsernameStep } from '@/components/registration/UsernameStep';
import { ProfilePicStep } from '@/components/registration/ProfilePicStep';
import { SecurityStep } from '@/components/registration/SecurityStep';
import { PasscodeStep } from '@/components/registration/PasscodeStep';

interface UserData {
  username: string;
  profilePic: string | null;
  passwordHash?: string;
  publicKeyEncryption?: string;
  publicKeySigning?: string;
}

interface SecurityStepProps {
  onComplete: () => void;
  onBack: () => void;
  username: string;
  profilePic: string;
  passwordHash: string;
  tokenStr?: string;
}

export default function RegisterScreen() {
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const [currentStep, setCurrentStep] = useState(0);
  const [userData, setUserData] = useState<UserData>({
    username: '',
    profilePic: null
  });

  const steps = [
    {
      title: 'Choose Username',
      component: <UsernameStep 
        onNext={(username) => {
          setUserData(prev => ({ ...prev, username }));
          setCurrentStep(1);
        }}
      />
    },
    {
      title: 'Profile Picture',
      component: <ProfilePicStep 
        onNext={(profilePic) => {
          setUserData(prev => ({ ...prev, profilePic }));
          setCurrentStep(2);
        }}
        onBack={() => setCurrentStep(0)}
      />
    },
    {
      title: 'Security Setup',
      component: <SecurityStep 
        username={userData.username}
        profilePic={userData.profilePic || ''}
        passwordHash={userData.passwordHash || ''}
        publicKeyEncryption={userData.publicKeyEncryption || ''}
        publicKeySigning={userData.publicKeySigning || ''}
        onComplete={() => setCurrentStep(3)}
        onBack={() => setCurrentStep(1)}
      />
    },
    {
      title: 'Set Passcode',
      component: <PasscodeStep 
        onComplete={(passwordHash) => {
          setUserData(prev => ({ ...prev, passwordHash }));
          // Don't navigate yet, go back to security step with the hash
          setCurrentStep(2);
        }}
        onBack={() => setCurrentStep(2)}
      />
    }
  ];

  return (
    <View style={[styles.container, { paddingTop: insets.top, backgroundColor: colors.background }]}>
      <Stepper
        steps={steps}
        currentStep={currentStep}
        colors={colors}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  }
}); 