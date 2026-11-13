---
description: Plan for Life Counter slice 2 — card art on any seat (search by name or artist with colour, type and legendary filters, random, cached offline), full-bleed art tiles that stay readable, and accent colours suggested from the art plus a custom picker; four test-gated tasks
status: draft
updated: 2026-11-13
---

# Life Counter slice 2: card art and accent colours

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Any seat can show the art of any Magic card, found by search or by dice, kept on the device so it works at a table with no signal, with an accent colour that suits it.

**Architecture:** A pure module `src/lib/art.ts` (art reference type, query builder, dominant colours, readable-colour adjustment, cache-eviction plan). `src/scryfall/art.ts` runs the search and random calls through the shared client. `src/ui/artStore.ts` saves the chosen image as a blob in its own IndexedDB database. `src/ui/life.ts` and a new `src/ui/artPicker.ts` draw the picker and the full-bleed tile. Player and setup records gain optional fields inside `swapsmith:life` version 1.

**Tech Stack:** TypeScript, Vite, Vitest, Playwright, existing `src/scryfall/` client. No new dependency (colour extraction is a small canvas read; `<input type="color">` is the custom picker).

**Spec:** [Life Counter art revamp](../specs/2026-11-13-life-counter-art.md), "Art" and "Accent colours". Slice 1 ([plan](2026-11-13-life-counter-slice-1.md)) is merged on this branch. Profiles (slice 3) and death (slice 4) are out of scope; art is per seat in the game and remembered for the next game like colours are.

## Facts checked live on 2026-11-13

