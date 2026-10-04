// The build's GLSL minifier (tools/glslMinify.js, vite.config.js): every /* glsl */ template
// literal in src/ minified keeps exactly its tokens (identifiers, numbers, operators, each
// preprocessor line whole and on a line of its own, each interpolation where it was), so every
// program compiles as before; a newline at a literal's start or end is kept (patches splice them
// into three.js's lines); spaces next to + and - stay ("a - -b"); the plugin's output is valid
// JavaScript giving the minified text with the interpolations' values; together the literals
// lose over a fifth of their bytes. (tests/net-relay-build.test.js's E2E part boots the built
// bundle and draws every look with them.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import glslMinify, { minifyGlsl, minifyLiterals, glslLiterals } from '../tools/glslMinify.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// GLSL's tokens: a preprocessor line is one token (its words, runs of spaces as one), the rest
// identifiers, numbers, placeholders and operators (comments dropped).
const TOKEN = /\u0000\d+\u0000|[A-Za-z_]\w*|(?:\d+\.\d*|\.\d+)(?:[eE][+-]?\d+)?[fF]?|\d+(?:[eE][+-]?\d+)?[uUfF]?|<<=|>>=|\+\+|--|<<|>>|<=|>=|==|!=|&&|\|\||\^\^|[-+*/%&|^]=|\S/g;
function tokens(text) {
  const out = [];
  const bare = text.replace(/\/\*[\s\S]*?\*\//g, (c) => (c.includes('\n') ? '\n' : ' ')).replace(/\/\/[^\n]*/g, '');
  for (const raw of bare.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('#')) out.push(line.replace(/\s+/g, ' '));
    else for (const m of line.matchAll(TOKEN)) out.push(m[0]);
  }
  return out;
}

function sources(dir = path.join(root, 'src'), out = []) {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) sources(p, out);
    else if (p.endsWith('.js')) out.push(p);
  }
  return out;
}

test('minifyGlsl: comments and spare whitespace out; preprocessor lines and lone interpolations kept on lines of their own; no space dropped next to + or -; a leading or trailing newline kept', () => {
  const src = '\n  // the noise\n  #define TAPS 12\n  uniform vec2 uSun; /* (uv) */\n  \u00000\u0000\n  float f(float x) {\n    return x * 2.0 - -1.0 + +x;\n  }\n  #ifdef USE_FOG\n    float d = f( a ) <= 3.0 ? 1.0 : 0.0;\n  #endif\n';
  assert.equal(minifyGlsl(src), '\n#define TAPS 12\nuniform vec2 uSun;\n\u00000\u0000\nfloat f(float x){return x*2.0 - -1.0 + +x;}\n#ifdef USE_FOG\nfloat d=f(a)<=3.0?1.0:0.0;\n#endif\n');
  assert.deepEqual(tokens(minifyGlsl(src)), tokens(src));
  assert.equal(minifyGlsl('#include <project_vertex>\n  vWorld = p.xyz;'), '#include <project_vertex>\nvWorld=p.xyz;', 'a patch spliced into a chunk\'s line keeps its ends');
  assert.equal(minifyGlsl('a = mix(\u00000\u0000, b, 0.5);'), 'a=mix(\u00000\u0000,b,0.5);');
  assert.equal(minifyGlsl('x = a -\u00001\u0000;'), 'x=a -\u00001\u0000;', 'an interpolation keeps the space after a minus');
});

test('the plugin\'s output is JavaScript giving the minified text with the interpolations\' values; a literal with a backslash is left as it is', async () => {
  const code = [
    'const N = 3;',
    "const f = (x) => x.toFixed(1);",
    'export const A = /* glsl */ `',
    '  #define K ${N}',
    '  // a comment, gone',
    "  float g(float x) { return x * ${f(-0.5)} - -1.0; } /* ${'}'} */",
    "  vec3 h = vec3(${[1, 2, 3].map((v) => `${v}.0`).join(', ')});",
    '`;',
    'export const B = /* glsl */ `a  =  "\\n";`;',
  ].join('\n');
  const { code: out, literals } = minifyLiterals(code);
  assert.equal(literals, 1, 'B (a backslash) left out');
  const mod = await import(`data:text/javascript,${encodeURIComponent(out)}`);
  assert.equal(mod.A, '\n#define K 3\nfloat g(float x){return x*-0.5 - -1.0;}vec3 h=vec3(1.0, 2.0, 3.0);\n');
  assert.equal(mod.B, 'a  =  "\n";');
  const plugin = glslMinify();
  assert.equal(plugin.apply, 'build', 'the build only (the dev server serves the sources)');
  assert.equal(plugin.transform('const x = 1;', '/src/a.js'), null, 'nothing to do');
  assert.equal(plugin.transform(code, '/node_modules/three/build/three.module.js'), null, 'three.js\'s own chunks untouched');
  assert.equal(plugin.transform(code, '/src/a.js').code, out);
});

test('every /* glsl */ literal in src/ keeps its tokens, its preprocessor lines and its interpolations; together they lose over a fifth of their bytes', () => {
  let before = 0;
  let after = 0;
  let count = 0;
  for (const file of sources()) {
    const code = fs.readFileSync(file, 'utf8');
    const literals = glslLiterals(code);
    if (!literals.length) continue;
    const { code: out } = minifyLiterals(code);
    const minified = glslLiterals(out);
    assert.equal(minified.length, literals.length, path.relative(root, file));
    literals.forEach((l, i) => {
      const m = minified[i];
      const where = `${path.relative(root, file)} literal ${i}`;
      assert.deepEqual(tokens(m.text), tokens(l.text), where);
      assert.deepEqual(m.exprs, l.exprs, `${where}: its interpolations`);
      assert.equal(/^\s*\n/.test(m.text), /^\s*\n/.test(l.text), `${where}: its leading newline`);
      assert.equal(/\n\s*$/.test(m.text), /\n\s*$/.test(l.text), `${where}: its trailing newline`);
      // Each directive alone on its line; no line holds one after other code.
      for (const line of m.text.split('\n')) assert.ok(!/^[^#]*[;{}]\s*#\s*(define|if|ifdef|ifndef|else|elif|endif|include|undef|pragma|extension|version)\b/.test(line), `${where}: ${line}`);
      before += l.text.length;
      after += m.text.length;
      count++;
    });
  }
  assert.ok(count >= 50, `${count} literals`);
  assert.ok(after < 0.8 * before, `${before} -> ${after} bytes`);
});
