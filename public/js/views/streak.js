// Streak: a plain record of the days something got ticked off.

import { h } from '../dom.js';
import * as store from '../store.js';
import { computeStreak, addDays, dayCounts } from '../model.js';

const WEEKS = 26;

export function renderStreak() {
  const today = store.today();
  const dayRecords = store.days();
  const s = computeStreak(dayRecords, today);

  // Grid runs Monday to Sunday down each column, oldest week on the left.
  const [y, m, d] = today.split('-').map(Number);
  const dow = (new Date(y, m - 1, d).getDay() + 6) % 7;            // 0 = Monday
  const cells = [];
  const first = addDays(today, -dow - (WEEKS - 1) * 7);
  for (let i = 0; i < WEEKS * 7; i++) {
    const key = addDays(first, i);
    if (key > today) { cells.push(h('i', { class: 'pad' })); continue; }
    const rec = dayRecords[key];
    const cls = dayCounts(rec) ? 'on' : (rec && rec.touched ? 'touched' : '');
    cells.push(h('i', { class: `${cls}${key === today ? ' today' : ''}`.trim(), title: key }));
  }

  const monthPrefix = today.slice(0, 7);
  const thisMonth = Object.entries(dayRecords).filter(([k, v]) => k.startsWith(monthPrefix) && dayCounts(v)).length;

  return h('div', { class: 'view-narrow' },
    h('div', { class: 'page-head' }, h('h1', null, 'Streak'), h('span', { class: 'muted small' }, 'Days you opened the board and ticked something off')),
    h('div', { class: 'stats' },
      stat('Current', s.current, s.current === 1 ? 'day' : 'days'),
      stat('Longest', s.longest, s.longest === 1 ? 'day' : 'days'),
      stat('This month', thisMonth, thisMonth === 1 ? 'day' : 'days'),
      stat('All time', s.total, s.total === 1 ? 'day' : 'days')),
    h('div', { class: 'heat', role: 'img', 'aria-label': `Last ${WEEKS} weeks. ${s.total} days with something ticked off.` }, cells),
    h('p', { class: 'muted small spacer' }, 'Filled squares are days you ticked something off. Outlined squares are days you only looked. Missing a day is fine; the run simply starts again.'));
}

function stat(label, num, unit) {
  return h('div', { class: 'stat' }, h('div', { class: 'caps muted' }, label), h('div', { class: 'num' }, String(num)), h('div', { class: 'small muted' }, unit));
}
