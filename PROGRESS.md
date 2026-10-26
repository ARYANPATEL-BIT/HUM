# HUM – Progress Log

Phase numbering follows the original spec (1 = player, 2 = world). That spec was never committed, so
phases 3–7 are named after their content. Phase 7's scope came from the task list in that request
(chalk, water, 15 notes, settings, head bob, end stats, Pages deploy, README, production cleanup); the
details are my design choices, not checked against a spec.
**SPEC.md now exists (2026-10-26)** but only covers phases 8–10 (recap map, photo mode, hiding), written
as each was built.
"Done" means wired in and reachable in a normal game, not just present in a file.

| Phase | Status | Notes |
|---|---|---|
| 1 – Player | Done | Controller, collision, input, loop, state machine, menus, seeds |
| 2 – World | Done | Chunk gen/build/streaming, floating origin, landmarks, textures |
| 3 – Lighting + post | Done | Post pass colour-space bug fixed in phase 7 (see below) |
| 4 – Audio | Done | Hum start-up bug on suspended AudioContexts fixed in phase 7 |
| 5 – Tasks, timer, win/lose | Done | Winnable without dev keys |
| 6 – Entity + pressure | Done | A* movement with collision in every state |
| 7 – Polish + ship | Done (automated checks only) | Needs a human playtest with mouse and sound |
| 8 – Recap map | Done (automated checks only) | End-screen map + PNG save |
| 9 – Photo mode | Done (automated checks only) | P / S |
| 10 – Hiding spots | Done (automated checks only) | Escape rate tuned in a simulation, not by people |

## Phases 8–10 (2026-10-26)

### Fixes first
The playtest-notes section of the request was the empty template again, so there were no human notes.
A baseline bot run on the code as found (seed 777, normal, entity on) won with no errors. One bug
found by reading the code and fixed:
- **Footstep loop under task overlays.** `player.stepped` is only reset inside `player.update()`, which is
  skipped while an overlay is open. If E opened the radio/keypad on the frame a foot landed, a footstep
  played every frame until the overlay closed. The bot never hit it because it stops before pressing E.
  `main.js` now clears `stepped` whenever the player isn't updated (overlay, hiding).

### 8 – Recap map (`src/ui/recap.js`)
- Samples every 0.5 s of play into two flat arrays of world meters (scene + origin chunk × size); the
  entity array is index-aligned, `NaN, NaN` before it spawns. A final sample is taken at game end.
  Task markers record the player's position on `task-complete`. `Chalk.positions()` gives the marks
  still in the world (ring buffer: last 128 of each kind).
- The end screen has a canvas next to the stats: walls, pillars and hiding spots of every chunk the
  player stood in at a sample (regenerated with `generateChunk`), the entity path (red, gaps on jumps
  > 8 m = relocation), the player path, start ring, task circles with the type's letter, chalk crosses,
  red X (caught / lights out) or green square (exit), legend and seed drawn into the image. Longest
  side 960 px. "save map (png)" downloads `hum-map-<seed>.png`.
- Checked: `tests/recap.test.mjs` walks 1.5 km through the real ChunkManager across a rebase. Every
  step between samples is 12.5 m ± 0.5 in world coordinates, the entity stays exactly 3 m behind, and
  chunk indices come out global. In the browser: a 1 km noclip run crossed a rebase (origin moved to
  chunk −7, 31), the path stayed continuous, and the PNG downloaded (50 KB). Bot wins show full maps.

### 9 – Photo mode (`main.js`, `PlayerController.look()`)
- P toggles (blocked under task overlays and the note reader). The playing update returns early after
  mouse look, so timer, entity, lights, tasks, recap and the run clock all stop. `#hud` is hidden, and
  the post pass keeps running. S calls `gfx.render(0)` then `canvas.toDataURL()` in the same task:
  no `preserveDrawingBuffer`. Esc (lock lost) → normal pause, photo mode off. Works while hidden
  (keeps the hiding camera).
- Checked in the browser on low (no post) and high: timer, recap, entity and player frozen while W
  is held; HUD hidden; look works; saved PNG is 1280×720, mean brightness 55 (low) / 45 (high), not
  black; P ignored under the note and the radio overlay; Esc → paused with the HUD back.

