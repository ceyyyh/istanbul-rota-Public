/**
 * Motor modülündeki sigorta paneli bulmacasının saf mantığı (THREE bağımlılığı yok, test edilebilir).
 *
 * Doğru sıra teşhis ekranında yazar. Yanlış sigorta kaldırılırsa panel aşırı akım korumasıyla
 * TÜM sigortaları atar ve ilerleme sıfırlanır.
 */

/** Sıfırlama sırası (sigorta numaraları, 1 tabanlı). Teşhis ekranı ve not bunu gösterir. */
export const FUSE_ORDER = Object.freeze([3, 1, 4, 2, 5]);

/** Sigortaların bağlı olduğu alt sistemler (etiketler için). */
export const FUSE_NAMES = Object.freeze({
  1: 'YAŞAM DESTEK',
  2: 'AYDINLATMA',
  3: 'ANA BARA',
  4: 'SOĞUTMA',
  5: 'İLETİŞİM / SEYİR',
});

export class FusePuzzle {
  constructor(order = FUSE_ORDER) {
    this.order = [...order];
    this.count = this.order.length;
    this.progress = 0;
    this.up = new Set();
    this.solved = false;
    this.mistakes = 0;
  }

  /** Bir sonraki beklenen sigorta (çözüldüyse null). */
  get expected() {
    return this.solved ? null : this.order[this.progress];
  }

  isUp(n) {
    return this.up.has(n);
  }

  /**
   * Sigorta n'i kaldır.
   * @returns {'ok'|'wrong'|'solved'|'ignored'}
   */
  raise(n) {
    if (this.solved || this.up.has(n) || n < 1 || n > this.count) return 'ignored';
    if (this.order[this.progress] === n) {
      this.up.add(n);
      this.progress++;
      if (this.progress === this.count) {
        this.solved = true;
        return 'solved';
      }
      return 'ok';
    }
    this.mistakes++;
    this.reset();
    return 'wrong';
  }

  reset() {
    this.progress = 0;
    this.up.clear();
  }

  /** Enerji başka yoldan geldiyse paneli tamamlanmış göster. */
  solve() {
    this.solved = true;
    this.up = new Set(this.order);
    this.progress = this.count;
  }
}
