// The face screen's pointer: one of Jonas's big bare cartoon hands in pixel art, open while
// it hovers and a fist while it pulls. Icons in the HUD icon format ({ w, h, rows, palette },
// '.' clear); ui/raster.js adds the dark outline and drop shadow when it builds the sprite.
// HOTSPOTS: the icon pixel that sits on the pointer.

const PALETTE = {
  c: '#f8d0a8', // the skin (player/model/palette.js skin, as the HUD face paints it)
  s: '#e2a47e', // its shaded side
  h: '#ffe8d0', // the sheen on its lit side
  l: '#c07a52', // creases and knuckles
  u: '#f4c49c', // the wrist
  U: '#d8996f', // the wrist's shaded side
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
