// Hero model preview: /preview.html?m=hero&...
//   anim=<name>&t=<s>&yaw=<rad>   one pose (defaults to a representative time per anim)
//   live=1                        animate in real time instead of freezing at t
//   grid=1[&page=0&per=8&shift=s]  labelled grid of the anims at representative times (+shift)
//   turn=1[&anim=]                 front / left / back / right turnaround
//   strip=<anim>&ts=0.1,0.3|phs=0,0.25   one anim at several times (or cycle phases)
//   faces=1                        every facial expression side by side
//   ph=<cyclePhase>&fv=<forwardVel>&vy=<vy>&pitch=&roll=&slope=&inv=1&action=   RenderState overrides
//   zoom=<k>                       single pose / strip: camera k times closer (default 1)
//   yawrate=<rad/s>                turn continuously (the view counter-rotates) to show the bank
//   (phs / ph are gait phases for walk/run/tiptoe/crawl: converted to the Player's cyclePhase)
//   wall_brace is the model's pose for the Player's air_hit_wall action (anim wallkick).
// Scenery sits where the physics puts it relative to rs.pos (see model/physicsLink.js): the
// ledge lip HANG_DEPTH up and WALL_DIST ahead (ledge_climb moves rs.pos like the Player), a
// wall WALL_DIST ahead, a trunk surface POLE_GAP ahead.
// Lights mirror the game renderer (sun along layout.SUN_DIR + hemisphere ambient).

import { PlayerModel } from '../../player/PlayerModel.js';
import { ANIM_NAMES } from '../../player/model/animations.js';
import { gaitStride } from '../../player/model/strides.js';
import { FACES } from '../../player/model/faceTexture.js';
import {
  HANG_DEPTH, WALL_DIST, POLE_GAP, LEDGE_CLIMB_TIME, climbProgress, physicsStride,
} from '../../player/model/physicsLink.js';
import { SUN_DIR } from '../../world/layout.js';

// Representative moments: t = animTime, ph = cyclePhase, fv/vy = velocities (units/tick),
// y = height above the ground, prop = scenery that makes the pose readable.
const PRESETS = {
  idle: { t: 4.2 }, sleep: { t: 2.4 }, walk: { ph: 0.3, fv: 10 }, run: { ph: 0.3, fv: 30 },
  tiptoe: { ph: 0.2, fv: 5 }, skid: { t: 0.2, fv: 15 }, turnaround: { t: 0.12 }, push: { t: 0.3, prop: 'wall', yaw: 1.3 },
  crouch: { t: 0.5 }, crawl: { ph: 0.25, fv: 6 }, crouch_slide: { t: 0.3, fv: 20 }, land: { t: 0.06 },
  jump: { t: 0.25, vy: 20, y: 60 }, fall: { t: 0.6, vy: -20, y: 80 }, double_jump: { t: 0.35, vy: 15, y: 80 },
  triple_jump: { t: 0.28, vy: 10, y: 100 }, backflip: { t: 0.3, vy: 10, y: 100 }, sideflip: { t: 0.25, vy: 10, y: 100 },
  long_jump: { t: 0.3, fv: 40, y: 50 }, dive: { t: 0.3, fv: 30, vy: -5, y: 40 }, belly_slide: { t: 0.3, fv: 25 },
  butt_slide: { t: 0.3, fv: 20 }, ground_pound_spin: { t: 0.15, y: 100 }, ground_pound_fall: { t: 0.3, vy: -50, y: 80 },
  ground_pound_land: { t: 0.05 }, wallkick: { t: 0.08, fv: 20, vy: 25, y: 60 },
  wall_brace: { t: 0.03, y: 60, prop: 'wall', yaw: 1.3, action: 'air_hit_wall', anim: 'wallkick' }, bonk: { t: 0.2, fv: -10, y: 20 },
  hurt: { t: 0.25, fv: -15, vy: 10, y: 40 }, fall_damage: { t: 0.8 }, ledge_hang: { t: 0.5, prop: 'ledge', yaw: 1.1 },
  ledge_climb: { t: 0.3, prop: 'ledge', yaw: 1.1 }, pole_hold: { t: 0.5, prop: 'pole', y: 60, yaw: 1.1 },
  pole_climb: { t: 0.2, prop: 'pole', y: 60, yaw: 1.1 },
  pole_jump: { t: 0.2, fv: -10, vy: 20, y: 60 }, punch1: { t: 0.1 }, punch2: { t: 0.1 }, kick: { t: 0.15 },
  jump_kick: { t: 0.2, vy: 5, y: 50 }, swim_idle: { t: 0.5, y: 80, prop: 'water' }, swim_stroke: { t: 0.2, fv: 8, y: 80, prop: 'water' },
  swim_flutter: { t: 0.3, fv: 10, y: 80, prop: 'water' }, water_surface: { t: 0.5, prop: 'surface' },
  water_jump: { t: 0.2, vy: 20, y: 60 }, star_dance: { t: 1.35 }, spawn: { t: 0.4 }, death: { t: 1.8 },
};
const LEDGE_Y = 170; // ledge top above the preview floor
const CLIMB_INSET = 65; // how far the Player moves Pip onto the ledge
const TRUNK_R = 35;

