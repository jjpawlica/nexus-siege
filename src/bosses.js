// bosses.js — miniboss + realm boss + Nexus boss state machines

import { uid, vDir, vDist, angleBetween } from './util.js';
import { damageHero } from './hero.js';
import { mobIsHardCC, mobMoveSpeedMult, updateStatusesForMob } from './damage.js';
import { circleCircle } from './collision.js';

export const MINIBOSS_TIMEOUT = 240; // 4 minutes per spec

export function spawnMiniboss(state, type) {
  const def = MINIBOSS_DEFS[type];
  if (!def) return;
  const boss = {
    id: uid(),
    type,
    bossKind: 'miniboss',
    pos: { x: 0, y: -22 },
    facing: Math.PI / 2,
    hp: def.hp, maxHp: def.hp,
    damage: def.damage,
    speed: def.speed,
    radius: def.radius,
    resist: def.resist,
    fsmState: 'approach',
    phase: 1,
    mechanicTimers: {},
    statuses: [],
    color: def.color, accent: def.accent,
    dead: false,
    boss: true,           // towers won't target, mobs distinct
    def,
    name: def.name,
    spawnTime: state.runTime,
    timeoutAt: state.runTime + MINIBOSS_TIMEOUT,
    enraged: false,
    timedOut: false,
  };
  state.mobs.push(boss);
  state.miniboss = boss;

  state.banners.push({
    text: `MINIBOSS: ${def.name.toUpperCase()} — 4:00 TO KILL`,
    color: '#ffdc3a', age: 0, ttl: 2.5, big: true, bordered: 'red',
  });
}

export function triggerRealmBoss(state, type) {
  // Open a portal near Nexus that the hero must enter to start the arena fight
  state.warpPortal = {
    pos: { x: 0, y: 5 },
    radius: 1.2,
    bossType: type,
    kind: 'realmBoss',
    bannerShown: false,
  };
  state.banners.push({
    text: 'REALM BOSS PORTAL OPEN — STEP INSIDE', color: '#ffdc3a',
    age: 0, ttl: 4, big: true, bordered: 'yellow',
  });
}

export function triggerNexusBoss(state) {
  state.warpPortal = {
    pos: { x: 0, y: 5 },
    radius: 1.5,
    bossType: 'riftEternal',
    kind: 'nexusBoss',
    bannerShown: false,
  };
  state.banners.push({
    text: 'THE NEXUS CRACKS — FINAL PORTAL OPEN', color: '#ff4080',
    age: 0, ttl: 4, big: true, bordered: 'red',
  });
}

export function updatePortal(state, dt) {
  if (!state.warpPortal) return;
  const hero = state.hero;
  const p = state.warpPortal;
  if (vDist(hero.pos, p.pos) <= p.radius + hero.radius) {
    // Enter arena
    enterArena(state, p.bossType, p.kind);
    state.warpPortal = null;
  }
}

function enterArena(state, bossType, kind) {
  state.phase = 'arena';
  state.arenaBossType = bossType;
  // Pause mobs by removing them from the field (store for restoration? Simpler: despawn non-boss mobs.)
  // Per spec: mob spawns pause, Nexus pressure pauses.
  // We remove lane mobs when entering arena.
  state.mobs = state.mobs.filter(m => m.boss && m.bossKind === 'realmBoss'); // should be empty
  state.projectiles = state.projectiles.filter(p => p.source !== 'mob');
  state.telegraphs = [];
  state.groundAoes = [];
  state.eventEntities = [];
  state.events.active = null;

  // Place hero at arena start
  state.hero.pos = { x: 0, y: 8 };
  state.camera.x = 0;
  state.camera.y = 0;

  // Spawn the boss
  if (kind === 'realmBoss') {
    spawnRealmBoss(state, bossType);
  } else if (kind === 'nexusBoss') {
    spawnNexusBoss(state);
  }

  state.banners.push({
    text: 'ARENA ENGAGED', color: '#ffffff', age: 0, ttl: 1.8, big: true,
  });
}

function spawnRealmBoss(state, type) {
  const def = REALM_BOSS_DEFS[type];
  if (!def) return;
  const boss = createBoss(state, type, def, 'realmBoss', { x: 0, y: -8 });
  state.boss = boss;
  state.banners.push({
    text: `${def.name.toUpperCase()}`, color: def.accent, age: 0, ttl: 2.5, big: true, bordered: 'red',
  });
}

