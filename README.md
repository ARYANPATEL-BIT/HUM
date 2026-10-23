# HUM

An open-source browser horror game set in endless yellow office space. The fluorescent lights hum,
the carpet is damp, and something is walking the halls. Finish four tasks, find the door that opens,
and get out before the timer runs down or it finds you.

Everything is procedural and seeded: the same seed always gives the same halls, tasks, codes,
bottles and notes. The game runs on three.js with no image, model or sound files. Textures are
drawn on canvases and every sound is synthesized with the Web Audio API.

**Play:** `https://<your-github-user>.github.io/<repo-name>/` once GitHub Pages is enabled (see [Deploying](#deploying)).
Desktop only (keyboard and mouse).

## How to play

Pick a difficulty on the title screen:

| Difficulty | Timer | The entity |
|---|---|---|
| easy | 10:00 | appears after 45 s |
| normal | 7:00 | appears after 45 s |
| hard | 5:00 | is there from the start |

Do one of each task. There are many copies of each one around the level, so the nearest one is
usually the right one:

- **Breaker:** hold E while looking at it. The lights strobe and it is loud.
- **Radio:** drag the dial slowly. When the static is almost gone, hold still until the voice locks in.
- **Cassette:** pick it up and carry it to a tape player in a *different* room. You can't run while carrying it.
- **Keypad:** the 4-digit code is painted on a wall nearby (yellow on black, at eye height).

When all four are done, a green exit door opens about 50 m away. Follow its low tone.

The entity hears sprinting, the breaker and keypad beeps. If it sees you it chases. Break line of
sight and keep moving. As time runs out the lights die, the hum climbs, and it gets faster.

You also have:

- **Chalk (Q):** mark the wall you're looking at with an X, or the floor with an arrow pointing where you face.
- **Water (E to pick up, R to drink):** sprinting drains stamina. A bottle refills it. You can carry three.
- **Notes (E):** 15 handwritten notes are scattered around. Each one you find is the next one you
  haven't read, so the story reads in order across runs. Progress is saved in your browser.

The end screen shows how you did: time survived, tasks, distance, chalk marks, water, notes, how
many times you were chased and your closest call. "Retry same seed" replays the exact same level.

### Controls

| Key | Action |
|---|---|
| WASD / arrows | move |
| Shift | sprint (uses stamina) |
| Mouse | look |
| E | interact / pick up / put a note down (hold on the breaker) |
| Q | chalk mark |
| R | drink water |
| Tab | task checklist |
| Esc | pause |

### Settings

Settings are on the title and pause screens: graphics preset (low / medium / high), field of view,
mouse sensitivity, invert Y, head bob and volume. They are saved in your browser. A preset that
switches antialiasing on or off takes effect after a reload.

### Seeds

Add `?seed=1234` (or any text, e.g. `?seed=mara`) to the URL to play a specific level. Without
one you get a random seed, which is shown on the pause and end screens.

## Development

Needs Node.js 20.19+ or 22.12+.

```sh
npm install
npm run dev       # dev server with the dev panel
npm test          # world + item tests (Node, no browser)
npm run build     # production build in dist/
npm run preview   # serve dist/ locally
```

The dev server (and only the dev server) adds a tuning panel (lil-gui), an FPS panel and these keys:

| Key | Dev action |
|---|---|
| ` (backquote) | debug view: no fog, chunk grid, entity path and state, memory stats |
| G | auto-run (noclip, fast) |
| F1 | complete the open task / the nearest task |
| F2 / F3 | +60 s / −60 s |
| F4 | teleport to the nearest task |
| F5 | toggle the entity |

None of this is in the production build. The dev code is loaded behind `import.meta.env.DEV`, so
Vite drops it, and CI fails the build if it ever shows up in `dist/`.

### Project layout

```
src/
  main.js              boot, game states, per-frame wiring
  config.js            every tuning value (units: meters, seconds)
  content/notes.js     the 15 notes
  core/                renderer + post, loop, input, RNG, storage, dev tools
  player/              first-person controller (stamina, head bob, steps), collision
  world/               chunk generation/building/streaming, lighting, textures,
                       task objects, pickups (bottles, notes), chalk
  tasks/               breaker, radio, keypad, task manager (interaction, win/lose)
  entity/              the entity (A* pathing, hearing, chase) and noise events
  audio/               hum, footsteps, task voices, entity, item sounds
  ui/                  menus, settings, HUD, end screen
tests/                 world.test.mjs (generation, seams, connectivity, streaming, collision)
                       items.test.mjs (pickups, notes, stamina, steps, head bob, settings)
```

## Deploying

`.github/workflows/deploy.yml` builds, tests and deploys `dist/` to GitHub Pages on every push to
`main`, using the official Pages actions. Pull requests are built and tested but not deployed.

One-time setup in the GitHub repo: **Settings → Pages → Build and deployment → Source: GitHub
Actions**. The build uses relative asset paths (`base: './'` in `vite.config.js`), so it works at
any repo path without changes.
