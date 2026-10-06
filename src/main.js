// Entry point: wires every system together and runs the fixed 30 Hz simulation.
//
// URL flags (for development and automated tests):
//   ?skipTitle=1   start playing immediately (no title screen, no face screen, no intro fly-in)
//   ?test=1        do not run the real-time loop; drive it via window.__game.step() (no menus)
//   ?face=1        open Pip's stretchy face screen instead of the title card (it is opt-in)
//   ?mute=1        no audio
//   ?pad=1 / 0     force / turn off the phone controller probe (net/RemotePad.js; ?test=1
//                  leaves it off unless ?pad=1)
//   ?area=hall     start in another area (world/areaDefs.js: hall, skerries, lane), at &entry=<id>
//                  (default: its respawn entry); only where play starts at once (?test,
//                  ?skipTitle)
//   ?look=classic  Sparrow Lane in its classic look (no realistic look; G toggles it in the game);
//                  ?look=real: realistic (the default, but under ?test=1, where it is opt-in)
//   ?tier=high     the realistic look's tier (high | mid | low) instead of the device's guess
//                  (and realistic under ?test=1 too)
//
// Game flow (state.mode 'title' -> 'play' -> 'gameover' -> 'title' ...; 'face' with ?face=1):
//   * title: the camera orbits the grounds behind the title card. On a first visit the card
//     asks for any key first (that press unlocks audio and the title music), then for Start;
//     a gamepad Start begins from either phase (see ui/TitleScreen.js).
//   * face (only with ?face=1): Pip's big stretchy head to pull about (ui/FaceScreen.js, its
//     own scene drawn by the renderer instead of the world); Start goes on to play.
//   * intro: the camera flies in from above the castle while Pip waits, hidden, above the
//     spawn; he drops in once the camera is nearly down, so his landing plays in frame.
//   * respawn (health ran out, or out of bounds): the camera snaps behind the spawn and Pip
//     drops in again.
//   * losing a life at x0 lives: GAME OVER card, then back to the title; starting again
//     gives 4 lives and 0 coins.
//   * AI RACE not stopped within 40 s (fx/Meltdown.js): the sky catches fire, the world burns
//     white and it is GAME OVER the same way, whatever the lives left.
//   * pause freezes everything drawn from the simulation clock (world, objects, hero).
//   * areas (core/AreaSwitch.js): walking into the castle door swings it open and wipes to the
//     Great Hall, and its inner door back out; the ship in the bottle's mouth shrinks Pip into
//     Midsummer Skerries, the first course, which he leaves with its star (it lights the
//     lighthouse there and the little one in the bottle) or from the pause screen (B); GAME
//     OVER always returns to the grounds.

import { FRAME_DT, MAX_STEPS_PER_FRAME, GAME_OVER_SECONDS } from './core/constants.js';
import { Events } from './core/events.js';
import { Input, neutralController } from './core/input.js';
import { buildLevel } from './world/level.js';
import { Player } from './player/Player.js';
import { PlayerModel } from './player/PlayerModel.js';
import { ScalePivot } from './player/model/scalePivot.js';
import { CameraController } from './camera/CameraController.js';
import { CameraShake } from './camera/shake.js';
import { N64Renderer } from './render/N64Renderer.js';
import { AudioEngine } from './audio/AudioEngine.js';
import { HUD } from './ui/HUD.js';
import { TitleScreen } from './ui/TitleScreen.js';
import { ChoiceScreen } from './ui/ChoiceScreen.js';
import { FaceScreen } from './ui/FaceScreen.js';
import { menuPlan } from './ui/face/stretch.js';
import { GameOverCard } from './ui/GameOverCard.js';
import { DialogBox } from './ui/DialogBox.js';
import { AlertBanner } from './ui/AlertBanner.js';
import { TouchController } from './ui/TouchController.js';
import { PhonePanel } from './ui/PhonePanel.js';
import { Recorder } from './ui/Recorder.js';
import { fullscreenKey } from './ui/fullscreen.js';
import { loadRaceChoice, saveRaceChoice } from './ui/raceChoice.js';
import { RemotePad } from './net/RemotePad.js';
import { ObjectManager } from './objects/ObjectManager.js';
import { Effects } from './fx/Effects.js';
import { Meltdown } from './fx/Meltdown.js';
import { AreaSwitch } from './core/AreaSwitch.js';
import { RealAreas } from './render/real/RealAreas.js';
import { AREA_DEFS } from './world/areaDefs.js';
import { prefetch } from './core/chunks.js';
import { LANE_BOSS } from './world/lane/layout.js';
import { ScreenWipe } from './ui/ScreenWipe.js';

