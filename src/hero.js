// hero.js — Emberblade (Ember Knight spec)

import { angleBetween, clamp, vDir, vDist } from './util.js';
import { keyDown, keyPressed, mousePressed } from './input.js';

export const HERO_RADIUS = 0.55;
export const HERO_BASE_MOVE_SPEED = 5; // m/s
export const HERO_BASE_MAX_HP = 450;

// Dodge
export const DODGE_CHARGES_MAX = 2;
export const DODGE_CHARGE_CD = 3;
export const DODGE_DURATION = 0.30;     // i-frames window
export const DODGE_DISTANCE = 3;         // meters
export const DODGE_SPEED = DODGE_DISTANCE / DODGE_DURATION;

// Basic attack combo
export const BASIC_COMBO_WINDOWS = [0.25, 0.30, 0.40]; // per-hit duration (animation)
export const BASIC_COMBO_COOLDOWN = 0.05; // brief delay between combo hits
export const BASIC_COMBO_RESET = 1.0;
export const BASIC_COMBO_DAMAGE = [18, 18, 28];
export const BASIC_COMBO_CONE = [
  { halfAngle: Math.PI / 6, radius: 1.8 },
  { halfAngle: Math.PI / 4, radius: 1.9 },
  { halfAngle: Math.PI / 5, radius: 2.2 },
];
export const BASIC_COMBO_FLOW_GAIN = [3, 3, 10];

// Combo Flow
export const COMBO_FLOW_MAX = 100;
export const COMBO_FLOW_DECAY_AFTER_IDLE = 3.0;
export const COMBO_FLOW_DECAY_PER_SEC = 10;
export const COMBO_FLOW_CHAIN_WINDOW = 2.0;

// Consumables
export const POTION_HEAL = 150;
export const POTION_CD = 8.0;

// Searing Aura (passive)
export const AURA_RADIUS = 3.0;
export const AURA_DPS = 4;
export const AURA_FLOW_TRICKLE = 0.4;    // per sec while enemies in aura

export function createHero() {
  return {
    pos: { x: 0, y: -5 },
    vel: { x: 0, y: 0 },
    facing: 0,
    hp: HERO_BASE_MAX_HP,
    maxHp: HERO_BASE_MAX_HP,
    xp: 0,
    level: 1,
    pendingLevels: 0,
    // talents
    talents: new Set(),
    // stats & modifiers
    mods: defaultMods(),
    // abilities
    abilityCDs: { Q: 0, E: 0, R: 0, F: 0 },
    abilityCharges: { Q: 2 },
    abilityChargeCD: { Q: 0 },
    // dodge
    dodgeCharges: DODGE_CHARGES_MAX,
    dodgeChargeCD: 0,
    dodgeActive: false,
    dodgeTimer: 0,
    dodgeDir: { x: 0, y: 0 },
    // basic combo
    basicCombo: { step: 0, timer: 0, resetTimer: 0, cooldown: 0 },
    // combo flow
    comboFlow: 0,
    comboFlowQueued: false, // RMB pressed -> empower next ability
    comboFlowLastAction: 0,  // time since last action
    // statuses on hero
    statuses: [],
    potions: 3,
    potionCD: 0,
    // I-frames
    iFrames: 0,
    // death / respawn
    downed: false,
    downedTimer: 0,
    dead: false,
    respawning: false,
    respawnTimer: 0,
    deathsThisRun: 0,
    lastKiller: null,
    // buffs from events/bosses
    buffs: [],
    radius: HERO_RADIUS,
    stunned: 0,
    // aura accum
    auraTickAccum: 0,
  };
}

export function defaultMods() {
  return {
    damageMult: 1.0,
    basicDmgMult: 1.0,
    fireDmgMult: 1.0,
    moveSpeedMult: 1.0,
    comboFlowGainMult: 1.0,
    comboFlowMultiplierOn100: 2.0,
    critChance: 0.05,
    critMult: 2.0,
    fireBurnDurationBonus: 0,
    fireBurnDamageMult: 1.0,
    maxHpBonus: 0,
    auraRadiusMult: 1.0,
    cleaveExtraSwings: 0,
    cleaveRadiusMult: 1.0,
    dashExtraCharges: 0,
    dashRadiusMult: 1.0,
    upperKnockupBonus: 0,
    upperDmgMult: 1.0,
    phoenixRadiusMult: 1.0,
    phoenixCDMult: 1.0,
    basicChainSpeedMult: 1.0,
    finisherFlowBonus: 0,
    hit3Shockwave: false,
    empoweredCostMult: 1.0,
    empoweredUltAtHalf: false,
    allDamageIsFire: false,
    fireVsBurningBonus: 0,
    comboFlowOverflowMax: COMBO_FLOW_MAX,
    hpRegenPerSec: 0,
  };
}

export function applyHeroMods(hero) {
  // Recompute derived stats from mods
  hero.maxHp = HERO_BASE_MAX_HP + hero.mods.maxHpBonus;
  if (hero.hp > hero.maxHp) hero.hp = hero.maxHp;
}

