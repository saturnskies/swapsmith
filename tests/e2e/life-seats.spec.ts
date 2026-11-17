import { expect, test, type Page } from '@playwright/test';
import { editPlayers, life, menu, plus, start, tile } from './life-helpers';

test.beforeEach(async ({ page }) => {
  await page.route('https://api.scryfall.com/**', (route) => route.abort());
});

/** Four players with names Ann, Bo, Cy, Di in seats 0 to 3 and different life totals, so a swap is easy to see. */
const table = async (page: Page, players = 4) => {
  await start(page, { players });
  const dlg = await editPlayers(page);
  for (const [i, name] of ['Ann', 'Bo', 'Cy', 'Di'].slice(0, players).entries()) await dlg.getByLabel(`Name for player ${i + 1}`).fill(name);
  await dlg.getByRole('button', { name: 'Close' }).click();
  const gameMenu = page.getByRole('dialog', { name: 'Game menu' });
  if (await gameMenu.isVisible()) await gameMenu.getByRole('button', { name: 'Close' }).click();
  await plus(page, 'Bo').click();
  await expect(life(page, 1)).toHaveText('41');
};
const arrange = async (page: Page) => {
  await (await menu(page)).getByRole('button', { name: 'Arrange seats' }).click();
  return page.getByRole('dialog', { name: 'Arrange seats' });
};
const chip = (page: Page, seat: number) => page.locator(`.seat-slot[data-seat="${seat}"] .seat-chip`);
const dragOnto = async (page: Page, from: number, to: number) => {
  const a = (await chip(page, from).boundingBox())!;
  const b = (await page.locator(`.seat-slot[data-seat="${to}"]`).boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2 + 10, a.y + a.height / 2 + 10);
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 6 });
  await page.mouse.up();
};

test('the menu offers Arrange seats only with two or more players', async ({ page }) => {
  await start(page);
  await expect((await menu(page)).getByRole('button', { name: 'Arrange seats' })).toBeVisible();
  await page.keyboard.press('Escape');
  await start(page, { players: 1 });
  await expect((await menu(page)).getByRole('button', { name: 'Arrange seats' })).toHaveCount(0);
});

test('the dialog shows the table as it sits: seats 1 and 2 on top, 0 and 3 below, with each player in place', async ({ page }) => {
  await table(page);
  await arrange(page);
  const y = async (seat: number) => (await chip(page, seat).boundingBox())!.y;
  expect(await y(1)).toBe(await y(2));
  expect(await y(0)).toBe(await y(3));
  expect(await y(1)).toBeLessThan(await y(0));
  await expect(chip(page, 1)).toContainText('Bo');
  await expect(chip(page, 1)).toContainText('41');
});

test('dragging one player onto another seat swaps them, with life, and the table behind follows', async ({ page }) => {
  await table(page);
  await arrange(page);
  await dragOnto(page, 1, 3);
  await expect(chip(page, 3)).toContainText('Bo');
  await expect(chip(page, 1)).toContainText('Di');
  await expect(page.locator('.seat-status')).toContainText('Bo and Di swapped seats');
  await page.getByRole('dialog', { name: 'Arrange seats' }).getByRole('button', { name: 'Close' }).click();
  await expect(tile(page, 3).locator('.tile-name')).toHaveText('Bo');
  await expect(life(page, 3)).toHaveText('41');
  await expect(tile(page, 1).locator('.tile-name')).toHaveText('Di');
  await expect(life(page, 1)).toHaveText('40');
  await expect(page.getByRole('button', { name: 'Game menu' })).toBeFocused();
});

test('dropping a player on empty space changes nothing', async ({ page }) => {
  await table(page);
  const dlg = await arrange(page);
  const a = (await chip(page, 1).boundingBox())!;
  const d = (await dlg.boundingBox())!;
  await page.mouse.move(a.x + 20, a.y + 20);
  await page.mouse.down();
  await page.mouse.move(d.x + 5, d.y + 5, { steps: 5 });
  await page.mouse.up();
  await expect(chip(page, 1)).toContainText('Bo');
});

test('tap one player, then another, swaps them too (for a keyboard or a shaky thumb), and the same one again lets go', async ({ page }) => {
  await table(page);
  await arrange(page);
  await chip(page, 0).click();
  await expect(chip(page, 0)).toHaveAttribute('aria-pressed', 'true');
  await chip(page, 0).click();
  await expect(chip(page, 0)).toHaveAttribute('aria-pressed', 'false');
  await chip(page, 0).click();
  await chip(page, 2).click();
  await expect(chip(page, 0)).toContainText('Cy');
  await expect(chip(page, 2)).toContainText('Ann');
});

test('a swap is saved, and commander damage stays with the commander', async ({ page }) => {
  await table(page);
  // Ann takes 5 commander damage from Bo (seat 1) through Ann's Counters sheet.
  await tile(page, 0).getByRole('button', { name: /Ann: poison and commander damage/ }).click();
  const sheet = page.getByRole('dialog').last();
  await sheet.getByRole('group', { name: /Bo/ }).getByRole('button', { name: /add 1|\+/ }).first().click();
  await page.keyboard.press('Escape');
  await arrange(page);
  await dragOnto(page, 1, 2);
  await page.getByRole('dialog', { name: 'Arrange seats' }).getByRole('button', { name: 'Close' }).click();
  await page.reload();
  await expect(tile(page, 2).locator('.tile-name')).toHaveText('Bo');
  await tile(page, 0).getByRole('button', { name: /Ann: poison and commander damage/ }).click();
  await expect(page.getByRole('dialog').last().getByRole('group', { name: /Bo/ }).locator('.counter-value')).toHaveText('1');
});

test('a player who has died stays settled when moved, and the burst does not play again', async ({ page }) => {
  await start(page, { players: 2, custom: '1' });
  await page.getByRole('button', { name: 'Player 1: lose 1 life' }).click();
  await expect(tile(page, 0)).toHaveAttribute('data-dead', 'true');
  await expect(tile(page, 0)).not.toHaveAttribute('data-dying', 'true'); // the first burst is over
  await arrange(page);
  await dragOnto(page, 0, 1);
  await page.getByRole('dialog', { name: 'Arrange seats' }).getByRole('button', { name: 'Close' }).click();
  await expect(tile(page, 1)).toHaveAttribute('data-dead', 'true');
  await expect(tile(page, 1)).not.toHaveAttribute('data-dying', 'true');
  await expect(tile(page, 0)).toHaveAttribute('data-dead', 'false');
  await expect(tile(page, 0)).not.toHaveAttribute('data-dying', 'true');
});
