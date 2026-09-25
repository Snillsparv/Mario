// Face screen preview: /preview.html?m=face — the face screen (ui/FaceScreen.js) on its own,
// drawn through N64Renderer like the game; Start shows it again (the count is __faceStarts).
//   &n64=0      native resolution (no retro filter)
//   &box=1      4:3 pillarbox
//   &sound=1    real audio (the first click / key unlocks it); default: a muted stand-in that
//               records the sfx names in __sfx
//   &touch=1    the touch controller (as on a phone)
// Hooks: __face (the FaceScreen: state(), pointer(type, fx, fy, opts), project(x, y, z),
// displacementAt(x, y, z), stretch, turn, zoom, head), __view, __sfx.
// Scripted drags for tools/shot.mjs, e.g.
//   --url "/preview.html?m=face" --actions '[{"eval":"__face.pointer(\"down\",0.62,0.6)"},
//     {"eval":"__face.pointer(\"move\",0.85,0.66)"},{"wait":300},{"shot":"shots/face.png"}]'
// (the preview never reads or writes the game's saved display settings: storage null).

import { N64Renderer } from '../../render/N64Renderer.js';
import { FaceScreen } from '../../ui/FaceScreen.js';
import { TouchController } from '../../ui/TouchController.js';
import { AudioEngine } from '../../audio/AudioEngine.js';
import { Input } from '../../core/input.js';
import { Events } from '../../core/events.js';

export async function setup(ctx) {
  const { params } = ctx;
  ctx.renderer.domElement.remove(); // the harness's renderer: this preview draws through N64Renderer
  ctx.renderer.dispose();
  const view = new N64Renderer(ctx.container, { storage: null });
  if (params.has('n64')) view.setN64Mode(params.get('n64') !== '0');
  if (params.has('box')) view.setPillarbox(params.get('box') !== '0');
  view.alignOverlay(ctx.ui);
  const events = new Events();
  window.__sfx = [];
  events.on('sfx', (e) => window.__sfx.push(e.name));
  const audio = params.get('sound') === '1' ? new AudioEngine(events) : { muted: true, unlock() {}, playMusic() {} };
  if (params.has('touch')) new TouchController({ input: new Input(window), events, view });
  window.__view = view;
  window.__faceStarts = 0;
  const loop = async () => {
    for (;;) {
      const face = new FaceScreen(ctx.ui, { events, audio, view });
      window.__face = face;
      await face.show();
      window.__faceStarts++;
    }
  };
  loop();
  return { render() {} }; // the face screen draws itself
}
