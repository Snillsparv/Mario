// Original pixel-art HUD icons (pure data, no DOM). Each icon is
// { w, h, rows: string[], palette: { char: css colour } }; '.' is transparent.
// raster.js adds the dark outline around the silhouette when building sprites.

// Pip's face: teal explorer hat with a mustard band and a leaf sprig, round face, big eyes.
const PIP = {
  rows: [
    '.....tTTd..g..',
    '....tTTttd.gG.',
    '...tTTtttddgG.',
    '...tTttttddG..',
    '...YYyyyyyyG..',
    'TTTttttttttddd',
    '.ddhhhhhhhhdd.',
    '..hssssssssh..',
    '.ssswesswesss.',
    '.ssseesseesss.',
    '.ssseesseesss.',
    '.sccssssssccs.',
    '..ssssmmssss..',
    '...SSSSSSSS...',
  ],
  palette: {
    T: '#5fd8c8', t: '#1d948c', d: '#0f5f58',
    y: '#e3a82b', Y: '#f8d66a',
    g: '#7ad64e', G: '#3f9a2c',
    s: '#f8d0a8', S: '#e2a47e', h: '#7a4524',
    e: '#2a1c3c', w: '#ffffff', c: '#f3877c', m: '#a8432f',
  },
};

// Rasterise a shading function over a size×size grid into palette rows.
// shade(x, y) returns a palette key or '.'; x, y are pixel centres.
function procedural(size, palette, shade) {
  const rows = [];
  for (let y = 0; y < size; y++) {
    let row = '';
    for (let x = 0; x < size; x++) row += shade(x + 0.5, y + 0.5);
    rows.push(row);
  }
  return { rows, palette };
}

// Gold coin: dark rim, bright face lit from the top-left, embossed vertical slot.
function coinIcon() {
  const c = 7;
  return procedural(14, { H: '#fff4b0', M: '#ffd23a', L: '#e8a414', R: '#b8700a' }, (x, y) => {
    const dx = x - c;
    const dy = y - c;
    const d = Math.hypot(dx, dy);
    if (d > 7) return '.';
    if (d > 5.9) return dx + dy < -3 ? 'M' : 'R';
    // Raised centre bar with a shadow on its right, like a coin face lit from the left.
    if (Math.abs(dy) < 3.6) {
      if (x > 6 && x < 8) return 'H';
      if (x > 8 && x < 9) return 'L';
    }
    if (d > 3.4 && dx + dy < -3) return 'H';
    if (d > 3.4 && dx + dy > 3) return 'L';
    return 'M';
  });
}

// Direction the light comes from (screen space, y down): top-left.
const LIGHT_ANGLE = Math.atan2(-1, -1);

// Five-pointed star with bevelled facets: the facet on the lit side of each spoke is bright.
function starIcon() {
  const cx = 7;
  const cy = 7.8;
  const outer = 7.9;
  const inner = 3.7;
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const r = i % 2 ? inner : outer;
    pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  const inside = (x, y) => {
    let hit = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, yi] = pts[i];
      const [xj, yj] = pts[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
    }
    return hit;
  };
  return procedural(14, { H: '#fffbd0', M: '#ffe04a', L: '#f0a810', C: '#fff27a' }, (x, y) => {
    if (!inside(x, y)) return '.';
    const dx = x - cx;
    const dy = y - cy;
    if (Math.hypot(dx, dy) < 1.4) return 'C';
    // Each point has two facets either side of its spoke; a facet is lit when it faces
    // the light coming from the top-left.
    const seg = (2 * Math.PI) / 5;
    const a = Math.atan2(dy, dx);
    const k = Math.round((a + Math.PI / 2) / seg);
    const spoke = -Math.PI / 2 + k * seg;
    const side = Math.sign(Math.sin(a - spoke)) || 1;
    const facet = spoke + side * (Math.PI / 5);
    const lit = Math.cos(facet - LIGHT_ANGLE) > 0.1;
    if (lit && dx + dy < -4) return 'H';
    return lit ? 'M' : 'L';
  });
}

export const ICONS = {
  pip: { ...PIP, w: 14, h: 14 },
  coin: { ...coinIcon(), w: 14, h: 14 },
  star: { ...starIcon(), w: 14, h: 14 },
};