function spawnNexusBoss(state) {
  const def = REALM_BOSS_DEFS.riftEternal;
  const boss = createBoss(state, 'riftEternal', def, 'nexusBoss', { x: 0, y: -8 });
  state.boss = boss;
  state.banners.push({
    text: `THE RIFT ETERNAL`, color: def.accent, age: 0, ttl: 3, big: true, bordered: 'red',
  });
}

function createBoss(state, type, def, bossKind, pos) {
  return {
    id: uid(),
    type, bossKind,
    pos: { x: pos.x, y: pos.y },
    facing: Math.PI / 2,
    hp: def.hp, maxHp: def.hp,
    damage: def.damage, speed: def.speed,
    radius: def.radius, resist: def.resist,
    fsmState: 'intro', phaseIndex: 0,
    phaseTimer: 0,
    mechanicTimers: {},
    statuses: [],
    color: def.color, accent: def.accent,
    dead: false, boss: true, def,
    name: def.name,
    attackCd: 0, windUpTimer: 0,
    nextMechanic: 0,
    enrageAt: state.runTime + (def.enrageAfter || 999),
    enraged: false,
    spawnTime: state.runTime,
  };
}

// --- Definitions ---

export const MINIBOSS_DEFS = {
  cinderjaw: {
    name: 'Cinderjaw', color: '#501020', accent: '#ff6a30',
    hp: 800, damage: 18, speed: 2.6, radius: 1.1, resist: 0.1,
    biteCd: 1.4, biteRange: 2.2, biteHalfAngle: Math.PI / 5,
    rollingInfernoCd: 12,
    enrageAtPct: 0.3,
  },
  frostbiteAlpha: {
    name: 'Frostbite Alpha', color: '#3050a0', accent: '#a0e0ff',
    hp: 1170, damage: 22, speed: 2.8, radius: 1.0, resist: 0.2,
    leapCd: 10, howlCd: 20, auraRadius: 5, auraSlow: 0.15,
  },
};

export const REALM_BOSS_DEFS = {
  pyrexus: {
    name: 'Pyrexus the Sunderer',
    color: '#551010', accent: '#ff7030',
    hp: 2500, damage: 25, speed: 2.0, radius: 1.6, resist: 0.2,
    phases: 3,
    arena: { shape: 'circle', radius: 20 },
    enrageAfter: 360,    // 6 min — DPS check
  },
  cryaxar: {
    name: 'Cryaxar the Glacial Tyrant',
    color: '#1a2060', accent: '#80a0ff',
    hp: 4160, damage: 30, speed: 1.5, radius: 1.8, resist: 0.25,
    phases: 3,
    arena: { shape: 'rect', w: 25, h: 15 },
    enrageAfter: 420,    // 7 min
  },
  riftEternal: {
    name: 'The Rift Eternal',
    color: '#402040', accent: '#ff40a0',
    hp: 5000, damage: 32, speed: 1.8, radius: 1.7, resist: 0.3,
    phases: 3,
    arena: { shape: 'circle', radius: 25 },
    enrageAfter: 600,    // 10 min
  },
};

// --- Per-tick updates ---

export function updateBoss(state, dt) {
  // Miniboss timeout: spec says 4 min → timeout debuff, no buff reward
  if (state.miniboss && !state.miniboss.dead && state.runTime >= state.miniboss.timeoutAt) {
    applyMinibossTimeoutDebuff(state, state.miniboss);
    state.miniboss.dead = true;
    state.miniboss.timedOut = true;
    state.miniboss = null;
  }

  if (state.miniboss && !state.miniboss.dead) updateMiniboss(state, state.miniboss, dt);
  if (state.boss && !state.boss.dead) updateRealmBoss(state, state.boss, dt);
  if (state.miniboss && state.miniboss.dead) {
    if (!state.miniboss.timedOut) onMinibossDefeated(state);
    state.miniboss = null;
  }
  if (state.boss && state.boss.dead) {
    onBossDefeated(state);
  }
}

