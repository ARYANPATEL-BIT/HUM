# HUM – Spec (additions)

The original SPEC.md (phases 1–7) was never committed to this repo. This file starts at the features
requested on 2026-10-26 and is extended as each one is built. PROGRESS.md tracks what is done.

## 8 – Recap map

- Every `recap.interval` (0.5 s) of play, record the player's position and the entity's position.
  Storage is two plain flat number arrays (`[x0, z0, x1, z1, …]`), no object per sample. The entity
  array stays index-aligned with the player array; before it spawns (or while disabled) its sample is
  `NaN, NaN`.
- Positions are world meters: scene position + origin chunk × chunk size. The floating-origin rebase
  moves scene coordinates but not world coordinates, so a path stays continuous across rebases.
- Recording runs only while the game is in the playing state (not paused, not in photo mode).
- Task completions are recorded as markers (the player's position when the task finished; for the
  cassette that is the tape player it was delivered to).
- On the end screen (escaped, caught or lights out) a top-down 2D canvas map shows:
  - the walls, pillars and hiding spots of every chunk the player was in at a sample, regenerated
    from the seed (`generateChunk`), not read back from loaded chunks;
  - the player path and the entity path in different colours; a jump of more than
    `recap.breakDist` between two entity samples (relocation) is drawn as a gap;
  - markers for the start, completed tasks, chalk marks still in the world, and the death spot
    (caught / lights out) or the exit door (escaped);
  - a legend and the seed, drawn into the canvas so a saved image explains itself.
- A "save map" button downloads the canvas as `hum-map-<seed>.png`.

## 9 – Photo mode

- P toggles photo mode while playing. The game is paused: timer, entity, lights, tasks, recap
  sampling and player movement all stop. Mouse look still works so the shot can be framed. The HUD
  (crosshair, prompt, timer, bars) is hidden. Post-processing stays on (grain keeps moving).
- S saves a PNG of the current view as `hum-<seed>-<timestamp>.png`. The save renders a frame and
  calls `toDataURL` on the WebGL canvas in the same task, before the browser can clear the drawing
  buffer, so `preserveDrawingBuffer` stays off.
- P does nothing while a task overlay or the note reader is open. Leaving pointer lock (Esc) ends
  photo mode and goes to the normal pause screen.

## 10 – Hiding spots

- Placement is part of `generateChunk` (own salt, so walls, tasks and pickups of existing seeds don't
  move). About 1 in 3 ordinary chunks (`hiding.chunkChance`; never landmark chunks) gets 1–2 spots in
  one of its rooms, each in its own cell with its back against an existing wall of that cell:
  - **office desk** (1.6 × 0.75 × 0.8 m): top, two side panels, a modesty panel;
  - **tall cupboard** (1.0 × 2.0 × 0.6 m): back, sides, top, bottom and two doors with a slit
    between them.
  Spots are shifted along the wall, away from the middle of the cell edge. That keeps cupboards off
  keypad codes painted at eye height on the edge's middle, and keeps the cell centre and edge midpoints
  (task props, entity A* checks) clear. Both are simple primitives merged into one mesh per chunk
  (+1 draw call for a chunk with spots) and add box colliders.
- Hold C within `hiding.reach` of a spot's front to hide. The player is moved into the spot: under the
  desk (eye 0.5 m) or inside the cupboard (eye 1.55 m, looking out through the door slit), facing out.
  Movement, E, Q and R are locked; mouse look still works. Letting go of C puts the player back
  where they stood. Stamina regenerates while hidden.
- The entity can't see a hidden player, except:
  - **spotted:** it was chasing and within `hiding.spottedDist` (6 m) when the player hid. It goes
    straight for the spot.
  - **searched:** a chase that loses sight because the player hid heads for where it last saw them
    (not the player's live position, as a normal chase does for `entity.loseDist` seconds). On
    arrival, if the player is within `hiding.searchRadius`, it checks the spot with
    `hiding.searchChance`; otherwise (or if the roll fails) it gives up as if it had lost the player.
  - **heard:** while it investigates a noise within `hiding.searchRadius` of a player who has been
    hidden longer than `hiding.breathAfter`.
  Once found, it catches the player at `hiding.catchDist` (the spot's colliders keep it further away
  than the normal catch distance).
- Breathing plays while hidden: quiet at first. After `hiding.breathAfter` (20 s) it gets louder and
  faster over `hiding.breathRamp` seconds, and each breath emits a noise event whose radius grows from
  `hiding.breathNoise[0]` to `[1]`. Hiding can't last forever.
- Tuning target: hiding while chased works about half the time, not always (measured by a simulation
  in `tests/hiding.test.mjs`).
