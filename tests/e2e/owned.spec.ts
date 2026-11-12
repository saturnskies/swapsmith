import { expect, test } from '@playwright/test';
import { edgarFull, mockScryfall, pasteAndFix, seedTwoEdgarDecks, showPane, suggestionsPanel } from './helpers';

// Deck from tests/fixtures/e2e-list.txt: total $39.54, of which 8 Swamps ($0.72) are owned by default.

test('basic lands count as owned, and ticking cards lowers what is still to buy', async ({ page }) => {
  const misses = await mockScryfall(page);
  await pasteAndFix(page);
  await expect(page.getByTestId('deck-total')).toHaveText('$39.54');
  await expect(page.getByTestId('deck-to-buy')).toHaveText('$38.82');
  await expect(page.getByRole('checkbox', { name: 'Own Swamp' })).toBeChecked();

  await page.getByRole('checkbox', { name: 'Own Edgar Markov' }).check();
  await expect(page.getByTestId('deck-to-buy')).toHaveText('$6.65');

  await page.getByRole('checkbox', { name: 'Own Swamp' }).uncheck();
  await expect(page.getByTestId('deck-to-buy')).toHaveText('$7.37');
  await expect(page.getByTestId('deck-total')).toHaveText('$39.54');
  expect(misses).toEqual([]);
});

test('owned cards are remembered across reloads, and belong to one deck only', async ({ page }) => {
  await mockScryfall(page);
  await pasteAndFix(page, 'First');
  await page.getByRole('checkbox', { name: 'Own Sol Ring' }).check();
  await expect(page.getByTestId('deck-to-buy')).toHaveText('$37.54');

  await page.reload();
  await expect(page.getByRole('checkbox', { name: 'Own Sol Ring' })).toBeChecked();

  // A physical card is in one deck at a time: owning Sol Ring for First says nothing about Second.
  await pasteAndFix(page, 'Second');
  await expect(page.getByRole('checkbox', { name: 'Own Sol Ring' })).not.toBeChecked();
  await expect(page.getByTestId('deck-to-buy')).toHaveText('$38.82');

  await page.getByRole('link', { name: 'Swapsmith' }).click();
  await expect(page.getByRole('listitem').filter({ hasText: 'First' })).toContainText('$37.54 to buy');
  await expect(page.getByRole('listitem').filter({ hasText: 'Second' })).toContainText('$38.82 to buy');
});

// Minas Tirith ($5.53) has cheaper replacements unless it is owned.
const MINAS = '7b0d7e62-0287-454a-8702-b0bfa7b41245';

test('ticking a card in one deck leaves it unticked in another deck that has it', async ({ page }) => {
  await mockScryfall(page, edgarFull);
  await seedTwoEdgarDecks(page, (a, b) => ({ version: 2, decks: [a, b], prefs: { view: 'list' } }));

  await page.goto('./#/deck/deck-a');
  await expect(page.getByTestId('deck-total')).toHaveText(/\$/);
  const beforeA = await page.getByTestId('deck-to-buy').textContent();
  await page.getByRole('checkbox', { name: 'Own Minas Tirith' }).check();
  await expect(page.getByTestId('deck-to-buy')).not.toHaveText(beforeA!);

  await page.goto('./#/deck/deck-b');
  await expect(page.getByTestId('deck-total')).toHaveText(/\$/);
  await expect(page.getByRole('checkbox', { name: 'Own Minas Tirith' })).not.toBeChecked();
  await expect(page.getByTestId('deck-to-buy')).toHaveText(beforeA!); // Deck B is untouched by what Deck A owns
});

test("suggestions in a deck ignore what you own in another deck", async ({ page }) => {
  await mockScryfall(page, edgarFull);
  // Minas Tirith is owned for Deck A only.
  await seedTwoEdgarDecks(page, (a, b) => ({ version: 2, decks: [{ ...a, owned: [MINAS], unownedBasics: [] }, b], prefs: { view: 'list' } }));

  await page.goto('./#/deck/deck-b');
  await expect(page.getByTestId('deck-total')).toHaveText(/\$/);
  await showPane(page, 'Suggestions');
  await page.getByRole('button', { name: 'Find suggestions' }).click();
  const panel = suggestionsPanel(page);
  await panel.getByRole('button', { name: 'Cheaper' }).click();
  await expect(panel.getByRole('region', { name: 'Cheaper than Minas Tirith' })).toBeVisible();

  // The same card IS owned in Deck A, so there it has no cheaper replacements: ownership is read per deck, in both directions.
  await page.goto('./#/deck/deck-a');
  await expect(page.getByTestId('deck-total')).toHaveText(/\$/);
  await showPane(page, 'Suggestions');
  await page.getByRole('button', { name: 'Find suggestions' }).click();
  const panelA = suggestionsPanel(page);
  await panelA.getByRole('button', { name: 'Cheaper' }).click();
  await expect(panelA).toContainText('Cheaper cards that do the same job'); // the Cheaper view has drawn
  await expect(panelA.getByRole('region', { name: 'Cheaper than Minas Tirith' })).toHaveCount(0);
});

