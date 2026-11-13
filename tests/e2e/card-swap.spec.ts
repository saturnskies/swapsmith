import { readFileSync } from 'node:fs';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { frontFace } from '../../src/scryfall/cards';
import type { FixtureMap } from '../support/fixtures';
import { edgarEdhrec, edgarFull, mockScryfall, seedEdgarDeck, showPane, suggestionsPanel } from './helpers';

// Tap a card in the deck list, see similar cards that fit (swap-from-card spec). The full Edgar Markov deck
// with EDHREC's Edgar pages recorded 2026-11-03 (tests/fixtures/edhrec-edgar.json); the deck runs no Game
// Changers, so the page is bracket 2 (Core).

/**
 * The Edgar recordings predate the recorder keeping `mana_cost` and `cmc`, so the costs the tests look for are added to
 * the recorded replies here (Scryfall's real costs for those cards).
 */
const COSTS: Record<string, [cost: string, cmc: number]> = { 'Arcane Signet': ['{2}', 2], "Commander's Sphere": ['{3}', 3], 'Orzhov Signet': ['{1}', 2], 'Phyrexian Altar': ['{3}', 3] };
const withCosts = (map: FixtureMap): FixtureMap =>
  JSON.parse(JSON.stringify(map), (_key, v) => (v && typeof v === 'object' && 'oracle_id' in v && v.name in COSTS ? { ...v, mana_cost: COSTS[v.name][0], cmc: COSTS[v.name][1] } : v));

/**
 * A copy of EDHREC's Edgar pages with the page cards changed: `decks` sets a card's deck count (of the page's 3409), and
 * `without` takes a card off the page. Inclusion is decks over 3409, so Arcane Signet is at 78%, Orzhov Signet 40%,
 * Commander's Sphere 20% and Phyrexian Altar 7%.
 */
const withPage = (map: FixtureMap, edit: { decks?: Record<string, number>; without?: string[] }): FixtureMap =>
  JSON.parse(JSON.stringify(map), (key, v) => {
    if (key === 'cardviews' && Array.isArray(v)) return v.filter((c) => !edit.without?.includes(c.name));
    if (v && typeof v === 'object' && 'num_decks' in v && v.name in (edit.decks ?? {})) return { ...v, num_decks: edit.decks![v.name] };
    return v;
  });

/** Opens the Edgar deck (without `removed` cards, which then count as candidates) on the Cards pane, before any search. `edhrec` undefined means EDHREC answers 403. */
async function openEdgar(page: Page, removed: string[] = [], edhrec?: FixtureMap) {
  const misses = await mockScryfall(page, withCosts(edgarFull), edhrec && withCosts(edhrec));
  const deck = await seedEdgarDeck(page);
  await page.goto(`./#/deck/${deck.id}`);
  await expect(page.getByTestId('deck-count')).toHaveText('100 / 100 cards');
  for (const name of removed) await page.getByRole('button', { name: `Remove ${name}` }).click();
  return misses;
}

/**
 * Opens the Edgar deck (without `removed` cards, which then count as candidates), runs Find suggestions, waits for
 * EDHREC's page and the role lookups, and leaves the Cards pane showing.
 */
async function foundEdgar(page: Page, removed: string[] = [], edhrec: FixtureMap = edgarEdhrec) {
  const misses = await openEdgar(page, removed, edhrec);
  await showPane(page, 'Suggestions');
  await page.getByRole('button', { name: 'Find suggestions' }).click();
  await expect(page.getByTestId('edhrec-source')).toBeVisible({ timeout: 15_000 });
  await showPane(page, 'Cards');
  return misses;
}
const edgarDeckJson = JSON.parse(readFileSync(new URL('../fixtures/edgar-deck.json', import.meta.url), 'utf8'));
const nameButton = (page: Page, name: string) => page.locator('table.cards').getByRole('button', { name, exact: true });
const TCGPLAYER = /^https:\/\/www\.tcgplayer\.com\/product\/\d+$/;

