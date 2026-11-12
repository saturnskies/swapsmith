import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { deckTotals } from '../../src/lib/deck';
import { parseDeckList } from '../../src/lib/parse';
import { printings } from '../../src/scryfall/cards';
import { createClient, memoryCache, ScryfallError } from '../../src/scryfall/client';
import { buildDeck, commanderCandidates, priceDeck, priceEntries, resolveList, withPrinting } from '../../src/scryfall/resolve';
import type { ScryCard } from '../../src/scryfall/types';
import { fixtureFetch, type FixtureMap } from '../support/fixtures';

// Real Scryfall replies for tests/fixtures/e2e-list.txt (see record-fixtures.test.ts): the lookups recorded 2026-11-02, the prices 2026-11-12.
const map: FixtureMap = JSON.parse(readFileSync(new URL('../fixtures/scryfall-e2e.json', import.meta.url), 'utf8'));
const list = readFileSync(new URL('../fixtures/e2e-list.txt', import.meta.url), 'utf8');

function setup() {
  const fetch = fixtureFetch(map);
  return { fetch, client: createClient({ fetch, cache: memoryCache(), spacingMs: 0 }) };
}

async function resolvedLines() {
  const { client, fetch } = setup();
  const resolved = await resolveList(client, parseDeckList(list).entries);
  const lines = resolved.flatMap((r) => (r.card ? [{ entry: r.entry, card: r.card }] : r.suggestion ? [{ entry: r.entry, card: r.suggestion }] : []));
  return { client, fetch, resolved, lines };
}

describe('resolveList', () => {
  it('matches a double-faced card by its full "A // B" name', async () => {
    const { resolved } = await resolvedLines();
    expect(resolved[1].card?.name).toBe('Bloodline Keeper // Lord of Lineage');
  });

  it('offers Scryfall\'s "did you mean" for a typo, and nothing when no card is close', async () => {
    const { resolved, fetch } = await resolvedLines();
    expect(resolved[2]).toMatchObject({ card: null, suggestion: { name: 'Kalastria Highborn' } });
    expect(resolved[3]).toMatchObject({ card: null, suggestion: null });
    expect(fetch.misses).toEqual([]);
  });
});

describe('resolveList on the full Edgar Markov list (real replies)', () => {
  const edgarMap: FixtureMap = JSON.parse(readFileSync(new URL('../fixtures/scryfall-edgar-resolve.json', import.meta.url), 'utf8'));
  const edgarList = readFileSync(new URL('../fixtures/edgar-list.txt', import.meta.url), 'utf8');

  async function resolveEdgar() {
    const fetch = fixtureFetch(edgarMap);
    const resolved = await resolveList(createClient({ fetch, cache: memoryCache(), spacingMs: 0 }), parseDeckList(edgarList).entries);
    return { fetch, resolved, byName: (n: string) => resolved.find((r) => r.entry.name === n)! };
  }

  it('asks only about the real typos, each with the right suggestion', async () => {
    const { resolved, fetch } = await resolveEdgar();
    const open = resolved.filter((r) => !r.card).map((r) => [r.entry.name, r.suggestion?.name ?? null]);
    expect(open).toEqual([
      ['Calastria Highborn', 'Kalastria Highborn'],
      ['Chiral Attentive First Year', 'Kirol, Attentive First-Year'],
      ['Emmerstorm Predator', null],
      ['Sanguine Siphoner', 'Sanguine Syphoner'],
    ]);
    expect(fetch.misses).toEqual([]);
  });

  it('accepts spellings that differ only in spaces or punctuation', async () => {
    const { byName } = await resolveEdgar();
    expect(byName('Stromkirk Blood-Thief').card?.name).toBe('Stromkirk Bloodthief');
    expect(byName('Null Priest of Oblivion').card?.name).toBe('Nullpriest of Oblivion');
    expect(byName("Moogle's Valor").card?.name).toBe("Moogles' Valor");
  });

  it('gets the real Sign in Blood, not Scheming Silvertongue // Sign in Blood', async () => {
    const { byName } = await resolveEdgar();
    expect(byName('Sign in Blood').card?.name).toBe('Sign in Blood');
    expect(byName('Scheming Silvertongue').card?.name).toBe('Scheming Silvertongue // Sign in Blood');
  });

  it('matches alternate printed names and says which card they are', async () => {
    const { byName } = await resolveEdgar();
    expect(byName('Panther Idol')).toMatchObject({ card: { name: "Mind's Eye" }, aliasOf: "Mind's Eye" });
    expect(byName('Dracula, Blood Immortal')).toMatchObject({ card: { name: 'Falkenrath Forebear' }, aliasOf: 'Falkenrath Forebear' });
    expect(byName('Edgar Markov').aliasOf).toBeUndefined();
  });
});

