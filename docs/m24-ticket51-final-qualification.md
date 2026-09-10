# M24 Ticket 51 final web-app qualification

Ticket 51 closes M24 after the Hunt/Result/Tower, Collection/Growth, and Shell/Data tools Chrome gates. The
owner accepts Mobie as a web app, so the final gate exercises a real Chrome target with iPad CSS viewport
dimensions. It does not claim a native iPad Safari hardware run.

Run the app and an isolated Chrome CDP target, then run:

```bash
npm run dev -- --host 0.0.0.0
chrome --remote-debugging-port=9222 --user-data-dir=/tmp/mobie-ticket51 about:blank
npm run qualification:m24 -- --port=9222
```

The runner refuses to start unless the Ticket 48, 49, and 50 evidence files exist with every required
assertion green and zero console/runtime/unhandled errors. It also verifies the recorded Ticket 01–50
commit inventory before exercising the current build.

The live matrix captures screenshots and accessibility snapshots for cold boot, Region → Encounter → Team →
Battle → Result, Tower Setup/Result, My Mobies, and every data-tool surface. Each iPad-sized viewport checks
orientation, touch-style activation, safe-area padding, scroll ownership, 44px targets, and an equivalent
200% CSS viewport with reachable primary actions. The run additionally verifies reload retention for canonical
localStorage and IndexedDB keys, scanner-off capability, keyboard focus cycling/restoration, fixed product
truth, and model-resource absence. The Save and Replay delivery/persistence, scanner-on capability,
pending-operation guards, artwork failures, and portable payload audit remain covered by the prerequisite
Ticket 48–50 evidence and are linked in the generated JSON.

Evidence is written under the ignored `test-runs/m24/ticket51-ipad-safari/` directory. `latest.json` points to
the most recent run; each checkpoint contains `screenshot.png`, `accessibility.json`, and its diagnostics.
