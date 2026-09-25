// The face screen's pointer: one of Pip's cream mittens in pixel art, open while it hovers and
// a fist while it pulls. Icons in the HUD icon format ({ w, h, rows, palette }, '.' clear);
// ui/raster.js adds the dark outline and drop shadow when it builds the sprite. HOTSPOTS: the
// icon pixel that sits on the pointer.

const PALETTE = {
  c: '#f7eed6', // the glove (player/model/palette.js glove)
  s: '#d9c9a2', // its shaded side
  h: '#ffffff', // the sheen on its lit side
  l: '#b39f74', // seams and creases
  u: '#ecdfbb', // the cuff
  U: '#c9b68c', // the cuff's shaded side
};

const icon = (rows) => ({ w: rows[0].length, h: rows.length, rows, palette: PALETTE });

export const MITTEN_OPEN = icon([
  '..........hhc.......',
  '........hhhcccc.....',
  '.......hhccccccs....',
  '.......hcccccccs....',
  '......hcccccccccs...',
  '......hcccccccccs...',
  '.hc...ccccccccccs...',
  '.hcc..ccccccccccs...',
  '.hccc.ccccccccccs...',
  '..cccllcccccccccs...',
  '..cccccccccccccss...',
  '...ccccccccccccss...',
  '....cccccccccccs....',
  '.....ccccccccsss....',
  '......ccccccsss.....',
  '......lllllllll.....',
  '.....uuuuuuuuuUU....',
  '.....uuuuuuuuuUU....',
  '.....UUUUUUUUUUU....',
]);

export const MITTEN_FIST = icon([
  '....................',
  '....................',
  '.........hhcc.......',
  '.......hhcccccc.....',
  '......hcccccccccs...',
  '.....hccccccccccs...',
  '.....hcccccccccccs..',
  '.....ccccccccccccs..',
  '....hcccccccccccss..',
  '...hllllllllllcss...',
  '...hcccccccccclss...',
  '...ccccccccccclss...',
  '....lllllllllllss...',
  '.....cccccccccss....',
  '......ccccccsss.....',
  '......lllllllll.....',
  '.....uuuuuuuuuUU....',
  '.....uuuuuuuuuUU....',
  '.....UUUUUUUUUUU....',
]);

export const HOTSPOTS = { open: [10.5, 0.5], fist: [10, 8] };
