// Installs the CLI as a macOS launchd agent so usage syncs in the background
// even after reboot. Runs `tokaholics sync` on an interval.

import { writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir, platform } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const pexec = promisify(execFile);
const LABEL = 'ai.tokaholics.sync';
const PLIST = join(homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);

function binPath() {
  // Absolute path to bin/tokaholics.js inside this package.
  return fileURLToPath(new URL('../bin/tokaholics.js', import.meta.url));
}

export async function installAgent({ intervalSec = 300 } = {}) {
  if (platform() !== 'darwin') {
    throw new Error('Background agent is macOS-only for now. Use `tokaholics sync` via cron on Linux.');
  }
  await mkdir(join(homedir(), 'Library', 'LaunchAgents'), { recursive: true });
  const node = process.execPath;
  const logDir = join(homedir(), '.tokaholics');
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${node}</string>
    <string>${binPath()}</string>
    <string>sync</string>
  </array>
  <key>StartInterval</key><integer>${intervalSec}</integer>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>${join(logDir, 'sync.log')}</string>
  <key>StandardErrorPath</key><string>${join(logDir, 'sync.err.log')}</string>
</dict>
</plist>`;
  await writeFile(PLIST, plist);
  // Reload if already loaded.
  try { await pexec('launchctl', ['unload', PLIST]); } catch { /* not loaded */ }
  await pexec('launchctl', ['load', PLIST]);
  return PLIST;
}

export async function uninstallAgent() {
  if (platform() !== 'darwin') return;
  try { await pexec('launchctl', ['unload', PLIST]); } catch { /* */ }
  try { await rm(PLIST); } catch { /* */ }
}
