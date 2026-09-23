// The two trailing scarf tails: short chains of flat segments hanging from the back of the
// neck. Each frame the "wind" (the negated velocity of the neck: body velocity from the
// RenderState plus motion from the pose itself, e.g. flips and spins) and gravity are
// brought into torso space; every segment springs toward that direction, lower segments
// more loosely, so the tails lag, whip through somersaults and flutter at speed.

import * as THREE from 'three';
import { clamp } from '../../core/math.js';
import { paint } from './palette.js';

// [length, top width, bottom width] per segment, root first.
const TAILS = [
  { spread: -0.22, segs: [[10, 9, 8.4], [9.5, 8.4, 7.6], [8.5, 7.6, 6.2]] },
  { spread: 0.2, segs: [[9, 8.6, 8], [8.5, 8, 7.2], [7.5, 7.2, 5.8]] },
];
const STIFFNESS = [140, 90, 60]; // spring strength per segment (1/s^2), root is stiffest
const DAMPING = [16, 12, 10];
const WIND_SCALE = 1 / 420; // (units/s) -> relative to gravity (1)
const MIN_PITCH = 0.3; // keep the tails off the back of the tunic
const MAX_PITCH = 2.7;
const MAX_POSE_SPEED = 1500; // ignore pose-velocity spikes (blend snaps, teleports)

function segmentGeometry([len, w0, w1]) {
  const g = new THREE.BoxGeometry(1, len, 1.6).translate(0, -len / 2, 0);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setX(i, pos.getX(i) * (pos.getY(i) < -len / 2 ? w1 : w0));
  g.computeVertexNormals();
  return paint(g, 'scarf');
}

const tmpQ = new THREE.Quaternion();
const tmpV = new THREE.Vector3();
const wind = new THREE.Vector3();
const dir = new THREE.Vector3();

export class ScarfTails {
  // material: the rig's vertex-colour body material.
  constructor(torso, anchors, material) {
    this.torso = torso;
    this.anchor = anchors[0];
    this.prevRel = null;
    this.tails = TAILS.map((def, t) => {
      let parent = torso;
      const joints = def.segs.map((s, i) => {
        const j = new THREE.Group();
        j.rotation.order = 'XZY';
        if (i === 0) j.position.copy(anchors[t]);
        else j.position.y = -def.segs[i - 1][0];
        j.add(new THREE.Mesh(segmentGeometry(s), material));
        parent.add(j);
        parent = j;
        return j;
      });
      // Absolute (torso-space) angles and angular velocities per segment.
      const n = joints.length;
      return { def, joints, ax: new Float32Array(n).fill(MIN_PITCH), az: new Float32Array(n), vx: new Float32Array(n), vz: new Float32Array(n) };
    });
  }

  // bodyVel: world velocity of the hero (units/s). root: the model's object3D (world
  // matrices must be current). time: seconds, for the flutter.
  update(dt, bodyVel, root, time) {
    // Motion of the knot relative to the feet (flips, spins, bounces) adds to the wind.
    this.torso.localToWorld(tmpV.copy(this.anchor)).sub(root.position);
    wind.copy(bodyVel);
    if (this.prevRel && dt > 0) {
      dir.subVectors(tmpV, this.prevRel).divideScalar(dt);
      if (dir.length() < MAX_POSE_SPEED) wind.add(dir);
    }
    (this.prevRel ??= new THREE.Vector3()).copy(tmpV);

    // Into torso space: gravity + wind (negated velocity).
    this.torso.getWorldQuaternion(tmpQ).invert();
    const speed = wind.length();
    wind.multiplyScalar(-WIND_SCALE).applyQuaternion(tmpQ);
    dir.set(0, -1, 0).applyQuaternion(tmpQ).add(wind).normalize();
    const baseAx = Math.atan2(-dir.z, -dir.y);
    const baseAz = Math.asin(clamp(dir.x, -1, 1));
    const flutter = Math.min(0.45, 0.04 + speed / 2200);

    const h = Math.min(dt, 1 / 30);
    for (const tail of this.tails) {
      const { ax, az, vx, vz, joints, def } = tail;
      for (let i = 0; i < joints.length; i++) {
        const wob = Math.sin(time * 15 - i * 1.4 + def.spread * 9);
        const tx = clamp(baseAx + flutter * wob, MIN_PITCH, MAX_PITCH);
        const tz = clamp(baseAz + def.spread + flutter * 0.6 * Math.cos(time * 11 - i * 1.2), -1.3, 1.3);
        vx[i] += (STIFFNESS[i] * (tx - ax[i]) - DAMPING[i] * vx[i]) * h;
        vz[i] += (STIFFNESS[i] * (tz - az[i]) - DAMPING[i] * vz[i]) * h;
        ax[i] = clamp(ax[i] + vx[i] * h, MIN_PITCH, MAX_PITCH);
        az[i] += vz[i] * h;
        // Children store rotations relative to their parent segment.
        joints[i].rotation.set(ax[i] - (i ? ax[i - 1] : 0), 0, az[i] - (i ? az[i - 1] : 0));
      }
    }
  }
}
