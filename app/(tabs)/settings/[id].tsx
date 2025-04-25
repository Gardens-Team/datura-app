import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Image,
  FlatList,
  Modal,
  TextInput,
  Pressable,
  SafeAreaView,
} from 'react-native';
import { useLocalSearchParams, useNavigation } from 'expo-router';
import { useColorScheme } from 'react-native';
import { Colors } from '@/constants/Colors';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { supabase } from '@/services/supabase-singleton';
import { Ionicons } from '@expo/vector-icons';
import { setGardenAccessSettings } from '@/services/garden-service';

// Define an interface for Garden data (you might already have this)
interface Garden {
  id: string;
  name: string;
  access_type?: string; // Add access_type
  // Add other relevant garden properties
}

// Define interface for Member data
interface Member {
  userId: string;
  role: string;
  username: string;
  profile_pic: string | null;
}

// Define access types
type AccessType = 'invite_only' | 'request_access' | 'passcode' | 'open';
const ACCESS_TYPE_OPTIONS: { key: AccessType; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: 'invite_only', label: 'Invite Only', icon: 'mail-outline' },
  { key: 'request_access', label: 'Request to Join', icon: 'checkbox-outline' },
  { key: 'passcode', label: 'Passcode', icon: 'keypad-outline' },
  { key: 'open', label: 'Open Access', icon: 'lock-open-outline' },
];

// Helper component for Member List Item
const MemberItem = ({ item, colors }: { item: Member, colors: typeof Colors.light }) => {
  return (
    <View style={styles.memberRow}>
      <Image
        source={{ uri: item.profile_pic || 'https://via.placeholder.com/40' }}
        style={styles.memberAvatar}
      />
      <View style={styles.memberInfo}>
        <Text style={[styles.memberName, { color: colors.text }]}>{item.username}</Text>
        <Text style={[styles.memberRole, { color: colors.secondaryText }]}>{item.role}</Text>
      </View>
      {/* Add action button (e.g., manage user) if needed */}
      {/* <TouchableOpacity>...</TouchableOpacity> */}
    </View>
  );
};

