import { createClient } from '@supabase/supabase-js';

const supabaseUrl =
  import.meta.env.VITE_SUPABASE_URL ||
  'https://gtqjhlknpqobfdnsciid.supabase.co';

const supabaseAnonKey =
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd0cWpobGtucHFvYmZkbnNjaWlkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI1OTQ4ODUsImV4cCI6MjA4ODE3MDg4NX0.44nVoOojTZdJmMK3tZDHkiyqsW3PVGGszTOApnQ8p-k';

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    storageKey: 'nexus-auth',
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
