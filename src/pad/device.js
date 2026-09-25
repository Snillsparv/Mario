// Phone features the pad page uses, each guarded (a browser without one just goes without):
// vibration, keeping the screen on, fullscreen, and no scrolling / zooming / selection / long-press
// menus. `nav` / `doc` are injectable for the node tests.

// Vibrate for `ms` where the browser allows it (Android Chrome after a first tap; iOS has no
// vibration API). Returns whether it was asked for.
export function vibrate(ms, nav = globalThis.navigator) {
  try {
    if (!nav || typeof nav.vibrate !== 'function') return false;
    if (nav.userActivation && !nav.userActivation.hasBeenActive) return false; // would be blocked (and logged)
    return nav.vibrate(Math.max(0, Math.round(ms))) !== false;
  } catch {
    return false;
  }
}

// Keep the screen on while the page shows. Returns { mode, held(), request(), release() };
// mode: 'api' | 'video' | null (nothing works here).
//
//  * 'api': the Screen Wake Lock API. Browsers only offer it on secure pages (https, localhost),
//    so it is there when the page is opened on the computer itself.
//  * 'video': the phone opens http://<the computer's LAN address>/pad.html, which is not a secure
//    page, so there is no wake lock API. A playing video keeps the screen on instead: a tiny
//    live stream drawn on a 2x2 canvas (no media file), kept in view under the controller.
//    Chromium keeps the screen on for a playing stream video that is on screen, however small
//    and even muted (VideoWakeLock: stream videos are exempt from its size rule). WebKit (every
//    iPhone browser) only for a video that plays with sound, not looping (shouldDisableSleep),
//    so there the stream also carries a silent Web Audio track and the video is unmuted; that
//    needs a tap, and the audio session is made 'ambient' where it can be, so the phone's own
//    music keeps playing.
//
// Asked for again when the page shows and on taps (some browsers allow it only after one);
// the video pauses while the page is hidden.
export function keepAwake({ nav = globalThis.navigator, doc = globalThis.document, win = globalThis } = {}) {
  const keeper = nav?.wakeLock?.request ? apiLock(nav, doc) : streamLock(nav, doc, win);
  if (!keeper) return { mode: null, held: () => false, request() {}, release() {} };
  const hidden = () => doc?.visibilityState === 'hidden';
  const request = () => {
    if (!hidden()) keeper.start();
  };
  const onVisibility = () => (hidden() ? keeper.pause() : keeper.start());
  const gesture = { capture: true, passive: true }; // before the controller's own handlers
  const taps = ['touchend', 'pointerup', 'click'];
  doc?.addEventListener?.('visibilitychange', onVisibility);
  for (const t of taps) doc?.addEventListener?.(t, request, gesture);
  request();
  return {
    mode: keeper.mode,
    held: () => keeper.held(),
    request,
    release() {
      doc?.removeEventListener?.('visibilitychange', onVisibility);
      for (const t of taps) doc?.removeEventListener?.(t, request, gesture);
      keeper.stop();
    },
  };
}

// The Screen Wake Lock API: the browser drops the lock when the page is hidden.
function apiLock(nav, doc) {
  let sentinel = null;
  let pending = false;
  let on = true;
  return {
    mode: 'api',
    held: () => !!sentinel,
    async start() {
      if (!on || sentinel || pending) return;
      pending = true;
      try {
        const s = await nav.wakeLock.request('screen');
        if (!on || doc?.visibilityState === 'hidden') {
          s.release?.().catch?.(() => {});
          return;
        }
        sentinel = s;
        s.addEventListener?.('release', () => {
          if (sentinel === s) sentinel = null;
        });
      } catch {
        // not allowed now (no gesture yet, battery saver): the next tap or visibility change retries
      } finally {
        pending = false;
      }
    },
    pause() {},
    stop() {
      on = false;
      const s = sentinel;
      sentinel = null;
      s?.release?.().catch?.(() => {});
    },
  };
}

// WebKit (Safari and every iPhone browser) needs the video to play with sound to keep the
// screen on; Chromium and Gecko do not.
export function needsAudibleVideo(win = globalThis) {
  const proto = win?.HTMLVideoElement?.prototype;
  return !!proto && 'webkitSetPresentationMode' in proto;
}

const AWAKE_CSS = 'position:fixed;left:0;bottom:0;width:2px;height:2px;opacity:0;pointer-events:none;z-index:-1;';
const REPAINT_MS = 1000; // a new stream frame now and then, so the video never stalls

