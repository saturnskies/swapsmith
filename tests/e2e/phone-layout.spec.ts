import { expect, test, type Locator, type Page } from '@playwright/test';
import { composite, contrastRatio, effectiveBackground, parseColor } from '../support/contrast';
import { start } from './life-helpers';
import { openEdgarDeck, paneBar, row, seedEdgarDeck, showPane, suggestionsPanel } from './helpers';

// Phone layout fixes (docs/superpowers/plans/2026-11-04-phone-layout.md). These check what the page
// really renders, in both colour schemes. They never assert prices: re-recording fixtures moves them.

test.skip(({ isMobile }) => !isMobile, 'phone layout checks run on the phone project only');

interface Sample {
  color: string;
  outlineColor: string;
  outlineStyle: string;
  borderColor: string;
  opacity: string;
  bgs: string[];
  parentBgs: string[];
}

/** The computed colours of an element and the backgrounds behind it, nearest first. */
const sample = (loc: Locator): Promise<Sample> =>
  loc.evaluate((el) => {
    const chain = (start: Element | null) => {
      const out: string[] = [];
      for (let n = start; n; n = n.parentElement) out.push(getComputedStyle(n).backgroundColor);
      return out;
    };
    const cs = getComputedStyle(el);
    return { color: cs.color, outlineColor: cs.outlineColor, outlineStyle: cs.outlineStyle, borderColor: cs.borderTopColor, opacity: cs.opacity, bgs: chain(el), parentBgs: chain(el.parentElement) };
  });

const ratio = (fg: string, bgs: string[]) => contrastRatio(parseColor(fg), effectiveBackground(bgs));

/** Text contrast as seen, with the element's own `opacity` mixed in: dimming a whole control dims its label too. */
function seenRatio(s: Sample): number {
  const op = Number(s.opacity);
  const base = effectiveBackground(s.parentBgs);
  const own = parseColor(s.bgs[0]);
  const fg = parseColor(s.color);
  const seenBg = composite({ ...own, a: own.a * op }, base);
  const seenFg = composite({ ...fg, a: fg.a * op }, base);
  return contrastRatio(seenFg, seenBg);
}

for (const scheme of ['light', 'dark'] as const) {
  test.describe(`${scheme} mode`, () => {
    test.beforeEach(async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
    });

    test('links and the logo name are readable', async ({ page }) => {
      await openEdgarDeck(page);
      const back = await sample(page.getByRole('link', { name: '← Your decks' }));
      expect(ratio(back.color, back.bgs), 'text link').toBeGreaterThanOrEqual(4.5);
      const logo = await sample(page.getByRole('heading', { level: 1 }).locator('span'));
      expect(ratio(logo.color, logo.bgs), 'logo, large text').toBeGreaterThanOrEqual(3);
    });

    test('a pressed Keep chip is readable', async ({ page }) => {
      await openEdgarDeck(page);
      const keep = page.getByRole('button', { name: /^Keep / }).first();
      await keep.click();
      const pressed = page.locator('.keep-toggle[aria-pressed="true"]:visible').first();
      await expect(pressed).toBeVisible();
      const s = await sample(pressed);
      expect(ratio(s.color, s.bgs)).toBeGreaterThanOrEqual(4.5);
    });

    test('"Save $x" on a cheaper replacement is readable', async ({ page }) => {
      await openEdgarDeck(page);
      await findSuggestions(page);
      const panel = suggestionsPanel(page);
      await panel.getByRole('button', { name: 'Cheaper' }).click();
      const save = panel.locator('.save').first();
      await expect(save).toContainText('Save $');
      const s = await sample(save);
      expect(ratio(s.color, s.bgs)).toBeGreaterThanOrEqual(4.5);
    });

    test('the keyboard focus ring is visible on links, buttons and fields', async ({ page }) => {
      await openEdgarDeck(page);
      await page.keyboard.press('Tab'); // so focus counts as keyboard focus (:focus-visible)
      const targets = [page.getByRole('link', { name: '← Your decks' }), page.getByRole('button', { name: 'Rename' }), page.getByRole('combobox', { name: 'Add a card' })];
      for (const target of targets) {
        await target.focus();
        const s = await sample(target);
        expect(s.outlineStyle).not.toBe('none');
        expect(ratio(s.outlineColor, s.parentBgs), 'focus ring').toBeGreaterThanOrEqual(3);
      }
    });

    test('a text field has a border you can see against both the field and the page', async ({ page }) => {
      await openEdgarDeck(page);
      const s = await sample(page.getByRole('combobox', { name: 'Add a card' }));
      expect(ratio(s.borderColor, s.bgs), 'against the field').toBeGreaterThanOrEqual(3);
      expect(ratio(s.borderColor, s.parentBgs), 'against the page').toBeGreaterThanOrEqual(3);
    });

    test('a disabled primary button keeps a readable label and is not just dimmed', async ({ page }) => {
      await page.goto('./#/new');
      const create = page.getByRole('button', { name: 'Create deck' });
      await expect(create).toBeDisabled();
      const s = await sample(create);
      expect(seenRatio(s), 'label as seen').toBeGreaterThanOrEqual(4.5);
      expect(s.opacity, 'a disabled control is restyled, not faded').toBe('1');
    });

    test('the paste box and its focus ring are visible', async ({ page }) => {
      await page.goto('./#/paste');
      const box = page.getByLabel('Decklist');
      const s = await sample(box);
      expect(ratio(s.borderColor, s.bgs), 'textarea border').toBeGreaterThanOrEqual(3);
      await page.keyboard.press('Tab');
      await box.focus();
      const f = await sample(box);
      expect(f.outlineStyle).not.toBe('none');
      expect(ratio(f.outlineColor, f.parentBgs), 'textarea focus ring').toBeGreaterThanOrEqual(3);
    });
  });
}

