import { describe, expect, it } from 'vitest';
import { SCRIM_ALPHA, accentSuggestions, artQuery, artRefOf, dominantColors, parseAccent, planEviction, readable, type ArtSearch } from '../../src/lib/art';
import { contrastWithWhite } from '../../src/lib/life';
import { MAX_QUERY, quote } from '../../src/lib/browse';
import type { ScryCard } from '../../src/scryfall/types';
import artFixture from '../fixtures/scryfall-art.json';

const card = (over: Partial<ScryCard> = {}): ScryCard =>
  ({
    id: 'card-1',
    name: 'Edgar Markov',
    set: 'c17',
    set_name: 'Commander 2017',
    collector_number: '1',
    color_identity: ['W', 'B', 'R'],
    legalities: {},
    finishes: [],
    prices: { usd: null, usd_foil: null, usd_etched: null },
    artist: 'Eric Deschamps',
    illustration_id: 'illus-1',
    image_uris: { art_crop: 'https://cards.scryfall.io/art_crop/front/a/b/ab.jpg?1' },
    ...over,
  }) as ScryCard;

describe('quote', () => {
  it('wraps in quotes and escapes quotes and backslashes', () => {
    expect(quote('edgar')).toBe('"edgar"');
    expect(quote('a"b\\c')).toBe('"a\\"b\\\\c"');
  });
});

describe('artRefOf', () => {
  it('builds a reference from a single-faced card', () => {
    expect(artRefOf(card())).toEqual({ id: 'illus-1', cardId: 'card-1', name: 'Edgar Markov', artist: 'Eric Deschamps', url: 'https://cards.scryfall.io/art_crop/front/a/b/ab.jpg?1' });
  });

  it('uses the first face when the card has no top-level image', () => {
    const c = card({ image_uris: undefined, card_faces: [{ name: 'Front', image_uris: { art_crop: 'https://cards.scryfall.io/f.jpg' } }, { name: 'Back', image_uris: { art_crop: 'https://cards.scryfall.io/b.jpg' } }] });
    expect(artRefOf(c)?.url).toBe('https://cards.scryfall.io/f.jpg');
  });

  it('reads the illustration id (and artist) from the first face when the card has none of its own', () => {
    const c = card({ illustration_id: undefined, artist: undefined, image_uris: undefined, card_faces: [{ name: 'Front', illustration_id: 'face-illus', artist: 'Face Artist', image_uris: { art_crop: 'https://cards.scryfall.io/f.jpg' } }, { name: 'Back', illustration_id: 'back-illus', image_uris: { art_crop: 'https://cards.scryfall.io/b.jpg' } }] });
    expect(artRefOf(c)).toEqual({ id: 'face-illus', cardId: 'card-1', name: 'Edgar Markov', artist: 'Face Artist', url: 'https://cards.scryfall.io/f.jpg' });
  });

  it("credits the first face's artist when the illustration comes from the face, not the card's combined string", () => {
    const c = card({ illustration_id: undefined, artist: 'Florey & Scott Okumura', image_uris: undefined, card_faces: [{ name: 'Front', illustration_id: 'face-illus', artist: 'Florey', image_uris: { art_crop: 'https://cards.scryfall.io/f.jpg' } }, { name: 'Back', illustration_id: 'back-illus', artist: 'Scott Okumura', image_uris: { art_crop: 'https://cards.scryfall.io/b.jpg' } }] });
    expect(artRefOf(c)?.artist).toBe('Florey');
    // The card's artist stays the credit when the face names none, and when the card's own illustration is used.
    expect(artRefOf(card({ illustration_id: undefined, artist: 'Both', image_uris: undefined, card_faces: [{ name: 'Front', illustration_id: 'f', image_uris: { art_crop: 'https://cards.scryfall.io/f.jpg' } }] }))?.artist).toBe('Both');
    expect(artRefOf(card({ artist: 'Top', card_faces: [{ name: 'Front', artist: 'Face' }] }))?.artist).toBe('Top');
  });

  it('builds references from the real two-faced and one-faced cards Scryfall answered (recorded 2026-11-13)', () => {
    const list = (artFixture as unknown as Record<string, { body: { data: ScryCard[] } }>)['GET /cards/search?q=name%3A%22delver%22+is%3Ahighres&unique=art&order=released&page=1'].body.data;
    const twoFaced = list.filter((c) => !c.illustration_id && c.card_faces);
    expect(twoFaced.length).toBeGreaterThan(0);
    for (const c of twoFaced) {
      const ref = artRefOf(c);
      expect(ref, c.name).not.toBeNull();
      expect(ref!.id).toBe(c.card_faces![0].illustration_id);
      expect(ref!.url).toBe(c.card_faces![0].image_uris!.art_crop);
    }
    // Lost Mine of Phandelver has no artist at all: still rejected.
    expect(artRefOf(list.find((c) => c.name === 'Lost Mine of Phandelver')!)).toBeNull();
    expect(list.map(artRefOf).filter(Boolean)).toHaveLength(list.length - 1);
  });

  it('is null without an illustration id, an artist or a crop', () => {
    expect(artRefOf(card({ illustration_id: undefined }))).toBeNull();
    expect(artRefOf(card({ artist: undefined }))).toBeNull();
    expect(artRefOf(card({ artist: '   ' }))).toBeNull();
    expect(artRefOf(card({ image_uris: {} }))).toBeNull();
    expect(artRefOf(card({ image_uris: undefined }))).toBeNull();
    expect(artRefOf(card({ image_uris: undefined, card_faces: [{ name: 'Front' }] }))).toBeNull();
  });

  it('trims the name and artist and cuts them to 80 characters', () => {
    const ref = artRefOf(card({ name: `  ${'N'.repeat(100)}  `, artist: `  ${'A'.repeat(100)}  ` }));
    expect(ref?.name).toBe('N'.repeat(80));
    expect(ref?.artist).toBe('A'.repeat(80));
    expect(artRefOf(card({ name: '  Edgar  ' }))?.name).toBe('Edgar');
  });
});

