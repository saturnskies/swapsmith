import type { Deck } from './deck';
import { sanitizeProfiles, type Profile } from './profiles';
import { sanitizeStore, type Store } from './storage';

/** A backup file: the whole store plus a header so we can recognise it and change the format later. */
export interface BackupFile {
  app: 'swapsmith';
  backup: 1;
  exportedAt: string;
  store: Store;
  /** Saved Life Counter profiles; written only when there are some, so an older app ignores the field and an older file has none. */
  profiles?: Profile[];
}

export class BackupError extends Error {}

export function makeBackup(store: Store, now = new Date(), profiles: Profile[] = []): string {
  const file: BackupFile = { app: 'swapsmith', backup: 1, exportedAt: now.toISOString(), store, ...(profiles.length ? { profiles } : {}) };
  return JSON.stringify(file, null, 2);
}

export const backupFileName = (now = new Date()) => `swapsmith-backup-${now.toISOString().slice(0, 10)}.json`;

/** The parsed backup file, checked for the header and a store. Throws BackupError if it is not a Swapsmith backup. */
function readFile(text: string): Partial<BackupFile> & { store: Store } {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new BackupError("That file isn't a Swapsmith backup (it isn't valid JSON).");
  }
  const file = data as Partial<BackupFile> | null;
  if (!file || typeof file !== 'object' || file.app !== 'swapsmith' || file.backup !== 1 || !file.store || typeof file.store !== 'object') {
    throw new BackupError("That file isn't a Swapsmith backup.");
  }
  return file as Partial<BackupFile> & { store: Store };
}

/** Reads a backup file's text. Throws BackupError if it is not a Swapsmith backup; skips decks that are damaged. */
export function parseBackup(text: string): Store {
  return sanitizeStore(readFile(text).store as unknown as Record<string, unknown>);
}

/** The profiles in a backup file's text: none when the field is missing or odd, bad entries dropped. Throws BackupError exactly when `parseBackup` would. */
export function readBackupProfiles(text: string): Profile[] {
  return sanitizeProfiles(readFile(text).profiles);
}

export interface RestoreResult {
  store: Store;
  added: number;
  updated: number;
}

/**
 * Merges a backup into the current store, never deleting a deck: decks only in the backup are added
 * and a deck in both keeps whichever was edited last. Ownership belongs to each deck, so a deck's ticks
 * travel with it and are never mixed between decks. (That means the newer copy's ticks replace the other
 * copy's ticks; they are no longer combined as they were when owned cards were one shared list.)
 */
export function mergeBackup(current: Store, backup: Store): RestoreResult {
  const decks: Deck[] = [...current.decks];
  let added = 0;
  let updated = 0;
  for (const incoming of backup.decks) {
    const i = decks.findIndex((d) => d.id === incoming.id);
    if (i < 0) {
      decks.push(incoming);
      added += 1;
    } else if (incoming.updatedAt > decks[i].updatedAt) {
      decks[i] = incoming;
      updated += 1;
    }
  }
  return { store: { ...current, decks }, added, updated };
}
