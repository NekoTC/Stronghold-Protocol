import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { selectDownloadSource } from '../tools/assets/network.mjs';
import { downloadUrls, githubProxyUrl, normalizeProxyPrefix } from '../tools/assets/sources.mjs';
import { Downloader } from '../tools/assets/downloader.mjs';
import { cachedJson, loadIndexes } from '../tools/assets/cache.mjs';
import { resolveTemplate } from '../tools/assets/manifest.mjs';

const RAW = 'https://raw.githubusercontent.com/o/r/main/a.json';
const PROXY = 'https://gh-proxy/' + RAW;
const CDN = 'https://cdn.jsdelivr.net/gh/o/r@main/a.json';
const quiet = () => {};

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'sp-network-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

test('public IP country selects the preferred source, once per invocation', async () => {
  for (const [country, expected] of [['CN', 'mirror'], ['US', 'direct'], ['HK', 'direct'], ['TW', 'direct']]) {
    let calls = 0;
    const messages = [];
    const source = await selectDownloadSource({ log: (s) => messages.push(s), fetchImpl: async (url, { signal }) => {
      calls++;
      assert.equal(url, 'https://www.cloudflare.com/cdn-cgi/trace');
      assert.ok(signal instanceof AbortSignal);
      return new Response(`ip=2001:db8::1\nloc=${country}\n`);
    } });
    assert.equal(source, expected);
    assert.equal(calls, 1);
    assert.ok(!messages.join('\n').includes('2001:db8::1'), 'do not log public IP');
  }
});

test('failed, malformed and invalid-IP lookups try the secondary provider', async () => {
  for (const response of [() => { throw new Error('offline'); }, () => new Response('busy', { status: 503 }),
    () => new Response('<html>error</html>'), () => new Response('ip=invalid\nloc=CN')]) {
    let calls = 0;
    const result = await selectDownloadSource({ log: quiet, fetchImpl: async () => {
      if (++calls === 1) return response();
      return Response.json({ success: true, ip: '203.0.113.1', country_code: 'CN' });
    } });
    assert.equal(result, 'mirror');
    assert.equal(calls, 2);
  }
});

test('lookup timeout and invalid secondary response fall back to direct', async () => {
  let calls = 0;
  // Keep the event loop alive while exercising AbortSignal.timeout's unref timer.
  const keepAlive = setInterval(quiet, 1000);
  try {
    assert.equal(await selectDownloadSource({ timeoutMs: 10, log: quiet, fetchImpl: async (_url, { signal }) => {
      calls++;
      return new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
    } }), 'direct');
  } finally { clearInterval(keepAlive); }
  assert.equal(calls, 2);
  for (const data of [{ success: false, ip: '203.0.113.1', country_code: 'CN' }, { success: true, ip: '203.0.113.1', country_code: 'XX' }]) {
    assert.equal(await selectDownloadSource({ log: quiet, fetchImpl: async () => Response.json(data) }), 'direct');
  }
});

test('manual source and offline mode perform no lookup; invalid modes fail', async () => {
  const fetchImpl = async () => { assert.fail('unexpected network request'); };
  for (const mode of ['direct', 'mirror']) assert.equal(await selectDownloadSource({ mode, fetchImpl, log: quiet }), mode);
  assert.equal(await selectDownloadSource({ offline: true, fetchImpl }), 'direct');
  await assert.rejects(selectDownloadSource({ mode: 'invalid', fetchImpl }), /unknown asset source/);
});

test('URL order, voice support, custom prefix, and no double prefix', () => {
  assert.deepEqual(downloadUrls(RAW, { source: 'mirror' }), [PROXY, RAW, CDN]);
  assert.deepEqual(downloadUrls(RAW), [RAW, CDN, PROXY]);
  const voice = 'https://raw.githubusercontent.com/ArknightsAssets/ArknightsAssets2/voice/assets/x.mp3';
  assert.deepEqual(downloadUrls(voice, { source: 'mirror' }), ['https://gh-proxy/' + voice, voice]);
  assert.deepEqual(downloadUrls(PROXY, { source: 'mirror' }), [PROXY]);
  for (const url of ['https://example.com/a', 'https://github.com.evil.example/a', 'https://user:secret@github.com/a']) {
    assert.equal(githubProxyUrl(url), null);
  }
  assert.equal(githubProxyUrl(RAW, 'https://mirror.example/prefix'), 'https://mirror.example/prefix/' + RAW);
  assert.equal(normalizeProxyPrefix(), 'https://gh-proxy/');
  for (const prefix of ['http://mirror.example/', 'https://mirror.example/?q=x', 'https://user:secret@mirror.example/']) {
    assert.throws(() => normalizeProxyPrefix(prefix), /HTTPS URL/);
  }
});

