'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../src/core.js');

// ---------- Poligon ----------
test('Avrupa yakası içindeki noktalar kabul edilir', () => {
  const inside = {
    Taksim: [41.037, 28.985],
    Bakırköy: [40.98, 28.87],
    Şişli: [41.06, 28.987],
    Sarıyer: [41.167, 29.05],
    Beylikdüzü: [40.98, 28.64],
    Silivri: [41.07, 28.25],
    Rumelihisarı: [41.085, 29.055],
    'Rumeli Hisarı kalesi': [41.0846, 29.0565],
    'Arnavutköy-Boğaz': [41.0675, 29.043],
    'Ortaköy Camii': [41.0473, 29.027],
    Yeniköy: [41.12, 29.07],
    Garipçe: [41.21, 29.10],
    'Topkapı Sarayı': [41.0115, 28.9834],
    Kumkapı: [41.003, 28.965],
    'Beylikdüzü (41.0)': [41.0, 28.64],
    Kumburgaz: [41.022, 28.47],
    Mimarsinan: [41.02, 28.53],
    'Gürpınar': [40.965, 28.6],
    'Arnavutköy (batı)': [41.18, 28.74],
    Çatalca: [41.14, 28.46],
    Eminönü: [41.017, 28.97],
    'Beşiktaş (41.043)': [41.043, 29.007],
    'Karaköy (41.022)': [41.022, 28.977]
  };
  for (const [name, [lat, lon]] of Object.entries(inside)) {
    assert.equal(C.isInEuropeanSide(lat, lon), true, name);
  }
});

test('Avrupa yakası dışındaki noktalar reddedilir', () => {
  const outside = {
    Kadıköy: [40.99, 29.03],
    Üsküdar: [41.026, 29.015],
    Marmara: [40.8, 28.9],
    Karadeniz: [41.7, 28.5],
    'Anadolu Hisarı': [41.083, 29.067],
    Kanlıca: [41.10, 29.065],
    Kuzguncuk: [41.035, 29.03],
    Vaniköy: [41.06, 29.06],
    Kandilli: [41.075, 29.057],
    Çubuklu: [41.105, 29.08],
    Beykoz: [41.13, 29.10],
    Beylerbeyi: [41.045, 29.045],
    Çengelköy: [41.05, 29.05],
    'Anadolu Kavağı': [41.17, 29.09],
    Ataşehir: [40.99, 29.11],
    Ankara: [39.93, 32.86],
    Batı: [41.1, 27.5]
  };
  for (const [name, [lat, lon]] of Object.entries(outside)) {
    assert.equal(C.isInEuropeanSide(lat, lon), false, name);
  }
});

test('Koordinat doğrulama', () => {
  assert.throws(() => C.isInEuropeanSide(NaN, 28.9), TypeError);
  assert.throws(() => C.isInEuropeanSide(41, undefined), TypeError);
  assert.throws(() => C.isInEuropeanSide('41', '28'), TypeError);
  assert.throws(() => C.isInEuropeanSide(Infinity, 28), TypeError);
  assert.throws(() => C.isInEuropeanSide(91, 28), RangeError);
  assert.throws(() => C.isInEuropeanSide(41, 181), RangeError);
  assert.throws(() => C.buildReverseUrl(-91, 0), RangeError);
});

// ---------- URL'ler ----------
test('buildSearchUrl parametreleri ve encode', () => {
  const u = C.buildSearchUrl('Galata Kulesi & çay');
  assert.ok(u.startsWith('https://nominatim.openstreetmap.org/search?q='));
  assert.ok(u.includes('q=' + encodeURIComponent('Galata Kulesi & çay') + '&'));
  for (const p of ['format=jsonv2', 'limit=5', 'accept-language=tr', 'countrycodes=tr',
    'viewbox=28.0,41.6,29.15,40.85', 'bounded=1']) {
    assert.ok(u.includes(p), p);
  }
  assert.equal(C.buildSearchUrl('  a   b ').includes('q=a%20b&'), true);
  assert.throws(() => C.buildSearchUrl('   '));
  assert.throws(() => C.buildSearchUrl(null), TypeError);
});

test('buildReverseUrl', () => {
  const u = C.buildReverseUrl(41.037, 28.985);
  assert.equal(u, 'https://nominatim.openstreetmap.org/reverse?lat=41.037&lon=28.985&format=jsonv2&zoom=18&accept-language=tr');
});

