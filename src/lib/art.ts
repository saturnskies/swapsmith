/** Card art for Life Counter seats: the reference type, the search query, color sampling and the cache plan. Pure: no DOM, no network. */

import { MAX_QUERY, quote } from './browse';
import { contrastWithWhite } from './life';
import type { ScryCard } from '../scryfall/types';

/** One artwork of one card. `id` is Scryfall's `illustration_id`; `url` is the `art_crop` link, used only to fetch the image and as its cache key. */
export interface ArtRef {
  id: string;
  cardId: string;
  name: string;
  artist: string;
  url: string;
}

const TEXT_MAX = 80;

/** Opacity of the black scrim over art. White text on the brightest art under it is white on a 40% grey, 5.7:1 (checked in tests). */
export const SCRIM_ALPHA = 0.6;

/**
 * The art of a card, or null when it has no `illustration_id`, no artist or no art crop. A two-faced card has no
 * `illustration_id` or `image_uris` of its own (Scryfall puts them on the faces, checked 2026-11-13), so the first
 * face's are used; the artist comes from the card, else the first face.
 */
export function artRefOf(card: ScryCard): ArtRef | null {
  const face = card.card_faces?.[0];
  const url = card.image_uris?.art_crop ?? face?.image_uris?.art_crop;
  const illustration = card.illustration_id ?? face?.illustration_id;
  const artist = (card.artist ?? face?.artist)?.trim().slice(0, TEXT_MAX).trim();
  const name = card.name?.trim().slice(0, TEXT_MAX).trim();
  if (!illustration || !card.id || !artist || !name || !url) return null;
  return { id: illustration, cardId: card.id, name, artist, url };
}

/** The card types the picker offers, in the order they are written into a query. */
export const ART_TYPES = ['creature', 'land', 'artifact', 'enchantment', 'instant', 'sorcery', 'planeswalker'] as const;

const WUBRG = ['W', 'U', 'B', 'R', 'G'] as const;

export interface ArtSearch {
  text: string;
  by: 'name' | 'artist';
  /** Color letters W U B R G, or C for colorless. */
  colors: readonly string[];
  /** Entries of ART_TYPES; anything else is ignored. */
  types: readonly string[];
  legendary: boolean;
}

export type ArtQueryResult = { ok: true; q: string } | { ok: false; error: string };

