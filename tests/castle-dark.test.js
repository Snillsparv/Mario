// AI RACE mode on the castle: every material is graded (dark grey stone, dark crimson roofs),
// the window panes carry the glow attribute and glow, the flags tear, the circuit cables sit
// on the round towers' faces clear of their windows and only show while the mode does, and
// setDarkness never touches the building's geometry.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import * as L from '../src/world/layout.js';
import { buildCastle, DARK_GRADES } from '../src/world/castle.js';

const part = buildCastle(L);
const meshes = [];
part.object3D.traverse((o) => o.isMesh && meshes.push(o));
const byName = (n) => meshes.find((m) => m.name === n);
const basicShader = () => ({ vertexShader: THREE.ShaderLib.basic.vertexShader, fragmentShader: THREE.ShaderLib.basic.fragmentShader, uniforms: {} });

function graded(rgb, { sat, mul, add = [0, 0, 0] }) {
  const l = 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2];
  return rgb.map((c, i) => (l + (c - l) * sat) * mul[i] + add[i]);
}

test('every castle material is graded; stone goes dark grey, roofs dark crimson', () => {
  for (const n of ['wall', 'trim', 'roof', 'wood', 'glass', 'flags']) {
    const m = byName(`castle-${n}`);
    assert.ok(m?.material.userData.darkGrade, `castle-${n} graded`);
    const s = basicShader();
    m.material.onBeforeCompile(s);
    assert.match(s.fragmentShader, /uniform float darkT;/);
  }
  const cream = [0.83, 0.72, 0.51];
  const wall = graded(cream, DARK_GRADES.wall);
  assert.ok(Math.max(...wall) < 0.12 && Math.max(...wall) - Math.min(...wall) < 0.03, `wall ${wall}`);
  const roof = graded([0.55, 0.05, 0.05], DARK_GRADES.roof);
  assert.ok(roof[0] > 3 * roof[1] && roof[0] < 0.2, `roof ${roof}`);
  // The flags turn to black rags.
  const s = basicShader();
  byName('castle-flags').material.onBeforeCompile(s);
  assert.match(s.fragmentShader, /Ragged cloth/);
  const flag = graded([0.9, 0.2, 0.2], DARK_GRADES.flags);
  assert.ok(Math.max(...flag) < 0.05);
});

test('window panes carry the glow attribute; the trim shader lights them', () => {
  for (const n of ['wall', 'trim', 'roof', 'wood', 'glass']) {
    const g = byName(`castle-${n}`).geometry;
    assert.ok(g.attributes.darkGlow, `castle-${n} has the attribute`);
    assert.equal(g.attributes.darkGlow.count, g.attributes.position.count);
  }
  const trim = byName('castle-trim').geometry;
  const glow = trim.attributes.darkGlow;
  const col = trim.attributes.color;
  let lit = 0;
  for (let i = 0; i < glow.count; i++) {
    if (glow.getX(i) <= 0) continue;
    lit++;
    assert.ok(glow.getX(i) <= 1);
    // A dark pane (the recess tint), never the pale stone around it.
    assert.ok(col.getX(i) < 0.3 && col.getZ(i) < 0.4, `glowing vertex ${i} is a pane`);
  }
  assert.ok(lit >= 3 * 60, `${lit / 3} glowing triangles`);
  const s = basicShader();
  byName('castle-trim').material.onBeforeCompile(s);
  assert.match(s.vertexShader, /attribute float darkGlow;/);
  assert.match(s.fragmentShader, /darkGlowColor \* pulse/);
});

test('circuit cables: on the towers, clear of the windows, shown only in the mode', () => {
  const mesh = byName('castle-circuits');
  assert.ok(mesh);
  // Drawn (transparent) with the first frame so its shader compiles with the level's.
  assert.equal(mesh.visible, true);
  assert.equal(mesh.frustumCulled, false);
  part.setDarkness(0);
  mesh.onAfterRender();
  assert.equal(mesh.frustumCulled, true);
  assert.equal(mesh.visible, false);
  part.setDarkness(0.2);
  assert.equal(mesh.visible, false, 'the walls darken first');
  part.setDarkness(0.7);
  assert.equal(mesh.visible, true);
  part.setDarkness(1);
  const pos = mesh.geometry.attributes.position;
  assert.ok(pos.count > 200);
  // Every vertex lies just off a round tower's surface (between its inscribed and outer
  // radius, plus the lift), between the tower's foot and top, and away from the other
  // castle meshes' window panes.
  const C = L.CASTLE;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    assert.ok(y > C.baseY && y < C.keepTopY, 'within the castle height');
    assert.ok(Math.abs(x - C.x) < C.halfWidth + 60 && z < C.frontZ + 300 && z > C.backZ - 400, 'on the castle');
  }
  // Nothing on a pane: no cable vertex within a few units of a glowing trim vertex.
  const trim = byName('castle-trim').geometry;
  const tp = trim.attributes.position;
  const tg = trim.attributes.darkGlow;
  const panes = [];
  for (let i = 0; i < tg.count; i++) if (tg.getX(i) > 0) panes.push([tp.getX(i), tp.getY(i), tp.getZ(i)]);
  let close = 0;
  for (let i = 0; i < pos.count; i += 7) {
    for (const p of panes) if (Math.hypot(pos.getX(i) - p[0], pos.getY(i) - p[1], pos.getZ(i) - p[2]) < 30) close++;
  }
  assert.equal(close, 0, 'cables stay clear of the windows');
  const s = basicShader();
  mesh.material.onBeforeCompile(s);
  assert.match(s.fragmentShader, /diffuseColor\.a \*= circuitT;/);
  part.setDarkness(0);
  assert.equal(mesh.visible, false);
});

test('setDarkness and the storm clock never touch the building geometry', () => {
  const still = meshes.filter((m) => m.name !== 'castle-flags');
  const snap = () => still.map((m) => Object.values(m.geometry.attributes).map((a) => a.array.slice()));
  const before = snap();
  for (let k = 0; k <= 30; k++) {
    part.setDarkness(k / 30);
    part.update(k / 30);
  }
  assert.deepEqual(snap(), before);
  // The rose window pulses in the storm (uniforms), and settles back when it ends.
  const glass = byName('castle-glass').material.userData.darkGrade;
  part.update(1.1);
  const a = glass.darkMul.value.x;
  part.update(2.0);
  assert.notEqual(glass.darkMul.value.x, a);
  part.setDarkness(0);
});
