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
* `src/core/math.js`: `wrapAngle`, `angleDiff`, `approachAngle`, `approach`,
  `stickToWorldYaw(stickX, stickY, cameraYaw)`, `makeRng(seed)`.
* `src/core/constants.js`: `FLOOR_TOLERANCE` (78), `FLOOR_LOWER_LIMIT`, `CEIL_NONE`,
  `NO_WATER`, `PLAYER_HEIGHT`, `PLAYER_RADIUS`.

## Frame flow (`src/main.js`, owned by integration)

```
tick (30 Hz):
  controller = input.poll()
  START.pressed -> toggle pause
  player.update(controller, camera.getYaw())
  objects.update({ player, frame, camera })
  camera.update(controller, player)
  hud.update({ lives, coins, stars, health, showPower, breath, paused })
render (rAF):
  rs = player.getRenderState(alpha); model.update(rs, dt)
  camera.apply(alpha); level.update(time, threeCamera); objects.animate(time, alpha, threeCamera)
  audio.update(dt); view.render()
```

Test hooks: `?test=1` disables the real-time loop and exposes
`window.__game.step(n, controllerOverride)`, `__game.snapshot()`, `__game.player`,
`__game.camera`, `__game.level`, `__game.render()`. `?skipTitle=1` skips the title/intro.
`?mute=1` disables audio.

## Module ownership (one owner per file set)

| Area | Files | Contract |
|---|---|---|
| Core | `src/core/*`, `src/main.js`, `src/world/level.js` | integration |
| Collision | `src/collision/*` | below |
| Layout | `src/world/layout.js` | anchors are shared contract |
| Terrain + water | `src/world/terrain.js`, `src/world/water.js`, `src/world/terrainTextures.js` | WorldPart |
| Castle + bridge | `src/world/castle.js`, `src/world/castle/*` | WorldPart |
| Props | `src/world/props.js`, `src/world/props/*` (trees, fences, waterfall, flowers, rocks) | WorldPart |
| Sky | `src/world/sky.js` | WorldPart |
| Player physics | `src/player/Player.js`, `src/player/actions/*`, `src/player/physics/*` | Player |
| Hero model | `src/player/PlayerModel.js`, `src/player/model/*` | PlayerModel |
| Camera | `src/camera/*` | CameraController |
| Renderer | `src/render/N64Renderer.js`, `src/render/post/*` (texgen/materials are shared helpers) | N64Renderer |
| Audio | `src/audio/*` | AudioEngine |
| HUD/title | `src/ui/*` | HUD, TitleScreen |
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
  `y + offsetY` out of all walls within `radius` horizontally (SM64-style).
* `raycast(origin, dir, maxDist, { floors, walls, ceilings }) -> { point, normal, distance, surface } | null`.
* `waterLevelAt(x, z) -> height | NO_WATER`. `findPole(x, y, z, reach) -> pole | null`.
* Surface: `{ kind: 'floor'|'ceil'|'wall', a, b, c, normal:{x,y,z}, d, minY, maxY,
  surface: 'default'|'not_slippery'|'slippery'|'very_slippery'|'death', terrain:
  'grass'|'stone'|'wood'|'sand'|'water', hn (walls: horizontal normal) }`.
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

`src/world/layout.js` is the single source of truth for positions: `SPAWN`, `CASTLE`,
`BRIDGE`, `ISLAND`, `MOAT`, `POND`, `WATERFALL`, `EAST_HILL`, `WEST_MOUND`, `PERIMETER`,
`PATHS`, `TREES`, `FENCES`, `COINS`, `RED_COINS`, `STAR`, `BUTTERFLY_SPOTS`,
`BIRD_CIRCLES`, heights `WATER_LEVEL`, `MOAT_FLOOR`, `LAWN_BASE`, `ISLAND_TOP`,
`CLIFF_TOP`, and functions `groundHeight(x,z)`, `lawnHeight(x,z)`, `regionAt(x,z)`
(`'lawn'|'island'|'water'|'cliff'`), `pathMask(x,z)`, `waterLevelAt(x,z)`, `SUN_DIR`.
Builders place things with `groundHeight()`; the terrain mesh must match it.

