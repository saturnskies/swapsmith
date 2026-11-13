import { frontFace, looseName } from './cards';
import { ScryfallError, type ScryfallClient } from './client';
import type { ScryCard, ScryList } from './types';

/**
 * Searches over many exact card names at once, `<filters> (!"A" or !"B" …)`, split into batches
 * that stay under Scryfall's query cap. Shared by the deck role lookup and the EDHREC name lookup.
 */

// Scryfall silently drops the end of a query past ~1,000 characters (checked 2026-11-02).
const MAX_QUERY_CHARS = 900;

// Quotes and backslashes would break the quoted name, so they are dropped.
export const cleanName = (n: string) => n.replace(/["\\]/g, '').trim();
export const nameQuery = (filters: string, names: string[]) => `${filters} (${names.map((n) => `!"${cleanName(n)}"`).join(' or ')})`;

/** Front faces (a double-faced card's full name doesn't match `!"…"`), deduplicated and grouped so each query fits with `filters`. */
export function nameBatches(names: string[], filters: string): string[][] {
  const out: string[][] = [];
  let current: string[] = [];
  for (const n of new Set(names.map(frontFace).filter((n) => cleanName(n)))) {
    if (current.length && nameQuery(filters, [...current, n]).length > MAX_QUERY_CHARS) {
      out.push(current);
      current = [];
    }
    current.push(n);
  }
  if (current.length) out.push(current);
  return out;
}

/**
 * Finds each named card with `filters` applied (for example `prefer:usd-low` for the cheapest
 * printing), keyed by the loose form of its front face. A batch that fails is counted in `failed`,
 * its names listed in `unanswered`, and the others are kept; only when every batch fails does this throw.
 */
export async function cardsByNames(
  client: ScryfallClient,
  names: string[],
  filters: string,
): Promise<{ cards: Map<string, ScryCard>; failed: number; unanswered: string[] }> {
  const cards = new Map<string, ScryCard>();
  const groups = nameBatches(names, filters);
  const errors: unknown[] = [];
  const unanswered: string[] = [];
  await Promise.all(
    groups.map(async (group) => {
      try {
        const res = await client.get<ScryList<ScryCard>>(`/cards/search?${new URLSearchParams({ q: nameQuery(filters, group) })}`);
        for (const c of res.data ?? []) cards.set(looseName(frontFace(c.name)), c);
      } catch (e) {
        if (e instanceof ScryfallError && e.status === 404) return; // none of these matched
        errors.push(e);
        unanswered.push(...group);
      }
    }),
  );
  if (groups.length && errors.length === groups.length) throw errors[0];
  return { cards, failed: errors.length, unanswered };
}

/**
 * How many of these cards (by Oracle ID) are on Scryfall's Game Changers list (`is:gamechanger`, 53
 * cards on 2026-11-12), for the bracket estimate. The whole list is one cached request shared by
 * every deck, instead of a search over each deck's names. Null when the list can't be read in full,
 * so a partial count never guesses a bracket too low.
 */
export async function gameChangerCount(client: ScryfallClient, oracleIds: string[]): Promise<number | null> {
  try {
    const res = await client.get<ScryList<ScryCard>>(`/cards/search?${new URLSearchParams({ q: 'is:gamechanger' })}`);
    // More than a page (175) of Game Changers, or a term Scryfall ignored, is not the list we know how to read.
    if (res.has_more || res.warnings?.length || !Array.isArray(res.data)) return null;
    const listed = new Set(res.data.map((c) => c.oracle_id ?? c.card_faces?.[0]?.oracle_id));
    return new Set(oracleIds.filter((id) => listed.has(id))).size;
  } catch {
    return null;
  }
}
