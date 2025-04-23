import React, { useEffect, useState } from 'react';
import { 
  View, 
  Text, 
  FlatList, 
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Image
} from 'react-native';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from 'react-native';
import { getPendingMembershipRequests } from '@/services/garden-service';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { Ionicons } from '@expo/vector-icons';
import { format } from 'date-fns';

interface PendingMembershipProps {
  onPress?: () => void;
}

export default function PendingMemberships({ onPress }: PendingMembershipProps) {
  const [loading, setLoading] = useState(true);
  const [pendingRequests, setPendingRequests] = useState<any[]>([]);
  const { user } = useCurrentUser();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];

  useEffect(() => {
    async function fetchPendingRequests() {
      if (!user) return;
      
      try {
        setLoading(true);
        const requests = await getPendingMembershipRequests(user.id);
        setPendingRequests(requests);
      } catch (error) {
        console.error('Failed to fetch pending requests:', error);
      } finally {
        setLoading(false);
      }
    }
    
    fetchPendingRequests();
    
    // Set up refresh interval
    const interval = setInterval(fetchPendingRequests, 60000); // Refresh every minute
    return () => clearInterval(interval);
  }, [user]);

  if (loading) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="small" color={colors.primary} />
      </View>
    );
  }

  if (pendingRequests.length === 0) {
    return null; // Don't show anything if no pending requests
  }

  const formatDate = (dateString: string) => {
    try {
      return format(new Date(dateString), 'MMM d, yyyy');
    } catch (e) {
      return dateString;
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.header}>
        <Ionicons name="hourglass-outline" size={18} color={colors.primary} />
        <Text style={[styles.headerText, { color: colors.primary }]}>
          Pending Garden Requests
        </Text>
      </View>
      
      <FlatList
        data={pendingRequests}
        keyExtractor={(item) => item.garden_id}
        renderItem={({ item }) => (
          <View style={[styles.requestItem, { borderBottomColor: colors.border }]}>
            <View style={styles.gardenInfo}>
              {item.garden_logo ? (
                <Image source={{ uri: item.garden_logo }} style={styles.gardenLogo} />
              ) : (
                <View style={[styles.gardenLogo, { backgroundColor: colors.secondaryText }]}>
                  <Text style={styles.gardenInitial}>
                    {item.garden_name?.charAt(0) || '?'}
                  </Text>
                </View>
              )}
              <View style={styles.gardenDetails}>
                <Text style={[styles.gardenName, { color: colors.text }]}>
                  {item.garden_name || 'Unknown Garden'}
                </Text>
                <Text style={[styles.requestDate, { color: colors.secondaryText }]}>
                  Requested {formatDate(item.joined_at)}
                </Text>
              </View>
            </View>
            <Text style={[styles.pendingText, { color: colors.error }]}>
              PENDING
            </Text>
          </View>
        )}
        scrollEnabled={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginVertical: 8,
    borderRadius: 12,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#E1E1E1',
  },
  headerText: {
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 8,
  },
  requestItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 12,
    borderBottomWidth: 1,
  },
  gardenInfo: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  gardenLogo: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  gardenInitial: {
    fontSize: 18,
    fontWeight: '600',
    color: 'white',
  },
  gardenDetails: {
    marginLeft: 12,
  },
  gardenName: {
    fontSize: 16,
    fontWeight: '500',
  },
  requestDate: {
    fontSize: 12,
    marginTop: 2,
  },
  pendingText: {
    fontSize: 12,
    fontWeight: '600',
  },
}); 