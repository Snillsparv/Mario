// The mystery box (layout.MYSTERY_BOX) and the winged hat inside it.
//
// The box: a floating cube of translucent blue crystal (edge = spot.size) in a brass frame,
// with a glowing white-gold "?" on each side face, bobbing gently; `spot.y` is the height of
// its underside above the ground. A collider (walls, a floor on top, a ceiling below) so Pip's
// head stops at its underside and he can stand on it; it moves with the box's bob and jolt (the
// surfaces are shifted in place, like the AI RACE button's cap), one tick ahead of the picture:
// the physics step that uses it is the one drawn at that pose, so Pip standing on top rides the
// box exactly and a head bump meets the visible underside. When Pip bumps it from below while
// rising (his head within BUMP_REACH of the underside, his feet axis over its footprint) or an
// attack of his (player.getAttack()) overlaps it, the box jolts (up; down when he pounds or
// kicks it from on top), flashes, emits sfx 'box_hit' and releases the hat. The underside is
// spot.y (340) up, out of reach of a punch or kick from the ground by design (the classic way
// in is a jump into it from below); the attacks that reach it are the jump kick near the top of
// a jump, a dive or flight into it, and a ground pound on its top.
// The hat pops out of the top and hovers above the box, spinning, then glides down beside it
// (the side toward the camera, so it stays in view) to hover at chest height, where Pip can
// walk into it (above the box it could only be reached with a triple jump). Touching it calls
// player.giveWingHat(HAT_SECONDS) (the player plays 'powerup'). The empty box shows dim and
// without its "?"; RESPAWN_TICKS after the hat was taken it lights up again and can be hit
// once more.
//
//   new MysteryBox({ spot, collision, events, sparkles, shadows, shadowSlots: [box, hat],
//                    groundAt, buildHat? })
//     buildHat() -> Object3D: the hat model; default: the hero model's buildWingedHat()
//     (src/player/model/wings.js: Pip's own hat and wings, flapped via userData.flap), or the
//     stand-in from wingedHat.js if that is missing
//   update(player, hero, tick, cameraYaw?)  30 Hz; hero = { y, vy, air } of the previous tick
//                                (ObjectManager); the hat glides toward the camera (cameraYaw + PI)
//                                or, without one, back the way Pip came (faceYaw + PI)
//   animate(alpha, clock)        render
//   setDarkness(t)               the frame dims with the storm, the crystal keeps glowing
//   reset()                      lit, hat inside
//
// Draw calls: frame, crystal back faces, crystal front faces; the hat (3) only while it is out.
// No allocation per tick or frame beyond event payloads (moving the collider writes the 12
// surfaces' fields in place).

import * as THREE from 'three';
import { PLAYER_HEIGHT, PLAYER_RADIUS, FRAME_DT } from '../core/constants.js';
import { bakeLighting } from '../render/materials.js';
import { tri } from './AiButton.js';
import { makeCrystalTexture, CRYSTAL_CELLS } from './boxTextures.js';
import { buildPlaceholderWingedHat, flapWings } from './wingedHat.js';
import * as heroWings from '../player/model/wings.js';
import { TINT } from './Sparkles.js';
import { shadowSize } from './BlobShadows.js';

export const BOX = {
  BOB: 5, // bob amplitude (units) ...
  BOB_RATE: 1.7, // ... and speed (radians per second)
  BUMP_REACH: 25, // head this close below the underside (or touching it) bumps it
  BUMP_MARGIN: 30, // the feet axis may be this far outside the footprint (the head is round)
  JOLT: 30, // how far it jumps up when hit
  POUND_JOLT: -16, // ... or dips when hit from on top
  JOLT_TICKS: 9,
  FLASH_TICKS: 12,
  RESPAWN_TICKS: 900, // 30 s after the hat was taken
  TWINKLE_EVERY: 14,
  FRAME: 11, // brass bar thickness
  HAT_SECONDS: 40,
  HAT_POP_TICKS: 16, // out of the top ...
  HAT_ABOVE: 95, // ... to this far above the box top
  HAT_HOLD_TICKS: 24, // hovering above the box
  HAT_GLIDE_TICKS: 50, // then gliding down beside it ...
  HAT_OUT: 240, // ... this far from the box centre ...
  HAT_HEIGHT: 105, // ... to hover this high over the floor (Pip's chest)
  HAT_RADIUS: 55, // pickup: hat radius (plus Pip's)
  HAT_LOW: -30, // pickup window relative to the feet
  HAT_HIGH: PLAYER_HEIGHT + 40,
  HERO_HAT_SCALE: 1.2, // the hero model's hat (as Pip wears it) a little bigger as a pickup
};

