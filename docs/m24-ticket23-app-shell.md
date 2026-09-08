# M24 Ticket 23 — AppShell and cold boot

Ticket 23 gives the app one full viewport shell and one cached bootstrap owner. `AppShell` owns the
route background and safe-area padding; `ScreenViewport` owns the route scroll surface; `TaskHeader`
and `UtilityDock` define the Title's stable visual frame. The XState machine remains the only route
authority.

`bootstrapCoordinator.tsx` starts roster and incubator reads together, waits for roster completion, and
hydrates meta from that canonical roster. StrictMode effects and React remounts reuse the same promise.
The browser App also keeps one XState route actor outside the React root, so a root remount preserves the
current route without introducing a second screen machine.
The public readiness contract is `loading | ready | partial-error`. While loading, the Title remains
visible, canonical-data actions are disabled with an explanation, and safe More/Settings actions stay
available. A partial error exposes Retry without changing the route. Resize and orientation are CSS
layout work and do not send game events or mutate stores.

## Chrome evidence

Start Vite and an isolated Chrome CDP target:

```sh
npm run dev -- --host 127.0.0.1
google-chrome --headless=new --remote-debugging-port=9222 \
  --user-data-dir=/tmp/mobie-m24-ticket23 about:blank
npm run baseline:m24-shell -- --port=9222 --device=ticket23-chrome
```

The runner clears the isolated origin, uses a deterministic delayed cold boot with a simulated meta
failure, opens safe Settings during `partial-error`, clears the fixture and retries with a slower
successful load, then verifies the ready Title, `START → regionSelect → BACK → title`, My Mobie, and
More handoffs. It records screenshots, AX snapshots, DOM overflow, viewport metadata, coordinator
stage/promise counters, XState route-event counts, and browser errors under the ignored
`test-runs/m24/ticket23-app-shell/<device>/` directory.

The evidence is functional Chrome coverage. iPad Safari safe-area, touch, zoom, hardware performance,
thermal, and long-duration qualification remain separate release gates.
