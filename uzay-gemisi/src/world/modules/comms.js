import { buildShell } from '../structure/shell.js';

/**
 * İletişim — TASLAK. Sahibi ajan bu dosyayı tamamen yeniden yazacak.
 * Sözleşme için bkz. docs/ARCHITECTURE.md ("Modül sözleşmesi").
 */
export default {
  id: 'comms',
  name: 'İletişim',
  build(mctx) {
    buildShell(mctx, {});
  },
};
