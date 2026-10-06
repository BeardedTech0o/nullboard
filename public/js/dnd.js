// Drag and drop with touch events and a ghost element. HTML5 draggable is not
// used: it does not work on iOS home-screen apps.
//
// On touch a drag starts after a short press, so normal scrolling still works.
// With a mouse it starts after the pointer moves a few pixels.

import { $ } from './dom.js';

const HOLD_MS = 240;
const SLOP = 10;       // movement that cancels a press (the user is scrolling)
const MOUSE_SLOP = 5;
const EDGE = 56;       // auto-scroll band at the edges
const NO_DRAG = 'button, a, input, select, textarea, [data-nodrag]';

// While a finger is down the page must not be rebuilt: touch events follow
// their original target, and once that node leaves the document they stop
// reaching the listeners. The shell checks this before it re-renders.
let busy = 0;
const idleCallbacks = [];
export const isDragging = () => busy > 0;
export function afterDrag(fn) { idleCallbacks.push(fn); }
function release() {
  busy = Math.max(0, busy - 1);
  if (!busy) while (idleCallbacks.length) idleCallbacks.shift()();
}

// enableDnd({ root, itemSel, zoneSel, itemId(el), onDrop({ id, zone, beforeId }) })
// Call once per render on the freshly built root. Listeners die with the node.
export function enableDnd({ root, itemSel, zoneSel, itemId, onDrop }) {
  let pending = null;   // press recorded, drag not started yet
  let drag = null;      // active drag
  let suppressClick = false;

  root.addEventListener('click', (e) => {
    if (suppressClick) { e.stopPropagation(); e.preventDefault(); }
  }, true);

  root.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) return;
    const item = e.target.closest(itemSel);
    if (!item || e.target.closest(NO_DRAG)) return;
    const t = e.touches[0];
    pending = { item, x: t.clientX, y: t.clientY, touch: true, timer: setTimeout(() => begin(t.clientX, t.clientY), HOLD_MS) };
    document.addEventListener('touchmove', onTouchMove, { passive: false });
    document.addEventListener('touchend', onEnd);
    document.addEventListener('touchcancel', onCancel);
  }, { passive: true });

  root.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    const item = e.target.closest(itemSel);
    if (!item || e.target.closest(NO_DRAG)) return;
    pending = { item, x: e.clientX, y: e.clientY, touch: false, timer: null };
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onEnd);
  });

  function detach() {
    document.removeEventListener('touchmove', onTouchMove);
    document.removeEventListener('touchend', onEnd);
    document.removeEventListener('touchcancel', onCancel);
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onEnd);
  }

  function begin(x, y) {
    if (!pending) return;
    const { item } = pending;
    const rect = item.getBoundingClientRect();
    const ghost = item.cloneNode(true);
    ghost.classList.add('drag-ghost');
    ghost.style.setProperty('width', `${rect.width}px`);
    document.body.appendChild(ghost);
    item.classList.add('dragging');
    busy++;
    // Scroll snapping would undo every small auto-scroll step.
    const snapBar = $('.columns', root);
    if (snapBar) snapBar.style.setProperty('scroll-snap-type', 'none');
    drag = { snapBar, item, ghost, offX: x - rect.left, offY: y - rect.top, zone: null, line: null, x, y, raf: 0 };
    if (navigator.vibrate) navigator.vibrate(8);
    position(x, y);
    loop();
  }

  function position(x, y) {
    drag.x = x;
    drag.y = y;
    drag.ghost.style.setProperty('transform', `translate3d(${x - drag.offX}px, ${y - drag.offY}px, 0)`);
    const under = document.elementFromPoint(x, y);
    const zone = under ? under.closest(zoneSel) : null;
    if (zone !== drag.zone) {
      if (drag.zone) drag.zone.classList.remove('drop-hot');
      if (zone) zone.classList.add('drop-hot');
      drag.zone = zone;
    }
    showLine();
  }

  // Draws an insertion line in column-style zones that hold ordered items.
  function showLine() {
    if (drag.line) { drag.line.remove(); drag.line = null; }
    const zone = drag.zone;
    if (!zone || zone.dataset.ordered !== 'true') return;
    const before = beforeElement(zone, drag.y, drag.item);
    const line = document.createElement('div');
    line.className = 'drop-line';
    if (before) zone.insertBefore(line, before); else zone.appendChild(line);
    drag.line = line;
  }

  function beforeElement(zone, y, skip) {
    const items = [...zone.querySelectorAll(itemSel)].filter((el) => el !== skip);
    for (const el of items) {
      const r = el.getBoundingClientRect();
      if (y < r.top + r.height / 2) return el;
    }
    return null;
  }

  // Keeps scrolling while the finger rests near an edge of the board.
  function loop() {
    if (!drag) return;
    const scroller = drag.zone && drag.zone.closest('.columns');
    const bar = scroller || $('.columns', root);
    if (bar) {
      const r = bar.getBoundingClientRect();
      if (drag.x < r.left + EDGE) bar.scrollLeft -= 12;
      else if (drag.x > r.right - EDGE) bar.scrollLeft += 12;
    }
    if (drag.zone) {
      const col = drag.zone.closest('.column-body, .sidebar') || drag.zone;
      const r = col.getBoundingClientRect();
      if (drag.y < r.top + EDGE) col.scrollTop -= 10;
      else if (drag.y > r.bottom - EDGE) col.scrollTop += 10;
    }
    drag.raf = requestAnimationFrame(loop);
  }

  function onTouchMove(e) {
    const t = e.touches[0];
    if (drag) { e.preventDefault(); position(t.clientX, t.clientY); return; }
    if (pending && Math.hypot(t.clientX - pending.x, t.clientY - pending.y) > SLOP) cancelPending();
  }

  function onMouseMove(e) {
    if (drag) { position(e.clientX, e.clientY); return; }
    if (pending && Math.hypot(e.clientX - pending.x, e.clientY - pending.y) > MOUSE_SLOP) begin(e.clientX, e.clientY);
  }

  function cancelPending() {
    if (pending) clearTimeout(pending.timer);
    pending = null;
    detach();
  }

  function onCancel() { finish(false); }
  function onEnd() { finish(true); }

  function finish(commit) {
    const d = drag;
    clearTimeout(pending && pending.timer);
    cancelAnimationFrame(d ? d.raf : 0);
    pending = null;
    drag = null;
    detach();
    if (!d) return;
    const zone = d.zone;
    const before = zone && zone.dataset.ordered === 'true' ? beforeElement(zone, d.y, d.item) : null;
    const beforeId = before ? itemId(before) : null;
    d.ghost.remove();
    if (d.snapBar) d.snapBar.style.removeProperty('scroll-snap-type');
    if (d.line) d.line.remove();
    if (zone) zone.classList.remove('drop-hot');
    d.item.classList.remove('dragging');
    suppressClick = true;
    setTimeout(() => { suppressClick = false; }, 350);
    if (commit && zone) onDrop({ id: itemId(d.item), zone, beforeId });
    release();
  }
}
