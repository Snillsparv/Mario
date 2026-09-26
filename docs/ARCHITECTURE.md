# Castle Grounds — architecture & module contracts

An N64-era 3D platformer level (a castle on a moated island with a lawn, hills, a
waterfall and a pond) rendered with three.js. The goal is to recreate the **look and feel**
of a late-90s N64 platformer's castle-grounds hub as closely as possible: low-poly
geometry, small bilinear-filtered textures, baked vertex-colour lighting, low-poly 3D trees,
panoramic sky, distance fog, a 30 Hz simulation with momentum-based movement, and a
camera that trails the hero.

**Originality rule (hard requirement):** every asset is created from scratch in code. The
hero is an **original character** (see "Hero design" below), not an existing mascot. No
Nintendo characters, logos, emblems, fonts, textures, sounds, music or melodies. The
castle is an original fairy-tale castle design. Game mechanics (jump arcs, triple jump,
long jump, wall kick, camera behaviour) are fine to reproduce; code and assets are not
copied from anywhere (in particular, never copy or transliterate decompiled game source).

## Units and conventions

* 1 unit ≈ 1 cm. The hero is ~160 units tall, collision radius 50.
* Y is up. `yaw = 0` faces **+Z**; forward vector = `(sin yaw, 0, cos yaw)`. This equals
  three.js `rotation.y` for models whose front faces +Z.
* Simulation: fixed **30 Hz** ticks (`FRAME_DT = 1/30`). Velocities are units/tick,
  gravity ≈ 4 units/tick². Rendering interpolates between the previous and current tick
  with `alpha ∈ [0,1]`.
* `src/core/math.js`: `clamp`, `lerp`, `smoothstep`, `wrapAngle`, `angleDiff`, `lerpAngle`,
  `approachAngle`, `approach`, `stickToWorldYaw(stickX, stickY, cameraYaw)`, `makeRng(seed)`.
* `src/core/constants.js`: `FPS`, `FRAME_DT`, `MAX_STEPS_PER_FRAME`, `FLOOR_TOLERANCE` (78),
  `FLOOR_LOWER_LIMIT`, `CEIL_NONE`, `NO_WATER`, `PLAYER_HEIGHT`, `PLAYER_RADIUS`,
  `GAME_OVER_SECONDS` (3.2: the GAME OVER card in main.js; the audio's game-over jingle and
  ambience duck are timed to the same value).

## Frame flow (`src/main.js`, owned by integration)

Setup: `view.alignOverlay(uiRoot)` (the HUD/title follow the 4:3 pillarbox),
`view.setWaterLevelFn(collision.waterLevelAt)`, `cam.reset(player)`.

Game flow, `state.mode` `'title' → 'play' → 'gameover' → 'title' …` (`'face'` instead of
`'title'` with `?face=1`):

```
title:    new TitleScreen(uiRoot, { events, audio }).show()   (requests the 'title' track)
          two phases on a first visit (audio still locked by the browser's autoplay rules):
            1. PRESS ANY KEY: any key/click/tap unlocks audio and starts the title
               track; that press is swallowed (it does not start the game)
            2. PRESS START: Enter/Space/Esc/click on the card/gamepad Start or A starts
          phase 1 is skipped when audio is muted, unavailable or already allowed (the title
          after a game over); a gamepad press is no user gesture, so a pad starts from either
          phase (audio then unlocks on the first key/click in play)
          show() resolves after the start key/button is released too (the game never sees it)
          hud.setVisible(false); hero model hidden
          rAF: level.update(t), objects.animate(t), cam.titleOrbit(t), cam.apply(1), view.render()
          (until play starts, objects.animate() runs the objects' ambient clock from t itself:
          birds and butterflies move, nothing can be picked up; see Objects)
face:     (opt-in, ?face=1) new FaceScreen(uiRoot, { events, audio, view }).show()   (see "Face screen")
          Jonas's big stretchy head in a scene of its own, drawn by view.setView(scene, camera)
          instead of the world (nothing in main ticks or draws meanwhile); the title track
          plays on; show() resolves once Start (Enter/Space/Esc, pad Start/A, touch START/A,
          phone START/A, a click on its hint line) has been pressed and released
          (menuPlan(location.search), ui/face/stretch.js: no title/face with ?test / ?skipTitle;
          the face screen is opt-in: ?face=1 opens it instead of the title card)
start:    hud.setVisible(true); player.beginIntro(); cam.startIntro(player)
          dropHold = 60 ticks: Jonas waits hidden above the spawn while the 96-tick fly-in runs,
          then drops (~32 ticks) and lands as the camera settles behind him
          input.flush(); emit 'gameStart' (stops the menu track; AudioEngine unlocks audio here
          only with sticky user activation, so a pad-only start creates no blocked
          AudioContext); audio.playMusic('castle_grounds')
respawn:  player enters 'spawn' again (Player.respawn after death / out of bounds)
          -> cam.reset(player) (behind Jonas, facing the castle)
lives:    4 at start; 'lifeLost' at x0 -> once the death plays out: mode 'gameover', emit
          'gameOver' (audio plays the 'game_over' jingle), new GameOverCard(uiRoot).show()
          over the frozen world for GAME_OVER_SECONDS (3.2 s, core/constants.js); then
          card.remove(), objects.reset(), player.coins = 0, lives = 4 — all *before* the
          title, so the title backdrop already shows the new game's world — then the title,
          the face screen and start (with the intro) as above
meltdown: AI RACE not stopped within 40 s (see "Meltdown"): once the white has held a second,
          meltdown.update() returns 'over' and main calls the same gameOver() directly ("game
          over now", whatever the lives left; a pending death's game over is dropped); its reset
          also calls meltdown.reset() (sky, grade, white-out, embers, light, sounds, clock)
```

Simulation and rendering:

```
tick (30 Hz, only in 'play'):
  controller = input.poll()
  START.pressed -> toggle pause (hud.setPaused, emit 'pause' / 'unpause')
  paused -> return                        (nothing below runs; state.time stands still)
  state.time += FRAME_DT
  darkT eases toward state.dark (AI RACE mode: applyDarkness(t), see below)
  meltdown.update(camera.position, cam.getYaw()) === 'over' -> gameOver(), return   (see "Meltdown")
  dropHold > 0 ? dropHold-- : player.update(cam.playerInput(controller), cam.getYaw())
  action changed to 'spawn' -> respawn / game over (above)
  objects.update({ player, frame, camera })
  cam.update(controller, player)
  hud.update({ lives, coins, stars, health, showPower, breath, paused })
  audio.setListener(cam.camera.position, cam.getYaw())
render (rAF):
  input.sample()                          (latches gamepad flicks between ticks)
  rs = player.getRenderState(alpha); model.update(rs, paused ? 0 : dt)
  model.object3D.visible = play && !dropHold && !cam.hideHero
  cam.apply(alpha); level.update(state.time, threeCamera); objects.animate(state.time, alpha, threeCamera)
  audio.update(dt); view.render()
```

While paused (or on the game-over card) `alpha` is held and `state.time` does not advance,
so the world (water, waterfall, flags, clouds), the objects and the hero all freeze.

Input (`src/core/input.js`): `poll()` once per tick; a key or pad button that goes down and
up between two polls still reads as held for one poll (`pressed`, then `released`);
The keyboard's digital stick eases in from rest (0.3 to full over ~0.37 s) so a run starts
gently, like tilting an analog stick; turning and releasing are immediate, and gamepads keep
their true analog value. `sample()` per render frame latches pad buttons; `flush()` drops latched taps and makes held
buttons not count as fresh presses; `setOverride(partialController)` for tests.
Gamepads: every connected standard-mapping pad is read and merged (buttons OR'ed, the stick
pushed furthest wins), so an idle or odd device at index 0 cannot hide the real controller;
pads without the standard mapping are read only when no standard pad is connected (then the
most recently active one). Face buttons by `padLayout(pad)`: `'standard'` (an Xbox-style
standard pad: bottom jumps, right or left attacks), `'nintendo'` (a standard pad whose id
names Nintendo, a Switch / Pro Controller or a Switch pad maker: the right button, labelled A,
jumps and the bottom one, labelled B, attacks) and `'raw'` (no standard mapping, read in the
Switch's own order Y B A X L R ZL ZR - +: right (A) jumps, bottom (B) attacks, left and top do
nothing, no d-pad buttons; its right stick is axes 2 and 5, the HID Z and Rz, or 2 and 3 when the
browser reports no more than 5 axes). The title starts from any pad's Start or face buttons 0-2, and the
pause legend names a Nintendo-style or raw pad's buttons by the Switch labels.
`input.getGamepads` can be replaced in tests. Mouse-drag orbit
ends on mouseup, on window blur, and on the first move with neither drag button held.

Test hooks: `?test=1` disables the real-time loop and the first title (the title still
follows a game over, as in play) and exposes
`window.__game`: `step(n, controllerOverride)` (n ticks, then one draw; the hero model is
posed after every tick with dt = 1/30 s, like a 30 fps real-time run, so pose blends, blinks
and wing flaps have caught up after a big step), `render()` (draw with dt 0),
`snapshot()`, `startGame(intro = true)` (replay the intro flow), and `player`, `camera`,
`level`, `objects`, `state`, `view`, `input`, `hud`, `audio`, `model`, `events`, `fx`, `shake`,
`meltdown` (AI RACE's 40-second clock: `meltdown.skipTo(seconds)` jumps it ahead, `.phase`,
`.seconds`, `.levels`; see "Meltdown"), `setDark(on)`,
`neutralController`, `face` (the FaceScreen while it shows, else null). `?skipTitle=1` skips
the title, the face screen and the intro. `?face=1` opens the (opt-in) face screen at once
(no title card). `?mute=1` disables audio.
`window.__ready` is set once play starts (after the title without `?skipTitle`).
In `?test=1` nothing requests animation frames while the GAME OVER card shows, so headless
Chromium does not advance its CSS fade (it stays transparent until something paints, e.g. a
resize); check the card's look in a real-time run (`/?skipTitle=1`).

## Module ownership (one owner per file set)

| Area | Files | Contract |
|---|---|---|
| Core | `src/core/*`, `src/main.js`, `src/world/level.js`, `index.html`, `vite.config.js`, `tools/*`, `docs/*` | integration |
| Collision | `src/collision/*` | below |
| Layout | `src/world/layout.js` | anchors are shared contract |
| Terrain + water | `src/world/terrain.js`, `src/world/terrain/*` (tessellate, floorBlocks, walls, shading, MeshBuffer), `src/world/water.js`, `src/world/terrainTextures.js` | WorldPart |
| Castle + bridge | `src/world/castle.js`, `src/world/castle/*` | WorldPart |
| Props | `src/world/props.js`, `src/world/props/*` (trees, fences, waterfall, flowers, rocks) | WorldPart |
| Sky | `src/world/sky.js` | WorldPart |
| Player physics | `src/player/Player.js`, `src/player/actions/*`, `src/player/physics/*` | Player |
| Hero model | `src/player/PlayerModel.js`, `src/player/model/*` | PlayerModel |
| Camera | `src/camera/*` | CameraController |
| Renderer | `src/render/N64Renderer.js`, `src/render/post/*` (texgen/materials are shared helpers) | N64Renderer |
| Audio | `src/audio/*` | AudioEngine |
| HUD/title | `src/ui/*` (incl. `logoWorker.js`, the title logo's off-thread renderer, and `face/*`, the face screen's head, art and logic) | HUD, TitleScreen, FaceScreen |
| Objects | `src/objects/*` | ObjectManager |

