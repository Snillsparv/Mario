// N64-style trailing follow camera ("an invisible camera operator").
//
// Default ('follow') mode: orbits the hero at ~1250 units, pitched ~8 deg down at a point
// 150 units above the hero's feet, with the view aimed ~7 deg above that point so the hero
// stands in the lower middle of the screen under the castle and the sky (see cameraConfig:
// aim). Nothing is rigidly attached to the hero:
//   * lag      - the orbit centre eases toward the hero (the look point more tightly), so the
//                hero pulls away a little when it sets off and the camera drifts to a stop;
//   * leash    - the camera stays where it is and only re-establishes its distance, so a
//                hero running sideways circles the camera, and one running toward it makes
//                it back up;
//   * swing    - while the hero moves, the yaw eases slowly toward the hero's back (speed
//                proportional, capped, fading out when the hero faces the camera);
//   * vertical - a jump does not lift the camera until the hero leaves a band around the
//                take-off height; it catches up once the hero lands.
// Standing still, the view tilts up a little more after a moment (the resting view: the castle
// and the sky over the hero, as in the classic opening shot; see cameraConfig REST_*).
// C-left/right rotate the orbit by 45 deg over 6 ticks, C-down/up zoom (C-up from the close
// step enters first-person look while the hero stands still), R toggles the tighter 'hero'
// camera, mouse drag orbits.
// CameraCollider keeps the result out of walls, terrain and water, and rises over a crest
// that hides the hero's feet (crest.js). A swimmer under a low cover (the drawbridge deck)
// takes the camera under the surface with it (cover.js), one hidden round a corner of the island
// turns it along the moat (swimSight.js); the star celebration swings round to the hero's front
// (celebration.js).
//
// update() runs at 30 Hz and keeps the previous tick so apply(alpha) can interpolate.
// Besides the contract (reset/update/apply/getYaw/startIntro/titleOrbit) the game reads:
//   cam.firstPerson          first-person look is active
//   cam.playerInput(c)       controller to pass to player.update() (stick and A/B/Z withheld
//                            while first-person look uses them, so the hero stands still)
//   cam.hideHero             the hero model should not be drawn (first person, or no room)
//   cam.underwater           the rendered camera position is below the water surface
// and apply() publishes camera.userData.focus: the interpolated point LOOK_HEIGHT above the
// hero's feet (null while there is no hero to keep in view: first person, title, intro), which
// the props' foliage fade uses to find the hero.

import * as THREE from 'three';
import { FLOOR_LOWER_LIMIT, NO_WATER } from '../core/constants.js';
import { angleDiff, clamp, smoothstep, wrapAngle } from '../core/math.js';
import { neutralController } from '../core/input.js';
import { CameraCollider } from './CameraCollider.js';
import { Celebration } from './celebration.js';
import { Cover } from './cover.js';
import { SwimSight } from './swimSight.js';
import { introPose, makeIntroPath, smootherstep, titleOrbitPose } from './cinematics.js';
import * as layout from '../world/layout.js';
import * as K from './cameraConfig.js';

const NEUTRAL = neutralController();
const ZERO = { x: 0, y: 0, z: 0 };

