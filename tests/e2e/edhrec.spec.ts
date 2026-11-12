import { expect, test } from '@playwright/test';
import { edgarEdhrec, edgarFull, mockScryfall, row, seedEdgarDeck, showPane } from './helpers';

// The full Edgar Markov deck, with EDHREC's Edgar pages and their Scryfall lookups recorded 2026-11-03
// (tests/fixtures/edhrec-edgar.json). Prices are that recording's. The deck runs no Game Changers, so
// it starts at bracket 2 (Core: 3,409 decks in that recording).

test('upgrades come from what Edgar Markov decks play, grouped by category, including off-tribe artifacts and enchantments', async ({ page }) => {
  const misses = await mockScryfall(page, edgarFull, edgarEdhrec);
  const deck = await seedEdgarDeck(page);
  await page.goto(`./#/deck/${deck.id}`);
  await showPane(page, 'Suggestions'); // below 70rem the panel is its own pane
  await page.getByRole('button', { name: 'Find suggestions' }).click();

  const panel = page.getByRole('complementary', { name: 'Suggestions' });
  const source = panel.getByTestId('edhrec-source');
  await expect(source).toContainText(/From [\d,]+ Edgar Markov decks on EDHREC/);
  await expect(source.getByRole('link')).toHaveAttribute('href', 'https://edhrec.com/commanders/edgar-markov/core');

  const groups = await panel.getByRole('region').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
  expect(groups.slice(0, 3)).toEqual(['Creatures', 'Instants', 'Sorceries']);
  expect(groups).toEqual(expect.arrayContaining(['Utility Artifacts', 'Enchantments', 'Lands']));

  const artifacts = panel.getByRole('list', { name: 'Utility Artifacts upgrades' });
  await expect(artifacts.getByRole('listitem')).toHaveCount(5);
  await expect(artifacts).toContainText("Herald's Horn");
  await expect(artifacts.getByRole('listitem').filter({ hasText: "Herald's Horn" })).toContainText(/In \d+% of Edgar Markov decks · \+\d+% synergy/);
  await expect(artifacts.getByRole('link', { name: "Herald's Horn" })).toHaveAttribute('href', /^https:\/\/www\.tcgplayer\.com\/product\/\d+$/);
  await expect(panel.getByRole('list', { name: 'Enchantments upgrades' })).toContainText('Exquisite Blood');
  // The deck already runs Skullclamp, EDHREC's top utility artifact for Edgar.
  await expect(panel.getByRole('button', { name: 'Add Skullclamp' })).toHaveCount(0);

  // Show more adds five at a time.
  await panel.getByRole('button', { name: 'Show more Utility Artifacts' }).click();
  await expect(artifacts.getByRole('listitem')).toHaveCount(10);

  // Nothing suggested is already in the deck, and no basic lands.
  const names = await panel.locator('.sugg-name').allTextContents();
  expect(names).not.toContain('Swamp');
  for (const name of names) {
    await expect(row(page, name)).toHaveCount(0);
  }
  expect(misses).toEqual([]);
});

test('adding an EDHREC suggestion puts it in the deck and takes it off the list', async ({ page }) => {
  const misses = await mockScryfall(page, edgarFull, edgarEdhrec);
  const deck = await seedEdgarDeck(page);
  await page.goto(`./#/deck/${deck.id}`);
  await showPane(page, 'Suggestions'); // below 70rem the panel is its own pane
  await page.getByRole('button', { name: 'Find suggestions' }).click();

  await page.getByRole('button', { name: "Add Herald's Horn" }).click();
  await expect(page.getByTestId('deck-count')).toHaveText('101 / 100 cards');
  await showPane(page, 'Cards');
  await expect(page.getByRole('row').filter({ hasText: "Herald's Horn" })).toBeVisible();
  await showPane(page, 'Suggestions');
  await expect(page.getByRole('button', { name: "Add Herald's Horn" })).toHaveCount(0);
  // The list refills from the rest of the page without new requests.
  await expect(page.getByRole('list', { name: 'Utility Artifacts upgrades' }).getByRole('listitem')).toHaveCount(5);
  expect(misses).toEqual([]);
});

test('when EDHREC has no page for the commander, upgrades fall back to card rules and say so', async ({ page }) => {
  const misses = await mockScryfall(page, edgarFull);
  const deck = await seedEdgarDeck(page);
  await page.goto(`./#/deck/${deck.id}`);
  await showPane(page, 'Suggestions'); // below 70rem the panel is its own pane
  await page.getByRole('button', { name: 'Find suggestions' }).click();

  const panel = page.getByRole('complementary', { name: 'Suggestions' });
  await expect(panel).toContainText('EDHREC has no decks for Edgar Markov, so these come from card rules, not real decks.');
  await expect(panel.getByRole('list', { name: 'Creatures upgrades' }).getByRole('listitem').first()).toContainText('Woe Strider');
  expect(misses).toEqual([]);
});

