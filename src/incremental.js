// Incremental sync: instead of re-scanning every .jsonl on each run, we remember
// a byte offset per file and only read the bytes appended since last time, keeping
// running absolute per-(day,model) totals in a local state file. The ingest API is
// idempotent (absolute upsert), so we push only the days that actually changed.
//
// State: ~/.tokaholics/sync-state.json
//   { offsets: { "<path>": <bytes> }, totals: { "<day>\t<model>": {...} } }

import { open, readdir, stat, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { aggregateUsage } from './parse.js';

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
async function saveState(state) {
  await mkdir(DIR, { recursive: true });
  await writeFile(STATE, JSON.stringify(state));
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
  for (const [key, t] of Object.entries(totals)) {
    if (!days || days.has(t.day)) out.push(t);
  }
  return out;
}

/**
 * @returns {Promise<{rows: Array, changedDays: number, seeded: boolean}>}
 *   rows = absolute totals for days that changed this run (ready to upsert).
 */
export async function aggregateIncremental() {
  let state = await loadState();

  // First run: seed totals from a full scan; mark every file fully read.
  if (!state || !state.totals) {
    const { rows } = await aggregateUsage({ sinceDay: null });
    const totals = {};
    for (const r of rows) totals[`${r.day}\t${r.model}`] = r;
    const offsets = {};
    for await (const f of walkJsonl(PROJECTS_DIR)) {
      offsets[f] = (await stat(f)).size;
    }
    await saveState({ offsets, totals });
    return { rows, changedDays: new Set(rows.map((r) => r.day)).size, seeded: true };
  }

  const { offsets, totals } = state;
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

      const seen = new Set();
      for (const line of complete.split('\n')) {
        if (!line || line[0] !== '{') continue;
        let obj; try { obj = JSON.parse(line); } catch { continue; }
        const msg = obj.message; const usage = msg?.usage;
        if (!usage || !msg?.id || seen.has(msg.id)) continue;
        seen.add(msg.id);
        const day = localDay(obj.timestamp); if (!day) continue;
        const model = msg.model || 'unknown';
        const key = `${day}\t${model}`;
        if (!totals[key]) totals[key] = emptyTotal(day, model);
        addUsage(totals[key], usage);
        changed.add(day);
      }
    } finally {
      await fh.close();
    }
  }

  await saveState({ offsets, totals });
  return { rows: rowsFor(totals, changed), changedDays: changed.size, seeded: false };
}

/** Drop incremental state so the next sync rebuilds from a full scan. */
export async function resetIncremental() {
  try { await writeFile(STATE, JSON.stringify({})); } catch { /* */ }
}
