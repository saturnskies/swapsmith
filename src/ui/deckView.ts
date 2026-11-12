import { cleanDeckName, deckTotals, newDeckId, savedBracket, type Deck, type DeckEntry } from '../lib/deck';
import { deckFileName, deckToText } from '../lib/export';
import { decodeDeck, encodeDeck, ShareError } from '../lib/share';
import { cardWarnings, DECK_SIZE, isBasicLand, warningText } from '../lib/format';
import { cardImage, compareLines, GROUP_ORDER, groupByType, typeGroup, typeName, type SortKey } from '../lib/groups';
import { deckCollection, isOwned, setOwned as setOwnedIn, stillToBuy } from '../lib/owned';
import { sortPrintings } from '../lib/price';
import { autocompleteNames, cardByName, printings, PRINTINGS_PAGE } from '../scryfall/cards';
import { oracleIdOf, priceDeck, priceEntries, withPrinting, type PricedCard } from '../scryfall/resolve';
import type { ScryCard } from '../scryfall/types';
import type { AppContext } from './app';
import { combobox } from './combobox';
import { undoToast } from './undoToast';
import { helpTip } from './helpTip';
import { paneSwitch } from './panes';
import { saveFile } from './saveFile';
import { cardDialog } from './cardDialog';
import { suggestionsPanel, type SwapPanel } from './suggestions';
import { segmented } from './controls';
import { h, usd } from './dom';

const FINISH_LABEL = { nonfoil: '', foil: 'Foil', etched: 'Etched' } as const;
const SCRYFALL_DOWN = "Couldn't reach Scryfall. Check your connection and try again.";

export function renderDeck(view: HTMLElement, ctx: AppContext, id: string): void {
  const found = ctx.store.decks.find((d) => d.id === id);
  if (!found) {
    view.append(h('section', { class: 'stack' }, h('h2', {}, 'Deck not found'), h('p', {}, 'It may have been deleted, or saved in a different browser.'), h('a', { class: 'button', href: '#/' }, 'Back to your decks')));
    return;
  }
  renderDeckPage(view, ctx, found, false);
}

/** A deck someone shared by link (`#d=<code>`): read-only, with a button to save a copy. */
export async function renderShared(view: HTMLElement, ctx: AppContext, code: string): Promise<void> {
  try {
    const shared = await decodeDeck(code);
    renderDeckPage(view, ctx, { ...shared, id: newDeckId(), format: 'commander', updatedAt: new Date().toISOString() }, true);
  } catch (e) {
    const why = e instanceof ShareError ? e.message : 'This share link could not be opened.';
    view.append(
      h('section', { class: 'stack' }, h('h2', {}, "Couldn't open this shared deck"), h('p', { role: 'alert' }, why, ' Ask for the link again, or check that it was copied in full.'), h('a', { class: 'button', href: '#/' }, 'Go to your decks')),
    );
  }
}

