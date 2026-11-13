import { keepAwake, type AwakeDeps, type AwakeState } from '../lib/awake';
import {
  CMDR_LETHAL,
  LIFE_PRESETS,
  MAX_NAME,
  MAX_PLAYERS,
  PALETTE,
  POISON_LETHAL,
  applyChange,
  counter,
  gameFromDefaults,
  loadLife,
  newGame,
  parseStartingLife,
  randomSeat,
  resetGame,
  saveLife,
  seating,
  setColor,
  setFirst,
  setName,
  setPartners,
  undo,
  warnings,
  type Defaults,
  type Target,
} from '../lib/life';
import { segmented } from './controls';
import { h } from './dom';

/** A press this long (ms) counts as a hold: ±10 instead of ±1. */
const HOLD_MS = 500;
/** After a hold registers, the one click that follows its release (a few ms later) is ignored; a deliberate tap after this long is not. */
const SWALLOW_MS = 150;
const UNSAVED = "Your browser is blocking storage, so this game won't be saved if you close the app.";
const AWAKE_MSG = 'Your screen may turn off during the game.';
/** The roll highlights a tile every this many ms, around the table twice and on to the winner. */
const ROLL_STEP_MS = 100;

export interface Life {
  hasGame(): boolean;
  /**
   * Makes sure there is a game to show: the saved one, else a new one from the saved defaults. Safe to call again and again.
   * Under a save from a newer version a default game plays in memory only: `persist()` skips the write, so the newer save's
   * bytes stay untouched until a New game replaces it.
   */
  ensureGame(): void;
  /** Draws the game. Drawn once: the container stays mounted while another tab shows. */
  render(view: HTMLElement): void;
  /** True while the game screen is showing: keeps the screen awake then, and lets go otherwise. */
  setAwake(on: boolean): void;
}

/** A button that changes a counter: tap = ±1, hold = ±10 once, Shift+Enter = ±10. `delta` is 1 or -1. */
function holdButton(o: { text: string; aria: string; delta: 1 | -1; cls: string; onChange: (amount: number) => void }): HTMLButtonElement {
  const b = h('button', { type: 'button', class: o.cls, 'aria-label': o.aria, title: 'Tap for 1, hold for 10' }, o.text);
  let timer = 0;
  let held = false;
  let swallowUntil = 0;
  /** Ends a press. Only a release over the button is followed by a click, so only then is that click swallowed. */
  const stop = (released = false) => {
    window.clearTimeout(timer);
    timer = 0;
    if (held && released) swallowUntil = performance.now() + SWALLOW_MS;
    held = false;
  };
  b.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    stop();
    timer = window.setTimeout(() => {
      timer = 0;
      held = true;
      o.onChange(o.delta * 10);
    }, HOLD_MS);
  });
  b.addEventListener('pointerup', () => stop(true));
  for (const t of ['pointercancel', 'pointerleave']) b.addEventListener(t, () => stop());
  b.addEventListener('click', (e) => {
    if (performance.now() < swallowUntil) {
      swallowUntil = 0;
      return;
    }
    o.onChange(e.shiftKey ? o.delta * 10 : o.delta);
  });
  b.addEventListener('contextmenu', (e) => e.preventDefault());
  return b;
}

const padded = <T,>(items: T[], blank: T): T[] => Array.from({ length: MAX_PLAYERS }, (_, i) => items[i] ?? blank);

/** One row per seat: a name field and the eight color swatches. The in-game edit dialog uses it. */
function playerRows(o: { count: number; name(seat: number): string; color(seat: number): number; onName(seat: number, value: string): void; onColor(seat: number, color: number): void }): HTMLElement {
  return h(
    'div',
    { class: 'player-rows' },
    ...Array.from({ length: o.count }, (_, seat) => {
      const input = h('input', { type: 'text', maxlength: MAX_NAME, autocomplete: 'off', placeholder: `Player ${seat + 1}`, value: o.name(seat), 'aria-label': `Name for player ${seat + 1}` });
      input.addEventListener('input', () => o.onName(seat, input.value));
      const buttons = PALETTE.map((c, i) => {
        const b = h('button', { type: 'button', class: 'swatch', 'aria-label': c.name, 'aria-pressed': String(i === o.color(seat)), style: `--swatch:${c.hex}` });
        b.addEventListener('click', () => {
          o.onColor(seat, i);
          buttons.forEach((x, j) => x.setAttribute('aria-pressed', String(j === i)));
        });
        return b;
      });
      return h('div', { class: 'player-row' }, h('span', { class: 'seat', 'aria-hidden': 'true' }, String(seat + 1)), input, h('div', { class: 'swatches', role: 'group', 'aria-label': `Color for player ${seat + 1}` }, ...buttons));
    }),
  );
}

