// Select a source once per download invocation, using the public egress IP.
import { isIP } from 'node:net';

export function validateSource(mode) {
  if (!['auto', 'direct', 'mirror'].includes(mode)) throw new Error(`unknown asset source: ${mode} (auto|direct|mirror)`);
  return mode;
}

/** No IP is persisted. Explicit choices and offline invocations make no lookup. */
export async function selectDownloadSource({ mode = 'auto', offline = false, fetchImpl = globalThis.fetch, timeoutMs = 4000, log = console.log } = {}) {
  validateSource(mode);
  if (offline) return 'direct';
  if (mode !== 'auto') {
    log(`[network] 手动选择：${mode === 'mirror' ? '国内镜像优先' : '原始源优先'}`);
    return mode;
  }
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
