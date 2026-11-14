/**
 * The art picker: a dialog with a search box (card name or artist), colour, type and Legendary filters and a grid of art
 * crops. Tapping a cell hands that artwork to `onPick`; the dialog closes when `onPick` answers null, and stays open with
 * its message when it answers one. Scryfall is reached only through the shared client (`searchArt`).
 */

import { ART_TYPES, artQuery, type ArtRef } from '../lib/art';
import { COLORS } from '../lib/browse';
import { searchArt } from '../scryfall/art';
import { ScryfallError, type ScryfallClient } from '../scryfall/client';
import { segmented } from './controls';
import { h } from './dom';

const UNREACHABLE = "Couldn't reach Scryfall. Check your connection and try again.";

/**
 * How a failed search is told to the person: a query that cannot be sent or that Scryfall refuses (400) is a problem with
 * what they typed, so it goes on the form beside the box; everything else (offline, rate limited, a server error) is not
 * something typing differently fixes, so it is a status line.
 */
export function searchProblem(e: unknown): { form: boolean; message: string } {
  if (e instanceof ScryfallError) return e.status === 400 ? { form: true, message: e.message } : { form: false, message: UNREACHABLE };
  if (e instanceof Error) return { form: true, message: e.message };
  return { form: false, message: UNREACHABLE };
}

export interface ArtPickerOptions {
  /** Where the dialog is added; it removes itself when closed. */
  host: HTMLElement;
  client: ScryfallClient;
  /** Whose art this is, for the dialog's name ("Art for Player 1"). */
  label: string;
  /** Applies the artwork. Answers null when done, or a message to show while the picker stays open. */
  onPick(ref: ArtRef): Promise<string | null>;
}

