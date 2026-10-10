// Every tuning value in the game lives here. Units: meters, seconds, radians.

const DEG = Math.PI / 180;

// Fog density that guarantees loadRadius chunks are fully hidden (>99.5%).
// visibility = exp(-(density * d)^2). Solve for density given d and target.
function fogDensityForRadius(loadRadius, chunkCells, cellSize, hiddenFraction = 0.995) {
  const d = loadRadius * chunkCells * cellSize;
  return Math.sqrt(-Math.log(1 - hiddenFraction)) / d;
}

export const CONFIG = {
  render: {
    fov: 75,
    near: 0.05,
    far: 75,
    maxPixelRatio: 1.5,
    antialias: true,
  },

  loop: {
    maxDelta: 0.1,
  },

  atmosphere: {
    fogColor: 0x2b2512,
    // Computed at startup from loadRadius so pop-in is never visible.
    // fogDensity is set in config init below.
    fogDensity: 0, // filled in by initFogDensity()
    hemi: { sky: 0xfff0c0, ground: 0x857448, intensity: 0.25 },
  },

  world: {
    cellSize: 4,
    wallHeight: 3,
    wallThickness: 0.2,
    chunkCells: 8,
    loadRadius: 2,
    unloadDistance: 72,
    maxBuildsPerFrame: 1,
    rebaseDistance: 1000,
    edgeOpenings: [1, 3],
    extraWallRemoval: 0.3,
    roomsPerChunk: [1, 2],
    roomSize: [3, 6],
    pillarMinRoomSize: 4,
    pillarSpacing: 2,
    pillarSize: 0.6,
    panelSpacing: 2,
    panelSize: [1.2, 0.6],
    panelGap: 0.02,
    floorTint: { variation: 0.12, dampChance: 0.1, dampDarken: 0.3 },
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
      stackStep: 0.5,
      maxTilt: 0.15,
      wallMargin: 1.4,
      pileSpacing: 1.5,
      pileRadius: 0.35,
    },
    redLight: { size: [3, 4], panelColor: 0xff2010 },
    stairs: {
      size: [3, 4],
      ceiling: 7,
      steps: 16,
      rise: 0.2,
      run: 0.35,
      width: 2,
      sideBlockHeight: 0.45,
      tint: [0.8, 0.78, 0.74],
    },
  },

  textures: {
    seed: 1337,
    wallpaper: {
      meters: [4, 3],
      px: [512, 384],
      base: '#c6b25f',
      stripeEvery: 32,
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
      tiles: 6,
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
    mirrorDim: 0.55,
  },

  lighting: {
    // Fixed pool of 4 PointLights that move to the nearest panels.
    poolSize: 4,
    color: 0xfff4c0,
    intensity: 6.0,
    distance: 14,
    decay: 2,
    // Baked vertex lighting: ambient and directional terms applied at chunk build time.
    bakeAmbient: 0.18,   // base brightness added to every vertex
    bakeDirY: 0.55,      // vertical component (panels face down, so ceiling brighter)
    // Flicker
    flickerRate: 3.2,    // noise frequency (cycles/sec)
    flickerDepth: 0.15,  // peak-to-peak brightness swing under flicker
    deadPanelChance: 0.08, // fraction of normal panels that start dead
    flickerIntensityBase: 1.0, // multiplier for flickerDepth, scaled by pressure ramp
  },

  post: {
    enabled: true,
    // Film grain
    grainStrength: 0.045,
    grainSize: 1.5,
    // Vignette
    vignetteOffset: 0.4,
    vignetteDarkness: 0.7,
    // Chromatic aberration
    caStrength: 0.0014,
  },

  // Graphics presets applied at startup (or switchable in the dev panel).
  // 'preset' is the active preset name; the object under that key is merged into render/post.
  preset: 'high',
  presets: {
    low: {
      render: { antialias: false, maxPixelRatio: 1.0 },
      post: { enabled: false },
      lighting: { poolSize: 4 },
    },
    medium: {
      render: { antialias: false, maxPixelRatio: 1.25 },
      post: { enabled: true, grainStrength: 0.03, caStrength: 0.0008 },
      lighting: { poolSize: 4 },
    },
    high: {
      render: { antialias: true, maxPixelRatio: 1.5 },
      post: { enabled: true },
      lighting: { poolSize: 4 },
    },
  },

  player: {
    eyeHeight: 1.65,
    radius: 0.3,
    walkSpeed: 2.6,
    sprintSpeed: 4.8,
    accel: 12,
    decel: 14,
    stepSmoothing: 14,
  },

  input: {
    mouseSensitivity: 0.0022,
    invertY: false,
    pitchLimit: 85 * DEG,
    maxMouseDelta: 250,
  },

  collision: {
    iterations: 3,
    maxSubstep: 0.1,
  },

  audio: {
    masterVolume: 0.8,
    ambienceVolume: 0.5,
    sfxVolume: 1.0,
    entityVolume: 0.9,
    uiVolume: 0.8,
    // Hum generator
    hum: {
      sawFreq: 120,
      sineFreq: 240,
      sineGain: 0.12,
      noiseGain: 0.06,
      noiseFreqLow: 80,
      noiseFreqHigh: 400,
      baseGain: 0.18,
      flickerGainSpike: 0.9, // gain multiplier on panel flicker
      crackleMs: 120,
    },
    // Footsteps
    footsteps: {
      walkInterval: 0.52,  // seconds between steps at walk speed
      sprintInterval: 0.32,
      filterFreq: 800,
      gainBase: 0.25,
      gainVariation: 0.15,
      pitchVariation: 0.12,
      sprintGain: 0.45,
    },
    // Task audio voice cap
    taskVoiceRadius: 30,
    taskVoiceMax: 4,
  },

  game: {
    // Difficulty: timer seconds
    timerEasy: 600,
    timerNormal: 420,
    timerHard: 300,
    timer: 420, // active value; can be overridden by difficulty pick
    // Tasks
    taskDensity: 1 / 4,   // roughly one task object per N chunks within the grid
    tasksRequired: 4,     // one of each type must be completed
    interactRange: 2.0,
    interactFacingDot: 0.5,
    // Cassette
    cassetteDeliverRange: 2.5,
    // Exit door
    exitSpawnDist: 50,
    exitTone: 60, // Hz, the distinct low tone
    // Density guarantee: if no unused task within this range, force one in next chunk
    densityMinRange: 40,
    densityMaxRange: 80,
  },

  entity: {
    spawnDelay: 45,       // seconds before the entity appears (hard: 0)
    spawnMinDist: 25,
    chaseLosDist: 12,
    loseDist: 5,          // seconds without LoS => go to wander
    caughtDist: 1.0,
    relocateChunks: 2,    // if player > this many chunks away, relocate
    relocateDelay: 20,    // seconds before relocation
    gracePeriod: 10,      // seconds after losing player before can chase again
    // Pathfinding
    pathMaxExpansions: 4000,
    pathRecomputeHz: 2,
    // Wander
    wanderSpeed: 1.2,
    // Investigate
    investigateSpeed: 1.8,
    // Chase
    chaseSpeed: 3.2,
    // Hearing
    hearingRadius: 18,
    // Pressure ramp (all are multipliers at timeLeft = 0 vs timeLeft = full)
    rampSpeedMax: 1.5,
    rampHearingMax: 1.8,
    rampFlickerMax: 3.0,
    rampDeadPanelMax: 0.35,
    rampHumPitchHz: 20, // extra Hz added to hum at max pressure
    // Fairness
    overlayWarnDist: 10, // within this dist during overlay, pulse red vignette
  },

  dev: {
    infoUpdateInterval: 0.25,
    debugKey: 'Backquote',
    autoRunKey: 'KeyG',
    autoRunSpeed: 25,
    fogWarnThreshold: 0.99,
  },
};

// Compute fog density from loadRadius so pop-in is always hidden.
CONFIG.atmosphere.fogDensity = fogDensityForRadius(
  CONFIG.world.loadRadius,
  CONFIG.world.chunkCells,
  CONFIG.world.cellSize
);
