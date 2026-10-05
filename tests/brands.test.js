// The brand and IP scan (the repository is public): no car maker's or model's name, paint or
// light-signature marketing name, no robot franchise, its factions, robots or planet, no toy
// maker, anywhere in the repo's text (code, comments, tests, docs, tools, the pages, the
// README, package.json, the build config) or in what the player sees. Every file is split into
// lowercase words (apostrophes dropped, then split on anything but letters and digits) and
// adjacent pairs of them (one space between); each is hashed (sha256) and none may be one of
// FORBIDDEN: digests only, so the names themselves never enter the repo (the plain list is kept
// outside it with the plan that made it). Common words on it are banned too: write "bee",
// "converter". (The console maker's characters are checked in player-visible strings by the UI
// tests; its own name stays allowed where the pad detection needs it, in core/input.js.)

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIRS = ['src', 'tests', 'docs', 'tools'];
const FILES = ['index.html', 'pad.html', 'preview.html', 'README.md', 'package.json', 'vite.config.js'];
const TEXT = new Set(['.js', '.mjs', '.cjs', '.md', '.html', '.json', '.css', '.txt', '.glsl']);

const FORBIDDEN = new Set([
  'bccae4ce7be65100a8472740c829b76610a653a6816a7b88c7f7def8ae8e9b0c',
  'cc05dd4eb2d533c80978d64ccb420d7a189dc4a3ec1d399cc35983df0a92de12',
  '6ac970efe8fdedf92aa253115befad8c9f31019ea5f6c5347bcbde81cbb28bf8',
  '1912e1b5d55f3cd500dbe67e0217d2114161a989fbb3a280f06e27b4f95da56d',
  'fe7280cbed88608f16bac4c90d0bc3700d3eae3d6af167be975e94afbb921093',
  'c9b556cc1c13ed37065ad2d7d2215d459ab7950707736f505eb2981ea66530fc',
  'b2808c947ea04c193e096f4923d13599ab96317dee1e33c8705bfc863f354903',
  'c66bb784bb260be105a54f3e77488d63d4b9e4762cc20e7ff34249a8d849ba85',
  'a29e8e020f4171ce7c101ce5377819793bc83d0df04e97f3359d41f502889313',
  '5059c5d77b7b9e52c6b3605ae0efad9548078b56861014064fb60dabbd3d719d',
  '361b904b27614818f00b146a39f6841899d55468345f5e8c842b8cfa58f3bdd1',
  'ad9b0702bc418499b1f2fb4eea3f87e9aaf24aeb315f12b79dd2e9efaa9bda20',
  'd418a266edeba03119edfc572dfcd136afbd17413a5d799c496ad862ff6e1081',
  '2b8d7b22466b9a4ee8b46d3a409c295ad762b0568757a6cd6ece6daf28867ab5',
  '786806b784a56b57a427fa514e79e6c2bbce98b8da613348897190868cce0822',
  'fe719b64e20cb4228c2334fc9c9ad135c71b02622c049982d75cbdc1285468be',
  '925e2b1a37e8212265f53faaeff8f154ddc9d1e20e0cc021ec206d0a65cc5e4e',
  '944ca128927886e21b7fc0f4d4e2a2f011c7f979f3e3c240b8725ba55adfaf88',
  '598427034543b344eacf5b60ac94d5a9c44f3dc6786ef7b1893e2dc8842dbccf',
  'a0d31c7525ce5dd238a933d6495c9048d43dec6c8cce5e4347c101d30eefc146',
  'abe813283539591d1183c8f307742f8d00c9099de8754f9c3667ab334414ecad',
  '51b0f2d4483ce0c8caac5227d5e1a3e9780ff3787aac75aec8d40d34ba6ffd31',
  '8a83b060406f54e6333e32fb1e15b3c62467fcf992d3f16b01571b3b903f4f65',
  'c730a8070ca69ae746002271a82c9e212955976587d16b4ac5f6ccdef9f4970b',
  '8e923f7b2635424f0509512e4da99503d4086d22aa2f8ea057c1668892681c20',
]);

const sha = (s) => createHash('sha256').update(s).digest('hex');

// The words of a text and its adjacent pairs, as hashed.
function terms(text) {
  const words = text.toLowerCase().replace(/['’]/g, '').split(/[^a-z0-9]+/).filter(Boolean);
  const out = new Set(words);
  for (let i = 0; i + 1 < words.length; i++) out.add(`${words[i]} ${words[i + 1]}`);
  return out;
}

function files() {
  const out = FILES.map((f) => join(ROOT, f));
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      if (name === 'node_modules' || name.startsWith('.')) continue;
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (TEXT.has(extname(name))) out.push(p);
    }
  };
  for (const d of DIRS) walk(join(ROOT, d));
  return out;
}

test('the digests are well formed and the scan finds what it looks for (a planted word and pair)', () => {
  assert.ok(FORBIDDEN.size >= 20);
  for (const d of FORBIDDEN) assert.match(d, /^[0-9a-f]{64}$/);
  const planted = terms("A Bee's Knees. bee-knees");
  assert.ok(planted.has('bees') && planted.has('bees knees') && planted.has('bee knees'));
});

test('no brand, model, marketing, robot franchise or toy maker name anywhere in the repo\'s text', () => {
  const list = files();
  assert.ok(list.length > 300, `${list.length} files scanned`);
  const hits = [];
  for (const f of list) {
    for (const t of terms(readFileSync(f, 'utf8'))) if (FORBIDDEN.has(sha(t))) hits.push(`${f.slice(ROOT.length)}: a forbidden ${t.includes(' ') ? 'pair' : 'word'} (${sha(t).slice(0, 8)})`);
  }
  assert.deepEqual(hits, []);
});
