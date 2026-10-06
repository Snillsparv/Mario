// The R fixes in Sparrow Lane (the dad's round): the kerbs along the road's edge clipped exactly
// (plan.js kerbRuns: no stub of kerb into the road where two pieces meet, no gap at a corner,
// none at the drives: the asphalt runs up into them), the straight running on into the turning
// area (no lawn left between them and the dad's drive), the dad's corner bed (the photo's: round
// field stones right at the asphalt's edge, no kerb there, the red-leaf tree in it, walked onto
// from the road), the turning area's sign at its corner in both looks (its face as sign.js lays
// it out: yellow, a red rim, "Vänd-" over "plats", the no-parking sign; its post solid; its
// stroke font the only lettering in the street, exactly the letters of its two words), and every
// lamppost a climbable pole whose arm leaves the post under its cap (nothing drawn where he
// stands on it).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import * as THREE from 'three';
import * as lane from '../src/world/lane/layout.js';
import { buildArea } from '../src/world/area.js';
import { AREA_DEFS } from '../src/world/areas.js';
import { buildLane } from '../src/world/lane/build.js';
import { buildLaneDetail } from '../src/world/lane/real/detail.js';
import { kerbRuns, roadPieces, inside, bedStones } from '../src/world/lane/real/plan.js';
import { SIGN_TEXT, GLYPHS, signFace } from '../src/world/lane/real/sign.js';

const O = AREA_DEFS.lane.origin;
const area = buildArea(new THREE.Scene(), AREA_DEFS.lane);
const col = area.collision;
const classic = buildLane(lane);
const high = buildLaneDetail(lane, 'high');
const { GROUND, BED, TURN_SIGN: S, LAMP } = lane;
const positions = (name) => classic.object3D.getObjectByName(name).geometry.attributes.position;
const floorAt = (x, z, y = 400) => col.findFloor(x + O.x, y + O.y, z + O.z);

test('the kerbs: exactly where the road meets the lawn or the pavement (never inside another piece of road, no stub across it), closed at every corner, none at the drives, none along the dad\'s corner bed', () => {
  for (const round of [false, true]) {
    const road = roadPieces(lane, { round });
    const runs = kerbRuns(lane, road);
    const label = round ? 'drawn round' : 'the colliders\' 16-gon';
    // Never inside another piece: its middle and both ends, a hair out from the edge.
    for (const { p, q, n } of runs) {
      for (const t of [0.02, 0.5, 0.98]) {
        const [x, z] = [p[0] + (q[0] - p[0]) * t + n[0] * 2, p[1] + (q[1] - p[1]) * t + n[1] * 2];
        assert.ok(!road.some((o) => inside(o, x, z)), `${label}: a kerb at ${x.toFixed(0)}, ${z.toFixed(0)} runs inside the road`);
      }
    }
    // Closed: every run's end meets another run's (a corner or the next run along), no gap.
    const ends = runs.flatMap((r) => [r.p, r.q]);
    for (const e of ends) {
      const met = ends.filter((f) => Math.hypot(f[0] - e[0], f[1] - e[1]) < 4).length;
      assert.ok(met >= 2, `${label}: a kerb's end alone at ${e[0].toFixed(0)}, ${e[1].toFixed(0)}`);
    }
    // No kerb across the straight's end (the old stub: the edge where the straight met the
    // turning area, with lawn between them).
    const end = lane.ROAD.line[lane.ROAD.line.length - 1][0];
    assert.ok(!runs.some((r) => Math.abs(r.p[0] - end) < 1 && Math.abs(r.q[0] - end) < 1), `${label}: no kerb across the straight's end`);
    // The dad's drive's mouth: no kerb, the asphalt runs up into it; along the bed, no kerb.
    const along = (kind, x0, x1) => runs.filter((r) => r.kind === kind && Math.abs(r.p[1] - lane.ROAD.half) < 1 && Math.abs(r.q[1] - lane.ROAD.half) < 1).reduce((s, r) => s + Math.max(0, Math.min(x1, Math.max(r.p[0], r.q[0])) - Math.max(x0, Math.min(r.p[0], r.q[0]))), 0);
    const D = lane.DAD_DRIVE;
    assert.ok(Math.abs(along('drop', D.x0, D.x1) - (D.x1 - D.x0)) < 1, `${label}: the drive's mouth all dropped`);
    assert.ok(Math.abs(along('bed', BED.x1 - BED.rx, BED.x1) - BED.rx) < 1, `${label}: the bed's street edge, no kerb`);
    assert.equal(along('kerb', BED.x1 - BED.rx + 1, D.x1 - 1), 0, `${label}: no granite kerb from the bed to the drive's east edge`);
  }
});

