import { expect, test, type Page } from '@playwright/test';

/** A minimal saved deck; enough for the home list (art lookups are aborted, so no art shows). */
const deck = (i: number) => ({
  id: `d${i}`,
  name: `Deck ${i}`,
  format: 'commander',
  commander: { oracleId: `o${i}`, name: `Commander ${i}` },
  cards: [],
  updatedAt: new Date(2026, 0, 1 + i).toISOString(),
});

test.beforeEach(async ({ page }) => {
  await page.route('https://api.scryfall.com/**', (route) => route.abort());
  const decks = Array.from({ length: 25 }, (_, i) => deck(i));
  await page.addInitScript((d) => {
    if (!localStorage.getItem('swapsmith:v1')) localStorage.setItem('swapsmith:v1', JSON.stringify({ version: 1, decks: d, owned: [], unownedBasics: [], prefs: { view: 'list' } }));
  }, decks);
});

const bar = (page: Page) => page.getByRole('navigation', { name: 'Main' });
const tab = (page: Page, name: string) => bar(page).getByRole('link', { name });
const hash = (page: Page) => page.evaluate(() => location.hash);
const scrollY = (page: Page) => page.evaluate(() => Math.round(window.scrollY));

test('shows Decks, Browse and Life Counter, with the current one marked', async ({ page }) => {
  await page.goto('./');
  await expect(tab(page, 'Decks')).toHaveAttribute('aria-current', 'page');
  await expect(tab(page, 'Browse')).not.toHaveAttribute('aria-current', 'page');
  await expect(tab(page, 'Life Counter')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Your decks' })).toBeVisible();

  await tab(page, 'Browse').click();
  await expect(page).toHaveURL(/#\/browse$/);
  await expect(tab(page, 'Browse')).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('heading', { name: 'Browse' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Your decks' })).toBeHidden();

  // The Life Counter opens straight into the full-screen game, which hides the bar.
  await tab(page, 'Life Counter').click();
  await expect(page).toHaveURL(/#\/life\/game$/);
  await expect(page.locator('.tile')).toHaveCount(2);
  await expect(bar(page)).toBeHidden();
});

test('a reload stays on the tab', async ({ page }) => {
  await page.goto('./#/life');
  await page.reload();
  await expect(page).toHaveURL(/#\/life\/game$/);
  await expect(page.locator('.tile')).toHaveCount(2);
  await expect(page.locator('[data-tab="life"]')).toBeVisible();
});

test('Decks keeps a half-typed form when you visit another tab and come back', async ({ page }) => {
  await page.goto('./#/new');
  const field = page.locator('[data-tab="decks"] input').first();
  await field.fill('Edgar');
  await tab(page, 'Life Counter').click();
  await expect(field).toBeHidden();
  // The game hides the bar; the browser's back goes to where we were.
  await page.goBack();
  await expect(page).toHaveURL(/#\/new$/);
  await expect(field).toHaveValue('Edgar');
});

test('Decks keeps its scroll position when you visit another tab and come back', async ({ page }) => {
  await page.goto('./');
  await expect(page.getByText('Deck 24', { exact: true })).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 400));
  expect(await scrollY(page)).toBe(400);
  await tab(page, 'Browse').click();
  await expect(page.getByRole('heading', { name: 'Browse' })).toBeVisible();
  await tab(page, 'Decks').click();
  await expect(page.getByRole('heading', { name: 'Your decks' })).toBeVisible();
  await expect.poll(() => scrollY(page)).toBe(400);
});

test('tapping the tab you are on goes to its root and scrolls to the top', async ({ page }) => {
  await page.goto('./#/paste');
  await tab(page, 'Decks').click();
  await expect(page.getByRole('heading', { name: 'Your decks' })).toBeVisible();
  expect(await hash(page)).toBe('#/');

  await page.evaluate(() => window.scrollTo(0, 400));
  await tab(page, 'Decks').click();
  await expect.poll(() => scrollY(page)).toBe(0);
  expect(await hash(page)).toBe('#/');
});

test('Browse and Life Counter stay mounted while hidden', async ({ page }) => {
  await page.goto('./#/browse');
  const browse = page.locator('[data-tab="browse"]');
  await browse.evaluate((el) => ((el as HTMLElement).dataset.mark = 'kept'));
  await tab(page, 'Decks').click();
  await expect(browse).toBeHidden();
  await tab(page, 'Browse').click();
  await expect(browse).toBeVisible();
  await expect(browse).toHaveAttribute('data-mark', 'kept');
});

test('every Life Counter route lands on the game', async ({ page }) => {
  await page.goto('./#/life/nope');
  await expect(page).toHaveURL(/#\/life\/game$/);
  await expect(page.locator('.tile')).toHaveCount(2);
  await page.goto('./#/life');
  await expect(page).toHaveURL(/#\/life\/game$/);
  await expect(page.locator('.tile')).toHaveCount(2);
});

test('the bar does not cover the end of the page', async ({ page }) => {
  await page.goto('./');
  await expect(page.getByText('Deck 24', { exact: true })).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  const footer = await page.locator('.site-footer').boundingBox();
  const nav = await bar(page).boundingBox();
  expect(footer && nav && footer.y + footer.height <= nav.y + 1).toBe(true);
});

test.describe('an open dialog never outlives its tab', () => {
  /** Whatever is open, going to another tab (browser back, a link) must leave the bar and page usable. */
  const usableAfterLeaving = async (page: Page) => {
    await page.evaluate(() => (location.hash = '#/'));
    await expect(page.getByRole('heading', { name: 'Your decks' })).toBeVisible();
    await expect(page.locator('dialog[open]')).toHaveCount(0);
    await tab(page, 'Browse').click();
    await expect(page).toHaveURL(/#\/browse$/);
  };

  test('the game menu', async ({ page }) => {
    await page.goto('./#/life');
    await page.getByRole('button', { name: 'Game menu' }).click();
    await expect(page.getByRole('dialog', { name: 'Game menu' })).toBeVisible();
    await usableAfterLeaving(page);
  });

  test("a player's counters sheet", async ({ page }) => {
    await page.goto('./#/life');
    await page.getByRole('button', { name: 'Player 1: poison and commander damage' }).click();
    await expect(page.getByRole('dialog', { name: 'Player 1: counters' })).toBeVisible();
    await usableAfterLeaving(page);
  });

  for (const sheet of ['New game', 'Defaults']) {
    test(`the ${sheet} sheet`, async ({ page }) => {
      await page.goto('./#/life');
      await page.getByRole('button', { name: 'Game menu' }).click();
      await page.getByRole('dialog', { name: 'Game menu' }).getByRole('button', { name: sheet }).click();
      await expect(page.getByRole('dialog', { name: sheet })).toBeVisible();
      await usableAfterLeaving(page);
    });
  }

  test('the replace-game question', async ({ page }) => {
    await page.goto('./#/life');
    await page.getByRole('button', { name: 'Game menu' }).click();
    await page.getByRole('dialog', { name: 'Game menu' }).getByRole('button', { name: 'New game' }).click();
    await page.getByRole('dialog', { name: 'New game' }).getByRole('button', { name: 'Start' }).click();
    await expect(page.getByRole('dialog', { name: 'Replace the game in progress?' })).toBeVisible();
    await usableAfterLeaving(page);
  });
});
