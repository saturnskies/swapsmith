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

const toast = (page: Page) => page.locator('.toast');
const toastUndo = (page: Page) => toast(page).getByRole('button', { name: 'Undo' });
const stored = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('swapsmith:life') ?? 'null'));
const resetTotals = async (page: Page) => {
  const m = await menu(page);
  await m.getByRole('button', { name: 'Reset life totals' }).click();
  return m;
};
/** A game with something in every place a reset touches: life, poison, commander damage, a partner flag, who goes first, history. */
const messyGame = async (page: Page) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await threePlayers(page);
  await minus(page, 'Player 1').click();
  const own = await openSheet(page, 'Player 2');
  await own.getByLabel('Has a partner commander').check();
  await closeSheet(own);
  const dlg = await openSheet(page, 'Player 3');
  await add(dlg, 'Poison').click();
  await add(dlg, "Damage from Player 2's partner").click();
  await closeSheet(dlg);
  await (await menu(page)).getByRole('button', { name: 'Roll for first player' }).click();
  await expect(page.locator('.tile[data-first="true"]')).toHaveCount(1);
};

test('reset life totals needs no confirm: everything goes back at once, the menu closes, and nothing asks', async ({ page }) => {
  await threePlayers(page);
  await minus(page, 'Player 1').click();
  const dlg = await openSheet(page, 'Player 3');
  await add(dlg, 'Poison').click();
  await closeSheet(dlg);

  const m = await resetTotals(page);
  // Right after the press: no dialog of any kind is open, and none was ever in the page.
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  await expect(page.locator('dialog').filter({ hasText: 'Reset all life totals?' })).toHaveCount(0);
  await expect(life(page, 0)).toHaveText('40');
  await expect(tile(page, 2).locator('.tile-badges')).not.toContainText('Poison');
  await expect(page.locator('.tile-name').first()).toHaveText(/Player \d/);
  await expect(page.getByRole('button', { name: 'Game menu' })).toBeFocused();
  await (await menu(page)).getByRole('button', { name: 'Close' }).click();
  await expect(m).toBeHidden();
});

test('the reset toast says so, and its Undo puts the exact previous game back', async ({ page }) => {
  await messyGame(page);
  const before = (await stored(page)).game;
  expect(before.history.length).toBeGreaterThan(0);
  expect(before.first).not.toBeNull();

  await resetTotals(page);
  const status = page.getByRole('status').filter({ hasText: 'Life totals reset' });
  await expect(status).toBeVisible();
  await expect(status.getByRole('button', { name: 'Undo' })).toBeVisible();
  expect((await stored(page)).game.history).toEqual([]);
  await expect(page.locator('.tile[data-first="true"]')).toHaveCount(0);

  await status.getByRole('button', { name: 'Undo' }).click();
  await expect(life(page, 0)).toHaveText('39');
  await expect(tile(page, 2).locator('.tile-badges')).toContainText('Poison 1');
  await expect(page.locator('.tile[data-first="true"]')).toHaveCount(1);
  expect((await stored(page)).game).toEqual(before);
  await expect(toast(page)).toHaveText('');
  const m = await menu(page);
  await expect(m.getByRole('button', { name: 'Undo' })).toBeEnabled();
  await m.getByRole('button', { name: 'Undo' }).click();
  await expect(tile(page, 2).locator('.tile-badges')).not.toContainText('Commander');
});

test('the toast goes after about 8 seconds, and then the menu Undo cannot bring the reset back', async ({ page }) => {
  await page.clock.install();
  await threePlayers(page);
  await minus(page, 'Player 1').click();
  await resetTotals(page);
  await expect(toast(page)).toContainText('Life totals reset');
  await page.clock.fastForward(7000);
  await expect(toast(page)).toContainText('Life totals reset');
  await page.clock.fastForward(1500);
  await expect(toast(page)).toHaveText('');

  await expect(life(page, 0)).toHaveText('40');
  const m = await menu(page);
  await expect(m.getByRole('button', { name: 'Undo' })).toBeDisabled();
});

