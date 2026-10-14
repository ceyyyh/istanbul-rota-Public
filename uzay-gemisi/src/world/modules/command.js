import { buildShell } from '../structure/shell.js';

/**
 * Kumanda Modülü — TASLAK. Sahibi ajan bu dosyayı tamamen yeniden yazacak.
 * Sözleşme için bkz. docs/ARCHITECTURE.md ("Modül sözleşmesi").
 */
export default {
  id: 'command',
  name: 'Kumanda Modülü',
  build(mctx) {
    buildShell(mctx, { lockedUntil: 'power_restored', lockedText: 'KİLİTLİ — Kumanda modülü için enerji gerekli', outerWindows: [{ x: 0, w: 6, y: 0.9, h: 1.6 }] });
  },
};
