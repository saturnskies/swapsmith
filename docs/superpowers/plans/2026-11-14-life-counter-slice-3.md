---
description: Plan for Life Counter slice 3 — saved pod profiles (name, card art, accent colour) picked per seat, kept in the Life Counter store and carried in deck backup and restore; three test-gated tasks
status: draft
updated: 2026-11-14
---

# Life Counter slice 3: pod profiles

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The owner and their pod save each player once (name, art, accent colour) and drop that player into any seat in one tap, and the profiles survive reinstalling through Back up / Restore.

**Architecture:** A pure module `src/lib/profiles.ts` (profile type, sanitizer, add/rename/delete, apply-to-seat, merge). `LifeStore` gains an optional `profiles` array (same key `swapsmith:life`, still `version: 1`). The Life screen gets "Save as profile" and "Use profile" on each seat's edit row plus a Profiles list in the game menu to rename or delete. The backup file gains an optional top-level `profiles` field; restore merges by id and never deletes. Profile art is the same `ArtRef` slice 2 stores; image bytes are not in the backup, they are fetched again from the art host when a restored profile is used.

**Tech Stack:** TypeScript, Vite, Vitest, Playwright, existing `src/ui/artStore.ts`. No new dependency.

**Spec:** [Life Counter art revamp](../specs/2026-11-13-life-counter-art.md), "Profiles". Slices 1 and 2 are on this branch ([slice 2 plan](2026-11-13-life-counter-slice-2.md)).

## Global Constraints

- Keep `swapsmith:life` at `version: 1`; `profiles` is optional and sanitized, an older store loads unchanged. Never touch `swapsmith:v1`, the package id `io.github.saturnskies.swapsmith` or any Android file.
- A profile is `{ id, name, art?, accent? }`. At most **12** profiles; `name` trimmed, 1 to `MAX_NAME` (24) characters; `accent` a `#rrggbb` string; `art` passes `sanitizeArt`. Anything else in stored or backup data is dropped, never thrown on.
- The backup file keeps `backup: 1` and `store` exactly as today; `profiles` is an extra optional field, so an older app restores the decks and ignores it, and an older file restores with no profile change.
- Restore never deletes: a profile in both keeps the current copy; profiles only in the backup are added up to the cap of 12 (the rest are skipped and counted in the message).
- Profiles are included in backup; no link or QR sharing (spec).
- Art for every profile is in the image cache's keep set (profile art ids join the seats' and the remembered setup's), so saving other art never evicts a profile's image while room can be made elsewhere.
- Applying a profile whose image is not cached fetches it through `artStore.save`; if that fails (offline, storage blocked) the seat still gets name and accent, shows the accent colour, and a notice says the art is unavailable. Nothing throws.
- Names and card text go into the page with `textContent`, never `innerHTML`.
- Tap targets 44 px, text 4.5:1, focus returns to the control that opened a dialog; no animation added.
- Every doc under `docs/` starts with front matter; run `tools/doc-index.sh` after changing one.

## Decisions this plan makes (owner can overturn)

