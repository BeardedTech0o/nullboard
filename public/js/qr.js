// Renders a QR code as inline SVG using the vendored qrcode-generator
// (MIT, Kazuhiko Arase). Built with createElementNS, so no markup is parsed
// and the CSP needs no allowances.
import qrcode from '../vendor/qrcode.mjs';
import { svg } from './dom.js';

export function qrSvg(text) {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  let d = '';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (qr.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`;
    }
  }
  return svg('svg', { viewBox: `-4 -4 ${n + 8} ${n + 8}`, 'shape-rendering': 'crispEdges', role: 'img', 'aria-label': 'QR code for your authenticator app' },
    svg('path', { d, fill: 'currentColor' }));
}
