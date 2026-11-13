/** Browse tab logic that needs no browser: turning the search form into a Scryfall query, sorting, and what a card's detail says. */
import { isLegendaryCreature } from '../scryfall/resolve';
import type { ScryCard } from '../scryfall/types';
import { mergeEntries, type Deck } from './deck';
import { cardWarnings, warningText } from './format';

export type ColorMode = 'within' | 'exactly' | 'includes';

export interface Filters {
  /** Words that must all appear in the card name. */
  name: string;
  /** Only cards legal in Commander (`legal:commander`). */
  commanderLegal: boolean;
  /** Raw Scryfall syntax, ANDed with everything else. */
  advanced: string;
  /** A set code such as "cmr". */
  set: string;
  /** Card type words, such as "legendary artifact". */
  type: string;
  /** One creature type, such as "elf". */
  tribe: string;
  /** One keyword, such as "flying" or "first strike". */
  keyword: string;
  /** A Scryfall query for a role (ramp, removal, token makers…), chosen from a list in the screen; empty for any. */
  role: string;
  /** Color identity letters W U B R G, or C alone for colorless. */
  colors: string[];
  colorMode: ColorMode;
  /** Mana value bounds, as typed. */
  mvMin: string;
  mvMax: string;
  /** Rarity names; see RARITIES. */
  rarities: string[];
  /** USD price bounds, as typed. */
  priceMin: string;
  priceMax: string;
}

export function defaultFilters(): Filters {
  return { name: '', commanderLegal: true, advanced: '', set: '', type: '', tribe: '', keyword: '', role: '', colors: [], colorMode: 'within', mvMin: '', mvMax: '', rarities: [], priceMin: '', priceMax: '' };
}

/** The color toggles, in WUBRG order; colorless stands alone. */
export const COLORS = [
  { id: 'W', label: 'White' },
  { id: 'U', label: 'Blue' },
  { id: 'B', label: 'Black' },
  { id: 'R', label: 'Red' },
  { id: 'G', label: 'Green' },
  { id: 'C', label: 'Colorless' },
] as const;

export const RARITIES = [
  { id: 'common', code: 'c', label: 'Common' },
  { id: 'uncommon', code: 'u', label: 'Uncommon' },
  { id: 'rare', code: 'r', label: 'Rare' },
  { id: 'mythic', code: 'm', label: 'Mythic' },
] as const;

/** Scryfall silently drops the end of a query past ~1,000 characters; we refuse to send more than this. */
export const MAX_QUERY = 900;

/** Where an error belongs on the form. */
export type Field = 'form' | 'advanced' | 'set' | 'type' | 'tribe' | 'keyword' | 'colors' | 'mv' | 'price';

export type QueryResult = { ok: true; q: string } | { ok: false; field: Field; error: string };

export const quote = (word: string) => `"${word.replace(/[\\"]/g, '\\$&')}"`;
const words = (text: string) => text.split(/\s+/).filter(Boolean);

/** True when every "(" has its ")" once quoted text and /regex/ text are set aside. */
function balanced(text: string): boolean {
  let depth = 0;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (c === '"') {
      i += 1;
      while (i < text.length && text[i] !== '"') i += text[i] === '\\' ? 2 : 1;
    } else if (c === '/' && i > 0 && ':=<>'.includes(text[i - 1])) {
      i += 1;
      while (i < text.length && text[i] !== '/') i += text[i] === '\\' ? 2 : 1;
    } else if (c === '(') depth += 1;
    else if (c === ')' && (depth -= 1) < 0) return false;
  }
  return depth === 0;
}

/** True for text that is already one parenthesized group, like "(a or b)"; "(a) or (b)" is not. */
function isOneGroup(text: string): boolean {
  if (text[0] !== '(' || text[text.length - 1] !== ')') return false;
  let depth = 0;
  for (let i = 0; i < text.length; i += 1) {
    depth += text[i] === '(' ? 1 : text[i] === ')' ? -1 : 0;
    if (depth === 0 && i < text.length - 1) return false;
  }
  return depth === 0;
}