1. **"Defaults remember a profile per seat" stays out** (spec: not until asked).
2. **Using a profile copies it onto the seat**, it does not link: later edits to the profile do not change a game in progress, and editing the seat does not change the profile. Cost if wrong: a rename in Profiles does not show on a seat already playing.
3. **Deleting a profile never deletes its image**; it simply stops being protected from eviction (answers the spec's open item).
4. **Backup carries art references, not image bytes**, to keep the file small and stay inside the host allow-list. Cost: a restored profile needs a connection once to show its art again.
5. **Profile ids** are `p` + 8 random hex characters from `crypto.getRandomValues`; collision is checked on add.
6. Saving a seat whose name is empty or the default "Player N" is refused with "Give this player a name first".

## Review Focus

- A backup or store with 500 profiles, duplicate ids, a 10 KB name or a non-hex accent: capped, deduplicated, trimmed or dropped, and the Life Counter still opens.
- Restore of a file with no `profiles` field, or `profiles` that is not an array: decks restore as before, profiles unchanged.
- Restore when the pod is full (12): nothing lost, the message says how many were skipped.
- Apply a profile whose art was evicted and the phone is offline: name and accent apply, tile shows the accent, notice shown.
- Two seats given the same profile: both work, one image row, and removing art from one seat does not delete the other's image.
- Delete a profile that a seat in the current game was copied from: the seat keeps its name, art and accent.

---

## File Structure

- Create `src/lib/profiles.ts`, `tests/unit/profiles.test.ts`: the pure layer.
- Modify `src/lib/life.ts`: `LifeStore.profiles?`, `sanitizeProfiles` call in `loadLife`, `emptyLife`.
- Modify `src/lib/backup.ts`, `tests/unit/backup.test.ts`: `profiles` in the file, `readBackupProfiles`.
- Modify `src/ui/life.ts`, `src/style.css`: save/use/manage UI, keep set.
- Create `src/ui/profilePicker.ts`: the "Use profile" dialog (one job, keeps `life.ts` from growing further).
- Modify `src/ui/app.ts`, `src/ui/backup.ts`: hand the backup section a profiles handle.
- Create `tests/e2e/life-profiles.spec.ts`; extend `tests/e2e/backup.spec.ts` (or the existing backup spec's name).
- Docs: the art spec, `CLAUDE.md`, `docs/INDEX.md`.

---

### Task 1: Profiles in the store and the backup file (pure)

**Files:**
- Create: `src/lib/profiles.ts`, `tests/unit/profiles.test.ts`
- Modify: `src/lib/life.ts`, `src/lib/backup.ts`, `tests/unit/life.test.ts`, `tests/unit/backup.test.ts`

**Interfaces:**
- Produces (`src/lib/profiles.ts`):
  - `interface Profile { id: string; name: string; art?: ArtRef; accent?: string }`
  - `const MAX_PROFILES = 12`
  - `sanitizeProfiles(x: unknown): Profile[]` (drops bad entries, dedupes by id keeping the first, trims names, caps at 12)
  - `profileFromSeat(player: Player, id: string): Profile | null` (null when the name is empty or the default)
  - `addProfile(list: Profile[], p: Profile): Profile[] | null` (null when full or id taken)
  - `renameProfile(list, id, name): Profile[]`, `deleteProfile(list, id): Profile[]`
  - `applyProfile(game: Game, seat: number, p: Profile): Game` (copies name, art, accent; clears art/accent the profile lacks; same bounds as `setName`/`setArt`/`setAccent`)
  - `mergeProfiles(current: Profile[], incoming: Profile[]): { profiles: Profile[]; added: number; skipped: number }`
  - `newProfileId(draw?: () => number): string`
- Produces (`src/lib/life.ts`): `LifeStore.profiles?: Profile[]`, kept through `loadLife`/`saveLife`.
- Produces (`src/lib/backup.ts`): `makeBackup(store: Store, now?: Date, profiles?: Profile[]): string` writes `profiles` only when non-empty; `readBackupProfiles(text: string): Profile[]` (never throws on a missing or odd field; throws `BackupError` exactly when `parseBackup` would).

- [ ] **Step 1: Write the failing tests** in `tests/unit/profiles.test.ts`: `sanitizeProfiles` drops a non-object, a missing name, a 10 KB name (trimmed to 24), a non-hex accent (accent dropped, profile kept), an art with a bad host (art dropped), a duplicate id; 500 entries give 12. `profileFromSeat` returns null for `''` and for the default `Player 2`. `addProfile` returns null at 12 and for a taken id. `applyProfile` onto a seat that had art and accent clears them when the profile has none; applying never changes other seats. `mergeProfiles` keeps the current copy on a shared id, adds new ones, and reports `skipped` when over 12. In `life.test.ts`: a store saved without `profiles` loads with none; one with junk loads clean; round trip keeps them. In `backup.test.ts`: `makeBackup` with profiles then `readBackupProfiles` round-trips; a file with `profiles: "x"` or no field gives `[]`; `readBackupProfiles('not json')` throws `BackupError`; `parseBackup` of a file with profiles still returns the same `Store` as before.
- [ ] **Step 2: Run** `npx vitest run tests/unit/profiles.test.ts tests/unit/life.test.ts tests/unit/backup.test.ts`. Expected: FAIL (module and exports missing).
- [ ] **Step 3: Implement** `src/lib/profiles.ts` as above, reusing `sanitizeArt`, `sanitizeAccent`, `MAX_NAME` and the game setters from `src/lib/life.ts` (no second copy of their rules). `newProfileId` uses `crypto.getRandomValues` (the `uint32` helper if it is exported).
- [ ] **Step 4: Wire** `LifeStore.profiles?` through `loadLife` (via `sanitizeProfiles`) and keep `saveLife` writing it; add the `profiles` field to `makeBackup` and `readBackupProfiles` to `backup.ts`.
- [ ] **Step 5: Run** the three test files, then `npm run typecheck`. Expected: PASS.
- [ ] **Step 6: Commit**, one commit per file, tests first.

---

### Task 2: Save, use and manage profiles on the Life screen

**Files:**
- Create: `src/ui/profilePicker.ts`, `tests/e2e/life-profiles.spec.ts`
- Modify: `src/ui/life.ts`, `src/style.css`

**Interfaces:**
- Consumes: Task 1's `Profile`, `profileFromSeat`, `addProfile`, `renameProfile`, `deleteProfile`, `applyProfile`, `newProfileId`; slice 2's `artStore.save(ref, keep)`, `artStore.url`, the existing `remember`/`persist`/`exclusive` helpers in `createLife`.
- Produces:
  - `openProfilePicker(o: { host: HTMLElement; profiles: Profile[]; label: string; onPick(p: Profile): void }): void` in `src/ui/profilePicker.ts` (a dialog listing profiles as buttons, each showing the name and a swatch of its accent; empty list says "No saved players yet. Use Save as profile on a seat.").
  - `Life.profiles(): Profile[]` and `Life.mergeProfiles(incoming: Profile[]): { added: number; skipped: number }` for the backup section (Task 3).
- Behaviour: each seat's edit row gets **Save as profile** and **Use profile**; the game menu gets **Profiles** (list with Rename and Delete, Delete has no confirm and an 8 s undo toast like Reset). Saving then using are persisted with `persist()`. The keep set in the pick flow (`life.ts` ~667) also includes every profile's art id.

- [ ] **Step 1: Write the failing e2e tests** in `tests/e2e/life-profiles.spec.ts` (desktop and phone, fixtures answer Scryfall, reuse the slice 2 helpers `mockArt`, `editPlayers`, `tile`): (a) name seat 1 "Edgar", pick art, tap Save as profile; open seat 2's Use profile and see "Edgar"; pick it; seat 2's tile shows the name and the same art and accent. (b) Save as profile on a seat named "Player 1" shows "Give this player a name first" and saves nothing. (c) Profiles survive reload and a New game. (d) Rename in the menu changes the list, not a seat already playing; Delete removes it and shows the undo toast, Undo brings it back; deleting leaves the seat copied from it intact. (e) A 13th save is refused with a visible message. (f) Offline (route abort) after the image row is removed: Use profile gives name and accent, accent-coloured tile and the notice. (g) Two seats on the same profile, Remove art on one leaves the other's tile art. (h) a name like `<img src=x onerror=alert(1)>` appears as text in both lists. (i) the Profile dialogs are 44 px tall rows, focus returns to the opener on close.
- [ ] **Step 2: Run** `npx playwright test tests/e2e/life-profiles.spec.ts --trace off`. Expected: FAIL.
- [ ] **Step 3: Implement** `src/ui/profilePicker.ts` and the wiring in `src/ui/life.ts` (apply goes through the same `exclusive` one-art-change guard as pick, random and remove; art re-fetch uses `artStore.save` with the full keep set and falls back to session-only/notice exactly as the pick flow does). Add `Life.profiles` and `Life.mergeProfiles`. Style in `src/style.css` with the existing tokens.
- [ ] **Step 4: Run** the new spec, then `npm run check`. Expected: PASS.
- [ ] **Step 5: Exercise it as a user** at 390×844 with touch against live Scryfall: save three players, start a new game, use each on a seat, reload; read screenshots.
- [ ] **Step 6: Commit**, one commit per file, tests first.

---

### Task 3: Profiles in Back up / Restore, and docs

**Files:**
- Modify: `src/ui/backup.ts`, `src/ui/app.ts` (pass a profiles handle: `{ get(): Profile[]; merge(incoming: Profile[]): { added: number; skipped: number } }` through `AppContext`), the backup e2e spec
- Docs: `docs/superpowers/specs/2026-11-13-life-counter-art.md` (Profiles "as built", status notes), `CLAUDE.md` (architecture lines for `src/lib/profiles.ts` and `src/ui/profilePicker.ts`, and the backup file's optional `profiles`), `docs/INDEX.md` via `tools/doc-index.sh`

**Interfaces:**
- Consumes: Task 1's `makeBackup(store, now, profiles)`, `readBackupProfiles`, Task 2's `Life.profiles` and `Life.mergeProfiles`.
- Produces: the Back up file includes profiles; the Restore message reads "Restored: N decks added, M updated, P player profiles added (S skipped, pod is full). Nothing was deleted." with the profile part only when profiles were in the file.

- [ ] **Step 1: Write the failing e2e tests**: save two profiles, Back up, read the downloaded JSON and see `profiles` with both and `store` unchanged in shape; clear storage, Restore, open Use profile and see both; restore an old file with no `profiles` field leaves existing profiles alone; restoring with 12 saved and 2 in the file shows "2 skipped"; a file whose `profiles` is junk restores the decks and says nothing about profiles.
- [ ] **Step 2: Run** the backup spec. Expected: FAIL.
- [ ] **Step 3: Implement** the wiring in `src/ui/backup.ts` and `src/ui/app.ts`. The backup button's status text counts profiles when there are any.
- [ ] **Step 4: Docs**: record Profiles "as built" in the art spec (including decisions 2 to 4 above), add the CLAUDE.md lines, run `tools/doc-index.sh` and `tools/doc-index.sh --check`.
- [ ] **Step 5: Run** `npm run check`. Expected: PASS. Then exercise Back up and Restore in the browser as a user.
- [ ] **Step 6: Commit**, one commit per file, tests first.

---

## Self-review

- **Spec coverage:** name + art + accent saved locally (Tasks 1, 2); picked per seat (2); in backup and restore (1, 3); no sharing (constraints); open item "deleted profile's cached art" (decision 3).
- **Types:** `Profile`, `mergeProfiles` and `Life.mergeProfiles` signatures match across tasks.
- **Proportion:** three tasks for one spec section; no code bodies beyond what the signatures leave open.
