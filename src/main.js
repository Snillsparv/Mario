// Entry point: wires every system together and runs the fixed 30 Hz simulation.
//
// URL flags (for development and automated tests):
//   ?skipTitle=1   start playing immediately (no title screen, no intro fly-in)
//   ?test=1        do not run the real-time loop; drive it via window.__game.step()
//   ?mute=1        no audio
//
// Game flow (state.mode 'title' -> 'play' -> 'gameover' -> 'title' ...):
//   * title: the camera orbits the grounds behind the title card. On a first visit the card
//     asks for any key first (that press unlocks audio and the title music), then for Start;
//     a gamepad Start begins from either phase (see ui/TitleScreen.js).
//   * intro: the camera flies in from above the castle while Pip waits, hidden, above the
//     spawn; he drops in once the camera is nearly down, so his landing plays in frame.
//   * respawn (health ran out, or out of bounds): the camera snaps behind the spawn and Pip
//     drops in again.
//   * losing a life at x0 lives: GAME OVER card, then back to the title; starting again
//     gives 4 lives and 0 coins.
//   * pause freezes everything drawn from the simulation clock (world, objects, hero).

import { FRAME_DT, MAX_STEPS_PER_FRAME, GAME_OVER_SECONDS } from './core/constants.js';
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
import { GameOverCard } from './ui/GameOverCard.js';
import { DialogBox } from './ui/DialogBox.js';
import { ObjectManager } from './objects/ObjectManager.js';

const params = new URLSearchParams(location.search);
const TEST = params.has('test');
const SKIP_TITLE = params.has('skipTitle') || TEST;

