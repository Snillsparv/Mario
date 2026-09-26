// Effects preview: the level drawn through N64Renderer with fx/Effects.js on top.
//   /preview.html?m=fx                      storm (dark 1, rain 1) from behind the spawn
//   &dark=0.5  &rain=0.3                    darkness / rain amounts (rain defaults to dark)
//   &fires=1                                five fires on the lawn + one in a tree canopy
//   &boom=0.15                              a blast in front of the camera, shown 0.15 s in
//   &bolt=1                                 a lightning strike (bolt + held flash)
//   &flash=1                                hold the renderer's lightning flash at its peak
//   &warm=3                                 simulate 3 s before the first frame
//   &freeze=1                               stop the effects' clock after the warm-up
//   &n64=0                                  native resolution
//   &melt=42                                AI RACE's meltdown at 42 s on its clock
//                                           (fx/Meltdown.js levelsAt; the light blooms in
//                                           front of the camera as in the game): renderer,
//                                           sky and effects, held there
// The harness camera (&cam=x,y,z&look=x,y,z) works as usual. window.__fx (Effects),
// window.__view (N64Renderer) and window.__fxStep(seconds) (advance at 30 Hz, then draw)
// are exposed for scripted screenshots; __fxStats() -> { calls, triangles, particles }.

import { N64Renderer } from '../../render/N64Renderer.js';
import { Effects } from '../../fx/Effects.js';
import { levelsAt, lightAnchor, placeOrb } from '../../fx/Meltdown.js';
import * as layout from '../../world/layout.js';

const VIEW = { pos: [0, 720, 7300], look: [0, 380, 0] };
const STEP = 1 / 30;

export async function setup(ctx) {
  const { params } = ctx;
  ctx.renderer.domElement.remove();
  ctx.renderer.dispose();

  const view = new N64Renderer(ctx.container, { storage: null });
  view.setN64Mode(params.get('n64') !== '0');
  const { buildLevel } = await import('../../world/level.js');
  const level = buildLevel(view.scene);
  view.setWaterLevelFn((x, z) => level.collision.waterLevelAt(x, z));

  const fx = new Effects({ scene: view.scene, events: null, collision: level.collision, layout });
  const dark = Number(params.get('dark') ?? 1);
  const rain = Number(params.get('rain') ?? dark);
  level.setDarkness?.(dark);
  view.setDarkness(dark);
  fx.setRain(rain);

  const camera = view.camera;
  const syncCamera = () => {
    camera.position.copy(ctx.camera.position);
    camera.quaternion.copy(ctx.camera.quaternion);
    camera.updateMatrixWorld();
  };
  const g = (x, z) => layout.groundHeight(x, z);
  let time = 0;
  const step = (seconds) => {
    syncCamera();
    for (let s = 0; s < seconds; s += STEP) {
      time += STEP;
      level.update(time, camera);
      fx.update(STEP, time, camera);
    }
  };
  window.__fx = fx;
  window.__view = view;
  window.__level = level;

  // Place the camera before the warm-up (splashes and bolts spawn in front of it).
  const cam = params.get('cam') ? params.get('cam').split(',').map(Number) : VIEW.pos;
  const look = params.get('look') ? params.get('look').split(',').map(Number) : VIEW.look;
  ctx.camera.position.set(...cam);
  ctx.camera.lookAt(...look);
  ctx.camera.updateMatrixWorld();

  if (params.has('fires')) {
    for (const [x, z, r] of [
      [-700, 4700, 150],
      [350, 4500, 120],
      [900, 5100, 180],
      [-250, 3900, 220],
      [1500, 4200, 100],
    ]) {
      fx.ignite(x, g(x, z), z, { radius: r, duration: 60 });
    }
    const tree = level.trees?.find((t) => t.x === 2700 && t.z === 5000) ?? level.trees?.[6];
    if (tree?.canopy) fx.ignite(tree.canopy.x, tree.canopy.y, tree.canopy.z, { radius: tree.canopy.radius ?? 250, duration: 60 });
    else fx.ignite(2700, g(2700, 5000) + 520, 5000, { radius: 260, duration: 60 });
  }
  if (params.has('melt')) {
    const L = levelsAt(Number(params.get('melt')) || 0);
    if (L.light > 0 || L.glare > 0) {
      const anchor = lightAnchor(cam[0], cam[1], cam[2], Math.atan2(look[0] - cam[0], look[2] - cam[2]));
      Object.assign(L, { lit: true, gx: anchor.gx, gy: anchor.gy, gz: anchor.gz });
      placeOrb(L.light, anchor, L);
    }
    view.setMeltdown(L);
    level.setMeltdown(L);
    fx.setMeltdown(L);
    window.__melt = L;
  }
  step(Number(params.get('warm') ?? 2));
  if (params.has('boom')) {
    const x = 250;
    const z = 5000;
    fx.explode(x, g(x, z) + 120, z, { radius: 250 });
    step(Number(params.get('boom')) || 0.15);
  }
  if (params.has('bolt')) {
    fx.strike(1);
    step(STEP);
  }
  const freeze = params.has('freeze');
  window.__fxStep = (seconds) => {
    step(seconds);
    syncCamera();
    view.render();
  };
  window.__fxStats = () => ({
    calls: view.renderer.info.render.calls,
    triangles: view.renderer.info.render.triangles,
    particles: fx.particleCount,
    fires: fx.fireCount,
    rain: fx.rain.geometry.instanceCount,
  });

  return {
    camera: { pos: cam, look },
    update() {
      if (!freeze) step(STEP);
    },
    render() {
      syncCamera();
      if (params.has('flash')) view.flash(1);
      view.render();
    },
  };
}