test('downloader uses proxy, validates payload, falls back, and skips existing files', async (t) => {
  const dir = await fixture(t);
  const calls = [];
  const dl = new Downloader({ root: dir, ledgerPath: join(dir, 'ledger.json'), source: 'mirror', retries: 1, backoffMs: 0, log: quiet,
    fetchImpl: async (url) => {
      calls.push(url);
      return url === PROXY ? new Response('<html>bad gateway</html>') : Response.json({ ok: true });
    } });
  const job = { rel: 'a.json', urls: [RAW], kind: 'json' };
  assert.equal((await dl.run([job])).get(job.rel).url, RAW);
  assert.deepEqual(calls, [PROXY, RAW]);
  assert.equal((await dl.run([job])).get(job.rel).status, 'skip');
  assert.equal(calls.length, 2);
});

test('proxy provenance is recognized as the primary asset, not a fallback asset', async (t) => {
  const dir = await fixture(t);
  const dl = new Downloader({ root: dir, ledgerPath: join(dir, 'ledger.json'), source: 'mirror', log: quiet,
    fetchImpl: async () => Response.json({ ok: true }) });
  const job = { rel: 'a.json', urls: [RAW], kind: 'json' };
  assert.equal((await dl.run([job])).get(job.rel).url, PROXY);
  const resolved = resolveTemplate({ icon: { alts: [job] } }, { root: dir, spine: new Map(), sourceOf: (rel) => dl.ledger.files[rel]?.url });
  assert.deepEqual(resolved.fallbacks, []);
  assert.equal(resolved.value.icon, '/assets/a.json');
});

test('both indexes use the selected proxy and cached/offline reads make no request', async (t) => {
  const dir = await fixture(t);
  const calls = [];
  const opts = { source: 'mirror', log: quiet, fetchImpl: async (url) => { calls.push(url); return Response.json({ index: true }); } };
  const result = await loadIndexes(dir, opts);
  assert.deepEqual(result, { audioData: { index: true }, modelsData: { index: true } });
  assert.equal(calls.length, 2);
  assert.ok(calls.every((url) => url.startsWith('https://gh-proxy/https://raw.githubusercontent.com/')));
  await loadIndexes(dir, { ...opts, offline: true, refresh: true });
  assert.equal(calls.length, 2);
  assert.deepEqual(JSON.parse(await readFile(join(dir, '.cache', 'ark-models', 'models_data.json'), 'utf8')), { index: true });
});

test('index proxy miss falls back to raw', async (t) => {
  const dir = await fixture(t);
  const calls = [];
  assert.deepEqual(await cachedJson({ cacheFile: join(dir, 'index.json'), url: RAW, source: 'mirror', log: quiet,
    fetchImpl: async (url) => { calls.push(url); return url === PROXY ? new Response('', { status: 404 }) : Response.json({ ok: true }); } }), { ok: true });
  assert.deepEqual(calls, [PROXY, RAW]);
});

test('setup and asset CLI document and validate source options before doing work', () => {
  for (const script of ['tools/setup.mjs', 'tools/fetch-assets.mjs']) {
    const help = spawnSync(process.execPath, [script, '--help'], { encoding: 'utf8' });
    assert.equal(help.status, 0, help.stderr);
    assert.match(help.stdout, /--asset-source/);
    assert.match(help.stdout, /SP_GITHUB_PROXY/);
    const invalid = spawnSync(process.execPath, [script, '--asset-source=invalid'], { encoding: 'utf8' });
    assert.notEqual(invalid.status, 0);
    assert.match(invalid.stderr, /unknown asset source/);
  }
});
