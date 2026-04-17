// world.js — Nexus, towers, safe zones, healing well, pressure

import { uid, vDist, vDir } from './util.js';
import { heroDamageToMob } from './damage.js';

export const NEXUS_MAX_HP = 1000;
export const NEXUS_RADIUS = 2.0;
export const PRESSURE_RADIUS = 4.0;
export const PRESSURE_MAX = 100;
export const PRESSURE_BREACH_BURST = 20;
export const PRESSURE_TICK_PER_MOB = 1;  // HP/s per mob
export const PRESSURE_FILL_PER_MOB_PER_SEC = 15;
export const PRESSURE_DRAIN = 40;         // when no mobs in zone

// Towers
export const TOWER_CONFIGS = {
  outer: { hp: 300, damage: 25, atkSpeed: 1.5, range: 8 },
  inner: { hp: 400, damage: 35, atkSpeed: 1.0, range: 6 },
};

// Healing well (smaller, positioned just north of Nexus on the lane side)
export const WELL_RADIUS = 1.6;
export const WELL_HEAL_PER_SEC = 5;
export const WELL_USE_MAX = 10;     // seconds of usage
export const WELL_RECHARGE = 30;

// Safe zones
export const SAFE_ZONE_RADIUS = 2.0;
export const SAFE_ZONE_REGEN = 2;

export function createWorld() {
  return {
    nexus: {
      pos: { x: 0, y: 0 },
      hp: NEXUS_MAX_HP,
      maxHp: NEXUS_MAX_HP,
      radius: NEXUS_RADIUS,
      // Nexus as a tower: shoots nearest mob
      atkCd: 0,
      atkSpeed: 1.8,
      atkDamage: 40,
      atkRange: 9,
    },
    pressure: 0,                         // 0..100
    towers: [
      createTower('outer', { x: 0, y: -18 }),
      createTower('inner', { x: 0, y: -10 }),
    ],
    safeZones: [
      { pos: { x: -7, y: -14 }, radius: SAFE_ZONE_RADIUS },
      { pos: { x: 7, y: -14 }, radius: SAFE_ZONE_RADIUS },
    ],
    well: {
      pos: { x: 0, y: -4 },      // just north of Nexus, on the lane side
      radius: WELL_RADIUS,
      chargeTimer: WELL_USE_MAX,
      state: 'ready',
      rechargeTimer: 0,
    },
    spawnPoint: { x: 0, y: -40 },
    laneBounds: { minX: -6, maxX: 6, minY: -40, maxY: 0 },
  };
}

function createTower(kind, pos) {
  const cfg = TOWER_CONFIGS[kind];
  return {
    id: uid(),
    kind,
    pos: { x: pos.x, y: pos.y },
    hp: cfg.hp, maxHp: cfg.hp,
    damage: cfg.damage,
    atkSpeed: cfg.atkSpeed,
    range: cfg.range,
    atkCd: 0,
    destroyed: false,
    radius: 0.8,
  };
}

// --- Updates ---

export function updateWorld(state, dt) {
  if (state.phase === 'arena') return;   // per spec: mobs + pressure pause during arena fights

  updateTowers(state, dt);
  updateNexusAttack(state, dt);
  updatePressure(state, dt);
  updateHealingWell(state, dt);
  updateSafeZones(state, dt);
}

function updateNexusAttack(state, dt) {
  const n = state.world.nexus;
  n.atkCd -= dt;
  if (n.atkCd > 0 || n.hp <= 0) return;
  // Find nearest non-boss, non-structure mob in range
  let best = null, bestD = n.atkRange;
  for (const m of state.mobs) {
    if (m.dead || m.boss || m.eventEntity || m.structure) continue;
    const d = vDist(m.pos, n.pos);
    if (d < bestD) { bestD = d; best = m; }
  }
  if (best) {
    const dir = vDir(n.pos, best.pos);
    state.projectiles.push({
      id: uid(),
      type: 'nexusBolt',
      pos: { x: n.pos.x + dir.x * n.radius, y: n.pos.y + dir.y * n.radius },
      vel: { x: dir.x * 22, y: dir.y * 22 },
      radius: 0.35,
      damage: n.atkDamage,
      source: 'tower',   // reuse tower branch (no self-damage)
      lifetime: 2.0,
      pierce: false,
      hitIds: new Set(),
      color: '#ffaa40',
    });
    n.atkCd = n.atkSpeed;
  }
}

