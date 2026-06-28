import Constants from 'expo-constants'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl =
  Constants.expoConfig?.extra?.supabaseUrl ||
  process.env.EXPO_PUBLIC_SUPABASE_URL

const supabaseAnonKey =
  Constants.expoConfig?.extra?.supabaseKey ||
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