test('the straight runs on into the turning area: asphalt and a floor at 0 where the old lawn notch was, between it and the dad\'s drive', () => {
  for (const [x, z] of [[2450, 300], [2520, 420], [2580, 440], [2420, 100]]) {
    assert.equal(lane.groundHeight(x, z), 0, `the road at ${x}, ${z}`);
    assert.ok(roadPieces(lane).some((o) => inside(o, x, z)), `drawn asphalt at ${x}, ${z}`);
    const f = floorAt(x, z, 100);
    assert.ok(f.surface && Math.abs(f.y - O.y) < 0.5, `a floor at 0 at ${x}, ${z} (${(f.y - O.y).toFixed(1)})`);
  }
  // And the lawn east of the drive still a step up behind its kerb.
  const f = floorAt(2560, 520, 100);
  assert.ok(Math.abs(f.y - O.y - GROUND) < 0.5, `the neighbour's lawn at ${GROUND}`);
});

test('the dad\'s corner bed: at the corner where his drive meets the street, a little over the lawn (walked onto from the road), its field stones close set along both asphalt edges in both looks, the red-leaf tree in it', () => {
  assert.ok(lane.inBed(BED.x1 - 5, BED.z0 + 5) && lane.inBed(lane.RED_TREE.x, lane.RED_TREE.z));
  assert.ok(!lane.inBed(BED.x1 + 5, BED.z0 + 100) && !lane.inBed(BED.x1 - 100, BED.z0 - 5), 'not on the drive or the street');
  // Its floor: the bed's top, under the knee from the road.
  for (const [x, z] of [[BED.x1 - 60, BED.z0 + 60], [lane.RED_TREE.x + 100, lane.RED_TREE.z], [BED.x1 - BED.rx + 80, BED.z0 + 40]]) {
    const f = floorAt(x, z);
    assert.ok(Math.abs(f.y - O.y - (GROUND + BED.raise)) < 0.5, `the bed's top at ${x}, ${z}: ${(f.y - O.y).toFixed(1)}`);
  }
  assert.ok(GROUND + BED.raise < 30, 'a step from the road under his knee');
  // The stones: along the street's edge on the road, along the drive's on the drive, round the lawn.
  const stones = bedStones(lane);
  const street = stones.filter((s) => s.z < BED.z0 + 30 && s.y < 0);
  const drive = stones.filter((s) => s.x > BED.x1 - 30 && s.y > 0);
  assert.ok(street.length >= 14 && drive.length >= 10 && stones.length - street.length - drive.length >= 10, `${street.length} along the street, ${drive.length} along the drive, ${stones.length} in all`);
  // (Close set: each next to the one before, a hand's gap at most between them.)
  for (const row of [street.map((s) => [s.x, s.s]).sort((a, b) => a[0] - b[0]), drive.map((s) => [s.z, s.s]).sort((a, b) => a[0] - b[0])]) {
    for (let i = 1; i < row.length; i++) assert.ok(row[i][0] - row[i - 1][0] < 1.7 * Math.max(row[i][1], row[i - 1][1]) + 13, `close set (${(row[i][0] - row[i - 1][0]).toFixed(0)} apart)`);
  }
  // The classic look's stones are where they are (lane-blocks: their lathes' feet).
  const b = positions('lane-blocks');
  for (const s of street.slice(0, 5)) {
    let near = false;
    for (let i = 0; i < b.count && !near; i++) near = Math.hypot(b.getX(i) - s.x, b.getZ(i) - s.z) < s.s * 1.2 && Math.abs(b.getY(i) - s.y) < s.s * 1.2;
    assert.ok(near, `a classic stone at ${s.x.toFixed(0)}, ${s.z.toFixed(0)}`);
  }
});