export class CameraController {
  constructor({ collision, camera, events }) {
    this.collision = collision;
    this.camera = camera;
    this.events = events;
    this.collider = new CameraCollider(collision);

    this.pos = new THREE.Vector3(); // this tick's camera pose (what apply() interpolates)
    this.target = new THREE.Vector3();
    this.prevPos = new THREE.Vector3();
    this.prevTarget = new THREE.Vector3();
    this.pivot = new THREE.Vector3(); // lagging orbit centre
    this.look = new THREE.Vector3(); // orbit look point (tighter lag than the pivot)
    this.anchor = new THREE.Vector3(); // unobstructed orbit position (drives the leash)

    this.mode = 'follow'; // 'follow' | 'hero' | 'first_person' | 'intro'
    this.orbitMode = 'follow'; // orbit mode to return to after first-person / intro
    this.zoom = 0;
    this.yaw = Math.PI; // orbit yaw: direction from the hero to the camera
    this.dist = K.ORBIT_MODES.follow.dist[0];
    this.basePitch = K.ORBIT_MODES.follow.pitch[0];
    this.aimPitch = K.ORBIT_MODES.follow.aim[0]; // eased configured aim above the look point
    this.aimRise = 0; // eased total aim (radians) of the rendered target above the look point...
    this.aimFresh = true; // ...set outright on the next tick (after a reset or teleport)
    this.restAim = 0; // eased extra aim of the resting view (cameraConfig REST_*)...
    this.restTicks = 0; // ...ticks the hero has stood still
    this.pitchOffset = 0; // mouse drag
    this.squeezePitch = 0; // extra tilt while walls push the camera in
    this.slideRate = 0; // eased yaw rate of the wall slide
    this.focusY = 0; // lagged feet height the camera frames
    this.tween = null; // pending C-button rotation { delta, t }
    this.fp = { yaw: 0, pitch: 0 };
    this.blend = null; // cross-fade { pos, target, t } for mode switches
    this.intro = null;
    this.lookYaw = 0;
    this.underwater = false;
    this.cover = new Cover(collision, this.collider); // swimmer under a low deck (cover.js)
    this.star = new Celebration(this.collider); // star celebration swing (celebration.js)
    this.swimSight = new SwimSight(collision, this.collider); // swimmer round a corner (swimSight.js)
    this.titleShot = false; // the title orbit is on screen (no hero)

    this.hero = {
      x: 0, y: 0, z: 0, velX: 0, velY: 0, velZ: 0, speed: 0, faceYaw: 0, action: '',
      grounded: true, onPole: false, inWater: false, submerged: false, covered: false,
    };
    // Hero feet last tick and this tick (the published focus is interpolated between them).
    this._heroPrev = { x: 0, y: 0, z: 0 };
    this._heroNow = { x: 0, y: 0, z: 0 };
    this._focus = { x: 0, y: 0, z: 0 }; // camera.userData.focus (one object, reused)
    this._waterPrev = NO_WATER; // water level at last tick's and this tick's pose
    this._waterNow = NO_WATER;
    this.cut = false; // this tick's pose must not be interpolated from the previous one
    this._tmp = new THREE.Vector3();
  }

  // ------------------------------------------------------------------ public API

  get firstPerson() {
    return this.mode === 'first_person';
  }

  // The star celebration's swing ({ ..., returning }), or null.
  get celebration() {
    return this.star.state;
  }

  // The camera sits at the hero's eye (first person) or found no room outside its head.
  get hideHero() {
    return (this.firstPerson && !this.blend) || this.collider.insideHero;
  }

  // Controller the hero should see this tick: first-person look takes over the stick and the
  // action buttons (A/B also leave it), so the hero stands still.
  playerInput(controller) {
    if (!this.firstPerson) return controller;
    return { ...controller, stickX: 0, stickY: 0, stickMag: 0, A: NEUTRAL.A, B: NEUTRAL.B, Z: NEUTRAL.Z };
  }

  // Yaw the camera looks along (camera -> target) for stick-relative movement.
  getYaw() {
    return this.lookYaw;
  }

  // Snap behind the hero (level start, respawn), or to the nearest open side if walled in.
  reset(player) {
    this.hero.submerged = false;
    this.cover.ticks = 0;
    const hero = this._readHero(player, true);
    this._heroPrev.x = this._heroNow.x = hero.x;
    this._heroPrev.y = this._heroNow.y = hero.y;
    this._heroPrev.z = this._heroNow.z = hero.z;
    this.cover.reset(hero.covered);
    this.star.reset();
    this.swimSight.reset();
    this.titleShot = false;
    this.mode = this.orbitMode;
    this.zoom = 0;
    this.tween = null;
    this.blend = null;
    this.intro = null;
    this.pitchOffset = 0;
    this.squeezePitch = 0;
    this.slideRate = 0;
    const cfg = K.ORBIT_MODES[this.orbitMode];
    this.dist = cfg.dist[0];
    this.basePitch = cfg.pitch[0];
    this.aimPitch = cfg.aim[0];
    this.restTicks = K.REST_DELAY; // a hero placed standing starts in the resting view
    this.restAim = this._resting(hero) ? K.REST_AIM : 0;
    this.focusY = hero.y;
    this._snapToHero(hero);
    this.cover.updateCap(hero, this.look.y, this.dist);
    this.collider.reset();
    this._setOrbitYaw(this.collider.openYaw(this.look, hero.faceYaw + Math.PI, this._orbitPitch(), this.dist));
    this._updateOrbit(NEUTRAL, hero);
    this._finishTick(true);
  }