export default function GardenSettingsScreen() {
  const { id: gardenId } = useLocalSearchParams<{ id: string }>();
  const { user } = useCurrentUser();
  const navigation = useNavigation();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];

  const [garden, setGarden] = useState<Garden | null>(null);
  const [currentUserRole, setCurrentUserRole] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [isMembersVisible, setIsMembersVisible] = useState(false);
  const [members, setMembers] = useState<Member[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [isAccessModalVisible, setIsAccessModalVisible] = useState(false);
  const [currentAccessType, setCurrentAccessType] = useState<AccessType>('invite_only');
  const [selectedAccessType, setSelectedAccessType] = useState<AccessType>('invite_only');
  const [passcodeInput, setPasscodeInput] = useState('');
  const [loadingAccessUpdate, setLoadingAccessUpdate] = useState(false);
  const [isMutesVisible, setIsMutesVisible] = useState(false);
  const [isBansVisible, setIsBansVisible] = useState(false);
  const [isTimeoutsVisible, setIsTimeoutsVisible] = useState(false);

  useEffect(() => {
    if (gardenId) {
      fetchGardenData();
    }
  }, [gardenId, user]);

  async function fetchGardenData() {
    setLoading(true);
    try {
      // Fetch garden details
      const { data: gardenData, error: gardenError } = await supabase
        .from('gardens')
        .select('id, name, access_type') // Add access_type
        .eq('id', gardenId)
        .single();

      if (gardenError) throw gardenError;
      setGarden(gardenData);
      setCurrentAccessType(gardenData?.access_type as AccessType || 'invite_only'); // Set current access type
      setSelectedAccessType(gardenData?.access_type as AccessType || 'invite_only'); // Initialize modal selection

      // Fetch user role in this garden
      if (user) {
        const { data: membershipData, error: membershipError } = await supabase
          .from('memberships')
          .select('role')
          .eq('garden_id', gardenId)
          .eq('user_id', user.id)
          .single();

        if (membershipError && membershipError.code !== 'PGRST116') {
          throw membershipError;
        }
        setCurrentUserRole(membershipData?.role || null);
      }
      
      // Set screen title dynamically
      if (gardenData?.name) {
         navigation.setOptions({ title: `${gardenData.name} Settings` });
      }
      
    } catch (error) {
      console.error('Error fetching garden settings data:', error);
    } finally {
      setLoading(false);
    }
  }
  
  async function fetchGardenMembers() {
    if (!gardenId || members.length > 0) return; // Don't refetch if already loaded

    setLoadingMembers(true);
    try {
      // Fetch memberships
      const { data: memberships, error: membershipError } = await supabase
        .from('memberships')
        .select('user_id, role')
        .eq('garden_id', gardenId)
        // Optionally filter out pending members if needed
        // .neq('role', 'pending'); 

      if (membershipError) throw membershipError;
      if (!memberships || memberships.length === 0) {
        setMembers([]);
        return;
      }

      // Get user IDs
      const userIds = memberships.map(m => m.user_id);

      // Fetch user details for members
      const { data: users, error: userError } = await supabase
        .from('users')
        .select('id, username, profile_pic')
        .in('id', userIds);

      if (userError) throw userError;

      // Combine data
      const memberData = memberships.map((membership) => {
        const userProfile = users?.find((u) => u.id === membership.user_id);
        return {
          userId: membership.user_id,
          role: membership.role,
          username: userProfile?.username || 'Unknown User',
          profile_pic: userProfile?.profile_pic || null,
        };
      });

      setMembers(memberData);

    } catch (error) {
      console.error('Error fetching garden members:', error);
      // Handle error display if needed
    } finally {
      setLoadingMembers(false);
    }
  }

  const isAdmin = currentUserRole === 'admin' || currentUserRole === 'creator';

  // Helper component for settings rows
  const SettingsRow = ({ title, iconName, onPress, value }: { title: string, iconName: keyof typeof Ionicons.glyphMap, onPress?: () => void, value?: string }) => (
    <TouchableOpacity style={styles.row} onPress={onPress} disabled={!onPress}>
      <View style={styles.rowLeft}>
        <Ionicons name={iconName} size={20} color={colors.primary} style={styles.icon} />
        <Text style={[styles.rowTitle, { color: colors.text }]}>{title}</Text>
      </View>
      <View style={styles.rowRight}>
        {value && <Text style={[styles.rowValue, { color: colors.secondaryText }]}>{value}</Text>}
        {onPress && <Ionicons name="chevron-forward" size={20} color={colors.secondaryText} />}
      </View>
    </TouchableOpacity>
  );

  // Handle saving access settings
  async function handleSaveAccessSettings() {
    if (!gardenId) return;

    if (selectedAccessType === 'passcode' && passcodeInput.length !== 6) {
      alert('Please enter a 6-digit passcode.'); // Use Alert for simple messages
      return;
    }

    setLoadingAccessUpdate(true);
    try {
      await setGardenAccessSettings(gardenId, {
        accessType: selectedAccessType,
        passcode: selectedAccessType === 'passcode' ? passcodeInput : undefined,
      });
      setCurrentAccessType(selectedAccessType); // Update local state on success
      setIsAccessModalVisible(false);
      setPasscodeInput(''); // Clear passcode input
      // Optionally show a success message
    } catch (error) {
      console.error('Failed to save access settings:', error);
      alert('Failed to update access settings. Please try again.');
    } finally {
      setLoadingAccessUpdate(false);
    }
  }

  // Passcode Input Components (can be extracted later)
  const PasscodeDigits = ({ count }: { count: number }) => (
    <View style={styles.passcodeDisplay}>
      {[...Array(6)].map((_, i) => (
        <View
          key={i}
          style={[
            styles.passcodeDigit,
            { borderColor: colors.primary },
            i < count && { backgroundColor: colors.primary },
          ]}
        />
      ))}
    </View>
  );

  const PasscodeKeypad = ({ onPress, onBackspace }: { onPress: (num: string) => void, onBackspace: () => void }) => {
    const numbers = [
      ['1', '2', '3'],
      ['4', '5', '6'],
      ['7', '8', '9'],
      ['', '0', 'del']
    ];

    return (
      <View style={styles.keypadContainer}>
        {numbers.map((row, rowIndex) => (
          <View key={`row-${rowIndex}`} style={styles.keypadRow}>
            {row.map((num, colIndex) => {
              const uniqueKey = num === '' 
                ? `key-empty-${rowIndex}-${colIndex}`
                : `key-${num}-${rowIndex}-${colIndex}`;

              return (
                <Pressable
                  key={uniqueKey}
                  style={({ pressed }) => [
                    styles.keypadButton,
                    { backgroundColor: pressed ? colors.border : (colorScheme === 'dark' ? '#333' : '#f0f0f0') },
                    num === '' && { backgroundColor: 'transparent' },
                  ]}
                  onPress={() => (num === 'del' ? onBackspace() : num !== '' ? onPress(num) : null)}
                  disabled={num === ''}
                >
                  {num === 'del' ? (
                    <Ionicons name="backspace-outline" size={24} color={colors.text} />
                  ) : (
                    <Text style={[styles.keypadText, { color: colors.text }]}>{num}</Text>
                  )}
                </Pressable>
              );
            })}
          </View>
        ))}
      </View>
    );
  };

  if (loading) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (!garden) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <Text style={{ color: colors.error }}>Garden not found.</Text>
      </View>
    );
  }

  return (
    <ScrollView style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Section: General */}
      <Text style={[styles.sectionHeader, { color: colors.secondaryText }]}>General</Text>
      <View style={[styles.section, { backgroundColor: colors.surface }]}>
        <SettingsRow 
          title="Members" 
          iconName="people-outline" 
          value={`${members.length} member${members.length !== 1 ? 's' : ''}`} 
          onPress={() => { 
            const shouldOpen = !isMembersVisible;
            setIsMembersVisible(shouldOpen);
            if (shouldOpen) {
              fetchGardenMembers();
            }
          }} 
        />
        {/* Collapsible Members List */}
        {isMembersVisible && (
          <View style={styles.collapsibleContent}>
            {loadingMembers ? (
              <ActivityIndicator color={colors.primary} style={{ marginVertical: 10 }}/>
            ) : members.length > 0 ? (
              <FlatList
                data={members}
                renderItem={({ item }) => <MemberItem item={item} colors={colors} />}
                keyExtractor={(item) => item.userId}
                style={styles.memberList}
                scrollEnabled={false} // Disable FlatList scrolling, rely on ScrollView
              />
            ) : (
              <Text style={[styles.emptyListText, { color: colors.secondaryText }]}>No members found.</Text>
            )}
          </View>
        )}
        <SettingsRow
          title="Access"
          iconName={ACCESS_TYPE_OPTIONS.find(opt => opt.key === currentAccessType)?.icon || 'help-circle-outline'}
          value={ACCESS_TYPE_OPTIONS.find(opt => opt.key === currentAccessType)?.label || 'Unknown'}
          onPress={() => setIsAccessModalVisible(true)}
        />
      </View>

      {/* Section: Admin Actions (Conditional) */}
      {isAdmin && (
        <>
          <Text style={[styles.sectionHeader, { color: colors.secondaryText }]}>Admin Actions</Text>
          <View style={[styles.section, { backgroundColor: colors.surface }]}>
            <SettingsRow title="Manage Mutes" iconName="mic-off-outline" onPress={() => setIsMutesVisible(!isMutesVisible)} />
            {isMutesVisible && (
              <View style={styles.collapsibleContent}>
                <Text style={[styles.emptyListText, { color: colors.secondaryText }]}>Mutes management coming soon.</Text>
              </View>
            )}
            <SettingsRow title="Manage Bans" iconName="ban-outline" onPress={() => setIsBansVisible(!isBansVisible)} />
            {isBansVisible && (
              <View style={styles.collapsibleContent}>
                <Text style={[styles.emptyListText, { color: colors.secondaryText }]}>Bans management coming soon.</Text>
              </View>
            )}
            <SettingsRow title="Timeouts" iconName="timer-outline" onPress={() => setIsTimeoutsVisible(!isTimeoutsVisible)} />
            {isTimeoutsVisible && (
              <View style={styles.collapsibleContent}>
                <Text style={[styles.emptyListText, { color: colors.secondaryText }]}>Timeouts management coming soon.</Text>
              </View>
            )}
            {/* Add other admin actions as needed */}
          </View>
        </>
      )}
      
       {/* Add more sections as needed */}

      {/* Access Settings Modal */}
      <Modal
        visible={isAccessModalVisible}
        animationType="slide"
        transparent={false} // Full screen modal
        onRequestClose={() => setIsAccessModalVisible(false)}
      >
        <SafeAreaView style={[styles.modalContainer, { backgroundColor: colors.background }]}>
          <View style={styles.modalHeader}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>Garden Access</Text>
            <TouchableOpacity onPress={() => setIsAccessModalVisible(false)}>
              <Ionicons name="close" size={24} color={colors.text} />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.modalScrollView}>
            <Text style={[styles.modalSectionHeader, { color: colors.secondaryText }]}>Access Type</Text>
            {ACCESS_TYPE_OPTIONS.map(option => (
              <TouchableOpacity
                key={option.key}
                style={[
                  styles.accessOption,
                  { borderColor: selectedAccessType === option.key ? colors.primary : colors.border },
                  selectedAccessType === option.key && { backgroundColor: colors.primary + '10' }
                ]}
                onPress={() => setSelectedAccessType(option.key)}
              >
                <Ionicons name={option.icon} size={24} color={selectedAccessType === option.key ? colors.primary : colors.text} style={{ marginRight: 12 }}/>
                <Text style={[styles.accessLabel, { color: selectedAccessType === option.key ? colors.primary : colors.text }]}>
                  {option.label}
                </Text>
              </TouchableOpacity>
            ))}

            {selectedAccessType === 'passcode' && (
              <>
                <Text style={[styles.modalSectionHeader, { color: colors.secondaryText, marginTop: 20 }]}>Set Passcode</Text>
                <Text style={[styles.passcodeInstructions, { color: colors.secondaryText }]}>
                  Enter a 6-digit passcode required to join this garden.
                </Text>
                <PasscodeDigits count={passcodeInput.length} />
                <PasscodeKeypad
                  onPress={(num) => setPasscodeInput(prev => (prev.length < 6 ? prev + num : prev))}
                  onBackspace={() => setPasscodeInput(prev => prev.slice(0, -1))}
                />
              </>
            )}
          </ScrollView>

          <View style={styles.modalFooter}>
            <TouchableOpacity
              style={[
                styles.saveButton,
                { backgroundColor: colors.primary },
                (selectedAccessType === 'passcode' && passcodeInput.length !== 6) && { opacity: 0.5 }
              ]}
              onPress={handleSaveAccessSettings}
              disabled={loadingAccessUpdate || (selectedAccessType === 'passcode' && passcodeInput.length !== 6)}
            >
              {loadingAccessUpdate ? (
                <ActivityIndicator color="white" />
              ) : (
                <Text style={styles.saveButtonText}>Save Settings</Text>
              )}
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sectionHeader: {
    marginTop: 20,
    marginBottom: 8,
    marginLeft: 16,
    fontSize: 14,
    fontWeight: '500',
    textTransform: 'uppercase',
  },
  section: {
    borderRadius: 8,
    marginHorizontal: 12,
    overflow: 'hidden',
    // Add shadow/elevation if desired
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(0,0,0,0.1)', // Use color from theme eventually
  },
  rowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  rowRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  icon: {
    marginRight: 12,
  },
  rowTitle: {
    fontSize: 16,
  },
  rowValue: {
    fontSize: 16,
    marginRight: 8,
  },
  // Styles for Members List
  collapsibleContent: {
    paddingHorizontal: 16,
    paddingBottom: 10, // Add some padding at the bottom
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(0,0,0,0.1)', // Use theme color
  },
  memberList: {
    maxHeight: 200, // Limit height to make it scrollable if needed
  },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
  },
  memberAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    marginRight: 12,
  },
  memberInfo: {
    flex: 1,
  },
  memberName: {
    fontSize: 15,
    fontWeight: '500',
  },
  memberRole: {
    fontSize: 13,
    textTransform: 'capitalize',
  },
  emptyListText: {
    textAlign: 'center',
    marginVertical: 10,
    fontSize: 14,
  },
  // Styles for Access Modal
  modalContainer: {
    flex: 1,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(0,0,0,0.1)',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '600',
  },
  modalScrollView: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 10,
  },
  modalSectionHeader: {
    marginTop: 10,
    marginBottom: 10,
    fontSize: 14,
    fontWeight: '500',
    textTransform: 'uppercase',
  },
  accessOption: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 8,
    borderWidth: 1.5,
    marginBottom: 12,
  },
  accessLabel: {
    fontSize: 16,
    fontWeight: '500',
  },
  passcodeInstructions: {
    textAlign: 'center',
    marginBottom: 10,
    fontSize: 14,
  },
  passcodeDisplay: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginVertical: 16,
  },
  passcodeDigit: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1.5,
    marginHorizontal: 6,
  },
  keypadContainer: {
    width: '100%',
    maxWidth: 280,
    alignSelf: 'center',
    marginTop: 10,
  },
  keypadRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: 12,
  },
  keypadButton: {
    width: 65,
    height: 65,
    borderRadius: 32.5,
    justifyContent: 'center',
    alignItems: 'center',
  },
  keypadText: {
    fontSize: 26,
    fontWeight: '400',
  },
  modalFooter: {
    padding: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(0,0,0,0.1)',
  },
  saveButton: {
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
});
