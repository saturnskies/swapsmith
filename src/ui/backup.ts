import { backupFileName, BackupError, makeBackup, mergeBackup, parseBackup, readBackupProfiles } from '../lib/backup';
import type { AppContext } from './app';
import { h } from './dom';
import { saveFile } from './saveFile';

const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`;

/** "Back up" and "Restore" for the home screen: decks live only on this device, so this is the safety net. */
export function backupSection(ctx: AppContext): HTMLElement {
  const status = h('p', { class: 'muted small', 'aria-live': 'polite' });
  const alert = h('p', { class: 'notice', role: 'alert' });

  const backBtn = h('button', { type: 'button', class: 'button' }, 'Back up my decks');
  backBtn.addEventListener('click', async () => {
    alert.textContent = '';
    try {
      const profiles = ctx.profiles.get();
      await saveFile(makeBackup(ctx.store, new Date(), profiles), backupFileName(), 'application/json');
      const decks = `${ctx.store.decks.length} deck${ctx.store.decks.length === 1 ? '' : 's'}`;
      status.textContent = `Backup file made with ${decks}${profiles.length ? ` and ${count(profiles.length, 'player profile')}` : ''}. Keep it somewhere safe, like Drive or email to yourself.`;
    } catch (e) {
      // Closing the share sheet rejects on some devices; that is not a failure worth shouting about.
      if (!/cancel|dismiss/i.test(String((e as Error)?.message))) alert.textContent = "Couldn't make the backup file. Try again.";
    }
  });

  const file = h('input', { type: 'file', accept: '.json,application/json', hidden: true, 'aria-label': 'Backup file' }) as HTMLInputElement;
  const restoreBtn = h('button', { type: 'button', class: 'button' }, 'Restore from backup');
  restoreBtn.addEventListener('click', () => file.click());
  file.addEventListener('change', async () => {
    const picked = file.files?.[0];
    file.value = '';
    if (!picked) return;
    alert.textContent = '';
    try {
      const text = await picked.text();
      // The file is read once for the decks (a BackupError here stops everything, as before) and once for the profiles.
      const result = mergeBackup(ctx.store, parseBackup(text));
      const incoming = readBackupProfiles(text);
      let profileNote = '';
      if (incoming.length) {
        // The decks are restored whatever happens to the profiles.
        try {
          const { added, skipped } = ctx.profiles.merge(incoming);
          profileNote = `, ${count(added, 'player profile')} added${skipped ? ` (${skipped} skipped, pod is full)` : ''}`;
        } catch {
          profileNote = '';
        }
      }
      ctx.replaceStore(result.store);
      ctx.refresh();
      // refresh() rebuilt the screen, so show the outcome on the new one.
      const note = document.querySelector('.backup [aria-live]');
      if (note) note.textContent = `Restored: ${count(result.added, 'deck')} added, ${result.updated} updated${profileNote}. Nothing was deleted.`;
    } catch (e) {
      alert.textContent = e instanceof BackupError ? e.message : "Couldn't read that file.";
    }
  });

  return h(
    'section',
    { class: 'backup', 'aria-labelledby': 'backup-h' },
    h('h3', { id: 'backup-h' }, 'Backup and restore'),
    h('p', { class: 'muted small' }, 'Decks are saved on this device only. Make a backup before uninstalling the app or clearing browser data. Saved Life Counter players come along. Restoring adds to what you have and never deletes.'),
    h('div', { class: 'actions' }, backBtn, restoreBtn, file),
    status,
    alert,
  );
}
