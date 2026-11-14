---
description: Life Counter art revamp spec — opens straight into a saved default 2-player 40-life game, card-art tiles from any Scryfall card (search, filters, random, cached offline), accent colours suggested from the art, pod profiles in deck backup, and a splatter-to-skull death effect
status: current
updated: 2026-11-14
---

# Life Counter art revamp: design spec

Builds on the [tab bar and Life Counter spec](2026-11-04-tab-bar-life-counter.md). Decisions below came from a question round with the owner on 2026-11-13.

## Goal

A Life Counter that opens ready to play and looks like a card table: each seat shows art from any Magic card, with an accent colour that suits it, and a dramatic death.

## Decisions

### Opening and defaults (slice 1)

- Opening the Life Counter tab goes straight to a game (`#/life/game`), never the setup screen. No saved game → a default game: **2 players, 40 life**.
- The default is editable: a **Defaults** sheet in the game menu (player count, starting life) and a "Make current setup the default" button. The old setup screen becomes the **New game** sheet; there is no screen before the game.
- The game is remembered across tab switches and app switches, and **never auto-resets**; only New game replaces it. (The owner first said a fully closed app should return to default, then chose "never auto-reset" when shown that the OS kills backgrounded apps. Revisit if lost games are not the pain it seems.)
- **No confirm on reset of life totals.** An **undo toast** ("Life totals reset" + Undo, about 8 s, in memory only) covers a slip; the Undo history is emptied by a reset, so it cannot.
- 2-player layout: **face-to-face**, two full-bleed tiles stacked, the top one rotated 180°, matching how 3–6 players are already seated.
- Plan decisions, made in slice 1 (the owner can overturn): (1) **New game still asks** "Replace the game in progress?", since it discards names and counters too; (2) **reset is undone by the toast**, which holds a snapshot of the game before the reset; (3) **Leave game goes to Decks** (`#/`), as does Android back from the game; (4) **New game and Defaults edit players and starting life only**; names and colors stay in Edit names & colors.
- Out of the box tiles use the accent palette, art optional.

### Art (slice 2)

- Any seat can use the art crop of any Scryfall card printing.
- **Picker:** name (or artist) search with a grid of art crops; filters for colour, card type and legendary only. The grid lists each distinct artwork once (`unique=art`), so reprints with different art are already separate cells and no second "printings" step is needed (decided in the [slice 2 plan](../plans/2026-11-13-life-counter-slice-2.md)).
- **Random:** a dice button that applies a random card's art straight away. No filters, no confirm.
- **Offline:** the chosen image is cached in IndexedDB at pick time, so profiles and games render with no signal. Tile falls back to the accent colour if the image is missing.
- **Tile:** art full-bleed behind everything with a dark scrim, big life number on top, accent colour on border, buttons and glow. Contrast must stay AA over any art.
- **Credit:** card name and artist shown in the picker and a seat's edit sheet, not on the tile.
- Art goes through `src/scryfall/` (the only code that calls Scryfall), on the existing queue and cache rules.

### Accent colours (slice 2)

- On picking art, 4–6 dominant colours are pulled from the image and offered as swatches, adjusted to stay readable (`contrastWithWhite`), beside the existing palette and a custom colour option. One tap applies one; nothing is applied automatically.

### Profiles (slice 3)

- A profile is name + art (cached image and credit) + accent colour. Saved locally, picked per seat.
- Profiles are **included in deck backup and restore**. No link or QR sharing for now.
- "Defaults" may later remember a profile per seat; not in scope until asked.

### Death (slice 4)

- Any lethal source triggers it: life 0, 10 poison, or 21 commander damage from one commander.
- About 1.2 s: an SVG blood splatter bursts over the art, then settles into a skull glyph while the art desaturates and darkens. Plays once per death; no network.
- Fully reversible: undo, or moving the counter back above lethal, fades the skull and restores the art.
- `prefers-reduced-motion`: skip the burst, show the skull immediately. Short haptic buzz on Android.

## Slices (each its own PR, gated by tests)

1. Default game on open, Defaults sheet, no reset confirm, 2-player layout.
2. Art picker (search, filters, random, cache), full-bleed tiles, accent suggestions.
3. Profiles, saved and in backup.
4. Death splatter and skull.

