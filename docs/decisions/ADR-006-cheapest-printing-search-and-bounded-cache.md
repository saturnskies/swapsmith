---
description: Prices a deck with one cheapest-printing search per ~15 cards instead of downloading every printing, loads printings only when the picker opens, and keeps the reply cache bounded and usable offline for a week
status: current
updated: 2026-11-12
---
# ADR-006: Cheapest-printing search, printings on demand, and a bounded cache

## Context

Pricing a deck used to download every paper printing of every card, then pick the cheapest in the browser ([v1 spec](../superpowers/specs/2026-11-02-swapsmith-design.md), "Data source"). Measured against the live API on 2026-11-12 for the 100-card Edgar Markov deck (78 different cards, `tests/fixtures/edgar-deck.json`):

| | Requests | JSON downloaded | Time to prices |
|---|---|---|---|
| Every printing (before) | 16 | 10.8 MB (1,577 printings) | 7.6 s |
| Cheapest printing only (after) | 5 | 0.4 MB | 3.3 s |

Scryfall's documented limit for `/cards/search` is 2 requests a second (its rate-limits page, as returned by a web search on 2026-11-12; the page refused a direct automated read), which matches the 429s seen at 10 a second on 2026-11-02. So the number of searches sets the floor on load time. Three more problems came with the old design:

- Every reply was saved in IndexedDB and nothing was ever deleted, so each deck opened added about 10 MB for good.
- A saved reply older than 24 hours was ignored even when Scryfall could not be reached, so an installed app at a game table with no signal showed "Couldn't reach Scryfall" instead of yesterday's prices.
- The service worker saved files only as they were requested through it, so the app opened offline on the second visit, not the first, and the heading font came from Google Fonts, which the worker never saves and the Android app cannot reach offline.

## Decision

- **Price with `prefer:usd-low`.** One search per ~15 cards, `(oracleid:A or oracleid:B …) game:paper -st:memorabilia -is:oversized -border:gold prefer:usd-low` with `unique=cards`, returns each card's lowest-priced paper printing. That printing is priced at its cheapest finish. A 100-card deck needs about 6 requests. Code: `cheapestPrintings` in `src/scryfall/cards.ts`, `priceEntries` in `src/scryfall/resolve.ts`.
- **"Cheapest" means Scryfall's pick.** On 262 cards checked live (the Edgar deck, the 175 most-played Commander cards and 9 foil-only or oddly printed cards) the price matched the old method for 260. The two that differed (Yavimaya Coast $0.36 against a $0.25 Tenth Edition foil, Worldly Tutor $26.80 against a $26.17 foil) were cases where a foil of another printing was listed below every nonfoil. Scryfall ranks printings by nonfoil price and uses the foil price only for cards with no nonfoil. The printing picker still lists every finish, so a cheaper foil can be picked by hand.
- **Printings load when the picker opens**, one cached request per card (`printings`), not with the deck. A deck entry with a picked printing looks all picked printings up in one batched call when the deck is priced.
- **The Browse card detail uses the same lookup**, so Browse and the deck never disagree about a card's cheapest price.
- **The reply cache is bounded and works offline** (`src/scryfall/client.ts`): replies are fresh for 24 hours as before; a reply up to 7 days old is used when the host cannot be reached (at once when the device reports it is offline, otherwise after the usual retries, and for a 429 or 5xx that outlasts them), and the app says prices may be out of date; anything older is deleted once a session. The IndexedDB database moved to version 2 with an index on the save time, and version 1's contents are dropped on upgrade.
- **Find suggestions asks first for what its opening list needs.** Requests leave in the order they are made, two a second. The deck's role checks (a dozen searches, used by Swaps and Cheaper) now start after the Upgrades list has asked for its cards instead of before, and the Game Changers count reads Scryfall's whole list in one cached request shared by every deck instead of searching each deck's names. Measured live in a browser on 2026-11-12 for the Edgar deck: first upgrades shown in 4.4 s, down from 9 to 10 s; Swaps settles at about 12 s as before.
- **Identical requests in flight are shared**: a second caller waits for the first one's reply instead of taking another slot in the 2-a-second queue.
- **The app shell is saved at install.** The build writes `precache.json` (every built file); `public/sw.js` saves those, the page and the icons when it installs, serves built files from the saved copy without a request, and drops built files a newer deploy no longer lists. Bricolage Grotesque is served from `src/fonts/` (SIL Open Font License, licence alongside) instead of Google Fonts.

## Alternatives Considered

### Keep every printing, but show prices from the cheap search first
- Pros: prices appear in 3 s and the exact "cheapest across every finish" is kept
- Cons: 21 requests instead of 16, still 10 MB per deck in memory and in the cache, and prices that can change a moment after they appear
- Rejected: more load on Scryfall to keep a difference seen on 2 cards in 262, both of them doubtful foil prices

### Scryfall bulk data (one daily file of every card)
- Pros: no rate limit at all, every price offline
- Cons: the files are very large (from memory, well over 100 MB for one object per card and several times that with every printing; not re-measured here), on a phone, on mobile data
- Rejected: far too heavy for a site whose whole build is about 350 kB

### A server or scheduled job that publishes a trimmed price file
- Pros: one small download, instant pricing
- Cons: something to run, pay for and keep alive, against [ADR-001](ADR-001-swapsmith-stack-and-hosting.md)'s no-server goal
- Rejected for now; worth another look if traffic ever makes Scryfall's limits the bottleneck

### Keep stale replies forever (no deletion)
- Pros: a deck opens offline however old its prices are
- Cons: unbounded storage, and month-old prices shown as if they meant something
- Rejected: a week covers a trip or a weekend event; the cache is not a price history

## Consequences

- First load of a 100-card deck drops from about 8 s to about 3 s (2.3 to 2.7 s measured in a browser), and from 10.8 MB to 0.4 MB of JSON; a reload within 24 hours takes about 0.15 s. The cache holds about 0.4 MB per deck and at most a week of replies.
- Opening the printing picker waits for one request the first time (then 24 h cached). A card with more than 175 printings (basic lands, Sol Ring) lists its cheapest 175 priced ones.
- A foil of another printing that is cheaper than every nonfoil is no longer chosen automatically (about 1 card in 100).
- A deck whose every card has a picked printing (a list pasted with set codes) needs 2 extra requests for the picked printings.
- Fixtures: the pricing replies were re-recorded on 2026-11-12 with `RECORD=fill`, which keeps every reply already recorded and asks the real API only for requests the app newly makes, so recorded suggestions stayed as they were while deck prices moved to that day's.
- Not done here: converting `godofwar.ttf` (25 kB) to WOFF2, and trimming saved replies to the fields the app reads.