test('Home shows no empty alert box until there is a message to show', async ({ page }) => {
  await seedEdgarDeck(page);
  await page.goto('./');
  await expect(page.getByRole('button', { name: 'Back up my decks' })).toBeVisible();
  // An empty message slot must paint nothing and take no room: an empty bordered box reads as a broken control...
  const painted = await page.locator('.notice').evaluateAll((els) =>
    els.filter((e) => !e.textContent?.trim() && (e.getBoundingClientRect().width > 1 || e.getBoundingClientRect().height > 1)).length,
  );
  expect(painted).toBe(0);
  // ...but it stays in the accessibility tree (not display:none), so a screen reader announces text added to it later.
  await expect(page.getByRole('alert')).toBeAttached();
  await expect(page.getByRole('alert')).toBeEmpty();
});

// ---- Touch targets (slice 3) ------------------------------------------------------------------

const TARGETS = ['a.back', '.button', '.segment', '.sort', '.link-button', '.keep-toggle', '.icon-button', 'input[type=checkbox]', 'input[type=text]'];

/**
 * For the first and last few visible controls of each kind, taps a 44px square around the control
 * (centre and the four edge midpoints, 21.5px out; corners are left out because rounded controls
 * legitimately don't claim them) and reports every spot that lands on something else. That
 * catches a target that is too small and also one that a neighbour's larger target covers.
 */
async function missedTaps(page: Page): Promise<string[]> {
  return page.evaluate((targets) => {
    const bad: string[] = [];
    const HALF = 21.5;
    for (const sel of targets) {
      const all = [...document.querySelectorAll<HTMLElement>(sel)].filter((e) => e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden');
      for (const el of new Set([...all.slice(0, 6), ...all.slice(-2)])) {
        el.scrollIntoView({ block: 'center' });
        // A checkbox is tapped through the label that wraps it, so the label's box is the target.
        const label = el.closest('label');
        const r = (label ?? el).getBoundingClientRect();
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        for (const [dx, dy] of [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1]]) {
          const hit = document.elementFromPoint(cx + dx * HALF, cy + dy * HALF);
          const ok = !!hit && (hit === el || el.contains(hit) || (!!label && (hit === label || label.contains(hit))));
          if (!ok) {
            const name = (el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 28);
            bad.push(`${sel} "${name}" tap ${dx},${dy} lands on ${hit ? `${hit.tagName}.${hit.className}` : 'nothing'}`);
            break;
          }
        }
      }
    }
    return bad;
  }, TARGETS);
}

