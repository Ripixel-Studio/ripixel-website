/* Tiled route maps (activity route, /life/fitness heatmap).
 *
 * Reads the JSON the build put in each [data-route-map] block (tasks/route-map.mjs) and
 * lays a Leaflet map over the static SVG, which stays as the no-JS fallback. Draws only
 * the published lines: no geolocation, no locate control, no markers beyond the route's
 * own first and last points. One finger scrolls the page on touch screens (two fingers
 * pan and pinch), the wheel never zooms, and with reduced motion nothing animates.
 */
(function () {
  'use strict';
  var L = window.L;
  if (!L) return;

  // OpenStreetMap's own tiles: no key (CARTO's basemaps now answer every keyless request
  // with an "API KEY REQUIRED" tile). Light use with attribution is within
  // https://operations.osmfoundation.org/policies/tiles/; the CSS filter turns them into zine paper.
  var TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
  var ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var touch = L.Browser.mobile;

  /** A row of text buttons (fit, fit all) in the top-right corner. */
  function buttons(map, items) {
    var Ctl = L.Control.extend({
      options: { position: 'topright' },
      onAdd: function () {
        var bar = L.DomUtil.create('div', 'leaflet-bar route-map__buttons');
        items.forEach(function (it) {
          var b = L.DomUtil.create('button', 'route-map__button', bar);
          b.type = 'button';
          b.textContent = it.label;
          b.title = it.title;
          b.setAttribute('aria-label', it.title);
          L.DomEvent.disableClickPropagation(b);
          L.DomEvent.on(b, 'click', function (e) {
            L.DomEvent.preventDefault(e);
            it.run();
          });
        });
        return bar;
      },
    });
    map.addControl(new Ctl());
  }

  function fit(map, b) {
    if (b) map.fitBounds(b, { padding: [24, 24], animate: false, maxZoom: 16 });
  }

  function init(el) {
    var src = el.querySelector('[data-route-map-data]');
    if (!src) return;
    var data;
    try { data = JSON.parse(src.textContent); } catch (e) { return; }
    if (!data || !data.fit) return;

    var pane = document.createElement('div');
    pane.className = 'route-map__canvas';
    el.appendChild(pane);
    // Live before Leaflet measures the pane (a hidden pane is 0×0 and fits at max zoom);
    // undone if anything below throws, so the static SVG comes back.
    el.classList.add('is-live');
    try { build(el, pane, data); } catch (e) {
      el.classList.remove('is-live');
      el.removeChild(pane);
    }
  }

  function build(el, pane, data) {

    var map = L.map(pane, {
      attributionControl: false,
      dragging: !touch,
      tap: !touch,
      touchZoom: true,
      scrollWheelZoom: false,
      keyboard: true,
      zoomSnap: 0.25,
      zoomAnimation: !reduce,
      fadeAnimation: !reduce,
      markerZoomAnimation: !reduce,
      inertia: !reduce,
      minZoom: 3,
      maxZoom: 19,
    });
    L.control.attribution({ prefix: '<a href="https://leafletjs.com">Leaflet</a>' }).addAttribution(ATTRIBUTION).addTo(map);
    L.tileLayer(TILES, { maxZoom: 19, className: 'route-map__tiles' }).addTo(map);

    pane.setAttribute('aria-label', 'Interactive map: arrow keys pan, plus and minus zoom');
    pane.setAttribute('role', 'application');
    pane.setAttribute('aria-roledescription', 'map');

    if (data.kind === 'heatmap') {
      var r = L.svg({ padding: 0.5 });
      (data.segments || []).forEach(function (seg) {
        L.polyline(seg, { renderer: r, interactive: false, className: 'route-map__heat', weight: 3, opacity: 1 }).addTo(map);
      });
      buttons(map, [
        { label: 'home', title: 'Fit the map to home turf', run: function () { fit(map, data.fit); } },
        { label: 'fit all', title: 'Fit the map to every route', run: function () { fit(map, data.all); } },
      ]);
    } else {
      var line = data.line || [];
      L.polyline(line, { interactive: false, className: 'route-map__line', weight: 4, opacity: 1 }).addTo(map);
      if (line.length) {
        L.circleMarker(line[0], { radius: 6, interactive: false, className: 'route-map__start', weight: 2, fillOpacity: 1 }).addTo(map);
        L.circleMarker(line[line.length - 1], { radius: 6, interactive: false, className: 'route-map__end', weight: 2, fillOpacity: 1 }).addTo(map);
      }
      buttons(map, [{ label: 'fit', title: 'Fit the map to the route', run: function () { fit(map, data.fit); } }]);
    }

    fit(map, data.fit);
    var fb = el.querySelector('.route-map__fallback');
    if (fb) fb.setAttribute('aria-hidden', 'true');
    if (touch) el.classList.add('is-touch');
  }

  var els = document.querySelectorAll('[data-route-map]');
  for (var i = 0; i < els.length; i++) {
    init(els[i]);
  }
})();