// Player cyclePhase for a gait phase of the model at speed fv (the animator converts back).
function cyclePhaseFor(anim, ph, fv) {
  const model = gaitStride(anim, fv);
  return model ? (ph * model) / (physicsStride(anim) || model) : ph;
}

export async function setup({ THREE, scene, ui, params, camera }) {
  scene.background = new THREE.Color(0x86b8f0);
  const sun = new THREE.DirectionalLight(0xfff3e0, 0.6 * Math.PI);
  sun.position.set(SUN_DIR.x, SUN_DIR.y, SUN_DIR.z);
  scene.add(sun, new THREE.HemisphereLight(0xffffff, 0x9a9a88, 0.62 * Math.PI));

  const num = (k, d) => (params.has(k) ? Number(params.get(k)) : d);
  const live = params.has('live');
  const yawRate = num('yawrate', 0);
  const grass = new THREE.MeshLambertMaterial({ color: 0x5aa83a });
  const stone = new THREE.MeshLambertMaterial({ color: 0xc9b99a });
  const bark = new THREE.MeshLambertMaterial({ color: 0x7a5230 });
  const water = new THREE.MeshLambertMaterial({ color: 0x3a8fd0, transparent: true, opacity: 0.45, depthWrite: false });

  const actors = [];

  // One posed hero standing on its own patch of grass at (x, baseY, z).
  function addHero(anim, x, baseY, z, { yaw, t } = {}) {
    const pre = PRESETS[anim] ?? {};
    yaw ??= params.has('yaw') ? num('yaw', 0) : (pre.yaw ?? 0.35);
    const cell = new THREE.Group();
    cell.position.set(x, baseY, z);
    scene.add(cell);
    cell.add(new THREE.Mesh(new THREE.BoxGeometry(200, 6, 200).translate(0, -3, 0), grass));
    let y = num('y', pre.y ?? 0);
    let floorY = 0;
    // Scenery is authored for Pip facing +Z and turned with him.
    const props = new THREE.Group();
    props.rotation.y = yaw;
    cell.add(props);
    let pz = 0;
    if (pre.prop === 'ledge') {
      // Ledge top at LEDGE_Y, wall face at z = 0, Pip facing it; rs.pos where the physics has it.
      props.add(new THREE.Mesh(new THREE.BoxGeometry(200, LEDGE_Y, 120).translate(0, LEDGE_Y / 2, 60), stone));
      const { up, fwd } = anim === 'ledge_climb' ? climbProgress((t ?? num('t', pre.t)) / LEDGE_CLIMB_TIME) : { up: 0, fwd: 0 };
      y = LEDGE_Y - HANG_DEPTH * (1 - up);
      pz = -WALL_DIST + CLIMB_INSET * fwd;
      floorY = up >= 1 && pz > 0 ? LEDGE_Y : 0;
    } else if (pre.prop === 'wall') {
      props.add(new THREE.Mesh(new THREE.BoxGeometry(200, 200, 20).translate(0, 100, WALL_DIST + 10), stone));
    } else if (pre.prop === 'pole') {
      props.add(new THREE.Mesh(new THREE.CylinderGeometry(TRUNK_R, TRUNK_R, 300, 9).translate(0, 150, POLE_GAP + TRUNK_R), bark));
    } else if (pre.prop === 'water' || pre.prop === 'surface') {
      const level = pre.prop === 'water' ? y + 170 : 105;
      props.add(new THREE.Mesh(new THREE.BoxGeometry(200, level, 200).translate(0, level / 2, 0), water));
    }
    const model = new PlayerModel();
    props.add(model.object3D);
    // slope=<rad> tilts the floor down toward Pip's front (use pitch=<slope> to lie along it).
    const slope = num('slope', 0);
    const s = Math.sin(slope);
    const floorNormal = { x: Math.sin(yaw) * s, y: Math.cos(slope), z: Math.cos(yaw) * s };
    if (slope) cell.children[0].rotation.set(slope, yaw, 0, 'YXZ');
    const fv = num('fv', pre.fv ?? 0);
    const rs = {
      pos: { x: 0, y, z: pz }, yaw: 0, pitch: num('pitch', 0), roll: num('roll', 0),
      action: params.get('action') ?? pre.action ?? anim, anim: pre.anim ?? anim,
      animTime: t ?? num('t', pre.t ?? 0.3), cyclePhase: cyclePhaseFor(anim, num('ph', pre.ph ?? 0), fv),
      forwardVel: fv,
      vy: num('vy', pre.vy ?? 0), floorY, floorNormal, invincible: params.has('inv'), headYaw: 0,
    };
    const actor = { model, rs, props, yaw };
    // Settle blends, the bank and the scarf before the first frame.
    for (let i = 0; i < 90; i++) step(actor, 1 / 60);
    actors.push(actor);
    return model;
  }

  // One render frame of an actor: live mode advances time and stride like the Player;
  // yawrate turns Pip while the scenery turns back so the view stays put.
  function step(a, dt) {
    const { rs } = a;
    if (live) {
      rs.animTime += dt;
      rs.cyclePhase += (Math.abs(rs.forwardVel) * 30 * dt) / (physicsStride(rs.anim) || gaitStride(rs.anim, rs.forwardVel) || 150);
    }
    if (yawRate) {
      rs.yaw += yawRate * dt;
      a.props.rotation.y = a.yaw - rs.yaw;
    }
    a.model.update(rs, dt);
  }

  function label(text, x, y, z) {
    const el = document.createElement('div');
    el.textContent = text;
    el.style.cssText = 'position:absolute;transform:translate(-50%,0);font:bold 12px monospace;color:#fff;'
      + 'text-shadow:0 0 3px #000,0 0 2px #000;white-space:nowrap';
    ui.appendChild(el);
    return { el, pos: new THREE.Vector3(x, y, z) };
  }
  const labels = [];

  let view;
  if (params.has('grid')) {
    // Narrow field of view so every cell is seen from nearly the same angle.
    camera.fov = 20;
    const per = num('per', 8);
    const names = ANIM_NAMES.slice(num('page', 0) * per, num('page', 0) * per + per);
    const cols = Math.ceil(Math.sqrt(names.length * 1.8));
    const rows = Math.ceil(names.length / cols);
    names.forEach((name, i) => {
      const cx = ((i % cols) - (cols - 1) / 2) * 260;
      const cy = -Math.floor(i / cols) * 330;
      const pre = PRESETS[name] ?? {};
      const t = params.has('t') ? num('t', 0) : (pre.t ?? 0.3) + num('shift', 0);
      addHero(name, cx, cy, 0, { t });
      labels.push(label(`${name} ${t.toFixed(2)}`, cx, cy - 20, 100));
    });
    const midY = (-(rows - 1) * 330) / 2 + 90;
    const dist = Math.max(rows * 330, cols * 260 * 0.56) * 2.9;
    view = { pos: [0, midY + dist * 0.12, dist], look: [0, midY, 0] };
  } else if (params.has('strip')) {
    // One anim at several moments: ts=animTimes or phs=cyclePhases (comma separated).
    const anim = params.get('strip');
    const list = (k) => params.get(k)?.split(',').map(Number);
    const ts = list('ts') ?? list('phs') ?? [0.1, 0.3, 0.6];
    const byPhase = params.has('phs');
    ts.forEach((v, i) => {
      const x = (i - (ts.length - 1) / 2) * 240;
      addHero(anim, x, 0, 0, { t: byPhase ? undefined : v, yaw: params.has('yaw') ? num('yaw', 0) : 1.2 });
      if (byPhase) actors.at(-1).rs.cyclePhase = cyclePhaseFor(anim, v, actors.at(-1).rs.forwardVel);
      labels.push(label(`${anim} ${byPhase ? 'ph' : 't'}=${v}`, x, -30, 100));
    });
    for (const a of actors) for (let i = 0; i < 30; i++) step(a, 1 / 60);
    camera.fov = 25;
    const lift = actors[0].rs.pos.y;
    view = { pos: [0, 260 + lift, ts.length * 240 * 1.35 + 250], look: [0, 70 + lift, 0] };
  } else if (params.has('turn')) {
    const anim = params.get('anim') || 'idle';
    [0, Math.PI / 2, Math.PI, -Math.PI / 2].forEach((yaw, i) => addHero(anim, (i - 1.5) * 210, 0, 0, { yaw }));
    view = { pos: [0, 120, 900], look: [0, 80, 0] };
  } else if (params.has('faces')) {
    FACES.forEach((face, i) => {
      const x = (i - (FACES.length - 1) / 2) * 90;
      const m = addHero('idle', x, 0, 0, { yaw: 0, t: 0.5 });
      actors.at(-1).face = face;
      m.faceMaterial.map = m.faces(face);
      labels.push(label(face, x, 48, 0));
    });
    view = { pos: [0, 150, 520], look: [0, 115, 0] };
  } else {
    const anim = params.get('anim') || 'idle';
    addHero(anim, 0, 0, 0);
    const lift = actors[0].rs.pos.y;
    view = { pos: [230, 170 + lift * 0.6, 430], look: [0, 75 + lift * 0.6, 0] };
    labels.push(label(`${anim}  t=${actors[0].rs.animTime}`, 0, -30, 0));
  }

  // zoom=k: move the camera k times closer to the look point.
  const zoom = num('zoom', 1);
  if (zoom > 0 && zoom !== 1) view.pos = view.pos.map((v, i) => view.look[i] + (v - view.look[i]) / zoom);

  return {
    camera: view,
    update(dt) {
      for (const a of actors) {
        if (!a.face) step(a, dt); // (expression strip: frozen)
      }
      camera.updateMatrixWorld();
      const w = innerWidth;
      const h = innerHeight;
      for (const l of labels) {
        const p = l.pos.clone().project(camera);
        l.el.style.left = `${((p.x + 1) / 2) * w}px`;
        l.el.style.top = `${((1 - p.y) / 2) * h}px`;
      }
    },
  };
}
