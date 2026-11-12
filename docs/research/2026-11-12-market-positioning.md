---
description: Where Swapsmith sits among Commander deck tools (Moxfield, Archidekt, EDHREC, ManaBox and newer entrants), what already sets it apart, and ranked ways to set it apart further
status: current
updated: 2026-11-12
---

# Swapsmith: market position and how to sharpen it (2026-11-12)

**How to read this.** Claims marked *(searched)* come from web searches run on 2026-11-12 and are linked under Sources. Claims marked *(from memory)* are what the author knew of these products from before this session and were not re-checked; confirm them on the product itself before building on them. Swapsmith facts come from the code and the specs.

## The field

| Tool | What people use it for | What it does not do |
|---|---|---|
| **Moxfield** | The default deck builder: fast editing, playtesting, primers, collection, several price sources. Reviewers rank it first *(searched)*. | Tells you what the deck costs, not what to cut for what, and not what is left to buy without setting up a collection *(from memory)*. Needs an account to save. |
| **Archidekt** | Visual, category-based builder with a collection manager and two price sources; free *(searched)*. | Same gap: prices and a collection, no priced one-for-one swaps *(from memory)*. |
| **EDHREC** | The data: what decks with a commander play, with budget, theme and bracket filters. Its "Cheap" filter shows the cheapest tenth of decks *(searched)*. Budget help is mostly articles that hand-pick replacements for the ten priciest cards *(searched)*. | Works from the commander, not from your list and your wallet. No ownership, no totals. |
| **ManaBox** and other phone apps | Scanning cards, collection, deck building on a phone, offline *(searched)*. | Collection first; upgrade advice is not the point *(from memory)*. |
| **Playgroup.gg** | Free browser builder that imports Moxfield and Archidekt links and suggests cards from tracked win rates *(searched)*. | Needs play data; suggestions are not priced swaps. |

Card Kingdom's own budget advice says there is no one-for-one cheaper version of every card and that the usual method is to build first, then swap the expensive cards out by hand *(searched)*. That manual step is the job Swapsmith automates.

## What already sets Swapsmith apart

1. **The headline number is "Still to buy", not "Deck total".** Ownership is ticked per deck in seconds, with no collection to import first, and basic lands count as owned.
2. **Suggestions are swaps, not a wish list.** Each one names the card to cut and the card to add, says why (same job, or same type), keeps the deck at 100, and has Undo. Cheaper replacements are offered only for cards of $5 or more that you do not own.
3. **It starts from your list and your commander's real decks together**: EDHREC inclusion and synergy for the commander, checked against your colours, your bracket and your prices.
4. **Nothing to sign up for and nothing leaves the device.** No account, no server, no ads; decks live in the browser, share links carry the deck in the address.
5. **It is fast and small.** The whole built site is about 350 kB, fonts and icons included; a 100-card deck prices in about 3 seconds (ADR-006) and opens with saved prices when offline.
6. **It is an app at the table too**: installable, an Android build, a life counter that keeps the screen awake.

The honest weak spots: no accounts means no sync between devices (backup files only); there is no collection across decks; import is paste-only (Moxfield and Archidekt block browser calls, ADR-005); USD and TCGplayer only; and it depends on EDHREC's unofficial data.

## Positioning in one line

Not "another deck builder". **"Paste your deck, see what is left to buy, and get the best swaps for the money you have."** Moxfield and Archidekt are where the deck lives; Swapsmith is where you decide what to buy next. That framing makes the big builders the source of lists rather than rivals.

## Ways to stand out more, ranked by value for effort

