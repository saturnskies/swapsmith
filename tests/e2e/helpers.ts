import { readFileSync } from 'node:fs';
import { expect, type Page } from '@playwright/test';
import { frontFace, looseName } from '../../src/scryfall/cards';
import { requestKey, type FixtureMap } from '../support/fixtures';

const load = (name: string): FixtureMap => JSON.parse(readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8'));

/**
 * Recorded Scryfall replies (see tests/unit/record-fixtures.test.ts). Fixtures recorded at different
 * times can hold the same request with different prices, so each test uses only its own flow's map.
 */
export const flows: FixtureMap = { ...load('scryfall-e2e.json'), ...load('scryfall-new-deck.json') };
/** The Edgar Markov EDHREC pages and their Scryfall name lookups, recorded 2026-11-03. */
export const edgarEdhrec: FixtureMap = load('edhrec-edgar.json');
/**
 * The full Edgar deck's Scryfall replies. Every Find also counts the deck's Game Changers, so the
 * recorded `is:gamechanger` replies (from the EDHREC recording) come with it, and the rules-based
 * fallback's newer searches with them.
 */
export const edgarFull: FixtureMap = {
  ...load('scryfall-edgar-full.json'),
  // The fallback's wider searches (more roles, the tokens theme Edgar's text names), recorded 2026-11-04.
  ...load('scryfall-edgar-fallback.json'),
  ...Object.fromEntries(Object.entries(edgarEdhrec).filter(([k]) => k.startsWith('GET /cards/search?q=is%3Agamechanger'))),
};
/** The Browse tab's searches (every sort, no match, an ignored term, a bad query), recorded 2026-11-04. */
export const browseSearches: FixtureMap = load('scryfall-browse.json');
export const e2eList = readFileSync(new URL('../fixtures/e2e-list.txt', import.meta.url), 'utf8');

// A 1×1 grey PNG standing in for card images, so tests never download from Scryfall's image host.
const PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

/**
 * Answers Scryfall and EDHREC from recorded replies; returns the requests that had no recording.
 * EDHREC answers 403 ("no page for this commander") unless `edhrec` holds its replies, so tests that
 * don't pass one see the rules-based fallback.
 */
export async function mockScryfall(page: Page, recorded: FixtureMap = flows, edhrec?: FixtureMap): Promise<string[]> {
  const misses: string[] = [];
  await page.route('https://json.edhrec.com/**', async (route) => {
    if (!edhrec) return route.fulfill({ status: 403, contentType: 'text/html', body: '<html>Forbidden</html>' });
    const key = requestKey('GET', route.request().url());
    const hit = edhrec[key];
    if (!hit) {
      misses.push(key);
      return route.fulfill({ status: 500, json: { error: 'unrecorded' } });
    }
    return route.fulfill({ status: hit.status, json: hit.body });
  });
  const lookups = edhrec ? lookupIndex(edhrec) : null;
  const roles = edhrec ? roleIndex({ ...recorded, ...edhrec }) : null;
  if (edhrec) recorded = { ...recorded, ...edhrec };
  await page.route('https://cards.scryfall.io/**', (route) => route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL }));
  await page.route('https://api.scryfall.com/**', async (route) => {
    const req = route.request();
    const key = requestKey(req.method(), req.url(), req.postData());
    const hit = recorded[key] ?? (lookups && answerLookup(lookups, req.url())) ?? (roles && answerRoles(roles, req.url()));
    if (!hit) {
      misses.push(key);
      return route.fulfill({ status: 500, json: { object: 'error', details: 'unrecorded' } });
    }
    return route.fulfill({ status: hit.status, json: hit.body });
  });
  return misses;
}

const LOOKUP = /^f:commander id<=\w+ game:paper prefer:usd-low \((.*)\)$/;
/** The app's own name matching, so the mock pairs names exactly as the app does. */
const loose = (n: string) => looseName(frontFace(n));

/** Every card in the recorded EDHREC name lookups, by loose front-face name. */
function lookupIndex(map: FixtureMap): Map<string, unknown> {
  const index = new Map<string, unknown>();
  for (const [key, rec] of Object.entries(map)) {
    const q = key.startsWith('GET /cards/search?') ? new URLSearchParams(key.split('?')[1]).get('q') : null;
    if (!q || !LOOKUP.test(q)) continue;
    for (const c of (rec.body as { data?: Array<{ name: string }> }).data ?? []) index.set(loose(c.name), c);
  }
  return index;
}

/**
 * Answers an EDHREC name lookup (`… prefer:usd-low (!"A" or !"B" …)`) from recorded cards, as Scryfall
 * would: the cards found, or 404 when none are. The app batches names by what it has already looked
 * up, so batches vary with the order a test changes filters; the cards themselves are all recorded.
 */
function answerLookup(index: Map<string, unknown>, url: string): { status: number; body: unknown } | null {
  const q = new URL(url).searchParams.get('q') ?? '';
  const m = LOOKUP.exec(q);
  if (!m) return null;
  const data = [...m[1].matchAll(/!"([^"]+)"/g)].map(([, n]) => index.get(loose(n))).filter(Boolean);
  return data.length ? { status: 200, body: { object: 'list', has_more: false, total_cards: data.length, data } } : { status: 404, body: { object: 'error', status: 404, details: 'Your query didn’t match any cards.' } };
}

