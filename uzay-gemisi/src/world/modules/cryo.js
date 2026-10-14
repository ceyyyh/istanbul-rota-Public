import { buildShell } from '../structure/shell.js';

/**
 * Hiper-Uyku Bölmesi — TASLAK. Sahibi ajan bu dosyayı tamamen yeniden yazacak.
 * Sözleşme için bkz. docs/ARCHITECTURE.md ("Modül sözleşmesi").
 */
export default {
  id: 'cryo',
  name: 'Hiper-Uyku Bölmesi',
  build(mctx) {
    buildShell(mctx, {});
  },
};
