// The cannon on the east lawn (layout.CANNON { x, z, yaw, pad? }): step onto its glowing
// loading pad and Pip hops into the barrel (player.enterCannon, actions/cannon.js); aim with
// the stick, A fires him off toward the castle's roofs, B or Z climbs back out. Look:
// cannonModel.js. An original design.
//
//   new Cannon({ spot, collision, events, groundAt, fx? })
//   desc                       the descriptor the Player gets: { x, y, z (the barrel's pivot),
//                              muzzle, restYaw, restPitch, exit: { x, y, z } }
//   pad                        { x, y, z, radius }: the loading pad's top centre
//   update(player, tick)       30 Hz: the pad trigger, the barrel follows the aim
//   animate(alpha, clock)      render: turret yaw, barrel pitch and recoil, pad glow, pennant
//   setDarkness(t)             AI RACE crossfade: the stone and iron dim with the storm, the
//                              pad's ring keeps glowing
//   reset()                    barrel at rest, pad armed
//
// Trigger: Pip standing (grounded) on the pad's top while it is armed. It disarms while he is
// in the cannon and re-arms once he has stood or walked anywhere off the pad (so climbing out
// never drops him straight back in). Idle, the barrel rests pointing up over the castle
// (restYaw = spot.yaw, restPitch); while Pip is inside it follows his aim (player.cannon.yaw /
// pitch); after a shot it holds for a moment, then swings back to rest.
//
// Firing ('cannonFire' { pos, yaw, pitch, dir }, emitted by the Player): the barrel recoils and
// springs back, and fx.muzzle (Effects) puts a flash, a ring of smoke and sparks at the mouth.
//
// Colliders (static, added at construction): the emplacement drum (a 12-sided prism with a
// flat stone top you can hop onto), a column round the turret and breech (flat-topped at about
// the barrel's top), and the pad's top (a 14-unit step up from the lawn). The barrel has none:
// it only turns while Pip is inside.
//
// Draw calls: three (base, turret, barrel), one material (cannonModel.js).

import * as THREE from 'three';
import { lerp, lerpAngle, approach, approachAngle, TAU, wrapAngle } from '../core/math.js';
import { tri } from './AiButton.js';
import { CANNON_DIMS, CANNON_COLORS, buildBaseGeometry, buildTurretGeometry, buildBarrelGeometry, makeCannonMaterial } from './cannonModel.js';

export const CANNON = {
  COLLIDER_SIDES: 12,
  HOLD_TICKS: 36, // after a shot the barrel holds its aim this long...
  RETURN_RATE: 0.03, // ...then swings back to rest this fast (radians per tick)
  RECOIL: 46, // how far the barrel kicks back along its bore
  RECOIL_TICKS: 14,
  GLOW_IDLE: 0.55, // the pad ring's glow: while armed (pulsing)...
  GLOW_PULSE: 0.3,
  GLOW_OFF: 0.12, // ...and while Pip is in the cannon (or the pad is disarmed)
  MUZZLE_FX: 130, // radius of the muzzle blast
};

const GLOW = new THREE.Color().fromArray(CANNON_COLORS.glow);

