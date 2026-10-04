# Castle Grounds

A late-90s-style 3D platformer hub level in the browser, built from scratch with three.js:
a fairy-tale castle on a moated island, a drawbridge, rolling lawns, a hill, a waterfall and
a pond, explored by Jonas (a cartoon avatar of the player: round glasses, messy brown hair,
a light blue cap and a red π t-shirt) with classic momentum-based platforming moves.

**An original homage.** Castle Grounds is an unofficial, non-commercial fan homage to the
castle-grounds hub levels of late-90s console 3D platformers. It is not affiliated with,
endorsed by or sponsored by the rights holders of the games that inspired it, and it uses
none of their characters, names, logos, emblems or assets. Everything is original and
generated in code at run time: the hero Jonas (an original cartoon of a real player, not any
existing character), the castle and every other model, every texture, the sky, the pixel
fonts, the HUD and title art, every sound effect and all of the music (synthesised with the
Web Audio API). The game loads no image, model, font or audio files; its only runtime
library is three.js.

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

* **Jonas's stretchy face**: open the game with `?face=1` for a start screen with Jonas's big face: grab and pull his cheeks, nose, glasses, ears or cap (they wobble back when let go), drag the sky to turn his head, scroll or pinch to zoom, then press Start to play.
* **Into the castle and on to the first course**: walk into the castle's big front door; see
  "The castle and Midsummer Skerries" and "Sparrow Lane" below.
* **Collect the 8 red coins** scattered around the grounds: when the last one is taken a
  **star** appears in the air above the courtyard in front of the castle door. Jump up and
  grab it.
* **Health** is the power meter (8 wedges; it shows up when Jonas is hurt or underwater). Long
  falls knock wedges off, and underwater Jonas slowly runs out of air (surface to breathe,
  which also heals). **Coins restore health**: a yellow coin one wedge, a red coin two.
* **Lives**: Jonas starts with 4. Running out of health, or falling out of the world, costs one
  and he drops back in at the start; losing one at ×0 is GAME OVER. A **1-up gem** is hidden
  somewhere on the grounds and gives an extra life.
* **With or without AI RACE**: the first screen, before the title, asks which game to play (up / down and Enter, or click an option; the choice is remembered). WITHOUT AI RACE leaves the AI RACE button off the lawn, so the grounds stay peaceful.
* **AI RACE**: ground-pound the AI RACE button to storm the grounds; among other horrors, server halls drop from the sky (dodge the red markers) and grind up out of the ground until tech has taken over the lawn. Pound STOP to end it for good: the button sinks into the ground and is gone until a new game.
  Don't take too long: if AI RACE is not stopped (or Rustmaw beaten) within **40 seconds**, the sky overheats (a klaxon warns you at 30 s), then catches fire, a blinding light rises over the horizon and the whole world burns white: GAME OVER, however many lives are left. Until the picture is completely white you can still pound STOP (the warning keeps blinking STOP THE AI RACE!) and everything fades back.
* **Beating Rustmaw** (the giant mechanical lizard on the castle roof in AI RACE mode): its tail
  runs back over the keep onto the flat roof behind it and ends in a glowing orange coupling.
  Get up there (fly with the winged cap, or take the cannon), walk up behind the coupling and
  press **attack** to grab it (it cannot spit fireballs while you hold on). **Rotate the stick in
  circles**: Jonas hauls the beast off the roof and whirls it round over the castle, faster with
  every circle (listen to the whoosh climb). Press **attack** again to throw it: with enough spin
  (about three circles) it flies off the castle and crashes down, which ends AI RACE mode and
  leaves a **star** at the crash site. Let go too early and it twists free, slams back onto its
  perch and knocks Jonas back; crouch lets go, and holding on without spinning it tears loose.
  Start AI RACE again for a rematch (the star is only won once per game).
* **The cannon** on the east lawn shoots Jonas onto the castle's roofs, all the way up to the top
  of the keep, where a ring of coins and a sign wait. Step onto its glowing pad to climb in.

### The castle and Midsummer Skerries

