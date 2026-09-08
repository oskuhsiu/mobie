# M24 post-M23 Chrome baseline

This is the repeatable non-battle baseline for the application after
M24 Ticket 22, starting from the Ticket 21 frontier (`2121098`). It exercises the real Vite app in Chrome through
CDP, records screenshots and the Chrome accessibility tree, and writes an
index containing the route, event, storage, lazy-loading, capability, focus,
scroll, artwork, and browser-error observations for every checkpoint.
The Ticket 22 run is complete only when this command produces the evidence
index; no captured run is checked into the repository.

The baseline does not use generated mockups. The journey clicks the real
screens and modals, reads the real generated species data, and seeds the
additional growth/card/egg values through the existing store and persistence
APIs. The only controlled route setup is a DEV-only result handoff used to
reach the win/loss branches deterministically after the real
Title → Region → Encounter → Team Select → Battle handoff.
If a headless compositor leaves the intro presentation open, the same DEV
driver releases the command deck at the existing player-choice boundary so
the route can still be inspected.

## Re-run

Start the dev server and an isolated Chrome target:

```sh
npm run dev -- --host 127.0.0.1
google-chrome --headless=new --remote-debugging-port=9222 \
  --user-data-dir=/tmp/mobie-m24-chrome
```

Capture one representative viewport:

```sh
npm run baseline:m24 -- --port=9222 --viewport=wide-landscape --device=chrome-local
```

Capture all five viewport classes sequentially:

```sh
npm run baseline:m24 -- --port=9222 --all --device=chrome-matrix
```

The output is gitignored by the repository policy:

```text
test-runs/m24/post-m23-chrome/<device>/index.json
test-runs/m24/post-m23-chrome/<device>/<viewport>/index.json
test-runs/m24/post-m23-chrome/<device>/<viewport>/<checkpoint>/
  screenshot.png
  accessibility.json
  metrics.json
```

The top-level index is the evidence index. Each viewport index records the
same checkpoint catalog plus the observed journey and browser errors. Each
metrics file is self-contained, so a single checkpoint can be reviewed without
opening the whole run.
The runner validates checkpoint metadata and the per-viewport index before it
publishes either file; a failed Chrome storage reset also fails the run instead
of allowing stale data to masquerade as an empty baseline.

## Viewports and checkpoints

| Viewport | CSS size | What it records |
|---|---:|---|
| wide landscape | 1180×820 | full content and modal journey |
| mid landscape | 1024×768 | full content and modal journey |
| short landscape | 852×393 | compressed command/content layout |
| tablet portrait | 1024×1366 | portrait scroll and modal layout |
| phone portrait | 393×852 | narrow content, overflow, and action reachability |

The journey index covers:

- Title and More menu; v1→v2 settings migration, malformed-settings recovery,
  reload persistence, and default-off/explicit-on scanner capability states;
  empty Replay and Incubator states;
- My Mobies, owner MobCard, growth progress, Card Library add/QR/invalid
  import error, Move Trainer, Partner Skills, Dex and registered filter,
  Achievements and claim, ready egg and hatch reveal,
  Save idle/busy/result/malformed-legacy-error/older-compare/backup-restore
  with a legacy model entry checksum-only fixture, and
  Settings;
- Region Select, wild Encounter and target card, Team Select and matchup
  advice, battle handoff, artwork failure fallback, recoverable error, and
  `ABORT_BATTLE` leave;
- wild win/capture, arena/practice win, tower setup, tower win, tower loss,
  `TOWER_CONTINUE`, ordinary loss, `PLAY_AGAIN`, and populated Replay plus
  Replay Player. The populated replay is produced by a real QTE turn through
  the battle runtime session.

For every captured checkpoint the catalog records its legal next actions. The
metrics add point-in-time observations for:

- document/body horizontal overflow and the primary scroll owner;
- fixed/sticky elements and possible action/content overlap;
- active focus, modal containment, and Escape behavior where exercised;
- key DOM counts, artwork load/failure/fallback indicators, localStorage keys,
  IndexedDB names, and loaded JS resource URLs;
- no-model UI controls, exported zip entry names, and the retired `mz-models`
  sentinel's keys, bytes, timestamp, count, and operation counters;
- console/log errors, unhandled exceptions, and network load failures.

The Save busy checkpoint briefly holds the real Web Share boundary in the
browser so the UI's `處理中…` disabled state is observable; it then releases
that same boundary and records the normal download/share result.

The baseline records the scanner capability boundary from the default-off
state. Settings v2 keeps `scannerEnabled` false until the player explicitly
turns it on; the default Tools menu therefore has no scanner entry and does
not load the scanner chunk or request camera permission. The scanner modal is
an explicit lazy action after enabling the preference, and its existing
unsupported/denied/manual-code fallback remains the camera boundary.

## State and authority inventory

| Surface | State/setup | Authority and next step |
|---|---|---|
| Title | loaded | `START`, or open the two-level `ToolsMenu` |
| Region Select | loaded | `SELECT_REGION`, `OPEN_TOWER`, or `BACK` |
| Encounter | loaded; optional wild supply | `ENGAGE`, `BACK`, target `MobCard`, or choose supply |
| Team Select | loaded; advice and 3-card selection | `SELECT_TEAM`, `BACK`, or `顯示建議` |
| Battle | renderer handoff; compatibility/artwork fallback | battle commands, `ABORT_BATTLE`, or result handoff |
| Wild result | win/capture path | capture, `PLAY_AGAIN`, or `TO_REGIONS` |
| Arena result | practice EXP-only win | `PLAY_AGAIN` or `TO_REGIONS` |
| Tower result | win/loss settlement | `TOWER_CONTINUE` on win or `TOWER_QUIT` |
| Replay | lazy load, empty, populated, player | wait, open event stream, export/report, delete, or close |
| Incubator | empty, ready, hatch reveal | obtain egg, hatch when ready, or close |
| Card Library | populated, add panel, QR, invalid import | add/import/print or close |
| Save | idle, export busy, export result | wait for export, inspect no-model download, import, restore, or close |
| Scanner | default-off entry absent; explicit on state can open lazy modal | `scannerEnabled` controls entry/chunk; camera request only after selecting it |

The script catalog is the executable form of the route/event/storage/lazy
boundary index. Relevant persisted namespaces are intentionally visible by
name in evidence while their values remain application-owned:

- localStorage: `mobie.roster.v2`, `mobie.meta.v1`, `mobie.incubator.v1`,
  `mobie.settings.v1` (read-only migration source), `mobie.settings.v2`,
  `mobie.skillpoints.v1`, `mobie.playerskills.v1`,
  `mobie.itembag.v1`, `mobie.run.v1`, and `mobie.savemeta.v1`;
- IndexedDB: `mz-cards`, `mz-replays`, retired `mz-models` sentinel storage, and save backup storage;
- lazy boundaries: utility modals, `qrcode`, `fflate`, capability-gated
  `CardScannerModal`/`jsqr`, `CaptureStage`, and the M23 `NextBattleScene` entry;
  `ReplayPlayerModal` is a nested child of its already lazy `ReplayListModal` entry.

The retired `mz-models` store is seeded only by the baseline harness with a
sentinel record. The app journey must leave its keys, bytes, timestamp, and
count unchanged, with zero observed open, transaction, read, write, or delete
operations. Legacy save model bytes are a checksum-only fixture and are never
returned to runtime storage.

The baseline is diagnostic evidence. It does not claim iPad Safari support,
hardware performance, long-duration heap stability, or thermal qualification;
those remain separate release/device gates.
