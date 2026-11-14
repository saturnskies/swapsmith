import type { Deck } from '../lib/deck';
import { browserStorage, loadStore, saveStore, type Store } from '../lib/storage';
import { createEdhrecClient } from '../edhrec/page';
import { createClient, type NetworkState, type ScryfallClient } from '../scryfall/client';
import { renderDeck, renderShared } from './deckView';
import { lifeRoute, tabOf, type Tab } from '../lib/nav';
import { renderBrowse } from './browse';
import { h } from './dom';
import { renderHome } from './home';
import { createLife } from './life';
import { renderNewDeck } from './newDeck';
import { renderPaste } from './paste';
import { createTabBar } from './tabs';

/** Shared state and actions every screen gets. */
export interface AppContext {
  client: ScryfallClient;
  /** EDHREC's commander pages (ADR-005), on its own slower queue. */
  edhrec: ScryfallClient;
  store: Store;
  persistent: boolean;
  saveDeck(deck: Deck): void;
  deleteDeck(id: string): void;
  /** Remembers the list or grid view for every deck. */
  setView(view: 'list' | 'grid'): void;
  /** Remembers on this device that the first-use note about Owned and Keep was dismissed. */
  dismissHelp(): void;
  go(route: string): void;
  /** Like go, but swaps the current history entry, so back skips the screen we just left. */
  replace(route: string): void;
  /** Redraws the current screen (after the store changed underneath it). */
  refresh(): void;
  /** Overwrites the saved decks (with their owned cards) and view with `next` (used by restore) and saves. */
  replaceStore(next: Store): void;
}

export function startApp(root: HTMLElement): void {
  const storage = browserStorage();
  const { store, persistent } = loadStore(storage);
  const save = () => void saveStore(storage, store);
  /** The Decks screen draws from the store: a change made while another tab shows (a card added from Browse) must redraw it on return. */
  let decksStale = false;
  const touch = () => {
    if (active !== 'decks') decksStale = true;
  };

  let active: Tab | null = null;

  // Said above every tab while prices come from copies saved on this device because Scryfall can't be reached
  // (offline at a game table), and withdrawn as soon as it answers again. Empty, it stays in the page for
  // screen readers but takes no room (ui-state rules).
  const savedNote = h('p', { class: 'notice', role: 'status', 'data-testid': 'saved-prices' });
  const onNetwork = (state: NetworkState) => {
    savedNote.textContent = state === 'saved' ? "Can't reach Scryfall, so these are the prices saved on this device earlier. They may be out of date." : '';
  };

  const ctx: AppContext = {
    client: createClient({ onNetwork }),
    edhrec: createEdhrecClient(),
    store,
    persistent,
    saveDeck(deck) {
      const i = store.decks.findIndex((d) => d.id === deck.id);
      if (i >= 0) store.decks[i] = deck;
      else store.decks.unshift(deck);
      save();
      touch();
    },
    setView(view) {
      store.prefs = { ...store.prefs, view };
      save();
    },
    dismissHelp() {
      store.prefs = { ...store.prefs, helpDismissed: true };
      save();
    },
    deleteDeck(id) {
      store.decks = store.decks.filter((d) => d.id !== id);
      save();
      touch();
    },
    go(route) {
      if (location.hash === route) render(true);
      else location.hash = route;
    },
    replace(route) {
      if (location.hash === route) render(true);
      else location.replace(route);
    },
    refresh: () => render(true),
    replaceStore(next) {
      store.decks = next.decks;
      store.prefs = next.prefs;
      save();
      touch();
    },
  };

  const banner = persistent
    ? null
    : h('p', { class: 'banner', role: 'status' }, "Your browser is blocking storage, so decks won't be saved after you close this tab.");
  // One container per tab. Browse and Life Counter stay mounted and are hidden while another tab shows, so
  // their inputs, scroll and game survive a visit elsewhere. Decks redraws only when its route changes.
  const views: Record<Tab, HTMLElement> = {
    decks: h('div', { class: 'view', 'data-tab': 'decks' }),
    browse: h('div', { class: 'view', 'data-tab': 'browse' }),
    life: h('div', { class: 'view', 'data-tab': 'life' }),
  };
  const view = views.decks;
  root.replaceChildren(...(banner ? [banner] : []), savedNote, ...Object.values(views));
  const bar = createTabBar();
  document.body.append(bar.el);
  renderBrowse(views.browse, ctx, storage);
  const life = createLife(storage, ctx.client);

  /** Where each tab was left (its last route and window scroll), for coming back to it. */
  const last: Record<Tab, string> = { decks: '#/', browse: '#/browse', life: lifeRoute() };
  const scroll: Record<Tab, number> = { decks: 0, browse: 0, life: 0 };
  let decksDrawn: string | null = null;

  /** `force` redraws the Decks screen even when its route is unchanged (the store changed underneath it). */
  function render(force = false) {
    const hash = location.hash || '#/';
    const tab = tabOf(hash);
    if (tab === 'life') {
      // The Life Counter opens into a game, never a setup screen: make sure one exists, then send every Life Counter route to it.
      life.ensureGame();
      if (hash !== lifeRoute()) {
        location.replace(lifeRoute());
        return;
      }
    }
    // A game fills the screen: the stylesheet hides the header, footer and tab bar while this is set.
    document.body.classList.toggle('in-game', tab === 'life');
    const switched = tab !== active;
    if (active && switched) scroll[active] = window.scrollY;
    active = tab;
    last[tab] = hash;
    for (const t of Object.keys(views) as Tab[]) {
      // A modal dialog left open in a view we hide would still block the whole page, unseen.
      if (t !== tab) views[t].querySelectorAll<HTMLDialogElement>('dialog[open]').forEach((d) => d.close());
      views[t].hidden = t !== tab;
    }
    bar.update(tab, last);

    let restore = switched;
    if (tab === 'decks') {
      if (hash === decksDrawn && !force && !decksStale) {
        // Same screen as when we left: keep it as it is.
      } else {
        drawDecks(hash);
        decksDrawn = hash;
        decksStale = false;
        restore = false;
      }
    } else {
      if (tab === 'life') life.render(views.life);
      if (!switched) restore = false;
    }
    window.scrollTo(0, restore ? scroll[tab] : 0);
    // The screen stays awake only while a game is showing.
    life.setAwake(tab === 'life' && life.hasGame());
  }

  function drawDecks(hash: string) {
    const route = hash.replace(/^#/, '') || '/';
    view.replaceChildren();
    if (route.startsWith('d=')) {
      void renderShared(view, ctx, route.slice(2));
      return;
    }
    const deckMatch = route.match(/^\/deck\/([\w-]+)$/);
    if (route === '/paste') renderPaste(view, ctx);
    else if (route === '/new') renderNewDeck(view, ctx);
    else if (deckMatch) renderDeck(view, ctx, deckMatch[1]);
    else renderHome(view, ctx);
  }

  window.addEventListener('hashchange', () => render());
  render();
}
