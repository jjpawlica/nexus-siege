// mobs.js — mob factory + AI per archetype

import { uid, vDir, vDist, angleBetween, clamp } from './util.js';
import { damageHero, addComboFlow } from './hero.js';
import { mobIsHardCC, mobMoveSpeedMult, updateStatusesForMob } from './damage.js';
import { onStructureDestroyed } from './world.js';

// Archetype definitions
export const MOB_TYPES = {
  // --- Realm 1: Ember Wastes ---
  cinderImp: {
    name: 'Cinder Imp', color: '#2a2a2a', accent: '#ff5030',
    radius: 0.45, hp: 40, damage: 8, speed: 3.5,
    aggroRange: 8, attackRange: 0.85, attackCd: 0.9, xp: 5,
    role: 'melee', windUp: 0.35, resist: 0,
  },
  ashenArcher: {
    name: 'Ashen Archer', color: '#3a2820', accent: '#ffb060',
    radius: 0.45, hp: 30, damage: 12, speed: 2.5,
    aggroRange: 14, attackRange: 6.5, attackCd: 1.6, xp: 7,
    role: 'ranged', kiteDistance: 5.5, windUp: 0.5, resist: 0,
    projectile: { speed: 14, radius: 0.25, color: '#ffb060' },
  },
  magmaBrute: {
    name: 'Magma Brute', color: '#501010', accent: '#ff7010',
    radius: 0.85, hp: 200, damage: 20, speed: 2.0,
    aggroRange: 10, attackRange: 2.5, attackCd: 6.0, xp: 25,
    role: 'elite', windUp: 1.0, resist: 0.10,
    slamRadius: 2.5, slamColor: '#ff6030',
  },
  blazeShaman: {
    name: 'Blaze Shaman', color: '#2a0a2a', accent: '#ff40ff',
    radius: 0.5, hp: 35, damage: 15, speed: 2.0,
    aggroRange: 14, attackRange: 8.0, attackCd: 5.0, xp: 7,
    role: 'caster', castRadius: 2.0, windUp: 1.0, resist: 0.05,
    castColor: '#ff40ff',
  },
  // --- Realm 2: Frost Deeps ---
  rimewraith: {
    name: 'Rimewraith', color: '#c0d8f0', accent: '#80e0ff',
    radius: 0.45, hp: 55, damage: 10, speed: 3.5,
    aggroRange: 8, attackRange: 0.85, attackCd: 0.9, xp: 5,
    role: 'melee', windUp: 0.3, resist: 0.10,
    onHitSlow: { percent: 0.20, duration: 2 },
  },
  frostLancer: {
    name: 'Frost Lancer', color: '#6090c0', accent: '#a0e0ff',
    radius: 0.45, hp: 40, damage: 16, speed: 2.5,
    aggroRange: 14, attackRange: 7.0, attackCd: 1.8, xp: 7,
    role: 'ranged', kiteDistance: 6, windUp: 0.6, resist: 0.10,
    projectile: { speed: 15, radius: 0.3, color: '#a0e0ff', piercing: true },
  },
  glacialTyrant: {
    name: 'Glacial Tyrant', color: '#2030a0', accent: '#80a0ff',
    radius: 0.95, hp: 260, damage: 25, speed: 1.5,
    aggroRange: 10, attackRange: 3.0, attackCd: 7.0, xp: 25,
    role: 'elite', windUp: 0.8, resist: 0.20,
    coneRadius: 3.0, coneHalfAngle: Math.PI / 5, coneStun: 1.2,
    coneColor: '#8080ff',
  },
  blizzardOracle: {
    name: 'Blizzard Oracle', color: '#4060a0', accent: '#c0c0ff',
    radius: 0.5, hp: 45, damage: 18, speed: 2.0,
    aggroRange: 14, attackRange: 8, attackCd: 6.5, xp: 7,
    role: 'caster', windUp: 1.2, resist: 0.15,
    castColor: '#c0c0ff',
  },
};

export function spawnMob(state, type, pos) {
  const d = MOB_TYPES[type];
  if (!d) { console.warn('Unknown mob type', type); return null; }
  const scaled = applyRealmScaling(state, d);
  const mob = {
    id: uid(),
    type,
    pos: { x: pos.x, y: pos.y },
    vel: { x: 0, y: 0 },
    facing: Math.PI / 2,
    hp: scaled.hp, maxHp: scaled.hp,
    damage: scaled.damage,
    speed: scaled.speed,
    xp: scaled.xp,
    radius: d.radius,
    target: null,     // 'nexus' | 'hero'
    fsmState: 'pathing',
    attackCd: 0,
    windUpTimer: 0,
    attackAnim: 0,
    statuses: [],
    color: d.color, accent: d.accent,
    resist: d.resist,
    dead: false,
    def: d,           // definition reference
  };
  // Apply enemy enrage buff if active (T1 destroyed)
  if (state.enemyEnrage) {
    mob.damage = Math.round(mob.damage * 1.25);
    mob.speed = mob.speed * 1.15;
    mob.hp = Math.round(mob.hp * 1.15);
    mob.maxHp = Math.round(mob.maxHp * 1.15);
    mob.enraged = true;
    mob.accent = '#ff4040';
  }
  state.mobs.push(mob);
  return mob;
}