test('buildRouteUrl lon,lat sırası ve profiller', () => {
  const from = { lat: 41.037, lon: 28.985 };
  const to = { lat: 40.98, lon: 28.87 };
  const car = C.buildRouteUrl('car', from, to);
  assert.equal(car, 'https://routing.openstreetmap.de/routed-car/route/v1/driving/28.985,41.037;28.87,40.98?alternatives=true&steps=true&geometries=geojson&overview=full');
  assert.ok(C.buildRouteUrl('foot', from, to).includes('/routed-foot/route/v1/driving/'));
  assert.ok(C.buildRouteUrl('bike', from, to).includes('/routed-bike/route/v1/driving/'));
  assert.throws(() => C.buildRouteUrl('uçak', from, to), /Bilinmeyen/);
  assert.throws(() => C.buildRouteUrl('toString', from, to), /Bilinmeyen/);
  assert.throws(() => C.buildRouteUrl(undefined, from, to), /Bilinmeyen/);
  assert.throws(() => C.buildRouteUrl('car', { lat: NaN, lon: 1 }, to), TypeError);
  assert.throws(() => C.buildRouteUrl('car', from, { lat: 41, lon: 500 }), RangeError);
  assert.throws(() => C.buildRouteUrl('car', null, to), TypeError);
});

// ---------- pickBestRoute ----------
test('pickBestRoute', () => {
  assert.equal(C.pickBestRoute([]), null);
  assert.equal(C.pickBestRoute(undefined), null);
  assert.equal(C.pickBestRoute(null), null);
  const a = { duration: 600, distance: 5000 };
  const b = { duration: 500, distance: 7000 };
  const c = { duration: 500, distance: 6000 };
  assert.equal(C.pickBestRoute([a]), a);
  assert.equal(C.pickBestRoute([a, b]), b);
  assert.equal(C.pickBestRoute([a, b, c]), c, 'eşit süre: kısa mesafe');
  assert.equal(C.pickBestRoute([c, b, a]), c);
  const d = { duration: 500, distance: 6000 };
  assert.equal(C.pickBestRoute([c, d]), c, 'tam eşitlikte ilk');
});

test('parseRouteResponse hataları', () => {
  assert.throws(() => C.parseRouteResponse(null), /geçersiz/i);
  assert.throws(() => C.parseRouteResponse({ code: 'NoRoute' }), /bulunamadı/);
  assert.throws(() => C.parseRouteResponse({ code: 'InvalidQuery' }), /InvalidQuery/);
  assert.throws(() => C.parseRouteResponse({ code: 'Ok', routes: [] }), /bulunamadı/);
  assert.throws(() => C.parseRouteResponse({ code: 'Ok' }), /bulunamadı/);
  const routes = [{ duration: 1 }];
  assert.equal(C.parseRouteResponse({ code: 'Ok', routes }), routes);
});

// ---------- Biçimlendirme ----------
test('formatDuration sınırları', () => {
  assert.equal(C.formatDuration(0), "1 dk'dan az");
  assert.equal(C.formatDuration(59), "1 dk'dan az");
  assert.equal(C.formatDuration(60), '1 dk');
  assert.equal(C.formatDuration(480), '8 dk');
  assert.equal(C.formatDuration(3599), '1 sa');
  assert.equal(C.formatDuration(3600), '1 sa');
  assert.equal(C.formatDuration(4320), '1 sa 12 dk');
  assert.equal(C.formatDuration(7500), '2 sa 5 dk');
  assert.throws(() => C.formatDuration(-1), RangeError);
  assert.throws(() => C.formatDuration(NaN), RangeError);
});

test('formatDistance sınırları', () => {
  assert.equal(C.formatDistance(0), '0 m');
  assert.equal(C.formatDistance(850), '850 m');
  assert.equal(C.formatDistance(999), '999 m');
  assert.equal(C.formatDistance(999.6), '1,0 km');
  assert.equal(C.formatDistance(1000), '1,0 km');
  assert.equal(C.formatDistance(12400), '12,4 km');
  assert.equal(C.formatDistance(12449), '12,4 km');
  assert.equal(C.formatDistance(12450), '12,5 km');
  assert.throws(() => C.formatDistance(-5), RangeError);
  assert.throws(() => C.formatDistance(undefined), RangeError);
});

// ---------- instructionFor ----------
const step = (type, modifier, extra) => Object.assign({ name: '', maneuver: { type, modifier } }, extra);

