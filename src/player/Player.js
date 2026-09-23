// PLACEHOLDER — replaced by the full action-state-machine implementation.
// Implements the Player contract from docs/ARCHITECTURE.md with trivial movement.
import { stickToWorldYaw, approachAngle } from '../core/math.js';

export class Player {
  constructor({ collision, events, spawn }) {
    this.collision = collision;
    this.events = events;
    this.pos = { x: spawn.x, y: spawn.y, z: spawn.z };
    this.prevPos = { ...this.pos };
    this.vel = { x: 0, y: 0, z: 0 };
    this.faceYaw = spawn.yaw;
    this.prevFaceYaw = this.faceYaw;
    this.forwardVel = 0;
    this.action = 'idle';
    this.actionTimer = 0;
    this.health = 8;
    this.coins = 0;
    this.stars = 0;
    this.lives = 4;
    this.floor = { y: spawn.y, surface: null };
    this.cyclePhase = 0;
  }

  update(input, cameraYaw) {
    this.prevPos = { ...this.pos };
    this.prevFaceYaw = this.faceYaw;
    if (input.stickMag > 0.05) {
      this.faceYaw = approachAngle(this.faceYaw, stickToWorldYaw(input.stickX, input.stickY, cameraYaw), 0.4);
      this.forwardVel = 32 * input.stickMag;
    } else this.forwardVel = 0;
    this.pos.x += Math.sin(this.faceYaw) * this.forwardVel;
    this.pos.z += Math.cos(this.faceYaw) * this.forwardVel;
    const f = this.collision.findFloor(this.pos.x, this.pos.y + 100, this.pos.z);
    if (input.A.pressed && this.pos.y <= f.y + 1) this.vel.y = 42;
    this.vel.y = Math.max(this.vel.y - 4, -75);
    this.pos.y += this.vel.y;
    if (this.pos.y <= f.y) {
      this.pos.y = f.y;
      this.vel.y = 0;
    }
    this.floor = f;
    this.action = this.pos.y > f.y + 1 ? 'jump' : this.forwardVel > 0 ? 'walking' : 'idle';
    this.cyclePhase += this.forwardVel / 180;
    this.actionTimer++;
  }

  getRenderState(alpha) {
    const p = this.prevPos;
    const c = this.pos;
    const n = this.floor.surface?.normal ?? { x: 0, y: 1, z: 0 };
    return {
      pos: { x: p.x + (c.x - p.x) * alpha, y: p.y + (c.y - p.y) * alpha, z: p.z + (c.z - p.z) * alpha },
      yaw: this.prevFaceYaw + ((((this.faceYaw - this.prevFaceYaw + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI) - Math.PI) * alpha,
      pitch: 0,
      roll: 0,
      action: this.action,
      anim: this.action === 'jump' ? 'jump' : this.forwardVel > 0 ? 'run' : 'idle',
      animTime: this.actionTimer / 30,
      cyclePhase: this.cyclePhase,
      forwardVel: this.forwardVel,
      vy: this.vel.y,
      grounded: this.action !== 'jump',
      inWater: false,
      floorY: this.floor.y,
      floorNormal: n,
      health: this.health,
      invincible: false,
      punchStep: 0,
    };
  }

  collectCoin(value = 1) {
    this.coins += value;
    this.health = Math.min(8, this.health + value);
  }

  collectStar() {
    this.stars++;
  }

  takeDamage(amount, from) {
    this.health = Math.max(0, this.health - amount);
  }
}