**Into the castle**: walk up the steps to the big front door and keep walking into it. The door
creaks and its two big leaves swing open onto the dark passage behind, Jonas steps into it as
the picture closes in a circle around him, and it opens again inside the **Great Hall**, a warm
vaulted hall in a golden haze, with gleaming rose-marble columns, teal panelling and a polished
tiled floor that mirrors the room, where the ship in a bottle lies in a round apse at the top
of a round stepped dais. A **1-up** waits on the fireplace's mantel: wall-kick up the narrow gap
beside it, or climb the banner pole and jump from its top. Of the two doors in the east wall,
the one with the snowflake over it is still being built (it only rattles); the one with the
little red house over it leads to Sparrow Lane (below). The front door, inside, swings open the same way and takes him
back out onto the porch, where it swings shut behind him with a thud as the picture opens.
While AI RACE is on (or its storm is still clearing) the storm keeps the door sealed. The hall
has its own music, a music-box waltz, over the crackle of the fire in its hearth, and every
step and jump rings in the big room.

**The ship in the bottle** lies on its stand at the far end of the hall, with a tiny sea, a
red-sailed boat and a lighthouse inside it. Climb the round steps (the books and the cork are a
little climb of their own) to its mouth and walk into the neck: Jonas shrinks to fit, dives in
and drops out of the sky onto a jetty in **Midsummer Skerries**, the first course: a bay of
pink granite rocks in the midsummer evening, with the bottle's red-sailed boat moored at the
jetty. Far out on the last rock stands a white lighthouse with a red band, and the course's
**star** sits on its lamp gallery. A brisk polska plays over the wind, the lapping waves and
the gulls.

* Three ways out to the lighthouse's rock: **hop across the skerries** to the west (one gap is
  too wide for a normal jump: a sign there teaches the **long jump**, and a row of coins shows
  the way); **swim across the sound** to the sandy beach (stand up for a rest on the sand bar
  half way, or dive down to the **sunken rowing boat**: its coins and the course's **1-up** lie
  in it); or take the **fishermen's boardwalk** east (run and jump where planks are missing,
  balance along the single plank) to East Rock with its red sheds. There, **wall-kick** up the
  narrow gap between the granite pinnacle and the tall net shed, or climb the net mast and jump
  from its top, onto the shed's loft; then walk the **plank bridge** down to the lighthouse's
  rock (jump the gap in its middle at a run). Missed a jump? The water is friendly: swim to a
  rock and jump out (pull back and press jump at the surface).
* Wreath frogs and mosquitoes live on the meadow of Midsummer Skerries, and a tin crab guards
  the sand bar's rest stop in the Sound (another hides on the islet). Watch their tell, then
  jump on them or punch them!
* On the lighthouse's rock, hop up the two stone blocks (or double jump up the rock face), climb
  the wooden stair, then the tall **signal mast** in front of the lighthouse: climb all the way
  up (the camera turns round to show the lighthouse ahead), stand on your hands on its top, push
  up toward the lighthouse and jump onto the gallery. Walk round to the star.
* The star lights the lighthouse: its lamp glows and two beams sweep round the bay for the rest
  of the game, and the tiny lighthouse in the bottle lights up too (a gold lamp with little beams
  turning round inside the glass). Then it takes Jonas back out of the bottle into the Great
  Hall (one more star on the counter), popping out onto the dais; walk straight back into the
  neck to go again. To leave without it, pause and press **J** (B on a gamepad or the touch
  controls): the pause screen shows "Leave course" (not while Jonas is still dropping in). A life
  lost in the course drops him back onto the jetty; GAME OVER, wherever it happens, goes back to
  the castle grounds and puts every coin and star back.
* 58 coins wait in the course: along the jetty, on the skerries, in the air over the long
  jump's gap, up the signal mast, round the gallery, along the boardwalk, up the wall-kick gap,
  down the plank bridge, in the sunken boat, and round and up the **maypole** on Home Island's
  midsummer meadow (by the red cottage and the flagpole; butterflies over it and gulls in the
  sky). The maypole, the flagpole and the masts can all be climbed.

### Sparrow Lane

The east door with the **little red house** on its plaque (right beside the way in) swings open
like the front door and takes Jonas to **Sparrow Lane**, the second course: his own street on a
golden autumn afternoon. He steps out of his own black front door onto the path of his long red
house, with the mailbox (a little blue sparrow keeps watch over it: read it) by the street; up
the hill across the street stand villas behind grey stone walls, with steps, drives and side
yards up to the forest; along his side long low houses joined by flat-roofed carports; a turning
area at the far end with a double garage and a footpath, the junction with its big trees and a
motorhome at the other. Cars stand on the drives (his own two in front of the carport) and flags
fly over the gardens. Nothing here can hurt him.

