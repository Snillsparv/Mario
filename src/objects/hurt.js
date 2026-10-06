// What the course's hurting things (objects/Critters.js, objects/Minions.js and Sparrow Lane's
// STOMPWATT, objects/laneBoss/LaneBoss.js) ask about Jonas, in main so each of their chunks can.
//
//   AWAY[action] === 1      // F4: he is away (no strike, no stomp, no fight)
//   heroInvincible(player)  // he is blinking after a hit

// F4: actions in which he is away (exactly where Player.bounce() refuses: the automatic and
// submerged groups and NO_BOUNCE, plus being shot out of the cannon).
export const AWAY = {
  reading: 1,
  death: 1,
  spawn: 1,
  spawn_land: 1,
  star_dance: 1,
  star_fall: 1,
  pole: 1,
  pole_top: 1,
  ledge_hang: 1,
  ledge_climb: 1,
  cannon: 1,
  cannon_shot: 1,
  tail_hold: 1,
  tail_spin: 1,
  tail_throw: 1,
  swim_idle: 1,
  swim_stroke: 1,
  swim_flutter: 1,
  water_surface: 1,
};

// Is the hero blinking after a hit? (Player: tick < invincibleUntil; a plain boolean also works.)
export function heroInvincible(p) {
  if (typeof p.invincible === 'boolean') return p.invincible;
  return p.invincibleUntil !== undefined && p.tick !== undefined && p.tick < p.invincibleUntil;
}
