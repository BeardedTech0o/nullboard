// Tiny DOM helpers. Everything is built with createElement and textContent, so
// user text can never be parsed as markup, and no inline handlers or style
// attributes are used (the CSP forbids both).

const SVG_NS = 'http://www.w3.org/2000/svg';

// h('div', { class: 'x', on: { click: fn }, dataset: { id: 1 } }, child, 'text')
export function h(tag, props, ...children) {
  const node = document.createElement(tag);
  if (props) {
    for (const [key, val] of Object.entries(props)) {
      if (val == null || val === false) continue;
      if (key === 'class') node.className = val;
      else if (key === 'on') for (const [ev, fn] of Object.entries(val)) node.addEventListener(ev, fn);
      else if (key === 'dataset') for (const [k, v] of Object.entries(val)) { if (v != null) node.dataset[k] = String(v); }
      else if (key === 'vars') for (const [k, v] of Object.entries(val)) node.style.setProperty(k, v);
      else if (key === 'text') node.textContent = val;
      else if (key in node && typeof val !== 'object' && !key.startsWith('aria') && key !== 'list') node[key] = val;
      else node.setAttribute(key, val === true ? '' : String(val));
    }
  }
  append(node, children);
  return node;
}

export function append(node, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    node.appendChild(typeof c === 'object' ? c : document.createTextNode(String(c)));
  }
  return node;
}

export function svg(tag, attrs, ...children) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs || {})) node.setAttribute(k, String(v));
  for (const c of children.flat()) if (c) node.appendChild(c);
  return node;
}

export const clear = (node) => { while (node.firstChild) node.removeChild(node.firstChild); return node; };

export const $ = (sel, root = document) => root.querySelector(sel);

// Same wait-for-layout trick the iOS repaint fix uses.
export const nextFrames = (fn) => requestAnimationFrame(() => requestAnimationFrame(fn));
