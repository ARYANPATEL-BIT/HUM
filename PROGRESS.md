# HUM – Progress Log

Phase numbering follows SPEC.md (1 = player, 2 = world). SPEC.md was not in the repo when this
was written (2026-10-23), so phases 3–6 are named after their content and phase 7 is not described.
"Done" means wired in and reachable in a normal game, not just present in a file.

| Phase | Status | Notes |
|---|---|---|
| 1 – Player | Done | Controller, collision, input, loop, state machine, menus, seeds |
| 2 – World | Done | Chunk gen/build/streaming, floating origin, landmarks, textures; `npm run test:world` passes |
| 3 – Lighting + post | Done | See below; antialias preset change needs a reload |
| 4 – Audio | Done | Hum, footsteps, task voices, entity audio, muffle, crackle |
| 5 – Tasks, timer, win/lose | Done | Winnable without dev keys |
| 6 – Entity + pressure | Done | A* movement with collision in every state |
| 7 | Not started | |

## 1 – Player
`src/player/controller.js`, `src/player/collision.js`, `src/core/*`, `src/ui/menus.js`.
Sprint is blocked while carrying the cassette (`canSprint`).

## 2 – World
`src/world/chunkGen.js`, `chunkBuilder.js`, `chunkManager.js`, `geoBuilder.js`, `textures.js`, `assets.js`.

## 3 – Lighting + post
- `src/world/lighting.js`: fixed pool of 4 PointLights on the nearest live panels.
- Burst flicker state machine per panel (steady → burst → steady, or dead); value noise switches the
  panel off during a burst. Parameters in `CONFIG.lighting.flicker`. Not yet checked against SPEC.md.
- Panel brightness is written per instance into the chunk's InstancedMesh (water reflections too).
- `deadPanelChance` decides which panels start dead (deterministic per panel); they are skipped by the
  vertex light bake in `chunkBuilder.js`.
- Fog density computed from loadRadius (`config.js`).
- Combined grain + vignette + CA pass (`src/core/post.js`); uniforms re-read from `CONFIG.post` every frame.
- Presets low/medium/high; `gfx.setPreset()` applies pixel ratio and post live. Antialias only on reload.
- Dev lil-gui panel (dev builds only): preset, lighting, post, fog, "copy config".
- There is no in-game settings menu; presets are switchable from the dev panel only.

## 4 – Audio
`src/audio/`: AudioContext + buses + compressor, hum (shared generator, one panner per pooled light,
gain follows panel brightness), crackle on each flicker-off of a pooled light, footsteps, nearest-4
task voices, exit tone, entity drone/footsteps/heartbeat, lowpass muffle while an overlay is open.
All positional sources are rebased on origin shifts.

## 5 – Tasks, timer, win/lose
- Difficulty picker on the title screen (easy 10:00 / normal 7:00 / hard 5:00; hard spawns the entity at once).
- `src/world/taskObjects.js`: deterministic task objects and tape players per chunk; a tape player never
  shares a chunk with a cassette. Density guarantee runs on every chunk load and forces a missing type
  into an empty chunk at least `densityMinRange` away.
- Primitive meshes for breaker, radio, cassette, keypad, tape player and exit door (shared geometry/material per type).
- Keypad code painted on a wall in one of the 3x3 chunks around the keypad (`makeCodeTexture`).
- Breaker (hold E), radio (drag dial), keypad (enter code), cassette (carry to a tape player in another chunk).
- Overlays release pointer lock without pausing; the close button re-locks; Esc closes and pauses
  ("click to resume"). Overlay handlers are bound once.
- HUD timer, Tab checklist, breaker bar, carry indicator, end screen with retry/new seed.
- Exit door spawns ~50 m from the player after all four task types are done; reaching it wins.
- Task props have no collision (the player walks through them).

## 6 – Entity + pressure
- `src/entity/entity.js`: primitive figure with vertex-jitter shader; wander / investigate / chase / lose.
- Every state follows an A* path over cells (wall-aware edges, 4000-expansion cap, 2 Hz re-plan) and
  moves through `CollisionWorld`. If the cap is hit it heads for the closest explored cell.
- Hears sprinting, the breaker and keypad presses (`src/entity/noiseEvents.js`).
- Pressure ramp: entity speed, hearing radius, jitter, flicker frequency, dead-panel fraction;
  hum pitch rises over the last 60 s. Red vignette when it is within 10 m while an overlay is open.
- Dev: F1 complete task, F2/F3 ±60 s, F4 teleport to nearest task, F5 toggle entity;
  debug view (backquote) draws the entity path and a state label.

## Verification
- `npm run build` and `npm run test:world` pass.
- Headless Chrome smoke run (pointer lock emulated): full win and timer-loss runs with no page errors.
  Still needs a real playtest with mouse and sound.
