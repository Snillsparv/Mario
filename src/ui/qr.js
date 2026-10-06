// The QR code matrix of the phone panel (ui/PhonePanel.js), apart from ui/phoneLogic.js: the QR
// library (qrcode-generator) is not side-effect-free, so whatever imports it carries it, and the
// phone's own page (src/pad/*) shares phoneLogic.js's other helpers but never draws a code.
//
//   qrMatrix(text) -> { size, dark(x, y) } | null

import qrcode from 'qrcode-generator';

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
