// (e) Etkileşim taraması: kayıtlı her etkileşimi tek tek tetikle; istisna/konsol hatası olmamalı.
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { openGame, installQa, table } from './helpers.js';

/**
 * Sayfa içinde: tüm tutamaçları sırayla tetikler.
 * Her tetiklemeden sonra kısa simülasyon (animasyon/onUpdate hataları da yakalanır),
 * açılan modal kapatılmaya çalışılır.
 */
async function sweep(page, label) {
  return page.evaluate(async (label) => {
    const g = window.__game;
    const { ctx } = g;
    const handles = [...ctx.interactions.handles];
    const results = [];
    const describe = (h) => {
      const o = h.object;
      let p = o;
      let mod = null;
      while (p) {
        if (p.name?.startsWith('module-')) {
          mod = p.name.slice(7);
          break;
        }
        p = p.parent;
      }
      let prompt;
      try {
        prompt = typeof h.prompt === 'function' ? h.prompt() : h.prompt;
      } catch (err) {
        prompt = `!! prompt hatası: ${err.message}`;
      }
      return { id: h.id || o.name || o.type, module: mod || (o.parent ? '?' : 'sahne-dışı'), prompt: String(prompt ?? '').slice(0, 60) };
    };
    for (let i = 0; i < handles.length; i++) {
      const h = handles[i];
      if (!ctx.interactions.handles.includes(h)) {
        results.push({ i, ...describe(h), status: 'kaldırıldı' });
        continue;
      }
      const d = describe(h);
      const mark = window.__qaLog.length;
      let status = 'ok';
      let error = null;
      let enabled = true;
      try {
        enabled = typeof h.enabled === 'function' ? !!h.enabled() : h.enabled !== false;
      } catch (err) {
        status = 'HATA';
        error = `enabled(): ${err.message}`;
      }
      // Oyuncuyu nesnenin yanına taşı (bazı işleyiciler konuma bakabilir)
      try {
        const wp = new ctx.THREE.Vector3();
        h.object.getWorldPosition(wp);
        const loc = ctx.layout.locate(wp.x, wp.z);
        if (loc.region === 'module') g.teleport(loc.id, Math.max(-4.5, Math.min(4.5, loc.lx)), 0, 0);
      } catch {
        /* yoksay */
      }
      try {
        const ret = h.onInteract({ object: h.object, hit: null, handle: h });
        if (ret && typeof ret.then === 'function') {
          await Promise.race([ret, new Promise((r) => setTimeout(r, 1500))]);
        }
        ctx.bus.emit('interact', { id: h.id, object: h.object });
      } catch (err) {
        status = 'İSTİSNA';
        error = String(err?.stack || err).split('\n').slice(0, 3).join(' | ');
      }
      let simErr = null;
      try {
        g.simulate(0.5);
      } catch (err) {
        simErr = String(err?.message || err);
      }
      const modal = !!ctx.ui?.isModalOpen?.();
      let closed = null;
      if (modal) closed = window.__qa.closeModals();
      try {
        g.simulate(0.2);
      } catch {
        /* yoksay */
      }
      const logs = window.__qaLog.slice(mark).filter((l) => l.k !== 'warn');
      if (logs.length && status === 'ok') {
        status = 'KONSOL-HATA';
        error = logs.map((l) => l.t.split('\n')[0]).join(' || ').slice(0, 400);
      }
      if (simErr) {
        status = 'İSTİSNA';
        error = `simulate: ${simErr}`;
      }
      // Oyuncu donmuş kaldıysa (sinematik) çöz — sonraki tetiklemeleri etkilemesin
      const frozen = ctx.player.frozen;
      results.push({ i, ...d, enabled, status, modal: modal ? (closed ? 'açıldı→kapandı' : 'AÇIK KALDI') : '', frozen, error });
      if (modal && !closed) break; // modal kapanmıyorsa devam etmenin anlamı yok
    }
    return { label, count: handles.length, results, flags: { ...ctx.state.flags } };
  }, label);
}

for (const [label, query] of [
  ['enerjisiz', 'autostart=1&nointro=1&quality=low'],
  ['enerjili', 'autostart=1&nointro=1&quality=low&flags=power_restored,talked_tars'],
]) {
  test(`etkileşim taraması (${label}): istisna yok`, async ({ page }) => {
    test.setTimeout(300_000);
    const log = await openGame(page, query);
    await installQa(page);
    const res = await sweep(page, label);
    const rows = res.results.map((r) => ({ '#': r.i, modül: r.module, id: r.id, ipucu: r.prompt, etkin: r.enabled ? 'evet' : 'hayır', durum: r.status, modal: r.modal, hata: r.error || '' }));
    console.log(`\n[etkileşim ${label}] ${res.count} tutamaç\n` + table(rows, ['#', 'modül', 'id', 'ipucu', 'etkin', 'durum', 'modal', 'hata']));
    console.log(`[etkileşim ${label}] son bayraklar: ${JSON.stringify(res.flags)}`);
    try {
      const dir = path.join(process.cwd(), 'test-results');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, `qa-interactions-${label}.json`), JSON.stringify(res, null, 2));
    } catch {
      /* yoksay */
    }
    const bad = res.results.filter((r) => r.status === 'İSTİSNA' || r.status === 'HATA');
    const consoleBad = res.results.filter((r) => r.status === 'KONSOL-HATA');
    const stuck = res.results.filter((r) => r.modal === 'AÇIK KALDI');
    if (consoleBad.length) test.info().annotations.push({ type: 'uyarı', description: `konsol hatası: ${consoleBad.map((r) => `${r.module}/${r.id}`).join(', ')}` });
    expect(bad, 'etkileşimde istisna').toEqual([]);
    expect(stuck, 'kapatılamayan modal').toEqual([]);
    expect(consoleBad.map((r) => `${r.module}/${r.id}: ${r.error}`), 'etkileşim sırasında console.error').toEqual([]);
    const pageErrors = log.errors.filter((e) => e.startsWith('[pageerror]'));
    expect(pageErrors).toEqual([]);
  });
}
