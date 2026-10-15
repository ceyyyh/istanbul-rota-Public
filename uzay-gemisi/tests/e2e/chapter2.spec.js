// Bölüm 2 — Miller gezegeni uçtan uca akışı (docs/ARCHITECTURE.md §15).
// Kaynaklar: src/gameplay/story/MillerSequence.js, src/gameplay/Missions.js, src/planet/PlanetWorld.js,
//            src/gameplay/crew/Crew.js, src/world/modules/airlock.js, src/world/modules/comms.js
//
// Zamanlama: oyun döngüsü durdurulur. Bekleme döngüleri (pump) oyun zamanını GERÇEK ZAMANA eşit ilerletir
// (simulate ile); böylece setTimeout tabanlı sekanslar (karartma, altyazılar) ve dalga hızı gerçekçi kalır.
// Yürüyüş kısa parçalar halinde yapılır: senkron tek bir evaluate içinde gerçek zamanlayıcılar işlemez.
//
// Etkileşimler ctx.interactions.handles içinden id ile bulunup onInteract çağrılır (mesafe/ışın atlanır);
// etkinleştirme koşulu (enabled) önce kontrol edilir. Diyalog/terminal seçimi klavye Enter ile yapılır.

import { test, expect } from '@playwright/test';
import { openGame, expectNoErrors, installQa, installWalk } from './helpers.js';

const Q =
  'autostart=1&nointro=1&quality=low&flags=intro_done,talked_tars,power_restored,messages_read,ring_spinning,blackhole_observed';

/**
 * Oyun durumunun özeti. sim saniye kadar oyun zamanı ilerler; close ise açık modalı kapatmayı dener.
 * Self-contained olmalı (page.evaluate ile serileştirilir).
 */
function SNAP({ sim = 0, close = false } = {}) {
  const g = window.__game;
  g.simulate(sim);
  if (close && window.__qa && window.__qa.modalOpen()) window.__qa.closeModals();
  const { ctx } = g;
  const wv = ctx.planet ? ctx.planet.wave : null;
  const story = ctx.missions ? ctx.missions.story : null;
  return {
    t: ctx.engine.time,
    world: ctx.world.current,
    flags: { ...ctx.state.flags },
    modal: !!ctx.ui?.isModalOpen?.(),
    frozen: !!ctx.player.frozen,
    pos: [ctx.player.position.x, ctx.player.position.z],
    wave: { active: !!(wv && wv.active), distance: wv ? Math.round(wv.distance) : null },
    elaPinned: !!(story && story.elaPinned),
    busy: !!(story && story.busy),
    hits: window.__qaHits ?? 0,
  };
}

/** Koşul sağlanana kadar oyun zamanını gerçek zamanla eşit ilerletir. */
async function pump(page, until, { maxMs = 120_000, close = false } = {}) {
  const t0 = Date.now();
  let last = t0;
  let snap = null;
  while (Date.now() - t0 < maxMs) {
    const now = Date.now();
    const sim = Math.min(0.5, (now - last) / 1000);
    last = now;
    snap = await page.evaluate(SNAP, { sim, close });
    if (until(snap)) return { ok: true, snap, sec: (Date.now() - t0) / 1000 };
    await page.waitForTimeout(100);
  }
  return { ok: false, snap, sec: (Date.now() - t0) / 1000 };
}

/** Etkileşimi id ile tetikler. enabled() false ise tetiklemez. */
async function fire(page, id) {
  return page.evaluate((id) => {
    const { ctx } = window.__game;
    const h = ctx.interactions.handles.find((x) => x.id === id);
    if (!h) return { found: false, enabled: false };
    const enabled = typeof h.enabled === 'function' ? !!h.enabled() : true;
    if (enabled) h.onInteract({ object: h.object, hit: null, handle: h });
    return { found: true, enabled };
  }, id);
}

/** Gezegen nesnesinin dünya XZ konumu (planet.objects: beacon | debris | ramp). */
async function objectXZ(page, name) {
  return page.evaluate((name) => {
    const o = window.__game.ctx.planet.objects[name];
    o.updateWorldMatrix(true, false);
    const e = o.matrixWorld.elements;
    return { x: e[12], z: e[14] };
  }, name);
}

/**
 * Oyuncuyu (x,z) noktasına yürütür. sprint: Shift basılı (koşu 5 m/s; yürüme 2.7 m/s).
 * Kısa parçalarla çalışır: her parça arasında gerçek zamanlayıcılar (dalga yakalama sekansı vb.) işleyebilir.
 */
