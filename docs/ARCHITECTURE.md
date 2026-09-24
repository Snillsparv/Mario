# Castle Grounds — architecture & module contracts

An N64-era 3D platformer level (a castle on a moated island with a lawn, hills, a
waterfall and a pond) rendered with three.js. The goal is to recreate the **look and feel**
of a late-90s N64 platformer's castle-grounds hub as closely as possible: low-poly
geometry, small bilinear-filtered textures, baked vertex-colour lighting, billboard trees,
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

Game flow, `state.mode` `'title' → 'play' → 'gameover' → 'title' …`:

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
start:    hud.setVisible(true); player.beginIntro(); cam.startIntro(player)
          dropHold = 60 ticks: Pip waits hidden above the spawn while the 96-tick fly-in runs,
          then drops (~32 ticks) and lands as the camera settles behind him
          input.flush(); emit 'gameStart' (stops the menu track; AudioEngine unlocks audio here
          only with sticky user activation, so a pad-only start creates no blocked
          AudioContext); audio.playMusic('castle_grounds')
respawn:  player enters 'spawn' again (Player.respawn after death / out of bounds)
          -> cam.reset(player) (behind Pip, facing the castle)
lives:    4 at start; 'lifeLost' at x0 -> once the death plays out: mode 'gameover', emit
          'gameOver' (audio plays the 'game_over' jingle), new GameOverCard(uiRoot).show()
          over the frozen world for GAME_OVER_SECONDS (3.2 s, core/constants.js); then
          card.remove(), objects.reset(), player.coins = 0, lives = 4 — all *before* the
          title, so the title backdrop already shows the new game's world — then the title
          and start (with the intro) as above
```

Simulation and rendering:

```
tick (30 Hz, only in 'play'):
  controller = input.poll()
  START.pressed -> toggle pause (hud.setPaused, emit 'pause' / 'unpause')
  paused -> return                        (nothing below runs; state.time stands still)
  state.time += FRAME_DT
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
`sample()` per render frame latches pad buttons; `flush()` drops latched taps and makes held
buttons not count as fresh presses; `setOverride(partialController)` for tests.
Gamepads: every connected standard-mapping pad is read and merged (buttons OR'ed, the stick
pushed furthest wins), so an idle or odd device at index 0 cannot hide the real controller;
pads without the standard mapping are read only when no standard pad is connected (then the
most recently active one). `input.getGamepads` can be replaced in tests. Mouse-drag orbit
ends on mouseup, on window blur, and on the first move with neither drag button held.

Test hooks: `?test=1` disables the real-time loop and the first title (the title still
follows a game over, as in play) and exposes
`window.__game`: `step(n, controllerOverride)` (n ticks, then one draw; the hero model is
posed after every tick with dt = 1/30 s, like a 30 fps real-time run, so pose blends, blinks
and the scarf have caught up after a big step), `render()` (draw with dt 0),
`snapshot()`, `startGame(intro = true)` (replay the intro flow), and `player`, `camera`,
`level`, `objects`, `state`, `view`, `input`, `hud`, `audio`, `model`, `events`,
`neutralController`. `?skipTitle=1` skips the title/intro. `?mute=1` disables audio.
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
| HUD/title | `src/ui/*` (incl. `logoWorker.js`, the title logo's off-thread renderer) | HUD, TitleScreen |
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
player.takeDamage(wedges, fromPos)
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
water_surface, water_jump, star_dance, spawn, death`.

## Hero model (`src/player/PlayerModel.js`)

```js
const model = new PlayerModel()
model.object3D            // THREE.Group, origin at the feet, front faces +Z, ~160 units tall
model.update(renderState, dtSeconds)   // positions/rotates the group, poses limbs, blob shadow at floorY
```

Hero design ("Pip"): an original chibi explorer — big round head (~40% of height), large
friendly oval eyes, rosy cheeks, small button nose, no moustache; a teal wide-brim
explorer hat with a mustard band and a small leaf sprig; a mustard-yellow scarf with two
trailing tails; a burnt-orange tunic with a brown belt; cream gloves; dark-brown boots.
Built from low-poly primitives with Lambert/Gouraud shading lit by the sun + ambient.
Includes an N64-style dark circular blob shadow projected onto the floor.

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

The orbit centre (look point) is `LOOK_HEIGHT` (150) above the hero's feet, but the rendered
view is aimed a few degrees *above* it (`cameraConfig.js` `ORBIT_MODES.*.aim`, eased, fading
out as the orbit steepens), so the hero stands in the lower middle of the picture; the orbit,
the collider's sight lines and `getYaw()` ignore the aim. Because of the aim the hero is no
longer at the centre of the view, so `cam.apply()` publishes **`camera.userData.focus`**
(`{ x, y, z }`, the interpolated look point `LOOK_HEIGHT` above the hero's feet, one reused
object; `null` while there is no hero to keep in view: title, intro, first person). The
props' foliage fade (`src/world/props/billboards.js` `heroLocator`) reads it to find the
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
```

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
activation) and `pause` / `unpause` (duck + sfx).

## HUD / title (`src/ui/*`)