test('the next change to the game takes the toast away', async ({ page }) => {
  await threePlayers(page);
  await resetTotals(page);
  await expect(toast(page)).toContainText('Life totals reset');
  await minus(page, 'Player 2').click();
  await expect(life(page, 1)).toHaveText('39');
  await expect(toast(page)).toHaveText('');

  await resetTotals(page);
  await expect(toast(page)).toContainText('Life totals reset');
  const dlg = await openSheet(page, 'Player 1');
  await add(dlg, 'Poison').click();
  await expect(toast(page)).toHaveText('');
  await closeSheet(dlg);

  await resetTotals(page);
  await expect(toast(page)).toContainText('Life totals reset');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await (await menu(page)).getByRole('button', { name: 'Roll for first player' }).click();
  await expect(page.locator('.tile[data-first="true"]')).toHaveCount(1);
  await expect(toast(page)).toHaveText('');

  await resetTotals(page);
  await expect(toast(page)).toContainText('Life totals reset');
  const edit = await menu(page);
  await edit.getByRole('button', { name: 'Edit names & colors' }).click();
  await page.getByRole('dialog', { name: 'Edit players' }).getByLabel('Name for player 1').fill('Ana');
  await expect(toast(page)).toHaveText('');
});

test('reset twice in a row: the toast restores only the state before the second reset, and its timer restarts', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.clock.install();
  await threePlayers(page);
  await minus(page, 'Player 1').click();
  await resetTotals(page);
  await page.clock.fastForward(5000);
  await resetTotals(page);
  // 10 s after the first reset, 5 s after the second: the first reset's timer must not have taken this toast away.
  await page.clock.fastForward(5000);
  await expect(toast(page)).toContainText('Life totals reset');

  await toastUndo(page).click();
  await expect(life(page, 0)).toHaveText('40');
  await expect(toast(page)).toHaveText('');
  expect((await stored(page)).game.players[0].life).toBe(40);
  expect(errors).toEqual([]);
});

test('a new game takes the toast and its Undo away, and an old timer cannot touch the new game\'s toast', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.clock.install();
  await threePlayers(page);
  await minus(page, 'Player 1').click();
  await resetTotals(page);
  await expect(toastUndo(page)).toBeVisible();

  await (await menu(page)).getByRole('button', { name: 'New game' }).click();
  const sheet = page.getByRole('dialog', { name: 'New game' });
  await sheet.getByRole('button', { name: 'Start' }).click();
  await page.getByRole('button', { name: 'Replace it' }).click();
  await expect(page.locator('.tile')).toHaveCount(2);
  await expect(toast(page)).toHaveText('');
  await expect(page.getByRole('button', { name: 'Undo' })).toHaveCount(0);

  await page.clock.fastForward(4000);
  await resetTotals(page);
  await page.clock.fastForward(5000);
  await expect(toast(page)).toContainText('Life totals reset');
  await page.clock.fastForward(4000);
  await expect(toast(page)).toHaveText('');
  expect(errors).toEqual([]);
});

test('the empty toast slot stays in the accessibility tree as a 1px clipped box', async ({ page }) => {
  await threePlayers(page);
  const slot = toast(page);
  await expect(slot).toHaveCount(1);
  await expect(slot).toHaveAttribute('role', 'status');
  await expect(slot).toHaveText('');
  const box = () =>
    slot.evaluate((el) => {
      const s = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return { display: s.display, position: s.position, w: r.width, h: r.height };
    });
  expect(await box()).toEqual({ display: expect.not.stringMatching(/^none$/), position: 'absolute', w: 1, h: 1 });

  await resetTotals(page);
  const shown = await box();
  expect(shown.position).toBe('absolute');
  expect(shown.w).toBeGreaterThan(1);
  expect(shown.h).toBeGreaterThan(1);
});
