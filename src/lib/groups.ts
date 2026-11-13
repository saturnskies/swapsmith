import type { ScryCard } from '../scryfall/types';

/** Card-type groups in the order deck lists use; a card goes in the first group its front face matches. */
const GROUPS: Array<[string, string]> = [
  ['Creature', 'Creatures'],
  ['Planeswalker', 'Planeswalkers'],
  ['Battle', 'Battles'],
  ['Instant', 'Instants'],
  ['Sorcery', 'Sorceries'],
  ['Artifact', 'Artifacts'],
  ['Enchantment', 'Enchantments'],
  ['Land', 'Lands'],
];
export const GROUP_ORDER = ['Commander', ...GROUPS.map(([, g]) => g), 'Other'];
// Built once: sorting a deck asks for a card's group thousands of times.
const MATCHERS = GROUPS.map(([type, group]) => ({ type, group, word: new RegExp(`\\b${type}\\b`) }));
const groupOf = (typeLine: string) => {
  const front = typeLine.split(' // ')[0];
  return MATCHERS.find((m) => m.word.test(front));
};

/** The singular type name for a list row, e.g. "Creature". */
export function typeName(typeLine: string): string {
  return groupOf(typeLine)?.type ?? 'Other';
}

export function typeGroup(typeLine: string): string {
  return groupOf(typeLine)?.group ?? 'Other';
}

export type SortKey = 'type' | 'name' | 'price';

export interface GroupLine {
  name: string;
  typeLine: string;
  qty: number;
  price: number | null;
  isCommander: boolean;
}

/** Orders cards for display: by price (highest first, unpriced last) or by name. */
export function compareLines(sort: SortKey) {
  return (a: GroupLine, b: GroupLine) =>
    sort === 'price' ? (b.price ?? -1) - (a.price ?? -1) || a.name.localeCompare(b.name) : a.name.localeCompare(b.name);
}

/** Groups cards by type, commander first, with each group's card count (quantities added up). */
export function groupByType<T extends GroupLine>(lines: T[], sort: SortKey): Array<{ group: string; count: number; cards: T[] }> {
  const by = new Map<string, T[]>();
  for (const l of lines) {
    const g = l.isCommander ? 'Commander' : typeGroup(l.typeLine);
    by.set(g, [...(by.get(g) ?? []), l]);
  }
  return GROUP_ORDER.filter((g) => by.has(g)).map((group) => {
    const cards = [...by.get(group)!].sort(compareLines(sort));
    return { group, count: cards.reduce((n, c) => n + c.qty, 0), cards };
  });
}

/** A card's image URL from Scryfall; double-faced cards keep images per face, so the front is used. */
export function cardImage(card: ScryCard | null, size: 'small' | 'normal' = 'normal'): string | null {
  if (!card) return null;
  return card.image_uris?.[size] ?? card.card_faces?.[0]?.image_uris?.[size] ?? null;
}

/** The cropped artwork of a card; double-faced cards use the front face. */
export function cardArt(card: ScryCard | null): string | null {
  if (!card) return null;
  return card.image_uris?.art_crop ?? card.card_faces?.[0]?.image_uris?.art_crop ?? null;
}
