import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDuration, fmtDuration, computeStreak, addDays, parseImport, isBlocked, reviewDue, defaultPrefs, DAY_MS } from '../public/js/model.js';

test('durations parse and format', () => {
  assert.equal(parseDuration('1h 30m'), 90);
  assert.equal(parseDuration('1.5h'), 90);
  assert.equal(parseDuration('45'), 45);
  assert.equal(parseDuration('2h'), 120);
  assert.equal(parseDuration('soon'), null);
  assert.equal(fmtDuration(5400), '1h 30m');
  assert.equal(fmtDuration(0), '0m');
});

test('streak: counts back from today or yesterday, gaps reset it', () => {
  const d = (n) => addDays('2026-10-06', n);
  const tick = { ticks: 1, ticked: [] };
  assert.equal(computeStreak({ [d(0)]: tick, [d(-1)]: tick, [d(-2)]: tick }, d(0)).current, 3);
  assert.equal(computeStreak({ [d(-1)]: tick, [d(-2)]: tick }, d(0)).current, 2, 'today not done yet does not break it');
  assert.equal(computeStreak({ [d(-2)]: tick }, d(0)).current, 0);
  assert.equal(computeStreak({ [d(0)]: { touched: true, ticks: 0, ticked: [] } }, d(0)).current, 0, 'only looking does not count');
  assert.equal(computeStreak({ [d(-9)]: tick, [d(-8)]: tick, [d(-7)]: tick, [d(0)]: tick }, d(0)).longest, 3);
});

test('blocked clears when the blocker is archived', () => {
  const a = { id: 'a', lane: 'active' };
  const b = { id: 'b', blocked: true, blockedBy: 'a' };
  assert.equal(isBlocked(b, new Map([['a', a], ['b', b]])), true);
  a.lane = 'archive';
  assert.equal(isBlocked(b, new Map([['a', a], ['b', b]])), false);
  assert.equal(isBlocked({ blocked: true, blockedBy: null }, new Map()), true);
});

test('weekly review is due after seven days', () => {
  const p = defaultPrefs(1000);
  assert.equal(reviewDue(p, 1000 + 6 * DAY_MS), false);
  assert.equal(reviewDue(p, 1000 + 7 * DAY_MS), true);
  assert.equal(reviewDue({ ...p, lastReviewAt: 1000 + 7 * DAY_MS }, 1000 + 8 * DAY_MS), false);
});

test('legacy import maps projects, tiles, notes, done and templates', () => {
  const raw = JSON.stringify({ projects: [{ id: 'p1', name: 'P', color: '#fff' }], tiles: [
    { id: 't1', projectId: 'p1', title: 'A', status: 'inprogress', notes: [{ id: 'n', text: 'x' }] },
    { id: 't2', projectId: 'p1', title: 'B', status: 'done', notes: [] },
    { id: 't3', projectId: 'gone', title: 'C', status: null },
  ], templates: [{ id: 'x', name: 'T', tiles: [{ title: 'one' }] }], fontSize: 'large' });
  const r = parseImport(raw, 5);
  assert.deepEqual(r.counts, { project: 1, tile: 3, template: 1 });
  const t = Object.fromEntries(r.records.filter((x) => x.kind === 'tile').map((x) => [x.id, x.data]));
  assert.equal(t.t1.status, 'inprogress'); assert.equal(t.t1.lane, 'active'); assert.equal(t.t1.notes[0].text, 'x');
  assert.equal(t.t2.lane, 'archive'); assert.equal(t.t2.archiveReason, 'completed');
  assert.equal(t.t3.projectId, null);
  assert.equal(r.fontSize, 'large');
  // the raw localStorage dump form is accepted too
  assert.equal(parseImport(JSON.stringify({ 'ashcombe-kanban-v1': raw })).counts.tile, 3);
  assert.throws(() => parseImport('nope'), /valid JSON/);
  assert.throws(() => parseImport('{}'), /No projects/);
});
