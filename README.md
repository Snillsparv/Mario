# Castle Grounds

An N64-style 3D platformer hub level built from scratch with three.js: a fairy-tale castle
on a moated island, a drawbridge, rolling lawns, a hill, a waterfall and a pond, explored by
an original hero, Pip, with classic momentum-based platforming moves.

```
npm install
npm run dev      # then open the printed URL
npm test         # unit tests (node)
npm run build    # production build into dist/
```

## Controls

| Keyboard | Gamepad | |
|---|---|---|
| WASD (Q: walk slowly) | left stick | move |
| Space / K | A | jump (again on landing: double, triple jump) |
| J | X / B | punch, dive |
| Shift / L | triggers, LB | crouch, ground pound |
| arrow keys, mouse drag | right stick, d-pad | camera (up from close: first-person look) |
| C | RB | camera mode |
| Enter / Esc | Start | pause |
| F1 / F2 / F3 | | debug overlay / N64 filter / 4:3 screen |

On a first visit the title asks for any key, click or tap first (browsers only allow sound
after one), then for Start; a gamepad Start begins right away.

Pip starts with 4 lives. Losing all health (or falling out of the world) costs one and he
drops back in at the start; losing one at ×0 is game over and returns to the title.

URL flags: `?skipTitle=1` (straight into play), `?mute=1`, `?test=1` (no real-time loop;
driven through `window.__game`, see the docs).

See `docs/ARCHITECTURE.md` for how the code is organised.
