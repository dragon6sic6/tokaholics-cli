// Supabase access for the CLI. The CLI authenticates with a per-device token
// (issued by `redeem-pairing-code`) and writes ONLY through the `ingest` edge
// function. It never touches the database directly and holds no service key.

import { readConfig, getSecret } from './store.js';

// Built-in defaults so a freshly-installed CLI knows where to talk.
// The publishable key is safe to embed in clients. Overridable via config/env.
const DEFAULT_URL =
  process.env.TOKAHOLICS_SUPABASE_URL || 'https://pdfuopfqhubsumcpfqdb.supabase.co';
const DEFAULT_ANON =
  process.env.TOKAHOLICS_SUPABASE_ANON || 'sb_publishable__Z3ntgU8fQGyA7s8VJlo5g_JcAjItQe';

async function endpoint() {
  const cfg = await readConfig();
  const url = cfg.supabaseUrl || DEFAULT_URL;
  const anon = cfg.supabaseAnon || DEFAULT_ANON;
  if (!url || !anon) throw new Error('Missing Supabase config (url/anon).');
  return { url, anon };
}

async function callFn(name, body) {
  const { url, anon } = await endpoint();
  const res = await fetch(`${url}/functions/v1/${name}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: anon,
      Authorization: `Bearer ${anon}`,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!res.ok) throw new Error(`${name} failed (${res.status}): ${data.error || text}`);
  return data;
}

// Redeem a 6-digit pairing code from the iOS app.
// Returns { device_id, user_id, username, device_token }.
export async function redeemPairing(code, deviceName, plat) {
  return callFn('redeem-pairing-code', {
    code,
    device_name: deviceName,
    platform: plat,
  });
}

// Idempotent upsert of absolute daily aggregates via the ingest function.
export async function pushUsage(rows) {
  const token = await getSecret();
  if (!token) throw new Error('No device token. Run `tokaholics login <code>` first.');
  const payload = rows.map((r) => ({
    day: r.day,
    model: r.model,
    input_tokens: r.input_tokens,
    output_tokens: r.output_tokens,
    cache_write_tokens: r.cache_write_tokens,
    cache_read_tokens: r.cache_read_tokens,
    message_count: r.message_count,
  }));
  const out = await callFn('ingest', { device_token: token, rows: payload });
  return out.rows;
}