function renderDeckPage(view: HTMLElement, ctx: AppContext, start: Deck, readOnly: boolean): void {
  let deck: Deck = start;
  /** The `updatedAt` of the stored deck as this screen last saw it. */
  let seen = start.updatedAt;
  /**
   * Saves the deck, except for a shared deck that hasn't been saved to this browser. If the stored deck has moved
   * on since this screen last saw it (Browse added a card while this screen sat hidden, mid-pricing), this copy is
   * stale and saving it would put the old deck back; skip it, the app redraws this screen from the store when it
   * is shown again.
   */
  const persist = (d: Deck) => {
    if (readOnly) return;
    const stored = ctx.store.decks.find((x) => x.id === d.id);
    if (stored && stored.updatedAt !== seen) return;
    ctx.saveDeck(d);
    seen = d.updatedAt;
  };
  let priced: PricedCard[] = [];
  let sort: SortKey = 'type';

  const viewSwitch = segmented(
    'View',
    [{ id: 'list', label: 'List' }, { id: 'grid', label: 'Grid' }],
    ctx.store.prefs.view,
    (v) => {
      ctx.setView(v);
      redraw();
    },
    'view-switch',
  );

  const total = h('span', { 'data-testid': 'deck-total' }, '—');
  const toBuy = h('span', { class: 'stat-hero', 'data-testid': 'deck-to-buy' }, '—');
  const count = h('span', { 'data-testid': 'deck-count' }, '—');
  const note = h('p', { class: 'muted' });
  const adder = h('div', { class: 'stack' });
  const body = h('div', { class: 'stack' });

  // ---- Title and rename -----------------------------------------------------------------------
  const titleBox = h('div', { class: 'deck-head' });
  const drawTitle = () => {
    const rename = h('button', { type: 'button', class: 'button small' }, 'Rename');
    rename.addEventListener('click', editTitle);
    titleBox.replaceChildren(
      h('div', { class: 'deck-title-row' }, h('h2', {}, deck.name || 'Shared deck'), readOnly ? null : rename),
      h('p', { class: 'muted' }, `Commander: ${deck.commander.name} · `, count),
    );
    return rename;
  };
  function editTitle() {
    const input = h('input', { type: 'text', 'aria-label': 'Deck name', autocomplete: 'off', maxlength: 80, value: deck.name, class: 'title-input' });
    const error = h('p', { class: 'notice', role: 'alert' });
    const saveBtn = h('button', { type: 'submit', class: 'button primary small' }, 'Save name');
    const cancel = h('button', { type: 'button', class: 'button small' }, 'Cancel');
    const finish = () => drawTitle().focus();
    cancel.addEventListener('click', finish);
    const form = h('form', { class: 'title-edit' }, input, saveBtn, cancel);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const name = cleanDeckName(input.value);
      if (!name) {
        error.textContent = 'Give the deck a name.';
        titleBox.replaceChildren(form, error);
        input.focus();
        return;
      }
      if (name !== deck.name) {
        deck = { ...deck, name, updatedAt: new Date().toISOString() };
        persist(deck);
      }
      finish();
    });
    form.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') finish();
    });
    titleBox.replaceChildren(form);
    input.focus();
    input.select();
  }
  drawTitle();

  // What you own belongs to this deck only: a physical card is in one deck at a time.
  const owned = (p: PricedCard) => isOwned(deckCollection(deck), p.entry.card.oracleId, p.typeLine);
  const summary = () => ({
    ...deckTotals(priced.map((p) => ({ qty: p.entry.qty, price: p.price }))),
    toBuy: stillToBuy(priced.map((p) => ({ qty: p.entry.qty, price: p.price, owned: owned(p) }))),
  });

  let panel: SwapPanel | null = null;
  let swapDialog: ReturnType<typeof cardDialog> | null = null;
  let lastSwap: { removed: PricedCard; index: number; addedOracleId: string; label: string } | null = null;

  // Undo for a removal lives here, on the Cards pane, not in the suggestions panel (a different pane on a phone). The
  // offer holds the deck as it was just before the removal and is dropped by the next change to the cards (`commit`), so
  // Undo can only ever bring back that one removal and never reverts something newer. Ticking Owned does not end it:
  // ownership is stored apart from the cards, which Undo does not touch.
  const removalUndo = undoToast();

  /** Saves the deck and redraws totals, the cards and the suggestions from `priced`. Any edit other than a swap ends the Undo offer. */
  const commit = (cards: DeckEntry[], extra: Partial<Deck> = {}, opts: { keepUndo?: boolean } = {}) => {
    if (!opts.keepUndo) lastSwap = null;
    removalUndo.clear(); // any change ends the removal Undo offer; remove() makes a new one after this
    swapDialog?.root.close(); // its options were worked out for the deck as it was
    deck = { ...deck, ...extra, cards, updatedAt: new Date().toISOString(), summary: summary() };
    persist(deck);
    redraw();
    panel?.refresh();
  };
  const cardsOf = () => priced.filter((x) => !x.isCommander).map((x) => x.entry);

  const redraw = () => {
    const t = summary();
    total.textContent = usd(t.total);
    toBuy.textContent = usd(t.toBuy);
    count.textContent = `${t.count} / ${DECK_SIZE} cards`;
    const failed = priced.filter((p) => p.failed).length;
    note.textContent = failed
      ? `${failed} ${failed === 1 ? 'card' : 'cards'} couldn't be priced because Scryfall didn't answer. Reload the page to try again.`
      : t.unpriced
        ? `${t.unpriced} ${t.unpriced === 1 ? 'card has' : 'cards have'} no TCGplayer price and ${t.unpriced === 1 ? 'is' : 'are'} left out of the total.`
        : '';
    const draw = ctx.store.prefs.view === 'grid' ? grid : table;
    body.replaceChildren(
      draw(priced, sort, {
        onSort: (key) => ((sort = key), redraw()),
        onRemove: remove,
        owned,
        onOwned: (p, value) => {
          const next = setOwnedIn(deckCollection(deck), p.entry.card.oracleId, p.typeLine, value);
          deck = { ...deck, owned: next.owned, unownedBasics: next.unownedBasics, updatedAt: new Date().toISOString() };
          deck = { ...deck, summary: summary() };
          persist(deck);
          redraw();
          panel?.refresh(); // cheaper replacements skip owned cards
        },
        onPrinting: openPicker,
        onOpen: swapDialog ? (p) => swapDialog!.open(p) : undefined,
        onKeep: (p, value) => {
          const entry = { ...p.entry };
          if (value) entry.keep = true;
          else delete entry.keep;
          priced = priced.map((x) => (x === p ? { ...x, entry } : x));
          commit(cardsOf());
        },
        readOnly,
      }),
    );
  };

  // ---- Removing -------------------------------------------------------------------------------
  /** Removes one copy; the last copy removes the card. The commander can't be removed. Offers Undo for 10 s. */
  const remove = (p: PricedCard) => {
    if (p.isCommander) return;
    const before = priced.map((x) => ({ ...x, entry: { ...x.entry } }));
    // A keyboard user cannot reach a toast that is last in the page within 10 s, so hand it focus; touch and mouse
    // users are not moved (a focus ring would only be noise).
    const byKeyboard = !!document.activeElement?.matches(':focus-visible');
    const label = p.entry.qty > 1 ? `one copy of ${p.entry.card.name}` : p.entry.card.name;
    if (p.entry.qty > 1) {
      p.entry = { ...p.entry, qty: p.entry.qty - 1 };
    } else {
      priced = priced.filter((x) => x !== p);
    }
    commit(cardsOf());
    removalUndo.offer(
      `Removed ${label}.`,
      () => {
        priced = before;
        commit(cardsOf()); // also ends the offer
      },
      byKeyboard,
    );
  };

  // ---- Printing picker ------------------------------------------------------------------------
  // A card's printings are loaded when its picker opens (one cached request), not with the deck (ADR-006).
  const picker = h('dialog', { class: 'picker', 'aria-labelledby': 'picker-h' });
  /** Each opening bumps this; a printings reply for a picker that was reopened (or closed) meanwhile is ignored. */
  let pickerRun = 0;
  /** The card as it is in the deck now: it may have been replaced (a Keep, another copy) since the picker opened. */
  const current = (p: PricedCard) => priced.find((x) => x.isCommander === p.isCommander && x.entry.card.oracleId === p.entry.card.oracleId);
  const choosePrinting = (p: PricedCard, printing: ScryCard | undefined) => {
    const now = current(p);
    picker.close();
    if (!now) return;
    const next = withPrinting(now, printing);
    priced = priced.map((x) => (x === now ? next : x));
    if (now.isCommander) commit(cardsOf(), { commanderPrintingId: printing?.id });
    else commit(cardsOf());
  };
  const openPicker = async (p: PricedCard) => {
    const run = ++pickerRun;
    const name = p.entry.card.name;
    const close = h('button', { type: 'button', class: 'button' }, 'Close');
    close.addEventListener('click', () => picker.close());
    const head = h('div', { class: 'picker-head' }, h('h3', { id: 'picker-h' }, `Printings of ${name}`), close);
    picker.replaceChildren(head, h('p', { class: 'muted small', role: 'status' }, 'Loading printings…'));
    if (!picker.open) picker.showModal();

    let prints: ScryCard[];
    try {
      prints = await printings(ctx.client, p.entry.card.oracleId);
    } catch {
      if (run !== pickerRun || !picker.open) return;
      const retry = h('button', { type: 'button', class: 'button' }, 'Try again');
      retry.addEventListener('click', () => void openPicker(p));
      picker.replaceChildren(head, h('p', { class: 'notice', role: 'alert' }, SCRYFALL_DOWN), h('div', { class: 'actions' }, retry));
      return;
    }
    if (run !== pickerRun || !picker.open) return;
    // Re-find after the wait (ui-state rules): the card may have been replaced or removed meanwhile.
    const now = current(p);
    if (!now) return picker.close();
    // The printing in use is always listed, even when it is outside the search (a pinned promo, or past the first page).
    if (now.card && !prints.some((c) => c.id === now.card!.id)) prints = [...prints, now.card];

    const fmt = (v: string | null) => (v ? usd(Number(v)) : null);
    const items = sortPrintings(prints).map((c) => {
      const inUse = c.id === now.card?.id;
      const finishes = [
        fmt(c.prices.usd) && `Nonfoil ${fmt(c.prices.usd)}`,
        fmt(c.prices.usd_foil) && `Foil ${fmt(c.prices.usd_foil)}`,
        fmt(c.prices.usd_etched) && `Etched ${fmt(c.prices.usd_etched)}`,
      ].filter(Boolean);
      const use = h('button', { type: 'button', class: 'button' }, 'Use this printing');
      use.addEventListener('click', () => choosePrinting(now, c));
      return h(
        'li',
        { class: inUse ? 'current' : '' },
        h('div', { class: 'picker-name' }, h('strong', {}, `${c.set.toUpperCase()} #${c.collector_number}`), h('span', { class: 'muted' }, c.set_name)),
        h('span', { class: 'picker-prices' }, finishes.length ? finishes.join(' · ') : 'No price'),
        inUse ? h('span', { class: 'tag' }, 'Current') : use,
      );
    });
    const cheapest = h('button', { type: 'button', class: 'button primary' }, 'Use the cheapest printing');
    cheapest.addEventListener('click', () => choosePrinting(now, undefined));
    picker.replaceChildren(
      head,
      h('p', { class: 'muted small' }, prints.length >= PRINTINGS_PAGE ? `The cheapest ${PRINTINGS_PAGE} printings, cheapest first.` : `${prints.length} paper printings, cheapest first. Prices are each printing's cheapest finish.`),
      h('ul', { class: 'picker-list' }, ...items),
      h('div', { class: 'actions' }, now.entry.printingId ? cheapest : null),
    );
  };

  // ---- Adding ---------------------------------------------------------------------------------
  /** Prices one new card from the card object already in hand (no lookup by name). */
  const priceCard = async (card: ScryCard) => {
    const oid = oracleIdOf(card);
    const [p] = await priceEntries(ctx.client, [{ entry: { card: { oracleId: oid, name: card.name }, qty: 1 }, isCommander: false }], undefined, new Map([[oid, card]]));
    return p;
  };
  const add = async (card: ScryCard) => {
    const oid = oracleIdOf(card);
    const bump = (p: PricedCard) => (p.entry = { ...p.entry, qty: p.entry.qty + 1 });
    const find = () => priced.find((p) => !p.isCommander && p.entry.card.oracleId === oid);
    const existing = find();
    if (existing) {
      bump(existing);
    } else {
      const added = await priceCard(card);
      // Re-find after the wait (ui-state rules): the deck may have changed while pricing, with a removal, an Undo or
      // the same card added twice. Build on the deck as it is now, not as it was when the pick started.
      const now = find();
      if (now) bump(now);
      else priced = [...priced, added];
    }
    commit(cardsOf());
  };

  // ---- Swapping (from suggestions) ------------------------------------------------------------
  let swapping = false;
  /**
   * Replaces a deck card with a suggested card; Undo puts it back. One swap at a time, and the cut is
   * found again by Oracle ID after pricing, since the deck may have changed meanwhile.
   */
  const swap = async (cutId: string, card: ScryCard) => {
    if (swapping) return;
    swapping = true;
    try {
      const added = await priceCard(card);
      const index = priced.findIndex((x) => !x.isCommander && x.entry.card.oracleId === cutId);
      if (index < 0 || priced.some((x) => x.entry.card.oracleId === added.entry.card.oracleId)) return; // already swapped or added
      const removed = priced[index];
      priced = [...priced.slice(0, index), ...priced.slice(index + 1), added];
      commit(cardsOf(), {}, { keepUndo: true });
      lastSwap = { removed, index, addedOracleId: added.entry.card.oracleId, label: `${removed.entry.card.name} → ${card.name}` };
      panel?.refresh();
    } finally {
      swapping = false;
    }
  };
  /**
   * A swap made from the card dialog (opened on the Cards pane), which also offers Undo here: the suggestions panel's own
   * Undo banner is in another pane on a phone. Both end together, since `undo` and `commit` clear this offer.
   */
  const swapFromDialog = async (cutId: string, card: ScryCard) => {
    const earlier = lastSwap;
    const byKeyboard = !!document.activeElement?.matches(':focus-visible'); // as remove(): a keyboard user can't reach the bar in time
    await swap(cutId, card);
    // A swap that bailed leaves `lastSwap` as it was; offer Undo only for the one just made.
    if (lastSwap && lastSwap !== earlier) removalUndo.offer(`Swapped ${lastSwap.label}.`, undo, byKeyboard);
  };
  const undo = () => {
    if (!lastSwap) return;
    const { removed, index, addedOracleId } = lastSwap;
    priced = priced.filter((x) => x.isCommander || x.entry.card.oracleId !== addedOracleId);
    priced.splice(Math.min(index, priced.length), 0, removed);
    commit(cardsOf()); // also ends the Undo offer
  };

  const warningBox = h('div', { class: 'warning-box' });
  const status = h('p', { class: 'muted small', 'aria-live': 'polite' });
  const search = combobox<string>({
    id: 'add-card',
    label: 'Add a card',
    placeholder: 'Start typing a card name',
    search: (typed) => autocompleteNames(ctx.client, typed),
    render: (name) => ({ label: name }),
    onPick: async (name) => {
      search.clear();
      warningBox.replaceChildren();
      status.textContent = `Adding ${name}…`;
      try {
        const card = await cardByName(ctx.client, name);
        if (!card) {
          status.textContent = `Scryfall has no card named ${name}.`;
          return;
        }
        const commander = priced.find((p) => p.isCommander)?.card;
        const warnings = cardWarnings(
          {
            oracleId: oracleIdOf(card),
            name: card.name,
            typeLine: card.type_line ?? card.card_faces?.[0]?.type_line ?? '',
            colorIdentity: card.color_identity ?? [],
            commanderLegality: card.legalities?.commander,
          },
          { colorIdentity: commander?.color_identity ?? [], oracleIds: new Set(priced.map((p) => p.entry.card.oracleId)) },
        );
        if (!warnings.length) {
          await add(card);
          status.textContent = `Added ${card.name}.`;
          return;
        }
        status.textContent = '';
        const yes = h('button', { type: 'button', class: 'button' }, 'Add anyway');
        const no = h('button', { type: 'button', class: 'button' }, 'Cancel');
        yes.addEventListener('click', async () => {
          warningBox.replaceChildren();
          await add(card);
          status.textContent = `Added ${card.name}.`;
          search.input.focus();
        });
        no.addEventListener('click', () => {
          warningBox.replaceChildren();
          search.input.focus();
        });
        warningBox.replaceChildren(
          h('div', { class: 'notice stack', role: 'alert' }, ...warnings.map((w) => h('p', {}, warningText(w, card.name, deck.commander.name))), h('div', { class: 'actions' }, yes, no)),
        );
        yes.focus();
      } catch {
        status.textContent = SCRYFALL_DOWN;
      }
    },
  });

  // ---- Delete deck ----------------------------------------------------------------------------
  const confirmBox = h('div', { class: 'actions' });
  const del = h('button', { type: 'button', class: 'button danger' }, 'Delete deck');
  del.addEventListener('click', () => {
    const yes = h('button', { type: 'button', class: 'button danger' }, `Yes, delete ${deck.name}`);
    const no = h('button', { type: 'button', class: 'button' }, 'Cancel');
    yes.addEventListener('click', () => {
      ctx.deleteDeck(deck.id);
      ctx.replace('#/');
    });
    no.addEventListener('click', () => confirmBox.replaceChildren(del));
    confirmBox.replaceChildren(h('span', {}, 'Delete this deck? This cannot be undone.'), yes, no);
  });
  confirmBox.append(del);

  // On wide screens the upgrades panel sits beside the cards; below 70rem a bar switches between the two.
  // The card list and, above it, the first-use note about Owned and Keep (one column, so the panel beside it stays put).
  const cardsPane = h('div', { class: 'stack' }, body);
  const columns = h('div', { class: 'deck-columns' }, cardsPane);

  // ---- Sharing --------------------------------------------------------------------------------
  const shareBox = h('div', { class: 'stack' });
  const shareBtn = h('button', { type: 'button', class: 'button' }, 'Copy share link');
  shareBtn.addEventListener('click', async () => {
    const link = `${location.origin}${location.pathname}#d=${await encodeDeck(deck)}`;
    const field = h('input', { type: 'text', readonly: true, value: link, 'aria-label': 'Share link', class: 'share-field' });
    const msg = h('p', { class: 'muted small', role: 'status' });
    shareBox.replaceChildren(field, msg);
    try {
      await navigator.clipboard.writeText(link);
      msg.textContent = 'Link copied. Anyone with it can see this deck and save a copy. Your owned cards are not included.';
    } catch {
      field.select();
      msg.textContent = 'Copy the link above. Anyone with it can see this deck and save a copy. Your owned cards are not included.';
    }
  });

  // ---- Exporting ------------------------------------------------------------------------------
  const exportMsg = h('p', { class: 'muted small', role: 'status' });
  const copyBtn = h('button', { type: 'button', class: 'button' }, 'Copy deck');
  copyBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(deckToText(deck));
      exportMsg.textContent = 'Deck copied.';
    } catch {
      exportMsg.textContent = "Couldn't copy. Use Download .txt instead.";
    }
  });
  const downloadBtn = h('button', { type: 'button', class: 'button' }, 'Download .txt');
  downloadBtn.addEventListener('click', async () => {
    try {
      await saveFile(deckToText(deck), deckFileName(deck), 'text/plain');
      exportMsg.textContent = 'Deck list saved.';
    } catch (e) {
      // Closing the share sheet rejects on some devices; that is not an error.
      if (!/cancel|dismiss/i.test(String((e as Error)?.message))) exportMsg.textContent = "Couldn't save the deck list. Try again.";
    }
  });

  // Copy, download and the share link live behind one button, so the header stays short. A shared
  // (read-only) deck can still be exported but has no link of its own to make.
  const options = h('dialog', { class: 'picker', 'aria-labelledby': 'options-h' });
  const closeOptions = h('button', { type: 'button', class: 'button' }, 'Close');
  closeOptions.addEventListener('click', () => options.close());
  options.append(
    h('div', { class: 'picker-head' }, h('h3', { id: 'options-h' }, readOnly ? 'Export' : 'Share & export'), closeOptions),
    h('div', { class: 'actions' }, copyBtn, downloadBtn, readOnly ? null : shareBtn),
    exportMsg,
    shareBox,
  );
  const openOptions = h('button', { type: 'button', class: 'button' }, readOnly ? 'Export' : 'Share & export');
  openOptions.addEventListener('click', () => options.showModal());

  const save = h('button', { type: 'button', class: 'button primary' }, 'Save to my decks');
  save.addEventListener('click', () => {
    ctx.saveDeck(deck);
    ctx.replace(`#/deck/${deck.id}`);
  });
  const sharedBanner = h('div', { class: 'banner row-between' }, h('p', {}, 'A shared deck. Save it to change it or track your cards.'), save);

  view.append(
    h(
      'section',
      { class: 'stack' },
      h('a', { href: '#/', class: 'back' }, '← Your decks'),
      readOnly ? sharedBanner : null,
      titleBox,
      // What you came for is what is left to buy; the deck total is context, and the card count sits on the commander line.
      h(
        'div',
        { class: 'row-between stat-row' },
        h('div', { class: 'stat-main' }, h('span', { class: 'stat-label' }, 'Still to buy'), toBuy, h('span', { class: 'stat-sub' }, 'Deck total ', total)),
        openOptions,
      ),
      note,
      adder,
      columns,
      readOnly ? null : confirmBox,
      picker,
      options,
      removalUndo.root,
    ),
  );

  // ---- First load -----------------------------------------------------------------------------
  const progress = h('progress', { max: 1, value: 0, 'aria-label': 'Pricing progress' });
  const progressText = h('span', { class: 'muted' });
  body.append(h('div', { class: 'progress', role: 'status' }, progress, progressText));
  priceDeck(ctx.client, deck, (done, all) => {
    progress.max = all;
    progress.value = done;
    progressText.textContent = `Pricing ${done} of ${all} cards…`;
  })
    .then((result) => {
      priced = result;
      deck = { ...deck, summary: summary() };
      persist(deck);
      if (readOnly) adder.append(viewSwitch);
      else {
        adder.append(search.root, warningBox, status, viewSwitch);
        columns.classList.add('with-panel');
        panel = suggestionsPanel(ctx, () => priced, {
          add,
          swap,
          undo,
          lastSwap: () => lastSwap?.label ?? null,
          collection: () => deckCollection(deck),
          onSearch: (state) => panes.setSearch(state),
          bracket: () => savedBracket(deck),
          // Saved quietly: not a deck edit, so it neither redraws the cards nor ends the Undo offer.
          setBracket: (bracket) => {
            deck = { ...deck, bracket };
            persist(deck);
          },
        });
        columns.append(panel.root);
        swapDialog = cardDialog(panel, swapFromDialog);
        picker.after(swapDialog.root);
        const panes = paneSwitch(columns, panel.root);
        columns.after(panes.root);
        if (!ctx.store.prefs.helpDismissed) cardsPane.prepend(helpTip(() => ctx.dismissHelp()));
      }
      redraw();
    })
    .catch((err: unknown) => {
      console.error('Swapsmith: pricing failed', err);
      body.replaceChildren(h('p', { class: 'notice', role: 'alert' }, "Couldn't reach Scryfall to price this deck. Check your connection and reload."));
    });
}

