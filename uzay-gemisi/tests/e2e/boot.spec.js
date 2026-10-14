// (a) Açılış: hatasız yüklenir, gemi eksiksiz kurulur.
import { test, expect } from '@playwright/test';
import { openGame, expectNoErrors, DEFAULT_QUERY } from './helpers.js';

test.describe('Açılış', () => {
  test('autostart+nointro: hata yok, 12 modül + 12 koridor kuruldu', async ({ page }) => {
    const log = await openGame(page, DEFAULT_QUERY);
    console.log(`[açılış] hazır olma süresi: ${log.bootMs} ms`);

    const info = await page.evaluate(() => {
      const { ctx } = window.__game;
      const ship = ctx.ship;
      return {
        started: window.__game.started,
        modules: ship.modules.map((m) => ({
          id: m.id,
          index: m.index,
          children: m.group.children.length,
          colliders: m.colliders?.length ?? 0,
          sources: m.stats?.sources ?? null,
          merged: m.stats?.merged ?? null,
          ms: Math.round(m.ms),
        })),
        corridors: ship.corridors.length,
        layoutIds: ctx.layout.MODULE_IDS,
        hub: !!ship.hub,
        doors: ctx.doors.length,
        poolSize: ctx.lighting.pool.length,
        qualityLights: ctx.engine.quality.lights,
        qualityName: ctx.engine.qualityName,
        lightRecords: ctx.lighting.records.length,
        handles: ctx.interactions.handles.length,
        playerLoc: ctx.player.location,
        hasApi: ['ready', 'teleport', 'setFlags', 'hold', 'press', 'simulate'].every((k) => k in window.__game),
        ctxKeys: ['THREE', 'engine', 'scene', 'camera', 'renderer', 'bus', 'state', 'input', 'collision', 'lighting', 'materials', 'layout', 'player', 'interactions', 'ui', 'audio', 'space', 'doors', 'doorOpeners', 'ship', 'tars', 'missions', 'params', 'onUpdate'].filter((k) => !(k in ctx)),
      };
    });

    expect(info.hasApi, '__game API eksik').toBe(true);
    expect(info.ctxKeys, 'ctx içinde eksik alanlar').toEqual([]);
    expect(info.started).toBe(true);
    expect(info.modules).toHaveLength(12);
    expect(info.modules.map((m) => m.id)).toEqual(info.layoutIds);
    expect(info.corridors).toBe(12);
    expect(info.qualityName).toBe('low');
    // Gerçek ışık sayısı kaliteye göre sabit (low → 4)
    expect(info.poolSize).toBe(info.qualityLights);
    // Her modülde içerik ve en az birkaç çarpışma engeli olmalı
    for (const m of info.modules) {
      expect(m.children, `${m.id}: boş grup`).toBeGreaterThan(0);
      expect(m.colliders, `${m.id}: çarpışma engeli yok`).toBeGreaterThan(3);
    }
    // Her modülün iki kapısı olmalı (en az 24 kapı)
    expect(info.doors).toBeGreaterThanOrEqual(24);
    // Oyuncu hiper-uyku bölmesinde uyanır
    expect(info.playerLoc.id).toBe('cryo');

    // [ship] yedek kabuk uyarısı / hatası olmamalı
    const shipMsgs = log.logs.filter((l) => /\[ship\]/.test(l.text));
    expect(shipMsgs.map((l) => `${l.type}: ${l.text}`), 'yedek kabuk / kurulum sorunu').toEqual([]);
    expectNoErrors(log, 'açılış');

    // Modül kurulum süreleri (bilgi)
    console.log('[açılış] modül kurulum (ms):', info.modules.map((m) => `${m.id}:${m.ms}`).join(' '));
    console.log(`[açılış] ışık kaydı: ${info.lightRecords}, havuz: ${info.poolSize}, etkileşim: ${info.handles}, kapı: ${info.doors}`);
  });

  test('modül başına ışık bütçesi ≤ 4 (addLight) ve ışık havuzu sabit', async ({ page }) => {
    const log = await openGame(page, DEFAULT_QUERY);
    const res = await page.evaluate(() => {
      const { ctx } = window.__game;
      const { layout, lighting } = ctx;
      // Işık kayıtlarını konumlarına göre modüllere say (koridor ışıkları hariç)
      const per = {};
      for (const r of lighting.records) {
        const loc = layout.locate(r.position.x, r.position.z);
        if (loc.region !== 'module') continue;
        per[loc.id] = (per[loc.id] || 0) + 1;
      }
      const countPointLights = () => {
        let n = 0;
        ctx.scene.traverse((o) => {
          if (o.isPointLight) n++;
        });
        return n;
      };
      const before = countPointLights();
      window.__game.simulate(1);
      ctx.state.set('power_restored', true);
      window.__game.simulate(3);
      const after = countPointLights();
      const invisible = [];
      ctx.scene.traverse((o) => {
        if (o.isPointLight && !o.visible) invisible.push(o.name || o.uuid);
      });
      return { per, before, after, invisible, mode: lighting.mode };
    });
    console.log('[ışık] modül başına addLight:', JSON.stringify(res.per));
    const over = Object.entries(res.per).filter(([, n]) => n > 4);
    if (over.length) test.info().annotations.push({ type: 'uyarı', description: `4'ten fazla ışık: ${JSON.stringify(over)}` });
    expect(over, 'modül başına en fazla 4 addLight').toEqual([]);
    expect(res.after, 'PointLight sayısı değişmemeli').toBe(res.before);
    expect(res.invisible, 'visible=false ışık olmamalı').toEqual([]);
    expect(res.mode).toBe('normal');
    expectNoErrors(log);
  });
});
