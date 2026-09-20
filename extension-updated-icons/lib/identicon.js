// lib/identicon.js
// Small, dependency-free, fully local "identicon" generator: a colorful,
// symmetric grid pattern derived deterministically from an address (or any
// string), the same role MetaMask's account "blockie" avatar plays --
// instant, at-a-glance visual identity per account, so two accounts never
// look identical and the same account always looks the same. Pure inline
// SVG (crisp at any size, no image request, no canvas, nothing to load),
// and the color palette is curated (fixed saturation/lightness bands, hue
// picked from the hash) rather than raw random RGB, so results always look
// intentional against this wallet's dark theme instead of muddy.
(function () {
  // A tiny, seedable PRNG (mulberry32) fed by a simple string hash, so the
  // same input always produces the exact same pattern and colors -- no
  // Math.random(), no external hashing library needed.
  function hashString(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function mulberry32(seed) {
    let a = seed;
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function hsl(h, s, l) {
    return `hsl(${Math.round(h)}, ${s}%, ${l}%)`;
  }

  // Renders a 5-wide, 5-tall grid, generated 3 columns at a time and
  // mirrored left-right (columns 4-5 repeat columns 2-1) for the same
  // pleasing bilateral symmetry classic blockie/identicon patterns use.
  const GRID = 5;
  const CELLS = Math.ceil(GRID / 2) * GRID; // 3 x 5 = 15 random cells, mirrored to 5 x 5

  // Returns an inline <svg> markup string, `size`x`size` px, for the given
  // seed string (typically a 0x address, but any string works -- also used
  // for token symbols where there's no real logo to show).
  function svgFor(seed, size) {
    size = size || 28;
    const rand = mulberry32(hashString(String(seed || "")));

    const bgHue = rand() * 360;
    // Foreground hue offset by 100-260 degrees from the background so the
    // two never land close enough to blend together, whatever bgHue is.
    const fgHue = (bgHue + 100 + rand() * 160) % 360;
    const bg = hsl(bgHue, 38, 20);
    const fg = hsl(fgHue, 62, 58);

    const cellSize = size / GRID;
    const cols = Math.ceil(GRID / 2);
    const pattern = [];
    for (let col = 0; col < cols; col++) {
      for (let row = 0; row < GRID; row++) {
        pattern.push(rand() >= 0.5);
      }
    }

    let rects = "";
    for (let col = 0; col < GRID; col++) {
      const sourceCol = col < cols ? col : GRID - 1 - col;
      for (let row = 0; row < GRID; row++) {
        if (pattern[sourceCol * GRID + row]) {
          rects += `<rect x="${(col * cellSize).toFixed(2)}" y="${(row * cellSize).toFixed(2)}" width="${cellSize.toFixed(2)}" height="${cellSize.toFixed(2)}" fill="${fg}" />`;
        }
      }
    }

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-hidden="true"><rect width="${size}" height="${size}" fill="${bg}" />${rects}</svg>`;
  }

  if (typeof self !== "undefined") {
    self.TM_IDENTICON = { svgFor };
  }
})();
