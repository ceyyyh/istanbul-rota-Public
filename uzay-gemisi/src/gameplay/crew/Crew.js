import * as THREE from 'three';

/**
 * Mürettebat NPC'leri (TASLAK — Ajan M "Mürettebat" yeniden yazacak; API sabit kalmalı).
 *
 * Kadro (özgün karakterler, filmden esinli roller):
 *   'ela'   — Dr. Ela Yıldız, biyolog; iniş ekibinde (Brand rolü)
 *   'doruk' — Doruk Aral, görev uzmanı; iniş ekibinde (Doyle rolü)
 *   'rami'  — Prof. Rami Kaya, fizikçi; gemide kalır, dönüşte 23 yaş yaşlanmış (Romilly rolü)
 *
 * API:
 *   crew.get(id) → npc
 *   npc.group                         THREE.Group (ctx.scene içinde, dinamik)
 *   npc.id, npc.name
 *   npc.placeAt(x, z, yaw)            dünya koordinatı
 *   npc.setPose('idle'|'walk'|'sit'|'type'|'run'|'wave')
 *   npc.walkTo(x, z, { speed, run }) → Promise   (düz çizgide yürür; varınca idle)
 *   npc.follow(targetVec3 | null, { distance })  hedefi takip et (gezegende oyuncu)
 *   npc.lookAt(x, z)
 *   npc.say(text, ms?)                altyazı + (varsa) konuşma sentezi
 *   npc.setAged(bool)                 yaşlanmış görünüm (gri saç/sakal)
 *   npc.setVisible(bool)
 *   npc.talk = { prompt, onTalk }     etkileşim metnini/işleyicisini değiştir (görev akışı için)
 *   crew.update(dt, t)
 * Olay: 'crew:talk' { id }
 */
class Npc {
  constructor(ctx, id, name, color) {
    this.ctx = ctx;
    this.id = id;
    this.name = name;
    this.group = new THREE.Group();
    this.group.name = `npc-${id}`;
    this.group.userData.dynamic = true;
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.8 });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 1.1, 4, 8), mat);
    body.position.y = 0.9;
    this.group.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 8), new THREE.MeshStandardMaterial({ color: 0xc8a080 }));
    head.position.y = 1.65;
    this.group.add(head);
    ctx.scene.add(this.group);
    this.talk = { prompt: `${name} ile konuş`, onTalk: () => this.say('Şimdi meşgulüm.') };
    ctx.interactions.add(body, {
      id: `crew-${id}`,
      prompt: () => this.talk.prompt,
      onInteract: () => {
        ctx.bus.emit('crew:talk', { id });
        this.talk.onTalk?.();
      },
    });
  }
  placeAt(x, z, yaw = 0) {
    this.group.position.set(x, 0, z);
    this.group.rotation.y = yaw;
  }
  setPose() {}
  walkTo(x, z) {
    this.placeAt(x, z, this.group.rotation.y);
    return Promise.resolve();
  }
  follow() {}
  lookAt(x, z) {
    this.group.rotation.y = Math.atan2(x - this.group.position.x, z - this.group.position.z);
  }
  say(text, ms = 4000) {
    this.ctx.ui?.subtitle?.(this.name, text, ms);
  }
  setAged() {}
  setVisible(v) {
    this.group.visible = v;
  }
}

export class Crew {
  constructor(ctx) {
    this.ctx = ctx;
    const L = ctx.layout;
    this.members = new Map();
    const defs = [
      ['ela', 'Dr. Ela Yıldız', 0x8a8f96, 'lab', 0, 2],
      ['doruk', 'Doruk Aral', 0x6f7680, 'command', -2, 1.5],
      ['rami', 'Prof. Rami Kaya', 0x7a7468, 'observation', 2, 1.5],
    ];
    for (const [id, name, color, mod, lx, lz] of defs) {
      const npc = new Npc(ctx, id, name, color);
      const p = L.localToWorld(L.moduleIndexById(mod), lx, lz);
      npc.placeAt(p.x, p.z, 0);
      this.members.set(id, npc);
    }
  }
  get(id) {
    return this.members.get(id);
  }
  update() {}
}