test.describe('touch targets', () => {
  test('the phone is treated as a touch device', async ({ page }) => {
    await page.goto('./');
    expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true);
  });

  test('every control in the card list has a 44px target of its own', async ({ page }) => {
    await openEdgarDeck(page);
    expect(await missedTaps(page), 'card list').toEqual([]);
    await findSuggestions(page);
    expect(await missedTaps(page), 'suggestions').toEqual([]);
  });

  test('every control in the card grid has a 44px target of its own', async ({ page }) => {
    await openEdgarDeck(page);
    await page.getByRole('button', { name: 'Grid' }).click();
    await expect(page.locator('.card-tile').first()).toBeVisible();
    // Owned, Keep and remove share one line under each tile; a taller row means one of them wrapped.
    // A pressed Keep chip is bold, so it is the widest case: press one first.
    await page.getByRole('button', { name: /^Keep / }).first().click();
    await expect(page.locator('.keep-toggle[aria-pressed="true"]:visible')).toHaveCount(1);
    const tallest = await page.locator('.card-tools').evaluateAll((rows) => Math.max(...rows.map((r) => r.getBoundingClientRect().height)));
    expect(tallest, 'tallest tool row').toBeLessThanOrEqual(48);
    expect(await missedTaps(page)).toEqual([]);
  });

  test('bigger targets do not make the screen longer to scroll', async ({ page }) => {
    await openEdgarDeck(page);
    await expect(page.locator('table.cards tbody tr').first()).toBeVisible();
    // Measured before this slice on the seeded 100-card deck at Pixel 7 width: list 9318px, grid 16542px.
    // The list must not grow (Keep now shares the printing line); the grid may grow 15% for 44px tool rows.
    const height = () => page.evaluate(() => document.documentElement.scrollHeight);
    expect(await height(), 'list view').toBeLessThanOrEqual(9400);
    await page.getByRole('button', { name: 'Grid' }).click();
    await expect(page.locator('.card-tile').first()).toBeVisible();
    expect(await height(), 'grid view').toBeLessThanOrEqual(19_000);
  });
});

// ---- Cards | Suggestions switch (slice 4) -----------------------------------------------------
// Below 70rem the card list and the suggestions panel share the screen: a bar at the bottom switches
// between them, so suggestions are one tap away instead of a 100-row scroll.


async function findSuggestions(page: Page) {
  await showPane(page, 'Suggestions');
  await suggestionsPanel(page).getByRole('button', { name: 'Find suggestions' }).click();
  await expect(suggestionsPanel(page).getByRole('list', { name: 'Creatures upgrades' }).getByRole('listitem').first()).toBeVisible();
}