  update(controller, player) {
    const c = controller || NEUTRAL;
    const hero = this._readHero(player);
    if (!Number.isFinite(hero.x + hero.y + hero.z)) return;
    const hp = this._heroPrev;
    const hn = this._heroNow;
    hp.x = hn.x;
    hp.y = hn.y;
    hp.z = hn.z;
    hn.x = hero.x;
    hn.y = hero.y;
    hn.z = hero.z;
    this.titleShot = false;
    this.prevPos.copy(this.pos);
    this.prevTarget.copy(this.target);
    this.cut = false;

    if (this.mode === 'intro') {
      this._updateIntro(hero);
    } else {
      this._handleButtons(c, hero);
      if (this.mode === 'first_person') this._updateFirstPerson(c, hero);
      else this._updateOrbit(c, hero);
    }
    this._applyBlend(hero);
    this._finishTick(this.cut);
  }

  // Render-time interpolation between the last two ticks.
  apply(alpha = 1) {
    const a = clamp(alpha, 0, 1);
    const cam = this.camera;
    cam.position.lerpVectors(this.prevPos, this.pos, a);
    this._tmp.lerpVectors(this.prevTarget, this.target, a);
    cam.lookAt(this._tmp);
    if (cam.fov !== K.FOV) {
      cam.fov = K.FOV;
      cam.updateProjectionMatrix();
    }
    // (The water level at the two tick poses, not a fresh query: no per-frame garbage.)
    const w0 = this._waterPrev;
    const w1 = this._waterNow;
    const w = w0 === NO_WATER || w1 === NO_WATER ? (a < 0.5 ? w0 : w1) : w0 + (w1 - w0) * a;
    this.underwater = w !== NO_WATER && cam.position.y < w;
    // camera.userData.focus (see top): LOOK_HEIGHT above the hero's interpolated feet, or null.
    // (Inline: a helper taking `a` would box it on every call.)
    const ud = cam.userData;
    if (!ud) return;
    if (this.titleShot || this.mode === 'intro' || this.mode === 'first_person') {
      ud.focus = null;
      return;
    }
    const p = this._heroPrev;
    const n = this._heroNow;
    const f = this._focus;
    f.x = p.x + (n.x - p.x) * a;
    f.y = p.y + (n.y - p.y) * a + K.LOOK_HEIGHT;
    f.z = p.z + (n.z - p.z) * a;
    ud.focus = f;
  }

  // Cinematic fly-in from above the castle to behind the hero's spawn (~3 s).
  startIntro(player) {
    this.reset(player);
    const hero = this.hero;
    const floor = this.collision.findFloor(hero.x, hero.y, hero.z).y;
    const spawn = { x: hero.x, y: floor > FLOOR_LOWER_LIMIT ? floor : hero.y, z: hero.z };
    this.focusY = spawn.y;
    this.intro = { t: 0, path: makeIntroPath(layout, spawn) };
    this.mode = 'intro';
    this._updateIntro(hero);
    this._finishTick(true);
  }

  // Slow orbit of the castle grounds behind the title screen.
  titleOrbit(timeSeconds) {
    titleOrbitPose(layout, timeSeconds, this.pos, this.target);
    this.titleShot = true;
    this._finishTick(true);
  }

  // ------------------------------------------------------------------ input

