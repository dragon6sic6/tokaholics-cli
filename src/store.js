// Local config + secure secret storage.
//   • Non-secret config (supabase url, anon key, device_id) → ~/.tokaholics/config.json
//   • Secret device JWT → macOS Keychain via the `security` CLI (never on disk in plaintext).
//     On non-macOS we fall back to a 0600 file (documented tradeoff).

import { mkdir, readFile, writeFile, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir, platform } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const pexec = promisify(execFile);
const DIR = join(homedir(), '.tokaholics');
const CONFIG = join(DIR, 'config.json');
const KEYCHAIN_SERVICE = 'tokaholics-device-jwt';

async function ensureDir() {
  await mkdir(DIR, { recursive: true });
}

export async function readConfig() {
  try {
    return JSON.parse(await readFile(CONFIG, 'utf8'));
  } catch {
    return {};
  }
}

export async function writeConfig(patch) {
  await ensureDir();
  const cur = await readConfig();
  const next = { ...cur, ...patch };
  await writeFile(CONFIG, JSON.stringify(next, null, 2));
  await chmod(CONFIG, 0o600);
  return next;
}

// ── secret (device JWT) ──────────────────────────────────────────────────────
export async function setSecret(jwt) {
  if (platform() === 'darwin') {
    // -U updates if present. Stored in the login keychain, ACL'd to this tool.
    await pexec('security', [
      'add-generic-password', '-U',
      '-s', KEYCHAIN_SERVICE,
      '-a', 'default',
      '-w', jwt,
    ]);
  } else {
    await ensureDir();
    const f = join(DIR, '.jwt');
    await writeFile(f, jwt);
    await chmod(f, 0o600);
  }
}

export async function getSecret() {
  if (platform() === 'darwin') {
    try {
      const { stdout } = await pexec('security', [
        'find-generic-password', '-s', KEYCHAIN_SERVICE, '-a', 'default', '-w',
      ]);
      return stdout.trim();
    } catch {
      return null;
    }
  }
  try {
    return (await readFile(join(DIR, '.jwt'), 'utf8')).trim();
  } catch {
    return null;
  }
}

export async function clearSecret() {
  if (platform() === 'darwin') {
    try {
      await pexec('security', ['delete-generic-password', '-s', KEYCHAIN_SERVICE, '-a', 'default']);
    } catch { /* not found */ }
  }
}

export const paths = { DIR, CONFIG };