const params = new URLSearchParams(location.search);
const TEST = params.has('test');
// The menus before play: the title card (or the face screen with ?face=1; none with ?test /
// ?skipTitle).
const MENUS = menuPlan(location.search);

const START_LIVES = 4;
// Ticks of the camera fly-in (CameraController INTRO_TICKS = 96) before Pip starts his
// ~32-tick drop from INTRO_DROP, so he lands just as the camera settles behind him.
const INTRO_HOLD_TICKS = 60;
// How long the switch into (and out of) AI RACE mode takes.
const DARK_FADE_SECONDS = 3;
// How long the boot waits at most for the realistic look's workers to start (ms).
const WORKERS_WAIT = 1000;

async function start() {
  const container = document.getElementById('game');
  const uiRoot = document.getElementById('ui');

  const events = new Events();
  const input = new Input(window);
  const view = new N64Renderer(container);
  view.alignOverlay(uiRoot); // HUD and title follow the picture when F3 pillarboxes it to 4:3
  const { scene, camera } = view;
  // Areas with a realistic look (Sparrow Lane: render/real/*), on this device's tier; ?look=classic
  // keeps them classic, as does G in the game (this session). Its workers start on the looks'
  // textures and geometry at once: the boot waits until they run (a worker starts only while
  // this thread is free), so they work beside the rest of it.
  const real = new RealAreas({ view, search: location.search, test: TEST });
  await Promise.race([real.prefetch(AREA_DEFS), new Promise((resolve) => setTimeout(resolve, WORKERS_WAIT))]);
  // The areas' lazy chunks of movers (Sparrow Lane's bins, through the lane's chunk) start
  // loading too, long before a door.
  for (const def of Object.values(AREA_DEFS)) def.boss?.load().catch(() => {});

  const level = buildLevel(scene);
  view.setWaterLevelFn((x, z) => level.collision.waterLevelAt(x, z));
  const player = new Player({ collision: level.collision, events, spawn: level.spawn });
  const model = new PlayerModel();
  const pivot = new ScalePivot(); // where his model is scaled about (poseHero)
  scene.add(model.object3D);
  view.addRealActor(model.object3D, model.shadow.mesh); // (he casts a realistic look's shadow)

  const cam = new CameraController({ collision: level.collision, camera, events });
  const shake = new CameraShake(events); // jolts the view on 'hallImpact' (server halls landing)
  const audio = new AudioEngine(events);
  if (params.has('mute')) audio.muted = true;
  // Rain, lightning, fire and explosions (AI RACE mode); objects use it for fireball impacts.
  const fx = new Effects({ scene, events, collision: level.collision, layout: level.layout });
  const objects = new ObjectManager({ scene, collision: level.collision, events, layout: level.layout, player, fx, level });
  // AI RACE's 40-second clock: not stopped in time, the sky catches fire and the world burns
  // white (it listens to 'darkMode'; ticked below while playing; its 'over' ends the game).
  const meltdown = new Meltdown({ events, targets: { view, level, fx, audio, shake }, trees: level.trees });
  // The wipe between areas, under the HUD (added to the root first).
  const wipe = new ScreenWipe(uiRoot);
  const hud = new HUD(uiRoot, { events });
  // Sign dialogs: the Player enters 'reading' and emits 'signRead'; the box takes the input
  // until its last page, then Pip is released (the closing press never reaches him).
  const dialog = new DialogBox(uiRoot, { events });
  new AlertBanner(uiRoot, { events }); // flashes 'AI RACE' when the mode switches on (and the meltdown's warning)
  // On-screen controller on touch screens (?touch=1 forces it): feeds input.setTouchState.
  const touch = new TouchController({ input, events, view });
  // A phone on the same network as the controller, through the dev/preview server's relay
  // (absent on a static host: the panel and its entry points then stay hidden).
  const remotePad = new RemotePad({ input, events });
  const phone = new PhonePanel(uiRoot, {
    remotePad,
    events,
    hud,
    canOpen: () => (state.mode === 'title' && !state.choosing) || (state.mode === 'play' && state.paused),
  });
  if (!TEST || params.get('pad') === '1') remotePad.start();
  // V records a 1920x1080 video of the picture, the UI and the sound, 9 a 1080x1920 portrait
  // one (ui/Recorder.js): while it records, the renderer frames the picture 16:9 or 9:16 and
  // calls it after every view.render().
  const recorder = new Recorder({ view, uiRoot, audio });
  fullscreenKey(); // F: the whole screen (ui/fullscreen.js)
  events.on('dialogClosed', () => {
    player.endReading?.();
    input.flush();
  });

  const state = {
    mode: 'title', // 'title' | 'face' | 'play' | 'gameover'
    choosing: false, // the game choice shows (before the title card, in mode 'title')
    frame: 0, // simulated (unpaused) ticks
    time: 0, // simulation clock in seconds; stands still while paused
    paused: false,
    started: false,
    lives: START_LIVES,
    gameOverPending: false, // a life was lost at x0: game over once the death plays out
    gameOvers: 0,
    dropHold: 0, // ticks Pip still waits (hidden, frozen) before dropping in
    held: false, // an area's cinematic holds him (Sparrow Lane's boss's intro)
    dark: false, // AI RACE mode requested (the button was ground-pounded)
    darkT: 0, // its crossfade, 0 = sunny grounds .. 1 = storm (eased over DARK_FADE_SECONDS)
  };
  let lastAction = player.action;
  // The areas (the grounds, the Great Hall, the courses): walking through a door, GAME OVER's
  // way back. A warp waits for plain play: not in AI RACE (the storm stays on the grounds), nor
  // while the meltdown runs (nor while a dialog is up: AreaSwitch sees to that itself).
  const areas = new AreaSwitch({
    scene,
    view,
    events,
    input,
    player,
    cam,
    hud,
    dialog,
    defs: AREA_DEFS,
    grounds: { level, objects },
    canWarp: () => state.mode === 'play' && !state.dark && state.darkT === 0 && !meltdown.running,
    onSwap: () => {
      lastAction = player.action; // an arrival (even one dropping in) is no respawn
    },
    real,
    boss: true, // (an area's lazy chunk: Sparrow Lane's bins)
  });
  // The pause legend's look row: in a course with a realistic look, drawn so or classic by choice.
  const lookRow = () => (view.look ? 'real' : areas.current.def.real && real.reason === 'chosen' ? 'classic' : null);
  // Sparrow Lane's robot fight, normal or easy (LANE_BOSS.easy: its chunk follows it): on the
  // pause screen there, Z toggles it, remembered on this device.
  const EASY = 'jonas.robotEasy';
  try {
    LANE_BOSS.easy = localStorage.getItem(EASY) === '1';
  } catch {
    // (No storage: normal.)
  }
  const robotRow = () => (areas.current.def.boss ? LANE_BOSS.easy : null);
  // G: "Classic street", the realistic look off (or back on) for this session.
  window.addEventListener('keydown', (e) => {
    if (e.code !== 'KeyG' || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    areas.setClassic(!real.classic);
    hud.setLook(lookRow());
  });
  let face = null; // the face screen while it shows
  const inMenu = () => state.mode === 'title' || state.mode === 'face';

  events.on('lifeLost', () => {
    if (state.lives === 0) state.gameOverPending = true;
    else state.lives--;
  });
  events.on('oneUp', () => {
    state.lives++;
  });

  // AI RACE mode: the objects' floor button toggles it; every system fades with darkT. Past
  // the meltdown's point of no return (the picture all white) nothing switches it off (the
  // button is dead by then); until then STOP rescues the world.
  events.on('aiRaceButton', ({ on }) => {
    if (!on && meltdown.doomed) return;
    // AI RACE stays on the grounds: not in another area (a test's setDark in the hall), nor while
    // a warp is under way (it could carry the storm through the door).
    if (on && (areas.name !== 'grounds' || areas.busy)) return;
    state.dark = on;
    events.emit('darkMode', { on });
  });
  // Rustmaw thrown off the roof and wrecked: the mode ends as if STOP was pressed (the storm
  // clears over the usual fade, the button pops back up; objects put the reward star out).
  // Too late once the picture is all white: the meltdown goes on.
  events.on('bossDefeated', () => {
    if (!state.dark || meltdown.doomed) return;
    state.dark = false;
    events.emit('darkMode', { on: false });
  });
  // The game choice (ui/ChoiceScreen.js, before the title card): with the AI RACE button on the
  // lawn, or without it (then nothing can start AI RACE). Remembered in the browser; the button
  // appears or vanishes behind the screen as the choice moves.
  let aiRace = loadRaceChoice();
  objects.setAiRaceButton(aiRace);
  events.on('aiRaceChoice', ({ on }) => {
    aiRace = on;
    objects.setAiRaceButton(on);
    saveRaceChoice(on);
  });
  function applyDarkness(t) {
    level.setDarkness(t);
    view.setDarkness?.(t);
    fx.setRain(t);
    objects.setDarkness?.(t);
  }

  // The game choice, then the title card, over a slow orbit of the grounds; resolves when the
  // player presses start. Until play starts, objects.animate() runs the objects' ambient clock
  // from `sec` itself (birds and butterflies move, nothing can be picked up), also after
  // objects.reset().
  async function runTitle() {
    state.mode = 'title';
    hud.setVisible(false);
    model.object3D.visible = false;
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
    // With or without AI RACE first (its picks arrive as 'aiRaceChoice'): the phone panel waits.
    state.choosing = true;
    await new ChoiceScreen(uiRoot, { events, audio, aiRace }).show();
    state.choosing = false;
    await new TitleScreen(uiRoot, { events, audio, phone }).show();
    cancelAnimationFrame(raf);
    // Audio: TitleScreen unlocks on the start press, and AudioEngine's 'gameStart' handler
    // unlocks with sticky user activation (not after a gamepad-only start, which is no gesture).
  }

  // Pip's big stretchy face after the title card (ui/FaceScreen.js): the renderer draws its
  // own scene instead of the world (nothing here ticks or draws meanwhile); resolves once
  // Start has been pressed and released. The title track plays on until 'gameStart'.
  async function runFace() {
    state.mode = 'face';
    hud.setVisible(false);
    model.object3D.visible = false;
    face = new FaceScreen(uiRoot, { events, audio, view });
    await face.show();
    face = null;
  }

  // Begin play: with `intro`, the camera flies in and Pip drops in at the spawn.
  function startGame(intro) {
    phone.close();
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
    // Player.respawn() already put Pip above the spawn (the current area's respawn point:
    // on the grounds, facing the castle): snap the camera behind him (it would otherwise keep
    // the orbit yaw from where he died).
    cam.reset(player);
    return false;
  }

  // GAME OVER card over the frozen world (audio plays its jingle on 'gameOver'), then a fresh
  // world behind the title: back on the grounds from whatever area, the new game's pickups,
  // stars and counters are back before the title shows, and play starts with 4 lives and 0
  // coins. Also the meltdown's end (the white held a second), whatever the lives left: a direct
  // "game over now".
  function gameOver() {
    if (state.mode === 'gameover') return;
    state.mode = 'gameover';
    state.gameOverPending = false;
    state.gameOvers++;
    hud.setPaused?.(false);
    dialog.close();
    events.emit('gameOver');
    const card = new GameOverCard(uiRoot).show();
    setTimeout(async () => {
      card.remove();
      areas.enter('grounds', 'start'); // back on the grounds from any area, before their reset
      areas.resetCourses(); // every area built so far gets its pickups and star back
      objects.reset(); // also takes the star it awarded back off player.stars
      meltdown.reset(); // the sky, grade, white-out, embers, light and sounds all off, clock stopped
      if (state.dark || state.darkT > 0) {
        state.dark = false;
        state.darkT = 0;
        events.emit('darkMode', { on: false });
      }
      applyDarkness(0);
      fx.clearFires();
      level.clearScorches();
      level.clearCircuits();
      player.coins = 0;
      state.lives = START_LIVES;
      await runTitle();
      if (MENUS.face) await runFace();
      startGame(true);
    }, GAME_OVER_SECONDS * 1000);
  }

  function tick(controller) {
    if (state.mode !== 'play') return;
    if (phone.isOpen) {
      phone.update(controller); // the phone panel over the pause screen: Start / B close it
      return;
    }
    if (controller.START.pressed && !areas.busy) {
      state.paused = !state.paused;
      // A course's way out is offered (the pause screen's line, the touch B kept bright) only
      // while it can be taken: not while Jonas dies or drops in (nothing changes while paused).
      const leave = state.paused && areas.canLeave();
      hud.setLeave?.(leave);
      hud.setLook?.(lookRow());
      hud.setRobot?.(robotRow());
      hud.setPaused?.(state.paused);
      events.emit(state.paused ? 'pause' : 'unpause', { leave });
    }
    // Paused in a course, B leaves it (the pause screen's "Leave course" line; a sign he was
    // reading closes first): play goes on under the wipe back out of the bottle.
    if (state.paused) {
      if (controller.B.pressed && areas.canLeave()) {
        state.paused = false;
        hud.setPaused?.(false);
        events.emit('unpause');
        areas.leave();
      } else if (controller.Z.pressed && robotRow() !== null) {
        LANE_BOSS.easy = !LANE_BOSS.easy;
        try {
          localStorage.setItem(EASY, LANE_BOSS.easy ? '1' : '0');
        } catch {
          // (Kept for this visit only.)
        }
        hud.setRobot?.(LANE_BOSS.easy);
        events.emit('sfx', { name: 'menu_select' });
      }
      return;
    }
    state.time += FRAME_DT;
    const darkGoal = state.dark ? 1 : 0;
    if (state.darkT !== darkGoal) {
      const step = FRAME_DT / DARK_FADE_SECONDS;
      state.darkT = darkGoal > state.darkT ? Math.min(1, state.darkT + step) : Math.max(0, state.darkT - step);
      applyDarkness(state.darkT);
    }
    // AI RACE's clock (counts only here: while playing, not paused). Its white held: game over.
    if (meltdown.update(camera.position, cam.getYaw()) === 'over') {
      gameOver();
      return;
    }
    if (dialog.isOpen) {
      dialog.update(controller);
      controller = neutralController(); // Pip and the camera wait while the box is up
    }
    // Sparrow Lane's boss's intro holds Jonas and the camera (its own shot shows it); keys held
    // through it are not fresh presses after.
    if (areas.objects.cinematic) {
      controller = neutralController();
      state.held = true;
    } else if (state.held) {
      state.held = false;
      input.flush();
    }
    // Walking through a door: the transition scripts the stick while the wipe closes and opens.
    controller = areas.step(controller);
    if (state.dropHold > 0) {
      state.dropHold--; // Pip waits above the spawn; input is ignored
    } else {
      // The camera withholds movement input while in first-person look mode. (An area's camera
      // may hold the stick's frame through its cuts: the lane's store room, cam.overlay.moveYaw.)
      player.update(cam.playerInput(controller), cam.overlay?.moveYaw ?? cam.getYaw());
    }
    if (player.action !== lastAction) {
      // Damage, death or a respawn can end a read early: take the box down with it.
      if (lastAction === 'reading' && dialog.isOpen) dialog.close();
      lastAction = player.action;
      if (lastAction === 'spawn' && onRespawn()) return;
    }
    // The current area's objects; while a warp runs (areas.busy) its critters hold their strikes.
    areas.objects.update({ player, frame: state.frame, camera: cam, warping: areas.busy });
    cam.overlay = areas.objects.cameraOverlay ?? null; // (the lane's boss's intro shot)
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
  // Pose the hero model; its own clocks (pose blends, blinks, wing flaps) run by dt while playing.
  // Drawn smaller (a realistic look's view.heroScale), the model is scaled about his grip (his
  // hands on a ledge's lip: player/model/scalePivot.js), not his feet.
  function poseHero(dt) {
    const running = state.mode === 'play' && !state.paused;
    const rs = player.getRenderState(renderAlpha);
    pivot.shift(rs, model.object3D.scale.y, player, running ? dt : 0);
    model.update(rs, running ? dt : 0); // pause freezes them too
  }
  function draw(dt) {
    // (Shrinking into the bottle; and a realistic look's size for him, Sparrow Lane's 0.85.)
    model.object3D.scale.setScalar(areas.heroScale(renderAlpha) * view.heroScale);
    poseHero(dt);
    const step = areas.heroOffset(renderAlpha); // (stepping into a door's opening)
    model.object3D.position.x += step.x;
    model.object3D.position.z += step.z;
    model.object3D.visible = state.mode === 'play' && state.dropHold === 0 && !cam.hideHero;
    cam.apply(renderAlpha);
    shake.apply(camera, state.mode === 'play' && !state.paused ? dt : 0);
    view.setFocus(model.object3D.position); // (a realistic look's shadow box follows him)
    // The pause legend's look row follows the look (it may swap in, built, while paused).
    if (state.paused && hud.look !== lookRow()) hud.setLook?.(lookRow());
    areas.update(state.time, camera, renderAlpha); // the current area's world (a door swinging)...
    areas.objects.animate(state.time, renderAlpha, camera); // ...and objects
    fx.update(state.mode === 'play' && !state.paused ? dt : 0, state.time, camera);
    audio.update?.(dt);
    wipe.draw(areas.wipe(renderAlpha), model.object3D.position, camera, model.object3D.scale.y);
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
    fx,
    meltdown, // AI RACE's 40-second clock (fx/Meltdown.js): meltdown.skipTo(seconds), .phase, .levels
    areas, // core/AreaSwitch.js: .current, .phase, .buildMs, .get(name)
    wipe,
    shake,
    touch,
    remotePad,
    phone,
    recorder,
    get face() {
      return face; // the FaceScreen while it shows (test hooks: see ui/FaceScreen.js), else null
    },
    get area() {
      return areas.name; // the area Jonas is in: 'grounds' | 'hall' | 'skerries' | 'lane'
    },
    // Sparrow Lane's lazy chunk attached to its objects (a promise: { bins }, or null when the
    // lane is not built yet or the chunk did not load).
    get laneBoss() {
      return areas.bossOf('lane');
    },
    // Switch area at once (no wipe), at an entry (default: its respawn entry), then draw.
    enterArea(name, entry) {
      const ok = areas.enter(name, entry);
      draw(0);
      return ok;
    },
    // Switch AI RACE mode directly (tests / debugging), as the floor button does.
    setDark(on) {
      events.emit('aiRaceButton', { on });
    },
    // Advance n simulation ticks with a fixed controller state (partial, like setOverride),
    // then draw once. The hero model is posed after every tick, as a 30 fps real-time run
    // would, so after a big step its pose blends, blinks and wing flaps have caught up instead of
    // showing the pose from before the step blended by a single 1/30 s frame. until(): checked
    // before each tick, true stops early (a scripted run up to a moment).
    step(n = 1, controllerState = null, until = null) {
      renderAlpha = 1;
      for (let i = 0; i < n; i++) {
        if (until?.()) break;
        input.setOverride(controllerState ?? {});
        tick(input.poll());
        if (i < n - 1 && !inMenu()) poseHero(FRAME_DT); // draw() poses the last
        // Effects (rain, fires, blasts) advance every tick too, not once per batch.
        if (i < n - 1 && state.mode === 'play' && !state.paused) fx.update(FRAME_DT, state.time, camera);
      }
      input.setOverride(null);
      if (!inMenu()) draw(FRAME_DT);
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
        area: areas.name,
        // A transition under way: { phase, to, entry, kind }, else null.
        warp: areas.warp && { phase: areas.phase, to: areas.warp.to, entry: areas.warp.entry, kind: areas.warp.kind },
      };
    },
    neutralController,
  };

  // The areas' code (each a lazy chunk: src/core/chunks.js; the lane's is on its way since boot):
  // a test waits for all of it (window.__game.enterArea switches at once), ?area= for its own;
  // play fetches it in the background from the title's first frames on, one at a time (a door
  // still waits behind the covered screen for an area not in yet: core/AreaSwitch.js).
  if (TEST) await Promise.all(Object.keys(AREA_DEFS).map((name) => areas.load(name)));
  else {
    if (params.has('area')) await areas.load(params.get('area'));
    requestAnimationFrame(() => prefetch(['lane', 'hall', 'skerries'], (name) => areas.load(name)));
  }

  cam.reset(player);
  if (!MENUS.title && !MENUS.face) {
    startGame(false);
    if (params.has('area')) areas.enter(params.get('area'), params.get('entry') ?? undefined);
  } else {
    if (MENUS.title) await runTitle();
    if (MENUS.face) await runFace();
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
    if (inMenu()) {
      acc = 0; // the title loop / face screen draws; the simulation waits
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