The street **looks real**, while Jonas, the coins and the star stay classic: low golden sunlight
with real shadows, a deep blue sky with drifting cirrus, painted-in-code brick, boards, roof tiles,
asphalt and lawns with blades of grass, windows set in the walls that reflect the street, leafy
hedges and trees swaying in the gusts, spruces up the hill. Modern crossovers, a hatchback, an
estate and a van stand on the drives (no plates, no badges), lacquered, each reflecting what
stands round it, sitting on their tyres with a soft shadow under them. The street is lived in:
dirt at the foot of the walls, rain streaks under the window sills, moss on the roofs and the
kerbs, a darker wheel track down the asphalt and glossy sealed patches, fallen leaves and grit in
the gutters, weeds in the kerbs' joints, gravel along the walls, dandelions in the lawns; snow
guards, ladders, vents and TV aerials on the roofs, air bricks, doorbells and a hose reel on the
walls, a blank street sign at the junction. And it is filmed
like a modern open-world game: soft contact shadows where things meet the ground, a glow round
the low sun and its rays through the trees, the houses' and trees' shadows all the way down the
street, a cinematic colour grade with subtle film grain, and a lower, wider camera over the
shoulder. Jonas is himself, just a little smaller there. The game picks the detail for your
computer or phone and steps it down (or back up) by itself if the picture stutters (F1 shows
how it draws, and on a computer how long the graphics card takes a frame); **G** shows the
street in the classic look instead (and back, Jonas and the camera with it), and **R** / **F2**
there shows the real street through the retro TV.

* The course's **star** twinkles over the ridge of Jonas's roof. Climb a **wheelie bin** by the
  carport, jump onto the carport's flat roof and hop across onto the roof's slope, then walk up to
  the ridge. Or jump right at the front wall to grab the eaves, or climb the little red-leaf tree
  in the round bed, stand on your hands on its top and flip onto the roof. The cars on the drive
  make steps too: onto the blue car's bonnet, its roof, then the carport.
* 50 coins: down the path, on the mailbox's roof, along the street, round the turning area, along
  the villas' walls and up their steps, up a drive and a side yard, on the motorhome's roof (a
  double jump), round the junction's lamppost, along a hedge top, on the carport and up the roof.
* The lampposts at the junction and the turning area, the three flagpoles and the red-leaf tree
  can be climbed: a handstand on top shows the lane.
