// Phone-as-controller protocol, shared by the game page, the phone's pad page (pad.html)
// and the relay in the local dev/preview server (tools/padRelay.js).
//
// The phone and the computer must be on the same network, with the game served locally
// (`npm run dev` or `npm run preview`); the hosted/static build has no relay, so the phone
// panel stays hidden there. Flow:
//   game page  -> GET PAD_INFO_PATH  ({ urls: ['http://192.168.x.y:5173/pad.html', ...] })
//              -> WebSocket PAD_WS_PATH, sends { t: 'join', role: 'game', room }
//   phone page -> opens pad.html?room=ABCD (QR code), WebSocket PAD_WS_PATH,
//                 sends { t: 'join', role: 'pad', room }
//   pad  -> game: { t: 'input', s: [stickX, stickY, buttons] }  (on change + every 100 ms)
//   game -> pad : { t: 'rumble', ms } (Pip hurt), { t: 'hello', name } (joined)
//   relay -> both: { t: 'peer', connected } when the other side joins or leaves
// One game and one pad per room; a new pad replaces the old one.

export const PAD_WS_PATH = '/pad-ws';
export const PAD_INFO_PATH = '/pad-info';
export const PAD_PAGE = 'pad.html';

// Button bits in the input message (order fixed: the protocol).
export const PAD_BUTTONS = ['A', 'B', 'Z', 'R', 'START', 'CU', 'CD', 'CL', 'CR'];

// Room codes: 4 letters without look-alikes (no I, O, L).
const ROOM_LETTERS = 'ABCDEFGHJKMNPQRSTUVWXYZ';
export function makeRoomCode(rng = Math.random) {
  let code = '';
  for (let i = 0; i < 4; i++) code += ROOM_LETTERS[Math.floor(rng() * ROOM_LETTERS.length)];
  return code;
}

export function isRoomCode(s) {
  return typeof s === 'string' && /^[A-Z]{4}$/.test(s);
}

// Controller state { stickX, stickY, A, B, ... } -> compact message.
export function encodeInput(state) {
  let bits = 0;
  PAD_BUTTONS.forEach((b, i) => {
    if (state[b]) bits |= 1 << i;
  });
  const q = (v) => Math.round(Math.max(-1, Math.min(1, Number(v) || 0)) * 1000) / 1000;
  return { t: 'input', s: [q(state.stickX), q(state.stickY), bits] };
}

// Message -> controller state (or null if malformed). Clamps the stick to the unit circle.
export function decodeInput(msg) {
  if (!msg || msg.t !== 'input' || !Array.isArray(msg.s) || msg.s.length !== 3) return null;
  let [x, y, bits] = msg.s;
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isInteger(bits)) return null;
  const m = Math.hypot(x, y);
  if (m > 1) {
    x /= m;
    y /= m;
  }
  const state = { stickX: x, stickY: y };
  PAD_BUTTONS.forEach((b, i) => {
    state[b] = (bits & (1 << i)) !== 0;
  });
  return state;
}
