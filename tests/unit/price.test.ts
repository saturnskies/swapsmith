import { describe, expect, it } from 'vitest';
import { bestPrice, sortPrintings, tcgplayerUrl } from '../../src/lib/price';
import type { ScryCard } from '../../src/scryfall/types';

const card = (over: Omit<Partial<ScryCard>, 'prices'> & { prices?: Partial<ScryCard['prices']> }): ScryCard => ({
  id: over.id ?? 'p1',
  oracle_id: 'o1',
  name: 'Test Card',
  set: 'tst',
  set_name: 'Test Set',
  collector_number: '1',
  type_line: 'Artifact',
  color_identity: [],
  legalities: { commander: 'legal' },
  finishes: ['nonfoil', 'foil'],
  ...over,
  prices: { usd: null, usd_foil: null, usd_etched: null, ...over.prices },
});

describe('bestPrice', () => {
  it('picks the lowest of nonfoil, foil and etched', () => {
    expect(bestPrice(card({ prices: { usd: '4.88', usd_foil: '4.10' } }))).toEqual({ price: 4.1, finish: 'foil' });
    expect(bestPrice(card({ prices: { usd: '2', usd_foil: '3', usd_etched: '1.5' } }))).toEqual({ price: 1.5, finish: 'etched' });
  });

  it('prefers nonfoil on a tie', () => {
    expect(bestPrice(card({ prices: { usd: '1.00', usd_foil: '1.00' } }))).toEqual({ price: 1, finish: 'nonfoil' });
  });

  it('returns null when no USD price exists', () => {
    expect(bestPrice(card({}))).toBeNull();
  });

  it('ignores unparseable or zero prices', () => {
    expect(bestPrice(card({ prices: { usd: 'abc', usd_foil: '0.00', usd_etched: '2.50' } }))).toEqual({ price: 2.5, finish: 'etched' });
  });
});

describe('tcgplayerUrl', () => {
  it('links straight to the TCGplayer product, without Scryfall affiliate redirects', () => {
    expect(tcgplayerUrl(card({ tcgplayer_id: 596294 }), 'nonfoil')).toBe('https://www.tcgplayer.com/product/596294');
  });

  it('uses the etched product id for an etched finish', () => {
    expect(tcgplayerUrl(card({ tcgplayer_id: 1, tcgplayer_etched_id: 2 }), 'etched')).toBe('https://www.tcgplayer.com/product/2');
  });

  it('falls back to the product id inside purchase_uris, then to a TCGplayer search', () => {
    const viaUri = card({
      purchase_uris: { tcgplayer: 'https://partner.tcgplayer.com/c/4931599/1830156/21018?subId1=api&u=https%3A%2F%2Fwww.tcgplayer.com%2Fproduct%2F609685%3Fpage%3D1' },
    });
    expect(tcgplayerUrl(viaUri, 'nonfoil')).toBe('https://www.tcgplayer.com/product/609685');

    const bare = card({ name: "Healer's Hawk" });
    expect(tcgplayerUrl(bare, 'nonfoil')).toBe("https://www.tcgplayer.com/search/magic/product?q=Healer's%20Hawk&productLineName=magic");
  });
});

describe('sortPrintings', () => {
  it('puts the cheapest printing first, counting foil, and unpriced printings last', () => {
    const prints = [
      card({ id: 'none', prices: {} }),
      card({ id: 'two', prices: { usd: '2.00' } }),
      card({ id: 'foil', prices: { usd: '5.00', usd_foil: '0.50' } }),
      card({ id: 'none2', prices: {} }),
    ];
    expect(sortPrintings(prints).map((c) => c.id)).toEqual(['foil', 'two', 'none', 'none2']);
  });
});
