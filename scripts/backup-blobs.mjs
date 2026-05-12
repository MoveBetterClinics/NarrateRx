#!/usr/bin/env node
/**
 * Backup NarrateRx media to local disk.
 *
 * Sources every URL from the database (media_assets table) rather than
 * Vercel Blob list(), because the originals are spread across multiple
 * legacy blob stores (one per retired per-brand project) that the current
 * BLOB_READ_WRITE_TOKEN can't list. Public blob URLs don't need a token
 * to read, so we just fetch each one.
 *
 * Usage: npm run backup:blobs
 * Requires: MULTITENANT_DATABASE_URL in .env.local
 */

import pg from 'pg';
import { createWriteStream, mkdirSync, existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { pipeline } from 'stream/promises';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import os from 'os';

// ---------------------------------------------------------------------------
// Load .env.local
// ---------------------------------------------------------------------------
const repoRoot = join(fileURLToPath(import.meta.url), '..', '..');
const envPath = join(repoRoot, '.env.local');

if (!existsSync(envPath)) {
  console.error('ERROR: .env.local not found.');
  process.exit(1);
}

for (const line of readFileSync(envPath, 'utf8').split('\n')) {
  const t = line.trim();
  if (!t || t.startsWith('#')) continue;
  const eq = t.indexOf('=');
  if (eq < 0) continue;
  const k = t.slice(0, eq).trim();
  const v = t.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '');
  if (!(k in process.env)) process.env[k] = v;
}

const dbUrl = process.env.MULTITENANT_DATABASE_URL;
if (!dbUrl) {
  console.error('ERROR: MULTITENANT_DATABASE_URL not set in .env.local');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------
const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19) + 'Z';
const backupDir = join(os.homedir(), 'Backups', 'narraterx-blobs', timestamp);
mkdirSync(backupDir, { recursive: true });

// ---------------------------------------------------------------------------
// Parse DB URL (password may contain special chars)
// ---------------------------------------------------------------------------
const stripped = dbUrl.replace(/^postgres(ql)?:\/\//, '');
const lastAt = stripped.lastIndexOf('@');
const auth = stripped.slice(0, lastAt);
const hostPart = stripped.slice(lastAt + 1);
const colon = auth.indexOf(':');
const user = auth.slice(0, colon);
const pwd = auth.slice(colon + 1);
const [hostport, dbAndQ = 'postgres'] = hostPart.split('/');
const [host, port = '5432'] = hostport.split(':');
const db = (dbAndQ || 'postgres').split('?')[0] || 'postgres';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function urlToLocalPath(u, destDir) {
  const parsed = new URL(u);
  // Group by store hostname so multiple legacy stores don't collide on path.
  const storeId = parsed.host.split('.')[0];
  const pathname = parsed.pathname.replace(/^\//, '');
  return join(destDir, storeId, pathname);
}

async function downloadUrl(u, destDir) {
  const localPath = urlToLocalPath(u, destDir);
  mkdirSync(dirname(localPath), { recursive: true });
  const res = await fetch(u);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  await pipeline(res.body, createWriteStream(localPath));
  return localPath;
}

function fmtBytes(n) {
  if (n >= 1_073_741_824) return (n / 1_073_741_824).toFixed(1) + ' GB';
  if (n >= 1_048_576)     return (n / 1_048_576).toFixed(1) + ' MB';
  if (n >= 1_024)         return (n / 1_024).toFixed(1) + ' KB';
  return n + ' B';
}

// ---------------------------------------------------------------------------
// Main: pull URLs from DB
// ---------------------------------------------------------------------------
const { Client } = pg;
const client = new Client({
  host, port: Number(port), user, password: pwd, database: db,
  ssl: { rejectUnauthorized: false },
});
await client.connect();

console.log('→ Querying media_assets ...');
const { rows } = await client.query(`
  SELECT blob_url, mime_type
  FROM media_assets
  WHERE blob_url IS NOT NULL
  ORDER BY created_at
`);
await client.end();

// Tally by store
const byHost = {};
for (const r of rows) {
  const h = new URL(r.blob_url).host.split('.')[0];
  byHost[h] = (byHost[h] || 0) + 1;
}
console.log(`  Found ${rows.length} URLs across ${Object.keys(byHost).length} blob store(s):`);
for (const [h, n] of Object.entries(byHost)) console.log(`    ${h}: ${n}`);

console.log(`\n→ Downloading to ${backupDir} ...\n`);

let done = 0;
let errors = 0;
const errorLog = [];
const CONCURRENCY = 8;

for (let i = 0; i < rows.length; i += CONCURRENCY) {
  const batch = rows.slice(i, i + CONCURRENCY);
  await Promise.all(
    batch.map(async row => {
      try {
        await downloadUrl(row.blob_url, backupDir);
        done++;
      } catch (err) {
        errors++;
        errorLog.push(`${err.message}\t${row.blob_url}`);
      }
      process.stdout.write(`\r  ${done + errors}/${rows.length} files  (${errors} errors)`);
    })
  );
}

console.log(`\n\n✓ Done. ${done}/${rows.length} downloaded${errors ? `, ${errors} errors` : ''}.`);
console.log(`  Saved to: ${backupDir}`);

if (errors > 0) {
  const errPath = join(backupDir, '_errors.log');
  await pipeline(
    (async function*() { for (const line of errorLog) yield line + '\n'; })(),
    createWriteStream(errPath)
  );
  console.log(`  Error log: ${errPath}`);
}

try {
  const du = execSync(`du -sh "${backupDir}"`).toString().split('\t')[0];
  console.log(`  Total size on disk: ${du}`);
} catch { /* ignore */ }

console.log('\nReminder: copy this snapshot off-machine (iCloud, external drive, etc.)');
console.log(`  cp -r "${backupDir}" ~/Library/Mobile\\ Documents/com~apple~CloudDocs/Backups/  # iCloud example`);
