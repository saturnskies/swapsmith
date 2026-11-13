import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { autocompleteNames, cardByName, cheapestPrintings, printings, searchCommanders } from '../../src/scryfall/cards';
import { createClient, memoryCache, ScryfallError } from '../../src/scryfall/client';
import { priceEntries } from '../../src/scryfall/resolve';
import { fixtureFetch, type FixtureMap } from '../support/fixtures';
import type { ScryfallClient } from '../../src/scryfall/client';

describe('cheapestPrintings', () => {
  const stub = (get: (q: string) => unknown): ScryfallClient => ({
    get: async <T,>(path: string) => get(new URLSearchParams(path.split('?')[1]).get('q')!) as T,
    post: async () => { throw new Error('unused'); },
  });
  const asked = (q: string) => [...q.matchAll(/oracleid:([\w-]+)/g)].map((m) => m[1]);
  const ids = Array.from({ length: 47 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);

  it('keeps every search under Scryfall\'s query limit and asks for each card exactly once', async () => {
    // Scryfall silently drops the end of a query longer than ~1,000 characters (checked 2026-11-02).
    const seen: string[] = [];
    const client = stub((q) => {
      expect(q.length).toBeLessThanOrEqual(900);
      expect(q).toContain('prefer:usd-low');
      seen.push(...asked(q));
      return { object: 'list', has_more: false, data: [] };
    });
    await cheapestPrintings(client, [...ids, ids[0]]);
    expect([...seen].sort()).toEqual([...ids].sort());
  });

  it('asks for one result per card, not every printing', async () => {
    const paths: string[] = [];
    const client: ScryfallClient = { get: async <T,>(path: string) => { paths.push(path); return { object: 'list', data: [] } as T; }, post: async () => { throw new Error('unused'); } };
    await cheapestPrintings(client, ['a']);
    expect(new URLSearchParams(paths[0].split('?')[1]).get('unique')).toBe('cards');
  });

  it('keys each card by its Oracle ID (the front face\'s for a double-faced card) and ignores a card it did not ask for', async () => {
    const client = stub(() => ({
      object: 'list',
      data: [{ oracle_id: 'a', name: 'A' }, { name: 'B // C', card_faces: [{ oracle_id: 'b', name: 'B' }] }, { oracle_id: 'stranger', name: 'Stranger' }],
    }));
    const { cards, failed } = await cheapestPrintings(client, ['a', 'b', 'none']);
    expect([...cards].map(([id, c]) => [id, c.name])).toEqual([['a', 'A'], ['b', 'B // C']]);
    expect(failed.size).toBe(0); // 'none' has no paper printing: not found, but not a failure
  });

  it('treats "no match" (404) as cards without a paper printing, not as a failure', async () => {
    const client = stub(() => { throw new ScryfallError(404, 'no cards'); });
    const { cards, failed } = await cheapestPrintings(client, ['a']);
    expect(cards.size).toBe(0);
    expect(failed.size).toBe(0);
  });

  it('keeps the batches that answered when another fails, names the cards that failed, and reports every batch', async () => {
    const batches: string[][] = [];
    const client = stub((q) => {
      const wanted = asked(q);
      if (wanted.includes(ids[0])) throw new ScryfallError(0, 'offline');
      return { object: 'list', data: wanted.map((id) => ({ oracle_id: id, name: id })) };
    });
    const { cards, failed } = await cheapestPrintings(client, ids, (b) => batches.push(b));
    expect(failed.has(ids[0])).toBe(true);
    expect(cards.has(ids[46])).toBe(true);
    expect(cards.size + failed.size).toBe(47);
    expect([...cards.keys()].some((id) => failed.has(id))).toBe(false);
    expect(batches.flat().sort()).toEqual([...ids].sort());
  });
});

// Real replies for the new-deck flow (see record-fixtures.test.ts): searches recorded 2026-11-02, prices 2026-11-12.
const newDeckMap: FixtureMap = JSON.parse(readFileSync(new URL('../fixtures/scryfall-new-deck.json', import.meta.url), 'utf8'));
const recorded = () => {
  const fetch = fixtureFetch(newDeckMap);
  return { fetch, client: createClient({ fetch, cache: memoryCache(), spacingMs: 0, heavySpacingMs: 0 }) };
};

describe('searchCommanders', () => {
  it('finds commanders by name, most-played first', async () => {
    const { client, fetch } = recorded();
    const found = await searchCommanders(client, 'edgar');
    expect(found[0].name).toBe('Edgar Markov');
    expect(found.length).toBeGreaterThan(1);
    expect(fetch.misses).toEqual([]);
  });

  it('asks nothing for fewer than 2 characters, and strips quotes from the typed text', async () => {
    const paths: string[] = [];
    const client = { get: async <T,>(p: string) => { paths.push(p); return { object: 'list', data: [] } as T; }, post: async () => { throw new Error('unused'); } };
    expect(await searchCommanders(client, ' e ')).toEqual([]);
    await searchCommanders(client, 'ed"gar');
    expect(paths).toHaveLength(1);
    expect(new URLSearchParams(paths[0].split('?')[1]).get('q')).toBe('is:commander game:paper "ed gar"');
  });
});

describe('autocompleteNames and cardByName', () => {
  it('drops art-series names like "Sol Ring // Sol Ring"', async () => {
    const { client } = recorded();
    expect(await autocompleteNames(client, 'sol r')).toEqual(['Sol Ring']);
  });

  it('looks up a card by exact name, and returns null when Scryfall has none', async () => {
    const { client } = recorded();
    expect((await cardByName(client, 'Llanowar Elves'))?.color_identity).toEqual(['G']);
    const notFound = JSON.parse(readFileSync(new URL('../fixtures/scryfall-404-named.json', import.meta.url), 'utf8'));
    const none = createClient({ fetch: async () => new Response(JSON.stringify(notFound), { status: 404 }), cache: memoryCache(), spacingMs: 0, heavySpacingMs: 0 });
    expect(await cardByName(none, 'Calastria Highborn')).toBeNull();
  });
});

describe('priceEntries with a known card', () => {
  it('prices a just-added card without looking it up again', async () => {
    const { client, fetch } = recorded();
    const sol = (await cardByName(client, 'Sol Ring'))!;
    const calls: string[] = [];
    const counting = createClient({ fetch: async (i, init) => { calls.push(String(i)); return fetch(i, init); }, cache: memoryCache(), spacingMs: 0, heavySpacingMs: 0 });
    const [p] = await priceEntries(counting, [{ entry: { card: { oracleId: sol.oracle_id!, name: 'Sol Ring' }, qty: 1 }, isCommander: false }], undefined, new Map([[sol.oracle_id!, sol]]));
    expect(p.price).toBe(1.28);
    expect(calls).toHaveLength(1); // just the search for its cheapest printing; no collection lookup
    expect(calls[0]).toContain('/cards/search');
    expect(fetch.misses).toEqual([]);
  });
});

// The real API (SCRYFALL_LIVE=1): a 200 can carry warnings for terms Scryfall dropped, so the search this
// app builds is checked for none, and for what it is relied on to return.
describe.runIf(process.env.SCRYFALL_LIVE === '1')('live cheapest-printing search (SCRYFALL_LIVE=1)', () => {
  const withUa: typeof fetch = (input, init) =>
    fetch(input, { ...init, headers: { ...Object.fromEntries(new Headers(init?.headers)), 'User-Agent': 'Swapsmith-tests/0.1' } });

  it('returns one priced paper printing per card, with no ignored term, and the lowest nonfoil price among its printings', async () => {
    const bodies: Array<{ warnings?: string[]; has_more?: boolean }> = [];
    const spy: typeof fetch = async (input, init) => {
      const res = await withUa(input, init);
      bodies.push(await res.clone().json());
      return res;
    };
    const client = createClient({ cache: memoryCache(), fetch: spy });
    const sol = (await cardByName(client, 'Sol Ring'))!;
    const elves = (await cardByName(client, 'Llanowar Elves'))!;
    bodies.length = 0;

    const { cards, failed } = await cheapestPrintings(client, [sol.oracle_id!, elves.oracle_id!]);
    expect(failed.size).toBe(0);
    expect(bodies).toHaveLength(1);
    expect(bodies[0].warnings ?? []).toEqual([]);
    expect(bodies[0].has_more).toBe(false);
    expect([...cards.keys()].sort()).toEqual([sol.oracle_id!, elves.oracle_id!].sort());

    // Against every printing of Sol Ring: nothing nonfoil is cheaper than the one returned.
    const prints = await printings(client, sol.oracle_id!);
    const lowest = Math.min(...prints.map((c) => Number(c.prices.usd)).filter((n) => n > 0));
    expect(Number(cards.get(sol.oracle_id!)!.prices.usd)).toBe(lowest);
  }, 60_000);
});
