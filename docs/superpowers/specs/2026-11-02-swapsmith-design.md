---
description: Swapsmith v1 design spec — free static Commander deckbuilder with live TCGplayer prices via Scryfall, owned-card tracking, and rules-based swap/upgrade/cheaper-replacement suggestions
status: current
updated: 2026-11-12
---

# Swapsmith v1: design spec

## Goal

A free website where someone builds or pastes a Commander deck, sees what each card costs on TCGplayer, marks what they own, and gets suggestions for what to swap in or out. It costs nothing to run or use: no accounts, no server, no AI calls.

**Audience:** the owner and their playgroup. It should be easy to use and work on a phone, but it doesn't need onboarding for strangers.

**Stack and hosting:** see [ADR-001](../../decisions/ADR-001-swapsmith-stack-and-hosting.md).

## In scope (v1)

1. **Commander deck building.** Pick a commander, then add cards by search with autocomplete. Or paste a text list.
2. **Live prices.** Each card shows its cheapest TCGplayer market price, with a link to that printing's TCGplayer page. A printing picker overrides the default per card.
3. **Owned cards.** Tick the cards you own for each deck. A physical card is in one deck at a time, so what you own for one deck says nothing about another. Totals show the deck cost and the cost still to buy.
4. **Suggestions**, all from rules over Scryfall data:
   - upgrades by price tier
   - swap pairs (cut one card, add another)
   - cheaper replacements
5. **Saving and sharing.** Decks are saved in the browser. A share link encodes the whole deck.
6. **Grid and list views.** A card-image grid grouped by type, or a compact list. You can switch between them.

## Out of scope (v1)

These were decided against for v1. The code shouldn't block them.

- Deck health checks (land, ramp, draw and removal counts against targets)
- Other formats (60-card Standard, Modern, Pauper). Code keeps format rules in one module so a format can be added later.
- Accounts and cloud saves
- Importing from Moxfield or Archidekt URLs
- AI-written suggestions
- Price history and alerts

## Data source: Scryfall API

