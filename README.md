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
* **AI RACE**: ground-pound the AI RACE button to storm the grounds; among other horrors, server halls drop from the sky (dodge the red markers) and grind up out of the ground until tech has taken over the lawn. Pound STOP to end it.
* **Beating Rustmaw** (the giant mechanical lizard on the castle roof in AI RACE mode): its tail
  runs back over the keep onto the flat roof behind it and ends in a glowing orange coupling.
  Get up there (fly with the winged hat, or take the cannon), walk up behind the coupling and
  press **attack** to grab it (it cannot spit fireballs while you hold on). **Rotate the stick in
  circles**: Pip hauls the beast off the roof and whirls it round over the castle, faster with
  every circle (listen to the whoosh climb). Press **attack** again to throw it: with enough spin
  (about three circles) it flies off the castle and crashes down, which ends AI RACE mode and
  leaves a **star** at the crash site. Let go too early and it twists free, slams back onto its
  perch and knocks Pip back; crouch lets go, and holding on without spinning it tears loose.
  Start AI RACE again for a rematch (the star is only won once per game).
* **The cannon** on the east lawn shoots Pip onto the castle's roofs, all the way up to the top
  of the keep, where a ring of coins and a sign wait. Step onto its glowing pad to climb in.

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
| fly | with the winged hat (from the crystal box), triple jump (or flip off a tree top): Pip takes off at the top of the jump and climbs. Like an aeroplane: pull back to climb, push forward to dive, left/right to bank. The run-up's forward push counts as "level" until you let go once. Crouch to drop |
| grab & throw a tail | attack next to Rustmaw's glowing tail coupling grabs it; rotate the stick in circles to spin (faster each circle), attack again to throw; crouch lets go |
| cannon | step onto the glowing pad beside the cannon: Pip hops into the barrel. Aim with the stick (up raises the barrel; the reticle shows where it points), jump fires, attack or crouch climbs back out. Mid-shot, crouch ground-pounds and attack dives; a landing from a shot never hurts. With the winged hat the shot turns into flight at its peak |

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

## Play with your phone as a controller

Your phone can steer Pip in the game running on your computer, over your local Wi-Fi. This
works only when the computer serves the game itself, because the phone and the game talk
through a small relay in the local server:

1. On the computer, run `npm run dev` (or `npm run build && npm run preview`). The server
   listens on your network and prints a `Local` URL and one or more `Network` URLs.
2. Open the `Local` URL (for example `http://localhost:5173/`) in a browser on the computer.
3. On the title screen or the pause screen, press the phone button to show a QR code.
4. Connect the phone to the same Wi-Fi network and scan the QR code with its camera. The
   controller page opens and pairs with the game by its four-letter room code. Pip now
   follows the phone; the keyboard and gamepads keep working as well.

One phone controls a game at a time: a second phone that scans the code takes over from the
first.

If there is no phone button, the server is not reachable from other devices: it was started
with `--host localhost` or `--host 127.0.0.1` (which keeps it on this computer only; start it
without that, or with `--host`), or the computer is not connected to a network.

If the phone can't connect:

* The first time, Windows or macOS may ask whether Node.js may accept incoming network
  connections. Allow it (on private networks is enough). Firewall or antivirus software can
  also block the port (5173 for `dev`, 4173 for `preview`).
* The phone and the computer must be on the same network. Guest Wi-Fi networks and some
  office or public networks keep devices apart, and a VPN on either device can get in the
  way too.
* If the computer has several network adapters, the QR code may point at the wrong one. Open
  one of the other `Network` addresses the terminal printed on the phone, followed by
  `/pad.html?room=` and the room code (for example
  `http://192.168.1.20:5173/pad.html?room=ABCD`).

The hosted version (for example a claude.ai link, or any static web host) has no relay, so
the phone button is hidden there. You can still open that link on the phone itself and play
with the on-screen touch controls.

`npm run build` puts the controller page next to the game: `dist/pad.html`, with its own small
script, so the game itself is still a single script and the phone never loads it.

The relay only runs while `npm run dev` or `npm run preview` is running. It accepts only pages
served by that same server, and anyone on your network who knows the current room code
could join as the controller.

See `docs/ARCHITECTURE.md` for how the code is organised.