const START_LIVES = 4;
// Ticks of the camera fly-in (CameraController INTRO_TICKS = 96) before Pip starts his
// ~32-tick drop from INTRO_DROP, so he lands just as the camera settles behind him.
const INTRO_HOLD_TICKS = 60;

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
  // Sign dialogs: the Player enters 'reading' and emits 'signRead'; the box takes the input
  // until its last page, then Pip is released (the closing press never reaches him).
  const dialog = new DialogBox(uiRoot, { events });
  events.on('dialogClosed', () => {
    player.endReading?.();
    input.flush();
  });

  const state = {
    mode: 'title', // 'title' | 'play' | 'gameover'
    frame: 0, // simulated (unpaused) ticks
    time: 0, // simulation clock in seconds; stands still while paused
    paused: false,
    started: false,
    lives: START_LIVES,
    gameOverPending: false, // a life was lost at x0: game over once the death plays out
    gameOvers: 0,
    dropHold: 0, // ticks Pip still waits (hidden, frozen) before dropping in
  };
  let lastAction = player.action;

  events.on('lifeLost', () => {
    if (state.lives === 0) state.gameOverPending = true;
    else state.lives--;
  });
  events.on('oneUp', () => {
    state.lives++;
  });

  // Title card over a slow orbit of the grounds; resolves when the player presses start.
  // Until play starts, objects.animate() runs the objects' ambient clock from `sec` itself
  // (birds and butterflies move, nothing can be picked up), also after objects.reset().
  async function runTitle() {
    state.mode = 'title';
    hud.setVisible(false);
    model.object3D.visible = false;
    const title = new TitleScreen(uiRoot, { events, audio });
    let raf = 0;
    const titleLoop = (t) => {
      const sec = t / 1000;
      state.time = sec;
      level.update(sec, camera);
      objects.animate(sec, 1, camera);
      cam.titleOrbit?.(sec);
      cam.apply(1);
      view.render();
      raf = requestAnimationFrame(titleLoop);
    };
    raf = requestAnimationFrame(titleLoop);
    await title.show();
    cancelAnimationFrame(raf);
    // Audio: TitleScreen unlocks on the start press, and AudioEngine's 'gameStart' handler
    // unlocks with sticky user activation (not after a gamepad-only start, which is no gesture).
  }

  // Begin play: with `intro`, the camera flies in and Pip drops in at the spawn.
  function startGame(intro) {
    state.mode = 'play';
    state.paused = false;
    state.started = true;
    hud.setPaused?.(false);
    hud.setVisible(true);
    if (intro) {
      player.beginIntro?.();
      cam.startIntro?.(player);
      state.dropHold = INTRO_HOLD_TICKS;
    }
    lastAction = player.action;
    input.flush(); // keys pressed on the title (or held through it) are not fresh presses
    events.emit('gameStart');
    audio.playMusic('castle_grounds');
  }

  // Pip just entered 'spawn' from a respawn. Returns true when the game is over instead.
  function onRespawn() {
    if (state.gameOverPending) {
      state.gameOverPending = false;
      if (state.lives === 0) {
        gameOver();
        return true;
      }
      state.lives--; // a 1-up arrived during the death animation: it pays for this life
    }
    // Player.respawn() already put Pip above the spawn, facing the castle: snap the camera
    // behind him (it would otherwise keep the orbit yaw from where he died).
    cam.reset(player);
    return false;
  }

  // GAME OVER card over the frozen world (audio plays its jingle on 'gameOver'), then a fresh
  // world behind the title: the new game's pickups, star and counters are back before the
  // title shows, and play starts with 4 lives and 0 coins.
  function gameOver() {
    state.mode = 'gameover';
    state.gameOvers++;
    hud.setPaused?.(false);
    dialog.close();
    events.emit('gameOver');
    const card = new GameOverCard(uiRoot).show();
    setTimeout(async () => {
      card.remove();
      objects.reset(); // also takes the star it awarded back off player.stars
      player.coins = 0;
      state.lives = START_LIVES;
      await runTitle();
      startGame(true);
    }, GAME_OVER_SECONDS * 1000);
  }

  function tick(controller) {
    if (state.mode !== 'play') return;
    if (controller.START.pressed) {
      state.paused = !state.paused;
      hud.setPaused?.(state.paused);
      events.emit(state.paused ? 'pause' : 'unpause');
    }
    if (state.paused) return;
    state.time += FRAME_DT;
    if (dialog.isOpen) {
      dialog.update(controller);
      controller = neutralController(); // Pip and the camera wait while the box is up
    }
    if (state.dropHold > 0) {
      state.dropHold--; // Pip waits above the spawn; input is ignored
    } else {
      // The camera withholds movement input while in first-person look mode.
      player.update(cam.playerInput(controller), cam.getYaw());
    }
    if (player.action !== lastAction) {
      // Damage, death or a respawn can end a read early: take the box down with it.
      if (lastAction === 'reading' && dialog.isOpen) dialog.close();
      lastAction = player.action;
      if (lastAction === 'spawn' && onRespawn()) return;
    }
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
  // Pose the hero model; its own clocks (pose blends, blinks, scarf) run by dt while playing.
  function poseHero(dt) {
    const running = state.mode === 'play' && !state.paused;
    model.update(player.getRenderState(renderAlpha), running ? dt : 0); // pause freezes them too
  }
  function draw(dt) {
    poseHero(dt);
    model.object3D.visible = state.mode === 'play' && state.dropHold === 0 && !cam.hideHero;
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
    model,
    dialog,
    // Advance n simulation ticks with a fixed controller state (partial, like setOverride),
    // then draw once. The hero model is posed after every tick, as a 30 fps real-time run
    // would, so after a big step its pose blends, blinks and scarf have caught up instead of
    // showing the pose from before the step blended by a single 1/30 s frame.
    step(n = 1, controllerState = null) {
      renderAlpha = 1;
      for (let i = 0; i < n; i++) {
        input.setOverride(controllerState ?? {});
        tick(input.poll());
        if (i < n - 1 && state.mode !== 'title') poseHero(FRAME_DT); // draw() poses the last
      }
      input.setOverride(null);
      if (state.mode !== 'title') draw(FRAME_DT);
    },
    render() {
      draw(0);
    },
    // Restart play as after the title (intro fly-in and drop-in when `intro`).
    startGame(intro = true) {
      startGame(intro);
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
        lives: state.lives,
        mode: state.mode,
        cameraYaw: cam.getYaw(),
        cameraPos: camera.position.toArray(),
        frame: state.frame,
      };
    },
    neutralController,
  };

  cam.reset(player);
  if (SKIP_TITLE) {
    startGame(false);
  } else {
    await runTitle();
    startGame(true);
  }

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
    input.sample(); // latch gamepad flicks between ticks
    if (state.mode === 'title') {
      acc = 0; // the title loop draws; the simulation waits
    } else {
      acc += dt;
      let steps = 0;
      while (acc >= FRAME_DT && steps < MAX_STEPS_PER_FRAME) {
        tick(input.poll());
        acc -= FRAME_DT;
        steps++;
      }
      if (steps === MAX_STEPS_PER_FRAME) acc = 0;
      // Frozen (pause, game over): hold the last interpolation instead of cycling it.
      if (state.mode === 'play' && !state.paused) renderAlpha = acc / FRAME_DT;
      draw(dt);
    }
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