  _handleButtons(c, hero) {
    if (this.mode === 'first_person') {
      if (c.CD.pressed || c.A.pressed || c.B.pressed || !this._canLook(hero)) this._exitFirstPerson(hero);
      return;
    }
    if (this.star.state) {
      // The camera buttons wait for the dance; during the swing back they take over.
      if (this.star.holdsButtons) return;
      if (c.R.pressed || c.CL.pressed || c.CR.pressed || c.CD.pressed || c.CU.pressed || c.mouseDX || c.mouseDY) {
        this.star.cancel();
      }
    }
    if (c.R.pressed) {
      this.orbitMode = this.mode = this.mode === 'follow' ? 'hero' : 'follow';
      this._sfx('camera_move');
    }
    if (c.CL.pressed) this._rotate(-1);
    if (c.CR.pressed) this._rotate(1);
    if (c.CD.pressed) {
      if (this.zoom < K.ORBIT_MODES[this.mode].dist.length - 1) {
        this.zoom++;
        this._sfx('camera_move');
      } else this._sfx('camera_buzz');
    }
    if (c.CU.pressed) {
      if (this.zoom > 0) {
        this.zoom--;
        this._sfx('camera_move');
      } else if (this._canLook(hero)) this._enterFirstPerson(hero);
      else this._sfx('camera_buzz');
    }
  }

  // First-person look is only available while the hero stands still on the ground.
  _canLook(hero) {
    return hero.grounded && !hero.inWater && hero.speed < K.MOVING_SPEED;
  }

  // Start a 45 deg orbit step (dir +1 = camera moves to its right), unless a wall is in the way.
  _rotate(dir) {
    const remaining = this.tween ? this.tween.delta * (1 - tweenEase(this.tween.t)) : 0;
    const delta = remaining + dir * K.C_ROTATE_STEP;
    const pitch = this._orbitPitch();
    const minDist = Math.max(K.C_BLOCK_MIN_DIST, this.dist * K.C_BLOCK_RATIO);
    if (this.collider.rotationBlocked(this.look, this.yaw + delta, pitch, this.dist, minDist)) {
      this._sfx('camera_buzz');
      return;
    }
    this.tween = { delta, t: 0 };
    this._sfx('camera_move');
  }

  // Glide from the orbit to the hand-over pose behind the head; _updateFirstPerson cuts to
  // the eye once the glide is done.
  _enterFirstPerson(hero) {
    this.mode = 'first_person';
    this.fp.yaw = hero.faceYaw;
    this.fp.pitch = K.FP_START_PITCH;
    this.tween = null;
    this._startBlend(this.pos, this.target);
    this._sfx('camera_move');
  }

  // Cut from the eye to the hand-over pose, then glide out to the orbit behind the view.
  _exitFirstPerson(hero) {
    const pos = new THREE.Vector3();
    const target = new THREE.Vector3();
    this._fpPose(hero, K.FP_HANDOVER_BACK, pos, target);
    this.mode = this.orbitMode;
    this.zoom = 0;
    this._snapToHero(hero);
    this._setOrbitYaw(this.fp.yaw + Math.PI);
    this._startBlend(pos, target);
    this.cut = true;
    this._sfx('camera_move');
  }

  // ------------------------------------------------------------------ modes

