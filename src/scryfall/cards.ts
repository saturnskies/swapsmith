import type { ParsedLine } from '../lib/parse';
import { ScryfallError, type ScryfallClient } from './client';
import type { ScryCard, ScryList } from './types';

const COLLECTION_LIMIT = 75; // Scryfall's maximum identifiers per /cards/collection call

/** "Bloodline Keeper // Lord of Lineage" → "Bloodline Keeper": Scryfall's collection lookup only matches the front face. */
export const frontFace = (name: string) => name.split(' // ')[0].trim();

/** Case-, accent- and apostrophe-insensitive form of a card name, for matching replies to requests. */
export const normName = (s: string) =>
  s.normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[’‘`]/g, "'").toLowerCase().replace(/\s+/g, ' ').trim();

/** Looser still: ignores spaces and punctuation, so "Blood-Thief" matches "Bloodthief" and "Moogle's" matches "Moogles'". */
export const looseName = (s: string) => normName(s).replace(/[^a-z0-9]/g, '');

/** Whether a card is the one a user typed: its name, front face or printed alternate name, ignoring punctuation. */
export function matchesName(card: ScryCard, typed: string): boolean {
  const want = new Set([looseName(typed), looseName(frontFace(typed))]);
  return [card.name, frontFace(card.name), card.card_faces?.[0]?.name, card.flavor_name].some((n) => !!n && want.has(looseName(n)));
}

const chunks = <T>(xs: T[], n: number) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

type Identifier = { name: string } | { name: string; set: string } | { set: string; collector_number: string } | { oracle_id: string } | { id: string };

async function collection(client: ScryfallClient, ids: Identifier[]): Promise<ScryCard[]> {
  const out: ScryCard[] = [];
  for (const batch of chunks(ids, COLLECTION_LIMIT)) {
    const res = await client.post<ScryList<ScryCard>>('/cards/collection', { identifiers: batch });
    out.push(...(res.data ?? []));
  }
  return out;
}

/**
 * Looks up pasted lines; the result is aligned with `entries`, null where Scryfall found nothing or
 * returned a different card. Scryfall answers in request order with misses left out, so replies are
 * paired with requests by position; each pairing is then checked, because a batch lookup of
 * "Sign in Blood" returns "Scheming Silvertongue // Sign in Blood".
 */
export async function lookupEntries(client: ScryfallClient, entries: ParsedLine[]): Promise<Array<ScryCard | null>> {
  const out: Array<ScryCard | null> = [];
  for (const batch of chunks(entries, COLLECTION_LIMIT)) {
    const ids: Identifier[] = batch.map((e) =>
      e.set && e.number ? { set: e.set, collector_number: e.number } : e.set ? { name: frontFace(e.name), set: e.set } : { name: frontFace(e.name) },
    );
    const res = await client.post<ScryList<ScryCard>>('/cards/collection', { identifiers: ids });
    const data = res.data ?? [];
    const missing = new Set((res.not_found ?? []).map((id) => JSON.stringify(id)));
    const accept = (e: ParsedLine, c: ScryCard | undefined) =>
      !c ? null : e.set && e.number ? (c.set === e.set && c.collector_number === e.number ? c : null) : matchesName(c, e.name) && (!e.set || c.set === e.set) ? c : null;

    if (data.length + missing.size === batch.length) {
      let next = 0;
      batch.forEach((e, i) => out.push(missing.has(JSON.stringify(ids[i])) ? null : accept(e, data[next++])));
    } else {
      // Unexpected reply shape: fall back to matching by name or printing.
      batch.forEach((e) => out.push(accept(e, data.find((c) => accept(e, c)))));
    }
  }
  return out;
}

/** Scryfall's "did you mean": the closest card name, or null when nothing is close enough. */
export async function fuzzyCard(client: ScryfallClient, name: string): Promise<ScryCard | null> {
  try {
    return await client.get<ScryCard>(`/cards/named?${new URLSearchParams({ fuzzy: name })}`);
  } catch (e) {
    if (e instanceof ScryfallError && e.status === 404) return null;
    throw e;
  }
}

/** One card object per Oracle ID (whichever printing Scryfall picks), for names, types and images. */
export async function cardsByOracleId(client: ScryfallClient, oracleIds: string[]): Promise<Map<string, ScryCard>> {
  const unique = [...new Set(oracleIds)];
  if (!unique.length) return new Map();
  const cards = await collection(client, unique.map((oracle_id) => ({ oracle_id })));
  const map = new Map<string, ScryCard>();
  for (const c of cards) {
    const id = c.oracle_id ?? c.card_faces?.[0]?.oracle_id;
    if (id) map.set(id, c);
  }
  return map;
}

/** The specific printings a user picked, by Scryfall ID. */
export async function cardsByPrintingId(client: ScryfallClient, printingIds: string[]): Promise<Map<string, ScryCard>> {
  const unique = [...new Set(printingIds)];
  if (!unique.length) return new Map();
  return new Map((await collection(client, unique.map((id) => ({ id })))).map((c) => [c.id, c]));
}

/** Paper printings worth pricing: no oversized cards, gold borders or memorabilia sets. */
const PRINT_FILTERS = 'game:paper -st:memorabilia -is:oversized -border:gold';

/** How many printings Scryfall returns in one page of a search. */
export const PRINTINGS_PAGE = 175;

export const PRINTINGS_QUERY = (oracleId: string) => `oracleid:${oracleId} ${PRINT_FILTERS}`;

/**
 * Paper printings of one card, sorted by nonfoil price, for the printing picker and the Browse card
 * detail. Scryfall sorts unpriced printings first, so a card with more than one page of printings
 * (basic lands, Sol Ring) is fetched again filtered to priced ones; then only the cheapest page
 * (PRINTINGS_PAGE) is seen, and a foil-only cheaper printing could be missed.
 */
export async function printings(client: ScryfallClient, oracleId: string): Promise<ScryCard[]> {
  const search = async (q: string) => {
    try {
      return await client.get<ScryList<ScryCard>>(`/cards/search?${new URLSearchParams({ q, unique: 'prints', order: 'usd', dir: 'asc' })}`);
    } catch (e) {
      if (e instanceof ScryfallError && e.status === 404) return { object: 'list', data: [] } as ScryList<ScryCard>;
      throw e;
    }
  };
  const first = await search(PRINTINGS_QUERY(oracleId));
  if (!first.has_more) return first.data;
  return (await search(`${PRINTINGS_QUERY(oracleId)} usd>0`)).data;
}

// Scryfall silently drops the end of a query past ~1,000 characters (checked 2026-11-02), so
// batches stop well short of that.
const MAX_QUERY_CHARS = 900;

// `prefer:usd-low` makes Scryfall answer with each card's lowest-priced printing (a foil-only card's
// foil printing), so one result per card is enough to price it.
const cheapestQuery = (ids: string[]) => `(${ids.map((id) => `oracleid:${id}`).join(' or ')}) ${PRINT_FILTERS} prefer:usd-low`;

/** Splits Oracle IDs into groups whose OR query stays within MAX_QUERY_CHARS. */
function queryBatches(ids: string[]): string[][] {
  const out: string[][] = [];
  let current: string[] = [];
  for (const id of ids) {
    if (current.length && cheapestQuery([...current, id]).length > MAX_QUERY_CHARS) {
      out.push(current);
      current = [];
    }
    current.push(id);
  }
  if (current.length) out.push(current);
  return out;
}

/**
 * The lowest-priced paper printing of each card, in one search per ~15 cards: a 100-card deck needs
 * about 6 requests (ADR-006). A card with no paper printing is left out of `cards`. A batch that
 * fails is listed in `failed` and the others are kept. `onBatch` reports each batch as it settles.
 */
export async function cheapestPrintings(
  client: ScryfallClient,
  oracleIds: string[],
  onBatch: (ids: string[]) => void = () => {},
): Promise<{ cards: Map<string, ScryCard>; failed: Set<string> }> {
  const cards = new Map<string, ScryCard>();
  const failed = new Set<string>();
  await Promise.all(
    queryBatches([...new Set(oracleIds)]).map(async (ids) => {
      const wanted = new Set(ids);
      try {
        const res = await client.get<ScryList<ScryCard>>(`/cards/search?${new URLSearchParams({ q: cheapestQuery(ids), unique: 'cards' })}`);
        for (const c of res.data ?? []) {
          const id = c.oracle_id ?? c.card_faces?.[0]?.oracle_id;
          if (id && wanted.has(id)) cards.set(id, c);
        }
      } catch (e) {
        // 404: none of these cards has a paper printing.
        if (!(e instanceof ScryfallError && e.status === 404)) for (const id of ids) failed.add(id);
      } finally {
        onBatch(ids);
      }
    }),
  );
  return { cards, failed };
}

const MIN_QUERY = 2;
const MAX_SUGGESTIONS = 10;

/** Cards that can be a commander whose name contains the typed text, most-played first. */
export async function searchCommanders(client: ScryfallClient, typed: string): Promise<ScryCard[]> {
  const text = typed.replace(/["\\]/g, ' ').replace(/\s+/g, ' ').trim();
  if (text.length < MIN_QUERY) return [];
  try {
    const res = await client.get<ScryList<ScryCard>>(`/cards/search?${new URLSearchParams({ q: `is:commander game:paper "${text}"`, order: 'edhrec' })}`);
    return res.data.slice(0, MAX_SUGGESTIONS);
  } catch (e) {
    if (e instanceof ScryfallError && e.status === 404) return [];
    throw e;
  }
}

/**
 * Card names starting with or containing the typed text (Scryfall's autocomplete). Drops oddities
 * like "Sol Ring // Sol Ring" (art-series cards), whose two halves share one name.
 */
export async function autocompleteNames(client: ScryfallClient, typed: string): Promise<string[]> {
  const text = typed.trim();
  if (text.length < MIN_QUERY) return [];
  const res = await client.get<{ data: string[] }>(`/cards/autocomplete?${new URLSearchParams({ q: text })}`);
  return (res.data ?? [])
    .filter((n) => {
      const [a, b] = n.split(' // ');
      return b === undefined || a !== b;
    })
    .slice(0, MAX_SUGGESTIONS);
}

/** A card by its exact name, or null. */
export async function cardByName(client: ScryfallClient, name: string): Promise<ScryCard | null> {
  try {
    return await client.get<ScryCard>(`/cards/named?${new URLSearchParams({ exact: name })}`);
  } catch (e) {
    if (e instanceof ScryfallError && e.status === 404) return null;
    throw e;
  }
}
