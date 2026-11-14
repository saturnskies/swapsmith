/**
 * The death effect's pictures: an irregular blood splatter and a skull, both inline SVG built with DOM calls from path
 * data written here (never from game data). Decorative: the overlay is aria-hidden and ignores the pointer, so the life
 * buttons under it keep working. The shapes are fixed; a seat only turns and scales the splatter a little so seats differ.
 */

const NS = 'http://www.w3.org/2000/svg';

/** Skull fills. Every light fill stays at or below luminance 0.18 so white text over the skull keeps 4.5:1 (a test reads these). */
export const BONE = '#706a5e';
export const BONE_LIT = '#766f62';
export const BONE_SHADE = '#5c564c';
export const SOCKET = '#0a0707';
export const BLOOD = '#7d0b0e';
export const BLOOD_DARK = '#580708';
export const BLOOD_LIT = '#a31217';

// The splatter is drawn inside a circle of radius 105 around (150, 110) of a 300 by 220 box, so turning it never clips it.
const SPLAT_BOX = '0 0 300 220';
const SPLAT = {
  main: 'M198 110C198.7 117.4 208.2 127.6 205.7 133.1C203.1 138.5 189.2 139.8 182.8 142.8C176.4 145.8 172.5 146 167.1 151.2C161.6 156.4 156.1 173 150 174C143.9 175.1 135.8 162.9 130.2 157.8C124.6 152.7 122 147.8 116.6 143.4C111.2 139 103 137.2 97.8 131.6C92.6 126.1 84.7 116.9 85.4 110C86.1 103.1 97.7 96.6 102 90.1C106.3 83.6 106.5 76.1 111.1 71.1C115.6 66.1 122.9 64.6 129.3 60.1C135.8 55.6 143.7 42.7 150 44C156.3 45.4 161.7 62.8 167.3 68.1C173 73.4 178.4 72.5 184.1 75.9C189.8 79.3 199 83 201.3 88.7C203.7 94.4 197.3 102.6 198 110Z',
  pool: 'M179.9 107C181 111.7 180 120 176.9 123.6C173.7 127.2 166.4 126.7 161.1 128.7C155.7 130.8 148.8 137.5 144.5 136.1C140.3 134.7 138 125.3 135.5 120.4C133 115.6 130.6 112.2 129.5 107C128.4 101.8 126.2 92.3 129.1 88.9C132.1 85.5 141.9 87.7 147.4 86.6C152.9 85.5 158.2 81 162 82.4C165.8 83.8 167.2 91.1 170.2 95.2C173.2 99.3 178.8 102.3 179.9 107Z',
  lit: 'M126 83.2C125.4 81.4 132 72.1 136.4 70.3C140.9 68.4 152.1 70.4 152.7 72.1C153.3 73.8 144.4 78.8 140 80.7C135.5 82.5 126.6 84.9 126 83.2Z',
  streaks: [
    'M127 90Q97.9 73.4 72.4 62.5Q96.3 76.1 121.6 99.1Z',
    'M145.6 79.8Q130.7 47.6 119.6 20.8Q127.5 48.7 135 83.4Z',
    'M175.3 91.7Q195.6 60.3 211.2 33.8Q191.6 57.2 162 81.3Z',
    'M180.8 110.8Q215.5 96.1 245.2 90.1Q214.7 92.1 178 97.3Z',
    'M168.7 134.4Q202.6 149.7 223.6 170.3Q205.2 146.6 177.2 124.2Z',
    'M142.5 140.6Q150.2 167 155.4 188.7Q156 166.6 161.8 139.2Z',
    'M123 126.1Q110.5 160.6 90 179.6Q114.7 164.3 137 138.6Z',
  ],
  lines: ['M117 64.7L96.4 28', 'M204.5 129.9L242.1 148.9', 'M127.5 159.1L107.6 191.6'],
  drops: [
    [229.9, 124.4, 4.5, 2.5, 10.2],
    [222.5, 141.7, 5.1, 3.2, 23.6],
    [187.7, 185.7, 3.2, 2.4, 63.5],
    [172.9, 185.7, 4.6, 3.6, 73.2],
    [133.7, 196.6, 4.9, 2.7, 100.7],
    [99, 192.6, 7.1, 4.5, 121.7],
    [80.7, 157.9, 8.8, 4.8, 145.4],
    [61.4, 133, 4.2, 2.8, 165.5],
    [72.7, 100.5, 5.8, 3.4, 187],
    [96.5, 64.9, 5.7, 5.4, 220.1],
    [107.1, 52.8, 3.7, 2, 233.2],
    [122.4, 25.6, 3.2, 2.3, 251.9],
    [164.6, 40.6, 10.5, 5.8, 281.9],
    [213.4, 35.4, 9.7, 5.8, 310.4],
    [201.2, 67.8, 2.9, 2.7, 320.5],
    [231.5, 76.3, 4.4, 2.7, 337.5],
    [68.2, 59.9, 4.2, 4.1, -149],
    [214.3, 29.9, 4.4, 4.1, -51.6],
    [227.5, 173.4, 3.7, 3.3, 40.1],
    [86.7, 183.4, 3.7, 3.5, 131.8],
  ],
};

