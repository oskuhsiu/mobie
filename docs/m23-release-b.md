# M23 Release B — next default and legacy rollback

Release B promotes the `next` renderer to the normal battle entry. The route
is display-only and is never written to a save, replay, or player preference.
The established `legacy` entry remains available for one release through an
operator-only rollback query while the compatibility renderer remains the
one-way recovery path for renderer failures.

## Gate record

- Release A route evidence is retained under the ignored
  `test-runs/m23/release-a-legacy/`, `release-a-next/`,
  `release-a-compat/`, and `release-a-next-fallback/` directories. Those runs
  used the same seed and deterministic digest (`5621dba2`) and completed the
  required seeded battle checkpoints without browser errors.
- Owner sign-off for the Ticket 18 implementation and route-promotion
  decision is recorded with the 2026-09-08 rollout instruction. The
  one-release stability observation required before Ticket 19 remains a
  separate future gate.

## Route policy

- An absent route enters `next` in production and ordinary development.
- `?renderer=legacy` (or the equivalent `rendererRoute=legacy`) is a
  controlled operator rollback for this release. It is not persisted and does
  not add a Settings control or a player-facing renderer choice. Remove the
  query and reload to return to `next`.
- The DEV M23 driver and CDP harness may still request `next`, `legacy`, or
  `compatibility` explicitly so each route can be qualified.
- WebGL, shader, chunk, context, and sustained-performance failures latch
  `compatibility` for the current session. The battle session, reducer turn,
  replay input, and result handoff are not re-created when this happens.

Both WebGL entries consume the same `BattleSceneSnapshot`, session token,
presentation coordinator, seeded battle flow, replay recorder, and result
handoff. Renderer selection is observable through `[data-renderer-route]` and
the local DEV diagnostics port only; no telemetry or player data is uploaded.

## Evidence commands

With the existing Vite and Chrome/CDP setup from `README.md`, run the default
route and then the explicit rollback and compatibility routes:

```sh
node scripts/m23-baseline.mjs --seed=m23-current-parity-v1-seed --device=release-b-next
node scripts/m23-baseline.mjs --renderer=legacy --seed=m23-current-parity-v1-seed --device=release-b-legacy-rollback
node scripts/m23-baseline.mjs --renderer=compatibility --seed=m23-current-parity-v1-seed --device=release-b-compat
node scripts/m23-baseline.mjs --renderer=next --artwork=large-texture --seed=m23-current-parity-v1-seed --device=release-b-artwork-success
node scripts/m23-baseline.mjs --renderer=next --artwork=artwork-404 --seed=m23-current-parity-v1-seed --device=release-b-artwork-failure
node scripts/m23-baseline.mjs --renderer=next --rendererFailure=chunk-reject --seed=m23-current-parity-v1-seed --device=release-b-chunk-reject
npm run perf:check -- --renderer=next --evidence=true --device=release-b-next
```

Repeat the next route once with the existing browser profile and once with a
fresh profile. The normal artwork journey is the success case. The harness
also supports `--artwork=large-texture` for a deterministic successful load and
`--artwork=artwork-404` or `--artwork=decode-failure` for failure cases; each
fixture is applied after the battle is initialized and before the journey
continues. Each must retain the same layout and finish the seeded journey.
Store the resulting three-file checkpoint directories under
`test-runs/m23/<device>/`.

The current Chrome evidence includes the following completed runs:

| Run | Requested/effective route | Result | Evidence |
|---|---|---|---|
| Existing profile default (absent route) | `next` / `next` | 9 checkpoints, digest `5621dba2`, 0 errors | `test-runs/m23/release-b-default-no-route/` |
| Existing profile rollback | `legacy` / `legacy` | 9 checkpoints, digest `5621dba2`, 0 errors | `test-runs/m23/release-b-legacy-rollback/` |
| Existing profile compatibility | `compatibility` / `compatibility` | 9 checkpoints, digest `5621dba2`, 0 errors | `test-runs/m23/release-b-compatibility/` |
| Fresh profile default (absent route) | `next` / `next` | 9 checkpoints, digest `5621dba2`, 0 errors; SwiftShader functional-only | `test-runs/m23/release-b-fresh-no-route/` |
| Fresh profile artwork success | `next` / `next` | `large-texture`, modes `artwork/artwork`, 9 checkpoints, digest `5621dba2`, 0 errors; SwiftShader functional-only | `test-runs/m23/release-b-fresh-artwork-success-cached/` |
| Fresh profile artwork failure | `next` / `next` | `artwork-404`, modes `silhouette/artwork`, 9 checkpoints, digest `5621dba2`, 0 errors; SwiftShader functional-only | `test-runs/m23/release-b-fresh-artwork-404-cached/` |
| Injected chunk rejection | `next` / `compatibility` | 9 checkpoints, digest `5621dba2`, 0 errors; reason `chunk-reject` | `test-runs/m23/release-b-next-chunk-reject/` |
| Injected WebGL failure | `next` / `compatibility` | 9 checkpoints, digest `5621dba2`, 0 errors; reason `webgl-unsupported` | `test-runs/m23/release-b-webgl-unsupported/` |

The observed automatic fallback rate is `0/4` for the healthy next runs in
this table and `1/1` for the deliberately injected chunk-rejection run. The
injected WebGL failure is also `1/1` by design. The injected cases are expected
failure-path rates; this app has no uploaded telemetry for a natural production
denominator. The existing `graphicsGovernor.test.ts` covers the ordered DPR →
post → particles/weather → compatibility downgrade policy; a hardware
pressure-rate claim remains outside this short functional run. The haptics wrapper also skips vibration
when Chromium reports no active user gesture, keeping these programmatic
journeys free of browser warnings.

For every route, record the requested route, effective route, seed, digest,
fallback reason, browser errors, and final result. The injected Release A
chunk-reject run already demonstrates the expected one-run compatibility
fallback (`1/1` by design); natural production fallback rate is unavailable
because this project does not upload telemetry and must be measured from
local release runs.

## Rollback checklist

1. Open the battle with `?renderer=legacy` and reload the battle entry.
2. Confirm `data-renderer-route="legacy"` and that the existing roster,
   settings, save data, and replay data remain unchanged.
3. Complete one seeded battle and compare its digest and canonical result with
   the `next` run.
4. Remove the query, reload, and confirm the normal route is `next`.
5. If `next` fails during loading or rendering, confirm the host latches
   `compatibility` and the same battle remains interactive.

## Known limitations and next gate

- Physical iPad Safari qualification from Ticket 16 remains an external
  limitation; Chrome evidence does not replace it.
- The full five-viewport, thermal, retained-heap, and long artwork-churn
  matrix remains release evidence work rather than a claim from the short
  local route checks.
- Ticket 19 may start only after Release B has remained stable for one release
  and the owner approves retiring the duplicate legacy choreography.

## Owner acceptance

Run `npm run typecheck && npm test && npm run build`, inspect the production
manifest for the lazy next, legacy, and compatibility entries, then complete
the route, fresh-profile, retained-data, artwork-success, and
artwork-failure journeys above. Release B is accepted only when the next
default and legacy rollback complete the same seeded battle, compatibility
remains playable, and the stability/owner gate is recorded.