  _updateOrbit(c, hero) {
    const cfg = K.ORBIT_MODES[this.mode] || K.ORBIT_MODES[this.orbitMode];
    this._updateFocus(hero);
    this._followHero(hero);

    // Leash: keep the yaw of where the camera already is relative to the orbit centre.
    const ax = this.anchor.x - this.pivot.x;
    const az = this.anchor.z - this.pivot.z;
    if (ax * ax + az * az > 1) this.yaw = Math.atan2(ax, az);

    // A swimmer under the deck or hidden round a corner: turn toward a clear view (the wall
    // slide and the swing behind the hero rest meanwhile).
    const tweening = !!this.tween;
    let turn = this.cover.steer(hero, this.yaw, this.pos, tweening);
    if (turn === null) turn = this.swimSight.steer(hero, this.yaw, this.pos, tweening);
    if (turn !== null) {
      this.yaw += turn;
      this.slideRate = 0;
    } else {
      this._swingBehind(cfg, hero);
      this._slideAlongWall(hero);
    }
    if (this.tween) {
      const t0 = tweenEase(this.tween.t);
      this.tween.t++;
      this.yaw += this.tween.delta * (tweenEase(this.tween.t) - t0);
      if (this.tween.t >= K.C_ROTATE_TICKS) this.tween = null;
    }
    this.yaw = wrapAngle(this.yaw - (c.mouseDX || 0) * K.MOUSE_YAW);
    this.pitchOffset += (c.mouseDY || 0) * K.MOUSE_PITCH;
    const celebrationYaw = this.star.update(hero, this.yaw);
    if (celebrationYaw !== null) {
      this.yaw = celebrationYaw;
      this.slideRate = 0;
    }
    const dancing = this.star.closeUp;
    if (dancing) this.tween = null;

    const zoom = Math.min(this.zoom, cfg.dist.length - 1);
    this.dist += ((dancing ? Math.min(cfg.dist[zoom], this.star.state.dist) : cfg.dist[zoom]) - this.dist) * K.ZOOM_RATE;
    this.basePitch += ((dancing ? K.CELEBRATE_PITCH : cfg.pitch[zoom]) - this.basePitch) * K.ZOOM_RATE;
    this.aimPitch += ((dancing ? K.CELEBRATE_AIM : cfg.aim[zoom]) - this.aimPitch) * K.ZOOM_RATE;
    this._updateRest(hero);
    // (Under cover the camera stays low, below the deck: no tilt over the walls.)
    const squeeze = hero.covered ? 0 : 1 - smoothstep(K.SQUEEZE_RANGE[0], K.SQUEEZE_RANGE[1], this.collider.ratio ?? 1);
    this.squeezePitch += (squeeze * K.SQUEEZE_PITCH - this.squeezePitch) * K.SQUEEZE_RATE;
    // Keep the stored mouse offset inside the range the total pitch can use.
    this.pitchOffset = clamp(this.pitchOffset, K.PITCH_MIN - this.basePitch, K.PITCH_MAX - this.basePitch);

    this.cover.ease(hero.covered);
    const lookY = this.focusY + K.LOOK_HEIGHT - this.cover.drop;
    this.cover.updateCap(hero, lookY, this.dist);
    const pitch = this._orbitPitch();
    this.look.y = this.pivot.y = lookY;
    const cp = Math.cos(pitch) * this.dist;
    this.anchor.set(
      this.pivot.x + Math.sin(this.yaw) * cp,
      lookY + Math.sin(pitch) * this.dist,
      this.pivot.z + Math.cos(this.yaw) * cp,
    );
    this.collider.resolve(this.look, this.anchor, hero, this.pos);
    this._aimTarget(hero);
  }

  // The rendered target: the look point, with the view aimed aimPitch above it plus whatever
  // the height limit lifted the camera by this tick (so it keeps the orbit's pitch over rising
  // ground). Fades out for steep orbits. The hero's feet never end up more than FEET_MAX_BELOW
  // below the view axis: the aim gives way first, and if the look point lags far above a
  // diving or falling hero the view tilts below it. Horizontal position unchanged (getYaw is
  // unaffected).
  _aimTarget(hero) {
    const pos = this.pos;
    const look = this.look;
    this.target.copy(look);
    const dx = look.x - pos.x;
    const dz = look.z - pos.z;
    const h = Math.sqrt(dx * dx + dz * dz);
    if (h < 1) return;
    const v = pos.y - look.y;
    const toLook = Math.atan2(v, h); // > 0: the camera looks down at the look point
    const lifted = this.collider.heightLift || 0;
    const orbit = lifted > 0 ? Math.atan2(v - lifted, h) : toLook; // pitch before that lift
    const fx = hero.x - pos.x;
    const fz = hero.z - pos.z;
    const toFeet = Math.atan2(pos.y - hero.y, Math.max(1, Math.sqrt(fx * fx + fz * fz)));
    const feetRoom = toLook - toFeet; // rise that would put the feet on the view axis
    const goal = Math.min(
      (this.aimPitch + this.restAim + toLook - orbit) * (1 - smoothstep(K.AIM_FADE[0], K.AIM_FADE[1], orbit)),
      feetRoom + K.FEET_MAX_BELOW,
    );
    // Eased (the lift and the feet limit switch in with kinks), hard-limited so the feet stay in frame.
    if (this.aimFresh) this.aimRise = goal;
    else this.aimRise += (goal - this.aimRise) * K.AIM_RATE;
    this.aimFresh = false;
    const rise = Math.min(this.aimRise, feetRoom + K.FEET_HARD_BELOW);
    if (rise === 0) return;
    this.target.y = pos.y - h * Math.tan(clamp(toLook - rise, -K.AIM_MAX_UP, K.AIM_MAX_DOWN));
  }

