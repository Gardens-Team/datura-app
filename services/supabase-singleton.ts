import { createClient } from '@supabase/supabase-js';

// Read from environment variables
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.EXPO_PUBLIC_SUPABASE_KEY!;

// Create a single Supabase client for the entire app
export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true
  },
  realtime: {
    // Enable Supabase Realtime
    params: {
      eventsPerSecond: 10
    }
  }
}); 