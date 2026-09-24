// Pure helpers for the phone-controller panel (ui/PhonePanel.js): texts, the QR code matrix,
// the pixel-art phone icon and the panel layout on the HUD's 320x240 logical grid. No DOM, so
// node tests cover all of it.

import qrcode from 'qrcode-generator';

export const PHONE_TITLE = 'PHONE CONTROLLER';
export const PHONE_SCAN = 'Scan with your phone - same Wi-Fi';
export const PHONE_OPEN = 'or open this address on it:';
export const PHONE_ROOM = 'ROOM CODE';
export const PHONE_LINKING = 'Connecting...';
export const PHONE_WAITING = 'Waiting for your phone...';
export const PHONE_JOINED = 'Phone connected!';
export const PHONE_LINKED = 'Phone connected';
export const PHONE_CLOSE = 'Esc / B  close';
export const PHONE_BUTTON = 'Phone';
export const PHONE_BUTTON_TIP = 'Use your phone as a controller (P)';

// Small-font / big-font strings of the panel (the glyph-coverage test checks them).
export const PHONE_SMALL_STRINGS = [PHONE_SCAN, PHONE_OPEN, PHONE_ROOM, PHONE_LINKING, PHONE_WAITING, PHONE_LINKED, PHONE_CLOSE, PHONE_BUTTON, '×'];
export const PHONE_BIG_STRINGS = [PHONE_TITLE, PHONE_JOINED, 'ABCDEFGHJKMNPQRSTUVWXYZ'];

// Seconds "Phone connected!" stays up before the panel closes by itself.
export const JOINED_CLOSE_MS = 1500;

// Modules of light margin around the code (the QR standard asks for 4).
export const QR_QUIET = 4;

// The QR code of `text` (automatic version, error correction M): { size, dark(x, y) } with
// size in modules (no quiet zone). Null when it cannot be encoded.
export function qrMatrix(text) {
  if (typeof text !== 'string' || !text) return null;
  try {
    const qr = qrcode(0, 'M');
    qr.addData(text, 'Byte');
    qr.make();
    const size = qr.getModuleCount();
    return { size, dark: (x, y) => qr.isDark(y, x) };
  } catch {
    return null; // too long for any version
  }
}

// Device pixels per module so the code plus its quiet zone fits `devicePx` (whole pixels, so
// every module stays a crisp square), at least 1.
export function qrModulePx(devicePx, size, quiet = QR_QUIET) {
  return Math.max(1, Math.floor(devicePx / (size + 2 * quiet)));
}

// A phone held sideways, a thumb pad on its screen (the outline is added by raster.js).
const PHONE = {
  rows: [
    '.hhhhhhhhhhhhhhhhhh.',
    'hbbbbbbbbbbbbbbbbbbd',
    'hbbSSSSSSSSSSSSSSbbd',
    'hbbSSSSSSSSSSSaaSbbd',
    'hbbSSwSSSSSSSSaaSbbd',
    'hcbSwwwSSSSSSSSSSbbd',
    'hbbSSwSSSSSSrrSSSbbd',
    'hbbSSSSSSSSSrrSSSbbd',
    'hbbSSSSSSSSSSSSSSbbd',
    'hbbbbbbbbbbbbbbbbbbd',
    '.dddddddddddddddddd.',
  ],
  palette: {
    h: '#8a93c0', b: '#3c4266', d: '#232840', c: '#0c0e1c',
    S: '#2a86a8',
    w: '#ffffff', a: '#ffd23a', r: '#f3877c',
  },
};
export const PHONE_ICON = { ...PHONE, w: PHONE.rows[0].length, h: PHONE.rows.length };

// Panel layout in logical px (the HUD's 320x240 grid; W x H is the whole screen, never less
// than 320 x 240). Every rect is { x, y, w, h } relative to the panel's top-left, except
// `panel` (relative to the screen). The QR box includes its quiet zone.
export const PANEL_W = 300;
export function panelLayout(W, H) {
  const pad = 10;
  const w = Math.min(PANEL_W, W - 12);
  const titleY = pad;
  const scanY = titleY + 10 + 7;
  const bodyY = scanY + 9 + 8;
  const qr = { x: pad, y: bodyY, w: 112, h: 112 };
  const colX = qr.x + qr.w + 12;
  const colW = w - pad - colX;
  const col = {
    open: { x: colX, y: bodyY, w: colW, h: 9 },
    url: { x: colX, y: bodyY + 12, w: colW, h: 26 },
    roomLabel: { x: colX, y: bodyY + 44, w: colW, h: 9 },
    room: { x: colX, y: bodyY + 56, w: colW, h: 20 },
    status: { x: colX, y: bodyY + 88, w: colW, h: 9 },
  };
  const footY = bodyY + qr.h + 6;
  const h = footY + 9 + pad - 2;
  return {
    panel: { x: Math.round((W - w) / 2), y: Math.round(Math.max(6, (H - h) / 2)), w, h },
    pad,
    title: { x: 0, y: titleY, w, h: 10 },
    close: { x: w - pad - 11, y: pad - 4, w: 16, h: 16 },
    scan: { x: 0, y: scanY, w, h: 9 },
    qr,
    ...col,
    foot: { x: pad, y: footY, w: w - 2 * pad, h: 9 },
  };
}

// Where the "phone connected" HUD badge sits (logical px from the screen's bottom-left).
export const BADGE = { left: 10, bottom: 8 };
