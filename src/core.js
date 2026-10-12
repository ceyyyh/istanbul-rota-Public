/* İstanbul Rota - saf mantık (DOM'suz). Tarayıcıda global `MapsCore`, Node'da module.exports. */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module && module.exports) {
    module.exports = api;
  } else {
    root.MapsCore = api;
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var NOMINATIM_BASE = 'https://nominatim.openstreetmap.org';
  var ROUTE_BASE = 'https://routing.openstreetmap.de';
  var VIEWBOX = '28.0,41.6,29.15,40.85';

  var MODES = {
    car: { profile: 'routed-car', label: 'Araba' },
    foot: { profile: 'routed-foot', label: 'Yaya' },
    bike: { profile: 'routed-bike', label: 'Bisiklet' }
  };

  var NOT_SUPPORTED_MESSAGE = 'Şimdilik sadece Avrupa yakası destekleniyor';

  // ---------- Koordinat doğrulama ----------

  function validateCoord(lat, lon) {
    if (typeof lat !== 'number' || typeof lon !== 'number' || !isFinite(lat) || !isFinite(lon)) {
      throw new TypeError('Geçersiz koordinat: enlem ve boylam sayı olmalı');
    }
    if (lat < -90 || lat > 90) {
      throw new RangeError('Geçersiz enlem: ' + lat);
    }
    if (lon < -180 || lon > 180) {
      throw new RangeError('Geçersiz boylam: ' + lon);
    }
  }

  function fmtCoord(n) {
    return String(Number(n.toFixed(6)));
  }

  // ---------- Avrupa yakası poligonu (kaba) ----------
  // [enlem, boylam]; Rumelifeneri'nden başlar, Boğaz kıyısı güneye, Marmara kıyısı batıya,
  // batı sınırı ~28.0, Karadeniz kıyısı doğuya doğru kapanır.
  var EUROPE_POLYGON = [
    [41.2355, 29.12], // Rumelifeneri
    [41.21, 29.105], // Garipçe
    [41.16, 29.08], // Rumelikavağı / Sarıyer
    [41.12, 29.074], // Yeniköy-Tarabya hattı
    [41.1, 29.061], // Yeniköy güneyi (Kanlıca karşısı)
    [41.0855, 29.0585], // Rumeli Hisarı
    [41.08, 29.0565],
    [41.0735, 29.0525], // Bebek
    [41.06, 29.046], // Arnavutköy
    [41.0475, 29.0295], // Ortaköy
    [41.041, 29.0075], // Beşiktaş
    [41.0345, 28.996], // Kabataş
    [41.025, 28.984], // Karaköy
    [41.0165, 28.987], // Sarayburnu
    [41.004, 28.982], // Ahırkapı
    [40.999, 28.965], // Kumkapı kıyısı
    [40.995, 28.94], // Yenikapı
    [40.975, 28.9], // Zeytinburnu
    [40.955, 28.87], // Bakırköy kıyısı
    [40.95, 28.82], // Yeşilköy
    [40.97, 28.78], // Florya
    [40.965, 28.72], // Avcılar
    [40.955, 28.64], // Beylikdüzü
    [40.955, 28.6], // Gürpınar kıyısı
    [40.99, 28.575], // Büyükçekmece körfezi
    [41.0, 28.53], // Mimarsinan kıyısı
    [41.01, 28.47], // Kumburgaz kıyısı
    [41.035, 28.37], // Selimpaşa / Çanta
    [41.055, 28.25], // Silivri
    [41.06, 28.1],
    [41.075, 28.0], // batı sınırı
    [41.6, 28.0], // il sınırının kuzeybatı ucu
    [41.6, 28.55], // Karadeniz kıyısı (Yalıköy/Karacaköy açıkları)
    [41.37, 28.65],
    [41.35, 28.67], // Karaburun
    [41.3, 28.85],
    [41.25, 29.03] // Kilyos
  ];

  function pointInPolygon(lat, lon, poly) {
    var inside = false;
    for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      var yi = poly[i][0], xi = poly[i][1];
      var yj = poly[j][0], xj = poly[j][1];
      var crosses = (yi > lat) !== (yj > lat) &&
        lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
      if (crosses) inside = !inside;
    }
    return inside;
  }

  function isInEuropeanSide(lat, lon) {
    validateCoord(lat, lon);
    return pointInPolygon(lat, lon, EUROPE_POLYGON);
  }

  // ---------- URL üreticiler ----------

  function buildSearchUrl(q) {
    if (typeof q !== 'string') throw new TypeError('Arama metni gerekli');
    var text = q.replace(/\s+/g, ' ').trim();
    if (!text) throw new Error('Arama metni boş olamaz');
    return NOMINATIM_BASE + '/search?q=' + encodeURIComponent(text) +
      '&format=jsonv2&limit=5&accept-language=tr&countrycodes=tr' +
      '&viewbox=' + VIEWBOX + '&bounded=1';
  }

  function buildReverseUrl(lat, lon) {
    validateCoord(lat, lon);
    return NOMINATIM_BASE + '/reverse?lat=' + encodeURIComponent(fmtCoord(lat)) +
      '&lon=' + encodeURIComponent(fmtCoord(lon)) +
      '&format=jsonv2&zoom=18&accept-language=tr';
  }

  function buildRouteUrl(mode, from, to) {
    if (typeof mode !== 'string' || !Object.prototype.hasOwnProperty.call(MODES, mode)) {
      throw new Error('Bilinmeyen ulaşım modu: ' + String(mode));
    }
    if (!from || !to) throw new TypeError('Başlangıç ve varış gerekli');
    validateCoord(from.lat, from.lon);
    validateCoord(to.lat, to.lon);
    // OSRM sırası: boylam,enlem
    var coords = fmtCoord(from.lon) + ',' + fmtCoord(from.lat) + ';' +
      fmtCoord(to.lon) + ',' + fmtCoord(to.lat);
    return ROUTE_BASE + '/' + MODES[mode].profile + '/route/v1/driving/' + coords +
      '?alternatives=true&steps=true&geometries=geojson&overview=full';
  }

  // ---------- Rota seçimi ----------

  function pickBestRoute(routes) {
    if (!Array.isArray(routes) || routes.length === 0) return null;
    var best = null;
    for (var i = 0; i < routes.length; i++) {
      var r = routes[i];
      if (!r || typeof r.duration !== 'number' || isNaN(r.duration)) continue;
      if (best === null) { best = r; continue; }
      if (r.duration < best.duration) {
        best = r;
      } else if (r.duration === best.duration) {
        var d = typeof r.distance === 'number' ? r.distance : Infinity;
        var bd = typeof best.distance === 'number' ? best.distance : Infinity;
        if (d < bd) best = r;
      }
    }
    return best;
  }

  // OSRM yanıtını doğrular; hata durumunda anlaşılır Türkçe mesajla fırlatır.
  function parseRouteResponse(data) {
    if (!data || typeof data !== 'object') {
      throw new Error('Rota servisinden geçersiz yanıt alındı.');
    }
    if (data.code !== 'Ok') {
      if (data.code === 'NoRoute') {
        throw new Error('Bu iki nokta arasında rota bulunamadı.');
      }
      if (data.code === 'NoSegment') {
        throw new Error('Noktalardan biri yola yakın değil; başka bir nokta seçin.');
      }
      throw new Error('Rota hesaplanamadı (' + String(data.code) + ').');
    }
    if (!Array.isArray(data.routes) || data.routes.length === 0) {
      throw new Error('Rota bulunamadı.');
    }
    return data.routes;
  }

  // ---------- Biçimlendirme ----------

  function formatDuration(seconds) {
    if (typeof seconds !== 'number' || !isFinite(seconds) || seconds < 0) {
      throw new RangeError('Geçersiz süre');
    }
    if (seconds < 60) return "1 dk'dan az";
    var totalMin = Math.round(seconds / 60);
    var h = Math.floor(totalMin / 60);
    var m = totalMin % 60;
    if (h === 0) return m + ' dk';
    if (m === 0) return h + ' sa';
    return h + ' sa ' + m + ' dk';
  }

  function formatDistance(meters) {
    if (typeof meters !== 'number' || !isFinite(meters) || meters < 0) {
      throw new RangeError('Geçersiz mesafe');
    }
    var rounded = Math.round(meters);
    if (rounded < 1000) return rounded + ' m';
    return (Math.round(meters / 100) / 10).toFixed(1).replace('.', ',') + ' km';
  }

  // ---------- Adım adım tarif ----------

  var DIR = {
    left: 'sola',
    right: 'sağa',
    'slight left': 'hafif sola',
    'slight right': 'hafif sağa',
    'sharp left': 'keskin sola',
    'sharp right': 'keskin sağa'
  };

  function cap(s) {
    return s.charAt(0).toLocaleUpperCase('tr-TR') + s.slice(1);
  }

  function dirOf(mod) {
    return typeof mod === 'string' && Object.prototype.hasOwnProperty.call(DIR, mod) ? DIR[mod] : null;
  }

  function baseInstruction(type, mod, exit) {
    var dir = dirOf(mod);
    switch (type) {
      case 'depart':
        return 'Yola çık';
      case 'arrive':
        return 'Varış noktasına ulaştın';
      case 'turn':
        if (mod === 'uturn') return 'U dönüşü yap';
        if (mod === 'straight') return 'Düz devam et';
        return dir ? cap(dir) + ' dön' : 'Dön';
      case 'new name':
        return 'Devam et';
      case 'continue':
        if (mod === 'uturn') return 'U dönüşü yap';
        if (mod === 'straight') return 'Düz devam et';
        return dir ? cap(dir) + ' doğru devam et' : 'Devam et';
      case 'merge':
        if (dir) return cap(dir) + ' doğru yola katıl';
        return 'Yola katıl';
      case 'on ramp':
        return dir ? cap(dir) + ' bağlantı yoluna gir' : 'Bağlantı yoluna gir';
      case 'off ramp':
        return dir ? cap(dir) + ' çıkış yoluna gir' : 'Çıkış yoluna gir';
      case 'fork':
        if (mod === 'left' || mod === 'slight left' || mod === 'sharp left') return 'Çatalda sola git';
        if (mod === 'right' || mod === 'slight right' || mod === 'sharp right') return 'Çatalda sağa git';
        return 'Çatalda düz devam et';
      case 'end of road':
        if (mod === 'left' || mod === 'slight left' || mod === 'sharp left') return 'Yolun sonunda sola dön';
        if (mod === 'right' || mod === 'slight right' || mod === 'sharp right') return 'Yolun sonunda sağa dön';
        return 'Yolun sonunda dön';
      case 'roundabout':
      case 'rotary':
        if (typeof exit === 'number' && isFinite(exit) && exit >= 1 && Math.floor(exit) === exit) {
          return 'Dönel kavşağa gir, ' + exit + '. çıkıştan çık';
        }
        return 'Dönel kavşağa gir';
      case 'roundabout turn':
        return dir ? cap(dir) + ' dön' : 'Kavşakta dön';
      case 'exit roundabout':
      case 'exit rotary':
        return 'Dönel kavşaktan çık';
      default:
        return 'Devam et';
    }
  }

  function instructionFor(step) {
    var m = step && typeof step === 'object' ? step.maneuver : null;
    var text;
    if (m && typeof m === 'object') {
      text = baseInstruction(m.type, m.modifier, m.exit);
    } else {
      text = 'Devam et';
    }
    var name = step && typeof step.name === 'string' ? step.name.trim() : '';
    return name ? text + ' — ' + name : text;
  }

  // ---------- Nominatim yardımcıları ----------

  // Nominatim sonucunu {lat, lon, label} biçimine çevirir; geçersizse null.
  function normalizePlace(item) {
    if (!item || typeof item !== 'object') return null;
    var lat = parseFloat(item.lat);
    var lon = parseFloat(item.lon);
    if (!isFinite(lat) || !isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
    var full = typeof item.display_name === 'string' ? item.display_name : '';
    var parts = full.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    var label = parts.slice(0, 3).join(', ');
    if (!label && typeof item.name === 'string') label = item.name;
    return { lat: lat, lon: lon, label: label, fullLabel: full || label };
  }

  // ---------- Hız sınırlı kuyruk ----------

  // fn çağrıları sıraya girer; ardışık çağrıların başlangıçları arasında en az minIntervalMs olur.
  // opts.shouldSkip(...args) true dönerse çağrı gönderilmez (kuyrukta bayatlamış istek);
  // promise, skipped=true işaretli bir Error ile reddedilir ve aralık tüketilmez.
  function createRateLimitedQueue(fn, minIntervalMs, opts) {
    opts = opts || {};
    var now = opts.now || function () { return Date.now(); };
    var sleep = opts.sleep || function (ms) {
      return new Promise(function (resolve) { setTimeout(resolve, ms); });
    };
    var shouldSkip = opts.shouldSkip || null;
    var lastStart = null;
    var tail = Promise.resolve();

    function skipError() {
      var e = new Error('İstek atlandı (güncelliğini yitirdi).');
      e.skipped = true;
      return e;
    }

    return function enqueue() {
      var args = arguments;
      var self = this;
      var run = tail.then(function () {
        if (shouldSkip && shouldSkip.apply(self, args)) throw skipError();
        var wait = lastStart === null ? 0 : lastStart + minIntervalMs - now();
        var pre = wait > 0 ? Promise.resolve(sleep(wait)) : Promise.resolve();
        return pre.then(function () {
          if (shouldSkip && shouldSkip.apply(self, args)) throw skipError();
          lastStart = now();
          return fn.apply(self, args);
        });
      });
      // Hata zinciri bozmasın
      tail = run.then(function () {}, function () {});
      return run;
    };
  }

  // ---------- Sıra (sequence) denetimi ----------
  // Eski (geçersiz kalmış) yanıtları yok saymak için: next() yeni kimlik verir,
  // isCurrent(id) yalnızca son verilen kimlik için true döner.
  function createSeqGuard() {
    var current = 0;
    return {
      next: function () { return ++current; },
      invalidate: function () { return ++current; },
      isCurrent: function (id) { return id === current; },
      get value() { return current; }
    };
  }

  // ---------- Cache ----------

  function createCache(maxEntries) {
    var max = typeof maxEntries === 'number' && maxEntries > 0 ? maxEntries : 200;
    var map = new Map();
    return {
      has: function (k) { return map.has(k); },
      get: function (k) {
        if (!map.has(k)) return undefined;
        var v = map.get(k);
        map.delete(k); // son kullanılan sona
        map.set(k, v);
        return v;
      },
      set: function (k, v) {
        if (map.has(k)) map.delete(k);
        map.set(k, v);
        while (map.size > max) {
          map.delete(map.keys().next().value);
        }
      },
      delete: function (k) { return map.delete(k); },
      clear: function () { map.clear(); },
      get size() { return map.size; }
    };
  }

  // Aynı anahtar için tekrar istek atmaz (uçuştaki istek de paylaşılır);
  // reddedilen istekler cache'ten silinir ki tekrar denenebilsin.
  // cached(key, isStale, ...): isStale() true ise çağıran artık sonucu istemiyor.
  // Paylaşılan istek BAŞKA bir çağıranın bayatlığı yüzünden atlandıysa (err.skipped),
  // bu çağıran hâlâ güncelse istek yeniden başlatılır; değilse skipped ile reddedilir.
  function createCachedFetcher(fetchFn, cache) {
    function cached(key, isStale) {
      var self = this;
      var args = arguments;
      var p;
      if (cache.has(key)) {
        p = cache.get(key);
      } else {
        try {
          p = Promise.resolve(fetchFn.apply(self, args));
        } catch (e) {
          p = Promise.reject(e);
        }
        cache.set(key, p);
        p.catch(function () {
          if (cache.has(key) && cache.get(key) === p) cache.delete(key);
        });
      }
      return p.catch(function (err) {
        if (err && err.skipped && !(typeof isStale === 'function' && isStale())) {
          if (cache.has(key) && cache.get(key) === p) cache.delete(key);
          return cached.apply(self, args);
        }
        throw err;
      });
    }
    return cached;
  }

  // ---------- Zaman aşımlı fetch ----------

  function fetchJson(url, opts) {
    opts = opts || {};
    var timeoutMs = opts.timeoutMs || 15000;
    var fetchImpl = opts.fetchImpl || (typeof fetch === 'function' ? fetch : null);
    if (!fetchImpl) return Promise.reject(new Error('Bu tarayıcı ağ isteklerini desteklemiyor.'));
    var controller = typeof AbortController === 'function' ? new AbortController() : null;
    var timedOut = false;
    var timer;
    var TIMEOUT_MSG = 'İstek zaman aşımına uğradı. Lütfen tekrar deneyin.';

    // AbortController olsa da olmasa da zaman aşımı doğrudan reject eder.
    var timeoutPromise = new Promise(function (_, reject) {
      timer = setTimeout(function () {
        timedOut = true;
        reject(new Error(TIMEOUT_MSG));
        if (controller) controller.abort();
      }, timeoutMs);
    });

    var req = Promise.resolve()
      .then(function () {
        return fetchImpl(url, { signal: controller ? controller.signal : undefined, headers: { Accept: 'application/json' } });
      })
      .then(function (res) {
        if (!res.ok) {
          // OSRM hata gövdesi (ör. NoRoute) JSON olabilir; varsa yine de ayrıştırmayı dene.
          return res.json().then(function (body) { return body; }, function () {
            throw new Error('Sunucu hatası (' + res.status + ')');
          }).then(function (body) {
            if (body && typeof body === 'object' && body.code) return body;
            throw new Error('Sunucu hatası (' + res.status + ')');
          });
        }
        return res.json();
      })
      .catch(function (err) {
        if (err && err.name === 'AbortError') {
          throw new Error(timedOut ? TIMEOUT_MSG : 'İstek iptal edildi.');
        }
        if (err instanceof SyntaxError) {
          throw new Error('Sunucudan geçersiz yanıt');
        }
        if (err instanceof TypeError) {
          throw new Error('Ağ hatası: sunucuya ulaşılamadı. Bağlantınızı kontrol edin.');
        }
        throw err;
      });

    return Promise.race([req, timeoutPromise]).then(
      function (v) { clearTimeout(timer); return v; },
      function (e) { clearTimeout(timer); throw e; }
    );
  }

  return {
    MODES: MODES,
    NOT_SUPPORTED_MESSAGE: NOT_SUPPORTED_MESSAGE,
    EUROPE_POLYGON: EUROPE_POLYGON,
    validateCoord: validateCoord,
    isInEuropeanSide: isInEuropeanSide,
    buildSearchUrl: buildSearchUrl,
    buildReverseUrl: buildReverseUrl,
    buildRouteUrl: buildRouteUrl,
    pickBestRoute: pickBestRoute,
    parseRouteResponse: parseRouteResponse,
    formatDuration: formatDuration,
    formatDistance: formatDistance,
    instructionFor: instructionFor,
    normalizePlace: normalizePlace,
    createRateLimitedQueue: createRateLimitedQueue,
    createCache: createCache,
    createCachedFetcher: createCachedFetcher,
    createSeqGuard: createSeqGuard,
    fetchJson: fetchJson
  };
});