test('the turning area\'s sign: "Vänd-" over "plats" in black on a yellow plate with a red rim, the no-parking sign under them (a blue disc in a red ring, one red stripe from its upper left to its lower right); its stroke font only the letters of those words', () => {
  assert.deepEqual(SIGN_TEXT, ['Vänd-', 'plats']);
  // (The narrow allowance: the font can letter nothing but these two words.)
  assert.deepEqual(Object.keys(GLYPHS).sort(), [...new Set(SIGN_TEXT.join(''))].sort());
  const { w, h } = S.plate;
  const face = signFace(S.plate);
  const of = (color) => face.filter((p) => p.color === color);
  const bounds = (pieces) => {
    const pts = pieces.flatMap((p) => p.poly);
    return [Math.min(...pts.map((q) => q[0])), Math.max(...pts.map((q) => q[0])), Math.min(...pts.map((q) => q[1])), Math.max(...pts.map((q) => q[1]))];
  };
  for (const p of face) for (const [u, v] of p.poly) assert.ok(u >= -0.01 && u <= w + 0.01 && v >= -0.01 && v <= h + 0.01, 'on the plate');
  const [rim, field] = [face.find((p) => p.layer === 0), face.find((p) => p.layer === 1)];
  assert.equal(rim.color, 0xc8302a);
  assert.equal(field.color, 0xf2c31c);
  // The lettering over the upper half, two lines; the disc under it.
  const black = of(0x161616);
  const [, , lo, hi] = bounds(black);
  assert.ok(lo > h * 0.5 && hi < h, `the words from ${lo.toFixed(0)} to ${hi.toFixed(0)}`);
  const [u0, u1] = bounds(black);
  assert.ok(u1 - u0 > w * 0.6 && u1 - u0 < w * 0.9, 'across most of the plate');
  const blue = face.find((p) => p.color === 0x1d4f9c);
  const [bu0, bu1, bv0, bv1] = bounds([blue]);
  assert.ok(bv1 < lo && bv0 > 0 && Math.abs((bu0 + bu1) / 2 - w / 2) < 0.5, 'the disc under the words, centred');
  const ring = face.find((p) => p.color === 0xc8302a && p.layer === 2);
  const [ru0, ru1] = bounds([ring]);
  assert.ok(ru1 - ru0 > bu1 - bu0, 'its red ring round it');
  const stripe = face.find((p) => p.color === 0xc8302a && p.layer === 4);
  const [a, b] = [stripe.poly[0], stripe.poly[1]];
  assert.ok(a[0] < b[0] && a[1] > b[1], 'the stripe from its upper left to its lower right');
});

