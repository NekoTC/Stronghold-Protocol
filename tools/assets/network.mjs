// Explicit download-source selection and one shared policy per asset invocation.
// `auto` is the local fork's extra mode: it picks the source once per invocation from the public egress IP.
// Selecting a source never persists the IP and makes no other request.
import { isIP } from 'node:net';
import { downloadUrls, normalizeProxyPrefix } from './sources.mjs';

export function validateSource(mode) {
  if (!['auto', 'direct', 'mirror'].includes(mode)) throw new Error(`unknown asset source: ${mode} (auto|direct|mirror)`);
  return mode;
}

export async function selectDownloadSource({ mode = 'direct', offline = false, proxyPrefix, fetchImpl = globalThis.fetch, timeoutMs = 4000, log = console.log, verified = false } = {}) {
  validateSource(mode);
  if (offline) return 'direct';
  const chosen = mode === 'auto' ? await lookupSource({ fetchImpl, timeoutMs, log }) : mode;
  const normalizedProxy = chosen === 'mirror' ? normalizeProxyPrefix(proxyPrefix) : '';
  if (chosen === 'mirror') {
    log(`[network] 手动开启 GitHub 镜像：${normalizedProxy || '代理已禁用'}；${verified ? '原始文件校验 Git blob。' : '文件仅校验格式和大小。'}`);
  } else {
    log(mode === 'auto' ? '[network] 原始源（自动检测未选择镜像）' : '[network] 原始源（未开启 GitHub 镜像）');
  }
  return chosen;
}

/** The local fork's public-IP lookup: CN → mirror, anything else → direct. Never logs or stores the IP. */
async function lookupSource({ fetchImpl, timeoutMs, log }) {
  log('[network] 检测公网 IP 所属地区…');
  const providers = [
    { url: 'https://www.cloudflare.com/cdn-cgi/trace', parse: async (res) => {
      const fields = Object.fromEntries((await res.text()).trim().split(/\r?\n/).map((line) => line.split('=')));
      return { ip: fields.ip, country: fields.loc };
    } },
    { url: 'https://ipwho.is/', parse: async (res) => {
      const data = await res.json();
      return data.success === true ? { ip: data.ip, country: data.country_code } : {};
    } },
  ];
  for (const provider of providers) {
    try {
      const res = await fetchImpl(provider.url, { signal: AbortSignal.timeout(timeoutMs) });
      if (!res.ok) { await res.body?.cancel(); continue; }
      const { ip, country } = await provider.parse(res);
      const code = typeof country === 'string' ? country.trim().toUpperCase() : '';
      if (typeof ip !== 'string' || !isIP(ip) || !/^[A-Z]{2}$/.test(code) || code === 'XX') continue;
      const source = code === 'CN' ? 'mirror' : 'direct';
      log(`[network] IP 地区 ${code}：${source === 'mirror' ? '国内镜像优先' : '原始源优先'}（失败自动回退）`);
      return source;
    } catch { /* bounded lookup failure: try the next provider */ }
  }
  log('[network] IP 地区检测未成功：原始源优先，保留镜像回退（可用 --asset-source=mirror 手动选择）。');
  return 'direct';
}

/** Shared by indexes, files, Spine follow-ups and fonts; a tripped mirror stays off. */
export class MirrorPolicy {
  constructor({ source = 'direct', proxyPrefix, failureLimit = 3, timeoutMs = 8000, log = console.log } = {}) {
    this.source = validateSource(source) === 'auto' ? 'direct' : source;
    this.proxyPrefix = this.source === 'mirror' ? normalizeProxyPrefix(proxyPrefix) : '';
    this.failureLimit = Math.max(1, Number(failureLimit) || 3);
    this.timeoutMs = Math.max(1, Number(timeoutMs) || 8000);
    this.log = log;
    this.failures = 0;
    this.disabled = false;
    this.hintShown = false;
    this.abortMirror = new AbortController();
  }

  urls(url) {
    return downloadUrls(url, { source: this.disabled ? 'direct' : this.source, proxyPrefix: this.proxyPrefix });
  }

  isProxy(url) {
    return this.source === 'mirror' && !!this.proxyPrefix && url.startsWith(this.proxyPrefix);
  }

  skip(url) { return this.isProxy(url) && this.disabled; }

  async request(url, fetchImpl, options = {}, timeoutMs = 120000) {
    if (!this.isProxy(url)) {
      return fetchImpl(url, { ...options, signal: options.signal ?? AbortSignal.timeout(timeoutMs) });
    }
    const headerDeadline = new AbortController();
    const signal = AbortSignal.any([headerDeadline.signal, this.abortMirror.signal]);
    const timer = setTimeout(() => headerDeadline.abort(new Error('GitHub mirror response headers timed out')), Math.min(timeoutMs, this.timeoutMs));
    try {
      return await fetchImpl(url, { ...options, signal });
    } finally {
      clearTimeout(timer);
    }
  }

  async readBody(url, response, maxBytes = Infinity) {
    if (Number(response.headers?.get('content-length')) > maxBytes) {
      await response.body?.cancel();
      throw new Error(`JSON exceeds ${maxBytes} bytes`);
    }
    if (!this.isProxy(url) && !Number.isFinite(maxBytes)) return Buffer.from(await response.arrayBuffer());
    if (!response.body) return Buffer.alloc(0);
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    try {
      while (true) { // loop-cap: response EOF, maxBytes for bounded JSON, and body idle deadline
        const { value, done } = this.isProxy(url)
          ? await readChunk(reader, this.timeoutMs, this.abortMirror.signal)
          : await readChunk(reader, this.timeoutMs);
        if (done) break;
        const chunk = Buffer.from(value);
        size += chunk.length;
        if (size > maxBytes) throw new Error(`JSON exceeds ${maxBytes} bytes`);
        chunks.push(chunk);
      }
    } catch (error) {
      try { await reader.cancel(error); } catch { /* ignore */ }
      throw error;
    } finally {
      reader.releaseLock();
    }
    return Buffer.concat(chunks, size);
  }

  succeeded(url) {
    // A success from a request already in flight must not reopen a tripped circuit.
    if (this.isProxy(url) && !this.disabled) this.failures = 0;
  }

  failed(url) {
    if (this.isProxy(url)) {
      if (this.disabled || ++this.failures < this.failureLimit) return;
      this.disabled = true;
      this.log(`[network] GitHub 镜像连续失败 ${this.failures} 次：本次运行停用镜像，继续使用原始源 / jsDelivr。`);
      this.abortMirror.abort(new Error('GitHub mirror disabled for this run'));
    }
  }

  directFailureHint() {
    if (this.source !== 'direct' || this.hintShown) return;
    this.hintShown = true;
    this.log('[network] GitHub 下载失败；如需使用第三方镜像，可重新运行并加 --asset-source=mirror（或 SP_ASSET_SOURCE=mirror）。');
  }
}

function readChunk(reader, timeoutMs, signal) {
  return new Promise((resolve, reject) => {
    let timer;
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    };
    const onAbort = () => { cleanup(); reject(signal.reason ?? new Error('GitHub mirror request aborted')); };
    if (signal?.aborted) return onAbort();
    timer = setTimeout(() => { cleanup(); reject(new Error(`GitHub mirror response body idle for ${timeoutMs} ms`)); }, timeoutMs);
    signal?.addEventListener('abort', onAbort, { once: true });
    reader.read().then((value) => { cleanup(); resolve(value); }, (error) => { cleanup(); reject(error); });
  });
}