export function applyRealmScaling(state, def) {
  // Realm index -> scaling
  const mult = state.realmScaling || 1.0;
  return {
    hp: Math.round(def.hp * mult),
    damage: Math.round(def.damage * mult),
    speed: def.speed,
    xp: def.xp,
  };
}

// --- AI per-frame ---

export function updateMob(mob, state, dt) {
  if (mob.dead) return;
  // Time Freeze: mobs don't act or tick statuses
  if (state.timeFreeze && state.timeFreeze.active) return;
  // Event entities: no AI, hp handled by events.js
  if (mob.eventEntity) {
    updateStatusesForMob(state, mob, dt);
    return;
  }
  // Lane structures: no AI; handle destruction
  if (mob.structure) {
    updateStatusesForMob(state, mob, dt);
    if (mob.hp <= 0 && !mob.dead) onStructureDestroyed(state, mob);
    return;
  }
  // Miniboss has dedicated path (in bosses.js); skip here if it's a boss
  if (mob.boss) return;
  // statuses
  updateStatusesForMob(state, mob, dt);
  if (mob.hp <= 0) { killMob(state, mob); return; }
  if (mobIsHardCC(mob)) return;

  const d = mob.def;
  mob.attackCd -= dt;

  const hero = state.hero;
  const nexus = state.world.nexus;

  // Choose target
  const distToHero = vDist(mob.pos, hero.pos);
  const distToNexus = vDist(mob.pos, nexus.pos);

  let tgt = null;
  // Ranged/caster stand back and shoot nexus-lane area
  if (d.role === 'ranged' || d.role === 'caster') {
    // Priority: if hero closer than kite distance, kite/shoot hero; else shoot nearest target
    if (distToHero < d.aggroRange) tgt = hero;
    else tgt = nexus;
  } else {
    // Melee/elite: prefer hero if in aggro range, else push nexus
    if (distToHero < d.aggroRange && !hero.downed) tgt = hero;
    else tgt = nexus;
  }

  mob.target = tgt === hero ? 'hero' : 'nexus';
  const tgtPos = tgt === hero ? hero.pos : nexus.pos;
  const dist = vDist(mob.pos, tgtPos);

  // Rotation
  mob.facing = angleBetween(mob.pos, tgtPos);

  // Behavior by role
  const speedMult = mobMoveSpeedMult(mob);
  if (mob.windUpTimer > 0) {
    // During wind-up, don't move
    mob.windUpTimer -= dt;
    if (mob.windUpTimer <= 0) {
      commitMobAttack(state, mob, tgt, tgtPos);
    }
  } else if (mob.attackAnim > 0) {
    mob.attackAnim -= dt;
  } else if (d.role === 'ranged' || d.role === 'caster') {
    // Kite: stand at attackRange from target
    const want = d.attackRange - 0.5;
    if (d.role === 'ranged' && dist < (d.kiteDistance || d.attackRange - 1) && tgt === hero) {
      // back away
      const dir = vDir(hero.pos, mob.pos);
      mob.pos.x += dir.x * d.speed * speedMult * dt;
      mob.pos.y += dir.y * d.speed * speedMult * dt;
    } else if (dist > want + 0.2) {
      const dir = vDir(mob.pos, tgtPos);
      mob.pos.x += dir.x * d.speed * speedMult * dt;
      mob.pos.y += dir.y * d.speed * speedMult * dt;
    }
    // Try attack
    if (mob.attackCd <= 0 && dist <= d.attackRange && tgt === hero) {
      startMobWindUp(mob);
    } else if (mob.attackCd <= 0 && (d.role === 'caster' || d.role === 'ranged')) {
      // shoot at nearest (hero if in any range else nexus)
      if (distToHero <= d.attackRange) startMobWindUp(mob);
    }
  } else {
    // Melee / elite: close distance, slam at range
    if (dist > d.attackRange - 0.3) {
      const dir = vDir(mob.pos, tgtPos);
      mob.pos.x += dir.x * d.speed * speedMult * dt;
      mob.pos.y += dir.y * d.speed * speedMult * dt;
    } else if (mob.attackCd <= 0) {
      startMobWindUp(mob);
    }
  }
}

function startMobWindUp(mob) {
  mob.windUpTimer = mob.def.windUp;
  mob.attackAnim = 0;
  // pre-create telegraph in state — handled at commit time for ranged/caster
}

