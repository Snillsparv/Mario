// STOMPWATT preview (Sparrow Lane's boss, objects/laneBoss/*): /preview.html?m=laneBoss&...
// The classic look's model (the dad's car's own classic faces on its rig, lit by the lane's
// bake: model.js), on a patch of drive under the lane's sky colour. (The realistic look's model
// is the worker's car: see it in the game, tools/realShots.mjs's robot views.)
//   morph=0..1          the morph (0 the car, 1 the robot; default 1)
//   pose=<a rig.js POSES name>   its pose (default stand; on bent legs its pelvis lowered: rig.footLift)
//   lift=<units>        the car's body raised off its wheels (default 0; 50 during a wake)
//   blink=0..1          its eyes shut that far
//   look=<radians>      its head turned round
//   hatch=<radians>     its backpack's hatch open that far (the battery's cells show)
//   lights=0..3         its power lights still lit (default 3)
//   sheet=poses|morph   a row of them instead: every pose (but fold; poses=a,b,c: those), or the
//                       morph at 0, 1/4, 1/2, 3/4, 1
//   turn=<radians>      its own heading (default 0: facing the camera's yaw 0)
//   yaw=<radians>       the camera's angle round it (0: in front; default a three-quarter view),
//                       spin=1 orbits slowly; dist=<units> its distance
import * as layout from '../../world/lane/layout.js';
import { dadCar } from '../../world/lane/props.js';
import { LIGHT } from '../../world/lane/build.js';
import { RobotModel, classicCar } from '../../objects/laneBoss/model.js';
import { BONES, POSES, unfold, footLift } from '../../objects/laneBoss/rig.js';

const N = BONES.length;
const INDEX = Object.fromEntries(BONES.map(([name], i) => [name, i]));
const turnsOf = (name, m, look = 0) => {
  const t = new Float32Array(N * 3);
  const goal = new Float32Array(N * 3);
  const fold = new Float32Array(N * 3);
  for (const [bone, r] of Object.entries(POSES[name] ?? POSES.stand)) goal.set(r, INDEX[bone] * 3);
  for (const [bone, r] of Object.entries(POSES.fold)) fold.set(r, INDEX[bone] * 3);
  const k = unfold(m);
  for (let i = 0; i < t.length; i++) t[i] = fold[i] + (goal[i] - fold[i]) * k;
  t[INDEX.neck * 3 + 1] += look;
  return t;
};

export async function setup({ THREE, scene, params }) {
  scene.background = new THREE.Color(0x9ec4ec);
  scene.fog = new THREE.Fog(0x9ec4ec, 6000, 24000);
  const car = layout.CARS.find((c) => c.id === layout.LANE_BOSS.car);
  const pieces = classicCar(layout, { ownCar: (id, paint, mark) => dadCar(paint, layout, car, mark) });
  const num = (k, d) => (params.has(k) ? Number(params.get(k)) : d);
  const sheet = params.get('sheet');
  const list = sheet === 'poses' ? (params.get('poses')?.split(',') ?? Object.keys(POSES).filter((p) => p !== 'fold')).map((pose) => ({ pose, m: 1 })) : sheet === 'morph' ? [0, 0.25, 0.5, 0.75, 1].map((m) => ({ pose: 'stand', m })) : [{ pose: params.get('pose') ?? 'stand', m: num('morph', 1) }];
  const gap = sheet === 'morph' ? 760 : sheet === 'poses' ? 640 : 600;
  list.forEach(({ pose, m }, i) => {
    const model = new RobotModel('classic', pieces, { tint: car.classicTint ?? car.tint, light: { ...LIGHT, sun: layout.LANE_SUN } });
    scene.add(model.group);
    const t = turnsOf(pose, m, num('look', 0));
    const lift = (hip, kn) => footLift(t[INDEX[hip] * 3], t[INDEX[kn] * 3]);
    const bob = m >= 1 ? -Math.min(lift('hipL', 'knL'), lift('hipR', 'knR')) : 0;
    model.pose({ x: (i - (list.length - 1) / 2) * gap, y: 0, z: 0, yaw: num('turn', 0), m, lift: num('lift', 0), bob, turns: t, blinkL: num('blink', 0), blinkR: num('blink', 0), hatch: num('hatch', 0), lights: num('lights', 3) });
  });
  // The drive under it.
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(gap * list.length + 1600, 2400).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x5a5a58 }));
  scene.add(ground);
  const dist = num('dist', 1700 + (list.length - 1) * gap * 0.32);
  let yaw = num('yaw', sheet ? 0.25 : 0.55);
  const spin = params.get('spin') === '1';
  const camera = { pos: [Math.sin(yaw) * dist, num('camy', 420), Math.cos(yaw) * dist], look: [0, num('looky', 330), 0] };
  return {
    camera,
    update(dt) {
      if (!spin) return;
      yaw += dt * 0.3;
      window.__preview?.camera.position.set(Math.sin(yaw) * dist, 420, Math.cos(yaw) * dist);
      window.__preview?.camera.lookAt(0, 330, 0);
    },
  };
}