async function walkTo(page, p, label, { sprint = false, maxMs = 120_000 } = {}) {
  const t0 = Date.now();
  let r = null;
  while (Date.now() - t0 < maxMs) {
    r = await page.evaluate(
      ([x, z, sprint]) => {
        window.__game.hold('ShiftLeft', sprint);
        return window.__qaWalkTo(x, z, 0.2, 2.8);
      },
      [p.x, p.z, sprint],
    );
    if (r.reached) break;
    await page.waitForTimeout(120);
  }
  await page.evaluate(() => window.__game.hold('ShiftLeft', false));
  expect(r.reached, `${label}: yürüyüş ulaşmadı (blocked=${r.blocked}, pos=${JSON.stringify(r.pos)})`).toBe(true);
  return r;
}

/** Diyalog / terminalde Enter ile ilerler (her basış: daktiloyu tamamlar ya da seçer) until flag. */
async function advanceUntilFlag(page, flag, maxPresses = 120) {
  let snap = null;
  for (let i = 0; i < maxPresses; i++) {
    snap = await page.evaluate(SNAP, { sim: 0.5 });
    if (snap.flags[flag]) return snap;
    await page.keyboard.press('Enter');
    await page.waitForTimeout(120);
  }
  return snap;
}

/** Hava kilidinden Ranger'a biniş → gezegene iniş (miller_landed). */
async function boardAndLand(page) {
  const board = await fire(page, 'airlock.board');
  expect(board, 'airlock.board etkileşimi yok').toMatchObject({ found: true, enabled: true });
  const landing = await pump(page, (s) => s.flags.miller_landed && s.world === 'planet', { maxMs: 120_000 });
  expect(landing.ok, `iniş olmadı: ${JSON.stringify(landing.snap)}`).toBe(true);
  console.log(`[bölüm2] iniş ${landing.sec.toFixed(1)} sn gerçek zaman`);
  return landing.snap;
}

/** Kaydediciyi al → sekans biter, dalga başlar. */
async function getBeacon(page) {
  const beaconAt = await objectXZ(page, 'beacon');
  await walkTo(page, beaconAt, 'kaydedici');
  const b = await fire(page, 'planet.beacon');
  expect(b, 'planet.beacon etkileşimi etkin değil').toMatchObject({ found: true, enabled: true });
  const wave = await pump(page, (s) => s.flags.beacon_found && s.wave.active, { maxMs: 120_000 });
  expect(wave.ok, `kaydedici sonrası dalga başlamadı: ${JSON.stringify(wave.snap)}`).toBe(true);
  console.log(`[bölüm2] kaydedici→dalga ${wave.sec.toFixed(1)} sn gerçek zaman`);
  return wave.snap;
}

