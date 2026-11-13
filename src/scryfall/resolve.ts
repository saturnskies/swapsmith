import { mergeEntries, newDeckId, type Deck, type DeckEntry } from '../lib/deck';
import type { ParsedLine } from '../lib/parse';
import { bestPrice, tcgplayerUrl, type Finish } from '../lib/price';
import { cardsByOracleId, cardsByPrintingId, cheapestPrintings, fuzzyCard, lookupEntries, looseName, matchesName } from './cards';
import type { ScryfallClient } from './client';
import type { ScryCard } from './types';

export interface ResolvedLine {
  entry: ParsedLine;
  /** The matched card, or null when the name didn't match. */
  card: ScryCard | null;
  /** Scryfall's "did you mean" for an unmatched name, or null. */
  suggestion: ScryCard | null;
  /** Set when the typed name is an alternate printed name, e.g. "Panther Idol" for Mind's Eye. */
  aliasOf?: string;
}

/** Matches pasted lines to cards and finds suggestions for the ones that don't match. */
export async function resolveList(client: ScryfallClient, entries: ParsedLine[]): Promise<ResolvedLine[]> {
  const cards = await lookupEntries(client, entries);
  // All "did you mean" lookups are queued at once; the client spaces them out.
  return Promise.all(
    entries.map(async (entry, i): Promise<ResolvedLine> => {
      const card = cards[i];
      if (card) return { entry, card, suggestion: null, ...alias(card, entry.name) };
      const suggestion = await fuzzyCard(client, entry.name);
      // A "did you mean" that is exactly what was typed (or its alternate name) needs no question.
      if (suggestion && matchesName(suggestion, entry.name)) return { entry, card: suggestion, suggestion: null, ...alias(suggestion, entry.name) };
      return { entry, card: null, suggestion };
    }),
  );
}

const alias = (card: ScryCard, typed: string) =>
  card.flavor_name && looseName(card.flavor_name) === looseName(typed) && looseName(card.name) !== looseName(typed) ? { aliasOf: card.name } : {};

export const oracleIdOf = (c: ScryCard) => c.oracle_id ?? c.card_faces?.[0]?.oracle_id ?? c.id;

const typeLineOf = (c: ScryCard) => c.type_line ?? c.card_faces?.map((f) => f.type_line).join(' // ') ?? '';

export const isLegendaryCreature = (c: ScryCard) => /\bLegendary\b/.test(typeLineOf(c).split(' // ')[0]) && /\bCreature\b/.test(typeLineOf(c).split(' // ')[0]);

/** Who could be the commander: lines marked as commander, else every legendary creature in the list. */
export function commanderCandidates(lines: Array<{ entry: ParsedLine; card: ScryCard }>): ScryCard[] {
  const marked = lines.filter((l) => l.entry.isCommander).map((l) => l.card);
  const pool = marked.length ? marked : lines.filter((l) => isLegendaryCreature(l.card)).map((l) => l.card);
  const seen = new Set<string>();
  return pool.filter((c) => !seen.has(oracleIdOf(c)) && seen.add(oracleIdOf(c)));
}

/** Builds a deck from matched lines; a line with a pasted set and number keeps that printing. */
export function buildDeck(name: string, lines: Array<{ entry: ParsedLine; card: ScryCard }>, commander: ScryCard, now = new Date()): Deck {
  const commanderId = oracleIdOf(commander);
  const entries: DeckEntry[] = [];
  let commanderSkipped = false;
  for (const { entry, card } of lines) {
    const id = oracleIdOf(card);
    if (id === commanderId && !commanderSkipped) {
      commanderSkipped = true;
      if (entry.qty === 1) continue;
      entries.push({ card: { oracleId: id, name: card.name }, qty: entry.qty - 1 });
      continue;
    }
    const e: DeckEntry = { card: { oracleId: id, name: card.name }, qty: entry.qty };
    if (entry.set && entry.number) e.printingId = card.id;
    entries.push(e);
  }
  return {
    id: newDeckId(),
    name: name.trim() || `${commander.name} deck`,
    format: 'commander',
    commander: { oracleId: commanderId, name: commander.name },
    cards: mergeEntries(entries),
    updatedAt: now.toISOString(),
  };
}

export interface PricedCard {
  entry: DeckEntry;
  isCommander: boolean;
  /** The printing that is priced: the pinned one, else the cheapest. Null if Scryfall has no such card. */
  card: ScryCard | null;
  /** Scryfall's lowest-priced paper printing, for going back from a pinned one. Null when the card has none or it couldn't be loaded. */
  cheapest: ScryCard | null;
  typeLine: string;
  price: number | null;
  finish: Finish | null;
  url: string | null;
  /** True when Scryfall couldn't be reached for this card's price; reloading may fix it. */
  failed?: boolean;
}

