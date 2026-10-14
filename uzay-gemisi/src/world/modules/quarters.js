import { buildShell } from '../structure/shell.js';

/**
 * Yaşam Alanı — TASLAK. Sahibi ajan bu dosyayı tamamen yeniden yazacak.
 * Sözleşme için bkz. docs/ARCHITECTURE.md ("Modül sözleşmesi").
 */
export default {
  id: 'quarters',
  name: 'Yaşam Alanı',
  build(mctx) {
    buildShell(mctx, {});
  },
};
