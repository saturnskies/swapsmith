import { expect, type Page } from '@playwright/test';

export const menu = async (page: Page) => {
  await page.getByRole('button', { name: 'Game menu' }).click();
  return page.getByRole('dialog', { name: 'Game menu' });
};
const pick = (page: Page, group: string, name: string) => page.getByRole('group', { name: group }).getByRole('button', { name, exact: true }).click();

/**
 * Opens the Life Counter, which opens straight into a game (2 players, 40 life by default). When `players`, `life` or
 * `custom` (a typed starting life) is given, starts a new game with them through Menu → New game.
 */
export const start = async (page: Page, opts: { players?: number; life?: number; custom?: string } = {}) => {
  await page.goto('./#/life');
  await expect(page.locator('.tile').first()).toBeVisible();
  if (opts.players == null && opts.life == null && opts.custom == null) return;
  await (await menu(page)).getByRole('button', { name: 'New game' }).click();
  const dlg = page.getByRole('dialog', { name: 'New game' });
  if (opts.players) await pick(page, 'Players', String(opts.players));
  if (opts.life) await pick(page, 'Starting life', String(opts.life));
  if (opts.custom != null) {
    await pick(page, 'Starting life', 'Custom');
    await page.getByLabel('Custom starting life').fill(opts.custom);
  }
  await dlg.getByRole('button', { name: 'Start' }).click();
  // The question only shows when a game exists; a pristine default game still counts as one.
  const replace = page.getByRole('button', { name: 'Replace it' });
  if (await replace.isVisible()) await replace.click();
  await expect(dlg).toBeHidden();
};
export const life = (page: Page, seat: number) => page.locator(`.tile[data-player="${seat}"] .tile-life`);
export const minus = (page: Page, name: string) => page.getByRole('button', { name: `${name}: lose 1 life` });
export const plus = (page: Page, name: string) => page.getByRole('button', { name: `${name}: gain 1 life` });

/** Opens Menu → Edit names & colors: the dialog where each seat's name, color and art are set. */
export const editPlayers = async (page: Page) => {
  await (await menu(page)).getByRole('button', { name: 'Edit names & colors' }).click();
  return page.getByRole('dialog', { name: 'Edit players' });
};
export const tile = (page: Page, seat: number) => page.locator(`.tile[data-player="${seat}"]`);
