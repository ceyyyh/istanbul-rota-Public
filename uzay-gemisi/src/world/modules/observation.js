import { buildShell } from '../structure/shell.js';

/**
 * Gözlem Güvertesi — TASLAK. Sahibi ajan bu dosyayı tamamen yeniden yazacak.
 * Sözleşme için bkz. docs/ARCHITECTURE.md ("Modül sözleşmesi").
 */
export default {
  id: 'observation',
  name: 'Gözlem Güvertesi',
  build(mctx) {
    buildShell(mctx, { outerWindows: [{ x: 0, w: 8, y: 0.5, h: 2.2 }] });
  },
};
