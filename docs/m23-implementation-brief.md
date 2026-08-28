# M23 Ticket 01 execution record

This file is a non-normative implementation/evidence record. If it conflicts
with `plan/`, the canonical plan wins; requirements are linked here rather
than re-derived.

## Canonical decision pointers

- Ticket scope and acceptance: `plan/23-24-ui-rebuild-tickets/01-freeze-baseline-and-real-evidence.md`.
- Product/configuration decisions: `plan/23-24-ui-rebuild-tickets/README.md`, “Locked product and engineering truth”.
- Parity, reference, license, M23.0 evidence, and performance gates:
  `plan/23-battle-scene-rebuild.md` §§1.3, 3.3, 7 “M23.0”, and 8.
- Screenshot/AX checkpoint requirements: `plan/23-battle-scene-ui-spec.md` §11.
- Accepted review history: `plan/23-battle-scene-review-log.md`.

Per the master’s §3.3 decision, this implementation used
`LinearAbilityExtThreeJS` only as a concept reference pinned at
`bf58757ab9b6057515470aa074cdb4026bc54ed7`; it copied no upstream source or
binary asset and added no GLB/GLTF path. Any future substantial adaptation must
follow that section’s `ATTRIBUTION.md`, MIT notice, and provenance procedure.
The executable fixture in `src/test/m23/baselineScenario.ts` records the exact
canonical fixed-on/hard-off/Scanner configuration without redefining it here.

## Evidence and commands

Evidence is local and gitignored by the exact root-scoped `/test-runs/` rule.
Each run uses:

```text
test-runs/m23/<device>/m23-current-parity-v1--<checkpoint>/screenshot.png
test-runs/m23/<device>/m23-current-parity-v1--<checkpoint>/metrics.json
test-runs/m23/<device>/m23-current-parity-v1--<checkpoint>/accessibility.json
```

`src/test/m23/evidenceSchema.ts` is the executable JSON and path contract. A
baseline includes player-choice, QTE, normal-attack, star, volcanic terrain,
rain terrain, switch, faint, and outcome checkpoints. Metrics keep active
rendered frame gaps separate from intentional idle cadence, and record long
tasks, renderer resources, pool live/capacity, DPR, tier, active cue, first-cast
latency, production battle chunks, asset complexity, and explicit limitations.
Accessibility evidence stores checkpoint-labelled semantic/AX nodes.

Run the schema boundary directly with:

```sh
npx vitest run src/test/m23/evidenceSchema.test.ts
npm run typecheck
git check-ignore test-runs/m23/sample
```

Ticket completion additionally requires the repository checks named by the
ticket, including `npm test` and `npm run build` for Ticket 01.

## Ticket 01 recorded baseline — 2026-08-28

Reference commit before the harness work is `24612c6`. The canonical suite id
is `m23-current-parity-v1`; seed `m23-current-parity-v1-seed` currently produces
digest `5621dba2`, covering all required gameplay branches and encoded replays.

The reproducible Chrome evidence is local at:

```text
test-runs/m23/chrome-metal-headless-mac/m23-current-parity-v1--<checkpoint>/
test-runs/m23/chrome-swiftshader-mac/m23-current-parity-v1--<checkpoint>/
```

Both runs contain nine exact three-file scenario directories (including
volcanic and rain), parse through the executable schema, and report zero
console errors and zero unhandled exceptions. The
hardware run used Chrome 152 as reported by CDP, ANGLE Metal on Intel UHD 630,
1180×820 at DPR 1. Its final diagnostics snapshot recorded 14 geometries, 6
textures, 6 programs, 21 draw calls, 2,220 triangles, 31.6 MiB JS heap used,
and 8 long tasks. First resolver-to-impact latency was 455.5 ms. The
screenshot-instrumented active series contained 3,070 rendered gaps: p50 16.7
ms, p95 17.7 ms, with 0% over 34 ms. These descriptive figures include
screencast/checkpoint effects and are not a release verdict.

Production chunk evidence records every JS asset and marks the current battle
and shared/main set: `BattleStage` 1,629 gzip bytes, `CaptureStage` 2,027,
`MobieVisual` 248,259, and the two current `index` chunks 81,084 and 228,444
gzip bytes (561,443 bytes total for that deliberately broad baseline set).

The independent existing `npm run perf:check -- --port=9223` run excludes
screencast. Calibration was 16.7 ms p50 / 16.8 ms p95 / 0% jank; Title and
Region Select passed. Current battle failed the existing p50≤25 ms, p95≤34 ms,
jank≤5% gate: entry was 16.7 / 66.6 ms / 17.5%, steady was 16.7 / 66.7 ms /
19.7%, and an active turn was 16.7 / 50.1 ms / 17.7%. This is the baseline to
improve, not a threshold to weaken.

SwiftShader completed the same functional matrix with the same digest and no
errors. Its active p50/p95 were 247.7/363.9 ms, so it is explicitly non-gating.
Cross-origin artwork exposed 25–26 image resource entries but no byte sizes;
renderer texture counts are the available complexity evidence. The driver also
provides 404, decode-failure, and generated 4096×4096 large-texture fixtures.
The minimum supported physical device remains undecided; no iPad claim is made
in Ticket 01. Auto therefore remains conservatively documented as starting at
Balanced, and High remains not release-ready.

## Review boundary

Parity and rollback are reviewed directly against the canonical ticket and
master §§1.3/7 rather than a duplicate rule set here. Ticket 01 does not modify
the battle reducer, gameplay formulas, replay schema, save schema, or production
feature defaults. Production-build marker searches confirm the DEV driver,
scenario registry, and artwork fixtures are absent from shipped chunks.
