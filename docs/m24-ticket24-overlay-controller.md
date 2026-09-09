# M24 Ticket 24 — OverlayController and ModalSurface

Ticket 24 gives the AppShell one owner for non-battle overlays. `ui/shell/OverlayController.tsx` keeps
the route-scoped stack and exact invoker, and exposes `open`, `push`, `pop`, and `close`. `pop` returns to
the parent entry, while `close` clears the stack and restores the root invoker. A route change
clears the stack without restoring focus into the previous screen. Nested utility details therefore
replace the active surface through the stack rather than mounting a second top-level backdrop.

`ui/shell/ModalSurface.tsx` is the shared portal surface. It renders the labelled dialog header,
description, scroll-owning body, and optional footer; marks the application root inert; locks body
scroll; traps focus; restores standalone invokers when a screen owns a surface directly; and applies the
declared `escape-and-backdrop`, `escape-only`, or `explicit-action-only` dismiss policy. Tool contents
continue to own their stores and actions. BattleScreen keeps its battle-specific overlay transitions.

The More menu is grouped into **成長與收藏** and **資料與設定**. It focuses the first enabled tool on
open. More→Settings closes the menu while retaining the More button as the invoker, so close, Escape,
and backdrop dismissal all return focus to that button. Settings keeps its long preference list in the
surface body while the footer remains visible.

Run the focused evidence with a local Vite server and an isolated Chrome CDP target:

```bash
npm run baseline:m24-overlay -- --port=9222
```

The runner writes screenshots, metrics, and Chrome AX snapshots under the ignored
`test-runs/m24/ticket24-overlay/` directory. It covers grouped More focus, Settings dialog semantics,
root inertness, keyboard cycling, body-only scrolling, footer visibility, Escape/backdrop restoration,
route-change cleanup, and nested Team detail push/pop. The Chrome run is functional evidence; physical
iPad Safari remains a separate release gate.