```js
const hud = new HUD(uiRootElement, { events })  // subscribes to 'coin' (red-coin numbers use coin.index)
hud.update({ lives, coins, stars, health, showPower, breath, paused }); hud.setPaused(bool)
hud.setVisible(bool)          // hidden behind the title (hud.visible; hidden HUDs skip repaints)
hud.setViewport(rect | null)
const title = new TitleScreen(uiRootElement, { events, audio }); await title.show()  // can be shown again
title.setViewport(rect | null)
const card = new GameOverCard(uiRootElement).show()  // dark screen + gold GAME OVER, fades in
card.setViewport(rect | null); card.remove(); card.shown   // remove() at once; show() again ok
```

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

## Signs and dialog (`layout.SIGNS`, Player, `src/ui/DialogBox.js`)

`layout.SIGNS`: `[{ id, x, z, yaw, pages: [string] }]`, wooden signposts built by props (the
readable board faces `yaw`), with original text. Reading works like the classic games:

* Player: B pressed while grounded and not attacking, with a sign within reach in front of Pip
  (Pip in front of the sign's face and facing it) -> action `'reading'` (anim `idle`, no
  movement, input ignored), emits `'signRead' { sign }` instead of punching.
  `player.endReading()` returns to idle.
* `new DialogBox(uiRoot, { events })` opens on `'signRead'`, shows the pages one by one
  (text typed out; A/B completes the page, then advances), emits `'dialogClosed' { sign }`
  after the last page. `dialog.isOpen`, `dialog.update(controller)` (30 Hz, called by main
  while open), `dialog.close()`.
* main: while `dialog.isOpen` the tick feeds the controller to the dialog and a neutral
  controller to Pip and the camera; on `'dialogClosed'` it calls `player.endReading()` and
  `input.flush()` so the closing press never becomes a jump or punch.

## Objects (`src/objects/ObjectManager.js`)

```js
new ObjectManager({ scene, collision, events, layout, player })
objects.update({ player, frame, camera })   // 30 Hz: collection, AI
objects.animate(time, alpha, threeCamera)   // render: spin, billboards
objects.reset()                             // new game: every pickup back (see below)
objects.ambient(time) -> alpha              // title backdrop clock (animate() calls it itself)
objects.started                             // an update() ran since construction / reset()
```

`reset()` (always present; main calls it after GAME OVER, before the title): all yellow and
red coins come back (red count 0), the star is hidden until the next full red set, the 1-up
gem returns, live sparkles vanish, and the star it awarded is taken back off `player.stars`.
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
Everything animates on the simulation clock, so pausing freezes it.

## Events (`src/core/events.js`)

| name | payload | emitted by |
|---|---|---|
| `sfx` | `{ name, pos?, volume?, pitch? }` | anyone; audio plays it |
| `footstep` | `{ terrain, pos, speed }` | player |
| `land` | `{ terrain, pos, hard }` | player |
| `splash` | `{ pos, big }` | player |
| `hurt` | `{ pos, amount }` | player |
| `coin` | `{ value, pos, red, index? }` (`index` 1..8 on red coins) | objects |
| `redCoinsComplete` | `{ pos }` (where the star appears) | objects |
| `starCollected` | `{ pos }` | objects |
| `lifeLost` / `oneUp` | `{}` | player / objects (main counts lives; audio plays sfx) |
| `pause` / `unpause` / `gameStart` / `gameOver` | `{}` | main (audio consumes all four: ducks, menu-track stop, unlock, `game_over` jingle) |

Standard sfx names: `jump, double_jump, triple_jump, backflip, sideflip, long_jump,
wallkick, dive, ground_pound, ground_pound_land, punch, kick, land, land_hard, skid,
bonk, hurt, ledge_grab, climb, swim, splash, water_exit, coin, red_coin, star_appear,
star_get, one_up, pause, menu_select`, plus `footstep, life_lost, unpause, camera_move,
camera_buzz`. Unknown names must be ignored silently.

## Tooling

* `npm run dev` — dev server. `npm test` — node unit tests (`tests/**/*.test.js`).
  `npm run build` — production build into `dist/` (one ~850 kB / ~250 kB gzip bundle by
  design, plus the ~13 kB title-logo worker; `vite.config.js` raises `chunkSizeWarningLimit`
  to 900 kB accordingly).
* `node tools/shot.mjs --url "/preview.html?m=<area>&cam=x,y,z&look=x,y,z" --out shots/x.png`
  — headless screenshot of a preview page (prints browser errors).
* `node tools/shot.mjs --url "/?test=1" --actions '[{"step":30,"input":{"stickY":1}},{"shot":"shots/a.png"},{"eval":"__game.snapshot()"}]'`
  — scripted full-game run. Actions: `{step, input}`, `{eval}`, `{shot}`, `{wait: ms}` (for
  real-time runs such as `/?skipTitle=1`).
* `/preview.html?m=world` shows the whole level without the player.
* Requirements: Node.js 20.19+ or 22.12+ (Vite 8); `tools/shot.mjs` and the browser tests
  (`E2E=1 npm test`) need Playwright's Chromium (`npx playwright install chromium`).
* `index.html` carries the tab icon inline (Pip's HUD face from `src/ui/icons.js` as an SVG
  data URI), so no `/favicon.ico` is requested.
