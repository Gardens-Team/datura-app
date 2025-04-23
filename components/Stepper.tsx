import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

interface Step {
  title: string;
  component: React.ReactNode;
}

interface StepperProps {
  steps: Step[];
  currentStep: number;
  colors: {
    text: string;
    primary: string;
    secondaryText: string;
    border: string;
  };
}

export function Stepper({ steps, currentStep, colors }: StepperProps) {
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        {steps.map((step, index) => (
          <View key={step.title} style={styles.stepIndicator}>
            <View style={[
              styles.dot,
              { 
                backgroundColor: index <= currentStep ? colors.primary : colors.secondaryText,
                borderColor: colors.border
              }
            ]} />
            <Text style={[
              styles.stepTitle,
              { 
                color: index <= currentStep ? colors.text : colors.secondaryText,
                fontWeight: index === currentStep ? '600' : '400'
              }
            ]}>
              {step.title}
            </Text>
            {index < steps.length - 1 && (
              <View style={[
                styles.line,
                { backgroundColor: index < currentStep ? colors.primary : colors.secondaryText }
              ]} />
            )}
          </View>
        ))}
      </View>
      <View style={styles.content}>
        {steps[currentStep].component}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 16,
  },
  stepIndicator: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  dot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2,
  },
  stepTitle: {
    marginLeft: 8,
    fontSize: 14,
  },
  line: {
    flex: 1,
    height: 2,
    marginHorizontal: 8,
  },
  content: {
    flex: 1,
    paddingHorizontal: 24,
  },
}); 