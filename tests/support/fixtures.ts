/**
 * Recorded Scryfall replies, keyed by request, shared by unit tests (fixtureFetch) and e2e tests
 * (page.route). Recorded from the real API by tests/unit/record-fixtures.test.ts (RECORD=1).
 */
export type Recorded = { status: number; body: unknown };
export type FixtureMap = Record<string, Recorded>;

export const SCRYFALL = 'https://api.scryfall.com';

export function requestKey(method: string, url: string, body?: string | null): string {
  const path = url.startsWith(SCRYFALL) ? url.slice(SCRYFALL.length) : url;
  return method.toUpperCase() === 'POST' ? `POST ${path} ${body ?? ''}` : `GET ${path}`;
}

/** A fetch that answers from recorded replies and fails loudly on anything unrecorded. */
export function fixtureFetch(map: FixtureMap): typeof fetch & { misses: string[] } {
  const misses: string[] = [];
  const fn = async (input: string | URL | Request, init?: RequestInit) => {
    const key = requestKey(init?.method ?? 'GET', String(input), init?.body as string | undefined);
    const hit = map[key];
    if (!hit) {
      misses.push(key);
      return new Response(JSON.stringify({ object: 'error', details: `unrecorded request: ${key}` }), { status: 599 });
    }
    return new Response(JSON.stringify(hit.body), { status: hit.status, headers: { 'content-type': 'application/json' } });
  };
  return Object.assign(fn as typeof fetch, { misses });
}

const CARD_KEYS = [
  'id', 'oracle_id', 'name', 'flavor_name', 'set', 'set_name', 'collector_number', 'type_line', 'mana_cost', 'cmc', 'rarity', 'keywords', 'oracle_text', 'edhrec_rank', 'color_identity', 'legalities',
  'finishes', 'prices', 'tcgplayer_id', 'tcgplayer_etched_id', 'image_uris', 'card_faces', 'object',
];

const COMPARE_KEYS = ['produced_mana', 'power', 'toughness'];

/** Keeps only the EDHREC page fields src/lib/edhrec.ts reads, in the same shape, so fixtures stay small. */
export function trimEdhrec(body: unknown): unknown {
  if (!body || typeof body !== 'object') return body;
  const b = body as Record<string, any>;
  if ('redirect' in b) return { redirect: b.redirect };
  const dict = b.container?.json_dict;
  return {
    header: b.header,
    container: {
      json_dict: {
        card: { num_decks: dict?.card?.num_decks },
        cardlists: (dict?.cardlists ?? []).map((l: Record<string, any>) => ({
          header: l.header,
          tag: l.tag,
          cardviews: (l.cardviews ?? []).map((v: Record<string, unknown>) => ({ name: v.name, num_decks: v.num_decks, potential_decks: v.potential_decks, synergy: v.synergy })),
        })),
      },
    },
    panels: { taglinks: b.panels?.taglinks, piechart: b.panels?.piechart },
    bracket_counts: b.bracket_counts,
  };
}

/** Keeps only the card fields Swapsmith reads, so fixtures stay small. */
export function trim(body: unknown, opts: { allLegalities?: boolean; compareFields?: boolean } = {}): unknown {
  if (!body || typeof body !== 'object') return body;
  const b = body as Record<string, unknown>;
  if (b.object === 'list') return { ...b, data: (b.data as unknown[]).map((c) => trim(c, opts)) };
  if (b.object !== 'card') return b;
  const out: Record<string, unknown> = {};
  for (const k of CARD_KEYS) if (k in b) out[k] = b[k];
  // The fields src/lib/similar.ts compares on; only recordings made for it keep them, so older fixtures stay as recorded.
  if (opts.compareFields) for (const k of COMPARE_KEYS) if (k in b) out[k] = b[k];
  const img = (u: unknown) => (u && typeof u === 'object' ? { small: (u as Record<string, string>).small, normal: (u as Record<string, string>).normal } : undefined);
  if (out.image_uris) out.image_uris = img(out.image_uris);
  if (Array.isArray(out.card_faces)) {
    out.card_faces = (out.card_faces as Array<Record<string, unknown>>).map((f) => ({ name: f.name, oracle_id: f.oracle_id, type_line: f.type_line, oracle_text: f.oracle_text, ...(opts.compareFields ? { mana_cost: f.mana_cost, power: f.power, toughness: f.toughness } : {}), ...(f.image_uris ? { image_uris: img(f.image_uris) } : {}) }));
  }
  const legal = out.legalities as Record<string, string> | undefined;
  if (legal) out.legalities = opts.allLegalities ? legal : { commander: legal.commander };
  const prices = out.prices as Record<string, string | null> | undefined;
  if (prices) out.prices = { usd: prices.usd, usd_foil: prices.usd_foil, usd_etched: prices.usd_etched };
  return out;
}

/** Keeps only the card fields the art picker reads (the art_crop link, never the other image sizes), in the same shape. */
export function trimArt(body: unknown): unknown {
  if (!body || typeof body !== 'object') return body;
  const b = body as Record<string, any>;
  if (b.object === 'list') return { ...b, data: (b.data as unknown[]).map(trimArt) };
  if (b.object !== 'card') return b;
  const crop = (u: any) => (u?.art_crop ? { art_crop: u.art_crop } : undefined);
  const out: Record<string, unknown> = {};
  for (const k of ['object', 'id', 'oracle_id', 'name', 'layout', 'artist', 'illustration_id', 'image_status']) if (k in b) out[k] = b[k];
  if (b.image_uris) out.image_uris = crop(b.image_uris);
  if (Array.isArray(b.card_faces)) {
    out.card_faces = b.card_faces.map((f: Record<string, any>) => ({ name: f.name, artist: f.artist, illustration_id: f.illustration_id, ...(f.image_uris ? { image_uris: crop(f.image_uris) } : {}) }));
  }
  return out;
}
