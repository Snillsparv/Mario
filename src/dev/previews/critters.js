// Midsummer critters preview: /preview.html?m=critters&... (objects/Critters.js, critterModel.js)
//   kind=frog|crab|mosquito|all    which critters (all, the default: the three side by side, the
//                                  frog left, the crab in the middle, the mosquito right)
//   pose=idle|tell|strike|stuck|dazed|defeat   their pose (POSES below: each kind's state and
//                                  tick for it), default idle
//   t=N                            that many ticks into the pose's state instead of its own tick
//   yaw=<radians>                  the camera's angle round them (0: straight in front; default a
//                                  three-quarter view), spin=1 orbits slowly; dist=<units> its
//                                  distance (default: 330 for one, 700 for all, or further back
//                                  so all that is posed fits the frame); it looks at the middle of
//                                  what is posed (where the poses took them: a frog that leapt,
//                                  a lunging crab, a mosquito's danger ring), from the ground to
//                                  the highest top (a hovering mosquito, a stuck one's nose in
//                                  the turf)
// On a grass plane with a strip of water behind them, lit as Midsummer Skerries' actors are (the
// course's low golden sun, the grounds' hemisphere), so the colours are the game's. Every pose
// is reached through the critters' own steps: each kind is a Critters of its own with a
// stand-in hero (no model: only where he stands counts) in front of it, in its strike window,
// stepped until it is in the pose's state at its tick; for the stuck and dazed poses he steps
// aside once its target locks (its strike misses him), for the defeats he drops onto it.
import { Critters, CRITTER } from '../../objects/Critters.js';
import { CRITTER_RIG } from '../../objects/critterModel.js';
import { CollisionWorld } from '../../collision/CollisionWorld.js';
import { Events } from '../../core/events.js';
import { NO_WATER } from '../../core/constants.js';
import { SKERRIES_ATMOSPHERE } from '../../world/areas.js';
import { SKY_HORIZON_COLOR } from '../../world/sky.js';
import { grassTexture, waterTexture } from '../../world/terrainTextures.js';

const KINDS = ['frog', 'crab', 'mosquito'];
const WATER_Z = -420; // the water strip from here back
// Each kind's lowest and highest point over its record's y (rig space: the mosquito's origin
// is its thorax, its legs dangling 80 under it, its abdomen curling up to 100 over it as it
// aims) and how far it reaches round it (its needle 130 ahead), to frame what is posed.
const SPAN = [[0, 90], [0, 105], [-80, 100]];
const REACH = [70, 95, 135];
const MARK_TO = [CRITTER.FROG.MARK_TO, 0, CRITTER.MOSQUITO.MARK_TO];

// The poses, per kind [state, tick] (frog, crab, mosquito; a stomped frog is flat after 2 ticks,
// poofing with its wreath flying up; the crab's dent and the mosquito's splat last 3).
const POSES = {
  idle: [['idle', 0], ['hidden', 0], ['patrol', 0]],
  tell: [['windup', 12], ['windup', 12], ['aim', 12]],
  strike: [['leap', 10], ['pinch', 2], ['dive', 3]],
  stuck: [['dazed', 10], ['stuck', 10], ['stuck', 10]],
  dazed: [['dazed', 20], ['stuck', 20], ['stuck', 20]],
  defeat: [['poof', 2], ['dent', 2], ['splat', 2]],
};
// Where the stand-in hero waits in front of each kind (in its window: the frog winds up, the
// crab too, the mosquito aims from where it hovers), and the state and tick by which its target
// has locked (he steps aside then for the stuck poses, or drops onto it for the defeats).
const AHEAD = [240, 180, 225];
const LOCKED = [['windup', 19], ['windup', 15], ['aim', 2]];

// A hero standing in for Jonas: where he stands, what he does (never hurt, never stomping
// unless dropped onto it), and what he did last tick.
function standIn(x, z) {
  return {
    pos: { x, y: 0, z },
    vel: { x: 0, y: 0, z: 0 },
    action: 'idle',
    tick: 0,
    invincibleUntil: 0,
    inWater: false,
    floor: { y: 0, surface: {} },
    takeDamage() {
      return true;
    },
    getAttack() {
      return null;
    },
    bounce() {
      return true;
    },
  };
}

// Steps one critter (kind index k, at x) to the pose's state and tick (at most 600 ticks).
function poseOne(collision, k, x, pose, tick) {
  const critters = new Critters({ spots: [{ id: KINDS[k], kind: KINDS[k], x, y: 0, z: 0, yaw: 0, roam: 1, fight: 400 }], collision, events: new Events() });
  const c = critters.list[0];
  const [state, t0] = POSES[pose][k];
  const t = tick ?? t0;
  const hero = standIn(x, pose === 'idle' ? 5000 : AHEAD[k]);
  const last = { y: 0, vy: 0, air: false };
  const step = () => {
    hero.tick++;
    critters.update(hero, last, hero.tick);
    last.y = hero.pos.y;
    last.vy = hero.vel.y;
    last.air = hero.pos.y > 1;
  };
  const [lockState, lockT] = LOCKED[k];
  let moved = false;
  for (let i = 0; i < 600 && !(c.state === state && c.t === t); i++) {
    if (!moved && c.state === lockState && c.t >= lockT) {
      moved = true;
      if (pose === 'stuck' || pose === 'dazed') hero.pos.x += 260;
      else if (pose === 'defeat') {
        // Dropping onto its top (falling, out of the air), then away up out of it.
        const R = CRITTER_RIG[KINDS[k]];
        Object.assign(hero.pos, { x: c.x, y: c.y + (R.TOP + critters._rise(c)) * c.scale - 5, z: c.z });
        Object.assign(hero.vel, { y: -12 });
        Object.assign(last, { y: hero.pos.y + 15, vy: -12, air: true });
        hero.action = 'freefall';
        step();
        hero.pos.y += 3000;
        hero.vel.y = 0;
        continue;
      }
    }
    step();
  }
  critters.animate(1, 0);
  return critters;
}

