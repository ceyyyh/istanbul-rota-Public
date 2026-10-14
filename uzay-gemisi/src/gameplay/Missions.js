/**
 * Görev zinciri (TASLAK — Ajan 5 "TARS & Oynanış" yeniden yazacak).
 * Bayraklar ve akış: docs/ARCHITECTURE.md ("Görev akışı").
 */
export class Missions {
  constructor(ctx) {
    this.ctx = ctx;
  }
  start() {
    const { ui, state } = this.ctx;
    ui.setObjective('TARS ile konuş');
    state.set('intro_done', true);
  }
  update() {}
}