const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const smooth = (u) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));

export class MysteryBox {
  constructor({ spot, collision, events, sparkles, shadows, shadowSlots = null, groundAt, buildHat = null }) {
    this.x = spot.x;
    this.z = spot.z;
    this.size = spot.size ?? 130;
    this.half = this.size / 2;
    this.collision = collision;
    this.events = events;
    this.sparkles = sparkles;
    this.shadows = shadows;
    this.shadowSlots = shadowSlots;
    // The floor at the ground there (not whatever is highest: another box's top in a shared
    // test world, a canopy).
    const g = groundAt(this.x, this.z);
    const f = collision.findFloor(this.x, Number.isFinite(g) ? g + 100 : 1e5, this.z);
    this.groundY = f.surface ? f.y : g;
    this.groundNormal = f.surface ? { ...f.surface.normal } : { x: 0, y: 1, z: 0 };
    this.bottomY = this.groundY + (spot.y ?? 340);
    this.topY = this.bottomY + this.size;
    this.centerY = this.bottomY + this.half;
    this.pos = { x: this.x, y: this.centerY, z: this.z }; // sfx position

    this.state = 'ready'; // 'ready' | 'empty' (hat out) | 'recharging' (hat taken)
    this.timer = 0;
    this.hits = 0;
    this.tick = 0;
    this.jolt = BOX.JOLT_TICKS; // ticks since the last hit (JOLT_TICKS: at rest)
    this.offset = 0; // jolt offset (units) this tick / the previous one
    this.prevOffset = 0;
    this.joltSize = BOX.JOLT; // BOX.JOLT from below or the side, BOX.POUND_JOLT from on top
    this.lift = 0; // where the collider stands now (bob + jolt), relative to the rest pose
    this.flash = 0;
    this.darkT = 0;

    // The hat: 'inside' | 'pop' | 'hold' | 'glide' | 'hover'.
    this.hat = { state: 'inside', t: 0, x: this.x, y: this.centerY, z: this.z, px: this.x, py: this.centerY, pz: this.z, fromX: 0, fromY: 0, fromZ: 0, toX: 0, toY: 0, toZ: 0, floorY: 0, floorN: null };

    this.mesh = new THREE.Group();
    this.mesh.name = 'mysteryBox';
    this._buildBox();
    this.hatMesh = (buildHat ?? heroWings.buildWingedHat ?? buildPlaceholderWingedHat)();
    this.hatMesh.visible = false;
    this.hatScale = buildHat || !heroWings.buildWingedHat ? 1 : BOX.HERO_HAT_SCALE;
    this.mesh.add(this.hatMesh);
    this._surfaces = this._addCollider();
    // Rest heights of the collider's vertices (a, b, c per surface).
    this._restY = new Float64Array(this._surfaces.length * 3);
    for (let i = 0; i < this._surfaces.length; i++) {
      const f = this._surfaces[i];
      this._restY[i * 3] = f.a[1];
      this._restY[i * 3 + 1] = f.b[1];
      this._restY[i * 3 + 2] = f.c[1];
    }
    this._setLift(this._liftAt(1, BOX.JOLT_TICKS)); // the first tick's pose (see update)
    if (shadows && shadowSlots) {
      const n = this.groundNormal;
      shadows.place(shadowSlots[0], this.x, this.groundY, this.z, n, shadowSize(this.size * 1.25, this.bottomY - this.groundY));
    }
  }

  get hatOut() {
    return this.hat.state !== 'inside';
  }