describe('artQuery', () => {
  const base: ArtSearch = { text: '', by: 'name', colors: [], types: [], legendary: false };
  const q = (over: Partial<ArtSearch> = {}) => artQuery({ ...base, ...over });

  it('gives game:paper for an empty search so the grid starts with something', () => {
    expect(q()).toEqual({ ok: true, q: 'game:paper' });
    expect(q({ text: '   ' })).toEqual({ ok: true, q: 'game:paper' });
  });

  it('turns each name word into a name term', () => {
    expect(q({ text: 'edgar  markov' })).toEqual({ ok: true, q: 'name:"edgar" name:"markov"' });
  });

  it('turns an artist into one a: term with the whole name', () => {
    expect(q({ text: ' rebecca  guay ', by: 'artist' })).toEqual({ ok: true, q: 'a:"rebecca guay"' });
  });

  it('adds no game filter once anything else is set', () => {
    for (const r of [q({ text: 'x' }), q({ colors: ['W'] }), q({ types: ['land'] }), q({ legendary: true })]) {
      expect(r.ok && r.q).not.toContain('game:');
    }
  });

  it('writes colors as an includes-mode identity in WUBRG order', () => {
    expect(q({ colors: ['R', 'U', 'W'] })).toEqual({ ok: true, q: 'id>=wur' });
    expect(q({ colors: ['G'] })).toEqual({ ok: true, q: 'id>=g' });
  });

  it('writes colorless alone as id=c, and lets real colors win over it', () => {
    expect(q({ colors: ['C'] })).toEqual({ ok: true, q: 'id=c' });
    expect(q({ colors: ['C', 'B'] })).toEqual({ ok: true, q: 'id>=b' });
  });

  it('ignores unknown colors and types', () => {
    expect(q({ colors: ['X'], types: ['bogus) or (a:x'] })).toEqual({ ok: true, q: 'game:paper' });
  });

  it('joins several types with or inside parentheses, a single one bare', () => {
    expect(q({ types: ['creature'] })).toEqual({ ok: true, q: 't:creature' });
    expect(q({ types: ['land', 'creature'] })).toEqual({ ok: true, q: '(t:creature or t:land)' });
  });

  it('adds legendary', () => {
    expect(q({ legendary: true })).toEqual({ ok: true, q: 't:legendary' });
  });

  it('combines everything', () => {
    expect(q({ text: 'edgar', colors: ['W', 'B'], types: ['creature', 'artifact'], legendary: true })).toEqual({
      ok: true,
      q: 'name:"edgar" id>=wb (t:creature or t:artifact) t:legendary',
    });
  });

  it('escapes quotes and backslashes in the text', () => {
    expect(q({ text: 'a"b' })).toEqual({ ok: true, q: 'name:"a\\"b"' });
    expect(q({ text: 'a\\b', by: 'artist' })).toEqual({ ok: true, q: 'a:"a\\\\b"' });
  });

  it('refuses text that is only quotes and backslashes', () => {
    for (const by of ['name', 'artist'] as const) {
      for (const text of ['"', '\\', '"" \\ "', '\\"\\"']) {
        const r = q({ text, by });
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.error).toMatch(/\S/);
      }
    }
  });

  it('refuses a query over the length cap, naming the numbers, and accepts one at it', () => {
    const long = q({ text: 'x'.repeat(MAX_QUERY), by: 'artist' });
    expect(long.ok).toBe(false);
    if (!long.ok) expect(long.error).toContain(String(MAX_QUERY));
    // `a:"` + text + `"` is 4 characters of wrapping.
    const edge = q({ text: 'x'.repeat(MAX_QUERY - 4), by: 'artist' });
    expect(edge.ok && edge.q.length).toBe(MAX_QUERY);
    expect(q({ text: 'x'.repeat(MAX_QUERY - 3), by: 'artist' }).ok).toBe(false);
  });

  it('measures the length after escaping', () => {
    expect(q({ text: '"'.repeat(MAX_QUERY / 2) + 'a', by: 'artist' }).ok).toBe(false);
  });
});