test('tapping a card name opens a dialog with the card and similar cards that fit', async ({ page }) => {
  const misses = await foundEdgar(page);
  await nameButton(page, 'Arcane Signet').click();

  const dialog = page.getByRole('dialog', { name: 'Arcane Signet' });
  await expect(dialog).toBeVisible();
  const mine = dialog.getByRole('region', { name: 'Your card' });
  await expect(mine).toContainText("{T}: Add one mana of any color in your commander's color identity.");
  await expect(mine.locator('.mana-cost')).toHaveText('{2}');
  await expect(mine).toContainText(/\$\d+\.\d\d/);
  await expect(mine.getByTestId('tapped-popularity')).toHaveText(/^In \d+% of Edgar Markov decks$/);
  await expect(mine.getByRole('link', { name: 'Buy on TCGplayer' })).toHaveAttribute('href', TCGPLAYER);

  // Other mana rocks, from the deck-mates' page: each with name, price, popularity and text. Sol Ring and Skullclamp are
  // in the deck already, and the rest of the page's artifacts don't read like a mana rock.
  const options = dialog.getByRole('list', { name: 'Similar cards' }).getByRole('listitem');
  await expect(options.first()).toBeVisible();
  const names = await options.locator('.sugg-name').allTextContents();
  expect(names.length).toBeGreaterThanOrEqual(1);
  expect(names.length).toBeLessThanOrEqual(10);
  expect(names).toContain("Commander's Sphere");
  expect(names).not.toContain('Arcane Signet');
  expect(names).not.toContain('Sol Ring');
  expect(names).not.toContain('Skullclamp');
  for (const option of await options.all()) {
    await expect(option.getByRole('link').first()).toHaveAttribute('href', TCGPLAYER);
    await expect(option).toContainText(/\$\d+\.\d\d/);
    await expect(option).toContainText(/In \d+% of Edgar Markov decks/);
    await expect(option.locator('.swap-type')).toContainText('Artifact');
    await expect(option.locator('.swap-text')).not.toBeEmpty();
  }
  await expect(options.filter({ hasText: "Commander's Sphere" }).locator('.mana-cost')).toHaveText('{3}');
  expect(misses).toEqual([]);
});

test('a land gets only lands, 10 at most, with Show more for the rest', async ({ page }) => {
  // Four of the deck's lands go back into the pool, so more than ten dual lands read like Haunted Ridge.
  await foundEdgar(page, ['Shattered Sanctum', 'Smoldering Marsh', 'Sundown Pass', 'Thriving Bluff']);
  await nameButton(page, 'Haunted Ridge').click();
  const dialog = page.getByRole('dialog', { name: 'Haunted Ridge' });
  const options = dialog.getByRole('list', { name: 'Similar cards' }).getByRole('listitem');
  await expect(options).toHaveCount(10);
  await dialog.getByRole('button', { name: 'Show more' }).click();
  expect(await options.count()).toBeGreaterThan(10);
  expect(await options.count()).toBeLessThanOrEqual(20);
  for (const type of await options.locator('.swap-type').allTextContents()) expect(type).toContain('Land');
  // A page of ten at most, so the button goes once everything is shown (or stays for a further page).
  if ((await options.count()) < 20) await expect(dialog.getByRole('button', { name: 'Show more' })).toHaveCount(0);
});

test('a card with no similar cards that fit says so', async ({ page }) => {
  await foundEdgar(page);
  // Roles still load when the dialog opens, so it first says it is still checking; the empty line is the answer once they are in.
  await nameButton(page, 'Master of Dark Rites').click();
  const dialog = page.getByRole('dialog', { name: 'Master of Dark Rites' });
  await expect(dialog.getByTestId('tapped-popularity')).toHaveText(/^In \d+% of Edgar Markov decks$/);
  await expect(dialog).toContainText('No similar cards found for this deck yet.');
  await expect(dialog.getByRole('button', { name: 'Show more' })).toHaveCount(0);
});

test('the commander and basic lands keep their TCGplayer link instead of opening the dialog', async ({ page }) => {
  await foundEdgar(page);
  await expect(page.locator('table.cards').getByRole('link', { name: 'Edgar Markov', exact: true })).toHaveAttribute('href', TCGPLAYER);
  await expect(page.locator('table.cards').getByRole('link', { name: 'Swamp', exact: true })).toHaveAttribute('href', TCGPLAYER);
  await expect(nameButton(page, 'Swamp')).toHaveCount(0);
});

