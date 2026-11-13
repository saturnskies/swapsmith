import { readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseDeckList } from '../../src/lib/parse';
import { createClient, memoryCache } from '../../src/scryfall/client';
import { autocompleteNames, cardByName, searchCommanders } from '../../src/scryfall/cards';
import { buildDeck, commanderCandidates, oracleIdOf, priceDeck, priceEntries, resolveList } from '../../src/scryfall/resolve';
import { fuzzyCard } from '../../src/scryfall/cards';
import { deckProfile } from '../../src/lib/profile';
import { sortPrintings } from '../../src/lib/price';
import { roleLookupNames, scoreEdhrec, scoreSuggestions } from '../../src/lib/suggest';
import { candidatePool, deckCardFacts, rulesText } from '../../src/scryfall/suggest';
import { deckRoles } from '../../src/scryfall/roles';
import { cheaperReplacements, edhrecKeepScores, swapPairs } from '../../src/lib/swaps';
import { fixtureFetch, requestKey, trim, trimEdhrec, type FixtureMap } from '../support/fixtures';
import { commanderPage, createEdhrecClient, EDHREC_BASE } from '../../src/edhrec/page';
import { edhrecCandidates } from '../../src/edhrec/candidates';
import { estimateBracket, type PageFilter } from '../../src/lib/edhrec';
import type { Deck } from '../../src/lib/deck';
import { gameChangerCount } from '../../src/scryfall/names';
import { searchCards } from '../../src/scryfall/browse';
import { cardsByOracleId, cheapestPrintings, printings } from '../../src/scryfall/cards';
import { SORTS } from '../../src/lib/browse';
import { pageRoles, scoredPage } from '../support/swap-pool';
import { BREYA } from '../support/swap-samples';
import { BASIC_SWAMP_QUERY, COMMANDER_TYPED, SAMPLES, SOLPHIM_TYPED } from '../support/browse-samples';

const FILL = process.env.RECORD === 'fill';
const fixture = (file: string): FixtureMap => JSON.parse(readFileSync(new URL(`../fixtures/${file}`, import.meta.url), 'utf8'));

/**
 * RECORD=fill, for when the app starts making different requests: a request the fixture already holds is
 * answered from it (so its recorded prices and suggestions stay as they are) and only a request it lacks
 * goes to the real API. Requests the flow no longer makes are dropped, since `map` holds only what this
 * run asked for. With RECORD=1 everything is asked afresh.
 */
function fill(file: string, map: FixtureMap, live: typeof fetch, alsoRecordedIn: string[] = []): typeof fetch {
  if (!FILL) return live;
  const old = fixture(file);
  // Replies another fixture holds for this flow (its later, wider searches) are used but stay in that file.
  const elsewhere: FixtureMap = Object.assign({}, ...alsoRecordedIn.map(fixture));
  const reply = (hit: FixtureMap[string]) => new Response(JSON.stringify(hit.body), { status: hit.status, headers: { 'content-type': 'application/json' } });
  return async (input, init) => {
    const key = requestKey(init?.method ?? 'GET', String(input), init?.body as string | undefined);
    if (old[key]) return reply((map[key] = old[key]));
    if (elsewhere[key]) return reply(elsewhere[key]);
    return live(input, init);
  };
}

/**
 * Re-records tests/fixtures/scryfall-e2e.json from the real Scryfall API by running the same flow the
 * paste screen runs on tests/fixtures/e2e-list.txt. Run: RECORD=1 npx vitest run tests/unit/record-fixtures.test.ts
 * (or RECORD=fill to keep what is recorded and add only the requests that are missing).
 */