test("when EDHREC doesn't answer, upgrades fall back to card rules and say so", async ({ page }) => {
  await mockScryfall(page, edgarFull, edgarEdhrec);
  await page.route('https://json.edhrec.com/**', (route) => route.abort());
  const deck = await seedEdgarDeck(page);
  await page.goto(`./#/deck/${deck.id}`);
  await showPane(page, 'Suggestions'); // below 70rem the panel is its own pane
  await page.getByRole('button', { name: 'Find suggestions' }).click();

  const panel = page.getByRole('complementary', { name: 'Suggestions' });
  await expect(panel).toContainText("EDHREC didn't answer, so these come from card rules", { timeout: 30_000 });
  await expect(panel.getByRole('list', { name: 'Creatures upgrades' }).getByRole('listitem').first()).toContainText('Woe Strider');
});

async function findSuggestions(page: import('@playwright/test').Page, timeout = 15_000) {
  const deck = await seedEdgarDeck(page);
  await page.goto(`./#/deck/${deck.id}`);
  await showPane(page, 'Suggestions'); // below 70rem the panel is its own pane
  await page.getByRole('button', { name: 'Find suggestions' }).click();
  const panel = page.getByRole('complementary', { name: 'Suggestions' });
  await expect(panel.getByTestId('edhrec-source')).toBeVisible({ timeout });
  return panel;
}
const sourceLink = (panel: import('@playwright/test').Locator) => panel.getByTestId('edhrec-source').getByRole('link');
const EDGAR = 'https://edhrec.com/commanders/edgar-markov';

test("starts at a bracket estimated from the deck's Game Changers", async ({ page }) => {
  const misses = await mockScryfall(page, edgarFull, edgarEdhrec);
  const panel = await findSuggestions(page);
  await expect(panel.getByLabel('Bracket')).toHaveValue('2');
  await expect(panel.getByTestId('bracket-estimate')).toContainText('Bracket estimated from your deck’s Game Changers (0).');
  await expect(sourceLink(panel)).toHaveText('3,409 Edgar Markov decks on EDHREC');
  await expect(sourceLink(panel)).toHaveAttribute('href', `${EDGAR}/core`);
  // Counts beside each bracket come from EDHREC.
  await expect(panel.getByLabel('Bracket').locator('option', { hasText: '2 Core' })).toHaveText('2 Core (3,409)');
  expect(misses).toEqual([]);
});

test('picking a theme reloads the list from decks with that theme', async ({ page }) => {
  const misses = await mockScryfall(page, edgarFull, edgarEdhrec);
  const panel = await findSuggestions(page);
  await panel.getByLabel('Theme').selectOption('vampires');
  await expect(sourceLink(panel)).toHaveAttribute('href', `${EDGAR}/core/vampires`);
  await expect(sourceLink(panel)).toHaveText('83 Edgar Markov decks on EDHREC');
  await expect(panel.getByLabel('Theme')).toHaveValue('vampires');
  expect(misses).toEqual([]);
});

test('a bracket with too few decks shows all brackets and says so', async ({ page }) => {
  const misses = await mockScryfall(page, edgarFull, edgarEdhrec);
  const panel = await findSuggestions(page);
  await panel.getByLabel('Theme').selectOption('vampires');
  await expect(sourceLink(panel)).toHaveAttribute('href', `${EDGAR}/core/vampires`);
  await panel.getByLabel('Bracket').selectOption('1');
  await expect(panel).toContainText('Only 8 Edgar Markov decks are at bracket 1 Exhibition with this theme, so this shows all brackets.');
  await expect(sourceLink(panel)).toHaveAttribute('href', `${EDGAR}/vampires`);
  await expect(panel.getByLabel('Bracket')).toHaveValue('0');
  expect(misses).toEqual([]);
});

test('a bracket pick is saved with the deck and used next time', async ({ page }) => {
  const misses = await mockScryfall(page, edgarFull, edgarEdhrec);
  const panel = await findSuggestions(page);
  await panel.getByLabel('Bracket').selectOption('0');
  await expect(sourceLink(panel)).toHaveAttribute('href', EDGAR);
  await expect(panel.getByTestId('bracket-estimate')).toHaveCount(0);

  await page.reload();
  await showPane(page, 'Suggestions'); // below 70rem the panel is its own pane
  await page.getByRole('button', { name: 'Find suggestions' }).click();
  await expect(sourceLink(panel)).toHaveAttribute('href', EDGAR);
  await expect(panel.getByLabel('Bracket')).toHaveValue('0');
  await expect(panel.getByTestId('bracket-estimate')).toHaveCount(0);
  expect(misses).toEqual([]);
});

