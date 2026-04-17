// state.js — single source of truth

import { mulberry32 } from './util.js';
import { createHero } from './hero.js';
import { createWorld } from './world.js';

export function createState(seed = Math.floor(Math.random() * 2 ** 31)) {
  return {
    runTime: 0,
    realmIndex: -1,
    realmTime: 0,
    phase: 'menu',              // 'menu' | 'lane' | 'arena' | 'warp' | 'results'
    currentRealm: null,
    realmScaling: 1.0,
    spawnTimer: 0,
    hazardNextSpawn: 2,
    minibossSpawned: false,
    realmBossSpawned: false,
    eventTriggered: [],
    runFailed: false,
    runFailReason: null,
    victory: false,

    hero: createHero(),
    mobs: [],
    projectiles: [],
    telegraphs: [],
    groundAoes: [],
    slashes: [],
    particles: [],
    floaters: [],
    healOrbs: [],
    banners: [],
    shakes: [],
    scheduled: [],
    hazards: [],
    eventEntities: [],
    miniboss: null,
    boss: null,
    arenaBossType: null,
    arenaPending: null,
    warpPortal: null,

    events: { active: null, schedule: [] },
    world: createWorld(),
    globalMobSpeedMult: 1.0,
    aether: 0,

    ui: {
      modalOpen: false,
      pendingPickCount: 0,
      pickPool: [],
      bannerText: null,
      debug: false,
      pauseMenu: false,
      vendorOpen: false,
      nexusShopOpen: false,
      nexusShopAvailable: false,
    },
    minibossAcceleration: 0,
    realmBossAcceleration: 0,
    deathLog: [],
    timeFreeze: { active: false, timeRemaining: 0, usedThisRealm: false },

    input: {
      keys: new Set(),
      pressedThisFrame: new Set(),
      mouse: { x: 0, y: 0, buttons: 0, worldX: 0, worldY: 0 },
      mousePressedThisFrame: new Set(),
    },

    rng: mulberry32(seed),
    seed,

    camera: { x: 0, y: -12 },   // shifted north to fit the longer lane + outposts
    canvasW: 1280,
    canvasH: 720,
    paused: false,
    fps: 0,
    frameTime: 0,
  };
}