// Grant combo flow (called from ability/basic hits)
export function addComboFlow(hero, amount) {
  const chainBonus = (performance.now() / 1000 - hero.comboFlowLastAction) < COMBO_FLOW_CHAIN_WINDOW ? 1.5 : 1.0;
  const gain = amount * hero.mods.comboFlowGainMult * chainBonus;
  hero.comboFlow = Math.min(hero.mods.comboFlowOverflowMax, hero.comboFlow + gain);
  hero.comboFlowLastAction = performance.now() / 1000;
}

export function consumeEmpowered(hero) {
  // Returns true if next ability should be empowered, consuming flow.
  if (hero.comboFlowQueued && hero.comboFlow >= COMBO_FLOW_MAX * hero.mods.empoweredCostMult) {
    hero.comboFlow -= COMBO_FLOW_MAX * hero.mods.empoweredCostMult;
    hero.comboFlowQueued = false;
    return true;
  }
  return false;
}

// Damage entering the hero
export function damageHero(state, amount, source) {
  const hero = state.hero;
  if (hero.iFrames > 0 || hero.dead || hero.respawning) return 0;
  const final = Math.max(1, Math.round(amount));
  hero.hp -= final;
  // Floater
  state.floaters.push({
    pos: { x: hero.pos.x, y: hero.pos.y - 0.5 },
    text: `${final}`,
    color: '#ff6a6a',
    age: 0, ttl: 0.9, vy: -1.2,
  });
  if (hero.hp <= 0) {
    hero.hp = 0;
    onHeroKilled(state, source);
  }
  return final;
}

function onHeroKilled(state, source) {
  const hero = state.hero;
  hero.lastKiller = humanizeKiller(source);
  // Record death log entry
  if (!state.deathLog) state.deathLog = [];
  state.deathLog.push({
    time: state.runTime,
    killer: hero.lastKiller,
    pos: { x: hero.pos.x, y: hero.pos.y },
    level: hero.level,
    realm: state.currentRealm ? state.currentRealm.name : '?',
    deathNumber: hero.deathsThisRun + 1,
    phase: state.phase,
  });
  hero.deathsThisRun++;

  if (state.phase === 'arena') {
    // Solo prototype: arena death = run fail (no revivers)
    hero.dead = true;
    return;
  }
  // Lane phase: enter respawning state with scaling timer
  const deathNum = hero.deathsThisRun;
  const baseCurve = [10, 15, 20, 30, 45];
  const baseTimer = deathNum >= 5 ? Math.min(60, 45 + (deathNum - 5) * 3) : baseCurve[Math.min(deathNum - 1, 4)];
  const levelPenalty = Math.max(0, hero.level - 5);
  hero.respawnTimer = Math.min(60, baseTimer + levelPenalty);
  hero.respawning = true;
  // Clear transient state
  hero.statuses = [];
  hero.stunned = 0;
  hero.iFrames = 0;
  hero.dodgeActive = false;
  hero.comboFlow = 0;
  hero.comboFlowQueued = false;
  hero.basicCombo.step = 0;
  // Death banner
  state.banners.push({
    text: `YOU DIED — killed by ${hero.lastKiller}`,
    color: '#ff4040', age: 0, ttl: 2.5, big: true, bordered: 'red',
  });
}

function humanizeKiller(source) {
  if (!source) return 'unknown';
  if (typeof source !== 'string') return String(source);
  const map = {
    'mobShot': 'a ranged attack',
    'telegraph': 'a telegraphed attack',
    'aoe': 'ground damage',
    'hazard': 'environmental hazard',
  };
  return map[source] || source;
}

// Aether express respawn: lane only
export function tryAetherRespawn(state) {
  const hero = state.hero;
  if (!hero.respawning || state.phase !== 'lane') return false;
  const cost = 25;
  if (state.aether < cost) return false;
  state.aether -= cost;
  hero.respawnTimer = 0;
  return true;
}

export function healHero(state, amount) {
  const hero = state.hero;
  if (hero.dead) return 0;
  const effective = amount * (hero.mods.healMult || 1);
  const prev = hero.hp;
  hero.hp = Math.min(hero.maxHp, hero.hp + effective);
  const real = hero.hp - prev;
  if (real > 0) {
    state.floaters.push({
      pos: { x: hero.pos.x, y: hero.pos.y - 0.5 },
      text: `+${real}`,
      color: '#70ff70',
      age: 0, ttl: 1.0, vy: -1.0,
    });
  }
  return real;
}

