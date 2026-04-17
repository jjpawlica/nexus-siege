// abilities.js — Q/W/E/R, LMB combo, RMB release, Space dodge

import { keyPressed, keyDown, mousePressed } from './input.js';
import {
  HERO_RADIUS, DODGE_CHARGES_MAX, DODGE_CHARGE_CD, DODGE_DURATION, DODGE_DISTANCE,
  BASIC_COMBO_DAMAGE, BASIC_COMBO_CONE, BASIC_COMBO_FLOW_GAIN, BASIC_COMBO_RESET,
  BASIC_COMBO_WINDOWS, BASIC_COMBO_COOLDOWN,
  COMBO_FLOW_MAX, AURA_RADIUS, AURA_DPS, AURA_FLOW_TRICKLE,
  addComboFlow, consumeEmpowered, tryPotion,
} from './hero.js';
import { uid, vDir, vDist, vec } from './util.js';
import { heroDamageToMob, applyBurn, applyStun, applyKnockup } from './damage.js';
import { circleCone, circleCircle } from './collision.js';

// --- Input dispatch ---

export function processAbilityInputs(state, dt) {
  const hero = state.hero;
  if (hero.dead || hero.respawning) return;
  if (state.phase !== 'lane' && state.phase !== 'arena') return;
  if (hero.downed) return;
  if (state.ui.nexusShopOpen || state.ui.modalOpen) return;   // browsing, not fighting

  // Space -> dodge
  if (keyPressed(state, 'Space')) tryDodge(state);

  // LMB -> basic attack
  if (mousePressed(state, 0)) tryBasicAttack(state);

  // RMB -> queue empowered release
  if (mousePressed(state, 2)) {
    if (hero.comboFlow >= COMBO_FLOW_MAX * hero.mods.empoweredCostMult) {
      hero.comboFlowQueued = true;
    }
  }

  // Abilities — Q=Flame Dash, E=Cinder Cleave, R=Blazing Uppercut, F=Phoenix Rend (ult)
  if (keyPressed(state, 'KeyQ')) tryAbility(state, 'Q', abilityFlameDash);
  if (keyPressed(state, 'KeyE')) tryAbility(state, 'E', abilityCinderCleave);
  if (keyPressed(state, 'KeyR')) tryAbility(state, 'R', abilityBlazingUppercut);
  if (keyPressed(state, 'KeyF')) tryAbility(state, 'F', abilityPhoenixRend);

  // Consumables — Z/X/C/V slots (prototype: only Z = potion; X/C/V reserved)
  if (!state.ui.modalOpen && keyPressed(state, 'KeyZ')) tryPotion(state);
}

function tryAbility(state, key, fn) {
  const hero = state.hero;
  if (hero.stunned > 0) return;
  if (key === 'Q') {
    const maxCharges = 2 + hero.mods.dashExtraCharges;
    if (hero.abilityCharges.Q <= 0) return;
    hero.abilityCharges.Q--;
    if (hero.abilityChargeCD.Q <= 0) hero.abilityChargeCD.Q = 6;
  } else {
    if (hero.abilityCDs[key] > 0) return;
  }
  // Ashen Will mythic: ultimate empowers at 50% flow
  if (key === 'F' && hero.mods.empoweredUltAtHalf && hero.comboFlow >= 50) {
    hero.comboFlowQueued = true;
  }
  const empowered = consumeEmpowered(hero);
  fn(state, empowered);
  if (key !== 'Q') {
    hero.abilityCDs[key] = {
      E: 4,                              // Cinder Cleave
      R: 10,                             // Blazing Uppercut
      F: 45 * hero.mods.phoenixCDMult,   // Phoenix Rend (ult)
    }[key];
  }
  // Cancel current animation into ability — cancel any basic combo in progress
  hero.basicCombo.cooldown = 0.1;
}

// --- Basic attack (3-hit combo) ---