* Up the steps at the turning area there is a **trampoline** in a garden: jump onto it and keep
  the jump button held to bounce sky high, up to the secret **1-up** floating over it. The
  basketball hoop beside it makes a fine perch (hop over from the van's roof).
* The star takes Jonas back into the Great Hall in front of the little house's door; so does
  pausing and pressing **J** (B), and walking back into his own front door.

### Moves

| Move | How |
|---|---|
| double / triple jump | jump again just as Jonas lands; the third in a row (at running speed) goes highest |
| long jump | while running, crouch (slide) and jump right away |
| backflip | crouch standing still, then jump |
| side flip | while running, pull the stick the opposite way and jump during the skid |
| wall kick | jump into a wall and press jump again just as Jonas hits it; chain them between two walls |
| punch, kick | attack standing still (press repeatedly for a punch-punch-kick combo) |
| dive | attack while running fast, on the ground or in the air |
| jump kick | attack in the air at low speed |
| ground pound | crouch in the air |
| ledge grab | automatic when Jonas falls past the edge of a ledge he faces: jump or push toward it to climb up, crouch or pull back to let go |
| climb trees | jump into a tree trunk to hug it: stick up climbs, down slides, jump leaps off, crouch lets go |
| swim | jump to stroke, hold jump to kick along; at the surface pull back and jump to leap out, crouch (or push up and jump) to dive |
| fly | with the winged cap (from the crystal box), triple jump (or flip off a tree top): Jonas takes off at the top of the jump and climbs. Like an aeroplane: pull back to climb, push forward to dive, left/right to bank. The run-up's forward push counts as "level" until you let go once. Crouch to drop |
| grab & throw a tail | attack next to Rustmaw's glowing tail coupling grabs it; rotate the stick in circles to spin (faster each circle), attack again to throw; crouch lets go |
| cannon | step onto the glowing pad beside the cannon: Jonas hops into the barrel. Aim with the stick (up raises the barrel; the reticle shows where it points), jump fires, attack or crouch climbs back out. Mid-shot, crouch ground-pounds and attack dives; a landing from a shot never hurts. With the winged cap the shot turns into flight at its peak |

## Controls

| Keyboard | Gamepad (Xbox-style / Switch-style) | |
|---|---|---|
| WASD (Q: walk slowly) | left stick | move |
| Space / K | A (bottom) / A (right) | jump |
| J | X or B / B (bottom) | attack (punch, kick, dive) |
| Shift / L | triggers, LB / ZL, ZR, L | crouch, ground pound |
| arrow keys, mouse drag | right stick, d-pad | camera (up from close: first-person look) |
| C | RB | camera mode |
| Enter / Esc | Start | pause (shows the controls) |
| J (while paused in a course) | B (while paused in a course) | leave the course (back out of the ship in the bottle) |
| R (or F2) | | retro filter (the low-resolution N64 look on/off; in Sparrow Lane's real look, for that visit) |
| G | | Sparrow Lane: the classic look instead of the real one (and back), for this session |
| 4 (or F3) | | 4:3 screen |
| V | | record video, landscape: V starts, V again stops and saves a Full HD (1920x1080) MP4 or WebM with sound (works when the game runs on your own computer, `npm run dev` / `npm run preview`) |
| 9 | | record video, portrait: the same at 1080x1920 (9:16), for Instagram Reels and Stories; 9 (or V) again stops and saves |
| F | | fullscreen: the game fills the whole screen, without the browser's bars (F again leaves; in Chrome and Edge hold Esc to leave, a short Esc still pauses) |
| F1 | | debug overlay |

USB and Bluetooth gamepads work (several connected pads are all read); press a button once
so the browser shows the pad to the game. Switch-style pads jump with the button labelled A
(on the right) and attack with B (at the bottom). On a first visit
the title asks for any key, click or tap first (browsers only allow sound after one), then
for Start; a gamepad Start begins right away.

The recording is always exactly Full HD, 1920x1080 (16:9, V) or 1080x1920 (9:16, 9),
whatever the window's shape: while it runs the picture is framed at that shape in the window
(with bars as needed: in a normal wide window, portrait is a tall column in the middle) and a
blinking REC shows in the corner (not recorded); it stops by itself after 10 minutes or when
the tab is hidden. In portrait the camera sees a little wider, so the narrow picture still
shows Jonas's surroundings (the castle front fills it from the start), and the retro filter
keeps its 240 pixels across the short side. The file is MP4 (H.264 + AAC, which every phone
and Instagram take) where the browser can record it (recent Chrome, Edge and Safari), else
WebM (VP9 + Opus, e.g. Firefox). Portrait files end in `-portrait`
(`castle-grounds-2026-09-27-1412-portrait.mp4`). Inside the published artifact page (an iframe
that blocks downloads) V and 9 only explain this.

URL flags: `?skipTitle=1` (straight into play), `?mute=1`, `?test=1` (no real-time loop;
driven through `window.__game`, see the docs), `?area=hall`, `?area=skerries` or `?area=lane`
(with `?skipTitle=1` or `?test=1`: start inside the Great Hall, in Midsummer Skerries or in
Sparrow Lane), `?look=classic` (Sparrow Lane in its classic look), `?tier=high`, `mid` or `low`
(its real look at that detail, as asked: no automatic stepping; high has every film effect,
mid the contact shadows and the glow, low, for phones, none of them).

## Play with your phone as a controller

Your phone can steer Jonas in the game running on your computer, over your local Wi-Fi. This
works only when the computer serves the game itself, because the phone and the game talk
through a small relay in the local server:

1. On the computer, run `npm run dev` (or `npm run build && npm run preview`). The server
   listens on your network and prints a `Local` URL and one or more `Network` URLs.
2. Open the `Local` URL (for example `http://localhost:5173/`) in a browser on the computer.
3. On the title screen or the pause screen, press P to show a QR code.
4. Connect the phone to the same Wi-Fi network and scan the QR code with its camera. The
   controller page opens and pairs with the game by its four-letter room code. Jonas now
   follows the phone; the keyboard and gamepads keep working as well.

One phone controls a game at a time: a second phone that scans the code takes over from the
first.

If P shows nothing (and the pause screen lists no P row), the server is not reachable from
other devices: it was started with `--host localhost` or `--host 127.0.0.1` (which keeps it on
this computer only; start it without that, or with `--host`), or the computer is not
connected to a network.

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
P does nothing there. You can still open that link on the phone itself and play
with the on-screen touch controls.

`npm run build` puts the controller page next to the game: `dist/pad.html`, with its own small
script, so the game itself is still a single script and the phone never loads it.

The relay only runs while `npm run dev` or `npm run preview` is running. It accepts only pages
served by that same server, and anyone on your network who knows the current room code
could join as the controller.

See `docs/ARCHITECTURE.md` for how the code is organised.