/** True for a word with nothing in it but quotes and backslashes. */
const onlyQuotes = (s: string) => /^["\\]+$/.test(s);

/**
 * The Scryfall query for the art picker. User text is quoted and escaped; colors use includes mode (`id>=wub`),
 * colorless alone is `id=c`. With no text and no filter it is `game:paper`, so the grid starts with something;
 * any other search adds no game filter. Nothing is ever truncated: a query over MAX_QUERY is refused.
 */
export function artQuery(s: ArtSearch): ArtQueryResult {
  const parts: string[] = [];
  const text = s.text.trim().split(/\s+/).filter(Boolean);
  if (text.length) {
    const words = text.filter((w) => !onlyQuotes(w));
    if (!words.length) return { ok: false, error: 'Type a name or artist; quotes and backslashes alone cannot be searched.' };
    parts.push(s.by === 'artist' ? `a:${quote(words.join(' '))}` : words.map((w) => `name:${quote(w)}`).join(' '));
  }

  const colors = WUBRG.filter((c) => s.colors.includes(c));
  if (colors.length) parts.push(`id>=${colors.join('').toLowerCase()}`);
  else if (s.colors.includes('C')) parts.push('id=c');

  const types = ART_TYPES.filter((t) => s.types.includes(t)).map((t) => `t:${t}`);
  if (types.length) parts.push(types.length === 1 ? types[0] : `(${types.join(' or ')})`);
  if (s.legendary) parts.push('t:legendary');

  const q = parts.length ? parts.join(' ') : 'game:paper';
  if (q.length > MAX_QUERY) return { ok: false, error: `This search is too long (${q.length} of ${MAX_QUERY} characters). Shorten the text or drop a filter.` };
  return { ok: true, q };
}

const hex2 = (n: number) => Math.round(n).toString(16).padStart(2, '0');
const rgbHex = (r: number, g: number, b: number) => `#${hex2(r)}${hex2(g)}${hex2(b)}`;

const NEAR_BLACK = 30;
const NEAR_WHITE = 225;
/** Colors closer than this (Euclidean distance in RGB) count as the same color. */
const MERGE_DISTANCE = 48;

/**
 * Up to `n` dominant colors of RGBA pixel bytes as `#rrggbb`, most common first. Pixels are bucketed to 4 bits per channel;
 * transparent and near-black or near-white pixels are skipped; buckets that are close together are merged into the more common one.
 */
export function dominantColors(pixels: Uint8ClampedArray, n: number): string[] {
  const buckets = new Map<number, { count: number; r: number; g: number; b: number }>();
  for (let i = 0; i + 3 < pixels.length; i += 4) {
    const [r, g, b, a] = [pixels[i], pixels[i + 1], pixels[i + 2], pixels[i + 3]];
    if (a < 128) continue;
    if (r < NEAR_BLACK && g < NEAR_BLACK && b < NEAR_BLACK) continue;
    if (r > NEAR_WHITE && g > NEAR_WHITE && b > NEAR_WHITE) continue;
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const bucket = buckets.get(key) ?? { count: 0, r: 0, g: 0, b: 0 };
    bucket.count++;
    bucket.r += r;
    bucket.g += g;
    bucket.b += b;
    buckets.set(key, bucket);
  }

  const sorted = [...buckets.entries()].sort((x, y) => y[1].count - x[1].count || x[0] - y[0]).map(([, v]) => ({ count: v.count, rgb: [v.r / v.count, v.g / v.count, v.b / v.count] }));
  const clusters: Array<{ count: number; rgb: number[] }> = [];
  for (const c of sorted) {
    const near = clusters.find((k) => Math.hypot(k.rgb[0] - c.rgb[0], k.rgb[1] - c.rgb[1], k.rgb[2] - c.rgb[2]) < MERGE_DISTANCE);
    if (near) near.count += c.count;
    else clusters.push({ ...c });
  }
  return clusters
    .sort((x, y) => y.count - x.count)
    .slice(0, Math.max(0, n))
    .map((k) => rgbHex(k.rgb[0], k.rgb[1], k.rgb[2]));
}

const MIN_CONTRAST = 4.5;

/** The color as lowercase `#rrggbb`, darkened (never lightened) until white text on it reaches 4.5:1; null when `hex` isn't `#rrggbb`. */
export function readable(hex: string): string | null {
  if (typeof hex !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(hex)) return null;
  let [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  let out = rgbHex(r, g, b);
  for (let i = 0; i < 400 && contrastWithWhite(out) < MIN_CONTRAST; i++) {
    r = Math.floor(r * 0.97);
    g = Math.floor(g * 0.97);
    b = Math.floor(b * 0.97);
    out = rgbHex(r, g, b);
  }
  return out;
}

export interface CacheEntry {
  id: string;
  bytes: number;
  lastUsed: number;
}

export interface EvictionPlan {
  /** Ids to delete, least recently used first. */
  remove: string[];
  /** Caps still exceeded once everything not in `keep` is gone (what `keep` alone costs). */
  unmet: Array<'count' | 'bytes'>;
}

/** Which cached images to delete so the cache fits `caps`: least recently used first, never one in `keep`. */
export function planEviction(entries: readonly CacheEntry[], keep: ReadonlySet<string>, caps: { count: number; bytes: number }): EvictionPlan {
  let count = entries.length;
  let bytes = entries.reduce((sum, e) => sum + e.bytes, 0);
  const remove: string[] = [];
  const oldest = entries.filter((e) => !keep.has(e.id)).sort((a, b) => a.lastUsed - b.lastUsed);
  for (const e of oldest) {
    if (count <= caps.count && bytes <= caps.bytes) break;
    remove.push(e.id);
    count--;
    bytes -= e.bytes;
  }
  const unmet: EvictionPlan['unmet'] = [];
  if (count > caps.count) unmet.push('count');
  if (bytes > caps.bytes) unmet.push('bytes');
  return { remove, unmet };
}
