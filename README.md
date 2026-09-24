# Castle Grounds

A late-90s-style 3D platformer hub level in the browser, built from scratch with three.js:
a fairy-tale castle on a moated island, a drawbridge, rolling lawns, a hill, a waterfall and
a pond, explored by an original hero, Pip, with classic momentum-based platforming moves.

**An original homage.** Castle Grounds is an unofficial, non-commercial fan homage to the
castle-grounds hub levels of late-90s console 3D platformers. It is not affiliated with,
endorsed by or sponsored by the rights holders of the games that inspired it, and it uses
none of their characters, names, logos, emblems or assets. Everything is original and
generated in code at run time: the hero Pip (an original character), the castle and every
other model, every texture, the sky, the pixel fonts, the HUD and title art, every sound
effect and all of the music (synthesised with the Web Audio API). The game loads no image,
model, font or audio files; its only runtime library is three.js.

## Setup

Requires **Node.js 20.19+ or 22.12+** (Vite 8) and npm.

```
npm install
npm run dev      # then open the printed URL
npm test         # unit tests (node)
npm run build    # production build into dist/ (npm run preview serves it)
```

The screenshot/automation tool (`node tools/shot.mjs`, see `docs/ARCHITECTURE.md`) and the
browser tests (`E2E=1 npm test`) drive a headless Chromium through Playwright. Install that
browser once with `npx playwright install chromium`.

## How to play

* **Collect the 8 red coins** scattered around the grounds: when the last one is taken a
  **star** appears in the air above the courtyard in front of the castle door. Jump up and
  grab it.
* **Health** is the power meter (8 wedges; it shows up when Pip is hurt or underwater). Long
  falls knock wedges off, and underwater Pip slowly runs out of air (surface to breathe,
  which also heals). **Coins restore health**: a yellow coin one wedge, a red coin two.
* **Lives**: Pip starts with 4. Running out of health, or falling out of the world, costs one
  and he drops back in at the start; losing one at ×0 is GAME OVER. A **1-up gem** is hidden
  somewhere on the grounds and gives an extra life.

### Moves

| Move | How |
|---|---|
| double / triple jump | jump again just as Pip lands; the third in a row (at running speed) goes highest |
| long jump | while running, crouch (slide) and jump right away |
| backflip | crouch standing still, then jump |
| side flip | while running, pull the stick the opposite way and jump during the skid |
| wall kick | jump into a wall and press jump again just as Pip hits it; chain them between two walls |
| punch, kick | attack standing still (press repeatedly for a punch-punch-kick combo) |
| dive | attack while running fast, on the ground or in the air |
| jump kick | attack in the air at low speed |
| ground pound | crouch in the air |
| ledge grab | automatic when Pip falls past the edge of a ledge he faces: jump or push toward it to climb up, crouch or pull back to let go |
| climb trees | jump into a tree trunk to hug it: stick up climbs, down slides, jump leaps off, crouch lets go |
| swim | jump to stroke, hold jump to kick along; at the surface pull back and jump to leap out, crouch (or push up and jump) to dive |

## Controls

| Keyboard | Gamepad | |
|---|---|---|
| WASD (Q: walk slowly) | left stick | move |
| Space / K | A | jump |
| J | X / B | attack (punch, kick, dive) |
| Shift / L | triggers, LB | crouch, ground pound |
| arrow keys, mouse drag | right stick, d-pad | camera (up from close: first-person look) |
| C | RB | camera mode |
| Enter / Esc | Start | pause (shows the controls) |
| F1 / F2 / F3 | | debug overlay / retro filter / 4:3 screen |

Any standard-mapping gamepad works (several connected pads are all read). On a first visit
the title asks for any key, click or tap first (browsers only allow sound after one), then
for Start; a gamepad Start begins right away.

URL flags: `?skipTitle=1` (straight into play), `?mute=1`, `?test=1` (no real-time loop;
driven through `window.__game`, see the docs).

See `docs/ARCHITECTURE.md` for how the code is organised.