test('Escape closes the dialog', async ({ page }) => {
  await foundEdgar(page);
  await nameButton(page, 'Skullclamp').click();
  await expect(page.getByRole('dialog', { name: 'Skullclamp' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('on a phone the dialog buttons and links are at least 44px tall', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'phones only');
  await foundEdgar(page);
  await nameButton(page, 'Arcane Signet').click();
  const dialog = page.getByRole('dialog', { name: 'Arcane Signet' });
  await expect(dialog.getByRole('listitem').first()).toBeVisible();
  for (const target of [dialog.getByRole('button', { name: 'Close' }), dialog.getByRole('link', { name: 'Buy on TCGplayer' }), dialog.getByRole('listitem').first().getByRole('link').first()]) {
    const box = await target.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
  }
});

// Swap from the dialog: the same swap as the Suggestions tab, so it ends in the same Undo offer. Arcane Signet's options
// are Commander's Sphere, Phyrexian Altar and Orzhov Signet; Orzhov Signet is also an option for Sol Ring.
const swapButton = (dialog: Locator, from: string, to: string) => dialog.getByRole('button', { name: `Swap ${from} for ${to}`, exact: true });
const toast = (page: Page) => page.getByRole('status').filter({ hasText: /^Swapped / });
const rowCount = (page: Page, name: string) => page.locator('table.cards tbody tr').filter({ has: page.getByRole('button', { name, exact: true }) });

test('Swap replaces the tapped card, closes the dialog and offers Undo', async ({ page }) => {
  const misses = await foundEdgar(page);
  const total = await page.getByTestId('deck-total').textContent();
  await nameButton(page, 'Arcane Signet').click();
  const dialog = page.getByRole('dialog', { name: 'Arcane Signet' });
  await swapButton(dialog, 'Arcane Signet', "Commander's Sphere").click();

  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByTestId('deck-count')).toHaveText('100 / 100 cards');
  await expect(rowCount(page, "Commander's Sphere")).toHaveCount(1);
  await expect(rowCount(page, 'Arcane Signet')).toHaveCount(0);
  await expect(page.getByTestId('deck-total')).not.toHaveText(total!);

  // Undo is on the Cards pane itself, so a phone (where the Suggestions pane is hidden) can reach it without switching.
  const offer = toast(page);
  await expect(offer).toContainText("Swapped Arcane Signet → Commander's Sphere.");
  await offer.getByRole('button', { name: 'Undo' }).click();
  await expect(rowCount(page, 'Arcane Signet')).toHaveCount(1);
  await expect(rowCount(page, "Commander's Sphere")).toHaveCount(0);
  await expect(page.getByTestId('deck-count')).toHaveText('100 / 100 cards');
  await expect(page.getByTestId('deck-total')).toHaveText(total!);
  await expect(offer).toHaveCount(0);
  // The panel's own offer is gone too.
  await showPane(page, 'Suggestions');
  await expect(suggestionsPanel(page)).not.toContainText('Swapped ');
  // Pricing the swapped-in card asks for its cheapest printing, which the Edgar recordings hold only for cards in the
  // deck; the app keeps the card it already has, unpriced, when that fails. Nothing else may go unrecorded.
  expect(misses.filter((m) => !m.includes('prefer%3Ausd-low&unique=cards'))).toEqual([]);
});

test("Undo in the Suggestions panel also ends the Cards pane's offer", async ({ page }) => {
  await foundEdgar(page);
  const total = await page.getByTestId('deck-total').textContent();
  await nameButton(page, 'Arcane Signet').click();
  await swapButton(page.getByRole('dialog', { name: 'Arcane Signet' }), 'Arcane Signet', "Commander's Sphere").click();
  await expect(toast(page)).toBeVisible();
  await showPane(page, 'Suggestions');
  const panel = suggestionsPanel(page);
  await expect(panel).toContainText("Swapped Arcane Signet → Commander's Sphere.");
  await panel.getByRole('button', { name: 'Undo' }).click();
  await expect(toast(page)).toHaveCount(0);
  await showPane(page, 'Cards');
  await expect(rowCount(page, 'Arcane Signet')).toHaveCount(1);
  await expect(page.getByTestId('deck-total')).toHaveText(total!);
});

test('a swap from the Suggestions tab leaves the Cards pane without an offer', async ({ page }) => {
  await foundEdgar(page);
  await showPane(page, 'Suggestions');
  const panel = suggestionsPanel(page);
  await panel.getByRole('button', { name: 'Swaps' }).click();
  await panel.getByRole('list', { name: 'Swap pairs' }).getByRole('button', { name: /^Swap .* for / }).first().click();
  await expect(panel).toContainText('Swapped ');
  await expect(toast(page)).toHaveCount(0);
});

test('a card marked Keep still opens the dialog, lists options and swaps', async ({ page }) => {
  await foundEdgar(page);
  await page.getByRole('button', { name: 'Keep Arcane Signet' }).click();
  await expect(page.getByRole('button', { name: 'Keep Arcane Signet' })).toHaveAttribute('aria-pressed', 'true');
  await nameButton(page, 'Arcane Signet').click();
  const dialog = page.getByRole('dialog', { name: 'Arcane Signet' });
  await expect(dialog.getByRole('list', { name: 'Similar cards' }).getByRole('listitem').first()).toBeVisible();
  await swapButton(dialog, 'Arcane Signet', "Commander's Sphere").click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(rowCount(page, "Commander's Sphere")).toHaveCount(1);
  await expect(rowCount(page, 'Arcane Signet')).toHaveCount(0);
});

test('after a swap, another card no longer lists the card that went in', async ({ page }) => {
  await foundEdgar(page);
  await nameButton(page, 'Arcane Signet').click();
  const first = page.getByRole('dialog', { name: 'Arcane Signet' });
  await expect(first.locator('.sugg-name', { hasText: 'Orzhov Signet' })).toBeVisible();
  await page.keyboard.press('Escape');
  await nameButton(page, 'Sol Ring').click();
  const dialog = page.getByRole('dialog', { name: 'Sol Ring' });
  await swapButton(dialog, 'Sol Ring', 'Orzhov Signet').click();
  await expect(rowCount(page, 'Orzhov Signet')).toHaveCount(1);

  await nameButton(page, 'Arcane Signet').click();
  const again = page.getByRole('dialog', { name: 'Arcane Signet' });
  const options = again.getByRole('list', { name: 'Similar cards' }).getByRole('listitem');
  await expect(options.first()).toBeVisible();
  expect(await options.locator('.sugg-name').allTextContents()).not.toContain('Orzhov Signet');
});

test('pressing Swap on two options at once swaps once, and never adds a card twice', async ({ page }) => {
  await foundEdgar(page);
  await nameButton(page, 'Arcane Signet').click();
  const dialog = page.getByRole('dialog', { name: 'Arcane Signet' });
  await expect(swapButton(dialog, 'Arcane Signet', "Commander's Sphere")).toBeVisible();
  // Both clicks land before either swap finishes; the options are Commander's Sphere, then Phyrexian Altar.
  await dialog.evaluate((el) => el.querySelectorAll<HTMLButtonElement>('.swap-option button').forEach((b, i) => i < 2 && b.click()));
  await expect(rowCount(page, "Commander's Sphere")).toHaveCount(1);
  // Let any second swap finish too, so the checks below see the settled deck, not a moment in between.
  await page.waitForTimeout(3000);
  await expect(page.getByTestId('deck-count')).toHaveText('100 / 100 cards');
  await expect(rowCount(page, 'Phyrexian Altar')).toHaveCount(0);
  await expect(rowCount(page, 'Arcane Signet')).toHaveCount(0);
  await expect(rowCount(page, "Commander's Sphere")).toHaveCount(1);
});

// Better fit and the comparison line. Scores are EDHREC's inclusion plus positive synergy: Arcane Signet 0.78, Orzhov
// Signet 0.51, Commander's Sphere 0.28, Phyrexian Altar 0.07. The options for Arcane Signet cost {2}, {1}, {3} and {3}
// (cmc 2, 2, 3 and 3).
const option = (dialog: Locator, name: string) => dialog.getByRole('listitem').filter({ has: dialog.page().getByRole('link', { name, exact: true }) });

test('no option is flagged Better fit when the tapped card is the most played, and the comparison line follows the cost', async ({ page }) => {
  await foundEdgar(page);
  await nameButton(page, 'Arcane Signet').click();
  const dialog = page.getByRole('dialog', { name: 'Arcane Signet' });
  await expect(option(dialog, "Commander's Sphere")).toBeVisible();
  await expect(dialog.getByText('Better fit')).toHaveCount(0);
  await expect(option(dialog, "Commander's Sphere").locator('.swap-diff')).toHaveText('Costs 1 more');
  // Same mana value and nothing else the data states: no line at all, and the option stays in the list.
  await expect(option(dialog, 'Orzhov Signet')).toBeVisible();
  await expect(option(dialog, 'Orzhov Signet').locator('.swap-diff')).toHaveCount(0);
});

test('an option scoring at least 0.1 higher on inclusion plus synergy is flagged Better fit, with a label that says what it means', async ({ page }) => {
  // Commander's Sphere at 97% of decks (score 1.05) against Arcane Signet's 0.78; Orzhov Signet (0.51) scores lower.
  await foundEdgar(page, [], withPage(edgarEdhrec, { decks: { "Commander's Sphere": 3300 } }));
  await nameButton(page, 'Arcane Signet').click();
  const dialog = page.getByRole('dialog', { name: 'Arcane Signet' });
  const sphere = option(dialog, "Commander's Sphere");
  await expect(sphere.getByText('Better fit')).toBeVisible();
  await expect(sphere.locator('.tag')).toHaveAttribute('title', 'Higher inclusion and synergy score than Arcane Signet for this commander');
  await expect(sphere.locator('.tag')).toContainText('Higher inclusion and synergy score than Arcane Signet for this commander');
  await expect(sphere.locator('.swap-diff')).toHaveText('Costs 1 more');
  await expect(option(dialog, 'Orzhov Signet').getByText('Better fit')).toHaveCount(0);
  await expect(dialog.getByText('Better fit')).toHaveCount(1);
  await expect(dialog.getByText("Not on this commander's page")).toHaveCount(0);
});

test("a tapped card the page doesn't list says so, and every option with a score is flagged", async ({ page }) => {
  await foundEdgar(page, [], withPage(edgarEdhrec, { without: ['Arcane Signet'] }));
  await nameButton(page, 'Arcane Signet').click();
  const dialog = page.getByRole('dialog', { name: 'Arcane Signet' });
  await expect(option(dialog, "Commander's Sphere")).toBeVisible();
  await expect(dialog.getByRole('region', { name: 'Your card' })).toContainText("Not on this commander's page");
  await expect(dialog.getByTestId('tapped-popularity')).toHaveCount(0);
  await expect(option(dialog, "Commander's Sphere").getByText('Better fit')).toBeVisible();
  await expect(option(dialog, 'Orzhov Signet').getByText('Better fit')).toBeVisible();
  // Phyrexian Altar's 0.07 is under the margin even against a score of 0.
  await expect(option(dialog, 'Phyrexian Altar').getByText('Better fit')).toHaveCount(0);
});

test('the rules-based fallback never shows Better fit: it has no commander page to rank against', async ({ page }) => {
  // EDHREC answers 403, so the options come from Scryfall's rules pool and carry no commander popularity. Sol Ring goes
  // back into the pool, and the pool's one card that fits Arcane Signet is listed, unflagged.
  await mockScryfall(page, withCosts(edgarFull));
  const deck = await seedEdgarDeck(page);
  await page.goto(`./#/deck/${deck.id}`);
  await expect(page.getByTestId('deck-count')).toHaveText('100 / 100 cards');
  for (const name of ['Sol Ring', 'Skullclamp', 'Blasphemous Act']) await page.getByRole('button', { name: `Remove ${name}` }).click();
  await showPane(page, 'Suggestions');
  await page.getByRole('button', { name: 'Find suggestions' }).click();
  await expect(suggestionsPanel(page).getByRole('list').first()).toBeVisible({ timeout: 15_000 });
  await showPane(page, 'Cards');
  await expect(page.getByTestId('edhrec-source')).toHaveCount(0);
  await nameButton(page, 'Arcane Signet').click();
  const dialog = page.getByRole('dialog', { name: 'Arcane Signet' });
  await expect(dialog.getByRole('listitem').first()).toBeVisible();
  await expect(dialog.getByText('Better fit')).toHaveCount(0);
  await expect(dialog.getByText('Higher inclusion and synergy score')).toHaveCount(0);
});

// Loading, failure and the fallback. Tapping a card before any search starts the panel's own Find; the dialog never loads anything itself.

/** Holds every EDHREC reply until `release()`, and logs the requests, so a test can act while the page is still loading. Register it after mockScryfall. */
async function holdEdhrec(page: Page) {
  const requests: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  await page.route('https://json.edhrec.com/**', async (route) => {
    requests.push(route.request().url());
    await gate;
    await route.fallback();
  });
  return { requests, release };
}
const openDialogs = (page: Page) => page.locator('dialog[open]');

test('tapping a card before Find suggestions starts the same load, shows a loading line, then fills in with no second EDHREC request', async ({ page }) => {
  await openEdgar(page, [], edgarEdhrec);
  const held = await holdEdhrec(page);
  await nameButton(page, 'Arcane Signet').click();
  const dialog = page.getByRole('dialog', { name: 'Arcane Signet' });
  await expect(dialog.getByText('Finding similar cards…')).toBeVisible();
  // It is the panel's own search: its button is busy, and pressing it again (here by script, as the disabled button takes no clicks) starts nothing.
  await expect.poll(() => held.requests.length).toBeGreaterThan(0);
  await page.evaluate(() => document.querySelectorAll<HTMLButtonElement>('aside.suggestions > button').forEach((b) => b.click()));
  held.release();
  await expect(dialog.getByRole('list', { name: 'Similar cards' }).getByRole('listitem').first()).toBeVisible({ timeout: 15_000 });
  await expect(dialog.getByText('Finding similar cards…')).toHaveCount(0);
  await expect(dialog.getByText('Matching is approximate')).toHaveCount(0);
  // The one live region holds only the loading, failed and empty lines: it stays in the tree (empty now) and never wraps the list.
  const live = await dialog.evaluate((el) => {
    const regions = [...el.querySelectorAll<HTMLElement>('[role=status]')].filter((r) => !r.closest('.swap-option'));
    return { count: regions.length, text: regions[0]?.textContent, hidden: regions[0] ? getComputedStyle(regions[0]).display === 'none' : null, wrapsList: !!el.querySelector('[role=status] ul') };
  });
  expect(live).toEqual({ count: 1, text: '', hidden: false, wrapsList: false });
  expect(held.requests.length).toBe(new Set(held.requests).size);
  // Closing and tapping again shows the options at once, and still asks for nothing more.
  const asked = held.requests.length;
  await page.keyboard.press('Escape');
  await nameButton(page, 'Arcane Signet').click();
  await expect(page.getByRole('dialog', { name: 'Arcane Signet' }).getByRole('listitem').first()).toBeVisible();
  expect(held.requests.length).toBe(asked);
});

/**
 * Holds the role searches for EDHREC's cards (Scryfall `otag:` queries over names that are not in the deck) until `release()`, so a test
 * can act while roles are still loading. The deck's own role searches go through: the client keeps at most 4 requests open, so held
 * searches that came first would starve the page's own lookups. Register it after mockScryfall.
 */
async function holdRoles(page: Page) {
  const deck = new Set((edgarDeckJson.cards as Array<{ card: { name: string } }>).map((c) => frontFace(c.card.name)));
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  await page.route('https://api.scryfall.com/**', async (route) => {
    const q = new URL(route.request().url()).searchParams.get('q') ?? '';
    const first = /!"([^"]+)"/.exec(q)?.[1];
    if (q.includes('otag:') && first && !deck.has(first)) await gate;
    await route.fallback();
  });
  return { release };
}
const checking = (dialog: Locator) => dialog.getByText('Still checking what cards do…');

