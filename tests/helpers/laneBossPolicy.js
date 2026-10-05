// A scripted player for STOMPWATT's fight (objects/laneBoss/fight.js), shared by the node test
// (tests/lane-boss.test.js) and the browser one (tests/lane-boss-browser.test.js imports it
// through the dev server): from the boss's state and his own place each tick, the controller
// input a careful child would give. It keeps its distance between attacks; steps out of a
// stomp's locked ring and jumps its shockwave just before it arrives; walks off a dash's line
// once it locks; backs out of a swipe's arc; while the robot charges it runs round behind it and
// punches the glowing cells; once it is beaten it fetches the reward star. Pure: no imports.
//
//   policy(boss, player, cameraYaw, tick, opts?) -> { stickX, stickY, A, B }
//       opts.FIGHT: tuning.js FIGHT (the attacks' numbers; the browser passes them in), opts.jumpWave
//       (ticks before the wave reaches him that he jumps; default 2)

const stickTo = (yaw, camYaw, mag = 1) => ({ stickX: Math.sin(camYaw - yaw) * mag, stickY: Math.cos(camYaw - yaw) * mag, A: false, B: false });
const NONE = () => ({ stickX: 0, stickY: 0, A: false, B: false });

export function policy(boss, player, camYaw, tick, { FIGHT, jumpWave = 2 } = {}) {
  const p = player.pos;
  const c = boss.cur;
  const dx = c.x - p.x;
  const dz = c.z - p.z;
  const dist = Math.hypot(dx, dz);
  const toBoss = Math.atan2(dx, dz);
  const away = toBoss + Math.PI;
  const go = (x, z, mag = 1) => stickTo(Math.atan2(x - p.x, z - p.z), camYaw, mag);
  const grounded = !!(player.floor && player.floor.surface) && p.y <= player.floor.y + 1;
  // The shockwave: jump just before its band reaches his feet circle.
  const w = boss.markers.wave;
  // (In the air over it: holding the jump, no drifting.)
  if (w.on && !grounded && Math.abs(Math.hypot(p.x - w.x, p.z - w.z) - w.r) < 400) return { ...NONE(), A: player.vel.y > 0 };
  if (w.on && grounded) {
    const d = Math.hypot(p.x - w.x, p.z - w.z);
    const reach = FIGHT.STOMP.band / 2 + 50;
    const gap = d - w.r - reach; // (how far the band still has to run)
    if (gap > 0 && gap <= FIGHT.STOMP.wave * jumpWave) return { ...NONE(), A: true };
    // (Coming: standing still for it, not running on ahead of it.)
    if (gap > 0 && gap <= 100) return NONE();
  }
  const s = boss.state;
  const back = { x: -Math.sin(c.yaw), z: -Math.cos(c.yaw) };
  // The reward star: fetch it (jump under it).
  const star = boss.star?.star;
  if (star && star.active && star.state === 'idle') {
    const sd = Math.hypot(star.pos.x - p.x, star.pos.z - p.z);
    if (sd < 40) return { ...NONE(), A: grounded && tick % 20 === 0 };
    return go(star.pos.x, star.pos.z);
  }
  if (s === 'open' || s === 'plug' || s === 'kneel') {
    // Behind it: to the spot behind its back, then in toward its middle, punching.
    const bx = c.x + back.x * 260;
    const bz = c.z + back.z * 260;
    const behind = (p.x - c.x) * back.x + (p.z - c.z) * back.z;
    if (behind < 140 || Math.hypot(p.x - bx, p.z - bz) > 200) {
      // (Round its side, not through it.)
      if (behind < 0 && dist < 380) {
        const side = (p.x - c.x) * back.z - (p.z - c.z) * back.x >= 0 ? 1 : -1;
        return go(c.x + back.z * side * 360 + back.x * 100, c.z - back.x * side * 360 + back.z * 100);
      }
      return go(bx, bz);
    }
    if (s !== 'open') return NONE();
    // In close (walking in to its back), then facing it, punching (a press every other tick).
    if (dist > 190 && player.action !== 'punch') return go(c.x, c.z, 0.5);
    return { ...NONE(), B: tick % 2 === 0 };
  }
  if ((s === 'low' || (s === 'walk' && boss.walkMode === 'charge')) && boss.chargeAt) {
    // Off to wait behind the charging spot.
    const C = boss.chargeAt;
    const bx = C.x - Math.sin(C.yaw) * 420;
    const bz = C.z - Math.cos(C.yaw) * 420;
    if (Math.hypot(p.x - bx, p.z - bz) > 60 && Math.hypot(p.x - c.x, p.z - c.z) > 300) return go(bx, bz);
    if (Math.hypot(p.x - c.x, p.z - c.z) <= 300) return stickTo(away, camYaw);
    return NONE();
  }
  if (s === 'stomp_tell' || s === 'stomp_hop') {
    // Out of the ring once it has locked (it no longer follows him): away from its middle.
    const ring = boss.markers.ring;
    const locked = s === 'stomp_hop' || boss.t > boss._phase().tell - FIGHT.LOCK;
    const rd = Math.hypot(p.x - ring.x, p.z - ring.z);
    if (locked && rd < FIGHT.STOMP.foot + 120) return stickTo(Math.atan2(p.x - ring.x, p.z - ring.z) + (rd < 1 ? 1 : 0), camYaw);
    return NONE();
  }
  if (s === 'dash_tell' || s === 'dash') {
    // Off the line once it locks: sideways, away from it.
    const a = boss.atk;
    const off = (p.x - c.x) * a.dz - (p.z - c.z) * a.dx;
    const locked = s === 'dash' || boss.t > boss._phase().tell - FIGHT.LOCK;
    if (locked && Math.abs(off) < FIGHT.DASH.r + 230) {
      const k = off >= 0 ? 1 : -1;
      return stickTo(Math.atan2(a.dz * k, -a.dx * k), camYaw);
    }
    return NONE();
  }
  if (s === 'swipe_tell' || s === 'swipe') {
    if (dist < FIGHT.SWIPE.reach + 160) return stickTo(away, camYaw);
    return NONE();
  }
  // Between attacks: keep about 650 off it, on the street side of it (the open ground in front
  // of the drives: never backing into the carport or a hedge).
  const A = boss.arena;
  const sx = A.x;
  const sz = A.z - 450;
  let ux = sx - c.x;
  let uz = sz - c.z;
  let ul = Math.hypot(ux, uz);
  if (ul < 200) {
    ux = -dx;
    uz = -dz;
    ul = Math.hypot(ux, uz) || 1;
  }
  const rx = c.x + (ux / ul) * 650;
  const rz = c.z + (uz / ul) * 650;
  const rd = Math.hypot(rx - p.x, rz - p.z);
  if (dist < 420 || (rd > 160 && FIGHTS[s])) return go(rx, rz, dist < 420 ? 1 : 0.8);
  return NONE();
}
const FIGHTS = { stand: 1, walk: 1, gap: 1, watch: 1, dizzy: 1, zapped: 1, unplug: 1 };