test.describe('Cards | Suggestions switch', () => {
  test('suggestions are one tap away from the top of a 100-card list', async ({ page }) => {
    await openEdgarDeck(page);
    const bar = paneBar(page);
    await expect(bar).toBeInViewport();
    await expect(bar.getByRole('button', { name: 'Cards', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('table.cards')).toBeVisible();

    await showPane(page, 'Suggestions');
    await expect(bar.getByRole('button', { name: 'Suggestions', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('table.cards')).toBeHidden();
    await expect(suggestionsPanel(page).getByRole('button', { name: 'Find suggestions' })).toBeInViewport();
  });

  test('the bar stays on screen while you scroll the list', async ({ page }) => {
    await openEdgarDeck(page);
    await page.evaluate(() => window.scrollTo(0, 4000));
    await expect(paneBar(page)).toBeInViewport();
  });

  test('Cards brings the list back where you were', async ({ page }) => {
    await openEdgarDeck(page);
    await page.evaluate(() => window.scrollTo(0, 3000));
    const before = await page.evaluate(() => window.scrollY);
    expect(before).toBeGreaterThan(2000);
    await showPane(page, 'Suggestions');
    await showPane(page, 'Cards');
    await expect.poll(() => page.evaluate((y) => Math.abs(window.scrollY - y), before)).toBeLessThanOrEqual(2);
  });

  test('a card added from suggestions is in the list when you switch back', async ({ page }) => {
    await openEdgarDeck(page);
    await findSuggestions(page);
    await suggestionsPanel(page).getByRole('button', { name: 'Add Indulgent Aristocrat' }).click();
    await expect(page.getByTestId('deck-count')).toHaveText('101 / 100 cards');
    await showPane(page, 'Cards');
    await expect(page.getByTestId('deck-count')).toHaveText('101 / 100 cards');
    await expect(row(page, 'Indulgent Aristocrat')).toHaveCount(1);
  });

  test('a change made in the list updates suggestions while they are hidden', async ({ page }) => {
    await openEdgarDeck(page);
    await findSuggestions(page);
    await suggestionsPanel(page).getByRole('button', { name: 'Cheaper' }).click();
    await expect(suggestionsPanel(page).getByRole('region', { name: 'Cheaper than Minas Tirith' })).toBeVisible();

    await showPane(page, 'Cards');
    await page.getByRole('checkbox', { name: 'Own Minas Tirith' }).check();
    await showPane(page, 'Suggestions');
    await expect(suggestionsPanel(page).getByRole('region', { name: 'Cheaper than Minas Tirith' })).toHaveCount(0);
  });

  test('Undo is still offered after you leave suggestions and come back', async ({ page }) => {
    await openEdgarDeck(page);
    await findSuggestions(page);
    await suggestionsPanel(page).getByRole('button', { name: 'Cheaper' }).click();
    await suggestionsPanel(page).getByRole('button', { name: 'Swap Minas Tirith for Buried Ruin' }).click();
    await expect(suggestionsPanel(page).getByText('Swapped Minas Tirith → Buried Ruin.')).toBeVisible();

    await showPane(page, 'Cards');
    await showPane(page, 'Suggestions');
    await suggestionsPanel(page).getByRole('button', { name: 'Undo' }).click();
    await expect(suggestionsPanel(page).getByText('Swapped Minas Tirith')).toHaveCount(0);
    await expect(suggestionsPanel(page).getByRole('region', { name: 'Cheaper than Minas Tirith' })).toBeVisible();
  });

  test('leaving while a search runs does not lose it', async ({ page }) => {
    await openEdgarDeck(page);
    await showPane(page, 'Suggestions');
    await suggestionsPanel(page).getByRole('button', { name: 'Find suggestions' }).click();
    await showPane(page, 'Cards');
    await showPane(page, 'Suggestions');
    await expect(suggestionsPanel(page)).toContainText(/Searching Scryfall|Budget/);
    await expect(suggestionsPanel(page).getByRole('list', { name: 'Creatures upgrades' }).getByRole('listitem').first()).toBeVisible();
  });

  test('switching panes does not touch the history, so Back still leaves the deck', async ({ page }) => {
    await openEdgarDeck(page);
    const before = await page.evaluate(() => ({ length: history.length, hash: location.hash }));
    await showPane(page, 'Suggestions');
    await showPane(page, 'Cards');
    expect(await page.evaluate(() => ({ length: history.length, hash: location.hash }))).toEqual(before);
  });

  test('the switch keeps keyboard focus on the button you pressed', async ({ page }) => {
    await openEdgarDeck(page);
    await showPane(page, 'Suggestions');
    await expect(paneBar(page).getByRole('button', { name: 'Suggestions', exact: true })).toBeFocused();
  });

  test('List and Grid are only offered where they apply: hidden while Suggestions shows, always on a wide screen', async ({ page }) => {
    await openEdgarDeck(page);
    const view = page.getByRole('group', { name: 'View' });
    await view.getByRole('button', { name: 'Grid' }).click();
    await expect(view).toBeVisible();

    await showPane(page, 'Suggestions');
    await expect(view).toBeHidden(); // it would control a list you cannot see
    await showPane(page, 'Cards');
    await expect(view).toBeVisible();
    await expect(view.getByRole('button', { name: 'Grid' })).toHaveAttribute('aria-pressed', 'true'); // your choice is kept

    await showPane(page, 'Suggestions');
    await page.setViewportSize({ width: 1280, height: 900 });
    await expect(view).toBeVisible(); // side by side: the list is on screen too
  });

  test('a wide screen shows both side by side with no switch, and narrowing keeps your pane', async ({ page }) => {
    await openEdgarDeck(page);
    await showPane(page, 'Suggestions');
    await page.setViewportSize({ width: 1280, height: 900 });
    await expect(paneBar(page)).toBeHidden();
    await expect(page.locator('table.cards')).toBeVisible();
    await expect(suggestionsPanel(page)).toBeVisible();
    await page.setViewportSize({ width: 412, height: 839 });
    await expect(paneBar(page)).toBeVisible();
    await expect(suggestionsPanel(page)).toBeVisible();
    await expect(page.locator('table.cards')).toBeHidden();
  });
});

// ---- Deck header (slice 5) ---------------------------------------------------------------------

test.describe('deck header', () => {
  test('"Still to buy" is the biggest number and the card count sits on the commander line', async ({ page }) => {
    await openEdgarDeck(page);
    const size = (id: string) => page.getByTestId(id).evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    const toBuy = await size('deck-to-buy');
    expect(toBuy, 'still to buy vs deck total').toBeGreaterThan(await size('deck-total'));
    expect(toBuy, 'still to buy vs card count').toBeGreaterThan(await size('deck-count'));
    await expect(page.locator('.deck-head').getByTestId('deck-count')).toHaveText('100 / 100 cards');
    await expect(page.locator('.deck-head')).toContainText('Commander: Edgar Markov');
  });

  test('empty message lines take no space above the cards', async ({ page }) => {
    await openEdgarDeck(page);
    // A message slot that is mounted but empty (copy status, share link, price note) has no height, yet
    // each one still gets a grid gap around it: that was the ~100px hole between the buttons and the stats.
    const gaps = await page.evaluate(() => {
      const section = document.querySelector('main section.stack');
      const out: string[] = [];
      for (const el of section?.querySelectorAll<HTMLElement>('*') ?? []) {
        if (el.closest('.deck-columns, dialog, table')) continue;
        const parent = el.parentElement;
        if (!parent || !/grid|flex/.test(getComputedStyle(parent).display)) continue;
        if (getComputedStyle(el).display === 'none' || el.hidden) continue;
        if (/absolute|fixed/.test(getComputedStyle(el).position)) continue; // out of flow: it gets no grid gap
        if (el.getBoundingClientRect().height === 0) out.push(`${el.tagName}.${el.className || '(no class)'}`);
      }
      return out;
    });
    expect(gaps).toEqual([]);
  });

  test('empty status and alert slots stay in the accessibility tree, so filling them is announced', async ({ page }) => {
    await openEdgarDeck(page);
    const gone = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('[data-tab="decks"] [aria-live], [data-tab="decks"] [role="status"], [data-tab="decks"] [role="alert"]')]
        .filter((el) => !(el.textContent ?? '').trim() && !el.closest('dialog'))
        .filter((el) => getComputedStyle(el).display === 'none' || getComputedStyle(el).visibility === 'hidden')
        .map((el) => `${el.tagName.toLowerCase()}.${el.className || '(no class)'}`),
    );
    expect(gone).toEqual([]);
  });

  test('the first cards are on the first screen', async ({ page }) => {
    await openEdgarDeck(page);
    const top = await page.locator('table.cards thead').evaluate((el) => el.getBoundingClientRect().top + window.scrollY);
    // 696px down at Pixel 7 size before this slice, 520px after: a guard so the header does not creep back down.
    expect(top).toBeLessThanOrEqual(530);
  });

  test('copy, download and share are behind one button, and Escape closes it', async ({ page }) => {
    await openEdgarDeck(page);
    // Counted in the DOM, not by role: a closed dialog's buttons are hidden from role queries, which would make
    // this pass even if the header still had them.
    const outside = await page.locator('button').evaluateAll((els) => els.filter((e) => /Copy deck|Download \.txt/.test(e.textContent ?? '') && !e.closest('dialog')).length);
    expect(outside, 'Copy and Download buttons outside the dialog').toBe(0);
    await page.getByRole('button', { name: 'Share & export' }).click();
    const dialog = page.getByRole('dialog', { name: 'Share & export' });
    await expect(dialog.getByRole('button', { name: 'Copy deck' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Download .txt' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Copy share link' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('button', { name: 'Share & export' })).toBeFocused();
  });
});

test('the browser bar colour follows the colour scheme', async ({ page }) => {
  await page.goto('./');
  const metas = await page.locator('meta[name="theme-color"]').evaluateAll((els) => els.map((e) => ({ content: e.getAttribute('content'), media: e.getAttribute('media') })));
  const find = (scheme: string) => metas.find((m) => m.media === `(prefers-color-scheme: ${scheme})`);
  expect(find('light')?.content).toBe('#ffffff');
  expect(find('dark')?.content).toBe('#242424');
});

// Life Counter, two players face to face (docs/superpowers/plans/2026-11-13-life-counter-slice-1.md, Task 4).
for (const size of [
  { width: 390, height: 844 },
  { width: 360, height: 640 },
]) {
  test(`life counter ${size.width}x${size.height}: the default game is two tall tiles, the top one upside down, nothing clipped`, async ({ page }) => {
    await page.setViewportSize(size);
    await start(page);
    const tiles = page.locator('.tile');
    await expect(tiles).toHaveCount(2);
    await expect(page.locator('.table-row.top .tile')).toHaveAttribute('data-player', '1');
    await expect(page.locator('.table-row.top .tile-inner')).toHaveCSS('transform', /matrix\(-1, ?[^,]*, ?[^,]*, ?-1/);
    await expect(page.locator('.table-row.bottom .tile')).toHaveAttribute('data-player', '0');
    const boxes = await tiles.evaluateAll((els) =>
      els.map((el) => {
        const t = el.getBoundingClientRect();
        const inner = [el.querySelector('.tile-life'), ...el.querySelectorAll('.life-btn')].map((x) => {
          const r = x!.getBoundingClientRect();
          return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, h: r.height };
        });
        return { top: t.top, bottom: t.bottom, left: t.left, right: t.right, h: t.height, inner };
      }),
    );
    const vh = size.height;
    for (const b of boxes) {
      expect(b.h, 'tile height').toBeGreaterThanOrEqual(vh * 0.4);
      expect(b.inner).toHaveLength(3);
      for (const r of b.inner) {
        expect(r.h, 'life number and buttons are at least 44px tall').toBeGreaterThanOrEqual(44);
        expect(r.top).toBeGreaterThanOrEqual(b.top - 0.5);
        expect(r.bottom).toBeLessThanOrEqual(b.bottom + 0.5);
        expect(r.left).toBeGreaterThanOrEqual(b.left - 0.5);
        expect(r.right).toBeLessThanOrEqual(b.right + 0.5);
      }
    }
    // The menu button sits in the middle, between the tiles, and is reachable.
    const menu = page.getByRole('button', { name: 'Game menu' });
    const m = (await menu.boundingBox())!;
    const [topTile, bottomTile] = boxes.map((b) => b).sort((a, b) => a.top - b.top);
    expect(Math.abs(m.x + m.width / 2 - size.width / 2)).toBeLessThan(2);
    expect(m.y + m.height / 2).toBeGreaterThan(topTile.bottom - 2);
    expect(m.y + m.height / 2).toBeLessThan(bottomTile.top + 2);
    await menu.click();
    await expect(page.getByRole('dialog', { name: 'Game menu' })).toBeVisible();
  });
}
