---
description: Plan for Life Counter slice 4 — a seat that takes lethal damage (life 0, 10 poison, 21 from one commander) plays a blood splatter that settles into a skull while its art darkens and greys; reversible, reduced-motion safe, no network; two test-gated tasks
status: draft
updated: 2026-11-14
---

# Life Counter slice 4: death splatter and skull

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a player's life, poison or commander damage becomes lethal, their tile shows an SVG blood splatter that bursts and settles into a skull while the art goes dark and grey; undoing or healing above lethal restores the tile.

**Architecture:** `isDead(game, seat)` in `src/lib/life.ts` (the same three conditions `warnings` already lists; `warnings` reuses it). `updateTile` in `src/ui/life.ts` sets `data-dead` and plays the effect once per transition into death; the visuals are inline SVG plus CSS in `src/style.css`, no image or network. A short haptic buzz goes through `src/ui/native.ts` (Capacitor Haptics only if already a dependency, else `navigator.vibrate`).

**Tech Stack:** TypeScript, CSS animation, inline SVG, Vitest, Playwright. No new dependency.

**Spec:** [Life Counter art revamp](../specs/2026-11-13-life-counter-art.md), "Death".

## Global Constraints

- Lethal sources: life <= 0, poison >= `POISON_LETHAL` (10), commander damage >= `CMDR_LETHAL` (21) from one commander. Nobody is ever eliminated: counters keep working on a dead seat (spec: fully reversible; slice 1 rule "only a warning").
- About 1.2 s: splatter bursts over the art, then settles into a skull glyph; art desaturates (`grayscale`) and darkens. Plays once per transition into death, never on load, reload, tab switch or redraw of an already dead seat (a dead seat reloads already settled).
- Reversible: undo, or moving the counter back above lethal, fades the skull and restores the art within the same tile (no reload).
- `prefers-reduced-motion: reduce`: no burst; the settled skull and greyed art show immediately.
- Text on a dead tile keeps 4.5:1 (the life number and name over the darkened art); the skull and splatter are decorative (`aria-hidden`), the death is announced through the existing warning text and `data-dead`, plus an `aria-live` "Name is out" is NOT added (the warning text already reads).
- Works with no art (accent colour tile): same splatter and skull over the accent, tile greys.
- No network, no image file, no new font. Splatter and skull are inline SVG built with DOM calls, no `innerHTML` with game data.
- Android haptic: one short buzz (about 80 ms) on transition into death, only where the platform offers it; absence never throws.
- Keep `swapsmith:life` at version 1 (death is derived, never stored); never touch `swapsmith:v1`, the package id or Android files.
- Tap targets and layout unchanged; the effect never blocks the life buttons (`pointer-events: none` on the overlay).
- Every doc under `docs/` starts with front matter; run `tools/doc-index.sh` after changing one.

## Decisions this plan makes (owner can overturn)

1. Death is derived from the game on every redraw, not stored, so older saves and restores need no migration.
2. Settled dead state after a reload shows with no animation (the animation belongs to the moment of dying).
3. The splatter is one fixed SVG shape, rotated and scaled by a per-seat angle so seats differ a little; no randomness (tests stay deterministic).
4. No sound.

## Review Focus

- Dying twice in a row (life to 0, +1, to 0) plays the effect each time; changing other counters on an already dead seat does not replay it.
- Partner commanders: lethal from the partner slot (`slot: 1`) kills like any commander.
- Undo from dead to alive removes the skull and greying immediately; Reset removes it for everyone.
- A seat dead on load (saved at 0 life) shows settled, no animation, and the Life Counter opens normally.
- 6 seats and the rotated top row: the skull is not mirrored or clipped on rotated tiles; the life buttons still work under the overlay.
- Reduced motion with the page emulated: no animation, skull visible.

---

### Task 1: `isDead` and the death state on the tile

**Files:**
- Modify: `src/lib/life.ts`, `tests/unit/life.test.ts`, `src/ui/life.ts`, `src/style.css`
- Create: `tests/e2e/life-death.spec.ts`

**Interfaces:**
- Produces: `isDead(game: Game, seat: number): boolean` exported from `src/lib/life.ts` (`warnings` now calls it for the three lethal lines, wording unchanged).
- Tile contract: `data-dead="true|false"` on every tile element; `data-dying="true"` is set only for the animation window of a transition into death and removed on `animationend` or after 1300 ms, whichever comes first.

