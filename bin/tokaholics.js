#!/usr/bin/env node
// tokaholics — CLI that measures your Claude Code token burn and pushes it to
// the leaderboard. Reads ONLY usage numbers from your logs, never your code.

import { Command } from 'commander';
import { hostname, platform } from 'node:os';
import { aggregateUsage, aggregateByProject, daysAgo, today } from '../src/parse.js';
import { readConfig, writeConfig, setSecret, clearSecret } from '../src/store.js';
import { redeemPairing, pushUsage } from '../src/api.js';
import { installAgent, uninstallAgent } from '../src/daemon.js';
import { installHook, uninstallHook } from '../src/hook.js';
import { aggregateIncremental, resetIncremental } from '../src/incremental.js';

const program = new Command();
program
  .name('tokaholics')
  .description('Track your Claude Code burn. Climb the leaderboard with your friends.')
  .version('0.1.0');

const fmt = (n) => (n / 1e6).toFixed(1) + 'M';

// ── login / pairing ──────────────────────────────────────────────────────────
program
  .command('login')
  .description('Pair this machine with your Tokaholics account')
  .argument('<code>', '6-digit pairing code shown in the iOS app')
  .option('--url <url>', 'Supabase project URL (first-time setup)')
  .option('--anon <key>', 'Supabase anon key (first-time setup)')
  .action(async (code, opts) => {
    if (opts.url || opts.anon) {
      await writeConfig({
        ...(opts.url ? { supabaseUrl: opts.url } : {}),
        ...(opts.anon ? { supabaseAnon: opts.anon } : {}),
      });
    }
    const name = hostname();
    const { device_id, device_token, user_id, username } = await redeemPairing(code, name, platform());
    await setSecret(device_token);
    await writeConfig({ deviceId: device_id, userId: user_id, username });
    console.log(`✓ Paired as @${username} (device: ${name}).`);
    console.log('  Run `tokaholics start` to sync in the background, or `tokaholics sync` once.');
  });

program
  .command('setup')
  .description('One command: pair + full sync + background agent + instant hook')
  .argument('<code>', '8-char pairing code from the iOS app')
  .option('--url <url>', 'Supabase project URL (first-time setup only)')
  .option('--anon <key>', 'Supabase anon key (first-time setup only)')
  .action(async (code, opts) => {
    if (opts.url || opts.anon) {
      await writeConfig({
        ...(opts.url ? { supabaseUrl: opts.url } : {}),
        ...(opts.anon ? { supabaseAnon: opts.anon } : {}),
      });
    }
    const name = hostname();
    const { device_id, device_token, user_id, username } = await redeemPairing(code, name, platform());
    await setSecret(device_token);
    await writeConfig({ deviceId: device_id, userId: user_id, username });
    console.log(`✓ Paired as @${username} (${name}).`);

    await resetIncremental();
    const { rows, changedDays } = await aggregateIncremental();
    if (rows.length) {
      const n = await pushUsage(rows);
      const tot = rows.reduce((s, r) =>
        s + r.input_tokens + r.output_tokens + r.cache_write_tokens + r.cache_read_tokens, 0);
      console.log(`✓ Backfilled ${n} day/model rows (${fmt(tot)} tokens) across ${changedDays} days.`);
    }
    await installAgent({ intervalSec: 300 });
    console.log('✓ Background sync running (every 5 min).');
    await installHook();
    console.log('✓ Instant sync after every Claude Code session.');
    console.log('\n🔥 You are live on Tokaholics. Open the app and watch your burn.');
  });

program
  .command('logout')
  .description('Unpair this machine')
  .action(async () => {
    await clearSecret();
    await writeConfig({ deviceId: null, userId: null });
    await uninstallAgent();
    console.log('✓ Logged out and background sync removed.');
  });

// ── sync ──────────────────────────────────────────────────────────────────────
program
  .command('sync')
  .description('Incrementally parse new log lines and push changed days')
  .option('--full', 'Rebuild from a full scan of all history')
  .action(async (opts) => {
    const cfg = await readConfig();
    if (!cfg.deviceId) {
      console.error('Not paired. Run `tokaholics login <code>` first.');
      process.exit(1);
    }
    if (opts.full) await resetIncremental();
    const { rows, changedDays, seeded } = await aggregateIncremental();
    if (rows.length === 0) {
      console.log('Up to date — nothing new to push.');
      return;
    }
    const n = await pushUsage(rows);
    console.log(`✓ Pushed ${n} day/model rows (${changedDays} day(s) changed${seeded ? ', full backfill' : ''}).`);
  });

// ── local stats (no network) ───────────────────────────────────────────────────
program
  .command('stats')
  .description('Show your local burn for the last 7 days (no upload)')
  .action(async () => {
    const { rows } = await aggregateUsage({ sinceDay: daysAgo(7) });
    const byDay = {};
    for (const r of rows) {
      const t = r.input_tokens + r.output_tokens + r.cache_write_tokens + r.cache_read_tokens;
      byDay[r.day] = (byDay[r.day] || 0) + t;
    }
    console.log('Your burn (last 7 days):');
    for (const [d, t] of Object.entries(byDay).sort()) {
      const bar = '█'.repeat(Math.min(40, Math.round(t / 1e7)));
      const tag = d === today() ? '  ← today' : '';
      console.log(`  ${d}  ${fmt(t).padStart(7)}  ${bar}${tag}`);
    }
  });

program
  .command('projects')
  .description('Show your burn broken down by project (last 30 days, local)')
  .action(async () => {
    const rows = await aggregateByProject({ sinceDay: daysAgo(30) });
    if (rows.length === 0) { console.log('No usage found.'); return; }
    const max = rows[0].tokens;
    console.log('Your burn by project (last 30 days):');
    for (const r of rows.slice(0, 20)) {
      const bar = '█'.repeat(Math.max(1, Math.round((r.tokens / max) * 30)));
      console.log(`  ${fmt(r.tokens).padStart(7)}  ${bar}  ${r.project}`);
    }
  });

// ── background agent ────────────────────────────────────────────────────────────
program
  .command('start')
  .description('Install the background sync agent (launchd, every 5 min)')
  .option('--interval <sec>', 'Sync interval in seconds', '300')
  .action(async (opts) => {
    const plist = await installAgent({ intervalSec: parseInt(opts.interval, 10) });
    console.log(`✓ Background sync running. (${plist})`);
  });

program
  .command('stop')
  .description('Remove the background sync agent')
  .action(async () => {
    await uninstallAgent();
    console.log('✓ Background sync stopped.');
  });

program
  .command('install-hook')
  .description('Push usage instantly after every Claude Code session (Stop hook)')
  .action(async () => {
    const path = await installHook();
    console.log(`✓ Realtime hook installed in ${path}.`);
    console.log('  Your burn now syncs the moment each Claude Code session ends.');
  });

program
  .command('uninstall-hook')
  .description('Remove the Claude Code Stop hook')
  .action(async () => {
    await uninstallHook();
    console.log('✓ Realtime hook removed.');
  });

program
  .command('status')
  .description('Show pairing + config status')
  .action(async () => {
    const cfg = await readConfig();
    console.log('Account:   ', cfg.username ? `@${cfg.username}` : '(not paired)');
    console.log('Device id: ', cfg.deviceId || '—');
    console.log('Supabase:  ', cfg.supabaseUrl || '(default/env)');
  });

program.parseAsync();
