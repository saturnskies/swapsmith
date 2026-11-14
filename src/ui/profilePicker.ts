/**
 * The "Use profile" dialog: the saved players as buttons, each with its name and a chip of its accent. Tapping one closes
 * the dialog and hands the profile to `onPick`. Names go in with textContent only.
 */

import type { Profile } from '../lib/profiles';
import { h } from './dom';

const NO_PROFILES = 'No saved players yet. Use Save as profile on a seat.';

let ids = 0;

export function openProfilePicker(o: { host: HTMLElement; profiles: Profile[]; label: string; onPick(p: Profile): void }): void {
  const n = ++ids;
  const close = h('button', { type: 'button', class: 'button' }, 'Close');
  const list = o.profiles.length
    ? h(
        'ul',
        { class: 'profile-list' },
        ...o.profiles.map((p) => {
          const b = h(
            'button',
            { type: 'button', class: 'button profile-pick' },
            h('span', { class: 'swatch-chip', 'aria-hidden': 'true', style: p.accent ? `--chip:${p.accent}` : '' }),
            h('span', { class: 'profile-name' }, p.name),
          );
          b.addEventListener('click', () => {
            dlg.close();
            o.onPick(p);
          });
          return h('li', {}, b);
        }),
      )
    : h('p', { class: 'muted' }, NO_PROFILES);
  const dlg = h('dialog', { class: 'picker sheet profile-picker', 'aria-labelledby': `profile-h-${n}` }, h('h2', { id: `profile-h-${n}` }, `Profile for ${o.label}`), list, h('div', { class: 'actions' }, close));
  close.addEventListener('click', () => dlg.close());
  dlg.addEventListener('close', () => dlg.remove());
  o.host.append(dlg);
  dlg.showModal();
}
