---
description: Life Counter art revamp spec — opens straight into a saved default 2-player 40-life game, card-art tiles from any Scryfall card (search, filters, random, cached offline), accent colours suggested from the art, pod profiles in deck backup, and a splatter-to-skull death effect
status: draft
updated: 2026-11-13
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
- **Picker:** name (or artist) search with a grid of art crops; filters for colour, card type and legendary only; tap a card to choose among its printings' art.
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

## Open items for the plan

- Saved-store version bump and sanitizer changes (`swapsmith:life`); profiles key and backup file shape (must not touch `swapsmith:v1`, see Android signing gotchas in CLAUDE.md).
- Image cache size cap and eviction (ADR-006 bounded cache is the model).
- Scryfall art search query shape, and an e2e fixture set for it.
- Whether a game's cached art counts against the cap when its profile is deleted.
