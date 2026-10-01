// Every tuning value in the game lives here. Units: meters, seconds, radians.

const DEG = Math.PI / 180;

export const CONFIG = {
  render: {
    fov: 75,
    near: 0.05,
    far: 75, // everything past this is fully fogged anyway; also lets frustum culling drop far chunks
    maxPixelRatio: 1.5, // cap on devicePixelRatio to protect the fill-rate budget
    antialias: true,
  },

  loop: {
    maxDelta: 0.1, // clamp frame dt so a tab switch doesn't teleport the player
  },

  atmosphere: {
    fogColor: 0x2b2512,
    // FogExp2: visibility = exp(-(density * d)^2). 0.035 => ~99.3% hidden at 64 m,
    // the closest an unloaded chunk can ever be (loadRadius 2 x 32 m).
    fogDensity: 0.035,
    // Temporary phase-2 fill light (phase 3 adds the real light pool).
    hemi: { sky: 0xfff0c0, ground: 0x857448, intensity: 1.6 },
  },

  world: {
    cellSize: 4,
    wallHeight: 3,
    wallThickness: 0.2,
    chunkCells: 8, // chunk = 8x8 cells = 32 m
    loadRadius: 2, // chunks within this Chebyshev radius of the player's chunk stay loaded (5x5)
    unloadDistance: 72, // m from player to a chunk's footprint before it unloads (hysteresis vs. thrash)
    maxBuildsPerFrame: 1,
    rebaseDistance: 1000, // floating origin: shift the world when the player is this far from 0,0
    edgeOpenings: [1, 3], // doorways per shared chunk edge (min, max)
    extraWallRemoval: 0.3, // fraction of maze walls knocked out after the backtracker, to add loops
    roomsPerChunk: [1, 2],
    roomSize: [3, 6], // cells per side
    pillarMinRoomSize: 4, // rooms at least this big on both sides get pillars
    pillarSpacing: 2, // cells between pillars
    pillarSize: 0.6,
    panelSpacing: 2, // a ceiling light panel every N cells
    panelSize: [1.2, 0.6],
    panelGap: 0.02, // offset below ceiling to avoid z-fighting
    floorTint: { variation: 0.12, dampChance: 0.1, dampDarken: 0.3 }, // per grid vertex, interpolated
    spawnCell: [3, 3],
  },

  landmarks: {
    chance: 1 / 15,
    doorways: 2,
    flooded: { size: [4, 5], waterLevel: 0.05 },
    chairs: {
      size: [3, 5],
      pilesPerCell: 1.1,
      maxStack: 4,
      stackStep: 0.5, // vertical offset between stacked chairs
      maxTilt: 0.15,
      wallMargin: 1.4, // keep piles off the walls so there's always a walkable ring
      pileSpacing: 1.5,
      pileRadius: 0.35,
    },
    redLight: { size: [3, 4], panelColor: 0xff2010 },
    stairs: {
      size: [3, 4], // cells (x, z)
      ceiling: 7, // this room's ceiling height; the stairs climb into the dark
      steps: 16,
      rise: 0.2,
      run: 0.35,
      width: 2,
      sideBlockHeight: 0.45, // stair sides taller than this block movement
      tint: [0.8, 0.78, 0.74],
    },
  },

  textures: {
    seed: 1337,
    wallpaper: {
      meters: [4, 3], // one repeat covers 4 m of wall, full height
      px: [512, 384],
      base: '#c6b25f',
      stripeEvery: 32, // px
      stripeLight: 'rgba(255, 246, 205, 0.07)',
      stripeDark: 'rgba(95, 75, 25, 0.10)',
      noise: 10,
      stains: 7,
      stainColor: [110, 85, 35],
      baseboard: '#6d5c32',
    },
    carpet: {
      meters: 4,
      px: 512,
      base: [142, 125, 84],
      noise: 26,
      blotches: 14,
    },
    ceiling: {
      meters: 4,
      px: 512,
      tiles: 6, // tiles per repeat => ~0.67 m tiles, divides the 4 m cell evenly
      base: [218, 212, 188],
      line: '#8a8570',
      speckles: 2500,
      stainedTiles: 3,
    },
  },

  colors: {
    panelOn: 0xfff6dc,
    panelDead: 0x2a2820,
    chair: 0x2c2b2e,
    water: 0x1f1a0b,
    waterOpacity: 0.8,
    mirrorDim: 0.55, // brightness of reflected panels in flooded rooms
  },

  player: {
    eyeHeight: 1.65,
    radius: 0.3,
    walkSpeed: 2.6,
    sprintSpeed: 4.8,
    accel: 12, // exponential approach rate toward target velocity while moving
    decel: 14, // ...and while stopping
    stepSmoothing: 14, // how quickly the player's height follows stairs
  },

  input: {
    mouseSensitivity: 0.0022, // radians per pixel of mouse movement
    invertY: false,
    pitchLimit: 85 * DEG,
    maxMouseDelta: 250, // drop per-event spikes some browsers emit on pointer lock
  },

  collision: {
    iterations: 3, // push-out passes per substep (handles corners)
    maxSubstep: 0.1, // max distance moved per substep, must be < player radius
  },

  dev: {
    infoUpdateInterval: 0.25,
    debugKey: 'Backquote', // ` : chunk grid, fog off, memory readout
    autoRunKey: 'KeyG', // noclip straight-line run for the 2 km memory test
    autoRunSpeed: 25,
    fogWarnThreshold: 0.99, // warn if an unloaded chunk could ever be less hidden than this
  },
};