test('while roles load, a card with no options yet says it is still checking, not that nothing fits; the empty line comes only once loading ends', async ({ page }) => {
  await openEdgar(page, [], edgarEdhrec);
  const held = await holdRoles(page);
  await showPane(page, 'Suggestions');
  await page.getByRole('button', { name: 'Find suggestions' }).click();
  await expect(page.getByTestId('edhrec-source')).toBeVisible({ timeout: 15_000 });
  await showPane(page, 'Cards');

  // Skullclamp reads like no other card: only its role (draw) and type tie it to the cards that are options once roles are in.
  await nameButton(page, 'Skullclamp').click();
  const dialog = page.getByRole('dialog', { name: 'Skullclamp' });
  await expect(checking(dialog)).toBeVisible();
  await expect(dialog.getByTestId('tapped-popularity')).toBeVisible();
  await expect(dialog.getByText('No similar cards found for this deck yet.')).toHaveCount(0);
  await expect(dialog.getByRole('listitem')).toHaveCount(0);

  held.release();
  await expect(dialog.getByRole('list', { name: 'Similar cards' }).getByRole('listitem').first()).toBeVisible({ timeout: 20_000 });
  await expect(checking(dialog)).toHaveCount(0);
  await expect(dialog.getByText('No similar cards found for this deck yet.')).toHaveCount(0);

  // A card that has none even with roles in says so, now that nothing is loading.
  await page.keyboard.press('Escape');
  await nameButton(page, 'Master of Dark Rites').click();
  const none = page.getByRole('dialog', { name: 'Master of Dark Rites' });
  await expect(none).toContainText('No similar cards found for this deck yet.');
  await expect(checking(none)).toHaveCount(0);
});

