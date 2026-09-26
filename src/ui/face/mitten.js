// The face screen's pointer: one of Jonas's big white-gloved cartoon hands in pixel art, open while
// it hovers and a fist while it pulls. Icons in the HUD icon format ({ w, h, rows, palette },
// '.' clear); ui/raster.js adds the dark outline and drop shadow when it builds the sprite.
// HOTSPOTS: the icon pixel that sits on the pointer.

const PALETTE = {
  c: '#f7f7f3', // the white glove (player/model/palette.js glove)
  s: '#d4d4cc', // its shaded side
  h: '#ffffff', // the sheen on its lit side
  l: '#9e9e96', // creases and knuckles
  u: '#eeeee6', // the glove's cuff
  U: '#c8c8be', // the cuff's shaded side
};

const icon = (rows) => ({ w: rows[0].length, h: rows.length, rows, palette: PALETTE });

export const MITTEN_OPEN = icon([
  '..........hhc.......',
  '........hhhcclc.....',
  '.......hhclcclcs....',
  '.......hcclcclcs....',
  '......hccclcclccs...',
  '......hccclcclccs...',
  '.hc...cccclcclccs...',
  '.hcc..cccclcclccs...',
  '.hccc.ccccccccccs...',
  '..cccllcccccccccs...',
  '..cccccccccccccss...',
  '...ccccccccccccss...',
  '....cccccccccccs....',
  '.....ccccccccsss....',
  '......ccccccsss.....',
  '......sssssssss.....',
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
  '......sssssssss.....',
  '.....uuuuuuuuuUU....',
  '.....uuuuuuuuuUU....',
  '.....UUUUUUUUUUU....',
]);

export const HOTSPOTS = { open: [10.5, 0.5], fist: [10, 8] };
