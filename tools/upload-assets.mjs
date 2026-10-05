#!/usr/bin/env node
// Upload generated public assets to S3-compatible object storage. The game server never proxies these files.
import { readdir, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const PUBLIC = join(ROOT, 'public');
const endpoint = process.env.SP_OBJECT_STORAGE_ENDPOINT;
const bucket = process.env.SP_OBJECT_STORAGE_BUCKET;
const prefix = (process.env.SP_OBJECT_STORAGE_PREFIX || '').replace(/^\/+|\/+$/g, '');
const base = (process.env.SP_ASSET_BASE_URL || '').replace(/\/$/, '');
const concurrency = Math.max(1, Math.min(32, Number(process.env.SP_OBJECT_STORAGE_CONCURRENCY || 8)));
const flags = new Set(process.argv.slice(2));
const dryRun = flags.has('--dry-run');
if (flags.has('--help') || flags.has('-h')) {
  console.log('Usage: npm run assets:upload -- [--dry-run]\nRequired: SP_OBJECT_STORAGE_ENDPOINT, SP_OBJECT_STORAGE_BUCKET, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY\nOptional: SP_OBJECT_STORAGE_PREFIX, SP_ASSET_BASE_URL, SP_OBJECT_STORAGE_CONCURRENCY');
  process.exit(0);
}
if (!endpoint || !bucket) throw new Error('Set SP_OBJECT_STORAGE_ENDPOINT and SP_OBJECT_STORAGE_BUCKET');
if (!dryRun && (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY)) throw new Error('Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY, or use --dry-run');

const files = [];
async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const file = join(dir, entry.name);
    if (entry.isDirectory()) await walk(file);
    else if (entry.isFile()) files.push(file);
  }
}
await walk(PUBLIC);
const jobs = [];
for (const file of files) {
  const rel = relative(PUBLIC, file).split(sep).join('/');
  if (!rel.startsWith('assets/') && !rel.startsWith('fonts/')) continue;
  const key = `${prefix ? `${prefix}/` : ''}${rel}`;
  jobs.push({ file, rel, key, size: (await stat(file)).size, url: base ? `${base}/${key}` : `${endpoint.replace(/\/$/, '')}/${bucket}/${key}` });
}
const mime = (file) => ({ '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.html': 'text/html; charset=utf-8', '.woff2': 'font/woff2', '.woff': 'font/woff', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg' }[file.slice(file.lastIndexOf('.')).toLowerCase()] || 'application/octet-stream');
const argvFor = (job) => ['s3', 'cp', job.file, `s3://${bucket}/${job.key}`, '--endpoint-url', endpoint, '--only-show-errors', '--cache-control', 'public,max-age=31536000,immutable', '--content-type', mime(job.rel)];
const run = (argv) => new Promise((resolve, reject) => {
  if (dryRun) { console.log(`aws ${argv.map((x) => JSON.stringify(x)).join(' ')}`); resolve(); return; }
  const child = spawn('aws', argv, { cwd: ROOT, stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
  let err = ''; child.stderr.on('data', (b) => { err += b; });
  child.on('error', (e) => reject(new Error(`aws CLI unavailable: ${e.message}`)));
  child.on('close', (code) => code === 0 ? resolve() : reject(new Error(`aws s3 cp failed (${code}): ${err.trim()}`)));
});
let cursor = 0;
async function worker() { while (cursor < jobs.length) { const job = jobs[cursor++]; await run(argvFor(job)); if (!dryRun) console.log(`[assets] uploaded ${job.key}`); } }
await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, worker));
console.log(`${dryRun ? 'Would upload' : 'Uploaded'} ${jobs.length} files to s3://${bucket}/${prefix}`);
console.log(JSON.stringify({ bucket, endpoint, prefix, baseUrl: base, files: jobs.map(({ rel, key, size, url }) => ({ rel, key, size, url })) }, null, 2));
