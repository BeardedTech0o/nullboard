// Focus view: the one task committed to today, and nothing else.

import { h } from '../dom.js';
import { icon } from '../icons.js';
import * as store from '../store.js';
import * as actions from '../actions.js';
import { openTileSheet } from '../tile-sheet.js';
import { openSheet, navigate } from '../ui.js';
import { STATUS_LABEL, subtaskProgress, fmtDuration, elapsedSec, overBy, isBlocked, blockerOf, computeStreak, addDays, reviewDue, prettyDate } from '../model.js';

const STATUSES = ['todo', 'inprogress', 'signoff'];

export function renderFocus() {
  const prefs = store.prefs();
  const byId = store.tileById();
  const tile = prefs.focus ? byId.get(prefs.focus.tileId) : null;
  const live = tile && tile.lane === 'active' ? tile : null;

  const wrap = h('div', { class: 'focus' });
  if (reviewDue(prefs, store.now())) wrap.appendChild(reviewBanner());
  wrap.appendChild(live ? focusCard(live, prefs, byId) : emptyFocus());
  wrap.appendChild(streakStrip());
  return wrap;
}

function reviewBanner() {
  return h('div', { class: 'banner' },
    h('span', null, 'Your weekly review is due. It takes about ten minutes.'),
    h('button', { type: 'button', class: 'btn btn-sm', on: { click: () => navigate('review') } }, 'Start review'));
}