test('instructionFor: tüm tipler', () => {
  const cases = [
    [step('depart'), 'Yola çık'],
    [step('arrive'), 'Varış noktasına ulaştın'],
    [step('turn', 'left'), 'Sola dön'],
    [step('turn', 'right'), 'Sağa dön'],
    [step('turn', 'slight left'), 'Hafif sola dön'],
    [step('turn', 'slight right'), 'Hafif sağa dön'],
    [step('turn', 'sharp left'), 'Keskin sola dön'],
    [step('turn', 'sharp right'), 'Keskin sağa dön'],
    [step('turn', 'uturn'), 'U dönüşü yap'],
    [step('turn', 'straight'), 'Düz devam et'],
    [step('turn'), 'Dön'],
    [step('new name', 'straight'), 'Devam et'],
    [step('continue', 'straight'), 'Düz devam et'],
    [step('continue', 'left'), 'Sola doğru devam et'],
    [step('continue', 'uturn'), 'U dönüşü yap'],
    [step('merge', 'slight right'), 'Hafif sağa doğru yola katıl'],
    [step('merge'), 'Yola katıl'],
    [step('on ramp', 'right'), 'Sağa bağlantı yoluna gir'],
    [step('on ramp'), 'Bağlantı yoluna gir'],
    [step('off ramp', 'left'), 'Sola çıkış yoluna gir'],
    [step('off ramp'), 'Çıkış yoluna gir'],
    [step('fork', 'slight left'), 'Çatalda sola git'],
    [step('fork', 'right'), 'Çatalda sağa git'],
    [step('fork'), 'Çatalda düz devam et'],
    [step('end of road', 'left'), 'Yolun sonunda sola dön'],
    [step('end of road', 'right'), 'Yolun sonunda sağa dön'],
    [step('end of road'), 'Yolun sonunda dön'],
    [step('roundabout', 'right', { maneuver: { type: 'roundabout', modifier: 'right', exit: 2 } }), 'Dönel kavşağa gir, 2. çıkıştan çık'],
    [{ maneuver: { type: 'rotary', exit: 1 } }, 'Dönel kavşağa gir, 1. çıkıştan çık'],
    [{ maneuver: { type: 'roundabout' } }, 'Dönel kavşağa gir'],
    [{ maneuver: { type: 'roundabout', exit: 0 } }, 'Dönel kavşağa gir'],
    [{ maneuver: { type: 'roundabout', exit: 1.5 } }, 'Dönel kavşağa gir'],
    [{ maneuver: { type: 'roundabout turn', modifier: 'left' } }, 'Sola dön'],
    [{ maneuver: { type: 'exit roundabout' } }, 'Dönel kavşaktan çık'],
    [{ maneuver: { type: 'exit rotary' } }, 'Dönel kavşaktan çık']
  ];
  for (const [s, expected] of cases) {
    assert.equal(C.instructionFor(s), expected, JSON.stringify(s));
  }
});

test('instructionFor: bilinmeyen tip, bozuk girdi ve sokak adı', () => {
  assert.equal(C.instructionFor(step('teleport', 'left')), 'Devam et');
  assert.equal(C.instructionFor({}), 'Devam et');
  assert.equal(C.instructionFor(null), 'Devam et');
  assert.equal(C.instructionFor(undefined), 'Devam et');
  assert.equal(C.instructionFor({ maneuver: { type: 'turn', modifier: 'zzz' } }), 'Dön');
  assert.equal(C.instructionFor({ name: 'İstiklal Caddesi', maneuver: { type: 'turn', modifier: 'left' } }),
    'Sola dön — İstiklal Caddesi');
  assert.equal(C.instructionFor({ name: '   ', maneuver: { type: 'depart' } }), 'Yola çık');
  assert.equal(C.instructionFor({ name: 42, maneuver: { type: 'depart' } }), 'Yola çık');
});

// ---------- normalizePlace ----------
test('normalizePlace', () => {
  const p = C.normalizePlace({ lat: '41.03', lon: '28.98', display_name: 'Taksim, Beyoğlu, İstanbul, Marmara, Türkiye' });
  assert.deepEqual([p.lat, p.lon, p.label], [41.03, 28.98, 'Taksim, Beyoğlu, İstanbul']);
  assert.equal(C.normalizePlace({ lat: 'x', lon: '1' }), null);
  assert.equal(C.normalizePlace({ lat: '95', lon: '1' }), null);
  assert.equal(C.normalizePlace(null), null);
});

// ---------- Kuyruk ----------
function fakeClock() {
  let t = 1000;
  return {
    now: () => t,
    sleep: async (ms) => { t += ms; },
    advance: (ms) => { t += ms; }
  };
}