describe.runIf(process.env.RECORD === '1' || FILL)('record Scryfall fixtures', () => {
  it('records the paste-and-price flow', async () => {
    const map: FixtureMap = {};
    const recording: typeof fetch = async (input, init) => {
      const headers = { ...Object.fromEntries(new Headers(init?.headers)), 'User-Agent': 'Swapsmith-fixture-recorder/0.1' };
      const res = await fetch(input, { ...init, headers });
      const body = await res.clone().json();
      map[requestKey(init?.method ?? 'GET', String(input), init?.body as string | undefined)] = { status: res.status, body: trim(body) };
      return res;
    };
    const client = createClient({ fetch: fill('scryfall-e2e.json', map, recording), cache: memoryCache() });

    const { entries } = parseDeckList(readFileSync(new URL('../fixtures/e2e-list.txt', import.meta.url), 'utf8'));
    const resolved = await resolveList(client, entries);
    // As the user would: accept each suggestion, remove lines with none.
    const lines = resolved.flatMap((r) => (r.card ? [{ entry: r.entry, card: r.card }] : r.suggestion ? [{ entry: r.entry, card: r.suggestion }] : []));
    const [commander] = commanderCandidates(lines);
    const deck = buildDeck('E2E', lines, commander);
    await priceDeck(client, deck);
    // The printing picker, which the e2e tests open on the commander to pick its second-cheapest printing;
    // a deck with a picked printing looks that printing up when it is priced again (a reload, a shared link).
    const second = sortPrintings(await printings(client, oracleIdOf(commander)))[1];
    await priceDeck(client, { ...deck, commanderPrintingId: second.id });

    writeFileSync(new URL('../fixtures/scryfall-e2e.json', import.meta.url), JSON.stringify(map, null, 1) + '\n');
    expect(Object.keys(map).length).toBeGreaterThan(5);
  }, 120_000);

  it('records the new-deck flow: commander search, add by name, reload', async () => {
    const map: FixtureMap = {};
    const recording: typeof fetch = async (input, init) => {
      const headers = { ...Object.fromEntries(new Headers(init?.headers)), 'User-Agent': 'Swapsmith-fixture-recorder/0.1' };
      const res = await fetch(input, { ...init, headers });
      map[requestKey(init?.method ?? 'GET', String(input), init?.body as string | undefined)] = { status: res.status, body: trim(await res.clone().json()) };
      return res;
    };
    const client = createClient({ fetch: fill('scryfall-new-deck.json', map, recording), cache: memoryCache() });

    // Same calls, in the same order, as tests/e2e/new-deck.spec.ts makes through the UI.
    const [edgar] = await searchCommanders(client, 'edgar');
    const deck = buildDeck('Fresh Edgar', [], edgar);
    await priceDeck(client, deck);
    for (const [typed, name] of [['sol r', 'Sol Ring'], ['llanowar', 'Llanowar Elves']]) {
      await autocompleteNames(client, typed);
      const card = (await cardByName(client, name))!;
      const id = oracleIdOf(card);
      await priceEntries(client, [{ entry: { card: { oracleId: id, name: card.name }, qty: 1 }, isCommander: false }], undefined, new Map([[id, card]]));
      if (name === 'Sol Ring') deck.cards.push({ card: { oracleId: id, name: card.name }, qty: 1 });
    }
    await priceDeck(client, deck); // the reload after Llanowar Elves is removed

    writeFileSync(new URL('../fixtures/scryfall-new-deck.json', import.meta.url), JSON.stringify(map, null, 1) + '\n');
    expect(Object.keys(map).length).toBeGreaterThan(5);
  }, 120_000);

  it('records the full Edgar deck, priced, with its upgrade searches', async () => {
    const map: FixtureMap = {};
    const recording: typeof fetch = async (input, init) => {
      const headers = { ...Object.fromEntries(new Headers(init?.headers)), 'User-Agent': 'Swapsmith-fixture-recorder/0.1' };
      const res = await fetch(input, { ...init, headers });
      map[requestKey(init?.method ?? 'GET', String(input), init?.body as string | undefined)] = { status: res.status, body: trim(await res.clone().json()) };
      return res;
    };
    const resolver = createClient({ cache: memoryCache(), fetch: (i, init) => fetch(i, { ...init, headers: { ...Object.fromEntries(new Headers(init?.headers)), 'User-Agent': 'Swapsmith-fixture-recorder/0.1' } }) });
    const client = createClient({ fetch: fill('scryfall-edgar-full.json', map, recording, ['scryfall-edgar-fallback.json']), cache: memoryCache() });

    // Build the deck as a user would (accept every suggestion, look up Immersturm Predator) without recording it:
    // e2e tests start from this saved deck. RECORD=fill keeps the deck already saved.
    const build = async (): Promise<Deck> => {
      const resolved = await resolveList(resolver, parseDeckList(readFileSync(new URL('../fixtures/edgar-list.txt', import.meta.url), 'utf8')).entries);
      const immersturm = (await fuzzyCard(resolver, 'Immersturm Predator'))!;
      const lines = resolved.map((r) => ({ entry: r.entry, card: r.card ?? r.suggestion ?? immersturm }));
      return { ...buildDeck('Edgar Vampires', lines, commanderCandidates(lines)[0], new Date('2026-11-02T00:00:00Z')), id: 'edgarfull' };
    };
    const deck = FILL ? (JSON.parse(readFileSync(new URL('../fixtures/edgar-deck.json', import.meta.url), 'utf8')) as Deck) : await build();
    writeFileSync(new URL('../fixtures/edgar-deck.json', import.meta.url), JSON.stringify(deck, null, 1) + '\n');

    // What the deck page does: price it, then Find suggestions, then
    // add a budget creature, apply the first swap, and take the first cheaper replacement. (Same
    // requests as the panel: the pool, then the deck's roles.)
    const priced = await priceDeck(client, deck);
    const commander = priced.find((p) => p.isCommander)!.card!;
    const profile = deckProfile(priced.map((p) => ({ name: p.entry.card.name, typeLine: p.typeLine, oracleText: rulesText(p.card), isCommander: p.isCommander })), commander.color_identity);
    const { pool } = await candidatePool(client, profile);
    const { roles } = await deckRoles(client, priced.filter((c) => !c.isCommander).map((c) => ({ oracleId: c.entry.card.oracleId, name: c.entry.card.name })));
    const scored = scoreSuggestions(pool, { colorIdentity: profile.colorIdentity, oracleIds: new Set(priced.map((p) => p.entry.card.oracleId)) }, new Set());
    // The card tests/e2e/suggestions.spec.ts adds by name (a budget creature among the first Creatures upgrades).
    const topBudget = scored.find((s) => s.card.name === 'Indulgent Aristocrat')!;
    const facts = deckCardFacts(priced, roles, pool, { owned: [], unownedBasics: [] });
    const firstSwap = swapPairs(scored, facts, profile)[0].add.card;
    const firstCheaper = cheaperReplacements(facts, scored)[0].options[0].add.card;
    for (const card of [topBudget.card, firstSwap, firstCheaper]) {
      await priceEntries(client, [{ entry: { card: { oracleId: oracleIdOf(card), name: card.name }, qty: 1 }, isCommander: false }], undefined, new Map([[oracleIdOf(card), card]]));
    }

    // Suggestion results are only scored and shown, never read for rules text: drop it to keep the fixture small.
    // (The deck's own prices also use prefer:usd-low, and their rules text is read, so only the pool searches are trimmed.)
    for (const [key, rec] of Object.entries(map)) {
      if (!key.includes('q=f%3Acommander')) continue;
      for (const c of (rec.body as { data?: Array<Record<string, unknown>> }).data ?? []) {
        delete c.oracle_text;
        for (const f of (c.card_faces as Array<Record<string, unknown>> | undefined) ?? []) delete f.oracle_text;
      }
    }
    writeFileSync(new URL('../fixtures/scryfall-edgar-full.json', import.meta.url), JSON.stringify(map) + '\n');
    expect(topBudget).toBeDefined();
  }, 300_000);

  it('records the Edgar Markov EDHREC page, its Scryfall name lookups, a partner redirect and a missing commander', async () => {
    const map: FixtureMap = {};
    const recording: typeof fetch = async (input, init) => {
      const headers = { ...Object.fromEntries(new Headers(init?.headers)), 'User-Agent': 'Swapsmith-fixture-recorder/0.1' };
      const res = await fetch(input, { ...init, headers });
      const url = String(input);
      // EDHREC's 403 for an unknown commander is an HTML page; the app only reads its status.
      const body = await res.clone().json().catch(() => null);
      map[requestKey(init?.method ?? 'GET', url, init?.body as string | undefined)] = { status: res.status, body: url.startsWith(EDHREC_BASE) ? trimEdhrec(body) : trim(body) };
      return res;
    };
    const filled = fill('edhrec-edgar.json', map, recording);
    const edhrec = createEdhrecClient({ fetch: filled, cache: memoryCache() });
    const scryfall = createClient({ fetch: filled, cache: memoryCache() });

    // What Find suggestions does for the seeded Edgar deck (tests/fixtures/edgar-deck.json): count its
    // Game Changers for the starting bracket, then load the pages tests/e2e/edhrec.spec.ts switches to.
    // Each page's lookups start fresh, so the recording holds every listed card; the e2e mock answers
    // any batch of names from them.
    const seeded = JSON.parse(readFileSync(new URL('../fixtures/edgar-deck.json', import.meta.url), 'utf8')) as Deck;
    const gameChangers = await gameChangerCount(scryfall, [seeded.commander.oracleId, ...seeded.cards.map((c) => c.card.oracleId)]);
    if (gameChangers == null) throw new Error('Game Changer search failed');
    const estimated = estimateBracket(gameChangers);
    console.log(`Edgar deck: ${gameChangers} Game Changers, estimated bracket ${estimated}`);
    const load = (filter: PageFilter) => edhrecCandidates(edhrec, scryfall, { slug: 'edgar-markov', filter, colorIdentity: ['B', 'R', 'W'], known: new Map() });
    const result = await load({ bracket: estimated, theme: null, budget: false });
    if (result.status !== 'ok') throw new Error(`EDHREC page: ${result.status}`);
    const everyCard = new Map(result.candidates.map((c) => [oracleIdOf(c.card), c.card.name]));
    for (const filter of [
      { bracket: null, theme: null, budget: false },
      { bracket: estimated, theme: 'vampires', budget: false },
      { bracket: estimated, theme: null, budget: true },
      { bracket: 2, theme: null, budget: false },
      { bracket: 1, theme: 'vampires', budget: false }, // too few decks, so all brackets of Vampires
    ]) {
      const page = await load(filter);
      if (page.status !== 'ok') throw new Error(`EDHREC page ${JSON.stringify(filter)} failed`);
      for (const c of page.candidates) everyCard.set(oracleIdOf(c.card), c.card.name);
    }
    // tests/e2e/edhrec.spec.ts adds Herald's Horn, which prices it.
    const horn = result.candidates.find((c) => c.card.name === "Herald's Horn")!.card;
    await priceEntries(scryfall, [{ entry: { card: { oracleId: oracleIdOf(horn), name: horn.name }, qty: 1 }, isCommander: false }], undefined, new Map([[oracleIdOf(horn), horn]]));

    // What Swaps and Cheaper do on that page: look up the roles of the 60 best cards, then price the
    // first swap's add and the first cheaper replacement, which the e2e tests apply. The deck's own
    // prices and roles come from scryfall-edgar-full.json, as the e2e mock serves them.
    const replay = createClient({ fetch: fixtureFetch(JSON.parse(readFileSync(new URL('../fixtures/scryfall-edgar-full.json', import.meta.url), 'utf8'))), cache: memoryCache(), sleep: async () => {} });
    const priced = await priceDeck(replay, seeded);
    const oracleIds = new Set(priced.map((p) => p.entry.card.oracleId));
    const edgarId = ['B', 'R', 'W'];
    const unchecked = scoreEdhrec(result.candidates, { colorIdentity: edgarId, oracleIds }, new Set(), 'Edgar Markov');
    const { roles: candidateRoles, complete } = await deckRoles(scryfall, roleLookupNames(unchecked));
    if (!complete) throw new Error('candidate role lookup incomplete');
    const { roles: ownRoles } = await deckRoles(replay, priced.filter((c) => !c.isCommander).map((c) => ({ oracleId: c.entry.card.oracleId, name: c.entry.card.name })));
    const facts = deckCardFacts(priced, ownRoles, [], { owned: [], unownedBasics: [] }, candidateRoles);
    const scored = scoreEdhrec(result.candidates, { colorIdentity: edgarId, oracleIds }, new Set(), 'Edgar Markov', candidateRoles);
    const profile = deckProfile(priced.map((p) => ({ name: p.entry.card.name, typeLine: p.typeLine, oracleText: rulesText(p.card), isCommander: p.isCommander })), edgarId);
    const firstSwap = swapPairs(scored, facts, profile, { keepScores: edhrecKeepScores(facts, result.page), matchType: true })[0];
    const firstCheaper = cheaperReplacements(facts, scored, 3, { deckRolesKnown: true })[0];
    console.log(`EDHREC swap: ${firstSwap.cut.name} → ${firstSwap.add.card.name}; cheaper: ${firstCheaper.card.name} → ${firstCheaper.options[0].add.card.name}`);
    for (const card of [firstSwap.add.card, firstCheaper.options[0].add.card]) {
      await priceEntries(scryfall, [{ entry: { card: { oracleId: oracleIdOf(card), name: card.name }, qty: 1 }, isCommander: false }], undefined, new Map([[oracleIdOf(card), card]]));
    }
    // After a filter change the panel looks up roles for that page's best cards, batched by what it
    // already knows. Record the roles of every card on every page, so the e2e mock can answer any batch.
    if (!(await deckRoles(scryfall, [...everyCard].map(([oracleId, name]) => ({ oracleId, name })))).complete) throw new Error('role lookup for every card incomplete');
    await commanderPage(edhrec, '/commanders/tymna-the-weaver-thrasios-triton-hero');
    await commanderPage(edhrec, '/commanders/not-a-real-commander-swapsmith');

    writeFileSync(new URL('../fixtures/edhrec-edgar.json', import.meta.url), JSON.stringify(map) + '\n');
  }, 300_000);

  it('records the wider fallback searches for the Edgar deck (only those not already in scryfall-edgar-full.json)', async () => {
    const map: FixtureMap = {};
    const recording: typeof fetch = async (input, init) => {
      const headers = { ...Object.fromEntries(new Headers(init?.headers)), 'User-Agent': 'Swapsmith-fixture-recorder/0.1' };
      const res = await fetch(input, { ...init, headers });
      map[requestKey(init?.method ?? 'GET', String(input), init?.body as string | undefined)] = { status: res.status, body: trim(await res.clone().json()) };
      return res;
    };
    const full: FixtureMap = JSON.parse(readFileSync(new URL('../fixtures/scryfall-edgar-full.json', import.meta.url), 'utf8'));
    const replay = createClient({ fetch: fixtureFetch(full), cache: memoryCache(), sleep: async () => {} });
    const client = createClient({ fetch: fill('scryfall-edgar-fallback.json', map, recording), cache: memoryCache() });

    // The deck as the e2e tests price it, then the pool Find builds when EDHREC has nothing.
    const seeded = JSON.parse(readFileSync(new URL('../fixtures/edgar-deck.json', import.meta.url), 'utf8')) as Deck;
    const priced = await priceDeck(replay, seeded);
    const commander = priced.find((p) => p.isCommander)!.card!;
    const profile = deckProfile(priced.map((p) => ({ name: p.entry.card.name, typeLine: p.typeLine, oracleText: rulesText(p.card), isCommander: p.isCommander })), commander.color_identity);
    console.log(`Edgar themes: ${profile.themes.map((t) => t.label).join(', ')}`);
    const { pool, failed } = await candidatePool(client, profile);
    if (failed.length) throw new Error(`searches failed: ${failed.join(', ')}`);

    // tests/e2e/suggestions.spec.ts applies the first swap and the first two cheaper options for
    // Minas Tirith, which prices them. The deck's roles come from the full recording.
    const { roles } = await deckRoles(replay, priced.filter((c) => !c.isCommander).map((c) => ({ oracleId: c.entry.card.oracleId, name: c.entry.card.name })));
    const facts = deckCardFacts(priced, roles, pool, { owned: [], unownedBasics: [] });
    const scored = scoreSuggestions(pool, { colorIdentity: profile.colorIdentity, oracleIds: new Set(facts.map((c) => c.oracleId)) }, new Set());
    const firstSwap = swapPairs(scored, facts, profile)[0].add.card;
    const minas = cheaperReplacements(facts, scored).find((r) => r.card.name === 'Minas Tirith')!.options.slice(0, 2).map((o) => o.add.card);
    console.log(`Fallback swap add: ${firstSwap.name}; Minas Tirith options: ${minas.map((c) => c.name).join(', ')}`);
    for (const card of [firstSwap, ...minas]) {
      await priceEntries(client, [{ entry: { card: { oracleId: oracleIdOf(card), name: card.name }, qty: 1 }, isCommander: false }], undefined, new Map([[oracleIdOf(card), card]]));
    }

    // Rules text isn't read from suggestions; drop it like the full recording does.
    for (const [key, rec] of Object.entries(map)) {
      if (key in full) delete map[key];
      else for (const c of (rec.body as { data?: Array<Record<string, unknown>> }).data ?? []) delete c.oracle_text;
    }
    writeFileSync(new URL('../fixtures/scryfall-edgar-fallback.json', import.meta.url), JSON.stringify(map) + '\n');
    expect(pool.length).toBeGreaterThan(100);
  }, 300_000);

  it('records lookups for the full Edgar Markov list', async () => {
    const map: FixtureMap = {};
    const recording: typeof fetch = async (input, init) => {
      const headers = { ...Object.fromEntries(new Headers(init?.headers)), 'User-Agent': 'Swapsmith-fixture-recorder/0.1' };
      const res = await fetch(input, { ...init, headers });
      map[requestKey(init?.method ?? 'GET', String(input), init?.body as string | undefined)] = { status: res.status, body: trim(await res.clone().json()) };
      return res;
    };
    const client = createClient({ fetch: fill('scryfall-edgar-resolve.json', map, recording), cache: memoryCache() });
    await resolveList(client, parseDeckList(readFileSync(new URL('../fixtures/edgar-list.txt', import.meta.url), 'utf8')).entries);
    writeFileSync(new URL('../fixtures/scryfall-edgar-resolve.json', import.meta.url), JSON.stringify(map, null, 1) + '\n');
    expect(Object.keys(map).length).toBeGreaterThan(2);
  }, 120_000);

  // Breya, Etherium Shaper (W/U/B/R, artifacts) plays dozens of mana rocks and dual lands, which is what tests/unit/similar-fixtures.test.ts
  // needs to check that a mana rock's options are mana rocks and a dual land's are lands. Recorded 2026-11-06. Kept apart from the Edgar
  // flow so no other fixture or pinned e2e total moves; unlike the Edgar recordings it keeps produced_mana, power and toughness.
  it('records the Breya EDHREC page, its Scryfall name lookups and role lookups', async () => {
    const map: FixtureMap = {};
    const recording: typeof fetch = async (input, init) => {
      const headers = { ...Object.fromEntries(new Headers(init?.headers)), 'User-Agent': 'Swapsmith-fixture-recorder/0.1' };
      const res = await fetch(input, { ...init, headers });
      const url = String(input);
      const body = await res.clone().json().catch(() => null);
      // Role lookups are only read for the card's name and Oracle ID.
      const roleSearch = decodeURIComponent(url).includes('q=otag:');
      const kept = roleSearch && body?.object === 'list' ? { ...body, data: body.data.map((c: Record<string, unknown>) => ({ object: 'card', id: c.id, oracle_id: c.oracle_id, name: c.name })) } : body;
      map[requestKey(init?.method ?? 'GET', url, init?.body as string | undefined)] = { status: res.status, body: url.startsWith(EDHREC_BASE) ? trimEdhrec(kept) : trim(kept, { compareFields: true }) };
      return res;
    };
    const filled = fill('edhrec-breya.json', map, recording);
    const edhrec = createEdhrecClient({ fetch: filled, cache: memoryCache() });
    const scryfall = createClient({ fetch: filled, cache: memoryCache() });

    const commander = (await cardByName(scryfall, BREYA.commander))!;
    expect(commander.color_identity).toEqual(BREYA.colorIdentity);
    const { page, scored } = await scoredPage(edhrec, scryfall, { ...BREYA, filter: { bracket: null, theme: null, budget: false } });
    // The roles of every page card, for the tapped card (a deck card, whose roles the deck's own lookup gives).
    await pageRoles(scryfall, page);

    writeFileSync(new URL('../fixtures/edhrec-breya.json', import.meta.url), JSON.stringify(map) + '\n');
    console.log(`Breya: ${page.candidates.length} page cards, ${scored.length} scored`);
    expect(page.candidates.length).toBeGreaterThan(200);
  }, 600_000);
});

