// Hero model design: Jonas, a cartoon avatar of the player. A plain light blue baseball cap
// (no emblem, never red) over messy brown hair that sticks out from under it, thin dark round
// glasses in front of his eyes, a red t-shirt with a white pi on the chest, bare arms and
// hands, black jeans, odd socks (blue left, yellow right) in sneakers, and no scarf. The same
// head parts (model/head.js) build the face screen's big head.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { PlayerModel } from '../src/player/PlayerModel.js';
import { COLORS } from '../src/player/model/palette.js';
import { buildHeadParts, capSection, GLASSES, SKULL } from '../src/player/model/head.js';
import { buildHatMesh } from '../src/player/model/rig.js';
import { FACE_DESIGN } from '../src/player/model/faceTexture.js';

// Palette names of the colours a geometry's vertices carry.
const tmp = new THREE.Color();
function colorsOf(geometry) {
  const col = geometry.attributes.color.array;
  const names = new Set();
  for (let i = 0; i < col.length; i += 3) {
    const name = Object.keys(COLORS).find((k) => {
      tmp.set(COLORS[k]);
      return Math.abs(tmp.r - col[i]) < 1e-5 && Math.abs(tmp.g - col[i + 1]) < 1e-5 && Math.abs(tmp.b - col[i + 2]) < 1e-5;
    });
    names.add(name ?? 'unknown');
  }
  return names;
}
const boneMesh = (bone) => bone.children.find((o) => o.isMesh);

// The head's parts in head-centre space, as { mesh, color } records (in-game or face screen).
function headParts(hi) {
  const c = new THREE.Group();
  const parts = [];
  buildHeadParts(c, { hi, mesh: (geometry, color) => {
    const mesh = new THREE.Mesh(geometry);
    parts.push({ mesh, color });
    return mesh;
  } });
  c.updateMatrixWorld(true);
  return { parts, cap: c.getObjectByName('hat') };
}

function eachVertex(mesh, f) {
  const v = new THREE.Vector3();
  const pos = mesh.geometry.attributes.position;
  for (let i = 0; i < pos.count; i++) f(v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld));
}

const skullRatio = (v, grow = 0) => Math.hypot(v.x / (SKULL[0] + grow), v.y / (SKULL[1] + grow), v.z / (SKULL[2] + grow));

test('no scarf, and the cap is a plain light blue cap (no letter or emblem, never red)', () => {
  const model = new PlayerModel();
  assert.equal(model.scarf, undefined);
  assert.equal(model.rig.scarfAnchors, undefined);
  let yellowAtNeck = 0;
  const torso = boneMesh(model.rig.torso);
  for (const name of colorsOf(torso.geometry)) if (name === 'sockR') yellowAtNeck++;
  assert.equal(yellowAtNeck, 0, 'nothing yellow round the neck');
  const cap = buildHatMesh(new THREE.MeshLambertMaterial({ vertexColors: true }));
  const names = colorsOf(cap.geometry);
  assert.deepEqual([...names].sort(), ['cap', 'capBill', 'capSeam', 'capUnder'], 'only the cap\'s own blues');
  for (const name of names) {
    const c = new THREE.Color(COLORS[name]);
    assert.ok(c.b > c.r + 0.2 && c.b >= c.g, `${name} is blue`);
  }
  const light = new THREE.Color(COLORS.cap);
  assert.ok(light.r > 0.15 && light.g > 0.4 && light.b > 0.75, 'a light blue');
});

test('the cap covers the top of the head and the hair; tufts stick out under it', () => {
  for (const hi of [false, true]) {
    const { parts, cap } = headParts(hi);
    const toCap = cap.matrixWorld.clone().invert();
    const p = new THREE.Vector3();
    // Everything above the band (but the cap itself) stays inside the crown.
    for (const { mesh, color } of parts) {
      if (mesh.parent === cap) continue;
      eachVertex(mesh, (v) => {
        p.copy(v).applyMatrix4(toCap);
        if (p.y < 1.5) return;
        const s = capSection(p.y);
        const q = s ? Math.hypot(p.x / s.ax, (p.z - s.zc) / s.az) : Infinity;
        assert.ok(q < 1, `${hi ? 'face screen' : 'in game'}: ${color} pokes out of the cap at ${p.toArray().map((x) => x.toFixed(1))}`);
      });
    }
    // Rowdy hair: tufts stick out well past the skull under the cap, at the sides and the nape.
    let sides = 0;
    let nape = 0;
    for (const { mesh, color } of parts) {
      if (color !== 'hair' && color !== 'hairTuft') continue;
      eachVertex(mesh, (v) => {
        if (skullRatio(v, 5) < 1) return;
        if (Math.abs(v.x) > 30) sides++;
        if (v.z < -20 && v.y < -8) nape++;
      });
    }
    assert.ok(sides >= 6 && nape >= 3, `tufts: ${sides} at the sides, ${nape} at the nape`);
  }
});

