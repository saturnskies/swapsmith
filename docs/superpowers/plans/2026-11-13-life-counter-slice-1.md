---
description: Plan for Life Counter slice 1 — the tab opens straight into a saved default 2-player 40-life game, New game and Defaults sheets replace the setup screen, reset needs no confirm (with an undo toast), face-to-face 2-player layout checked; four test-gated tasks
status: done
updated: 2026-11-13
---

# Life Counter slice 1: default game on open

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Opening the Life Counter tab shows a playable game at once (2 players, 40 life unless the owner changed the default). The setup screen is gone: **New game** and **Defaults** are sheets in the game menu. Resetting life totals no longer asks first.

**Architecture:** Pure changes in `src/lib/life.ts` (new `defaults` on the store, default player count 2) and `src/lib/nav.ts` (`#/life` is the game). `src/ui/life.ts` creates the default game on first show, replaces `drawSetup` with two dialogs that share one players-and-life form, and drops the reset confirm for an in-memory undo toast. No network, no new storage key.

**Tech Stack:** TypeScript, Vite, Vitest (`tests/unit/`), Playwright (`tests/e2e/`).

**Spec:** [Life Counter art revamp](../specs/2026-11-13-life-counter-art.md), "Opening and defaults". Slices 2–4 (art, profiles, death) are out of scope here.

## Global Constraints