function updateTowers(state, dt) {
  for (const t of state.world.towers) {
    if (t.destroyed) continue;
    t.atkCd -= dt;
    if (t.atkCd > 0) continue;
    // Find nearest non-boss, non-event, non-structure mob in range
    let best = null, bestD = t.range;
    for (const m of state.mobs) {
      if (m.dead || m.boss || m.eventEntity || m.structure) continue;
      const d = vDist(m.pos, t.pos);
      if (d < bestD) { bestD = d; best = m; }
    }
    if (best) {
      // Fire projectile
      const dir = vDir(t.pos, best.pos);
      state.projectiles.push({
        id: uid(),
        type: 'tower',
        pos: { x: t.pos.x + dir.x * 0.6, y: t.pos.y + dir.y * 0.6 },
        vel: { x: dir.x * 18, y: dir.y * 18 },
        radius: 0.25,
        damage: t.damage,
        source: 'tower',
        lifetime: 2.0,
        pierce: false,
        hitIds: new Set(),
        color: '#ffe040',
      });
      t.atkCd = t.atkSpeed;
    }
  }
}

function updatePressure(state, dt) {
  // Time Freeze: no pressure tick (mobs aren't acting)
  if (state.timeFreeze && state.timeFreeze.active) return;

  const nexus = state.world.nexus;
  // Count mobs in pressure zone (exclude event entities and bosses-in-arena)
  let insideCount = 0;
  for (const m of state.mobs) {
    if (m.dead || m.eventEntity) continue;
    if (vDist(m.pos, nexus.pos) <= PRESSURE_RADIUS + m.radius * 0.5) insideCount++;
  }
  state.world.pressureMobCount = insideCount;

  // Nexus damage from occupants
  if (insideCount > 0) {
    nexus.hp -= insideCount * PRESSURE_TICK_PER_MOB * dt;
    // Pressure meter fills
    state.world.pressure = Math.min(PRESSURE_MAX, state.world.pressure + insideCount * PRESSURE_FILL_PER_MOB_PER_SEC * dt);
  } else {
    state.world.pressure = Math.max(0, state.world.pressure - PRESSURE_DRAIN * dt);
  }
  // Breach
  if (state.world.pressure >= PRESSURE_MAX) {
    nexus.hp -= PRESSURE_BREACH_BURST;
    state.world.pressure = 0;
    state.shakes.push({ mag: 0.6, ttl: 0.4, age: 0 });
    state.banners.push({
      text: 'NEXUS BREACHED!',
      color: '#ff3040',
      age: 0, ttl: 1.8,
      big: true,
    });
  }
  if (nexus.hp <= 0) {
    nexus.hp = 0;
    state.runFailed = true;
    state.runFailReason = 'Nexus destroyed';
  }
}

function updateHealingWell(state, dt) {
  const w = state.world.well;
  // inside?
  const hero = state.hero;
  const inside = vDist(hero.pos, w.pos) <= w.radius + hero.radius * 0.4;
  if (w.state === 'ready') {
    if (inside && !hero.dead && !hero.respawning) {
      // heal, deplete
      w.chargeTimer = Math.max(0, w.chargeTimer - dt);
      hero.hp = Math.min(hero.maxHp, hero.hp + WELL_HEAL_PER_SEC * dt);
      if (w.chargeTimer <= 0) {
        w.state = 'depleted';
        w.rechargeTimer = WELL_RECHARGE;
      }
    }
  } else {
    w.rechargeTimer -= dt;
    if (w.rechargeTimer <= 0) {
      w.state = 'ready';
      w.chargeTimer = WELL_USE_MAX;
    }
  }
}