describe('SCRIM_ALPHA', () => {
  it('is at least 0.6', () => {
    expect(SCRIM_ALPHA).toBeGreaterThanOrEqual(0.6);
  });

  it('keeps white text at 4.5:1 or better over the brightest possible art', () => {
    const grey = Math.round(255 * (1 - SCRIM_ALPHA));
    const hex = `#${grey.toString(16).padStart(2, '0').repeat(3)}`;
    expect(contrastWithWhite(hex)).toBeGreaterThanOrEqual(4.5);
  });
});

/** An RGBA buffer of `count` pixels, each the given color. */
const solid = (rgba: [number, number, number, number], count: number): number[] => Array.from({ length: count }).flatMap(() => rgba);
const px = (...parts: number[][]) => new Uint8ClampedArray(parts.flat());

describe('dominantColors', () => {
  it('returns one color for a solid image', () => {
    expect(dominantColors(px(solid([200, 30, 30, 255], 64)), 5)).toEqual(['#c81e1e']);
  });

  it('returns both colors of a two-color image, the more common first', () => {
    expect(dominantColors(px(solid([30, 30, 200, 255], 10), solid([200, 30, 30, 255], 30)), 5)).toEqual(['#c81e1e', '#1e1ec8']);
  });

  it('returns at most n colors, by population', () => {
    const data = px(solid([200, 30, 30, 255], 30), solid([30, 200, 30, 255], 20), solid([30, 30, 200, 255], 10));
    expect(dominantColors(data, 2)).toEqual(['#c81e1e', '#1ec81e']);
    expect(dominantColors(data, 0)).toEqual([]);
  });

  it('skips transparent, near-black and near-white pixels', () => {
    const data = px(solid([200, 30, 30, 0], 50), solid([0, 0, 0, 255], 50), solid([255, 255, 255, 255], 50), solid([10, 10, 12, 255], 50), solid([250, 252, 250, 255], 50), solid([30, 30, 200, 255], 3));
    expect(dominantColors(data, 5)).toEqual(['#1e1ec8']);
  });

  it('merges near neighbours into one color', () => {
    const data = px(solid([200, 30, 30, 255], 20), solid([204, 34, 28, 255], 15), solid([30, 30, 200, 255], 5));
    expect(dominantColors(data, 5)).toEqual(['#c81e1e', '#1e1ec8']);
  });

  it('keeps clearly different colors apart even when close in hue', () => {
    expect(dominantColors(px(solid([200, 30, 30, 255], 20), solid([120, 30, 30, 255], 10)), 5)).toHaveLength(2);
  });

  it('returns [] for an empty or all-transparent image', () => {
    expect(dominantColors(new Uint8ClampedArray(0), 5)).toEqual([]);
    expect(dominantColors(px(solid([200, 30, 30, 0], 40)), 5)).toEqual([]);
  });

  it('ignores a trailing partial pixel', () => {
    expect(dominantColors(new Uint8ClampedArray([200, 30, 30, 255, 1, 2]), 5)).toEqual(['#c81e1e']);
  });
});

