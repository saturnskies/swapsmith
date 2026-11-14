import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { ART_TYPES, artQuery, type ArtSearch } from '../../src/lib/art';
import { randomArt, searchArt, USABLE_ART } from '../../src/scryfall/art';
import { createClient, memoryCache } from '../../src/scryfall/client';
import { createArtStore } from '../../src/ui/artStore';
import type { ScryCard, ScryList } from '../../src/scryfall/types';

// The real API and image CDN (ART_LIVE=1): every term the picker can build must come back with no warning
// (an unknown term is silently dropped, so a filter would do nothing), random must answer a card with usable art,
// and the page must be able to read the image bytes from a browser origin.
// Timeouts are long because a 429 makes the client wait out Retry-After (60 s) before it asks again.
describe.runIf(process.env.ART_LIVE === '1')('live art search and storage (ART_LIVE=1)', () => {
  // Scryfall's API and image CDN both answer 400 to Node's default User-Agent; browsers send their own, which they accept.
  const withUa: typeof fetch = (input, init) => fetch(input, { ...init, headers: { ...Object.fromEntries(new Headers(init?.headers)), 'User-Agent': 'Swapsmith-tests/0.1' } });
  const live = () => createClient({ cache: memoryCache(), fetch: withUa });
  const base: ArtSearch = { text: '', by: 'name', colors: [], types: [], legendary: false };

  const searches: Array<[string, ArtSearch]> = [
    ['nothing (game:paper)', base],
    ['name', { ...base, text: 'sol ring' }],
    ['artist', { ...base, text: 'rebecca guay', by: 'artist' }],
    ...(['W', 'U', 'B', 'R', 'G', 'C'] as const).map((c): [string, ArtSearch] => [`color ${c}`, { ...base, colors: [c] }]),
    ['two colors', { ...base, colors: ['W', 'U'] }],
    ...ART_TYPES.map((t): [string, ArtSearch] => [`type ${t}`, { ...base, types: [t] }]),
    ['two types', { ...base, types: ['creature', 'land'] }],
    ['legendary', { ...base, legendary: true }],
    ['everything together', { text: 'a', by: 'name', colors: ['B', 'R'], types: ['creature', 'artifact'], legendary: true }],
  ];

  it('accepts every term artQuery can build with no warning and at least one card', async () => {
    const client = live();
    for (const [label, s] of searches) {
      const built = artQuery(s);
      expect(built.ok, label).toBe(true);
      if (!built.ok) continue;
      const page = await searchArt(client, built.q, 1);
      expect(page.warnings, label).toEqual([]);
      expect(page.cards.length, label).toBeGreaterThan(0);
    }
  }, 180_000);

  it('answers a 404 for no match, a 400 for a bad query, and a second page', async () => {
    const client = live();
    expect(await searchArt(client, 'name:"zzzzqq"', 1)).toMatchObject({ cards: [], total: 0 });
    await expect(searchArt(client, '(t:elf', 1)).rejects.toMatchObject({ status: 400 });
    const first = await searchArt(client, 'name:"sol"', 1);
    expect(first.hasMore).toBe(true);
    const second = await searchArt(client, 'name:"sol"', 2);
    expect(second.cards[0].id).not.toBe(first.cards[0].id);
  }, 180_000);

  it('USABLE_ART leaves no placeholder or missing image in a search, and keeps two-faced cards', async () => {
    const client = live();
    const res = await client.get<ScryList<ScryCard>>(`/cards/search?${new URLSearchParams({ q: `name:"delver" ${USABLE_ART}`, unique: 'art', order: 'released' })}`);
    expect(res.warnings).toBeUndefined();
    expect(res.data.every((c) => c.image_status !== 'placeholder' && c.image_status !== 'missing')).toBe(true);
    const page = await searchArt(client, 'name:"delver of secrets"', 1);
    expect(page.cards.some((c) => c.name.includes('//'))).toBe(true);
  }, 180_000);

  it('random answers a card with a usable art crop, a different one on a second call', async () => {
    const client = live();
    const seen = new Set<string>();
    for (let i = 0; i < 3; i++) {
      const ref = await randomArt(client);
      expect(ref.url).toMatch(/^https:\/\/cards\.scryfall\.io\/art_crop\//);
      seen.add(ref.id);
    }
    expect(seen.size).toBeGreaterThan(1);
  }, 180_000);

  it('serves the art crop with CORS *, and artStore saves it (no redirect, under 600 KB) and reads it back', async () => {
    const ref = await randomArt(live());
    const res = await withUa(ref.url, { headers: { Origin: 'https://example.test' } });
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(res.headers.get('content-type')).toMatch(/^image\//);

    const store = createArtStore({ dbName: 'art-live-test', fetch: withUa });
    expect(await store.save(ref, new Set())).toBe(ref.id);
    expect(await store.has(ref.id)).toBe(true);
  }, 180_000);
});