test('the sign in both looks: at the bed\'s corner by the asphalt, facing the street\'s way in, its plate drawn in both (the classic look\'s paint, the realistic one\'s enamel), its post solid', () => {
  assert.ok(lane.inBed(S.x, S.z) && Math.hypot(S.x - BED.x1, S.z - BED.z0) < 100, 'in the bed at its corner');
  assert.ok(Math.abs(Math.sin(S.yaw) + 1) < 1e-9, 'facing west, the street\'s way in');
  // Its plate's yellow in each look, where the plate stands.
  const yellow = (pos, color) => {
    let n = 0;
    for (let i = 0; i < pos.length / 3; i++) {
      const [x, y, z] = [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]];
      if (Math.abs(x - S.x) < 12 && Math.abs(z - S.z) < S.plate.w / 2 + 1 && y > S.plate.y0 && y < S.plate.y0 + S.plate.h && color(i)) n++;
    }
    return n;
  };
  const r = classic.object3D.getObjectByName('lane-render').geometry.attributes;
  assert.ok(yellow(r.position.array, (i) => r.color.getX(i) > 2 * r.color.getZ(i) && r.color.getY(i) > 2 * r.color.getZ(i)) >= 6, 'the classic plate');
  const e = high.meshes.find((m) => m.name === 'enamel').buffers;
  assert.ok(yellow(e.position, (i) => e.color[i * 3] > 3 * e.color[i * 3 + 2] && e.color[i * 3 + 1] > 2 * e.color[i * 3 + 2]) >= 6, 'the realistic plate');
  // Solid: a thin post he cannot walk through, and no pole (the plate is in the way of a climb).
  const hit = col.raycast({ x: S.x - 200 + O.x, y: GROUND + 80 + O.y, z: S.z + O.z }, { x: 1, y: 0, z: 0 }, 400, { floors: false, ceilings: false });
  assert.ok(hit && Math.abs(hit.point.x - O.x - (S.x - S.collider)) < 3, `the post solid (${hit?.point.x.toFixed(0)})`);
  assert.ok(!lane.POLES.some((p) => Math.hypot(p.x - S.x, p.z - S.z) < 50), 'not a pole');
  // The robot keeps off the bed and clear of the post (its feet's reach and a margin).
  for (const [x0, x1, z0, z1] of lane.LANE_BOSS.walk) {
    const cx = Math.max(x0, Math.min(x1, S.x));
    const cz = Math.max(z0, Math.min(z1, S.z));
    assert.ok(Math.hypot(cx - S.x, cz - S.z) > 135, `the robot's ground ${[x0, x1, z0, z1]} clear of the post`);
  }
});

test('the privacy rules\' narrow allowance: the street\'s only lettering is the sign\'s, drawn from its stroke font by the two builders of the sign alone; no canvas text anywhere in the lane', () => {
  const files = [];
  const walk = (dir) => {
    for (const f of readdirSync(dir)) {
      const p = new URL(f, dir);
      if (statSync(p).isDirectory()) walk(new URL(`${f}/`, dir));
      else if (f.endsWith('.js')) files.push(p);
    }
  };
  walk(new URL('../src/world/lane/', import.meta.url));
  const users = files.filter((f) => /\bsignFace\b|\bGLYPHS\b|\bSIGN_TEXT\b/.test(readFileSync(f, 'utf8'))).map((f) => f.pathname.split('/src/world/lane/')[1]).sort();
  assert.deepEqual(users, ['props.js', 'real/garden.js', 'real/sign.js']);
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    assert.ok(!/fillText|strokeText|measureText|font\s*=/.test(src), `${f.pathname}: no canvas text`);
  }
  // (The sign's word is a traffic sign's own, no street's name.)
  assert.ok(!/[A-ZÅÄÖ][a-zåäö]+(vägen|gatan|stigen|gränd|backen|allén|torget|vagen)\b/.test(SIGN_TEXT.join('')));
});

test('every lamppost a climbable pole up to its cap; its arm leaves the post under the cap: nothing drawn over the cap where he stands, in either look', () => {
  for (const l of lane.LAMPS) {
    const pole = lane.POLES.find((p) => p.x === l.x && p.z === l.z);
    assert.ok(pole && pole.y1 === LAMP.top && pole.y0 === GROUND, `${l.id}: a pole up to its cap`);
    assert.ok(Number.isFinite(pole.camYaw), `${l.id}: a side of its own`);
    // (His side across the arm: he climbs past its root on his own side of the post.)
    const off = Math.abs(Math.atan2(Math.sin(pole.camYaw - l.yaw), Math.cos(pole.camYaw - l.yaw)));
    if (!['L1', 'L6'].includes(l.id)) assert.ok(off > 1.2, `${l.id}: his side ${off.toFixed(2)} off the arm`);
  }
  const over = (pos) => {
    let n = 0;
    for (let i = 0; i < pos.length / 3; i++) {
      const [x, y, z] = [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]];
      if (y > LAMP.top + 1 && y < LAMP.top + 220 && lane.LAMPS.some((l) => Math.hypot(x - l.x, z - l.z) < 45)) n++;
    }
    return n;
  };
  assert.equal(over(positions('lane-render').array), 0, 'the classic look');
  for (const m of high.meshes) assert.equal(over(m.buffers.position), 0, `the realistic look's ${m.name}`);
});