Every card fact and price comes from the free public [Scryfall API](https://scryfall.com/docs/api), called directly from the browser. This was confirmed on 2026-11-02:

- **CORS:** it sends `access-control-allow-origin: *`.
- **Prices:** Scryfall's `prices.usd`, `usd_foil` and `usd_etched` are TCGplayer market prices, refreshed daily. `purchase_uris.tcgplayer` links to the TCGplayer product. The app strips Scryfall's affiliate redirect and links to `tcgplayer.com/product/<id>` directly; the product id is in the redirect's `u=` parameter.
- **Searches the suggestions use:** `f:commander` (legal in Commander), `id<=wbr` (within a color identity), `order:edhrec` (EDHREC popularity), `usd<3` (price filter) and `otag:` (Scryfall Tagger functional tags). Verified tags: `ramp`, `card-advantage`, `removal`, `board-wipe`, `tutor`, `sacrifice-outlet`, `lifegain`, `death-trigger`, `recursion`, `mana-rock`. Example: `id<=wbr f:commander t:vampire usd<3 order:edhrec` returned 371 cards, led by Blood Artist.
- **Endpoints:**

  | Use | Endpoint |
  |---|---|
  | Autocomplete names | `GET /cards/autocomplete?q=` |
  | Look up up to 75 cards in one call | `POST /cards/collection` |
  | Cheapest printing of up to ~15 cards (deck prices, Browse card detail) | `GET /cards/search?q=(oracleid:<id> or …) prefer:usd-low&unique=cards` |
  | All printings of one card (printing picker, when it opens) | `GET /cards/search?q=oracleid:<id>&unique=prints` |
  | Suggestion and role searches | `GET /cards/search?q=` |

**Being a good API citizen.** Scryfall asks clients to stay under about 10 requests a second and to cache data.

- All requests go through one client module.
- That module queues requests, about 100 ms apart, and retries on HTTP 429 with backoff.
- It caches responses in IndexedDB for 24 hours, keyed by URL. Prices only change daily, so a reopened deck loads mostly from cache. A reply up to a week old is used when Scryfall can't be reached, with a note that prices may be out of date; older replies are deleted ([ADR-006](../../decisions/ADR-006-cheapest-printing-search-and-bounded-cache.md)).
- Two callers asking for the same thing at once share one request.
- The footer credits Scryfall. The site never charges for Scryfall data, which Scryfall's terms require.

**Load cost** (since 2026-11-12, [ADR-006](../../decisions/ADR-006-cheapest-printing-search-and-bounded-cache.md)). A 100-card deck is priced in about 6 requests:
- One search per ~15 cards for each card's cheapest paper printing (`prefer:usd-low`, one result per card).
- One batched lookup for the printings a user picked, when there are any.
- One lookup for cards with no paper printing, when there are any, so they still show by name and type.

The 100-card Edgar list (78 different cards) was priced in 3.3 s and 0.4 MB against the live API on 2026-11-12. Before that, every printing of every card was downloaded: 16 requests, 10.8 MB and 7.6 s for the same deck.

**Scryfall behaviour found while building (2026-11-02):**
- **Query length:** queries longer than about 1,000 characters are silently cut short, so batches stay under 900.
- **Rate limits:** bursts of searches at 10 a second get 429s. Those replies carry no CORS headers, so browsers report them as a network error. Searches, name lookups and collection lookups are spaced 500 ms apart, and network errors are retried like 429s.
- **Batch lookups:** results come back in request order with misses left out. Matching is forgiving: "Stromkirk Blood-Thief" finds Stromkirk Bloodthief. It can also return the wrong card: "Sign in Blood" returns Scheming Silvertongue // Sign in Blood. So each pairing is checked by name, and a mismatch falls back to fuzzy lookup.
- **Double-faced cards:** a batch lookup only matches the front-face name, not "A // B".
- **Alternate names:** names printed on some versions (`flavor_name`, e.g. Panther Idol for Mind's Eye) are matched and shown to the user.
- **User-Agent:** the API rejects Node's default User-Agent, but browsers are fine.

## Data model

All of this lives in the browser.

```ts
Deck = {
  id: string,                 // random, local only
  name: string,
  format: 'commander',        // the only value in v1
  commander: CardRef,
  cards: DeckEntry[],         // excludes the commander
  updatedAt: string,          // ISO time
  owned?: string[],           // oracle ids owned for THIS deck only (a physical card is in one deck at a time)
  unownedBasics?: string[],   // basic lands are owned by default; unticking one in this deck adds it here
}
DeckEntry = { card: CardRef, qty: number, printingId?: string /* user-picked printing; absent = cheapest */ }
CardRef  = { oracleId: string, name: string }
Prefs    = { view: 'grid' | 'list', budgetTier?: 'budget' | 'mid' | 'premium' }
```

- **Storage.** Decks (each with the cards owned for it) and preferences go in `localStorage` under one versioned key (`swapsmith:v1`; the `version` inside is 2 since 2026-11-05, see "Decisions after review"). Cached API responses go in IndexedDB. If storage is blocked, as in some private windows, the app still works for the session and shows a banner saying decks won't be saved.
- **Owned cards are matched by Oracle ID.** Owning any printing of a card counts as owning it. Basic lands (type line `Basic Land`, including Wastes and snow basics) count as owned unless unticked.

### Share links

A share link holds the deck in the URL hash (`#d=<data>`), so no server is needed.

- **Encoding:** compact text lines (`qty|oracleId|printingId|name`; the exact format is documented in `src/lib/share.ts`), compressed with the browser's built-in `CompressionStream('deflate-raw')`, then base64url-encoded. Oracle IDs make the deck exact without re-matching names. The full 100-card Edgar deck makes a link of about 3.6 KB (measured 2026-11-02).
- **Untrusted input:** a link can come from anyone, so decoding checks every field and refuses links that inflate past 64 KB or list more than 250 cards.
- **Opening a link:** shows the deck read-only, with a **Save to my decks** button.
- **Owned cards stay out.** They're personal and are never put in a share link.

## Screens and flows

### 1. Deck list (home)

- Cards for each saved deck: commander art, name, total, still-to-buy, and last edited.
- Buttons: **New deck** and **Paste a list**.

### 2. New deck

1. **Pick a commander.** Autocomplete only offers cards that can be commanders, using `is:commander`.
2. You land on an empty deck editor with that commander, ready to add cards.

### 3. Paste a list

- **Accepted formats:** `1 Card Name`, `1x Card Name`, `Card Name` (qty 1), and `1 Card Name (SET) 123`, which pins that printing. Section headers like `Commander`, `Deck` and `Sideboard`, and blank lines, are ignored.
- **Choosing the commander:** a `Commander` section, or a line marked `*CMDR*`, sets it. Otherwise the app asks which listed legend is the commander.
- **Names that don't match** appear in a fix-up list. Each has autocomplete and a "did you mean" choice from Scryfall's fuzzy match. This catches typos like "Calastria Highborn" → Kalastria Highborn.

### 4. Deck editor (main screen)

- **Header:** deck name, commander, deck total, still-to-buy total, card count against 100, and a color identity pip row.
- **Add card:** a search box with autocomplete. It warns, but still allows, when a card is outside the commander's colors, not legal in Commander, or a duplicate of a non-basic card.
- **View toggle:** grid or list, remembered per browser.
  - **Grid:** card images grouped by type (Creatures, Instants, Sorceries, Artifacts, Enchantments, Planeswalkers, Lands, and Battles if any). Each tile shows price, an owned tick and a remove button.
  - **List:** one row per card with name (hover or tap to see the image), type, printing, qty, price, owned and remove. Columns can be sorted.
- **Card links:** every card name and image links to that printing's TCGplayer page in a new tab.
- **Printing picker:** opened from a card. It loads and lists the card's paper printings (the cheapest 175 for a card with more) with set, number, finish (nonfoil, foil or etched) and price, cheapest first. You can pick one, or reset to cheapest.
- **Rename and delete deck:** deleting asks for confirmation in the page.
- **Share:** copies the share link.

### 5. Suggestions panel

A panel beside the editor on wide screens, or a tab on phones, with three sections.

## Suggestion rules

> **Replaced 2026-11-04** by the [recommendations revamp spec](2026-11-03-recommendations-revamp.md). Upgrades, swaps and cheaper replacements now come from EDHREC's data for the commander. The rules below are the fallback when EDHREC has nothing, widened there with more roles and themes and shown in categories instead of price tiers. The revamp also brings in gap lines, which were out of scope here.

All rules are pure functions over card data, so unit tests can cover them without the network. Every suggestion shows a short reason built from the rule that produced it.

### Deck profile, computed locally from deck cards

- **Color identity:** the commander's `color_identity`.
- **Tribe:** the most common creature subtype among non-commander creatures, if at least 8 cards share it. The commander's own types break ties.
- **Themes:** found by matching oracle text across deck cards. A theme counts when at least 5 cards match it.

  | Theme | Matching oracle text |
  |---|---|
  | sacrifice | `sacrifice a creature`, `sacrifice another` |
  | death triggers | `whenever .* dies` |
  | lifegain | `lifelink`, `gain .* life` |
  | tokens | `create .* token` |
  | +1/+1 counters | `\+1/\+1 counter` |
  | graveyard | `from your graveyard` |

- **Card roles:** looked up through Scryfall tags. Run `otag:<role> (!"A" or !"B" …)` over the deck's names in batches that keep each query under 900 characters. Built in step 8, which needs roles for matching cuts; upgrades don't need the deck's own roles.

### Candidate pool

Built when the user clicks **Find upgrades**, not on every deck open, since it costs one search per line below. Run one search for each:
- the detected tribe (`t:<tribe>`)
- each detected theme (its oracle-text query)
- four core roles: `otag:ramp`, `otag:card-advantage`, `otag:removal` and `otag:board-wipe`

Theme-specific roles such as sacrifice outlets or lifegain come through the theme searches, which keeps a deck to about 8 searches (5.5 s live on 2026-11-02).

Rules for every search:
- `f:commander id<=<CI> game:paper prefer:usd-low order:edhrec`, plus the filter above. `prefer:usd-low` makes Scryfall return each card's cheapest printing, so suggestions are priced and tiered without a lookup per card.
- Keep the first page, up to 175 of the most-played cards.
- Remove cards already in the deck, and defensively re-check legality and color identity.
- Collect the results into one pool. Search replies are cached for 24 hours like every request.

### Score for a candidate

`score = popularity + 0.5 × (tribe and theme matches) + 0.25 × (role matches) + 0.3 if owned`

- `popularity` = `1 − edhrec_rank / max_rank`, from 0 to 1, where `max_rank` is the worst rank in the pool.
- Cards with no `edhrec_rank` get popularity 0.
- **Why roles weigh less:** with every match at 0.5, Dusk // Dawn (one theme, three roles) topped the Edgar deck's Budget list, above Indulgent Aristocrat (tribe plus three themes). Changed 2026-11-02; a unit test keeps this case.

### 1. Upgrades by price tier

- **Tiers** are set on the cheapest printing's price: Budget is under $3, Mid is $3–$15, Premium is over $15. The boundaries are constants in one module.
- **Each tier** shows the top 10 by score.
- **Reasons** list the matched tribe and themes, then roles, then the EDHREC rank, then "owned". For example: "Vampire · sacrifice · lifegain · +1/+1 counters · EDHREC #2588". The price shows beside the name.
- **Where it shows:** a panel beside the cards on wide screens (70 rem and up), below them on phones. Each suggestion links to TCGplayer and has an **Add** button.

### 2. Swap pairs

- **Adds:** the best-scoring candidates in the chosen price tier (any price by default), up to 10 pairs. Filtering by tier first means a tier always shows its own best swaps.
- **The paired cut** comes from the deck with the lowest keep score: `popularity + 0.5 × (tribe and theme matches) + 0.25 × roles`, the same scale as suggestion scores. Popularity is normalised by the worst EDHREC rank in the deck.
- **Only improvements:** an add is skipped when its score is no better than the cut's keep score, so a swap never offers a downgrade.
- **Cut preference:** a card that shares a role with the add, so a removal spell replaces a removal spell. If none shares a role, the lowest keep score overall.
- **Never cut:** the commander, basic lands, cards the user has pinned with **Keep** (a toggle on each card, saved with the deck but not in share links), or a card already used in another pair.
- **Lands:** a land is only cut for a land.
- **Apply:** one click swaps the two cards. **Undo** reverts the last apply.
- **Deck roles** come from `otag:<role> (!"A" or !"B" …)` searches over the deck's own names (front faces), batched under the query cap: 4 roles × 2 batches for a 100-card deck. They load after the pool, so upgrades show first. If they fail, swaps and replacements use the roles seen in the pool searches and say matching is approximate.
- **Lists update locally:** after Find suggestions, adding, swapping, undoing, or toggling Keep or Owned recomputes every list with no new requests. Any edit other than a swap ends the Undo offer.
- **One swap at a time:** a swap re-finds its cut card after pricing and is ignored if the card is already gone, so double clicks can't grow the deck.

### 3. Cheaper replacements

- **Which cards get them:** every deck card whose cheapest price is at least $5 and that the user doesn't own, except the commander and cards marked Keep. The threshold is a constant.
- **What's offered:** the 3 highest-scoring cards that share at least one role with it, are within the color identity, are legal, cost under half its price, and match it as land or nonland.
- **Display:** "Save $X.XX", plus a **Swap** button.

### Guarantees across all three

- Never suggest a card that is banned in Commander, outside the color identity, or already in the deck.
- Always link to TCGplayer.

**Known limits:**
- Scryfall's functional tags are broad: "ramp" includes Path to Exile and "card draw" includes Sun Titan. Role matching is a good start, not a judgment of fit.
- EDHREC rank measures a card's popularity across all of Commander, not in decks with this particular commander. Suggestions are on-theme and popular, but they won't know combos.

## Errors and empty states

- **Scryfall unreachable:** a banner says "Couldn't reach Scryfall; showing saved prices from <date>". Edits still work.
- **Card with no price:** it shows "no price" and is left out of totals, and the total says "N cards unpriced".
- **Fewer than 5 deck cards:** suggestions show "Add a few cards to get suggestions", with tribe and color picks only.

## Testing

Tests are written first, following the repo's TDD flow.

- **Unit tests (Vitest)** cover:
  - list parser formats
  - share-link encode and decode round trip
  - cheapest-printing selection
  - deck profile detection
  - scoring
  - each suggestion rule's guarantees, including no banned, off-color or duplicate cards
  - tier boundaries
  - storage migration from an empty or corrupted store

  These tests use recorded Scryfall fixtures, so they need no network.
- **End-to-end tests (Playwright)** cover:
  - new deck from commander
  - paste the Edgar Markov list
  - fix a typo
  - mark cards owned and see still-to-buy change
  - switch views
  - pick a printing
  - apply a swap and undo it
  - copy a share link and open it in a fresh context

  These tests run against the built site, with Scryfall answered from fixtures (`page.route`).
- **CI:** a GitHub Actions workflow runs lint, unit and end-to-end tests on every push and PR. It deploys to GitHub Pages only from `main` after the tests pass.

## Build order (vertical slices)

Each slice works end to end and is gated by its tests. The detailed plan comes next, in `docs/superpowers/plans/`.

1. **Skeleton and deploy:** Vite app, CI, Pages deploy, footer credit, and the Scryfall client with queue and cache.
2. **Paste a list and price it:** parser, fix-up list, list view, totals, TCGplayer links, saved in the browser.
3. **Commander-first building:** commander picker, add-card autocomplete, legality and color warnings.
4. **Owned cards and printing picker:** still-to-buy total.
5. **Grid view:** view toggle.
6. **Share links.**
7. **Suggestions:** deck profile, candidate pool, upgrades by tier.
8. **Swap pairs and cheaper replacements:** apply and undo.

## Decisions after review (2026-11-02)

- **Cheapest printing comes from Scryfall, not from a list of every printing (2026-11-12).** See [ADR-006](../../decisions/ADR-006-cheapest-printing-search-and-bounded-cache.md): a deck loads in about a third of the requests, a foil of another printing that undercuts every nonfoil is no longer picked automatically, and the app keeps week-old prices for offline use.
- **Repo name:** the repo is renamed `swapsmith` on GitHub, so the site lives at `https://saturnskies.github.io/swapsmith/`. Vite's `base` is `/swapsmith/`.
- **Basic lands are owned by default.** Unticking one records it in the deck's `unownedBasics`. Still-to-buy totals exclude owned basics.
- **Owned belongs to each deck (2026-11-05).** Each deck stores `owned` and `unownedBasics` itself; nothing is shared between decks, in suggestions, totals, backups or restores. Data saved before this change (one list for every deck) is migrated when it loads or when an old backup is restored: each deck gets the ticks for the cards it contains, so it looks exactly as it did, and the old shared list is dropped. A deck that already has its own ticks is never overwritten. The storage key and package id are unchanged ([ADR-004](../../decisions/ADR-004-apk-signing-and-data-safety.md)). Edge cases, all deliberate: ticks made by an old cached copy of the app after the upgrade are dropped for any deck that already has its own ticks; legacy ticks for cards that were in no deck at migration time survive only in the untouched safety copy (`swapsmith:v1:before-owned-per-deck`, written once, never read); and the old top-level lists leave storage on the next save, not at load. A restore keeps the newer copy of a deck together with its ticks, so the other copy's ticks are replaced, not combined. Ticking a card counts as editing the deck (`updatedAt`), so it moves that deck up the home list. Plan: [owned per deck](../plans/2026-11-05-owned-per-deck.md).