// The video fallback (see keepAwake). Built on the first start(); null when the browser can
// not make a stream from a canvas.
function streamLock(nav, doc, win) {
  const probe = doc?.createElement?.('canvas');
  if (typeof probe?.captureStream !== 'function' || typeof win?.MediaStream !== 'function') return null;
  const sound = needsAudibleVideo(win);
  const AudioCtx = win.AudioContext ?? win.webkitAudioContext;
  if (sound && typeof AudioCtx?.prototype?.createMediaStreamDestination !== 'function') return null;
  let video = null;
  let stream = null;
  let audio = null;
  let paint = null;
  let timer = 0;
  let on = true;

  const build = () => {
    const canvas = probe;
    canvas.width = canvas.height = 2;
    const g = canvas.getContext('2d');
    let n = 0;
    paint = () => {
      g.fillStyle = n++ & 1 ? '#121318' : '#131419';
      g.fillRect(0, 0, 2, 2);
    };
    paint();
    const tracks = canvas.captureStream().getVideoTracks();
    if (sound) {
      audio = new AudioCtx();
      const dest = audio.createMediaStreamDestination();
      const gain = audio.createGain(); // silence, but a live audio track
      gain.gain.value = 0;
      const osc = audio.createOscillator();
      osc.connect(gain);
      gain.connect(dest);
      osc.start();
      tracks.push(...dest.stream.getAudioTracks());
      try {
        if (nav?.audioSession) nav.audioSession.type = 'ambient'; // mix with the phone's music
      } catch {
        // not settable here
      }
    }
    stream = new win.MediaStream(tracks);
    video = doc.createElement('video');
    video.className = 'pad-awake';
    video.setAttribute('aria-hidden', 'true');
    video.setAttribute('playsinline', ''); // not the iPhone's full-screen player
    video.setAttribute('disablepictureinpicture', '');
    video.setAttribute('disableremoteplayback', '');
    video.playsInline = true;
    video.muted = !sound;
    video.tabIndex = -1;
    video.style.cssText = AWAKE_CSS;
    video.srcObject = stream;
    doc.body.appendChild(video);
  };

  return {
    mode: 'video',
    held: () => !!video && !video.paused && (!audio || audio.state === 'running'),
    start() {
      if (!on) return;
      if (!video) {
        try {
          build();
        } catch {
          this.stop(); // an older browser missing a piece: no fallback, nothing broken
          return;
        }
      }
      if (audio && audio.state !== 'running') audio.resume?.().catch?.(() => {});
      if (video.paused) {
        try {
          video.play()?.catch?.(() => {}); // refused without a tap: the next tap retries
        } catch {
          // an old browser without a play() promise that throws instead
        }
      }
      if (!timer) timer = win.setInterval(paint, REPAINT_MS);
    },
    pause() {
      video?.pause();
      audio?.suspend?.().catch?.(() => {});
      win.clearInterval(timer);
      timer = 0;
    },
    stop() {
      on = false;
      this.pause();
      for (const t of stream?.getTracks() ?? []) t.stop();
      video?.remove();
      audio?.close?.().catch?.(() => {});
      video = stream = audio = null;
    },
  };
}

// Fullscreen: whether the page can go fullscreen (not on iPhone Safari), whether it is, and a
// toggle (to be called from a tap).
export function canFullscreen(doc = globalThis.document) {
  const el = doc?.documentElement;
  return !!(el && (doc.fullscreenEnabled || doc.webkitFullscreenEnabled) && (el.requestFullscreen || el.webkitRequestFullscreen));
}

export function isFullscreen(doc = globalThis.document) {
  return !!(doc?.fullscreenElement || doc?.webkitFullscreenElement);
}

export async function toggleFullscreen(doc = globalThis.document) {
  try {
    if (isFullscreen(doc)) {
      await (doc.exitFullscreen?.() ?? doc.webkitExitFullscreen?.());
    } else {
      const el = doc.documentElement;
      await (el.requestFullscreen ? el.requestFullscreen({ navigationUI: 'hide' }) : el.webkitRequestFullscreen?.());
    }
  } catch {
    // refused (no gesture, not supported): stay as is
  }
}

// No page gestures: pinch or double-tap zoom, scrolling / rubber-banding, text selection,
// long-press menus and drag images. Taps still click (buttons on the code screen).
export function lockGestures(doc = globalThis.document) {
  const stop = (e) => {
    if (e.cancelable) e.preventDefault();
  };
  const active = { passive: false };
  doc.addEventListener('gesturestart', stop, active); // iOS pinch
  doc.addEventListener('gesturechange', stop, active);
  doc.addEventListener('contextmenu', stop);
  doc.addEventListener('selectstart', stop);
  doc.addEventListener('dragstart', stop);
  doc.addEventListener('dblclick', stop);
  // Two fingers anywhere, or a drag outside the controller: never a scroll or a zoom.
  doc.addEventListener('touchmove', stop, active);
}
