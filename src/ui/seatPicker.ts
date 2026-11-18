/**
 * The Arrange seats dialog: a small copy of the table, one chip per player in the place that player sits. Drag a chip onto
 * another seat (or tap one chip, then another) and the two players trade places. The dialog only reports the swap through
 * `onSwap`; the game changes there, and `players()` is read again to redraw the chips. Names go in with textContent only.
 */

import { PALETTE } from '../lib/life';
import { h } from './dom';

export interface SeatChip {
  name: string;
  /** Index into PALETTE. */
  color: number;
  /** A `#rrggbb` accent that replaces the palette color. */
  accent?: string;
  life: number;
}

const DRAG_START_PX = 6;
let ids = 0;

export function openSeatPicker(o: { host: HTMLElement; layout: { top: number[]; bottom: number[] }; players(): SeatChip[]; onSwap(a: number, b: number): void; onClose?(): void }): void {
  const n = ++ids;
  const status = h('p', { class: 'small muted seat-status', role: 'status' }, 'Drag a player onto another seat, or tap one and then another.');
  const grid = h('div', { class: 'seat-grid', 'data-rows': String(o.layout.top.length ? 2 : 1) });
  const close = h('button', { type: 'button', class: 'button' }, 'Close');
  const dlg = h('dialog', { class: 'picker sheet seat-picker', 'aria-labelledby': `seat-h-${n}` }, h('h2', { id: `seat-h-${n}` }, 'Arrange seats'), status, grid, h('div', { class: 'actions' }, close));
  let selected: number | null = null;
  let justDragged = false;

  const swap = (a: number, b: number) => {
    const before = o.players();
    o.onSwap(a, b);
    selected = null;
    draw();
    status.textContent = `${before[a].name} and ${before[b].name} swapped seats.`;
    grid.querySelector<HTMLElement>(`.seat-chip[data-seat="${b}"]`)?.focus();
  };

  const chip = (seat: number, p: SeatChip) => {
    const b = h(
      'button',
      { type: 'button', class: 'seat-chip', 'data-seat': seat, 'aria-pressed': String(selected === seat), 'aria-label': `${p.name}, ${p.life} life` },
      h('span', { class: 'seat-name' }, p.name),
      h('span', { class: 'seat-life' }, String(p.life)),
    );
    b.style.setProperty('--tile', p.accent ?? PALETTE[p.color].hex);
    b.addEventListener('click', () => {
      if (justDragged) return void (justDragged = false);
      if (selected === null) {
        selected = seat;
        draw();
        status.textContent = `${p.name} selected. Tap the player to swap with.`;
        grid.querySelector<HTMLElement>(`.seat-chip[data-seat="${seat}"]`)?.focus();
      } else if (selected === seat) {
        selected = null;
        draw();
        status.textContent = 'Nothing selected.';
        grid.querySelector<HTMLElement>(`.seat-chip[data-seat="${seat}"]`)?.focus();
      } else swap(selected, seat);
    });
    b.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      const x0 = e.clientX;
      const y0 = e.clientY;
      let moved = false;
      let target: number | null = null;
      b.setPointerCapture(e.pointerId);
      const slotAt = (x: number, y: number) => {
        const slot = document.elementsFromPoint(x, y).find((el): el is HTMLElement => el instanceof HTMLElement && el.classList.contains('seat-slot') && Number(el.dataset.seat) !== seat);
        return slot ?? null;
      };
      const move = (ev: PointerEvent) => {
        const dx = ev.clientX - x0;
        const dy = ev.clientY - y0;
        if (!moved && Math.hypot(dx, dy) < DRAG_START_PX) return;
        moved = true;
        b.classList.add('dragging');
        b.style.transform = `translate(${dx}px, ${dy}px)`;
        const slot = slotAt(ev.clientX, ev.clientY);
        target = slot ? Number(slot.dataset.seat) : null;
        for (const s of grid.querySelectorAll<HTMLElement>('.seat-slot')) s.classList.toggle('target', slot === s);
      };
      const end = () => {
        b.removeEventListener('pointermove', move);
        b.removeEventListener('pointerup', up);
        b.removeEventListener('pointercancel', cancel);
        for (const s of grid.querySelectorAll<HTMLElement>('.seat-slot')) s.classList.remove('target');
        b.classList.remove('dragging');
        b.style.transform = '';
      };
      const up = () => {
        end();
        if (!moved) return;
        justDragged = true; // the click that follows a drag is not a tap
        window.setTimeout(() => (justDragged = false), 0);
        if (target !== null) swap(seat, target);
      };
      const cancel = () => end();
      b.addEventListener('pointermove', move);
      b.addEventListener('pointerup', up);
      b.addEventListener('pointercancel', cancel);
    });
    return b;
  };

  const draw = () => {
    const players = o.players();
    const row = (seats: number[], cls: string) => h('div', { class: `seat-row ${cls}` }, ...seats.map((s) => h('div', { class: 'seat-slot', 'data-seat': s }, chip(s, players[s]))));
    grid.replaceChildren(...(o.layout.top.length ? [row(o.layout.top, 'top')] : []), row(o.layout.bottom, 'bottom'));
  };

  close.addEventListener('click', () => dlg.close());
  dlg.addEventListener('close', () => {
    dlg.remove();
    o.onClose?.();
  });
  draw();
  o.host.append(dlg);
  dlg.showModal();
}