Each area also owns `src/dev/previews/<area>.js` (preview page) and `tests/<area>*.test.js`.

## Collision (`src/collision/CollisionWorld.js`)

Triangle soup, classified by unit normal: floor `n.y > 0.1`, ceiling `n.y < -0.1`, else
wall. Uniform XZ grid (1000-unit cells). **Winding matters**: author collider triangles
CCW when viewed from the side they face (three.js default front faces).

* `addTriangles(flatPositions, { surface, terrain })`, `addObject(object3D, opts)`
  (world-space, honours `mesh.userData.collide === false`, `.surface`, `.terrain`),
  `addCollider({ object3D?, positions?, surface?, terrain? })`, `addPole({x,z,y0,y1,radius})`,
  `setWaterLevelFn(fn)`, `finalize()`.
* `findFloor(x, y, z, tol = 78) -> { y, surface }` highest floor with height ≤ y + tol;
  `y = FLOOR_LOWER_LIMIT, surface = null` if none.
* `findCeil(x, y, z, tol = 78) -> { y, surface }` lowest ceiling with height ≥ y − tol;
  `y = CEIL_NONE` if none.
* `findWalls(x, y, z, offsetY, radius) -> { x, z, walls[] }` pushes the point at height
  `y + offsetY` out of all walls within `radius` horizontally (SM64-style). When nothing is
  touched `walls` is a shared frozen empty array: read it, never mutate it.
* `raycast(origin, dir, maxDist, { floors, walls, ceilings }) -> { point, normal, distance, surface } | null`
  (each kind defaults to true; results are fresh objects).
* `waterLevelAt(x, z) -> height | NO_WATER`. `findPole(x, y, z, reach) -> pole | null`.
* Surface: `{ kind: 'floor'|'ceil'|'wall', a, b, c, normal:{x,y,z}, d, minY, maxY,
  surface: 'default'|'not_slippery'|'slippery'|'very_slippery'|'death', terrain:
  'grass'|'stone'|'wood'|'sand'|'water', hn (walls: horizontal normal), hscale (walls:
  length of the normal's horizontal part), tx/tz/pu/ys (walls: face-space extent) }`.
  Queries allocate nothing but their result objects (numeric grid keys, precomputed wall
  data).
  `CollisionWorld.planeHeight(surface, x, z)`.

## World parts (`src/world/*.js`)

Each builder is `build*(layout) -> WorldPart`:

```js
{
  object3D: THREE.Object3D,                    // added to the scene
  colliders: [{ object3D?, positions?, surface?, terrain? }],
  poles?: [{ x, z, y0, y1, radius }],          // climbable tree trunks
  update?(timeSeconds, threeCamera),           // per render frame (scrolling water, billboards)
}
```

The sky (`src/world/sky.js`) is a `BackSide`, unfogged dome whose mesh is named
**`'skyDome'`**: the renderer's underwater tint finds it by that name
(`src/render/post/underwater.js` `SKY_DOME_NAME`), so renaming it silently turns the tint off.

`src/world/layout.js` is the single source of truth for positions: `SPAWN`, `CASTLE`,
`BRIDGE`, `ISLAND`, `MOAT`, `POND`, `WATERFALL`, `EAST_HILL`, `WEST_MOUND`, `PERIMETER`,
`PATHS`, `TREES`, `FENCES`, `COINS`, `RED_COINS`, `STAR`, `BUTTERFLY_SPOTS`,
`BIRD_CIRCLES`, heights `WATER_LEVEL`, `MOAT_FLOOR`, `LAWN_BASE`, `ISLAND_TOP`,
`CLIFF_TOP`, and functions `groundHeight(x,z)`, `lawnHeight(x,z)`, `regionAt(x,z)`
(`'lawn'|'island'|'water'|'cliff'`), `pathMask(x,z)`, `waterLevelAt(x,z)`, `SUN_DIR`.
Builders place things with `groundHeight()`; the terrain mesh must match it.