function applyMinibossTimeoutDebuff(state, boss) {
  const hero = state.hero;
  if (boss.type === 'cinderjaw') {
    hero.mods.healMult = (hero.mods.healMult || 1) * 0.85;   // Scorched: heal -15%
    hero.buffs.push({ name: 'Scorched (-15% heal)', age: 0, ttl: 9999, debuff: true });
    state.banners.push({ text: 'TIMEOUT — SCORCHED', color: '#ff3030', age: 0, ttl: 3, big: true, bordered: 'red' });
  } else if (boss.type === 'frostbiteAlpha') {
    hero.mods.dodgeCDMult = (hero.mods.dodgeCDMult || 1) * 1.20;  // Numbed: dodge CD +20%
    hero.buffs.push({ name: 'Numbed (+20% dodge CD)', age: 0, ttl: 9999, debuff: true });
    state.banners.push({ text: 'TIMEOUT — NUMBED', color: '#3080c0', age: 0, ttl: 3, big: true, bordered: 'red' });
  }
}

function updateMiniboss(state, boss, dt) {
  updateStatusesForMob(state, boss, dt);
  if (boss.hp <= 0) { boss.dead = true; return; }
  if (mobIsHardCC(boss)) return;

  const hero = state.hero;
  const d = boss.def;
  const distToHero = vDist(boss.pos, hero.pos);
  boss.facing = angleBetween(boss.pos, hero.pos);

  // Enrage
  if (boss.hp / boss.maxHp <= (d.enrageAtPct || 0.3) && !boss.enraged) {
    boss.enraged = true;
    state.banners.push({ text: `${d.name} ENRAGES!`, color: '#ff4040', age: 0, ttl: 1.6, big: false });
  }
  const speed = d.speed * (boss.enraged ? 1.3 : 1.0) * mobMoveSpeedMult(boss);
  const atkSpd = boss.enraged ? 0.5 : 1.0;

  // Close distance
  if (distToHero > d.biteRange && (boss.windUpTimer || 0) <= 0) {
    const dir = vDir(boss.pos, hero.pos);
    boss.pos.x += dir.x * speed * dt;
    boss.pos.y += dir.y * speed * dt;
  }

  // Type-specific mechanics
  if (boss.type === 'cinderjaw') runCinderjaw(state, boss, dt, atkSpd);
  if (boss.type === 'frostbiteAlpha') runFrostbiteAlpha(state, boss, dt, atkSpd);
}

function runCinderjaw(state, boss, dt, atkSpd) {
  const d = boss.def;
  boss.attackCd -= dt;
  boss.windUpTimer = (boss.windUpTimer || 0) - dt;

  // Rolling Inferno every d.rollingInfernoCd
  if (!boss.mechanicTimers.ri) boss.mechanicTimers.ri = d.rollingInfernoCd - 3;
  boss.mechanicTimers.ri -= dt;
  if (boss.mechanicTimers.ri <= 0) {
    boss.mechanicTimers.ri = d.rollingInfernoCd * atkSpd;
    // Pick a direction across lane
    const dir = Math.cos(state.rng.next() * Math.PI * 2);
    const startX = -6, endX = 6;
    const y = boss.pos.y;
    // Telegraph line
    state.telegraphs.push({
      id: uid(), shape: 'line',
      origin: { x: startX, y }, end: { x: endX, y },
      width: 1.5,
      color: '#ff4030',
      windUp: 0.9, commit: 0.2, execute: 0.1,
      phase: 'windUp', age: 0,
      damage: d.damage * 1.2, source: boss.id, sourceName: d.name || boss.name, fromMob: true,
      onExecute: (s) => {
        // spawn fire trail ground aoe
        for (let x = -6; x <= 6; x += 0.6) {
          s.groundAoes.push({
            pos: { x, y }, radius: 0.6,
            age: 0, ttl: 3.0,
            dps: 8, tickAccum: 0, tickRate: 0.25,
            source: 'mob', color: '#ff5030',
            hitIds: new Set(),
          });
        }
      },
    });
  }

  // Bite
  const hero = state.hero;
  const dist = vDist(boss.pos, hero.pos);
  if (boss.attackCd <= 0 && boss.windUpTimer <= 0 && dist <= d.biteRange + 0.3) {
    boss.windUpTimer = 0.3 * atkSpd;
    boss.attackCd = d.biteCd * atkSpd;
    state.telegraphs.push({
      id: uid(), shape: 'cone',
      origin: { x: boss.pos.x, y: boss.pos.y },
      facing: boss.facing, halfAngle: d.biteHalfAngle, radius: d.biteRange,
      color: '#ff5a2a',
      windUp: 0, commit: 0.2, execute: 0.1,
      phase: 'commit', age: 0,
      damage: d.damage, source: boss.id, sourceName: d.name || boss.name, fromMob: true,
    });
  }
}

