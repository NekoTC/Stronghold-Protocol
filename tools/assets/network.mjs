// Explicit download-source selection and one shared policy per asset invocation.
// Selecting a source never looks up the user's public IP or makes a request.
import { downloadUrls, githubProxyUrl, normalizeProxyPrefix } from './sources.mjs';

export function validateSource(mode) {
  if (!['direct', 'mirror'].includes(mode)) throw new Error(`unknown asset source: ${mode} (direct|mirror)`);
  return mode;
}

export async function selectDownloadSource({ mode = 'direct', offline = false, log = console.log } = {}) {
  validateSource(mode);
  if (offline) return 'direct';
  log(`[network] ${mode === 'mirror' ? '手动开启 GitHub 镜像' : '原始源（未开启 GitHub 镜像）'}`);
  return mode;
}

/** Shared by indexes, files, Spine follow-ups and fonts; a tripped mirror stays off. */
export class MirrorPolicy {
  constructor({ source = 'direct', proxyPrefix, failureLimit = 3, timeoutMs = 8000, log = console.log } = {}) {
    this.source = validateSource(source);
    this.proxyPrefix = normalizeProxyPrefix(proxyPrefix);
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

  signal(url, timeoutMs) {
    if (!this.isProxy(url)) return AbortSignal.timeout(timeoutMs);
    return AbortSignal.any([AbortSignal.timeout(Math.min(timeoutMs, this.timeoutMs)), this.abortMirror.signal]);
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
    } else if (this.source === 'direct' && !this.hintShown && githubProxyUrl(url, this.proxyPrefix)) {
      this.hintShown = true;
      this.log('[network] GitHub 下载失败；如需使用第三方镜像，可重新运行并加 --asset-source=mirror（或 SP_ASSET_SOURCE=mirror）。');
    }
  }
}
