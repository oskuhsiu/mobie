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
- The current owner instruction authorizes implementing Ticket 18 after the
  Release A evidence review. The operational stability period and final
  production acceptance remain recorded here rather than inferred from a
  single local run.

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
npm run perf:check -- --renderer=next --evidence=true --device=release-b-next
```

Repeat the next route once with the existing browser profile and once with a
fresh profile. The normal artwork journey is the success case; in the DEV
driver, exercise `prepareArtworkFixture('artwork-404')` and
`prepareArtworkFixture('decode-failure')` after the battle is initialized and
before continuing the journey for the failure cases. Each must retain the same
layout and finish the seeded journey.
Store the resulting three-file checkpoint directories under
`test-runs/m23/<device>/`.

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
