/*
 * CubeNav -- shows each page of an app on one face of a rotating cube.
 * Adapted for Token Exchange from a generic drop-in module: the built-in
 * tab bar/prev-next buttons are optional (this app supplies its own themed
 * tab bar and just calls .go()/.turn()), and the stage uses a fixed height
 * (via the --cn-stage-h custom property) with each face scrolling
 * internally, rather than assuming a flex-stretched parent -- this app's
 * screens size themselves to their own content and rely on the page
 * scrolling, so the cube gets its own explicit viewport instead.
 *
 *   CubeNav.mount(document.getElementById('stage'), {
 *     faces: [
 *       { id: 'home',     label: 'Home',     el: document.getElementById('screen-main') },
 *       { id: 'activity', label: 'Activity', el: document.getElementById('screen-activity') },
 *       { id: 'send',     label: 'Send',     el: document.getElementById('screen-send') },
 *     ],
 *     start: 0,          // which face shows first
 *     duration: 650,      // rotation time in ms
 *     bar: false,          // skip the built-in tab bar -- caller drives .go()/.turn() itself
 *   });
 *
 * 4 faces makes a cube; 3, 5, 6... make a prism with that many sides.
 * Fires a "facechange" event on the root (mount target) on every turn.
 */
(function (global) {
  'use strict';

  var CSS = [
    '.cn{display:flex;flex-direction:column;height:100%;min-height:0}',
    '.cn-bar{display:flex;align-items:center;gap:.25rem;padding:.5rem;overflow-x:auto;flex:none}',
    '.cn-tab,.cn-turn{font:inherit;color:inherit;background:none;border:1px solid transparent;border-radius:999px;padding:.45rem .9rem;cursor:pointer;white-space:nowrap}',
    '.cn-tab[aria-current="true"]{border-color:currentColor}',
    '.cn-turn{padding:.45rem .7rem;line-height:1}',
    '.cn-tab:focus-visible,.cn-turn:focus-visible{outline:2px solid currentColor;outline-offset:2px}',
    '.cn-tabs{display:flex;gap:.25rem;flex:1;justify-content:center}',
    '.cn-stage{position:relative;height:var(--cn-stage-h,520px);flex:none;perspective:1400px;overflow:hidden;touch-action:pan-y}',
    '.cn-cube{position:absolute;inset:0;transform-style:preserve-3d;transition:transform var(--cn-dur,700ms) cubic-bezier(.65,0,.35,1)}',
    '.cn-face{position:absolute;inset:0;overflow:auto;backface-visibility:hidden;-webkit-backface-visibility:hidden;transition:filter var(--cn-dur,700ms)}',
    '.cn-face[data-active="false"]{filter:brightness(.55)}',
    '.cn-face iframe{border:0;width:100%;height:100%;display:block}',
    '@media (prefers-reduced-motion:reduce){.cn-cube,.cn-face{transition:none}}'
  ].join('\n');

  function injectCSS() {
    if (document.getElementById('cn-style')) return;
    var s = document.createElement('style');
    s.id = 'cn-style';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  function mount(root, opts) {
    injectCSS();
    var faces = opts.faces || [];
    var n = faces.length;
    if (n < 2) throw new Error('CubeNav needs at least 2 faces');
    var step = 360 / n;
    var index = 0, angle = 0, depth = 0;
    var useBar = opts.bar !== false;

    root.classList.add('cn');
    root.style.setProperty('--cn-dur', (opts.duration || 700) + 'ms');
    root.innerHTML = '';

    var bar = null, tabs = [];
    if (useBar) {
      // Tabs and left/right buttons
      bar = document.createElement('nav');
      bar.className = 'cn-bar';
      bar.setAttribute('aria-label', opts.navLabel || 'Pages');
      var prev = button('cn-turn', '‹', 'Turn left');
      var next = button('cn-turn', '›', 'Turn right');
      var tabWrap = document.createElement('div');
      tabWrap.className = 'cn-tabs';
      tabs = faces.map(function (f, i) {
        var b = button('cn-tab', f.label, null);
        b.addEventListener('click', function () { go(i); });
        tabWrap.appendChild(b);
        return b;
      });
      bar.append(prev, tabWrap, next);
      prev.addEventListener('click', function () { turn(-1); });
      next.addEventListener('click', function () { turn(1); });
      bar.addEventListener('keydown', function (e) {
        if (e.key === 'ArrowLeft') { turn(-1); e.preventDefault(); }
        if (e.key === 'ArrowRight') { turn(1); e.preventDefault(); }
      });
    }

    // The cube itself
    var stage = document.createElement('div');
    stage.className = 'cn-stage';
    var cube = document.createElement('div');
    cube.className = 'cn-cube';
    var faceEls = faces.map(function (f, i) {
      var el = document.createElement('section');
      el.className = 'cn-face';
      el.id = 'cn-' + f.id;
      el.setAttribute('aria-label', f.label || f.id);
      if (f.el) el.appendChild(f.el);
      else if (f.html != null) el.innerHTML = f.html;
      cube.appendChild(el);
      return el;
    });
    stage.appendChild(cube);
    if (bar) root.append(bar, stage);
    else root.append(stage);

    // Frames load only when their face is shown or next to it
    function loadNear(i) {
      [i, (i + 1) % n, (i - 1 + n) % n].forEach(function (k) {
        var f = faces[k], el = faceEls[k];
        if (f.src && !el.firstChild) {
          var fr = document.createElement('iframe');
          fr.src = f.src;
          fr.title = f.label || f.id;
          el.appendChild(fr);
        }
      });
    }

    function layout() {
      var w = stage.clientWidth;
      depth = n === 2 ? w / 2 : w / (2 * Math.tan(Math.PI / n));
      faceEls.forEach(function (el, i) {
        el.style.transform = 'rotateY(' + (i * step) + 'deg) translateZ(' + depth + 'px)';
      });
      paint();
    }

    function paint() {
      cube.style.transform = 'translateZ(' + (-depth) + 'px) rotateY(' + angle + 'deg)';
      faceEls.forEach(function (el, i) {
        var on = i === index;
        el.dataset.active = on;
        el.inert = !on;
        el.setAttribute('aria-hidden', !on);
      });
      tabs.forEach(function (t, i) { t.setAttribute('aria-current', i === index); });
    }

    // Turn toward face i the short way; +1 = one face to the right
    function go(i) {
      i = ((i % n) + n) % n;
      var d = (i - index + n) % n;
      if (d > n / 2) d -= n;
      if (!d) return;
      angle -= d * step;
      index = i;
      loadNear(i);
      paint();
      if (opts.hash) history.replaceState(null, '', '#' + faces[i].id);
      root.dispatchEvent(new CustomEvent('facechange', { detail: { index: i, id: faces[i].id } }));
    }
    function turn(d) { var t = index + d; go(t); }

    // Horizontal swipe on touch screens
    var sx = null, sy = null;
    stage.addEventListener('touchstart', function (e) {
      sx = e.touches[0].clientX; sy = e.touches[0].clientY;
    }, { passive: true });
    stage.addEventListener('touchend', function (e) {
      if (sx == null) return;
      var dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy;
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) turn(dx < 0 ? 1 : -1);
      sx = null;
    });

    // Start face: #hash (only when opts.hash is on), then opts.start
    var s = -1;
    if (opts.hash) {
      var startId = location.hash.slice(1);
      s = faces.findIndex(function (f) { return f.id === startId; });
    }
    index = s >= 0 ? s : (opts.start || 0);
    angle = -index * step;
    loadNear(index);
    cube.style.transition = 'none';
    layout();
    cube.getBoundingClientRect();
    cube.style.transition = '';

    new ResizeObserver(function () {
      cube.style.transition = 'none';
      layout();
      requestAnimationFrame(function () { cube.style.transition = ''; });
    }).observe(stage);

    return { go: go, turn: turn, get index() { return index; } };
  }

  function button(cls, text, label) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = cls;
    b.textContent = text;
    if (label) b.setAttribute('aria-label', label);
    return b;
  }

  global.CubeNav = { mount: mount };
})(window);