type Part = { terms: string[] } | { field: Field; error: string };
const fail = (field: Field, error: string): Part => ({ field, error });

/** A low and a high bound typed as text: both optional, each matching `shape`, the low one not above the high one. */
function range(field: Field, lo: string, hi: string, shape: RegExp, what: string, term: string): Part {
  const a = lo.trim();
  const b = hi.trim();
  for (const v of [a, b]) if (v && !shape.test(v)) return fail(field, what);
  if (a && b && Number(a) > Number(b)) return fail(field, `The minimum is above the maximum.`);
  return { terms: [...(a ? [`${term}>=${Number(a)}`] : []), ...(b ? [`${term}<=${Number(b)}`] : [])] };
}

function filterTerms(f: Filters): Part[] {
  const out: Part[] = [];
  const set = f.set.trim().toLowerCase();
  if (set) out.push(/^[a-z0-9]{2,6}$/.test(set) ? { terms: [`set:${set}`] } : fail('set', 'A set code is 2 to 6 letters or digits, like cmr.'));

  const type = words(f.type.toLowerCase());
  if (type.length) out.push(type.every((w) => /^[a-z][a-z'-]*$/.test(w)) ? { terms: type.map((w) => `t:${w}`) } : fail('type', 'Type words use letters, hyphens and apostrophes only, like legendary artifact.'));

  const tribe = f.tribe.trim().toLowerCase();
  if (tribe) out.push(/^[a-z][a-z-]*$/.test(tribe) ? { terms: ['t:creature', `t:${tribe}`] } : fail('tribe', 'Give one creature type, letters and hyphens only, like elf.'));

  const keyword = words(f.keyword.toLowerCase()).join(' ');
  if (keyword) out.push(/^[a-z][a-z -]*$/.test(keyword) ? { terms: [`kw:${quote(keyword)}`] } : fail('keyword', 'Give one keyword, letters, spaces and hyphens only, like first strike.'));

  const role = f.role.trim();
  if (role) out.push({ terms: [/\bor\b/i.test(role) && !isOneGroup(role) ? `(${role})` : role] });

  const colors = COLORS.filter((c) => f.colors.includes(c.id)).map((c) => c.id);
  if (colors.length) {
    if (colors.includes('C')) out.push(colors.length > 1 ? fail('colors', 'Colorless cannot be combined with colors.') : { terms: ['id=c'] });
    else out.push({ terms: [`id${{ within: '<=', exactly: '=', includes: '>=' }[f.colorMode] ?? '<='}${colors.join('').toLowerCase()}`] });
  }

  out.push(range('mv', f.mvMin, f.mvMax, /^\d{1,2}$/, 'Mana value is a whole number from 0 to 99.', 'mv'));

  const rarities = RARITIES.filter((r) => f.rarities.includes(r.id)).map((r) => `r:${r.code}`);
  if (rarities.length) out.push({ terms: [rarities.length === 1 ? rarities[0] : `(${rarities.join(' or ')})`] });

  out.push(range('price', f.priceMin, f.priceMax, /^\d+(\.\d{1,2})?$/, 'Price is dollars with up to two decimals, like 2.50.', 'usd'));
  return out;
}

/** The Scryfall query for the form, or the reason it can't be sent. Nothing is ever truncated. */
export function buildQuery(f: Filters): QueryResult {
  const advanced = f.advanced.trim();
  const parts: string[] = [];
  if (f.commanderLegal) parts.push('legal:commander');
  for (const word of words(f.name)) parts.push(`name:${quote(word)}`);
  for (const part of filterTerms(f)) {
    if ('error' in part) return { ok: false, ...part };
    parts.push(...part.terms);
  }
  if (advanced) {
    if (!balanced(advanced)) return { ok: false, field: 'advanced', error: 'The advanced box has unbalanced parentheses. Close every ( with a ).' };
    parts.push(`(${advanced})`);
  }
  if (!parts.length) return { ok: false, field: 'form', error: 'Add at least one filter, or turn Commander-legal on.' };
  const q = parts.join(' ');
  if (q.length > MAX_QUERY) {
    const where = advanced ? 'Shorten the advanced box or drop a filter.' : 'Drop a filter.';
    return { ok: false, field: advanced ? 'advanced' : 'form', error: `This search is too long (${q.length} of ${MAX_QUERY} characters). ${where}` };
  }
  return { ok: true, q };
}

export type SortKey = 'popularity' | 'price' | 'name' | 'mana' | 'released';

/** The sorts offered, with Scryfall's `order` and the direction that suits each (popularity 1 is the best). */
export const SORTS: Array<{ id: SortKey; label: string; order: string; descending: boolean }> = [
  { id: 'popularity', label: 'Popularity', order: 'edhrec', descending: false },
  { id: 'price', label: 'Price', order: 'usd', descending: true },
  { id: 'name', label: 'Name', order: 'name', descending: false },
  { id: 'mana', label: 'Mana value', order: 'cmc', descending: false },
  { id: 'released', label: 'Release date', order: 'released', descending: true },
];

export function sortParams(id: SortKey, descending: boolean): { order: string; dir: 'asc' | 'desc' } {
  const s = SORTS.find((x) => x.id === id) ?? SORTS[0];
  return { order: s.order, dir: descending ? 'desc' : 'asc' };
}

export const PREFS_KEY = 'swapsmith:browse';

/** What Browse remembers between visits: how results look and are ordered. Filters and results are not kept. */
export interface BrowsePrefs {
  version: 1;
  view: 'grid' | 'list';
  sort: SortKey;
  descending: boolean;
  commanderLegal: boolean;
}

export function defaultPrefs(): BrowsePrefs {
  return { version: 1, view: 'grid', sort: 'popularity', descending: SORTS[0].descending, commanderLegal: true };
}

function sanitizePrefs(raw: Record<string, unknown>): BrowsePrefs {
  const d = defaultPrefs();
  return {
    version: 1,
    view: raw.view === 'grid' || raw.view === 'list' ? raw.view : d.view,
    sort: SORTS.some((x) => x.id === raw.sort) ? (raw.sort as SortKey) : d.sort,
    descending: typeof raw.descending === 'boolean' ? raw.descending : d.descending,
    commanderLegal: typeof raw.commanderLegal === 'boolean' ? raw.commanderLegal : d.commanderLegal,
  };
}

/**
 * Reads the saved preferences under their own key, apart from the deck store. Bad data falls back to the
 * defaults field by field. `future` means a newer version saved here, which must not be overwritten.
 */
export function loadPrefs(storage: Storage | null): { prefs: BrowsePrefs; future: boolean } {
  const fresh = (future = false) => ({ prefs: defaultPrefs(), future });
  let raw: string | null;
  try {
    raw = storage ? storage.getItem(PREFS_KEY) : null;
  } catch {
    return fresh();
  }
  if (raw == null) return fresh();
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return fresh();
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return fresh();
  const rec = data as Record<string, unknown>;
  if (typeof rec.version === 'number' && rec.version > 1) return fresh(true);
  return { prefs: sanitizePrefs(rec), future: false };
}

/** Saves the preferences; false when storage is missing, blocked or full. */
export function savePrefs(storage: Storage | null, prefs: BrowsePrefs): boolean {
  if (!storage) return false;
  try {
    storage.setItem(PREFS_KEY, JSON.stringify(prefs));
    return true;
  } catch {
    return false;
  }
}

/** Scryfall's documented legality statuses, in words. Anything else is treated as unknown. */
const STATUSES: Record<string, string> = { legal: 'Legal', not_legal: 'Not legal', banned: 'Banned', restricted: 'Restricted' };

/** Commander status in words; the tone lets the screen style it, but the words carry the meaning. */
export function legalityLabel(status: string | undefined): { text: string; tone: 'good' | 'bad' | 'unknown' } {
  const word = status ? STATUSES[status] : undefined;
  if (!word) return { text: 'Commander legality unknown', tone: 'unknown' };
  return { text: `${word} in Commander`, tone: status === 'legal' ? 'good' : 'bad' };
}

/** Scryfall writes some format keys without a separator; these are how people write them. */
const FORMAT_NAMES: Record<string, string> = { paupercommander: 'Pauper Commander', standardbrawl: 'Standard Brawl', competitivebrawl: 'Competitive Brawl', predh: 'Pre-DH', oldschool: 'Old School' };

const formatName = (key: string) => FORMAT_NAMES[key] ?? key.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

/** Every format with a readable name and status: Commander first, then A to Z. Missing or odd values are skipped. */
export function allFormats(legalities: Record<string, string | undefined>): Array<{ format: string; status: string }> {
  return Object.entries(legalities)
    .flatMap(([key, status]) => (status && STATUSES[status] ? [{ key, format: formatName(key), status: STATUSES[status] }] : []))
    .sort((a, b) => (a.key === 'commander' ? -1 : b.key === 'commander' ? 1 : a.format.localeCompare(b.format)))
    .map(({ format, status }) => ({ format, status }));
}

/**
 * The Oracle ID that all printings of a card share, or null when the card has none. Never falls back to the
 * printing id: looking a printing id up as an Oracle ID would match nothing and could not be told apart from a real one.
 */
export function realOracleId(card: ScryCard): string | null {
  return card.oracle_id || card.card_faces?.[0]?.oracle_id || null;
}

const typeLineOf = (card: ScryCard) => card.type_line ?? card.card_faces?.map((f) => f.type_line ?? '').join(' // ') ?? '';

/** A legendary creature, or a card whose text says it can be your commander. */
export function canBeCommander(card: ScryCard): boolean {
  const text = card.oracle_text ?? card.card_faces?.map((f) => f.oracle_text ?? '').join('\n') ?? '';
  return isLegendaryCreature(card) || /can be your commander/i.test(text);
}

export interface AddCheck {
  /** Why the card cannot go in this deck; null when it can. */
  blocked: string | null;
  /** Things worth knowing that do not stop the add (colors, legality). */
  notes: string[];
}

/**
 * Whether a card may be added to a deck from Browse. A second copy (except basic lands), the commander
 * itself and a card with no Oracle ID are blocked; colors and legality only warn, like everywhere else in
 * the app. `identity` is the commander's color identity, or null when it could not be looked up.
 */
export function checkAdd(deck: Deck, card: ScryCard, identity: string[] | null): AddCheck {
  const oracleId = card.oracle_id || card.card_faces?.[0]?.oracle_id;
  if (!oracleId) return { blocked: `${card.name} can't be added: Scryfall gave it no Oracle ID.`, notes: [] };
  const warnings = cardWarnings(
    { oracleId, name: card.name, typeLine: typeLineOf(card), colorIdentity: card.color_identity ?? [], commanderLegality: card.legalities?.commander },
    { colorIdentity: identity ?? card.color_identity ?? [], oracleIds: new Set([deck.commander.oracleId, ...deck.cards.map((e) => e.card.oracleId)]) },
  );
  const say = (w: (typeof warnings)[number]) => warningText(w, card.name, deck.commander.name);
  return {
    blocked: warnings.includes('duplicate') ? say('duplicate') : null,
    notes: [...warnings.filter((w) => w !== 'duplicate').map(say), ...(identity ? [] : [`Couldn't check ${deck.commander.name}'s colors.`])],
  };
}

/** The deck with one more copy of the card. Saved prices are dropped: they no longer match, and opening the deck prices it again. */
export function addCardToDeck(deck: Deck, card: ScryCard, now = new Date()): Deck {
  const oracleId = (card.oracle_id || card.card_faces?.[0]?.oracle_id) as string;
  const next: Deck = { ...deck, cards: mergeEntries([...deck.cards, { card: { oracleId, name: card.name }, qty: 1 }]), updatedAt: now.toISOString() };
  delete next.summary;
  return next;
}