test("the price filter narrows the list, and Budget reads EDHREC's budget decks", async ({ page }) => {
  const misses = await mockScryfall(page, edgarFull, edgarEdhrec);
  const panel = await findSuggestions(page);
  const prices = async () => (await panel.locator('.sugg-price').allTextContents()).map((p) => Number(p.replace(/[$,]/g, '')));

  await panel.getByRole('group', { name: 'Price' }).getByRole('button', { name: 'Budget' }).click();
  await expect(sourceLink(panel)).toHaveAttribute('href', `${EDGAR}/core/budget`);
  await expect(panel.getByTestId('edhrec-source')).toContainText('cards under $3');
  const budget = await prices();
  expect(budget.length).toBeGreaterThan(5);
  expect(budget.every((p) => p < 3)).toBe(true);

  await panel.getByRole('group', { name: 'Price' }).getByRole('button', { name: 'Premium' }).click();
  await expect(sourceLink(panel)).toHaveAttribute('href', `${EDGAR}/core`);
  await expect(panel.getByTestId('edhrec-source')).toContainText('cards over $15');
  const premium = await prices();
  expect(premium.length).toBeGreaterThan(0);
  expect(premium.every((p) => p > 15)).toBe(true);
  expect(misses).toEqual([]);
});

test('if a filter page fails, the previous list stays and a note says so', async ({ page }) => {
  await mockScryfall(page, edgarFull, edgarEdhrec);
  // From All decks, so there is no broader page to fall back to (a bracket page that fails falls back to all brackets).
  await page.route('https://json.edhrec.com/pages/commanders/edgar-markov/vampires.json', (route) => route.abort());
  const panel = await findSuggestions(page);
  await panel.getByLabel('Bracket').selectOption('0');
  await expect(sourceLink(panel)).toHaveAttribute('href', EDGAR);
  await panel.getByLabel('Theme').selectOption('vampires');
  await expect(panel).toContainText("EDHREC didn't answer for that choice, so this is still the previous list.", { timeout: 30_000 });
  await expect(sourceLink(panel)).toHaveAttribute('href', EDGAR);
  await expect(panel.getByLabel('Theme')).toHaveValue('');
  await expect(panel.getByRole('list', { name: 'Creatures upgrades' }).getByRole('listitem')).toHaveCount(5);
});

test('if a filter has no EDHREC page, the previous list stays and a note says so', async ({ page }) => {
  await mockScryfall(page, edgarFull, edgarEdhrec);
  // EDHREC answers 403 for a page it doesn't have.
  await page.route('https://json.edhrec.com/pages/commanders/edgar-markov/vampires.json', (route) => route.fulfill({ status: 403, contentType: 'text/html', body: '<html>Forbidden</html>' }));
  const panel = await findSuggestions(page);
  await panel.getByLabel('Bracket').selectOption('0');
  await expect(sourceLink(panel)).toHaveAttribute('href', EDGAR);
  await panel.getByLabel('Theme').selectOption('vampires');
  await expect(panel).toContainText('EDHREC has no decks for that choice, so this is still the previous list.');
  await expect(sourceLink(panel)).toHaveAttribute('href', EDGAR);
  await expect(panel.getByLabel('Theme')).toHaveValue('');
});

test('a chosen bracket with no page falls back to all brackets instead of losing EDHREC', async ({ page }) => {
  const misses = await mockScryfall(page, edgarFull, edgarEdhrec);
  await page.route('https://json.edhrec.com/pages/commanders/edgar-markov/core/vampires.json', (route) => route.fulfill({ status: 403, contentType: 'text/html', body: '<html>Forbidden</html>' }));
  const panel = await findSuggestions(page);
  await panel.getByLabel('Theme').selectOption('vampires');
  await expect(panel).toContainText('No Edgar Markov decks are at bracket 2 Core with this theme, so this shows all brackets.');
  await expect(sourceLink(panel)).toHaveAttribute('href', `${EDGAR}/vampires`);
  expect(misses).toEqual([]);
});

