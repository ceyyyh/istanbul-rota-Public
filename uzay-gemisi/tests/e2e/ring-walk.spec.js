// (c) Halka turu (enerjili) ve (d) kumanda modülü kilidi.
import { test, expect } from '@playwright/test';
import { openGame, expectNoErrors, installQa, installWalk } from './helpers.js';

const POWERED = 'autostart=1&nointro=1&quality=low&flags=power_restored';
const UNPOWERED = 'autostart=1&nointro=1&quality=low';

/** Sayfa içinde: ringPath boyunca yürür. dir=+1 (i→i+1) veya -1. */
async function walkRing(page, dir) {
  return page.evaluate(
    ({ dir }) => {
      const g = window.__game;
      const { player, layout } = g.ctx;
      const path = layout.ringPath();
      const ordered = dir > 0 ? path : [...path].reverse();
      const start = layout.spawnPoint('cryo');
      g.teleport('cryo', 0, 0, dir > 0 ? 0 : 180);
      let idx = ordered.findIndex((p) => p.index === 1 && p.kind === 'center');
      const log = [];
      for (let n = 1; n <= ordered.length; n++) {
        const wp = ordered[(idx + n) % ordered.length];
        const r = window.__qaWalkTo(wp.x, wp.z, 20, 0.5);
        log.push({ wp: `${wp.index}:${layout.MODULE_IDS[wp.index]}:${wp.kind}`, ok: r.reached, s: +r.seconds.toFixed(2), blocked: r.blocked, at: `${r.loc.id}/${r.loc.region} lx=${r.loc.lx.toFixed(2)} lz=${r.loc.lz.toFixed(2)}` });
        if (!r.reached) break;
      }
      return { log, start: { x: start.x, z: start.z } };
    },
    { dir },
  );
}

for (const [dir, name] of [
  [1, 'ileri (i→i+1)'],
  [-1, 'geri (i→i-1)'],
]) {
  test(`halka turu enerjili — ${name}: her ara nokta ≤ 20 sn`, async ({ page }) => {
    test.setTimeout(240_000);
    const log = await openGame(page, POWERED);
    await installQa(page);
    await installWalk(page);
    const res = await walkRing(page, dir);
    const failed = res.log.filter((l) => !l.ok);
    const slow = res.log.filter((l) => l.ok && l.s > 10);
    const total = res.log.reduce((a, l) => a + l.s, 0);
    console.log(`[halka ${name}] ${res.log.length} ara nokta, toplam ${total.toFixed(1)} sn simülasyon`);
    if (slow.length) console.log(`[halka ${name}] yavaş (>10 sn):`, slow.map((l) => `${l.wp} ${l.s}s`).join(', '));
    const blocked = res.log.filter((l) => l.blocked);
    if (blocked.length) test.info().annotations.push({ type: 'uyarı', description: `yürüyüşte modal/donma: ${blocked.map((l) => `${l.wp}:${l.blocked}`).join(', ')}` });
    expect(failed, `TAKILDI:\n${failed.map((l) => `${l.wp} @ ${l.at} (${l.blocked || ''})`).join('\n')}`).toEqual([]);
    expect(res.log).toHaveLength(36);
    expectNoErrors(log, 'halka turu');
  });
}

test('kilit: enerji yokken cryo → kumanda (-X) kapıda durur; power_restored sonrası geçilir', async ({ page }) => {
  test.setTimeout(180_000);
  const log = await openGame(page, UNPOWERED);
  await installQa(page);
  await installWalk(page);

  const res = await page.evaluate(() => {
    const g = window.__game;
    const { player, layout, bus, state, doors } = g.ctx;
    const lockedEvents = [];
    const off = bus.on('door:locked', (e) => lockedEvents.push(e?.position ? [e.position.x, e.position.z] : null));
    const powered0 = state.is('power_restored');
    // cryo merkezinden -X yönüne bak
    g.teleport('cryo', 0, 0, 180);
    const target = layout.localToWorld(0, 0, 0); // kumanda modülü merkezi
    const enter = layout.localToWorld(0, 5.5 - 0.6, 0); // kumanda modülünün +X kapısının hemen içi
    const before = window.__qaWalkTo(enter.x, enter.z, 20, 0.5);
    // Kumanda modülünün içine (kapının ötesine) geçilmemeli
    const loc = player.location;
    const insideCommand = loc.id === 'command' && loc.region === 'module' && loc.lx < 5.5 - 0.1;
    const lockedDoors = doors.filter((d) => d.locked).length;
    // Enerjiyi ver
    g.setFlags('power_restored');
    g.simulate(0.5);
    const lockedAfter = doors.filter((d) => d.locked).length;
    const after = window.__qaWalkTo(target.x, target.z, 25, 0.5);
    off();
    return {
      powered0,
      before: { reached: before.reached, loc: before.loc, blocked: before.blocked },
      insideCommand,
      lockedDoors,
      lockedAfter,
      lockedEvents: lockedEvents.length,
      after: { reached: after.reached, loc: after.loc, seconds: after.seconds, blocked: after.blocked },
    };
  });
  console.log('[kilit]', JSON.stringify(res));
  expect(res.powered0, 'başlangıçta enerji olmamalı').toBe(false);
  expect(res.lockedDoors, 'enerji yokken kilitli kapı olmalı').toBeGreaterThanOrEqual(1);
  expect(res.before.reached, 'enerji yokken kumanda modülüne girilmemeli').toBe(false);
  expect(res.insideCommand).toBe(false);
  expect(res.lockedEvents, "kilitli kapıda 'door:locked' olayı yayılmalı").toBeGreaterThanOrEqual(1);
  expect(res.lockedAfter, 'enerji sonrası kilitli kapı kalmamalı (kumanda)').toBeLessThan(res.lockedDoors);
  expect(res.after.reached, `enerji sonrası kumanda merkezine ulaşılmalı (konum ${JSON.stringify(res.after.loc)})`).toBe(true);
  expect(res.after.loc.id).toBe('command');
  expectNoErrors(log, 'kilit');
});

test('enerjisiz: kumanda dışındaki halka (cryo → observation, +X yönünde) yürünebilir', async ({ page }) => {
  test.setTimeout(240_000);
  const log = await openGame(page, UNPOWERED);
  await installQa(page);
  await installWalk(page);
  const res = await page.evaluate(() => {
    const g = window.__game;
    const { layout } = g.ctx;
    const path = layout.ringPath();
    g.teleport('cryo', 0, 0, 0);
    const out = [];
    // cryo merkezinden ileri, observation (11) çıkışına kadar (kumanda hariç)
    const start = path.findIndex((p) => p.index === 1 && p.kind === 'center');
    for (let i = start + 1; i < path.length; i++) {
      const wp = path[i];
      const r = window.__qaWalkTo(wp.x, wp.z, 20, 0.5);
      out.push({ wp: `${layout.MODULE_IDS[wp.index]}:${wp.kind}`, ok: r.reached, at: `${r.loc.id}/${r.loc.region} lx=${r.loc.lx.toFixed(2)}` });
      if (!r.reached) break;
    }
    return out;
  });
  const failed = res.filter((r) => !r.ok);
  expect(failed, `enerjisiz halkada takılma: ${JSON.stringify(failed)}`).toEqual([]);
  expectNoErrors(log, 'enerjisiz halka');
});
