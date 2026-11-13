import { expect, test } from '@playwright/test';
import { mockScryfall, pasteAndFix } from './helpers';

test('share a deck by link; a friend sees it read-only and can save a copy', async ({ page, browser }) => {
  await mockScryfall(page);
  await pasteAndFix(page, 'Edgar to share');
  // Personal state that must NOT travel: an owned card. A chosen printing should.
  await page.getByRole('checkbox', { name: 'Own Sol Ring' }).check();
  await page.getByRole('button', { name: 'Change printing of Edgar Markov' }).click();
  await page.getByRole('dialog').getByRole('listitem').nth(1).getByRole('button', { name: 'Use this printing' }).click();
  await expect(page.getByTestId('deck-total')).toHaveText('$40.77');

  await page.getByRole('button', { name: 'Share & export' }).click();
  await page.getByRole('dialog', { name: 'Share & export' }).getByRole('button', { name: 'Copy share link' }).click();
  const link = await page.getByRole('textbox', { name: 'Share link' }).inputValue();
  expect(link).toMatch(/\/swapsmith\/#d=[A-Za-z0-9_-]+$/);
  await expect(page.getByRole('status').filter({ hasText: 'owned cards are not included' })).toBeVisible();

  // A friend: a brand-new browser profile with nothing saved.
  const friendCtx = await browser.newContext();
  const friend = await friendCtx.newPage();
  // Pricing the shared deck looks up the picked commander printing, as the home page later does for its art (recorded).
  const misses = await mockScryfall(friend);
  await friend.goto(link);
  await expect(friend.getByRole('heading', { level: 2, name: 'Edgar to share' })).toBeVisible();
  await expect(friend.getByText('A shared deck.')).toBeVisible();
  await expect(friend.getByTestId('deck-total')).toHaveText('$40.77');
  await expect(friend.getByRole('row').filter({ hasText: 'Edgar Markov' })).toContainText('INR #328');
  // A shared deck has no suggestions, so a card's name stays a TCGplayer link instead of opening the card dialog.
  await expect(friend.getByRole('row').filter({ hasText: 'Sol Ring' }).getByRole('link', { name: 'Sol Ring' })).toHaveAttribute('href', /^https:\/\/www\.tcgplayer\.com\/product\/\d+$/);
  await expect(friend.getByRole('button', { name: 'Sol Ring', exact: true })).toHaveCount(0);
  // Read-only: no editing controls, and nothing saved yet.
  await expect(friend.getByRole('checkbox')).toHaveCount(0);
  await expect(friend.getByRole('button', { name: /^Remove / })).toHaveCount(0);
  await expect(friend.getByRole('combobox', { name: 'Add a card' })).toHaveCount(0);
  await expect(friend.getByRole('button', { name: 'Delete deck' })).toHaveCount(0);
  await expect(friend.getByRole('button', { name: 'Share' })).toHaveCount(0);
  await expect(friend.getByRole('note', { name: 'How Owned and Keep work' })).toHaveCount(0); // nothing to explain: no Owned or Keep controls
  // They can still copy or download what they were sent, but have no link of their own to make.
  await friend.getByRole('button', { name: 'Export' }).click();
  const exportOptions = friend.getByRole('dialog', { name: 'Export' });
  await expect(exportOptions.getByRole('button', { name: 'Copy deck' })).toBeVisible();
  await expect(exportOptions.getByRole('button', { name: 'Download .txt' })).toBeVisible();
  await expect(exportOptions.getByRole('button', { name: 'Copy share link' })).toHaveCount(0);
  await exportOptions.getByRole('button', { name: 'Close' }).click();
  await expect(exportOptions).toBeHidden();
  await expect(friend.getByRole('group', { name: 'Show' })).toHaveCount(0); // no suggestions, so no Cards | Suggestions switch

  await friend.getByRole('button', { name: 'Save to my decks' }).click();
  await expect(friend).toHaveURL(/#\/deck\//);
  await expect(friend.getByRole('checkbox', { name: 'Own Sol Ring' })).not.toBeChecked();
  await expect(friend.getByRole('row').filter({ hasText: 'Edgar Markov' })).toContainText('INR #328');
  await friend.getByRole('link', { name: 'Swapsmith' }).click();
  await expect(friend.getByRole('listitem').filter({ hasText: 'Edgar to share' })).toBeVisible();
  expect(misses).toEqual([]);
  await friendCtx.close();
});

test('a damaged share link explains what went wrong', async ({ page }) => {
  await mockScryfall(page);
  await page.goto('./#d=not-really-a-deck');
  await expect(page.getByRole('heading', { name: "Couldn't open this shared deck" })).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('damaged');
  await page.getByRole('link', { name: 'Go to your decks' }).click();
  await expect(page.getByRole('heading', { name: 'Your decks' })).toBeVisible();
});