function runFrostbiteAlpha(state, boss, dt, atkSpd) {
  const d = boss.def;
  boss.attackCd -= dt;
  boss.windUpTimer = (boss.windUpTimer || 0) - dt;
  // Passive slow aura
  const hero = state.hero;
  if (vDist(boss.pos, hero.pos) <= d.auraRadius) {
    // apply slow once per second
    boss.mechanicTimers.aura = (boss.mechanicTimers.aura || 0) - dt;
    if (boss.mechanicTimers.aura <= 0) {
      boss.mechanicTimers.aura = 1.0;
      if (!hero.statuses) hero.statuses = [];
      hero.statuses.push({ type: 'slow', percent: d.auraSlow, age: 0, ttl: 1.2 });
    }
  }
  // Leap Strike
  if (!boss.mechanicTimers.leap) boss.mechanicTimers.leap = d.leapCd - 3;
  boss.mechanicTimers.leap -= dt;
  if (boss.mechanicTimers.leap <= 0) {
    boss.mechanicTimers.leap = d.leapCd * atkSpd;
    state.telegraphs.push({
      id: uid(), shape: 'circle',
      origin: { x: hero.pos.x, y: hero.pos.y },
      radius: 2.0, color: '#80a0ff',
      windUp: 1.2, commit: 0.15, execute: 0.1,
      phase: 'windUp', age: 0,
      damage: d.damage, source: boss.id, sourceName: d.name || boss.name, fromMob: true,
      stun: 1.0,
      leapTarget: { x: hero.pos.x, y: hero.pos.y },
      onExecute: (s) => {
        // teleport boss to the target
        boss.pos.x = hero.pos.x;
        boss.pos.y = hero.pos.y;
      },
    });
  }
  // Pack Howl
  if (!boss.mechanicTimers.howl) boss.mechanicTimers.howl = d.howlCd - 5;
  boss.mechanicTimers.howl -= dt;
  if (boss.mechanicTimers.howl <= 0) {
    boss.mechanicTimers.howl = d.howlCd * atkSpd;
    import('./mobs.js').then(m => {
      for (let i = 0; i < 3; i++) {
        const w = m.spawnMob(state, 'rimewraith', {
          x: boss.pos.x + (state.rng.next() - 0.5) * 2,
          y: boss.pos.y + (state.rng.next() - 0.5) * 2,
        });
        if (w) w.speed *= 1.2;
      }
    });
    state.banners.push({ text: 'PACK HOWL!', color: '#80a0ff', age: 0, ttl: 1.5, big: false });
  }
  // Basic melee
  const dist = vDist(boss.pos, hero.pos);
  if (boss.attackCd <= 0 && boss.windUpTimer <= 0 && dist <= 2.0) {
    boss.windUpTimer = 0.35 * atkSpd;
    boss.attackCd = 1.6 * atkSpd;
    state.telegraphs.push({
      id: uid(), shape: 'cone',
      origin: { x: boss.pos.x, y: boss.pos.y },
      facing: boss.facing, halfAngle: Math.PI / 4, radius: 2.2,
      color: '#80a0ff',
      windUp: 0, commit: 0.2, execute: 0.1,
      phase: 'commit', age: 0,
      damage: d.damage, source: boss.id, sourceName: d.name || boss.name, fromMob: true,
    });
  }
}

