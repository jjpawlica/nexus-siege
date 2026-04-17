// realms.js — realm configs + spawn scheduler

import { spawnMob } from './mobs.js';
import { spawnLaneStructure } from './world.js';
import { uid } from './util.js';

export const REALMS = [
  {
    id: 'emberWastes',
    name: 'The Ember Wastes',
    bgColor: '#3a0a0a',
    accentColor: '#ff7a1a',
    groundTint: '#4a1414',
    realmScaling: 1.0,
    duration: 480,   // ~8 min
    hazardType: 'lavaVent',
    hazardIntervalRange: [6, 12],
    mobPool: ['cinderImp', 'ashenArcher', 'magmaBrute', 'blazeShaman'],
    mobWeights: { cinderImp: 0.55, ashenArcher: 0.20, magmaBrute: 0.10, blazeShaman: 0.15 },
    // spawn cadence: start at 1 mob / 2s, ramp to 1 mob / 0.7s
    spawnStart: 2.0, spawnEnd: 0.7,
    eventType: 'emberRift',
    eventTimings: [120, 360],   // 2m, 6m
    minibossAt: 240,             // 4m
    minibossType: 'cinderjaw',
    realmBossAt: 480,            // end
    realmBossType: 'pyrexus',
  },
  {
    id: 'frostDeeps',
    name: 'The Frost Deeps',
    bgColor: '#0a1a3a',
    accentColor: '#a0e0ff',
    groundTint: '#12234a',
    realmScaling: 1.3,
    duration: 480,
    hazardType: 'icePatch',
    hazardIntervalRange: [0, 0],   // static ice patches
    mobPool: ['rimewraith', 'frostLancer', 'glacialTyrant', 'blizzardOracle'],
    mobWeights: { rimewraith: 0.55, frostLancer: 0.20, glacialTyrant: 0.10, blizzardOracle: 0.15 },
    spawnStart: 3.0, spawnEnd: 1.0,
    eventType: 'frostboundTotem',
    eventTimings: [120, 360],
    minibossAt: 240,
    minibossType: 'frostbiteAlpha',
    realmBossAt: 480,
    realmBossType: 'cryaxar',
  },
];

export function startRealm(state, index) {
  const realm = REALMS[index];
  state.realmIndex = index;
  state.realmTime = 0;
  state.realmScaling = realm.realmScaling;
  state.currentRealm = realm;
  state.spawnTimer = 0;
  state.mobs = [];
  state.projectiles = [];
  state.telegraphs = [];
  state.groundAoes = [];
  state.hazards = [];
  state.eventTriggered = [];
  state.minibossSpawned = false;
  state.realmBossSpawned = false;
  state.minibossAcceleration = 0;
  state.realmBossAcceleration = 0;
  state.meteorTimer = 20;       // sporadic realm hazard interval
  state.blizzardSweepTimer = 25;
  state.rearWaveTimer = 70;     // first rear breach ~70s in
  state.phase = 'lane';

  // Pre-place hazards (static) — ice patches for Frost Deeps
  if (realm.hazardType === 'icePatch') {
    for (let i = 0; i < 6; i++) {
      const x = -5 + state.rng.next() * 10;
      const y = -22 + state.rng.next() * 18;
      state.hazards.push({ type: 'icePatch', pos: { x, y }, radius: 1.5, permanent: true });
    }
  }

  // Lane structures (enemy outposts) — 2 per lane
  // T1 (outer, nearer player) at y=-20; T2 (deep, far) at y=-24
  spawnLaneStructure(state, 't1', { x: 0, y: -20 });
  spawnLaneStructure(state, 't2', { x: 0, y: -24 });

  state.banners.push({
    text: realm.name, color: realm.accentColor,
    age: 0, ttl: 3.0, big: true,
  });
}