test('when two filter changes overlap, only the newest page is shown', async ({ page }) => {
  const misses = await mockScryfall(page, edgarFull, edgarEdhrec);
  const panel = await findSuggestions(page);
  // EDHREC pages load one at a time, but Scryfall lookups run side by side: hold back the lookups
  // the first change (Core Vampires) starts until the second change (All decks Vampires) has shown.
  let holding = true;
  let held = 0;
  let released = 0;
  await page.route(/api\.scryfall\.com\/cards\/search\?q=f%3Acommander[^&]*prefer%3Ausd-low/, async (route) => {
    if (!holding) return route.fallback();
    held++;
    await new Promise((r) => setTimeout(r, 6000));
    await route.fallback();
    released++;
  });
  await panel.getByLabel('Theme').selectOption('vampires');
  await expect.poll(() => held, { timeout: 15_000 }).toBeGreaterThan(0);
  holding = false;
  await panel.getByLabel('Bracket').selectOption('0');
  await expect(sourceLink(panel)).toHaveAttribute('href', `${EDGAR}/vampires`);
  // Let the held lookups answer and settle before checking they didn't replace the newer page.
  await expect.poll(() => released, { timeout: 20_000 }).toBe(held);
  await page.waitForTimeout(1500);
  await expect(sourceLink(panel)).toHaveAttribute('href', `${EDGAR}/vampires`);
  await expect(sourceLink(panel)).toHaveText('5,325 Edgar Markov decks on EDHREC');
  expect(misses).toEqual([]);
});

test('if the Game Changer search fails, suggestions start from all decks', async ({ page }) => {
  await mockScryfall(page, edgarFull, edgarEdhrec);
  await page.route(/api\.scryfall\.com\/cards\/search\?q=is%3Agamechanger/, (route) => route.abort());
  // The client retries the failed search with backoff before giving up.
  const panel = await findSuggestions(page, 45_000);
  await expect(sourceLink(panel)).toHaveAttribute('href', EDGAR);
  await expect(panel.getByLabel('Bracket')).toHaveValue('0');
  await expect(panel.getByTestId('bracket-estimate')).toHaveCount(0);
});

test('types the deck is short of are named, and their categories come first', async ({ page }) => {
  const misses = await mockScryfall(page, edgarFull, edgarEdhrec);
  const panel = await findSuggestions(page);
  const regionOrder = () => panel.getByRole('region').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));

  // The deck runs 30 creatures; the average Core Edgar deck runs 35. Its 8 artifacts match the average.
  const gaps = panel.getByTestId('gaps');
  await expect(gaps.getByRole('listitem')).toHaveText(['Creatures: you run 30, typical is 35']);
  expect((await regionOrder())[0]).toBe('Creatures');

  // Three artifacts fewer is a gap; the lists recompute without new requests.
  await showPane(page, 'Cards');
  for (const name of ['Sol Ring', 'Arcane Signet', 'Talisman of Hierarchy']) await page.getByRole('button', { name: `Remove ${name}` }).click();
  await showPane(page, 'Suggestions');
  await expect(gaps.getByRole('listitem')).toHaveText(['Creatures: you run 30, typical is 35', 'Artifacts: you run 5, typical is 8']);
  expect((await regionOrder()).slice(0, 3)).toEqual(['Creatures', 'Utility Artifacts', 'Mana Artifacts']);
  expect(misses).toEqual([]);
});

test("no gap lines when EDHREC's page has no average deck", async ({ page }) => {
  // The recorded Core page without its average deck (panels.piechart).
  const key = 'GET https://json.edhrec.com/pages/commanders/edgar-markov/core.json';
  const core = structuredClone(edgarEdhrec[key]) as { status: number; body: { panels: Record<string, unknown> } };
  delete core.body.panels.piechart;
  const misses = await mockScryfall(page, edgarFull, { ...edgarEdhrec, [key]: core });
  const panel = await findSuggestions(page);
  await expect(panel.getByRole('list', { name: 'Creatures upgrades' })).toBeVisible();
  await expect(panel.getByTestId('gaps')).toHaveCount(0);
  expect(misses).toEqual([]);
});

