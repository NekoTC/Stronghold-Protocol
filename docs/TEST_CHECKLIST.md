# COS Integration Test Checklist

## Quick Verification Steps

### Stage 1: Local Testing (No COS Required)

1. Start server: npm start
2. Check runtime config: curl http://localhost:3000/runtime-config.json
3. Browser test: Open http://localhost:3000
   - DevTools → Application → Service Workers (sw.js registered)
   - Application → Cache Storage (stronghold-v3 exists)
4. Create solo match and verify game data loads

### Stage 2: Offline Mode Testing

1. Ensure game fully loaded once (cache established)
2. Stop server (Ctrl+C)
3. Refresh browser (F5)
   - Expected: Page loads, solo mode works
4. Check Cache Storage → stronghold-v3 contains core files

### Stage 3: COS Deployment Testing

1. Set environment variables
2. Test upload tool: node tools/upload-to-cos.mjs --help
3. Dry run: node tools/upload-to-cos.mjs --dry-run
4. Execute upload: node tools/upload-to-cos.mjs
5. Configure CDN domains and restart server
6. Verify resources load from CDN in Network tab

## Test Matrix

| Scenario | Expected | Status |
|----------|----------|--------|
| Runtime config load | Returns correct JSON | ⬜ |
| Service Worker registration | SW registered | ⬜ |
| Core files cached | Contains shell + data | ⬜ |
| Resource local loading | From /assets, /data | ⬜ |
| Resource CDN loading | From CDN domain | ⬜ |
| Offline page load | Page displays | ⬜ |
| Offline solo mode | Match works | ⬜ |
| Upload tool help | Shows help | ⬜ |
| Upload dry run | Lists files only | ⬜ |
| Full upload | Uploads all files | ⬜ |

## Known Limitations

1. Service Worker scope: Must be served from /sw.js
2. HTTPS requirement: Production requires HTTPS
3. Cache updates: Need manual cache clear or version bump
4. CORS: COS bucket must allow game domain

## Troubleshooting

- SW not registered: Check console, verify /sw.js accessible
- Cache not established: Force update in DevTools
- Offline mode fails: Confirm full load occurred first
- COS upload fails: Verify environment variables and permissions
