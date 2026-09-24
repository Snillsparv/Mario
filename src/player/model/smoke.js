// Hot-foot smoke: while the 'burn' anim starts, small dark puffs pop out of the seat of Pip's
// trousers and hang in the air behind him as he shoots up, growing and drifting up before
// they shrink away. One instanced low-poly mesh inside the hero's object3D; the puffs live in
// world space (so they trail), and their instance matrices are written relative to the
// object3D each frame. Frozen while dt is 0 (pause).

import * as THREE from 'three';
import { smoothstep } from '../../core/math.js';

const MAX_PUFFS = 20;
const EMIT_TIME = 0.5; // seconds of the burn anim that smoke
const EMIT_EVERY = 0.025;
const LIFE = 0.45;
const SEAT = new THREE.Vector3(0, -5, -19); // in the pelvis frame: the seat of the trousers
const COLOR = 0x58514b;

const tmpM = new THREE.Matrix4();
const inv = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpS = new THREE.Vector3();
const tmpP = new THREE.Vector3();
const back = new THREE.Vector3();

export class SeatSmoke {
  constructor() {
    const geometry = new THREE.IcosahedronGeometry(1, 1); // 80 smooth-shaded triangles
    const material = new THREE.MeshLambertMaterial({ color: COLOR, transparent: true, opacity: 0.72, depthWrite: false });
    this.mesh = new THREE.InstancedMesh(geometry, material, MAX_PUFFS);
    this.mesh.name = 'seatSmoke';
    this.mesh.count = 0;
    this.mesh.visible = false;
    this.mesh.frustumCulled = false; // instances move every frame; the pool is tiny
    this.puffs = Array.from({ length: MAX_PUFFS }, () => ({
      age: LIFE, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, spin: 0, size: 1,
    }));
    this.emitIn = 0;
    this.seed = 1;
  }

  rand() {
    this.seed = (this.seed * 16807) % 2147483647;
    return this.seed / 2147483647;
  }

  // rs: sanitized RenderState; hips: the rig's pelvis joint and root: the hero's object3D
  // (world matrices current).
  update(dt, rs, hips, root) {
    // Smokes for EMIT_TIME, but not while falling back through the trail after the apex.
    if (rs.anim === 'burn' && rs.animTime < EMIT_TIME && (rs.vy > 0 || rs.animTime < 0.2)) {
      this.emitIn -= dt;
      while (this.emitIn <= 0) {
        this.emit(hips, root);
        this.emitIn += EMIT_EVERY;
      }
    } else {
      this.emitIn = 0;
    }
    let live = 0;
    inv.copy(root.matrixWorld).invert();
    for (const q of this.puffs) {
      if (q.age >= LIFE) continue;
      q.age += dt;
      if (q.age >= LIFE) continue;
      q.x += q.vx * dt;
      q.y += q.vy * dt;
      q.z += q.vz * dt;
      const u = q.age / LIFE;
      const s = q.size * (0.5 + smoothstep(0, 0.4, u)) * (1 - smoothstep(0.5, 1, u));
      tmpQ.setFromAxisAngle(back.set(0.3, 1, 0.2).normalize(), q.spin + u * 3);
      tmpM.compose(tmpP.set(q.x, q.y, q.z), tmpQ, tmpS.setScalar(Math.max(s, 0.01)));
      this.mesh.setMatrixAt(live++, tmpM.premultiply(inv));
    }
    this.mesh.count = live;
    this.mesh.visible = live > 0;
    if (live) this.mesh.instanceMatrix.needsUpdate = true;
  }

  emit(hips, root) {
    const q = this.puffs.find((p) => p.age >= LIFE);
    if (!q) return;
    tmpP.copy(SEAT).applyMatrix4(hips.matrixWorld);
    // Drifts out behind him and up a little (in world space, so it trails as he rises).
    back.set(0, 0, -1).transformDirection(root.matrixWorld);
    const r = () => this.rand() - 0.5;
    q.age = 0;
    q.x = tmpP.x + r() * 6;
    q.y = tmpP.y + r() * 6;
    q.z = tmpP.z + r() * 6;
    q.vx = back.x * 60 + r() * 50;
    q.vy = 15 + r() * 30;
    q.vz = back.z * 60 + r() * 50;
    q.spin = this.rand() * 6;
    q.size = 9 + this.rand() * 5;
  }
}