test("swaps cut the card Edgar Markov decks play least for one they play more, and undo puts it back", async ({ page }) => {
  const misses = await mockScryfall(page, edgarFull, edgarEdhrec);
  const searches: string[] = [];
  page.on('request', (r) => r.url().startsWith('https://api.scryfall.com/cards/search') && searches.push(decodeURIComponent(new URL(r.url()).searchParams.get('q') ?? '')));
  const panel = await findSuggestions(page);
  await panel.getByRole('button', { name: 'Swaps' }).click();
  // Pairs settle once the deck's and the suggested cards' roles have loaded.
  await expect(panel.getByText(/^Checking what/)).toHaveCount(0, { timeout: 30_000 });
  await expect(panel).toContainText('Each pick replaces the card Edgar Markov decks play least');

  const first = panel.getByRole('list', { name: 'Swap pairs' }).getByRole('listitem').first();
  await expect(first).toContainText('Cut Kalastria Highborn');
  await expect(first).toContainText('Add Blood Artist');
  await expect(first).toContainText(/In \d+% of Edgar Markov decks/);
  await first.getByRole('button', { name: 'Swap Kalastria Highborn for Blood Artist' }).click();

  await expect(page.getByTestId('deck-count')).toHaveText('100 / 100 cards');
  await showPane(page, 'Cards');
  await expect(page.getByRole('row').filter({ hasText: 'Blood Artist' })).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: 'Kalastria Highborn' })).toHaveCount(0);
  await showPane(page, 'Suggestions');
  await expect(panel.getByRole('list', { name: 'Swap pairs' }).getByRole('listitem').first()).not.toContainText('Blood Artist');

  await panel.getByRole('button', { name: 'Undo' }).click();
  await showPane(page, 'Cards');
  await expect(page.getByRole('row').filter({ hasText: 'Kalastria Highborn' })).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: 'Blood Artist' })).toHaveCount(0);
  await expect(page.getByTestId('deck-total')).toHaveText('$120.90');
  // EDHREC answered, so v1's rules-based searches (tribe, themes, roles) never ran.
  expect(searches.filter((q) => /prefer:usd-low (t:|o:|otag:|\(keyword)/.test(q))).toEqual([]);
  expect(misses).toEqual([]);
});

test('cheaper replacements come from what Edgar Markov decks play', async ({ page }) => {
  const misses = await mockScryfall(page, edgarFull, edgarEdhrec);
  const panel = await findSuggestions(page);
  await panel.getByRole('button', { name: 'Cheaper' }).click();
  await expect(panel.getByText(/^Checking what/)).toHaveCount(0, { timeout: 30_000 });

  const group = panel.getByRole('region', { name: 'Cheaper than Emeritus of Woe // Demonic Tutor' });
  const option = group.getByRole('listitem').first();
  await expect(option).toContainText('Preacher of the Schism');
  await expect(option).toContainText(/Save \$\d+\.\d\d/);
  await expect(option).toContainText(/In \d+% of Edgar Markov decks/);
  await option.getByRole('button', { name: /^Swap Emeritus of Woe/ }).click();
  await showPane(page, 'Cards');
  await expect(page.getByRole('row').filter({ hasText: 'Preacher of the Schism' })).toBeVisible();
  await expect(page.getByTestId('deck-count')).toHaveText('100 / 100 cards');
  expect(misses).toEqual([]);
});

test('if the role lookups fail, swaps match cards by type and say matching is approximate', async ({ page }) => {
  await mockScryfall(page, edgarFull, edgarEdhrec);
  // Role lookups are otag searches over exact names (`!"Name"`): the deck's and the suggested cards'.
  await page.route(/api\.scryfall\.com\/cards\/search\?q=otag%3A[^&]*%21%22/, (route) => route.abort());
  const panel = await findSuggestions(page);
  await panel.getByRole('button', { name: 'Swaps' }).click();
  await expect(panel).toContainText("Couldn't check what every card in your deck does", { timeout: 45_000 });
  const pairs = panel.getByRole('list', { name: 'Swap pairs' }).getByRole('listitem');
  await expect(pairs.first()).toBeVisible();
  for (const text of await pairs.allTextContents()) expect(text).toMatch(/Both (creatures|instants|sorceries|artifacts|enchantments|planeswalkers|lands|battles)\./);
});

test("when EDHREC has nothing and Scryfall's searches all fail, a message says so", async ({ page }) => {
  // The client retries each failed search with backoff before giving up.
  test.setTimeout(150_000);
  await mockScryfall(page, edgarFull);
  await page.route(/api\.scryfall\.com\/cards\/search\?q=f%3Acommander[^&]*prefer%3Ausd-low/, (route) => route.abort());
  const deck = await seedEdgarDeck(page);
  await page.goto(`./#/deck/${deck.id}`);
  await showPane(page, 'Suggestions'); // below 70rem the panel is its own pane
  await page.getByRole('button', { name: 'Find suggestions' }).click();
  const panel = page.getByRole('complementary', { name: 'Suggestions' });
  await expect(panel).toContainText('EDHREC has no decks for Edgar Markov, so these come from card rules, not real decks.');
  await expect(panel).toContainText("Couldn't reach Scryfall. Check your connection and try again.", { timeout: 120_000 });
  await expect(page.getByRole('button', { name: 'Refresh suggestions' })).toBeEnabled();
});
