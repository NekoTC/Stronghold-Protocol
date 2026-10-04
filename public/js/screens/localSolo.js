// Offline solo runner. Progress is local and intentionally independent of the WebSocket lobby.
import { useEffect, useState } from '../../vendor/hooks.module.js';
import { html, Button, MicroLabel, Panel } from '../ui/components.js';
import { store, useStore } from '../store.js';

const KEY = 'sp.localSolo.v1';
const read = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; } };
const write = (v) => { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch {} };

export function startLocalSolo(difficulty = 'FUNNY') {
  const old = read();
  store.set({ room: { code: 'LOCAL', mode: 'solo', difficulty, inMatch: true, local: true, seats: [] }, match: { public: { phase: 'LOCAL_SOLO', round: old.round || 1, totalRounds: difficulty === 'FUNNY' ? 9 : 14, paused: false, local: true }, private: null, field: null, result: null, battle: null } });
}

export function LocalSoloScreen() {
  const match = useStore((s) => s.match?.public || {});
  const [state, setState] = useState(() => ({ round: read().round || 1, coins: read().coins || 20, paused: false }));
  useEffect(() => { write(state); }, [state]);
  const total = match.totalRounds || 9;
  const advance = () => setState((s) => ({ ...s, round: Math.min(total, s.round + 1), coins: s.coins + 5 }));
  const reset = () => { write({}); store.set({ room: null, match: { public: null, private: null, field: null, result: null, battle: null } }); };
  return html`<div class="screen lobby-screen"><header class="topbar"><div><${MicroLabel} tone="mint">LOCAL SOLO · OFFLINE CACHE<//><h1 class="topbar__title">独立模拟</h1></div><div class="t-lo">${state.paused ? '已暂停' : '本地运行'} · 不需要请求</div></header><div class="lobby-body"><section class="lobby-left"><${Panel} class="brackets"><${MicroLabel}>ROUND PROGRESS<//><h2>第 ${state.round} / ${total} 回合</h2><p class="t-lo">战斗状态、资源和进度保存在本机，可在离线状态继续。</p><div class="create-box"><${Button} variant="primary" icon="chevrons" disabled=${state.round >= total || state.paused} onClick=${advance}>完成本回合<//><${Button} variant="secondary" icon="pause" onClick=${() => setState((s) => ({ ...s, paused: !s.paused }))}>${state.paused ? '继续' : '暂停'}<//></div><p class="num">资源 ${state.coins}</p><//></section><section class="lobby-right"><${Panel} tone="amber"><${MicroLabel}>LOCAL STORAGE<//><h2>离线存档</h2><p class="t-lo">最后进度会自动保存到此浏览器。</p><${Button} variant="ghost" icon="chevronLeft" onClick=${reset}>返回大厅<//></${Panel}></section></div></div>`;
}
