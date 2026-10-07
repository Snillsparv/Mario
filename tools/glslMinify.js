// The build's GLSL minifier (vite.config.js, build only): every template literal marked
// /* glsl */ in the game's own code (the shaders and shader patches: render/real/*, the post
// passes, the sky, the terrain's and the objects' patches, the effects) loses its comments and the whitespace the GLSL compiler does not
// need, so the shipped bundle carries less text (the minifier leaves template literals as they
// are: it cannot know they are GLSL). Its tokens stay exactly the same (tests/glsl-minify.test.js
// checks it for every literal in src/), so the programs compile to the same code:
//   * each preprocessor line (#define, #if, #include <...>) stays a line of its own, its words as
//     they were (runs of spaces made one);
//   * an interpolation (${...}) alone on its line stays alone on it (it may hold its own
//     directives); inline ones are left where they are, with the spaces round them;
//   * other lines are joined with one space, and the spaces next to { } ( ) [ ] ; , = < > ! * / %
//     & | ^ ? : dropped (never next to + or -: "a - -b" must not become "a--b");
//   * a newline at the literal's start or end stays (the literal may be spliced into another
//     shader's lines: three.js's chunks replaced by a patch).
// A literal with a backslash, or an interpolation it cannot read, is left as it is. Three.js's
// own shader chunks are not touched (the realistic materials patch them by their exact text).
// Mark a literal only if each interpolation in it is a number or stands alone on its line: an
// inline one whose value carries lines of its own (a nested template, a string with \n or a
// directive) gets the next line joined onto its last one ("#endif vec3 ..."). The unit test
// cannot see that (the value is only known at run time); the E2E build test compiles every look.
//
//   minifyGlsl(text) -> text         // a literal's text (its interpolations stood in by
//                                    // \u0000n\u0000 placeholders)
//   glslLiterals(code) -> [{ start, end, text, exprs }]   // a module's /* glsl */ literals
//   minifyLiterals(code) -> { code, saved, literals }   // a module's source, its /* glsl */
//                                    // literals minified
//   glslMinify() -> Vite plugin      // (apply: 'build')

const PLACEHOLDER = /^\u0000\d+\u0000$/;
const TIGHT = /[ ]?([{}()[\];,=<>!*/%&|^?:])[ ]?/g;

export function minifyGlsl(text) {
  const lead = /^\s*\n/.test(text) ? '\n' : '';
  const trail = /\n\s*$/.test(text) ? '\n' : '';
  // (A block comment that spans lines ends the line it is on.)
  const bare = text.replace(/\/\*[\s\S]*?\*\//g, (c) => (c.includes('\n') ? '\n' : ' ')).replace(/\/\/[^\n]*/g, '');
  const out = [];
  let line = '';
  const flush = () => {
    if (line) out.push(line.replace(TIGHT, '$1'));
    line = '';
  };
  for (const raw of bare.split('\n')) {
    const t = raw.trim().replace(/[ \t]+/g, ' ');
    if (!t) continue;
    if (t.startsWith('#') || PLACEHOLDER.test(t)) {
      flush();
      out.push(t);
    } else line += (line ? ' ' : '') + t;
  }
  flush();
  return lead + out.join('\n') + trail;
}

// The end of a JS string or template literal starting at s[i] (its quote), or -1.
function skipString(s, i) {
  const q = s[i];
  for (let j = i + 1; j < s.length; j++) {
    if (s[j] === '\\') j++;
    else if (q === '`' && s[j] === '$' && s[j + 1] === '{') {
      j = skipExpression(s, j + 2);
      if (j < 0) return -1;
    } else if (s[j] === q) return j;
  }
  return -1;
}

// The index of the } closing an interpolation whose expression starts at s[i], or -1.
function skipExpression(s, i) {
  let depth = 0;
  for (let j = i; j < s.length; j++) {
    const c = s[j];
    if (c === "'" || c === '"' || c === '`') {
      j = skipString(s, j);
      if (j < 0) return -1;
    } else if (c === '{') depth++;
    else if (c === '}') {
      if (depth === 0) return j;
      depth--;
    }
  }
  return -1;
}

// Each /* glsl */ literal in `code`: { start, end (its closing backtick), text (its
// interpolations stood in by placeholders), exprs (their source: '${...}') }; one with a
// backslash or an interpolation it cannot read is left out.
export function glslLiterals(code) {
  const marker = /\/\*\s*glsl\s*\*\/\s*`/g;
  const found = [];
  let m;
  while ((m = marker.exec(code))) {
    const start = m.index + m[0].length; // (the literal's first character)
    const exprs = [];
    let text = '';
    let end = -1;
    for (let i = start; i < code.length; i++) {
      const c = code[i];
      if (c === '\\') break;
      if (c === '`') {
        end = i;
        break;
      }
      if (c === '$' && code[i + 1] === '{') {
        const close = skipExpression(code, i + 2);
        if (close < 0) break;
        text += `\u0000${exprs.length}\u0000`;
        exprs.push(code.slice(i, close + 1));
        i = close;
        continue;
      }
      text += c;
    }
    if (end < 0) continue;
    found.push({ start, end, text, exprs });
    marker.lastIndex = end + 1;
  }
  return found;
}

export function minifyLiterals(code) {
  let out = '';
  let last = 0;
  let saved = 0;
  const literals = glslLiterals(code);
  for (const { start, end, text, exprs } of literals) {
    const body = minifyGlsl(text).replace(/\u0000(\d+)\u0000/g, (_, n) => exprs[Number(n)]);
    out += code.slice(last, start) + body;
    saved += end - start - body.length;
    last = end;
  }
  return { code: out + code.slice(last), saved, literals: literals.length };
}

export default function glslMinify() {
  let saved = 0;
  let literals = 0;
  return {
    name: 'glsl-minify',
    apply: 'build',
    transform(code, id) {
      if (!/\.js$/.test(id.split('?')[0]) || id.includes('node_modules') || !/\/\*\s*glsl\s*\*\//.test(code)) return null;
      const result = minifyLiterals(code);
      if (!result.literals) return null;
      saved += result.saved;
      literals += result.literals;
      return { code: result.code, map: null };
    },
    buildEnd() {
      if (literals) this.info?.(`glsl-minify: ${literals} shader literals, ${saved} bytes saved`);
    },
  };
}
