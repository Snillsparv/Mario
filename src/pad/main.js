// Phone controller page (pad.html): the phone steers Pip in the game running on a computer on
// the same Wi-Fi, through the relay in the local dev / preview server (tools/padRelay.js,
// protocol src/net/protocol.js). The game shows a QR code for pad.html?room=ABCD.
//
//   * ?room=ABCD (any case): the full-screen controller (ui/TouchController.js standalone
//     mode) at once; its state goes to the game through PadLink (pad/padLink.js).
//   * no or a bad code: the game-code screen (pad/codeEntry.js); the chosen code is written
//     into the URL, so a reload keeps it.
//   * status strip (pad/statusStrip.js) in the band the layout keeps free; its grid button goes
//     back to the code screen, the corner button toggles fullscreen where there is one. In
//     portrait a label plate (pad/codePlate.js) above the controls shows the game code.
//   * rumble from the game (Pip hurt): vibration where the phone allows it (not iPhones), and
//     the controller's LED flashes. The LED also shows the link: green connected, amber waiting
//     for the game, red connecting / lost.
//   * the screen stays on while the page shows (pad/device.js keepAwake: the wake lock API on a
//     secure page, else - the usual http://<LAN address> case - a tiny playing video); no
//     scrolling, zooming, selection or long-press menus.
//
// Loads only the controller and the protocol (no three.js, no game code).

import { TouchController } from '../ui/TouchController.js';
import { Events } from '../core/events.js';
import { PadLink, padSocketUrl } from './padLink.js';
import { CodeEntry, roomFromSearch } from './codeEntry.js';
import { StatusStrip } from './statusStrip.js';
import { CodePlate } from './codePlate.js';
import { vibrate, keepAwake, canFullscreen, toggleFullscreen, lockGestures } from './device.js';

const CSS = `
.cg-pad .cg-tc-led { transition: background 120ms, box-shadow 120ms; }
.cg-pad[data-link="waiting"] .cg-tc-led { background:#e3a82b; box-shadow: 0 0 5px 1px rgba(227,168,43,0.8), inset 0 -1px 1px rgba(0,0,0,0.3);
  animation: pad-blink 1.2s steps(2, jump-none) infinite; }
.cg-pad[data-link="connecting"] .cg-tc-led, .cg-pad[data-link="reconnecting"] .cg-tc-led, .cg-pad[data-link="replaced"] .cg-tc-led,
.cg-pad[data-link="stopped"] .cg-tc-led { background:#c9523f; box-shadow: 0 0 4px 1px rgba(201,82,63,0.6), inset 0 -1px 1px rgba(0,0,0,0.3); }
/* Another phone has the game: the controls go grey until this one rejoins. */
.cg-pad[data-link="replaced"] :is(.cg-tc-btn, .cg-tc-knob, .cg-tc-dpad, .cg-tc-rock) { filter: saturate(0.15) brightness(0.62); }
.cg-pad.pad-hit .cg-tc-led { background:#ff5a3c; box-shadow: 0 0 12px 4px rgba(255,90,60,0.95); animation:none; }
`;

const RUMBLE_FLASH_MS = 250; // the LED flash lasts at least this long

function main() {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  lockGestures(document);
  const awake = keepAwake();

  const events = new Events();
  let link = null;
  let room = null;
  let tc = null;
  let rumbleUntil = 0;
  let flashTimer = 0;

  const strip = new StatusStrip(document.body, {
    fullscreen: canFullscreen(),
    onCode: () => showCode(),
    onFullscreen: () => toggleFullscreen(),
    onRetry: () => link?.retryNow(),
  });
  const plate = new CodePlate(document.body, { onRejoin: () => link?.retryNow() });
  const entry = new CodeEntry(document.body, { onSubmit: (code) => play(code) });

  // Press buzzes are short and must not cut a rumble from the game short.
  const haptics = (ms) => {
    if (performance.now() >= rumbleUntil) vibrate(ms);
  };

  function onStatus(status, l) {
    if (l !== link) return; // a link that was replaced
    strip.set(status, { room: l.room, failures: l.failures });
    plate.set(l.room, status);
    if (tc) tc.root.dataset.link = status;
  }

  function onRumble(ms) {
    rumbleUntil = performance.now() + ms;
    vibrate(ms);
    if (!tc) return;
    tc.root.classList.add('pad-hit');
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => tc.root.classList.remove('pad-hit'), Math.max(ms, RUMBLE_FLASH_MS));
  }

  function play(code) {
    room = code;
    try {
      const url = new URL(location.href);
      url.searchParams.set('room', code);
      history.replaceState(null, '', url);
    } catch {
      // a sandboxed frame: the URL just stays
    }
    document.title = `Pad ${code} - Castle Grounds`;
    entry.hide();
    tc ??= new TouchController({
      standalone: true,
      events,
      sink: (state) => link?.setState(state),
      haptics,
      onLayout: (L) => {
        strip.place(L.strip);
        plate.place(L.panel);
      },
    });
    link?.stop();
    link = new PadLink({ url: padSocketUrl(location), room: code, onStatus, onRumble });
    tc.setVisible(true);
    strip.setVisible(true);
    plate.setVisible(true);
    link.start();
  }

  function showCode(message = '') {
    const old = link;
    link = null;
    old?.stop();
    tc?.setVisible(false);
    strip.setVisible(false);
    plate.setVisible(false);
    document.title = 'Phone controller - Castle Grounds';
    entry.show({ message });
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') link?.wake();
  });
  window.addEventListener('online', () => link?.wake());
  // Leaving the page: let go of the game at once (Pip stops); back from the page cache: rejoin.
  window.addEventListener('pagehide', () => link?.stop());
  window.addEventListener('pageshow', (e) => {
    if (e.persisted && room && link?.status === 'stopped') play(room);
  });

  const initial = roomFromSearch(location.search);
  if (initial) play(initial);
  else {
    const raw = new URLSearchParams(location.search).get('room');
    showCode(raw ? `"${raw.slice(0, 12)}" is not a game code.` : '');
  }

  // Test and screenshot hooks (tools/shot.mjs waits for __ready).
  window.__pad = {
    get tc() {
      return tc;
    },
    get link() {
      return link;
    },
    strip,
    plate,
    entry,
    awake,
  };
  window.__ready = true;
}

main();