### 10 – Hiding spots (`chunkGen.placeHidingSpots`, `assets.hidingGeometries`, `src/player/hiding.js`, `entity.js`)
- Placement is chunk data (own salt, so existing seeds keep their walls, tasks and pickups): 1 in
  2.96 ordinary chunks over 2514 tested, 1–2 per chunk, desks and cupboards ~50/50. Each sits in its own
  room cell, back to an existing wall, shifted along it. Tests check the cell centre and the open edge
  midpoints stay clear (task props, entity A*), cupboards stay ≥ 0.5 m off the middle of the wall edge
  (keypad codes), and the box stays inside its cell.
- One merged mesh per chunk with spots (DoubleSide Lambert so the inside is visible) + box colliders.
- Hold C within 1.3 m of a spot's front: the player is moved to the spot's centre, the camera goes under
  the desk (0.5 m, set back so the desktop and side panels frame the view) or inside the cupboard
  (1.55 m, looking through the door slit). Only mouse look works; E/Q/R and the breaker are blocked;
  stamina regenerates. Letting go puts you back where you stood. Esc/pause clears held keys, so you
  come out on resume.
- Entity rules: no line of sight to a hidden player unless `hiding.found`. Found when (a) it was chasing
  within 6 m as you hid; (b) a chase that lost you goes to where it last saw you, not your live
  position, and on arrival, if you're within 3 m, it checks with `searchChance`, else it gives up
  (LOSE → 10 s grace); (c) it investigates a noise within 3 m of you after you've been hidden > 20 s.
  A found player is caught at 1.5 m, because the spot's colliders keep it 0.7–1.1 m away.
- Breathing (filtered noise, `playBreath`): quiet every 3.4 s; from 20 s it ramps over 20 s to loud
  every 2 s, and each breath emits a noise event of radius 4 → 12 m.
- **Tuning.** `tests/hiding.test.mjs` simulates chases with the real Entity, PlayerController,
  collision and Hiding code. The entity is chasing from 6–12 m with line of sight; the player runs
  (70% sprint, 30% walk as if carrying the cassette) to a spot 6–24 m away and hides for 15 s; pressure
  is random. Escape rate with `searchChance` 0.5: 36–48% over 4 seeds. With 0.35: 49–52%. Set to 0.35;
  the test's fixed seed gives 47% (43/92: 30 spotted, 19 searched and found). In that sim 68/160
  runs were caught before reaching a spot. This is a model of a player, not people; a human who
  breaks line of sight before hiding always escapes, and one who hides in plain view at < 6 m never
  does.
- Checked in the browser: prompt "[C] hold to hide under the desk / in the cupboard", real C key enters,
  W/E do nothing, camera at 0.5 / 1.55 m, release returns to the front point; through main.js, the entity
  chasing from 5 m caught the player in 1.6 s, and from 10.2 m with the roll forced to fail it went
  back to wander and the player was still hidden after 12 s.

### Perf (desks/cupboards loaded)
Production builds of HEAD and this change, same seed (4242), same deterministic 20 s walk-and-turn,
headless Chrome, RTX 5070 Laptop GPU, 1280×720 at DPR 1.5, vsync off; two runs each, order swapped:

| build | preset | draw calls avg (min–max) | avg fps | 1% low fps |
|---|---|---|---|---|
| HEAD | low | 47.9–48.0 (43–62) | 453–454 | 263 |
| this | low | 49.9 (45–64) | 426–432 | 250–263 |
| HEAD | high | 48.7–48.9 (44–63) | 442–445 | 270 |
| this | high | 50.8 (46–65) | 408–426 | 244–256 |

+2 draw calls on this walk (+1 per chunk with spots that is in view). Triangles are negligible: a desk
is 48 and a cupboard 84. FPS is 4–8% lower in both runs, about +0.13 ms a frame; I didn't profile which
part (the extra draws, the per-frame `hiding.near` scan of loaded chunks, recap sampling). These
numbers say nothing about integrated graphics.