  // Resting view (cameraConfig REST_*): eases restAim in once the hero has stood still on the
  // ground (or drops into the spawn) for REST_DELAY ticks, and out as soon as it moves, jumps,
  // swims, holds a pole or ledge, or dances for a star (that close-up has its own framing).
  _updateRest(hero) {
    this.restTicks = this._resting(hero) ? this.restTicks + 1 : 0;
    const goal = this.restTicks > K.REST_DELAY ? K.REST_AIM : 0;
    this.restAim += (goal - this.restAim) * (goal > this.restAim ? K.REST_IN_RATE : K.REST_OUT_RATE);
  }

  _resting(hero) {
    if (hero.inWater || hero.speed >= K.MOVING_SPEED || this.star.state) return false;
    return hero.action === K.REST_ACTION || (hero.grounded && !K.ANCHORED_ACTION.test(hero.action));
  }

  // Horizontal follow lag of the orbit centre and the look point (teleports snap).
  _followHero(hero) {
    const dx = hero.x - this.pivot.x;
    const dz = hero.z - this.pivot.z;
    if (dx * dx + dz * dz > K.FOCUS_SNAP_DIST * K.FOCUS_SNAP_DIST) {
      this._snapToHero(hero);
      return;
    }
    this.pivot.x += dx * K.PIVOT_RATE;
    this.pivot.z += dz * K.PIVOT_RATE;
    this.look.x += (hero.x - this.look.x) * K.LOOK_RATE;
    this.look.z += (hero.z - this.look.z) * K.LOOK_RATE;
  }

  _snapToHero(hero) {
    this.pivot.set(hero.x, this.focusY + K.LOOK_HEIGHT - this.cover.drop, hero.z);
    this.look.copy(this.pivot);
    this.aimFresh = true;
  }

  _orbitPitch() {
    return this.cover.pitch(clamp(this.basePitch + this.pitchOffset + this.squeezePitch, K.PITCH_MIN, K.PITCH_MAX));
  }

  // Vertical framing with a jump band (see cameraConfig).
  _updateFocus(hero) {
    const dy = hero.y - this.focusY;
    if (Math.abs(dy) > K.FOCUS_SNAP_DIST) this.focusY = hero.y;
    else if (hero.grounded || hero.inWater) this.focusY += dy * K.FOCUS_CATCHUP;
    else if (dy > K.JUMP_BAND_UP) this.focusY += (dy - K.JUMP_BAND_UP) * K.BAND_FOLLOW_UP;
    else if (dy < -K.JUMP_BAND_DOWN) {
      this.focusY += (dy + K.JUMP_BAND_DOWN) * K.BAND_FOLLOW_DOWN;
      this.focusY = Math.min(this.focusY, hero.y + K.FALL_MAX_LAG);
    }
  }