test('a focused Swap button keeps focus when the panel redraws as roles load', async ({ page }) => {
  await openEdgar(page, [], edgarEdhrec);
  const held = await holdRoles(page);
  await showPane(page, 'Suggestions');
  await page.getByRole('button', { name: 'Find suggestions' }).click();
  await expect(page.getByTestId('edhrec-source')).toBeVisible({ timeout: 15_000 });
  await showPane(page, 'Cards');

  await nameButton(page, 'Arcane Signet').click();
  const dialog = page.getByRole('dialog', { name: 'Arcane Signet' });
  const swap = swapButton(dialog, 'Arcane Signet', "Commander's Sphere");
  await swap.focus();
  // Marks this very button, so a redraw that replaces it is told apart from none at all.
  await swap.evaluate((el) => el.setAttribute('data-before-redraw', ''));
  await expect(swap).toBeFocused();

  held.release();
  // The panel redraws when the roles come in, and the list is built again: this is a new button, and it holds focus.
  await expect(swap).not.toHaveAttribute('data-before-redraw', '', { timeout: 20_000 });
  await expect(swap).toBeFocused();
  await expect(dialog.getByRole('button', { name: /^Swap / }).filter({ hasText: 'Swap' }).first()).toBeVisible();
});

test('with no EDHREC page, the options come from the rules pool with a note that matching is approximate', async ({ page }) => {
  await openEdgar(page, ['Sol Ring', 'Skullclamp', 'Blasphemous Act']);
  await nameButton(page, 'Arcane Signet').click();
  const dialog = page.getByRole('dialog', { name: 'Arcane Signet' });
  await expect(dialog.getByRole('listitem').first()).toBeVisible({ timeout: 30_000 });
  await expect(dialog.getByText('Matching is approximate')).toBeVisible();
  await expect(dialog.getByText('Better fit')).toHaveCount(0);
});

