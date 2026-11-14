/** The three top-level tabs. */
export type Tab = 'decks' | 'browse' | 'life';

const bare = (route: string) => route.replace(/^#/, '') || '/';

/** Which tab a route (hash, with or without the #) belongs to. Every deck screen and share link is Decks. */
export function tabOf(route: string): Tab {
  const r = bare(route);
  if (r === '/browse' || r.startsWith('/browse/')) return 'browse';
  if (r === '/life' || r.startsWith('/life/')) return 'life';
  return 'decks';
}

/** Where "back" goes from a route; null means we are at Your decks and back leaves the app. */
export function backTarget(route: string): string | null {
  const r = bare(route);
  if (r === '/') return null;
  return '#/';
}

/** The one Life Counter route: the game is its only screen, so every Life Counter route is sent here. */
export function lifeRoute(): string {
  return '#/life/game';
}