test('kuyruk: istekler arası en az aralık, sıra korunur', async () => {
  const clock = fakeClock();
  const starts = [];
  const order = [];
  const q = C.createRateLimitedQueue(async (x) => {
    starts.push(clock.now());
    order.push(x);
    return x * 2;
  }, 1100, { now: clock.now, sleep: clock.sleep });

  const results = await Promise.all([q(1), q(2), q(3)]);
  assert.deepEqual(results, [2, 4, 6]);
  assert.deepEqual(order, [1, 2, 3]);
  assert.equal(starts[0], 1000, 'ilk istek beklemez');
  assert.equal(starts[1] - starts[0], 1100);
  assert.equal(starts[2] - starts[1], 1100);
});

test('kuyruk: yeterince beklendiyse uyumaz; hata zinciri bozmaz', async () => {
  const clock = fakeClock();
  const sleeps = [];
  const q = C.createRateLimitedQueue(async (x) => {
    if (x === 'bad') throw new Error('boom');
    return x;
  }, 1100, { now: clock.now, sleep: async (ms) => { sleeps.push(ms); clock.advance(ms); } });

  assert.equal(await q('a'), 'a');
  clock.advance(2000);
  assert.equal(await q('b'), 'b');
  assert.deepEqual(sleeps, [], 'aralık zaten geçmişti');
  await assert.rejects(q('bad'), /boom/);
  assert.equal(await q('c'), 'c');
  assert.deepEqual(sleeps, [1100, 1100]);
});

// ---------- Cache ----------
test('cache: get/set/has, LRU tahliye', () => {
  const c = C.createCache(2);
  assert.equal(c.has('a'), false);
  assert.equal(c.get('a'), undefined);
  c.set('a', 1);
  c.set('b', 2);
  assert.equal(c.get('a'), 1); // a artık en yeni
  c.set('c', 3); // b atılır
  assert.equal(c.has('b'), false);
  assert.equal(c.has('a'), true);
  assert.equal(c.has('c'), true);
  assert.equal(c.size, 2);
  c.set('c', 4);
  assert.equal(c.get('c'), 4);
  assert.equal(c.delete('c'), true);
  assert.equal(c.has('c'), false);
  c.clear();
  assert.equal(c.size, 0);
});

test('cache: falsy değerler de saklanır', () => {
  const c = C.createCache();
  c.set('x', null);
  c.set('y', []);
  assert.equal(c.has('x'), true);
  assert.equal(c.get('x'), null);
  assert.deepEqual(c.get('y'), []);
});

// ---------- fetchJson (sahte fetch, ağ yok) ----------
test('fetchJson: başarı, HTTP hatası, ağ hatası, zaman aşımı', async () => {
  const ok = await C.fetchJson('u', { fetchImpl: async () => ({ ok: true, json: async () => ({ a: 1 }) }) });
  assert.deepEqual(ok, { a: 1 });

  await assert.rejects(
    C.fetchJson('u', { fetchImpl: async () => ({ ok: false, status: 503, json: async () => { throw new Error('x'); } }) }),
    /Sunucu hatası \(503\)/);

  // OSRM 400 + NoRoute gövdesi iletilir
  const nr = await C.fetchJson('u', { fetchImpl: async () => ({ ok: false, status: 400, json: async () => ({ code: 'NoRoute' }) }) });
  assert.equal(nr.code, 'NoRoute');

  await assert.rejects(
    C.fetchJson('u', { fetchImpl: async () => { throw new TypeError('Failed to fetch'); } }),
    /Ağ hatası/);

  await assert.rejects(
    C.fetchJson('u', {
      timeoutMs: 20,
      fetchImpl: (url, { signal }) => new Promise((_, reject) => {
        signal.addEventListener('abort', () => { const e = new Error('aborted'); e.name = 'AbortError'; reject(e); });
      })
    }),
    /zaman aşımı/);
});

// ---------- Sıra denetimi ----------
test('createSeqGuard: yalnızca son kimlik geçerli', () => {
  const g = C.createSeqGuard();
  const a = g.next();
  assert.equal(g.isCurrent(a), true);
  const b = g.next();
  assert.equal(g.isCurrent(a), false);
  assert.equal(g.isCurrent(b), true);
  g.invalidate();
  assert.equal(g.isCurrent(b), false);
});

// ---------- Cache'li fetcher ----------
test('createCachedFetcher: aynı anahtar tek istek; hata cache edilmez', async () => {
  let calls = 0;
  let fail = true;
  const cached = C.createCachedFetcher(async (key) => {
    calls++;
    if (key === 'bad' && fail) throw new Error('ağ');
    return key + '!';
  }, C.createCache(10));

  const [x, y] = await Promise.all([cached('a'), cached('a')]);
  assert.equal(x, 'a!');
  assert.equal(y, 'a!');
  assert.equal(await cached('a'), 'a!');
  assert.equal(calls, 1);

  await assert.rejects(cached('bad'), /ağ/);
  await new Promise((r) => setImmediate(r));
  assert.equal(calls, 2);
  fail = false;
  assert.equal(await cached('bad'), 'bad!', 'hatadan sonra yeniden denenir');
  assert.equal(calls, 3);
});