interface TableHandlers {
  onSort: (k: SortKey) => void;
  onRemove: (p: PricedCard) => void;
  owned: (p: PricedCard) => boolean;
  onOwned: (p: PricedCard, owned: boolean) => void;
  onPrinting: (p: PricedCard) => void;
  onKeep: (p: PricedCard, keep: boolean) => void;
  /** Opens the card dialog (similar cards that fit); absent for a shared deck, which has no suggestions. */
  onOpen?: (p: PricedCard) => void;
  /** A shared deck: no owned ticks, removing or changing printings. */
  readOnly?: boolean;
}

/** The controls every card gets in both views: link, owned tick, printing button, remove button. */
function cardControls(p: PricedCard, { onRemove, owned, onOwned, onPrinting, onKeep, onOpen, readOnly }: TableHandlers) {
  const name = p.entry.card.name;
  const printing = p.card ? `${p.card.set.toUpperCase()} #${p.card.collector_number}` : '—';
  const finish = p.finish ? FINISH_LABEL[p.finish] : '';
  const link = (...children: Array<Node | string>) =>
    p.url ? h('a', { href: p.url, target: '_blank', rel: 'noopener' }, ...children) : h('span', {}, ...children);
  /**
   * The card's name: a button that opens the card dialog (where the TCGplayer link now lives) for cards that can be
   * swapped; the commander, basic lands, cards without Scryfall data and shared decks keep the plain TCGplayer link.
   */
  const nameControl = () => {
    if (readOnly || !onOpen || p.isCommander || isBasicLand(p.typeLine) || !p.card) return link(name);
    const btn = h('button', { type: 'button', class: 'name-button', title: 'Similar cards that fit this deck' }, name);
    btn.addEventListener('click', () => onOpen(p));
    return btn;
  };
  const own = () => {
    if (readOnly) return null;
    const box = h('input', { type: 'checkbox', 'aria-label': `Own ${name}`, checked: owned(p) });
    box.addEventListener('change', () => onOwned(p, box.checked));
    return box;
  };
  const printingControl = () => {
    if (readOnly || !p.cheapest) return h('span', {}, printing);
    const btn = h('button', { type: 'button', class: 'link-button', 'aria-label': `Change printing of ${name}`, title: 'Change printing' }, printing, ' ▾');
    btn.addEventListener('click', () => onPrinting(p));
    return btn;
  };
  const finishTag = () => (finish ? h('span', { class: 'tag' }, finish) : null);
  const remove = () => {
    if (readOnly || p.isCommander) return null;
    const btn = h('button', { type: 'button', class: 'icon-button', 'aria-label': `Remove ${name}`, title: p.entry.qty > 1 ? 'Remove one copy' : 'Remove from deck' }, '×');
    btn.addEventListener('click', () => onRemove(p));
    return btn;
  };
  /** "Keep" pins a card so suggestions never offer to cut or replace it. */
  const keepToggle = () => {
    if (readOnly || p.isCommander || isBasicLand(p.typeLine)) return null;
    const kept = !!p.entry.keep;
    const btn = h('button', { type: 'button', class: 'keep-toggle', 'aria-pressed': String(kept), 'aria-label': `Keep ${name}`, title: kept ? 'Kept: never suggested as a cut' : 'Keep: never suggest cutting this card' }, 'Keep');
    btn.addEventListener('click', () => onKeep(p, !kept));
    return btn;
  };
  const priceText = p.price != null ? usd(p.price) : p.failed ? "couldn't load" : 'no price';
  return { name, link, nameControl, own, printingControl, finishTag, remove, keepToggle, priceText };
}

