// A small camera shake for heavy impacts (AI RACE mode's server halls slamming down: the
// 'hallImpact' { pos, strength } event). Rotation only, applied after the camera controller
// has placed the camera for the frame: the position (and so the collider's clearance, the
// water test and the listener) is untouched, the view just jolts for a moment.
//
//   const shake = new CameraShake(events)
//   shake.kick(strength, pos?)     strength 0..1; fainter the farther pos is from the camera
//   shake.apply(camera, dt)        per render frame, after cam.apply(); dt 0 (paused) freezes it

export const SHAKE = {
  ANGLE: 0.012, // radians of jolt at strength 1, right at the impact
  DECAY: 5.5, // per second
  NEAR: 1500, // full strength within this distance of the camera ...
  FAR: 9000, // ... fading out to nothing here
};

export class CameraShake {
  constructor(events = null) {
    this.amount = 0;
    this.time = 0;
    this.pending = 0; // kicks waiting for the camera position (their falloff)
    this.px = 0;
    this.py = 0;
    this.pz = 0;
    this.hasPos = false;
    events?.on?.('hallImpact', (e) => this.kick(e?.strength ?? 1, e?.pos ?? null));
  }

  kick(strength = 1, pos = null) {
    if (!(strength > 0)) return;
    // strongest pending kick wins (its position decides the falloff)
    if (strength >= this.pending) {
      this.pending = strength;
      this.hasPos = !!pos;
      if (pos) {
        this.px = pos.x;
        this.py = pos.y;
        this.pz = pos.z;
      }
    }
  }

  apply(camera, dt) {
    if (this.pending > 0) {
      let k = this.pending;
      if (this.hasPos) {
        const p = camera.position;
        const dx = p.x - this.px;
        const dy = p.y - this.py;
        const dz = p.z - this.pz;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        const f = d <= SHAKE.NEAR ? 1 : d >= SHAKE.FAR ? 0 : 1 - (d - SHAKE.NEAR) / (SHAKE.FAR - SHAKE.NEAR);
        k *= f * f;
      }
      if (k > this.amount) this.amount = k;
      this.pending = 0;
    }
    if (!(this.amount > 0.002)) {
      this.amount = 0;
      return;
    }
    if (dt > 0) {
      this.time += dt;
      this.amount *= Math.exp(-SHAKE.DECAY * dt);
    }
    const a = this.amount * SHAKE.ANGLE;
    const t = this.time;
    camera.rotateX(a * Math.sin(t * 61) * 0.8);
    camera.rotateY(a * Math.sin(t * 47 + 1.3) * 0.5);
    camera.rotateZ(a * Math.sin(t * 53 + 2.1) * 0.6);
  }
}
