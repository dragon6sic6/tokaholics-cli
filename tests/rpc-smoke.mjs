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
  ['league_standings(this week)',() => c.rpc('league_standings', { p_tz: 'Europe/Stockholm', p_offset: 0 })],
  ['league_standings(last week)',() => c.rpc('league_standings', { p_tz: 'Europe/Stockholm', p_offset: 1 })],
  ['my_stats',                   () => c.rpc('my_stats')],
  ['create_pairing_code',        () => c.rpc('create_pairing_code')],
];

let failed = 0;
for (const [name, fn] of checks) {
  const { error } = await fn();
  if (error) { console.log(`✗ ${name} — ${error.message}`); failed++; }
  else console.log(`✓ ${name}`);
}

// Group Sprint lifecycle — create → list → detail → leave (cleans up after).
try {
  const { data: sid, error: e1 } = await c.rpc('create_sprint', { p_name: 'smoke sprint', p_goal: 1000000, p_days: 7 });
  if (e1) throw e1;
  const { data: mine, error: e2 } = await c.rpc('my_sprints');
  if (e2) throw e2;
  if (!mine.some(s => s.id === sid)) throw new Error('created sprint not in my_sprints');
  const { error: e3 } = await c.rpc('sprint_detail', { p_id: sid });
  if (e3) throw e3;
  const { error: e4 } = await c.rpc('leave_sprint', { p_id: sid });
  if (e4) throw e4;
  console.log('✓ sprint lifecycle (create/list/detail/leave)');
} catch (e) {
  console.log(`✗ sprint lifecycle — ${e.message}`); failed++;
}

console.log(failed ? `\n${failed} RPC check(s) FAILED` : '\nAll RPC checks passed ✓');
process.exit(failed ? 1 : 0);