- [ ] **Step 1: Write failing tests.** Unit (`life.test.ts`): `isDead` is true at life 0, life -5, poison 10, commander 21 from slot 0, commander 21 from slot 1 (partner), false at life 1, poison 9, commander 20, false for a bad seat index; `warnings` output is unchanged for all of these. E2E (`life-death.spec.ts`, desktop and phone, reuse `life-helpers.ts`): taking a seat to 0 sets `data-dead="true"` and `data-dying="true"` then the latter clears within 2 s; +1 life clears `data-dead`; die, heal, die again sets `data-dying` again; changing poison on an already dead seat does not set `data-dying`; poison 10 and commander 21 each kill; Undo from dead restores; New game and Reset clear; reload of a saved dead game gives `data-dead="true"` and never `data-dying`; with `page.emulateMedia({ reducedMotion: 'reduce' })` the dead tile has the skull visible and computed `animation-name` is `none` on the overlay; a dead tile's life number and name keep 4.5:1 over bright white art and over no art (reuse the contrast helper from `life-art.spec.ts`); the life buttons are still clickable on a dead tile (`pointer-events` on overlay is `none`); a rotated top tile's skull is not clipped (its bounding box lies inside the tile's).
- [ ] **Step 2: Run** `npx vitest run tests/unit/life.test.ts` and `npx playwright test tests/e2e/life-death.spec.ts --trace off`. Expected: FAIL.
- [ ] **Step 3: Implement** `isDead` in `src/lib/life.ts`. In `updateTile` set `data-dead`; detect the transition by comparing the previous `data-dead` with the new one (first draw of a tile never counts as a transition). Build the overlay once per tile as inline SVG (`aria-hidden`, `pointer-events: none`): a splatter group and a skull group. CSS: `.tile[data-dead="true"]` gets `filter: grayscale(1) brightness(.55)` on the art layer (not on the text), a darkened scrim, skull opacity 1 and splatter opacity .85; `.tile[data-dying="true"]` runs the burst (scale 0.2 to 1.1 to 1, 1.2 s) then crossfades splatter to skull; the reverse fades in 300 ms; `@media (prefers-reduced-motion: reduce)` removes all animation and transition.
- [ ] **Step 4: Run** the unit and e2e specs, then `npm run check`. Expected: PASS.
- [ ] **Step 5: Exercise it as a user** at 390x844 touch with live art: kill a seat with art, one without, one rotated at the top, undo, reload; read screenshots taken mid-animation (about 300 ms) and settled.
- [ ] **Step 6: Commit** one commit per file, tests first.

---

### Task 2: Haptic buzz, docs

**Files:**
- Modify: `src/ui/native.ts`, `src/ui/life.ts` (call site), `tests/e2e/life-death.spec.ts`, `docs/superpowers/specs/2026-11-13-life-counter-art.md`, `CLAUDE.md`, `docs/INDEX.md`

**Interfaces:**
- Consumes: Task 1's transition detection in `updateTile`.
- Produces: `buzz(ms?: number): void` in `src/ui/native.ts` (default 80; uses `navigator.vibrate` when present, never throws, does nothing under reduced motion).

- [ ] **Step 1: Write the failing test**: stub `navigator.vibrate` with `page.addInitScript`; dying calls it once with 80; reload of a dead game, a counter change on a dead seat and healing do not call it; with reduced motion it is not called; a missing or throwing `vibrate` does not break the tile.
- [ ] **Step 2: Run** the spec. Expected: FAIL.
- [ ] **Step 3: Implement** `buzz` and call it from the transition branch only.
- [ ] **Step 4: Docs**: update the art spec "Death" as built (decisions above, and that Capacitor Haptics was not added), CLAUDE.md architecture line for the death effect, mark this plan done at the end, run `tools/doc-index.sh` and `--check`.
- [ ] **Step 5: Run** `npm run check`. Expected: PASS.
- [ ] **Step 6: Commit** one commit per file, tests first.

---

## Self-review

- **Spec coverage:** lethal sources, burst then skull, darker greyed art, once per death, no network, reversible, reduced motion, haptic (Tasks 1 and 2).
- **Types:** `isDead` and `buzz` signatures consistent across tasks.
- **Proportion:** two tasks for one spec section.