function updateRealmBoss(state, boss, dt) {
  updateStatusesForMob(state, boss, dt);
  if (boss.hp <= 0) { boss.dead = true; return; }
  if (mobIsHardCC(boss)) return;

  // Enrage check (DPS check — per-boss enrageAfter value)
  if (!boss.enraged && state.runTime >= boss.enrageAt) {
    boss.enraged = true;
    boss.damage = Math.round(boss.damage * 1.5);
    state.banners.push({
      text: `${boss.name.toUpperCase()} ENRAGES`,
      color: '#ff2020', age: 0, ttl: 2.8, big: true, bordered: 'red',
    });
    state.shakes.push({ mag: 0.8, ttl: 0.6, age: 0 });
  }

  // Phase transitions
  const pct = boss.hp / boss.maxHp;
  const desiredPhase = pct > 0.66 ? 0 : pct > 0.33 ? 1 : 2;
  if (desiredPhase !== boss.phaseIndex) {
    boss.phaseIndex = desiredPhase;
    state.banners.push({
      text: `PHASE ${desiredPhase + 1}`,
      color: '#ffffff', age: 0, ttl: 1.5, big: true,
    });
    // brief invuln flash
    boss.statuses.push({ type: 'stun', age: 0, ttl: 0.3 });
    boss.mechanicTimers = {};
  }

  const hero = state.hero;
  const d = boss.def;
  boss.facing = angleBetween(boss.pos, hero.pos);
  boss.attackCd -= dt;

  const dist = vDist(boss.pos, hero.pos);

  if (boss.type === 'pyrexus') runPyrexus(state, boss, dt);
  else if (boss.type === 'cryaxar') runCryaxar(state, boss, dt);
  else if (boss.type === 'riftEternal') runRiftEternal(state, boss, dt);
}

function runPyrexus(state, boss, dt) {
  if (boss.enraged) dt *= 1.4;   // enrage: mechanics fire faster
  const d = boss.def;
  const hero = state.hero;
  boss.mechanicTimers.basic = (boss.mechanicTimers.basic || 3.5) - dt;
  boss.mechanicTimers.lineRupture = (boss.mechanicTimers.lineRupture || 4) - dt;
  boss.mechanicTimers.fissure = (boss.mechanicTimers.fissure || 10) - dt;
  boss.mechanicTimers.summon = (boss.mechanicTimers.summon || 15) - dt;
  boss.mechanicTimers.meltdown = (boss.mechanicTimers.meltdown || 12) - dt;

  // Movement: slow step toward hero until in medium range
  const dist = vDist(boss.pos, hero.pos);
  if (dist > 3.0) {
    const dir = vDir(boss.pos, hero.pos);
    boss.pos.x += dir.x * d.speed * dt;
    boss.pos.y += dir.y * d.speed * dt;
  }

  // Phase 1 — basic slam + line rupture
  if (boss.mechanicTimers.basic <= 0) {
    boss.mechanicTimers.basic = 3.5;
    // small AoE slam
    state.telegraphs.push({
      id: uid(), shape: 'circle',
      origin: { x: hero.pos.x, y: hero.pos.y },
      radius: 1.8, color: '#ff7030',
      windUp: 0.8, commit: 0.2, execute: 0.1,
      phase: 'windUp', age: 0,
      damage: d.damage, source: boss.id, sourceName: d.name || boss.name, fromMob: true,
    });
  }
  if (boss.mechanicTimers.lineRupture <= 0) {
    boss.mechanicTimers.lineRupture = 6;
    const dx = hero.pos.x - boss.pos.x, dy = hero.pos.y - boss.pos.y;
    const L = Math.hypot(dx, dy) || 1;
    const ex = dx / L, ey = dy / L;
    const len = 14;
    state.telegraphs.push({
      id: uid(), shape: 'line',
      origin: { x: boss.pos.x, y: boss.pos.y },
      end: { x: boss.pos.x + ex * len, y: boss.pos.y + ey * len },
      width: 1.2,
      color: '#ff3020',
      windUp: 1.0, commit: 0.2, execute: 0.1,
      phase: 'windUp', age: 0,
      damage: d.damage * 1.4, source: boss.id, sourceName: d.name || boss.name, fromMob: true,
    });
  }

  // Phase 2 — summon + fissure
  if (boss.phaseIndex >= 1) {
    if (boss.mechanicTimers.summon <= 0) {
      boss.mechanicTimers.summon = 15;
      import('./mobs.js').then(m => {
        m.spawnMob(state, 'cinderImp', { x: boss.pos.x - 1.5, y: boss.pos.y - 1.5 });
        m.spawnMob(state, 'cinderImp', { x: boss.pos.x + 1.5, y: boss.pos.y - 1.5 });
      });
    }
    if (boss.mechanicTimers.fissure <= 0) {
      boss.mechanicTimers.fissure = 10;
      // 3 concentric rings
      for (let i = 0; i < 3; i++) {
        const r = 2 + i * 2.5;
        state.telegraphs.push({
          id: uid(), shape: 'ring',
          origin: { x: boss.pos.x, y: boss.pos.y },
          radius: r, innerRadius: r - 1.0,
          color: '#ff5030',
          windUp: 0.6 + i * 0.35, commit: 0.25, execute: 0.1,
          phase: 'windUp', age: 0,
          damage: d.damage, source: boss.id, sourceName: d.name || boss.name, fromMob: true,
        });
      }
    }
  }

  // Phase 3 — enrage + meltdown
  if (boss.phaseIndex >= 2) {
    if (boss.mechanicTimers.meltdown <= 0) {
      boss.mechanicTimers.meltdown = 18;
      // Meltdown: 3s yellow channel; if NOT interrupted (by any hero damage during channel), heals 20%
      boss.channelHealActive = true;
      boss.channelInterrupted = false;
      state.banners.push({ text: 'MELTDOWN — INTERRUPT!', color: '#ffdc3a', age: 0, ttl: 1.8, big: false, bordered: 'yellow' });
      state.telegraphs.push({
        id: uid(), shape: 'circle',
        origin: { x: boss.pos.x, y: boss.pos.y },
        radius: 2.5, color: '#ffdc3a',
        windUp: 3.0, commit: 0.1, execute: 0.05,
        phase: 'windUp', age: 0,
        damage: 0, source: boss.id, fromMob: false,
        onExecute: (s) => {
          boss.channelHealActive = false;
          if (!boss.channelInterrupted) {
            boss.hp = Math.min(boss.maxHp, boss.hp + Math.round(boss.maxHp * 0.20));
            s.banners.push({ text: `${boss.name} HEALS`, color: '#ffdc3a', age: 0, ttl: 1.5, big: false });
          } else {
            s.banners.push({ text: 'MELTDOWN INTERRUPTED', color: '#80ff80', age: 0, ttl: 1.5, big: false });
          }
        },
      });
    }
  }
}

