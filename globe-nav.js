/*
 * GlobeNav -- drop-in alternative to CubeNav (cube-nav.js). Same API:
 *
 *   var nav = GlobeNav.mount(root, { faces, start, duration, bar:false });
 *   nav.go(i); nav.turn(+1); nav.index;  root fires "facechange".
 *
 * Instead of the faces being the sides of a box, they sit on the surface of a
 * wireframe sphere (latitude/longitude rings glow behind and between them).
 * Swiping rotates the globe, and the rotation follows your finger/mouse
 * while you drag, then snaps to the nearest page (a quick flick moves one
 * page). Vertical scrolling inside a page still works: a drag only turns the
 * globe once it is clearly horizontal.
 */
(function (global) {
  'use strict';

  var CSS = [
    '.gn{display:flex;flex-direction:column;height:100%;min-height:0}',
    '.gn-stage{position:relative;height:var(--cn-stage-h,520px);flex:none;perspective:1300px;overflow:hidden;touch-action:pan-y;cursor:grab;user-select:none;-webkit-user-select:none}',
    '.gn-stage.gn-drag{cursor:grabbing}',
    '.gn-globe{position:absolute;inset:0;transform-style:preserve-3d;transition:transform var(--cn-dur,700ms) cubic-bezier(.2,.8,.2,1)}',
    '.gn-globe.gn-live{transition:none}',
    '.gn-ring{position:absolute;left:50%;top:50%;border-radius:50%;pointer-events:none;border:1px solid color-mix(in srgb,var(--gold-bright,#f5c542) 32%,transparent);box-shadow:0 0 10px color-mix(in srgb,var(--gold-bright,#f5c542) 14%,transparent)}',
    '.gn-face{position:absolute;overflow:auto;backface-visibility:hidden;-webkit-backface-visibility:hidden;border-radius:18px;transition:filter var(--cn-dur,700ms)}',
    '.gn-face[data-active="false"]{filter:brightness(.5)}',
    '@media (prefers-reduced-motion:reduce){.gn-globe,.gn-face{transition:none}}'
  ].join('\n');

  function injectCSS() {
    if (document.getElementById('gn-style')) return;
    var s = document.createElement('style');
    s.id = 'gn-style';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  function mount(root, opts) {
    injectCSS();
    var faces = opts.faces || [];
    var n = faces.length;
    if (n < 2) throw new Error('GlobeNav needs at least 2 faces');
    var step = 360 / n;
    var index = 0, angle = 0, R = 0, fw = 0;

    root.classList.add('gn');
    root.style.setProperty('--cn-dur', (opts.duration || 700) + 'ms');
    root.innerHTML = '';

    var stage = document.createElement('div');
    stage.className = 'gn-stage';
    var globe = document.createElement('div');
    globe.className = 'gn-globe';

    var ringEls = [];
    function ring() {
      var r = document.createElement('div');
      r.className = 'gn-ring';
      globe.appendChild(r);
      ringEls.push(r);
      return r;
    }
    // 6 meridians + 5 parallels
    var meridians = [0, 1, 2, 3, 4, 5].map(ring);
    var parallels = [-60, -30, 0, 30, 60].map(function (lat) { var r = ring(); r.dataset.lat = lat; return r; });

    var faceEls = faces.map(function (f) {
      var el = document.createElement('section');
      el.className = 'gn-face';
      el.id = 'cn-' + f.id;
      el.setAttribute('aria-label', f.label || f.id);
      if (f.el) el.appendChild(f.el);
      else if (f.html != null) el.innerHTML = f.html;
      globe.appendChild(el);
      return el;
    });
    stage.appendChild(globe);
    root.appendChild(stage);

    function size(el, w, h, y) {
      el.style.width = w + 'px';
      el.style.height = h + 'px';
      el.style.marginLeft = (-w / 2) + 'px';
      el.style.marginTop = (-h / 2 + (y || 0)) + 'px';
    }

    function layout() {
      var w = stage.clientWidth, h = stage.clientHeight;
      fw = Math.round(w * 0.9);
      // Radius: far enough that neighbouring pages swing around behind the
      // sphere rather than overlapping the active one.
      R = Math.max(fw * 0.62, fw / (2 * Math.tan(Math.PI / Math.max(n, 3))) + 40);
      faceEls.forEach(function (el, i) {
        size(el, fw, h - 16, 0);
        el.style.transform = 'rotateY(' + (i * step) + 'deg) translateZ(' + R + 'px)';
      });
      var d = R * 2;
      meridians.forEach(function (r, k) {
        size(r, d, d, 0);
        r.style.transform = 'rotateY(' + (k * 30) + 'deg)';
      });
      parallels.forEach(function (r) {
        var lat = +r.dataset.lat * Math.PI / 180;
        var rr = R * Math.cos(lat) * 2;
        size(r, rr, rr, R * Math.sin(lat));
        r.style.transform = 'rotateX(90deg)';
      });
      paint(false);
    }

    function paint(live) {
      globe.classList.toggle('gn-live', !!live);
      globe.style.transform = 'translateZ(' + (-R) + 'px) rotateY(' + angle + 'deg)';
      faceEls.forEach(function (el, i) {
        var on = i === index;
        el.dataset.active = on;
        el.inert = !on;
        el.setAttribute('aria-hidden', !on);
      });
    }

    function go(i) {
      i = ((i % n) + n) % n;
      var d = (i - index + n) % n;
      if (d > n / 2) d -= n;
      if (!d) return;
      angle -= d * step;
      index = i;
      paint(false);
      if (opts.hash) history.replaceState(null, '', '#' + faces[i].id);
      root.dispatchEvent(new CustomEvent('facechange', { detail: { index: i, id: faces[i].id } }));
    }
    function turn(d) { go(index + d); }

    // ---- interactive drag -------------------------------------------------
    var pid = null, sx = 0, sy = 0, base = 0, dragging = false, lastX = 0, lastT = 0, vx = 0, moved = false;

    stage.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      pid = e.pointerId; sx = lastX = e.clientX; sy = e.clientY;
      lastT = e.timeStamp; vx = 0; base = angle; dragging = false; moved = false;
    });
    stage.addEventListener('pointermove', function (e) {
      if (pid !== e.pointerId) return;
      var dx = e.clientX - sx, dy = e.clientY - sy;
      if (!dragging) {
        if (Math.abs(dx) < 10 || Math.abs(dx) < Math.abs(dy) * 1.2) return;
        dragging = true; moved = true;
        stage.classList.add('gn-drag');
        try { stage.setPointerCapture(pid); } catch (_) {}
      }
      var dt = Math.max(1, e.timeStamp - lastT);
      vx = (e.clientX - lastX) / dt;
      lastX = e.clientX; lastT = e.timeStamp;
      // one stage-width of drag ~ one page of rotation
      angle = base + dx * (step / Math.max(1, stage.clientWidth * 0.9));
      paint(true);
    });
    function release(e) {
      if (pid !== e.pointerId) return;
      pid = null;
      stage.classList.remove('gn-drag');
      if (!dragging) return;
      dragging = false;
      var moveFaces = (base - angle) / step;      // + = toward next page
      var target = Math.round(moveFaces + (-vx * 120) / stage.clientWidth * 1.0);
      if (target === 0 && Math.abs(vx) > 0.5) target = vx < 0 ? 1 : -1;
      target = Math.max(-1, Math.min(1, target)); // never skip more than one page
      angle = base;                                // go() works from the settled angle
      var from = index;
      // reset visual angle to where finger left it, then animate to target
      var fingerAngle = base - moveFaces * step;
      globe.classList.add('gn-live');
      globe.style.transform = 'translateZ(' + (-R) + 'px) rotateY(' + fingerAngle + 'deg)';
      globe.getBoundingClientRect();
      if (target === 0) { paint(false); } else { go(from + target); }
    }
    stage.addEventListener('pointerup', release);
    stage.addEventListener('pointercancel', release);
    // A drag must not also click whatever button was under the finger.
    stage.addEventListener('click', function (e) {
      if (moved) { e.stopPropagation(); e.preventDefault(); moved = false; }
    }, true);

    // keyboard: arrows when focus is on the stage itself
    stage.tabIndex = -1;
    stage.addEventListener('keydown', function (e) {
      if (e.target !== stage) return;
      if (e.key === 'ArrowLeft') { turn(-1); e.preventDefault(); }
      if (e.key === 'ArrowRight') { turn(1); e.preventDefault(); }
    });

    var s = -1;
    if (opts.hash) {
      var startId = location.hash.slice(1);
      s = faces.findIndex(function (f) { return f.id === startId; });
    }
    index = s >= 0 ? s : (opts.start || 0);
    angle = -index * step;
    globe.classList.add('gn-live');
    layout();
    globe.getBoundingClientRect();
    globe.classList.remove('gn-live');

    new ResizeObserver(function () {
      globe.classList.add('gn-live');
      layout();
      requestAnimationFrame(function () { globe.classList.remove('gn-live'); });
    }).observe(stage);

    return { go: go, turn: turn, get index() { return index; } };
  }

  global.GlobeNav = { mount: mount };
})(window);
