// Incremental sync: instead of re-scanning every .jsonl on each run, we remember
// a byte offset per file and only read the bytes appended since last time, keeping
// running absolute per-(day,model) totals AND a persisted set of every seen
// message.id in a local state file. The ingest API is idempotent (absolute
// upsert), so we push only the days that actually changed.
//
// The seen-id set MUST be global + persisted: the same message.id can appear in
// multiple files (resumed/branched sessions) and across a sync boundary (streaming
// duplicates straddling an offset), and double-counting is permanent under an
// absolute upsert. Deduping against one cross-run set fixes both.
//
// State: ~/.tokaholics/sync-state.json
//   { offsets: {"<path>": <bytes>}, totals: {"<day>\t<model>": {...}}, seen: ["<id>", ...] }

import { open, readdir, stat, readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createInterface } from 'node:readline';

const DIR = join(homedir(), '.tokaholics');
const STATE = join(DIR, 'sync-state.json');
const PROJECTS_DIR = join(homedir(), '.claude', 'projects');

function localDay(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

async function* walkJsonl(dir) {
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) yield* walkJsonl(full);
    else if (e.isFile() && e.name.endsWith('.jsonl')) yield full;
  }
}

async function loadState() {
  try { return JSON.parse(await readFile(STATE, 'utf8')); } catch { return null; }
}
async function saveState({ offsets, totals, seen }) {
  await mkdir(DIR, { recursive: true });
  const tmp = STATE + '.tmp';
  await writeFile(tmp, JSON.stringify({ offsets, totals, seen: [...seen] }));
  await rename(tmp, STATE);   // atomic: never leave a half-written state file
}

function emptyTotal(day, model) {
  return { day, model, input_tokens: 0, output_tokens: 0,
           cache_write_tokens: 0, cache_read_tokens: 0, message_count: 0 };
}
function addUsage(t, usage) {
  t.input_tokens       += usage.input_tokens || 0;
  t.output_tokens      += usage.output_tokens || 0;
  t.cache_write_tokens += usage.cache_creation_input_tokens || 0;
  t.cache_read_tokens  += usage.cache_read_input_tokens || 0;
  t.message_count      += 1;
}
function rowsFor(totals, days) {
  const out = [];
  for (const t of Object.values(totals)) {
    if (!days || days.has(t.day)) out.push(t);
  }
  return out;
}

// Apply one assistant-usage line to totals + seen (global dedupe). Returns the
// day it touched, or null.
function applyLine(line, totals, seen) {
  if (!line || line[0] !== '{') return null;
  let obj; try { obj = JSON.parse(line); } catch { return null; }
  const msg = obj.message; const usage = msg?.usage;
  if (!usage || !msg?.id || seen.has(msg.id)) return null;
  seen.add(msg.id);
  const day = localDay(obj.timestamp); if (!day) return null;
  const key = `${day}\t${msg.model || 'unknown'}`;
  if (!totals[key]) totals[key] = emptyTotal(day, msg.model || 'unknown');
  addUsage(totals[key], usage);
  return day;
}

// First-run seed: a full streaming scan that records totals + the global seen set
// + per-file offsets (so subsequent runs only read appended bytes).
async function seed() {
  const totals = {}; const seen = new Set(); const offsets = {};
  for await (const file of walkJsonl(PROJECTS_DIR)) {
    const rl = createInterface({
      input: createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
    for await (const line of rl) applyLine(line, totals, seen);
    offsets[file] = (await stat(file)).size;
  }
  await saveState({ offsets, totals, seen });
  return { rows: rowsFor(totals, null), changedDays: new Set(Object.values(totals).map((t) => t.day)).size, seeded: true };
}

/**
 * @returns {Promise<{rows: Array, changedDays: number, seeded: boolean}>}
 *   rows = absolute totals for days that changed this run (ready to upsert).
 */
export async function aggregateIncremental() {
  const state = await loadState();
  if (!state || !state.totals || !Array.isArray(state.seen)) return seed();

  const { offsets, totals } = state;
  const seen = new Set(state.seen);
  const changed = new Set();

  for await (const file of walkJsonl(PROJECTS_DIR)) {
    const size = (await stat(file)).size;
    let offset = offsets[file] || 0;
    if (size < offset) offset = 0;          // file truncated/rotated → re-read
    if (size <= offset) continue;           // nothing new

    const fh = await open(file, 'r');
    try {
      const len = size - offset;
      const buf = Buffer.alloc(len);
      await fh.read(buf, 0, len, offset);
      const text = buf.toString('utf8');
      const lastNL = text.lastIndexOf('\n');
      if (lastNL === -1) continue;          // no complete line yet
      const complete = text.slice(0, lastNL + 1);
      offsets[file] = offset + Buffer.byteLength(complete, 'utf8');
      for (const line of complete.split('\n')) {
        const day = applyLine(line, totals, seen);
        if (day) changed.add(day);
      }
    } finally {
      await fh.close();
    }
  }

  await saveState({ offsets, totals, seen });
  return { rows: rowsFor(totals, changed), changedDays: changed.size, seeded: false };
}

/** Drop incremental state so the next sync rebuilds from a full scan. */
export async function resetIncremental() {
  try { await writeFile(STATE, JSON.stringify({})); } catch { /* */ }
}
