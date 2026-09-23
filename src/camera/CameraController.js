// N64-style trailing follow camera ("an invisible camera operator").
//
// Default ('lakitu') mode: orbits the hero at ~1250 units, pitched ~17 deg down at a point
// 120 units above the hero's feet. Nothing is rigidly attached to the hero:
//   * lag      - the orbit centre eases toward the hero (the look point more tightly), so the
//                hero pulls away a little when it sets off and the camera drifts to a stop;
//   * leash    - the camera stays where it is and only re-establishes its distance, so a
//                hero running sideways circles the camera, and one running toward it makes
//                it back up;
//   * swing    - while the hero moves, the yaw eases slowly toward the hero's back (speed
//                proportional, capped, fading out when the hero faces the camera);
//   * vertical - a jump does not lift the camera until the hero leaves a band around the
//                take-off height; it catches up once the hero lands.
// C-left/right rotate the orbit by 45 deg over 6 ticks, C-down/up zoom (C-up from the close
// step enters first-person look while the hero stands still), R toggles the tighter 'hero'
// camera, mouse drag orbits.
// CameraCollider keeps the result out of walls, terrain and water.
//
// update() runs at 30 Hz and keeps the previous tick so apply(alpha) can interpolate.
// Besides the contract (reset/update/apply/getYaw/startIntro/titleOrbit) the game reads:
//   cam.firstPerson          first-person look is active
//   cam.playerInput(c)       controller to pass to player.update() (stick and A/B/Z withheld
//                            while first-person look uses them, so the hero stands still)
//   cam.hideHero             the hero model should not be drawn (first person, or no room)
//   cam.underwater           the rendered camera position is below the water surface

import * as THREE from 'three';
import { FLOOR_LOWER_LIMIT, NO_WATER } from '../core/constants.js';
import { angleDiff, clamp, smoothstep, wrapAngle } from '../core/math.js';
import { neutralController } from '../core/input.js';
import { CameraCollider } from './CameraCollider.js';
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

    this.mode = 'lakitu'; // 'lakitu' | 'hero' | 'first_person' | 'intro'
    this.orbitMode = 'lakitu'; // orbit mode to return to after first-person / intro
    this.zoom = 0;
    this.yaw = Math.PI; // orbit yaw: direction from the hero to the camera
    this.dist = K.ORBIT_MODES.lakitu.dist[0];
    this.basePitch = K.ORBIT_MODES.lakitu.pitch[0];
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

    this.hero = { x: 0, y: 0, z: 0, velX: 0, velY: 0, velZ: 0, speed: 0, faceYaw: 0, grounded: true, onPole: false, inWater: false, submerged: false };
    this.cut = false; // this tick's pose must not be interpolated from the previous one
    this._tmp = new THREE.Vector3();
  }

  // ------------------------------------------------------------------ public API

  get firstPerson() {
    return this.mode === 'first_person';
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

  // Snap behind the hero (level start, respawn).
  reset(player) {
    this.hero.submerged = false;
    const hero = this._readHero(player);
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
    this.focusY = hero.y;
    this._snapToHero(hero);
    this.collider.reset();
    this._setOrbitYaw(hero.faceYaw + Math.PI);
    this._updateOrbit(NEUTRAL, hero);
    this._finishTick(true);
  }

  update(controller, player) {
    const c = controller || NEUTRAL;
    const hero = this._readHero(player);
    if (!Number.isFinite(hero.x + hero.y + hero.z)) return;
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
    this.underwater = this._isUnderwater(cam.position);
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
    this._finishTick(true);
  }

  // ------------------------------------------------------------------ input

  _handleButtons(c, hero) {
    if (this.mode === 'first_person') {
      if (c.CD.pressed || c.A.pressed || c.B.pressed || !this._canLook(hero)) this._exitFirstPerson(hero);
      return;
    }
    if (c.R.pressed) {
      this.orbitMode = this.mode = this.mode === 'lakitu' ? 'hero' : 'lakitu';
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

    this._swingBehind(cfg, hero);
    this._slideAlongWall(hero);
    if (this.tween) {
      const t0 = tweenEase(this.tween.t);
      this.tween.t++;
      this.yaw += this.tween.delta * (tweenEase(this.tween.t) - t0);
      if (this.tween.t >= K.C_ROTATE_TICKS) this.tween = null;
    }
    this.yaw = wrapAngle(this.yaw - (c.mouseDX || 0) * K.MOUSE_YAW);
    this.pitchOffset += (c.mouseDY || 0) * K.MOUSE_PITCH;

    const zoom = Math.min(this.zoom, cfg.dist.length - 1);
    this.dist += (cfg.dist[zoom] - this.dist) * K.ZOOM_RATE;
    this.basePitch += (cfg.pitch[zoom] - this.basePitch) * K.ZOOM_RATE;
    const squeeze = 1 - smoothstep(K.SQUEEZE_RANGE[0], K.SQUEEZE_RANGE[1], this.collider.ratio ?? 1);
    this.squeezePitch += (squeeze * K.SQUEEZE_PITCH - this.squeezePitch) * K.SQUEEZE_RATE;
    // Keep the stored mouse offset inside the range the total pitch can use.
    this.pitchOffset = clamp(this.pitchOffset, K.PITCH_MIN - this.basePitch, K.PITCH_MAX - this.basePitch);
    const pitch = this._orbitPitch();

    const lookY = this.focusY + K.LOOK_HEIGHT;
    this.look.y = this.pivot.y = lookY;
    const cp = Math.cos(pitch) * this.dist;
    this.anchor.set(
      this.pivot.x + Math.sin(this.yaw) * cp,
      lookY + Math.sin(pitch) * this.dist,
      this.pivot.z + Math.cos(this.yaw) * cp,
    );
    this.collider.resolve(this.look, this.anchor, hero, this.pos);
    this.target.copy(this.look);
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
    this.pivot.set(hero.x, this.focusY + K.LOOK_HEIGHT, hero.z);
    this.look.copy(this.pivot);
  }

  _orbitPitch() {
    return clamp(this.basePitch + this.pitchOffset + this.squeezePitch, K.PITCH_MIN, K.PITCH_MAX);
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
  // (while moving). The rate is eased so it does not switch on and off with the ray hits.
  _slideAlongWall(hero) {
    const wall = this.collider.blocker;
    const ratio = this.collider.ratio ?? 1;
    const pressure = Math.max(1 - ratio / K.WALL_SLIDE_START, this.collider.occluded ? K.OCCLUDED_SLIDE : 0);
    let goal = 0;
    if (wall?.kind === 'wall' && pressure > 0 && !this.tween && hero.speed >= K.MOVING_SPEED) {
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
    this.underwater = this._isUnderwater(this.pos);
  }

  _isUnderwater(p) {
    const w = this.collision.waterLevelAt(p.x, p.z);
    return w !== NO_WATER && p.y < w;
  }

  // Normalised snapshot of the fields the camera reads (all optional except pos).
  _readHero(player) {
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
    const water = this.collision.waterLevelAt(p.x, p.z);
    h.inWater = player.inWater ?? (water !== NO_WATER && p.y < water);
    const head = p.y + K.HEAD_HEIGHT;
    if (!h.inWater || water === NO_WATER || head > water + K.SUBMERGE_EXIT) h.submerged = false;
    else if (head < water - K.SUBMERGE_ENTER) h.submerged = true;
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
