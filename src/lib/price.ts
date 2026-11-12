import type { ScryCard } from '../scryfall/types';

export type Finish = 'nonfoil' | 'foil' | 'etched';

export interface PriceInfo {
  price: number;
  finish: Finish;
}

const FINISH_FIELDS: Array<[Finish, keyof ScryCard['prices']]> = [
  ['nonfoil', 'usd'],
  ['foil', 'usd_foil'],
  ['etched', 'usd_etched'],
];

/** The lowest TCGplayer market price among a printing's finishes; nonfoil wins ties. */
export function bestPrice(card: ScryCard): PriceInfo | null {
  let best: PriceInfo | null = null;
  for (const [finish, field] of FINISH_FIELDS) {
    const price = Number(card.prices?.[field]);
    if (!Number.isFinite(price) || price <= 0) continue;
    if (!best || price < best.price) best = { price, finish };
  }
  return best;
}

/** A direct TCGplayer product link for a printing, without Scryfall's affiliate redirect. */
export function tcgplayerUrl(card: ScryCard, finish: Finish): string {
  const id = finish === 'etched' && card.tcgplayer_etched_id ? card.tcgplayer_etched_id : card.tcgplayer_id;
  if (id) return `https://www.tcgplayer.com/product/${id}`;

  const partner = card.purchase_uris?.tcgplayer;
  if (partner) {
    try {
      const target = new URL(new URL(partner).searchParams.get('u') ?? '');
      const m = target.pathname.match(/^\/product\/(\d+)/);
      if (target.hostname.endsWith('tcgplayer.com') && m) return `https://www.tcgplayer.com/product/${m[1]}`;
    } catch {
      // Malformed link: fall through to a search.
    }
  }
  return `https://www.tcgplayer.com/search/magic/product?q=${encodeURIComponent(card.name)}&productLineName=magic`;
}

/** Printings for the picker: cheapest first (by each printing's cheapest finish), unpriced last. */
export function sortPrintings(prints: ScryCard[]): ScryCard[] {
  const key = (c: ScryCard) => bestPrice(c)?.price ?? Infinity;
  return [...prints].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
}