- `cards.scryfall.io` art-crop images answer with `access-control-allow-origin: *` and a one-year cache, so the page can `fetch()` the bytes and keep them.
- `/cards/search?q=name:edgar&unique=art` returns one card per distinct artwork across all printings; each card carries `artist`, `illustration_id` and `image_status`, and its `image_uris.art_crop` (or the first face's).
- `a:"rebecca guay"` is the artist term and returned 174 cards with `unique=art`; `/cards/random` answers one card.
- The shared client caches `GET` replies for 24 h by path, so `/cards/random` would return the same card all day. Random must bypass the cache.

## Global Constraints

- All Scryfall calls go through `src/scryfall/` and its queue; the picker never calls `fetch` for the API directly. Image bytes come from `cards.scryfall.io` with plain `fetch` (the image CDN is not rate limited like the API).
- Keep `swapsmith:life` and `version: 1`; new fields (`Player.art`, `Player.accent`, `Setup.arts`, `Setup.accents`) are optional and sanitized, an older store loads unchanged. Never touch `swapsmith:v1`, the package id or Android signing files.
- Art images live only in the new IndexedDB database `swapsmith-art`, never in `localStorage`. The cache holds at most **24 images** and **8 MB**; the least recently used image not referenced by the current game or the remembered setup is deleted first. A single image over **600 KB** is refused, not cached.
- A tile with missing art (never cached, deleted, storage blocked) falls back to its accent colour; nothing throws.
- Text on a tile must stay at 4.5:1 or better over any art: a fixed black scrim of at least 60% opacity (white on 40% grey is 5.7:1), checked by a unit test of the constants, plus a screenshot check on a very bright image.
- Search terms come from the user: quote and escape them (reuse the `quote` helper in `src/lib/browse.ts`, exporting it if needed), keep the final query under `MAX_QUERY` (900) and show any `warnings` Scryfall returns instead of ignoring them.
- Respect `prefers-reduced-motion`; no animation is added in this slice.
- Credit (card name and artist) shows in the picker and in the seat's edit row, not on the tile.
- Every doc under `docs/` starts with front matter; run `tools/doc-index.sh` after changing one.

## Decisions this plan makes (owner can overturn)

1. **No separate "other printings" step.** The spec said tapping a card shows its printings' art. `unique=art` already returns each distinct artwork as its own grid cell, so one grid covers it. Cost if wrong: a card whose same artwork is reprinted shows once, which is what a person wants.
2. **Art is per seat in the game and remembered by seat for the next game** (like colours), until profiles arrive in slice 3.
3. **Accent is a hex colour** stored on the player (`accent`), overriding the palette swatch when set; the palette index stays so older stores and slice 1 behaviour are unchanged. A custom or suggested colour is darkened until white text reaches 4.5:1; the original is never shown as selected if it was changed.
4. **Random is unfiltered and instant** (owner's choice), but the result must have a usable art crop; a reply without one is retried once, then reports "Couldn't find art, try again".
5. **Entry point:** an **Art** button on each seat's row in the existing "Edit names & colors" sheet. No new menu item.
6. **Picker filters:** colour identity (W U B R G plus colourless, "includes" mode), card type chips (creature, land, artifact, enchantment, instant, sorcery, planeswalker), a Legendary toggle, and a name/artist switch for the text box. No set, rarity or price filters.

## Reuse ladder (rungs that held)

- Rung 2 (in the repo): `searchCards`-style call through the shared client, `COLORS`, `quote` and `MAX_QUERY` from `src/lib/browse.ts`, `contrastWithWhite` and `PALETTE` from `src/lib/life.ts`, `segmented` and the `.picker` dialog styling, the 24 h/7-day cache and queue in `src/scryfall/client.ts` (extended with one option, not copied).
- Rung 4 (platform): `<input type="color">`, `createImageBitmap` and a 32×32 canvas for colour sampling, `URL.createObjectURL` for the blobs, IndexedDB.
- Rung 6 (new code): the art query builder, colour clustering, eviction plan and the picker screen, each the smallest thing that works.

## Execution Routing

| Work | Who | Model | Effort |
|---|---|---|---|
| Task 1 (pure layer, unit tests) | worker agent | sonnet | high |
| Task 2 (Scryfall calls, image store, fixtures, live test) | worker agent | sonnet | high |
| Task 3 (picker, tile, random, remove) | worker agent | sonnet | high |
| Task 4 (accent suggestions, custom colour, docs) | worker agent | sonnet | high |
| Gate after each task | shell: `npm run check` | none | none |
| Final review | whole-branch review | opus | high |

## Task 1: The art model and its pure helpers

**Files:** `src/lib/art.ts` (new), `src/lib/life.ts`, `src/scryfall/types.ts`, `src/lib/browse.ts` (export `quote` only), `tests/unit/art.test.ts` (new), `tests/unit/life.test.ts`

- [ ] **Step 1: Failing tests first.**
  - `ArtRef = { id: string; cardId: string; name: string; artist: string; url: string }` (`id` is the `illustration_id`; `url` is the `art_crop` link, used only to fetch and as the cache key).
  - `artRefOf(card)` returns an `ArtRef` from a `ScryCard` (top-level or first-face `art_crop`; card without `illustration_id`, `artist` or crop → `null`; name and artist trimmed and cut to 80 characters).
  - `artQuery({ text, by: 'name' | 'artist', colors, types, legendary })`: name words become `name:"w"` terms, an artist becomes `a:"…"`, colours become `id>=wub` style (includes mode; `C` alone is `id=c`), types `t:creature` joined with `or` inside parentheses, legendary `t:legendary`. Returns `{ ok, q }` or `{ ok: false, error }` for over 900 characters or text that is only quotes/backslashes. Quotes and backslashes in `text` are escaped. Empty everything gives the query `game:paper` so the grid starts with something.
  - `SCRIM_ALPHA` is at least 0.6, and a test computes the worst case (white art under the scrim, white text) with `contrastWithWhite` on the blended grey and asserts ≥ 4.5.
  - `dominantColors(pixels: Uint8ClampedArray, n)` over RGBA bytes: buckets to 4 bits per channel, skips transparent and near-black/near-white pixels, merges near neighbours, returns up to `n` `#rrggbb` ordered by population; a solid-colour image returns one colour, a two-colour image returns both, an empty or all-transparent image returns `[]`.
  - `readable(hex)` darkens (never lightens) until `contrastWithWhite ≥ 4.5`; an already readable colour is returned unchanged; garbage (`'red'`, `'#12'`, `''`) returns `null`.
  - `planEviction(entries: {id, bytes, lastUsed}[], keep: Set<string>, caps: {count, bytes})` returns the ids to delete: least recently used first, never one in `keep`, stops when both caps are met; if `keep` alone exceeds a cap it deletes nothing it must keep and reports what it could not meet.
  - Life store: `Player.art?: ArtRef`, `Player.accent?: string`, `Setup.arts?: (ArtRef | null)[]`, `Setup.accents?: (string | null)[]` are sanitized on load: a wrong-shaped `art` (missing field, non-https `url`, oversized strings) is dropped, a bad `accent` (not `#rrggbb`) is dropped, arrays are cut to `MAX_PLAYERS`. An older store without them loads exactly as before (the existing sanitizer tests stay green). `setArt(game, seat, art | null)` and `setAccent(game, seat, hex | null)` return new games and are not undoable changes.
- [ ] **Step 2: Run, see them fail** (`npx vitest run tests/unit/art.test.ts tests/unit/life.test.ts`).
- [ ] **Step 3: Implement** the above; add `artist?`, `illustration_id?`, `image_status?` to `ScryCard`; thread `arts` and `accents` through `newGame` and `remember`-style setup updates only as far as the sanitizer and `gameFromDefaults` (names, colours, art and accent by seat index).
- [ ] **Step 4: Typecheck and unit suite green.**
- [ ] **Step 5: Commit per file.**

**Failure paths (each tested):** a store whose `art` is `null`, an array, a string or has a `javascript:` or `http:` `url`; an `accent` of `"red"`; `dominantColors` on a zero-length array; eviction with an empty list and with `keep` bigger than the caps.

## Task 2: Search, random and the offline image store

**Files:** `src/scryfall/client.ts` (one option), `src/scryfall/art.ts` (new), `src/ui/artStore.ts` (new), `tests/unit/client.test.ts`, `tests/unit/art-search.test.ts` (new), `tests/unit/art-store.test.ts` (new), `tests/unit/record-fixtures.test.ts`, `tests/fixtures/scryfall-art.json` (recorded)

- [ ] **Step 1: Record real replies first** (`.claude/rules/external-tools.md`): with `RECORD=1`, record an art search by name (`unique=art`), by artist, a 404 (no match), a random card reply, and one reply whose card has two faces. Note the date and the API behaviour seen in the fixture file header. The fake used by unit tests is built from these, not from assumptions.
- [ ] **Step 2: Failing tests.**
  - Client: `get(path, { fresh: true })` skips the cache read and does not write the reply; two `fresh` calls hit the network twice; a normal `get` is unchanged (existing client tests stay green).
  - `searchArt(client, query, page)` returns `{ cards: ArtRef-ready cards, total, hasMore, warnings }`, drops cards `artRefOf` rejects, treats 404 as empty, throws on 400 and on every other failure; the query uses `unique=art`, `order=released`, and is page-numbered. A reply with `warnings` is passed back and not hidden.
  - `randomArt(client)` calls `/cards/random?q=<usable-art terms>` fresh, returns an `ArtRef`, retries once when the card has no usable crop, then throws a clear error.
  - `artStore`: `save(ref)` fetches `ref.url` (CORS), refuses a non-OK reply, a non-image content type, an empty body and anything over 600 KB, stores `{ id, blob, bytes, lastUsed }`, then runs `planEviction` against the keep set it is given; `url(id)` returns an object URL (reused until `release`) and bumps `lastUsed`; `has(id)`; `remove(id)`. All of it tolerates IndexedDB being missing or throwing (returns `false` / `null`, never throws).
- [ ] **Step 3: Run, see them fail.**
- [ ] **Step 4: Implement.** `ClientOptions`/`get` gain `{ fresh?: boolean }`; the artwork-only random query term is verified live in Step 5 and written into one constant.
- [ ] **Step 5: Live test `ART_LIVE=1`** (opt-in, like `SCRYFALL_LIVE`): every term `artQuery` can build (name, artist, each colour, each type, legendary, all together) returns **no `warnings`** and at least one card; random returns a card with an `art_crop`; an art-crop `fetch` from a browser-like Origin returns CORS `*`. Run it before review and say in the PR whether it ran.
- [ ] **Step 6: `npm run check` green; commit per file.**

**Failure paths (each tested):** image `fetch` rejects, returns 404, 200 with HTML, or a body that is cut off (`blob.size` 0): nothing is saved, the caller gets `null`; an image saved twice at once (one row, one fetch); `save` while the keep set is unknown (nothing is evicted); quota error from IndexedDB mid-save (the partial row is removed, the old images stay); two `fresh` random calls overlapping (no shared reply).

## Task 3: The picker and full-bleed tiles

**Files:** `src/ui/artPicker.ts` (new), `src/ui/life.ts`, `src/style.css`, `tests/e2e/life-art.spec.ts` (new), `tests/e2e/life-helpers.ts`, `tests/e2e/helpers.ts` (fixture route for art)

- [ ] **Step 1: Failing e2e tests first**, with Scryfall answered from the recorded fixture and image bytes from a small recorded art-crop file under `tests/fixtures/`.
  - Menu → Edit names & colors → a seat's **Art** button opens the picker; the dialog is labelled, the first focus is the search box, Escape closes it.
  - Typing "edgar" and Search shows a grid of art crops (each a button named "Card name, art by Artist"); switching the box to **Artist** searches `a:`; the colour, type and Legendary filters change the request (asserted on the recorded query string); an invalid or too-long query shows an inline error with `aria-invalid` and `aria-describedby`; warnings from Scryfall are shown; no match shows "No art found"; **Load more** appears only when `hasMore` and appends.
  - Tapping a cell closes the picker and the seat's tile shows that art full-bleed under the scrim, life number and buttons still readable (computed colour contrast over the scrim ≥ 4.5 for the tile text) and the edit row shows "Card · Artist". The image is saved: reload with the network blocked and the art is still there (Playwright `setOffline(true)` plus reload).
  - The dice button applies a random card's art at once, with no confirm; pressing it twice quickly applies one result (the second press is ignored until the first finishes); a failed random shows a status message and keeps the old art.
  - **Remove art** returns the seat to its colour.
  - A seat whose cached image is missing (deleted from IndexedDB in the test) shows the colour and no broken-image icon; art for 25 different images evicts the oldest not in use and never one a seat shows.
  - Storage blocked: the art still applies for the session and a one-line notice says it won't survive closing the app.
  - The picker closes when the Life tab is hidden (`ui-state.md`), a slow search reply arriving after the picker closed or after a newer search is ignored (run counter), and the Search button is disabled while a search is running.
- [ ] **Step 2: Run, see them fail.**
- [ ] **Step 3: Implement.** `artPicker.ts` exports `openArtPicker({ host, client, store, onPick, onRandom })`; the life screen passes the seat's callbacks. Per the `ui-state.md` rules: re-find the seat after every `await`, one search at a time, run counter, bump it only when a search starts, empty live regions stay in the tree, object URLs released when the tile redraws. Tiles set `--art` from the object URL and render the scrim; no art means today's tile. Pick order: save the image first, then `setArt` and persist, so a failed save never leaves a seat pointing at nothing.
- [ ] **Step 4: Run `npm run check`.**
- [ ] **Step 5: Exercise it as a user** (background dev server, phone-size viewport, real Scryfall): pick art on two seats, random on a third, go offline, reload; screenshot a very bright art and a very dark one at `deviceScaleFactor` 2 and look at them.
- [ ] **Step 6: Commit per file.**

**Failure paths (each tested):** search reply for an older run; picker open while the game is replaced by New game (pick is dropped); pick of an image that fails to save (picker stays open with a message, seat unchanged); double tap on a cell.

## Task 4: Accent suggestions, custom colour and docs

**Files:** `src/ui/life.ts`, `src/ui/artPicker.ts` (or a small `src/ui/accent.ts`), `src/style.css`, `tests/e2e/life-art.spec.ts`, `tests/e2e/phone-layout.spec.ts`, docs

- [ ] **Step 1: Failing tests first.**
  - After art is chosen, the seat's row shows 4–6 suggested swatches (from `dominantColors` over a 32×32 sample of the cached image, passed through `readable`), the palette swatches, and a custom colour input. Each is a button or input with an accessible name ("Accent: #b3261e" style, not colour alone).
  - Tapping a suggestion sets the seat's accent: the tile border, glow and the − / + buttons use it, text stays ≥ 4.5:1 (computed). Nothing is applied until a swatch is tapped.
  - The custom colour input accepts any colour; a too-light value is darkened to a readable one and the row says "Adjusted so text stays readable".
  - Palette swatch tapped after a suggestion clears the accent. Remove art clears suggestions but keeps the accent (the person may still like it).
  - Suggestions with a solid black or all-transparent image show none and the palette still works. Sampling failure (`createImageBitmap` rejects) shows none and does not throw.
  - The accent and art survive reload, tab switch and a New game (remembered by seat).
  - At 390×844 and 360×640 with 2 and 4 players the Art button, swatches and the picker's controls are at least 44 px and unclipped.
- [ ] **Step 2: Run, see them fail.**
- [ ] **Step 3: Implement.** Sampling happens once per art id and is cached in memory; it runs after the pick, never blocks the tile.
- [ ] **Step 4: Docs.** Update the art spec (decisions 1–6 made; art remembered by seat), add an ADR only if the image store needs one (`docs/decisions/ADR-007-life-counter-art-cache.md`: why IndexedDB blobs with caps, alternatives: URL only, service-worker cache), note slice 2 in `CLAUDE.md` Architecture (one line each for `src/lib/art.ts`, `src/ui/artPicker.ts`, `src/ui/artStore.ts`), and a line in `docs/template-sync.md` only if a workflow improvement came up. Run `tools/doc-index.sh` and `tools/doc-index.sh --check`.
- [ ] **Step 5: `npm run check`, then `ART_LIVE=1 npx vitest run tests/unit/art-live.test.ts`; `/go`** (verify, review, simplify). Open the PR only when the owner asks.

**Failure paths (each tested):** a cached image that decodes to zero opaque pixels; a custom colour typed as an invalid string (input rejects it, accent unchanged); sampling a very large image (the 32×32 downscale bounds the work).

## Review Focus

Correctness of the store round trip (old stores, bad art/accent values, newer-version stores); the image store's failure paths and caps; nothing partial left in IndexedDB; search input escaping and the 900-character cap; contrast over any art; object URLs released; dialogs closed on tab hide; run counters on search and random; no regression in slice 1 behaviour (default game, sheets, reset toast); Scryfall load (one random or search per tap, none per keystroke).

## Follow-ups (not in this slice)

- Profiles (slice 3) reuse `ArtRef`, the image store and the keep set; deleting a profile releases its image.
- Death effect (slice 4) must grey the art through a CSS filter on the `--art` layer, not by re-encoding the cached blob.
- Pinch-and-drag crop focus (dropped from the tile look question) if the default crop cuts faces badly.
- Offline hint when the picker is opened with no connection (cached art still works, search does not).