export class Cannon {
  constructor({ spot, collision, events = null, groundAt = null, fx = null }) {
    const D = CANNON_DIMS;
    this.x = spot.x;
    this.z = spot.z;
    this.collision = collision;
    this.events = events;
    this.fx = fx;
    // Ground under the centre (before our own colliders exist): the analytic ground if given.
    const ground = (x, z) => {
      const g = groundAt ? groundAt(x, z) : NaN;
      if (Number.isFinite(g)) return g;
      const f = collision.findFloor(x, 1e5, z);
      return f.surface ? f.y : 0;
    };
    this.groundY = ground(this.x, this.z);
    this.restYaw = wrapAngle(spot.yaw ?? 0);
    this.restPitch = D.REST_PITCH;
    this.padYaw = wrapAngle(this.restYaw + (spot.pad ?? D.PAD_ANGLE));

    // Aim now and last tick (the render interpolates), recoil, the shot's hold.
    this.yaw = this.prevYaw = this.restYaw;
    this.pitch = this.prevPitch = this.restPitch;
    this.recoil = this.prevRecoil = 0;
    this.recoilT = CANNON.RECOIL_TICKS;
    this.hold = 0;
    this.armed = true;
    this.loaded = false; // Pip is in the cannon (action 'cannon')
    this.darkT = 0;

    this.material = makeCannonMaterial();
    const base = buildBaseGeometry({ padYaw: this.padYaw, groundAt: (lx, lz) => ground(this.x + lx, this.z + lz) - this.groundY });
    this.pad = { x: this.x + base.pad.x, y: this.groundY + base.pad.y, z: this.z + base.pad.z, radius: D.PAD_R };
    this.material.userData.uniforms.cannonWaveDir.value.set(base.flagDir[0], base.flagDir[1]);

    this.mesh = new THREE.Group();
    this.mesh.name = 'cannon';
    this.mesh.position.set(this.x, this.groundY, this.z);
    this.base = new THREE.Mesh(base.geometry, this.material);
    this.base.name = 'cannonBase';
    this.turret = new THREE.Mesh(buildTurretGeometry(), this.material);
    this.turret.name = 'cannonTurret';
    this.barrel = new THREE.Mesh(buildBarrelGeometry(), this.material);
    this.barrel.name = 'cannonBarrel';
    this.barrel.position.y = D.PIVOT_Y;
    this.turret.add(this.barrel);
    this.mesh.add(this.base, this.turret);

    const e = D.EXIT_DIST;
    const ex = this.x + Math.sin(this.padYaw) * e;
    const ez = this.z + Math.cos(this.padYaw) * e;
    this.desc = {
      x: this.x,
      y: this.groundY + D.PIVOT_Y,
      z: this.z,
      muzzle: D.MUZZLE,
      restYaw: this.restYaw,
      restPitch: this.restPitch,
      exit: { x: ex, y: ground(ex, ez), z: ez },
    };
    this.padSurfaces = this._addColliders();
    events?.on?.('cannonFire', (ev) => this._fired(ev));
    this._pose(1);
  }

  // Static colliders (see top). Returns the pad top's surfaces (the trigger's floor).
  _addColliders() {
    const col = this.collision;
    if (!col?.addTriangles) return new Set();
    const D = CANNON_DIMS;
    const G = this.groundY;
    const list = col.surfaces;
    // (A polygon's corners on the circumscribed circle, so the flat sides touch radius r.)
    const prism = (cx, cz, r, n, y0, y1, walls = true) => {
      const out = [];
      const R = r / Math.cos(Math.PI / n);
      const pts = Array.from({ length: n }, (_, i) => {
        const a = ((i + 0.5) / n) * TAU;
        return [cx + Math.sin(a) * R, cz + Math.cos(a) * R];
      });
      for (let i = 1; i + 1 < n; i++) tri(out, [pts[0][0], y1, pts[0][1]], [pts[i][0], y1, pts[i][1]], [pts[i + 1][0], y1, pts[i + 1][1]], 0, 1, 0);
      if (walls) {
        for (let i = 0; i < n; i++) {
          const a = pts[i];
          const b = pts[(i + 1) % n];
          const nx = (a[0] + b[0]) / 2 - cx;
          const nz = (a[1] + b[1]) / 2 - cz;
          tri(out, [a[0], y0, a[1]], [b[0], y0, b[1]], [b[0], y1, b[1]], nx, 0, nz);
          tri(out, [a[0], y0, a[1]], [b[0], y1, b[1]], [a[0], y1, a[1]], nx, 0, nz);
        }
      }
      return out;
    };
    const S = CANNON.COLLIDER_SIDES;
    col.addTriangles(prism(this.x, this.z, D.BASE_R, S, G - D.BASE_SINK, G + D.BASE_TOP), { terrain: 'stone' });
    col.addTriangles(prism(this.x, this.z, D.TURRET_COLLIDER_R, S, G + D.BASE_TOP - 10, G + D.TURRET_COLLIDER_TOP), { terrain: 'stone' });
    const first = list ? list.length : 0;
    // The pad: its top only (a lip lower than the hero's knee probe; walls there would stop him
    // stepping on).
    col.addTriangles(prism(this.pad.x, this.pad.z, D.PAD_R + 6, 16, this.pad.y - 40, this.pad.y, false), { terrain: 'stone' });
    return new Set(list ? list.slice(first) : []);
  }

