import { expect, test } from '@playwright/test';
import { mockScryfall, pasteAndFix } from './helpers';

const DAY = 24 * 60 * 60 * 1000;
const savedNote = (page: import('@playwright/test').Page) => page.getByTestId('saved-prices');

test('a deck priced earlier still opens with its saved prices when Scryfall cannot be reached, and says so', async ({ page }) => {
  const start = new Date('2026-11-12T12:00:00Z').getTime();
  await page.clock.setFixedTime(start);
  await mockScryfall(page);
  await pasteAndFix(page);
  await expect(page.getByTestId('deck-total')).toHaveText('$39.54');
  // The note is in the page (so a screen reader hears it when it fills) but empty while prices are live.
  await expect(savedNote(page)).toHaveCount(1);
  await expect(savedNote(page)).toBeEmpty();

  // Two days later the saved prices are past their 24 hours, and Scryfall is unreachable.
  await page.clock.setFixedTime(start + 2 * DAY);
  await page.route('https://api.scryfall.com/**', (route) => route.abort());
  await page.reload();

  await expect(page.getByTestId('deck-total')).toHaveText('$39.54', { timeout: 30_000 });
  await expect(page.getByTestId('deck-count')).toHaveText('13 / 100 cards');
  await expect(savedNote(page)).toContainText("Can't reach Scryfall");
  await expect(page.getByRole('alert').filter({ hasText: "Couldn't reach Scryfall to price this deck" })).toHaveCount(0);
});

test('prices saved more than a week ago are not shown as if they were current', async ({ page }) => {
  const start = new Date('2026-11-12T12:00:00Z').getTime();
  await page.clock.setFixedTime(start);
  await mockScryfall(page);
  await pasteAndFix(page);

  await page.clock.setFixedTime(start + 8 * DAY);
  await page.route('https://api.scryfall.com/**', (route) => route.abort());
  await page.reload();

  await expect(page.getByRole('alert').filter({ hasText: "Couldn't reach Scryfall to price this deck" })).toBeVisible({ timeout: 30_000 });
  await expect(savedNote(page)).toBeEmpty();
});