function updateSafeZones(state, dt) {
  const hero = state.hero;
  if (hero.dead || hero.respawning) return;
  let inside = false;
  for (const sz of state.world.safeZones) {
    if (vDist(hero.pos, sz.pos) <= sz.radius + hero.radius * 0.4) { inside = true; break; }
  }
  state.hero.inSafeZone = inside;
  if (inside) {
    hero.hp = Math.min(hero.maxHp, hero.hp + SAFE_ZONE_REGEN * dt);
  }
}

// Damage to tower (from mobs reaching it)
export function damageTower(tower, amount) {
  if (tower.destroyed) return;
  tower.hp -= amount;
  if (tower.hp <= 0) {
    tower.destroyed = true;
    tower.hp = 0;
  }
}

// Called when realm boss cleared — restore Nexus + towers
export function restoreWorldOnRealmClear(state) {
  const w = state.world;
  w.nexus.hp = w.nexus.maxHp;
  for (const t of w.towers) {
    t.hp = t.maxHp;
    t.destroyed = false;
  }
  w.pressure = 0;
  w.well.state = 'ready';
  w.well.chargeTimer = WELL_USE_MAX;
}

// Lane structures (enemy outposts) — 2 per lane per spec
export const STRUCTURE_T1_HP = 1200;
export const STRUCTURE_T2_HP = 2200;
export const STRUCTURE_T1_ACCELERATION = 60;   // miniboss spawns 60s earlier
export const STRUCTURE_T2_ACCELERATION = 120;  // realm boss portal opens 120s earlier

// Structure combat tuning
export const T1_ATTACK_CD_MIN = 5.5;
export const T1_ATTACK_CD_MAX = 7.5;
export const T1_PROJECTILE_SPEED = 10;
export const T1_PROJECTILE_RADIUS = 0.55;
export const T1_PROJECTILE_DAMAGE = 28;

export const T2_ATTACK_CD_MIN = 8;
export const T2_ATTACK_CD_MAX = 11;
export const T2_AOE_RADIUS = 2.4;
export const T2_AOE_DAMAGE = 55;
export const T2_WINDUP = 1.6;

export function spawnLaneStructure(state, kind, pos) {
  const hp = kind === 't1' ? STRUCTURE_T1_HP : STRUCTURE_T2_HP;
  const accent = kind === 't1' ? '#ff6020' : '#ffdc3a';
  const structure = {
    id: uid(),
    type: 'structure',
    structure: true,
    structureKind: kind,
    pos: { x: pos.x, y: pos.y },
    vel: { x: 0, y: 0 },
    facing: 0,
    radius: 1.3,
    hp, maxHp: hp,
    damage: kind === 't1' ? T1_PROJECTILE_DAMAGE : T2_AOE_DAMAGE,
    speed: 0,
    resist: 0.35,                     // extra tanky
    color: '#302018',
    accent,
    fsmState: 'static',
    statuses: [],
    dead: false,
    def: { xp: 60, role: 'structure', name: kind === 't1' ? 'Enemy Outpost' : 'Forward Base' },
    attackCd: 3 + state.rng.next() * 2,   // first attack ~3–5s after spawn
  };
  state.mobs.push(structure);
  return structure;
}

// Enrage bonus applied when T1 is destroyed — buffs existing + future mobs
export const T1_ENRAGE_DAMAGE_MULT = 1.25;
export const T1_ENRAGE_SPEED_MULT = 1.15;
export const T1_ENRAGE_HP_MULT = 1.15;

