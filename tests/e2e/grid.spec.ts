import { expect, test } from '@playwright/test';
import { mockScryfall, pasteAndFix } from './helpers';

// Deck from tests/fixtures/e2e-list.txt: Edgar Markov (commander), 3 creatures, Sol Ring, 8 Swamps.

test('switch to a card grid grouped by type, with images, prices and TCGplayer links', async ({ page }) => {
  const misses = await mockScryfall(page);
  await pasteAndFix(page);

  await page.getByRole('button', { name: 'Grid' }).click();
  await expect(page.getByRole('button', { name: 'Grid' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('table')).toHaveCount(0);

  const headings = page.getByRole('heading', { level: 3 }).filter({ hasNotText: 'Suggestions' });
  await expect(headings).toHaveText(['Commander (1)', 'Creatures (3)', 'Artifacts (1)', 'Lands (8)']);

  const edgar = page.getByRole('listitem').filter({ hasText: 'Edgar Markov' });
  await expect(edgar.getByRole('img', { name: 'Edgar Markov' })).toBeVisible();
  await expect(edgar).toContainText('$32.17');
  await expect(edgar.getByRole('link', { name: 'Edgar Markov' }).first()).toHaveAttribute('href', 'https://www.tcgplayer.com/product/596294');

  const keeper = page.getByRole('listitem').filter({ hasText: 'Bloodline Keeper' });
  await expect(keeper.getByRole('img', { name: 'Bloodline Keeper // Lord of Lineage' })).toHaveAttribute('src', /cards\.scryfall\.io\/normal\/front\//);
  await expect(page.getByRole('listitem').filter({ hasText: 'Swamp' })).toContainText('×8');
  expect(misses).toEqual([]);
});

test('owned, remove and printing work in the grid too', async ({ page }) => {
  await mockScryfall(page);
  await pasteAndFix(page);
  await page.getByRole('button', { name: 'Grid' }).click();

  await page.getByRole('checkbox', { name: 'Own Edgar Markov' }).check();
  await expect(page.getByTestId('deck-to-buy')).toHaveText('$6.65');

  await page.getByRole('button', { name: 'Remove Sol Ring' }).click();
  await expect(page.getByTestId('deck-count')).toHaveText('12 / 100 cards');
  await expect(page.getByRole('heading', { name: /^Artifacts/ })).toHaveCount(0);

  await page.getByRole('button', { name: 'Change printing of Edgar Markov' }).click();
  await expect(page.getByRole('dialog', { name: 'Printings of Edgar Markov' })).toBeVisible();
});

test('the chosen view is remembered across reloads and decks', async ({ page }) => {
  await mockScryfall(page);
  await pasteAndFix(page);
  await page.getByRole('button', { name: 'Grid' }).click();

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Creatures (3)' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Grid' })).toHaveAttribute('aria-pressed', 'true');

  await page.getByRole('button', { name: 'List' }).click();
  await expect(page.getByRole('table')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('table')).toBeVisible();
});