describe('readable', () => {
  it('returns an already readable color unchanged', () => {
    expect(readable('#1d4e9e')).toBe('#1d4e9e');
    expect(readable('#000000')).toBe('#000000');
  });

  it('always answers lowercase #rrggbb, readable input included', () => {
    expect(readable('#1D4E9E')).toBe('#1d4e9e');
    expect(readable('#FFEE00')).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('darkens a too-light color until white text reaches 4.5:1, without lightening it', () => {
    for (const hex of ['#ffffff', '#ffee00', '#f0a0a0', '#88cc88', '#7a7a7a']) {
      const out = readable(hex);
      expect(out).toMatch(/^#[0-9a-f]{6}$/);
      expect(contrastWithWhite(out!)).toBeGreaterThanOrEqual(4.5);
      for (const i of [1, 3, 5]) expect(parseInt(out!.slice(i, i + 2), 16)).toBeLessThanOrEqual(parseInt(hex.slice(i, i + 2), 16));
    }
  });

  it('keeps the hue direction (channel order) of a darkened color', () => {
    const out = readable('#ffee00')!;
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(out.slice(i, i + 2), 16));
    expect(r).toBeGreaterThan(b);
    expect(g).toBeGreaterThan(b);
  });

  it('is null for garbage', () => {
    for (const bad of ['red', '#12', '', '#12345', '#1234567', '#gggggg', 'rgb(0,0,0)']) expect(readable(bad)).toBeNull();
  });
});

describe('accentSuggestions', () => {
  it('offers the dominant colors, each darkened until white text on it reaches 4.5:1', () => {
    const data = px(solid([240, 210, 40, 255], 30), solid([200, 30, 30, 255], 20), solid([30, 30, 200, 255], 10));
    const out = accentSuggestions(data);
    expect(out).toHaveLength(3);
    for (const hex of out) expect(contrastWithWhite(hex)).toBeGreaterThanOrEqual(4.5);
    expect(out[0]).toBe(readable('#f0d228'));
    expect(out[0]).not.toBe('#f0d228');
    expect(out[1]).toBe('#c81e1e');
  });

  it('offers at most 6, and no duplicates', () => {
    const colors: Array<[number, number, number]> = [[200, 30, 30], [30, 200, 30], [30, 30, 200], [200, 200, 30], [30, 200, 200], [200, 30, 200], [120, 60, 30], [60, 120, 30]];
    const out = accentSuggestions(px(...colors.map((c, i) => solid([...c, 255], 40 - i))));
    expect(out.length).toBeLessThanOrEqual(6);
    expect(new Set(out).size).toBe(out.length);
  });

  it('offers nothing for black, white, transparent or empty images', () => {
    expect(accentSuggestions(px(solid([0, 0, 0, 255], 64)))).toEqual([]);
    expect(accentSuggestions(px(solid([255, 255, 255, 255], 64)))).toEqual([]);
    expect(accentSuggestions(px(solid([200, 30, 30, 0], 64)))).toEqual([]);
    expect(accentSuggestions(new Uint8ClampedArray(0))).toEqual([]);
  });
});

describe('parseAccent', () => {
  it('takes #rrggbb, rrggbb and #rgb in any case, answering lowercase #rrggbb', () => {
    expect(parseAccent('#1D4E9E')).toEqual({ hex: '#1d4e9e', adjusted: false });
    expect(parseAccent(' 1d4e9e ')).toEqual({ hex: '#1d4e9e', adjusted: false });
    expect(parseAccent('#048')).toEqual({ hex: '#004488', adjusted: false });
  });

  it('darkens a too-light color and says it did', () => {
    const out = parseAccent('#ffff00')!;
    expect(out.adjusted).toBe(true);
    expect(contrastWithWhite(out.hex)).toBeGreaterThanOrEqual(4.5);
  });

  it('is null for anything else', () => {
    for (const bad of ['', '   ', 'banana', '#12', '#12345', '#1234567', '#gggggg', 'rgb(0,0,0)', '##123456', '#12 34 56']) expect(parseAccent(bad)).toBeNull();
    expect(parseAccent(undefined as unknown as string)).toBeNull();
  });
});

describe('planEviction', () => {
  const e = (id: string, bytes: number, lastUsed: number) => ({ id, bytes, lastUsed });

  it('does nothing when both caps are met', () => {
    expect(planEviction([e('a', 10, 1), e('b', 10, 2)], new Set(), { count: 5, bytes: 100 })).toEqual({ remove: [], unmet: [] });
  });

  it('removes least recently used first until the count cap is met', () => {
    const entries = [e('c', 1, 30), e('a', 1, 10), e('b', 1, 20)];
    expect(planEviction(entries, new Set(), { count: 1, bytes: 100 })).toEqual({ remove: ['a', 'b'], unmet: [] });
  });

  it('removes until the byte cap is met', () => {
    const entries = [e('a', 60, 1), e('b', 60, 2), e('c', 60, 3)];
    expect(planEviction(entries, new Set(), { count: 10, bytes: 100 })).toEqual({ remove: ['a', 'b'], unmet: [] });
  });

  it('stops as soon as both caps are met', () => {
    const entries = [e('a', 10, 1), e('b', 10, 2), e('c', 10, 3), e('d', 90, 4)];
    expect(planEviction(entries, new Set(), { count: 3, bytes: 100 }).remove).toEqual(['a', 'b']);
  });

  it('never removes one in keep, taking the next oldest instead', () => {
    const entries = [e('a', 1, 1), e('b', 1, 2), e('c', 1, 3)];
    expect(planEviction(entries, new Set(['a']), { count: 2, bytes: 100 })).toEqual({ remove: ['b'], unmet: [] });
  });

  it('does not change its input', () => {
    const entries = [e('b', 1, 2), e('a', 1, 1)];
    planEviction(entries, new Set(), { count: 1, bytes: 10 });
    expect(entries.map((x) => x.id)).toEqual(['b', 'a']);
  });

  it('handles an empty list', () => {
    expect(planEviction([], new Set(), { count: 24, bytes: 8 })).toEqual({ remove: [], unmet: [] });
    expect(planEviction([], new Set(['x']), { count: 0, bytes: 0 })).toEqual({ remove: [], unmet: [] });
  });

  it('removes nothing it must keep, and reports the caps it could not meet', () => {
    const entries = [e('a', 100, 1), e('b', 100, 2), e('c', 100, 3)];
    const r = planEviction(entries, new Set(['a', 'b']), { count: 1, bytes: 150 });
    expect(r.remove).toEqual(['c']);
    expect(r.unmet).toEqual(['count', 'bytes']);
  });

  it('reports only the cap that could not be met', () => {
    const entries = [e('a', 1, 1), e('b', 1, 2), e('c', 1, 3)];
    expect(planEviction(entries, new Set(['a', 'b', 'c']), { count: 2, bytes: 100 })).toEqual({ remove: [], unmet: ['count'] });
  });
});
