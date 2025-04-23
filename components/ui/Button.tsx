import React from 'react';
import { TouchableOpacity, Text, StyleSheet, TouchableOpacityProps, ActivityIndicator, ViewStyle, TextStyle } from 'react-native';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from 'react-native';

interface ButtonProps extends TouchableOpacityProps {
  variant?: 'default' | 'destructive' | 'outline' | 'secondary' | 'ghost' | 'link';
  size?: 'default' | 'sm' | 'lg' | 'icon';
  children: React.ReactNode;
  isLoading?: boolean;
}

export function Button({ 
  variant = 'default', 
  size = 'default', 
  children, 
  style,
  isLoading,
  disabled,
  ...props 
}: ButtonProps) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];

  const getVariantStyle = (): ViewStyle => {
    switch (variant) {
      case 'destructive':
        return {
          backgroundColor: colors.error,
          borderWidth: 0,
        };
      case 'outline':
        return {
          backgroundColor: 'transparent',
          borderWidth: 1,
          borderColor: colors.border,
        };
      case 'secondary':
        return {
          backgroundColor: colors.surface,
          borderWidth: 0,
        };
      case 'ghost':
        return {
          backgroundColor: 'transparent',
          borderWidth: 0,
        };
      case 'link':
        return {
          backgroundColor: 'transparent',
          borderWidth: 0,
          paddingVertical: 0,
          paddingHorizontal: 0,
        };
      default:
        return {
          backgroundColor: colors.primary,
          borderWidth: 0,
        };
    }
  };

  const getSizeStyle = (): ViewStyle => {
    switch (size) {
      case 'sm':
        return {
          paddingVertical: 8,
          paddingHorizontal: 12,
        };
      case 'lg':
        return {
          paddingVertical: 16,
          paddingHorizontal: 24,
        };
      case 'icon':
        return {
          width: 40,
          height: 40,
          padding: 8,
        };
      default:
        return {
          paddingVertical: 12,
          paddingHorizontal: 16,
        };
    }
  };

  const getTextStyle = (): TextStyle => {
    const baseStyle: TextStyle = {
      textAlign: 'center',
      fontSize: size === 'sm' ? 14 : size === 'lg' ? 16 : 15,
      fontWeight: '500',
    };

    switch (variant) {
      case 'destructive':
        return { ...baseStyle, color: colors.error };
      case 'outline':
        return { ...baseStyle, color: colors.text };
      case 'secondary':
        return { ...baseStyle, color: colors.surface };
      case 'ghost':
      case 'link':
        return { ...baseStyle, color: colors.text };
      default:
        return { ...baseStyle, color: colors.accent };
    }
  };

  const buttonStyles = [
    styles.button,
    getVariantStyle(),
    getSizeStyle(),
    disabled && styles.disabled,
    style,
  ];

  const textStyles = getTextStyle();

  return (
    <TouchableOpacity
      style={buttonStyles}
      disabled={disabled || isLoading}
      {...props}
    >
      {isLoading ? (
        <ActivityIndicator color={textStyles.color} />
      ) : (
        typeof children === 'string' ? (
          <Text style={textStyles}>{children}</Text>
        ) : (
          children
        )
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabled: {
    opacity: 0.5,
  },
}); 