/**
 * LiveFolio Pin Bridge — injected into shared-folio iframes (?lf_pins=1).
 *
 * The folio iframe is sandboxed (sandbox="allow-scripts", opaque origin), so
 * the parent shell cannot reach into its document. This script runs INSIDE
 * the folio to:
 *
 *   1. CAPTURE pins at click time with real DOM context: scroll-absolute
 *      percentage coordinates, a CSS selector for the clicked element, an
 *      HTML snapshot of it, and the containing section (index + heading).
 *      Selector-first anchoring is the same model the Studio uses — see
 *      StudioView.tsx — so share pins and studio pins have identical
 *      semantics, and any viewer on ANY device can re-locate the element
 *      (percentages alone are viewport/layout dependent and can never be).
 *   2. RENDER pin markers inside the folio document anchored to the target
 *      element, so pins scroll with the content instead of floating on the
 *      viewport.
 *
 * Capture model: NO intercepting overlay. A full-page overlay can never see
 * the element under the pointer (hit-testing returns the overlay itself), so
 * while pinning we register capture-phase listeners on the document — the
 * click target is then the real content element. Pin mode only adds a
 * viewport-fixed, pointer-events:none tint as a visual hint. Idle markers are
 * appended directly to the document (small absolute elements, no full-page
 * wrapper — a full-document overlay breaks Chromium touch scrolling).
 *
 * Protocol (postMessage; the sandboxed frame has an opaque origin, so both
 * sides authenticate by window identity — e.source — never by e.origin):
 *   iframe -> parent : LIVEFOLIO_PINS_READY   (on init)
 *                      LIVEFOLIO_PIN_DROP      {x, y, selector, elementHtml,
 *                                               slideIndex, sectionLabel}
 *   parent -> iframe : LIVEFOLIO_PINS_SYNC     {pins: [{id,x,y,selector,
 *                                               elementHtml,text,author,index}],
 *                                               accent}
 *                      LIVEFOLIO_PIN_MODE      {active: boolean}
 *
 * Keep this file in sync with StudioView.tsx (getUniqueSelector /
 * getSectionContext / resolvePinTarget / marker styling).
 */
