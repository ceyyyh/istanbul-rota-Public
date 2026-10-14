import { buildShell } from '../structure/shell.js';

/**
 * Motor ve Enerji — TASLAK. Sahibi ajan bu dosyayı tamamen yeniden yazacak.
 * Sözleşme için bkz. docs/ARCHITECTURE.md ("Modül sözleşmesi").
 */
export default {
  id: 'engine',
  name: 'Motor ve Enerji',
  build(mctx) {
    buildShell(mctx, { wall: 'dark', floor: 'grate' });
  },
};
