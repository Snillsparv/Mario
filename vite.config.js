import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import padRelay from './tools/padRelay.js';

// Pages in the build: the game, plus the phone's controller page (pad.html) once it exists.
const input = { main: 'index.html' };
const hasPadPage = existsSync(fileURLToPath(new URL('./pad.html', import.meta.url)));
if (hasPadPage) input.pad = 'pad.html';

export default defineConfig({
  base: './',
  // host: true listens on every interface, so a phone on the same Wi-Fi can reach the game
  // server and its phone-controller relay (tools/padRelay.js) in dev and in preview.
  server: { host: true },
  preview: { host: true },
  plugins: [
    padRelay(),
    {
      name: 'pad-page-check',
      apply: 'build',
      buildStart() {
        if (!hasPadPage) this.warn('pad.html is missing: the phone controller page is not built');
      },
    },
  ],
  build: {
    target: 'es2022',
    rolldownOptions: { input },
    // One bundle is intended: the game needs all of it (three.js is most of it) before the
    // first frame, so splitting would only add requests. ~850 kB minified, ~250 kB gzipped
    // (plus the title logo worker, ~13 kB).
    chunkSizeWarningLimit: 900,
  },
});
