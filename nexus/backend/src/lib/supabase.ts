import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌  SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not set. Set these environment variables and restart.');
  process.exit(1);
}

export const supabase = createClient(supabaseUrl, supabaseServiceKey);