  // Is the player standing on the pad's top?
  onPad(player) {
    const f = player.floor;
    if (!player.grounded || !f?.surface) return false;
    return this.padSurfaces.has(f.surface) && Math.abs(player.pos.y - this.pad.y) < 2;
  }

  update(player, tick = 0) {
    this.prevYaw = this.yaw;
    this.prevPitch = this.pitch;
    this.prevRecoil = this.recoil;
    if (this.recoilT < CANNON.RECOIL_TICKS) {
      this.recoilT++;
      const u = this.recoilT / CANNON.RECOIL_TICKS;
      this.recoil = u >= 1 ? 0 : CANNON.RECOIL * (u < 0.15 ? u / 0.15 : 1 - (u - 0.15) / 0.85) ** 1.5;
    }
    const s = player.cannon;
    const inside = player.action === 'cannon' && s?.desc === this.desc;
    this.loaded = inside;
    if (inside) {
      this.yaw = s.yaw;
      this.pitch = s.pitch;
      this.armed = false;
    } else if (this.hold > 0) {
      this.hold--;
    } else {
      this.yaw = approachAngle(this.yaw, this.restYaw, CANNON.RETURN_RATE);
      this.pitch = approach(this.pitch, this.restPitch, CANNON.RETURN_RATE);
    }
    if (inside) return;
    const on = this.onPad(player);
    if (!on && player.grounded) this.armed = true;
    if (on && this.armed && typeof player.enterCannon === 'function' && player.enterCannon(this.desc)) {
      this.armed = false;
      this.loaded = true;
      this.hold = 0;
    }
  }

  // 'cannonFire' from the Player: recoil, and the blast at the mouth.
  _fired(ev) {
    this.recoilT = 0;
    this.hold = CANNON.HOLD_TICKS;
    if (!ev?.pos) return;
    const d = ev.dir ?? { x: 0, y: 1, z: 0 };
    if (this.fx?.muzzle) this.fx.muzzle(ev.pos.x, ev.pos.y, ev.pos.z, d.x, d.y, d.z, { radius: CANNON.MUZZLE_FX });
    else this.fx?.explode?.(ev.pos.x, ev.pos.y, ev.pos.z, { radius: CANNON.MUZZLE_FX });
  }

  setDarkness(t) {
    this.darkT = t;
    this.material.color.setScalar(1 - 0.72 * t);
  }

  reset() {
    this.yaw = this.prevYaw = this.restYaw;
    this.pitch = this.prevPitch = this.restPitch;
    this.recoil = this.prevRecoil = 0;
    this.recoilT = CANNON.RECOIL_TICKS;
    this.hold = 0;
    this.armed = true;
    this.loaded = false;
    this._pose(1);
  }

  _pose(alpha) {
    this.turret.rotation.y = lerpAngle(this.prevYaw, this.yaw, alpha);
    this.barrel.rotation.x = -lerp(this.prevPitch, this.pitch, alpha);
    const k = lerp(this.prevRecoil, this.recoil, alpha);
    // Recoil: back along the bore (the barrel's local -Z, turned by its pitch).
    const p = this.barrel.rotation.x;
    this.barrel.position.y = CANNON_DIMS.PIVOT_Y + Math.sin(p) * k;
    this.barrel.position.z = -Math.cos(p) * k;
  }

  animate(alpha, clock) {
    this._pose(alpha);
    const u = this.material.userData.uniforms;
    u.cannonTime.value = clock;
    const idle = this.armed && !this.loaded;
    const g = idle ? CANNON.GLOW_IDLE + CANNON.GLOW_PULSE * Math.sin(clock * 3.2) : CANNON.GLOW_OFF;
    u.cannonGlow.value.copy(GLOW).multiplyScalar(g * (1 + 0.6 * this.darkT));
  }
}
