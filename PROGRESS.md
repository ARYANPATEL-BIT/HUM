# HUM – Progress Log

Phase numbering follows SPEC.md (1 = player, 2 = world). **SPEC.md is still not in the repo** (checked
2026-10-23), so phases 3–7 are named after their content. Phase 7's scope comes from the task list in
the request (chalk, water, 15 notes, settings, head bob, end stats, Pages deploy, README, production
cleanup); the details below are my design choices, not checked against a spec.
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