### Look guidelines (all world parts)

* Materials: `worldMaterial()` from `src/render/materials.js` (unlit `MeshBasicMaterial`,
  texture × vertex colour, fog on). Bake lighting with `bakeLighting(geometry, opts)`
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
cam.reset(player); cam.update(controller, player) /* 30 Hz */; cam.apply(alpha) /* render */
cam.getYaw()        // yaw the camera looks along (used for stick-relative movement)
cam.startIntro?(player); cam.titleOrbit?(timeSeconds)
```

## Renderer (`src/render/N64Renderer.js`)

```js
const view = new N64Renderer(containerElement)
view.scene, view.camera (THREE.PerspectiveCamera, vertical fov ~45, near 20, far ~40000)
view.render(); view.renderer (THREE.WebGLRenderer)
```

## Audio (`src/audio/AudioEngine.js`)

```js
const audio = new AudioEngine(events)   // subscribes to events itself
audio.unlock()                          // after a user gesture
audio.play(name, { pos?, volume?, pitch? }); audio.playMusic(name); audio.stopMusic()
audio.setListener(pos, yaw); audio.update(dt); audio.muted = true|false
```

All sound effects are synthesized with WebAudio. Music is an **original** composition.

## HUD / title (`src/ui/*`)

```js
const hud = new HUD(uiRootElement); hud.update({ lives, coins, stars, health, showPower, breath, paused }); hud.setPaused(bool)
const title = new TitleScreen(uiRootElement, { events, audio }); await title.show()
```

## Objects (`src/objects/ObjectManager.js`)

```js
new ObjectManager({ scene, collision, events, layout, player })
objects.update({ player, frame, camera })   // 30 Hz: collection, AI
objects.animate(time, alpha, threeCamera)   // render: spin, billboards
```

Yellow coins (1), red coins (2, collect all 8 → star appears at `STAR` with a jingle),
the star (touch → `player.collectStar()`), butterflies, circling birds.

## Events (`src/core/events.js`)

| name | payload | emitted by |
|---|---|---|
| `sfx` | `{ name, pos?, volume?, pitch? }` | anyone; audio plays it |
| `footstep` | `{ terrain, pos, speed }` | player |
| `land` | `{ terrain, pos, hard }` | player |
| `splash` | `{ pos, big }` | player |
| `hurt` | `{ pos, amount }` | player |
| `coin` | `{ value, pos, red }` | objects |
| `redCoinsComplete` | `{}` | objects |
| `starCollected` | `{ pos }` | objects |
| `lifeLost` / `oneUp` | `{}` | player / objects |
| `pause` / `unpause` / `gameStart` | `{}` | main |

Standard sfx names: `jump, double_jump, triple_jump, backflip, sideflip, long_jump,
wallkick, dive, ground_pound, ground_pound_land, punch, kick, land, land_hard, skid,
bonk, hurt, ledge_grab, climb, swim, splash, water_exit, coin, red_coin, star_appear,
star_get, one_up, pause, menu_select`. Unknown names must be ignored silently.

## Tooling

* `npm run dev` — dev server. `npm test` — node unit tests (`tests/**/*.test.js`).
* `node tools/shot.mjs --url "/preview.html?m=<area>&cam=x,y,z&look=x,y,z" --out shots/x.png`
  — headless screenshot of a preview page (prints browser errors).
* `node tools/shot.mjs --url "/?test=1" --actions '[{"step":30,"input":{"stickY":1}},{"shot":"shots/a.png"},{"eval":"__game.snapshot()"}]'`
  — scripted full-game run.
* `/preview.html?m=world` shows the whole level without the player.