/** What a card name does: a shared deck's names are TCGplayer links; otherwise they open the card dialog, which has the link. */
const nameNote = (handlers: TableHandlers) => (handlers.onOpen && !handlers.readOnly ? 'Tap a card name for similar cards and its TCGplayer link.' : 'Card names open TCGplayer in a new tab.');

const asLine = (p: PricedCard) => ({ name: p.entry.card.name, typeLine: p.typeLine, qty: p.entry.qty, price: p.price, isCommander: p.isCommander, p });

/** Card images grouped by type, commander first. */
function grid(priced: PricedCard[], sort: SortKey, handlers: TableHandlers): HTMLElement {
  const groups = groupByType(priced.map(asLine), sort === 'price' ? 'price' : 'name');
  return h(
    'div',
    { class: 'stack' },
    ...groups.map(({ group, count, cards }) =>
      h(
        'section',
        { class: 'grid-group', 'aria-label': group },
        h('h3', {}, `${group} (${count})`),
        h(
          'ul',
          { class: 'card-grid' },
          ...cards.map(({ p }) => {
            const c = cardControls(p, handlers);
            const src = cardImage(p.card);
            const art = src
              ? h('img', { src, alt: c.name, loading: 'lazy', width: 488, height: 680 })
              : h('div', { class: 'card-missing', role: 'img', 'aria-label': c.name }, c.name);
            return h(
              'li',
              { class: 'card-tile' },
              h('div', { class: 'card-art' }, c.link(art), p.entry.qty > 1 ? h('span', { class: 'qty-badge' }, `×${p.entry.qty}`) : null),
              h('div', { class: 'card-meta' }, h('span', { class: 'card-tile-name' }, c.nameControl()), h('span', { class: 'card-tile-price' }, c.priceText)),
              h('div', { class: 'card-printing' }, c.printingControl(), c.finishTag()),
              handlers.readOnly ? null : h('div', { class: 'card-tools' }, h('label', { class: 'own-label' }, c.own(), 'Owned'), c.keepToggle(), c.remove()),
            );
          }),
        ),
      ),
    ),
    h('p', { class: 'muted small' }, `Card images from Scryfall. Prices are TCGplayer market prices for the cheapest printing. ${nameNote(handlers)}`),
  );
}

