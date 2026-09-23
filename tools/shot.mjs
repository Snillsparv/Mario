#!/usr/bin/env node
// Headless screenshot / automation tool. Starts its own Vite dev server on a free port,
// opens a page in Chromium (SwiftShader WebGL), optionally runs scripted actions, and saves
// screenshots. Prints browser console errors and page errors (exit code 1 if any page error).
//
// Usage:
//   node tools/shot.mjs --url "/preview.html?m=world" --out shots/world.png
//   node tools/shot.mjs --url "/?test=1" --actions actions.json
//   node tools/shot.mjs --url "/?test=1" --actions '[{"step":30,"input":{"stickY":1}},{"shot":"shots/a.png"}]'
// Options: --width 960 --height 540 --wait 500 (ms after __ready before the first action)
//
// Actions (array, run in order):
//   { "step": N, "input": { stickX, stickY, A, B, Z, R, CL, CR, CU, CD, START } }
//        -> window.__game.step(N, input)   (full game with ?test=1 only)
//   { "eval": "js expression" }            -> result is printed as JSON
//   { "shot": "path.png" }                 -> screenshot
//   { "wait": ms }
// With no actions, a single screenshot is written to --out.

import { createServer } from 'vite';
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf('--' + name);
  return i >= 0 ? args[i + 1] : def;
};

const url = opt('url', '/preview.html?m=world');
const out = opt('out', 'shots/shot.png');
const width = Number(opt('width', 960));
const height = Number(opt('height', 540));
const wait = Number(opt('wait', 500));
let actions = opt('actions', null);
if (actions) {
  actions = fs.existsSync(actions) ? JSON.parse(fs.readFileSync(actions, 'utf8')) : JSON.parse(actions);
}

const server = await createServer({
  root,
  logLevel: 'error',
  server: { port: 0, strictPort: false, host: '127.0.0.1', hmr: false },
});
await server.listen();
const base = server.resolvedUrls.local[0].replace(/\/$/, '');

const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});
let pageErrors = 0;
try {
  const page = await browser.newPage({ viewport: { width, height } });
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') console.log(`[browser ${m.type()}] ${m.text()}`);
  });
  page.on('pageerror', (e) => {
    pageErrors++;
    console.log(`[pageerror] ${e.stack || e.message}`);
  });
  await page.goto(base + url, { waitUntil: 'load', timeout: 120000 });
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 180000 });
  await page.waitForTimeout(wait);

  const ensureDir = (f) => fs.mkdirSync(path.dirname(path.resolve(root, f)), { recursive: true });
  if (!actions) {
    ensureDir(out);
    await page.screenshot({ path: path.resolve(root, out) });
    console.log(`saved ${out}`);
  } else {
    for (const a of actions) {
      if (a.step !== undefined) {
        await page.evaluate(([n, input]) => window.__game.step(n, input), [a.step, a.input || {}]);
      } else if (a.eval) {
        const r = await page.evaluate((code) => {
          const v = (0, eval)(code);
          return v === undefined ? null : JSON.parse(JSON.stringify(v));
        }, a.eval);
        console.log(`eval ${a.eval} => ${JSON.stringify(r)}`);
      } else if (a.shot) {
        ensureDir(a.shot);
        await page.screenshot({ path: path.resolve(root, a.shot) });
        console.log(`saved ${a.shot}`);
      } else if (a.wait) {
        await page.waitForTimeout(a.wait);
      }
    }
  }
} finally {
  await browser.close();
  await server.close();
}
process.exit(pageErrors ? 1 : 0);