describe.runIf(process.env.RECORD === '1' || FILL)('record Browse fixtures', () => {
  it('records the Browse searches: every sort, no match, an ignored term, a bad query', async () => {
    const map: FixtureMap = {};
    const recording: typeof fetch = async (input, init) => {
      const headers = { ...Object.fromEntries(new Headers(init?.headers)), 'User-Agent': 'Swapsmith-fixture-recorder/0.1' };
      const res = await fetch(input, { ...init, headers });
      const body = await res.clone().json();
      map[requestKey(init?.method ?? 'GET', String(input), init?.body as string | undefined)] = { status: res.status, body: trim(body, { allLegalities: full }) };
      return res;
    };
    // The card detail reads every format's legality; the big searches below only need Commander, which keeps the file small.
    let full = true;
    const client = createClient({ fetch: fill('scryfall-browse.json', map, recording), cache: memoryCache() });
    const crypt = 'legal:commander name:"crypt"';
    for (const s of SORTS) await searchCards(client, crypt, s.id, s.descending, 1);
    // The same search the other way round, for the direction toggle.
    await searchCards(client, crypt, 'popularity', true, 1);
    await searchCards(client, 'legal:commander name:"zzzzqq"', 'popularity', false, 1);
    // Scryfall ignores an unknown keyword and answers 200 with a warning.
    await searchCards(client, `${crypt} (bogus:thing)`, 'popularity', false, 1);
    // An advanced term that narrows the same search.
    await searchCards(client, `${crypt} (t:land)`, 'popularity', false, 1);
    // A 400 can't come from the form (it refuses unbalanced parentheses first), so it is recorded straight from the API.
    await searchCards(client, 'legal:commander (t:elf', 'popularity', false, 1).catch(() => undefined);
    // A search with more than one page (187 matches: 175 then 12), and the same search sorted by price.
    full = false;
    const sol = 'legal:commander name:"sol"';
    await searchCards(client, sol, 'popularity', false, 1);
    await searchCards(client, sol, 'popularity', false, 2);
    await searchCards(client, sol, 'price', true, 1);
    // One real search per filter (tests/support/browse-samples.ts).
    for (const sample of SAMPLES) await searchCards(client, sample.q, 'popularity', false, 1);
    // The cheapest printing of the cards the e2e tests open in the card detail: Sol Ring (dozens of printings), a spell, and a double-faced card.
    const pick = async (q: string, cardName: string) => (await searchCards(client, q, 'popularity', false, 1)).cards.find((c) => c.name === cardName)!;
    for (const [q, cardName] of [[sol, 'Sol Ring'], [crypt, 'Crypt Ghast'], [crypt, "Agadeem's Awakening // Agadeem, the Undercrypt"]] as const) {
      const card = await pick(q, cardName);
      await cheapestPrintings(client, [card.oracle_id ?? card.card_faces![0].oracle_id!]);
    }
    // Add to deck…: basic lands to repeat, and the commanders New deck… finds and Add to deck… looks up (one lookup per commander, as the app asks).
    await searchCards(client, BASIC_SWAMP_QUERY, 'popularity', false, 1);
    await searchCommanders(client, SOLPHIM_TYPED);
    for (const [typed, wanted] of [[COMMANDER_TYPED.green, 'Selvala, Heart of the Wilds'], [COMMANDER_TYPED.black, 'Edgar Markov']] as const) {
      const found = (await searchCommanders(client, typed)).find((c) => c.name === wanted)!;
      await cardsByOracleId(client, [found.oracle_id!]);
    }
    writeFileSync(new URL('../fixtures/scryfall-browse.json', import.meta.url), JSON.stringify(map));
    console.log(`recorded ${Object.keys(map).length} Browse requests`);
  }, 120_000);
});