/** A card at one printing, priced at that printing's cheapest finish. */
function at(printing: ScryCard): Pick<PricedCard, 'card' | 'typeLine' | 'price' | 'finish' | 'url'> {
  const best = bestPrice(printing);
  return { card: printing, typeLine: typeLineOf(printing), price: best?.price ?? null, finish: best?.finish ?? null, url: tcgplayerUrl(printing, best?.finish ?? 'nonfoil') };
}

/** Prices a card at a chosen printing, or back at the cheapest when none is given. */
export function withPrinting(p: PricedCard, printing: ScryCard | undefined): PricedCard {
  const entry: DeckEntry = { ...p.entry };
  if (printing) entry.printingId = printing.id;
  else delete entry.printingId;
  const pick = printing ?? p.cheapest;
  if (!pick) return { ...p, entry, price: null, finish: null };
  // The printing is in hand, so whatever failed to load before no longer applies.
  const { failed: _failed, ...rest } = p;
  return { ...rest, entry, ...at(pick) };
}

/** Prices every card in a deck at its pinned or cheapest printing. Reports progress as cards are priced. */
export function priceDeck(client: ScryfallClient, deck: Deck, onProgress?: (done: number, total: number) => void): Promise<PricedCard[]> {
  return priceEntries(
    client,
    [
      { entry: { card: deck.commander, qty: 1, ...(deck.commanderPrintingId ? { printingId: deck.commanderPrintingId } : {}) }, isCommander: true },
      ...deck.cards.map((entry) => ({ entry, isCommander: false })),
    ],
    onProgress,
  );
}

/**
 * Prices deck entries: one search per ~15 cards for each card's cheapest paper printing, plus one
 * lookup for the printings users pinned (ADR-006). A batch that fails leaves its cards in the list,
 * unpriced and marked `failed`; this throws only when nothing could be loaded at all. `known` holds
 * card objects already fetched (say, a card just added by name), shown when a card has no paper
 * printing or its price couldn't be loaded.
 */
export async function priceEntries(
  client: ScryfallClient,
  all: Array<{ entry: DeckEntry; isCommander: boolean }>,
  onProgress: (done: number, total: number) => void = () => {},
  known: Map<string, ScryCard> = new Map(),
): Promise<PricedCard[]> {
  const ids = [...new Set(all.map((x) => x.entry.card.oracleId))];
  const pinnedIds = all.flatMap((x) => (x.entry.printingId ? [x.entry.printingId] : []));
  let done = 0;
  onProgress(0, ids.length);

  const [cheap, pinned] = await Promise.all([
    cheapestPrintings(client, ids, (batch) => onProgress((done += batch.length), ids.length)),
    // Null when the pinned printings couldn't be loaded: those cards are then unpriced, not priced at another printing.
    cardsByPrintingId(client, pinnedIds).catch(() => null),
  ]);
  const unseen = ids.filter((id) => !cheap.cards.has(id) && !known.has(id));
  if (ids.length && cheap.failed.size === ids.length && unseen.length === ids.length) throw new Error('prices unavailable');
  // Cards with no paper printing (or whose batch failed) still show by name and type when Scryfall knows them.
  const others = unseen.length ? await cardsByOracleId(client, unseen).catch(() => new Map<string, ScryCard>()) : new Map<string, ScryCard>();

  return all.map(({ entry, isCommander }): PricedCard => {
    const id = entry.card.oracleId;
    const cheapest = cheap.cards.get(id) ?? null;
    const shown = cheapest ?? known.get(id) ?? others.get(id) ?? null;
    const found = entry.printingId ? pinned?.get(entry.printingId) : undefined;
    // A pinned printing of another card (a hand-made share link) is ignored, like one that no longer exists.
    const pin = found && oracleIdOf(found) === id ? found : undefined;
    const failed = cheap.failed.has(id) || (!!entry.printingId && pinned === null);
    const unpriced = { card: shown, typeLine: shown ? typeLineOf(shown) : '', price: null, finish: null, url: shown ? tcgplayerUrl(shown, 'nonfoil') : null };
    const priced: PricedCard = { entry, isCommander, cheapest, ...(failed ? unpriced : pin ? at(pin) : cheapest ? at(cheapest) : unpriced) };
    if (failed) priced.failed = true;
    return priced;
  });
}
