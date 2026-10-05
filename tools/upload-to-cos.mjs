#!/usr/bin/env node
// Upload assets, fonts, and data files to Tencent COS for CDN delivery.
import { readdir, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const PUBLIC = join(ROOT, 'public');
const DATA = join(ROOT, 'data');
const bucket = process.env.SP_OBJECT_STORAGE_BUCKET;
const region = process.env.SP_COS_REGION || process.env.SP_OBJECT_STORAGE_REGION || 'ap-shanghai';
const prefix = (process.env.SP_OBJECT_STORAGE_PREFIX || '').replace(/^\/+|\/+$/g, '');
const assetBase = (process.env.SP_ASSET_BASE_URL || '').replace(/\/$/, '');
const dataBase = (process.env.SP_DATA_BASE_URL || '').replace(/\/$/, '');
const flags = new Set(process.argv.slice(2));
const dryRun = flags.has('--dry-run');
const skipData = flags.has('--skip-data');
const dataOnly = flags.has('--data-only');

if (flags.has('--help') || flags.has('-h')) {
  console.log(`Usage: node tools/upload-to-cos.mjs [OPTIONS]

Upload game assets and data files to Tencent Cloud COS.

Options:
  --dry-run     Show what would be uploaded without uploading
  --skip-data   Upload only assets/fonts, skip data files
  --data-only   Upload only data files, skip assets/fonts
  -h, --help    Show this help

Required environment variables:
  SP_OBJECT_STORAGE_BUCKET    COS bucket name
  TENCENTCLOUD_SECRET_ID      Tencent Cloud secret ID
  TENCENTCLOUD_SECRET_KEY     Tencent Cloud secret key

Optional environment variables:
  SP_COS_REGION               COS region (default: ap-shanghai)
  SP_OBJECT_STORAGE_PREFIX    Path prefix in bucket
  SP_ASSET_BASE_URL           CDN URL for assets/fonts
  SP_DATA_BASE_URL            CDN URL for data files
`);
  process.exit(0);
}

if (!bucket) throw new Error('Set SP_OBJECT_STORAGE_BUCKET');
const accessKey = process.env.TENCENTCLOUD_SECRET_ID;
const secretKey = process.env.TENCENTCLOUD_SECRET_KEY;
if (!dryRun && (!accessKey || !secretKey)) {
  throw new Error('Set TENCENTCLOUD_SECRET_ID and TENCENTCLOUD_SECRET_KEY, or use --dry-run');
}

async function walk(dir) {
  const files = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const file = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await walk(file));
    else if (entry.isFile()) files.push(file);
  }
  return files;
}

const run = (argv, label) => new Promise((resolve, reject) => {
  if (dryRun) {
    console.log(`coscmd ${argv.map((x) => JSON.stringify(x)).join(' ')}`);
    resolve();
    return;
  }
  const child = spawn('coscmd', argv, {
    cwd: ROOT,
    env: process.env,
    stdio: ['ignore', 'ignore', 'pipe'],
    windowsHide: true
  });
  let err = '';
  child.stderr.on('data', (b) => { err += b; });
  child.on('error', (e) => reject(new Error(`coscmd unavailable: ${e.message}`)));
  child.on('close', (code) => {
    if (code === 0) resolve();
    else reject(new Error(`${label} failed (${code}): ${err.trim()}`));
  });
});

const jobs = [];

if (!dataOnly) {
  const publicFiles = await walk(PUBLIC);
  for (const file of publicFiles) {
    const rel = relative(PUBLIC, file).split(sep).join('/');
    if (!rel.startsWith('assets/') && !rel.startsWith('fonts/')) continue;
    const key = `${prefix ? `${prefix}/` : ''}${rel}`;
    const url = assetBase ? `${assetBase}/${rel}` : `https://${bucket}.cos.${region}.myqcloud.com/${key}`;
    jobs.push({ file, rel, key, size: (await stat(file)).size, url, type: 'asset' });
  }
}

if (!skipData && !dataOnly) {
  const dataFiles = await walk(DATA);
  for (const file of dataFiles) {
    const rel = relative(DATA, file).split(sep).join('/');
    if (!rel.endsWith('.json')) continue;
    const dataKey = `${prefix ? `${prefix}/` : ''}data/${rel}`;
    const url = dataBase ? `${dataBase}/${rel}` : `https://${bucket}.cos.${region}.myqcloud.com/${dataKey}`;
    jobs.push({ file, rel: `data/${rel}`, key: dataKey, size: (await stat(file)).size, url, type: 'data' });
  }
} else if (dataOnly) {
  const dataFiles = await walk(DATA);
  for (const file of dataFiles) {
    const rel = relative(DATA, file).split(sep).join('/');
    if (!rel.endsWith('.json')) continue;
    const dataKey = `${prefix ? `${prefix}/` : ''}data/${rel}`;
    const url = dataBase ? `${dataBase}/${rel}` : `https://${bucket}.cos.${region}.myqcloud.com/${dataKey}`;
    jobs.push({ file, rel: `data/${rel}`, key: dataKey, size: (await stat(file)).size, url, type: 'data' });
  }
}

if (jobs.length === 0) {
  console.log('No files to upload');
  process.exit(0);
}

if (!dryRun) {
  await run(['config', '-a', accessKey, '-s', secretKey, '-b', bucket, '-r', region], 'coscmd config');
}

const uploadTasks = new Map();
for (const job of jobs) {
  if (job.type === 'asset') {
    const dir = job.rel.split('/')[0];
    if (!uploadTasks.has(dir)) uploadTasks.set(dir, { source: join(PUBLIC, dir), target: `${prefix ? `${prefix}/` : ''}${dir}` });
  } else if (job.type === 'data') {
    if (!uploadTasks.has('data')) uploadTasks.set('data', { source: DATA, target: `${prefix ? `${prefix}/` : ''}data` });
  }
}

for (const [name, { source, target }] of uploadTasks) {
  await run(['upload', '-r', source, target], `coscmd upload ${name}`);
}

const assetCount = jobs.filter(j => j.type === 'asset').length;
const dataCount = jobs.filter(j => j.type === 'data').length;

console.log(`
${dryRun ? 'Would upload' : 'Uploaded'} ${jobs.length} files to cos://${bucket}/${prefix || '(root)'}
  Assets/Fonts: ${assetCount} files
  Data files:   ${dataCount} files`);

if (assetBase) console.log(`
Asset CDN: ${assetBase}`);
if (dataBase) console.log(`Data CDN:  ${dataBase}`);

console.log(`
Runtime config for deployment:
  SP_ASSET_BASE_URL="${assetBase || `https://${bucket}.cos.${region}.myqcloud.com${prefix ? '/' + prefix : ''}`}"
  SP_DATA_BASE_URL="${dataBase || `https://${bucket}.cos.${region}.myqcloud.com${prefix ? '/' + prefix : ''}/data`}"`);