/** Pastes tests/fixtures/e2e-list.txt, fixes its two problem lines, and creates the deck. */
export async function pasteAndFix(page: Page, name = 'Edgar test') {
  await page.goto('./');
  await page.getByRole('link', { name: 'Paste a list' }).click();
  await page.getByLabel('Deck name').fill(name);
  await page.getByLabel('Decklist').fill(e2eList);
  await page.getByRole('button', { name: 'Price this deck' }).click();

  await expect(page.getByText('2 cards need attention')).toBeVisible();
  await page.getByRole('button', { name: 'Use Kalastria Highborn' }).click();
  const emmerstorm = page.getByRole('listitem').filter({ hasText: 'Emmerstorm Predator' });
  await expect(emmerstorm).toContainText('No close match');
  await emmerstorm.getByRole('button', { name: 'Remove' }).click();

  await expect(page.getByText('Commander: Edgar Markov')).toBeVisible();
  await page.getByRole('button', { name: 'Create deck' }).click();
  await expect(page.getByTestId('deck-total')).toHaveText(/\$/);
}

const edgarDeck = () => JSON.parse(readFileSync(new URL('../fixtures/edgar-deck.json', import.meta.url), 'utf8'));

/** Saves `store` as the app's saved data before the page loads (only if nothing is saved yet). */
export async function seedStore(page: Page, store: object) {
  await page.addInitScript(([payload]) => {
    if (!localStorage.getItem('swapsmith:v1')) localStorage.setItem('swapsmith:v1', payload);
  }, [JSON.stringify(store)]);
}

/**
 * The full 100-card Edgar Markov deck, saved before the page loads, as if the user had built it. The
 * first-use note about Owned and Keep starts dismissed, as for a returning user, so it does not move
 * what other specs measure; pass `{ firstVisit: true }` to see it. (Saved in the old shape on purpose:
 * it is migrated on load, so every spec that uses this also exercises the migration.)
 */
export async function seedEdgarDeck(page: Page, opts: { firstVisit?: boolean } = {}) {
  const deck = edgarDeck();
  const prefs = opts.firstVisit ? { view: 'list' } : { view: 'list', helpDismissed: true };
  await seedStore(page, { version: 1, decks: [deck], owned: [], unownedBasics: [], prefs });
  return deck as { id: string };
}

/** Two copies of the Edgar deck (ids `deck-a` and `deck-b`), so the same card is in both; `store` builds the saved data from them. */
export async function seedTwoEdgarDecks(page: Page, store: (a: object, b: object) => object) {
  const edgar = edgarDeck();
  await seedStore(page, store({ ...edgar, id: 'deck-a', name: 'Deck A' }, { ...edgar, id: 'deck-b', name: 'Deck B' }));
}

/** Answers Scryfall from the recorded Edgar replies, seeds the deck and opens it once its 100 cards are priced. */
export async function openEdgarDeck(page: Page, opts: { firstVisit?: boolean } = {}) {
  await mockScryfall(page, edgarFull);
  const deck = await seedEdgarDeck(page, opts);
  await page.goto(`./#/deck/${deck.id}`);
  await expect(page.getByTestId('deck-count')).toHaveText('100 / 100 cards');
  return deck;
}

/**
 * The deck-list row for a card, found by its name (counts hidden rows too, unlike a role query on the row). The name
 * is a button that opens the card dialog, except for the commander and basic lands, where it is a TCGplayer link.
 */
export const cardName = (page: Page, name: string) => page.getByRole('button', { name, exact: true }).or(page.getByRole('link', { name, exact: true }));
export const row = (page: Page, name: string) => page.getByRole('row').filter({ has: cardName(page, name) });
export const suggestionsPanel = (page: Page) => page.getByRole('complementary', { name: 'Suggestions' });
export const paneBar = (page: Page) => page.getByRole('group', { name: 'Show' });

/** 70rem in px (src/style.css): from this width the list and the suggestions panel sit side by side. */
const SIDE_BY_SIDE_PX = 1120;

/**
 * Below 70rem the card list and the suggestions panel share the screen and a bar switches between them;
 * this shows one. On a wide screen both are already visible, so nothing is clicked.
 */
export async function showPane(page: Page, pane: 'Cards' | 'Suggestions') {
  if ((page.viewportSize()?.width ?? 1280) >= SIDE_BY_SIDE_PX) return;
  await paneBar(page).getByRole('button', { name: pane, exact: true }).click();
}
const ROLE = /^(otag:[a-z-]+) \((.*)\)$/;
type RoleIndex = { checked: Set<string>; byTag: Map<string, Map<string, unknown>> };