(function () {
  'use strict';
  if (window.__livefolioPinBridge) return; // a cached folio HTML may double-inject
  window.__livefolioPinBridge = true;

  var state = { pins: [], accent: '#FF3B00', mode: false };

  function send(type, payload) {
    try {
      window.parent.postMessage(Object.assign({ type: type }, payload || {}), '*');
    } catch (err) { /* parent may have navigated away */ }
  }

  // Mirrors StudioView.tsx escapeHtml — author/text are user-controlled.
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ── Element identification (keep in sync with StudioView.tsx) ─────────

  // Collapse whitespace/newlines so HTML and text can be compared across
  // formatting differences.
  function normWs(s) {
    return String(s == null ? '' : s).replace(/\s+/g, ' ');
  }
  // Text content of a captured HTML snapshot (tags stripped, whitespace
  // collapsed) — used to re-locate an element after the DOM changed.
  function snapshotText(html) {
    return normWs(html).replace(/<[^>]*>/g, ' ').trim();
  }
  // Structure-only shape (tags + attributes, whitespace stripped) — used for
  // longest-common-prefix similarity between a captured snapshot and live
  // candidates.
  function htmlShape(html) {
    return String(html == null ? '' : html).replace(/\s+/g, '');
  }
  // Common prefix length of two strings.
  function commonPrefixLen(a, b) {
    var n = Math.min(a.length, b.length);
    var i = 0;
    while (i < n && a.charCodeAt(i) === b.charCodeAt(i)) i++;
    return i;
  }

  // Mirrors StudioView.tsx getUniqueSelector — prefers ids, else nth-of-type
  // chains joined with ' > '.
  function getUniqueSelector(el) {
    if (el.id) return '#' + el.id;
    if (el === document.body) return 'body';
    var path = [];
    var curr = el;
    while (curr && curr.nodeType === Node.ELEMENT_NODE) {
      var s = curr.nodeName.toLowerCase();
      if (curr.id) {
        s += '#' + curr.id;
        path.unshift(s);
        break;
      }
      var sib = curr;
      var idx = 1;
      while ((sib = sib.previousElementSibling)) {
        if (sib.nodeName.toLowerCase() === s) idx++;
      }
      s += ':nth-of-type(' + idx + ')';
      path.unshift(s);
      curr = curr.parentNode;
    }
    return path.join(' > ');
  }

  // Containing section context — walks up to the nearest
  // section/article/[data-section] and reports its 0-based index among all
  // sections plus its first h1-h3 heading text (what the curated brief shows
  // an AI instead of "Whole Page / Global").
  function getSectionContext(el) {
    var node = el;
    while (node && node.nodeType === Node.ELEMENT_NODE &&
           node !== document.body && node !== document.documentElement) {
      var tag = (node.tagName || '').toLowerCase();
      if (tag === 'section' || tag === 'article' ||
          (node.hasAttribute && node.hasAttribute('data-section'))) break;
      node = node.parentElement;
    }
    if (!node || node === document.body || node === document.documentElement) return {};
    var sections = document.querySelectorAll('section, article, [data-section]');
    var idx = -1;
    for (var i = 0; i < sections.length; i++) {
      if (sections[i] === node) { idx = i; break; }
    }
    var heading = node.querySelector('h1, h2, h3');
    var label = heading && heading.textContent
      ? normWs(heading.textContent).trim().slice(0, 120)
      : '';
    return {
      slideIndex: idx >= 0 ? idx : undefined,
      sectionLabel: label || undefined,
    };
  }

  // Text search fallback — locate the element whose text mentions a seed
  // taken from the captured snapshot (or the pin comment itself). Lets pins
  // survive DOM edits that invalidate structural selectors.
  function findByText(seed) {
    // Strip any markup (the seed may be a raw elementHtml snapshot).
    var want = normWs(seed).replace(/<[^>]*>/g, ' ').trim();
    if (want.length < 12) return null;
    var probe = want.slice(0, 48);
    var all = document.querySelectorAll('h1, h2, h3, h4, p, li, blockquote, figcaption, td, th, dt, dd, span, a, strong, em, b, i, label, button');
    var best = null;
    var bestLen = Infinity;
    var guard = 0;
    for (var i = 0; i < all.length && guard < 30000; i++, guard++) {
      var el = all[i];
      if (el.children && el.children.length > 0) continue; // leaf-ish nodes only
      var t = normWs(el.textContent).trim();
      if (t && t.indexOf(probe) !== -1 && t.length < bestLen) {
        best = el;
        bestLen = t.length;
      }
    }
    return best;
  }

  // Given a pin, resolve the live element it points at. Chain:
  //   1. exact stored selector
  //   2. selector shortened from the tail until it matches, choosing the
  //      candidate whose structure best matches the captured HTML snapshot
  //   3. text affinity (snapshot text, then the comment text itself)
  // Returns null when nothing can be trusted (caller falls back to x/y).
  function resolvePinTarget(pin) {
    if (pin.selector) {
      try {
        var hit = document.querySelector(pin.selector);
        if (hit) return hit;
      } catch (err) { /* malformed selector — fall through */ }
      try {
        var parts = String(pin.selector).split(' > ');
        var snapshotShape = htmlShape(pin.elementHtml || '');
        while (parts.length > 1) {
          parts.pop();
          var nodes = [];
          try {
            nodes = Array.prototype.slice.call(document.querySelectorAll(parts.join(' > ')));
          } catch (err) { nodes = []; }
          if (nodes.length === 0) continue;
          if (!snapshotShape) return nodes[nodes.length - 1];
          var best = nodes[0];
          var bestScore = -1;
          for (var i = 0; i < nodes.length; i++) {
            var score = commonPrefixLen(htmlShape(nodes[i].outerHTML), snapshotShape);
            if (score > bestScore) { bestScore = score; best = nodes[i]; }
          }
          return bestScore > 40 ? best : best; // strongest structural guess
        }
      } catch (err) { /* selector walk failed — fall through */ }
    }
    // Text affinity — survives DOM edits that invalidate structural paths.
    var seed = snapshotText(pin.elementHtml) || pin.text || '';
    var found = findByText(seed);
    if (found) return found;
    return null;
  }

  // ── Rendering ─────────────────────────────────────────────────────────

  // Marker position in DOCUMENT pixel coordinates (scroll-absolute). The
  // resolved element's rect center + scroll offsets — correct on any device,
  // recomputed per layout. Falls back to stored x/y percentages mapped onto
  // the current scroll size (legacy pins).
  function markerXY(pin) {
    var targetEl = resolvePinTarget(pin);
    if (targetEl) {
      var rect = targetEl.getBoundingClientRect();
      if (rect.width > 0 || rect.height > 0) {
        return {
          x: rect.left + window.scrollX + rect.width / 2,
          y: rect.top + window.scrollY + rect.height / 2,
        };
      }
    }
    return {
      x: ((pin.x != null ? pin.x : 50) / 100) * document.documentElement.scrollWidth,
      y: ((pin.y != null ? pin.y : 50) / 100) * document.documentElement.scrollHeight,
    };
  }

  // Markers are appended DIRECTLY to the document, one absolutely-positioned
  // 24px element each at pixel coordinates. There is deliberately NO
  // full-page wrapper layer for the idle view: Chromium's touch-scroll
  // hit-testing misbehaves with full-document overlays (wheel still works,
  // but drags freeze — the reported mobile bug), so nothing but the small
  // markers themselves may exist in the document outside pin mode.
  var markers = [];

  function removeMarkers() {
    for (var i = 0; i < markers.length; i++) {
      var m = markers[i];
      if (m.parentNode) m.parentNode.removeChild(m);
    }
    markers = [];
  }

  function renderMarkers() {
    removeMarkers();
    if (!document.body || !state.pins.length) return;
    for (var i = 0; i < state.pins.length; i++) {
      var pin = state.pins[i];
      var xy = markerXY(pin);
      var marker = document.createElement('div');
      marker.className = 'livefolio-pin-marker';
      marker.style.position = 'absolute';
      marker.style.left = xy.x + 'px';
      marker.style.top = xy.y + 'px';
      marker.style.width = '24px';
      marker.style.height = '24px';
      marker.style.marginLeft = '-12px';
      marker.style.marginTop = '-12px';
      // While pinning, markers must not intercept taps.
      marker.style.pointerEvents = state.mode ? 'none' : 'auto';
      marker.style.cursor = 'help';
      marker.innerHTML =
        '<div style="width:100%;height:100%;background:' + state.accent +
        ';color:#fff;border-radius:9999px;display:flex;align-items:center;justify-content:center;' +
        'box-shadow:0 2px 10px rgba(15,15,13,0.25);border:2px solid #F4F4F0;' +
        'font-size:10px;font-weight:700;font-family:system-ui,-apple-system,sans-serif;' +
        'transition:transform 0.2s ease, box-shadow 0.2s ease;">' +
        (pin.index != null ? pin.index : i + 1) +
        '</div>' +
        '<div class="livefolio-pin-tooltip" style="position:absolute;top:34px;left:50%;' +
        'transform:translateX(-50%);display:none;background:#0F0F0D;color:#F4F4F0;' +
        'font-size:11px;line-height:1.45;padding:8px 12px;border-radius:12px;' +
        'max-width:240px;white-space:normal;box-shadow:0 4px 16px rgba(15,15,13,0.3);' +
        'font-family:system-ui,-apple-system,sans-serif;font-weight:500;z-index:1000000;">' +
        '<strong style="display:block;font-size:9px;text-transform:uppercase;' +
        'letter-spacing:0.08em;opacity:0.7;margin-bottom:2px;">' +
        escapeHtml(pin.author || 'Feedback') + '</strong>' +
        '<span style="opacity:0.95;">' + escapeHtml(pin.text || 'View this note') + '</span>' +
        '</div>';
      if (!state.mode) {
        marker.onmouseenter = function () {
          if (this.children[0]) this.children[0].style.transform = 'scale(1.15)';
          if (this.children[1]) this.children[1].style.display = 'block';
        };
        marker.onmouseleave = function () {
          if (this.children[0]) this.children[0].style.transform = 'scale(1)';
          if (this.children[1]) this.children[1].style.display = 'none';
        };
      }
      document.body.appendChild(marker);
      markers.push(marker);
    }
  }

  // Pin mode adds a small VIEWPORT-FIXED tint (pointer-events: none) purely
  // as a visual "capture mode" hint — capture itself runs on document
  // listeners, so the tint never needs to cover scrollable content.
  var tint = null;

  function setTint(active) {
    if (tint && tint.parentNode) tint.parentNode.removeChild(tint);
    tint = null;
    if (document.body) document.body.style.cursor = active ? 'crosshair' : '';
    if (!active) return;
    tint = document.createElement('div');
    tint.id = 'livefolio-pin-tint';
    tint.style.position = 'fixed';
    tint.style.inset = '0';
    tint.style.zIndex = '999998';
    tint.style.pointerEvents = 'none';
    tint.style.backgroundColor = 'rgba(24, 24, 27, 0.05)';
    document.body.appendChild(tint);
  }

  function render() {
    if (!document.body) return;
    renderMarkers();
    setTint(state.mode);
  }

  // ── Capture (document capture-phase — no intercepting overlay) ────────

  // The click target is the real content element (nothing overlays it while
  // pinning); only body/documentElement hits yield no selector.
  function elementAtTarget(t) {
    var el = t && t.nodeType === 3 ? t.parentElement : t;
    while (el && (el === document.body || el === document.documentElement)) {
      el = el.parentElement;
    }
    return el && el.nodeType === 1 ? el : null;
  }

  function handleCapture(e, clientX, clientY) {
    if (clientX == null || clientY == null) return;
    var absX = clientX + window.scrollX;
    var absY = clientY + window.scrollY;
    var x = (absX / document.documentElement.scrollWidth) * 100;
    var y = (absY / document.documentElement.scrollHeight) * 100;
    var target = elementAtTarget(e && e.target);
    var payload = { x: x, y: y };
    if (target) {
      payload.selector = getUniqueSelector(target);
      payload.elementHtml = target.outerHTML ? target.outerHTML.substring(0, 500) : undefined;
      var section = getSectionContext(target);
      payload.slideIndex = section.slideIndex;
      payload.sectionLabel = section.sectionLabel;
    }
    send('LIVEFOLIO_PIN_DROP', payload);
  }

  // ── Link handling ─────────────────────────────────────────────────────
  // Links with target="_top"/"_parent" can't navigate the app tab from the
  // sandbox without the allow-top-navigation token — which freezes touch
  // scrolling of the iframe on mobile (see ShareClient sandbox comment).
  // Open them as REAL TABS instead: allow-popups + the click's user
  // activation make window.open work from inside the sandboxed document.
  // Never fires in pin mode (pinning owns every click).
  function onLinkClick(e) {
    if (state.mode) return;
    var el = e.target;
    var a = el && el.nodeType === 1 && el.closest ? el.closest('a[target]') : null;
    if (!a) return;
    var t = (a.getAttribute('target') || '').toLowerCase();
    if (t !== '_top' && t !== '_parent') return; // _blank and plain links work natively
    var href = a.getAttribute('href');
    if (!href) return;
    var url;
    try { url = new URL(href, window.location.href); } catch (err) { return; }
    e.preventDefault();
    e.stopPropagation();
    try { window.open(url.href, '_blank', 'noopener'); } catch (err) { /* popup blocked — nothing else to do */ }
  }
  document.addEventListener('click', onLinkClick, true);

  var touchStart = null;

  function onCaptureClick(e) {
    e.preventDefault();
    e.stopPropagation();
    handleCapture(e, e.clientX, e.clientY);
  }

  function onTouchStart(e) {
    if (e.changedTouches.length === 1) {
      var t = e.changedTouches[0];
      touchStart = { x: t.clientX, y: t.clientY };
    }
  }

  function onCaptureTouch(e) {
    if (e.changedTouches.length !== 1) return;
    var touch = e.changedTouches[0];
    var moved = touchStart
      ? Math.sqrt(Math.pow(touch.clientX - touchStart.x, 2) + Math.pow(touch.clientY - touchStart.y, 2))
      : 0;
    touchStart = null;
    if (moved > 12) return; // a scroll, not a tap
    // Suppress the follow-up click so content never receives it.
    e.preventDefault();
    handleCapture(e, touch.clientX, touch.clientY);
  }

  function setMode(active) {
    state.mode = !!active;
    if (state.mode) {
      document.addEventListener('click', onCaptureClick, true);
      document.addEventListener('touchstart', onTouchStart, { passive: true, capture: true });
      document.addEventListener('touchend', onCaptureTouch, { passive: false, capture: true });
    } else {
      document.removeEventListener('click', onCaptureClick, true);
      document.removeEventListener('touchstart', onTouchStart, { capture: true });
      document.removeEventListener('touchend', onCaptureTouch, { capture: true });
      touchStart = null;
    }
    render();
  }

  // ── Message handling ──────────────────────────────────────────────────

  window.addEventListener('message', function (e) {
    // Sandboxed iframe = opaque origin; window identity is the only check.
    if (e.source !== window.parent) return;
    var d = e.data;
    if (!d || typeof d !== 'object') return;
    if (d.type === 'LIVEFOLIO_PINS_SYNC') {
      state.pins = Array.isArray(d.pins) ? d.pins : [];
      if (typeof d.accent === 'string' && d.accent) state.accent = d.accent;
      render();
    } else if (d.type === 'LIVEFOLIO_PIN_MODE') {
      setMode(!!d.active);
    } else if (d.type === 'LIVEFOLIO_PINS_PING') {
      // Pull-based handshake: the parent may mount its message listener
      // after this script's parse-time PINS_READY was already sent (React
      // hydration vs. a fast cached iframe load) — answer every ping so the
      // parent always learns the bridge is up, however late it asks.
      send('LIVEFOLIO_PINS_READY', {});
    }
  });

  // Re-anchor after late layout (font/image loads) and viewport changes.
  window.addEventListener('resize', function () { render(); });
  window.addEventListener('load', function () { render(); });

  // Announce readiness once the DOM is available; the parent replies with the
  // current pins + mode (covers reload races: the parent re-syncs on READY).
  function announce() { send('LIVEFOLIO_PINS_READY', {}); }
  if (document.body) announce();
  else document.addEventListener('DOMContentLoaded', announce);
})();
