# Local-first feature draft

This branch contains an unfinished implementation for review. It is not ready for deployment.

- The offline solo screen stores a round counter in localStorage. It does not yet run the real match or battle engine. Online solo still uses the server.
- The PWA worker caches a small shell and previously requested same-origin files. Complete offline installation, cache updates, cross-origin asset caching and offline LAN transport remain unfinished.
- The runtime configuration exposes SP_ASSET_BASE_URL. Complete asset URL rewriting and initialization ordering remain unfinished.
- `npm run assets:upload` uses Tencent's official `coscmd` to recursively upload `public/assets/**` and `public/fonts/**` to COS. Set `SP_ASSET_BASE_URL` so the browser fetches binary assets directly from the CDN or COS domain. Use `--dry-run` to inspect commands without uploading.
- Multiplayer matchmaking joins available co-op rooms of the same difficulty. The first searcher creates an open room; hosts can enable or disable matching in their waiting room. Full rooms, running matches and disconnected hosts are skipped. Matching closes when the simulation starts.

Existing tests and syntax checks do not establish that these new features work end to end.