function runCryaxar(state, boss, dt) {
  if (boss.enraged) dt *= 1.4;
  const d = boss.def;
  const hero = state.hero;
  boss.mechanicTimers.slam = (boss.mechanicTimers.slam || 3) - dt;
  boss.mechanicTimers.spikes = (boss.mechanicTimers.spikes || 5) - dt;
  boss.mechanicTimers.warming = (boss.mechanicTimers.warming || 15) - dt;
  boss.mechanicTimers.freezeTick = (boss.mechanicTimers.freezeTick || 1) - dt;
  boss.mechanicTimers.blizzard = (boss.mechanicTimers.blizzard || 6) - dt;

  const dist = vDist(boss.pos, hero.pos);
  if (dist > 3.5) {
    const dir = vDir(boss.pos, hero.pos);
    boss.pos.x += dir.x * d.speed * dt;
    boss.pos.y += dir.y * d.speed * dt;
  }

  // Phase 1 — ground slams + glacial spikes
  if (boss.mechanicTimers.slam <= 0) {
    boss.mechanicTimers.slam = 3.2;
    state.telegraphs.push({
      id: uid(), shape: 'circle',
      origin: { x: hero.pos.x, y: hero.pos.y },
      radius: 2.0, color: '#80a0ff',
      windUp: 0.8, commit: 0.2, execute: 0.1,
      phase: 'windUp', age: 0,
      damage: d.damage, source: boss.id, sourceName: d.name || boss.name, fromMob: true,
    });
  }
  if (boss.mechanicTimers.spikes <= 0) {
    boss.mechanicTimers.spikes = 5;
    // 3 spikes at hero's current position + two offsets
    for (let i = -1; i <= 1; i++) {
      state.telegraphs.push({
        id: uid(), shape: 'circle',
        origin: { x: hero.pos.x + i * 2, y: hero.pos.y + i * 1 },
        radius: 1.0, color: '#ffdc3a',
        windUp: 1.0, commit: 0.2, execute: 0.1,
        phase: 'windUp', age: 0,
        damage: d.damage * 0.9, source: boss.id, sourceName: d.name || boss.name, fromMob: true,
      });
    }
  }

  // Phase 2 — freeze stacks mechanic
  if (boss.phaseIndex >= 1) {
    // Apply 1 freeze stack on each basic slam hit — approximated via a tick
    boss.mechanicTimers.freezeTick -= dt;
    if (boss.mechanicTimers.freezeTick <= 0) {
      boss.mechanicTimers.freezeTick = 2.0;
      if (dist <= 6) {
        // add freeze stack to hero
        if (!hero.statuses) hero.statuses = [];
        const f = hero.statuses.find(s => s.type === 'freezeStack');
        if (f) { f.stacks = Math.min(5, f.stacks + 1); f.age = 0; f.ttl = 10; }
        else hero.statuses.push({ type: 'freezeStack', stacks: 1, age: 0, ttl: 10 });
        const fs = hero.statuses.find(s => s.type === 'freezeStack');
        if (fs && fs.stacks >= 5) {
          hero.stunned = 3.0;
          fs.stacks = 0;
          state.banners.push({ text: 'FROZEN!', color: '#80a0ff', age: 0, ttl: 1.5, big: true, bordered: 'red' });
        }
      }
    }
    if (boss.mechanicTimers.warming <= 0) {
      boss.mechanicTimers.warming = 15;
      const wx = -8 + state.rng.next() * 16;
      const wy = -14 + state.rng.next() * 12;
      state.groundAoes.push({
        pos: { x: wx, y: wy }, radius: 1.6,
        age: 0, ttl: 12, dps: 0, tickAccum: 0, tickRate: 0.25,
        source: 'beneficial', color: '#ffe060',
        warming: true,
        hitIds: new Set(),
      });
    }
  }

  // Phase 3 — blizzard storm
  if (boss.phaseIndex >= 2) {
    if (boss.mechanicTimers.blizzard <= 0) {
      boss.mechanicTimers.blizzard = 7;
      const fromLeft = state.rng.next() < 0.5;
      const startX = fromLeft ? -18 : 18;
      const endX = -startX;
      const y = -6 + (state.rng.next() - 0.5) * 6;
      // Spawn a moving ground AoE
      state.groundAoes.push({
        pos: { x: startX, y },
        radius: 2.0,
        age: 0, ttl: 6,
        dps: 25, tickAccum: 0, tickRate: 0.4,
        source: 'mob', color: '#a0e0ff',
        hitIds: new Set(),
        moving: true, vel: { x: (endX - startX) / 6, y: 0 },
      });
    }
  }
}