let ids = 0;
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function openArtPicker(o: ArtPickerOptions): { close(): void } {
  const n = ++ids;
  const by = { value: 'name' as 'name' | 'artist' };
  const colors = new Set<string>();
  const types = new Set<string>();
  let legendary = false;

  // Counts searches started: a reply for an older one, or one that lands after the picker closed, is dropped.
  let run = 0;
  let searching = false;
  let picking = false;
  let closed = false;
  let query = '';
  let page = 0;
  let shown = 0;

  const errorId = `art-error-${n}`;
  const input = h('input', { type: 'text', autocomplete: 'off', autofocus: true, placeholder: 'Card name', 'aria-label': 'Card name or artist', 'aria-invalid': 'false', 'aria-describedby': errorId }) as HTMLInputElement;
  const error = h('p', { id: errorId, class: 'field-error art-error', role: 'alert' });
  const status = h('p', { class: 'small muted art-status', role: 'status' });
  const warnings = h('p', { class: 'small art-warnings', role: 'status' });
  const note = h('p', { class: 'small art-note', role: 'status' });
  const grid = h('ul', { class: 'art-grid' });
  const more = h('button', { type: 'button', class: 'button', hidden: true }, 'Load more') as HTMLButtonElement;
  const go = h('button', { type: 'submit', class: 'button primary' }, 'Search') as HTMLButtonElement;
  const close = h('button', { type: 'button', class: 'button' }, 'Close');

  const setError = (message: string) => {
    error.textContent = message;
    input.setAttribute('aria-invalid', String(message !== ''));
  };
  const check = (label: string, value: string, set: Set<string>) => {
    const box = h('input', { type: 'checkbox' }) as HTMLInputElement;
    box.addEventListener('change', () => (box.checked ? set.add(value) : set.delete(value)));
    return h('label', { class: 'own-label' }, box, label);
  };
  const legendaryBox = h('input', { type: 'checkbox' }) as HTMLInputElement;
  legendaryBox.addEventListener('change', () => (legendary = legendaryBox.checked));
  const filters = h(
    'details',
    { class: 'more-filters' },
    h('summary', {}, 'Filters'),
    h(
      'div',
      { class: 'filter-grid' },
      h('fieldset', { class: 'checks' }, h('legend', {}, 'Color identity'), ...COLORS.map((c) => check(c.label, c.id, colors))),
      h('fieldset', { class: 'checks' }, h('legend', {}, 'Card type'), ...ART_TYPES.map((t) => check(capital(t), t, types))),
      h('label', { class: 'own-label' }, legendaryBox, 'Legendary'),
    ),
  );
  const switcher = segmented(
    'Search by',
    [
      { id: 'name', label: 'Name' },
      { id: 'artist', label: 'Artist' },
    ],
    'name',
    (id) => {
      by.value = id;
      input.placeholder = id === 'artist' ? 'Artist' : 'Card name';
    },
  );

  const credit = (r: ArtRef) => `${r.name}, art by ${r.artist}`;
  const cell = (r: ArtRef) => {
    const b = h('button', { type: 'button', class: 'art-cell', 'aria-label': credit(r), title: credit(r) }, h('img', { src: r.url, alt: '', loading: 'lazy', decoding: 'async' }));
    b.addEventListener('click', () => void pick(r));
    return h('li', {}, b);
  };

  /** One artwork at a time: a second tap while one is being saved does nothing. */
  async function pick(r: ArtRef) {
    if (picking || closed) return;
    picking = true;
    note.textContent = 'Saving…';
    grid.setAttribute('aria-busy', 'true');
    let message: string | null;
    try {
      message = await o.onPick(r);
    } catch {
      message = "Couldn't save that image. Try another.";
    }
    picking = false;
    if (closed) return;
    grid.removeAttribute('aria-busy');
    note.textContent = message ?? '';
    if (message === null) dlg.close();
  }

  /** One search at a time. `next` asks for the following page of the same query instead of starting over. */
  async function search(next: boolean) {
    if (searching || closed) return;
    let q = query;
    if (!next) {
      const built = artQuery({ text: input.value, by: by.value, colors: [...colors], types: [...types], legendary });
      if (!built.ok) {
        setError(built.error);
        return;
      }
      setError('');
      q = built.q;
    }
    const me = ++run;
    searching = true;
    go.disabled = true;
    more.disabled = true;
    note.textContent = '';
    status.textContent = 'Searching…';
    if (!next) {
      grid.replaceChildren();
      warnings.textContent = '';
      more.hidden = true;
      shown = 0;
    }
    try {
      const res = await searchArt(o.client, q, next ? page + 1 : 1);
      if (me !== run) return;
      query = q;
      page = next ? page + 1 : 1;
      grid.append(...res.cards.map(cell));
      shown += res.cards.length;
      warnings.textContent = res.warnings.join(' ');
      status.textContent = shown > 0 ? `Showing ${shown}` : res.hasMore ? 'No usable art on this page yet.' : 'No art found';
      more.hidden = !res.hasMore;
    } catch (e) {
      if (me !== run) return;
      const problem = searchProblem(e);
      if (problem.form) setError(problem.message);
      status.textContent = problem.form ? '' : problem.message;
    } finally {
      if (me === run) {
        searching = false;
        go.disabled = false;
        more.disabled = false;
      }
    }
  }

  const form = h(
    'form',
    { class: 'stack' },
    h('h2', { id: `art-h-${n}` }, `Art for ${o.label}`),
    input,
    error,
    switcher,
    filters,
    h('div', { class: 'actions' }, go),
    status,
    warnings,
  );
  const dlg = h('dialog', { class: 'picker sheet art-picker', 'aria-labelledby': `art-h-${n}` }, form, note, grid, h('div', { class: 'actions' }, more, close));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    void search(false);
  });
  input.addEventListener('input', () => setError(''));
  more.addEventListener('click', () => void search(true));
  close.addEventListener('click', () => dlg.close());
  dlg.addEventListener('close', () => {
    closed = true;
    // A search still running is for nobody now: its reply must not land.
    run += 1;
    dlg.remove();
  });
  o.host.append(dlg);
  dlg.showModal();
  return { close: () => dlg.close() };
}
