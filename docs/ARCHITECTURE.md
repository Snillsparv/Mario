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
  areas.objects.update({ player, frame, camera, warping: areas.busy })   (the current area's
                                          objects; a warp running holds the critters' strikes)
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
| Great Hall | `src/world/hall/*` (layout, builder `hall.js`, its parts `plan.js`, `shell.js`, `features.js`, `bottle.js`, `light.js`, textures) | WorldPart, built by `area.js` |
| Midsummer Skerries | `src/world/skerries/*` (layout, build, lighthouse, east, props, houses, sea, textures) | WorldParts, built by `area.js` |
| Sparrow Lane | `src/world/lane/*` (layout, build, houses, props, door, textures; `real/*`, its realistic look: `look.js` on the main thread, `plan.js` and `spots.js` shared with the classic build, the worker's builders `detail.js`, `geo.js`, `house.js`, `villas.js`, `cars.js`, `foliage.js`, `grass.js`, `garden.js`, `street.js`, `extras.js`) | WorldPart, built by `area.js` |
| Realistic look | `src/render/real/*` (RealLook, OutputPass, sky, materials, probe, tier, RealAreas, textureStore, texCache, the worker `laneRealWorker.js`, `texgen/*`) | RealLook, RealAreas (see "Realistic look (Sparrow Lane)") |
| Critters | `src/objects/Critters.js`, `src/objects/critters/*` (a kind's steps each), `src/objects/critterModel.js` | Critters, built by ObjectManager (see "Critters") |
| Trampolines | `src/objects/Trampoline.js` (the spring only: its course draws it) | Trampolines, built by ObjectManager (see "Objects") |
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
  setDoorOpen?(t, id),                         // its swinging door named `id`, 0 shut .. 1 open (the
                                               // castle's front door; in the hall its inside,
                                               // 'hall_front', or the east door to Sparrow Lane,
                                               // 'hall_east_2'; the lane's 'lane_home': "Areas"); a
                                               // part with one door swings it whatever the id
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
inside the castle, `world/hall/*`), `'skerries'` (Midsummer Skerries, the first course,
through the ship in the bottle, `world/skerries/*`) or `'lane'` (Sparrow Lane, the second
course, through the hall's east door with the little house on it, `world/lane/*`); the hall and
the courses are built the first time he goes in and kept for the session.
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
  entries: { front: { x, y, z, yaw, walkIn, door }, bottle: { x, y, z, yaw, drop, camYaw } },
                                       // door: the id of the swinging door he comes out of
                                       // there (it stands open as he arrives, then shuts)
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
objects, update(time, camera), reset(), setVisible(on), setDoorOpen(t, id), setLit(on) }` (the
last two hand on to its parts' own, see "World parts"), everything in world coordinates
(`audio`: `def.audio` with its sound spots shifted and its `seaLevel` raised by the origin,
plus `isWater(x, z)`, whether there is open water there (the water's surface above the floor,
so not on a rock, the jetty or a beach above the waterline: the sea's laps); the grounds' is
their `def.audio` as it is):
`objectsLayout` is what an ObjectManager reads (COINS, RED_COINS, SIGNS, STAR, ONE_UP, DOORS,
BUTTERFLY_SPOTS, BIRD_CIRCLES, CRITTERS, TRAMPOLINES shifted, BIRD_TINT as it is, and
`groundHeight(x, z)`, the floor
under a point probed from `probeY`, so a coin's shadow never lands on the roof), `respawn` the
entry `def.respawn` names with its drop (player.setWorld's spawn), `waterFn` the collision
world's water (the renderer's, per area).

Rules for areas:
* **Far apart**: the hall's origin is (0, 0, −60000), Midsummer Skerries' (60000, 0, 0), Sparrow
  Lane's (−60000, 0, 0). Separate
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
* **Rooms for the camera**: a room's shell is convex with no inside corners (the hall: a nave
  into a half-round apse, its south corners rounded), so the follow camera slides round it
  instead of catching in a corner. Curved walls are flat facets that shade round (smooth
  normals) and collide as radial wedges from each facet out to well behind it (to the radius
  + 1300), so no pocket of air is left behind them. The plan's own test, `hall/layout.js`
  `inPlan(x, z, pad)`, is the samplers' authority (the tests' room bounds, the closed-room and
  headroom grids). Decoration with no collider of its own stands at most 56 out of the surface
  behind it (the camera keeps 60 off the walls): deeper parts get a collider (the list is under
  "The Great Hall"; `tests/hall.test.js` checks every trim, paint and panel vertex near the
  walls).
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

**Doors swing, Jonas shrinks.** Through a door (`kind 'door'`) its leaves swing
(`Area.setDoorOpen(t, doorId)`, 0 shut .. 1 open, eased by the part; an area may have more than
one swinging door, and the one named swings: the castle's front door on the grounds (`'castle'`,
its only one), in the hall its inside (`'hall_front'`) or the east door to Sparrow Lane
(`'hall_east_2'`), both `castle/building.js` `door()` with a passage, see "Castle door", and in
the lane the dad's front door (`'lane_home'`, one leaf, `lane/door.js`). AreaSwitch names the door
he walks into (`warp.from.id`) until the switch, then the one his entry names (`entry.door`; an
entry with none, the porch, leaves it to the part's own); the star exit and the leave swing
none): the door he walks into opens from shut as the wipe closes (`t /
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
never through a door; jumping at the mouth, the real model's shadow staying on the dais's top as he
shrinks in the air); the lamps (the course's star
lighting its lighthouse and the hall's at once, an area built later coming lit, GAME OVER
putting them out, nothing lit by Rustmaw's star or another area's); and Midsummer Skerries: into
the bottle's neck (its sound, the iris) to the drop-in onto the jetty with the camera behind
him, the course's look and sky, its card once a game; the real star's exit back out of the
bottle onto the hall's dais exactly 20 ticks after the dance, one star up, popping out with
`bottle_pop` as the fade opens, a stick held on from the course waiting to be let go and a fresh
push then walking him straight back into the armed bottle, the star staying taken; the pause
screen's leave (open while he reads a sign, which it closes; not while he drops in or dies;
main's pause toggle and paused branch in order); a life lost there; GAME OVER from it (main's
order, the star, the coins and the lamp back)); `tests/areas-browser.test.js` (E2E=1: the iris
over the picture and under the HUD, setDark ignored mid-warp and in the hall, the hall's picture
and draw calls (also from the dais's top), the hall's textures at most 128 px, the pause course
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
as `buildArea` places it with the real Player, camera and objects: the budgets (at most 16
meshes, under 26k room triangles and 1.5k collider triangles, built in under a second; the
hall's own objects at most 8 meshes too), a closed room (sampled with 12 seeds on the plan
(`inPlan`), outside the furniture; and at head height every ray out from the middle stopping at
the round walls, a column, the buttress or the chimney breast), no floor under less than
`HEADROOM`, 11 spam runs that never take Jonas or the camera out of it and trap the camera at
most 80 ticks in all (35 a run), the entries' footing and framing (the walk from the front door
up the dais's steps never trapping or hiding the camera), 17 walks round the bottle in the apse,
along the round walls and by the furniture and C-button swings from 28 spots (the apse's flanks
beside the stand, under the glass, among them), each with him facing 8 ways, that never trap the
camera or take it into a solid, two walks from the apse's east flank into the books' north side
(the camera, its view cut off by the books, turning round the bottle's neck, never into the
glass), stepping off the dais's back (a drop like the old landing's: the camera loses him until
its remedy turns it, at most 30 trapped and 45 occluded ticks a step) and jumping off its top's
back corners (not at all), the routes (the books up to the cork with their coins, wall kicks up the slot with its coins, the
banner pole onto the buttress for aims up to 15° off, staying up there, the hop onto the mantel
to the 1-up), signs read from the front only, every coin over a floor, the doors' triggers on
their faces, the bake on its pure functions (the floor darker along the walls and warmer by the
fire, the east wall at least 1.19 times the west's, the apse side's fill on the south wall, the
vault warm) and as baked into the floor (warmer before the fire than in the nave, whose middle
is not clamped), the dais drawn on its collider (walking up it, straight up the axis, up the
middle of the collider's facets and near its back, his feet stay within 30 of the drawn tread
under him), nothing drawn only standing more than 56 out of a wall but over a collider (the
front portal and the east doors' architraves held to it), the glass and its rim, the flicker
(its shader hook too), the panelling's mesh and every hall texture's mean colour, the marble's
sheen (its weights on the column and pilaster shafts and the hearth's surround and nowhere
else, its own program, its rim (clamped) and highlight in the compiled shader, and worked out
as the shader does with the camera at the arrival and the dais's foot: every column's shaft
whitened by at least 0.4 in its gleam and by less than 0.3 on average), the polished floor
(exactly when `MIRROR`: see-through, drawn before the lamp, the glass and the shadows; its
reflection flipped under it and made of exactly the low faces of the baked meshes it mirrors,
each in its baked colour times its source's texture mean, under 12k triangles, and the lid
over them in the mean colour of the faces left out above it; 1500 lines of sight from all over
the room through the open floor, every one meeting the mirror), nothing framed, lit or inlaid
on the axis or behind the bottle (the originality rules, below: only panelling on the
headboard, no rug near the axis and no inlay on it but the dais's apron, nothing inside the
ring on the dais's top, no glow low on the axis), the lamp (lit: a deep gold far from the
wall's cream, its beams turning round inside the glass, drawn before it), the front door's
leaves filling its opening shut (round the head of its arch too) and swinging aside onto the
passage, eased, and the east door to Sparrow Lane's the same (by its id only, the front door's
staying shut; its plaque's little red house, the other's snowflake), the `east_2` entry's
footing and framing (1300 of floor before him, the camera in front of him clear of the chart
table, the walk-in on into the room)); `tests/hall-wood.test.js` (the castle wood texture painted in node through
a stand-in canvas: its mean still `WOOD_MEAN`); `tests/geom.test.js` the toolkit the hall is built
with (a lathe over part of a turn, and with no option exactly the full lathe every other
builder draws, pinned to digests of its output before the options; smooth along its profile;
its tops textured from above (`vMode: 'plan'`); sweeps with unit normals facing out and caps
closing their ends; a path along a wall-frame contour; convex clipping; the closed soft box).
`tests/ui.test.js` checks the pause screen draws the HUD's
course name and the leave line only while the HUD offers it (`setLeave`; a switch takes it away;
in the legend's bindings, between PAUSE and the panel at every screen size), and the course card
(its ticks, its slide, waiting while paused, exactly double size on the 320-wide screen);
`tests/ui-wipe.test.js` (node, a stand-in canvas) that the iris is a hole round his chest as the
camera sees it, smaller the further it closes, lower with his size (into the bottle), centred
for a hero behind the camera, and the fade even; `tests/ui-dialog.test.js` that every hall and course sign and door page draws in the dialog
font, fits one screen of the box and is its own (no trademark), and that "AI RACE" never wraps
apart. `tests/areas.test.js` also walks Jonas up to the hall's snowflake door: its sign, no laugh, no
warp; and through the east door with the little house into Sparrow Lane and back (see "Sparrow
Lane").

### The Great Hall (`src/world/hall/*`)

`world/hall/layout.js` holds the anchors in the hall's local frame (+x east, −z north toward the
bottle at the far end, the floor at y 0; world = local + (0, 0, −60000)); `world/hall/hall.js`
builds the room (`buildHall(layout)`, a WorldPart) from its parts, all writing into one kit of
builders (one per material) and solids: `world/hall/plan.js` (the plan as runs of wall:
`planRuns`, `planPolygon`, `facetPanel`, `archHole`, `runPath`, `wallColliders`),
`world/hall/shell.js` (the floor, the walls in their bands, the vault and half-dome, the
columns, the windows), `world/hall/features.js` (the front portal, the fireplace, the
buttress and the banner pole, the east doors (the one to Sparrow Lane opening) and the wheel,
the chart table, the rugs, the candle rings), `world/hall/bottle.js` (its north end: the bottle, its stand and cradles, the
dais, the cork and the books), then bakes it (`world/hall/light.js`) and assembles the meshes.
`world/hall/textures.js` paints its own textures (`floorTexture`, `plasterTexture`,
`panelTexture`, `marbleTexture`, `bannerTexture`; each 64 × 64 but the banner's 32 × 64, painted
once and cached, carrying `userData.mean`, the mean of its pixels in linear RGB, worked out in JS
so it is there in node too and no canvas is ever read back).

```
                             -Z (north)
                    ____----  headboard  ----____
                 /  window     BOTTLE      window  \
          column    coins   on its stand   books, cork  column
          |                     DAIS                       |
          column            chandelier                column
   west   | window                                  window |  east
   (-X)   | buttress  pole                            door |  (+X)
          | (slot)     welcome sign          sign    wheel |
          | fireplace     chandelier    chart table   door |
           \ round                                  round /
            \______ banner  FRONT DOOR  banner _________/
                (rose window over the door)
                             +Z (south, the courtyard)
```

* **Plan** ("The Round Gallery", convex and tangent-continuous: no inside corner for the camera
  to catch in): the nave's straight walls at x ±2200 from z −2000 to 1800, a half-round apse to
  the north (`APSE`: centre (0, −2000), r 2200, 16 facets, its crown at z −4200), the south
  corners rounded (`ROUNDS`: quarter circles of r 1200 centred at (±1000, 1800), 5 facets each)
  into the flat south wall (x ±1000 at z 3000). `HALL` is the plan's bounding box; `inPlan(x, z,
  pad)` its own test. Curved walls are flat facets with normals lerped round (they shade round).
* **Walls**, bottom to top (`ELEVATION`; profiles in w into the room, v up): a marble bullnose
  skirting (0 … 160, 34 proud), teal raised panels (`hall-dado`, 150 … 1002: one panel per ~640
  of each free stretch of wall, fitted to it), a gold chair rail (990 … 1080, 42 proud), cream
  plaster (1060 … 2600, tessellated ~320 × 380 so the bake can grade it) and a marble cornice: a
  bead at the collision ceiling (2550 … 2600, 26 proud) and a quarter-round cove of r 200 out to
  the vault's spring at 2800, unbroken round the whole room. The dado stops at the front
  portal's pilaster bases (`PORTAL.pilasterU + baseR` either side of the door) and the skirting
  runs on into them; both stop at the east doors' niches (±330); the rail runs on over both; all
  three die into the chimney breast's and the buttress's sides (running 4 into them), and the
  slot's back wall keeps its own. Each facet's plaster runs 2 on behind its neighbours, so no
  hairline shows at the joints (nor round the windows' panes, which sit on their reveals' back
  edges, nor under the ribs' feet, closed underneath). **Behind the bottle** (apse facets 6 … 9) the panelling rises to the headboard (1700,
  one panel a facet), its rail stepped up there with gold returns (60 wide, 40 deep, 990 … 1790)
  either side, plaster again from 1770: **plain panelling, forever** (no picture, emblem, window
  or light on it), a dark teal ground for the glass and the lit lamp.
* **Over the collision ceiling** (drawn only, out of the camera's reach: it stays under ~2540):
  an elliptical barrel vault over the nave (springing at x ±2000, 2800, rising 1100, 16 segments,
  z −2000 … 2800), a half-dome over the apse (a spheroid quarter, 16 × 6), plaster strips up to
  the vault over the south rounds and in the lunette over the door; marble ribs across the vault
  at z −2000 (the showcase arch over the apse's mouth: 320 wide, 150 deep, gold beads on both
  faces), −1050, −100, 850 and 1800 (140 × 90), each end on a corbel (230 deep, 2600 … 2800),
  and three on the dome's meridians (30°, 90°, 150°).
* **Columns** (`COLUMNS`, 6, engaged: half in the wall): either side of the apse's mouth and of
  the dais, and two in the apse at 30° and 150°; lathes over ±105° about the way into the room,
  12 sides, smooth round and along: a cream marble base (0 … 262), a rose-marble shaft (to 2240,
  its sheen weight 1, below), a gold capital and abacus (to 2610). Colliders: 8-sided prisms of
  r 190 (`COLUMN`) to the ceiling.
* **Windows** (`WINDOWS`, 8): round-headed, 360 × 1300 from a 1150 sill in each nave wall (z
  −1525, −575) and in the middle of apse facets 5 and 10 (118.125° and 61.875°: flanking the
  headboard, off the axis), 280 × 1200 from 1200 in the middle facet of each south round. Each
  recessed behind the wall's plane: a splayed marble reveal 110 deep, narrowing 40 a side, a sill
  inside it, a moulded surround (28 proud), a pale gold pane on its back edge (`hall-glow`,
  brighter up), an iron mullion and transoms. No colliders: the walls stay flat, with no sill to stand on.
* **South wall**: the inside of the castle's front door (`castle/building.js` `door()` with
  `segs: 16`, the same door the grounds see: its collider puts the face at z 2944), its two
  leaves swinging into the wall on their hinges (`setDoorOpen(t)`, as Jonas goes out through it
  and comes in, see "Areas and transitions") through the opening the wall's dado leaves (cut with
  the same 16 segments) onto a dark passage drawn in with the wood. Round it a **portal**: a
  marble archivolt in voussoirs (from 70 to 190 out of the opening, 50 deep), a gold bead and a
  gold keystone, on two round rose-marble pilasters (`PORTAL`: half columns at u ±470, their axis
  20 in the wall, 12 sides, smooth, shaded round as well as baked: half as bright again facing
  the room as toward the wall; cream bases, gilt capitals, to 410); over it the
  stained-glass rose window (`castle/parts.js` `roundWindow`, 24 segments, full-bright), two
  crimson-and-gold banners (the castle's golden sun) at x ±700 from 2400 down to 1200.
* **West wall, beside the arrival**: the chimney breast (`CHIMNEY`: a cream marble pier x −2200 …
  −1750, z 740 … 1800, its two corners in the room round (r 60), its top the mantel at 1700, with
  the 1-up), the arched hearth (700 × 640, 140 deep: fire-lit reveals, a full-bright ember-glow
  back grading up into soot, three round bark logs (`hall-paint`: the wood's texture would darken
  them to soot) on embers, their sawn ends glowing, seven tongues of flame in three layers up to
  340, a cream half-round hearthstone) in a rose-marble bullnose surround with a gilt keystone,
  teal panels up its face either side of Jonas's crest (a white π on a red disc in a gold ring),
  a bullnose mantel shelf round its top and the skirting round its foot either side of the
  hearth; a plaster hood over the mantel to the ceiling (`HOOD`, solid); north of it the
  **wall-kick slot** (`SLOT`, z 380 … 740, 360 wide, open to the east) and the buttress
  (`BUTTRESS`: a cream marble pedestal x −2200 … −1750, z −80 … 380, top 1700, round corners, a
  teal panel, a gold cap moulding); the brass **banner pole** (`POLES`: r 30 at (−1500, 150), up
  to 1550, 150 under the buttress top, level with its middle and 250 east of its face) with a
  small banner near its top: the jump off its top toward the wall carries 730 … 850, clears the
  buttress's edge and stops against the wall over it, so any aim within 15° of straight at the
  wall drops him mid-top, where he stays (and a coin waits).
* **East wall**: two doors (`EAST_DOORS`: `door()`, 360 × 600, faces at x 2144, z 150 and 1270)
  in teal arched niches with cream architraves (56 deep) and gold beads, their piers solid (u
  ±(330 … 406), up to 460); plaques over them (at 1190, over the rail): a snowflake over the
  north one, still being built, and a little house (Falu-red walls, a black roof, a white door
  and window, a tiny blue bird on its ridge, on a deep blue field) over the south one, nearer the
  way in (`EAST_DOORS.open`), which opens onto Sparrow Lane: built like the front door with a
  passage, its two leaves (`hall-east-door-left/right`) swinging into the wall on their hinges
  (`setDoorOpen(t, 'hall_east_2')`) through the opening its niche (a ring of teal from the door's
  arch out to the niche's) and the dado behind it (cut with the same 16 segments) leave, onto a
  dark passage drawn in with the wood; a ship's wheel between them (`WHEEL`, at z 560, 1500 up:
  an oak rim, a gold hub, eight spokes out to gold handles).
* **Out in the room**: the round oak **chart table** (`CHART_TABLE`, (1050, 750), r 320, top 90,
  an octagonal collider) with a chart of the first course on it, on a compass rose inlaid in the
  floor (`RUGS`, r 640: gold, Falu red and teal rings, an eight-point star whose red north point
  points at the bottle; off the entry axis), a ring of 8 coins round it on the rose's red ring;
  a half-round rug before the hearth, half-round mats before the front door and the east doors;
  three gold **candle rings** (`CHANDELIERS`, r 420, 12 candles each, at 2120, on the axis over
  (0, 800), (0, −1000) and (0, −3000)) on a baluster, four chains and an iron rod to the vault.
* **The ship in the bottle** (`bottle.js`): a giant glass bottle lying along x 0 (axis 760; body
  r 520 from z −4130, its end on the apse's crown so no corridor behind it can trap the camera,
  to −2300, a shoulder to the neck, r 240 to −1440, a lip ring r 270 to −1400). Its colliders
  are convex solids round the axis of **slippery** stone, each cross-section with a corner
  straight up and down and a vertical face across its widest band (the body and shoulder 75° …
  105°, the neck and lip 70° … 110°): a wall there stops the camera's path check, where corners
  at the widest point would leave a steep floor (which the path leaves to the height limit) and a
  C-button swing could carry the camera into the glass. It lies on a **stand** that runs its
  length from its end to the dais, rising round the glass to 45° either side of straight down
  (its half-width follows the glass: 368 under the body, narrowing under the shoulder to 170
  under the neck): teal raised panels (`hall-dado`) under a gold rail, its top deep teal; with
  two gold **cradles** across it (z −4040, at the bottle's end, closing the wedge against the
  apse wall, and −2700; tops 420, level with the putty sea; their blocks and caps soft-edged,
  `castle/geom.js` `softBox`) whose cheeks rise round the glass from there into its widest band
  (to 640, their outer sides sloping in from 650 to 580). So no spot under the glass is lower
  than `HEADROOM` (400) under it: beside the stand the glass is 440 or more over the floor, the
  stand's own top lies inside the glass (its colliders flat-topped boxes, their sides running 10
  up into the glass's collider all along: no slit between the two, through which the camera,
  slipping over the stand's top, would be lifted into the glass), and no cradle leaves a ledge
  under it. The shoulder's collider ends 10 wider than the neck's, so no sliver of the neck's
  end face (a wall facing north, whose push would shove the camera into the shoulder) stands out
  where the two rings meet. Inside, a putty sea (420)
  with a model of the first course: pink granite islets, a red cottage on the green home island,
  a boat with a red sail and a white jib, a white lighthouse with a red band whose lamp is the
  `hall-lamp` mesh, hidden until that course's star is won (`setLit(on)`; `AREA_DEFS.hall.lamp`
  names the course, and AreaSwitch lights it with the course's own lighthouse): a deep gold lamp
  (`0xffa828`) swelling out of the dark lantern, so it stands out from the teal headboard behind
  the glass, and two hazy beams like the course's (a horizontal and a vertical fan each, 380
  long, fading out) turning round it at the course's 0.55 rad/s, inside the glass whichever way
  they point.
* **The dais** (`DAIS`, replacing a straight stair: no straight central staircase, no runner): a
  half-round stepped podium south of the mouth's plane (z −1400), 11 steps from its foot (r 1550)
  to its top (r 560 at 550, the neck's inner floor; `LANDING` is its alias). Its collider is one
  convex half-frustum of 12 facets (`stone|not_slippery`, 29°, 37 triangles, walkable from every
  side, a vertical back on the mouth's plane); the drawn steps sit on it: riser i stands at r
  1550 − 90 (i + 0.5) (rose marble, darker toward the floor), so tread i's middle
  (`daisTread(i)`) lies on the slope; every tread below the top is drawn half the facets'
  sagitta lower (up to 3.5: between its corners a facet lies lower than the round slope), so his
  feet stay within about 26 of the tread he stands on all round (measured −25.8 … +24.6; his
  shadow on it). Cream treads with a rounded nosing, 24 segments round, smooth, their marble
  laid from above (no streaks fanning in to the middle; the hearthstone and the chart table's
  top too); a gold and Falu ring inlaid on its top; a flat stepped back. Stepping off the back
  drops him 300 … 550, as off the old landing: the camera, up behind him, loses him for about a
  second until its remedy turns it to the side. A gold and rose half-ring (`DAIS_APRON`) is
  inlaid in the floor round its foot.
* **The cork and the books**, a little climb of their own in the apse's east flank: a giant
  **cork** (`CORK`, (1300, −2150), r 190 narrowing to 160 at its top, 380; round, a darker ring
  round its foot; an octagonal collider) and two giant **books** (`BOOKS`, z −2280 … −2020) stacked
  like steps up to it (tops 130 and 255, the top book's east end tucked into the cork's foot):
  red and teal covers overhanging cream page blocks with page lines at their west ends and the
  sides toward the hall (their fore-edges), rounded spines on their north sides between the
  boards' edges, with gold bands; hop up book, book, cork, a coin on each.
* **Meshes** (16; 15 drawn while the lamp is unlit): `hall-floor` (glazed tiles on a 200 grid
  clipped to the plan inset 300, in a rose border ring and an ivory fillet whose uvs sit on the
  tile's plain grout; see-through over its reflection, below), `hall-wall` (plaster: walls,
  vault, dome, strips, hood), `hall-dado` (teal raised panels: the wainscot, the headboard, the
  stand's sides, the niches, the breast's and buttress's panels; explicit uvs, one panel a
  repeat), `hall-trim` (pale marble, tinted cream or rose: skirting, cornice, ribs, corbels,
  columns, window reveals and surrounds, the portal, the door surrounds, the architraves, the
  dais, the breast, the mantel, the buttress, the hearthstone; glossy, below), `hall-wood` (oak
  and iron: the table, the wheel, mullions, rods, chains; the swinging doors' passages),
  `hall-door-left` and `hall-door-right` (the front door's leaves, the wood's material, each
  turning about its hinge), `hall-east-door-left` and `hall-east-door-right` (the east door to
  Sparrow Lane's, the same; two meshes more than before it opened), `hall-paint` (untextured vertex colours: gold work, cradles, the
  stand's rail and top, rugs and inlays, the crest, plaques, chart, candles, cork, books, the
  fire's logs, the model in the bottle), `hall-glow` (full-bright: the rose window's glass from
  the rose texture, and the panes, the hearth's back, embers, the logs' ends and flames, which
  all sample the rose texture's pale gold middle), `hall-cloth` (the banners), `hall-bottle`
  (the glass: one transparent surface, front faces only, no depth write, a highlight stripe in
  its vertex colours; outer faces only, so it never lies over itself; opacity 0.22 face on,
  rising to 0.62 and paler where the view grazes it, from the angle between each face and the
  view in its shader, so its outline reads against the walls and the stand), `hall-signs`
  (signposts: `props/decor.js` `addSignpost`, exported for it), `hall-lamp` (full-bright, its
  faces' glow its vertex colours' alpha: 1 on the lamp, fading along the beams; the course's
  beam material, so one shader for both; set about the lighthouse's axis to turn round it in
  `update(time)` while lit; drawn before the glass round it) and `hall-reflect` (the floor's
  reflection, below). The flames flicker: the glow mesh's `'flame'` attribute (0 steady, else
  the flame's phase) scales their colour by a wobble of the uniform `update(time)` sets
  (`material.userData.flameTime`). ~23.6k triangles in the room and ~10.6k in its reflection,
  827 collider triangles (stone 446, the dais `stone|not_slippery` 37, the glass
  `stone|slippery` 176, wood 168 with the signposts: `castle/geom.js` `SolidBuilder.solid(polys,
  terrain, surface?)`), built in ~230 ms in node, ~150 ms in the browser; 33–35 draw calls in the
  hall (35–37 with the lamp lit; the E2E budget is 45).
* **The polished floor** (`MIRROR` in `hall.js`, on): `hall-reflect` is the room's lower part
  mirrored under the floor (`scale.y` −1: three turns its faces round for the flip), one
  untextured `worldMaterial` mesh made once in `assemble()` from the baked wall, dado, trim,
  wood, paint and cloth and the glow's steady faces (not its flames, nor the rose window's
  glass, whose colours are in its texture): every face from the floor up that reaches 8 above it
  (so no rugs or inlays) and whose lowest corner is at most 1600 high (higher ones mirror far
  under the floor, seen through it only near the eye). Its colours are the baked ones times the
  mean colour of the source's texture (`userData.mean`; the castle wood's is `WOOD_MEAN`,
  [0.166, 0.074, 0.025], measured once in the browser, nothing in the game reads a canvas back,
  and `tests/hall-wood.test.js` keeps it true), dimmed to 0.9 (the untextured paint's by 0.9
  alone, the glow's not at all). Over them a lid (two faces looking down at the cornice,
  `HALL.ceilingY`, above every mirrored face, reaching 6000 past the walls every way) stands in
  for everything higher, the upper walls, the cornice and the vault, in the mean of their
  mirrored colours by area (a warm cream, about sRGB (191, 170, 140)): every look through the
  floor meets the mirrored room, the steep ones near the eye and from the perches too, never
  the dark clear colour behind it (which had greyed the floor round Jonas). The floor over it is
  see-through (opacity 0.82, still writing depth) and drawn first of the see-through meshes
  (renderOrder −2: before the lamp at −1, the glass, the blob shadows at 0.5 and his own shadow
  at 1), so about a fifth of the reflection shows through the tiles. It is static: Jonas, the
  coins, the flames, the swinging leaves, the glass, the lamp and the signs are not in it, which
  goes unseen at that blend. One draw call (35 at the arrival). With `MIRROR = false` the floor
  is opaque and the mesh is not made (13 meshes).
* **The glossy marble**: `hall-trim`'s per-vertex `sheen` weight (written as its builder's
  `glow`: 1 on the column and portal pilaster shafts, 0.6 on the hearth's surround, else 0)
  whitens a vertex toward a warm white (by up to 0.75) with a Fresnel rim (0.35 (1 − |n·v|)³,
  its base clamped at 0: |n·v| of two unit vectors can round past 1, and `pow` of a negative is
  undefined) and a highlight from a light in view space near the eye, a little left of it and
  above it, nearly level ((−0.35, 0.15, 0.92): on an upright shaft the view reflected about the
  normal has no up in it, so a higher light could never make it shine; 1.1 (r·l)¹⁰), worked out
  per vertex, so a rose shaft gleams in a stripe that slides round it as the camera moves. Its
  own program (`'hall-sheen'`), no draw call.
* **Light** (`light.js`, baked into the vertex colours: `makeHallLight(layout, windowSpots)`
  returns the two pure functions `floor` and `wall` of a vertex's position and normal,
  `bakeHall(geo, light)` multiplies a mesh's colours by one, clamped to 1.15 as one (all three
  channels scaled together, so a bright pool keeps its hue: the fire's stays orange); the floor
  gets the floor's light, everything else but the full-bright glow and lamp and the raw glass the
  wall's;
  the signs keep `bakedMesh` under `HALL_SUN`): a base of 0.62 plus 0.38 of the key light
  (`HALL_SUN`, (−0.351, 0.803, 0.482): from high in the south-west, so the east wall bakes about
  1.2 times as bright as the west), on the walls a weak fill from the apse's side (so the south
  wall's round parts, turned from the sun, still shade round) and a warm bounce on the
  down-facing vault and dome; ambient occlusion (the floor darker within 500 of the walls, the
  walls darker at their foot and under the cornice, the vault at its spring); warm coloured
  pools (under each candle ring, a big one round the fire and one more on the floor before it, a
  halo round each window and a patch of floor in front of it; off the floor each counts as much
  as the face turns toward it); the floor's light, all told, at 0.72 (it faces the key light
  square on and lies under every pool: unscaled it baked a flat clamped white, brighter than any
  wall; now the nave's middle bakes about 0.9 … 1.0, and, with its reflection under the golden
  haze, the arrival's floor reads as bright as the plaster, about 179 luma, its tiles still
  plain to see); and a warm/cool ramp (bright parts warm, dim parts cool, the vault never
  cool). The rose window's coloured pool is tinted into the floor before the bake.
* **Palette**: three hues plus gold. Cream and ivory (the plaster 0xfff0d6, the vault 0xfff4e2,
  the trims 0xf0e6d2 on pale marble, the floor's tiles), teal (the panels' field, 0x1f5754 on the
  stand, 0x2f6f6a in the rugs and niches), rose (the marble 0xe3a08e, the floor's border
  0xc4745e, Falu red 0xa8322a its darkest accent), gold (0xe8b84a, 0xe2b252). Oak only on the
  furniture; panes 0xffe6a0.
* **Drawn only, at most 56 proud** (the camera keeps 60 off the walls; a deeper part needs a
  collider, `tests/hall.test.js` checks every trim, paint and panel vertex near the walls): the
  portal (archivolt 50, bead 40, keystone 56, pilasters 50 at the shaft and 56 at base and
  capital), the east doors' architraves 56 and beads 40 (their piers solid below 460), the chair
  rail 42, the skirting 34, the headboard's returns 40, window surrounds 28 (the sills inside the
  reveals), the buttress's cap moulding 36, the mantel shelf 50 and the hearth's surround 44
  (over their boxes' faces), the breast's keystone 52, column bases and capitals up to 41 past
  their prisms, the wheel's rim 40 and hub 50, banners 34, plaques and crest 4, the cornice's bead
  26. The one part past 56 is `door()`'s own keystone (shared with the castle): 66, over its
  surround's collider but for its top 14.
* **Entries**: `front` (0, 0, 1550) facing north with the room behind him for the camera,
  walking in 10 ticks (on up the dais's steps in about 90 ticks, the camera never trapped nor
  hidden); `bottle` (0, 550, −1120) on the dais's top facing south, dropping 250, `camYaw` 0,
  with `sfx: 'bottle_pop'` (AreaSwitch plays it as the wipe opens), 280 out from the mouth's
  face: just off its re-arm apron (`DOOR.REACH + APRON`, 260), so turning round walks him
  straight back in (a stick held on from the course waits to be let go first); the respawn drops
  in at `front` from 400. `front` names its door (`door: 'hall_front'`, the one that stands open
  as he comes in from the porch, then shuts); `east_2` (1970, 0, 1270), 174 in front of the east
  door to Sparrow Lane, facing west into the room with the camera in front of him (`camYaw`
  −π/2: south of the chart table, with 1300 of floor before him), walking in 8 ticks, its door
  `'hall_east_2'`: back from the lane through the dad's front door, its star and its pause
  screen's leave (the last two swing no door: it stays shut behind him).
* **Doors** (`DOORS`): `hall_front`, the inside of the front door (face z 2944, yaw π), back out
  to the grounds' `porch`; `bottle` (the lip's end face, z −1400, on the dais's top at 550,
  `kind: 'bottle'`) into Midsummer Skerries' `arrival` (see "Midsummer Skerries");
  `hall_east_2` (face x 2144 at z 1270, yaw −π/2) into Sparrow Lane's `home` (out of the dad's
  front door, see "Sparrow Lane"); `hall_east_1` (z 150) `to: null` for now: no laugh, the
  handle rattling in its frame (`laugh: false`: `door_rattle`) and its sign (`HALL_DOOR_SOON`
  'This door is still being built.' / 'Come back after the next update!').
* **Pickups and signs**: 25 coins (`COINS`, each at its floor + 60, but the three hanging in the
  wall-kick slot at 450, 900, 1350: the ring round the chart table, the slot, three of the dais's
  treads (2, 5, 8) and its top, the cork, the buttress's top (the pole jump's reward), the books,
  and a trail of five round the west side of the apse behind the bottle), the 1-up on the mantel
  (`ONE_UP`), three signs (`SIGNS`, each with its `y`), none between the arrival and the dais:
  `hall_welcome` at (−750, 750) to the left of the way in, `bottle` at (1250, 0) behind the chart
  table ("Climb the steps, walk into the neck of the bottle and join it!"), `wallkick` at the
  slot's mouth.
* **Look** (`HALL_ATMOSPHERE`): a golden haze, not a brown murk: fog 0x6a4a34 from 4500 to 20000
  (also the clear colour: no sky), a warm actor sun 0xffe2b8 (0.55π) from the bake's own
  `HALL_SUN`, hemisphere 0xfff2dc / 0x7a5038 (0.55π). No light is added (see "Renderer": the
  actors' shader programs never change).
* **Originality** (the ORIGINALITY RULE, for this room; `tests/hall.test.js` guards the axis and
  the headboard):
  * **The plan is this game's own:** a nave into a full-width apse with rounded entrance corners. No
    copied room proportions.
  * **No straight central staircase, no carpet or runner.** The climb is a half-round rose and cream
    stepped dais.
  * **The axis has no emblem.** The compass rose is under the chart table, off the axis. The axis
    floor carries only the tile field, the thin apron half-ring round the dais foot and the plain
    border ring on the dais top; no figure, emblem or light pool inside any of them.
  * **Nothing framed, windowed or lit above the dais or behind the bottle.** The headboard is plain
    teal panelling; the apse windows are off-axis plain glazing. No oculus, no light shaft.
  * **The rose window stays over the entrance**, behind the arriving player.
  * **No star-emblem doors:** snowflake and little-house plaques, Jonas's π crest, a ship's wheel.
  * **Palette and motifs** are Swedish and nautical. Textures are procedural and original.
* **Sound** (`def.audio`, see "Audio"): its own loop, "Compass and Candle" (`castle_hall`); the
  `'hall'` ambience, a low room tone with the fire crackling in the hearth (`HEARTH_FIRE`, the
  middle of the hearth's opening, (−1750, 320, 1270)); every sound effect ringing in the hall
  reverb (`reverb: true`).
* **Preview**: `/preview.html?m=hall` (`src/dev/previews/hall.js`: the hall alone under its fog;
  `&col=1` the collider overlay, whose every face shows from inside the room; `&lamp=1` the
  lamp lit; `&door=0..1` the front door that far open;
  `&view=overview|entry|bottle|fire|vault|roof|apse|toys` (`roof` the vault's old name); `&t=`
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
overhead; the course's critters (see "Critters") live on it, on the sand bar and on the islet,
and the welcome sign on the jetty warns of them (each kind's tell, and to jump on them or punch
them) before its last page says how to leave.

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
  transitions": back out of the bottle onto the hall's dais). 58 coins (`COINS`: the jetty,
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
  (~60 ms in the browser); the course's objects 9 meshes (coins, sparkles, shadows, star, 1-up,
  butterflies, gulls, critters, critterMarkers); 38 draw calls from the arrival (the E2E budget
  is 55; one more while a critter's danger marker shows).
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
  Player, camera and objects: the budgets (its objects at most 9 meshes too), the arrival's open
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
  the mast, the critters' homes (see "Critters"));
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
  lost; the maypole climbed from four sides past its four coins, the flagpole's climb; on every
  tick of every route no critter is engaged and none has hurt him).

#### Critters (`src/objects/Critters.js`, `src/objects/critters/*`, `src/objects/critterModel.js`)

The course's enemies: small original critters of the midsummer archipelago, each living on its
own patch of the course and guarding the **fight circle** round its home. The **Wreath Frogs**
("kransgroda") hop and the **Mosquitoes** ("mygga") hover over Home Island's meadow, and a
**Tin Crab** ("burkkrabba", a hermit crab in an old herring tin) hides on the sand bar in the
Sound, another on the islet's first terrace. They are fair for a child, telegraphed, and
beaten with Jonas's own stomp and attacks; a defeated one drops a coin (a coin heals a wedge).
The castle grounds and the Great Hall have none.

```js
// layout.CRITTERS (course-local; world/area.js shifts x, y, z like the other point lists):
//   [{ id, kind: 'frog' | 'crab' | 'mosquito', x, y (its floor), z, yaw, roam, fight,
//      calm?, wade?, scale?, stand? }]
objects.critters                 // Critters (ObjectManager builds it where the layout has
                                 // CRITTERS: the course; null on the grounds and in the hall)
critters.update(player, hero, tick, hold, cameraYaw)   // 30 Hz, after the cannon (hold:
                                 // dialogOpen || warping); hero: the previous tick's { y, vy,
                                 // air }; cameraYaw: ObjectManager's (a struck one flies off the
                                 // camera's line of sight)
critters.animate(alpha, clock)   // instance matrices and channels, shadows, markers
critters.reset()                 // ObjectManager.reset() (GAME OVER) and enter() (every arrival)
critters.sendHome()              // a lost life (the 'spawn' edge, seen in update)
critters.alive, .engaged, .hits, .list, .byId(id), .mesh, .markers
CRITTER = { SHARED, FROG, CRAB, MOSQUITO }   // every number (the difficulty knobs; each kind's
                                 // table lives with its steps in critters/<kind>.js)
AWAY, STATES, HITTABLE           // see below
```

* **Fair for a child** (each rule tested):
  * F1 nothing hurts by touch: only a strike (the frog's landing, its last 6 leap ticks; the
    crab's pinch, its last 3 lunge ticks; the mosquito's needle, low over the floor and on the
    marked spot), 1 wedge (of 8), at most once a strike, through `player.takeDamage(1,
    fromPos)`. Touching one is a harmless **bump**: a live critter he walks or jumps into (on its
    level, his body reaching its body: his feet below its top, and his head above a hovering
    mosquito's underside, `UNDER` 25 below its thorax), never in its strike or the mosquito's
    aim (its tell flies a set path), nor while he is knocked back (`hurt`: the hit throws him
    round it, below), moves aside. A calm one notices him; its kind may have it skip away
    (`bumped()`: a frog after him on the ground hops off, a windup called off first); otherwise
    it is pushed out to arm's length (`PLAYER_RADIUS` + its `BUMP_R`, times its size; a hovering
    mosquito's 30, short of its stomp reach, so a jump beside it still comes down on it; a
    stuck one's `STUCK_R` 45) along the line from him, or, where it may not go (its leash, a
    wall stopping it short, off its floor, the water), round him by the least turn it may take,
    22.5 degrees at a time up to 90 to either side, toward home first: pressed on along the
    leash's rim or a wall it slides round him a little each tick, keeping nearly arm's length. It
    moves at most `BUMP_STEP` (24) a tick more than he does: never a jump. Even while he dies it
    is pushed off his feet (a leap that takes his last wedge also comes down short of him).
    Jonas never stands inside one.
  * F2 every strike is told for at least 20 ticks (motion, glow, sound); its target or heading
    locks at least 9 ticks before it can hurt; an orange **danger marker** on the ground shows
    where the frog lands and where the mosquito's needle comes down.
  * F3 one attacker at a time: a token taken as a windup (an aim) starts and given back as the
    strike ends (the frog's landing, the crab's pinch's end, the mosquito's dive's end: a hit,
    stuck or a miss; a cancel, a defeat, a lost life), then `SHARED.GAP` (40) ticks before the
    next windup.
  * F4 nothing happens while he is **away**: `hold` (a dialog, or a warp: main passes
    `warping: areas.busy`, ObjectManager holds the critters with it as with `dialogOpen`), in the
    water, or `AWAY[action]` (19 actions: exactly where `Player.bounce()` refuses, the automatic
    and submerged groups and `Player.NO_BOUNCE`, plus `cannon_shot`): no engagement, no new
    windup, a windup under way is called off (token back, cooldown 30), a strike in flight does
    no damage. No windup either while he blinks after a hit (`heroInvincible`, 2 s).
  * F5 he wins a tie: his attack (`player.getAttack()`, read once a tick) and his stomp are
    tested before the critter's own step, and again inside a strike where it has carried the
    critter that tick (`_parried`: a lunge or a dive into his punch, a leap or a dive up under
    his falling feet) before it may hurt him.
  * F6 knock-safe hits: at a hit his natural landing (145 and 290 along the knockback, which
    carries him about 286) is probed (2 `findFloor`, 2 `waterLevelAt`); where it would be off
    his level (60), on nothing or in the water (at the bar: over 95 deep), `fromPos` sends him
    toward the critter's home instead; where the critter stands in that way (ahead of him within
    the flight, nearer it than arm's length: a crab that pinched him at the rim from the home
    side), the way is turned round it, `KNOCK_ROUND` (0.5 rad) at a time up to three times, its
    far side first, to the first way that is clear of it and lands safely (2 more `findFloor`
    and 2 `waterLevelAt` a way): he never flies through it, and it is never shoved along by him.
  * F7 never near a route (below); F8 one stomp or one hit defeats any critter in any live
    state, and it drops exactly one coin.
* **Engagement**: a calm critter (frog `idle`, `return`; crab `hidden`, `return`, `hide`;
  mosquito `patrol`, `return`) whose circle he is in, on its level (his floor within 60 of its
  home's), not away, notices him (a frog caught in an idle hop lands it first). An engaged one
  is let go after 20 ticks of him beyond fight + 80, off its level or away (never mid-strike or
  in the stomp window or the recoil after it, nor in the air: a hop lands first) and goes home.
  Its body never leaves fight + its kind's leash (frog 60, crab 40, mosquito 100; a frog's hop
  bumped in the air is held inside it too).
* **Lifecycle**: a lost life (the hero's `'spawn'` edge, seen in `update`; never the global
  `'lifeLost'`, which every area's manager hears) sends the live ones home, calm, the token
  free; the defeated stay gone, and one being defeated finishes and drops its coin. Every
  arrival (`ObjectManager.enter`) and GAME OVER (`reset`) bring them all back home, calm, the
  life counter at 0. While another area is current they are frozen (not ticked or drawn).
  Re-entry lets a child farm coins: harmless (coins only heal).
* **Determinism and cost**: no `Math.random`, no wall clock, no rng stream: every choice is
  `noise(seed + life counter)` (Minions' noise), so a reset manager replays exactly and the
  butterflies' and gulls' rng sequences are untouched. Idle critters make no collision queries
  (a frog's idle ring is checked once in the constructor; a hidden crab sits still; a
  mosquito's patrol is a closed form on the life counter), no sparkles. Engaged (at most one at
  a time: the circles never overlap): a frog one `findWalls` per air tick and one `findFloor`
  per hop and at the lock; a crab one `findWalls` and one `findFloor` (and the water) per moving
  tick; a mosquito one `findWalls` per moving tick and one `findFloor` (and the water) as it
  would start its aim. A bump tick tries up to 9 ways round him (a `findWalls`, a `findFloor`
  and the water each), a hit up to 6 turned knockbacks, a tumble at an edge up to 5 ways.
  Allocation: collision results and `'sfx'` payloads only (tests guard the hot paths).
* **Sound**: positional `'sfx' { name, pos (lifted 60), pitch?, quiet?, deflate? }` (see
  "Events"); every call but the idle ones always plays and sets the shared gate
  (`lastSfxLife`); an idle call (`quiet: 1`: the frog's croak with him within 2000, the
  mosquito's whine within 1200, every 180 to 300 ticks) waits 45 ticks after any critter sound,
  so a loud whine always means it has seen him.
* **Rendering**: all of a course's critters are **one InstancedMesh** `'critters'` (one draw
  call) over one geometry holding the three models: each instance shows only its own (`aPart.z`
  against `aAnim2.w`: the type mask), its moving parts posed in the vertex shader from two
  per-instance channels (`CRITTER_ANIM`: the frog's legs, sac, head wobble, breath, blink,
  wreath lift and glow; the crab's gait, stride, claw raise, pincer, eye stalks, lift (with its
  spot's stand) and glow; the mosquito's wing beat and flap, abdomen curl, legs, red eyes,
  quiver and glow). Smooth Gouraud shading (the lathes' and cylinders' own normals, turned with
  each part; never recomputed), a warm rim and the glow (`aEmit`), the fog at 0.6 like the
  minions'. Material `MeshLambertMaterial` with program cache key `'skerryCritters'`, lit by the
  course's actor sun and hemisphere. The models' attributes are built once per session
  (`critterBase()`) and shared by every manager's geometry. The **danger markers** are a second
  small InstancedMesh `'critterMarkers'` (the AI RACE markers' texture with a wider, solid ring,
  normally blended in a bright sRGB orange pulsing 0.7..1, steady at full brightness for the
  first 0.3 of its growth, drawn with the blob shadows, renderOrder 0.6), visible only while one
  shows (one more draw call). One blob shadow slot each (after the minions' and the boss
  star's), hidden when it is gone; white twinkles, gold bursts and clods (`TINT` petal,
  buttercup, sand, fluff; dirt and scrap) only at moments he caused.
* **The Wreath Frog** (`critters/frog.js`, `FROG`): a fat, glossy lime frog (its back #8DC23A,
  light against the meadow from the raised follow camera) wearing a midsummer flower wreath of
  daisies, buttercups and harebells (never gold; each flower standing clear of the leaves, turned
  up and out toward the raised camera, its yellow eye a little proud), open, friendly gold eyes
  (each a lathe whose pole looks forward: a wide black oval pupil under half the eye across,
  paler gold round it, a white glint up on the same side of both), a pink throat sac; about 120
  across its hind feet, its head (the stomp top) at 75, under 800 triangles. Calm (`idle`) it
  breathes, blinks and hops round a ring of up to six points about its home (0.6 of its roam
  out; points on its floor, dry and clear of walls), croaking quietly now and then. When he comes
  in it notices him (`notice`: a croak, pitch 1.25, a hop and a white twinkle), then
  **approaches** in cycles of a crouch, a 12-tick hop and a rest: toward him while he is beyond
  290 (to land about 240 from him), away when he is nearer than 160, and inside that window it
  rests and **winds up** (20 ticks, 26 for a `calm` frog: it crouches, its sac puffs up glowing,
  it shakes from tick 12, `frog_puff`); at the lock (tick 14, 18 when calm) its facing and the
  target T (his feet, at most 400 away, inside the leash, on its level and dry, else half way,
  else it gives up with a puzzled croak) lock together and the marker appears at T, growing from
  110 across (well over his own shadow) to 150. The **leap** (20 ticks, `frog_leap`) lands
  exactly on T, its peak 135 over flat ground; only its ticks 15 to 20 hurt (its body sphere, 40
  up, r 45, against his capsule). It lands (`frog_land`, the token back) **dazed** for 36 ticks
  (squashed and wobbling, three white twinkles circling its head, a new three every 12 ticks, a
  sleepy croak: the stomp window), cools off for 45 and comes again. Walked into on the ground
  while after him it hops off (a windup called off). A **stomp** bounces him with
  `player.bounce(72)`, a trampoline belly (he rises 684, about twice a plain stomp), and
  squashes it flat in 2 ticks (stomped in the air, it drops to its floor as it flattens), then
  it poofs; a hit knocks it tumbling (8 a tick, up at 22: its arc peaks about 80 up), off the
  camera's line of sight when it would fly on behind him (`KNOCK_TURN` 0.7 rad aside). Either
  way its wreath pops off (`frog_pop`, petals) and flies straight up in the world, spinning and
  shrinking, `WREATH_RISE` 300 over 10 ticks, then bursts into gold sparkles: the wreath turned
  into the coin, which lies where the frog was (a stomp's at the same tick). Early and high, so
  the follow camera rising with his bounce still sees it. Measured with the real Player (the
  fairness test, at both ends of the window): standing still he is hit; a sidestep up to 22
  ticks into the tell is never hit; walking in mashing B he knocks it over first; a jump as it
  takes off stomps it.
* **The Tin Crab** (`critters/crab.js`, `CRAB`): a coral hermit crab living in an old oval
  herring tin (a plain grey tin with cobalt and yellow bands, no lettering, its peeled lid curled
  up at the back), claws ending in two-jawed pincers (the right one bigger), eyes on stalks;
  about 175 across its legs, its tin's top at 78 standing, under 750 triangles. Its legs lift
  its body from the tin on the ground (`hidden`, lift 0) to standing (1) and taller in the tell
  (1.25): every height of it (its stomp top 82 standing, 48 hidden; its body capsule) rides that
  lift, plus its spot's `stand`, and its feet stay planted (the shader moves a leg vertex by its
  modelled height). Calm it sits **hidden** in its tin (at a wading spot sitting up a little on
  its legs, `WADE_LIFT` 0.65, so at the sand bar its yellow band and its peeking eyes are over
  the water), its eye stalks peeking out now and then and following him (the tin turning)
  while he is about (on its level, or swimming there: watched, never woken). When he comes in it
  **wakes** (14
  ticks: up on its legs, two clacks, a spray of sand), then **sidles** round him facing him,
  sideways at 7 a tick, turning back now and then or where it may not go, closing in or easing
  off at 3 a tick until he is 175 to 185 away (times its size), and, once it is not hidden
  behind him from the camera (at least `OFF_LINE` 0.45 rad off the camera's line through him: a
  child walking straight at it has it right behind him, so it sidles out first; or after
  `LINE_WAIT` 45 ticks of sidling), **winds up** (24 ticks: it
  rises tall, its claws go up and wide, turning as they rise so the pincers open toward him and
  the camera, glowing, the pincers working, a clack and a white twinkle at each claw every 6
  ticks); its heading locks at tick 14. The **pinch** lunges 4
  ticks along it at 18 a tick (at every size) and snaps (`crab_snap`) at its tick 2: only its
  ticks 2 to 4 hurt (a claw sphere 56 in front, 42 up, r 32, times its size). Then its claws are
  **stuck** in the sand for 28 ticks (nose down, the tin up, legs scrabbling: the stomp
  window), it cools off for 40 and comes again; let go, it sidles home and **hides**. It never
  steps more than 40 off its floor, onto a deadly floor or into the water (a `wade` crab: at
  most 95 deep), nor past its leash. A **stomp** (a plain bounce) dents its tin in 3 ticks:
  squashed, it rattles like a can and its stalks droop, rattling on as it poofs, its coin 11
  ticks after the stomp (while the camera following his bounce still has it in view); a hit
  knocks it tumbling, the tin spinning, dented as it lands, never into water deeper than it may
  wade (at such an edge, or a drop, it glances off along it, away from him); either way a
  `crab_tonk`, sand and bits of tin, its coin (at the bar floating 50 over the water). At a
  wading spot the dented tin floats up, its top kept `FLOAT` (30) over the water through the
  dent, the tumble and the poof (it stays standing on its legs, its feet hanging in the water),
  never crumpling out of sight. No flip onto its back. Measured with the real Player, at
  both ends of its window and at both its sizes: standing still he is hit; a sidestep at half
  or full stick 18 ticks into the tell is never hit; walking in mashing B he knocks it over
  first.
* **The Mosquito** (`critters/mosquito.js`, `MOSQUITO`): a big cartoon mosquito in a
  charcoal-and-white "tiger" livery (no yellow or tan: never a bee; dark against the cliffs
  behind it from the follow camera), a long needle with a red tip, white cartoon eyes with black
  pupils (a deep red only while it aims, so red always means "now"), glassy wings and long
  dangling legs; about 230 from needle tip to abdomen, under 600 triangles. Calm it **patrols**
  a figure of eight 150 over its home (320 by 220 times its roam / 160, a closed form on the
  life counter, bobbing), whining quietly now and then. When he comes in it **spots** him (a
  loud whine), then **chases**: toward its stand point 220 from him, speeding up to 9 a tick,
  only while it is further than 230 from him: it never backs off, so nearer it just hovers.
  Parked 200 to 240 from him, his feet on its level and dry (1 `findFloor` and the water; else no
  tell at all: it waits 30 ticks and looks again), it **aims** (24 ticks, `mosquito_aim`, a
  'ting' as it locks): on its first tick T (his feet) and its heading lock and the ring appears
  at T, growing from 110 across to 170 (2 `MARK_R`); it rises 80 and draws back 40 from T, the
  needle pitched at T, the abdomen curling, wings beating faster, eyes and needle glowing red.
  The **dive** (`mosquito_dive`) runs the needle's tip along the locked line at 24 a tick to 20
  under T's floor; it hurts only with its tip at most 100 over the floor **and** him on the
  marked spot (his feet within `MARK_R` 85 + `PLAYER_RADIUS` of T): a child who steps off the
  ring is never clipped by a needle aimed at where he stood. While it dives its struck shape
  runs on to the needle's tip (a punch into it wins); otherwise its body capsule runs from its
  tail to the needle's middle. Hit, it bounces off in a backward somersault and cools off for
  60; missed, it is **stuck** in the turf for 60 ticks (55 degrees down, its body about 85 over
  the floor, wings buzzing, legs kicking, a tug and a 'doinng' every 20: the counter window,
  where it is bumped a little further off him), pulls free with a 'thwop' and cools off for 45;
  let go, it flies back onto its patrol. Hovering, it is bumped aside when he walks or jumps
  into it (his head reaching its body), short of its stomp reach. A **stomp** (a plain bounce)
  splats it (an accordion squash, 3 ticks) and it poofs right there, its coin on the floor
  under it 11 ticks after the stomp (in view of the camera rising after him); a hit sends it off
  like a balloon let go, zig-zagging, rolling and shrinking (`mosquito_pop` with `deflate`),
  then it falls and poofs; its coin on the floor where it came down. (While it dives, a punch
  wins as soon as it reaches the needle's tip: with him standing still and mashing B it pops
  about 225 from him, its tip about 100 off: the plan's swat into the incoming needle.)
  Measured with the real Player, its aim started where it parks: standing still he is hit; a
  sidestep 18 ticks into the aim leaves it stuck; walking in mashing B it is struck (or stuck
  behind him), never hitting him; mashing B where he stands he swats the incoming needle; a jump
  4 ticks into the aim is never hit, one at 12 stomps it as it dives.
* **Homes** (`layout.CRITTERS`, tested in `tests/skerries.test.js`: each on its floor, its
  circle on its level and dry (a crab's where it can stand: the bar's 88 deep, wading allowed
  there only; the islet's ring a little narrower than its circle), a meadow critter's leash on
  level, a knockback toward home safe from anywhere he can stand in it, every same-level route
  corridor (`tests/helpers/skerriesCorridors.js`) at least fight + 150 away, 1200 from the
  arrival, the meadow's circles north of z 4800, no two circles touching, the mosquitoes'
  patrols over their level and clear of walls, the real follow camera never trapped round
  them):

  | id | kind | home (x, z), floor | fight / leash | notes |
  |---|---|---|---|---|
  | `frog_north` | frog | (150, 2650), meadow 150 | 500 / 560 | `calm` 1.3: the first one met, coming back from the jetty's foot; the maypole's approach 738 away |
  | `frog_west` | frog | (−1350, 4100), meadow 150 | 500 / 560 | by the butterflies west of the maypole; the maypole 832 away |
  | `mosquito_south` | mosquito | (−150, 4300), meadow 150 | 400 / 500 | over the south meadow; roam 160 |
  | `mosquito_cottage` | mosquito | (1000, 4450), meadow 150 | 350 / 450 | south of the red cottage; roam 140 |
  | `crab_bar` | crab | (700, 400), sand bar −88 | 330 / 370 | `wade`, `scale` 1.25, `stand` 40 (its tin's bands clear of the water): the Sound's wading rest stop; hidden while he swims |
  | `crab_islet` | crab | (1180, −5480), first terrace 300 | 300 / 340 | the terrace's north-east ring, a reward for exploring it |

* **Originality**: original designs with English names (the Swedish ones only here). The tin
  is brandless (plain bands, no lettering, no fish). Mechanics only (stomp, punch, a coin); no
  flip-on-its-back crab, no pop-up-and-hide loop, no existing enemy's shape; dizzy marks are
  white twinkles.
* **Preview**: `/preview.html?m=critters` (`&kind=frog|crab|mosquito|all`,
  `&pose=idle|tell|strike|stuck|dazed|defeat`, `&t=N` ticks into the pose's state, `&yaw=`,
  `&dist=`, `&spin=1`): the three side by side on grass by a strip of water, lit as the course's
  actors, the camera on the middle of what is posed (each one where its pose took it, with its
  reach round it and its danger ring, from the ground to the highest top) and far enough back
  that all of it fits the frame. Every
  pose comes from the critters' own steps: each kind is a manager of its own with a stand-in
  hero in its window, stepped into the pose's state (he steps aside once it has locked on for
  the stuck poses, drops onto it for the defeats).
* **Tests**: `tests/objects-critters.test.js` (node: the meshes and the shared models; the idle
  critters with no queries and no sparkles (the frogs' rings, the crab in its tin, the
  mosquito's patrol as its closed form), the same every run and after a reset; engagement and
  release (the crab sidling home into its tin, the mosquito back onto its patrol), a hop in the
  air landed first; the frog's tell (its exact length, calm too), the lock and the locked yaw,
  the marker (its size, colour and steady start, strike after strike), one wedge by its own
  rule, the leap's peak; every away case and the warp hold through ObjectManager, the crab's
  and the mosquito's tells called off too; the token; defeat in every live state of every kind,
  the tie, the coin, a plain bounce off the crab and the mosquito (the crab's and the
  mosquito's coin 11 ticks after a stomp, the mosquito poofing where it was; a punched one
  deflating, falling and poofing on its floor); a stomp in the air, the wreath's flight and
  burst, a tumble off the camera's line, the daze's twinkles; the knock-safe rule, turned round
  a critter standing in his way home (its far side first, else its near side; never through
  it, a stuck crab never shoved by him flying back); the frog's leash, water (a pool on its own
  level too) and drop for its hops and its target (half way, the puzzled cancel) and the strike
  window; the crab's window from any distance at both sizes, its locked heading and claw, its
  lunge of 72 at both sizes hurting only from pinch tick 2, never into deep water (a pool on its
  level; a wading one into a shallow pool, never deeper than 95, and knocked over at a deep edge
  it glances off along it) or off a drop; its tell never hidden behind him from the camera (it
  sidles off the camera's line first, or winds up after `LINE_WAIT`); a wading crab at the sand
  bar's depth (hidden, its yellow band over the water, its eyes on a swimmer who never wakes it;
  stomped or knocked over, its dented tin floating over the water, standing on its legs); the
  mosquito parking and aiming only 200 to 240 from him (the plan's numbers), up to 9 a tick,
  never backing off, held in its leash (driven out to it), sliding along a wall, no tell with his
  feet off its level, its needle hurting only low and on the ring, its struck capsule running to
  the needle's tip only in the dive, stuck for 60; the token with a crab (back at the pinch's
  end; a crab and a frog both after him never wind up at once); let go mid-strike (the pinch,
  the dive and the stomp window finish first, the token back, no ring left); the hit shapes (the
  crab's capsule riding its lift, a stuck mosquito's `STUCK_R`, every kind's `STOMP_LOW`); the
  lost-life edge and reset; the blob shadows; the three models' sizes, triangles and normals,
  the crab's planted feet, the eyes and flowers clear of what they sit on, each part in its own
  model's branch of the shader, the raised claws turned to open forward; the hot paths; the
  fairness rows with the real Player for all three; the sounds and the shared gate, the idle
  whine rare and quiet; the bump at the leash's rim (a crab chased onto its rim sliding round
  him at nearly arm's length, never more than `BUMP_STEP` a tick past his pace), against a wall,
  in a windup and off a dying hero, the crab and the stuck mosquito pushed aside, a hovering
  mosquito once his head reaches it, never mid-strike or in the aim; the state vocabulary),
  `tests/skerries.test.js` (the homes, above),
  `tests/skerries-routes.test.js` (no route wakes one), `tests/skerries-critters.test.js` (on the
  real course: frog_north notices him, hits him once, lets him go, is stomped and heals him with
  its coin; a life lost by frog_west sends the frogs home; mosquito_south's ring under him and
  its hit, stuck in the turf when he steps aside and popped with a punch, never a wedge to a
  B-masher, bumped aside (never inside him) as he walks in under it and stomped with a held jump
  from beside it; crab_bar hidden while he swims round the bar (its yellow band over the water,
  its eyes on him), awake as he stands up on it, knocked over by a ground pound and stomped
  (its tin floating over the water all the way), its coin picked up standing; crab_islet's
  pinch by the terrace's rim sending him back onto the terrace, never through the crab),
  `tests/areas.test.js` (all six
  back after every arrival and GAME OVER; none in the hall or on the grounds; no hit while a
  warp runs), `tests/audio-sfx.test.js` (the thirteen critter sounds).

### Sparrow Lane (`src/world/lane/*`)

The second course, through the hall's east door with the little house on its plaque: a quiet
residential cul-de-sac on a golden October afternoon, Jonas's own street. He comes out of his
own black front door onto the grass-paver path of his long red house; the course's star waits
over the ridge of his roof, in view from the first second. Up the hill across the street stand
split-level villas behind grey block walls, along his side long low chain houses linked by flat
roofs; a turning area at the east end, the junction at the west. Cars stand on the drives (his
own two by the carport), flags fly over the gardens, a little blue sparrow stands on his
mailbox, and in a garden up the hill a trampoline throws him up toward a secret 1-up. Nothing
here hurts: no critters, no water, no death floor. Its environment has **two looks**: the classic
N64 look below, and a realistic one (physically lit, its own sky, real shadows, procedural PBR
textures, its own detailed geometry: real tile roofs, leaf-card trees, lofted cars, grass blades:
see "Realistic look (Sparrow Lane)") swapped in once built, with exactly the same colliders;
Jonas and the course's objects keep their classic look in both.

`world/lane/layout.js` holds the anchors in the course's local frame, the **street frame**: +x
along the lane's long straight toward the turning area, +z across it toward the dad's side, −z up
the hill toward the forest, the road at y 0 (world = local + (−60000, 0, 0)). Everything is drawn
at **1.5 times its real size** (`SCALE` 150 units a metre: a 6 m carriageway is 900 wide, room for
the follow camera between kerb and walls), measured off an aerial view in the street frame (the
houses set parallel to the street, the chain houses' lengths trimmed to fit end to end; the real
lane's gentle climb dropped: the road is flat). `world/lane/build.js` builds the course
(`buildLane(layout)`, the WorldPart `'lane'`): the ground, the kerbs, the terraces, the forest's
bank and the boundary, writing into its kit the houses through `world/lane/houses.js` (`house(kit,
h)` by `h.kit`: `'villa'`, `'chain'`, `'garage'`; `link`, `carport`), the dad's front door through
`world/lane/door.js` (`frontDoor`, `doorLeaf`) and the props through `world/lane/props.js`
(`buildProps`); `world/lane/textures.js` paints its three textures of its own (`asphaltTexture`
and `panTileTexture` 64 × 64, `renderTexture` 32 × 32; the rest reuses the terrain's grass,
masonry and flagstones, the castle's stone bricks and wood, the skerries' painted planks, the
trees' leaves).

```
                               -Z (uphill: the forest)
        ┌──────────────── forest bank, firs ──────────────────────┐
        │ north_west   north_1  north_2  north_3  north_4  north_5│
        │  (motorhome)   ┌wall┐  ┌wall┐  ┌wall┐  ┌wall┐ ╭── east_ │
   west │ L1 junction ╲── street ── pavement ──────────── turning │ east_house
        │  trees  F3   ╲  south_1 ┤link├ DAD ├carport┤ south_2 area│  F2
        │ south_west    hedge   mailbox, red tree  bins      footpath ╲
        └──────── back hedges ────────────────────────────────── barrier
                               +Z (the dad's side)
```

* **The ground** (`ROAD`, `TURN`, `KERB`, `PAVEMENT`, `FOOTPATH`): the carriageway (half width 450
  round a centreline polyline: the west leg from the junction, a bend of three short segments,
  the long straight at z 0, mitred) and the turning area (a 16-sided disc r 1150 at (3500, −250))
  at y 0; everything else a step up at `GROUND` 22 (walked up without a jump): the north
  pavement (paler asphalt, 450 … 700 off the line, along the bend and the straight), the drives
  (asphalt; the villas' notches cobbled), the dad's grass-paver path, the footpath (450 wide, out
  of the turning area's south-east rim, a low two-rail barrier across it 1300 along: the play
  space's end) and the lawn. The lawn is drawn as 2000 tiles with every road and hard surface
  (and the terraces) cut out of them (castle/geom.js `subtractConvex`, after a separating-axis
  test, each piece rid of repeated corners), so nothing lies over anything; the same pieces are
  its colliders (grass; the road and hard surfaces stone) wherever Jonas can be (the dad's drive
  darker under the carport's roof, the link's own short drive, the dad's patio of grey slabs
  behind the house). Granite kerbs
  run along every edge of the road's pieces that is the road's edge (a face from the road up and
  a strip on top), dropped (asphalt grey) in front of the drives; their 22 needs no collider (under
  the knee probe). Out past the junction the road runs on into the fog with the side road (drawn
  only).
* **The terraces** (`NORTH`, `PLOTS_N`, `STEPS`): the five villas' gardens behind a retaining wall
  of split-face blocks (a paler coping along its top) from the pavement (z −700) up to `TERRACE`
  150, flat back to z −3400, then rising 1 in 4 to 300 at the forest's edge (z −4000); along the
  turning area the wall follows an arc of r 1400 round its middle, then runs on east at z −1300
  (`wallZAt(x)`). Each plot is convex blocks (their fronts straight, 300 long round the arc), cut
  by its drive notch (cobbles at 22 from the wall back to the villa's garage door, block walls
  either side) and its steps (five drawn steps on a smooth `not_slippery` ramp up from the
  pavement, a dark railing on their drive side); where two blocks' fronts differ, the one nearer
  the street shows its side. Behind them the forest's bank rises to 1500 and on, far out into
  the fog, to a crest 4100 high (drawn only; the wedges where its strips turn a corner filled),
  so no camera sees its far edge against the sky.
* **The houses** (`HOUSES`, `houses.js`): a record is a footprint `w` along its own u by `d` along
  its w, turned by `yaw` (u runs (cos yaw, −sin yaw), w (sin yaw, cos yaw); its front the +w face),
  so the west end's houses, set at an angle to the street, are built like any other (`frame(h)`).
  **Villas** (`VILLAS`, north_1 … north_5, 1800 × 1500, the split-level brick houses: white render
  to 412 with the garage door at drive level, red-brown brick to the eaves at 822, plain, arched
  and bay windows, an arched front door at its garden's level, a hipped roof of pan tiles, 27°, to
  1204, wide eaves (110) over a dark soffit; north_3 a balcony on its west gable, solid, 390 over
  its side yard; north_5 the basketball hoop, see "Props"); **north_west** (white render to its eaves at 462, a light grey pyramid roof with
  two roof windows, a double garage, a low wing behind it, a flagstone drive in front) with the
  **motorhome** on its drive (a white box with a dark window band on four wheels, solid to 522:
  a running double jump grabs its edge, a single one from the drive falls short). **Chain houses**
  (south_west, south_1, `DAD`, south_2 and its wing, east_house): a white brick plinth (135), boards
  to the eaves at 412 (or white brick gable ends with boards in their triangles), black-framed
  windows with a pale glint and white curtains, a black front door with a little black wall
  lamp beside it, a low gable roof (20°) along u, 60 overhangs, TV antennas on three ridges
  (`ANTENNAS`, drawn only); south_west a glazed veranda on its west gable, a brown picket fence and a rail
  fence (slabs). The **link** (south_1 … the dad's, a block to its flat roof at 370) and the
  **carport** (`CARPORT`, the dad's … south_2: its roof slab 345 … 370 on three posts, open toward
  the drive, a back wall of yellow boards: 323 of room under it; wood underfoot).
  **east_garage** (a double garage
  facing the turning area: white render, a white board gable, two dark panel doors, a white brick
  pier) in front of east_house. Each house is one convex collider (its walls and its hipped or
  gable roof); the drawn overhangs have none.
* **The dad's house** (`DAD`, x −1100 … 1600, z 1330 … 2605): Falu-red boards, its eaves at 412,
  its ridge at 644 over z 1967.5; the black front door (`DAD.door`, 150 × 315 at x 0 in a white
  frame: `door.js`, one leaf hinged on its left seen from the path, swinging 1.35 rad into a dark
  vestibule 170 deep, its own mesh, a wall lamp beside it), six windows, the white brick gable
  ends; in the front garden the path, the round bed (`ROUND_BED`: raised 14, red leaves fallen on
  it, ringed with 14 small grey stones) with the red-leaf tree (`RED_TREE`, a small ornamental
  tree: its trunk a climbable pole to 442, six stems out to a round crown of nine blobs in three
  reds from 330 to 700, about the house's height, drawn in render's white, not in the green leaf
  texture, open over the trunk's top where Jonas stands), the rhododendron (solid), a blue pot by
  the door (`POT`), the mailbox; the two wheelie bins against the east gable (`BINS`, solid to
  182) under the car charger (`DAD.charger`); his drive runs on under the carport, his two cars on
  it (see "Props").
* **Props** (`props.js`): lampposts L1 … L7 (grey, an arm and a flat head; prism colliders, but
  for the climbable L1 and L6), white flagpoles F1 … F3 with gold knobs (climbable) flying their
  flags (`FLAGPOLES[].flag`: north_2's blue and yellow cross flag, `FLAG` 300 × 188; long blue and
  yellow pennants on F2 and F3, `PENNANT`; all in `lane-cloth`, streaming along `WIND` and waving:
  `waveFlags(geometry, layout)` returns the per-frame update the part's `update(time)` runs, each
  vertex swung across the wind the more the farther down its flag, in a wave running down it,
  from typed arrays, allocating nothing), hedges (solid leafy boxes with a soft crown, their
  tops walkable: south_1's 165 high along the street, south_2's along the turning area, the back
  hedges at 242, north_3's low box hedge on its terrace), thujas (steep frustum colliders), the
  three big trees at the junction (solid trunks under lumpy canopies), the garden trees
  (`GARDEN_TREES`: an apple tree hung with red apples on north_4's terrace, a birch behind the
  corner house, a red-leaved shrub by the double garage; trunks and the shrub solid), cosmos beds
  on north_3's and north_4's terraces (`FLOWER_BEDS`: tufts of leaves with pink and white
  flowers, drawn only), the mailbox (a black house-shaped box on a post: a brass slot, a door, a
  blank name plate; the little blue sparrow standing on its ridge at the street end: a blue body
  over a white belly, a round head, dark eyes, an orange beak, folded wings, its tail cocked),
  the **cars** (`CARS`, `CAR_KINDS`: generic and plate-less, an SUV, crossovers, hatchbacks, an
  estate and a van: a body up to the belt with its nose and boot rounded off, a glass cabin
  narrowing up to a roof in the body's colour with a pillar down each side, four wheels, pale
  headlights and red tail lights, a soft shadow under it; solid, the body and the cabin each
  convex: a hop onto a bonnet, a grab of a roof's edge. The dad's dark blue SUV and blue
  crossover side by side before the carport, noses out, the way to the bins clear on their
  west; the west neighbour's white one at the link; a silver hatchback, a dark grey crossover, a
  black hatchback and a black van noses in on north_1's, north_2's, north_3's and north_5's
  drives (not north_4's: its coins); a grey estate at the double garage), north_5's
  **basketball hoop** (`HOOP`, a children's one: a post against the wall, a white board 412 …
  522 on an arm, an orange ring and a net; the board and its arm one solid block from the wall: a
  perch, a hop from the van's roof lands on it), the **trampoline** (see below), the motorhome
  (its cab's windscreen, headlights and bumper, a door on its road side, a stripe down both
  sides, a ladder up its back), the footpath's cabinet, the blue sign (a white walking figure
  on it) and its barrier, the forest's firs and birches on the bank (`FOREST`, 34 firs,
  skerries/props.js `fir()`, and 10 birches, white bark ringed dark under yellowing canopies)
  and a ring of firs round the outside of the boundary (`EDGE_FOREST`, 70), drawn only, so the
  camera never looks out on nothing, and two houses down the side road in the fog
  (`SIDE_BLOCKS`, drawn only).
* **The trampoline and the 1-up** (`TRAMPOLINE`, `TRAMPOLINES`, `ONE_UP`): in north_5's front
  garden on the terrace (x 4580, z −1650): a dark mat in a padded blue ring on six legs, r 250,
  solid from the terrace up to its top at 240 (`props.js`); its spring is
  `objects/Trampoline.js` (see "Objects"): every landing on the mat throws him back up with a
  `boing` (`player.bounce(50, 'boing')`), to 578 (feet) without the jump button and to **852**
  every time with it held (`BOUNCE_HELD_VY`), steering from one bounce to the next. The 1-up
  floats at y 1020 over the mat's middle (the gem takes feet from 200 under it): only a held
  bounce reaches it; a jump from the mat (~507), bounces without the button or a running triple
  jump on the terrace beside it (~780) fall short. A sign at the turning area's rim under
  north_5's steps points the way (`trampoline`).
* **Boundary** (`BOUNDS`, `inBounds(x, z)`): invisible walls from −200 up to 4500, facing in, along
  a polygon a little inside the drawn edges (the forest bank, the hedges, the barrier, the firs):
  the camera stops at them too.
* **Entries and exits**: `home` (0, 22, 1156), 174 in front of the dad's front door on the path,
  facing the street, `camYaw` π (the camera in front of him over the lawn, the door shutting
  behind him and the star over the ridge in the picture), walking out 8 ticks, its door
  `'lane_home'`; a lost life drops him in there from 1000 (`RESPAWN`). The dad's front door
  (`DOORS`: `lane_home`, yaw π) takes him back into the hall's `east_2`, as do the star exit and
  the pause screen's leave (`def.leave`, `def.starExit`); `card: true`. `PROBE_Y` 4400 (over
  every roof). `waterLevelAt` is `NO_WATER` everywhere.
* **The star climb** (`STAR`: `lane_star` at (−250, 824, 1967.5), 180 over the ridge, placed):
  from the drive onto a bin, onto the carport's roof, a hop west lands on the roof's south-west
  slope anywhere along the carport's back half (walking into the gable gets him nowhere), up to
  the ridge; or a standing jump within 100 of the front wall grabs the eave; or the red-leaf
  tree's handstand and a flip toward the house with the stick held 4 … 20 ticks. Every fall from
  the dad's roof is harmless.
* **Coins** (`COINS`, 50, each at its floor + 60): down the path, on the mailbox's roof, along the
  street both ways, round the turning area (7), along north_2's and north_3's wall tops, up
  north_3's steps, up north_4's drive, up the side yard between north_2 and north_3, on the
  motorhome's roof, along south_1's hedge, round the junction's lamppost, on the footpath, over
  the bins, on the carport's roof and up the roof's south-west slope. The 1-up over the
  trampoline; no red coins.
* **Signs** (`SIGNS`): `sparrow_mailbox` (`post: false`: the mailbox is the sign, no signpost is
  drawn, its own collider within reach of the read; read from the street side), `lane_corner` at
  the junction facing up the lane, `lane_footpath` beside the blue sign, `trampoline` at the
  turning area's rim. Only "Jonas" is named.
* **Poles** (`POLES`, each with its own side, `camYaw`): L1 (looking along the west leg), L6 (at
  the dad's roof), F1, F2 (west up the lane), F3, the red-leaf tree (the roof ahead). Falls from
  them count from their foot.
* **Look** (`LANE_ATMOSPHERE`): the grounds' fog colour and sky dome (`def.sky`), the fog from 6000
  to 24000, a low warm actor sun 0xffdcb0 (0.66π) from the bake's `LANE_SUN` (−0.16, 0.40, 0.90:
  low in the south-west, so the villas' street faces and the turning area glow while the chain
  houses' fronts stand in soft shade), a warm hemisphere. Lighting baked from `LANE_SUN` with a
  warm tint (ambient 0.6, diffuse 0.55, at most 1.1), with a little painted occlusion: the walls
  darker toward their feet and under the eaves, the soffits dark, the drive under the carport
  0.62, hedges and canopies darker underneath, a soft shadow under each car; each villa's brick
  its own shade. Butterflies over the dad's lawn and north_3's flower beds
  (`BUTTERFLY_SPOTS`), small brown birds (`BIRD_TINT` 0x5a5048) circling over the forest
  (`BIRD_CIRCLES`).
* **Meshes** (13): `lane-asphalt`, `-grass` (also the bank), `-blocks` (masonry: the terraces'
  walls, the steps, the kerbs, the round bed's stones), `-brick` (the castle's stone bricks
  tinted: the villas' upper floors, the white brick plinths and gable ends), `-render` (white
  render and every flat-coloured detail by vertex tint: frames, panes, doors, poles, the bins,
  the mailbox and its sparrow, the cars, the hoop, the trampoline, the motorhome, the antennas,
  soffits, fascias, the vestibule, the red-leaf tree's crown and its fallen leaves, the shrub,
  the flowers), `-boards` (the skerries' painted planks upright: the chain houses' boards and
  gables, the fences, the barrier), `-roof` (pan tiles; the flat roofs' felt), `-cobbles` (the
  flagstone texture: the notches' cobbles, the north-west villa's flagstones, the patio, the
  flower beds' soil), `-leaves`, `-wood` (trunks), `-cloth` (the skerries' sailcloth, both faces:
  the flags, waving), `-signs` and `-door` (the dad's door's leaf, render's material). The part's
  `update(time)` waves the flags. ~21k triangles, ~1.8k collider triangles (stone, grass, wood;
  the steps `not_slippery`), built in ~200–300 ms in node; the course's objects (coins,
  sparkles, shadows, the star, the 1-up, butterflies, birds) within 9 meshes; 36 … 38 draw
  calls from the arrival, the roof, the turning area, the bend and the junction (the E2E budget
  is 55; ~27k triangles drawn with Jonas and the HUD), built in ~130 ms in the browser.
* **Sound** (`def.audio`, see "Audio"): Midsummer Skerries' polska (`skerries`) again; the `'lane'`
  ambience (the grounds' breeze, leaves and distant birds without their waterfall and moat
  laps); no reverb; the trampoline's `boing`. Footsteps: stone on the road, the hard surfaces,
  the roofs and the cars, grass on the lawns, the terraces and the trampoline's mat, wood on the
  carport, the fences, the mailbox and the hoop's board.
* **Privacy and originality** (the repository is public): no photograph's pixels (every texture is
  painted in code), no real street name, no house numbers (the houses go by neutral ids: north_1 …
  north_5, north_west, south_west, south_1, south_dad, south_2, east_garage, east_house), no names
  but Jonas's, no licence plates (the cars are generic shapes without plates or badges), no
  brands; the mailbox's name plate is blank; the hall's plaque is this game's own little house.
* **Preview**: `/preview.html?m=lane` (`src/dev/previews/lane.js`: the course under its fog with
  the grounds' sky dome; `&col=1` the collider overlay; `&door=0..1` the dad's door that far
  open; `&view=overview|arrival|home|roof|west|junction|turn|north|gap|mailbox|drive|trampoline|
  flags|hoop|high`; `&t=` freezes the clock, the flags wave with it).
* **Tests**: `tests/lane.test.js` (node, the course as `buildArea` places it with the real Player,
  camera and objects: the budgets, the arrival (on the path, the camera in front of him clear
  after the walk-in, the star in the picture, the respawn drop onto the path unhurt), no water and
  a floor everywhere inside the boundary, spam from 14 spots and long jumps off the ridge and L1's
  top never leaving it, the dad's house as measured (its slopes raycast at 18 points, the eaves,
  the carport's roof and the room under it), no floor under a ceiling lower than 300 anywhere,
  every coin over a floor, the star, every sign read from in front only (the mailbox with no
  signpost), the six poles grabbed from every open side with the camera swinging to `camYaw` and
  jumps off them unhurt, the side yards walked with the follow camera and C-button swings never
  in a solid, the privacy scan of its sources and signs, the look (the sun, the villas' fronts lit
  over the dad's, his walls Falu red, his roof dark, the red-leaf tree's crown about the house's
  height in several reds), the details (the 1-up over the trampoline's mat, the butterflies and
  birds, the flags waving with their hoists still and allocating nothing per frame) and the cars
  (each on its drive with a floor on its roof and bonnet, clear of the coins and of the way to
  the bins)); `tests/lane-routes.test.js` (scripted input: the star climb, the front eave, the
  red-leaf tree's flip, and the routes round the street, each collecting exactly its coins; the
  trampoline (852 every held bounce with a boing, the 1-up; a jump from the mat, plain bounces
  and a triple jump beside it short of it; bouncing every way in bounds), the hoop's board as a
  perch from the van's roof, the dad's cars as steps up to the carport);
  `tests/objects.test.js` (the trampoline's spring); `tests/audio-sfx.test.js` (`boing`);
  `tests/areas.test.js` (through the east door into
  the lane and back with the doors swinging, a stick held through, the door ids, the star exit,
  the leave, GAME OVER); `tests/areas-browser.test.js` (E2E: `?area=lane`, the full walk through
  it).

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
bottle's mouth leaves it on the dais's top, not hanging under him (`tests/model.test.js`).

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
  a wall's plane, where no wall push moves it out. The move is level (the height limit settles
  y after it), so a sloping ceiling (an overhang's underside, the hall bottle's) is slid along
  where it crosses the camera's height: slid down its slope, the move's level part would still
  run on into it (`tests/camera.test.js`).
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
view.setLook(look | null)         // draw the world through a realistic look (render/real/
                                  // RealLook.js), or classic again; see "Realistic look"
view.addRealActor(object3D, blob) // an actor casting a look's sun shadow (Jonas)
view.setFocus(p)                  // where a look's shadow box centres (per frame: Jonas)
view.compileLook(look, objects) -> Promise   // their programs for a look before it shows
view.toggleRetro(); view.retro    // F2 / R; the retro filter in effect (a look: this visit's)
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
render + 16-bit quantise/filter pass; off = native resolution; with a realistic look set, the
retro TV over it for this visit, never saved), F3 or 4 4:3 pillarbox (never
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

## Realistic look (Sparrow Lane)

The dad asked for his street "as realistic as possible", the character still classic. So
Sparrow Lane's environment has a second, realistic look (`render/real/*`, `world/lane/real/*`;
the plan behind it is the R1 and R2 milestones of the realistic-environment plan), while Jonas, the
coins, the star, the 1-up, the signs' boards, butterflies, birds and the HUD keep their classic
models and materials, and every other area keeps the N64 look.

**Visual only.** The realistic visuals are the classic builders run again with `look: 'real'`
(`buildLane(layout, { look: 'real', materials })`): the same faces, **unbaked** (the vertex
colours are the tints and painted shades; the materials light them), split into meshes by part
(the builders write panes into `kit.glass`, painted parts into `kit.paint`, the dad's paver path
into `kit.path`: in the classic look these are render's and grass's own builders, so its
geometry is unchanged to the byte), roofs with uvs up their slopes (`SlopeBuilder`), lawns' tints
grey (the lawn texture is green), a dim room panel behind every pane. Colliders, poles, signs,
coins, entries and the camera's world come from the classic build only; `tests/lane-real-
build.test.js` checks the realistic build's colliders and collision world are the classic
build's to the byte, and that it draws exactly the classic faces but those it draws itself:
**`REAL_DRAWN`** (`lane/build.js`) names the elements the realistic look builds anew (the
mailbox, the plants, the forest, the chain houses, the cars, the kerbs, the lamp and flag
posts, the fences, the bins, the villas' windows, the garage doors, the toys, the motorhome,
the cabinet); a classic builder asks `kit.drawn(name)` for the kit to draw one into, the kit or
one whose builders draw nothing (`NOTHING`, a no-op proxy) with the same `solids` and `signs`,
so every collider is still made exactly as before. The realistic build also draws the turning
area round (`round`: `plan.js roadPieces({ round })`, 64 sides at the mean of the 16-gon's
radii, the lawns and drives cut round it) while its colliders keep the 16-gon.

**Modules.**

* `render/real/RealLook.js` (`RealLook`): what a frame is drawn through: the HDR scene target
  (half float, MSAA per tier), `OutputPass.js` (exposure 1.3, three's Khronos PBR **Neutral**
  tone mapping, saturation 1.05, vignette 0.15, an 8 × 8 ordered dither), the analytic sky
  (`sky.js`: an art-directed golden-hour gradient, the sun's glow and disc, cirrus; drawn on the
  far plane centred on the camera; its `hazeColor(dir)` is every material's aerial
  perspective), the sky's prefiltered environment (`scene.environment`, intensity 1.3), the
  reflection probe (`probe.js`: one half-float cube capture of the street from over the road in
  front of the dad's house, Jonas hidden, prefiltered: the windows' envMap; taken on the first
  frame after each attach), the sun's soft shadow (PCF, radius 2.5) in a box round Jonas
  (`view.setFocus`), snapped to whole shadow texels across the light so static shadows never
  shimmer, and the light preset (`layout.LANE_REAL`).
* `render/real/materials.js`: `pbrMaterial` (a texture set's albedo × vertex tint × colour,
  normal map, ORM: occlusion and roughness), `plainMaterial` (paint, cloth), `glassMaterial`
  (ior 2.2 for double glazing's ~14 %: its F0 set in the standard material's lighting as the
  physical material would compute it, without that class in the bundle; roughness 0.02, its
  reflection added at full strength over the room at 1 − 0.45: a premultiplied output),
  `classicLook` (the signs' unlit boards, below), all but the last through `hazeChunk` (below);
  fixed `customProgramCacheKey`s ('real-haze', 'real-glass'), so a handful of programs serve
  the lane. `world/lane/real/look.js` holds the lane's catalogue (a set, cover, colour,
  roughness and normal strength per mesh: the boards' Falu red is the house's own tint × a
  light neutral board texture) and its build (`LANE_REAL_AREA = { jobs, build }`, the lane's
  `def.real`).
* **The clamp rule**: every realistic material's lit colour is clamped to 32 before the haze
  (`CLAMP_GLSL`, in `hazeChunk`). A GGX sun highlight on the glass is ~1e6, Inf in the probe's
  half-float cube, and the probe's prefilter smears it into NaN: every window went black. The
  clamp also stops MSAA fireflies. `tests/real-materials.test.js` checks each one has it.
* **Textures**: `render/real/texgen/noise.js` and `texgen/sets.js` paint PBR sets in code from
  seeded integer-hash noise (boards, brick, tiles, asphalt, grass, pavers, render, soil, granite,
  bark, the leaf atlas, fir): pure functions on typed arrays, RGBA8 albedo (sRGB) / normal
  (tangent space, OpenGL) / ORM, each tiling (but the cards' cut-outs), deterministic to the
  byte. They run in **the realistic look's worker**
  (`render/real/laneRealWorker.js`, a module worker like the title logo's), which keeps them in
  an **IndexedDB cache** (`texCache.js`: database 'castle-real', store 'tex', key
  `${TEXGEN_VERSION}:${jobKey}`, 48 MB, least recently used out, other versions first; any error
  is a miss). `TEXGEN_VERSION` is bumped by hand whenever a generator's output changes:
  `tests/real-texgen.test.js` pins each lane set's hash at 64 px with it. `textureStore.js` (main
  thread) asks the worker, keeps the sets for the session and makes the `DataTexture`s
  (repeating, mipmapped, anisotropic per tier; clones share an image). No photo pixels, no
  downloads: every colour is a number in the generators or the catalogue.
* `render/real/tier.js`: the tier from the device (phones and tablets **low**; a discrete or
  Apple-silicon GPU **high**; other desktops **mid**; `?tier=` overrides), and per tier:

  | | high | mid | low |
  |---|---|---|---|
  | render size | CSS × min(DPR, 1.5), ≤ 2.4 MP | CSS × 1, ≤ 1.6 MP | CSS × 1, ≤ 0.9 MP |
  | HDR target | RGBA16F, MSAA 4 | MSAA 2 | none: straight to the canvas, three tone maps per material |
  | shadow map, box | 2048, ±2600 | 1024, ±2200 | 1024, ±1600 |
  | textures | 512 (256 for render, granite, bark, fir; the leaf atlas 1024) | 512, the lawn 256, the leaf atlas 512 | 256 (the leaf atlas 512) |
  | anisotropy, probe | 8, 256 | 4, 128 | 2, none (the sky's environment) |

  Budgets per frame (the shadow pass included; checked in headless Chromium by
  `tests/lane-real-browser.test.js`, frame times by hand on real hardware): high ≤ 160 draw
  calls, ≤ 900k triangles, ≤ 20 realistic programs; mid ≤ 130 / 450k; low ≤ 100 / 200k. The
  governor that steps down from measured frame times comes later.
* `render/real/RealAreas.js` (main makes one; `AreaSwitch` uses it): the tier, whether
  realistic looks may run (fallbacks to classic, logged once, the F1 line saying why:
  `(classic: building | chosen | <what failed>)`: `?look=classic`, G in the game, the worker or a
  build failing; without float render targets the tier drops to low), the
  texture prefetch at boot (idle priority), and an area's build (its sets, `def.real.build`, its
  programs compiled for the look: `view.compileLook`). Under `?test=1` the realistic look is
  opt-in (`?look=real` or a `?tier=`), so scripted tests never see the look change mid-run.

**Its own geometry (R2).** What the classic builders no longer draw comes from the realistic
look's worker (`laneRealWorker.js`) as typed arrays: `world/lane/real/detail.js`
(`buildLaneDetail(layout, tier)`, a `{ area, tier }` job: `textureStore.detail`) builds pure
geometry with `geo.js` (`Geo`: non-indexed positions, normals, world-unit uvs, linear colours
and a `sway` weight; quads, boxes, cylinders and arcs of them, ellipsoids, lofts) from
`layout.js` alone, one buffer set per material, and `look.js` wraps them in meshes (the group
`lane-detail` in the realistic part) in its detail catalogue (`DETAIL`). Nothing of it runs on
the main thread but the upload.

* `house.js`: the chain houses in full: a white brick plinth 2 proud of the boards (a sloping
  flashing), real openings, windows sitting in the wall (a black casing proud, a reveal 10
  deep, two casements with glazing bars, the glass over white curtains and a dim room box, a
  sloping sheet-metal sill), doors with a lamp (the dad's: `door.js`'s opening and swinging
  leaf, its frame black, a glazed side light), and the roof: **pan tile courses**
  (`tileCourses`: courses 54 up the slope, rolls 45 across with analytic normals, each nose 3.2
  proud of the course below, every quad wound to face out) on the houses `LANE_REAL.tiles`
  names (the dad's and his neighbours'), the tile set's normal map on the others; a soffit, a
  fascia, half-round gutters with downpipes down the wall, barge boards and verge rolls, a ridge
  cap. The courses cast no shadow themselves (their rolls would shimmer at the shadow map's
  texels): a flat stand-in under them does (`shadowCaster`: no colour, no depth, both faces).
* `villas.js`: the villas' windows (white surrounds standing proud, sashes, stone sills),
  sectional garage doors, gutters and rounded hip and ridge caps over the classic hipped roofs.
* `foliage.js`: **leaf cards**: clusters of two crossed alpha-tested cards (the leaf atlas's
  cells: rhododendron, hedge, tree, red) on shells over the classic shapes (each canopy's
  blobs from the classic builder's own seeded stream, so every plant stands where its classic
  blob stood): the hedges (single cards over their faces and tops), the thujas, the junction's
  trees, the apple tree (apples), the birches (white bark, an airy yellowing canopy), the shrub,
  the dad's red-leaf tree (red sprays, its fallen leaves on the bed), the rhododendron down to
  the ground, the pot plant, the flower beds; dark cores where a real bush is dense; bark
  trunks and limbs. The forest's **firs** are one card spruce (`firGeometry`: drooping branch
  cards in whorls, a dark inner cone) instanced where `spots.js forestSpots` plants them (the
  classic forest draws its cones from the same list), plus a far tree line where the ground ends
  in the haze (`extras.js treeLine`, casting none).
* `cars.js`: **lofted cars** (rounded sections, the bonnet sloping to a rounded nose, the sill
  rising over the axles; a greenhouse of slices, glass on its straight runs, pillars in the
  body's colour; rounded tyres on dished five-spoke rims in dark arches; lamps, mirrors,
  handles; no plates, no badges): lacquered paint (`plainMaterial({ clearcoat })`: three's
  clearcoat lobe switched on in the standard material, `USE_CLEARCOAT`, without the physical
  material's class), dark opaque glass with ior 2's F0; both on the sky's environment (the probe,
  taken in front of the dad's house, painted the red wall into every bonnet as rust).
* `grass.js`: the **grass**: one clump of blades (`grassClump`: 4 blades of 3 segments on high,
  3 of 2 on mid, none on low) instanced over a 128 × 128 grid of 12-unit cells (80 × 80 on mid)
  that follows the camera (centred ahead of it, snapped to whole cells: `look.js grassGrid`, one
  uniform a frame); the vertex shader (`materials.js grassMaterial`) places each clump in its
  cell at a hash of the cell, turns and sizes it, stands it on the **lawn mask** (`lawnMask`: a
  1024 × 512 RGBA8 map of where blades grow and the ground's height there, built in the worker
  from `layout.js`: none on the road, the pavement, paths, drives, the round bed, the mailbox,
  bushes, hedges, houses, posts, or where the ground steps) and shrinks it to nothing off the
  lawns and toward the grid's radius (760 on high: no pop).
* `garden.js`: the mailbox (a chamfered charcoal board box, its roof boards, flap, blank enamel
  plate, framed door, knob, concrete foot) and its carved wooden bird painted blue (white
  breast, yellow beak, glossy eyes, raised wings); **granite kerbs** (`kerbs`: stones ~150 long
  with joints and a chamfer along every edge of the road, the turning area round, dropped flush
  at the drives: `plan.js` gives both builds the same road pieces); mended patches, a sealed
  crack, manhole and drain covers; the round bed's field stones. `street.js`: smooth tapered
  steel lampposts with a curved arm and luminaire, white flagpoles with a gilt ball and halyard
  (the flags their classic waving cloth), real pickets and rails, rounded wheelie bins.
  `extras.js`: the trampoline, the hoop, the motorhome, the cabinet.
* **Materials** (`render/real/materials.js`): `foliageMaterial` (an atlas with coverage-keeping
  mips; both faces lit by the card's own outward-bent normal, no back-face flip; the sun through
  the leaves from the shadowed direct light; alpha to coverage under MSAA; each vertex swaying
  along `layout.WIND` by its `sway`, from a wind uniform the part's update runs), `grassMaterial`,
  the lacquer, `shadowCaster`. Texture sets added in the worker: the leaf atlas (`leaves`, 1024 on
  high: four 512 cells), `fir`, `bark` (and a birch's), `granite`; cut-outs get mips that keep
  their coverage (`noise.js coverageMips`: each level's alpha scaled so as many texels pass the
  test as at full size; else distant foliage thins to nothing), uploaded as the
  `DataTexture`'s own mipmaps.
* **Tiers**: low (phones) halves the leaf clusters, has no tile courses (the normal map), no
  blades, plainer windows and cars, fewer materials (`LOW_MERGE`) and only the houses and the
  cars casting the sun's shadow (`LOW_CASTERS`); mid has 4 segments a roll and the smaller grass
  grid. Measured in headless Chromium at the five views: high 98–119 draw calls, ~790k triangles
  (393k of them the grass grid's, counted whole), 12 realistic programs; low 55–91 calls, ~150k.
  The realistic part hangs under its area's root only while shown (`Area.showReal`): the
  renderer's classic warm-ups compile whatever is under the root, hidden or not.

**The switch.** `AreaSwitch.get` starts an area's realistic build in the background as it builds
the area; once ready the area holds it (`Area.setReal(part, look)`: a second WorldPart under its
root, hidden) and, while it is the current area and realistic looks are wanted, `_look` shows
it (`Area.showReal`: its update and door follow), hides the grounds' sky dome and calls
`view.setLook(look)`. `_swap` drops any look first (`view.setLook(null)`), then the next area's
atmosphere and look. `setLook(look)` snapshots every field a look may touch and `setLook(null)`
writes it back, so leaving restores the renderer exactly:

| state | classic | realistic (the lane) |
|---|---|---|
| `renderer.shadowMap` enabled / type / autoUpdate | false / – / true | true / PCF / true |
| `sun.castShadow`, `sun.shadow` (map, mapSize, radius, biases, camera box) | off | on, per tier, radius 2.5, bias −4e-4, normalBias 3 |
| `sun.position`, `sun.target` | `setAtmosphere` | over the focus along `LANE_SUN` |
| sun colour and strength, hemisphere, fog | `setAtmosphere(def.atmosphere)` | `LANE_REAL.atmosphere`: (1, 0.82, 0.62) × 3, sky 0xcfe0ff, ground 0x5a6040, 0.9; fog in the haze's horizon colour, 3000 … 45000 |
| `scene.environment` / intensity / `background` | null / 1 / fog colour | sky PMREM / 1.3 / null (the sky draws) |
| `renderer.toneMapping` / exposure | none / 1 | none (the output pass) or Neutral (low) / 1.3 |
| retro filter | the saved setting | off; F2 / R: retro over realistic for this visit (`lookRetro`), never saved |
| pixel ratio | min(DPR, 2) | the tier's |
| Jonas | no shadow; blob shadow | casts and receives the sun's shadow; blob at 35 % (`REAL_BLOB`) |

The signs' boards stay unlit and baked, their colour turned back through the exposure and the
Neutral curve (`materials.js classicLook`: exact below its shoulder; on the direct path simply
not tone mapped), so they come out of the output pass as the classic look draws them. Keys: G
toggles "Classic street" (the classic look, this session; `AreaSwitch.setClassic`); F2 / R in
the realistic look is the retro TV over it for this visit. The pause legend's retro row says so
in such a course (`REAL_LOOK_ROW` 'R / F2 / G  Retro / Classic', `CLASSIC_LOOK_ROW` 'Retro /
Realistic' while classic by choice: `hud.setLook`), keeping the legend's twelve rows and widths. A frame with a look (`N64Renderer.draw`'s one branch, `look.draw`): the scene into
the HDR target, the output pass to the canvas; with the storm's grade, a flash or the meltdown
the output pass writes into the grade's target and `GradePass` finishes as in native mode; with
retro over realistic the scene is drawn at 240 lines and goes through the output pass into the
retro target and `N64Pass` (a real street on a 1998 TV); the recorder's capture sizes it like any
frame and its frame hook sees the finished canvas; a `setView()` scene bypasses it. The F1 line
reads `real 1600x900 msaa4 high`.

**Tests**: `tests/real-texgen.test.js` (every lane set pinned at 64 px with `TEXGEN_VERSION`,
deterministic, periodic noises and seams, plausible albedo / roughness / normals, the cut-outs'
mips keeping their coverage, the high tier's sets within 3 × 700 ms in node),
`tests/lane-real-build.test.js` (the colliders and collision world byte-identical to the
classic build's, exactly the classic faces but `REAL_DRAWN`'s, the split by part, the rooms,
unbaked tints, grey lawns, roof uvs up the slopes, no NaN, the catalogue's and the detail's
materials and shadow flags, the firs instanced, the grass following the camera, the pause
legend's look row, the realistic sources' privacy), `tests/lane-real-geometry.test.js` (the
worker's geometry: deterministic, within each tier's triangle budget, every face wound the way
its normals point, the walls open at every window and door, the tile courses on the classic
roof planes, the firs on the classic forest's spots, the lawn mask, the cars on their wheels
inside their colliders and their bodies and tyres closed, the bird on the ridge), `tests/real-materials.test.js` (the haze and the
clamp in every material's patched shader, the glass's F0 and premultiplied output, the leaf
cards', the grass's and the lacquer's patches, shared uniforms, ≤ 20 programs, the signs'
inverse tone mapping), `tests/lane-real-browser.test.js` (E2E: the swap, the pixels, the grade
and the recorder's framings, the counts and a blue sky at five views on high and on low, G, the
low tier, `?look=classic`, and the exact restore of the renderer after a visit, with and
without F2); `tests/net-relay-build.test.js` (the worker chunk).

**Bundle**: the generators and the realistic geometry builders are pure code in the worker's
own chunk (`laneRealWorker-*.js`, ~80 kB, no three.js, no imports: under 160 kB); `main`
carries only the renderer side (R1 +~29 kB, R2 +~9 kB: 1,682,765 bytes, under the
1,700,000-byte budget). `tests/net-relay-build.test.js` checks both.

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
  or room tone. `'lane'` (Sparrow Lane) is the grounds' air, leaves, tree birds and distant
  chorus without their waterfall and moat laps (those are the grounds' own, at their layout's
  spots: in the lane only the chorus sings). The pastoral bed plays only where the profile has it and not in AI RACE. The
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

`layout.SIGNS`: `[{ id, x, z, yaw, y?, post?, pages: [string] }]`, wooden signposts built by props
(the readable board faces `yaw`; a sign with `y` stands on that floor instead of the lawn: the
one on top of the keep), with original text. Other areas list theirs in their own layout (the
Great Hall's, Midsummer Skerries' and Sparrow Lane's `SIGNS`, each with its `y`, drawn by their
builders with the same `props/decor.js` `addSignpost`; `player.setWorld` hands Jonas the current
area's). A sign with `post: false` has no signpost: the thing it stands for is the sign (Sparrow
Lane's mailbox), drawn and solid by its builder, its collider within reach of the read. Reading works
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
  landing or flight can hit something this tick (`kind` is the action name). `player.bounce(vy = 50,
  sound = 'stomp')`: bounce up off an enemy Jonas landed on, or off a trampoline (action
  `'jump'`, sfx `sound`: a stomp's `stomp`, a trampoline's `boing`).
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
objects.update({ player, frame, camera, warping })   // 30 Hz: collection, AI (warping: a warp
                                            // runs, main's areas.busy: the critters hold off)
objects.animate(time, alpha, threeCamera)   // render: spin, billboards
objects.reset()                             // new game: every pickup back (see below)
objects.ambient(time) -> alpha              // title backdrop clock (animate() calls it itself)
objects.started                             // an update() ran since construction / reset()
objects.setAiRaceButton(on)                 // the title's game choice: false = no AI RACE button
                                            // (AiButton.setPresent: 'gone', colliders parked; kept by reset())
objects.enter(player)                       // the hero was just placed in this area (see below)
objects.door, objects.doors                 // the castle door (or null); every door (Door.js)
objects.critters                            // a course's critters (Critters.js), or null
objects.trampolines                         // a course's trampolines (Trampoline.js), or null
objects.spawnCoin(x, y, z, minY?)           // a run-time coin (minion and critter drops), at
                                            // least at minY (CoinField.spawnCoin)
```

Critters (`layout.CRITTERS`, see "Critters" under Midsummer Skerries): `objects.critters` is a
`Critters` manager (`Critters.js`, the shared framework: engagement, the one-attacker token,
the `AWAY` table, the hit tests, the bump, the knock-safe hurt, the danger markers, the poof and
the coin; `critters/<kind>.js`, each kind's state steps as plain functions `(self, c, player,
hero)`; `critterModel.js`, the three models in one type-masked InstancedMesh and the marker
mesh). The states are lowercase strings (`STATES`: per kind, each calm, engaged or a defeat;
`HITTABLE` = every non-defeat state). It ticks in `_step` after the cannon with `hold =
dialogOpen || warping`, draws in `_draw`, and `reset()` and `enter()` reset it. Its coins come
out of the drop slots (`COIN_DROPS` 6: one per critter); its blob shadows take one slot each
after the minions' and the boss star's.

Trampolines (`layout.TRAMPOLINES`, `[{ x, y, z, r, vy }]`: a mat's middle, its top at `y`;
Sparrow Lane's): `objects.trampolines` is a `Trampolines` (`Trampoline.js`), the spring only (the
course draws the trampoline and makes it solid; it has no mesh of its own). It ticks in `_step`
after the critters with the hero's remembered last tick: on the tick his feet come down on a
mat (airborne the tick before, standing now within `r` of its middle and within 4 of its top)
it calls `player.bounce(vy, 'boing')` (with A held he rises at `BOUNCE_HELD_VY`), so he bounces
again on every landing until he steers off. `update()` allocates nothing.

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
| `sfx` | `{ name, pos?, volume?, pitch?, pan?, quiet?, deflate? }` | anyone; audio plays it (`pan`: a non-positional sound's stereo position, the face screen; `pitch` multiplies its pitch; `quiet: 1` a critter's idle call, the recipe's own softer level; `deflate: 1` a critter's other defeat variant) |
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
ambience itself, not through `'sfx'`), Sparrow Lane's trampoline's `boing` (the Player's, as
`player.bounce(vy, 'boing')` throws him back up), and Rustmaw's tail grab's
`tail_grab, boss_haul, boss_whoosh, boss_throw, boss_slam, boss_crash, boss_splash`
(`boss_whoosh` once per whirl turn, its `pitch` rising with the spin), AI RACE's meltdown's
`meltdown_klaxon, meltdown_ignite, meltdown_flash, meltdown_blast, meltdown_ring`, and the face screen's
`face_grab, face_stretch, face_boing, face_boop` (with `pitch`, `volume` and `pan`), and the
critters' (`Critters.js`, positional): the Wreath Frog's `frog_croak` (pitch 1.25 as it notices
him, 0.7 puzzled, 0.8 dazed; `quiet` its idle croak), `frog_puff` (the windup), `frog_leap`,
`frog_land`, `frog_pop` (a defeat; the wreath flying off); the Tin Crab's `crab_clack` (as it
wakes and through its windup; `quiet` a softer pair), `crab_snap` (the pinch), `crab_tonk` (a
defeat: the tin bonked); the Mosquito's `mosquito_whine` (pitch 1.3 as it spots him; `quiet`
its idle whine), `mosquito_aim` (a 'ting' and the rising whine of its tell), `mosquito_dive`,
`mosquito_stuck` (its needle in the turf; `quiet` the later tugs, pitch 1.6 pulling free),
`mosquito_pop` (a defeat; `deflate` when punched: a 'pfrrrt').
Unknown names must be ignored silently.

## Tooling

* `npm run dev` — dev server. `npm test` — node unit tests (`tests/**/*.test.js`).
  `npm run build` — production build into `dist/`: the game as one bundle by design (1,682,765
  bytes with Sparrow Lane, its details and its realistic look's renderer side, ~545 kB gzip,
  plus the ~13 kB title-logo worker and the ~80 kB realistic look's worker; the size warning
  limit is 1700 kB, `GAME_CHUNK_LIMIT_KB` in `vite.config.js`, raised from 1600 for the second
  course: the hard budget is 1,700,000 bytes), then the phone's `pad.html` built separately
  into the same folder (~85 kB, its own copy of the touch controller and protocol).
  `npm run preview` serves it with the phone relay.
* `node tools/shot.mjs --url "/preview.html?m=<area>&cam=x,y,z&look=x,y,z" --out shots/x.png`
  — headless screenshot of a preview page (prints browser errors).
* `node tools/shot.mjs --url "/?test=1" --actions '[{"step":30,"input":{"stickY":1}},{"shot":"shots/a.png"},{"eval":"__game.snapshot()"}]'`
  — scripted full-game run. Actions: `{step, input}`, `{eval}`, `{shot}`, `{wait: ms}` (for
  real-time runs such as `/?skipTitle=1`).
* `/preview.html?m=world` shows the whole level without the player; `/preview.html?m=castle`
  the castle alone (`&col=1`, `&door=0..1` its front door that far open); `/preview.html?m=hall`
  the Great Hall alone (`&col=1` its colliders,
  `&view=overview|entry|bottle|fire|vault|roof|apse|toys`, `&lamp=1`, `&door=0..1`);
  `/preview.html?m=skerries` Midsummer Skerries (`&col=1`, `&lit=1`,
  `&view=arrival|skerries|islet|gallery|bay|east|chimney|bridge|meadow|wreck`);
  `/preview.html?m=lane` Sparrow Lane (`&col=1`, `&door=0..1`,
  `&view=overview|arrival|home|roof|west|junction|turn|north|gap|mailbox|drive|trampoline|flags|hoop|high`);
  `/preview.html?m=critters` the course's critters, each pose reached through their own steps
  (`&kind=frog|crab|mosquito|all`, `&pose=idle|tell|strike|stuck|dazed|defeat`, `&t=N`,
  `&yaw=`, `&dist=`, `&spin=1`).
* `node tools/shot.mjs --url "/?test=1&mute=1&area=skerries" --actions '[{"step":60},{"shot":"shots/arrival.png"}]'`
  — the game straight in an area (`&entry=` for another of its entries; `__game.enterArea(name,
  entry)` switches at once mid-run). More recipes:
  * the castle door swinging open as the iris closes: `--url "/?test=1&mute=1" --actions
    '[{"eval":"__game.player.teleport(0,300,-460,Math.PI);__game.player.setAction(\"idle\");__game.camera.reset(__game.player)"},{"step":10,"input":{"stickY":1}},{"shot":"shots/door.png"}]'`
    (and standing open behind him on the porch: `?area=hall`, walk south into the inner door,
    shoot a few ticks after the switch);
  * the hall from the dais's top, the bottle and its model behind him: `--url
    "/?test=1&mute=1&area=hall&entry=bottle" --actions '[{"step":20},{"shot":"shots/bottle.png"}]'`;
  * Jonas shrinking into the bottle: `--url "/?test=1&mute=1&area=hall" --actions
    '[{"eval":"__game.player.teleport(0,550,-61100,Math.PI);__game.player.setAction(\"idle\");__game.camera.reset(__game.player)"},{"step":20,"input":{"stickY":1}},{"shot":"shots/shrink.png"}]'`;
  * the lit lighthouse: `--url "/?test=1&mute=1&area=skerries" --actions
    '[{"step":60},{"eval":"__game.areas.current.setLit(true)"},{"step":30},{"shot":"shots/lit.png"}]'`
    (or win the star: teleport onto the gallery beside it, see `tests/areas-browser.test.js`).
* V in the game (run locally) records a 1920x1080 video with sound, 9 a 1080x1920 portrait one
  (see "Recorder"); `E2E=1 REC_OUT=<dir> node --test tests/recorder-browser.test.js` keeps the
  test recordings and PNGs of their frames.
* `node tools/realShots.mjs --out shots/real [--views arrival,door,west,turn,cars,roof,retro]
  [--sizes 960x540,1280x720] [--looks high,low,classic]` — Sparrow Lane's realistic look from
  fixed camera poses (the acceptance shots), beside the classic look; `/?test=1&area=lane` needs
  `&look=real` (or a `&tier=`) for the realistic look in shot.mjs runs.
* `/preview.html?m=fx&melt=48` holds AI RACE's meltdown at 48 s (sky, grade, embers, the light).
* `/preview.html?m=face` shows the face screen alone (Start shows it again); scripted pulls for
  shot.mjs: `{"eval":"__face.pointer('down', 0.6, 0.55)"}`, `{"eval":"__face.pointer('move',
  0.8, 0.6)"}`, `{"wait":500}`, `{"shot":"shots/pull.png"}` (see the preview's header).
* Requirements: Node.js 20.19+ or 22.12+ (Vite 8); `tools/shot.mjs` and the browser tests
  (`E2E=1 npm test`) need Playwright's Chromium (`npx playwright install chromium`).
* `index.html` carries the tab icon inline (Jonas's HUD face, `ICONS.hero` from
  `src/ui/icons.js`, with the HUD's 1-pixel outline, as an SVG data URI: regenerate it from the
  icon's rows when the icon changes), so no `/favicon.ico` is requested.
