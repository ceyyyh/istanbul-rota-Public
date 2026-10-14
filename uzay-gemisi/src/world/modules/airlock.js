import { buildShell } from '../structure/shell.js';

/**
 * Hava Kilidi — TASLAK. Sahibi ajan bu dosyayı tamamen yeniden yazacak.
 * Sözleşme için bkz. docs/ARCHITECTURE.md ("Modül sözleşmesi").
 */
export default {
  id: 'airlock',
  name: 'Hava Kilidi',
  build(mctx) {
    buildShell(mctx, {});
  },
};