function runRiftEternal(state, boss, dt) {
  if (boss.enraged) dt *= 1.5;   // final boss enrage harsher
  const d = boss.def;
  const hero = state.hero;
  boss.mechanicTimers.mech = (boss.mechanicTimers.mech || 2) - dt;

  const dist = vDist(boss.pos, hero.pos);
  if (dist > 4) {
    const dir = vDir(boss.pos, hero.pos);
    boss.pos.x += dir.x * d.speed * dt;
    boss.pos.y += dir.y * d.speed * dt;
  }

  if (boss.phaseIndex === 0) {
    boss.color = '#501010'; boss.accent = '#ff7030';
  } else if (boss.phaseIndex === 1) {
    boss.color = '#1a2060'; boss.accent = '#80a0ff';
  } else {
    boss.color = '#402040'; boss.accent = '#ff40a0';
  }

  if (boss.mechanicTimers.mech <= 0) {
    boss.mechanicTimers.mech = 3.5;
    const p = boss.phaseIndex;
    if (p === 0) {
      // Line Rupture
      const dx = hero.pos.x - boss.pos.x, dy = hero.pos.y - boss.pos.y;
      const L = Math.hypot(dx, dy) || 1;
      const ex = dx / L, ey = dy / L;
      state.telegraphs.push({
        id: uid(), shape: 'line',
        origin: { x: boss.pos.x, y: boss.pos.y },
        end: { x: boss.pos.x + ex * 16, y: boss.pos.y + ey * 16 },
        width: 1.2, color: '#ff3020',
        windUp: 0.9, commit: 0.2, execute: 0.1, phase: 'windUp', age: 0,
        damage: d.damage * 1.4, source: boss.id, sourceName: d.name || boss.name, fromMob: true,
      });
    } else if (p === 1) {
      // Slam at hero
      state.telegraphs.push({
        id: uid(), shape: 'circle',
        origin: { x: hero.pos.x, y: hero.pos.y },
        radius: 2.2, color: '#80a0ff',
        windUp: 1.0, commit: 0.2, execute: 0.1, phase: 'windUp', age: 0,
        damage: d.damage, source: boss.id, sourceName: d.name || boss.name, fromMob: true,
      });
    } else {
      // Reality Tears: paired portals + Void Lance
      const tp1 = { x: -6, y: -5 + (state.rng.next() - 0.5) * 4 };
      const tp2 = { x: 6, y: 5 + (state.rng.next() - 0.5) * 4 };
      state.telegraphs.push({
        id: uid(), shape: 'circle',
        origin: tp1, radius: 1.2, color: '#ffdc3a',
        windUp: 0.5, commit: 3.0, execute: 0.1, phase: 'windUp', age: 0,
        damage: 0, source: boss.id, fromMob: false,
        portalPair: tp2,
      });
      state.telegraphs.push({
        id: uid(), shape: 'circle',
        origin: tp2, radius: 1.2, color: '#ffdc3a',
        windUp: 0.5, commit: 3.0, execute: 0.1, phase: 'windUp', age: 0,
        damage: 0, source: boss.id, fromMob: false,
        portalPair: tp1,
      });
      // Void Lance
      const dx = hero.pos.x - boss.pos.x, dy = hero.pos.y - boss.pos.y;
      const L = Math.hypot(dx, dy) || 1;
      const ex = dx / L, ey = dy / L;
      state.telegraphs.push({
        id: uid(), shape: 'line',
        origin: { x: boss.pos.x, y: boss.pos.y },
        end: { x: boss.pos.x + ex * 18, y: boss.pos.y + ey * 18 },
        width: 1.0, color: '#ff40a0',
        windUp: 0.8, commit: 0.3, execute: 0.1, phase: 'windUp', age: 0,
        damage: d.damage * 1.5, source: boss.id, sourceName: d.name || boss.name, fromMob: true,
      });
    }
  }
}