function emptyFocus() {
  const next = suggestNext();
  return h('div', null,
    h('p', { class: 'caps focus-eyebrow' }, "Today's focus"),
    h('h1', { class: 'focus-title' }, 'Nothing committed yet.'),
    h('p', { class: 'muted' }, next
      ? 'Pick one task and stay with it. Anything else that comes to mind goes in the inbox.'
      : 'Add a task to the board, then come back and commit to one.'),
    next ? h('div', { class: 'stack' },
      h('p', { class: 'caps muted' }, 'Suggested next'),
      h('div', { class: 'pick' }, h('span', { class: 'tile-title' }, next.title)),
      h('div', { class: 'row' },
        h('button', { type: 'button', class: 'btn btn-primary', on: { click: () => actions.setFocus(next.id) } }, 'Commit to this'),
        h('button', { type: 'button', class: 'btn', on: { click: openPicker } }, 'Choose another')))
      : h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn btn-primary', on: { click: () => navigate('board') } }, 'Open the board')));
}

// First in-progress task that is not blocked, then to-do, then anything placed.
function suggestNext() {
  const byId = store.tileById();
  const open = store.tiles().filter((t) => t.lane === 'active' && !isBlocked(t, byId)).sort((a, b) => a.order - b.order);
  return open.find((t) => t.status === 'inprogress') || open.find((t) => t.status === 'todo') || open[0] || null;
}

export function openPicker() {
  const byId = store.tileById();
  const rank = { inprogress: 0, todo: 1, signoff: 2 };
  const list = store.tiles().filter((t) => t.lane === 'active')
    .sort((a, b) => (rank[a.status] ?? 3) - (rank[b.status] ?? 3) || a.order - b.order);
  openSheet({
    title: "Pick today's focus",
    cancelLabel: 'Close',
    build: (body, sheet) => {
      if (!list.length) { body.appendChild(h('p', { class: 'empty' }, 'No tasks on the board yet.')); return; }
      body.appendChild(h('div', { class: 'pick-list' }, list.map((t) => {
        const project = store.projectById().get(t.projectId);
        return h('button', { type: 'button', class: 'pick', on: { click: () => { sheet.close(); actions.setFocus(t.id); } } },
          h('span', { class: 'tile-title' }, t.title),
          h('span', { class: 'small muted' }, [project?.name, STATUS_LABEL[t.status] || 'Unplaced', isBlocked(t, byId) ? 'Blocked' : null].filter(Boolean).join('  ·  ')));
      })));
    },
  });
}

function focusCard(tile, prefs, byId) {
  const now = store.now();
  const project = store.projectById().get(tile.projectId);
  const prog = subtaskProgress(tile);
  const blocker = blockerOf(tile, byId);
  const blocked = isBlocked(tile, byId);
  const spent = elapsedSec(tile, now);
  const over = overBy(tile, now);
  const lastNote = tile.notes[tile.notes.length - 1];

  const stepInput = h('input', { class: 'input', type: 'text', placeholder: 'Add a step', maxLength: 500, enterKeyHint: 'done', 'aria-label': 'Add a step', dataset: { keep: 'focus-step' } });
  const addStep = () => { const v = stepInput.value; stepInput.value = ''; actions.addSubtask(tile.id, v); };
  stepInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addStep(); } });

  const noteInput = h('input', { class: 'input', type: 'text', placeholder: 'Note where you got to', maxLength: 5000, enterKeyHint: 'done', 'aria-label': 'Add a note', dataset: { keep: 'focus-note' } });
  const addNote = () => { const v = noteInput.value; noteInput.value = ''; actions.addNote(tile.id, v); };
  noteInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addNote(); } });

  return h('div', null,
    h('p', { class: 'caps focus-eyebrow' }, ["Today's focus", project ? `  ·  ${project.name}` : null]),
    h('h1', { class: 'focus-title' }, tile.title),

    blocked ? h('div', { class: 'blocked-box', role: 'alert' },
      h('strong', null, 'Blocked. '),
      blocker ? ['Waiting on ', h('button', { type: 'button', class: 'link-btn', on: { click: () => openTileSheet(blocker.id) } }, blocker.title), '.']
        : (tile.blockedNote || 'Waiting on something outside the board.')) : null,

    h('div', { class: 'focus-meta' },
      h('div', { class: 'seg status-seg', role: 'radiogroup', 'aria-label': 'Status' }, STATUSES.map((s) =>
        h('label', { class: 'seg-opt' },
          h('input', { type: 'radio', name: 'focus-status', value: s, checked: tile.status === s, on: { change: () => actions.setStatus(tile.id, s) } }),
          STATUS_LABEL[s]))),
      tile.subtasks.length ? h('span', { class: 'tag' }, `${prog.done} of ${prog.total} steps`) : null),

    tile.subtasks.length ? h('div', null,
      h('div', { class: 'progress', role: 'progressbar', 'aria-valuenow': prog.pct, 'aria-valuemin': 0, 'aria-valuemax': 100 },
        h('i', { vars: { width: `${prog.pct}%` } })),
      h('div', { class: 'where' }, h('span', null, prog.done === prog.total ? 'All steps done.' : `Next: ${tile.subtasks.find((s) => !s.done).text}`), h('span', null, `${prog.pct}%`))) : null,

    h('ul', { class: 'steps' }, tile.subtasks.map((s) =>
      h('li', { class: `step${s.done ? ' is-done' : ''}` },
        h('button', { type: 'button', class: 'tick', role: 'checkbox', 'aria-checked': String(!!s.done), 'aria-label': s.text, on: { click: () => actions.toggleSubtask(tile.id, s.id) } }, icon('check')),
        h('span', { class: 'step-text' }, s.text)))),
    h('div', { class: 'add-row' }, stepInput, h('button', { type: 'button', class: 'btn', on: { click: addStep } }, 'Add')),

    h('div', { class: 'section-head' }, h('span', { class: 'caps' }, 'Where I am')),
    lastNote ? h('div', { class: 'note' }, lastNote.text, lastNote.at ? h('div', { class: 'small muted' }, prettyDate(lastNote.at)) : null)
      : h('p', { class: 'muted small' }, 'No notes yet.'),
    h('div', { class: 'add-row' }, noteInput, h('button', { type: 'button', class: 'btn', on: { click: addNote } }, 'Save')),

    h('div', { class: 'section-head' }, h('span', { class: 'caps' }, 'Time')),
    h('div', { class: 'time-card' },
      h('div', { class: 'cell' }, h('div', { class: 'caps muted' }, 'Estimate'), h('div', { class: 'num' }, tile.estimateMin ? fmtDuration(tile.estimateMin * 60) : 'None')),
      h('div', { class: 'cell' }, h('div', { class: 'caps muted' }, 'Spent'), h('div', { class: `num${over != null && over > 0 ? ' over' : ''}` }, fmtDuration(spent))),
      h('div', { class: 'cell' }, h('div', { class: 'caps muted' }, over == null ? 'Compare' : over > 0 ? 'Over by' : 'Left'),
        h('div', { class: `num${over != null && over > 0 ? ' over' : ''}` }, over == null ? 'Set an estimate' : fmtDuration(Math.abs(over))))),
    over != null && over > tile.estimateMin * 30 ? h('p', { class: 'small over' }, 'Bigger than it looked. Worth splitting into smaller steps?') : null,
    h('div', { class: 'row spacer' },
      h('button', { type: 'button', class: 'btn', on: { click: () => actions.toggleTimer(tile.id) } }, icon(tile.timerStart ? 'pause' : 'play'), tile.timerStart ? 'Stop timer' : 'Start timer'),
      h('button', { type: 'button', class: 'btn btn-ghost', on: { click: () => actions.addSeconds(tile.id, 900) } }, '+15m')),

    h('div', { class: 'focus-actions' },
      h('button', { type: 'button', class: 'btn btn-primary', on: { click: () => actions.completeTile(tile.id) } }, icon('check'), 'Complete and archive'),
      h('button', { type: 'button', class: 'btn', on: { click: () => openTileSheet(tile.id) } }, 'Details'),
      h('button', { type: 'button', class: 'btn btn-ghost', on: { click: () => actions.setFocus(null) } }, 'Step away from this one')));
}

export function streakStrip() {
  const today = store.today();
  const s = computeStreak(store.days(), today);
  const dayRecords = store.days();
  const dots = [];
  for (let i = 6; i >= 0; i--) {
    const key = addDays(today, -i);
    const d = dayRecords[key];
    const on = d && ((d.ticks || 0) > 0 || (d.ticked || []).length > 0);
    dots.push(h('i', { class: on ? 'on' : (d && d.touched ? 'touched' : ''), title: key }));
  }
  return h('button', { type: 'button', class: 'streak-strip', on: { click: () => navigate('streak') }, 'aria-label': 'Open streak' },
    h('div', { class: 'dots' }, dots),
    h('span', null, s.current ? `${s.current} day${s.current === 1 ? '' : 's'} in a row` : s.doneToday ? 'Started today' : 'A fresh start is fine'));
}
