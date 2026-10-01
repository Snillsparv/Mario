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

Setup: `view.alignOverlay(uiRoot)` (the HUD/title follow the 4:3 pillarbox and the recorder's
16:9 or 9:16 frame), `view.setWaterLevelFn(collision.waterLevelAt)`, `cam.reset(player)`,
`new Recorder({ view, uiRoot, audio })` (V and 9: see "Recorder"; it composites each frame from the
renderer's frame hook, right after `view.render()`, only while recording), `new ScreenWipe(uiRoot)`
(before the HUD, so it lies under it) and `new AreaSwitch({ ... })` (see "Areas and
transitions": the grounds are the area play starts in).

Game flow, `state.mode` `'title' → 'play' → 'gameover' → 'title' …` (`'face'` instead of
`'title'` with `?face=1`):

```
choice:   new ChoiceScreen(uiRoot, { events, audio, aiRace }).show()   (the game choice, first: see
          "Game choice" below; state.choosing meanwhile, so P does not open the phone panel)
title:    new TitleScreen(uiRoot, { events, audio, phone }).show()   (requests the 'title' track)
          two phases on a first visit (audio still locked by the browser's autoplay rules):
            1. PRESS ANY KEY: any key/click/tap unlocks audio and starts the title
               track; that press is swallowed (it does not start the game)
            2. PRESS START: Enter/Space/Esc/click on the card/gamepad Start or A starts
          phase 1 is skipped when audio is muted, unavailable or already allowed (after a key
          or click played the game choice, or after a game over); a gamepad press is no user
          gesture, so a pad starts from either phase (audio then unlocks on the first key/click
          in play)
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
          card.remove(), areas.enter('grounds', 'start') and areas.resetCourses() (back on
          the grounds from whatever area, every area's pickups and star back), objects.reset(),
          player.coins = 0, lives = 4 — all *before* the title, so the title backdrop already
          shows the new game's world — then the title, the face screen and start (with the
          intro) as above
meltdown: AI RACE not stopped within 40 s (see "Meltdown"): once the white has held a second,
          meltdown.update() returns 'over' and main calls the same gameOver() directly ("game
          over now", whatever the lives left; a pending death's game over is dropped); its reset
          also calls meltdown.reset() (sky, grade, white-out, embers, light, sounds, clock)
```

Simulation and rendering:

```
tick (30 Hz, only in 'play'):
  controller = input.poll()
  START.pressed (not while areas.busy) -> toggle pause (hud.setLeave(paused && areas.canLeave()),
            hud.setPaused, emit 'pause' { leave } / 'unpause')
  paused -> B pressed and areas.canLeave() (a course: the pause screen's "Leave course") ->
            unpause (hud.setPaused(false), emit 'unpause') and areas.leave() (a sign he was
            reading closes first); then return
            (nothing below runs; state.time stands still)
  state.time += FRAME_DT
  darkT eases toward state.dark (AI RACE mode: applyDarkness(t), see below)
  meltdown.update(camera.position, cam.getYaw()) === 'over' -> gameOver(), return   (see "Meltdown")
  dialog up -> dialog.update(controller), and a neutral controller from here on
  controller = areas.step(controller)    (a walk through a door: the transition's scripted stick,
                                          see "Areas and transitions"; the switch itself runs here)
  dropHold > 0 ? dropHold-- : player.update(cam.playerInput(controller), cam.getYaw())
  action changed to 'spawn' -> respawn / game over (above)
  areas.objects.update({ player, frame, camera })   (the current area's objects)
  cam.update(controller, player)
  hud.update({ lives, coins, stars, health, showPower, breath, paused })
  audio.setListener(cam.camera.position, cam.getYaw())
render (rAF):
  input.sample()                          (latches gamepad flicks between ticks)
  model.object3D.scale = areas.heroScale(alpha)   (1, but as he shrinks into the bottle's neck)
  rs = player.getRenderState(alpha); model.update(rs, paused ? 0 : dt)
  model.object3D.position += areas.heroOffset(alpha)   (0, but as he steps into a door's opening)
  model.object3D.visible = play && !dropHold && !cam.hideHero
  cam.apply(alpha); areas.update(state.time, threeCamera, alpha)   (the current area's parts:
  level.update on the grounds; a door swinging through a warp); areas.objects.animate(state.time,
  alpha, threeCamera)
  audio.update(dt); wipe.draw(areas.wipe(alpha), hero feet, threeCamera, his scale); view.render()
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
`recorder` (see "Recorder"),
`meltdown` (AI RACE's 40-second clock: `meltdown.skipTo(seconds)` jumps it ahead, `.phase`,
`.seconds`, `.levels`; see "Meltdown"), `setDark(on)` (ignored outside the grounds),
`neutralController`, `face` (the FaceScreen while it shows, else null), `areas` (the
AreaSwitch: `.current`, `.phase`, `.buildMs`, `.get(name)`), `wipe`, `area` (the area Jonas is
in: `'grounds'`, `'hall'` or `'skerries'`) and `enterArea(name, entry?)` (switch at once, no
wipe, then draw); `snapshot()` also carries `area` and `warp` (`{ phase, to, entry, kind }`
while a transition runs, else null).
`?skipTitle=1` skips the title, the face screen and the intro. `?face=1` opens the (opt-in)
face screen at once (no title card). `?mute=1` disables audio. `?area=hall` or `?area=skerries`
(with `?test` or `?skipTitle`) starts play in that area, at `&entry=<id>` (default: its respawn
entry; the hall's `front` / `bottle`, the course's `arrival`).
`window.__ready` is set once play starts (after the title without `?skipTitle`).
In `?test=1` nothing requests animation frames while the GAME OVER card shows, so headless
Chromium does not advance its CSS fade (it stays transparent until something paints, e.g. a
resize); check the card's look in a real-time run (`/?skipTitle=1`).

## Module ownership (one owner per file set)

| Area | Files | Contract |
|---|---|---|
| Core | `src/core/*` (but `AreaSwitch.js`), `src/main.js`, `src/world/level.js`, `index.html`, `vite.config.js`, `tools/*`, `docs/*` | integration |
| Areas | `src/core/AreaSwitch.js`, `src/world/area.js`, `src/world/areas.js` | AreaDef, Area, AreaSwitch (see "Areas and transitions") |
| Great Hall | `src/world/hall/*` (layout, builder, bottle, textures) | WorldPart, built by `area.js` |
| Midsummer Skerries | `src/world/skerries/*` (layout, build, lighthouse, east, props, houses, sea, textures) | WorldParts, built by `area.js` |
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
  `addCollider({ object3D?, positions?, surface?, terrain? })`,
  `addPole({x,z,y0,y1,radius,camYaw?})` (`camYaw`: see "Camera"), `setWaterLevelFn(fn)`,
  `finalize()`.
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
  setDoorOpen?(t),                             // its swinging door, 0 shut .. 1 open (the castle's
                                               // front door, its inside in the hall: "Areas")
  setLit?(on),                                 // its lamp (a course's lighthouse, the one in the
                                               // hall's bottle): lit once the course's star is won
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
default spot is 800 behind the castle's back wall). `CASTLE.enter = { to: 'hall', entry: 'front' }`
opens the castle's front door into the Great Hall (without it the door is locked; see "Castle
door").
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

## Areas and transitions (`src/core/AreaSwitch.js`, `src/world/area.js`, `src/world/areas.js`)

Jonas is always in one **area**, a place with its own collision world, objects, entries and look:
`'grounds'` (the castle grounds, `world/level.js`, built at boot), `'hall'` (the Great Hall
inside the castle, `world/hall/*`) or `'skerries'` (Midsummer Skerries, the first course,
through the ship in the bottle, `world/skerries/*`); the hall and the course are built the
first time he goes in and kept for the session.
All areas share the one scene: each built area has a root group (`'area-<name>'`) shown only
while he is in it, so hidden areas cost no draw calls, and only the current area is updated
(`areas.update`) and animated (`areas.objects`).

```js
// world/areas.js: AREA_DEFS[name] (data and builder references only)
{
  name: 'hall',
  origin: { x: 0, y: 0, z: -60000 },   // world = local + origin (areas are authored in local coords)
  builders: [buildHall],               // WorldParts (level.js); colliders must be { positions }
  layout,                              // local anchors: ENTRIES, DOORS (and COINS, STAR, SIGNS, ...)
  entries: { front: { x, y, z, yaw, walkIn }, bottle: { x, y, z, yaw, drop, camYaw } },
  respawn: { entry: 'front', drop: 400 },
  waterLevelAt: (x, z) => NO_WATER,    // local
  probeY: 2400,                        // the ground probe's start (under the ceiling)
  sky: false,                          // the grounds' sky dome shows here
  atmosphere: HALL_ATMOSPHERE,         // view.setAtmosphere preset (null: the grounds' look)
  audio: { music: 'castle_hall', ambience: 'hall', reverb: true, fires: [HEARTH_FIRE] },
                                       // AudioEngine.setArea (on 'areaChange'): its own loop, its
                                       // ambience profile, sound effects in the hall reverb, and
                                       // where the ambience's own sounds come from (local: fires
                                       // [{ x, y, z }], gulls [{ x, y, z, radius }], seaLevel)
  leave: null, starExit: null,         // { to, entry }: the pause screen's way out, the star's
  card,                                // a course: its name as a title card on its first entry
  lamp: 'skerries',                    // the course whose star, once won, lights this area's lamp
                                       // too (the lighthouse in the bottle; a course's own star
                                       // lights its own)
}
groundsArea(level, objects) -> Area    // the grounds as an Area: entries 'start' (the spawn) and
                                       // 'porch' (174 in front of the door face, facing out, camYaw 0,
                                       // walkIn 8); setVisible toggles every part but the sky;
                                       // setDoorOpen swings the castle part's front door
buildArea(scene, def) -> Area          // world/area.js; shiftPositions(positions, origin);
                                       // worldAudio(def.audio, origin) (Area.audio)
```

`buildArea` runs the builders on the local layout, adds their objects under the root (placed at
the origin, hidden), and fills a new CollisionWorld with every collider's `positions` and every
pole shifted by the origin (an `{ object3D }` collider is refused: it would stay where the
builder left it), with the water from `def.waterLevelAt` shifted likewise. The Area is `{ name,
def, root, collision, parts, entries, audio, respawn, signs, groundAt, objectsLayout, waterFn,
objects, update(time, camera), reset(), setVisible(on), setDoorOpen(t), setLit(on) }` (the last
two hand on to its parts' own, see "World parts"), everything in world coordinates
(`audio`: `def.audio` with its sound spots shifted and its `seaLevel` raised by the origin,
plus `isWater(x, z)`, whether there is open water there (the water's surface above the floor,
so not on a rock, the jetty or a beach above the waterline: the sea's laps); the grounds' is
their `def.audio` as it is):
`objectsLayout` is what an ObjectManager reads (COINS, RED_COINS, SIGNS, STAR, ONE_UP, DOORS,
BUTTERFLY_SPOTS, BIRD_CIRCLES shifted, BIRD_TINT as it is, and `groundHeight(x, z)`, the floor
under a point probed from `probeY`, so a coin's shadow never lands on the roof), `respawn` the
entry `def.respawn` names with its drop (player.setWorld's spawn), `waterFn` the collision
world's water (the renderer's, per area).

Rules for areas:
* **Far apart**: the hall's origin is (0, 0, −60000), the course's (60000, 0, 0). Separate
  collision worlds keep the flight rim, water, the hole test and camera probes apart by
  construction; the distance is a second safeguard, so code that still reads the grounds' layout
  (ambience emitters, the shake's falloff, the AI RACE look-up zone, the effects' height cache)
  finds nothing there. Heights stay within −800 … 4500 (`OUT_OF_BOUNDS_Y` −3000, `CEIL_NONE`
  20000).
* **Entries**: every entry has at least 1300 of clear floor behind it (the camera trails ~1250
  back), or a `camYaw` that puts the camera where there is room (the porch: in front of him,
  the door at his back). A ceiling over walkable floor is at least 300 above it (lower ones let
  the follow camera escape), and a respawn drop starts under it (the hall: 400 under 2600).
  Inside the hall no spot Jonas can stand on lies under a ceiling (an overhang included) lower
  than 400 over it (`hall/layout.js` `HEADROOM`): a lower overhang is filled solid or too low
  for him to fit under (`tests/hall.test.js` scans a grid of every floor for it).
* **Not re-pointed**: the effects (`fx`: area objects get `fx: null`), the meltdown, the camera
  shake, the look-up and boss camera and the cannon's perimeter clamp stay the grounds': they
  only act in AI RACE mode, which never leaves the grounds (below).

```js
const areas = new AreaSwitch({ scene, view, events, input, player, cam, hud, dialog, defs: AREA_DEFS,
                               grounds: { level, objects }, canWarp, onSwap })
areas.get(name)                 // built on first use (buildArea + an ObjectManager of its own:
                                // fx and level null, area: name; its group hidden; root and
                                // group handed to view.prewarm), then kept; null if unknown
areas.enter(name, entryId?)     // switch at once, no wipe (GAME OVER, ?area=, tests)
areas.request({ to, entry, kind, from }) -> accepted   // 'warpRequest' calls it (objects/Door.js)
areas.step(controller) -> controller   // 30 Hz, in play after the dialog block (main's tick)
areas.wipe(alpha) -> { amount, kind, color }            // for ui/ScreenWipe.js
areas.leave(); areas.canLeave() // def.leave: the pause screen's way out of a course, and
                                // whether it can be taken now (main offers it only then)
areas.onStar(e)                 // 'starCollected' of the current area: its lamps (below), and
                                // def.starExit
areas.resetCourses()            // GAME OVER: every built area's reset() and objects.reset(), its
                                // lamps out; the course cards show again
areas.update(time, camera, alpha)   // per frame: the current area (and the sky where def.sky), and
                                // a door swinging (drawn alpha of the way into the next tick)
areas.heroScale(alpha) -> scale // per frame: Jonas's size (1, but diving into the bottle)
areas.heroOffset(alpha) -> { x, z }   // per frame: his model off where he stands (0, but
                                // stepping into a door's opening); reused
areas.busy, .name, .current, .objects, .phase, .warp, .buildMs[name], .carry, .still, .won
```

**The switch** (`_swap`, the one place that points the game at another area), in this order:
1. an open dialog closes;
2. the old area hides, the new one shows, the grounds' sky dome only where `def.sky`;
3. `view.setAtmosphere(def.atmosphere)` (`null`: the grounds) and `view.setWaterLevelFn(waterFn)`;
4. `player.setWorld({ collision, spawn: respawn, signs, groundAt })`, then `player.placeAt(entry)`;
5. `cam.setCollision(collision)`, then `cam.reset(player, { yaw: entry.camYaw })`;
6. `objects.enter(player)` (his last tick forgotten, a door he arrives at kept quiet);
7. `hud.setCourse(name)` (the pause screen's course name), and on a course's first entry in a
   game (`def.card`; `resetCourses()` forgets them) `hud.showCourse(name)`, its title card;
8. `input.flush()`;
9. `onSwap()` (main: `lastAction = player.action`, so an arrival dropping in is no respawn), then
   `'areaChange' { from, to, entry, audio }` (`audio`: the Area's, see above; the audio's music,
   ambience and reverb follow it).

**Transitions** run on the simulation clock inside `'play'` (no mode of their own: pause freezes
them, START is ignored while `busy`):

| Phase | Ticks | Stick | Wipe |
|---|---|---|---|
| `close` | 14 (the star exit 18) | through a door, pushing on toward it (world yaw = the door's yaw + π) as its leaves swing open, his model stepping on into the opening once they are aside; into the bottle, shrinking; else neutral. A camera still between him and the door (he backed into it) cuts to the room side behind him as the door opens (`cam.reset(player, { yaw: door.yaw })`), so the wipe closes on him at the door, not on his cap | 0 → 1 |
| `hold` | 4 | neutral; the **first** tick switches (building a new area there, behind the covered frame): the door he went through shuts, the one he comes out of stands open, he is his own size again | 1 |
| `open` | 14 | with `entry.walkIn: n`, walking on along `entry.yaw` for n ticks; then his own. The door behind him (after a door) stands open for the first `WARP.SHUT_FROM` (4) ticks, then shuts, its leaves meeting on tick 13 as `sfx door_close` plays (carried or held still, below). An entry with `sfx` plays it as this phase starts (popping out of the bottle: `bottle_pop`; the listener is there by then) | 1 → 0 |

The scripted stick for world yaw W is `a = wrap(cameraYaw − W)`, `(sin a, cos a)` (the inverse of
`stickToWorldYaw`), in one reused controller. **A stick held through a door is carried** across
the camera cut: the camera on the other side may face the other way (the porch: in front of him,
looking at the door), where the same push would turn him round into the door again. From the
switch on, while the stick stays pushed within ~40° (`WARP.CARRY_TURN`) of where it was, it is
read against the old camera's yaw turned through the door (`carryYaw` = old camera yaw +
`entry.yaw` − (door yaw + π)), so after the walk-in he walks on the way he was going (his buttons
his own, in a second reused controller); letting go or turning it hands it to the new camera,
also after the transition has ended. **The approach cut**: walking toward the camera into a
door that leads somewhere (the hall's inner door, right after arriving through it), the camera
backs up to the wall the door is in and he would walk into its lens with the door never in
view. So while no transition runs, once he is within 800 (`WARP.APPROACH`) of a door's face,
lined up with it, on its floor, grounded and heading for it (within 60°), with the camera
between him and it, the camera cuts round to the room side behind him looking at the door
(`cam.reset(player, { yaw: door.yaw })`) and the stick he holds is carried across that cut the
same way (read against the old camera's yaw), so he walks on into the door with it in view;
the switch then reads a carried stick in the frame it was carried in, so he comes out on the
other side the way he was walking. A locked door, or one with the camera already behind him,
never cuts. **Out of a course** (the star exit, the pause screen's leave: no door), a stick
still held at the switch is **held still** until it is let go (`.still`; his buttons his own):
pushed on from the course it would walk him straight back into the bottle's mouth, which is
armed (the hall's `bottle` entry stands just off its apron), while a fresh push takes him back
in at once.
A request is refused while a transition runs, while `canWarp()` says no (main: `mode 'play'`,
not `state.dark`, `darkT` 0, the meltdown not running) or a dialog is up (AreaSwitch asks the
dialog itself), while Jonas is in `death`, `spawn`, `reading` or `cannon`, and for an unknown
area or entry; the door that asked stays disarmed until he steps off its apron. Dying (or a
respawn) during `close` opens the wipe again from where it got to, without a switch, and a warp
no longer allowed on the first covered tick opens it from covered, without a switch. The star
exit (`onStar`, the current area's own star only, never Rustmaw's `{ boss: true }`) waits out
the dance (`star_dance` / `star_fall`; 45 ticks for a swimmer), 20 ticks more, then closes with
a gold-white fade (`#fff4d0`) instead of the iris. `canLeave()` is true in a course with a
`def.leave` while no transition runs, `canWarp()` says yes and Jonas is not in `death`, `spawn`
(dropping in) or `cannon`; `leave()` then closes a sign he is reading (its `'dialogClosed'` ends
the read) and requests `def.leave`. Main offers the way out (the pause screen's line, the touch
B kept bright) only while `canLeave()` holds as the game pauses, so the line and the button
always agree (nothing changes while paused).

**Doors swing, Jonas shrinks.** Through a door (`kind 'door'`) its two leaves swing
(`Area.setDoorOpen(t)`, 0 shut .. 1 open, eased by the part; each area has one swinging door: the
castle's front door on the grounds, its inside in the hall, `castle/building.js` `door()` with a
passage, see "Castle door"): the door he walks into opens from shut as the wipe closes (`t /
closeTicks`) and, if the warp is called off, shuts again with the wipe. Its collider stays solid,
so where he stands he stops at the surround's face, about 106 short of the leaves; once they have
swung aside (`WARP.STEP_AT`, 0.4 of the close) his model steps on into the opening as the iris
closes on him (`heroOffset`: up to `WARP.STEP`, 120, eased, along the door's way in; main moves
the model by it after posing it, so the iris follows him), and back out with a warp called off.
At the switch that door shuts (its area is hidden now) and the door he comes out of stands open;
it stays open while the iris is still small on him (`WARP.SHUT_FROM`, 4 ticks into the open),
then shuts behind him in view as the picture opens out, its leaves meeting on the open's last tick
but one as `door_close` plays (on the porch the camera faces it; in the hall it is behind the
camera, heard only). Into the bottle (`kind 'bottle'`) Jonas shrinks to `WARP.SHRINK` (0.35) of
his size as the wipe closes on him (`heroScale`, eased; main scales his model by it about his
feet, the shadow staying on the floor), and is his own size again from the switch (or grows back
with the wipe if the dive is called off). All of it is worked out per tick (`_swing`) and drawn
between ticks by `alpha`; a switch at once (`enter()`) shuts a door still swinging. Nothing is
allocated per tick or frame (`tests/objects-door.test.js` guards the source).

**Lamps.** A course's own star, the moment it is won (`onStar`), lights its lamp (`Area.setLit`:
Midsummer Skerries' lighthouse, its lamp glowing and its beams sweeping round) and that of every
area whose `def.lamp` names the course (the hall: the little lighthouse in the bottle, its lamp
glowing deep gold and two little beams sweeping round inside the glass), for the
rest of the game (`.won`, the courses won; an area built later comes lit). Rustmaw's star and a
star of another area light nothing. `resetCourses()` (GAME OVER) puts them all out.

**The wipe** (`src/ui/ScreenWipe.js`): `new ScreenWipe(uiRoot)` before the HUD (its canvas lies
under the HUD's counters and pause screen); main calls `wipe.draw(areas.wipe(alpha),
model.object3D.position, camera, model.object3D.scale.y)` every frame before `view.render()` (so
the recorder's composite has it). A black circle iris centred on Jonas's chest (100 above his
feet, times his scale, projected with the world camera; off screen or behind it: the middle),
from the farthest corner at 0 to nothing at 1, drawn at the HUD's logical resolution (240 lines,
`image-rendering: pixelated`) as two solid spans per row, so its edge steps like the pixel art;
`'fade'` fills with the colour at `amount` opacity; `display: none` at 0.

**AI RACE stays on the grounds.** Its button and beast are the grounds' objects; the castle door
is sealed while `modeOn || darkT > 0` (ObjectManager passes it to every door: the laugh and the
`castle_sealed` sign instead of the warp); main's `'aiRaceButton'` handler ignores `on` outside
the grounds (a test's `setDark(true)` in the hall) and while a transition runs; `canWarp()`
refuses warps while it is on, fading or melting down, and is asked again on the first covered
tick (a no then opens the wipe without a switch). So away from the grounds darkness is 0, the
meltdown idle, rain 0, and the look-up, boss camera and shake have nothing to react to.

**GAME OVER** from any area: after the card, `areas.enter('grounds', 'start')` and
`areas.resetCourses()` run first in the `setTimeout` body, before `objects.reset()`,
`meltdown.reset()` and the title (the grounds' look is back before the meltdown's reset
repaints it). Everything lasts for one game; nothing about areas is stored.

**Tests**: `tests/areas.test.js` (node: the real grounds, hall, Player and camera through main's
tick: the walk in, the phases and the stick each gives, the graph walk that finds no stale
collision world on Jonas or the camera, the arrival framing, the way back (and the approach cut
when he walks toward the camera into the inner door: never close over him, one cut, walked on
into the door and out on the porch; none at a locked door or with the camera already behind
him), the stick held through the inner door carried out across the porch until let go or turned,
AI RACE's seal, refusals (also once the screen is covered), a death mid-close, GAME OVER's
return, a test course's star exit, leave and resetCourses, one whose arrival stands in a door:
objects.enter on every switch; the doors swinging as a frame after each tick draws them, and
one half way between ticks (the castle door opening over the close from shut, eased, to standing
open, shut at the switch; the hall's open then, still open `SHUT_FROM` ticks into the open, then
shutting, meeting on the open's tick 13 as `door_close` plays; the same way back out, the castle
door shutting behind him on the porch; a warp called off shutting it with the wipe, `enter()`
shutting one mid-swing, none for the bottle); his step into the door (none until the leaves are
aside, then eased in to `STEP` with the frames between ticks between, straight in, the door's
collider still stopping him while his model stands in the opening, no leaf ever cutting his body;
back out with a warp called off; none at the switch, into the inner door the other way, none into
the bottle); Jonas shrinking into the bottle (falling every tick to `SHRINK`, the frames between
ticks strictly between them, his size again from the switch, growing back with a dive called off,
never through a door; jumping at the mouth, the real model's shadow staying on the landing as he
shrinks in the air); the lamps (the course's star
lighting its lighthouse and the hall's at once, an area built later coming lit, GAME OVER
putting them out, nothing lit by Rustmaw's star or another area's); and Midsummer Skerries: into
the bottle's neck (its sound, the iris) to the drop-in onto the jetty with the camera behind
him, the course's look and sky, its card once a game; the real star's exit back out of the
bottle onto the hall's landing exactly 20 ticks after the dance, one star up, popping out with
`bottle_pop` as the fade opens, a stick held on from the course waiting to be let go and a fresh
push then walking him straight back into the armed bottle, the star staying taken; the pause
screen's leave (open while he reads a sign, which it closes; not while he drops in or dies;
main's pause toggle and paused branch in order); a life lost there; GAME OVER from it (main's
order, the star, the coins and the lamp back)); `tests/areas-browser.test.js` (E2E=1: the iris
over the picture and under the HUD, setDark ignored mid-warp and in the hall, the hall's picture
and draw calls (also from the landing), the hall's textures at most 128 px, the pause course
name, the way out; the full walk: in through the castle door (its leaves swinging in onto the
passage, his model stepping into the opening), north up the hall into the bottle (Jonas
shrinking, the iris centred on his chest as it comes down), the course, out of it from the
pause screen, south down the hall and out of the inner door (the castle door standing open, then
shut behind him), no page errors; `?area=hall`, forward held through the inner door;
`?area=skerries`: the drop-in (paused then, no way out offered and B does nothing), the card,
the sky, its draw calls, build time and textures, the star's exit into the hall with both lamps
lit (out again after GAME OVER), paused while reading the welcome sign the way out offered (the
touch B kept bright) and B closing the sign and leaving, GAME OVER there back to the grounds'
title); `tests/castle.test.js` (the front door shut fills its opening, open its leaves stand
turned into the wall within the opening's sides onto the passage, on the way eased, the collider
unchanged);
`tests/ui-touch.test.js` (E2E=1: in a course on a landscape phone, paused, B stays bright over
the faded overlays and a tap on it leaves); `tests/skerries.test.js` and
`tests/skerries-routes.test.js` (see "Midsummer Skerries"); `tests/hall.test.js` (node, the hall
as `buildArea` places it with the real Player, camera and objects: the budgets (the hall's own
objects at most 8 meshes too), a closed room (sampled with 12 seeds, outside the furniture), no
floor under less than `HEADROOM`, spam runs that never leave it, the entries' footing and
framing, walks round the bottle's end and into its flanks that never trap the camera, C-button
swings by the bottle and the furniture that never take it into a solid, the routes (stairs,
cork, books, wall kicks up the slot with its coins, the banner pole onto the buttress for aims
up to 15° off, staying up there, the hop onto the mantel to the 1-up), signs read from the front
only, every coin over a floor, the doors' triggers on their faces, the glass and its rim, the
flicker (its shader hook too), the lamp (lit: a deep gold far from the wall's cream, its beams
turning round inside the glass, drawn before it), the front door's leaves filling its opening
shut and swinging aside onto the passage, eased). `tests/ui.test.js` checks the pause screen draws the HUD's
course name and the leave line only while the HUD offers it (`setLeave`; a switch takes it away;
in the legend's bindings, between PAUSE and the panel at every screen size), and the course card
(its ticks, its slide, waiting while paused, exactly double size on the 320-wide screen);
`tests/ui-wipe.test.js` (node, a stand-in canvas) that the iris is a hole round his chest as the
camera sees it, smaller the further it closes, lower with his size (into the bottle), centred
for a hero behind the camera, and the fade even; `tests/ui-dialog.test.js` that every hall and course sign and door page draws in the dialog
font, fits one screen of the box and is its own (no trademark), and that "AI RACE" never wraps
apart. `tests/areas.test.js` also walks Jonas up to the hall's east doors: their sign, no laugh,
no warp.

### The Great Hall (`src/world/hall/*`)

`world/hall/layout.js` holds the anchors in the hall's local frame (+x east, −z north toward the
bottle at the far end, the floor at y 0; world = local + (0, 0, −60000)); `world/hall/hall.js`
builds the room (`buildHall(layout)`, a WorldPart), `world/hall/bottle.js` its north end
(`buildBottle(kit, layout)`, writing into the same kit), `world/hall/textures.js` the one texture
of its own (`bannerTexture`, 32 × 64; everything else reuses the castle's and the courtyard's).

```
                       -Z (north)
     ┌──── window ──── bottle on its stand and cradles ──── window ────┐
     │ buttress  pole                                     door (cog)   │
     │ (slot)             books  landing  cork                         │
     │ fireplace   sign          stairs                  door (snow)   │
     │ (pi, 1-up)                chandelier                            │
     │ window                    sign      chart table          window │
     │ window    sign            chandelier                     window │
     └──── banner ──── rose window over the front door ──── banner ────┘
                       +Z (south, the courtyard)
```

* **Room**: inside x ±2200, z −4200 … 3000; floor, walls and the collision ceiling (2600) are
  200-thick stone slabs (their faces toward the room are the boxes' outward faces), stone
  pilasters up the side walls. Over the collision ceiling, drawn only and out of the camera's
  reach (it stays under ~2540): the open roof (`ROOF`): oak tie beams 200 × 160 from 2600 to
  2760 every 900 from z −3900 (so both candle rings hang from one), each carrying a king-post
  truss (principal rafters, struts) to the ridge at 3800, a ridge beam and a purlin down each
  slope, plaster panels under the slopes, the end walls rising into gables.
* **South wall**: the inside of the castle's front door (`castle/building.js` `door()`; its
  collider puts the face at z 2944), its two leaves swinging into the wall on their hinges
  (`setDoorOpen(t)`, as Jonas goes out through it and comes in, see "Areas and transitions")
  through the opening `shell()` leaves in the wall's faces, onto a dark passage drawn in with
  the wood (behind the shut leaves it never shows), under the stained-glass rose window
  (`castle/parts.js` `roundWindow`, the castle's rose texture, full-bright), two
  crimson-and-gold banners (the castle's golden sun) at x ±700 from 2400 down to 1200, pleated,
  cut to a point.
* **Windows**: two tall arched windows in each side wall (z 1900, 700) and two in the north wall
  (x ±1500): `castle/parts.js` `archWindow`, 320 × 1000 from a 600 sill, panes glowing pale gold
  behind iron bars.
* **West wall**: the chimney breast (stone collider x −2200 … −1750, z −1260 … −200, top 1700:
  the mantel, with the 1-up and a flue up the wall beside it) with its hearth (drawn only, 700 ×
  600, 120 deep: logs, embers and flickering flames, the inside lit warm from below) and Jonas's
  crest (a white π on a red disc with a gold rim, over the hearth); the buttress (x −2200 …
  −1750, z −2080 … −1620, top 1700) with the **wall-kick slot** between them (z −1620 … −1260,
  360 wide, open to the east); the **banner pole** (`POLES`: r 30 at (−1500, −1850), up to 1550,
  150 under the buttress top, level with its middle and 250 east of its face) with a small banner
  near its top: the jump off its top toward the wall carries 730 … 850, clears the buttress's
  edge and stops against the west wall over it, so any aim within 15° of straight at the wall
  drops him mid-top, where he stays.
* **East wall**: two arched stone alcoves (the arch standing 80 out of the wall; its piers
  solid) with doors still being built (`door()`, faces at x 2144), a snowflake and a cog on the
  plaques over them; out in the room the round **chart table** (oak, octagonal collider r 320,
  top 90 at (1100, 700)) with a chart of the first course on it (home island, the skerries, the
  lighthouse's islet, a dotted route), a ring of 8 coins round it.
* **The ship in the bottle** (`bottle.js`): a giant glass bottle lying along x 0 (axis 760; body
  r 520 from z −4190, just off the north wall so no corridor behind it can trap the camera, to
  −2300, a shoulder to the neck, r 240 to −1440, a lip ring r 270 to −1400). Its colliders are
  convex solids round the axis of **slippery** stone, each cross-section with a corner straight
  up and down and a vertical face across its widest band (the body and shoulder 75° … 105°, the
  neck and lip 70° … 110°): a wall there stops the camera's path check, where corners at the
  widest point would leave a steep floor (which the path leaves to the height limit) and a
  C-button swing could carry the camera into the glass. It lies on a dark oak **stand** that
  runs its length from its end to the landing, rising round the glass to 45° either side of
  straight down (its half-width follows the glass: 368 under the body, narrowing under the
  shoulder to 170 under the neck; a lighter rail along its top), with two lighter carved
  **cradles** across it (z −3600 and −2600, tops 420, level with the putty sea) whose cheeks
  rise round the glass from there into its widest band (to 640, their outer sides sloping in
  from 650 to 580). So no spot under the glass is lower than `HEADROOM` (400) under it: beside
  the stand the glass is 440 or more over the floor, the stand's own top lies inside the glass
  (its colliders flat-topped boxes; at worst a sliver under it, far too low to stand in), and no
  cradle leaves a ledge under it. Inside, a putty sea (420) with a model of the first course:
  pink granite islets, a red cottage on the green home island, a boat with a red sail and a
  white jib, a white lighthouse with a red band whose lamp is the `hall-lamp` mesh, hidden until
  that course's star is won (`setLit(on)`; `AREA_DEFS.hall.lamp` names the course, and
  AreaSwitch lights it with the course's own lighthouse): a deep gold lamp (`0xffa828`) swelling
  out of the dark lantern, so it stands out from the cream wall behind the glass, and two hazy
  beams like the course's (a horizontal and a vertical fan each, 380 long, fading out) turning
  round it at the course's 0.55 rad/s, inside the glass whichever way they point. The **landing** (wood, x ±450, z −1400
  … −900, top 550: the neck's inner floor) at its mouth; the **stairs** up to it a smooth ramp
  collider (`not_slippery`, 28.8°, from z 100) under 11 drawn steps (each tread's middle on the
  ramp; dark risers, light treads) between two dark stringers 40 wide, their tops along the ramp
  (the collider runs on under them); a giant **cork** (octagonal, r 190 at its foot narrowing to
  160 at its top, 380, 90 from the landing; a darker ring round its foot) and three giant
  **books** stacked like stairs against the landing's west side (tops 150, 300, 450).
* **Two candle rings** (iron, r 380, 8 candles each, at 2050) hang on chains from the tie beams
  over (0, 1500) and (0, −300).
* **Meshes** (12): `hall-floor` (flagstones on a 200 grid), `hall-wall` (plaster), `hall-trim`
  (stone), `hall-wood` (oak and iron; the front door's passage), `hall-door-left` and
  `hall-door-right` (the front door's leaves, the wood's material, each turning about its
  hinge), `hall-paint` (untextured vertex colours: the model, the crest, plaques, chart, candles,
  cork and books), `hall-glow` (full-bright: the rose window's
  glass from the rose texture, and the window panes, embers and flames, which all sample the rose
  texture's pale gold middle), `hall-cloth` (the banners), `hall-bottle` (the glass: one
  transparent surface, front faces only, no depth write, a highlight stripe in its vertex
  colours; outer faces only, so it never lies over itself; opacity 0.22 face on, rising to 0.62
  and paler where the view grazes it, from the angle between each face and the view in its
  shader, so its outline reads against the cream walls and the dark stand), `hall-signs`
  (signposts: `props/decor.js` `addSignpost`, exported for it), `hall-lamp` (full-bright, its
  faces' glow its vertex colours' alpha: 1 on the lamp, fading along the beams; the course's beam
  material, so one shader for both; set about the lighthouse's axis to turn round it in
  `update(time)` while lit; drawn before the glass round it). Lighting baked from `HALL_SUN`
  (0.1, 0.8, 0.6; ambient 0.55, diffuse 0.45); the floor 25 % darker within 400 of a wall, 15 %
  brighter in pools under the windows, a little under the candle rings, and faintly coloured
  under the rose window. The flames flicker: the glow mesh's `'flame'` attribute (0 steady, else
  the flame's phase) scales their colour by a wobble of the uniform `update(time)` sets
  (`material.userData.flameTime`). ~7.4k triangles, ~580 collider triangles (stone and wood; the
  glass `slippery`, the stairs `not_slippery`: `castle/geom.js` `SolidBuilder.solid(polys,
  terrain, surface?)`), built in ~40–80 ms in node, ~45 ms in the browser; 32 draw calls in the
  hall (the E2E budget is 45).
* **Entries**: `front` (0, 0, 1550) facing north with the room behind him for the camera,
  walking in 10 ticks; `bottle` (0, 550, −1120) facing south, dropping 250, `camYaw` 0, with
  `sfx: 'bottle_pop'` (AreaSwitch plays it as the wipe opens), 280 out from the mouth's face:
  just off its re-arm apron (`DOOR.REACH + APRON`, 260), so turning round walks him straight
  back in (a stick held on from the course waits to be let go first); the respawn drops in at
  `front` from 400.
* **Doors** (`DOORS`): `hall_front`, the inside of the front door (face z 2944, yaw π), back out
  to the grounds' `porch`; `bottle` (the lip's end face, z −1400, on the landing at 550, `kind:
  'bottle'`) into Midsummer Skerries' `arrival` (see "Midsummer Skerries"); `hall_east_1`,
  `hall_east_2` (faces x 2144, yaw −π/2) `to: null` for now: no laugh, the handle rattling in
  its frame (`laugh: false`: `door_rattle`) and their sign (`HALL_DOOR_SOON` 'This door is still
  being built.' / 'Come back after the next update!').
* **Pickups and signs**: 19 coins (`COINS`, each at its floor + 60, but the three hanging in the
  wall-kick slot at 450, 900, 1350: the ring round the chart table, the slot, up the stairs and
  onto the landing, the cork and the top two books), the 1-up on the mantel (`ONE_UP`), three
  signs (`SIGNS`, each with its `y`): `hall_welcome` by the front door, `bottle` by the stairs,
  `wallkick` in front of the fireplace.
* **Look** (`HALL_ATMOSPHERE`): brown-amber fog 0x3b2a1d from 3500 to 16000 (also the clear
  colour: no sky), a warm actor sun 0xffe0b0 (0.5π) from (0, 0.72, 0.69), hemisphere 0xfff0da /
  0x6e5038 (0.55π).
* **Sound** (`def.audio`, see "Audio"): its own loop, "Compass and Candle" (`castle_hall`); the
  `'hall'` ambience, a low room tone with the fire crackling in the hearth (`HEARTH_FIRE`, the
  middle of the hearth's opening, (−1750, 300, −730)); every sound effect ringing in the hall
  reverb (`reverb: true`).
* **Preview**: `/preview.html?m=hall` (`src/dev/previews/hall.js`: the hall alone under its fog;
  `&col=1` the collider overlay, whose every face shows from inside the room; `&lamp=1` the
  lamp lit; `&door=0..1` the front door that far open; `&view=entry|bottle|fire|roof`; `&t=`
  freezes the flicker).

### Midsummer Skerries (`src/world/skerries/*`)

The first course, through the neck of the ship in the bottle: a sheltered bay of pink-grey
granite skerries in midsummer evening light. Jonas drops in onto the jetty of Home Island, where
the red-sailed boat from the bottle is moored; far out on the last rock a white lighthouse with
a red band holds the course's star on its lamp gallery, in view from the first second. The way
there, three ways out to the islet: hop across the stepping skerries to the west (one gap wants
a long jump); swim across the Sound to the islet's beach (a sand bar to stand on half way, a
sunken rowing boat with the course's 1-up to dive to); or take the fishermen's boardwalk east
to East Rock, wall-kick up the chimney beside the net shed (or climb the net mast) onto its
loft and walk the plank bridge down onto the islet. Then climb its terraces and the signal
mast, and jump from its top onto the gallery. Water catches every missed jump. Home Island's
meadow has a maypole, a red cottage and a flagpole, butterflies over it and white gulls
overhead.

`world/skerries/layout.js` holds the anchors in the course's local frame (sea level at y 0, +x
east, −z north toward the lighthouse; world = local + (60000, 0, 0)); `world/skerries/build.js`
builds the land (`buildSkerries(layout)`, the WorldPart `'skerries'`), writing into its kit the
lighthouse and the signal mast through `world/skerries/lighthouse.js` (`buildLighthouse(kit,
layout)`, which also owns the lamp and its beams), the east route through
`world/skerries/east.js` (`buildEast(kit, layout)`: the boardwalk, East Rock's pinnacle, net
shed, boathouse and net mast, the plank bridge) and the props through
`world/skerries/props.js` (`buildProps(kit, layout)`: the maypole, the cottage, the flagpole,
the keeper's hut, the firs, the sand bar, the sunken boat; `fir()` also draws the cliffs'),
the houses among them through `world/skerries/houses.js` (`house(kit, h)`: Falu-red board
walls with white corners, doors and windows, a tarred board gable roof or a flat plank deck);
`world/skerries/sea.js` builds the sea (`buildSea(layout)`, the WorldPart `'sea'`);
`world/skerries/textures.js` its three textures of its own (`faluPlankTexture` 64 × 64,
`sailTexture` and `netTexture` 32 × 32; the rest reuses the terrain's rock, grass, path and
water textures, the castle's wood and the trees' leaves).

```
                          -Z (north)
     ┌── net racks ── reef ── net racks ── reef ── net racks ──┐
     │       great rock ┐  ┌ islet: three terraces, firs        │
     │       s5         └──┤  lighthouse (star), signal mast     │
     │                     └ stair, blocks, hut; beach  ╲        │
west │  s4 (long jump)       sunken boat       plank bridge     │ east
cliff│  s3                 the Sound       net shed ┐ East Rock │ cliff
     │     s2                 sand bar    chimney ──┘ boathouse │
     │       s1    boat  jetty                     boardwalk    │
     │          ┌── Home Island ────────┐ beach ────┘           │
     └──────────┴─ maypole, cottage ────┴───────────────────────┘
                          +Z (south): the mainland cliffs
```

* **Bay**: water at sea level over x ±5200, z −6600 … 5400 (`waterLevelAt`: none outside),
  over a sand seabed at −800 under all of it (no hole anywhere, so no edge is an invisible wall
  over the deep). One enclosure of four walls from the seabed up to 4500 (`BAY.wallTop`, over
  anything he can reach: the gallery is at 2750, a jump from it peaks near 3000) shuts it in,
  invisible: the mainland cliffs (west, south, east) and the net racks on the outer reef (north)
  are drawn just outside them, and the walls seal off the cliff tops. Authoring rule
  (`EDGE_RULE`, tested): no spot to stand on and no pole tip higher than 900 lies within 1200 of
  the enclosure.
* **Rocks** (`build.js` `rock()`): a convex top outline whose sides drop sheer into the water
  (leaning 10 out down to a toe 60 under the surface) and flare out from there to their foot on
  the seabed. Sheer above the water so a water jump slides up them onto the top and a hop that
  falls short grabs the edge; a sloping flank would be a floor too steep to stand on, which
  catches the water jump and slides him back in. Every top is at most 260 over the sea (but the
  islet's, which has its beach).
* **Home Island** (`HOME`, top 150): a granite plateau with a meadow in the middle (grass
  colliders: grassy footsteps), its south side against the cliffs, a sand beach (30°) down into
  the water along its north-east edge. The **jetty** (`JETTY`, x −1050 … −750, z 600 … 2000)
  is level with the island's top and runs on over its flank into it (no steep bit between
  them), on a stone crib boarded down to the water and solid to the seabed (nothing to swim
  under); the **boat** (`BOAT`, the bottle's boat full size: a blue hull, a plank deck at 80, a
  red mainsail and a white jib, both above Jonas's head on deck) lies alongside it, its hull
  against the jetty's side (no crevice between them), its mast (`BOAT_MAST`) a climbable pole.
* **Stepping skerries** (`SKERRIES`, rounded rocks of size r, tops `SKERRY.topK` 0.72 r across):
  s1 … s5 from the island's north-west corner out to Great Rock, the islet's west spur (top 300).
  Their tops' gaps (443 … 607) are running jumps (818 on flat ground), but s4 to s5: 1039, a long
  jump from s4 (864 across, the runway) over an arc of five coins; a plain running jump falls
  in. The `skerries_longjump` sign on s4 stands west of the hop in and the runway out.
* **The Sound**: open water 800 deep between the island and the islet, up to the islet's south
  beach (`ISLET_BEACH`: as wide as the first terrace's south edge, from that edge, where its top
  meets the terrace's, down under the water at 33°).
* **The islet** (`ISLET`, `TERRACES`): three terraces round (0, −4300), regular polygons with an
  edge facing south and east: the first (top 300, r 2000, 16 sides) drops into the sea like a
  rock, the second (750, r 1400) and third (1150, r 900, 12 sides) stand on the one below behind
  sheer granite faces, meadows on top inside granite rims. Up from the first: two stone blocks
  against the second's east face (`BLOCKS`, tops 450 and 600, 480 deep: walking hops; a running
  jump overshoots them) or a double jump up the face. Up from the second: a wooden stair
  (`STAIR`: a smooth `not_slippery` ramp collider at 27° under 12 drawn steps between stringers,
  all on a stone base) to a stone landing flush with the third's top and reaching into it (the
  stair meets the terrace along a straight edge, no step).
* **The lighthouse** (`LIGHTHOUSE`, on the third terrace at (0, −4600)): a tapering white tower of
  painted planks (r 340 → 280, 1150 … 2750) with a red band, a door and windows facing the mast;
  the lamp gallery round its top (an iron floor out to r 600 on struts, behind a railing 100 high
  that stays open over 70° facing south); the eight-sided lantern room (r 250, to 3350: dark
  glass between iron posts over a low white wall; a solid prism with an edge facing south) under
  a red domed cap with a gold finial. The **signal mast** (`MAST`, a climbable pole at (0, −3600)
  from 1150 to 2600: its tip 150 under the gallery's floor, 400 from its edge): up it (~180
  ticks), a handstand on its tip and the jump off it toward the lighthouse comes down on the
  gallery about 680 out, the lantern stopping him (any aim within 15° of straight at it; the
  jump clears the railing, so its gap is no part of the landing). The mast has a side of its
  own (`MAST.camYaw` 0, see "Camera" and "Tree tops"): while he holds it the camera swings round
  to its south side, looking past him at the lighthouse, and he works his way round the trunk
  to that side, facing the lighthouse, however he came to it. Up the stair he grabs it facing
  south-east, his back to the lighthouse, where the follow camera's usual swing behind him would
  leave the lighthouse off the screen and have a push toward it climb him back down; so pushing
  at the lighthouse is pushing the stick up. Walking off the gallery through its gap the mast
  catches him under its floor, and the same swing keeps the camera off the gallery, in view of
  him. The `skerries_mast` sign stands by the mast, facing the stair's head.
* **The east route** (`east.js`): the **boardwalk** (`BOARDWALK`, deck at 120) from Home
  Island's east shore (over its beach) east, then north up to East Rock, in stretches of plank
  deck (the planks across the walk) on cribs boarded down to the water and solid to the seabed
  like the jetty, with water where planks are missing: a gap of 300 and one of 450 (running
  jumps) and between them a single plank 110 wide (`narrow`: a slab, water under it) to balance
  along. The stretch past the first gap is 800 long, so a running jump over it (landing about
  500 past the gap) skids to a stop short of the plank. The last stretch, past the second gap,
  has a top of its own, East Rock's 150 (a step up the running jump clears), and runs on over
  the rock's flank into its top like the jetty into the island's: a rise of 30 (the knee probe's
  height, `step.js` `KNEE_Y`) would be a wall to him, sliding him along the rock's slanted face
  off the deck. **East Rock** (`EAST_ROCK`, flat granite, top 150, one of `build.js`'s rocks)
  carries a red **boathouse** on its east side, the tall red **net shed** (`NET_SHED`, its flat
  roof at 1250 a loft deck with a railing 100 high along its north and east edges) and west of
  it a granite **pinnacle** as tall. Between the pinnacle's east face (sheer) and the shed's
  west wall runs the wall-kick **chimney** (`CHIMNEY`, 360 wide like the hall's slot, open to
  the south), shut at its north end by a granite **back wall** 200 thick, as tall, whose top
  joins the pinnacle's to the loft: kicking back and forth up it reaches the top (three coins on
  the way; the follow camera, behind him, never loses him), with the stick straight across or
  angled toward the back wall, from anywhere in it; a runner who turns to kick without a stop is
  stopped by the back wall (open, it let him run on out of the chimney's north end). The back
  wall's collider goes in before the pinnacle's: in the corner between them a kick goes off the
  last wall that pushed him, which must be the pinnacle's face he meets head-on (were it the
  back wall, which he only grazes, he would stop and drop). From a camera off to a side or ahead
  of him, the chimney's walls hide him for a moment as he goes in or starts to kick (at most
  half a second, as in the hall's slot), until the camera has swung round. The easier way up,
  the **net mast** (`NET_MAST`, a climbable pole 250 south of the shed, `camYaw` 0 like the
  signal mast): its tip stands 300 under the loft, not 150, because from 150 under a jump with
  the stick held on carried him clean over the 600-deep loft; from 300 under it lands on the
  loft whether the stick is let go or held on, and the railing stops a landing sliding on over
  the far edges. The **plank bridge** (`BRIDGE`, 160 wide, about 12°) leaves from the back
  wall's top (west of the loft, so no gap in the loft's railing lies in the mast jump's way)
  down to the islet's second terrace: planks across two stringers on trestles, a 400 gap in the
  middle (a running jump downhill; a walking one falls in), flat landings at both ends (its
  head's lies on the back wall's top, so the bridge crosses the wall's edge at a slant with no
  hole beside it).
* **In the Sound** (`props.js`): the **sand bar** (`SANDBAR`, r 400, its top 88 under the surface:
  deeper than his feet float, 80, so he swims in over its edge, and shallower than he wades, 95,
  so he stands up on it, his head above the water: a rest half way across) and the **sunken
  rowing boat** (`WRECK`) on the seabed in the middle of the Sound, its hull solid up to its
  planked floor (the gunwales and thwarts above are drawn only), five coins in it and the
  course's **1-up** (`ONE_UP`) in its stern: a dive from the surface reaches it in about two
  seconds (breath lasts eight wedges of 8.5 s).
* **Home Island's meadow and the islet's extras** (`props.js`, `houses.js`): the **maypole**
  (`MAYPOLE`, a climbable pole wrapped in leaves from 150 to 1650 with a crossbar and two leafy
  hoops with flowers, a little pennant on top; `camYaw` 0: held from its south side, the crossbar
  along x clear of him), a ring of six coins round it and four up its axis; a red **cottage**
  (`COTTAGE`, walls to 630, ridge 960, a white chimney); the **flagpole** (`FLAGPOLE`, climbable,
  a blue and yellow pennant) by the boardwalk's start; on the second terrace the keeper's **hut**
  (`HUT`, north of the bridge's foot, built into the third terrace's south-east corner: its west
  wall inside the rock all along, so no narrowing crack is left between them, its ridge under the
  terrace's top) and two **firs** (`FIRS`, north-west of the stair's head; their colliders steep
  octagonal frustums from the ground to the tip, whose sides lean in less than a floor may, so
  they stop him like walls: a cone round the needles is a slope he walks straight up).
  Walking close round a house, at each corner the camera trailing behind him is hidden by it
  for a moment (up to about 0.7 s) until it is trapped and turns back to a clear view
  (`sight.js`; the grounds' castle corner towers do the same, for longer). Butterflies
  (`BUTTERFLY_SPOTS`) over the meadow; white gulls (`BIRD_CIRCLES`, `BIRD_TINT`) circling over
  the island and round the lantern.
* **Star** (`STAR`, `placed`): `skerries_star` on the gallery's east side, 160 over its floor,
  idle from the start (`Star.place`). Taking it ends the course (the star exit, see "Areas and
  transitions": back out of the bottle onto the hall's landing). 58 coins (`COINS`: the jetty,
  one over each stepping skerry, the long jump's arc, Great Rock, the blocks, the second terrace
  and the stair, three up the mast's axis (the climbing hero is 60 from it, inside the pickup
  radius), four round the gallery; six along the boardwalk, three up the chimney, three down the
  bridge, five in the sunken boat, six round the maypole and four up it); the 1-up in the boat;
  three signs. Climbable poles (`POLES`): the boat's mast, the signal mast, the net mast, the
  maypole and the flagpole.
* **Edges** (drawn only, outside the enclosure): the mainland cliffs, faceted granite slabs
  (each column leaning back from the wall, some set back a little) up to ~1500 under a grass cap
  rising inland with dark firs (`props.js` `fir()`, no colliders), the side cliffs running on
  north past the reef and sinking to their tips; the net-drying racks (`NETS`: tarred posts 900
  high every 600, two rails, nets hung between them, now and then a rack empty) just outside the
  north wall, low reef rocks (`REEF`, tops 60 … 120, solid) in front of them.
* **Sea** (`sea.js`): the moat's two water layers (the same textures, base and glint, scrolling
  by game time), a fine grid over the bay (slow swaths in its vertex colours) and big cells out
  to 36000, past the fog's end from anywhere in the bay, so the sea meets the sky dome in the
  haze; darker out at sea. The base layer is double-sided (it shows from under the water). Under
  it the seabed: sand under the bay, sinking away and darkening outside it.
* **Look** (`SKERRIES_ATMOSPHERE`): the grounds' fog colour and sky dome (`def.sky`), the fog from
  7000 to 28000, a low golden actor sun 0xffe2b4 (0.66π) from the west-south-west (`SKERRIES_SUN`,
  (−0.5, 0.45, 0.74)), the grounds' hemisphere. Lighting baked from `SKERRIES_SUN` with a warm
  golden-hour tint; rock darker where the sea wets it and under the water.
* **Meshes** (13): `skerries-granite` (the rock texture tinted pink-grey: every rock, the cliffs,
  the blocks, the stair's base, the pinnacle and the back wall), `-meadow` (grass: the meadows,
  the cliffs' caps), `-leaves` (the trees' leaf texture: the firs, tinted dark, and the
  maypole's leaves), `-sand` (the path texture: the beaches, the sand bar; tinted dark, the
  seabed), `-wood` (the castle's planks: the jetty, the boardwalk, the boat's deck and spars,
  the stair, the racks, the loft's deck and railing, the bridge, the sunken boat's insides;
  the gallery's iron), `-paint` (`faluPlankTexture`, painted planks tinted by vertex colour: the
  lighthouse, the boats' hulls, the houses' Falu-red walls, white trim and tarred roofs, the
  flagpole, the maypole's flowers), `-cloth` (the sails and pennants, double-sided), `-nets`
  (alpha-tested), `-signs`, `-lamp` and `-beam` (the lighthouse's lamp: full-bright glass over
  the dark panes and a lamp inside; two beams, each a horizontal and a vertical fan whose vertex
  colours' alpha fades along it, unfogged), `-sea`, `-glint`. ~9.8k triangles, ~1.7k collider
  triangles (stone, grass, sand, wood; the stair `not_slippery`), built in ~70–120 ms in node
  (~60 ms in the browser); the course's objects 7 meshes (coins, sparkles, shadows, star, 1-up,
  butterflies, gulls); 37 draw calls from the arrival (the E2E budget is 55).
  The `'skerries'` part's `setLit(on)` / `lit` lights the lamp (both its meshes hidden until
  then; its beams sweep round by game time): AreaSwitch lights it the moment the course's star
  is won, for the rest of the game, and `reset()` puts it out (GAME OVER's `resetCourses()`).
* **Entries and exits**: `arrival` (−830, 150, 1700) on the jetty facing north, in the lane up
  its east side that the welcome sign leaves free (a straight push runs him up the jetty past the
  sign through its coins), dropping in from 1600 under open sky, the camera behind him (the
  default reset) looking up the Sound at the lighthouse; a lost life drops him in there again
  (`RESPAWN`). `leave` (the pause screen) and `starExit` (the star) both take him to the hall's
  `bottle` entry; `card: true` (its name as a title card on its first entry in a game). Sound
  (`def.audio`, see "Audio"): its own loop, "Skerry Polska" (`skerries`); the `'sea'` ambience
  (the wind, waves lapping at `SEA_LEVEL` on the open water round the listener, never on the
  rocks or the meadow, gulls calling from over `BIRD_CIRCLES`, where the white gulls fly); no
  reverb.
* **Preview**: `/preview.html?m=skerries` (`src/dev/previews/skerries.js`: the course and its sea
  under its fog with the grounds' sky dome; `&col=1` the collider overlay; `&lit=1` the lamp lit;
  `&view=overview|arrival|skerries|islet|gallery|bay|east|chimney|bridge|meadow|wreck`, default
  `overview`; `&t=` freezes the clock).
* **Tests**: `tests/skerries.test.js` (node, the course as `buildArea` places it with the real
  Player, camera and objects: the budgets (its objects at most 8 meshes too), the arrival's open
  sky and the drop onto the jetty with the camera behind him, clear, and a straight push from
  there up the jetty past the welcome sign through its coins, the water over the bay and
  none outside it, a seabed under 200 sampled points, every top low enough or the islet's beach
  gentle enough, spam from every rock, deck and roof (Jonas and the camera stay in the bay),
  full-speed long jumps off the gallery's railing in 16 directions (the walls stop them),
  nothing high near the walls, signs read from the front only, every coin over a floor but the
  long jump's arc and those up the masts and the chimney, the star on the gallery, the 1-up in
  the sunken boat, the butterflies over the meadow and the white gulls clear over everything,
  the sand bar he stands up on, every house's walls solid where they stand (rays from 200 out
  hitting them there) and the bridge's decks, the five poles as built, the firs stopping him
  from every side (never carried up them), the hut built into the rock with no crack beside it
  and the camera never losing him round it, the camera's moment behind the cottage's corners
  walked round either way (at most 24 ticks), the net mast and the maypole held from their south
  sides with the camera there however he grabbed them (the flagpole where he grabbed it), the
  lamp and its beams, the camera keeping him in view when he walks off the gallery's gap onto
  the mast);
  `tests/skerries-routes.test.js`
  (scripted input on the real course: the hops from the island's corner to Great Rock, s4 to s5
  by long jump (with the arc's coins) and not by a running jump, out of the water onto every rock
  from every clear side, the swim across the Sound and up the beach, the blocks and the stair, the
  mast's climb and jump onto the gallery for five aims, the mast as a player meets it with the
  real follow camera (walked to from the stair's head and four other sides, a rest on its tip,
  the stick pushed at the lighthouse where it shows on the screen: always up, always onto the
  gallery), the walk round to the star: `'starCollected' { id: 'skerries_star', area:
  'skerries' }`; the east route: running jumps over the boardwalk's two gaps from three lines
  (past the first onto the long deck, skidding to a stop short of the plank; past the second
  onto the higher last stretch and on up onto East Rock without leaving the ground), the walk
  and run up off the last stretch onto the rock with and without the follow camera, its narrow
  plank walked and run along its middle, 40 off it and with the stick 5° off (and from 100 off
  it, his middle past its edge, he falls off), wall kicks up the chimney from five spots with the
  stick straight across or angled up to 20° toward the back wall, and as a player does them with
  the follow camera (walked in and a stop; run in and the stick swung at a wall at once; the
  camera starting off to a side or ahead: hidden at most 15 ticks in a row), the net mast's tip
  jump onto the loft for five aims with the stick let go or held on, the bridge from the loft
  over the back wall, its gap jumped at a run (landing 100 to 550 past it) and not at a walk,
  down onto the second terrace; a dive to the sunken boat's 1-up from five sides with no wedge
  lost; the maypole climbed from four sides past its four coins, the flagpole's climb).

## Player (`src/player/Player.js`)

```js
new Player({ collision, events, spawn: { x, y, z, yaw, drop? }, signs? })
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
player.setWorld({ collision, spawn, signs, groundAt? })  // move into another area (below)
player.placeAt({ x, y, z, yaw, drop? })                  // put him down at an area entry
signEntries(signs, groundAt?)  // (export) signs as the reach test uses them
```

Areas (places with a collision world of their own): `setWorld` points Jonas at the area's
`collision` world, makes `spawn` his respawn point (`spawn.drop`: the respawn drop-in's height
above it, `INTRO_DROP` 1600 when left out; `beginIntro()` and so every respawn use it, so a
room's lower ceiling is never above the start of the fall; the constructor keeps it too) and
takes the area's readable `signs` (a sign without `y` stands on `groundAt(x, z)`, by default the
grounds layout's `groundHeight`). Everything tied to the old place is dropped: a sign being read
(and the press guard), the cannon, Rustmaw's tail grip and spin (the grounds' objects set
`tailGrip` again on their first tick back), the blink after a hit, held breath and drowning,
jump chains and combo jumps, a wall to kick off, grab cooldowns, a let-go pole, a walk-off
drift, a flight's safe fall, a stomp bounce, and the winged hat (`'wingHat' { on: false }`).
Health, coins and stars carry over. `placeAt(entry)` then teleports him to the entry and stands
him there (`idle`), or with `entry.drop > 0` starts him that far above it in the `spawn`
drop-in. The winged-hat flight's rim (`actions/flying.js` `worldBounds`) is always that of
`player.collision`, so it follows the area too.

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
down, Z lets go; a fall that starts on a tree counts from its foot (no fall damage). A pole
with a side of its own (`camYaw`, a course's key pole: see "Camera") turns him round the trunk
to that side by himself while the stick leaves him be, on the trunk and on its tip, at the
rate the stick would (0.08 and `POLE_TOP_TURN_RATE` a tick): facing `camYaw + π`, his back to
the camera that swings round there, so the trunk never stands between them.

## Hero model (`src/player/PlayerModel.js`)

```js
const model = new PlayerModel()
model.object3D            // THREE.Group, origin at the feet, front faces +Z, ~160 units tall
model.update(renderState, dtSeconds)   // positions/rotates the group, poses limbs, blob shadow at floorY
```

The group's own scale and an offset on its position are left to main: 1 and none, but as
Jonas shrinks into the ship in the bottle (`areas.heroScale`) about his feet, and as he steps
into a door's opening (`areas.heroOffset`, see "Areas and transitions"). The blob shadow, a
child of the group, shrinks with him but keeps to the floor: `BlobShadow.update(rs, parentQuat,
parentScale)` divides its drop to the floor by the group's world scale, so a jump into the
bottle's mouth leaves it on the landing, not hanging under him (`tests/model.test.js`).

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
cam.reset(player, { yaw }?)   // snap behind the hero (level start, respawn), or to orbit yaw `yaw`
cam.setCollision(collision)   // probe another area's world from now on (reset() should follow)
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

Areas: `cam.setCollision(world)` points every part of the camera that probes the level at the
new world (the controller, the collider and its crest rise, the cover, sight and flight
helpers, the boss camera) and drops the C-button rotation probe, which is made again in the
new world when next needed; the collider starts its eased state over. `reset(player, { yaw })`
snaps the orbit to `yaw` (the direction from the hero to the camera) instead of behind him: an
entry facing away from a door gets the camera in front of him with the doorway at his back
(on the grounds porch at (0, 300, −470) facing +Z the default reset would sit side-on at
x −1238; yaw 0 puts it at (0, 624, 768)). A non-finite `yaw` means behind him, as before.
While the hero holds a pole (climbing it, or in the handstand on its tip) the orbit swings round
to his back (`POLE_SWING_*`, at most 2° a tick), or to the pole's own `camYaw` where it has one
(`collision.addPole({ ..., camYaw })`, kept only when finite): a course's key pole, the one he
jumps off toward a landmark, has the camera look past him at it however he grabbed the pole
(Midsummer Skerries' signal mast: `camYaw` 0, the camera south of it looking at the lighthouse),
and he works his way round the trunk to that side himself (see "Tree tops").

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
* The path: a move into a wall or ceiling stops in front of it and slides along it; a slide that
  would end on another one (an inside corner, the orbit slid onto that wall's plane) stops short
  (`_entering` counts a move ending within `ENTER_SLOP` of a face), so the camera never sits in
  a wall's plane, where no wall push moves it out (`tests/camera.test.js`).
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
view.setCapture({ aspect, minHeight, zoom, label } | null)   // the recorder's framing (see "Recorder")
view.setFrameHook(fn | null)      // fn() right after every render() (the buffer is still valid)
frameLayout(w, h, { pillarbox, capture, basePixelRatio, retroLines }) -> { viewport, pixelRatio, lines }   // pure
view.setView(scene, camera)       // draw another scene (a menu: the face screen) instead of the
                                  // world, through the same retro filter; its camera's aspect
                                  // follows the picture; setView() = back to the world
view.setDarkness(t); view.flash(strength)   // AI RACE mode's storm (see "AI RACE mode")
view.setMeltdown(levels)          // AI RACE's meltdown (see "Meltdown"): fire grade, white-out,
                                  // glare, heat shimmer, fog and actor lights; all 0 = no change
view.setAtmosphere(preset | null) // an area's own look (below); null = the grounds
```

Areas (`setAtmosphere`): `preset = { fog, near, far, water, sun, sunIntensity, sunDir, sky,
ground, ambientIntensity }` (colours as anything `THREE.Color.set` takes, `sunDir` a unit
`{ x, y, z }`) replaces the day look the storm (`setDarkness`), the meltdown and the
underwater fog work from: the fog colour and range with the clear colour, the underwater fog's
colour, and the actor lights (the sun's colour, strength and direction, `sun.position =
sunDir x 10000`; the hemisphere's sky and ground colours and strength). A field left out keeps
the grounds' value; `null` restores the grounds exactly (`view.dayDefault`, snapshot in
`initStorm()`). The per-area fog range lives in `view.fogRange`, which `applyAtmosphere()` uses
instead of the constants, so a storm or meltdown fading out returns to the area's look, not the
grounds'. Applied at once; with the camera under water the new surface fog waits for surfacing
(`UnderwaterFog.setSurfaceFog`). No light is added or removed (the lights stay `sun`,
`ambient` and `stormKey`), so the actors' shader programs never change.

While a `setView()` scene is drawn the world's underwater fog, storm grade, lightning flash and
meltdown grade are left out (`drawView()`), and the F1 overlay's mode line shows only the size.

Underwater (`src/render/post/underwater.js`, `UnderwaterFog`): while the camera is below the
water surface (per `setWaterLevelFn`) the scene fog is swapped for a short-range blue-green
one, and the sky dome (found by the mesh name `'skyDome'`, see World parts) is drawn with a
tinted copy of its material that mixes `UNDERWATER_SKY_TINT` of the fog colour into every
pixel, so looking up shows a murky surface instead of a clear sky. The tinted program is
compiled ahead of time while dry (`warm()`), so the first dive does not stall.

Keys: F1 debug overlay (fps, draw calls, triangles, render mode), F2 or R retro filter (240-line
render + 16-bit quantise/filter pass; off = native resolution), F3 or 4 4:3 pillarbox (never
with Ctrl/Cmd/Alt held: Cmd/Ctrl+R still reloads); V and 9 (the recorder's own listener, same
rules, never on key repeat) record video, landscape and portrait, see "Recorder"; F
(`ui/fullscreen.js` `fullscreenKey()`, same rules) toggles Fullscreen-API fullscreen on the
document through pad/device.js's `toggleFullscreen` (works in the artifact frame too, where F11
would keep the host page around the game) and, while fullscreen, asks Keyboard Lock for Escape
(Chromium; refused elsewhere and in frames) so Esc still pauses and holding Esc leaves.
The pause legend stays at twelve rows (the narrow one must fit a 4:3 screen): the arrow-key
and mouse-drag camera rows are one, `['Arrows / drag', 'Camera']`. Player-visible
labels are neutral ("Retro filter" in the pause legend, "Retro WxH" / "native WxH" in the F1
overlay, `MODE_LABELS`); internal names such as `N64Renderer`/`setN64Mode` are not shown. The
retro filter and pillarbox persist in `localStorage['castleGrounds.render.v1']`.

## Audio (`src/audio/AudioEngine.js`)

```js
const audio = new AudioEngine(events)   // subscribes to events itself
audio.unlock()                          // only after a user gesture (else the browser warns)
audio.play(name, { pos?, volume?, pitch?, terrain?, big?, index? }); audio.playMusic(name); audio.stopMusic()
audio.setListener(pos, yaw); audio.update(dt); audio.muted = true|false
audio.captureStream() -> { stream, release() } | null   // the master bus as a MediaStream (the recorder)
audio.setArea({ music, ambience, reverb, fires?, gulls?, seaLevel?, isWater? })   // on 'areaChange' (below)
```

All sound effects are synthesized with WebAudio. Music is an **original** composition.
Songs: `'title'` (a loop; a menu track stops on `gameStart`), `'castle_grounds'`, which
in game is a one-shot arrival cue (`finalBar: 8` in `songs.js`), not a loop, and
`'game_over'` ("Lanterns Out"), a jingle the engine plays **itself** on the `gameOver` event
(main never requests it) over the GAME OVER card, cutting whatever plays; the ambience is
ducked (to 0.3) for `GAME_OVER_SECONDS` (3.2 s, the card's length), then the title track
crossfades in from the jingle's last chord. The areas' loops, which the engine plays itself on
`'areaChange'` (main never requests them), both in 3/4 and fading in over 1 s:
`'castle_hall'` ("Compass and Candle", the Great Hall: G major, 92 bpm, 24 bars, ~47 s; a
glockenspiel music-box tune over harp arpeggios, soft strings and a waltz bass, no drums; its
`level` 1.2, higher than the busier songs', puts it within about a decibel of the polska and the
arrival cue in a render) and `'skerries'` ("Skerry Polska", Midsummer Skerries: D major, 132
bpm, 40 bars, ~55 s; a flute over a waltz bass with harp chords on beats 2 and 3 and a soft kick
and shaker; in B the horn answers each two-bar call of the flute over harp arpeggios; the
glockenspiel doubles the last A). (`compile.js`: harp stabs fall on beats 2 and 4 of a bar in
four, on beats 2 and 3 of a bar in three.) A one-shot cue (`castle_grounds`, `game_over`)
requested without a running AudioContext, or while muted, is **dropped**, never queued to start
later (so a gamepad-only start skips the arrival cue); a looping track (`title`, an area's) is
queued until audio unlocks.
Audio also consumes `gameStart` (stops a menu track, clears ducks, unlocks with sticky user
activation) and `pause` / `unpause` (duck + sfx), and AI RACE's `darkMode`, `lightning` and
`meltdown` (see "Meltdown"; `audio.setMeltdown(levels)` drives its inferno ambience).
Areas: `'areaChange' { audio }` calls `audio.setArea(audio)` with the area's `Area.audio`: its
`def.audio` in world coordinates (`world/area.js` `worldAudio`) and its water test, `{ music,
ambience, reverb, fires?, gulls?, seaLevel?, isWater? }`. The area Jonas is already in (GAME
OVER's switch back to the grounds he may never have left) changes nothing: its loop plays on and
the ambience keeps any fade under way (the storm lifting over its 3 s).
* **Music**: the area's own loop (`music`) plays (crossfading from whatever played, the arrival
  cue too) and becomes `audio.baseMusic`, the track the winged hat's theme and the storm's track
  hand the music slot back to when they end (`backToBase`; on the grounds, `null`, they fade to
  silence as before). An area entered while the hat's theme plays waits for it to end. Going
  back to the grounds (no music) stops only an area's loop (`AREA_TRACKS`: `castle_hall`,
  `skerries`, faded out over 1.2 s), never the arrival cue, the game-over jingle or the title.
* **Ambience**: the area's profile (`ambience.js` `PROFILES`, `setProfile(name, fade, spots)`,
  over 1.2 s; unknown names are the grounds'). `'grounds'` has everything. `'hall'` fades the
  pastoral bed out under a low room tone (low-passed noise), stops the birds, the distant
  chorus, the waterfall and the moat laps, and crackles a fire (`fire_crackle`) at `fires` (the
  hearth) every 0.15–0.55 s. `'sea'` keeps the air bed's low air layer (the wind) and fades out
  its two leaves layers (`leaves: false`: they have a fader of their own under the bed's), laps
  waves at `seaLevel` every 0.5–1.3 s on open water only (`isWater`; `seaLap`: the first of 8
  random spots round the listener that is water, each tried within a wider circle, 900 out to
  `LAP_RANGE` 3500): out on the water within 900 all round him, from over an island off its
  shore, farther off and quieter (on Home Island's meadow about half as many), none from dry land
  all round or from high up (beyond `LAP_RANGE`); and it calls a gull (`gull`) every 4–10 s from
  a point on one of the `gulls` circles, nearer circles far more often (none beyond 12000: the
  next call waits until one is in range, then comes at once); no tree birds, chorus, waterfall
  or room tone. The pastoral bed plays only where the profile has it and not in AI RACE. The
  profile and spots already in force change nothing (`setProfile` returns at once).
* **Reverb**: with `reverb` (the hall) every sound effect's voice also feeds the shared hall
  reverb (`hallReverb`) through one send (`roomSend`, 0.25 of it), except those that send into
  it themselves (`SFX_INFO` `hall`: the doors); the ambience bus never does.
Everything an area sets before the context exists (its profile and spots, the reverb, its loop,
queued like any loop) applies when the context is made.

## HUD / title (`src/ui/*`)

```js
const hud = new HUD(uiRootElement, { events })  // subscribes to 'coin' (red-coin numbers use coin.index)
                                                //   and 'cannonView' (the cannon's reticle)
hud.update({ lives, coins, stars, health, showPower, breath, paused }); hud.setPaused(bool)
hud.setVisible(bool)          // hidden behind the title (hud.visible; hidden HUDs skip repaints)
hud.setCourse(areaName)       // the pause screen's course name (hudLogic.js COURSE_NAMES)
hud.setLeave(bool)            // its "Leave course" line (main: as the game pauses, canLeave())
hud.showCourse(areaName)      // the course card (a course's first entry in a game)
const wipe = new ScreenWipe(uiRootElement)   // before the HUD; see "Areas and transitions"
hud.setViewport(rect | null)
const title = new TitleScreen(uiRootElement, { events, audio }); await title.show()  // can be shown again
title.setViewport(rect | null)
const face = new FaceScreen(uiRootElement, { events, audio, view }); await face.show()  // "Face screen"
const card = new GameOverCard(uiRootElement).show()  // dark screen + gold GAME OVER, fades in
new AlertBanner(uiRootElement, { events })   // AI RACE: 'darkMode' on, the meltdown's warning (30 s)
card.setViewport(rect | null); card.remove(); card.shown   // remove() at once; show() again ok
```

The pause screen names the course Jonas is in (`drawPauseScreen(..., { course, leave })`, from
`hud.setCourse`, which AreaSwitch calls on every switch): `COURSE_NAMES` = CASTLE GROUNDS, THE
GREAT HALL, MIDSUMMER SKERRIES (all in `BIG_STRINGS`). In a course whose way out (`def.leave`)
can be taken as the game pauses (`hud.setLeave(areas.canLeave())`: not while Jonas dies or drops
in; a sign he is reading closes as he leaves) a gold `J  Leave course` line (`leaveLine(kind)`:
`LEAVE_KEYS` J on the keyboard, B on a pad, a Switch-style pad and the touch controller: the
game's attack button) sits in the gap between PAUSE and the controls panel (`pauseLeaveRect`:
`pauseY + LEAVE_Y` (23), SMALL_FONT, centred; the stack and the legend are unchanged); B there
unpauses and leaves (main's tick). The touch controller keeps its B button bright over the
faded landscape overlays while the line shows (`'pause' { leave: true }`).
`hud.showCourse(area)` puts up the **course card**: the name in gold BIG_FONT at twice the HUD's
size (`COURSE_CARD`; `courseCardScale`: less if it would not fit with 6 px to spare, which no
course name needs on the narrowest, 320-wide screen) across the upper middle of the picture for
75 game ticks, sliding in from the right and out to the left (`courseCardOffset`); it counts in
`update()` while not paused and is not drawn over the pause screen, and the next `setCourse`
(a switch, GAME OVER's return) takes one still up away. It draws over the wipe (the HUD's
canvas lies above it), so it shows while the iris opens on the course.

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
start key/button is released as well. The title card has no phone button: P opens the phone
panel (see "Phone controller").

**Game choice** (`ui/ChoiceScreen.js`, `ui/raceChoice.js`): the first screen, before the title
card (main's `runTitle`, over the same slow orbit of the grounds; not with `?skipTitle` /
`?test`, nor with `?face=1` on the first visit, which skips the title card). CHOOSE YOUR GAME
(BIG_FONT, gold) over two stacked options, WITH AI RACE and WITHOUT AI RACE (`RACE_CHOICES`,
BIG_FONT, the picked one gold in a framed box, the other dimmed white), a SMALL_FONT line under
them saying what the picked one means (`about`), and the prompt at the bottom ("Up / down to
choose · Enter or Space to play"; on touch screens "Tap a choice to play"). Picking: up / down or
left / right (arrows, W / S, A / D; Tab switches; `choiceForKey`), or a gamepad's d-pad / left
stick (a fresh push): `sfx 'menu_move'` and `'aiRaceChoice' { on }`. Playing: Enter / Space /
Esc, gamepad Start or a face button, the phone's or the touch controller's START / A; a click
or tap on an option picks and plays it (the touch controller covers the screen, so its
`'touchPress'` carries `x, y` and the screen hit-tests its options). A key or click also unlocks
audio (a gesture), so the title card then plays its music and asks for Start at once; then
`sfx 'menu_select'`, a 0.3 s fade, and `show()` resolves with `{ aiRace }` once the press is
released (the title card never sees it). Main answers each `'aiRaceChoice'` with
`objects.setAiRaceButton(on)` (the button appears or vanishes behind the screen at once) and
saves it (`saveRaceChoice`, `localStorage['castleGrounds.aiRace.v1']`); at load it applies
`loadRaceChoice()` (with, by default), also with `?skipTitle`. Without the button nothing can
start AI RACE (its robots, Rustmaw, the meltdown); `__game.setDark(on)` still can, for tests.

## Recorder (`src/ui/Recorder.js`, `src/ui/recordLogic.js`)

V and 9 record the game as a video file that plays on a phone in Full HD: always exactly
1920x1080 (16:9, V, landscape) or 1080x1920 (9:16, 9, portrait: Instagram Reels and Stories),
up to 60 fps, with the game's sound, whatever the window's size and shape.

```js
const recorder = new Recorder({ view, uiRoot, audio })   // main; listens for V and 9 itself
recorder.toggle(shape?); recorder.start(shape = 'landscape' | 'portrait') -> boolean
recorder.stop(reason?) -> Promise<saved | null>
recorder.recording, .shape ('landscape' | 'portrait' while recording, else null), .format
  ({ mimeType, ext, video, audio }), .compositor (while recording: .canvas, .drawn: the UI
  elements painted in the last frame, .stats), .last ({ name, type, size, url, seconds,
  reason, shape }; url is revoked after 60 s), .note ({ kind, lines } while a message shows),
  .dispose()
REC_SHAPES.landscape / .portrait   // { key, width, height, aspect, zoom, label, suffix } (recordLogic.js)
```

* **Keys** (`shapeForKey`): V starts a landscape recording, 9 a portrait one; while one runs,
  either key stops it (not with Ctrl/Cmd/Alt, not on key repeat). It also stops and saves at the
  safety limit (`REC.maxSeconds`, 10 minutes) and when the page is hidden; on `pagehide` the
  chunks so far are saved at once. The pause legend has `['V / 9', 'Record 16:9 / 9:16']` (one
  row, so the narrow legend still fits a 4:3 screen).
* **Guards** (`recordSupport`): inside an iframe (the claude.ai artifact page is sandboxed and
  blocks downloads) V and 9 show a note instead ("Video recording is not available here / It works
  when the game runs on your own computer / (npm run dev or npm run preview)"); without
  `MediaRecorder` / `canvas.captureStream` or any recordable type, "not supported in this
  browser".
* **Framing**: `view.setCapture({ aspect, minHeight: height, zoom, label })` from the shape
  frames the picture 16:9 or 9:16 in the window (the 4:3 pillarbox code with another aspect:
  bars as needed, so portrait in a wide window is a centred column; `alignOverlay` keeps the UI
  root on the picture) and raises the pixel ratio until the drawing buffer is at least 1080 /
  1920 px tall (`frameLayout`). Retro mode keeps 240 lines along the picture's short side
  (`frameLayout`'s `lines`: 427x240 landscape, 240x427 portrait instead of a 135-pixel-wide
  sliver); only the upscaled output grows. Portrait also sets the world camera's
  `zoom` to `REC_SHAPES.portrait.zoom` (0.75): at the game's 45 degree vertical field of view a
  9:16 picture is only 26 degrees across, zoomed out it is about 58 x 35 (the camera logic keeps
  its own `fov`; `Effects` sizes its streaks by `camera.getEffectiveFOV()`). `setCapture(null)`
  on stop brings the 4:3 / full-window setting, the pixel ratio, the retro lines and zoom 1
  back; the 4:3 setting itself is never changed (F3/4 while recording applies afterwards); F2/R
  works as usual. F1 shows "16:9 rec" or "9:16 rec". The HUD, pause screen, dialog box and AI
  RACE banners already lay out for tall pictures (the HUD scales by width below 4:3).
* **Compositing** (`Compositor`, from `view.setFrameHook`, i.e. right after each `view.render()`
  while the WebGL buffer is valid; no `preserveDrawingBuffer`): one reused 2D canvas of the
  recording's size:
  the WebGL canvas (it is the picture rect) scaled to fill it, then every element under the UI
  root in paint order (the root's children by z-index, then tree order) at its
  `getBoundingClientRect()` relative to the picture (`mapRect`): canvases (smoothing off for
  pixel art: `image-rendering: pixelated` or drawn 1:1 in device px; on for CSS-stretched ones
  like the title logo) and the CSS-only visuals: background colours (the GAME OVER card's
  dimming, the face screen's curtain, the phone panel), `radial-gradient` backgrounds redrawn as
  canvas gradients (`parseRadialGradient`, farthest-corner ellipses: the AI RACE alert's red
  vignette, blinking with its `visibility` animation, and the title card's), rounded corners and
  borders, and the title logo's `drop-shadow` (canvas shadow). Computed `display`, `visibility`
  and the product of the ancestors' `opacity` are honoured each frame; DOM text and box shadows
  are not drawn. The element list (with live computed styles) is rebuilt only when a
  `MutationObserver` on the UI root sees the DOM change; a frame allocates nothing but the
  DOMRects. Its own REC indicator and notes live in a fixed root on `document.body`, outside
  the UI root, so they are never recorded.
* **Stream**: `compositor.canvas.captureStream(60)` plus the audio tap's track
  (`audio.captureStream()`: a `MediaStreamAudioDestinationNode` on the master bus, parallel to the
  speakers; none while muted or before audio exists: the video is silent). Compositing, the
  canvas stream and the MediaRecorder only begin `SETTLE_FRAMES` (3) animation frames after the
  framing change (the first composite is in the frame hook, then `_record` opens the stream
  and starts the MediaRecorder): the HUD and the other overlays re-lay out through
  ResizeObservers and redraw on their next frame, and a frame painted before that (the old HUD
  squeezed into the new shape) could still be in the capture pipeline when the MediaRecorder
  starts, opening the video (and its cover frame) on it. Stopping during those frames saves
  nothing ("Recording failed: nothing was saved").
* **Format** (`pickFormat(MediaRecorder.isTypeSupported)`, `REC_FORMATS`): MP4 H.264 (High, Main,
  Baseline at level 4.2) + AAC; MP4 H.264 + Opus (Chrome on Linux has no AAC encoder); WebM
  VP9 or VP8 + Opus; the plain `video/mp4` / `video/webm`. 16 Mbit/s video, 192 kbit/s audio, a
  chunk every second (`REC`). Playwright's headless Chromium (no H.264) records WebM VP9 + Opus.
* **Saving**: a Blob of the chunks, an object URL and a temporary `<a download>` click:
  `castle-grounds-YYYY-MM-DD-HHMM.mp4|webm`, portrait `...-HHMM-portrait.mp4|webm`
  (`recordFileName`, local time at the start), then a note "Saved <file>" (plus "Stopped at
  the 10 minute limit").
* **REC indicator**: a blinking pixel red dot and "REC mm:ss" (SMALL_FONT, the HUD's scale) in the
  window's lower-right corner. All recorder texts are in `REC_SMALL_STRINGS` (glyph coverage).
* **Cost**: while not recording nothing runs but the key listener (the renderer's hook is null).
  While recording: the bigger drawing buffer (1080 or 1920 lines), one full-frame drawImage plus
  one per visible UI canvas, and the browser's encoder.
* **Tests**: `tests/recorder.test.js` (pure parts: both shapes' framing in many windows, the
  portrait field of view), `tests/recorder-browser.test.js` (E2E=1: V in play, the download is
  a 1920x1080 video with sound whose frames, the first included, show the HUD, the framing is
  restored; 9 the same at 1080x1920 with the zoom and the retro columns, no recorded frame
  with a HUD bitmap from the old shape, stopped by V, all restored; the iframe refusal;
  `REC_OUT=<dir>` keeps the files and PNGs of their first frame and of one at ~0.8 s).

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
top of the keep), with original text. Other areas list theirs in their own layout (the Great
Hall's and Midsummer Skerries' `SIGNS`, each with its `y`, drawn by their builders with the same
`props/decor.js` `addSignpost`; `player.setWorld` hands Jonas the current area's). Reading works
like the classic games:

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
  retiring it.) Past the meltdown's point of no return (53 s, all white, see "Meltdown") the button is dead
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
meltdown.seconds, .doomed (from 53 s: all white), .running, .levels (the look, below)
levelsAt(seconds), lightAnchor(x, y, z, yaw), placeOrb(light, anchor, out)   // pure helpers
```

* **Clock**: starts at 0 when AI RACE mode turns on (`'darkMode' { on: true }`) and counts only
  in `update()`, which main calls only while playing (not paused, not on the title or the
  game-over card). The mode turning off before the picture is all white (pounding STOP,
  Rustmaw's defeat, a game over or new game) cancels it (`'cancelled' { warned, from }`: the
  world is rescued; whatever of the warning glow, the burning sky, the embers, the light and the
  white-out already shows fades back out together over 1.5 s, 2.5 s once the sky burns, and the
  trees it set alight die down); turning AI RACE on again (after a Rustmaw defeat: STOP retires
  the button) starts a fresh 40 s. From 53 s (all white) nothing cancels it but a game over:
  `setMode(false)` is ignored, main keeps the mode on
  (it ignores `'aiRaceButton' { on: false }` and `'bossDefeated'`), the button's cap light dies
  and pounds on it do nothing (`AiButton.setDead`, from ObjectManager on `'meltdown' { phase:
  'white' }`, with a fizzle; `objects.reset()` revives it).
* **Timeline** (`MELTDOWN`, seconds on the clock):
  * 30 `'warning'`: the AlertBanner shows WARNING! / THE SKY IS OVERHEATING / STOP THE AI RACE!
    (`hudLogic.js MELTDOWN_WARNING`), blinking to the very end (gone on `'cancelled'` or
    `'white'`); a klaxon (sfx
    `meltdown_klaxon`, two rising whoops) every 1.5 s until the light; the storm sky glows
    red-orange up from the horizon (the sky's `meltWarn`), the fog takes a red haze and the grade
    a share of the fire tint, stronger and stronger toward 40 s.
  * 40 `'fire'` (STOP still rescues the world): the sky dome turns to roiling flames (its shader:
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
  * 53 `'white'`, the point of no return: the whole picture is white; the roar collapses into a
    high, fading ring (`meltdown_ring`); the button dies.
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
  rain); +2 draw calls and ~200 triangles while the light shows. Measured from the spawn in a
  run from the mode's start: 73 draw calls at 38 s (12 server halls out), 76 and ~175k
  triangles at 48 s (17 out, the light showing); two of those calls are the castle door's
  leaves (71 and 74 with them hidden).
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
  mode from the spawn with all 29 planned units out (sent in at once, 10 s into the race): 72
  draw calls and ~163k triangles, against 67 and ~153k in the same view 3 s in with none out
  yet; two of those calls are the castle door's leaves (70 with them hidden).

## Winged hat, minions, castle door, touch controller

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
* **Castle door** (objects, `src/objects/Door.js`, `CastleDoor.js`): a `Door` is a trigger in
  front of a door's face: `new Door({ id, x, z, yaw, width, floorY, to, entry, kind, locked,
  sealedSign, laugh, events })` (x, z: the middle of the face; yaw: the way it looks, so Jonas
  walks in facing yaw + π; `to` null: locked). Walking up to it (in front of the face within
  `DOOR.REACH` 200, within `SIDE_MARGIN` 60 past either side, feet from 60 under its floor to
  260 over it, facing it within 60° or pushing against it; never while flying, reading, dying or
  dropping in) triggers it once. An **open** door plays its sound (`OPEN_SFX` by kind:
  `door_open`, the creak and latch; the bottle's mouth `bottle_dive`) and emits
  `'warpRequest' { to, entry, kind, from: door }` (AreaSwitch takes Jonas through it; see "Areas
  and transitions") and re-arms once he is off its apron (`APRON` 60 past the trigger, in front
  and at the sides), so he can walk straight back in. A **locked** one, or an open one while
  **sealed** (AI RACE), plays sfx `evil_laugh` (when `laugh`; else `door_rattle`, its handle
  tried in its frame: the hall's unbuilt doors) and shows its sign through
  `events.emit('signRead', { sign })` (a fresh copy each time); it re-arms once he has walked
  more than `REARM` (500) away. The castle's front door (`CastleDoor`, a Door facing +Z: its
  face and porch come from the collision world) opens into the Great Hall (`CASTLE.enter`);
  sealed it says `CASTLE_SEALED` ('The castle door is sealed shut...' / 'The storm has sealed
  it!' / 'Stop AI RACE and it will open again.', the mode's name on a short page so the box
  never splits it); without `enter` it is locked with `CASTLE_LOCKED` in both modes. Jonas is
  frozen while a dialog is up (main); `player.endReading()` is safe when he wasn't reading. No
  allocation per tick (the yaw's sine and cosine are worked out once).
  **Its leaves swing** (the castle's look, `castle/building.js` `door(kit, frame, width, height,
  { passage })`): the two leaves are built apart, each a plank slab with its iron and ring, and
  `doorLeaves()` makes them meshes of their own (`castle-door-left` / `-right`, sharing the
  castle wood's material and storm grade, the geometry baked where it stands shut and set about
  its hinge) that turn into the wall (1.4 rad standing open, eased) onto a dark passage behind the
  opening (`castle-doorway`, 260 deep, drawn only while the door stands open); the hall's front
  face is cut round the opening (`castle/geom.js` `openingPolys` with `doorContour()`), and the
  collider still fills the arch, so the door is solid however its leaves stand. The castle part's
  `setDoorOpen(t)` (0 shut .. 1 open) swings them; AreaSwitch drives it through a warp (see
  "Areas and transitions"). The castle now has 10 meshes: +2 draw calls wherever the door is in
  view (56 from the spawn, 54 before), the passage one more while it stands open. The hall's
  unbuilt doors stay one with the wall (`door()` without a passage).
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
  status, opened with P on the title or the pause screen (the pause legend's P row is also a
  click target; the title card has no phone button); a small badge
  while a phone is connected.

## Objects (`src/objects/ObjectManager.js`)

```js
new ObjectManager({ scene, collision, events, layout, player, fx, level, area? })  // fx/level: AI RACE fireballs
                                            // area: the area's name for 'starCollected' (default 'grounds')
objects.update({ player, frame, camera })   // 30 Hz: collection, AI
objects.animate(time, alpha, threeCamera)   // render: spin, billboards
objects.reset()                             // new game: every pickup back (see below)
objects.ambient(time) -> alpha              // title backdrop clock (animate() calls it itself)
objects.started                             // an update() ran since construction / reset()
objects.setAiRaceButton(on)                 // the title's game choice: false = no AI RACE button
                                            // (AiButton.setPresent: 'gone', colliders parked; kept by reset())
objects.enter(player)                       // the hero was just placed in this area (see below)
objects.door, objects.doors                 // the castle door (or null); every door (Door.js)
```

`enter(player)` (an arrival): the hero's remembered last tick is dropped (`hero.valid`, so no
stomp or box bump is read from a tick in another place), a dialog flag left up is cleared, and
every door he stands within the re-arm range of (`Door.near`: its apron, or REARM after a
message) is disarmed (`disarm()`), so it waits until he has walked away instead of going off
where he arrives.

Doors (`objects.doors`: the castle's `objects.door` first, then one `Door` per `layout.DOORS`
entry, see "Castle door"): every tick `door.update(player, sealed)` with `sealed = modeOn ||
darkT > 0` (AI RACE on or still fading out); `reset()` re-arms them all.

`reset()` (always present; main calls it after GAME OVER, before the title): all yellow and
red coins come back (red count 0), the star is hidden until the next full red set (a placed
one is back on its spot), the 1-up gem returns, live sparkles vanish, and the star it awarded
is taken back off `player.stars` (so is Rustmaw's reward star, `BossStar.js`, which can then be
won again).
The tick clock keeps running (birds and butterflies carry on where they are).

`ambient(time)`: until the first `update()` (and again after `reset()`), `animate()` drives the
objects' tick clock from the caller's `time` (seconds) through `ambient()`: ambient ticks only
(butterflies wander, birds circle, sparkles twinkle; no pickups, run against an out-of-reach
stand-in hero), catching up at most `MAX_STEPS_PER_FRAME` ticks per call and returning the
alpha into the latest tick. Play then carries on from that clock without a jump. So the title
loop just calls `objects.animate(t, 1, camera)`; no stand-in hero is needed in main.

Yellow coins (1), red coins (2, collect all 8 → star appears at `STAR` with a jingle),
the star (touch → `player.collectStar()`; `STAR.placed: true` puts it idle on its spot from the
start instead, `Star.place(target)`, with no red coins needed: a course's star; `reset()` puts a
placed star back there, taking it off `player.stars` as usual; `STAR.id` names it in
`'starCollected'`), the hidden 1-up gem (`layout.ONE_UP`, emits `oneUp`), butterflies
(`new Butterflies(BUTTERFLY_SPOTS, { collision, groundAt, rng, waterTop })`; optional
`waterTop` (default `Infinity`) is the highest water surface anywhere, so the water query is
skipped over floors above it; ObjectManager passes `layout.WATER_LEVEL`) and
circling birds (`new Birds(BIRD_CIRCLES, { collision, rng, tint })`, circles `{ x, z, y, radius
}`; `tint`, from `layout.BIRD_TINT`, colours the flock's bodies, their wings a shade darker: a
course's white gulls; without one the grounds' dark birds).
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
| `starCollected` | `{ pos, id, area }` (`id`: `layout.STAR.id` or `null`; `area`: the ObjectManager's `area`, `'grounds'` by default); Rustmaw's reward star sends `{ pos, boss: true }` | objects (audio plays the fanfare; AreaSwitch lights a course's lamps and takes him out through its star exit) |
| `lifeLost` / `oneUp` | `{}` | player / objects (main counts lives; audio plays sfx) |
| `pause` / `unpause` / `gameStart` / `gameOver` | `{}` (`pause`: `{ leave }`, the course's way out is offered) | main (audio consumes all four: ducks, menu-track stop, unlock, `game_over` jingle; the touch controller keeps B bright on `pause` `{ leave: true }`) |
| `signRead` | `{ sign }` (a `layout.SIGNS` entry) | player (B in front of a sign); the dialog box opens |
| `aiRaceButton` | `{ on }` | objects (the button was ground-pounded); main toggles AI RACE mode |
| `darkMode` | `{ on }` | main; audio, UI banner, objects and the meltdown react |
| `meltdown` | `{ phase, seconds }`: `'warning'` (30 s), `'fire'` (40 s), `'light'` (46 s), `'shock'` (the shockwave passing the camera), `'white'` (53 s, the point of no return), `'over'` (54 s: main ends the game), or `'cancelled'` `{ warned, from }` (the mode turned off before the white-out: the world rescued) | the Meltdown (`fx/Meltdown.js`); the banner, audio and objects (the button dies) react |
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
| `warpRequest` | `{ to, entry, kind, from }` (`kind`: the Door's, `'door'` or `'bottle'`; `from`: the Door) | objects (an open door was walked into); AreaSwitch runs the transition (or refuses it). AreaSwitch's own transitions emit nothing: they show as `areas.warp.kind` / `snapshot().warp.kind` `'leave'` (`leave()`) and `'star'` (the star exit) |
| `areaChange` | `{ from, to, entry, audio }` (area names, the entry id, the new area's `Area.audio`: its `def.audio` in world coordinates and its water test) | AreaSwitch (the switch, see "Areas and transitions"); audio changes the music, the ambience and the reverb (`setArea`) |

Standard sfx names: `jump, double_jump, triple_jump, backflip, sideflip, long_jump,
wallkick, dive, ground_pound, ground_pound_land, punch1, punch2, kick, jump_kick, land,
land_hard, skid,
bonk, hurt, ledge_grab, climb, swim, splash, water_exit, coin, red_coin, star_appear,
star_get, one_up, pause, menu_select`, plus `footstep, life_lost, unpause, camera_move,
camera_buzz`, the title's `menu_move` (its game choice moved), and the dialog box's
`dialog_open, text_blip, dialog_next, dialog_close`, and
AI RACE mode's `button_press, alarm, kaiju_roar, fireball_charge, fireball_launch,
fireball_explode, fireball_fizzle, tree_ignite, burn, fire_crackle, steam, thunder`, and the
cannon's `cannon_enter, cannon_turn, cannon_fire, cannon_whoosh`, the doors' `door_open` (as
their leaves start to swing) and `door_close` (AreaSwitch, as the leaves meet behind him) and the
hall's unbuilt doors' `door_rattle` (all sent into the shared hall reverb,
`SFX_INFO` `hall`), the bottle mouth's `bottle_dive` and the hall's `bottle` entry's
`bottle_pop` (AreaSwitch, as the wipe opens on it), the skerries' `gull` (played by the `'sea'`
ambience itself, not through `'sfx'`), and Rustmaw's tail grab's
`tail_grab, boss_haul, boss_whoosh, boss_throw, boss_slam, boss_crash, boss_splash`
(`boss_whoosh` once per whirl turn, its `pitch` rising with the spin), AI RACE's meltdown's
`meltdown_klaxon, meltdown_ignite, meltdown_flash, meltdown_blast, meltdown_ring`, and the face screen's
`face_grab, face_stretch, face_boing, face_boop` (with `pitch`, `volume` and `pan`).
Unknown names must be ignored silently.

## Tooling

* `npm run dev` — dev server. `npm test` — node unit tests (`tests/**/*.test.js`).
  `npm run build` — production build into `dist/`: the game as one bundle by design (1,498,506
  bytes, ~480 kB gzip, plus the ~13 kB title-logo worker; the size warning limit is 1500 kB,
  `GAME_CHUNK_LIMIT_KB` in `vite.config.js`), then the phone's `pad.html` built separately into
  the same folder (~85 kB, its own copy of the touch controller and protocol). `npm run
  preview` serves it with the phone relay.
* `node tools/shot.mjs --url "/preview.html?m=<area>&cam=x,y,z&look=x,y,z" --out shots/x.png`
  — headless screenshot of a preview page (prints browser errors).
* `node tools/shot.mjs --url "/?test=1" --actions '[{"step":30,"input":{"stickY":1}},{"shot":"shots/a.png"},{"eval":"__game.snapshot()"}]'`
  — scripted full-game run. Actions: `{step, input}`, `{eval}`, `{shot}`, `{wait: ms}` (for
  real-time runs such as `/?skipTitle=1`).
* `/preview.html?m=world` shows the whole level without the player; `/preview.html?m=castle`
  the castle alone (`&col=1`, `&door=0..1` its front door that far open); `/preview.html?m=hall`
  the Great Hall alone (`&col=1` its colliders, `&view=entry|bottle|fire|roof`, `&lamp=1`,
  `&door=0..1`); `/preview.html?m=skerries` Midsummer Skerries (`&col=1`, `&lit=1`,
  `&view=arrival|skerries|islet|gallery|bay|east|chimney|bridge|meadow|wreck`).
* `node tools/shot.mjs --url "/?test=1&mute=1&area=skerries" --actions '[{"step":60},{"shot":"shots/arrival.png"}]'`
  — the game straight in an area (`&entry=` for another of its entries; `__game.enterArea(name,
  entry)` switches at once mid-run). More recipes:
  * the castle door swinging open as the iris closes: `--url "/?test=1&mute=1" --actions
    '[{"eval":"__game.player.teleport(0,300,-460,Math.PI);__game.player.setAction(\"idle\");__game.camera.reset(__game.player)"},{"step":10,"input":{"stickY":1}},{"shot":"shots/door.png"}]'`
    (and standing open behind him on the porch: `?area=hall`, walk south into the inner door,
    shoot a few ticks after the switch);
  * the hall from its landing, the bottle and its model behind him: `--url
    "/?test=1&mute=1&area=hall&entry=bottle" --actions '[{"step":20},{"shot":"shots/bottle.png"}]'`;
  * Jonas shrinking into the bottle: `--url "/?test=1&mute=1&area=hall" --actions
    '[{"eval":"__game.player.teleport(0,550,-61100,Math.PI);__game.player.setAction(\"idle\");__game.camera.reset(__game.player)"},{"step":20,"input":{"stickY":1}},{"shot":"shots/shrink.png"}]'`;
  * the lit lighthouse: `--url "/?test=1&mute=1&area=skerries" --actions
    '[{"step":60},{"eval":"__game.areas.current.setLit(true)"},{"step":30},{"shot":"shots/lit.png"}]'`
    (or win the star: teleport onto the gallery beside it, see `tests/areas-browser.test.js`).
* V in the game (run locally) records a 1920x1080 video with sound, 9 a 1080x1920 portrait one
  (see "Recorder"); `E2E=1 REC_OUT=<dir> node --test tests/recorder-browser.test.js` keeps the
  test recordings and PNGs of their frames.
* `/preview.html?m=fx&melt=48` holds AI RACE's meltdown at 48 s (sky, grade, embers, the light).
* `/preview.html?m=face` shows the face screen alone (Start shows it again); scripted pulls for
  shot.mjs: `{"eval":"__face.pointer('down', 0.6, 0.55)"}`, `{"eval":"__face.pointer('move',
  0.8, 0.6)"}`, `{"wait":500}`, `{"shot":"shots/pull.png"}` (see the preview's header).
* Requirements: Node.js 20.19+ or 22.12+ (Vite 8); `tools/shot.mjs` and the browser tests
  (`E2E=1 npm test`) need Playwright's Chromium (`npx playwright install chromium`).
* `index.html` carries the tab icon inline (Jonas's HUD face, `ICONS.hero` from
  `src/ui/icons.js`, with the HUD's 1-pixel outline, as an SVG data URI: regenerate it from the
  icon's rows when the icon changes), so no `/favicon.ico` is requested.
