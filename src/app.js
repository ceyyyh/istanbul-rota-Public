/* İstanbul Rota - DOM/Leaflet bağlama. Kullanıcı girdisi her zaman textContent ile yazılır. */
(function () {
  'use strict';

  var C = window.MapsCore;
  var NOMINATIM_MIN_INTERVAL_MS = 1100;

  // ---------- Yardımcılar ----------
  function $(id) { return document.getElementById(id); }

  function el(tag, props, children) {
    var node = document.createElement(tag);
    if (props) {
      Object.keys(props).forEach(function (k) {
        if (k === 'text') node.textContent = props[k];
        else if (k === 'class') node.className = props[k];
        else node.setAttribute(k, props[k]);
      });
    }
    (children || []).forEach(function (c) {
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return node;
  }

  function cssVar(name, fallback) {
    try {
      var v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
      return v || fallback;
    } catch (e) {
      return fallback;
    }
  }

  var msgEl = $('msg');
  function setMsg(text, kind) {
    msgEl.textContent = text || '';
    msgEl.className = 'msg' + (text && kind ? ' ' + kind : '');
  }

  function coordLabel(lat, lon) {
    return lat.toFixed(5) + ', ' + lon.toFixed(5);
  }

  // ---------- Nominatim: tek kuyruk + bellek cache ----------
  var nominatimQueue = C.createRateLimitedQueue(function (url) {
    return C.fetchJson(url, { timeoutMs: 15000 });
  }, NOMINATIM_MIN_INTERVAL_MS);
  var nominatimCache = C.createCache(200);

  function nominatimGet(url) {
    if (nominatimCache.has(url)) return nominatimCache.get(url);
    var p = nominatimQueue(url);
    nominatimCache.set(url, p); // uçuştaki aynı istek de paylaşılır
    p.catch(function () {
      // Hatalı yanıtlar cache'te kalmasın; tekrar denenebilsin
      if (nominatimCache.has(url) && nominatimCache.get(url) === p) nominatimCache.delete(url);
    });
    return p;
  }

  // ---------- Harita ----------
  var map = L.map('map', { zoomControl: true }).setView([41.04, 28.98], 11);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© OpenStreetMap katkıcıları'
  }).addTo(map);

  var markerLayer = L.layerGroup().addTo(map);
  var routeLayer = L.layerGroup().addTo(map);
  var popup = L.popup({ closeButton: true });

  // ---------- Durum ----------
  var state = {
    from: null, // {lat, lon, label}
    to: null,
    mode: 'car',
    routes: [],
    best: -1,
    selected: -1,
    routeSeq: 0
  };
  var markers = { from: null, to: null };
  var searchSeq = { from: 0, to: 0 };
  var inputs = { from: $('in-from'), to: $('in-to') };
  var candLists = { from: $('cand-from'), to: $('cand-to') };
  var resultEl = $('result');

  function refreshMapSize() {
    setTimeout(function () { map.invalidateSize(); }, 0);
  }

  // ---------- Noktalar ----------
  function updateMarker(which) {
    if (markers[which]) { markerLayer.removeLayer(markers[which]); markers[which] = null; }
    var p = state[which];
    if (!p) return;
    var color = which === 'from' ? '#1a9850' : '#d73027';
    var m = L.circleMarker([p.lat, p.lon], {
      radius: 9, color: '#ffffff', weight: 3, fillColor: color, fillOpacity: 1
    });
    m.bindTooltip(which === 'from' ? 'Başlangıç' : 'Varış', { permanent: false });
    m.addTo(markerLayer);
    markers[which] = m;
  }

  function clearRoute() {
    state.routeSeq++;
    state.routes = [];
    state.best = -1;
    state.selected = -1;
    routeLayer.clearLayers();
    resultEl.textContent = '';
    refreshMapSize();
  }

  function setPoint(which, place) {
    var inside;
    try {
      inside = C.isInEuropeanSide(place.lat, place.lon);
    } catch (e) {
      setMsg('Geçersiz koordinat.', 'err');
      return false;
    }
    if (!inside) {
      setMsg(C.NOT_SUPPORTED_MESSAGE, 'warn');
      return false;
    }
    state[which] = { lat: place.lat, lon: place.lon, label: place.label };
    inputs[which].value = place.label;
    candLists[which].textContent = '';
    updateMarker(which);
    setMsg('', '');
    clearRoute();
    if (state.from && state.to) {
      findRoute();
    } else {
      map.setView([place.lat, place.lon], Math.max(map.getZoom(), 14));
    }
    return true;
  }

  // Koordinattan etiket bul (kuyruktan, cache'li)
  function reverseLabel(which, place) {
    var url;
    try { url = C.buildReverseUrl(place.lat, place.lon); } catch (e) { return; }
    nominatimGet(url).then(function (data) {
      var p = data && C.normalizePlace(data);
      if (!p || !p.label) return;
      var cur = state[which];
      if (cur && cur.lat === place.lat && cur.lon === place.lon) {
        cur.label = p.label;
        inputs[which].value = p.label;
      }
    }).catch(function () { /* etiket isteğe bağlı; koordinat etiketi kalır */ });
  }

  // ---------- Arama (yalnızca Enter / Ara) ----------
  function doSearch(which) {
    var q = inputs[which].value.trim();
    var list = candLists[which];
    list.textContent = '';
    if (!q) { setMsg('Aramak için bir yer adı yazın.', 'warn'); return; }
    var url;
    try { url = C.buildSearchUrl(q); } catch (e) { setMsg(e.message, 'err'); return; }

    var seq = ++searchSeq[which];
    setMsg('Aranıyor…', 'info');
    nominatimGet(url).then(function (data) {
      if (seq !== searchSeq[which]) return;
      var all = (Array.isArray(data) ? data : []).map(C.normalizePlace).filter(Boolean);
      var kept = all.filter(function (p) {
        try { return C.isInEuropeanSide(p.lat, p.lon); } catch (e) { return false; }
      });
      if (!kept.length) {
        setMsg(all.length ? C.NOT_SUPPORTED_MESSAGE + '. Bulunan sonuçlar Avrupa yakası dışında.' : 'Sonuç bulunamadı.', all.length ? 'warn' : 'info');
        return;
      }
      kept.forEach(function (p) {
        var btn = el('button', { type: 'button', text: p.fullLabel || p.label });
        btn.addEventListener('click', function () {
          if (setPoint(which, p)) map.setView([p.lat, p.lon], 15);
        });
        list.appendChild(el('li', null, [btn]));
      });
      setMsg(all.length > kept.length ? 'Avrupa yakası dışındaki sonuçlar gizlendi. Bir sonuç seçin.' : 'Bir sonuç seçin.', 'info');
    }).catch(function (err) {
      if (seq !== searchSeq[which]) return;
      setMsg(err && err.message ? err.message : 'Arama başarısız oldu.', 'err');
    });
  }

  $('form-from').addEventListener('submit', function (e) { e.preventDefault(); doSearch('from'); });
  $('form-to').addEventListener('submit', function (e) { e.preventDefault(); doSearch('to'); });

  // Metin değişince eski seçim geçersiz sayılır (otomatik arama YOK)
  ['from', 'to'].forEach(function (which) {
    inputs[which].addEventListener('input', function () {
      candLists[which].textContent = '';
    });
  });

  // ---------- Haritaya dokunma ----------
  map.on('click', function (e) {
    var lat = e.latlng.lat;
    var lon = e.latlng.lng;
    var box = el('div', { class: 'popup-actions' });
    var inside = false;
    try { inside = C.isInEuropeanSide(lat, lon); } catch (err) { /* geçersiz */ }

    if (!inside) {
      box.appendChild(el('p', { class: 'popup-title', text: C.NOT_SUPPORTED_MESSAGE }));
    } else {
      box.appendChild(el('p', { class: 'popup-title', text: coordLabel(lat, lon) }));
      ['from', 'to'].forEach(function (which) {
        var b = el('button', { type: 'button', text: which === 'from' ? 'Başlangıç yap' : 'Varış yap' });
        b.addEventListener('click', function () {
          map.closePopup();
          var place = { lat: lat, lon: lon, label: coordLabel(lat, lon) };
          if (setPoint(which, place)) reverseLabel(which, place);
        });
        box.appendChild(b);
      });
    }
    popup.setLatLng(e.latlng).setContent(box).openOn(map);
  });

  // ---------- Konumum ----------
  $('btn-locate').addEventListener('click', function () {
    try {
      if (!('geolocation' in navigator)) {
        setMsg('Bu tarayıcı konum özelliğini desteklemiyor.', 'err');
        return;
      }
      setMsg('Konum alınıyor…', 'info');
      navigator.geolocation.getCurrentPosition(function (pos) {
        try {
          var place = { lat: pos.coords.latitude, lon: pos.coords.longitude, label: 'Konumum' };
          if (setPoint('from', place)) map.setView([place.lat, place.lon], 15);
        } catch (err) {
          setMsg('Konum işlenemedi.', 'err');
        }
      }, function (err) {
        var text = 'Konum alınamadı.';
        if (err && err.code === 1) text = 'Konum izni reddedildi. Tarayıcı ayarlarından izin verin.';
        else if (err && err.code === 2) text = 'Konum belirlenemedi. Sinyali kontrol edin.';
        else if (err && err.code === 3) text = 'Konum isteği zaman aşımına uğradı.';
        setMsg(text, 'err');
      }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 });
    } catch (e) {
      setMsg('Konum alınamadı: ' + (e && e.message ? e.message : 'bilinmeyen hata'), 'err');
    }
  });

  // ---------- Değiştir ve mod ----------
  $('btn-swap').addEventListener('click', function () {
    var f = state.from, t = state.to;
    var fv = inputs.from.value, tv = inputs.to.value;
    state.from = t; state.to = f;
    inputs.from.value = tv; inputs.to.value = fv;
    candLists.from.textContent = ''; candLists.to.textContent = '';
    updateMarker('from'); updateMarker('to');
    clearRoute();
    if (state.from && state.to) findRoute();
  });

  var modeButtons = Array.prototype.slice.call(document.querySelectorAll('.modes button'));
  modeButtons.forEach(function (b) {
    b.addEventListener('click', function () {
      state.mode = b.getAttribute('data-mode');
      modeButtons.forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
      if (state.from && state.to) findRoute();
    });
  });

  $('btn-route').addEventListener('click', function () {
    if (!state.from || !state.to) {
      setMsg('Önce başlangıç ve varış noktasını seçin.', 'warn');
      return;
    }
    findRoute();
  });

  // ---------- Rota ----------
  function findRoute() {
    var url;
    try {
      url = C.buildRouteUrl(state.mode, state.from, state.to);
    } catch (e) {
      setMsg(e.message, 'err');
      return;
    }
    var seq = ++state.routeSeq;
    routeLayer.clearLayers();
    resultEl.textContent = '';
    setMsg('Rota hesaplanıyor…', 'info');

    C.fetchJson(url, { timeoutMs: 15000 }).then(function (data) {
      if (seq !== state.routeSeq) return;
      var routes = C.parseRouteResponse(data);
      state.routes = routes;
      state.best = routes.indexOf(C.pickBestRoute(routes));
      if (state.best < 0) state.best = 0;
      state.selected = state.best;
      setMsg('', '');
      drawRoutes(true);
      renderResult();
    }).catch(function (err) {
      if (seq !== state.routeSeq) return;
      setMsg(err && err.message ? err.message : 'Rota alınamadı.', 'err');
    });
  }

  function drawRoutes(fit) {
    routeLayer.clearLayers();
    var bestColor = cssVar('--route-best', '#0b6bcb');
    var altColor = cssVar('--route-alt', '#7d8aa0');
    var selectedLayer = null;
    state.routes.forEach(function (r, i) {
      if (!r || !r.geometry) return;
      var isSel = i === state.selected;
      var layer = L.geoJSON(r.geometry, {
        style: {
          color: isSel ? bestColor : altColor,
          weight: isSel ? 8 : 5,
          opacity: isSel ? 0.95 : 0.5,
          lineJoin: 'round',
          bubblingMouseEvents: false
        },
        bubblingMouseEvents: false
      });
      layer.on('click', function (ev) {
        if (ev.originalEvent) L.DomEvent.stop(ev.originalEvent);
        selectRoute(i);
      });
      layer.addTo(routeLayer);
      if (isSel) selectedLayer = layer;
    });
    if (selectedLayer) {
      selectedLayer.bringToFront();
      if (fit) {
        refreshMapSize();
        setTimeout(function () {
          map.fitBounds(selectedLayer.getBounds(), { padding: [30, 30] });
        }, 10);
      }
    }
  }

  function selectRoute(i) {
    if (i === state.selected || !state.routes[i]) return;
    state.selected = i;
    drawRoutes(false);
    renderResult();
  }

  function renderResult() {
    resultEl.textContent = '';
    var r = state.routes[state.selected];
    if (!r) return;

    var summary = el('div', { class: 'summary' }, [
      el('span', { class: 'big', text: C.formatDuration(r.duration) }),
      el('span', { class: 'sub', text: C.formatDistance(r.distance) }),
      el('span', { class: 'sub', text: C.MODES[state.mode].label })
    ]);
    resultEl.appendChild(summary);

    if (state.routes.length > 1) {
      var alts = el('div', { class: 'alts', role: 'group', 'aria-label': 'Alternatif rotalar' });
      state.routes.forEach(function (ar, i) {
        var kids = [document.createTextNode('Rota ' + (i + 1) + ' · ' + C.formatDuration(ar.duration) + ' · ' + C.formatDistance(ar.distance))];
        if (i === state.best) kids.push(el('span', { class: 'badge', text: 'En iyi' }));
        var b = el('button', { type: 'button', 'aria-pressed': String(i === state.selected) }, kids);
        b.addEventListener('click', function () { selectRoute(i); });
        alts.appendChild(b);
      });
      resultEl.appendChild(alts);
    }

    var steps = [];
    (r.legs || []).forEach(function (leg) {
      (leg.steps || []).forEach(function (s) { steps.push(s); });
    });
    var ol = el('ol', { class: 'steps' });
    steps.forEach(function (s) {
      var li = el('li', null, [
        el('span', { class: 'txt', text: C.instructionFor(s) }),
        el('span', { class: 'dist', text: s.distance > 0 ? C.formatDistance(s.distance) : '' })
      ]);
      ol.appendChild(li);
    });
    resultEl.appendChild(ol);
    refreshMapSize();
  }

  window.addEventListener('resize', refreshMapSize);
})();