function table(priced: PricedCard[], sort: SortKey, handlers: TableHandlers): HTMLElement {
  const { onSort } = handlers;
  const byName = compareLines('name');
  const sorted = [...priced].sort((a, b) => {
    if (a.isCommander !== b.isCommander) return a.isCommander ? -1 : 1;
    if (sort === 'type') {
      const d = GROUP_ORDER.indexOf(typeGroup(a.typeLine)) - GROUP_ORDER.indexOf(typeGroup(b.typeLine));
      if (d) return d;
    }
    return compareLines(sort === 'price' ? 'price' : 'name')(asLine(a), asLine(b)) || byName(asLine(a), asLine(b));
  });

  const th = (key: SortKey | null, label: string, cls = '') => {
    if (!key) return h('th', { scope: 'col', class: cls }, label);
    const btn = h('button', { type: 'button', class: 'sort' }, label);
    btn.addEventListener('click', () => onSort(key));
    return h('th', { scope: 'col', class: cls, 'aria-sort': sort === key ? (key === 'price' ? 'descending' : 'ascending') : 'none' }, btn);
  };

  const rows = sorted.map((p) => {
    const c = cardControls(p, handlers);
    const nameEl = c.nameControl();
    nameEl.setAttribute('data-testid', 'card-name');
    return h(
      'tr',
      {},
      h(
        'td',
        { class: 'name' },
        nameEl,
        // On phones the Qty column is hidden, so several copies show as ×N beside the name.
        p.entry.qty > 1 ? h('span', { class: 'qty-mark' }, `×${p.entry.qty}`) : null,
        p.isCommander ? h('span', { class: 'tag' }, 'Commander') : null,
        h('span', { class: 'hide-narrow' }, c.keepToggle()),
        // On phones the Printing column is hidden, so the printing shows under the name, in one row with
        // Keep: stacked small controls would need overlapping touch targets.
        h('div', { class: 'show-narrow sub' }, c.printingControl(), c.keepToggle(), c.finishTag()),
      ),
      h('td', { class: 'type hide-narrow' }, p.isCommander ? 'Commander' : typeName(p.typeLine)),
      h('td', { class: 'printing hide-narrow' }, c.printingControl(), c.finishTag()),
      h('td', { class: 'num hide-narrow' }, p.entry.qty),
      h('td', { class: 'num' }, c.priceText),
      h('td', { class: 'num hide-narrow' }, p.price == null ? '—' : usd(p.price * p.entry.qty)),
      // The label is the touch target: the checkbox alone is too small to hit reliably.
      handlers.readOnly ? null : h('td', { class: 'owned' }, h('label', { class: 'own-cell' }, c.own())),
      handlers.readOnly ? null : h('td', { class: 'remove' }, c.remove()),
    );
  });
  return h(
    'div',
    { class: 'stack' },
    h(
      'div',
      { class: 'table-wrap' },
      h(
        'table',
        { class: 'cards' },
        h(
          'thead',
          {},
          h('tr', {}, th('name', 'Card'), th('type', 'Type', 'hide-narrow'), th(null, 'Printing', 'hide-narrow'), th(null, 'Qty', 'num hide-narrow'), th('price', 'Price', 'num'), th(null, 'Line total', 'num hide-narrow'), handlers.readOnly ? null : th(null, 'Owned', 'owned'), handlers.readOnly ? null : h('th', { scope: 'col' }, h('span', { class: 'visually-hidden' }, 'Remove'))),
        ),
        h('tbody', {}, ...rows),
      ),
    ),
    h('p', { class: 'muted small' }, `Prices are TCGplayer market prices for the cheapest printing, via Scryfall. ${nameNote(handlers)}`),
  );
}

