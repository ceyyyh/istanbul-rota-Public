import { buildShell } from '../structure/shell.js';

/**
 * Hidroponik Bahçe — TASLAK. Sahibi ajan bu dosyayı tamamen yeniden yazacak.
 * Sözleşme için bkz. docs/ARCHITECTURE.md ("Modül sözleşmesi").
 */
export default {
  id: 'hydro',
  name: 'Hidroponik Bahçe',
  build(mctx) {
    buildShell(mctx, {});
  },
};