test('createCachedFetcher: senkron fırlatma reddedilir ve cache edilmez', async () => {
  const cache = C.createCache(5);
  const cached = C.createCachedFetcher(() => { throw new Error('sync'); }, cache);
  await assert.rejects(cached('k'), /sync/);
  await new Promise((r) => setImmediate(r));
  assert.equal(cache.has('k'), false);
});

// ---------- Kuyrukta bayat istek ----------
test('kuyruk: shouldSkip bayat isteği göndermez ve aralık tüketmez', async () => {
  const clock = fakeClock();
  const guard = C.createSeqGuard();
  const sent = [];
  const q = C.createRateLimitedQueue(async (x) => { sent.push(x); return x; }, 1100, {
    now: clock.now, sleep: clock.sleep,
    shouldSkip: (x, id) => id !== undefined && !guard.isCurrent(id)
  });
  const id1 = guard.next();
  const p1 = q('eski', id1);
  const p0 = q('ilk');
  const id2 = guard.next(); // p1 artık bayat
  const p2 = q('yeni', id2);
  const settled = await Promise.allSettled([p1, p0, p2]);
  assert.equal(settled[0].status, 'rejected');
  assert.equal(settled[0].reason.skipped, true);
  assert.deepEqual(sent, ['ilk', 'yeni']);
  assert.equal(settled[2].value, 'yeni');
});

// ---------- fetchJson ek durumlar ----------
test('fetchJson: bozuk JSON, AbortController yokken zaman aşımı', async () => {
  await assert.rejects(
    C.fetchJson('u', { fetchImpl: async () => ({ ok: true, json: async () => JSON.parse('{x') }) }),
    /Sunucudan geçersiz yanıt/);

  const RealAC = global.AbortController;
  global.AbortController = undefined;
  try {
    await assert.rejects(
      C.fetchJson('u', { timeoutMs: 20, fetchImpl: () => new Promise(() => {}) }),
      /zaman aşımı/);
  } finally {
    global.AbortController = RealAC;
  }
});

// ---------- Gerçek kompozisyon: cache + kuyruk(shouldSkip) ----------
test('entegrasyon: aynı anahtar, ilk çağıran bayatlar; ikinci çağıran sonucu alır, istek bir kez gider', async () => {
  const clock = fakeClock();
  let sent = 0;
  const queue = C.createRateLimitedQueue(async (url) => { sent++; return 'veri:' + url; }, 1100, {
    now: clock.now, sleep: clock.sleep,
    shouldSkip: (url, isStale) => typeof isStale === 'function' && isStale()
  });
  const get = C.createCachedFetcher((url, isStale) => queue(url, isStale), C.createCache(10));

  const blocker = get('baska', () => false); // kuyruğu meşgul eder
  let firstStale = false;
  const first = get('q', () => firstStale);
  const second = get('q', () => false);
  firstStale = true; // ilk çağıran bayatladı

  const [b, r1, r2] = await Promise.allSettled([blocker, first, second]);
  assert.equal(b.status, 'fulfilled');
  assert.equal(r1.status, 'rejected');
  assert.equal(r1.reason.skipped, true);
  assert.equal(r2.status, 'fulfilled');
  assert.equal(r2.value, 'veri:q');
  assert.equal(sent, 2, 'baska + q bir kez');
  assert.equal(await get('q', () => false), 'veri:q', 'cache');
  assert.equal(sent, 2);
});

test('entegrasyon: tüm çağıranlar bayatsa istek hiç gitmez', async () => {
  const clock = fakeClock();
  let sent = 0;
  const queue = C.createRateLimitedQueue(async () => { sent++; return 1; }, 1100, {
    now: clock.now, sleep: clock.sleep,
    shouldSkip: (u, isStale) => isStale()
  });
  const get = C.createCachedFetcher((u, s) => queue(u, s), C.createCache(10));
  const blocker = get('b', () => false);
  const a = get('q', () => true);
  const b = get('q', () => true);
  const res = await Promise.allSettled([blocker, a, b]);
  assert.equal(res[1].status, 'rejected');
  assert.equal(res[2].status, 'rejected');
  assert.equal(sent, 1);
});