export function applyEnemyEnrageBuff(state) {
  state.enemyEnrage = true;
  // Buff all currently-active mobs (exclude bosses, structures, event entities)
  for (const m of state.mobs) {
    if (m.dead || m.structure || m.eventEntity || m.boss) continue;
    if (m.enraged) continue;
    m.damage = Math.round(m.damage * T1_ENRAGE_DAMAGE_MULT);
    m.speed = m.speed * T1_ENRAGE_SPEED_MULT;
    m.hp = Math.round(m.hp * T1_ENRAGE_HP_MULT);
    m.maxHp = Math.round(m.maxHp * T1_ENRAGE_HP_MULT);
    m.enraged = true;
    // Visible tint via accent
    m.accent = '#ff4040';
  }
}

// Per-frame structure attack logic
export function updateStructures(state, dt) {
  if (state.timeFreeze && state.timeFreeze.active) return;   // frozen — no attacks
  const hero = state.hero;
  for (const m of state.mobs) {
    if (!m.structure || m.dead) continue;
    m.attackCd = (m.attackCd || 0) - dt;
    if (m.attackCd > 0) continue;
    if (hero.respawning || hero.dead) {
      // Idle while no target; short re-check
      m.attackCd = 1.0;
      continue;
    }
    if (m.structureKind === 't1') {
      // Slow projectile at hero
      m.attackCd = T1_ATTACK_CD_MIN + state.rng.next() * (T1_ATTACK_CD_MAX - T1_ATTACK_CD_MIN);
      const dir = vDir(m.pos, hero.pos);
      state.projectiles.push({
        id: uid(),
        type: 'structureBolt',
        pos: { x: m.pos.x + dir.x * m.radius, y: m.pos.y + dir.y * m.radius },
        vel: { x: dir.x * T1_PROJECTILE_SPEED, y: dir.y * T1_PROJECTILE_SPEED },
        radius: T1_PROJECTILE_RADIUS,
        damage: T1_PROJECTILE_DAMAGE,
        source: 'mob',
        sourceName: 'Enemy Outpost',
        lifetime: 5.0,
        pierce: false,
        hitIds: new Set(),
        color: m.accent,
      });
    } else if (m.structureKind === 't2') {
      // Telegraphed AoE at hero position
      m.attackCd = T2_ATTACK_CD_MIN + state.rng.next() * (T2_ATTACK_CD_MAX - T2_ATTACK_CD_MIN);
      state.telegraphs.push({
        id: uid(),
        shape: 'circle',
        origin: { x: hero.pos.x, y: hero.pos.y },
        radius: T2_AOE_RADIUS,
        color: '#ffdc3a',
        windUp: T2_WINDUP, commit: 0.2, execute: 0.15,
        phase: 'windUp', age: 0,
        damage: T2_AOE_DAMAGE,
        source: m.id, sourceName: 'Forward Base', fromMob: true,
      });
    }
  }
}

export function onStructureDestroyed(state, structure) {
  structure.dead = true;
  state.aether += structure.structureKind === 't1' ? 15 : 25;
  if (structure.structureKind === 't1') {
    state.minibossAcceleration = (state.minibossAcceleration || 0) + STRUCTURE_T1_ACCELERATION;
    // Enrage the enemy forces: buff existing and future mob damage/speed
    applyEnemyEnrageBuff(state);
    state.banners.push({
      text: 'OUTPOST FALLS — MINIBOSS APPROACHES · ENEMIES ENRAGE',
      color: '#ff8030', age: 0, ttl: 3.0, big: true, bordered: 'red',
    });
  } else {
    state.realmBossAcceleration = (state.realmBossAcceleration || 0) + STRUCTURE_T2_ACCELERATION;
    state.banners.push({
      text: 'FORWARD BASE FALLS — REALM BOSS STIRS',
      color: '#ffdc3a', age: 0, ttl: 2.5, big: true, bordered: 'yellow',
    });
  }
  // Drop XP + an orb
  state.hero.xp += structure.def.xp;
  state.healOrbs.push({
    id: uid(),
    pos: { x: structure.pos.x, y: structure.pos.y },
    age: 0, ttl: 12,
    heal: 40,
    radius: 0.6,
    pickupRadius: 1.2,
  });
  state.shakes.push({ mag: 0.5, ttl: 0.5, age: 0 });
}
