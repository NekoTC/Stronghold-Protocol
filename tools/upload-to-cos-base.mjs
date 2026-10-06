#!/usr/bin/env node
// Upload generated public assets to Tencent COS. The game server never proxies these files.
import { readdir, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const PUBLIC = join(ROOT, 'public');
const bucket = process.env.SP_OBJECT_STORAGE_BUCKET;
const region = process.env.SP_COS_REGION || process.env.SP_OBJECT_STORAGE_REGION || 'ap-shanghai';
const prefix = (process.env.SP_OBJECT_STORAGE_PREFIX || '').replace(/^\/+|\/+$/g, '');
const base = (process.env.SP_ASSET_BASE_URL || '').replace(/\/$/, '');
const flags = new Set(process.argv.slice(2));
const dryRun = flags.has('--dry-run');
if (flags.has('--help') || flags.has('-h')) {
  console.log('Usage: npm run assets:upload -- [--dry-run]\nRequired: SP_OBJECT_STORAGE_BUCKET, SP_COS_REGION, TENCENTCLOUD_SECRET_ID, TENCENTCLOUD_SECRET_KEY\nOptional: SP_OBJECT_STORAGE_PREFIX, SP_ASSET_BASE_URL');
  process.exit(0);
}
if (!bucket) throw new Error('Set SP_OBJECT_STORAGE_BUCKET');
const accessKey = process.env.TENCENTCLOUD_SECRET_ID;
const secretKey = process.env.TENCENTCLOUD_SECRET_KEY;
if (!dryRun && (!accessKey || !secretKey)) throw new Error('Set TENCENTCLOUD_SECRET_ID and TENCENTCLOUD_SECRET_KEY, or use --dry-run');

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
  jobs.push({ file, rel, key, size: (await stat(file)).size, url: base ? `${base}/${key}` : `https://${bucket}.cos.${region}.myqcloud.com/${key}` });
}
const run = (argv, label) => new Promise((resolve, reject) => {
  if (dryRun) { console.log(`coscmd ${argv.map((x) => JSON.stringify(x)).join(' ')}`); resolve(); return; }
  const child = spawn('coscmd', argv, { cwd: ROOT, env: process.env, stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
  let err = ''; child.stderr.on('data', (b) => { err += b; });
  child.on('error', (e) => reject(new Error(`coscmd unavailable: ${e.message}`)));
  child.on('close', (code) => code === 0 ? resolve() : reject(new Error(`${label} failed (${code}): ${err.trim()}`)));
});
const destinations = [...new Set(jobs.map(({ rel }) => rel.split('/')[0]))];
if (destinations.length) {
  if (!dryRun) await run(['config', '-a', accessKey, '-s', secretKey, '-b', bucket, '-r', region], 'coscmd config');
  for (const directory of destinations) {
    const target = `${prefix ? `${prefix}/` : ''}${directory}`;
    await run(['upload', '-r', join(PUBLIC, directory), target], `coscmd upload ${directory}`);
  }
}
console.log(`${dryRun ? 'Would upload' : 'Uploaded'} ${jobs.length} files to cos://${bucket}/${prefix || '(root)'}`);
console.log(JSON.stringify({ bucket, region, prefix, baseUrl: base, files: jobs.map(({ rel, key, size, url }) => ({ rel, key, size, url })) }, null, 2));
