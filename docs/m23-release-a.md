# M23 Release A — renderer rollout and rollback

Release A keeps the established battle renderer as the production default. The
renderer route is display-only and is never persisted in a save, replay, or
player preference.

## Route policy

- Production and ordinary development sessions use `legacy` when no route is
  supplied.
- The DEV/test-only `renderer=next` query flag selects the lazy next entry for
  the deterministic M23 scenario. It is ignored by production code and is not
  exposed in player navigation or Settings.
- `renderer=compatibility` selects the DOM compatibility entry for a DEV/test
  run. A `graphics=compatibility` request has the same display result.
- WebGL, shader, chunk, context, and sustained-performance failures move the
  active route to compatibility at the renderer safe point. The battle session
  and presentation coordinator continue with the same canonical state.

Both entries consume the same `BattleSceneSnapshot`, input handlers, battle
session token, seeded reducer flow, replay recorder, and result handoff. The
route is reported locally through `[data-renderer-route]` and the DEV
diagnostics port. No telemetry or player data is uploaded.

## Reproducible Chrome evidence

Use the existing isolated Chrome/CDP setup described in `README.md`. The
default fixture is `m23-current-parity-v1` with seed
`m23-current-parity-v1-seed`.

```sh
node scripts/m23-baseline.mjs --renderer=legacy --seed=m23-current-parity-v1-seed --device=release-a-legacy
node scripts/m23-baseline.mjs --renderer=next --seed=m23-current-parity-v1-seed --device=release-a-next
node scripts/m23-baseline.mjs --renderer=compatibility --seed=m23-current-parity-v1-seed --device=release-a-compat
```

For a shorter performance run, use the same route flag with
`npm run perf:check -- --renderer=<route> --evidence=true`. Each output must
record `requestedRendererRoute` and the effective `rendererRoute`, the same seed,
a complete battle, zero console or unhandled errors, and the route-specific
renderer state. Evidence belongs under the ignored `test-runs/m23/<device>/`
tree.

## Rollback checklist

1. Remove `renderer=next` or set `renderer=legacy` and reload the battle.
2. If the next entry fails, confirm the host reports
   `data-renderer-route="compatibility"`, diagnostics preserve
   `requestedRendererRoute="next"` with `rendererRoute="compatibility"`, and
   the compatibility battle remains interactive.
3. Confirm local roster/settings/replay storage is still present. Do not clear
   storage, recreate the account, or change the save/replay format as part of a
   renderer rollback.
4. Re-run the seeded fixture and compare its deterministic scenario digest and
   canonical battle result with the other route runs.
5. Attach the three route evidence directories and record the device, browser,
   graphics request, fallback reason, and any unverified device gate before
   owner sign-off.

## Known limitations

- The Release A route entries currently share the established `BattleStage`
  implementation behind separate lazy entry points. This validates route
  selection, packaging, deterministic parity, and rollback while preserving
  the current visual implementation for both entries.
- Physical iPad Safari qualification from Ticket 16 remains an external gate;
  Chrome evidence does not replace it.
- The baseline harness prepares some QTE, Star, terrain, and switch checkpoints
  explicitly. Those captures verify route continuity and semantic rendering,
  while naturally reached battle events remain covered by the live journey.

## Owner acceptance

Run `npm run typecheck && npm test && npm run build`, inspect the production
manifest for the expected lazy battle entries and absence of DEV/VfxLab or
mockup assets, then complete the three seeded Chrome runs above. Release A is
accepted when legacy is the default, next is opt-in, compatibility remains a
working fallback, and all route evidence records the same battle digest and
result without storage or replay migration.
