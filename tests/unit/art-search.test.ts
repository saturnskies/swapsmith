import { describe, expect, it } from 'vitest';
import artFixture from '../fixtures/scryfall-art.json';
import { artQuery, type ArtSearch } from '../../src/lib/art';
import { MAX_QUERY } from '../../src/lib/browse';
import { createClient, memoryCache, ScryfallError } from '../../src/scryfall/client';
import { randomArt, searchArt, USABLE_ART } from '../../src/scryfall/art';
import { fixtureFetch, type FixtureMap } from '../support/fixtures';
import type { ScryCard } from '../../src/scryfall/types';

// Real replies recorded 2026-11-13 (see the NOTE entry in the fixture and tests/unit/record-fixtures.test.ts).
const map = artFixture as unknown as FixtureMap;
const RANDOM_KEY = `GET /cards/random?q=${encodeURIComponent(USABLE_ART)}`;
const searchKey = (q: string, page = 1) => `GET /cards/search?${new URLSearchParams({ q: `${q} ${USABLE_ART}`, unique: 'art', order: 'released', page: String(page) })}`;

function clientOn(fixtures: FixtureMap) {
  const f = fixtureFetch(fixtures);
  const calls: string[] = [];
  const spy: typeof fetch = (input, init) => (calls.push(String(input)), f(input, init));
  const client = createClient({ fetch: spy, cache: memoryCache(), sleep: async () => {}, spacingMs: 0, heavySpacingMs: 0 });
  return { client, calls, f };
}

const listBody = (data: unknown[], extra: Record<string, unknown> = {}) => ({ status: 200, body: { object: 'list', total_cards: data.length, has_more: false, data, ...extra } });
const goodCard = (over: Partial<ScryCard> = {}) =>
  ({ object: 'card', id: 'c1', name: 'Sol Ring', artist: 'Mark Tedin', illustration_id: 'i1', image_status: 'highres_scan', image_uris: { art_crop: 'https://cards.scryfall.io/art_crop/front/c/1/c1.jpg?1' }, ...over }) as unknown as ScryCard;