test('with no EDHREC page and nothing in the rules pool for the card, the dialog says so', async ({ page }) => {
  await openEdgar(page);
  // Cathars' Crusade has no role tag, and the fallback pool's cards carry no rules text in the recording, so nothing reads like it.
  // (Blasphemous Act lists the other board wipes since a shared role and the same type are enough.)
  await nameButton(page, "Cathars' Crusade").click();
  const dialog = page.getByRole('dialog', { name: "Cathars' Crusade" });
  await expect(dialog.getByText('No similar cards found for this deck yet.')).toBeVisible({ timeout: 30_000 });
  await expect(dialog.getByRole('listitem')).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Show more' })).toHaveCount(0);
});

test('a card tapped while the first card is still loading shows only its own options, and a reply for a closed dialog opens nothing', async ({ page }) => {
  await openEdgar(page, [], edgarEdhrec);
  const held = await holdEdhrec(page);
  await nameButton(page, 'Arcane Signet').click();
  await expect(page.getByRole('dialog', { name: 'Arcane Signet' }).getByText('Finding similar cards…')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(openDialogs(page)).toHaveCount(0);
  await nameButton(page, 'Sol Ring').click();
  const dialog = page.getByRole('dialog', { name: 'Sol Ring' });
  await expect(dialog.getByText('Finding similar cards…')).toBeVisible();
  held.release();
  await expect(dialog.getByRole('listitem').first()).toBeVisible({ timeout: 15_000 });
  await expect(openDialogs(page)).toHaveCount(1);
  await expect(dialog.getByRole('button', { name: /^Swap Sol Ring for / }).first()).toBeVisible();
  await expect(dialog.getByRole('button', { name: /^Swap Arcane Signet for / })).toHaveCount(0);
  await expect(dialog.getByRole('region', { name: 'Your card' })).toBeVisible();
});

test('a reply that lands after the dialog was closed opens nothing', async ({ page }) => {
  await openEdgar(page, [], edgarEdhrec);
  const held = await holdEdhrec(page);
  await nameButton(page, 'Arcane Signet').click();
  await expect(page.getByRole('dialog', { name: 'Arcane Signet' }).getByText('Finding similar cards…')).toBeVisible();
  await page.keyboard.press('Escape');
  held.release();
  await showPane(page, 'Suggestions');
  await expect(page.getByTestId('edhrec-source')).toBeVisible({ timeout: 15_000 });
  await expect(openDialogs(page)).toHaveCount(0);
});

test('a load that fails shows Try again, leaves the dialog usable, and Try again runs the panel\'s search again', async ({ page }) => {
  // EDHREC answers 403 and every rules search answers 500, which the client does not retry (it retries only 429s and dropped
  // connections), so the failure is quick. A fake clock skips the client's 500 ms spacing between searches.
  await openEdgar(page);
  let searches = 0;
  await page.route(/api\.scryfall\.com\/cards\/search\?q=f%3Acommander[^&]*prefer%3Ausd-low/, (route) => {
    searches += 1;
    return route.fulfill({ status: 500, json: { object: 'error', details: 'down' } });
  });
  await page.clock.install();
  const dialog = page.getByRole('dialog', { name: 'Arcane Signet' });
  const retry = dialog.getByRole('button', { name: 'Try again' });
  const untilFailed = () => expect.poll(async () => (await page.clock.runFor(1000), await retry.count()), { timeout: 10_000 }).toBe(1);

  await nameButton(page, 'Arcane Signet').click();
  await expect(dialog.getByText('Finding similar cards…')).toBeVisible();
  await untilFailed();
  await expect(dialog.getByText("Couldn't load the cards to compare with")).toBeVisible();
  await expect(dialog.getByRole('region', { name: 'Your card' })).toContainText("{T}: Add one mana of any color in your commander's color identity.");
  const firstRound = searches;
  expect(firstRound).toBeGreaterThan(0);

  // Still a working dialog: Escape closes it, and the next tap shows the same failure.
  await page.keyboard.press('Escape');
  await expect(openDialogs(page)).toHaveCount(0);
  await nameButton(page, 'Arcane Signet').click();
  await expect(retry).toBeVisible();
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(openDialogs(page)).toHaveCount(0);

  // Try again is the panel's own Find: the loading line returns, the searches run again, and the button follows the new outcome.
  await nameButton(page, 'Arcane Signet').click();
  await retry.click();
  await expect(dialog.getByText('Finding similar cards…')).toBeVisible();
  await untilFailed();
  expect(searches).toBeGreaterThan(firstRound);
});

test('a tapped card the panel has no data for says so, with no Try again, and starts no new search', async ({ page }) => {
  // No path in the app leaves the dialog open on such a card: every deck change closes it first. So this holds the dialog
  // open through a deck change (close() does nothing), which is the one way its card can go missing under it.
  const misses = await foundEdgar(page);
  await page.evaluate(() => {
    (window as unknown as { keepOpen: boolean }).keepOpen = true;
    const close = HTMLDialogElement.prototype.close;
    HTMLDialogElement.prototype.close = function (this: HTMLDialogElement, ...args) {
      if (!(window as unknown as { keepOpen: boolean }).keepOpen) close.apply(this, args);
    };
  });
  let requests = 0;
  // What a new Find would ask for first (the role lookups from the Find that already ran may still be finishing).
  await page.route(/json\.edhrec\.com|api\.scryfall\.com\/cards\/search\?q=(is%3Agamechanger|f%3Acommander)/, (route) => ((requests += 1), route.fallback()));
  await nameButton(page, 'Arcane Signet').click();
  const dialog = page.getByRole('dialog', { name: 'Arcane Signet' });
  await expect(dialog.getByRole('listitem').first()).toBeVisible();
  // The dialog is modal, so a person cannot press Remove behind it; the script does.
  await page.evaluate(() => document.querySelector<HTMLButtonElement>('[aria-label="Remove Arcane Signet"]')!.click());

  await expect(dialog.getByText('No card details to compare for this card.')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Try again' })).toHaveCount(0);
  await expect(dialog.getByRole('listitem')).toHaveCount(0);
  // Nothing was searched and the Suggestions tab keeps what it had loaded.
  await page.waitForTimeout(1500);
  expect(requests).toBe(0);
  await expect(page.getByTestId('edhrec-source')).toBeAttached();
  // (By CSS: on a phone the Suggestions pane is hidden, and role queries skip hidden elements.)
  await expect(page.locator('aside.suggestions > button.primary')).toHaveText('Refresh suggestions');
  expect(misses).toEqual([]);
});