export async function setup({ THREE, scene, params }) {
  scene.background = new THREE.Color(SKY_HORIZON_COLOR);
  scene.fog = new THREE.Fog(SKY_HORIZON_COLOR, SKERRIES_ATMOSPHERE.near, SKERRIES_ATMOSPHERE.far);
  // The course's actor lights: its sun along its direction and the grounds' hemisphere.
  const A = SKERRIES_ATMOSPHERE;
  const sun = new THREE.DirectionalLight(A.sun, A.sunIntensity);
  sun.position.set(A.sunDir.x, A.sunDir.y, A.sunDir.z).multiplyScalar(10000);
  scene.add(sun, new THREE.HemisphereLight(0xffffff, 0x9a9a88, 0.62 * Math.PI));

  // The grass, and the water behind.
  const grass = grassTexture().clone();
  grass.repeat.set(30, 30);
  grass.needsUpdate = true;
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ map: grass }));
  const water = waterTexture().clone();
  water.repeat.set(8, 2);
  water.needsUpdate = true;
  const strip = new THREE.Mesh(
    new THREE.PlaneGeometry(6000, 1600).rotateX(-Math.PI / 2).translate(0, 3, WATER_Z - 800),
    new THREE.MeshBasicMaterial({ map: water, color: 0xb8d8e0, transparent: true, opacity: 0.9 }),
  );
  scene.add(ground, strip);
  const collision = new CollisionWorld();
  collision.addTriangles([-3000, 0, 3000, 3000, 0, 3000, 3000, 0, -3000, -3000, 0, 3000, 3000, 0, -3000, -3000, 0, -3000]);
  collision.setWaterLevelFn((x, z) => (z < WATER_Z ? 2 : NO_WATER));
  collision.finalize();

  const want = params.get('kind') ?? 'all';
  const kinds = want === 'all' ? [0, 1, 2] : [KINDS.indexOf(want)];
  const pose = POSES[params.get('pose')] ? params.get('pose') : 'idle';
  const tick = params.has('t') ? Number(params.get('t')) : null;
  const gap = 240;
  const crews = kinds.map((k, i) => poseOne(collision, k, (i - (kinds.length - 1) / 2) * gap, pose, tick));
  for (const crew of crews) scene.add(crew.mesh, crew.markers);

  const yaw0 = params.has('yaw') ? Number(params.get('yaw')) : kinds.length > 1 ? 0.3 : 0.45;
  const spin = params.has('spin');
  // It looks at the middle of what is posed (each one where its pose took it, with its reach
  // round it and its danger ring), from the ground up to the highest top ...
  const box = [Infinity, 0, Infinity, -Infinity, 0, -Infinity];
  const take = (x, y, z, r) => {
    box[0] = Math.min(box[0], x - r);
    box[1] = Math.min(box[1], y);
    box[2] = Math.min(box[2], z - r);
    box[3] = Math.max(box[3], x + r);
    box[4] = Math.max(box[4], y);
    box[5] = Math.max(box[5], z + r);
  };
  for (const crew of crews) {
    const c = crew.list[0];
    const r = REACH[c.kind] * c.scale;
    take(c.x, c.y + SPAN[c.kind][0], c.z, r);
    take(c.x, c.y + SPAN[c.kind][1], c.z, r);
    if (c.markOn === 1) take(c.tx, c.markY, c.tz, MARK_TO[c.kind] / 2);
  }
  const target = [(box[0] + box[3]) / 2, (box[1] + box[4]) / 2, (box[2] + box[5]) / 2];
  // ... from far enough back that all of it fits the frame (at the default distance or more):
  // its corners' half spread across the view and up it (the camera looking down about 17
  // degrees) against the field of view's, with a margin, plus half its depth.
  const fov = Math.tan((22.5 * Math.PI) / 180);
  const fit = (yaw) => {
    let w = 0;
    let h = 0;
    let deep = 0;
    for (let k = 0; k < 8; k++) {
      const dx = (k & 1 ? box[3] : box[0]) - target[0];
      const dy = (k & 2 ? box[4] : box[1]) - target[1];
      const dz = (k & 4 ? box[5] : box[2]) - target[2];
      const across = dx * Math.cos(yaw) - dz * Math.sin(yaw);
      const along = dx * Math.sin(yaw) + dz * Math.cos(yaw);
      w = Math.max(w, Math.abs(across));
      h = Math.max(h, Math.abs(dy * 0.96 + along * 0.29));
      deep = Math.max(deep, Math.abs(along));
    }
    return Math.max(w / (0.8 * fov * (innerWidth / innerHeight)), h / (0.8 * fov)) + deep / 2;
  };
  const dist = params.has('dist') ? Number(params.get('dist')) : Math.max(kinds.length > 1 ? 700 : 330, fit(yaw0));
  const ty = target[1];
  const at = (yaw) => [target[0] + Math.sin(yaw) * dist, ty + dist * 0.3, target[2] + Math.cos(yaw) * dist];
  return {
    camera: { pos: at(yaw0), look: target },
    update(dt, time) {
      for (const crew of crews) crew.animate(1, time);
      const cam = window.__preview?.camera;
      if (spin && cam) {
        cam.position.set(...at(yaw0 + time * 0.3));
        cam.lookAt(...target);
      }
    },
  };
}