export function updateHeroMovementAndFacing(hero, state, dt) {
  if (hero.respawning || hero.dead) return;
  // Mouse facing
  hero.facing = angleBetween(hero.pos, { x: state.input.mouse.worldX, y: state.input.mouse.worldY });

  // Stun gate
  if (hero.stunned > 0) {
    hero.stunned -= dt;
    return;
  }

  if (hero.dodgeActive) {
    hero.dodgeTimer += dt;
    hero.pos.x += hero.dodgeDir.x * DODGE_SPEED * dt;
    hero.pos.y += hero.dodgeDir.y * DODGE_SPEED * dt;
    if (hero.dodgeTimer >= DODGE_DURATION) {
      hero.dodgeActive = false;
      hero.iFrames = 0.0; // i-frames already ended with roll
    }
  } else {
    let dx = 0, dy = 0;
    if (keyDown(state, 'KeyW')) dy -= 1;
    if (keyDown(state, 'KeyS')) dy += 1;
    if (keyDown(state, 'KeyA')) dx -= 1;
    if (keyDown(state, 'KeyD')) dx += 1;
    const L = Math.hypot(dx, dy);
    if (L > 0) { dx /= L; dy /= L; }
    const speed = HERO_BASE_MOVE_SPEED * hero.mods.moveSpeedMult;
    hero.pos.x += dx * speed * dt;
    hero.pos.y += dy * speed * dt;
  }

  // Bounds (rough world clamp)
  hero.pos.x = clamp(hero.pos.x, -20, 20);
  hero.pos.y = clamp(hero.pos.y, -30, 15);
}

export function tickHeroState(hero, dt) {
  // Ability CDs
  for (const k of ['Q', 'E', 'R', 'F']) {
    hero.abilityCDs[k] = Math.max(0, hero.abilityCDs[k] - dt);
  }
  // Charge regen for Q
  const maxQCharges = 2 + hero.mods.dashExtraCharges;
  if (hero.abilityCharges.Q < maxQCharges) {
    hero.abilityChargeCD.Q -= dt;
    if (hero.abilityChargeCD.Q <= 0) {
      hero.abilityCharges.Q++;
      if (hero.abilityCharges.Q < maxQCharges) hero.abilityChargeCD.Q = 6;
    }
  }
  // Dodge charges (with dodgeCDMult from Numbed debuff, etc.)
  if (hero.dodgeCharges < DODGE_CHARGES_MAX) {
    hero.dodgeChargeCD -= dt;
    if (hero.dodgeChargeCD <= 0) {
      hero.dodgeCharges++;
      if (hero.dodgeCharges < DODGE_CHARGES_MAX) hero.dodgeChargeCD = DODGE_CHARGE_CD * (hero.mods.dodgeCDMult || 1);
    }
  }
  hero.potionCD = Math.max(0, hero.potionCD - dt);
  hero.iFrames = Math.max(0, hero.iFrames - dt);

  // Basic combo reset timer
  if (hero.basicCombo.step > 0) {
    hero.basicCombo.resetTimer -= dt;
    if (hero.basicCombo.resetTimer <= 0) hero.basicCombo.step = 0;
    hero.basicCombo.timer = Math.max(0, hero.basicCombo.timer - dt);
    hero.basicCombo.cooldown = Math.max(0, hero.basicCombo.cooldown - dt);
  }

  // Combo Flow decay
  const timeIdle = performance.now() / 1000 - hero.comboFlowLastAction;
  if (timeIdle > COMBO_FLOW_DECAY_AFTER_IDLE && hero.comboFlow > 0) {
    hero.comboFlow = Math.max(0, hero.comboFlow - COMBO_FLOW_DECAY_PER_SEC * dt);
  }

  // HP regen from mods
  if (hero.mods.hpRegenPerSec > 0 && !hero.downed && !hero.dead) {
    hero.hp = Math.min(hero.maxHp, hero.hp + hero.mods.hpRegenPerSec * dt);
  }

  // Buffs
  for (let i = hero.buffs.length - 1; i >= 0; i--) {
    hero.buffs[i].age += dt;
    if (hero.buffs[i].age >= hero.buffs[i].ttl) hero.buffs.splice(i, 1);
  }

  // Statuses on hero (slows, burn, etc.)
  for (let i = hero.statuses.length - 1; i >= 0; i--) {
    const s = hero.statuses[i];
    s.age += dt;
    if (s.age >= s.ttl) hero.statuses.splice(i, 1);
  }

  // Respawn timer (lane deaths)
  if (hero.respawning) {
    hero.respawnTimer -= dt;
    if (hero.respawnTimer <= 0) {
      // Respawn at Nexus
      hero.pos = { x: 0, y: -3 };
      hero.hp = hero.maxHp;
      hero.respawning = false;
      hero.iFrames = 2;
      hero.comboFlow = 0;
      hero.statuses = [];
      hero.stunned = 0;
      hero.downed = false;
      const killer = hero.lastKiller || '?';
      const t = state.runTime;
      const mm = String(Math.floor(t / 60)).padStart(2, '0');
      const ss = String(Math.floor(t % 60)).padStart(2, '0');
      state.banners.push({
        text: `Respawned — last death: ${killer} at ${mm}:${ss}`,
        color: '#80ff80', age: 0, ttl: 2.5, big: false,
      });
    }
  }
}

export function tryPotion(state) {
  const hero = state.hero;
  if (hero.potions <= 0 || hero.potionCD > 0 || hero.downed || hero.dead || hero.respawning) return false;
  hero.potions--;
  hero.potionCD = POTION_CD;
  healHero(state, POTION_HEAL);
  return true;
}
