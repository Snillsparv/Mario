// Pip, the original hero: a low-poly chibi explorer with procedural animation, a scarf
// that trails in the wind and an N64-style blob shadow.
//
//   const model = new PlayerModel();  scene.add(model.object3D);
//   model.update(renderState, dtSeconds);   // every render frame
//
// object3D sits at the feet (rs.pos) and is yawed to rs.yaw (front faces +Z). Everything
// else (poses, flips, squash, physical pitch/roll, blinking, invincibility flicker, the
// shadow) is handled inside. No lights are added: the renderer's sun + ambient shade Pip.

import * as THREE from 'three';
import { angleDiff, clamp } from '../core/math.js';
import { FLOOR_LOWER_LIMIT, FPS } from '../core/constants.js';
import { buildRig, applyPose } from './model/rig.js';
import { Animator } from './model/animator.js';
import { ScarfTails } from './model/scarf.js';
import { BlobShadow } from './model/shadow.js';
import { createFaceTextures, FACES } from './model/faceTexture.js';
import { COLORS } from './model/palette.js';
import { physicsStride } from './model/physicsLink.js';
import { gaitStride } from './model/strides.js';

// Fallback stride length (units per cycle) when the RenderState has no cyclePhase.
const FALLBACK_STRIDE = 150;
const BLINK_RATE = 15; // invincibility flicker: toggles per second (2 ticks on, 2 off)
const BANK_ANIMS = new Set(['walk', 'run']);
const MAX_BANK = 0.3;
// Anims drawn solid even while the Player reports invincibility: the hit that takes Pip's
// last wedge leaves him invincible, but he should not flicker out while he collapses.
const NO_FLICKER_ANIMS = new Set(['death']);

const num = (v, fallback) => (Number.isFinite(v) ? v : fallback);

export class PlayerModel {
  constructor() {
    this.faces = createFaceTextures();
    for (const f of FACES) this.faces(f); // paint every expression up front (no hitch later)
    const map = this.faces('open');
    this.faceMaterial = new THREE.MeshLambertMaterial({ map, color: map ? 0xffffff : COLORS.skin });

    this.rig = buildRig(this.faceMaterial);
    this.object3D = this.rig.object3D;
    this.animator = new Animator();
    this.scarf = new ScarfTails(this.rig.torso, this.rig.scarfAnchors, this.rig.material);
    this.shadow = new BlobShadow();
    this.object3D.add(this.shadow.mesh);

    this.rs = {
      pos: { x: 0, y: 0, z: 0 }, yaw: 0, pitch: 0, roll: 0, action: '', anim: 'idle', animTime: 0, cyclePhase: 0,
      forwardVel: 0, vy: 0, floorY: FLOOR_LOWER_LIMIT, floorNormal: { x: 0, y: 1, z: 0 }, invincible: false, headYaw: 0,
    };
    this.phase = 0;
    this.prevYaw = NaN; // NaN until the first frame (a number keeps the field unboxed)
    this.bank = 0;
    this.blinkIn = 2.5;
    this.bodyVel = new THREE.Vector3();
    this.worldPos = new THREE.Vector3();
    this.worldQuat = new THREE.Quaternion();
    this.worldScale = new THREE.Vector3();
  }

  update(renderState, dtSeconds) {
    const dt = clamp(num(dtSeconds, 1 / 60), 0, 0.1);
    const rs = this.sanitize(renderState, dt);
    const o = this.object3D;
    o.position.set(rs.pos.x, rs.pos.y, rs.pos.z);
    o.rotation.set(0, rs.yaw, 0);

    this.updateBank(rs, dt);
    const pose = this.animator.update(rs, dt, this.bank);
    applyPose(this.rig, pose, rs.pitch, rs.roll, rs.headYaw);
    this.updateFace(pose.face, dt);

    o.updateMatrixWorld(true);
    const v = rs.forwardVel * FPS;
    this.bodyVel.set(Math.sin(rs.yaw) * v, rs.vy * FPS, Math.cos(rs.yaw) * v);
    this.scarf.update(dt, this.bodyVel, o, this.animator.time);
    o.matrixWorld.decompose(this.worldPos, this.worldQuat, this.worldScale); // matrices are current
    this.shadow.update(rs, this.worldQuat);

    // Invincibility: the body flickers at a fixed rate whatever the display refresh; the
    // shadow stays. Not while dying (see NO_FLICKER_ANIMS).
    const flicker = rs.invincible && !NO_FLICKER_ANIMS.has(rs.anim);
    this.rig.orient.visible = !flicker || Math.floor(this.animator.time * BLINK_RATE) % 2 === 0;
  }

  // Copies the RenderState into a private, fully-populated record (missing or non-finite
  // fields get safe defaults) so a partial state from the physics never breaks the model.
  sanitize(r, dt) {
    const s = this.rs;
    s.pos.x = num(r?.pos?.x, 0);
    s.pos.y = num(r?.pos?.y, 0);
    s.pos.z = num(r?.pos?.z, 0);
    s.yaw = num(r?.yaw, 0);
    s.pitch = num(r?.pitch, 0);
    s.roll = num(r?.roll, 0);
    s.action = typeof r?.action === 'string' ? r.action : '';
    s.anim = typeof r?.anim === 'string' ? r.anim : 'idle';
    s.animTime = Math.max(0, num(r?.animTime, 0));
    s.forwardVel = num(r?.forwardVel, 0);
    s.vy = num(r?.vy, 0);
    // Stride phase from the physics when provided, else integrated from the speed (in the
    // Player's cycles, which the animator converts back to distance).
    const cycle = r?.cyclePhase;
    if (Number.isFinite(cycle)) {
      s.cyclePhase = cycle;
    } else {
      const stride = physicsStride(s.anim) || gaitStride(s.anim, s.forwardVel) || FALLBACK_STRIDE;
      this.phase += (Math.abs(s.forwardVel) * FPS * dt) / stride;
      s.cyclePhase = this.phase;
    }
    s.floorY = num(r?.floorY, FLOOR_LOWER_LIMIT);
    const n = r?.floorNormal;
    s.floorNormal.x = num(n?.x, 0);
    s.floorNormal.y = num(n?.y, 1);
    s.floorNormal.z = num(n?.z, 0);
    s.invincible = !!r?.invincible;
    s.headYaw = num(r?.headYaw, 0);
    return s;
  }

  // Lean into turns while walking/running (a render-only touch; physics tilt is separate).
  // The pose applies it about the feet, before the leg IK, so the boots stay planted.
  updateBank(rs, dt) {
    let target = 0;
    if (!Number.isNaN(this.prevYaw) && dt > 0 && BANK_ANIMS.has(rs.anim)) {
      const yawRate = angleDiff(this.prevYaw, rs.yaw) / dt;
      target = clamp(-yawRate * 0.07 * clamp(Math.abs(rs.forwardVel) / 30, 0, 1), -MAX_BANK, MAX_BANK);
    }
    this.prevYaw = rs.yaw;
    this.bank += (target - this.bank) * Math.min(1, dt * 10);
  }

  // Expression from the pose, with an automatic blink every few seconds on the open face.
  updateFace(face, dt) {
    this.blinkIn -= dt;
    if (this.blinkIn < -0.15) this.blinkIn = 2 + Math.random() * 3;
    if (face === 'open' && this.blinkIn < 0) face = this.blinkIn > -0.04 || this.blinkIn < -0.11 ? 'half' : 'blink';
    const map = this.faces(face);
    if (map && this.faceMaterial.map !== map) this.faceMaterial.map = map;
  }
}