describe('commanderCandidates and buildDeck', () => {
  it('finds Edgar Markov as the only legendary creature, and keeps him out of the 99', async () => {
    const { lines } = await resolvedLines();
    const candidates = commanderCandidates(lines);
    expect(candidates.map((c) => c.name)).toEqual(['Edgar Markov']);

    const deck = buildDeck('', lines, candidates[0]);
    expect(deck.name).toBe('Edgar Markov deck');
    expect(deck.commander.name).toBe('Edgar Markov');
    expect(deck.cards.map((e) => [e.card.name, e.qty])).toEqual([
      ['Bloodline Keeper // Lord of Lineage', 1], ['Kalastria Highborn', 1], ['Sol Ring', 1], ['Vampire Nighthawk', 1], ['Swamp', 8],
    ]);
  });

  it('prefers lines marked as commander over other legends', () => {
    const legend = (name: string) => ({ id: name, oracle_id: name, name, type_line: 'Legendary Creature — Vampire' }) as ScryCard;
    const lines = [
      { entry: { qty: 1, name: 'A', isCommander: false, line: 1 }, card: legend('A') },
      { entry: { qty: 1, name: 'B', isCommander: true, line: 2 }, card: legend('B') },
    ];
    expect(commanderCandidates(lines).map((c) => c.name)).toEqual(['B']);
  });
});

describe('priceDeck', () => {
  it('prices each card at its cheapest printing, with direct TCGplayer links', async () => {
    const { client, lines, fetch } = await resolvedLines();
    const progress: Array<[number, number]> = [];
    const priced = await priceDeck(client, buildDeck('E2E', lines, commanderCandidates(lines)[0]), (d, t) => progress.push([d, t]));

    expect(priced.map((p) => [p.entry.card.name, p.card?.set, p.card?.collector_number, p.price, p.finish])).toEqual([
      ['Edgar Markov', 'inr', '428', 32.17, 'nonfoil'],
      ['Bloodline Keeper // Lord of Lineage', 'inr', '327', 4.94, 'nonfoil'],
      ['Kalastria Highborn', 'fdn', '753', 0.27, 'nonfoil'],
      ['Sol Ring', 'trc', '499', 1.28, 'nonfoil'],
      ['Vampire Nighthawk', 'c13', '97', 0.16, 'nonfoil'],
      ['Swamp', 'fdn', '276', 0.09, 'nonfoil'],
    ]);
    expect(priced[0]).toMatchObject({ isCommander: true, url: 'https://www.tcgplayer.com/product/596294' });
    expect(deckTotals(priced.map((p) => ({ qty: p.entry.qty, price: p.price })))).toEqual({ total: 39.54, unpriced: 0, count: 13 });
    expect(progress[0]).toEqual([0, 6]);
    expect(progress.at(-1)).toEqual([6, 6]);
    expect(fetch.misses).toEqual([]);
  });

  it('needs one request for a small deck: no lookup per card, and no list of every printing', async () => {
    const { lines } = await resolvedLines();
    const recorded = fixtureFetch(map);
    const calls: string[] = [];
    const counting: typeof fetch = async (input, init) => {
      calls.push(String(input));
      return recorded(input, init);
    };
    await priceDeck(createClient({ fetch: counting, cache: memoryCache(), spacingMs: 0 }), buildDeck('E2E', lines, commanderCandidates(lines)[0]));
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('unique=cards');
    expect(recorded.misses).toEqual([]);
  });

  it('prices a chosen printing instead of the cheapest, and goes back to the cheapest', async () => {
    const { client, lines } = await resolvedLines();
    const deck = buildDeck('E2E', lines, commanderCandidates(lines)[0]);
    const edgar = (await priceDeck(client, deck))[0];
    const prints = await printings(client, deck.commander.oracleId);
    expect(prints.map((c) => `${c.set} ${c.collector_number}`)).toEqual(expect.arrayContaining(['inr 428', 'inr 328', 'c17 36']));

    const inr328 = prints.find((c) => c.collector_number === '328')!;
    const picked = withPrinting(edgar, inr328);
    expect(picked).toMatchObject({ price: 33.4, finish: 'nonfoil', url: 'https://www.tcgplayer.com/product/596295', entry: { printingId: inr328.id } });
    expect(edgar.entry.printingId).toBeUndefined(); // the original is unchanged

    // A foil-only printing is priced at its foil.
    expect(withPrinting(edgar, prints.find((c) => c.set === 'c17')!)).toMatchObject({ price: 42.51, finish: 'foil' });

    const reset = withPrinting(picked, undefined);
    expect(reset).toMatchObject({ price: 32.17, card: { collector_number: '428' } });
    expect(reset.entry.printingId).toBeUndefined();
  });

  it('prices the commander at its chosen printing when the deck says so, and still knows the cheapest', async () => {
    const { client, lines, fetch } = await resolvedLines();
    const deck = buildDeck('E2E', lines, commanderCandidates(lines)[0]);
    const inr328 = (await printings(client, deck.commander.oracleId)).find((c) => c.collector_number === '328')!;
    const again = await priceDeck(client, { ...deck, commanderPrintingId: inr328.id });
    expect(again[0]).toMatchObject({ isCommander: true, price: 33.4, finish: 'nonfoil', card: { collector_number: '328' }, cheapest: { collector_number: '428' } });
    expect(fetch.misses).toEqual([]);
  });
});