function tryBasicAttack(state) {
  const hero = state.hero;
  if (hero.basicCombo.cooldown > 0) return;
  const step = hero.basicCombo.step;
  const cone = BASIC_COMBO_CONE[step];
  const baseDmg = BASIC_COMBO_DAMAGE[step];
  // Searing blade spawn a visual slash
  state.slashes.push({
    origin: { x: hero.pos.x, y: hero.pos.y },
    facing: hero.facing,
    halfAngle: cone.halfAngle, radius: cone.radius,
    age: 0, ttl: 0.18,
    color: step === 2 ? '#ffb060' : '#ff7a1a',
  });
  // Hit all mobs in cone
  hitMobsInCone(state, {
    origin: hero.pos, facing: hero.facing,
    halfAngle: cone.halfAngle, radius: cone.radius,
  }, baseDmg, { basic: true, fire: true });
  // Combo flow
  addComboFlow(hero, BASIC_COMBO_FLOW_GAIN[step] + (step === 2 ? hero.mods.finisherFlowBonus : 0));
  // Blazing Finisher shockwave
  if (step === 2 && hero.mods.hit3Shockwave) {
    spawnShockwaveProjectile(state, hero);
  }
  // Advance combo
  const animDur = BASIC_COMBO_WINDOWS[step] / hero.mods.basicChainSpeedMult;
  hero.basicCombo.cooldown = animDur + BASIC_COMBO_COOLDOWN;
  hero.basicCombo.resetTimer = animDur + BASIC_COMBO_RESET;
  hero.basicCombo.step = (step + 1) % 3;
  hero.basicCombo.timer = animDur;
}

function spawnShockwaveProjectile(state, hero) {
  const dir = { x: Math.cos(hero.facing), y: Math.sin(hero.facing) };
  state.projectiles.push({
    id: uid(),
    type: 'shockwave',
    pos: { x: hero.pos.x + dir.x * 1.0, y: hero.pos.y + dir.y * 1.0 },
    vel: { x: dir.x * 18, y: dir.y * 18 },
    radius: 0.5,
    damage: 30,
    source: 'hero',
    lifetime: 0.7,
    pierce: true,
    hitIds: new Set(),
    fire: true,
    color: '#ff9a3a',
  });
}

// --- Q: Flame Dash ---

function abilityFlameDash(state, empowered) {
  const hero = state.hero;
  const dist = (empowered ? 8 : 5) * hero.mods.dashRadiusMult;
  const dir = { x: Math.cos(hero.facing), y: Math.sin(hero.facing) };
  // Move hero instantly along a dash (quick burst, short i-frames)
  hero.iFrames = Math.max(hero.iFrames, 0.18);
  // Sweep path hit
  const steps = 8;
  const path = [];
  for (let i = 1; i <= steps; i++) {
    path.push({ x: hero.pos.x + dir.x * (dist * i / steps), y: hero.pos.y + dir.y * (dist * i / steps) });
  }
  hero.pos.x += dir.x * dist;
  hero.pos.y += dir.y * dist;
  // Fire trail: damaging AoE pools
  for (const p of path) {
    state.groundAoes.push({
      pos: { x: p.x, y: p.y },
      radius: 0.9 * (empowered ? 1.3 : 1.0),
      age: 0, ttl: 1.0,
      dps: 10, tickAccum: 0, tickRate: 0.25,
      source: 'hero', fire: true,
      color: '#ff7a1a',
      hitIds: new Set(),
      burn: { dps: 5, duration: 3 },
    });
  }
  // Immediate pass-through damage
  hitMobsInRadius(state, { x: hero.pos.x - dir.x * dist * 0.5, y: hero.pos.y - dir.y * dist * 0.5 }, dist * 0.5 + 0.6, 24, { fire: true });
  addComboFlow(hero, 10);
  // Empowered: pull enemies to endpoint
  if (empowered) {
    for (const mob of state.mobs) {
      if (vDist(mob.pos, hero.pos) < 4 && !mob.boss && !mob.heavy) {
        const pullDir = vDir(mob.pos, hero.pos);
        mob.pos.x += pullDir.x * 1.8;
        mob.pos.y += pullDir.y * 1.8;
      }
    }
  }
  state.shakes.push({ mag: 0.15, ttl: 0.2, age: 0 });
}

// --- W: Cinder Cleave ---

