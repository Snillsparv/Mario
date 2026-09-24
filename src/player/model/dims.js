// Pip's skeleton measurements (units ~ cm, body space: origin at the feet, +Y up, +Z front).
// Shared by the rig builder and by pose helpers that need limb lengths (foot planting,
// hand placement on ledges and trunks).

export const CENTER = 78; // pivot height for flips / physical tilt (roughly the belly button)

export const HIP_Y = 48; // pelvis joint height
export const HIP_X = 10; // hip joints, left/right of the pelvis
export const HIP_DROP = 2; // hip joints sit slightly below the pelvis joint
export const THIGH = 15;
export const SHIN = 14;
export const ANKLE_Y = HIP_Y - HIP_DROP - THIGH - SHIN; // 17: ankle height when standing
// A swelling boot (attack anims) grows about this point above the ankle, on the shin inside
// the boot shaft, so the shaft does not climb over the knee.
export const BOOT_PIVOT_Y = 12;

export const SPINE_Y = 8; // torso joint above the pelvis joint
export const NECK_Y = 36; // head joint above the torso joint
export const SHOULDER_Y = 27; // shoulders above the torso joint
export const SHOULDER_X = 21.5; // out past the (slightly round) tunic
export const UPPER_ARM = 16;
export const FOREARM = 15;
export const HAND_OFFSET = 5; // wrist -> centre of the mitten
export const HAND_R = 7.4; // mitten radius

export const HEAD_R = 30;
export const HEAD_CY = 27; // head centre above the head joint
