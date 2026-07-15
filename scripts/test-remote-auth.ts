import { createClient } from '@supabase/supabase-js';

const sb = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.VITE_SUPABASE_ANON_KEY!,
  { auth: { persistSession: false } },
);

async function run() {
  const { data, error } = await sb.auth.signInWithPassword({
    email: 'phase7-proof@vantage.test',
    password: 'TestPassword123!',
  });
  if (error) {
    console.log('AUTH FAILED:', error.message);
  } else {
    console.log('AUTH SUCCESS! User ID:', data.user?.id);
  }
}

run().catch(console.error);
