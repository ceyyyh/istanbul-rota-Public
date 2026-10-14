import { buildShell } from '../structure/shell.js';

/**
 * Revir — TASLAK. Sahibi ajan bu dosyayı tamamen yeniden yazacak.
 * Sözleşme için bkz. docs/ARCHITECTURE.md ("Modül sözleşmesi").
 */
export default {
  id: 'medical',
  name: 'Revir',
  build(mctx) {
    buildShell(mctx, {});
  },
};