Current heights: `WATER_LEVEL = -20` (moat + pond surface, 120 below the lawn rim so the
water shows from the path; was -420), `MOAT_FLOOR = -1100` (deep enough to swim),
`LAWN_BASE = 100`, `ISLAND_TOP = 160`, `CLIFF_TOP = 1600` (perimeter cliffs out of reach
but below the castle walls; was 2600). Further exports used by the terrain and objects:
`COURTYARD`, the signed-distance helpers `sdWater`, `sdRoundRect`, `sdCircle`,
`distToPath`, the per-region heights `waterFloorHeight`, `islandHeight`, `cliffHeight`,
`regionHeight(region, x, z)`, and the terrain facet grid `FACET` (500) / `facetFlip(i, j)`.
An optional `ONE_UP = { x, z }` places the hidden 1-up gem (ObjectManager reads it; the
default spot is 800 behind the castle's back wall).
`CANNON = { x, z, yaw, pad }` places the cannon (see "Cannon"; `yaw`: its barrel's rest
direction, toward the keep; `pad`: its loading pad's direction off `yaw`), and `KEEP_TOP =
{ x, z, y, halfX, halfZ, towerR, eaveR }` describes the top of the castle, the keep's flat
roof walkway round the base of the round upper tower (castle/building.js), where a ring of
coins (`COINS` entries with `y`) and the `'keep_top'` sign wait.

### Look guidelines (all world parts)

* Materials: `worldMaterial()` from `src/render/materials.js` (unlit `MeshBasicMaterial`,
  texture × vertex colour, fog on). Transparent `DoubleSide` materials get
  `forceSinglePass = true` (one draw instead of three.js's back-then-front pair, which also
  rebuilds the program key each pass): fine for flat sheets like water and the waterfall, but
  a transparent double-sided shape that overlaps itself needs its own material. Bake lighting with `bakeLighting(geometry, opts)`
  (sun = `layout.SUN_DIR`) plus any hand-painted vertex tints / fake AO.
* Textures: paint procedurally with `src/render/texgen.js` (`canvasTexture`,
  `tileableNoise`, `tileableFbm`, `paintPixels`). 32–128 px, bilinear, repeat. Texel
  density roughly 1 texel ≈ 8–16 units, like the N64.
* Low-poly: chunky shapes, flat or gouraud-shaded faces, 3–12 sided cylinders/cones.
* Palette: saturated but soft greens for grass, cream/beige stone castle walls, deep red
  conical roofs, grey stone bricks, brown wood, blue-green translucent water, bright blue
  sky with white clouds.

## Player (`src/player/Player.js`)

```js
new Player({ collision, events, spawn: { x, y, z, yaw } })
player.update(controller, cameraYaw)      // one 30 Hz tick
player.getRenderState(alpha) -> RenderState
player.pos {x,y,z}, player.vel {x,y,z}, player.forwardVel, player.faceYaw,
player.action (string), player.actionTimer, player.health (0..8), player.coins,
player.stars, player.inWater (bool), player.breath (0..1, optional),
player.floor ({ y, surface }), player.beginIntro()  // optional spawn drop-in
player.collectCoin(value)      // +coins, heals 1 wedge per coin value
player.collectStar()           // stars++, triggers the celebration action
player.takeDamage(wedges, fromPos, { fire }?)  // fire: true -> the 'burn' hot-foot hop
player.enterCannon(cannon)     // climb into a cannon (objects call it: see "Cannon")
player.cannon                  // { desc, phase, yaw, pitch, inside, ... } once in a cannon
```

Cross-module writes: `objects.reset()` takes the star it awarded back off `player.stars`
(stars − 1, not below 0); main sets `player.coins = 0` for a new game after GAME OVER.

Events emitted on `events` (see Events below): `sfx`, `land`, `footstep`, `hurt`,
`splash`, `lifeLost`.

`RenderState` (consumed by PlayerModel and blob shadow):

```js
{
  pos: {x,y,z},               // interpolated feet position
  yaw, pitch, roll,           // interpolated body orientation (radians); pitch>0 = nose down
  action: string,             // current physics action (informational)
  anim: AnimName,             // which animation to show (see list)
  animTime: number,           // seconds since this anim started (interpolated)
  cyclePhase: number,         // accumulated locomotion cycles (walk/run/crawl/swim); 1.0 = one full stride cycle
  forwardVel, vy,
  grounded, inWater,
  floorY, floorNormal: {x,y,z},
  health, invincible (bool: blink while true),
  punchStep: 0|1|2,
  headYaw?: number            // optional look-around offset
}
```

`AnimName` — the complete list both sides must support:
`idle, sleep, walk, run, tiptoe, skid, turnaround, push, crouch, crawl, crouch_slide,
jump, fall, land, double_jump, triple_jump, backflip, sideflip, long_jump, dive,
belly_slide, butt_slide, ground_pound_spin, ground_pound_fall, ground_pound_land,
wallkick, bonk, hurt, fall_damage, ledge_hang, ledge_climb, pole_hold, pole_climb,
pole_jump, punch1, punch2, kick, jump_kick, swim_idle, swim_stroke, swim_flutter,
water_surface, water_jump, star_dance, spawn, death, pole_handstand, burn, fly,
cannon_shot, tail_hold, tail_spin, tail_throw`.

Rustmaw's tail (`src/player/actions/tail.js`, see "AI RACE mode"): objects set
`player.tailGrip` (the beast's grip record, `null` without a beast); B next to the glowing
coupling (feet within `TAIL_GRAB_REACH` of the spot to hold it from) starts action
`tail_hold` (anim `tail_hold`: both mittens on the coupling's bar, leaning back, heels dug in)
instead of a punch or dive; stick circles build `player.tailSpeed` (rad/tick, faster with each
turn, winding down when the stick stops) and start `tail_spin` (anim `tail_spin`: the hands rise
along the taut tail as the beast is hauled up, then he spins on the spot, `faceYaw` turning by
`tailDir * tailSpeed`); B lets go (`tail_throw`, anim `tail_throw`: the fling and a fist; the
beast reads `player.tailRelease`, the spin it was let go at). Z in `tail_hold` lets go; holding on
without spinning for `TAIL_HOLD_TICKS`, or the beast going away, tears it loose (a stumble, no
damage); a spin that runs down lets go on its own (a weak throw). All three are 'automatic'
actions: Jonas never moves (his own spin cannot fling him off the roof) and takes no fall damage.

Tree tops: climbing past the top of a tree's pole enters action `pole_top` (anim
`pole_handstand`, a handstand on the crown). During it `RenderState.pos` is the pole tip
(where the hands are). A jumps off with a big flip (`pole_top_jump`), stick down climbs back
down, Z lets go; a fall that starts on a tree counts from its foot (no fall damage).

## Hero model (`src/player/PlayerModel.js`)

```js
const model = new PlayerModel()
model.object3D            // THREE.Group, origin at the feet, front faces +Z, ~160 units tall
model.update(renderState, dtSeconds)   // positions/rotates the group, poses limbs, blob shadow at floorY
```

Hero design ("Jonas", a cartoon avatar of the player): a cheerful chibi guy — big round
head (~40% of height), large friendly oval eyes behind thin dark round glasses (real
geometry in front of the eyes: two rings turned to follow the face, a bridge, short temples
into the hair; clear lenses), rosy cheeks, a round button nose, no moustache; rowdy brown
hair (tufts sticking out from under the cap at the sides and the nape, a few locks over the
forehead under the bill); a plain light blue baseball cap (a round six-panel crown with
darker seams, a button on top, a curved, slightly darker bill pointing forward; no letter,
emblem or logo); a red t-shirt with a white π on the chest and short sleeves (bare arms),
a little round at the belly; big white cartoon gloves with flared cuffs; black jeans; white sneakers with grey tongues and red soles over
odd ankle socks (blue on the left foot, yellow on the right). Built from low-poly
primitives with Lambert/Gouraud shading lit by the sun + ambient (the head's parts in
`model/head.js`, shared with the face screen), every bone merged into one vertex-coloured
mesh: 16 draw calls (15 bones and the painted face), ~2.9k triangles, plus the winged cap's
wings while he wears it. Includes an N64-style dark circular blob shadow projected onto the
floor. The cap's marker in the rig is still named `hat` (`rig.hat`, cap space: origin at the
centre of its band, `HAT_POS` / `HAT_ROT` in `model/head.js`).
Attack swell (like classic cartoon platformers): on `punch1`/`punch2` the striking hand
balloons to ~2x about its wrist joint, on `kick`/`jump_kick` the kicking sneaker to ~1.8x
about `dims.BOOT_PIVOT_Y`, and a dive swells both hands slightly; pose channels
`handLSwell/handRSwell/footLSwell/footRSwell`, deflating smoothly when an attack is cut short.

## Camera (`src/camera/CameraController.js`)

```js
new CameraController({ collision, camera /* THREE.PerspectiveCamera */, events })
cam.reset(player)   // snap behind the hero (level start, respawn)
cam.update(controller, player) /* 30 Hz */; cam.apply(alpha) /* render */
cam.getYaw()        // yaw the camera looks along (used for stick-relative movement)
cam.startIntro?(player)      // 96-tick fly-in from above the castle to behind the spawn
cam.titleOrbit?(timeSeconds) // slow orbit behind the title screen
cam.firstPerson     // C-up first-person look is active
cam.playerInput(c)  // controller for player.update (stick and A/B/Z withheld in first person)
cam.hideHero        // don't draw the hero (first person, or no room behind him)
cam.underwater      // the rendered camera position is below the water surface
cam.celebration     // the star-celebration swing state ({ ..., returning }) or null
cam.cannonView      // the cannon's aiming view is up (mode 'cannon', see "Cannon")
```

Swimmer under a low cover (`src/camera/cover.js`, `COVER_*` in `cameraConfig.js`): when a
swimming hero is under a low ceiling (the drawbridge deck) with no room for the camera between
the water and the deck, the camera goes **under the water surface with him** (look point
dropped, pitch held under the surface) and the orbit turns toward the nearest yaw with a clear
view along the water; the cover lasts until the camera is out from under the deck. So
`cam.underwater` (and the renderer's underwater fog) can be true while the hero swims at the
surface.

Star celebration (`src/camera/celebration.js`, `CELEBRATE_*`): while the hero dances (or drops
to dance) the orbit swings round to a three-quarter front view and moves in, then swings back
to where it was once the dance ends, unless the player moves the hero or turns the camera
first. The camera buttons wait for the dance and take over during the swing back.

Rustmaw's tail grab (`src/camera/bossCam.js`, `BOSS_CAM`): `cam.bossCam.update(cam, hero)` runs
after the orbit's tick and blends its own pose over the orbit's (the orbit keeps running
underneath, as in the intro; its weight `w` eases in and out): while Jonas holds the tail
(`tail_*` actions) it backs off and rises behind him over the roof's parapet, and as he hauls
the beast up it moves far back and up and looks up past him with a wider view (the beast
whirling round high over the castle); on `'bossThrown'` it chases the beast along its flight
(behind and above it, clear of what lies under it) and holds on the wreck until the reward star
starts to rise, then hands back to the orbit. Nothing changes while `w` is 0.

Keeping the hero in view (`src/camera/CameraCollider.js`, `src/camera/sight.js`):
* A C-left/C-right press first runs the swing ahead on a copy of the collider; if the hero
  would end up hidden behind something taller than him (a corner tower, a wall), the press
  is refused with `sfx 'camera_buzz'`. Low, see-through blockers (fences) never veto it.
* The collider checks whether the look point and the chest are visible from where the camera
  actually ends up. If both stay hidden (6 ticks with no lift or dolly helping, or 30 in all)
  it reports `trapped`: the dolly stops and `sight.js` turns the orbit toward the nearest
  clear yaw (it also swings a swimmer around the island's corners and to a clear view of the
  whole body under the bridge); if that fails the camera cuts after 45 ticks.
* Motion is speed-limited: the camera moves at most 40 units per tick more than the orbit or
  the hero does (true teleports and respawns snap), so drops into the moat and hill crests
  never lurch.
* Parapets: with the hero up on a roof or the keep top and the camera out over the drop
  beside it (the floor under the camera 400+ below his feet), a low wall close to him (a
  battlement, no taller than he is) hiding his chest lifts the camera until it looks over it.
  The castle's battlements (`castle/parts.js` `merlonRow`) are solid: the crenels between
  them are narrower than the hero, so he can't walk off a roof through them.

The orbit centre (look point) is `LOOK_HEIGHT` (150) above the hero's feet, but the rendered
view is aimed a few degrees *above* it (`cameraConfig.js` `ORBIT_MODES.*.aim`, eased, fading
out as the orbit steepens), so the hero stands in the lower middle of the picture; the orbit,
the collider's sight lines and `getYaw()` ignore the aim. Because of the aim the hero is no
longer at the centre of the view, so `cam.apply()` publishes **`camera.userData.focus`**
(`{ x, y, z }`, the interpolated look point `LOOK_HEIGHT` above the hero's feet, one reused
object; `null` while there is no hero to keep in view: title, intro, first person). The
props' foliage fade (`src/world/props/foliageFade.js`) reads it to find the
hero. Only when `focus` is `undefined` (previews, other cameras) does it estimate the hero
from the camera position and horizontal view direction, assuming the default 8° orbit pitch
and 1000–1450 trailing distance. That estimate ignores the aim, so it is only approximate:
a camera that frames the hero differently should publish `focus`.

## Renderer (`src/render/N64Renderer.js`)

```js
const view = new N64Renderer(containerElement, { internalHeight?, storage? })
view.scene, view.camera (THREE.PerspectiveCamera, vertical fov 45, near 20, far 45000)
view.render(); view.renderer (THREE.WebGLRenderer)
view.setWaterLevelFn(fn)          // surface heights for the underwater fog (default layout.waterLevelAt)
view.isUnderwater                 // the camera is below the water surface
view.viewport                     // picture rectangle in CSS px (4:3 pillarbox)
view.onViewportChange(fn) -> unsubscribe; view.alignOverlay(element)  // keep DOM overlays on the picture
view.setN64Mode(on); view.setPillarbox(on); view.setDebugOverlay(on)
view.setView(scene, camera)       // draw another scene (a menu: the face screen) instead of the
                                  // world, through the same retro filter; its camera's aspect
                                  // follows the picture; setView() = back to the world
view.setDarkness(t); view.flash(strength)   // AI RACE mode's storm (see "AI RACE mode")
view.setMeltdown(levels)          // AI RACE's meltdown (see "Meltdown"): fire grade, white-out,
                                  // glare, heat shimmer, fog and actor lights; all 0 = no change
```

While a `setView()` scene is drawn the world's underwater fog, storm grade, lightning flash and
meltdown grade are left out (`drawView()`), and the F1 overlay's mode line shows only the size.

Underwater (`src/render/post/underwater.js`, `UnderwaterFog`): while the camera is below the
water surface (per `setWaterLevelFn`) the scene fog is swapped for a short-range blue-green
one, and the sky dome (found by the mesh name `'skyDome'`, see World parts) is drawn with a
tinted copy of its material that mixes `UNDERWATER_SKY_TINT` of the fog colour into every
pixel, so looking up shows a murky surface instead of a clear sky. The tinted program is
compiled ahead of time while dry (`warm()`), so the first dive does not stall.

Keys: F1 debug overlay (fps, draw calls, triangles, render mode), F2 retro filter (240-line
render + 16-bit quantise/filter pass; off = native resolution), F3 4:3 pillarbox. Player-visible
labels are neutral ("Retro filter" in the pause legend, "Retro WxH" / "native WxH" in the F1
overlay, `MODE_LABELS`); internal names such as `N64Renderer`/`setN64Mode` are not shown. The
retro filter and pillarbox persist in `localStorage['castleGrounds.render.v1']`.

## Audio (`src/audio/AudioEngine.js`)

```js
const audio = new AudioEngine(events)   // subscribes to events itself
audio.unlock()                          // only after a user gesture (else the browser warns)
audio.play(name, { pos?, volume?, pitch?, terrain?, big?, index? }); audio.playMusic(name); audio.stopMusic()
audio.setListener(pos, yaw); audio.update(dt); audio.muted = true|false
```

All sound effects are synthesized with WebAudio. Music is an **original** composition.
Songs: `'title'` (a loop; a menu track stops on `gameStart`), `'castle_grounds'`, which
in game is a one-shot arrival cue (`finalBar: 8` in `songs.js`), not a loop, and
`'game_over'` ("Lanterns Out"), a jingle the engine plays **itself** on the `gameOver` event
(main never requests it) over the GAME OVER card, cutting whatever plays; the ambience is
ducked (to 0.3) for `GAME_OVER_SECONDS` (3.2 s, the card's length), then the title track
crossfades in from the jingle's last chord. A one-shot cue (`castle_grounds`, `game_over`)
requested without a running AudioContext, or while muted, is **dropped**, never queued to
start later (so a gamepad-only start skips the arrival cue); a looping track (`title`) is
queued until audio unlocks.
Audio also consumes `gameStart` (stops a menu track, clears ducks, unlocks with sticky user
activation) and `pause` / `unpause` (duck + sfx), and AI RACE's `darkMode`, `lightning` and
`meltdown` (see "Meltdown"; `audio.setMeltdown(levels)` drives its inferno ambience).

## HUD / title (`src/ui/*`)

```js
const hud = new HUD(uiRootElement, { events })  // subscribes to 'coin' (red-coin numbers use coin.index)
                                                //   and 'cannonView' (the cannon's reticle)
hud.update({ lives, coins, stars, health, showPower, breath, paused }); hud.setPaused(bool)
hud.setVisible(bool)          // hidden behind the title (hud.visible; hidden HUDs skip repaints)
hud.setViewport(rect | null)
const title = new TitleScreen(uiRootElement, { events, audio }); await title.show()  // can be shown again
title.setViewport(rect | null)
const face = new FaceScreen(uiRootElement, { events, audio, view }); await face.show()  // "Face screen"
const card = new GameOverCard(uiRootElement).show()  // dark screen + gold GAME OVER, fades in
new AlertBanner(uiRootElement, { events })   // AI RACE: 'darkMode' on, the meltdown's warning (30 s)
card.setViewport(rect | null); card.remove(); card.shown   // remove() at once; show() again ok
```

The HUD's lives counter shows Jonas's pixel face (`ICONS.hero` in `src/ui/icons.js`: light blue
cap, brown hair, round glasses); the title card reads "starring JONAS" (`HERO_NAME` in
`hudLogic.js`, logo letters in his cap's light blue and his t-shirt's red).

The HUD, title card and GAME OVER card re-layout when `devicePixelRatio` changes without a
size change (a window moved to another monitor): the HUD and title check it every frame, the
card listens through `src/ui/pixelRatio.js`, so the pixel font stays 1:1 with device pixels.

`GameOverCard` (`src/ui/GameOverCard.js`) draws GAME OVER in the HUD's pixel font at the size
of the pause screen's PAUSE, and follows its own box (window resize, F3 pillarbox via
`alignOverlay`), redrawing the text at the new scale. main shows it on game over and removes it
after `GAME_OVER_SECONDS`.

`show()` requests the `'title'` track. On a first visit, while the browser still holds audio
back, the card starts in a locked phase showing **PRESS ANY KEY**: the first key, click or
tap unlocks audio and starts the title music and is swallowed; the card then shows PRESS
START. The locked phase is skipped when audio is muted, unavailable or already allowed.
Gamepad presses are no user gesture, so a pad Start/A begins the game from either phase
(without creating audio). The start press calls `audio.unlock()` (keyboard/pointer only),
emits `sfx 'menu_select'`, fades the card out in 0.4 s, and `show()` resolves once the
start key/button is released as well.

## Face screen (`src/ui/FaceScreen.js`, `src/ui/face/*`)

Between the title card and play, like a classic N64 start screen's toy but with our own hero:
Jonas's big 3D head fills the picture, bobbing, swaying, blinking and watching the pointer, and
any bit of it can be grabbed and pulled about. Everything is original: Jonas's own design, a hand
pointer, a sky backdrop, synthesized sounds and our own texts.

* **Head** (`face/pipHead.js`, `PipHead`): the in-game head (`model/head.js` buildHeadParts,
  which `rig.js` buildHead uses too: the same shapes, sizes, placement, palette) built at a
  much higher density (skull 112x84 segments, a 112-segment crown, …) plus the neck and the
  red t-shirt's crew neck under the chin, all in head-centre space. Two meshes: the skull with
  the painted face, and every other part (cap, glasses, hair, nose, ears, collar) merged into
  one vertex-coloured mesh (`DoubleSide`). ~60k triangles. At rest it is tipped forward a
  touch (`REST_PITCH`) so the cap's bill shows over the glasses.
* **Face** (`face/faceArt.js`): the in-game painting (`faceTexture.js` `paintFace`, exported
  with `FACE_DESIGN`) repainted at 8 px per design px over the front of the head only (`CROP`;
  the skull's uv is the in-game head's, remapped onto the window, clamped to skin outside it),
  one texture per expression, uploaded when the screen opens. Open-eyed expressions are painted
  without irises: the skull's fragment shader draws them (`IRIS_GLSL`: the painting's iris
  gradient, pupil and catch lights, clipped to the eye white) at `uPipIris.xy`, so the eyes
  follow the pointer (with none about they drift back and wander).
* **Deformation** (`face/stretch.js`, shared by both materials through `onBeforeCompile`):
  up to `STRETCH.HANDLES` (8) handles, each a grab point in rest space, a radius and an offset;
  every vertex moves by `sum_i offset_i * falloff(|position - grab_i| / radius_i)` with
  `falloff(d) = (1 - d^2)^3` (1 at the grab point, 0 from one radius on, flat at both ends), from
  its rest position in head space, so skin, hair, cap, glasses, ears, nose and collar always
  move together (the round glasses stretch with the face like every other part).
  Normals go through the cofactor of the deformation's Jacobian. Radius `STRETCH.RADIUS` (19),
  `NOSE_RADIUS` (8.5: the nose pulls out alone, the eyes beside it stay) and `BRIM_RADIUS` (24,
  the cap's bill bends broadly) by where it was grabbed (`grabRadius`).
* **Springs**: a held handle follows its target (a stiff 6 Hz spring, so a fast pull lags a hair
  and carries momentum); offsets are soft-limited to `STRETCH.MAX` (72, ~2.4 head radii).
  Released, it springs back through rest with a lightly damped 3.1 Hz wobble (ζ 0.12, a jelly
  jiggle over ~2 s) and frees its slot once settled; several wobble at once. A grab takes a free
  slot, else the released one with the least wobble left; none while all eight are held.
* **Controls**: pressing on the head picks the point under the pointer on the *shown* surface
  (the CPU applies the same field to the rest positions and raycasts, `raycast()`), and the
  pull target is where the pointer meets that point's depth plane, plus a bulge toward the
  viewer (35 % of the drag, up to 26), in head space, so the grabbed point stays under the
  pointer while the head bobs. A drag on the sky turns the head (`HeadTurn`: yaw ±1.0, pitch
  ±0.5, soft-clamped, a 1.4 Hz spring back on release); the wheel, a pinch (two fingers on the
  sky) or +/- zoom (`Zoom`, 0.8..1.35, eased); two fingers on the face pull two handles; a quick
  tap pokes it (a boop on the nose); a pad's stick or the arrow keys turn it too. Mouse right
  button: always turn.
* **Reactions** (`FaceMood`): blinks every 2.2-5.2 s at rest; while pulled a surprised face
  (eyes still following the hand), wide-eyed alarm past 42 % of `MAX`, a wince past 86 %; a
  giggle while released handles wobble; a dazed double blink after a big wobble. Sounds (sfx
  events): `face_grab` on a grab, `face_stretch` (a rubbery creak) each time a pull grows by
  another 7 units (pitch and level rising with it), `face_boing` on release (lower and longer the
  further it was pulled), `face_boop` for a tap on the nose, `menu_select` on Start, a soft
  boing as the head pops in. All panned by where they happen.
* **Pointer** (`face/mitten.js`): one of his big white-gloved cartoon hands in pixel art (the HUD
  icons' outline and shadow), open while it hovers, a fist while it pulls; a DOM element over the overlay (`cursor: none`),
  shown for the mouse only.
* **Backdrop** (`face/backdrop.js`): one fullscreen triangle, procedural: the sky's blues
  (`world/sky.js`), two layers of soft cumulus drifting slowly, a warm glow behind the head,
  hazy green hills along the bottom. Drawn first, no depth.
* **Drawing**: its own `THREE.Scene` (a key light from the upper left and the game's hemisphere
  fill) and camera (fov 30, framed to show ≥ 96 units tall and 118 wide, head a little above
  the middle), handed to the game's renderer with `view.setView(scene, camera)`: the retro
  filter (quantise, dither, video blur) applies. Draw calls: backdrop, skull, parts (+ the post
  pass). Enter / leave: the head pops in on an underdamped spring; on Start it spins away while
  a warm-white curtain washes over, which then fades off the game's first frames.
* **Input** stays inside: pointer / wheel listeners on its overlay (`touch-action: none`,
  pointer capture), keys in the capture phase (the Start key never reaches `Input`),
  `touchPress` / `touchRelease`, `remotePress` / `remoteRelease` and gamepads polled every frame
  (buttons held when it appeared are ignored until released); `show()` resolves after the start
  key/button is released too, and main's `startGame()` flushes the input. Leaving removes every
  listener and disposes every geometry, material and texture (`renderer.info.memory` returns
  to where it was).
* **Hint** (`face/faceText.js`, SMALL_FONT): "Drag Jonas's face! · Enter to play" ("START to play"
  with a pad, "START or tap here to play" with the touch controller) in a pill that is itself a
  start button, and "Drag the sky to turn him · wheel / pinch to zoom" above it.
* **Hooks**: `face.state()`, `project(x, y, z)` / `projectShare()` (a head-space point on screen),
  `displacementAt(x, y, z)`, `pointer(type, fx, fy, { id, pointerType, button })` (scripted
  pointers through the real handlers), `timeScale` and `advance(seconds)` (freeze an exact moment
  for a screenshot), `stretch`, `turn`, `zoom`, `head`. Preview: `/preview.html?m=face`
  (`&n64=0`, `&box=1`, `&sound=1`, `&touch=1`; `window.__face`).

## Signs and dialog (`layout.SIGNS`, Player, `src/ui/DialogBox.js`)

`layout.SIGNS`: `[{ id, x, z, yaw, y?, pages: [string] }]`, wooden signposts built by props (the
readable board faces `yaw`; a sign with `y` stands on that floor instead of the lawn: the one on
top of the keep), with original text. Reading works like the classic games:

* Player: B pressed while grounded and not attacking, with a sign within reach in front of Jonas
  (Jonas in front of the sign's face and facing it) -> action `'reading'` (anim `idle`, no
  movement, input ignored), emits `'signRead' { sign }` instead of punching.
  `player.endReading()` returns to idle.
* `new DialogBox(uiRoot, { events })` opens on `'signRead'`, shows the pages one by one
  (text typed out; A/B completes the page, then advances), emits `'dialogClosed' { sign }`
  after the last page. `dialog.isOpen`, `dialog.update(controller)` (30 Hz, called by main
  while open), `dialog.close()`.
* main: while `dialog.isOpen` the tick feeds the controller to the dialog and a neutral
  controller to Jonas and the camera; on `'dialogClosed'` it calls `player.endReading()` and
  `input.flush()` so the closing press never becomes a jump or punch.

## AI RACE mode (the stormy sci-fi horror grounds)

A floor button labelled **AI RACE** (`layout.AI_BUTTON`) switches the grounds into a dark
version and back. Everything is original: no existing monster, character or brand designs.

* **Toggle**: objects own the button (static collider, visual cap sinks when pressed). A
  ground pound landing on it (`player.action === 'ground_pound_land'` within its radius)
  flips it and emits `'aiRaceButton' { on }`. The cap reads "AI RACE" while the mode is
  off and "STOP" while it is on (pound it again to switch back). Pounding STOP also retires
  the button (`AiButton.retire()`): once the cap is down it sinks into the ground with dust and a
  grinding rumble (sfx `hall_rise`, pitched up) and is gone for the rest of the game (hidden, its
  colliders parked; a hero on it is carried down to the lawn), so AI RACE can't be started
  again; `objects.reset()` (a new game) brings it back. (Rustmaw's defeat ends the mode without
  retiring it.) Past the meltdown's point of no return (40 s, see "Meltdown") the button is dead
  and main ignores both a mode-off request and Rustmaw's defeat: the mode stays on. main sets
  `state.dark`, emits
  `'darkMode' { on }` and eases `state.darkT` 0..1 over 3 s, calling each tick while it
  changes: `level.setDarkness(t)` (every WorldPart's `setDarkness`), `view.setDarkness(t)`,
  `fx.setRain(t)`, `objects.setDarkness(t)`. Game over resets it to 0 (plus
  `fx.clearFires()`, `level.clearScorches()`). `window.__game.setDark(on)` toggles it in tests.
* **World** (`setDarkness(t)` on terrain, water, castle, props, sky): crossfade to a dead,
  desaturated palette (grey-green grass, black-green water, charcoal rock), a storm sky
  (low churning clouds, no sun), the castle's windows glowing sick red with pulsing
  light strips/cables, trees withered and darkened. `terrain.addScorch(x, z, r)` /
  `clearScorches()` draw burnt ground marks. Props export `trees` (canopy positions).
* **Renderer** (`view.setDarkness(t)`, `view.flash(strength)`): dark storm fog and colour
  grade; lightning flashes brighten the frame.
* **Effects** (`src/fx/Effects.js`): `setRain(t)` camera-following rain with ground splashes;
  `setMeltdown(levels)` (see "Meltdown": embers and ash instead of rain, no lightning while the
  sky burns, the light's fireball, pillar and shockwave);
  random lightning (emits `'lightning' { strength }`; renderer flashes, audio thunders);
  `ignite(x, y, z, { radius, duration, intensity }) -> id`, `extinguish(id)`, `clearFires()`
  (flame/ember/smoke particles), `explode(x, y, z, { radius })`, `update(dt, time, camera)`.
* **Monster** (objects): Rustmaw, an original giant mechanical lizard (long low head with a
  toothed hinged jaw, side-set red eye lenses, splayed clawed legs, small scale plates, a
  long whip tail) that rears up onto the castle's front roof near `layout.KAIJU` when the
  mode turns on (with a roar), tracks Jonas with its neck and head
  and spits arcing fireballs at him. An impact explodes (`fx.explode`), leaves a fire patch
  (`fx.ignite`, a damaging zone for its duration) and a scorch mark, and sets nearby trees
  alight (`level.trees` canopies). A blast hits Jonas for 2 wedges, touching fire for 1 with
  `player.takeDamage(n, fromPos, { fire: true })` (Jonas's 'burn' reaction). It leaves when
  the mode turns off.
* **Grabbing its tail and throwing it off the roof** (objects `RobotBeast.js`, player
  `actions/tail.js`, camera `bossCam.js`, `BossStar.js`). Its tail climbs round the keep's east
  side and runs on back along the rear block's flat roof (walkway at 2360); its end is a tow
  coupling (`RIG.GRIP`: a hazard-striped collar, two struts, a thick crossbar) glowing orange
  and pulsing (the material's `uGrip`, a glow sprite) a hand's height over the walkway. Jonas gets
  up there with the winged hat's flight (or a cannon shot). The beast answers his actions
  (`beast.grip` is shared with him as `player.tailGrip`):
  * `'held'` (B grabs it, `tail_hold`): it stays on its perch but struggles: roars again and
    again, looks back over its shoulder, claws scrabbling, body shaking, its tail thrashing like
    a skipping rope round the line from its root to his hands (the end stays put); **no
    fireballs**. Let go (Z, a hit, held too long): back to its business after an angry roar,
    `GRAB.RELEASE_GRACE` ticks before it shoots again.
  * `'haul'` (the spin starts, `tail_spin`): over `TAIL_RAISE_TICKS` it is torn off the ridge
    and hauled up into the whirl along a scripted path (`GRAB.HAUL` keys: bearing, elevation,
    how straight the tail is, roll; front legs tucked), swinging up east of the keep's spire and
    rolling onto its back; meanwhile it leads Jonas's facing (`grip.lead` / `grip.yaw`).
  * `'whirl'`: the coupling in his hands (`RobotBeast.hand`, from his feet and facing and
    `TAIL_HANDS`), the tail pulled straight, the whole beast swings round him along his facing,
    its body `GRAB.THETA` (68°) above the horizontal, belly up and limbs flailing: high enough
    that nothing of it touches the keep, its spire or the towers at any bearing (the lowest
    obstacle clearance is the test). A `boss_whoosh` each turn, its pitch rising with the spin.
  * `'thrown'` (B at `GRAB.THROW_MIN` = 0.15 rad/tick or more: about three stick circles): it
    flies off along the swing's tangent to a landing spot on that line (swung further round if
    need be) at least `LAND_MARGIN` outside the castle's footprint (`LAND_MARGIN_FRONT` in
    front of it), inside the perimeter, on level ground clear of trees, rocks and server halls,
    or in water, where its wreck fits (`_wreckFit`). The flight (`flightPoint`): ballistic up
    to `THROW_APEX` over the keep's top, its way across eased in and out (it shoots up out of
    the whirl, levelling out over the roof, then drops onto the spot), spinning flat and
    barrel-rolling, flailing and roaring, lined up along the nearest wall before it comes down
    on its back. `'bossThrown' { flight, to, water }`.
  * A weaker throw (or the spin running down, or a hit while whirled): it twists free (`'fall'`)
    and arcs back onto its perch, slamming down (dust, `boss_slam`, `'bossImpact'`), and Jonas is
    knocked back 1 wedge toward the roof's inside (a throw with no spin at all: its tail slams
    down on the roof).
  * `'wrecked'`: on the ground a giant blast of fire, sparks, scrap and dust (`fx.explode` x3,
    `fx.dust`, a fire, `level.addScorch`), `boss_crash` and a strong camera shake
    (`'bossImpact' { strength: 3 }`); in water a huge splash and steam (`boss_splash`). Then
    `'bossDefeated' { pos, water }`: main ends AI RACE mode as if STOP was pressed (the storm
    clears over the usual fade, the button pops back to "AI RACE", minions and server halls go
    away). It lies on its back, smoking and sparking, optics dying, then sinks away
    (`GRAB.WRECK_TICKS + SCRAP_TICKS`) and `beast.starDue` puts out the **reward star**
    (`BossStar.js`: a second, original star, warmer and redder, spiralling up out of the crash
    site; collected like the red-coin star: `player.collectStar()`, the celebration,
    `'starCollected' { pos, boss: true }`; once per game). The next AI RACE brings a repaired
    beast back to its perch, to be beaten again (no second star). `objects.reset()` hides both,
    takes the star back off `player.stars` and lets it be won again.
  * No new server hall arrives while the beast flies (its landing spot stays clear).
  * Camera (`src/camera/bossCam.js`, blended over the orbit by CameraController after its tick):
    holding on, it backs off and rises over the roof's parapet; whirling, far back and up,
    looking up past Jonas at the beast circling over the castle (wider field of view); thrown, it
    chases the beast along its flight (behind and above it) down to the crash and holds on the
    wreck until the star starts to rise, then hands back.
* **Audio**: rain and wind beds, thunder after lightning, an ominous original synth track,
  the monster's mechanical roar, fireball launch/explosion, fire crackle, button clunk,
  an alarm sting; birds stop while dark.
* **UI**: a flashing "AI RACE" alert banner when the mode switches on (and the meltdown's
  warning at 30 s).
* **The 40-second clock**: see "Meltdown": not stopped in time, the sky catches fire and the
  world burns white, then GAME OVER.

## Meltdown (AI RACE's 40-second clock)

If AI RACE is not stopped within 40 seconds the sky catches fire, a blinding light blooms over
the horizon and the whole world burns white, then GAME OVER: an original cartoon apocalypse (no
real-world imagery or text). `src/fx/Meltdown.js` (`Meltdown`, timings in `MELTDOWN`) is the
clock and the conductor; main ticks it and hooks it into the dark-mode switch and the game-over
flow.

```js
const meltdown = new Meltdown({ events, targets: { view, level, fx, audio, shake }, trees: level.trees })
meltdown.update(camPos, camYaw) -> 'over' | null   // 30 Hz, only while playing
meltdown.setMode(on)            // it listens to 'darkMode' itself
meltdown.reset()                // everything off at once (main's game-over reset)
meltdown.skipTo(seconds)        // tests: jump the running clock ahead
meltdown.phase                  // 'idle' | 'race' | 'warning' | 'fire' | 'light' | 'white' | 'over'
meltdown.seconds, .doomed (from 40 s), .running, .levels (the look, below)
levelsAt(seconds), lightAnchor(x, y, z, yaw), placeOrb(light, anchor, out)   // pure helpers
```

* **Clock**: starts at 0 when AI RACE mode turns on (`'darkMode' { on: true }`) and counts only
  in `update()`, which main calls only while playing (not paused, not on the title or the
  game-over card). The mode turning off before 40 s (pounding STOP, Rustmaw's defeat, a game
  over or new game) cancels it (`'cancelled'`; the warning glow fades out over 1.5 s); turning
  AI RACE on again (after a Rustmaw defeat: STOP retires the button) starts a fresh 40 s. From
  40 s nothing cancels it but a game over: `setMode(false)` is ignored, main keeps the mode on
  (it ignores `'aiRaceButton' { on: false }` and `'bossDefeated'`), the button's cap light dies
  and pounds on it do nothing (`AiButton.setDead`, from ObjectManager on `'meltdown' { phase:
  'fire' }`, with a fizzle; `objects.reset()` revives it).
* **Timeline** (`MELTDOWN`, seconds on the clock):
  * 30 `'warning'`: the AlertBanner shows WARNING! / THE SKY IS OVERHEATING / POUND STOP!
    (`hudLogic.js MELTDOWN_WARNING`, ~5 s, gone on `'cancelled'` or `'fire'`); a klaxon (sfx
    `meltdown_klaxon`, two rising whoops) every 1.5 s until the light; the storm sky glows
    red-orange up from the horizon (the sky's `meltWarn`), the fog takes a red haze and the grade
    a share of the fire tint, stronger and stronger toward 40 s.
  * 40 `'fire'`, the point of no return: the sky dome turns to roiling flames (its shader:
    procedural 3D value-noise fbm, licking tongues scrolling up from a white-hot horizon under a
    churning deck of smoke with bright veins of fire, sweeping up from the horizon over 1.6 s);
    the fog (`FIRE_FOG`), the actor lights (`FIRE_LIGHTS`) and the grade turn fiery orange (the
    storm grade eases off: the world is fire-lit); the rain turns into drifting embers and ash
    (`RainStreaks.setEmbers`), lightning stops, trees near the hero catch fire one by one
    (`fx.ignite` on canopies, up to 14, sfx `tree_ignite`), a roaring blaze and a deep rumble
    rise (`audio/inferno.js`) after a whoomph (`meltdown_ignite`) while the rain beds and the
    music fade; a low camera rumble (`shake.setRumble`).
  * 46 `'light'`: a blinding point of light blooms `LIGHT_DIST` (19000) away, 0.32 rad right of
    where the camera looks (from the spawn: rising beside and behind the castle's right towers),
    flashing (screen glare and sky bloom), then swelling into a roiling fireball that rises
    (elevation 0.1 -> 0.34 rad) over a pillar of light reaching down to the ground
    (`fx/DoomLight.js`); a shockwave wall of glowing dust races out from its foot at 5200/s
    (`'shock'` as it passes the camera: a big jolt and `meltdown_blast`); the exposure rises
    exponentially, colours bleach, a white fog pulls in and a heat shimmer ripples the picture;
    `meltdown_flash` booms and the blaze swells to a roar.
  * 53 `'white'`: the whole picture is white; the roar collapses into a high, fading ring
    (`meltdown_ring`).
  * 54 `'over'`: `update()` returns `'over'` (once) and main runs its GAME OVER (the card, the
    jingle, then the title; lives and coins reset as for any game over), whatever the lives
    left. Jonas stays controllable until the white-out.
* **Levels** (`meltdown.levels`, one reused object, handed to each target's `setMeltdown` while
  it changes, never while it stays all 0): `seconds`, `warn`, `fire`, `light` (0..1 over the
  light phase), `white` (exponential), `glow` (the fireball), `glare` (screen glare and sky
  bloom: a flash, then with the white), `shimmer`, `embers`, `rumble`, and once the light has
  bloomed `lit`, its ground point `gx, gy, gz`, the fireball `lx, ly, lz, lr` and the
  shockwave's radius `ring`.
* **Renderer** (`view.setMeltdown`, `render/post/meltdown.js`): fog (above and under water) and
  actor lights mixed toward the warning's red haze, the fire's orange and the white; the grade
  (`MELT_GLSL`, after the storm grade in both the N64 pass and the native grade pass):
  `meltGrade` (fire tint by luminance, keeping highlights; glare round the fireball's place on
  screen; exposure, bleach, pure white) and `heatShimmer` (the sampling offset). Uniform
  branches, skipped at 0; native mode draws through the grade pass while any of it shows. F1
  shows "meltdown".
* **Sky** (`world/sky.js`, `level.setMeltdown` -> the sky part): the same dome material and
  program (`meltWarn`, `meltFire`, `meltGlare`, `meltWhite`, `meltDir`, `meltTime` uniforms; the
  underwater copy shares them).
* **Effects**: embers and ash are a share of the rain streaks (same mesh), with their own
  wrapped offsets; the fireball + pillar (one mesh of two camera-facing quads, premultiplied: its
  body covers the burning sky, its halo adds) and the shockwave (an open 96-panel cylinder
  scaled in the vertex shader, additive) are hidden until the light, unfogged, depth-tested.
* **Audio**: `'meltdown'` events drive the one-shots and the inferno's collapse;
  `audio.setMeltdown(levels)` its level (fire) and swell (light); no music starts until it ends.
* **Cost**: no draw call of its own before the light (uniforms on the sky, the passes and the
  rain); +2 draw calls and ~200 triangles while the light shows. Measured from the spawn: 72
  draw calls at 38 s, 76 at 48 s (more server halls out by then).
* **Preview**: `/preview.html?m=fx&melt=48` holds the look at 48 s (renderer, sky and effects).

## Tech takeover (AI RACE mode's server halls)

While AI RACE mode is on, server racks and data halls drop out of the storm or grind up out
of the ground, one every few seconds, until the castle grounds are overrun
(`src/objects/ServerHalls.js`, models and shaders in `src/objects/serverHallModel.js`; all
original designs). Objects own it (built when `layout.KAIJU` exists, like the beast).

* **Units** (`HALL_TYPES`, collider = outer box): `tower` (a 260×260×720 rack monolith on a
  hazard-striped plinth, glowing corner rails, beacons on its cap), `row` (four racks,
  740×260×460, a cable tray with glowing cables on top), `hall` (a 920×540×420 data-hall
  module: rack fronts behind both long sides, vent grilles, beacons, three cooling fans on the
  roof). All dark gunmetal with rack front panels whose status LEDs (cyan, red, some green and
  amber) blink in the shader from a hash of rack row, panel and instance seed, so every unit
  twinkles on its own; light strips with a running red scanner light, glowing cable bundles
  with pulses running into the ground. Far away the LED detail fades into its average glow;
  the lights partly shine through the storm fog.
* **Slots** (`planSlots(layout, { collision, trees })`, deterministic, `SLOT_RULES`): ~30
  footprints over the lawn, planned at construction (~30 ms). Each keeps clear of the spawn
  (1200), the castle door (1800), the star, the AI RACE button, the mystery box, the cannon
  (1100 from its centre: its drum, loading pad and exit spot), signs, trees
  and their canopies, coins and red coins, the 1-up gem, both paths (their half width + 220),
  the bridge, the fences, water (350), the island, the perimeter cliffs (700) and steep ground
  (≤ 150 height difference under a footprint), with a 650 corridor to every other unit; the
  collision world confirms bare ground (no rock, bush, trunk, sign, button or box) around each.
  Arrival order is outward from the moat's front, so the takeover spreads from the castle
  toward the spawn and the corners.
* **Schedule** (`HALL`): the first unit 4 s after the mode turns on, then one every 3.5 s,
  each gap 0.1 s shorter down to 1.5 s (all ~30 out after ~75 s), at the first free slot at
  least 450 from the hero (where he is, was, and is heading), none while a dialog holds him
  or he is dying or respawning. Styles mix at random (never three alike in a row): **drop**
  (a red marker, the footprint outlined with hazard stripes, pulsing echoes and a column of
  light, shows where it will land while it falls for 1.5 s; heavy impact with dust, sparks
  and debris via `fx.dust`, the `'hallImpact'` event) or **rise** (it grinds up out of the
  ground over 1.5 s throwing up dirt). sfx `hall_warn`, `hall_impact`, `hall_rise` (pitched
  down when they sink).
* **Solid**: each slot's box collider (four walls, a flat top) is added to the collision world
  at construction and parked at y −60000; arriving and sinking move it by rewriting the
  surfaces' heights (like the mystery box), a tick ahead of the picture, so the hero can bump
  into, stand and walk on and wall-kick off the units, and minions, fireballs and the camera
  meet them. A drop's collider appears the tick before it lands.
* **The hero is never shut inside one**: arrivals start away from him; a falling unit that
  sweeps through him or lands on him hurts him 2 wedges (`player.takeDamage(2, centre)`, like a
  fireball blast; not while a dialog holds him) and pushes him out of its nearest open side
  (`player.teleport`); a rising top lifts him; a hero found inside a box below its top is
  lifted onto it or pushed out, and one hanging from a moving unit's edge is shaken off (the
  player's ledge hang keeps a fixed height); a sinking top carries him down smoothly.
* **Circuits** (terrain): once a unit is down, `level.addCircuit(x, z, radius, { grow })` ->
  id spreads glowing cyan circuit traces (two layers of board traces with pads, some blinking
  red, data buses radiating from the unit with pulses running out along them, the ground
  darkened to a black-green board) out to its radius over 4 s; `level.fadeCircuit(id,
  seconds)` fades one, `level.clearCircuits()` clears all. Drawn by the grass, courtyard and
  path materials themselves (a uniform array of up to `MAX_CIRCUITS` = 32 discs in
  `terrain.js`): no draw call of their own.
* **Mode off / reset**: when the mode ends every unit sinks back into the ground over ~2.7 s
  (its circuit fading; one still falling lands first), then its collider parks again.
  `objects.reset()` clears everything at once (units, colliders parked, circuits); main also
  calls `level.clearCircuits()` on game over.
* **Camera shake** (`src/camera/shake.js`): `new CameraShake(events)` jolts the view on
  `'hallImpact'` (fainter with distance); main calls `shake.apply(camera, dt)` right after
  `cam.apply(alpha)` (rotation only: the camera's position, collision and listener are
  untouched; dt 0 while paused freezes it). `shake.setRumble(amount)` holds a steady rumble
  under the kicks (the meltdown).
* **Cost**: one instanced draw per unit type showing (three at most) plus one for the warning
  markers while a drop is coming; ~10k triangles with all units out. Measured in the dark
  mode with all 30 units out: 72-75 draw calls and ≤ 172k triangles from the spawn (+3 calls,
  +10k triangles over the same view without them).

## Winged hat, minions, locked castle, touch controller

All original designs (no existing characters, blocks, caps or monsters are copied).

* **Mystery box** (objects, `layout.MYSTERY_BOX`): a floating translucent blue crystal cube
  in a brass frame with a glowing "?" on its faces (static collider). Jonas bumping its
  underside while rising (or punching it) makes it jolt and release the **winged cap** (the
  winged hat power-up, `wingHat` in the code): Jonas's own light blue cap with a pair of white
  feathered wings on the sides of its crown (`wings.js` buildWingedHat, 1.35x as a pickup),
  hovering and spinning. Touching it calls `player.giveWingHat(seconds = 40)`. The box can be
  hit again 30 s after its cap was taken.
* **Flight** (player): `player.giveWingHat(s)` sets `player.wingHat` (ticks left) and emits
  `'wingHat' { on: true }` (and `{ on: false }` when it runs out, `player.wingHat = 0`).
  `RenderState.wingHat` (bool) and `RenderState.wingHatEnding` (last 3 s, for blinking). While
  the hat is on, a triple jump (at the flip's peak, once it rises slower than `FLY_APEX_VY`)
  or the tree-top flip jump takes off into action `'flying'` (anim `'fly'`) and climbs away
  (`FLY_LAUNCH_TICKS`): stick up = nose down (dive, gains speed), stick down = nose up (climbs,
  loses speed; a stick still pushed up from the run-up is read as neutral until it is let go
  once, `player.flyStickLatch`), left/right banks and turns (`RenderState.pitch/roll` show it), a stall
  drops into a fall; Z ends the flight; landing skids to a stop; walls bonk. Taking the hat
  off mid-flight turns the flight into a fall. sfx `wing_flap`, `powerup`. Landing from a
  flight (or a fall right after one) never does fall damage; near the level's outer edge the
  flight turns back instead of leaving. Camera: while flying the orbit swings behind Jonas's
  heading (only as far round as there is room), following his pitch; R buzzes. In AI RACE
  mode near the castle the view tilts up (and may widen `camera.fov` up to 58°) to keep
  Rustmaw's head in frame; anything that needs the field of view reads `camera.fov`.
* **Attacks and stomps** (player): `player.getAttack()` -> `null` or `{ x, y, z, radius,
  kind }` while a punch, kick, jump kick, dive, belly slide (while fast), ground-pound
  landing or flight can hit something this tick (`kind` is the action name). `player.bounce(vy = 50)`: bounce up off an enemy Jonas landed on
  (action `'jump'`, sfx `stomp`).
* **Minions** (objects): 10 s after Rustmaw has risen, Sporebots burrow out of the ground
  (dust burst) around Jonas (700-1600 away, on land), up to 5 at a time, a new one every ~5 s.
  A Sporebot is a small original mushroom-shaped machine, ~120 across and ~130 tall
  (`minionModel.js`): a wide, low dome cap of riveted gunmetal plates with rust seams, vent
  fins and an exhaust stack, and a ring of red running lights round its rim; under the rim a
  dark sensor band with two big round red lenses (they glow, and flare when it attacks); a
  ribbed steel stem with a hazard-stripe band; three piston legs (a tripod) on round foot
  pads. It scuttles after Jonas on a tripod gait with its cap bobbing, winds up (crouches, tips
  its cap forward, eyes flaring, sparks crackling round the rim) and lunges to ram him with
  the cap (1 wedge, knockback via `player.takeDamage(1, pos)`). A hit from
  `player.getAttack()` or a stomp (Jonas falling onto its cap: `player.bounce()`) wrecks it: it
  flips onto its cap, legs flailing, in a small blast of sparks and scrap (`fx.explode`), and
  may drop a coin. They leave when the mode turns off; `reset()` clears them. All of them are
  one InstancedMesh (legs and cap animated in the vertex shader) plus two eye glow sprites
  each. sfx `minion_emerge`, `minion_bite` (the ram), `minion_wreck`, `stomp`.
* **Locked castle** (objects): walking up to the castle door (in front of it, within ~150,
  facing it) plays sfx `evil_laugh` and shows a dialog via
  `events.emit('signRead', { sign: { id: 'castle_locked', pages: [...] } })`; it can trigger
  again once Jonas has walked away (> 500) and come back. Jonas is frozen while the dialog is up
  (main); `player.endReading()` is safe when he wasn't reading.
* **Touch controller** (ui + input): on touch screens (`pointer: coarse`, or `?touch=1`) a
  retro game-controller UI appears (`src/ui/TouchController.js`, its own root appended to
  `document.body`, outside `#game`/`#ui`). Portrait: the game picture takes the top of the
  screen and the controller body fills the bottom (it sets `#game`'s bottom inset so the
  renderer resizes); landscape: translucent controls over the picture's lower corners. An
  analog thumb stick (and D-pad), JUMP (A), ATTACK (B), CROUCH (Z) buttons, the four camera
  buttons (C), CAM (R) and START; multi-touch, no page scrolling or zooming, optional
  vibration. It feeds the virtual controller through `input.setTouchState({ stickX, stickY,
  A, B, Z, R, START, CU, CD, CL, CR })` (merged like a gamepad in `poll()`/`sample()`); a tap
  also unlocks audio on the title.

## Cannon (the east lawn, up to the top of the castle)

An original cannon on the east lawn (`layout.CANNON`) shoots Jonas up onto the castle's roofs and
the very top of the keep (`layout.KEEP_TOP`). All original designs.

* **Object** (`src/objects/Cannon.js`, look in `cannonModel.js`; the ObjectManager builds it
  from `layout.CANNON`, before the server halls): a round drum of weathered stone blocks sunk
  in the lawn with a brass swivel ring on top; a squat teal-painted iron turret with a cream
  stripe and brass rivets that turns on it (yaw), iron cheeks with brass trunnion caps and a
  well for the breech; a thick dark-iron barrel (pitch) with a knob behind the breech, teal and
  cream painted bands between brass hoops, a brass lip and a dark bore. Beside it the loading
  pad: a stone slab with a brass rim, a pulsing teal ring and a compass rose, and a teal and
  cream pennant fluttering on a pole. Flat-shaded, baked vertex colours (the turning parts bake
  a fixed top light in their own frames); one material for three draw calls (base with pad and
  pennant, turret, barrel; ~2.2k triangles): the ring's glow and the pennant's flutter are
  shader uniforms. `setDarkness(t)` dims the stone and iron with the storm; the ring keeps
  glowing. Idle, the barrel rests pointing up toward the keep (`restYaw`, 70°); while Jonas is
  in it follows his aim; after a shot it holds a moment, then swings back. Static colliders:
  the drum (flat top 60 up, hop onto it), a column round the turret and breech (flat top at
  the barrel's top) and the pad's top (a 14-unit lip, stepped onto).
* **In and out**: standing on the pad's top while it is armed calls
  `player.enterCannon(cannon.desc)` (`desc = { x, y, z` (the barrel's pivot), `muzzle, restYaw,
  restPitch, exit }`); the pad disarms while he is in and re-arms once he has stood off it.
  Action `'cannon'` (group automatic, `actions/cannon.js`; `player.cannon.phase`): `hop` (a
  scripted leap over the breech, head first into the muzzle; sfx `cannon_enter`), `settle` (the
  barrel lowers to `CANNON_START_PITCH`), `aim`, `unload` (B or Z: the barrel swings back to
  rest) and `out` (a hop down to `desc.exit`, beside the pad, landing normally). Inside
  (`player.cannon.inside`) he is parked in the turret and immune to damage.
* **Aim**: the stick turns the barrel (yaw all round, pitch 5°..80°, `CANNON_YAW_RATE` /
  `CANNON_PITCH_RATE` at full push, the stick's square so small pushes aim finely; stick up
  raises it), sfx `cannon_turn` (a ratchet click) every `CANNON_CLICK_ANGLE` of turning.
* **Fire** (A): action `'cannon_shot'` (group airborne, anim `'cannon_shot'`: laid out flat
  like a dart, mittens thrust ahead, a slow corkscrew roll; RenderState pitch follows the arc).
  He leaves the muzzle at `CANNON_SPEED` along the barrel (`'cannonFire' { pos, yaw, pitch,
  dir }`, sfx `cannon_fire`, and `cannon_whoosh` not positional) and flies a ballistic arc
  under `CANNON_GRAVITY` (a floaty lob), sub-stepped every `CANNON_SUB_STEP` units, so no wall,
  floor, ceiling or trunk is tunnelled through. Falling past a ledge grabs it, a trunk in reach
  is hugged, a grazing wall is slid along, a wall met head-on (or a spot without room) bonks
  him softly off (`soft_bonk`), and the level's perimeter holds him `CANNON_EDGE_MARGIN`
  inside it, above the cliffs too. He lands on his feet (a hard landing's squat, at most
  `CANNON_LAND_MAX_SPEED`), never hurt: `player.flightFall` covers the shot and every fall
  after it until he lands, and a shot that lands on a roof too steep to stand on (a tower's
  cone) makes falls in the next `CANNON_SLIDE_GRACE` ticks safe too (`player.cannonSafeUntil`,
  read by `landFromAir`). From `CANNON_CONTROL_TICKS` in, Z ground-pounds and B dives. The
  flying body is an attack (`getAttack().kind === 'cannon_shot'`: minions, the mystery box).
* **Winged hat**: with the hat on, the shot takes off into flight (`'flying'`, `{ apex, cannon
  }`) at its peak (once it rises slower than `FLY_APEX_VY`), keeping its speed up to
  `CANNON_FLY_MAX_SPEED` (such an overspeed only bleeds off by drag; flying.js sub-steps up to
  12 a tick): a steep shot soars over the keep's banner.
* **Camera** (`src/camera/cannon.js`, `CANNON_CAM_*` in `cameraConfig.js`): mode `'cannon'`
  while he is in the barrel (settle, aim): the camera rides with the barrel, `CANNON_CAM_BACK`
  behind its pivot along the bore and `CANNON_CAM_UP` over it (square to it), kept
  `CANNON_CAM_CLEAR` over the floor, looking exactly along the barrel, so the middle of the
  picture is where it points and the barrel shows below, turning and tilting with the aim.
  `cam.hideHero` while he is inside; C buttons and R buzz; `getYaw()` is the aim's yaw. It
  glides in (`BLEND_TICKS`) once he has dropped in and back out to the orbit behind the barrel
  when he climbs out, or straight into the flight camera for a shot (`FLY_ACTION` includes
  `'cannon_shot'`). Emits `'cannonView' { on }`. The shake (`src/camera/shake.js`) jolts the
  view on `'cannonFire'` (`SHAKE.CANNON`).
* **HUD** (`'cannonView'`): a pixel reticle in the middle of the picture (a ring, four teal
  ticks, a dot) and a hint strip near the bottom ("Space / K Fire, J Climb out"; "A Fire,
  B Climb out" with a pad or the touch controller).
* **Effects**: `fx.muzzle(x, y, z, dx, dy, dz, { radius })` (a flash, a tongue of fire and
  sparks along the bore, a ring of smoke rolling out) when it fires; the barrel recoils and
  springs back.
* **The top of the castle** (`KEEP_TOP`, castle/building.js's keep): its flat roof walkway at
  3260, round the round upper tower (the tower's roof eave overhangs to 529 of the 600/650 half
  sizes; its steep cone funnels a shot down onto the walkway), with a ring of 8 yellow coins
  (560 from the tower's axis) and the `'keep_top'` sign in front of the tower. From the start
  aim (straight at the keep, 40°) raising the barrel to 48°..68° lands him up there (e.g. 12
  ticks at full push: 53°); other aims reach the wings' and the rear block's roofs.
* **AI RACE mode**: the cannon works the same; server halls keep 1100 clear of it
  (`SLOT_RULES.CANNON`), minions never burst out within `MINION.CANNON_CLEAR` (950) of it.
* **Touch and phone controllers** send the same stick and A / B / Z: nothing extra.
* **Cost**: three draw calls and ~2.2k triangles where it is in view (+3 calls next to it, +2
  from the spawn); a shot's sub-steps cost ~15 air steps a tick.

## Phone as a controller over the local network

A phone on the same Wi-Fi can steer Jonas in the game running on the computer. It needs the
game served locally (`npm run dev`, or `npm run build && npm run preview`): the hosted/static
build has no relay, so every phone feature stays hidden there.

* **Protocol** (`src/net/protocol.js`, shared by all parts): `PAD_WS_PATH` (`/pad-ws`),
  `PAD_INFO_PATH` (`/pad-info`), `PAD_PAGE` (`pad.html`), 4-letter room codes
  (`makeRoomCode`, `isRoomCode`), messages `join { role: 'game'|'pad', room }`,
  `input { s: [stickX, stickY, buttonBits] }` (`encodeInput` / `decodeInput`, bits in
  `PAD_BUTTONS` order), `rumble { ms }`, `hello { name }`, `peer { connected }`.
* **Relay** (`tools/padRelay.js`, a Vite plugin for both the dev and preview servers,
  `server.host` / `preview.host` = true): a `ws` WebSocket endpoint on `/pad-ws` (Vite's HMR
  socket is untouched), one game + one pad per room (a newcomer replaces the old one), pad
  `input` validated and forwarded to the game, game `rumble`/`hello` to the pad, `peer`
  notices both ways. `GET /pad-info` -> `{ urls }`: the pad page URL for each LAN IPv4
  address the server really listens on (empty with `reason: 'loopback'` for a loopback-only
  server). Every response carries `Server-Timing: pad-relay`, which is how the game knows a
  relay exists. Limits (`RELAY_LIMITS`): 1 KB messages, 60 msgs/s per socket (4x that closes
  it with 1008), 50 rooms, 200 sockets, 10 s to join, 10 s heartbeats; pages from other
  origins are refused. Close codes (`CLOSE_CODES`): 4000 replaced (do not auto-reconnect),
  4001 bad join, 4002 join timeout, 4003 relay full.
* **Pad page** (`pad.html`, `src/pad/*`; built as its own ~85 kB page, no three.js): the
  touch controller in standalone mode (`new TouchController({ standalone: true, sink })`,
  full-screen portrait and landscape layouts), a room-code entry screen when the URL has no
  `?room=`, a status strip (tap to rejoin after being replaced), sends button changes at
  once, stick moves at most every 33 ms and the whole state every 100 ms, reconnects with
  backoff, vibrates on `rumble`, keeps the screen awake where the browser allows it.
* **Game side**: `input.setRemoteState(state | null)` is its own input channel, merged like
  the touch state (buttons OR'ed, taps shorter than a tick still count; the phone's stick
  wins when pushed at least as far). `new RemotePad({ input, events })`
  (`src/net/RemotePad.js`) probes `/pad-info`, keeps a room code (it survives a reload),
  joins as 'game', applies the phone's input, releases it when the phone leaves or goes
  silent for 1.5 s, and sends `rumble` when Jonas is hurt; events `'phonePad' { connected,
  available, room, padUrl }` and `'remotePress' / 'remoteRelease' { button }` (the title
  starts from the phone's START/A). `?pad=0` turns it off, `?pad=1` forces it (`?test=1`
  skips it). `PhonePanel` (`src/ui/PhonePanel.js`, `phoneLogic.js`): the pairing panel with a
  QR code of the pad URL (`qrcode-generator`), the URL, the room code and the connection
  status, opened from a phone button on the title or the pause screen (P); a small badge
  while a phone is connected.

## Objects (`src/objects/ObjectManager.js`)

```js
new ObjectManager({ scene, collision, events, layout, player, fx, level })  // fx/level: AI RACE fireballs
objects.update({ player, frame, camera })   // 30 Hz: collection, AI
objects.animate(time, alpha, threeCamera)   // render: spin, billboards
objects.reset()                             // new game: every pickup back (see below)
objects.ambient(time) -> alpha              // title backdrop clock (animate() calls it itself)
objects.started                             // an update() ran since construction / reset()
```

`reset()` (always present; main calls it after GAME OVER, before the title): all yellow and
red coins come back (red count 0), the star is hidden until the next full red set, the 1-up
gem returns, live sparkles vanish, and the star it awarded is taken back off `player.stars`
(so is Rustmaw's reward star, `BossStar.js`, which can then be won again).
The tick clock keeps running (birds and butterflies carry on where they are).

`ambient(time)`: until the first `update()` (and again after `reset()`), `animate()` drives the
objects' tick clock from the caller's `time` (seconds) through `ambient()`: ambient ticks only
(butterflies wander, birds circle, sparkles twinkle; no pickups, run against an out-of-reach
stand-in hero), catching up at most `MAX_STEPS_PER_FRAME` ticks per call and returning the
alpha into the latest tick. Play then carries on from that clock without a jump. So the title
loop just calls `objects.animate(t, 1, camera)`; no stand-in hero is needed in main.

Yellow coins (1), red coins (2, collect all 8 → star appears at `STAR` with a jingle),
the star (touch → `player.collectStar()`), the hidden 1-up gem (`layout.ONE_UP`, emits
`oneUp`), butterflies (`new Butterflies(BUTTERFLY_SPOTS, { collision, groundAt, rng,
waterTop })`; optional `waterTop` (default `Infinity`) is the highest water surface anywhere,
so the water query is skipped over floors above it; ObjectManager passes
`layout.WATER_LEVEL`) and
circling birds (`new Birds(BIRD_CIRCLES, { collision, rng })`, circles `{ x, z, y, radius }`).
A second star, Rustmaw's reward (`new BossStar({ events, collision, sparkles, shadows,
shadowSlot, envMap })`, a `Star` instance of its own: `new Star(envMap, { color, emissive })`),
rises out of the crash site after the tail throw (see "AI RACE mode"); the objects set
`player.tailGrip` to the beast's grip record.
Everything animates on the simulation clock, so pausing freezes it.

## Events (`src/core/events.js`)

| name | payload | emitted by |
|---|---|---|
| `sfx` | `{ name, pos?, volume?, pitch?, pan? }` | anyone; audio plays it (`pan`: a non-positional sound's stereo position, the face screen) |
| `footstep` | `{ terrain, pos, speed }` | player |
| `land` | `{ terrain, pos, hard }` | player |
| `splash` | `{ pos, big }` | player |
| `hurt` | `{ pos, amount }` | player |
| `coin` | `{ value, pos, red, index? }` (`index` 1..8 on red coins) | objects |
| `redCoinsComplete` | `{ pos }` (where the star appears) | objects |
| `starCollected` | `{ pos }` | objects |
| `lifeLost` / `oneUp` | `{}` | player / objects (main counts lives; audio plays sfx) |
| `pause` / `unpause` / `gameStart` / `gameOver` | `{}` | main (audio consumes all four: ducks, menu-track stop, unlock, `game_over` jingle) |
| `signRead` | `{ sign }` (a `layout.SIGNS` entry) | player (B in front of a sign); the dialog box opens |
| `aiRaceButton` | `{ on }` | objects (the button was ground-pounded); main toggles AI RACE mode |
| `darkMode` | `{ on }` | main; audio, UI banner, objects and the meltdown react |
| `meltdown` | `{ phase, seconds }`: `'warning'` (30 s), `'fire'` (40 s, the point of no return), `'light'` (46 s), `'shock'` (the shockwave passing the camera), `'white'` (53 s), `'over'` (54 s: main ends the game), or `'cancelled'` `{ warned }` (the mode turned off before 40 s) | the Meltdown (`fx/Meltdown.js`); the banner, audio and objects (the button dies) react |
| `lightning` | `{ strength, pos }` | effects (the renderer flashes itself, audio plays thunder) |
| `kaijuRoar` | `{ pos }` | objects (the robot monster roars) |
| `hallImpact` | `{ pos, strength, kind }` (`kind` `'drop'`: a server hall slammed down, strength 1; `'rise'`: one started grinding up, 0.35) | objects (tech takeover); main's camera shake jolts the view |
| `bossThrown` | `{ flight, to, water }` (`flight`: `{ x0, y0, z0, vx, vy, vz, T, g }`, `RobotBeast.flightPoint(flight, t)` is its waist t ticks on; `to`: the crash site) | objects (Jonas threw Rustmaw); the boss camera chases it |
| `bossImpact` | `{ pos, strength, kind }` (`'slam'`: back down on its perch, 0.8-1.3; `'crash'` / `'splash'`: thrown down, 3 / 2) | objects (Rustmaw); main's camera shake jolts the view |
| `bossDefeated` | `{ pos, water }` | objects (Rustmaw crashed); main ends AI RACE mode as if STOP was pressed |
| `wingHat` | `{ on }` | player (the winged hat was put on / ran out); audio plays the flying theme |
| `phonePad` | `{ connected, available, room, padUrl }` | RemotePad (a phone joined / left) |
| `remotePress` / `remoteRelease` | `{ button }` | RemotePad (the phone's button edges; the title and the face screen go on on START/A) |
| `dialogClosed` | `{ sign, cancelled? }` (`cancelled` when `close()` took it down) | dialog box; main releases Jonas |
| `cannonFire` | `{ pos, yaw, pitch, dir }` (`pos`: the muzzle's mouth, `dir`: along the barrel) | player (fired out of the cannon); the cannon recoils and puts the muzzle blast (fx), main's camera shake jolts the view |
| `cannonView` | `{ on }` | camera (the cannon's aiming view went up / down); the HUD shows its reticle |

Standard sfx names: `jump, double_jump, triple_jump, backflip, sideflip, long_jump,
wallkick, dive, ground_pound, ground_pound_land, punch1, punch2, kick, jump_kick, land,
land_hard, skid,
bonk, hurt, ledge_grab, climb, swim, splash, water_exit, coin, red_coin, star_appear,
star_get, one_up, pause, menu_select`, plus `footstep, life_lost, unpause, camera_move,
camera_buzz`, and the dialog box's `dialog_open, text_blip, dialog_next, dialog_close`, and
AI RACE mode's `button_press, alarm, kaiju_roar, fireball_charge, fireball_launch,
fireball_explode, fireball_fizzle, tree_ignite, burn, fire_crackle, steam, thunder`, and the
cannon's `cannon_enter, cannon_turn, cannon_fire, cannon_whoosh`, and Rustmaw's tail grab's
`tail_grab, boss_haul, boss_whoosh, boss_throw, boss_slam, boss_crash, boss_splash`
(`boss_whoosh` once per whirl turn, its `pitch` rising with the spin), AI RACE's meltdown's
`meltdown_klaxon, meltdown_ignite, meltdown_flash, meltdown_blast, meltdown_ring`, and the face screen's
`face_grab, face_stretch, face_boing, face_boop` (with `pitch`, `volume` and `pan`).
Unknown names must be ignored silently.

## Tooling

* `npm run dev` — dev server. `npm test` — node unit tests (`tests/**/*.test.js`).
  `npm run build` — production build into `dist/`: the game as one bundle by design (~1.2 MB,
  ~370 kB gzip, plus the ~13 kB title-logo worker; the size warning limit is 1400 kB), then
  the phone's `pad.html` built separately into the same folder (~85 kB, its own copy of the
  touch controller and protocol). `npm run preview` serves it with the phone relay.
* `node tools/shot.mjs --url "/preview.html?m=<area>&cam=x,y,z&look=x,y,z" --out shots/x.png`
  — headless screenshot of a preview page (prints browser errors).
* `node tools/shot.mjs --url "/?test=1" --actions '[{"step":30,"input":{"stickY":1}},{"shot":"shots/a.png"},{"eval":"__game.snapshot()"}]'`
  — scripted full-game run. Actions: `{step, input}`, `{eval}`, `{shot}`, `{wait: ms}` (for
  real-time runs such as `/?skipTitle=1`).
* `/preview.html?m=world` shows the whole level without the player.
* `/preview.html?m=fx&melt=48` holds AI RACE's meltdown at 48 s (sky, grade, embers, the light).
* `/preview.html?m=face` shows the face screen alone (Start shows it again); scripted pulls for
  shot.mjs: `{"eval":"__face.pointer('down', 0.6, 0.55)"}`, `{"eval":"__face.pointer('move',
  0.8, 0.6)"}`, `{"wait":500}`, `{"shot":"shots/pull.png"}` (see the preview's header).
* Requirements: Node.js 20.19+ or 22.12+ (Vite 8); `tools/shot.mjs` and the browser tests
  (`E2E=1 npm test`) need Playwright's Chromium (`npx playwright install chromium`).
* `index.html` carries the tab icon inline (Jonas's HUD face, `ICONS.hero` from
  `src/ui/icons.js`, with the HUD's 1-pixel outline, as an SVG data URI: regenerate it from the
  icon's rows when the icon changes), so no `/favicon.ico` is requested.
