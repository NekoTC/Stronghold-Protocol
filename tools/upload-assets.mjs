#!/usr/bin/env node
// Upload generated public assets to S3-compatible object storage. Files are never sent by the game server.
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const dir = join(ROOT, 'public');
const endpoint = process.env.SP_OBJECT_STORAGE_ENDPOINT;
const bucket = process.env.SP_OBJECT_STORAGE_BUCKET;
const prefix = (process.env.SP_OBJECT_STORAGE_PREFIX || '').replace(/^\/+|\/+$/g, '');
const base = process.env.SP_ASSET_BASE_URL || '';
if (!endpoint || !bucket) throw new Error('Set SP_OBJECT_STORAGE_ENDPOINT and SP_OBJECT_STORAGE_BUCKET');
const files = [];
async function walk(p) { for (const e of await readdir(p, { withFileTypes: true })) { const x = join(p, e.name); if (e.isDirectory()) await walk(x); else files.push(x); } }
await walk(dir);
const manifest = [];
for (const file of files) {
  const rel = relative(dir, file).split(sep).join('/');
  if (!rel.startsWith('assets/') && !rel.startsWith('fonts/')) continue;
  const body = await readFile(file); const digest = crypto.createHash('sha256').update(body).digest('hex').slice(0, 16);
  const key = `${prefix ? `${prefix}/` : ''}${rel}`;
  const url = `${endpoint.replace(/\/$/, '')}/${encodeURIComponent(bucket)}/${key.split('/').map(encodeURIComponent).join('/')}`;
  manifest.push({ file: rel, key, bytes: (await stat(file)).size, sha256: digest, url: base ? `${base.replace(/\/$/, '')}/${key}` : url });
}
console.log(JSON.stringify({ bucket, endpoint, prefix, files: manifest }, null, 2));
console.log(`Prepared ${manifest.length} files. Use your provider CLI with the listed keys to upload; the app reads SP_ASSET_BASE_URL at runtime.`);