## Slice 2 as built (2026-11-14)

Built on the [slice 2 plan](../plans/2026-11-13-life-counter-slice-2.md); the decisions above (art from any printing, picker with filters, random, offline cache, full-bleed tile with scrim, credit in picker and edit sheet, suggested accents) are all made and shipped in slice 2 on its branch.

- **Art is remembered by seat**, like names and colors: `store.setup.arts` and `store.setup.accents` (optional fields in the version 1 `swapsmith:life` record; no version bump, bad values dropped on load). A New game gives each seat its remembered art and accent. The image itself is in the `swapsmith-art` IndexedDB ([ADR-007](../../decisions/ADR-007-life-counter-art-cache.md)).
- **Accent suggestions:** after art is saved, up to 6 dominant colors of a 32 by 32 copy of the image (`dominantColors`), each darkened until white text reaches 4.5:1 (`readable`), are offered as swatches named "Accent: #rrggbb". Nothing is applied until one is tapped. Sampling happens once per image per session and never blocks the tile; a decode failure, or an image with nothing left after skipping black, white and transparent pixels, offers none.
- **Custom color:** a text field per seat takes `#rrggbb`, `rrggbb` or `#rgb`. A too-light color is darkened and the row says "Adjusted so text stays readable"; anything else is refused with `aria-invalid` and the accent is unchanged.
- **What the accent colors:** the tile's border ring and glow around a tile with art, the − / + buttons (solid accent over art, so art never decides their contrast), and the whole tile when there is no art. A palette swatch replaces the accent; Remove art clears the suggestions but keeps the accent.
- **Edit dialog on a phone:** swatches are 44 px; the dialog scrolls under a Close that stays in view.
- Still open for later slices: whether a profile's cached art counts against the cap when the profile is deleted (slice 3); pinch-and-drag crop focus; an offline hint in the picker.

## Slice 3 as built (2026-11-14)

Built on the [slice 3 plan](../plans/2026-11-14-life-counter-slice-3.md). The Profiles decisions above are made and shipped; the plan's choices where the spec was silent are below.