- Keep the `swapsmith:life` key and `version: 1`. The new `defaults` field is additive; a store without it loads with `{players: 2, startingLife: 40}`. Never touch `swapsmith:v1` (Android data-safety rule in CLAUDE.md).
- A saved game is never replaced except by New game. No idle timer, no reset on launch ("never auto-reset", owner's call on 2026-11-13).
- Nothing is written to storage until the Life Counter tab is first shown.
- Existing saved games, names, colors, poison and commander damage keep working unchanged (sanitizer tests stay green).
- Every doc under `docs/` starts with front matter; run `tools/doc-index.sh` after changing one.

## Decisions this plan makes (owner can overturn)

1. **New game still asks** "Replace the game in progress?" It discards a whole game including names and counters. Only the reset-life-totals check goes, as asked.
2. **Reset is undoable by a toast**, not by the history list. The spec said "Undo already covers a slip", but `resetGame` empties history, so it does not. The toast ("Life totals reset" + Undo, about 8 s) holds an in-memory snapshot and is lost on reload.
3. **"Leave game" goes to Decks (`#/`)**, since the game is now the Life Counter's only screen and the tab bar stays hidden in it (2026-11-04 spec). Android back from the game also goes to `#/`.
4. **New game and Defaults edit players and starting life only.** Names and colors keep their own place (Edit names & colors, remembered in `store.setup`).

## Reuse ladder (rungs that held)

- Rung 2 (in the repo): `segmented`, `parseStartingLife`, `confirmDialog`, `newGame`, `lifeRoute` and the `.picker` dialog styling are extended, not replaced. `seating(2)` already returns `{top: [1], bottom: [0]}` with the top tile rotated 180°, so the face-to-face layout needs no new code, only a test.
- Rung 2 declined: the Life Counter toast is hand-built rather than reusing `src/ui/undoToast.ts`, because that one is a fixed bottom host with tab-bar offsets and the tab bar is hidden in a game.
- Rung 4 (platform): `<dialog>` for both sheets, as the menu already does.

## Execution Routing

| Work | Who | Model | Effort |
|---|---|---|---|
| Task 1 (lib, unit tests) | worker agent | sonnet | high |
| Task 2 (UI, e2e helpers and specs) | worker agent | sonnet | high |
| Task 3 (reset toast) | worker agent | sonnet | high |
| Task 4 (layout check, docs) | worker agent | sonnet | medium |
| Gate after each task | shell: `npm run check` | none | none |
| Review | `/go` code review | sonnet | high |

## Task 1: Defaults and the route live in the pure layer

**Files:** `src/lib/life.ts`, `src/lib/nav.ts`, `tests/unit/life.test.ts`, `tests/unit/nav.test.ts`

- [ ] **Step 1: Failing tests first.**
  - `DEFAULT_PLAYERS` is 2; `defaultSetup()` and `emptyLife()` give 2 players, 40 life.
  - `emptyLife().defaults` equals `{players: 2, startingLife: 40}`.
  - `loadLife` on a store saved without `defaults` returns the default pair (older saves keep working); with `defaults: {players: 4, startingLife: 30}` returns them.
  - Sanitizer cases, each falling back to the default pair or clamping, never throwing: `players: 0`, `7`, `"2"`, `null`, `2.6`; `startingLife: 0`, `1000`, `NaN`, a string; `defaults` itself `null`, an array, a number.
  - `lifeRoute('#/life')`, `lifeRoute('#/life/game')` and `lifeRoute('#/life/anything')` all return `'#/life/game'`; `backTarget('/life/game')` returns `'#/'`.
  - `gameFromDefaults(store)`: players and life from `defaults`, names and colors from `store.setup` by seat index, past the saved list falling back to "Player N" and the seat color.
- [ ] **Step 2: Run, see them fail** (`npx vitest run tests/unit/life.test.ts tests/unit/nav.test.ts`).
- [ ] **Step 3: Implement.**
  - `export interface Defaults { players: number; startingLife: number }`; `LifeStore` gains `defaults: Defaults`; `DEFAULT_PLAYERS = 2`; `sanitizeDefaults(raw)` reusing `whole` and the clamps `sanitizeSetup` already applies; wire it into `loadLife` and `emptyLife`.
  - `gameFromDefaults(store: LifeStore): Game` calling `newGame({ ...store.setup, players: d.players, startingLife: d.startingLife })`.
  - `lifeRoute(route)` returns `'#/life/game'` (drop the `hasGame` parameter and update callers); `backTarget` returns `'#/'` for `/life/game`.
- [ ] **Step 4: Run the unit suite and `npm run typecheck`.** Expect green, apart from callers fixed in Task 2.
- [ ] **Step 5: Commit** `src/lib/life.ts` and its test, then `src/lib/nav.ts` and its test, as separate commits.

**Failure paths (each tested above):** garbage in the saved `defaults`; a store from before this change; a store from a newer version (`future` stays untouched and is not overwritten by the default game).

## Task 2: The tab opens the game; New game and Defaults are sheets

**Files:** `src/ui/life.ts`, `src/ui/app.ts`, `src/ui/native.ts` (comment), `src/style.css`, `tests/e2e/life-helpers.ts`, `tests/e2e/life.spec.ts`, `tests/e2e/life-counters.spec.ts`, `tests/e2e/life-players.spec.ts`, `tests/e2e/tabs.spec.ts`

- [ ] **Step 1: Failing e2e tests first** (`tests/e2e/life.spec.ts`).
  - Fresh storage, open `#/life`: the URL becomes `#/life/game`, two tiles show 40, no "Start game" button anywhere. Tab bar and header are hidden.
  - Tapping the Life Counter tab from Decks lands on the same game.
  - Change a life total, go to Decks and back: the total is kept. Reload on `#/life/game`: kept.
  - Menu → **Defaults**: pick 4 players and 30 life, Save defaults. A fresh New game then starts with 4 players at 30; the game already in progress is untouched.
  - Menu → Defaults → "Use this game's setup" copies the current players and life into the form.
  - Menu → **New game** → Start while a game exists asks "Replace the game in progress?"; "Keep current game" leaves it, "Replace it" starts a fresh one from the form. The New game form starts from the defaults and changing it does not change the saved defaults.
  - Custom starting life: `0`, `1000`, `abc`, empty all disable Start/Save, set `aria-invalid` on the field and `aria-describedby` to the hint; `1` and `999` are accepted.
  - Menu → Leave game goes to Decks. Android back (`backTarget`) from the game goes to Decks.
  - A store saved by the old app (setup with `players: 4`, a live game, no `defaults`) still opens that game, and a New game uses the 2-player default.
  - Storage blocked: the default game still plays and the "won't survive closing" notice shows (existing banner, kept in the menu).
- [ ] **Step 2: Update helpers.** `start(page, opts)` opens `./#/life`; when `players` or `life` is given it opens Menu → New game, picks them and presses Start (no confirm appears on a pristine default game, so the helper handles the confirm only if shown). Remove `begin`; update call sites in the four specs; delete assertions about the setup screen and "Resume game".
- [ ] **Step 3: Run, see the new tests fail and the old ones fail for the right reason.**
- [ ] **Step 4: Implement.**
  - `createLife` gains `ensureGame()`: if `store.game` is null and no newer-version save is present, `store.game = gameFromDefaults(store)` and `persist()`. `app.ts` calls it when the life tab is about to show, before `lifeRoute`, and uses the one-argument `lifeRoute`. `last.life` starts as `'#/life/game'`.
  - Delete `drawSetup`, `begin` and the setup-only state (`custom`, `customText` move into the form below). `render` always calls `drawGame`.
  - One `setupForm(initial: Defaults, onValid)` function that returns the players `segmented`, the starting-life `segmented` with Custom and its field, and a validity callback; both sheets use it. `aria-invalid` and `aria-describedby` follow the "form problems" rule in `.claude/rules/ui-state.md`.
  - **New game** dialog: form plus Start; Start asks `confirmDialog` first (the game exists), then `store.game = newGame({...store.setup, players, startingLife})`, `store.setup` players and life updated, `persist()`, `drawGame`.
  - **Defaults** dialog: form plus "Use this game's setup" and Save defaults; Save writes `store.defaults`, `persist()`, and says "Saved" in an always-present `role=status`.
  - Menu actions become: Undo, Roll for first player, New game, Defaults, Edit names & colors, Reset life totals, Leave game, Close. "Leave game" links to `#/`.
  - Close any open sheet when the game view redraws or the tab hides (`ui-state.md`: modal left open in a hidden tab).
  - Update the comment in `native.ts` to the new back chain.
- [ ] **Step 5: Run `npm run check` (typecheck, unit, e2e).** Expect green.
- [ ] **Step 6: Commit per file** with specific messages.
- [ ] **Step 7: Exercise it as a user** (background dev server, phone-size viewport): fresh profile, tap the tab, play, switch tabs, reload, change defaults, new game. Screenshot at `deviceScaleFactor: 2` once for the PR.

**Failure paths (each with a test):** the Defaults form submitted while invalid; New game confirmed after the game was replaced meanwhile (re-read `store.game` after the confirm); two sheets opened by double tap (one dialog at a time); `ensureGame` called twice; storage throwing on `persist()`.

## Task 3: Reset without a confirm, with an undo toast

**Files:** `src/ui/life.ts`, `src/style.css`, `tests/e2e/life-counters.spec.ts`

- [ ] **Step 1: Failing e2e tests first.**
  - Menu → Reset life totals resets every total, poison and commander damage at once, the menu closes, and no confirm dialog appears at any point.
  - A `role=status` toast reads "Life totals reset" with an Undo button; pressing it restores the exact previous game (life, poison, commander damage, partner flags, who goes first, undo history). The toast disappears after about 8 s (use Playwright's clock) and on the next change to the game.
  - After the toast is gone, Undo in the menu no longer restores the reset (history stays emptied, as today).
  - Reset twice in a row: the toast's Undo restores the state before the second reset only (the first reset's snapshot is gone), and nothing throws.
  - The empty toast slot stays in the accessibility tree (1px clipped box), checked by a DOM test, per `ui-state.md`.
- [ ] **Step 2: Run, see them fail.**
- [ ] **Step 3: Implement.** In `drawGame`, `let resetSnapshot: Game | null`; the reset button stores `structuredClone(store.game)`, applies `resetGame`, closes the menu, shows the toast and starts a timer owned by this draw id (bail when `drawId` moved on). Any `adjust`, roll, edit, or new game clears the snapshot and the toast. Toast Undo restores the snapshot, `updateAll`, `refreshUndo`, `persist`. The Reset button no longer uses `confirmDialog`; `confirmDialog` stays for New game.
- [ ] **Step 4: Run `npm run check`.**
- [ ] **Step 5: Commit.**

**Failure paths:** the toast's Undo pressed after the game was replaced by New game (snapshot cleared, button gone); timer firing after a redraw (draw-id guard, tested by forcing a redraw before the timeout).

## Task 4: Two-player layout check and docs

**Files:** `tests/unit/life.test.ts`, `tests/e2e/phone-layout.spec.ts`, `docs/superpowers/specs/2026-11-04-tab-bar-life-counter.md`, `docs/superpowers/specs/2026-11-13-life-counter-art.md`, `docs/INDEX.md`, `CLAUDE.md` (only if a line goes stale)

- [ ] **Step 1: Tests.** Unit: `seating(2)` is `{top: [1], bottom: [0]}`. E2E at a 390×844 viewport: the default game has two tiles stacked, the top one `data-rotate="180"`, each at least 40% of the viewport height, the life number and both buttons at least 44 px tall and not clipped, the menu button reachable in the middle. Also at 360×640.
- [ ] **Step 2: Fix any layout fault the tests find** in `src/style.css` (expected: none).
- [ ] **Step 3: Docs.** Mark the 2026-11-04 spec's setup-screen and Resume sections as changed by this plan (a short "Changed on 2026-11-13" note linking the new spec, not a rewrite); in the art spec, set the reset line to "undo toast" and record decisions 1–4 above as made. Run `tools/doc-index.sh`, then `tools/doc-index.sh --check`.
- [ ] **Step 4: `npm run check`, then `/go`** (verify, review, simplify). Open the PR only when the owner asks.

## Review Focus

Correctness of the saved-store round trip (old stores, newer-version stores, blocked storage); that nothing replaces a game except the confirmed New game; modal dialogs closed when the tab hides; every `await`-free timer guarded by the draw id; accessibility of the sheets and toast; no setup-screen leftovers (grep `Start game`, `Resume game`, `drawSetup`, `#/life'` in `src/`, `tests/` and `docs/`).

## Follow-ups (not in this slice)

- A way back to the other tabs from the game without opening the menu (the bar stays hidden for now).
- Defaults remembering a profile per seat (after slice 3).
- Deck-style backup of the Life Counter store (already a follow-up in the 2026-11-04 spec).
- Leave game and Android back go to `#/`, not to the deck screen Decks last showed, so a deck left open loses its place (decision 3). Consider returning to `last.decks`.
- The spec's "Make current setup the default" is built as "Use this game's setup", which fills the Defaults form and still needs Save defaults.
- At 4 players on 360×640 the Menu button's edge overlaps the top-right corner of Player 1's Counters button (also at the base commit). Same padding trick as the 1-player corner menu, plus a test.
- `Setup.players` and `Setup.startingLife` are still written by New game but no longer read; drop them when slice 3 touches the store.