/** A modal question with two buttons; it removes itself when closed. */
function confirmDialog(host: HTMLElement, o: { id: string; title: string; text: string; keep: string; yes: string; onYes: () => void }) {
  const keep = h('button', { type: 'button', class: 'button' }, o.keep);
  const yes = h('button', { type: 'button', class: 'button primary' }, o.yes);
  const dlg = h('dialog', { class: 'picker', 'aria-labelledby': o.id }, h('h3', { id: o.id }, o.title), h('p', {}, o.text), h('div', { class: 'actions' }, keep, yes));
  dlg.addEventListener('close', () => dlg.remove());
  keep.addEventListener('click', () => dlg.close());
  yes.addEventListener('click', () => {
    dlg.close();
    o.onYes();
  });
  host.append(dlg);
  dlg.showModal();
}

let formIds = 0;

/**
 * The players and starting-life pickers the New game and Defaults sheets share. `value()` is the picked pair, or null while a
 * custom starting life is not a whole number from 1 to 999; `onChange` hears about every change (and once now), so a sheet can
 * enable or disable its button.
 */
function setupForm(initial: Defaults, onChange: (value: Defaults | null) => void): { el: HTMLElement; value(): Defaults | null } {
  const hintId = `life-custom-hint-${++formIds}`;
  let players = initial.players;
  let preset = initial.startingLife;
  let custom = !(LIFE_PRESETS as readonly number[]).includes(preset);
  let text = custom ? String(preset) : '';
  const field = h('input', { type: 'text', inputmode: 'numeric', autocomplete: 'off', value: text, 'aria-describedby': hintId, 'aria-invalid': 'false' }) as HTMLInputElement;
  const hint = h('p', { id: hintId, class: 'small muted life-hint', role: 'status' });
  const label = h('label', { class: 'stack' }, 'Custom starting life', field);
  const value = (): Defaults | null => {
    const startingLife = custom ? parseStartingLife(text) : preset;
    return startingLife == null ? null : { players, startingLife };
  };
  const sync = () => {
    const bad = custom && parseStartingLife(text) == null;
    label.hidden = !custom;
    hint.textContent = bad ? 'Enter a whole number from 1 to 999.' : '';
    field.setAttribute('aria-invalid', String(bad));
    onChange(value());
  };
  field.addEventListener('input', () => {
    text = field.value;
    sync();
  });
  const lifeOptions = [...LIFE_PRESETS.map((n) => ({ id: String(n), label: String(n) })), { id: 'custom', label: 'Custom' }];
  const el = h(
    'div',
    { class: 'stack' },
    h('div', { class: 'stack' }, h('strong', {}, 'Players'), segmented('Players', Array.from({ length: MAX_PLAYERS }, (_, i) => ({ id: String(i + 1), label: String(i + 1) })), String(players), (id) => {
      players = Number(id);
      sync();
    })),
    h(
      'div',
      { class: 'stack' },
      h('strong', {}, 'Starting life'),
      segmented('Starting life', lifeOptions, custom ? 'custom' : String(preset), (id) => {
        custom = id === 'custom';
        if (custom) {
          text = text || String(preset);
          field.value = text;
        } else preset = Number(id);
        sync();
      }),
      label,
      hint,
    ),
  );
  sync();
  return { el, value };
}

