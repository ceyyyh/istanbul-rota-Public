// (b) Her modüle ışınlan, birkaç kare çiz: hata yok; çizim çağrısı / üçgen istatistikleri.
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { openGame, expectNoErrors, table, pageLogMark } from './helpers.js';

// Yumuşak eşikler (aşılırsa uyarı notu düşülür, test başarısız olmaz).
// Not: değerler görünen her şeyi içerir (komşu modüller, koridorlar, dış gövde, uzay, işlem sonrası geçişler).
const SOFT = { calls: 250, triangles: 200_000 };
// Sert eşikler (aşılırsa test başarısız): açıkça bozuk bir durum
const HARD = { calls: 1500, triangles: 2_000_000 };

const VIEWS = [
  { name: 'ileri(+X)', lx: -3, lz: 0, yaw: 0 },
  { name: 'dış(-Z)', lx: 0, lz: 1.5, yaw: 90 },
];

test('12 modülde çizim: hata yok, çizim çağrısı/üçgen tablosu', async ({ page }) => {
  test.setTimeout(300_000);
  const log = await openGame(page, 'autostart=1&nointro=1&quality=low&flags=power_restored');
  const ids = await page.evaluate(() => window.__game.ctx.layout.MODULE_IDS);
  const rows = [];
  const perModuleErrors = {};

  for (const id of ids) {
    for (const v of VIEWS) {
      const mark = await pageLogMark(page);
      const t0 = Date.now();
      const r = await page.evaluate(
        ({ id, v }) => {
          const g = window.__game;
          const { engine, renderer, player } = g.ctx;
          g.teleport(id, v.lx, v.lz, v.yaw);
          g.simulate(0.25); // kapılar/ışıklar otursun
          let calls = 0;
          let tris = 0;
          let maxCalls = 0;
          const N = 3;
          for (let i = 0; i < N; i++) {
            engine.step(1 / 60, true);
            calls += renderer.info.render.calls;
            tris += renderer.info.render.triangles;
            maxCalls = Math.max(maxCalls, renderer.info.render.calls);
          }
          const m = g.ctx.ship.getModule(id);
          let dyn = 0;
          m.group.traverse((o) => {
            if (o !== m.group && o.userData.dynamic) dyn++;
          });
          let meshes = 0;
          let moduleTris = 0;
          m.group.traverse((o) => {
            if (!o.isMesh || !o.geometry) return;
            meshes++;
            const geo = o.geometry;
            const cnt = geo.index ? geo.index.count : geo.attributes.position?.count ?? 0;
            moduleTris += (cnt / 3) * (o.isInstancedMesh ? o.count : 1);
          });
          return {
            calls: Math.round(calls / N),
            maxCalls,
            triangles: Math.round(tris / N),
            programs: renderer.info.programs?.length ?? 0,
            geometries: renderer.info.memory.geometries,
            textures: renderer.info.memory.textures,
            loc: player.location.id,
            dynamic: dyn,
            meshes,
            moduleTris: Math.round(moduleTris),
          };
        },
        { id, v },
      );
      const ms = Date.now() - t0;
      const newLogs = await page.evaluate((m) => (window.__qaLog || []).slice(m).filter((l) => l.k !== 'warn'), mark);
      if (newLogs.length) perModuleErrors[`${id}/${v.name}`] = newLogs.map((l) => l.t.slice(0, 300));
      rows.push({ modül: id, görünüm: v.name, çağrı: r.calls, üçgen: r.triangles, 'modül üçgen': r.moduleTris, mesh: r.meshes, dinamik: r.dynamic, program: r.programs, doku: r.textures, ms, konum: r.loc });
      expect(r.loc, `${id}'e ışınlanılamadı`).toBe(id);
    }
  }

  const tbl = table(rows, ['modül', 'görünüm', 'çağrı', 'üçgen', 'modül üçgen', 'mesh', 'dinamik', 'program', 'doku', 'ms']);
  console.log('\n[çizim] modül başına istatistik (quality=low, 480x270)\n' + tbl + '\n');
  try {
    const dir = path.join(process.cwd(), 'test-results');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'qa-render-stats.json'), JSON.stringify(rows, null, 2));
    fs.writeFileSync(path.join(dir, 'qa-render-stats.txt'), tbl + '\n');
  } catch {
    /* yoksay */
  }

  // Yumuşak eşikler → uyarı
  for (const r of rows) {
    const warn = [];
    if (r.çağrı > SOFT.calls) warn.push(`çağrı ${r.çağrı} > ${SOFT.calls}`);
    if (r.üçgen > SOFT.triangles) warn.push(`üçgen ${r.üçgen} > ${SOFT.triangles}`);
    if (r['modül üçgen'] > 40_000) warn.push(`modül üçgen ${r['modül üçgen']} > 40000 (bütçe)`);
    if (r.dinamik > 25 * 3) warn.push(`dinamik nesne ${r.dinamik} (alt nesneler dahil) çok`);
    if (warn.length) test.info().annotations.push({ type: 'uyarı', description: `${r.modül}/${r.görünüm}: ${warn.join(', ')}` });
  }
  // Sert eşikler
  for (const r of rows) {
    expect(r.çağrı, `${r.modül}/${r.görünüm} çizim çağrısı`).toBeLessThan(HARD.calls);
    expect(r.üçgen, `${r.modül}/${r.görünüm} üçgen`).toBeLessThan(HARD.triangles);
  }
  expect(perModuleErrors, 'modül çiziminde hata').toEqual({});
  expectNoErrors(log, 'çizim');
});
