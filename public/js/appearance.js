// Theme and text size. The inline script in index.html sets the first paint;
// this keeps it in step with the synced preference afterwards.

let mq = null;
let wired = false;

export function applyTheme(choice) {
  const root = document.documentElement;
  const dark = choice === 'dark' || (choice !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  root.setAttribute('data-theme', dark ? 'dark' : 'light');
  try { localStorage.setItem('nb-theme', choice || 'system'); } catch { /* private mode */ }
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', getComputedStyle(root).getPropertyValue('--bg').trim() || (dark ? '#0a0a0a' : '#ffffff'));
  if (!wired) {
    wired = true;
    mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', () => {
      let saved = 'system';
      try { saved = localStorage.getItem('nb-theme') || 'system'; } catch { /* ignore */ }
      if (saved === 'system') applyTheme('system');
    });
  }
}

export function applyFontSize(size) {
  const s = size || 'medium';
  document.documentElement.setAttribute('data-fontsize', s);
  try { localStorage.setItem('nb-fontsize', s); } catch { /* private mode */ }
}

export function applyPrefs(prefs) {
  applyTheme(prefs.theme);
  applyFontSize(prefs.fontSize);
}
