import { artRefOf, type ArtRef } from '../lib/art';
import { ScryfallError, type ScryfallClient } from './client';
import type { ScryCard, ScryList } from './types';

/**
 * The query term that keeps cards with no usable art out of the art picker, for both the search and `/cards/random`.
 * Checked live 2026-11-13: `is:highres` is accepted with no `warnings` and leaves out every `placeholder` and `lowres` card
 * (a placeholder has an art_crop link too, but it is a "no image yet" picture). `-is:placeholder`, `-is:lowres`, `-has:placeholder`
 * and `has:art` are NOT supported: Scryfall answers 200 with a warning and drops them. `has:illustration_id` is accepted but
 * lets placeholders through.
 */
export const USABLE_ART = 'is:highres';

/** Scryfall silently drops the end of a `q` longer than about this many characters. */
const Q_LIMIT = 1000;

export interface ArtPage {
  /** One entry per artwork, newest first, with cards that have no usable art already dropped. */
  cards: ArtRef[];
  /** Every match across all pages, counting the cards that were dropped. */
  total: number;
  hasMore: boolean;
  /** Terms Scryfall ignored; the cards then don't reflect them. */
  warnings: string[];
}

/** Placeholder and missing images carry an `art_crop` link too, but it is a "no image yet" picture. */
const hasRealImage = (c: ScryCard) => c.image_status !== 'missing' && c.image_status !== 'placeholder';

const usable = (c: ScryCard): ArtRef | null => (hasRealImage(c) ? artRefOf(c) : null);

/**
 * One page (175 cards) of artworks for a query built by `artQuery`, one card per illustration, newest first, through
 * the shared client. `USABLE_ART` is added to `q`; everything else is a URL parameter, so the query is never cut off
 * (one that would pass the limit is refused). No match (404) is an empty page; a bad query (400) and every other failure throw.
 */
export async function searchArt(client: ScryfallClient, q: string, page: number): Promise<ArtPage> {
  const full = `${q} ${USABLE_ART}`;
  if (full.length > Q_LIMIT) throw new Error(`This search is too long (${full.length} of ${Q_LIMIT} characters). Shorten the text or drop a filter.`);
  try {
    const res = await client.get<ScryList<ScryCard>>(`/cards/search?${new URLSearchParams({ q: full, unique: 'art', order: 'released', page: String(page) })}`);
    return { cards: res.data.flatMap((c) => usable(c) ?? []), total: res.total_cards ?? res.data.length, hasMore: res.has_more === true, warnings: res.warnings ?? [] };
  } catch (e) {
    if (e instanceof ScryfallError && e.status === 404) return { cards: [], total: 0, hasMore: false, warnings: [] };
    throw e;
  }
}

/** The art of one random card. Never cached, never shared with an overlapping call; asked again once when the card has no usable art. */
export async function randomArt(client: ScryfallClient): Promise<ArtRef> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const card = await client.get<ScryCard>(`/cards/random?${new URLSearchParams({ q: USABLE_ART })}`, { fresh: true });
    const ref = usable(card);
    if (ref) return ref;
  }
  throw new Error("Couldn't find art, try again");
}
