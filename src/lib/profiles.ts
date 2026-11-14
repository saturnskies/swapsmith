import type { ArtRef } from './art';
import { MAX_NAME, sanitizeAccent, sanitizeArt, setAccent, setArt, setName, uint32, type Game, type Player } from './life';

/** Saved pod members: a name with optional card art and accent, dropped into any seat. Pure: no DOM. Kept in the Life store and the backup file. */

export interface Profile {
  id: string;
  name: string;
  art?: ArtRef;
  accent?: string;
}

export const MAX_PROFILES = 12;

const ID_MAX = 64;

/** The name a seat shows when nobody typed one (see `cleanName` in life.ts). */
const DEFAULT_SEAT_NAME = /^Player [1-6]$/;

/** `x` trimmed and cut to MAX_NAME, or null when it is not a string or is blank. */
const cleanName = (x: unknown): string | null => {
  if (typeof x !== 'string') return null;
  const name = x.trim().slice(0, MAX_NAME).trim();
  return name || null;
};

/** A profile's optional art and accent as they should appear on the record: only the ones that are valid. */
function looks(art: unknown, accent: unknown): Pick<Profile, 'art' | 'accent'> {
  const a = sanitizeArt(art);
  const c = sanitizeAccent(accent);
  return { ...(a ? { art: a } : {}), ...(c ? { accent: c } : {}) };
}

/** The profiles `x` describes: bad entries dropped, duplicate ids removed (first wins), names trimmed, at most MAX_PROFILES. Never throws. */
export function sanitizeProfiles(x: unknown): Profile[] {
  if (!Array.isArray(x)) return [];
  const out: Profile[] = [];
  const seen = new Set<string>();
  for (const raw of x) {
    if (out.length >= MAX_PROFILES) break;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const r = raw as Record<string, unknown>;
    const name = cleanName(r.name);
    if (typeof r.id !== 'string' || r.id.length < 1 || r.id.length > ID_MAX || !name || seen.has(r.id)) continue;
    seen.add(r.id);
    out.push({ id: r.id, name, ...looks(r.art, r.accent) });
  }
  return out;
}

/** A profile from a seat's name, art and accent, or null when the name is empty or still the default "Player N". */
export function profileFromSeat(player: Player, id: string): Profile | null {
  const name = cleanName(player.name);
  if (!name || DEFAULT_SEAT_NAME.test(name)) return null;
  return { id, name, ...looks(player.art, player.accent) };
}

/** The list with `p` added at the end, or null when it is full or the id is taken. */
export function addProfile(list: Profile[], p: Profile): Profile[] | null {
  if (list.length >= MAX_PROFILES || list.some((q) => q.id === p.id)) return null;
  return [...list, p];
}

/** The list with one profile renamed (trimmed, at most 24 characters); a blank name or unknown id changes nothing. */
export function renameProfile(list: Profile[], id: string, name: string): Profile[] {
  const clean = cleanName(name);
  if (!clean) return list;
  return list.map((p) => (p.id === id ? { ...p, name: clean } : p));
}

export function deleteProfile(list: Profile[], id: string): Profile[] {
  return list.filter((p) => p.id !== id);
}

/** Copies a profile onto one seat: its name, art and accent, clearing any art or accent the profile lacks. Other seats stay as they are. */
export function applyProfile(game: Game, seat: number, p: Profile): Game {
  return setAccent(setArt(setName(game, seat, p.name), seat, p.art ?? null), seat, p.accent ?? null);
}

/** Merges profiles from a backup into the current ones, never deleting: a shared id keeps the current copy, new ones are added up to the cap and the rest counted as skipped. */
export function mergeProfiles(current: Profile[], incoming: Profile[]): { profiles: Profile[]; added: number; skipped: number } {
  const profiles = [...current];
  const seen = new Set(current.map((p) => p.id));
  let added = 0;
  let skipped = 0;
  for (const p of incoming) {
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    if (profiles.length >= MAX_PROFILES) {
      skipped += 1;
      continue;
    }
    profiles.push(p);
    added += 1;
  }
  return { profiles, added, skipped };
}

/** A new id: `p` and 8 random hex characters. The caller checks it against the list (`addProfile` refuses a taken one). */
export function newProfileId(draw: () => number = uint32): string {
  return `p${draw().toString(16).padStart(8, '0')}`;
}