// Hand-made replies in the shape of the recorded ones, for failures and cards the recordings don't hold.
describe('priceEntries when Scryfall answers only in part', () => {
  const card = (id: string, usd: string | null, extra: Partial<ScryCard> = {}) =>
    ({ object: 'card', id: `print-${id}`, oracle_id: id, name: `Card ${id}`, set: 'tst', collector_number: '1', type_line: 'Creature', prices: { usd, usd_foil: null, usd_etched: null }, ...extra }) as ScryCard;
  const entry = (id: string, printingId?: string) => ({ entry: { card: { oracleId: id, name: `Card ${id}` }, qty: 1, ...(printingId ? { printingId } : {}) }, isCommander: false });
  /** Enough cards for two searches (a search holds about 17). */
  const many = Array.from({ length: 30 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
  const asked = (path: string) => [...(new URLSearchParams(path.split('?')[1]).get('q') ?? '').matchAll(/oracleid:([\w-]+)/g)].map((m) => m[1]);

  function stub(o: { search?: (ids: string[]) => ScryCard[]; collection?: (body: { identifiers: Array<Record<string, string>> }) => unknown } = {}) {
    const calls: string[] = [];
    const client = {
      get: async <T,>(path: string) => {
        calls.push(`GET ${path}`);
        return { object: 'list', data: (o.search ?? ((ids) => ids.map((id) => card(id, '1.00'))))(asked(path)) } as T;
      },
      post: async <T,>(path: string, body: unknown) => {
        calls.push(`POST ${path} ${JSON.stringify(body)}`);
        if (!o.collection) throw new Error('unexpected lookup');
        return o.collection(body as { identifiers: Array<Record<string, string>> }) as T;
      },
    };
    return { client, calls };
  }

  it('still prices the rest of the deck when one search fails, and marks the cards it could not price', async () => {
    const { client } = stub({
      search: (ids) => {
        if (ids.includes(many[0])) throw new ScryfallError(0, 'offline');
        return ids.map((id) => card(id, '2.00'));
      },
      collection: () => ({ object: 'list', data: [card(many[0], '9.99')] }),
    });
    const priced = await priceEntries(client, many.map((id) => entry(id)));
    const failed = priced.filter((p) => p.failed);
    expect(failed.length).toBeGreaterThan(0);
    expect(failed.length).toBeLessThan(30);
    expect(priced.at(-1)).toMatchObject({ price: 2, card: { oracle_id: many[29] } });
    // A card whose price didn't load keeps its name and type (from a plain lookup) but never shows that lookup's price.
    expect(priced[0]).toMatchObject({ failed: true, price: null, cheapest: null, card: { oracle_id: many[0] }, typeLine: 'Creature' });
    expect(priced[1]).toMatchObject({ failed: true, price: null, card: null });
  });

  it('throws when nothing at all could be loaded, so the screen can say Scryfall is unreachable', async () => {
    const { client } = stub({ search: () => { throw new ScryfallError(0, 'offline'); } });
    await expect(priceEntries(client, [entry('a'), entry('b')])).rejects.toThrow();
  });

  it('keeps a just-added card in the list, unpriced, when its price cannot be loaded', async () => {
    const { client, calls } = stub({ search: () => { throw new ScryfallError(0, 'offline'); } });
    const [p] = await priceEntries(client, [entry('a')], undefined, new Map([['a', card('a', '5.00')]]));
    expect(p).toMatchObject({ failed: true, price: null, card: { oracle_id: 'a' } });
    expect(calls).toHaveLength(1); // the card is already in hand: no second lookup
  });

  it('keeps a card with no Scryfall match in the list, unpriced', async () => {
    const { client } = stub({
      search: (ids) => ids.filter((id) => id !== 'gone').map((id) => card(id, '3.00')),
      collection: () => ({ object: 'list', not_found: [{ oracle_id: 'gone' }], data: [] }),
    });
    const priced = await priceEntries(client, [entry('a'), entry('gone')]);
    expect(priced[0]).toMatchObject({ price: 3 });
    expect(priced[1]).toMatchObject({ card: null, price: null, url: null });
    expect(priced[1].failed).toBeUndefined();
    expect(deckTotals(priced.map((p) => ({ qty: p.entry.qty, price: p.price })))).toMatchObject({ unpriced: 1 });
  });

  it('shows a card that has no paper printing by name and type, unpriced', async () => {
    const { client, calls } = stub({
      search: (ids) => ids.filter((id) => id !== 'digital').map((id) => card(id, '3.00')),
      collection: () => ({ object: 'list', data: [card('digital', '7.00', { type_line: 'Artifact' })] }),
    });
    const priced = await priceEntries(client, [entry('a'), entry('digital')]);
    expect(priced[1]).toMatchObject({ card: { oracle_id: 'digital' }, typeLine: 'Artifact', price: null, cheapest: null });
    expect(calls.filter((c) => c.startsWith('POST'))).toEqual([`POST /cards/collection ${JSON.stringify({ identifiers: [{ oracle_id: 'digital' }] })}`]);
  });

  it('looks up every picked printing in one request and prices each card at its own', async () => {
    const { client, calls } = stub({
      collection: ({ identifiers }) => ({ object: 'list', data: identifiers.map(({ id }) => card(id.replace('pin-', ''), '8.00', { id })) }),
    });
    const priced = await priceEntries(client, [entry('a', 'pin-a'), entry('b', 'pin-b'), entry('c')]);
    expect(priced.map((p) => [p.card?.id, p.price, p.cheapest?.id])).toEqual([['pin-a', 8, 'print-a'], ['pin-b', 8, 'print-b'], ['print-c', 1, 'print-c']]);
    expect(calls.filter((c) => c.startsWith('POST'))).toHaveLength(1);
  });

  it('falls back to the cheapest printing when a picked printing no longer exists or belongs to another card', async () => {
    const { client } = stub({
      // "pin-gone" is not found; "pin-b" turns out to be a printing of some other card (a hand-made share link).
      collection: () => ({ object: 'list', not_found: [{ id: 'pin-gone' }], data: [card('other', '500.00', { id: 'pin-b' })] }),
    });
    const priced = await priceEntries(client, [entry('a', 'pin-gone'), entry('b', 'pin-b')]);
    expect(priced.map((p) => [p.card?.id, p.price])).toEqual([['print-a', 1], ['print-b', 1]]);
  });

  it('leaves a card unpriced, rather than priced at another printing, when its picked printing cannot be loaded', async () => {
    const { client } = stub({ collection: () => { throw new ScryfallError(0, 'offline'); } });
    const priced = await priceEntries(client, [entry('a', 'pin-a'), entry('b')]);
    expect(priced[0]).toMatchObject({ failed: true, price: null, cheapest: { id: 'print-a' } });
    expect(priced[1]).toMatchObject({ price: 1 });
    expect(priced[1].failed).toBeUndefined();

    // Going back to the cheapest printing, which did load, prices the card and clears the failure.
    const reset = withPrinting(priced[0], undefined);
    expect(reset).toMatchObject({ price: 1, card: { id: 'print-a' } });
    expect(reset.failed).toBeUndefined();
    expect(reset.entry.printingId).toBeUndefined();
  });
});
