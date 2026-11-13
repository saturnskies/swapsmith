---
description: Tab bar and Life Counter spec — bottom tabs (Decks, Browse, Life Counter) with hash routes and per-tab place, plus an offline 1–6 player life counter with commander damage, poison, undo, wake lock and a saved game
status: current
updated: 2026-11-04
---

# Tab bar and Life Counter: design spec

Part 1 of two (then Browse, its own spec and PR). Needs no network. Nothing here touches Scryfall or EDHREC.

## Problem

Swapsmith has one flow: Your decks → a deck. There is no top-level navigation, so a second and third section (Browse, Life Counter) has nowhere to live, and the Android back gesture only knows "deck → Your decks → exit" (`src/ui/native.ts`, `src/lib/nav.ts`).

## Goal

A bottom tab bar that keeps each tab's place, and a Life Counter that works on a phone lying flat on a table, offline, for a whole Commander game.

## Tab bar

- Three tabs with icon and label: **Decks**, **Browse**, **Life Counter**. Inline SVG icons from our own code (a small `svg()` helper next to `h()`, since `h()` makes HTML elements only); labels always shown.
- A `<nav aria-label="Main">` with real links (`<a href="#/…">`) and `aria-current="page"` on the active one. Sits at the bottom, `padding-bottom: env(safe-area-inset-bottom)`, and the page gets matching bottom padding so nothing hides behind it. Same bar on desktop widths.
- **Routes** (hash, so a reload stays put):

  | Route | Tab |
  |---|---|
  | `#/`, `#/new`, `#/paste`, `#/deck/<id>`, `#d=<share>` (all today's routes) | Decks |
  | `#/browse` (and later `#/browse/…`) | Browse |
  | `#/life` | Life Counter, setup screen |
  | `#/life/game` | Life Counter, game (bar hidden) |

  `tabOf(route)` and the new `backTarget` live in `src/lib/nav.ts` and are unit-tested; `app.ts` stays the only router.
- **Each tab keeps its place.**
  - Decks: remembers its last route and window scroll position. Switching away and back returns to the same deck at the same scroll.
  - Browse and Life Counter: each has its own container that stays mounted and is hidden (`hidden`) when another tab is active, so inputs, scroll and game state survive without any save code. Decks keeps today's re-render-on-route model; its container is the one that is cleared.
  - Tapping the tab you are already on goes to that tab's root and scrolls to the top (Decks → `#/`).
  - Reload restores the route only, by design; a reload on `#/life/game` resumes the saved game (below).
- **Android back** (`installNativeBack`): `#/life/game` → `#/life` → `#/`; `#/browse` → `#/`; deck screens → `#/` (as today); `#/` → exit the app. Open `<dialog>`s still close first. Browsers keep their own back.
- **Hidden in a game.** On `#/life/game` the tab bar and the site header are hidden so the tiles fill the screen. The game menu button (centre of the table, see below) has an always-visible "Leave game" entry that goes to `#/life`; the game is kept, not ended.
- **Until part 2 ships,** `#/browse` shows a placeholder page ("Browse is coming soon" with a link back to Decks). The tab, route, back behavior and kept-place container all exist now, so part 2 only fills the container.

## Life Counter

### Setup screen (`#/life`)

> **Changed on 2026-11-13:** there is no setup screen or Resume game any more. `#/life` opens straight into the game (a default 2-player 40-life game when none is saved), and the choices below live in the game menu's **New game** and **Defaults** sheets. Reset life totals no longer asks first (an undo toast covers it). See [Life Counter art revamp](2026-11-13-life-counter-art.md), "Opening and defaults". The rest of this section is the original design.

- **Players:** 1–6, segmented control (default 4). Names (default "Player N", max 24 characters) and a color per player. Names and colors are remembered for the next game.
- **Starting life:** segmented control 20 · 30 · 40 · Custom (default 40); Custom shows a number input, whole numbers 1–999, invalid input keeps Start disabled with a message.
- **Start game** goes to `#/life/game`. If a game is in progress the screen shows **Resume game** first and **New game** second (confirm in a dialog before it replaces the saved game).

### Game screen (`#/life/game`)

- **Seating.** One tile per player, turn order clockwise starting at the bottom left. Tiles are rows around the phone's long edges and rotate so each tile reads upright for the person sitting at it:

  | Players | Top row (rotated 180°) | Bottom row |
  |---|---|---|
  | 1 | — | 1 |
  | 2 | 1 | 1 |
  | 3 | 1 | 2 |
  | 4 | 2 | 2 |
  | 5 | 2 | 3 |
  | 6 | 3 | 3 |

  Each tile's content (not its box) carries the rotation, so the grid layout stays simple. There are no side seats (decided 2026-11-04). With one player the tile is upright.
- **Tile:** player name, large life total on the player's color, a `−` and a `+` button, and small badges for poison and commander damage.
- **Change life:** tap = ±1; hold (≥ 500 ms) = ±10, applied once when the hold registers (no auto-repeat). A hold never also applies the tap. Keyboard: Enter/Space = ±1, Shift+Enter/Space = ±10. Buttons have names like "Alex: gain 1 life". Total changes are announced with `aria-live="polite"` on the tile's total.
- **Poison:** a counter per player (0–99, no minimum below 0), ±1 in the tile's detail sheet. Shows "Poisoned out" warning style at 10, nothing else happens.
- **Commander damage.** Tapping a tile's commander-damage button opens that player's sheet (a `<dialog>`): one row per opponent, each with its own counter. A player can be marked **Partners** in the sheet (there is no setup toggle), which gives each opponent two rows (one per partner), tracked separately. Counters go from 0 up, ±1 / ±10 same as life. At 21 the row and the tile badge switch to a "Lethal" warning style (text plus color, not color alone). **Nothing is ever eliminated automatically.** Life ≤ 0 and poison ≥ 10 get the same warning style. The undo button still works and the player can keep going. Commander damage is tracked separately: changing it never changes life (decided 2026-11-04); players adjust life themselves.
- **Undo:** one button in the game menu, undoes the last life, poison or commander-damage change by anyone, most recent first, up to the last 50. Names, colors and first-player roll are not undoable. Disabled when there is nothing to undo.
- **Roll for first player:** game-menu item picks one player at random (`crypto.getRandomValues`, behind an injectable function so tests are deterministic), highlights that tile with a "Goes first" marker for the rest of the game (a reset clears it, so a restarted game rolls again). A short highlight animation, skipped under `prefers-reduced-motion`.
- **Game menu:** a round button at the centre of the table opens a `<dialog>` with: Undo, Roll for first player, Edit names & colors, Reset life totals (confirm), Leave game. Centre placement stays reachable from any seat; its label is upright for the bottom player.
- **Keep the screen awake:** the Wake Lock API (`navigator.wakeLock.request('screen')`) is requested when the game screen opens and released when it closes. The browser releases it when the page is hidden, so the lock is requested again on `visibilitychange` back to visible. Unsupported, or rejected (battery saver): the game works as normal and the setup/menu shows "Screen may turn off" once; nothing throws.

### Saved game

- State is saved after every change to its own key `swapsmith:life` (`{version: 1, game, setup}`), **not** inside `swapsmith:v1`. That keeps deck data, backup and restore untouched, so the Android data-safety rules (one signing key, package id, `swapsmith:v1` migration rule) are unaffected.
- Loaded through a sanitizer like `sanitizeStore`: wrong shapes, player counts outside 1–6, non-numeric totals and oversized names are dropped or clamped, never thrown on. A saved value that isn't valid JSON is copied to `swapsmith:life:backup` and treated as no game, as `loadStore` does.
- Storage blocked or full: the game still works; a one-line notice says it won't survive closing the app, same wording style as the existing storage banner.
- Not part of deck backup/restore (a game lasts hours; decks are what people lose). Recorded as a follow-up, not built.

## Code layout and reuse

Reuse ladder, rung that held in brackets.

- `src/lib/life.ts` — pure state and reducers: new game, change life / poison / commander damage, undo (history capped at 50), lethal-warning checks, seating layout per player count, sanitize/serialize. Unit-tested in `tests/unit/life.test.ts`. [rung 6, nothing like it exists]
- `src/ui/life.ts` — setup and game screens, built with `h()`, the segmented-control pattern from `suggestions.ts` (extracted to `src/ui/controls.ts` if two files need it, per "finish migrations"). [rungs 2 and 4: `h()`, `<dialog>`, `<input type=number>`, `<input type=color>` not used — a fixed swatch palette instead, see below]
- `src/ui/tabs.ts` — the nav bar and the per-tab containers; `src/lib/nav.ts` — `tabOf`, `backTarget`. [rung 2: extends `backTarget`]
- Colors: 8 fixed swatches, each checked in a unit test to reach 4.5:1 contrast for the white tile text (AA), so no custom picker and no unreadable tile.
- Storage helpers: `browserStorage()` from `src/lib/storage.ts` for the access; the life key and sanitizer live in `life.ts`. [rung 2]
- No new dependency.

## Failure paths (each gets a test)

- Wake Lock: unsupported API; `request()` rejects; the system releases the lock when the page is hidden (re-request on return); a second request while one is held (one lock at a time); lock released when leaving `#/life/game`.
- Saved game: storage blocked; storage full on save; invalid JSON; valid JSON with a bad shape (7 players, a string life total, history that isn't an array); a saved game from the future (`version: 2`) is ignored without being overwritten until the user starts a new game.
- Tap/hold: a hold followed by pointer release does not also apply the tap; pointer leaving the button cancels the hold; two fingers on two tiles at once change two players independently; touch scrolling is not blocked (`touch-action: manipulation`).
- Undo: empty history disabled; history cap; undo after a reset.
- Routes: unknown `#/life/x` falls back to `#/life`; `#/life/game` with no saved game redirects to `#/life`; reload on `#/life/game` with a saved game resumes it.
- Tab state: leaving a deck at scroll N and coming back restores it; hidden containers keep their DOM.
- Android back: each row of the back table; a dialog open closes first.

## Test plan

- **Unit:** `life.test.ts` (reducers, undo, lethal thresholds at 20/21, 9/10 and 1/0, partner pairs tracked separately, layout per player count, sanitizer, contrast), `nav.test.ts` (`tabOf`, `backTarget` table).
- **E2E, `--project=desktop` while iterating, both projects in `npm run check`:** `tests/e2e/tabs.spec.ts` and `tests/e2e/life.spec.ts`. Wake Lock is stubbed with `addInitScript`; no Scryfall mock is needed beyond what the Decks tab already uses. The e2e checks tile rotation through a `data-rotate` attribute and a computed-style check on one tile, plus a screenshot of the 4- and 6-player tables at a phone viewport that is looked at by hand (not asserted).
- **Manual:** the Android back gesture can't run in Playwright. `backTarget` is unit-tested and the listener is exercised in a debug APK build before release; noted in the PR.

## Slices (the plan file comes after this spec is approved)

1. **Tab bar + routes + per-tab place.** Bar, `tabOf`/`backTarget`, Decks scroll memory, a Life Counter tab with an empty setup screen, the Browse placeholder. Test-gated end to end including the reload and back cases.
2. **Setup, game screen, life ±1/±10, seating and rotation, saved game, resume.** The first playable game.
3. **Poison and commander damage (partners), lethal warnings, undo.**
4. **Names and colors, roll for first, game menu polish, Wake Lock.**

Every slice runs `npm run check` before commit; each part ends with `/go`.

## Decisions made while writing

Asked 2026-11-04 and settled: commander damage is separate from life; Browse shows a placeholder until part 2; seats on the long edges only.

## Out of scope

- Other counters (energy, experience, monarch, day/night), turn timer, dice other than the first-player roll, game history, sharing a game.
- Choosing a commander from a saved deck, which would need card lookups (this part needs no network).
- Including the saved game in deck backup/restore.
