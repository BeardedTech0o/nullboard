// Stroke icons, 24px grid. One path string per icon.
import { svg } from './dom.js';

const PATHS = {
  plus: 'M12 5v14M5 12h14',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  x: 'M6 6l12 12M18 6L6 18',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  list: 'M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01',
  target: 'M12 3a9 9 0 100 18 9 9 0 000-18zM12 8a4 4 0 100 8 4 4 0 000-8z',
  inbox: 'M3 13l3-8h12l3 8M3 13v6h18v-6M3 13h5l1 3h6l1-3h5',
  moon: 'M20 14.5A8 8 0 019.5 4 8 8 0 1020 14.5z',
  archive: 'M3 5h18v4H3zM5 9v10h14V9M10 13h4',
  flame: 'M12 3c1 4 5 5 5 10a5 5 0 01-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-3-1-5 1-9z',
  clock: 'M12 3a9 9 0 100 18 9 9 0 000-18zM12 7v5l3 2',
  play: 'M8 5l11 7-11 7z',
  pause: 'M8 5v14M16 5v14',
  gear: 'M12 9a3 3 0 100 6 3 3 0 000-6zM19 12a7 7 0 00-.1-1.2l2-1.5-2-3.4-2.3.9a7 7 0 00-2-1.2L14.2 3h-4l-.4 2.6a7 7 0 00-2 1.2l-2.3-.9-2 3.4 2 1.5A7 7 0 005 12c0 .4 0 .8.1 1.2l-2 1.5 2 3.4 2.3-.9a7 7 0 002 1.2l.4 2.6h4l.4-2.6a7 7 0 002-1.2l2.3.9 2-3.4-2-1.5c.1-.4.1-.8.1-1.2z',
  menu: 'M4 7h16M4 12h16M4 17h16',
  folder: 'M3 6h6l2 2h10v11H3z',
  chevron: 'M9 6l6 6-6 6',
  up: 'M6 15l6-6 6 6',
  trash: 'M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13',
  block: 'M12 3a9 9 0 100 18 9 9 0 000-18zM6 6l12 12',
  undo: 'M9 14L4 9l5-5M4 9h10a6 6 0 010 12h-3',
  edit: 'M4 20h4L19 9l-4-4L4 16zM13 7l4 4',
  sun: 'M12 8a4 4 0 100 8 4 4 0 000-8zM12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M5 19l1.5-1.5M17.5 6.5L19 5',
  logout: 'M10 4H5v16h5M15 8l4 4-4 4M19 12H9',
  repeat: 'M17 3l4 4-4 4M3 11V9a2 2 0 012-2h16M7 21l-4-4 4-4M21 13v2a2 2 0 01-2 2H3',
};

export function icon(name, size) {
  const node = svg('svg', {
    viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 2,
    'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', focusable: 'false',
  }, svg('path', { d: PATHS[name] || PATHS.more }));
  if (size) { node.setAttribute('width', size); node.setAttribute('height', size); }
  return node;
}