export function updateSpawns(state, dt) {
  const realm = state.currentRealm;
  if (!realm) return;
  if (state.phase !== 'lane') return;
  if (state.realmBossSpawned || state.runFailed) return;

  // Spawn rate interpolation
  const t = Math.min(1, state.realmTime / realm.duration);
  const interval = realm.spawnStart + (realm.spawnEnd - realm.spawnStart) * t;
  state.spawnTimer += dt;
  if (state.spawnTimer >= interval) {
    state.spawnTimer -= interval;
    const type = pickWeighted(state.rng, realm.mobWeights);
    const x = -4 + state.rng.next() * 8;
    const y = state.world.spawnPoint.y + (state.rng.next() - 0.5) * 2;
    spawnMob(state, type, { x, y });
  }

  // Hazards (lava vents etc.)
  updateHazards(state, dt, realm);

  // Rear-breach waves (enemies spawn behind the defenses near the Nexus)
  updateRearWaves(state, dt, realm);

  // Event schedule
  for (let i = 0; i < realm.eventTimings.length; i++) {
    if (state.realmTime >= realm.eventTimings[i] && !state.eventTriggered[i]) {
      state.eventTriggered[i] = true;
      triggerEvent(state, realm.eventType);
    }
  }
}

function updateHazards(state, dt, realm) {
  // Per-realm base hazard (lava vents for Ember Wastes)
  if (realm.hazardType === 'lavaVent') {
    if (state.hazardNextSpawn === undefined) state.hazardNextSpawn = 2;
    state.hazardNextSpawn -= dt;
    if (state.hazardNextSpawn <= 0) {
      const [lo, hi] = realm.hazardIntervalRange;
      state.hazardNextSpawn = lo + state.rng.next() * (hi - lo);
      const x = -5 + state.rng.next() * 10;
      const y = -23 + state.rng.next() * 20;
      state.telegraphs.push({
        id: Math.random(),
        shape: 'circle',
        origin: { x, y },
        radius: 1.5,
        color: '#ff5030',
        windUp: 2.0, commit: 0.1, execute: 1.0,
        phase: 'windUp', age: 0,
        damage: 40, source: 'hazard', fromMob: true,
        onExecute: (s) => {
          s.groundAoes.push({
            pos: { x, y }, radius: 1.5,
            age: 0, ttl: 1.0,
            dps: 40, tickAccum: 0, tickRate: 0.25,
            source: 'mob', color: '#ff5030',
            hitIds: new Set(),
          });
        },
      });
    }
  }

  // Sporadic atmospheric events per realm
  if (realm.id === 'emberWastes') {
    state.meteorTimer = (state.meteorTimer ?? 20) - dt;
    if (state.meteorTimer <= 0) {
      state.meteorTimer = 18 + state.rng.next() * 12;
      spawnMeteor(state);
    }
  } else if (realm.id === 'frostDeeps') {
    state.blizzardSweepTimer = (state.blizzardSweepTimer ?? 25) - dt;
    if (state.blizzardSweepTimer <= 0) {
      state.blizzardSweepTimer = 22 + state.rng.next() * 15;
      spawnBlizzardGust(state);
    }
  }
}

function spawnMeteor(state) {
  const tx = -5 + state.rng.next() * 10;
  const ty = -22 + state.rng.next() * 18;
  state.telegraphs.push({
    id: Math.random(),
    shape: 'circle',
    origin: { x: tx, y: ty },
    radius: 2.2,
    color: '#ff3000',
    windUp: 2.5, commit: 0.2, execute: 0.15,
    phase: 'windUp', age: 0,
    damage: 80, source: 'hazard', fromMob: true,
    onExecute: (s) => {
      s.shakes.push({ mag: 0.7, ttl: 0.35, age: 0 });
      s.groundAoes.push({
        pos: { x: tx, y: ty }, radius: 2.4,
        age: 0, ttl: 1.6,
        dps: 20, tickAccum: 0, tickRate: 0.3,
        source: 'mob', color: '#ff3000',
        hitIds: new Set(),
      });
      // Meteor also damages mobs — falling rocks hit anyone
      for (const m of s.mobs) {
        if (m.dead || m.eventEntity || m.structure) continue;
        if (Math.hypot(m.pos.x - tx, m.pos.y - ty) <= 2.2 + m.radius) {
          m.hp -= 30;
          s.floaters.push({ pos: { x: m.pos.x, y: m.pos.y - 0.4 }, text: '30', color: '#ff9040', age: 0, ttl: 0.7, vy: -1.0, size: 14 });
        }
      }
    },
  });
  // Pre-warning banner (subtle)
  state.banners.push({
    text: 'METEOR INCOMING', color: '#ff6030', age: 0, ttl: 1.2, big: false,
  });
}

