import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: { host: true },
  build: {
    target: 'es2022',
    rolldownOptions: { input: { main: 'index.html' } },
    // One bundle is intended: the game needs all of it (three.js is most of it) before the
    // first frame, so splitting would only add requests. ~850 kB minified, ~250 kB gzipped
    // (plus the title logo worker, ~13 kB).
    chunkSizeWarningLimit: 900,
  },
});
