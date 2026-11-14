---
description: Life Counter card art is saved as image blobs in its own IndexedDB database with count, size and per-image caps and a keep set, so seats show art offline; why not a URL alone or the service-worker cache
status: current
updated: 2026-11-14
---
# ADR-007: Life Counter art is cached as bounded IndexedDB blobs

## Context

Each Life Counter seat can show the art crop of any Scryfall card ([spec](../superpowers/specs/2026-11-13-life-counter-art.md)). The Life Counter is used at a table, often with no signal, so a seat that was given art must still show it after the app is closed and reopened offline. A saved game, the remembered setup and (slice 3) profiles all point at art, and none of them may break when the image cannot be fetched. The art host serves one JPEG crop per artwork (a real one measured 32 KB, 626 by 457), and a phone has a limited, unannounced storage quota.

The app already has a service worker ([ADR-002](ADR-002-installable-pwa.md), [ADR-006](ADR-006-cheapest-printing-search-and-bounded-cache.md)) that saves same-origin built files only, and a Scryfall reply cache in IndexedDB that is bounded by age. Card images come from `cards.scryfall.io`, a different origin.

## Decision

- **Save the image bytes when art is picked.** `src/ui/artStore.ts` fetches `art_crop` once (CORS, no cookies, no redirects, https on `cards.scryfall.io` only), checks it is a whole image under 600 KB that is not SVG, and stores `{ id, blob, bytes, lastUsed }` keyed by the artwork's `illustration_id` in its own IndexedDB database, `swapsmith-art`. Never `localStorage`, never the `swapsmith:v1` or `swapsmith:life` keys.
- **Records hold a reference, not the image.** A seat stores `ArtRef` (`id`, `cardId`, `name`, `artist`, `url`) inside `swapsmith:life` (version 1, optional fields, so older saves load unchanged and bad values are dropped on load). The tile asks the store for an object URL by `id`; a missing image shows the seat's color.
- **Bounded.** At most 24 images and 8 MB in all. After a save, least recently used images are deleted first, but never one in the keep set (every seat's art in the game and the remembered setup, plus the image just saved); if the keep set alone is over the caps nothing else is deleted and the caps are allowed to be exceeded rather than break a seat. Use times are written at most once a minute per image.
- **Save first, then apply.** A seat is given art only after its image is saved, so a failed save never leaves a seat pointing at nothing, and a failed write leaves no partial row (the transaction rolls back). With storage blocked the art still applies for the session from the image host and the row says it will not be kept.
- **Colors are sampled from the saved blob**, never from the network: `artStore.blob(id)`, scaled to 32 by 32 in a canvas, then `dominantColors` and `readable` (`src/lib/art.ts`). Sampling is once per image per session and never blocks the tile.

## Alternatives Considered

### Store only the image URL and let the browser cache it
- Pros: nothing to store, no caps to manage
- Cons: the HTTP cache is evictable at any time and is not ours to keep; a cold offline start shows no art; Android's WebView cache is smaller still. Colors cannot be sampled from a cross-origin `<img>` without CORS bytes anyway
- Rejected: fails the offline requirement, which is the reason for the feature

### Cache images in the service worker
- Pros: the browser serves them transparently
- Cons: the worker is same-origin only by design (ADR-006) and is blocked in the e2e tests; the Android app has no worker; there is no way to say "keep what the game uses", so eviction cannot be tied to the saved game; a profile or backup (slice 3) needs the bytes, not a cache entry
- Rejected: wrong owner for the lifetime of the image

### Embed the image in the saved game as a data URL
- Pros: one record, nothing to keep in sync
- Cons: `localStorage` is about 5 MB for the whole origin, shared with decks; a 40 KB to 600 KB image per seat would crowd out the deck store and is rewritten on every life change
- Rejected: risks the deck data in `swapsmith:v1`

### Store full card images or several sizes per card
- Pros: reusable elsewhere
- Cons: about 10 times the bytes for no use in this feature
- Rejected: the art crop is the only size a tile shows

## Consequences

- A game with six seats of art costs normally about 200 KB (6 crops of about 32 KB), at most 6 times 600 KB; the caps and keep set bound the rest. Eviction is by last use, so art of an old game goes first.
- Removing art from a seat does not delete its image: it stays until eviction, so picking it again needs no download. Profiles (slice 3) join the keep set, and deleting one releases its image.
- The image host is on an allow-list in code (`isArtUrl`); a stored or restored `url` that is off it is never fetched.