// --- Hooks ---

function onMinibossDefeated(state) {
  // Auto-buff (pick random of 3)
  const pick = state.rng.int(0, 2);
  const hero = state.hero;
  if (state.currentRealm.id === 'emberWastes') {
    if (pick === 0) { hero.mods.fireDmgMult *= 1.10; hero.buffs.push({ name: '+10% fire dmg', age: 0, ttl: 9999 }); }
    else if (pick === 1) { hero.mods.comboFlowGainMult *= 1.25; hero.buffs.push({ name: '+25% flow gain', age: 0, ttl: 9999 }); }
    else { hero.mods.dashExtraCharges += 1; hero.abilityCharges.Q = Math.min(3, hero.abilityCharges.Q + 1); hero.buffs.push({ name: '+1 dodge charge', age: 0, ttl: 9999 }); }
  } else {
    if (pick === 0) { hero.mods.moveSpeedMult *= 1.08; hero.buffs.push({ name: '+8% move speed', age: 0, ttl: 9999 }); }
    else if (pick === 1) { for (const k of ['E','R','F']) hero.abilityCDs[k] *= 0.8; hero.buffs.push({ name: '-20% ability CD', age: 0, ttl: 9999 }); }
    else { hero.mods.hpRegenPerSec += 1; hero.buffs.push({ name: '+1 HP/s', age: 0, ttl: 9999 }); }
  }
  state.banners.push({ text: 'MINIBOSS DEFEATED — BUFF GAINED', color: '#ffdc3a', age: 0, ttl: 2.2, big: true });
  state.hero.xp += 150;
}

function onBossDefeated(state) {
  state.boss = null;
  // XP + drop
  state.hero.xp += 400;
  state.aether += 25;
  // Restore world; move on
  import('./world.js').then(m => m.restoreWorldOnRealmClear(state));
  state.banners.push({
    text: `${state.arenaBossType === 'riftEternal' ? 'THE RIFT ETERNAL DEFEATED' : 'REALM BOSS DEFEATED'}`,
    color: '#ffe040', age: 0, ttl: 3, big: true,
  });

  if (state.arenaBossType === 'riftEternal') {
    state.victory = true;
    state.phase = 'results';
  } else {
    // Go to warp phase
    state.phase = 'warp';
    state.ui.vendorOpen = true;
  }
}