  _buildBox() {
    const s = this.size;
    const h = this.half;
    const T = BOX.FRAME;
    // Crystal: a cube just inside the frame bars; side faces show the "?" cell, top and bottom
    // the plain cell. Back faces (drawn first) are a deeper blue with no glyph, so the "?" on
    // the far side never shows mirrored through the near one.
    const geo = new THREE.BoxGeometry(s - T * 0.6, s - T * 0.6, s - T * 0.6);
    const uv = geo.attributes.uv;
    for (let face = 0; face < 6; face++) {
      const cell = face === 2 || face === 3 ? CRYSTAL_CELLS.cap : CRYSTAL_CELLS.side;
      for (let k = 0; k < 4; k++) {
        const i = face * 4 + k;
        uv.setX(i, cell[0] + uv.getX(i) * (cell[1] - cell[0]));
      }
    }
    this.textures = { full: makeCrystalTexture('full'), empty: makeCrystalTexture('empty') };
    this.frontMat = new THREE.MeshBasicMaterial({ map: this.textures.full, transparent: true, depthWrite: false, side: THREE.FrontSide });
    this.backMat = new THREE.MeshBasicMaterial({ map: makeCrystalTexture('back'), transparent: true, depthWrite: false, side: THREE.BackSide });
    this.crystalBack = new THREE.Mesh(geo, this.backMat);
    this.crystalBack.name = 'mysteryBoxBack';
    this.crystalBack.renderOrder = 2;
    this.crystal = new THREE.Mesh(geo, this.frontMat);
    this.crystal.name = 'mysteryBoxCrystal';
    this.crystal.renderOrder = 3;

    // Brass frame: twelve bars along the edges, with chamfered corner blocks where they meet.
    const parts = [];
    const bar = (sx, sy, sz, x, y, z) => parts.push(new THREE.BoxGeometry(sx, sy, sz).translate(x, y, z).toNonIndexed());
    const L = s - T;
    for (const a of [-h + T / 2, h - T / 2]) {
      for (const b of [-h + T / 2, h - T / 2]) {
        bar(L, T, T, 0, a, b); // along x
        bar(T, L, T, a, 0, b); // along y
        bar(T, T, L, a, b, 0); // along z
      }
    }
    // Corner joints: small blocks with their edges bevelled off (a cube cut by an octahedron).
    const C = T * 1.5;
    const corner = new THREE.BoxGeometry(C, C, C).toNonIndexed();
    const cp = corner.attributes.position;
    for (let i = 0; i < cp.count; i++) cp.setXYZ(i, cp.getX(i) * 0.999, cp.getY(i), cp.getZ(i));
    for (const cx of [-1, 1]) {
      for (const cy of [-1, 1]) {
        for (const cz of [-1, 1]) {
          const inset = h - T * 0.4;
          parts.push(corner.clone().translate(cx * inset, cy * inset, cz * inset));
          parts.push(new THREE.OctahedronGeometry(C * 0.82, 0).translate(cx * inset, cy * inset, cz * inset));
        }
      }
    }
    corner.dispose();
    const n = parts.reduce((k, g) => k + g.attributes.position.count, 0);
    const pos = new Float32Array(n * 3);
    let o = 0;
    for (const g of parts) {
      pos.set(g.attributes.position.array, o);
      o += g.attributes.position.array.length;
      g.dispose();
    }
    const frameGeo = new THREE.BufferGeometry();
    frameGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    frameGeo.computeVertexNormals();
    // Brass, darker toward the bottom, then sun-baked like the world.
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const y = pos[i * 3 + 1] / s + 0.5;
      const k = 0.62 + 0.38 * y;
      col[i * 3] = 0.9 * k;
      col[i * 3 + 1] = 0.6 * k;
      col[i * 3 + 2] = 0.16 * k;
    }
    frameGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    bakeLighting(frameGeo, { ambient: 0.6, diffuse: 0.55 });
    this.frameMat = new THREE.MeshBasicMaterial({ vertexColors: true });
    this.frame = new THREE.Mesh(frameGeo, this.frameMat);
    this.frame.name = 'mysteryBoxFrame';