test('data saved before ownership moved into each deck opens with every deck looking the same', async ({ page }) => {
  await mockScryfall(page, edgarFull);
  // The old shape: one owned list for the whole app.
  await seedTwoEdgarDecks(page, (a, b) => ({ version: 1, decks: [a, b], owned: [MINAS], unownedBasics: [], prefs: { view: 'list' } }));

  await page.goto('./#/deck/deck-a');
  await expect(page.getByRole('checkbox', { name: 'Own Minas Tirith' })).toBeChecked();
  await page.goto('./#/deck/deck-b');
  await expect(page.getByRole('checkbox', { name: 'Own Minas Tirith' })).toBeChecked();

  // From now on they are separate: unticking in B leaves A alone, and nothing shared is saved any more.
  await page.getByRole('checkbox', { name: 'Own Minas Tirith' }).uncheck();
  await page.goto('./#/deck/deck-a');
  await expect(page.getByRole('checkbox', { name: 'Own Minas Tirith' })).toBeChecked();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('swapsmith:v1')!));
  expect(saved.version).toBe(2);
  expect(saved).not.toHaveProperty('owned');
  expect(saved.decks.find((d: { id: string }) => d.id === 'deck-b').owned).toEqual([]);
});

test('pick a different printing, then go back to the cheapest', async ({ page }) => {
  const misses = await mockScryfall(page);
  await pasteAndFix(page);

  await page.getByRole('button', { name: 'Change printing of Edgar Markov' }).click();
  const dialog = page.getByRole('dialog', { name: 'Printings of Edgar Markov' });
  await expect(dialog).toBeVisible();
  const options = dialog.getByRole('listitem');
  await expect(options.first()).toContainText('INR #428');
  await expect(options.first()).toContainText('Current');
  await expect(options.nth(1)).toContainText('INR #328');

  await options.nth(1).getByRole('button', { name: 'Use this printing' }).click();
  await expect(dialog).toBeHidden();
  const edgar = page.getByRole('row').filter({ hasText: 'Edgar Markov' });
  await expect(edgar).toContainText('INR #328');
  await expect(edgar).toContainText('$33.40');
  await expect(edgar.getByRole('link', { name: 'Edgar Markov' })).toHaveAttribute('href', 'https://www.tcgplayer.com/product/596295');
  await expect(page.getByTestId('deck-total')).toHaveText('$40.77');

  await page.reload();
  await expect(page.getByRole('row').filter({ hasText: 'Edgar Markov' })).toContainText('INR #328');

  await page.getByRole('button', { name: 'Change printing of Edgar Markov' }).click();
  await page.getByRole('button', { name: 'Use the cheapest printing' }).click();
  await expect(page.getByRole('row').filter({ hasText: 'Edgar Markov' })).toContainText('INR #428');
  await expect(page.getByTestId('deck-total')).toHaveText('$39.54');

  // A printing that only comes in foil is priced at its foil, and says so.
  await page.getByRole('button', { name: 'Change printing of Edgar Markov' }).click();
  await dialog.getByRole('listitem').filter({ hasText: 'C17 #36' }).getByRole('button', { name: 'Use this printing' }).click();
  await expect(edgar).toContainText('Foil');
  await expect(edgar).toContainText('$42.51');
  expect(misses).toEqual([]);
});

test('the printing picker says so when printings cannot be loaded, and Try again loads them', async ({ page }) => {
  await mockScryfall(page);
  await pasteAndFix(page);
  // A card's printings are asked for when its picker opens (unique=prints); the deck's own prices are not.
  const printings = /api\.scryfall\.com\/cards\/search\?.*unique=prints/;
  await page.route(printings, (route) => route.abort());

  await page.getByRole('button', { name: 'Change printing of Edgar Markov' }).click();
  const dialog = page.getByRole('dialog', { name: 'Printings of Edgar Markov' });
  await expect(dialog.getByRole('status')).toHaveText('Loading printings…');
  // The client retries a dropped request (1 s, 2 s, 4 s) before giving up.
  await expect(dialog.getByRole('alert')).toContainText("Couldn't reach Scryfall", { timeout: 30_000 });
  await expect(dialog.getByRole('listitem')).toHaveCount(0);
  await expect(page.getByTestId('deck-total')).toHaveText('$39.54'); // the deck is untouched

  await page.unroute(printings);
  await dialog.getByRole('button', { name: 'Try again' }).click();
  await expect(dialog.getByRole('listitem').first()).toContainText('INR #428');
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(dialog).toBeHidden();
});