function abilityCinderCleave(state, empowered) {
  const hero = state.hero;
  const halfAngle = empowered ? Math.PI : (Math.PI / 2);
  const radius = 3.0 * hero.mods.cleaveRadiusMult;
  const extraSwings = hero.mods.cleaveExtraSwings;
  const swings = 1 + extraSwings;
  const baseDmg = 55;
  for (let i = 0; i < swings; i++) {
    const thisHalf = swings > 1 ? (Math.PI / 6) * (i + 1) * 1.5 : halfAngle;
    const delay = i * 0.15;
    state.scheduled.push({
      at: state.runTime + delay,
      fn: (s) => {
        s.slashes.push({
          origin: { x: hero.pos.x, y: hero.pos.y },
          facing: hero.facing,
          halfAngle: Math.min(Math.PI, thisHalf),
          radius,
          age: 0, ttl: 0.22,
          color: '#ffa020',
        });
        hitMobsInCone(s, { origin: hero.pos, facing: hero.facing, halfAngle: Math.min(Math.PI, thisHalf), radius },
                      baseDmg, { fire: true, burn: { dps: 5, duration: 4 } });
      }
    });
  }
  addComboFlow(hero, 20);
  state.shakes.push({ mag: 0.25, ttl: 0.25, age: 0 });
}

// --- E: Blazing Uppercut ---

function abilityBlazingUppercut(state, empowered) {
  const hero = state.hero;
  const baseDmg = 110 * hero.mods.upperDmgMult;
  const knockup = 0.8 + hero.mods.upperKnockupBonus;
  if (empowered) {
    // AoE version
    state.slashes.push({
      origin: { x: hero.pos.x, y: hero.pos.y },
      facing: hero.facing,
      halfAngle: Math.PI, radius: 3.5,
      age: 0, ttl: 0.3,
      color: '#ffe080',
    });
    hitMobsInCone(state, { origin: hero.pos, facing: 0, halfAngle: Math.PI, radius: 3.5 }, baseDmg, {
      fire: true, knockup,
    });
  } else {
    // Find target ahead
    const dir = { x: Math.cos(hero.facing), y: Math.sin(hero.facing) };
    const target = findClosestMobInCone(state, hero.pos, hero.facing, Math.PI / 3, 3.5);
    state.slashes.push({
      origin: { x: hero.pos.x, y: hero.pos.y },
      facing: hero.facing,
      halfAngle: Math.PI / 4, radius: 3.5,
      age: 0, ttl: 0.28,
      color: '#ffe080',
    });
    if (target) {
      heroDamageToMob(state, target, baseDmg, { fire: true, knockup });
    }
  }
  addComboFlow(hero, 15);
  state.shakes.push({ mag: 0.3, ttl: 0.2, age: 0 });
}

// --- R: Phoenix Rend ---

function abilityPhoenixRend(state, empowered) {
  const hero = state.hero;
  const dur = 0.4;
  // Leap to mouse cursor point
  const target = {
    x: state.input.mouse.worldX,
    y: state.input.mouse.worldY,
  };
  // i-frames during leap
  hero.iFrames = Math.max(hero.iFrames, dur + 0.1);
  state.scheduled.push({
    at: state.runTime + dur,
    fn: (s) => {
      hero.pos.x = target.x;
      hero.pos.y = target.y;
      const radius = 3.5 * hero.mods.phoenixRadiusMult;
      s.slashes.push({
        origin: { x: target.x, y: target.y },
        facing: 0, halfAngle: Math.PI, radius,
        age: 0, ttl: 0.35, color: '#ffb84a',
      });
      hitMobsInRadius(s, target, radius, 180, { fire: true, stun: 0.6 });
      // Burning ground
      const groundTtl = empowered ? 10 : 5;
      s.groundAoes.push({
        pos: { x: target.x, y: target.y },
        radius,
        age: 0, ttl: groundTtl,
        dps: 18, tickAccum: 0, tickRate: 0.5,
        source: 'hero', fire: true,
        color: '#ff7a1a',
        hitIds: new Set(),
      });
      s.shakes.push({ mag: 0.5, ttl: 0.35, age: 0 });
      if (empowered) {
        // Second leap: to nearest mob
        const m = findNearestMob(s, target, 8);
        if (m) {
          s.scheduled.push({
            at: state.runTime + dur + 0.3,
            fn: (s2) => {
              hero.pos.x = m.pos.x;
              hero.pos.y = m.pos.y;
              hero.iFrames = Math.max(hero.iFrames, 0.2);
              s2.slashes.push({
                origin: { x: m.pos.x, y: m.pos.y },
                facing: 0, halfAngle: Math.PI, radius,
                age: 0, ttl: 0.35, color: '#ffb84a',
              });
              hitMobsInRadius(s2, m.pos, radius, 180, { fire: true, stun: 0.6 });
              s2.shakes.push({ mag: 0.5, ttl: 0.35, age: 0 });
            },
          });
        }
      }
    },
  });
  // Pre-leap small upward hop: null-state, iFrames cover it
}

