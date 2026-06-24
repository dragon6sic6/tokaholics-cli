// Installs a Claude Code "Stop" hook so usage is pushed immediately after every
// session ends — making friends' leaderboards update in near real-time.
//
// We edit ~/.claude/settings.json idempotently and tag our entry so it can be
// cleanly removed again. Existing hooks/settings are preserved.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const SETTINGS = join(homedir(), '.claude', 'settings.json');
const TAG = 'tokaholics'; // identifies our hook entry

function syncCommand() {
  const bin = fileURLToPath(new URL('../bin/tokaholics.js', import.meta.url));
  // Quote the path in case it contains spaces.
  return `"${process.execPath}" "${bin}" sync`;
}

async function readSettings() {
  try {
    return JSON.parse(await readFile(SETTINGS, 'utf8'));
  } catch {
    return {};
  }
}

async function writeSettings(obj) {
  await mkdir(join(homedir(), '.claude'), { recursive: true });
  await writeFile(SETTINGS, JSON.stringify(obj, null, 2));
}

function withoutOurHook(stopArray) {
  // Remove any Stop entries whose commands reference tokaholics.
  return (stopArray || []).filter((entry) => {
    const cmds = (entry.hooks || []).map((h) => h.command || '');
    return !cmds.some((c) => c.includes(TAG));
  });
}

export async function installHook() {
  const s = await readSettings();
  s.hooks = s.hooks || {};
  s.hooks.Stop = withoutOurHook(s.hooks.Stop); // de-dupe first
  s.hooks.Stop.push({
    matcher: '',
    hooks: [{ type: 'command', command: syncCommand() }],
  });
  await writeSettings(s);
  return SETTINGS;
}

export async function uninstallHook() {
  const s = await readSettings();
  if (s.hooks?.Stop) {
    s.hooks.Stop = withoutOurHook(s.hooks.Stop);
    if (s.hooks.Stop.length === 0) delete s.hooks.Stop;
    if (Object.keys(s.hooks).length === 0) delete s.hooks;
  }
  await writeSettings(s);
  return SETTINGS;
}