function updateRearWaves(state, dt, realm) {
  state.rearWaveTimer = (state.rearWaveTimer ?? 70) - dt;
  if (state.rearWaveTimer <= 0) {
    state.rearWaveTimer = 75 + state.rng.next() * 40;   // next: 75-115s
    spawnRearWave(state, realm);
  }
}

function spawnRearWave(state, realm) {
  const nexus = state.world.nexus;
  const count = 3 + state.rng.int(0, 1);   // 3-4 mobs
  const startAng = state.rng.next() * Math.PI * 2;
  state.banners.push({
    text: '⚠ REAR BREACH — ENEMIES BEHIND YOU',
    color: '#ff3030', age: 0, ttl: 2.5, big: true, bordered: 'red',
  });
  state.shakes.push({ mag: 0.35, ttl: 0.4, age: 0 });
  const pool = realm.id === 'emberWastes'
    ? ['magmaBrute', 'cinderImp', 'cinderImp', 'ashenArcher', 'blazeShaman']
    : ['glacialTyrant', 'rimewraith', 'rimewraith', 'frostLancer', 'blizzardOracle'];
  for (let i = 0; i < count; i++) {
    const ang = startAng + (i / count) * Math.PI * 2 + (state.rng.next() - 0.5) * 0.4;
    const dist = 3.5 + state.rng.next() * 2;
    const pos = { x: nexus.pos.x + Math.cos(ang) * dist, y: nexus.pos.y + Math.sin(ang) * dist };
    state.telegraphs.push({
      id: uid(),
      shape: 'circle',
      origin: pos,
      radius: 1.0,
      color: '#ff3030',
      windUp: 1.5, commit: 0.1, execute: 0.05,
      phase: 'windUp', age: 0,
      damage: 0, source: 'rearwave', fromMob: false,
      onExecute: (s) => {
        const type = s.rng.pick(pool);
        spawnMob(s, type, { x: pos.x, y: pos.y });
      },
    });
  }
}

function spawnBlizzardGust(state) {
  const fromLeft = state.rng.next() < 0.5;
  const startX = fromLeft ? -18 : 18;
  const endX = -startX;
  const y = -16 + (state.rng.next() - 0.5) * 10;
  state.groundAoes.push({
    pos: { x: startX, y },
    radius: 1.8,
    age: 0, ttl: 8,
    dps: 12, tickAccum: 0, tickRate: 0.4,
    source: 'mob', color: '#a0e0ff',
    hitIds: new Set(),
    moving: true, vel: { x: (endX - startX) / 8, y: 0 },
  });
  state.banners.push({
    text: 'BLIZZARD GUST', color: '#a0e0ff', age: 0, ttl: 1.2, big: false,
  });
}

function pickWeighted(rng, weights) {
  let total = 0;
  for (const w of Object.values(weights)) total += w;
  let r = rng.next() * total;
  for (const [k, w] of Object.entries(weights)) {
    r -= w;
    if (r <= 0) return k;
  }
  return Object.keys(weights)[0];
}

function triggerEvent(state, type) {
  import('./events.js').then(m => m.startEvent(state, type));
}

// Check end-of-realm conditions
export function checkRealmTransitions(state) {
  const realm = state.currentRealm;
  if (!realm) return;

  const minibossThreshold = realm.minibossAt - (state.minibossAcceleration || 0);
  const realmBossThreshold = realm.realmBossAt - (state.realmBossAcceleration || 0);

  // Miniboss trigger
  if (!state.minibossSpawned && state.realmTime >= minibossThreshold && state.phase === 'lane') {
    import('./bosses.js').then(m => m.spawnMiniboss(state, realm.minibossType));
    state.minibossSpawned = true;
  }

  // Realm boss trigger: end of duration AND no active miniboss
  const minibossStillAlive = state.miniboss && !state.miniboss.dead;
  if (!state.realmBossSpawned && state.realmTime >= realmBossThreshold && !minibossStillAlive && state.phase === 'lane') {
    import('./bosses.js').then(m => m.triggerRealmBoss(state, realm.realmBossType));
    state.realmBossSpawned = true;
  }
}