  // Ease the orbit toward the hero's back while it moves (or holds a pole).
  _swingBehind(cfg, hero) {
    const d = angleDiff(this.yaw, hero.faceYaw + Math.PI);
    if (hero.onPole) {
      this.yaw += clamp(d * K.POLE_SWING_GAIN, -K.POLE_SWING_MAX, K.POLE_SWING_MAX);
      return;
    }
    if (hero.speed < K.MOVING_SPEED) return;
    const facing = 1 - smoothstep(cfg.faceCamera[0], cfg.faceCamera[1], Math.abs(d));
    const speed = Math.min(hero.speed / K.RUN_SPEED, 1.2);
    const air = hero.grounded || hero.inWater ? 1 : K.AIR_SWING_SCALE;
    const max = cfg.swingMax * speed * air;
    this.yaw += clamp(d * cfg.swingGain * speed * air * facing, -max, max);
  }

  // When a wall squeezes the camera in or hides the hero, slide the orbit along the wall
  // (while the hero moves, or always once badly squeezed). The rate is eased so it does not
  // switch on and off with the ray hits.
  _slideAlongWall(hero) {
    const wall = this.collider.blocker;
    const ratio = this.collider.ratio ?? 1;
    const pressure = Math.max(1 - ratio / K.WALL_SLIDE_START, this.collider.occluded ? K.OCCLUDED_SLIDE : 0);
    let goal = 0;
    const moving = hero.speed >= K.MOVING_SPEED || ratio < K.CRAMPED_RATIO;
    if (wall?.kind === 'wall' && pressure > 0 && !this.tween && moving) {
      const n = wall.hn;
      let tx = n.z;
      let tz = -n.x;
      if (tx * Math.sin(this.yaw) + tz * Math.cos(this.yaw) < 0) {
        tx = -tx;
        tz = -tz;
      }
      const d = angleDiff(this.yaw, Math.atan2(tx, tz));
      const max = K.WALL_SLIDE_MAX * pressure;
      goal = clamp(d * K.WALL_SLIDE_GAIN, -max, max);
    }
    this.slideRate += (goal - this.slideRate) * K.WALL_SLIDE_EASE;
    this.yaw += this.slideRate;
  }

  _updateFirstPerson(c, hero) {
    const fp = this.fp;
    fp.yaw = wrapAngle(fp.yaw - c.stickX * K.FP_TURN - (c.mouseDX || 0) * K.MOUSE_YAW);
    fp.pitch = clamp(fp.pitch - c.stickY * K.FP_PITCH_RATE + (c.mouseDY || 0) * K.MOUSE_PITCH, K.FP_PITCH_MIN, K.FP_PITCH_MAX);
    this.focusY = hero.y;
    // While gliding in, aim for the hand-over pose (_applyBlend cuts to the eye at the end).
    this._fpPose(hero, this.blend ? K.FP_HANDOVER_BACK : 0, this.pos, this.target);
  }

  // Eye just in front of the face looking along fp yaw/pitch; `back` > 0 moves it that far
  // behind (and a little above) the eye, clear of the head.
  _fpPose(hero, back, pos, target) {
    const fx = Math.sin(this.fp.yaw);
    const fz = Math.cos(this.fp.yaw);
    const forward = K.EYE_FORWARD - back;
    pos.set(hero.x + fx * forward, hero.y + K.EYE_HEIGHT + (back / K.FP_HANDOVER_BACK) * K.FP_HANDOVER_RISE, hero.z + fz * forward);
    const cp = Math.cos(this.fp.pitch) * K.FP_LOOK_DIST;
    target.set(pos.x + fx * cp, pos.y - Math.sin(this.fp.pitch) * K.FP_LOOK_DIST, pos.z + fz * cp);
  }

  _updateIntro(hero) {
    // The live orbit keeps running underneath so the fly-in lands exactly on it.
    this._updateOrbit(NEUTRAL, hero);
    const intro = this.intro;
    intro.t++;
    const t = Math.min(1, intro.t / K.INTRO_TICKS);
    // introPose reads each live component before writing it, so in-place output is safe.
    introPose(intro.path, t, this.pos, this.target, this.pos, this.target);
    if (t >= 1) {
      this.intro = null;
      this.mode = this.orbitMode;
    }
  }