// --- Dodge ---

export function tryDodge(state) {
  const hero = state.hero;
  if (hero.dodgeCharges <= 0 || hero.dodgeActive) return false;
  hero.dodgeCharges--;
  if (hero.dodgeChargeCD <= 0) hero.dodgeChargeCD = DODGE_CHARGE_CD * (hero.mods.dodgeCDMult || 1);
  hero.dodgeActive = true;
  hero.dodgeTimer = 0;
  hero.iFrames = DODGE_DURATION;
  let dx = 0, dy = 0;
  if (keyDown(state, 'KeyW')) dy -= 1;
  if (keyDown(state, 'KeyS')) dy += 1;
  if (keyDown(state, 'KeyA')) dx -= 1;
  if (keyDown(state, 'KeyD')) dx += 1;
  const L = Math.hypot(dx, dy);
  if (L > 0) { hero.dodgeDir = { x: dx / L, y: dy / L }; }
  else { hero.dodgeDir = { x: -Math.cos(hero.facing), y: -Math.sin(hero.facing) }; } // back-dodge
  return true;
}

// --- Searing Aura passive ---

export function tickSearingAura(state, dt) {
  const hero = state.hero;
  if (hero.downed || hero.dead) return;
  const r = AURA_RADIUS * hero.mods.auraRadiusMult;
  hero.auraTickAccum += dt;
  let insideCount = 0;
  if (hero.auraTickAccum >= 0.25) {
    const tickStep = 0.25;
    hero.auraTickAccum -= tickStep;
    for (const mob of state.mobs) {
      if (vDist(mob.pos, hero.pos) <= r + mob.radius) {
        const dmg = AURA_DPS * tickStep;
        mob.hp -= dmg;
        insideCount++;
      }
    }
  } else {
    for (const mob of state.mobs) {
      if (vDist(mob.pos, hero.pos) <= r + mob.radius) insideCount++;
    }
  }
  if (insideCount > 0) {
    // flow trickle
    hero.comboFlow = Math.min(hero.mods.comboFlowOverflowMax, hero.comboFlow + AURA_FLOW_TRICKLE * dt);
  }
}

// --- Helpers for hits ---

export function hitMobsInCone(state, cone, baseDmg, opts = {}) {
  for (const mob of state.mobs) {
    if (circleCone(mob.pos, mob.radius, cone)) {
      heroDamageToMob(state, mob, baseDmg, opts);
    }
  }
  if (state.boss && circleCone(state.boss.pos, state.boss.radius, cone)) {
    heroDamageToMob(state, state.boss, baseDmg, opts);
  }
}
export function hitMobsInRadius(state, center, radius, baseDmg, opts = {}) {
  for (const mob of state.mobs) {
    if (vDist(mob.pos, center) <= radius + mob.radius) {
      heroDamageToMob(state, mob, baseDmg, opts);
    }
  }
  if (state.boss && vDist(state.boss.pos, center) <= radius + state.boss.radius) {
    heroDamageToMob(state, state.boss, baseDmg, opts);
  }
}

function findClosestMobInCone(state, origin, facing, halfAngle, radius) {
  let best = null, bestD = Infinity;
  for (const mob of state.mobs) {
    if (circleCone(mob.pos, mob.radius, { origin, facing, halfAngle, radius })) {
      const d = vDist(mob.pos, origin);
      if (d < bestD) { bestD = d; best = mob; }
    }
  }
  if (state.boss && circleCone(state.boss.pos, state.boss.radius, { origin, facing, halfAngle, radius })) {
    const d = vDist(state.boss.pos, origin);
    if (d < bestD) { bestD = d; best = state.boss; }
  }
  return best;
}

function findNearestMob(state, pos, radius) {
  let best = null, bestD = radius;
  for (const mob of state.mobs) {
    const d = vDist(mob.pos, pos);
    if (d < bestD) { bestD = d; best = mob; }
  }
  return best;
}
