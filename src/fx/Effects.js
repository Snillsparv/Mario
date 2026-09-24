// PLACEHOLDER — replaced by the effects implementation (rain, lightning, fire, explosions).
// Contract (docs/ARCHITECTURE.md "AI RACE mode"):
//   const fx = new Effects({ scene, events, collision, layout })
//   fx.setRain(t)                         // 0..1 rain amount (follows the darkness crossfade)
//   fx.ignite(x, y, z, { radius, duration, intensity }) -> id   // a burning fire (visual)
//   fx.extinguish(id); fx.clearFires()
//   fx.explode(x, y, z, { radius })       // one-shot fireball blast
//   fx.update(dt, time, camera)           // per render frame
//   emits 'lightning' { strength } (the renderer flashes, audio schedules thunder)
export class Effects {
  constructor({ scene, events } = {}) {
    this.scene = scene;
    this.events = events;
    this.nextId = 1;
  }
  setRain() {}
  ignite() {
    return this.nextId++;
  }
  extinguish() {}
  clearFires() {}
  explode() {}
  update() {}
}
