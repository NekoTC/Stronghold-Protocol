# Local-first feature draft

This branch contains an unfinished implementation for review. It is not ready for deployment.

- The offline solo screen stores a round counter in localStorage. It does not yet run the real match or battle engine. Online solo still uses the server.
- The PWA worker caches a small shell and previously requested same-origin files. Complete offline installation, cache updates, cross-origin asset caching and offline LAN transport remain unfinished.
- The runtime configuration exposes SP_ASSET_BASE_URL. Complete asset URL rewriting and initialization ordering remain unfinished.
- `npm run assets:upload` currently prints an upload inventory. It does not authenticate or upload files to object storage.
- The multiplayer matchmaking queue is a prototype. Session handling, cancellation, disconnect cleanup and matching feedback remain unfinished.

Existing tests and syntax checks do not establish that these new features work end to end.