- **A profile** is `{ id, name, art?, accent? }`, at most 12, kept in `store.profiles` (an optional field in the version 1 `swapsmith:life` record; no version bump, bad entries dropped on load). `src/lib/profiles.ts` is the pure layer; `src/ui/profilePicker.ts` is the Use profile dialog.
- **Save and use:** each seat's row in Edit players has "Save as profile" (refused with "Give this player a name first" for an empty or default "Player N" name; a 13th is refused) and "Use profile" (a list of 44 px buttons with an accent chip). Game menu then Profiles renames or deletes.
- **Using a profile copies it onto the seat; it does not link** (plan decision 2). Later edits to the profile do not change a game in progress, and editing the seat does not change the profile. A rename in Profiles does not show on a seat already playing.
- **Deleting a profile never deletes its image** (plan decision 3, which answers the open item about a deleted profile's cached art). The image only stops being protected from eviction: profile art ids join the seats' and the remembered setup's in the keep set.
- **Backup carries art references, not image bytes** (plan decision 4), to keep the file small and inside the host allow-list. A restored profile needs a connection once to show its art again; offline, using it still gives name and accent, an accent-coloured tile and a notice.
- **Back up and Restore:** the backup file keeps `backup: 1` and `store` exactly as before and gains an optional top-level `profiles` (written only when there are some), so an older app restores the decks and ignores it and an older file restores with no profile change. Restore never deletes: a profile id in both keeps the current copy, new ones are added up to the cap of 12 and the rest are counted ("2 skipped, pod is full"). The file is read once for decks and once for profiles; a bad `profiles` field restores the decks and says nothing about profiles, and a profile merge failure never blocks the deck restore. The home screen reaches the profiles through a lazy `ctx.profiles` handle because the Life Counter is created after the app context.
- **Known limits, parked on purpose:**
  - There is no update-profile path: to change a saved player's art or colour, delete the profile and save the seat again. Saving the same seat twice makes two profiles, which is allowed (two people can share a name).
  - Delete has one undo slot: a second delete within 8 s makes only the last one undoable. Reset shares the slot.
  - The delete undo toast lives inside the Profiles dialog, so closing the dialog within 8 s makes the deletion permanent.
  - Renaming in Profiles can produce a default-looking name ("Player 2"), which Save as profile would refuse.
  - If Edit players is closed while a profile's image is being fetched, the seat gets name and accent but the "art unavailable" notice has nowhere to show.

## Slice 4 as built (2026-11-14)

Built on the [slice 4 plan](../plans/2026-11-14-life-counter-slice-4.md). The Death decisions above are made and shipped; the plan's choices where the spec was silent are below.

- **Death is derived, never stored.** `isDead(game, seat)` in `src/lib/life.ts` is life <= 0, poison >= 10, or 21 from one commander (a partner slot counts); `warnings` reads the same list, wording unchanged. `swapsmith:life` stays at version 1, so no save or restore needs a migration. Nobody is eliminated: counters keep working on a dead seat.
- **Every tile carries `data-dead="true|false"`.** `data-dying="true"` is set only for the burst after a change from alive to dead, and goes on the skull's `animationend` or after 1300 ms. A tile's first draw has no earlier state, so a load, reload or tab switch shows a dead seat already settled, with no animation and no buzz.
- **The look.** `src/ui/deathArt.ts` builds the splatter and the skull as inline SVG with `createElementNS` (no `innerHTML`, no image, no font, no network), `aria-hidden` and `pointer-events: none`, in `.tile-death` between the art layer and the life number. The splatter is one fixed shape turned and scaled per seat (no randomness). Skull and splatter fills stay at or below luminance .18 so the white life number and name keep 4.5:1. The art layer gets `grayscale(1) brightness(.55)` over 300 ms; a tile with no art greys its accent the same way (its `.tile-art` is now `opacity: 0` in the layout instead of `display: none`). The top row's overlay is turned 180 degrees with its tile, so the skull faces that player.
- **Reduced motion:** no burst, no `data-dying`, no buzz, no transition; the settled skull and grey art show at once.
- **Haptic buzz:** `buzz(ms = 80)` in `src/ui/native.ts` calls `navigator.vibrate` (Android Chrome; iOS has none). **In the installed Android app it does nothing yet:** Chromium's WebView only vibrates when the app holds `android.permission.VIBRATE`, and `android/app/src/main/AndroidManifest.xml` declares only INTERNET. Adding `<uses-permission android:name="android.permission.VIBRATE" />` (a normal permission, no key or package id change) is the owner's call, since slices 1 to 4 left `android/` alone; not yet checked on a device. It does nothing under reduced motion, when `vibrate` is missing, or when it throws. It is called from the alive-to-dead branch only, so reload, healing and counter changes on a dead seat never buzz. **Capacitor Haptics was not added** (plan decision: only if already a dependency; it was not, and `navigator.vibrate` needs no new dependency, only the manifest permission above for the app).
- **Reset-toast Undo replays the burst, and buzzes.** Restoring a game that had dead seats is a change from alive to dead, like undoing a heal, so the burst and the buzz play again. Accepted, and pinned by an e2e test so it is a decision, not an accident.
- **Parked minors, worth knowing:**
  - The dead rule for `.tile-art` and the no-art `opacity: 0` rule tie in specificity; the dead one wins by source order, and a comment in `src/style.css` says so.
  - The art layer now fades over 300 ms when art is added or removed (it appeared at once before); harmless, and instant under reduced motion.
  - Each burst adds a `{ once: true }` `animationend` listener; after a heal mid-burst the stale one stays until the next skull animation ends. It only calls `endDying`, and the count is bounded.
  - The contrast test covers the life number and name, not the Counters pill or badges over the skull; in every tile shape the skull is centred (about 56% of the box) and the pill sits at the top edge, so they do not overlap. Recheck if the skull is enlarged.
  - The six-seat test checks skull bounds only; splatter bounds are checked on the two-seat tile (it fits a circle inside the box, so turning never clips).

## Open items for the plan

- Saved-store version bump and sanitizer changes (`swapsmith:life`); profiles key and backup file shape (must not touch `swapsmith:v1`, see Android signing gotchas in CLAUDE.md).
- Image cache size cap and eviction (ADR-006 bounded cache is the model).
- Scryfall art search query shape, and an e2e fixture set for it.
- Whether a game's cached art counts against the cap when its profile is deleted. (Answered in slice 3: deleting a profile never deletes its image.)