    this.boxGroup = new THREE.Group();
    this.boxGroup.position.set(this.x, this.centerY, this.z);
    this.boxGroup.add(this.frame, this.crystalBack, this.crystal);
    this.mesh.add(this.boxGroup);
  }

  // Collider at the rest position: four walls, the top (a floor) and the underside (a ceiling),
  // each wound to face outward. Returns its surfaces (moved by _setLift).
  _addCollider() {
    const col = this.collision;
    if (!col.addTriangles) return [];
    const h = this.half;
    const x0 = this.x - h;
    const x1 = this.x + h;
    const z0 = this.z - h;
    const z1 = this.z + h;
    const y0 = this.bottomY;
    const y1 = this.topY;
    const out = [];
    const quad = (a, b, c, d, nx, ny, nz) => {
      tri(out, a, b, c, nx, ny, nz);
      tri(out, a, c, d, nx, ny, nz);
    };
    quad([x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1], 0, 1, 0);
    quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], 0, -1, 0);
    quad([x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1], 1, 0, 0);
    quad([x0, y0, z0], [x0, y1, z0], [x0, y1, z1], [x0, y0, z1], -1, 0, 0);
    quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], 0, 0, 1);
    quad([x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], 0, 0, -1);
    const list = col.surfaces;
    const first = list ? list.length : 0;
    col.addTriangles(out, { terrain: 'stone' });
    return list ? list.slice(first) : [];
  }

  // Box height offset (bob + jolt) drawn at the end of tick `t` (the render clock t * FRAME_DT,
  // alpha 1), for jolt counter `j` (see update).
  _liftAt(t, j) {
    const bob = BOX.BOB * Math.sin(t * FRAME_DT * BOX.BOB_RATE);
    if (j >= BOX.JOLT_TICKS) return bob;
    const u = j / BOX.JOLT_TICKS;
    return bob + this.joltSize * Math.sin(Math.PI * u) * (1 - 0.5 * u);
  }

  // Moves the collider's surfaces to `lift` above their rest heights (the documented Surface
  // fields a/b/c, d, minY/maxY and, on walls, ys). The grid cells are x/z only, so they stay.
  _setLift(lift) {
    if (lift === this.lift) return;
    this.lift = lift;
    const list = this._surfaces;
    const rest = this._restY;
    for (let i = 0; i < list.length; i++) {
      const f = list[i];
      const ya = rest[i * 3] + lift;
      const yb = rest[i * 3 + 1] + lift;
      const yc = rest[i * 3 + 2] + lift;
      f.a[1] = ya;
      f.b[1] = yb;
      f.c[1] = yc;
      f.minY = ya < yb ? (ya < yc ? ya : yc) : yb < yc ? yb : yc;
      f.maxY = ya > yb ? (ya > yc ? ya : yc) : yb > yc ? yb : yc;
      f.d = -(f.normal.x * f.a[0] + f.normal.y * ya + f.normal.z * f.a[2]);
      const ys = f.ys;
      if (ys) {
        ys[0] = ya;
        ys[1] = yb;
        ys[2] = yc;
      }
    }
  }

  // Would the hero bump the underside this tick? His head is within BUMP_REACH below it (or
  // pressed against it: the physics stops him there and zeroes his vy, hence hero.vy, the
  // previous tick's), he is rising, and his feet axis is over the footprint.
  bumps(player, hero) {
    const p = player.pos;
    const vy = player.vel ? player.vel.y : 0;
    if (!(vy > 0 || (hero && hero.vy > 0))) return false;
    const m = this.half + BOX.BUMP_MARGIN;
    const dx = p.x - this.x;
    const dz = p.z - this.z;
    if (dx > m || dx < -m || dz > m || dz < -m) return false;
    const head = p.y + PLAYER_HEIGHT;
    const bottom = this.bottomY + this.lift;
    return p.y < bottom && head >= bottom - BOX.BUMP_REACH;
  }

  // Does an attack sphere { x, y, z, radius } overlap the box?
  struck(atk) {
    if (!atk) return false;
    const h = this.half;
    let dx = atk.x - this.x;
    let dy = atk.y - (this.centerY + this.lift);
    let dz = atk.z - this.z;
    dx = dx > h ? dx - h : dx < -h ? dx + h : 0;
    dy = dy > h ? dy - h : dy < -h ? dy + h : 0;
    dz = dz > h ? dz - h : dz < -h ? dz + h : 0;
    return dx * dx + dy * dy + dz * dz <= atk.radius * atk.radius;
  }

  update(player, hero, tick, cameraYaw = null) {
    this.tick = tick;
    this.cameraYaw = cameraYaw;
    this.prevOffset = this.offset;
    if (this.jolt < BOX.JOLT_TICKS) {
      this.jolt++;
      const u = this.jolt / BOX.JOLT_TICKS;
      this.offset = u >= 1 ? 0 : this.joltSize * Math.sin(Math.PI * u) * (1 - 0.5 * u);
    }
    if (this.flash > 0) this.flash--;

    if (this.state === 'ready') {
      if (tick % BOX.TWINKLE_EVERY === 0) this.sparkles?.twinkle(this.pos, this.size * 0.7, tick * FRAME_DT, TINT.box);
      if (this.bumps(player, hero) || this.struck(player.getAttack ? player.getAttack() : null)) this._hit(player);
    } else if (this.state === 'recharging') {
      if (--this.timer <= 0) {
        this.state = 'ready';
        this.frontMat.map = this.textures.full;
        this.flash = BOX.FLASH_TICKS;
        this.sparkles?.burst(this.pos, tick * FRAME_DT, TINT.box, 8);
      }
    }
    this._updateHat(player, tick);
    // The collider leads the picture by a tick: the next physics step is drawn at that pose.
    this._setLift(this._liftAt(tick + 1, this.jolt + 1));
  }

  _hit(player) {
    this.state = 'empty';
    this.hits++;
    this.jolt = 0;
    // Pounded or kicked from on top (his feet at its top): it dips under him; else it jumps up.
    const onTop = player.pos && player.pos.y >= this.topY + this.lift - 20;
    this.joltSize = onTop ? BOX.POUND_JOLT : BOX.JOLT;
    this.flash = BOX.FLASH_TICKS;
    this.frontMat.map = this.textures.empty;
    const t0 = this.tick * FRAME_DT;
    this.events.emit('sfx', { name: 'box_hit', pos: { x: this.x, y: this.centerY, z: this.z } });
    this.sparkles?.burst({ x: this.x, y: this.bottomY, z: this.z }, t0, TINT.box, 9);
    this._releaseHat(player);
  }

  // The hat pops out of the top; where it will glide to is chosen now: the side toward the
  // camera (or back the way Pip came), else the next clear side round the box (a floor, no
  // wall, no water there).
  _releaseHat(player) {
    const H = this.hat;
    H.state = 'pop';
    H.t = 0;
    H.x = H.px = this.x;
    H.y = H.py = this.centerY;
    H.z = H.pz = this.z;
    const yaw = (typeof this.cameraYaw === 'number' ? this.cameraYaw : (player.faceYaw ?? 0)) + Math.PI;
    const col = this.collision;
    let best = null;
    for (let k = 0; k < 8 && !best; k++) {
      const a = yaw + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * (Math.PI / 4);
      const x = this.x + Math.sin(a) * BOX.HAT_OUT;
      const z = this.z + Math.cos(a) * BOX.HAT_OUT;
      const f = col.findFloor(x, this.bottomY, z);
      if (!f.surface || f.y < this.groundY - 150) continue;
      const water = col.waterLevelAt ? col.waterLevelAt(x, z) : -Infinity;
      if (water > f.y) continue;
      const w = col.findWalls(x, f.y, z, BOX.HAT_HEIGHT, BOX.HAT_RADIUS);
      if (w.walls.length) continue;
      best = { x, z, f };
    }
    if (!best) best = { x: this.x, z: this.z + BOX.HAT_OUT, f: { y: this.groundY, surface: { normal: this.groundNormal } } };
    H.toX = best.x;
    H.toZ = best.z;
    H.floorY = best.f.y;
    H.floorN = best.f.surface.normal;
    H.toY = best.f.y + BOX.HAT_HEIGHT;
    this.hatMesh.visible = true;
  }

  _updateHat(player, tick) {
    const H = this.hat;
    if (H.state === 'inside') return;
    H.px = H.x;
    H.py = H.y;
    H.pz = H.z;
    H.t++;
    const B = BOX;
    if (H.state === 'pop') {
      const u = H.t / B.HAT_POP_TICKS;
      const e = 1 - (1 - u) * (1 - u);
      H.y = this.centerY + (this.topY + B.HAT_ABOVE - this.centerY) * e;
      if (H.t >= B.HAT_POP_TICKS) this._hatState('hold');
    } else if (H.state === 'hold') {
      H.y = this.topY + B.HAT_ABOVE + 6 * Math.sin(H.t * 0.2);
      if (H.t >= B.HAT_HOLD_TICKS) {
        H.fromX = H.x;
        H.fromY = H.y;
        H.fromZ = H.z;
        this._hatState('glide');
      }
    } else if (H.state === 'glide') {
      // Out first, then down, swaying like a falling leaf.
      const u = H.t / B.HAT_GLIDE_TICKS;
      const out = smooth(u / 0.7);
      const down = smooth((u - 0.15) / 0.85);
      const sway = Math.sin(u * Math.PI * 3) * 22 * (1 - u);
      const dx = H.toX - H.fromX;
      const dz = H.toZ - H.fromZ;
      const len = Math.sqrt(dx * dx + dz * dz) || 1;
      H.x = H.fromX + dx * out + (dz / len) * sway;
      H.z = H.fromZ + dz * out - (dx / len) * sway;
      H.y = H.fromY + (H.toY - H.fromY) * down;
      if (H.t >= B.HAT_GLIDE_TICKS) this._hatState('hover');
    } else {
      H.y = H.toY + 8 * Math.sin(H.t * 0.12);
      if (this.shadows && this.shadowSlots && H.t === 1) this.shadows.place(this.shadowSlots[1], H.toX, H.floorY, H.toZ, H.floorN, 80);
    }
    if (H.state !== 'pop' && this.touchesHat(player.pos)) this._takeHat(player);
  }

  _hatState(s) {
    this.hat.state = s;
    this.hat.t = 0;
  }

  // Does a hero with feet at `pos` touch the hat?
  touchesHat(pos) {
    const H = this.hat;
    const dx = pos.x - H.x;
    const dz = pos.z - H.z;
    const r = BOX.HAT_RADIUS + PLAYER_RADIUS;
    if (dx * dx + dz * dz > r * r) return false;
    const dy = H.y - pos.y;
    return dy >= BOX.HAT_LOW && dy <= BOX.HAT_HIGH;
  }

  _takeHat(player) {
    const H = this.hat;
    player.giveWingHat?.(BOX.HAT_SECONDS);
    this.sparkles?.burst({ x: H.x, y: H.y, z: H.z }, this.tick * FRAME_DT, TINT.hat, 10);
    this._stowHat();
    this.state = 'recharging';
    this.timer = BOX.RESPAWN_TICKS;
  }

  _stowHat() {
    const H = this.hat;
    H.state = 'inside';
    H.t = 0;
    H.x = H.px = this.x;
    H.y = H.py = this.centerY;
    H.z = H.pz = this.z;
    this.hatMesh.visible = false;
    if (this.shadows && this.shadowSlots) this.shadows.hide(this.shadowSlots[1]);
  }

  setDarkness(t) {
    this.darkT = t;
  }

  reset() {
    this._stowHat();
    this.state = 'ready';
    this.timer = 0;
    this.jolt = BOX.JOLT_TICKS;
    this.offset = this.prevOffset = 0;
    this.flash = 0;
    this.frontMat.map = this.textures.full;
    this._setLift(this._liftAt(this.tick + 1, BOX.JOLT_TICKS));
  }

  animate(alpha, clock) {
    const bob = BOX.BOB * Math.sin(clock * BOX.BOB_RATE);
    const jolt = this.prevOffset + (this.offset - this.prevOffset) * alpha;
    const g = this.boxGroup;
    g.position.y = this.centerY + bob + jolt;
    g.rotation.y = 0.04 * Math.sin(clock * 0.9);
    const lit = this.state === 'ready';
    const f = this.flash > 0 ? (this.flash - alpha) / BOX.FLASH_TICKS : 0;
    const glow = (lit ? 1 + 0.08 * Math.sin(clock * 3.1) : 0.62) + 0.9 * (f > 0 ? f : 0);
    this.frontMat.color.setScalar(glow);
    this.backMat.color.setScalar(lit ? 1 : 0.55);
    this.frameMat.color.setScalar((1 - 0.45 * this.darkT) * (1 + 0.5 * (f > 0 ? f : 0)));

    const H = this.hat;
    if (H.state === 'inside') return;
    const hat = this.hatMesh;
    hat.position.set(H.px + (H.x - H.px) * alpha, H.py + (H.y - H.py) * alpha, H.pz + (H.z - H.pz) * alpha);
    const fast = H.state === 'pop' || H.state === 'hold';
    const spin = clock * (fast ? 7 : 2.6);
    _e.set(H.state === 'glide' ? 0.18 * Math.sin(clock * 5) : 0.08, spin, 0, 'YXZ');
    hat.quaternion.copy(_q.setFromEuler(_e));
    const pop = H.state === 'pop' ? 0.4 + 0.6 * smooth((H.t - 1 + alpha) / BOX.HAT_POP_TICKS) : 1;
    hat.scale.setScalar(pop * this.hatScale);
    const beat = H.state === 'glide' ? 0.6 : 1;
    if (typeof hat.userData.flap === 'function') hat.userData.flap(clock, beat);
    else flapWings(hat, clock, beat);
  }
}
