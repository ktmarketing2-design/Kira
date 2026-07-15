import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

async function run() {
  const userId = 'a9a3d8fe-5178-4949-9fbf-14e3eadd47c0';
  const { data, error } = await supabase.auth.admin.updateUserById(userId, {
    password: 'TestPassword123!',
  });
  if (error) {
    console.error('Password reset failed:', error.message);
  } else {
    console.log('Password reset successful for user:', data.user?.email);
  }
}

run().catch(console.error);
