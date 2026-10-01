// The screen wipe (ui/ScreenWipe.js) on a stand-in canvas: hidden at 0; the iris is a hole round
// the hero's chest as the camera sees it, shrinking with the amount, and his chest comes down
// with his size (shrinking into the bottle: the hole follows it); a hero behind the camera gets
// it centred; the star exit's fade covers the screen evenly.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ScreenWipe } from '../src/ui/ScreenWipe.js';

const CHEST = 100; // the iris centres this far over his feet at his full size
const W = 640; // the canvas box (CSS px): 320 x 240 HUD pixels
const H = 480;

// A canvas stand-in recording the spans each draw fills.
let canvas;
beforeEach(() => {
  const ctx = {
    fillStyle: '',
    globalAlpha: 1,
    rects: [],
    alphas: [],
    clearRect() {
      this.rects.length = 0;
      this.alphas.length = 0;
    },
    fillRect(x, y, w, h) {
      this.rects.push([x, y, w, h]);
      this.alphas.push(this.globalAlpha);
    },
  };
  canvas = { className: '', style: {}, width: 1, height: 1, clientWidth: W, clientHeight: H, getContext: () => ctx, ctx };
  globalThis.document = { createElement: () => canvas };
});

afterEach(() => {
  delete globalThis.document;
});

const root = { appendChild() {} };

// The camera: looking north level from 800 south of his feet (at the origin), 150 up.
function camera() {
  const c = new THREE.PerspectiveCamera(45, W / H, 20, 45000);
  c.position.set(0, 150, 800);
  c.lookAt(0, 150, 0);
  c.updateMatrixWorld();
  return c;
}

// The hole the last draw left: its rows (a row of the hole has two spans either side of it, or
// one, at a screen edge) and its centre (the middle of its rows, and of its widest row).
function hole() {
  const rows = new Map();
  for (const [x, y, w] of canvas.ctx.rects) {
    if (!rows.has(y)) rows.set(y, []);
    rows.get(y).push([x, x + w]);
  }
  const open = [];
  for (let y = 0; y < canvas.height; y++) {
    const spans = rows.get(y) ?? [];
    if (spans.length === 1 && spans[0][0] === 0 && spans[0][1] === canvas.width) continue; // covered
    let x0 = 0;
    let x1 = canvas.width;
    for (const [a, b] of spans) {
      if (a === 0) x0 = b;
      else x1 = a;
    }
    open.push({ y, x0, x1 });
  }
  if (!open.length) return null;
  const widest = open.reduce((m, r) => (r.x1 - r.x0 > m.x1 - m.x0 ? r : m));
  return { rows: open.length, cy: (open[0].y + open.at(-1).y + 1) / 2, cx: (widest.x0 + widest.x1) / 2, width: widest.x1 - widest.x0 };
}

// Where his chest (CHEST * scale over his feet) is on the canvas, in its pixels.
function chest(cam, feet, scale) {
  const v = new THREE.Vector3(feet.x, feet.y + CHEST * scale, feet.z).project(cam);
  return { x: ((v.x + 1) / 2) * canvas.width, y: ((1 - v.y) / 2) * canvas.height };
}

test('hidden at 0, shown while it covers, at the HUD resolution', () => {
  const wipe = new ScreenWipe(root);
  const cam = camera();
  const feet = new THREE.Vector3(0, 0, 0);
  wipe.draw({ amount: 0, kind: 'iris', color: '#000000' }, feet, cam);
  assert.equal(canvas.style.display, undefined, 'never shown');
  wipe.draw({ amount: 0.5, kind: 'iris', color: '#000000' }, feet, cam);
  assert.equal(canvas.style.display, '');
  assert.deepEqual([canvas.width, canvas.height], [320, 240]);
  wipe.draw({ amount: 0, kind: 'iris', color: '#000000' }, feet, cam);
  assert.equal(canvas.style.display, 'none');
});

test('the iris is a hole round his chest, shrinking to nothing; shrinking into the bottle, his chest (and the hole) comes down with him', () => {
  const wipe = new ScreenWipe(root);
  const cam = camera();
  const feet = new THREE.Vector3(60, 0, -200);
  const iris = (amount, scale) => {
    wipe.draw({ amount, kind: 'iris', color: '#000000' }, feet, cam, scale);
    return hole();
  };
  // Full size: centred on his chest, smaller the further it has closed. (Far enough closed for
  // the hole to lie within the screen.)
  let last = Infinity;
  for (const amount of [0.6, 0.75, 0.9]) {
    const h = iris(amount, 1);
    const at = chest(cam, feet, 1);
    assert.ok(Math.abs(h.cy - at.y) <= 1 && Math.abs(h.cx - at.x) <= 1, `${amount}: hole at ${h.cx},${h.cy}, his chest at ${at.x},${at.y}`);
    assert.ok(h.width < last, `${amount}: ${h.width} across`);
    last = h.width;
  }
  assert.equal(iris(1, 1), null, 'covered');
  // At 0.35 of his size: on his chest as it is now, CHEST * 0.65 nearer his feet on screen.
  for (const scale of [0.61, 0.35]) {
    const big = iris(0.75, 1);
    const small = iris(0.75, scale);
    const at = chest(cam, feet, scale);
    assert.ok(Math.abs(small.cy - at.y) <= 1 && Math.abs(small.cx - at.x) <= 1, `${scale}: hole at ${small.cx},${small.cy}, his chest at ${at.x},${at.y}`);
    const down = chest(cam, feet, scale).y - chest(cam, feet, 1).y;
    assert.ok(down > 3, `${scale}: his chest ${down} px lower`);
    assert.ok(Math.abs(small.cy - big.cy - down) <= 1, `${scale}: the hole ${small.cy - big.cy} px lower`);
  }
});

test('a hero behind the camera gets the iris centred; the fade covers evenly', () => {
  const wipe = new ScreenWipe(root);
  const cam = camera();
  wipe.draw({ amount: 0.5, kind: 'iris', color: '#000000' }, new THREE.Vector3(0, 0, 2000), cam);
  const h = hole();
  assert.ok(Math.abs(h.cx - canvas.width / 2) <= 1 && Math.abs(h.cy - canvas.height / 2) <= 1, `${h.cx},${h.cy}`);
  wipe.draw({ amount: 0.4, kind: 'fade', color: '#fff4d0' }, new THREE.Vector3(), cam);
  assert.deepEqual(canvas.ctx.rects, [[0, 0, canvas.width, canvas.height]]);
  assert.deepEqual(canvas.ctx.alphas, [0.4]);
  assert.equal(canvas.ctx.fillStyle, '#fff4d0');
});