### Verification (2026-10-26)
- `npm test` (world, items, recap, hiding) and `npm run build` pass after each feature and at the end.
- Bot runs on the final code, entity on: won 777 normal, 31337 normal, 2024 hard; no page or console
  errors, no stuck bots. The bot never hides and wasn't chased in these runs, so hiding vs the entity
  in the real loop is covered only by the scripted browser check above and the Node simulation.

## Fixes before phase 7

The playtest-notes section of the request was an empty template, so I playtested with a headless Chrome
bot (real GPU, emulated pointer lock, real controller input, tasks done through the real UI).
Phases 1–6 were winnable as committed (normal, entity on and off). Found and fixed:

- **Medium/high presets rendered almost black.** The post pass rendered into a linear target and wrote
  it to the screen without converting it to sRGB; low (no post) looked correct. `post.js` now converts
  (`linearToOutputTexel`) before grain and vignette. The default preset is high, so every player saw this.
- **Entity colour and fog.** Its shader wrote display-space colour and ignored fog. It looked right
  only because of the bug above, and looked different on low. It now outputs linear colour through
  three's colourspace + fog chunks, so it's near-black on every preset and fades into fog like the walls.
- **Hum could never start on browsers that create AudioContext as 'suspended'** (Firefox, Safari):
  `initHum`/`initEntityAudio` required `state === 'running'` on the same tick. They now init once the
  context exists, and `resumeAudio()` runs on every click and keydown.
- Caught by the entity showed "Time left: 0s". The end screen now shows the real time left and the cause.
- Dev panel draw-call counter read 1 (three resets `renderer.info` per render; the post pass rendered last).
- Clicking the title background started a normal game; only the difficulty buttons start now.
- A clicked menu button kept focus during play (Space could press it again and reset the timer);
  focus is dropped on start and difficulty clicks only count on the title screen. Tab is blocked only
  while pointer-locked, so the settings menu is still keyboard-navigable.
- Radio lock-in window was ~2.4 px of drag. Now: 600 px per full sweep, lock within ±0.012 (~7 px)
  held for 0.4 s, static fades over ±0.1.
- Missing favicon (404 on every load). Interacting with a task type you already finished re-ran it, and
  its tone kept playing; finished types are now skipped for prompts, interaction and task voices.
- Entity was 6 meshes (6 draw calls); merged into one.