describe('searchArt', () => {
  it('asks for one page of one card per artwork, newest first, with the usable-art term appended', async () => {
    const { client, calls } = clientOn(map);
    await searchArt(client, 'name:"delver"', 1);
    const url = new URL(calls[0]);
    expect(url.pathname).toBe('/cards/search');
    expect(url.searchParams.get('q')).toBe(`name:"delver" ${USABLE_ART}`);
    expect(url.searchParams.get('unique')).toBe('art');
    expect(url.searchParams.get('order')).toBe('released');
    expect(url.searchParams.get('page')).toBe('1');
  });

  it('is page-numbered', async () => {
    const f = fixtureFetch({ [searchKey('name:"x"', 2)]: listBody([goodCard()], { total_cards: 176, has_more: true }) });
    const client = createClient({ fetch: f, cache: memoryCache(), sleep: async () => {}, spacingMs: 0, heavySpacingMs: 0 });
    const page = await searchArt(client, 'name:"x"', 2);
    expect(f.misses).toEqual([]);
    expect(page.hasMore).toBe(true);
    expect(page.total).toBe(176);
  });

  it('turns real replies into art references and drops cards with no usable art (name search, two-faced cards included)', async () => {
    const { client, f } = clientOn(map);
    const page = await searchArt(client, 'name:"delver"', 1);
    expect(f.misses).toEqual([]);
    // 13 cards; Lost Mine of Phandelver has no artist.
    expect(page.total).toBe(13);
    expect(page.cards).toHaveLength(12);
    expect(page.hasMore).toBe(false);
    expect(page.warnings).toEqual([]);
    expect(page.cards.every((c) => c.id && c.cardId && c.name && c.artist && c.url.startsWith('https://cards.scryfall.io/art_crop/'))).toBe(true);
    expect(page.cards.map((c) => c.name)).toContain('Delver of Secrets // Insectile Aberration');
    expect(new Set(page.cards.map((c) => c.id)).size).toBe(12);
  });

  it('searches by artist', async () => {
    const { client, f } = clientOn(map);
    const page = await searchArt(client, 'a:"quinton hoover"', 1);
    expect(f.misses).toEqual([]);
    expect(page.total).toBe(78);
    expect(page.cards.length).toBeGreaterThan(0);
    expect(page.cards.every((c) => c.artist.startsWith('Quinton Hoover'))).toBe(true); // two are shared with Val Mayerik
  });

  it('treats a 404 (no match) as an empty page', async () => {
    const { client, f } = clientOn(map);
    expect(await searchArt(client, 'name:"zzzzqq"', 1)).toEqual({ cards: [], total: 0, hasMore: false, warnings: [] });
    expect(f.misses).toEqual([]);
  });

  it('throws on a 400 and on every other failure', async () => {
    const { client } = clientOn(map);
    await expect(searchArt(client, '(t:elf', 1)).rejects.toMatchObject({ status: 400 });
    const rejected = await searchArt(clientOn({}).client, 'name:"nothing recorded"', 1).catch((e: unknown) => e);
    expect(rejected).toBeInstanceOf(ScryfallError);
    expect((rejected as ScryfallError).status).not.toBe(404);
    const down = createClient({ fetch: (async () => { throw new TypeError('Failed to fetch'); }) as typeof fetch, cache: memoryCache(), sleep: async () => {}, maxRetries: 0 });
    await expect(searchArt(down, 'name:"x"', 1)).rejects.toMatchObject({ status: 0 });
  });

  it('passes the reply\'s warnings back, never hides them', async () => {
    const { client, f } = clientOn(map);
    const page = await searchArt(client, 'name:"delver" (bogus:thing)', 1);
    expect(f.misses).toEqual([]);
    expect(page.warnings).toHaveLength(1);
    expect(page.warnings[0]).toContain('bogus');
    expect(page.cards.length).toBeGreaterThan(0);
  });

  it('drops cards whose image is missing or a placeholder, even with an art crop link', async () => {
    const cards = [goodCard({ id: 'a', illustration_id: 'ia' }), goodCard({ id: 'b', illustration_id: 'ib', image_status: 'placeholder' }), goodCard({ id: 'c', illustration_id: 'ic', image_status: 'missing' }), goodCard({ id: 'd', illustration_id: 'id', image_status: 'lowres' }), goodCard({ id: 'e', illustration_id: 'ie', image_status: undefined })];
    const f = fixtureFetch({ [searchKey('name:"x"')]: listBody(cards) });
    const client = createClient({ fetch: f, cache: memoryCache(), sleep: async () => {}, spacingMs: 0, heavySpacingMs: 0 });
    const page = await searchArt(client, 'name:"x"', 1);
    expect(page.cards.map((c) => c.cardId)).toEqual(['a', 'd', 'e']);
    expect(page.total).toBe(5);
  });

  it('keeps the whole query under Scryfall\'s silent 1,000 character cut-off, with every parameter outside `q`', async () => {
    // The longest query artQuery accepts, plus what searchArt appends.
    const longest: ArtSearch = { text: 'a'.repeat(MAX_QUERY - 60), by: 'name', colors: [], types: [], legendary: false };
    const built = artQuery(longest);
    expect(built.ok).toBe(true);
    const q = built.ok ? built.q : '';
    expect(q.length).toBeLessThanOrEqual(MAX_QUERY);
    const calls: string[] = [];
    const spy: typeof fetch = async (input) => (calls.push(String(input)), new Response(JSON.stringify({ object: 'error', details: 'x' }), { status: 404 }));
    await searchArt(createClient({ fetch: spy, cache: memoryCache(), sleep: async () => {}, spacingMs: 0, heavySpacingMs: 0 }), q, 1);
    const sent = new URL(calls[0]).searchParams;
    expect(sent.get('q')!.length).toBeLessThanOrEqual(1000);
    expect(sent.get('q')).toBe(`${q} ${USABLE_ART}`);
    expect(sent.get('q')).not.toMatch(/unique|order|page/);
  });

  it('refuses, without asking, a query that would pass the cut-off once the term is added', async () => {
    const calls: string[] = [];
    const spy: typeof fetch = async (input) => (calls.push(String(input)), new Response('{}'));
    const client = createClient({ fetch: spy, cache: memoryCache() });
    await expect(searchArt(client, 'x'.repeat(995), 1)).rejects.toThrow(/too long/i);
    expect(calls).toEqual([]);
  });
});

