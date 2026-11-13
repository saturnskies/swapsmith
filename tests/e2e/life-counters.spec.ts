import { expect, test, type Locator, type Page } from '@playwright/test';
import { life, minus, start } from './life-helpers';

test.beforeEach(async ({ page }) => {
  await page.route('https://api.scryfall.com/**', (route) => route.abort());
});

const tile = (page: Page, seat: number) => page.locator(`.tile[data-player="${seat}"]`);
const sheet = (page: Page, name: string) => page.getByRole('dialog', { name: `${name}: counters` });
const openSheet = async (page: Page, name: string) => {
  await page.getByRole('button', { name: `${name}: poison and commander damage` }).click();
  return sheet(page, name);
};
const closeSheet = async (dlg: Locator) => {
  await dlg.getByRole('button', { name: 'Close' }).click();
  await expect(dlg).toBeHidden();
};
const row = (dlg: Locator, name: string) => dlg.getByRole('group', { name, exact: true });
const value = (dlg: Locator, name: string) => row(dlg, name).locator('output');
const add = (dlg: Locator, name: string) => dlg.getByRole('button', { name: `${name}: add 1`, exact: true });
const hold = async (page: Page, target: Locator) => {
  const box = (await target.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(700);
  await page.mouse.up();
  await page.waitForTimeout(300);
};
const menu = async (page: Page) => {
  await page.getByRole('button', { name: 'Game menu' }).click();
  return page.getByRole('dialog', { name: 'Game menu' });
};
const threePlayers = async (page: Page) => {
  await start(page, { players: 3 });
};

test('poison counts per player, warns at 10, and nothing else happens', async ({ page }) => {
  await threePlayers(page);
  let dlg = await openSheet(page, 'Player 1');
  for (let i = 0; i < 3; i++) await add(dlg, 'Poison').click();
  await expect(value(dlg, 'Poison')).toHaveText('3');
  await closeSheet(dlg);
  await expect(tile(page, 0).locator('.tile-badges')).toContainText('Poison 3');
  await expect(tile(page, 0).locator('.tile-warn')).toHaveText('');

  dlg = await openSheet(page, 'Player 1');
  await hold(page, add(dlg, 'Poison'));
  await expect(value(dlg, 'Poison')).toHaveText('13');
  await closeSheet(dlg);
  await expect(tile(page, 0).locator('.tile-warn')).toContainText('Poison 13');
  await expect(tile(page, 0)).toHaveAttribute('data-warn', 'true');
  await expect(tile(page, 1)).not.toHaveAttribute('data-warn', 'true');

  // Never eliminated: the player can keep going.
  await minus(page, 'Player 1').click();
  await expect(life(page, 0)).toHaveText('39');
});

test('commander damage is tracked per opponent, warns at 21, and does not touch life', async ({ page }) => {
  await threePlayers(page);
  const dlg = await openSheet(page, 'Player 1');
  await expect(row(dlg, 'Damage from Player 2')).toBeVisible();
  await expect(row(dlg, 'Damage from Player 3')).toBeVisible();
  await expect(row(dlg, 'Damage from Player 1')).toHaveCount(0);

  const p2 = dlg.getByRole('button', { name: 'Damage from Player 2: add 1', exact: true });
  await hold(page, p2);
  await hold(page, p2);
  await expect(value(dlg, 'Damage from Player 2')).toHaveText('20');
  await expect(row(dlg, 'Damage from Player 2')).not.toContainText('Lethal');
  await add(dlg, 'Damage from Player 2').click();
  await expect(value(dlg, 'Damage from Player 2')).toHaveText('21');
  await expect(row(dlg, 'Damage from Player 2')).toContainText('Lethal');
  await expect(row(dlg, 'Damage from Player 3')).not.toContainText('Lethal');
  await closeSheet(dlg);

  await expect(tile(page, 0).locator('.tile-warn')).toContainText('Commander damage 21 from Player 2');
  await expect(life(page, 0)).toHaveText('40');
});

test('partners: each commander of a pair is tracked on its own row', async ({ page }) => {
  await threePlayers(page);
  const own = await openSheet(page, 'Player 2');
  await own.getByLabel('Has a partner commander').check();
  await closeSheet(own);

  let dlg = await openSheet(page, 'Player 1');
  await expect(row(dlg, 'Damage from Player 2')).toBeVisible();
  await expect(row(dlg, "Damage from Player 2's partner")).toBeVisible();
  await add(dlg, "Damage from Player 2's partner").click();
  await add(dlg, "Damage from Player 2's partner").click();
  await expect(value(dlg, "Damage from Player 2's partner")).toHaveText('2');
  await expect(value(dlg, 'Damage from Player 2')).toHaveText('0');
  await closeSheet(dlg);

  const off = await openSheet(page, 'Player 2');
  await off.getByLabel('Has a partner commander').uncheck();
  await closeSheet(off);
  dlg = await openSheet(page, 'Player 1');
  await expect(row(dlg, "Damage from Player 2's partner")).toHaveCount(0);
  await expect(value(dlg, 'Damage from Player 2')).toHaveText('0');
});

test('life at zero or below warns but the player keeps playing', async ({ page }) => {
  await start(page, { players: 1, custom: '1' });
  await minus(page, 'Player 1').click();
  await expect(life(page, 0)).toHaveText('0');
  await expect(tile(page, 0).locator('.tile-warn')).toContainText('Life 0 or below');
  await minus(page, 'Player 1').click();
  await expect(life(page, 0)).toHaveText('-1');
  await expect(tile(page, 0)).toHaveAttribute('data-warn', 'true');
});

test('undo takes back the last changes by anyone, one at a time', async ({ page }) => {
  await threePlayers(page);
  let m = await menu(page);
  await expect(m.getByRole('button', { name: 'Undo' })).toBeDisabled();
  await m.getByRole('button', { name: 'Close' }).click();

  await minus(page, 'Player 1').click();
  let dlg = await openSheet(page, 'Player 2');
  await add(dlg, 'Poison').click();
  await closeSheet(dlg);
  dlg = await openSheet(page, 'Player 3');
  await add(dlg, 'Damage from Player 1').click();
  await closeSheet(dlg);
  await expect(tile(page, 2).locator('.tile-badges')).toContainText('Commander 1');

  m = await menu(page);
  const undoBtn = m.getByRole('button', { name: 'Undo' });
  await undoBtn.click();
  await expect(tile(page, 2).locator('.tile-badges')).not.toContainText('Commander');
  await expect(tile(page, 1).locator('.tile-badges')).toContainText('Poison 1');
  await undoBtn.click();
  await expect(tile(page, 1).locator('.tile-badges')).not.toContainText('Poison');
  await expect(life(page, 0)).toHaveText('39');
  await undoBtn.click();
  await expect(life(page, 0)).toHaveText('40');
  await expect(undoBtn).toBeDisabled();
});

test('counters, partners and the undo history are saved with the game', async ({ page }) => {
  await threePlayers(page);
  const own = await openSheet(page, 'Player 2');
  await own.getByLabel('Has a partner commander').check();
  await closeSheet(own);
  const dlg = await openSheet(page, 'Player 1');
  await add(dlg, 'Poison').click();
  await add(dlg, "Damage from Player 2's partner").click();
  await closeSheet(dlg);

  await page.reload();
  await expect(tile(page, 0).locator('.tile-badges')).toContainText('Poison 1');
  const again = await openSheet(page, 'Player 1');
  await expect(value(again, "Damage from Player 2's partner")).toHaveText('1');
  await closeSheet(again);

  const m = await menu(page);
  await m.getByRole('button', { name: 'Undo' }).click();
  await expect(tile(page, 0).locator('.tile-badges')).toContainText('Poison 1');
  await expect(tile(page, 0).locator('.tile-badges')).not.toContainText('Commander');
});

test('reset life totals asks first, puts everything back, and leaves nothing to undo', async ({ page }) => {
  await threePlayers(page);
  await minus(page, 'Player 1').click();
  const dlg = await openSheet(page, 'Player 3');
  await add(dlg, 'Poison').click();
  await closeSheet(dlg);

  const m = await menu(page);
  await m.getByRole('button', { name: 'Reset life totals' }).click();
  const confirm = page.getByRole('dialog', { name: 'Reset all life totals?' });
  await confirm.getByRole('button', { name: 'Keep playing' }).click();
  await expect(life(page, 0)).toHaveText('39');

  await m.getByRole('button', { name: 'Reset life totals' }).click();
  await page.getByRole('dialog', { name: 'Reset all life totals?' }).getByRole('button', { name: 'Reset' }).click();
  await expect(life(page, 0)).toHaveText('40');
  await expect(tile(page, 2).locator('.tile-badges')).not.toContainText('Poison');
  await expect(page.locator('.tile-name').first()).toHaveText(/Player \d/);
  await expect(m.getByRole('button', { name: 'Undo' })).toBeDisabled();
});
