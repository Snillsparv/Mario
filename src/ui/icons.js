// Original pixel-art HUD icons (pure data, no DOM). Each icon is
// { w, h, rows: string[], palette: { char: css colour } }; '.' is transparent.
// raster.js adds the dark outline around the silhouette when building sprites.

// Jonas's face: a plain light blue cap (a darker bill, one seam, the button on top), messy
// brown hair sticking out under it, thin dark round glasses over big eyes, rosy cheeks.
const JONAS = {
  rows: [
    '......dd......',
    '....BBbbbb....',
    '..BBbbbbbbbd..',
    '.BBbbbbdbbbbd.',
    '.Bbbbbbdbbbbd.',
    'dddddddddddddd',
    'hhSSSShSSSSShh',
    'hhsgggHsgggshh',
    'hggwewggwewggh',
    '.sgwewggwewgs.',
    '.csgggSSgggsc.',
    '.ccsssssssscc.',
    '..ssssmmssss..',
    '...SSSSSSSS...',
  ],
  palette: {
    B: '#c4e8ff', b: '#86c8f0', d: '#4f95cc',
    h: '#8a5028', H: '#5a3216',
    s: '#f8d0a8', S: '#e2a47e', g: '#22222c', w: '#ffffff', e: '#5a3212', c: '#f3877c', m: '#a8432f',
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

// Our gold coin, matching the coins in the world (objects/textures.js paintCoinFace): a border
// ring (amber, bronze on the shaded lower right) and an embossed four-facet diamond lit from
// the upper left (white upper-left facet, light-gold upper-right, amber lower-left, bronze
// lower-right); the rim is lit on the upper left. W/M/L/R are the world coin's facet white,
// mid, lo and rim colours; H is a light gold for the lit rim and the upper-right facet.
const COIN = {
  rows: [
    '....HHHHHH....',
    '..HHHLLLLMMM..',
    '.HHLLMMMMLLMM.',
    '.HLMMMWHMMMLM.',
    'HHLMMWWHHMMLML',
    'HLMMMWWHHMMMRL',
    'HLMMWWWHHHMMRL',
    'HLMMLLLRRRMMRL',
    'HLMMMLLRRMMMRL',
    'HMLMMLLRRMMRLL',
    '.MLMMMLRMMMRL.',
    '.MMLLMMMMRRLL.',
    '..MMMRRRRLLL..',
    '....LLLLLL....',
  ],
  palette: { W: '#fffdf0', H: '#ffe680', M: '#ffd23a', L: '#d48c0c', R: '#b8700a' },
};

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
  hero: { ...JONAS, w: 14, h: 14 },
  coin: { ...COIN, w: 14, h: 14 },
  star: { ...starIcon(), w: 14, h: 14 },
};