| # | Idea | Why it differentiates | Cost and risk |
|---|---|---|---|
| 1 | **Budget planner: "I have $25"**. Pick the set of swaps with the best fit-per-dollar under a budget, show before and after, share it as a link. | Nobody found in this pass turns a budget into a concrete, priced, ordered plan. It is the product's name made literal. | Pure local logic on data already loaded (scores, prices). Medium: a spec, a small knapsack, one panel. |
| 2 | **One-tap buy list**. "Buy what is left" opens TCGplayer's mass entry with the still-to-buy cards and chosen printings; also copy as a list for Card Kingdom or Manapool. | Turns the headline number into an action. A retailer affiliate link could also pay for the project without ads. | Small. Check TCGplayer's mass-entry link format and affiliate terms first *(not verified here)*. |
| 3 | **Start from a precon**. Choose a preconstructed deck by name instead of pasting, then get its upgrade plan. | The people who most need budget upgrades have just bought a precon; they do not have a list to paste. | Needs a list source: Scryfall has no deck lists; MTGJSON publishes them *(from memory)*. A small static file per precon keeps ADR-001's no-server rule. |
| 4 | **Bracket in plain sight**. Show the deck's Game Changer count and bracket on the deck page, and warn when an add would raise it. | Brackets are how tables now agree on power; a swap tool that keeps you inside your bracket is safer to trust. | Small: the count is now one cached request for every deck, and the estimate exists already. |
| 5 | **Euro prices (Cardmarket)**. A currency switch: Scryfall carries EUR prices and `prefer:eur-low` *(from memory, check)*. | Most tools price in USD on TCGplayer first. European players are under-served and reachable with no new data source. | Small to medium: one more price field through pricing, tiers and links. |
| 6 | **"You already own this"** across decks. When a suggestion or a still-to-buy card sits in another of your decks, say so and offer to mark it. | Keeps the per-deck ownership rule (a physical card is in one deck) but stops people buying a second copy by accident. | Small, local. |
| 7 | **Price memory**. Keep each deck's daily still-to-buy total on the device and show the change since last visit. | A reason to come back, with no server. | Small. Storage is tiny. |
| 8 | **Combos one card away** from Commander Spellbook. | Popular question, and it interacts with brackets. | Medium; another outside API to depend on *(its browser access not checked)*. |
| 9 | **Share target on Android**: "Share to Swapsmith" from a deck site or a text. | Removes the copy-paste step on phones. | Small in the PWA manifest, a little more in the Capacitor app. |
| 10 | **A first screen that shows the product**. Today a new visitor sees "No decks yet". A "Try a sample deck" button would show totals and swaps in ten seconds. | Time-to-value for people arriving from a shared link or a post. | Small. |

Ideas 1, 2 and 4 together are a coherent next release: *plan the upgrade, keep it in bracket, buy it in one tap*.

## Things to keep, deliberately

- **No accounts and no server.** It is the trust and cost advantage; sync can stay a file backup until users ask for more.
- **Explanations on every suggestion.** "In so many percent of your commander's decks" and "both ramp" are the antidote to black-box AI deck advice.
- **Narrow scope.** Commander only, upgrades only. Every general deck-builder feature added (playtest, primers, tags) moves it toward a fight it cannot win.

## Risks to watch

- **EDHREC's JSON is unofficial** (ADR-005). The Scryfall fallback keeps suggestions alive, but the best signal can change or close without notice.
- **The logo font** (`src/fonts/godofwar.ttf`) has no licence file in the repo. Confirm it may be used on a public site, or swap it.
- **Scryfall's limits** (two searches a second) cap how fast first loads can get; ADR-006 lists the server-side option if traffic grows.

## Sources

- [Draftsim: best MTG deck builders](https://draftsim.com/best-mtg-deck-builder/) and [Draftsim: Commander deck builders](https://draftsim.com/mtg-edh-deck-builder/) (rankings, Archidekt and Moxfield notes)
- [Playgroup.gg Commander deck builder](https://playgroup.gg/commander/deck-builder)
- [Card Kingdom: how to brew Commander decks on a budget](https://blog.cardkingdom.com/how-to-brew-commander-decks-on-a-budget/)
- [EDHREC: Commander Showdown, budget vs expensive](https://edhrec.com/articles/new-edhrec-feature-commander-showdown-budget-vs-expensive/) and [EDHREC: Brew For Your Buck](https://edhrec.com/articles/brew-for-your-buck-the-legend-persists)
- [EDHREC: how to use Archidekt](https://edhrec.com/guides/how-to-use-archidekt-the-mtg-deckbuilding-site) and [Archidekt](https://archidekt.com/landing)
- [Draftsim: MTG collection trackers](https://draftsim.com/mtg-collection-tracker/) (ManaBox)
- [Scryfall API rate limits](https://scryfall.com/docs/api/rate-limits)