test.describe('Bölüm 2 — Miller gezegeni', () => {
  test('tam akış: iniş → kaydedici → Ela → rampa → dönüş → Rami → 23 yıllık mesajlar → bitiş', async ({ page }) => {
    test.setTimeout(480_000);
    const log = await openGame(page, Q);
    await installQa(page);
    await installWalk(page);

    // a. Başlangıç: hava kilidi, Ranger'a biniş → iniş
    const start = await page.evaluate(SNAP);
    expect(start.world).toBe('ship');
    expect(start.flags.ranger_launched).toBeFalsy();
    await boardAndLand(page);

    // b. Gezegen: kaydedici → dalga; Ela enkaza sıkışır
    const afterLand = await page.evaluate(SNAP);
    expect(afterLand.flags.beacon_found).toBeFalsy();
    await getBeacon(page);
    const pinned = await pump(page, (s) => s.elaPinned, { maxMs: 60_000 });
    expect(pinned.ok, 'Ela enkaza sıkışmadı (elaPinned)').toBe(true);

    // Ela kurtarılmadan rampa: kaçış tamamlanmamalı
    const early = await fire(page, 'planet.ramp');
    expect(early.enabled).toBe(true);
    const afterEarly = await page.evaluate(SNAP);
    expect(afterEarly.flags.wave_escaped, 'Ela kurtarılmadan rampa kaçışı tamamlandı').toBeFalsy();
    expect(afterEarly.world).toBe('planet');

    // Ela'yı kurtar (enkaz etkileşimi)
    const debrisAt = await objectXZ(page, 'debris');
    await walkTo(page, debrisAt, 'enkaz', { sprint: true });
    const d = await fire(page, 'planet.debris');
    expect(d, 'planet.debris etkileşimi etkin değil (Ela pinli olmalı)').toMatchObject({ found: true, enabled: true });
    const rescued = await pump(page, (s) => s.flags.ela_rescued, { maxMs: 60_000 });
    expect(rescued.ok, `Ela kurtarılmadı: ${JSON.stringify(rescued.snap)}`).toBe(true);

    // c. Rampa: dalga gelmeden Ranger'a koş
    const rampAt = await objectXZ(page, 'ramp');
    await walkTo(page, rampAt, 'rampa', { sprint: true });
    const r = await fire(page, 'planet.ramp');
    expect(r).toMatchObject({ found: true, enabled: true });
    const back = await pump(page, (s) => s.flags.returned_to_ship && s.world === 'ship' && !s.busy, { maxMs: 120_000 });
    expect(back.ok, `dönüş olmadı: ${JSON.stringify(back.snap)}`).toBe(true);
    console.log(`[bölüm2] kalkış→dönüş ${back.sec.toFixed(1)} sn gerçek zaman`);

    // d. Rami (yaşlanmış) ve 23 yıllık mesajlar
    const aged = await page.evaluate(() => window.__game.ctx.crew.get('rami')?.aged === true);
    expect(aged, 'Rami yaşlanmış değil (aged)').toBe(true);

    const talk = await fire(page, 'crew-rami');
    expect(talk, 'Rami konuşma etkileşimi etkin değil').toMatchObject({ found: true, enabled: true });
    const dlg = await page.evaluate(SNAP);
    expect(dlg.modal, 'Rami diyaloğu açılmadı').toBe(true);
    const ramiSnap = await advanceUntilFlag(page, 'rami_met');
    expect(ramiSnap.flags.rami_met, 'rami_met ayarlanmadı').toBeTruthy();

    expect(ramiSnap.flags.messages_23y_read).toBeFalsy();
    const comms = await fire(page, 'comms-console');
    expect(comms).toMatchObject({ found: true, enabled: true });
    const term = await page.evaluate(SNAP);
    expect(term.modal, 'iletişim konsolu 23 yıllık terminali açmadı').toBe(true);
    const commsSnap = await advanceUntilFlag(page, 'messages_23y_read');
    expect(commsSnap.flags.messages_23y_read, '23 yıllık mesajlar bitmedi').toBeTruthy();

    // e. Bitiş: modal kapanınca mission_complete
    const fin = await pump(page, (s) => s.flags.mission_complete && !s.modal, { maxMs: 60_000, close: true });
    expect(fin.snap.flags.mission_complete, `mission_complete olmadı: ${JSON.stringify(fin.snap.flags)}`).toBe(true);
    for (const f of ['miller_landed', 'beacon_found', 'ela_rescued', 'wave_escaped', 'returned_to_ship', 'rami_met', 'messages_23y_read']) {
      expect(fin.snap.flags[f], `${f} bayrağı yok`).toBeTruthy();
    }
    console.log('[bölüm2] uyarılar (tam akış):', JSON.stringify(log.warnings.slice(0, 8)));
    expectNoErrors(log, 'bölüm 2 tam akış');
  });

  test('dalga yakalar → kontrol noktasından devam (dünya hâlâ gezegen, hata yok)', async ({ page }) => {
    test.setTimeout(300_000);
    const log = await openGame(page, Q);
    await installQa(page);
    await installWalk(page);
    await page.evaluate(() => {
      window.__qaHits = 0;
      window.__game.ctx.bus.on('planet:wave_hit', () => {
        window.__qaHits++;
      });
    });

    await boardAndLand(page);
    await getBeacon(page);

    // Oyuncu hareketsiz bekler; dalga yakalamalı
    const hit = await pump(page, (s) => s.hits >= 1, { maxMs: 150_000 });
    expect(hit.ok, `dalga oyuncuyu yakalamadı: ${JSON.stringify(hit.snap)}`).toBe(true);
    console.log(`[bölüm2] dalga yakalaması ${hit.sec.toFixed(1)} sn gerçek zaman`);

    // Kontrol noktası: dalga yeniden başlar, oyuncu serbest, dünya gezegen kalır
    const again = await pump(page, (s) => s.hits >= 1 && s.wave.active && !s.frozen && !s.modal, { maxMs: 90_000 });
    expect(again.ok, `kontrol noktasından devam edilmedi: ${JSON.stringify(again.snap)}`).toBe(true);
    expect(again.snap.world, 'dalga sonrası dünya planet olmalı').toBe('planet');
    expect(again.snap.flags.beacon_found).toBe(true);
    expect(again.snap.flags.wave_escaped).toBeFalsy();

    // Oyuncu kontrol noktasına (Ela'nın yanı) ışınlanmış olmalı
    const ela = await page.evaluate(() => window.__game.ctx.planet.points.ela);
    const dist = Math.hypot(again.snap.pos[0] - ela.x, again.snap.pos[1] - ela.z);
    expect(dist, `kontrol noktası Ela'dan ${dist.toFixed(1)} m uzakta`).toBeLessThan(8);

    console.log('[bölüm2] uyarılar (dalga):', JSON.stringify(log.warnings.slice(0, 8)));
    expectNoErrors(log, 'dalga yakalama');
  });
});
