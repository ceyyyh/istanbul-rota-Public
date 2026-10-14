import { buildShell } from '../structure/shell.js';

/**
 * Robotik Atölye — TASLAK. Sahibi ajan bu dosyayı tamamen yeniden yazacak.
 * Sözleşme için bkz. docs/ARCHITECTURE.md ("Modül sözleşmesi").
 */
export default {
  id: 'robotics',
  name: 'Robotik Atölye',
  build(mctx) {
    buildShell(mctx, {});
  },
};