/** Every card checked in a recorded role search (`otag:<tag> (!"A" or …)`), and the cards found per tag. */
function roleIndex(map: FixtureMap): RoleIndex {
  const index: RoleIndex = { checked: new Set(), byTag: new Map() };
  for (const [key, rec] of Object.entries(map)) {
    const q = key.startsWith('GET /cards/search?') ? new URLSearchParams(key.split('?')[1]).get('q') : null;
    const m = q && ROLE.exec(q);
    if (!m || rec.status >= 500) continue;
    for (const [, n] of m[2].matchAll(/!"([^"]+)"/g)) index.checked.add(loose(n));
    const found = index.byTag.get(m[1]) ?? new Map<string, unknown>();
    for (const c of (rec.body as { data?: Array<{ name: string }> }).data ?? []) found.set(loose(c.name), c);
    index.byTag.set(m[1], found);
  }
  return index;
}

/**
 * Answers a role search over names the recordings already checked for roles, from those recorded
 * answers; batches differ with the order a test changes filters, the cards' roles don't.
 */
function answerRoles(index: RoleIndex, url: string): { status: number; body: unknown } | null {
  const m = ROLE.exec(new URL(url).searchParams.get('q') ?? '');
  if (!m) return null;
  const names = [...m[2].matchAll(/!"([^"]+)"/g)].map(([, n]) => loose(n));
  if (!names.length || !names.every((n) => index.checked.has(n))) return null;
  const found = index.byTag.get(m[1]) ?? new Map();
  const data = names.map((n) => found.get(n)).filter(Boolean);
  return data.length ? { status: 200, body: { object: 'list', has_more: false, total_cards: data.length, data } } : { status: 404, body: { object: 'error', status: 404, details: 'Your query didn’t match any cards.' } };
}


/** The recorded art-picker replies (name, artist, no match, ignored term, bad query, random), recorded 2026-11-13. */
export const artReplies: FixtureMap = load('scryfall-art.json');
/** A real 626×457 art crop (32 KB), served for every card image the art tests ask for. */
export const artCrop = readFileSync(new URL('../fixtures/art-crop-island.jpg', import.meta.url));

export interface ArtMock {
  /** The `q` of every card search that reached Scryfall, in order. */
  searches: string[];
  /** How many `/cards/random` requests were made. */
  randoms: number;
  /** The card images asked for with `fetch` (the app saving one), not the `<img>` thumbnails. */
  fetches: string[];
  /** Hold a kind of reply until the promise settles. */
  gate: { search?: Promise<unknown>; random?: Promise<unknown>; image?: Promise<unknown> };
  /** Status for the next replies: a random card or an image can be made to fail. */
  fail: { random?: boolean; image?: boolean };
  /** Overrides a search's answer (return null to use the recording). Gets the full `q` and the page number. */
  answer?: (q: string, page: number) => { status: number; body: unknown } | null;
  /** The image bytes served for card images, and their type. */
  image: { body: Buffer; type: string };
}

/**
 * Answers the art picker from the recordings: a search the recording holds is answered as recorded; any other search
 * (a filter combination, a different word) is answered with the recorded name search's cards, so a test can check the
 * request the filters build without Scryfall applying them. `/cards/random` answers the recorded random card.
 * Card images come from `art.image` with CORS allowed, so the app can save the bytes.
 */
export async function mockArt(page: Page): Promise<ArtMock> {
  const art: ArtMock = { searches: [], randoms: 0, fetches: [], gate: {}, fail: {}, image: { body: artCrop, type: 'image/jpeg' } };
  const byName = artReplies['GET /cards/search?q=name%3A%22delver%22+is%3Ahighres&unique=art&order=released&page=1'];
  const byArtist = artReplies['GET /cards/search?q=a%3A%22quinton+hoover%22+is%3Ahighres&unique=art&order=released&page=1'];
  await page.route('https://cards.scryfall.io/**', async (route) => {
    const req = route.request();
    if (req.resourceType() === 'fetch') art.fetches.push(req.url());
    if (art.gate.image && req.resourceType() === 'fetch') await art.gate.image;
    if (art.fail.image && req.resourceType() === 'fetch') return route.fulfill({ status: 500, body: 'no' });
    return route.fulfill({ status: 200, contentType: art.image.type, headers: { 'access-control-allow-origin': '*' }, body: art.image.body });
  });
  await page.route('https://api.scryfall.com/cards/random**', async (route) => {
    art.randoms += 1;
    if (art.gate.random) await art.gate.random;
    if (art.fail.random) return route.fulfill({ status: 500, json: { object: 'error', status: 500, details: 'boom' } });
    return route.fulfill({ status: 200, json: artReplies['GET /cards/random?q=is%3Ahighres'].body });
  });
  await page.route('https://api.scryfall.com/cards/search**', async (route) => {
    const url = new URL(route.request().url());
    const q = url.searchParams.get('q') ?? '';
    art.searches.push(q);
    if (art.gate.search) await art.gate.search;
    const hit = art.answer?.(q, Number(url.searchParams.get('page') ?? 1)) ?? artReplies[requestKey('GET', route.request().url())] ?? (q.startsWith('a:') ? byArtist : byName);
    return route.fulfill({ status: hit.status, json: hit.body });
  });
  return art;
}