/** The Life Counter: the full-screen game at `#/life/game` (its only screen), saved under its own key after every change. */
export function createLife(storage: Storage | null): Life {
  const loaded = loadLife(storage);
  const store = loaded.store;
  /** A newer version's save sits in storage: leave it alone until a new game starts. */
  let future = loaded.future;
  let saved = loaded.persistent;
  let drawn = false;
  let notices: HTMLElement[] = [];
  /** Counts screen draws: a roll started on an older draw must not write into a newer one. */
  let drawId = 0;
  let awakeState: AwakeState | null = null;
  let stopAwake: (() => void) | null = null;
  let awakeNotes: HTMLElement[] = [];

  const notice = () => {
    const n = h('p', { class: 'banner notice', role: 'status' }, saved ? '' : UNSAVED);
    notices.push(n);
    return n;
  };
  const persist = () => {
    if (future) return;
    saved = saveLife(storage, store);
    for (const n of notices) n.textContent = saved ? '' : UNSAVED;
  };

  /** Remembers a seat's name or color for the next game. */
  const remember = (seat: number, patch: { name?: string; color?: number }) => {
    const names = padded(store.setup.names, '');
    const colors = padded(store.setup.colors, -1);
    if (patch.name !== undefined) names[seat] = patch.name.slice(0, MAX_NAME);
    if (patch.color !== undefined) colors[seat] = patch.color;
    store.setup = { ...store.setup, names, colors };
  };
  const awakeNote = () => {
    const n = h('p', { class: 'banner notice', role: 'status' }, awakeState === 'unsupported' || awakeState === 'denied' ? AWAKE_MSG : '');
    awakeNotes.push(n);
    return n;
  };

  function drawGame(view: HTMLElement) {
    const me = ++drawId;
    notices = [];
    const seats = store.game!.players.map((_, i) => i);
    awakeNotes = [];
    const parts = new Map<number, { life: HTMLElement; badges: HTMLElement; warn: HTMLElement; el: HTMLElement; name: HTMLElement; counters: HTMLElement; minus: HTMLElement; plus: HTMLElement }>();

    /** Redraws everything a seat's tile shows from the saved game. */
    const updateTile = (seat: number) => {
      const g = store.game!;
      const p = g.players[seat];
      const t = parts.get(seat)!;
      t.life.textContent = String(p.life);
      t.name.textContent = p.name;
      t.counters.setAttribute('aria-label', `${p.name}: poison and commander damage`);
      t.minus.setAttribute('aria-label', `${p.name}: lose 1 life`);
      t.plus.setAttribute('aria-label', `${p.name}: gain 1 life`);
      t.el.style.setProperty('--tile', PALETTE[p.color].hex);
      t.el.dataset.first = String(g.first === seat);
      const worst = Math.max(0, ...Object.values(p.cmdr));
      t.badges.replaceChildren(...[g.first === seat ? 'Goes first' : null, p.poison > 0 ? `Poison ${p.poison}` : null, worst > 0 ? `Commander ${worst}` : null].filter((x): x is string => !!x).map((x) => h('span', { class: 'badge' }, x)));
      const why = warnings(g, seat);
      t.warn.textContent = why.join(' · ');
      t.el.dataset.warn = String(why.length > 0);
    };
    const updateAll = () => seats.forEach(updateTile);

    /** One change by one player, saved, with that player's tile redrawn. Returns the counter's new value. */
    const adjust = (seat: number, target: Target, delta: number) => {
      store.game = applyChange(store.game!, seat, target, delta);
      updateTile(seat);
      persist();
      return counter(store.game, seat, target);
    };

    const tile = (seat: number, flipped: boolean) => {
      const p = store.game!.players[seat];
      const life = h('output', { class: 'tile-life' }, String(p.life));
      const badges = h('span', { class: 'tile-badges' });
      const warn = h('p', { class: 'tile-warn', 'aria-live': 'polite' });
      const counters = h('button', { type: 'button', class: 'tile-counters', 'aria-label': `${p.name}: poison and commander damage` }, 'Counters');
      counters.addEventListener('click', () => openSheet(seat));
      const btn = (delta: 1 | -1) =>
        holdButton({ text: delta < 0 ? '−' : '+', aria: `${p.name}: ${delta < 0 ? 'lose' : 'gain'} 1 life`, delta, cls: `life-btn ${delta < 0 ? 'minus' : 'plus'}`, onChange: (n) => adjust(seat, { kind: 'life' }, n) });
      const minus = btn(-1);
      const plus = btn(1);
      const nameEl = h('span', { class: 'tile-name' }, p.name);
      const el = h(
        'div',
        { class: 'tile', 'data-player': seat, 'data-rotate': flipped ? '180' : '0', 'data-warn': 'false', 'data-first': 'false', style: `--tile:${PALETTE[p.color].hex}` },
        h(
          'div',
          { class: 'tile-inner' },
          h('div', { class: 'tile-head' }, nameEl, counters),
          h('div', { class: 'tile-mid' }, life, badges, warn),
          h('div', { class: 'tile-buttons' }, minus, plus),
        ),
      );
      parts.set(seat, { life, badges, warn, el, name: nameEl, counters, minus, plus });
      return el;
    };

    /** The per-player sheet: poison, whether the commander has a partner, and damage taken from each opponent's commander. */
    function openSheet(seat: number) {
      const g = store.game!;
      const me = g.players[seat];
      const row = (label: string, target: Target, lethalAt: number) => {
        const value = h('output', { class: 'counter-value' }, String(counter(store.game!, seat, target)));
        const flag = h('span', { class: 'lethal' });
        const el = h('div', { class: 'counter-row', role: 'group', 'aria-label': label }, h('span', { class: 'counter-label' }, label, flag));
        const refresh = (v: number) => {
          value.textContent = String(v);
          flag.textContent = v >= lethalAt ? 'Lethal' : '';
          el.dataset.warn = String(v >= lethalAt);
        };
        const btn = (delta: 1 | -1) => holdButton({ text: delta < 0 ? '−' : '+', aria: `${label}: ${delta < 0 ? 'remove' : 'add'} 1`, delta, cls: 'counter-btn', onChange: (n) => refresh(adjust(seat, target, n)) });
        el.append(btn(-1), value, btn(1));
        refresh(counter(store.game!, seat, target));
        return el;
      };
      const partner = h('input', { type: 'checkbox' }) as HTMLInputElement;
      partner.checked = me.partners;
      partner.addEventListener('change', () => {
        store.game = setPartners(store.game!, seat, partner.checked);
        updateAll();
        persist();
      });
      const rows = seats
        .filter((o) => o !== seat)
        .flatMap((o) => {
          const other = g.players[o];
          const main = row(`Damage from ${other.name}`, { kind: 'cmdr', from: o, slot: 0 }, CMDR_LETHAL);
          return other.partners ? [main, row(`Damage from ${other.name}'s partner`, { kind: 'cmdr', from: o, slot: 1 }, CMDR_LETHAL)] : [main];
        });
      const close = h('button', { type: 'button', class: 'button' }, 'Close');
      const dlg = h(
        'dialog',
        { class: 'picker sheet', 'aria-labelledby': 'sheet-h' },
        h('h2', { id: 'sheet-h' }, `${me.name}: counters`),
        row('Poison', { kind: 'poison' }, POISON_LETHAL),
        h('label', { class: 'check' }, partner, ' Has a partner commander'),
        rows.length ? h('h3', {}, 'Commander damage taken') : null,
        ...rows,
        h('div', { class: 'actions' }, close),
      );
      close.addEventListener('click', () => dlg.close());
      dlg.addEventListener('close', () => dlg.remove());
      view.append(dlg);
      dlg.showModal();
    }

    const { top, bottom } = seating(seats.length);
    const undoBtn = h('button', { type: 'button', class: 'button' }, 'Undo') as HTMLButtonElement;
    const refreshUndo = () => (undoBtn.disabled = store.game!.history.length === 0);
    undoBtn.addEventListener('click', () => {
      store.game = undo(store.game!);
      updateAll();
      refreshUndo();
      persist();
    });
    const reset = h('button', { type: 'button', class: 'button danger' }, 'Reset life totals');
    reset.addEventListener('click', () =>
      confirmDialog(view, {
        id: 'reset-h',
        title: 'Reset all life totals?',
        text: 'Life goes back to the starting total, poison and commander damage clear, and Undo is emptied.',
        keep: 'Keep playing',
        yes: 'Reset',
        onYes: () => {
          store.game = resetGame(store.game!);
          updateAll();
          refreshUndo();
          persist();
        },
      }),
    );
    const edit = h('button', { type: 'button', class: 'button' }, 'Edit names & colors');
    edit.addEventListener('click', () => {
      const closeEdit = h('button', { type: 'button', class: 'button' }, 'Close');
      const dlg = h(
        'dialog',
        { class: 'picker sheet', 'aria-labelledby': 'edit-h' },
        h('h2', { id: 'edit-h' }, 'Edit players'),
        playerRows({
          count: seats.length,
          name: (i) => store.game!.players[i].name,
          color: (i) => store.game!.players[i].color,
          onName: (i, v) => {
            store.game = setName(store.game!, i, v);
            remember(i, { name: v });
            updateAll();
            persist();
          },
          onColor: (i, c) => {
            store.game = setColor(store.game!, i, c);
            remember(i, { color: c });
            updateAll();
            persist();
          },
        }),
        h('div', { class: 'actions' }, closeEdit),
      );
      closeEdit.addEventListener('click', () => dlg.close());
      dlg.addEventListener('close', () => dlg.remove());
      view.append(dlg);
      dlg.showModal();
    });
    /** One roll at a time: the menu closes, the table lights up seat by seat, and the winner is marked and saved. */
    let rolling = false;
    const rollBtn = h('button', { type: 'button', class: 'button' }, 'Roll for first player');
    rollBtn.addEventListener('click', () => {
      if (rolling) return;
      rolling = true;
      open.disabled = true;
      menu.close();
      const seat = randomSeat(seats.length);
      const finish = () => {
        rolling = false;
        open.disabled = false;
        for (const t of parts.values()) t.el.classList.remove('rolling');
        if (me !== drawId || !store.game || seat >= store.game.players.length) return;
        store.game = setFirst(store.game, seat);
        updateAll();
        persist();
      };
      if (seats.length === 1 || matchMedia('(prefers-reduced-motion: reduce)').matches) return finish();
      const steps = 2 * seats.length + seat;
      const tick = (i: number) => {
        for (const t of parts.values()) t.el.classList.remove('rolling');
        if (me !== drawId || i > steps) return finish();
        parts.get(i % seats.length)?.el.classList.add('rolling');
        window.setTimeout(() => tick(i + 1), ROLL_STEP_MS);
      };
      tick(0);
    });
    /** One New game or Defaults sheet at a time: a second tap while one is showing does nothing. */
    let sheetOpen = false;
    const openSetupSheet = (build: () => HTMLDialogElement) => {
      if (sheetOpen) return;
      sheetOpen = true;
      menu.close();
      const dlg = build();
      dlg.addEventListener('close', () => {
        sheetOpen = false;
        dlg.remove();
      });
      view.append(dlg);
      dlg.showModal();
    };

    /** Players and starting life for a fresh game, from the saved defaults. Starting asks first: a game always exists. */
    const newGameDialog = () => {
      const start = h('button', { type: 'submit', class: 'button primary' }, 'Start') as HTMLButtonElement;
      const close = h('button', { type: 'button', class: 'button' }, 'Close');
      const form = setupForm(store.defaults, (v) => (start.disabled = v == null));
      const el = h('form', { class: 'stack' }, h('h2', { id: 'newgame-h' }, 'New game'), notice(), form.el, h('div', { class: 'actions' }, start, close));
      const dlg = h('dialog', { class: 'picker sheet', 'aria-labelledby': 'newgame-h' }, el);
      close.addEventListener('click', () => dlg.close());
      el.addEventListener('submit', (e) => {
        e.preventDefault();
        const picked = form.value();
        if (!picked) return;
        confirmDialog(view, {
          id: 'life-confirm-h',
          title: 'Replace the game in progress?',
          text: 'Its life totals will be lost.',
          keep: 'Keep current game',
          yes: 'Replace it',
          onYes: () => {
            store.setup = { ...store.setup, players: picked.players, startingLife: picked.startingLife };
            store.game = newGame(store.setup);
            future = false;
            persist();
            drawGame(view);
          },
        });
      });
      return dlg;
    };

    /** The pair the Life Counter opens into when there is no saved game, and the form's start for every New game. */
    const defaultsDialog = () => {
      const save = h('button', { type: 'submit', class: 'button primary' }, 'Save defaults') as HTMLButtonElement;
      const useGame = h('button', { type: 'button', class: 'button' }, "Use this game's setup");
      const close = h('button', { type: 'button', class: 'button' }, 'Close');
      const savedNote = h('p', { class: 'small muted saved-note', role: 'status' });
      const holder = h('div', { class: 'stack' });
      let form = { value: (): Defaults | null => null };
      const mount = (d: Defaults) => {
        const f = setupForm(d, (v) => {
          save.disabled = v == null;
          savedNote.textContent = '';
        });
        form = f;
        holder.replaceChildren(f.el);
      };
      mount(store.defaults);
      const el = h('form', { class: 'stack' }, h('h2', { id: 'defaults-h' }, 'Defaults'), h('p', { class: 'small muted' }, 'The players and starting life a new game starts with.'), notice(), holder, h('div', { class: 'actions' }, useGame, save, close), savedNote);
      const dlg = h('dialog', { class: 'picker sheet', 'aria-labelledby': 'defaults-h' }, el);
      close.addEventListener('click', () => dlg.close());
      useGame.addEventListener('click', () => mount({ players: store.game!.players.length, startingLife: store.game!.startingLife }));
      el.addEventListener('submit', (e) => {
        e.preventDefault();
        const picked = form.value();
        if (!picked) return;
        store.defaults = picked;
        persist();
        savedNote.textContent = saved && !future ? 'Saved' : 'Used for now, but not stored.';
      });
      return dlg;
    };

    const newBtn = h('button', { type: 'button', class: 'button' }, 'New game');
    newBtn.addEventListener('click', () => openSetupSheet(newGameDialog));
    const defaultsBtn = h('button', { type: 'button', class: 'button' }, 'Defaults');
    defaultsBtn.addEventListener('click', () => openSetupSheet(defaultsDialog));
    const close = h('button', { type: 'button', class: 'button' }, 'Close');
    const menu = h(
      'dialog',
      { class: 'picker', 'aria-labelledby': 'game-menu-h' },
      h('h2', { id: 'game-menu-h' }, 'Game menu'),
      notice(),
      awakeNote(),
      h('div', { class: 'menu-actions' }, undoBtn, rollBtn, newBtn, defaultsBtn, edit, reset, h('a', { class: 'button', href: '#/' }, 'Leave game'), close),
    );
    close.addEventListener('click', () => menu.close());
    const open = h('button', { type: 'button', class: `table-menu${top.length ? '' : ' corner'}`, 'aria-label': 'Game menu' }, 'Menu');
    open.addEventListener('click', () => {
      refreshUndo();
      menu.showModal();
    });

    view.replaceChildren(
      h('section', { class: 'table', 'aria-label': 'Life totals' }, top.length ? h('div', { class: 'table-row top' }, ...top.map((s) => tile(s, true))) : null, h('div', { class: 'table-row bottom' }, ...bottom.map((s) => tile(s, false))), open, menu),
    );
    updateAll();
  }

  return {
    hasGame: () => !!store.game,
    setAwake(on) {
      if (on && !stopAwake) {
        awakeState = null;
        const deps: AwakeDeps = { wakeLock: (navigator as unknown as { wakeLock?: AwakeDeps['wakeLock'] }).wakeLock, doc: document };
        stopAwake = keepAwake(deps, (state) => {
          awakeState = state;
          for (const n of awakeNotes) n.textContent = state === 'unsupported' || state === 'denied' ? AWAKE_MSG : '';
        });
      } else if (!on && stopAwake) {
        stopAwake();
        stopAwake = null;
      }
    },
    ensureGame() {
      if (!store.game) {
        store.game = gameFromDefaults(store);
        persist();
      }
    },
    render(view) {
      if (drawn) return;
      drawn = true;
      drawGame(view);
    },
  };
}
