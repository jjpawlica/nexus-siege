// damage.js — damage calculation, floaters, application to mobs

import { uid, vDist } from './util.js';

export function rollCrit(hero) {
  return Math.random() < hero.mods.critChance;
}

export function heroDamageToMob(state, mob, baseDmg, opts = {}) {
  const hero = state.hero;
  const isFire = opts.fire === true || hero.mods.allDamageIsFire;
  const isBurning = mob.statuses && mob.statuses.some(s => s.type === 'burn');
  let dmg = baseDmg * hero.mods.damageMult;
  if (opts.basic) dmg *= hero.mods.basicDmgMult;
  if (isFire) dmg *= hero.mods.fireDmgMult;
  if (isFire && isBurning) dmg *= (1 + hero.mods.fireVsBurningBonus);
  // crit
  const isCrit = Math.random() < hero.mods.critChance;
  if (isCrit) dmg *= hero.mods.critMult;
  // resist (fire vs mob resist)
  if (isFire && mob.resist) {
    const r = Math.min(0.75, mob.resist);
    dmg *= (1 - r);
  }
  const final = Math.max(1, Math.round(dmg));
  mob.hp -= final;
  // Boss channel interrupt hook
  if (mob.boss && mob.channelHealActive) mob.channelInterrupted = true;
  // floater
  state.floaters.push({
    pos: { x: mob.pos.x, y: mob.pos.y - 0.5 },
    text: isCrit ? `${final}!` : `${final}`,
    color: isCrit ? '#ffdc3a' : '#ffffff',
    age: 0, ttl: isCrit ? 1.1 : 0.8, vy: -1.0,
    size: isCrit ? 20 : 14,
    crit: isCrit,
  });
  // burn
  if (opts.burn) applyBurn(state, mob, opts.burn);
  if (opts.knockup) applyKnockup(mob, opts.knockup);
  if (opts.stun) applyStun(mob, opts.stun);
  if (opts.slow) applySlow(mob, opts.slow.percent, opts.slow.duration);
  return final;
}

export function applyBurn(state, mob, burn) {
  // burn = { dps, duration, stackCap=3 }
  const dur = (burn.duration || 4) + (state.hero ? state.hero.mods.fireBurnDurationBonus : 0);
  const dps = (burn.dps || 5) * (state.hero ? state.hero.mods.fireBurnDamageMult : 1);
  if (!mob.statuses) mob.statuses = [];
  const existing = mob.statuses.find(s => s.type === 'burn');
  if (existing) {
    existing.stacks = Math.min(burn.stackCap || 3, existing.stacks + 1);
    existing.age = 0;
    existing.ttl = dur;
  } else {
    mob.statuses.push({ type: 'burn', dps, age: 0, ttl: dur, tickAccum: 0, stacks: 1 });
  }
}

export function applyKnockup(mob, duration) {
  if (!mob.statuses) mob.statuses = [];
  if (!mob.statuses.some(s => s.type === 'knockup')) {
    mob.statuses.push({ type: 'knockup', age: 0, ttl: duration });
  }
}

export function applyStun(mob, duration) {
  if (!mob.statuses) mob.statuses = [];
  const existing = mob.statuses.find(s => s.type === 'stun');
  if (existing) existing.ttl = Math.max(existing.ttl - existing.age, duration);
  else mob.statuses.push({ type: 'stun', age: 0, ttl: duration });
}

export function applySlow(mob, percent, duration) {
  if (!mob.statuses) mob.statuses = [];
  const existing = mob.statuses.find(s => s.type === 'slow');
  if (existing) {
    existing.percent = Math.min(0.5, existing.percent + percent * 0.5);
    existing.age = 0;
    existing.ttl = duration;
  } else {
    mob.statuses.push({ type: 'slow', age: 0, ttl: duration, percent });
  }
}

export function mobIsHardCC(mob) {
  if (!mob.statuses) return false;
  return mob.statuses.some(s => s.type === 'stun' || s.type === 'knockup');
}

export function mobMoveSpeedMult(mob) {
  if (!mob.statuses) return 1;
  let m = 1;
  for (const s of mob.statuses) {
    if (s.type === 'slow') m *= (1 - s.percent);
    if (s.type === 'stun' || s.type === 'knockup') m = 0;
  }
  return m;
}

export function updateStatusesForMob(state, mob, dt) {
  if (!mob.statuses) return;
  for (let i = mob.statuses.length - 1; i >= 0; i--) {
    const s = mob.statuses[i];
    s.age += dt;
    if (s.type === 'burn') {
      s.tickAccum += dt;
      while (s.tickAccum >= 1.0) {
        s.tickAccum -= 1.0;
        const perTick = s.dps * s.stacks;
        const final = Math.max(1, Math.round(perTick));
        mob.hp -= final;
        state.floaters.push({
          pos: { x: mob.pos.x, y: mob.pos.y - 0.4 },
          text: `${final}`,
          color: '#ff8a2a',
          age: 0, ttl: 0.6, vy: -0.8, size: 12,
        });
      }
    }
    if (s.age >= s.ttl) mob.statuses.splice(i, 1);
  }
}
