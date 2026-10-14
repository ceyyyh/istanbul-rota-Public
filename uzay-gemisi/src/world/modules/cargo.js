import { buildShell } from '../structure/shell.js';

/**
 * Kargo Ambarı — TASLAK. Sahibi ajan bu dosyayı tamamen yeniden yazacak.
 * Sözleşme için bkz. docs/ARCHITECTURE.md ("Modül sözleşmesi").
 */
export default {
  id: 'cargo',
  name: 'Kargo Ambarı',
  build(mctx) {
    buildShell(mctx, { floor: 'grate' });
  },
};
