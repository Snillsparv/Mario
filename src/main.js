// Entry point: wires every system together and runs the fixed 30 Hz simulation.
//
// URL flags (for development and automated tests):
//   ?skipTitle=1   start playing immediately (no title screen, no intro fly-in)
//   ?test=1        do not run the real-time loop; drive it via window.__game.step()
//   ?mute=1        no audio

import { FRAME_DT, MAX_STEPS_PER_FRAME } from './core/constants.js';
import { Events } from './core/events.js';
import { Input, neutralController } from './core/input.js';
import { buildLevel } from './world/level.js';
import { Player } from './player/Player.js';
import { PlayerModel } from './player/PlayerModel.js';
import { CameraController } from './camera/CameraController.js';
import { N64Renderer } from './render/N64Renderer.js';
import { AudioEngine } from './audio/AudioEngine.js';
import { HUD } from './ui/HUD.js';
import { TitleScreen } from './ui/TitleScreen.js';
import { ObjectManager } from './objects/ObjectManager.js';

const params = new URLSearchParams(location.search);
const TEST = params.has('test');
const SKIP_TITLE = params.has('skipTitle') || TEST;

async function start() {
  const container = document.getElementById('game');
  const uiRoot = document.getElementById('ui');

  const events = new Events();
  const input = new Input(window);
  const view = new N64Renderer(container);
  view.alignOverlay(uiRoot); // HUD and title follow the picture when F3 pillarboxes it to 4:3
  const { scene, camera } = view;

  const level = buildLevel(scene);
  view.setWaterLevelFn((x, z) => level.collision.waterLevelAt(x, z));
  const player = new Player({ collision: level.collision, events, spawn: level.spawn });
  const model = new PlayerModel();
  scene.add(model.object3D);

  const cam = new CameraController({ collision: level.collision, camera, events });
  const audio = new AudioEngine(events);
  if (params.has('mute')) audio.muted = true;
  const objects = new ObjectManager({ scene, collision: level.collision, events, layout: level.layout, player });
  const hud = new HUD(uiRoot, { events });

  const state = {
    frame: 0,
    time: 0,
    paused: false,
    started: SKIP_TITLE,
    lives: 4,
  };

  events.on('lifeLost', () => {
    state.lives = Math.max(0, state.lives - 1);
  });
  events.on('oneUp', () => {
    state.lives++;
  });

  cam.reset(player);
  if (!SKIP_TITLE) {
    const title = new TitleScreen(uiRoot, { events, audio });
    // Render the world behind the title screen.
    let titleRaf = 0;
    const titleLoop = (t) => {
      level.update(t / 1000, camera);
      objects.animate(t / 1000, 1, camera);
      cam.titleOrbit?.(t / 1000);
      cam.apply(1);
      view.render();
      titleRaf = requestAnimationFrame(titleLoop);
    };
    titleRaf = requestAnimationFrame(titleLoop);
    await title.show();
    cancelAnimationFrame(titleRaf);
    audio.unlock();
    player.beginIntro?.();
    cam.startIntro?.(player);
    events.emit('gameStart');
    state.started = true;
  } else {
    events.emit('gameStart');
  }
  audio.playMusic('castle_grounds');

  function tick(controller) {
    if (controller.START.pressed) {
      state.paused = !state.paused;
      hud.setPaused?.(state.paused);
      events.emit(state.paused ? 'pause' : 'unpause');
    }
    if (state.paused) return;
    // The camera withholds movement input while in first-person look mode.
    player.update(cam.playerInput(controller), cam.getYaw());
    objects.update({ player, frame: state.frame, camera: cam });
    cam.update(controller, player);
    hud.update({
      lives: state.lives,
      coins: player.coins,
      stars: player.stars,
      health: player.health,
      showPower: player.health < 8 || !!player.inWater,
      breath: player.breath,
      paused: state.paused,
    });
    audio.setListener?.(cam.camera.position, cam.getYaw());
    state.frame++;
  }

  let renderAlpha = 1;
  function draw(dt) {
    const rs = player.getRenderState(renderAlpha);
    model.update(rs, dt);
    model.object3D.visible = !cam.hideHero;
    cam.apply(renderAlpha);
    level.update(state.time, camera);
    objects.animate(state.time, renderAlpha, camera);
    audio.update?.(dt);
    view.render();
  }

  // --- test / automation hooks -------------------------------------------------------
  window.__game = {
    events,
    player,
    camera: cam,
    level,
    objects,
    state,
    view,
    input,
    hud,
    audio,
    // Advance n simulation ticks with a fixed controller state (partial, like setOverride).
    step(n = 1, controllerState = null) {
      for (let i = 0; i < n; i++) {
        input.setOverride(controllerState ?? {});
        const c = input.poll();
        tick(c);
        state.time += FRAME_DT;
      }
      input.setOverride(null);
      renderAlpha = 1;
      draw(FRAME_DT);
    },
    render() {
      draw(0);
    },
    snapshot() {
      return {
        pos: { ...player.pos },
        vel: { ...player.vel },
        forwardVel: player.forwardVel,
        faceYaw: player.faceYaw,
        action: player.action,
        health: player.health,
        coins: player.coins,
        stars: player.stars,
        cameraYaw: cam.getYaw(),
        cameraPos: camera.position.toArray(),
        frame: state.frame,
      };
    },
    neutralController,
  };

  if (TEST) {
    draw(0);
    window.__ready = true;
    return;
  }

  let acc = 0;
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.25, (now - last) / 1000);
    last = now;
    acc += dt;
    let steps = 0;
    while (acc >= FRAME_DT && steps < MAX_STEPS_PER_FRAME) {
      tick(input.poll());
      state.time += FRAME_DT;
      acc -= FRAME_DT;
      steps++;
    }
    if (steps === MAX_STEPS_PER_FRAME) acc = 0;
    renderAlpha = acc / FRAME_DT;
    draw(dt);
    requestAnimationFrame(frame);
  }
  window.__ready = true;
  requestAnimationFrame(frame);
}

start().catch((err) => {
  console.error(err);
  const pre = document.createElement('pre');
  pre.style.cssText = 'position:fixed;inset:0;color:#f88;background:#000;padding:20px;white-space:pre-wrap';
  pre.textContent = String(err?.stack || err);
  document.body.appendChild(pre);
});
