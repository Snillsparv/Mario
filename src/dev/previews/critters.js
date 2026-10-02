// Midsummer critters preview: /preview.html?m=critters&... (objects/Critters.js, critterModel.js)
//   kind=frog|crab|mosquito|all    which critters (all, the default: the three side by side, the
//                                  frog left, the crab in the middle, the mosquito right)
//   pose=idle|tell|strike|stuck|dazed|defeat   their pose (POSES below: each kind's state and
//                                  tick for it, its look worked out here), default idle
//   t=N                            that many ticks into the pose's state instead of its own tick
//   yaw=<radians>                  the camera's angle round them (0: straight in front; default a
//                                  three-quarter view), spin=1 orbits slowly; dist=<units> its
//                                  distance (default 330 for one, 700 for all); it looks at the
//                                  middle of what is posed, from the ground to the highest top
//                                  (a hovering mosquito, a stuck one's nose in the turf)
// On a grass plane with a strip of water behind them, lit as Midsummer Skerries' actors are (the
// course's low golden sun, the grounds' hemisphere), so the colours are the game's. The crab
// and the mosquito show static channel sets for their states until their own steps arrive.
import { Critters, CRITTER } from '../../objects/Critters.js';
import { CRITTER_RIG, MODEL } from '../../objects/critterModel.js';
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
// aims), to frame what is posed.
const SPAN = [[0, 90], [0, 105], [-80, 100]];

// The poses, per kind [state, tick] (frog, crab, mosquito).
const POSES = {
  idle: [['idle', 0], ['hidden', 0], ['patrol', 0]],
  tell: [['windup', 12], ['windup', 12], ['aim', 12]],
  strike: [['leap', 10], ['pinch', 2], ['dive', 3]],
  stuck: [['dazed', 10], ['stuck', 10], ['stuck', 10]],
  dazed: [['dazed', 20], ['stuck', 20], ['stuck', 20]],
  defeat: [['squash', 4], ['dent', 6], ['splat', 4]],
};

const smooth = (u) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));

// A critter's look `t` ticks into `state` (Critters.debugPose sets it on a record at home): the
// channels the frog's steps (critters/frog.js) set then; for the crab and the mosquito static
// sets until their own steps arrive.
function look(state, t) {
  const F = CRITTER.FROG;
  return (c) => {
    if (c.kind === MODEL.FROG) {
      const W = Math.round(F.WINDUP * c.calm);
      const lock = Math.round(F.LOCK * c.calm);
      if (state === 'windup') {
        Object.assign(c, { a0: -0.3, a1: t / W, glow: 0.25 - 0.25 * Math.cos((t * Math.PI * 12) / 30), sq: 0.92, markOn: t >= lock ? 1 : 0, mark: 0 });
      } else if (state === 'leap') {
        const vy0 = (F.GRAVITY * (F.LEAP - 1)) / 2;
        c.y += vy0 * t - (F.GRAVITY * t * (t - 1)) / 2;
        Object.assign(c, { a0: t <= 6 ? 1 : 0.25, pitch: -0.012 * (vy0 - F.GRAVITY * t), markOn: 1, mark: (W - lock + t) / (W - lock + F.LEAP) });
      } else if (state === 'dazed') {
        Object.assign(c, { sq: 0.7 + 0.3 * smooth(t / 14), a2: 0.22 * Math.sin(t * 0.7) * (1 - t / F.DAZED) });
      } else if (state === 'squash') {
        Object.assign(c, { sq: t >= 2 ? 0.25 : 1 - 0.375 * t, b1: t >= F.LIFT ? 1 : t / F.LIFT });
      } else c.a1 = 0.15;
      // (Its target 220 ahead at the lock: what is left of the way in its leap.)
      const ahead = state === 'leap' ? 220 * (1 - t / F.LEAP) : 220;
      if (c.markOn === 1) Object.assign(c, { tx: c.x + Math.sin(c.yaw) * ahead, tz: c.z + Math.cos(c.yaw) * ahead, markY: c.floorY, mnx: 0, mny: 1, mnz: 0 });
      return;
    }
    if (c.kind === MODEL.CRAB) {
      const lift = (k) => k + c.stand / (CRITTER_RIG.crab.LIFT_SPAN * c.scale);
      if (state === 'windup') Object.assign(c, { b1: lift(1.25), a2: 1.3, a3: 0.6, b0: 1.1, glow: 0.8 });
      else if (state === 'pinch') Object.assign(c, { b1: lift(1.25), a2: 0.4, a3: 1, b0: 1.1, glow: 1, z: c.z + 36 });
      else if (state === 'stuck') Object.assign(c, { b1: lift(1), a2: -0.6, a1: 1, a0: t * 0.6, b0: 0.8, pitch: 0.25 });
      else if (state === 'dent') Object.assign(c, { b1: lift(1), b0: 0.4, sq: 0.6, roll: 0.15 });
      return;
    }
    if (state === 'aim') Object.assign(c, { y: c.y + 80, a1: 1.4, a2: 1, b0: 1, glow: 1, pitch: 0.5 });
    else if (state === 'dive') Object.assign(c, { y: c.y + 20, a1: 1.4, a2: 0.6, b0: 1, glow: 1, pitch: 0.9 });
    else if (state === 'stuck') Object.assign(c, { y: c.hy + 85, a1: 1.6, a0: 2.1, b1: 1, pitch: 0.96 });
    else if (state === 'splat') Object.assign(c, { sq: 0.35, a1: 0.3 });
  };
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
  const kinds = want === 'all' ? KINDS : [want];
  const gap = 240;
  const spots = kinds.map((kind, i) => ({ id: kind, kind, x: (i - (kinds.length - 1) / 2) * gap, y: 0, z: 0, yaw: 0, roam: 1, fight: 400 }));
  const critters = new Critters({ spots, collision, events: new Events() });
  const pose = POSES[params.get('pose')] ? params.get('pose') : 'idle';
  const t = params.has('t') ? Number(params.get('t')) : null;
  for (let i = 0; i < spots.length; i++) {
    const c = critters.list[i];
    const [state, tick] = POSES[pose][c.kind];
    // (The frog sits on its spot: its idle ring is shrunk to a point there.)
    critters.debugPose(i, state, t ?? tick, look(state, t ?? tick));
  }
  scene.add(critters.mesh, critters.markers);
  critters.animate(1, 0);

  const yaw0 = params.has('yaw') ? Number(params.get('yaw')) : kinds.length > 1 ? 0.3 : 0.45;
  const dist = params.has('dist') ? Number(params.get('dist')) : kinds.length > 1 ? 700 : 330;
  const spin = params.has('spin');
  // It looks at the middle of what is posed, from the ground up to the highest top.
  let lo = 0;
  let hi = 0;
  for (const c of critters.list) {
    lo = Math.min(lo, c.y + SPAN[c.kind][0]);
    hi = Math.max(hi, c.y + SPAN[c.kind][1]);
  }
  const ty = (lo + hi) / 2;
  const target = [0, ty, 0];
  const at = (yaw) => [Math.sin(yaw) * dist, ty + dist * 0.3, Math.cos(yaw) * dist];
  return {
    camera: { pos: at(yaw0), look: target },
    update(dt, time) {
      critters.animate(1, time);
      const cam = window.__preview?.camera;
      if (spin && cam) {
        cam.position.set(...at(yaw0 + time * 0.3));
        cam.lookAt(...target);
      }
    },
  };
}