## 7 – Polish + ship
- **Chalk (Q)** `src/world/chalk.js`: raycast from the eye (3 m) to wall/floor meshes. Wall → X facing
  the hit normal; floor → arrow pointing where you face (if the view ray misses, straight down 0.9 m
  ahead, only if there's line of sight). Two InstancedMeshes = 2 draw calls; ring buffer of 128 each;
  shifted on rebase. Count on the end screen.
- **Water bottles** `src/world/pickups.js`: 30% of chunks, off task and landmark cells, hold 3, E picks
  up, R drinks → full stamina. **Stamina** (new) in `controller.js`: 7 s of sprint, regen after 1.2 s,
  exhausted until 25%. HUD bar only while not full.
- **15 notes** `src/content/notes.js`: 20% of chunks, plus one always lying in front of the spawn
  (note 1 = tutorial). A pickup shows the lowest-numbered unread note, so they read in order across
  runs; read set saved in localStorage (`hum.notesRead`). Reading freezes movement and the timer;
  E puts it down; the entity keeps moving.
- **Settings** `src/ui/settings.js` (title + pause screens): preset, FOV, sensitivity, invert Y, head
  bob, volume; saved in localStorage (`hum.settings`), applied before the renderer is created. Changing
  to a preset with different antialiasing shows "applies after a reload".
- **Head bob**: one step phase in the controller drives the bob (dip on each footfall, sway per stride)
  and the footstep sounds, so they stay in sync. Fades out when you stop; can be turned off.
- **End screen stats**: cause (escaped / caught / lights out), difficulty, time survived, time left,
  tasks, distance, chalk marks, water drunk/found, notes read (new) and collected x/15, times chased,
  closest call, seed.
- **HUD**: crosshair, context prompt ("[E] take the cassette", "this player is too close…"), short
  flash messages, stamina bar, water count, cassette hint.
- **GitHub Pages**: `.github/workflows/deploy.yml`: Node 22, `npm ci`, `npm test`, build, grep `dist/`
  for dev tooling, then `configure-pages@v6` → `upload-pages-artifact@v5` → `deploy-pages@v5` (latest
  majors as of today, inputs checked). Deploys on push to main; PRs build and test only.
- **README.md** rewritten (play, controls, settings, seeds, dev keys, layout, deploy).
- **Production cleanup**: dev config moved from `CONFIG.dev` into `devTools.js`; the dev info panel and
  its CSS are created by devTools; removed unused `noclip`, `#dev-info`, `#keypad-clear-btn`, exports
  `applyPreset`/`LANDMARK_TYPES`. Prod bundle has no lil-gui, Stats, `window.hum` or dev keys; the only
  console calls left are three.js's own error logger.

## Verification (2026-10-23)
- `npm run build` passes. `npm test` = `test:world` (unchanged) + new `test:items` (pickup determinism
  and placement, spawn note, note order, bottle cap, stamina timing, stride, bob on/off/settle, frozen
  player, settings defaults). All pass.
- Wiring check (static scan): 38/38 modules reachable from main.js; no dangling DOM ids, data
  attributes or events; every handled key is documented (title hint, arrows in the README); no
  unread config keys found.
- Bot runs on the final code, entity on: won normal (seeds 777, 31337 on easy); earlier phase-7 runs
  also won hard (2024) and normal (31337, 777); one loss (12345 normal) when the bot, which never
  evades, sprinted into the entity. Every winning run read the spawn note, picked up and drank
  bottles, drew chalk marks and locked the radio by holding; 3 of 5 ran stamina to empty. No page
  errors or console errors in any run.
- Production build (vite preview), headless Chrome on an RTX 5070 Laptop GPU (D3D11), 1280×720 CSS px at
  devicePixelRatio 1.5, vsync off, 15 s walking and turning, WebGL draw calls counted directly:

  | preset | avg fps | 1% low | worst frame | draw calls avg (min–max) |
  |---|---|---|---|---|
  | low | 403 | 217 | 9.3 ms | 48.6 (43–62) |
  | medium | 374 | 204 | 10.8 ms | 51.0 (44–63) |
  | high | 369 | 208 | 9.1 ms | 52.6 (44–63) |

  The GPU is far from the bottleneck here, so preset differences are mostly noise; these numbers say
  nothing about integrated graphics. Draw calls depend on the view (frustum culling). The post pass
  is +1 on medium/high.

## Known gaps
- No human playtest yet. Audio (hum, footsteps in step with the bob, chalk/drink/paper sounds) is only
  verified as "no errors"; headless Chrome ignores autoplay rules, so the suspended-context fix is
  reasoned from the spec, not observed.
- After a long radio drag (> ~5 s since the mousedown) the browser may refuse the automatic re-lock;
  the game then shows "click to resume" (handled, but one extra click).
- Chalk marks near a wall's end can overhang the edge by up to ~0.2 m.
- Hard + carrying the cassette (no sprint) is very punishing if spotted close. Intended pressure,
  but worth a human opinion.
- **The recap map shows the entity walking through walls** at times. Outside the loaded chunks there
  are no colliders, so its A* and movement ignore walls there (about 23% of its samples in one bot
  run). That behaviour predates phase 8; the map just shows it. Freezing it outside loaded chunks
  isn't safe as is: relocation can put it 68 m behind the player, which can itself be unloaded.
- Hiding was tuned by simulation only. Not checked by a human: whether hold-to-hide (rather than a
  toggle) feels right; whether the breathing is audible/scary; whether hiding in plain view at > 6 m
  feels fair. The cupboard interior is lit by the room's lights (no shadows), so it isn't dark inside.
- Photo mode gives no on-screen confirmation of a save (the HUD is hidden); only the browser's download
  UI shows it.
- The map shows at most the last 128 wall and 128 floor chalk marks (the chalk ring buffer).
