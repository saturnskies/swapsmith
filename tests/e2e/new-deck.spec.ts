import { expect, test, type Page } from '@playwright/test';
import { mockScryfall } from './helpers';

async function pick(page: Page, label: string, typed: string, option: string) {
  const box = page.getByRole('combobox', { name: label });
  await box.fill(typed);
  await page.getByRole('option', { name: option, exact: true }).click();
}

async function startEdgarDeck(page: Page) {
  await page.goto('./');
  await page.getByRole('link', { name: 'New deck' }).click();
  await page.getByLabel('Deck name').fill('Fresh Edgar');
  await pick(page, 'Commander', 'edgar', 'Edgar Markov');
  await expect(page.getByText('Commander: Edgar Markov')).toBeVisible();
  await page.getByRole('button', { name: 'Create deck' }).click();
  await expect(page.getByTestId('deck-total')).toHaveText('$32.17');
}

test('start a deck from a commander and add cards by search', async ({ page }) => {
  const misses = await mockScryfall(page);
  await startEdgarDeck(page);
  await expect(page.getByRole('heading', { level: 2, name: 'Fresh Edgar' })).toBeVisible();
  await expect(page.getByTestId('deck-count')).toHaveText('1 / 100 cards');

  // Autocomplete leaves out art-series oddities like "Sol Ring // Sol Ring".
  await page.getByRole('combobox', { name: 'Add a card' }).fill('sol r');
  await expect(page.getByRole('option')).toHaveText(['Sol Ring']);
  await page.getByRole('option', { name: 'Sol Ring' }).click();

  await expect(page.getByRole('row').filter({ hasText: 'Sol Ring' })).toContainText('$1.28');
  await expect(page.getByTestId('deck-total')).toHaveText('$33.45');
  await expect(page.getByTestId('deck-count')).toHaveText('2 / 100 cards');
  await expect(page.getByRole('combobox', { name: 'Add a card' })).toHaveValue('');
  expect(misses).toEqual([]);
});

test('warns about an off-color card but lets you add it anyway', async ({ page }) => {
  await mockScryfall(page);
  await startEdgarDeck(page);

  await pick(page, 'Add a card', 'llanowar', 'Llanowar Elves');
  await expect(page.getByRole('alert')).toContainText("Llanowar Elves is outside Edgar Markov's colors.");
  await page.getByRole('button', { name: 'Add anyway' }).click();
  await expect(page.getByRole('row').filter({ hasText: 'Llanowar Elves' })).toBeVisible();
  await expect(page.getByTestId('deck-count')).toHaveText('2 / 100 cards');
});

test('warns about a duplicate, and Cancel leaves the deck unchanged', async ({ page }) => {
  await mockScryfall(page);
  await startEdgarDeck(page);
  await pick(page, 'Add a card', 'sol r', 'Sol Ring');
  await expect(page.getByTestId('deck-count')).toHaveText('2 / 100 cards');

  await pick(page, 'Add a card', 'sol r', 'Sol Ring');
  await expect(page.getByRole('alert')).toContainText('Sol Ring is already in this deck.');
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByTestId('deck-count')).toHaveText('2 / 100 cards');
});

test('remove a card, and the deck survives a reload', async ({ page }) => {
  const misses = await mockScryfall(page);
  await startEdgarDeck(page);
  await pick(page, 'Add a card', 'sol r', 'Sol Ring');
  await pick(page, 'Add a card', 'llanowar', 'Llanowar Elves');
  await page.getByRole('button', { name: 'Add anyway' }).click();
  await expect(page.getByTestId('deck-count')).toHaveText('3 / 100 cards');

  await page.getByRole('button', { name: 'Remove Llanowar Elves' }).click();
  await expect(page.getByTestId('deck-count')).toHaveText('2 / 100 cards');
  await expect(page.getByRole('button', { name: 'Remove Edgar Markov' })).toHaveCount(0);

  await page.reload();
  await expect(page.getByTestId('deck-total')).toHaveText('$33.45');
  await expect(page.getByRole('row').filter({ hasText: 'Sol Ring' })).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: 'Llanowar' })).toHaveCount(0);
  expect(misses).toEqual([]);
});

test('the commander search works with the keyboard', async ({ page }) => {
  await mockScryfall(page);
  await page.goto('./#/new');
  const box = page.getByRole('combobox', { name: 'Commander' });
  await box.fill('edgar');
  await expect(page.getByRole('option').first()).toHaveText(/Edgar Markov/);
  await box.press('ArrowDown');
  await expect(box).toHaveAttribute('aria-activedescendant', /.+/);
  await box.press('Enter');
  await expect(page.getByText('Commander: Edgar Markov')).toBeVisible();
});
