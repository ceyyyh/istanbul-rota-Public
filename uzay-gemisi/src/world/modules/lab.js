import { buildShell } from '../structure/shell.js';

/**
 * Bilim Laboratuvarı — TASLAK. Sahibi ajan bu dosyayı tamamen yeniden yazacak.
 * Sözleşme için bkz. docs/ARCHITECTURE.md ("Modül sözleşmesi").
 */
export default {
  id: 'lab',
  name: 'Bilim Laboratuvarı',
  build(mctx) {
    buildShell(mctx, {});
  },
};