function commitMobAttack(state, mob, tgt, tgtPos) {
  const d = mob.def;
  mob.attackAnim = 0.2;
  mob.attackCd = d.attackCd;

  if (d.role === 'ranged') {
    // Fire projectile
    const origin = { x: mob.pos.x, y: mob.pos.y };
    const dir = vDir(origin, tgt === state.hero ? state.hero.pos : state.world.nexus.pos);
    state.projectiles.push({
      id: uid(),
      type: 'mobShot',
      pos: { x: origin.x + dir.x * 0.6, y: origin.y + dir.y * 0.6 },
      vel: { x: dir.x * d.projectile.speed, y: dir.y * d.projectile.speed },
      radius: d.projectile.radius,
      damage: d.damage,
      source: 'mob',
      sourceName: d.name,
      lifetime: 3.0,
      pierce: !!d.projectile.piercing,
      hitIds: new Set(),
      color: d.projectile.color,
    });
  } else if (d.role === 'caster') {
    // Ground AoE telegraph
    const center = { x: (tgt === state.hero ? state.hero.pos.x : state.world.nexus.pos.x),
                     y: (tgt === state.hero ? state.hero.pos.y : state.world.nexus.pos.y) };
    state.telegraphs.push({
      id: uid(),
      shape: 'circle',
      origin: { x: center.x, y: center.y },
      radius: d.castRadius || 2.0,
      color: d.castColor || '#ff40ff',
      windUp: 0.5, commit: 0.2, execute: 0.1,
      phase: 'windUp', age: 0,
      damage: d.damage,
      source: mob.id,
      sourceName: d.name,
      fromMob: true,
    });
  } else if (d.role === 'elite' && mob.type === 'magmaBrute') {
    state.telegraphs.push({
      id: uid(),
      shape: 'circle',
      origin: { x: mob.pos.x, y: mob.pos.y },
      radius: d.slamRadius,
      color: d.slamColor,
      windUp: 0.0, commit: 0.2, execute: 0.15,
      phase: 'commit', age: 0,
      damage: d.damage,
      source: mob.id,
      sourceName: d.name,
      fromMob: true,
    });
  } else if (d.role === 'elite' && mob.type === 'glacialTyrant') {
    state.telegraphs.push({
      id: uid(),
      shape: 'cone',
      origin: { x: mob.pos.x, y: mob.pos.y },
      facing: mob.facing,
      halfAngle: d.coneHalfAngle,
      radius: d.coneRadius,
      color: d.coneColor,
      windUp: 0.0, commit: 0.2, execute: 0.15,
      phase: 'commit', age: 0,
      damage: d.damage,
      stun: d.coneStun,
      source: mob.id,
      sourceName: d.name,
      fromMob: true,
    });
  } else {
    // Basic melee: cone arc immediate at close range
    state.telegraphs.push({
      id: uid(),
      shape: 'cone',
      origin: { x: mob.pos.x, y: mob.pos.y },
      facing: mob.facing,
      halfAngle: Math.PI / 5,
      radius: d.attackRange + 0.3,
      color: d.accent,
      windUp: 0.0, commit: 0.15, execute: 0.1,
      phase: 'commit', age: 0,
      damage: d.damage,
      source: mob.id,
      sourceName: d.name,
      fromMob: true,
      slow: d.onHitSlow,
    });
  }
}

export function killMob(state, mob) {
  mob.dead = true;
  // XP
  state.hero.xp += mob.def.xp;
  // Fuel the Flame talent
  if (state.hero.mods.killFlowBonus) {
    addComboFlow(state.hero, state.hero.mods.killFlowBonus);
  }
  // Healing orb drop chance
  const d = mob.def;
  let dropChance = 0.10;
  if (d.role === 'elite') dropChance = 0.50;
  if (d.role === 'ranged' || d.role === 'caster') dropChance = 0.08;
  if (state.rng.next() < dropChance) {
    state.healOrbs.push({
      id: uid(),
      pos: { x: mob.pos.x, y: mob.pos.y },
      age: 0, ttl: 10,
      heal: 25,
      radius: 0.5,
      pickupRadius: 1.0,
    });
  }
  // Aether drop (small)
  state.aether += d.role === 'elite' ? 5 : 1;
  // Death particles
  for (let i = 0; i < 6; i++) {
    const a = Math.random() * Math.PI * 2;
    state.particles.push({
      pos: { x: mob.pos.x, y: mob.pos.y },
      vel: { x: Math.cos(a) * 3, y: Math.sin(a) * 3 },
      ttl: 0.6, age: 0,
      color: d.accent, size: 3,
    });
  }
}

export function removeDeadMobs(state) {
  state.mobs = state.mobs.filter(m => !m.dead);
}
