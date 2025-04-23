import React from 'react';
import { Image, StyleSheet, ImageStyle } from 'react-native';

interface LogoProps {
  size?: number;
  style?: ImageStyle;
}

export default function Logo({ size = 120, style }: LogoProps) {
  return (
    <Image
      source={require('@/assets/images/icon.png')}
      style={[
        styles.logo,
        {
          width: size,
          height: size,
        },
        style,
      ]}
      resizeMode="contain"
    />
  );
}

const styles = StyleSheet.create({
  logo: {
    width: '100%',
    height: '100%',
  },
}); 