test('round glasses sit in front of the eyes, clear of the face, following the head', () => {
  // The painted eye centre on the skull (faceTexture.js: longitude from the front, latitude).
  const { W, H, EYE_DX, EYE_Y } = FACE_DESIGN;
  const lon = (EYE_DX / W) * 2 * Math.PI;
  const lat = ((H / 2 - EYE_Y) / H) * Math.PI;
  const eye = new THREE.Vector3(Math.cos(lat) * Math.sin(lon), Math.sin(lat), Math.cos(lat) * Math.cos(lon));
  eye.divideScalar(Math.hypot(eye.x / SKULL[0], eye.y / SKULL[1], eye.z / SKULL[2]));
  assert.ok(Math.hypot(GLASSES.x - eye.x, GLASSES.y - eye.y) < 1.5, 'each ring centred on its eye');
  assert.ok(GLASSES.z > eye.z + 1, 'in front of the eye');
  assert.ok(GLASSES.r > 7.5 && GLASSES.tube < 1, 'round enough to frame the big eyes, thin frames');
  for (const hi of [false, true]) {
    const { parts } = headParts(hi);
    const glasses = parts.filter((p) => p.color === 'glasses');
    assert.ok(glasses.length >= 4, 'two rings, a bridge and temples');
    let front = 0;
    for (const { mesh } of glasses) {
      eachVertex(mesh, (v) => {
        assert.ok(skullRatio(v) > 1.005, `a frame inside the face at ${v.toArray().map((x) => x.toFixed(1))}`);
        if (v.z > 28) front++;
      });
      // On the head (they follow it): a child of the head-centre group, like the nose.
      assert.equal(mesh.parent, parts[0].mesh.parent);
    }
    assert.ok(front > 20, 'mostly in front of the face');
  }
  // In game they ride on the head bone.
  const model = new PlayerModel();
  assert.ok(colorsOf(boneMesh(model.rig.head).geometry).has('glasses'));
});

test('the outfit: red pi t-shirt, bare arms, white gloves, black jeans, odd socks in sneakers', () => {
  const model = new PlayerModel();
  model.update({ pos: { x: 0, y: 0, z: 0 }, anim: 'idle', animTime: 0.5, floorY: 0 }, 1 / 60);
  const { rig } = model;
  const torso = boneMesh(rig.torso).geometry;
  assert.ok(colorsOf(torso).has('shirt') && colorsOf(boneMesh(rig.hips).geometry).has('shirt'), 'a red t-shirt');
  const red = new THREE.Color(COLORS.shirt);
  assert.ok(red.r > 0.5 && red.g < 0.1 && red.b < 0.1);
  // The pi: white vertices on the front of the chest, a sign ~20 units across.
  const col = torso.attributes.color.array;
  const pos = torso.attributes.position.array;
  const white = new THREE.Color(COLORS.pi);
  const box = new THREE.Box3();
  for (let i = 0; i < col.length; i += 3) {
    if (Math.abs(col[i] - white.r) > 1e-5 || Math.abs(col[i + 2] - white.b) > 1e-5) continue;
    box.expandByPoint(new THREE.Vector3(pos[i], pos[i + 1], pos[i + 2]));
  }
  const size = box.getSize(new THREE.Vector3());
  assert.ok(size.x > 16 && size.x < 26 && size.y > 10 && size.y < 20, `pi ${size.x.toFixed(1)} x ${size.y.toFixed(1)}`);
  assert.ok(box.min.z > 9 && box.max.z > 15 && Math.abs(box.min.x + box.max.x) < 4, 'on the front of the chest');
  // Short sleeves: bare forearms (skin below the elbow), and white cartoon gloves on the hands.
  for (const s of ['L', 'R']) {
    assert.deepEqual([...colorsOf(boneMesh(rig[`arm${s}`].elbow).geometry)], ['skin'], `${s} forearm`);
    assert.deepEqual([...colorsOf(boneMesh(rig[`arm${s}`].wrist).geometry)], ['glove'], `${s} gloved hand`);
    assert.ok(colorsOf(boneMesh(rig[`arm${s}`].shoulder).geometry).has('shirt'), `${s} sleeve`);
    assert.deepEqual([...colorsOf(boneMesh(rig[`leg${s}`].thigh).geometry)], ['jeans'], `${s} thigh`);
  }
  const jeans = new THREE.Color(COLORS.jeans);
  assert.ok(jeans.r + jeans.g + jeans.b < 0.2, 'black jeans');
  // Odd socks: blue on the left foot, yellow on the right, in white sneakers.
  const left = colorsOf(boneMesh(rig.legL.boot).geometry);
  const right = colorsOf(boneMesh(rig.legR.boot).geometry);
  assert.ok(left.has('sockL') && !left.has('sockR') && right.has('sockR') && !right.has('sockL'));
  for (const b of [left, right]) assert.ok(b.has('shoe') && b.has('sole'));
  const blue = new THREE.Color(COLORS.sockL);
  const yellow = new THREE.Color(COLORS.sockR);
  assert.ok(blue.b > blue.r + 0.3 && blue.b > blue.g + 0.3, 'a blue sock');
  assert.ok(yellow.r > yellow.b + 0.4 && yellow.g > yellow.b + 0.4, 'a yellow sock');
});