const SKULL_BOX = '0 0 200 200';
const SKULL = {
  cranium: 'M100 20C58 20 28 50 28 90C28 112 37 127 51 136L51 150C51 157 56 161 62 161L68 161L68 177C68 181 72 184 76 184L124 184C128 184 132 181 132 177L132 161L138 161C144 161 149 157 149 150L149 136C163 127 172 112 172 90C172 50 142 20 100 20Z',
  jaw: 'M68 161L132 161L132 177C132 181 128 184 124 184L76 184C72 184 68 181 68 177Z',
  lit: 'M100 26C66 26 40 50 38 84C48 62 72 48 100 48C128 48 152 62 162 84C160 50 134 26 100 26Z',
  eyeL: 'M56 90C54 76 66 68 80 73C92 78 96 94 89 105C82 114 64 113 58 104C56 100 56 95 56 90Z',
  nose: 'M100 106L89 131C93 134 97 132 100 126C103 132 107 134 111 131Z',
  crack: 'M121 22L113 42L122 55L114 70L119 80',
  teeth: ['M80 162L80 183', 'M90 162L90 184', 'M100 162L100 184', 'M110 162L110 184', 'M120 162L120 183'],
  drip: 'M64 108L72 108L72 140C72 146 68 148 66 148C62 148 62 144 64 140Z',
};

const el = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, ...kids: SVGElement[]): SVGElementTagNameMap[K] => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  e.append(...kids);
  return e;
};
const svg = (cls: string, box: string) => el('svg', { class: cls, viewBox: box, 'aria-hidden': 'true', focusable: 'false', preserveAspectRatio: 'xMidYMid meet' });
const path = (d: string, fill: string, extra: Record<string, string | number> = {}) => el('path', { d, fill, ...extra });

/** The splatter: a lumpy main blob, tapered streaks, a darker pool, a highlight, thin streak lines and satellite droplets. */
function splatter(seat: number): SVGSVGElement {
  const root = svg('death-splat', SPLAT_BOX);
  const turn = (seat * 53) % 360;
  const scale = (0.9 + (seat % 3) * 0.07).toFixed(2);
  const g = el('g', { transform: `rotate(${turn} 150 110) translate(150 110) scale(${scale}) translate(-150 -110)` });
  for (const d of SPLAT.streaks) g.append(path(d, BLOOD));
  for (const d of SPLAT.lines) g.append(path(d, 'none', { stroke: BLOOD, 'stroke-width': 2.2, 'stroke-linecap': 'round' }));
  g.append(path(SPLAT.main, BLOOD), path(SPLAT.pool, BLOOD_DARK), path(SPLAT.lit, BLOOD_LIT, { opacity: 0.9 }));
  for (const [x, y, rx, ry, rot] of SPLAT.drops) g.append(el('ellipse', { cx: x, cy: y, rx, ry, fill: BLOOD, transform: `rotate(${rot} ${x} ${y})` }));
  root.append(g);
  return root;
}

/** The skull glyph: bone with a lit crown and shaded jaw, dark sockets, nose and tooth gaps, a hairline crack and one red drip. */
function skull(): SVGSVGElement {
  const root = svg('death-skull', SKULL_BOX);
  const dark = { stroke: SOCKET, 'stroke-linecap': 'round' };
  root.append(
    path(SKULL.cranium, BONE),
    path(SKULL.jaw, BONE_SHADE),
    path(SKULL.lit, BONE_LIT),
    path(SKULL.eyeL, SOCKET),
    path(SKULL.eyeL, SOCKET, { transform: 'translate(200 0) scale(-1 1)' }),
    path(SKULL.nose, SOCKET),
    path(SKULL.crack, 'none', { ...dark, 'stroke-width': 2, 'stroke-linejoin': 'round' }),
    ...SKULL.teeth.map((d) => path(d, 'none', { ...dark, 'stroke-width': 3 })),
    path(SKULL.drip, BLOOD),
  );
  return root;
}

/** The overlay for one tile: a darkening scrim, the splatter, then the skull. Built once per tile. */
export function deathOverlay(seat: number): HTMLElement {
  const root = document.createElement('div');
  root.className = 'tile-death';
  root.setAttribute('aria-hidden', 'true');
  root.append(splatter(seat), skull());
  return root;
}