describe('randomArt', () => {
  const makeClient = (replies: Array<{ status: number; body: unknown }>, calls: string[] = []) => {
    let i = 0;
    const spy: typeof fetch = async (input) => {
      calls.push(String(input));
      const r = replies[Math.min(i++, replies.length - 1)];
      return new Response(JSON.stringify(r.body), { status: r.status });
    };
    return createClient({ fetch: spy, cache: memoryCache(), sleep: async () => {}, spacingMs: 0 });
  };

  it('returns the art of the recorded random card, asking for usable art only', async () => {
    const f = fixtureFetch({ [RANDOM_KEY]: map[RANDOM_KEY] });
    const client = createClient({ fetch: f, cache: memoryCache(), sleep: async () => {}, spacingMs: 0 });
    const ref = await randomArt(client);
    expect(f.misses).toEqual([]);
    expect(ref).toMatchObject({ name: 'Ryusei, the Falling Star', artist: 'Grzegorz Rutkowski', id: 'a8b6ba10-c027-4d50-8a8b-dc15527a3c24' });
    expect(ref.url).toMatch(/^https:\/\/cards\.scryfall\.io\/art_crop\//);
  });

  it('never uses the cache: two calls, two requests', async () => {
    const calls: string[] = [];
    const client = makeClient([{ status: 200, body: map[RANDOM_KEY].body }], calls);
    await randomArt(client);
    await randomArt(client);
    expect(calls).toHaveLength(2);
  });

  it('two calls at once get their own reply', async () => {
    const calls: string[] = [];
    const a = goodCard({ id: 'a', name: 'Card A', illustration_id: 'ia' });
    const b = goodCard({ id: 'b', name: 'Card B', illustration_id: 'ib' });
    const client = makeClient([{ status: 200, body: a }, { status: 200, body: b }], calls);
    const refs = await Promise.all([randomArt(client), randomArt(client)]);
    expect(calls).toHaveLength(2);
    expect(refs.map((r) => r.name).sort()).toEqual(['Card A', 'Card B']);
  });

  it('retries once when the card has no usable crop, then returns the second card', async () => {
    const calls: string[] = [];
    const client = makeClient([{ status: 200, body: goodCard({ image_uris: {} }) }, { status: 200, body: goodCard({ name: 'Second' }) }], calls);
    expect((await randomArt(client)).name).toBe('Second');
    expect(calls).toHaveLength(2);
  });

  it('treats a placeholder or missing image like no usable crop', async () => {
    for (const image_status of ['placeholder', 'missing']) {
      const client = makeClient([{ status: 200, body: goodCard({ image_status }) }, { status: 200, body: goodCard({ name: 'Second' }) }]);
      expect((await randomArt(client)).name).toBe('Second');
    }
  });

  it('throws a clear error after the retry also has no usable art', async () => {
    const calls: string[] = [];
    const client = makeClient([{ status: 200, body: goodCard({ artist: undefined }) }], calls);
    await expect(randomArt(client)).rejects.toThrow("Couldn't find art, try again");
    expect(calls).toHaveLength(2);
  });

  it('does not retry a failed request: the error is thrown as it is', async () => {
    const calls: string[] = [];
    const client = makeClient([{ status: 400, body: { object: 'error', details: 'bad' } }], calls);
    await expect(randomArt(client)).rejects.toMatchObject({ status: 400 });
    expect(calls).toHaveLength(1);
  });
});