  // ------------------------------------------------------------------ helpers

  _setOrbitYaw(yaw) {
    this.yaw = wrapAngle(yaw);
    this.anchor.set(this.pivot.x + Math.sin(this.yaw) * this.dist, this.pivot.y, this.pivot.z + Math.cos(this.yaw) * this.dist);
  }

  _startBlend(pos, target) {
    this.blend = { pos: pos.clone(), target: target.clone(), t: 0 };
  }

  _applyBlend(hero) {
    const b = this.blend;
    if (!b) return;
    b.t++;
    if (b.t >= K.BLEND_TICKS) {
      this.blend = null;
      // The glide into first person ends at the hand-over pose behind the head: cut to the eye.
      if (this.firstPerson) {
        this._fpPose(hero, 0, this.pos, this.target);
        this.cut = true;
      }
      return;
    }
    const k = smootherstep(b.t / K.BLEND_TICKS);
    this.pos.lerpVectors(b.pos, this.pos, k);
    this.target.lerpVectors(b.target, this.target, k);
  }

  _finishTick(snap) {
    if (snap) {
      this.prevPos.copy(this.pos);
      this.prevTarget.copy(this.target);
    }
    const dx = this.target.x - this.pos.x;
    const dz = this.target.z - this.pos.z;
    if (this.mode === 'first_person') this.lookYaw = this.fp.yaw;
    else if (dx * dx + dz * dz > 100) this.lookYaw = Math.atan2(dx, dz);
    else this.lookYaw = wrapAngle(this.yaw + Math.PI);
    const before = this._waterNow;
    this._waterNow = this.collision.waterLevelAt(this.pos.x, this.pos.z);
    this._waterPrev = snap ? this._waterNow : before;
    this.underwater = this._waterNow !== NO_WATER && this.pos.y < this._waterNow;
  }

  // Normalised snapshot of the fields the camera reads (all optional except pos). `placed`: the
  // hero was just placed (reset), so its water flag may still be stale.
  _readHero(player, placed = false) {
    const h = this.hero;
    const p = player.pos;
    const vel = player.vel || ZERO;
    h.x = p.x;
    h.y = p.y;
    h.z = p.z;
    h.faceYaw = Number.isFinite(player.faceYaw) ? player.faceYaw : 0;
    // Horizontal velocity: prefer vel, fall back to forwardVel along the facing.
    h.velX = vel.x || 0;
    h.velY = vel.y || 0;
    h.velZ = vel.z || 0;
    if (h.velX === 0 && h.velZ === 0 && player.forwardVel) {
      h.velX = Math.sin(h.faceYaw) * player.forwardVel;
      h.velZ = Math.cos(h.faceYaw) * player.forwardVel;
    }
    h.speed = Math.max(Math.abs(player.forwardVel || 0), Math.hypot(h.velX, h.velZ));
    h.action = player.action || '';
    const water = this.collision.waterLevelAt(p.x, p.z);
    const below = water !== NO_WATER && p.y < water;
    h.inWater = placed ? !!player.inWater || below : (player.inWater ?? below);
    const head = p.y + K.HEAD_HEIGHT;
    if (!h.inWater || water === NO_WATER || head > water + K.SUBMERGE_EXIT) h.submerged = false;
    else if (head < water - K.SUBMERGE_ENTER) h.submerged = true;
    h.covered = this.cover.track(p, h.inWater, this.pos); // a low deck over the swimmer

    const floorY = player.floor?.y ?? p.y;
    h.onPole = player.action === K.POLE_ACTION;
    const anchored = K.ANCHORED_ACTION.test(player.action || '');
    h.grounded = anchored || (!h.inWater && p.y - floorY < 10 && !((vel.y || 0) > 0));
    return h;
  }

  _sfx(name) {
    this.events?.emit('sfx', { name });
  }
}

// 0..1 progress of a C-button rotation after t ticks (cosine ease).
function tweenEase(t) {
  return 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, t / K.C_ROTATE_TICKS));
}
