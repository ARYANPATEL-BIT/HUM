# HUM – Progress Log

## Status at session start (2026-10-10)

### Step 0 recovery: what git shows
All commits are clean, working tree is clean.

### Phases 1 & 2: DONE
World generation (chunkGen, chunkBuilder, chunkManager, geoBuilder, textures, assets),
player controller, collision, input, render loop, menus, devTools, rng, stateMachine.
`npm run build` and `npm run test:world` both pass.

### Phase 3: NOT STARTED
Missing entirely:
- Light pool (4 PointLights, never changing count)
- Instanced emissive panels (MeshBasicMaterial is there, but no brightness animation)
- Baked per-chunk vertex lighting (GeoBuilder has vertexColors on floor, but no light bake)
- Burst-style flicker driven by a noise function
- Fog density derived from loadRadius (currently hardcoded in config)
- Combined post pass (grain + vignette + chromatic aberration)
- Graphics presets (low/medium/high)
- Dev lil-gui tuning panel with "copy config" button

### Phase 4: NOT STARTED
`src/audio/` dir is empty.

### Phase 5: NOT STARTED
No timer, no tasks, no exit door, no win/lose screens.

### Phase 6: NOT STARTED
`src/entity/` dir is empty.

---

## Phase 3 – Lighting, Post, Presets (completed this session)

Files changed:
- `src/config.js` — added lighting, post, preset, flicker, gui sections; fog density now computed from loadRadius
- `src/world/lighting.js` (new) — fixed pool of 4 PointLights, panel assignment, burst flicker
- `src/world/chunkBuilder.js` — vertex lighting bake pass on floor/ceiling geometry
- `src/core/renderer.js` — EffectComposer with single combined post pass (grain+vignette+CA); preset apply
- `src/core/post.js` (new) — combined post shader
- `src/core/devTools.js` — lil-gui panel wired to lighting/post params, "copy config" button
- `src/main.js` — wire LightPool into game loop, pass to devTools

---

## Phase 4 – Audio (completed this session)

Files changed:
- `src/audio/audio.js` (new) — AudioContext, gain buses, DynamicsCompressor
- `src/audio/hum.js` (new) — shared hum generator (120Hz saw + 240Hz sine + bandpassed noise), per-light PannerNode pool
- `src/audio/footsteps.js` (new) — noise buffer, step timing, sprint variation
- `src/audio/tasks.js` (new) — one looping generator per task type, nearest-4 voice cap
- `src/main.js` — wire audio, update listener from camera each frame, re-sync panners on rebase

---

## Phase 5 – Timer, Tasks, Exit, Win/Lose (completed this session)

Files changed:
- `src/world/taskObjects.js` (new) — deterministic task placement from hash, used-id Set, density guarantee
- `src/tasks/breaker.js` (new)
- `src/tasks/radio.js` (new)
- `src/tasks/cassette.js` (new)
- `src/tasks/keypad.js` (new)
- `src/tasks/taskManager.js` (new) — interaction (E within 2m), overlay muffling, exit door, win/lose
- `src/ui/hud.js` (new) — countdown, checklist (Tab), end screen
- `index.html` — added HUD elements, overlay panels for each task type
- `src/main.js` — wire timer, task manager, game-state transitions

---

## Phase 6 – Entity + Pressure Ramp (completed this session)

Files changed:
- `src/entity/entity.js` (new) — primitives figure, vertex-jitter shader, state machine (wander/investigate/chase/lose), DDA LoS, A* pathfinding
- `src/entity/noiseEvents.js` (new) — emitter for sprinting/breaker/keypad sounds
- `src/core/devTools.js` — entity toggle, path draw, state label; dev keys for tasks
- `src/config.js` — entity, pressure, audio.hum pitch ramp sections
- `src/main.js` — spawn entity, pressure ramp function, update entity each frame

---

## Cuts / simplifications
- lil-gui loaded from CDN (unpkg) so no npm dependency is added.
- Vertex lighting bake is a single ambient + directional pass at build time, not a full radiosity solve.
- A* capped at 4000 node expansions and 2 Hz recompute as specified.
- Cassette "tape player" is a fixed prop placed deterministically in a different chunk; no animation.
- Keypad code texture is a canvas quad regenerated once per chunk load.
- HRTF panner for entity: uses 'HRTF' PannerModel as spec says; falls back gracefully if browser doesn't support.
- No lil-gui in production build (dynamic import behind import.meta.env.DEV).
