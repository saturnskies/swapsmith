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

/** Every row of the art cache, read from the page's own IndexedDB. */
export const cachedRows = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<Array<{ id: string; bytes: number; lastUsed: number }>>((resolve, reject) => {
        const open = indexedDB.open('swapsmith-art', 1);
        open.onsuccess = () => {
          const req = open.result.transaction('images').objectStore('images').getAll();
          req.onsuccess = () => resolve(req.result.map((r: { id: string; bytes: number; lastUsed: number }) => ({ id: r.id, bytes: r.bytes, lastUsed: r.lastUsed })));
          req.onerror = () => reject(req.error);
        };
        open.onerror = () => reject(open.error);
      }),
  );
/** Writes rows straight into the cache (`id`, `lastUsed`), or deletes them (`lastUsed` null). */
export const writeRows = (page: Page, rows: Array<{ id: string; lastUsed: number | null }>) =>
  page.evaluate(
    (list) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('swapsmith-art', 1);
        open.onsuccess = () => {
          const tx = open.result.transaction('images', 'readwrite');
          const store = tx.objectStore('images');
          for (const r of list) {
            if (r.lastUsed === null) store.delete(r.id);
            else store.put({ id: r.id, blob: new Blob([new Uint8Array(10)], { type: 'image/jpeg' }), bytes: 10, lastUsed: r.lastUsed });
          }
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        };
        open.onerror = () => reject(open.error);
      }),
    rows,
  );
/** The art id the saved game gives a seat (0-based), or undefined. */
export const artId = (page: Page, seat: number) => page.evaluate((s) => JSON.parse(localStorage.getItem('swapsmith:life') ?? '{}').game?.players?.[s]?.art?.id as string | undefined, seat);
