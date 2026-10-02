// Trampolines (layout.TRAMPOLINES: [{ x, y, z, r, vy }], Sparrow Lane's in north_5's front
// garden): landing on one's mat bounces the hero straight back up with a 'boing' (player.bounce:
// higher while the jump button is held, BOUNCE_HELD_VY), and again every time he comes down on
// it, until he steers off. The trampoline is drawn and made solid by its course (lane/props.js);
// this is only its spring.
//
//   new Trampolines({ spots })
//   update(player, hero)     30 Hz, after the hero's tick: hero is his previous tick's motion
//                            (ObjectManager.hero: { y, vy, air }) or null
//   bounces                  how many times he has bounced (tests)
//
// A bounce: his feet came down this tick (airborne the tick before, standing now) within r of
// a mat's middle and within MAT_SLACK of its top, y. player.bounce refuses while he reads a sign
// or drops in; it keeps his forward speed, so he can steer from one bounce to the next.
//
// Allocation: update() allocates nothing (an index loop, no Math.hypot or Math.max/min).

const MAT_SLACK = 4;

export class Trampolines {
  constructor({ spots }) {
    this.spots = spots;
    this.bounces = 0;
  }

  update(player, hero) {
    if (hero === null || !hero.air || !player.grounded) return;
    const p = player.pos;
    for (let i = 0; i < this.spots.length; i++) {
      const s = this.spots[i];
      const dx = p.x - s.x;
      const dz = p.z - s.z;
      const dy = p.y - s.y;
      if (dx * dx + dz * dz > s.r * s.r || dy > MAT_SLACK || dy < -MAT_SLACK) continue;
      if (player.bounce(s.vy, 'boing')) this.bounces++;
      return;
    }
  }
}
