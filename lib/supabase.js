import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://wlwotzxnzowbkbfcpnyi.supabase.co'
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Indsd290enhuem93YmtiZmNwbnlpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU4NjQ1OTEsImV4cCI6MjA5MTQ0MDU5MX0.nioXBAKA05_zRIyTpJmV_d4JY5mCYueOt5cKIlL-NNk'

export const supabase = createClient(supabaseUrl, supabaseAnonKey)