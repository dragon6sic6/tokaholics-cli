// RPC smoke test — calls every RPC the iOS app depends on and fails loudly if
// any is missing or errors. Run after schema changes to catch "dead feature"
// regressions (e.g. an app tab that calls an RPC that was never migrated).
//
//   node tests/rpc-smoke.mjs
//
// Uses the seeded dev account. (Remove this account for production; this test is
// dev-only tooling.)

import { createClient } from '@supabase/supabase-js';

const URL = process.env.TOKAHOLICS_SUPABASE_URL || 'https://pdfuopfqhubsumcpfqdb.supabase.co';
const ANON = process.env.TOKAHOLICS_SUPABASE_ANON || 'sb_publishable__Z3ntgU8fQGyA7s8VJlo5g_JcAjItQe';
const EMAIL = process.env.SMOKE_EMAIL || 'mathias@tokaholics.dev';
const PASSWORD = process.env.SMOKE_PASSWORD || 'tokaholics123';

const c = createClient(URL, ANON, { auth: { persistSession: false } });

const { error: authErr } = await c.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
if (authErr) { console.error('AUTH FAIL:', authErr.message); process.exit(1); }

const checks = [
  ['leaderboard(friends/today,tz)', () => c.rpc('leaderboard', { p_days: 1, p_scope: 'friends', p_tz: 'Pacific/Honolulu' })],
  ['leaderboard(global/week)',   () => c.rpc('leaderboard', { p_days: 7, p_scope: 'global' })],
  ['current_streak(tz)',         () => c.rpc('current_streak', { p_tz: 'Pacific/Honolulu' })],
  ['current_streak(default)',    () => c.rpc('current_streak')],
  ['my_stats',                   () => c.rpc('my_stats')],
  ['create_pairing_code',        () => c.rpc('create_pairing_code')],
];

let failed = 0;
for (const [name, fn] of checks) {
  const { error } = await fn();
  if (error) { console.log(`✗ ${name} — ${error.message}`); failed++; }
  else console.log(`✓ ${name}`);
}

console.log(failed ? `\n${failed} RPC check(s) FAILED` : '\nAll RPC checks passed ✓');
process.exit(failed ? 1 : 0);
