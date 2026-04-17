// events.js — Ember Rift + Frostbound Totem

import { uid, vDist, vDir } from './util.js';
import { spawnMob } from './mobs.js';

export function startEvent(state, type) {
  if (state.events.active) return;
  if (type === 'emberRift') startEmberRift(state);
  else if (type === 'frostboundTotem') startFrostboundTotem(state);
}

function startEmberRift(state) {
  const x = -3 + state.rng.next() * 6;
  const y = -15 + state.rng.next() * 4;
  const rift = makeEventEntity(state, {
    type: 'rift', pos: { x, y },
    hp: 400, radius: 1.0,
    color: '#ff4030', accent: '#ff8060',
    ttl: 45, spawnTimer: 6, spawnRate: 8,
    resistOverride: 0,
  });
  state.mobs.push(rift);
  state.events.active = { type: 'emberRift', rift, resolved: false };
  state.banners.push({
    text: 'EMBER RIFT OPENS!', color: '#ff4030',
    age: 0, ttl: 2.0, big: true, bordered: 'red',
  });
}

function startFrostboundTotem(state) {
  const side = state.rng.next() < 0.5 ? -1 : 1;
  const x = side * 9;
  const y = -14 + (state.rng.next() - 0.5) * 6;
  const totem = makeEventEntity(state, {
    type: 'totem', pos: { x, y },
    hp: 250, radius: 0.8,
    color: '#a0e0ff', accent: '#e0f8ff',
    ttl: 20,
  });
  state.mobs.push(totem);
  state.events.active = { type: 'frostboundTotem', totem, resolved: false };
  state.banners.push({
    text: 'FROSTBOUND TOTEM APPEARS', color: '#a0e0ff',
    age: 0, ttl: 2.0, big: true, bordered: 'yellow',
  });
}

function makeEventEntity(state, cfg) {
  return {
    id: uid(),
    type: cfg.type,
    eventEntity: true,
    pos: { x: cfg.pos.x, y: cfg.pos.y },
    vel: { x: 0, y: 0 },
    facing: 0,
    hp: cfg.hp, maxHp: cfg.hp,
    damage: 0, speed: 0,
    radius: cfg.radius,
    resist: 0,
    fsmState: 'static',
    statuses: [],
    color: cfg.color, accent: cfg.accent,
    dead: false,
    def: { xp: 0, role: 'event' },
    age: 0,
    ttl: cfg.ttl,
    spawnTimer: cfg.spawnTimer || 0,
    spawnRate: cfg.spawnRate || 0,
  };
}

export function updateEvents(state, dt) {
  if (!state.events.active) return;
  const ev = state.events.active;

  if (ev.type === 'emberRift') updateEmberRift(state, ev, dt);
  else if (ev.type === 'frostboundTotem') updateFrostboundTotem(state, ev, dt);

  if (ev.resolved) {
    state.events.active = null;
  }
}

function updateEmberRift(state, ev, dt) {
  const rift = ev.rift;
  rift.age += dt;
  if (rift.hp <= 0 && !rift.dead) {
    rift.dead = true;
    eventSuccess(state, 'emberRift');
    ev.resolved = true;
    return;
  }
  if (rift.age >= rift.ttl && !rift.dead) {
    rift.dead = true;
    eventFailure(state, 'emberRift');
    ev.resolved = true;
    return;
  }
  rift.spawnTimer -= dt;
  if (rift.spawnTimer <= 0) {
    rift.spawnTimer = rift.spawnRate;
    const roll = state.rng.next();
    if (roll < 0.33) spawnMob(state, 'magmaBrute', { x: rift.pos.x, y: rift.pos.y });
    else if (roll < 0.66) spawnMob(state, 'blazeShaman', { x: rift.pos.x, y: rift.pos.y });
    else {
      for (let i = 0; i < 3; i++) {
        spawnMob(state, 'cinderImp', { x: rift.pos.x + (state.rng.next() - 0.5) * 2, y: rift.pos.y + (state.rng.next() - 0.5) * 2 });
      }
    }
    state.slashes.push({
      origin: { x: rift.pos.x, y: rift.pos.y }, facing: 0, halfAngle: Math.PI, radius: 2.0,
      age: 0, ttl: 0.3, color: '#ff4030',
    });
  }
}

function updateFrostboundTotem(state, ev, dt) {
  const t = ev.totem;
  t.age += dt;
  if (t.hp <= 0 && !t.dead) {
    t.dead = true;
    eventSuccess(state, 'frostboundTotem');
    ev.resolved = true;
    return;
  }
  if (t.age >= t.ttl && !t.dead) {
    t.dead = true;
    eventFailure(state, 'frostboundTotem');
    ev.resolved = true;
    return;
  }
}

function eventSuccess(state, type) {
  const hero = state.hero;
  if (type === 'emberRift') {
    const pick = state.rng.int(0, 2);
    if (pick === 0) {
      hero.mods.damageMult *= 1.15;
      hero.buffs.push({ name: '+15% ability dmg', age: 0, ttl: 30 });
      scheduleRevert(state, 30, () => { hero.mods.damageMult /= 1.15; });
    } else if (pick === 1) {
      state.aether += 8;
    } else {
      const amount = Math.round(hero.maxHp * 0.3);
      hero.hp = Math.min(hero.maxHp, hero.hp + amount);
      state.floaters.push({ pos: { x: hero.pos.x, y: hero.pos.y - 0.7 }, text: `+${amount}`, color: '#70ff70', age: 0, ttl: 1.2, vy: -1.0, size: 18 });
    }
    state.banners.push({ text: 'RIFT CLOSED — BUFF GAINED', color: '#ff7a1a', age: 0, ttl: 2, big: false });
  } else if (type === 'frostboundTotem') {
    const pick = state.rng.int(0, 2);
    if (pick === 0) {
      hero.mods.comboFlowGainMult *= 1.30;
      hero.buffs.push({ name: '+30% flow gain', age: 0, ttl: 90 });
      scheduleRevert(state, 90, () => { hero.mods.comboFlowGainMult /= 1.30; });
    } else if (pick === 1) {
      for (const k of ['Q', 'E', 'R', 'F']) hero.abilityCDs[k] = 0;
      hero.abilityCharges.Q = 2 + hero.mods.dashExtraCharges;
      hero.buffs.push({ name: 'All CDs reset', age: 0, ttl: 1 });
    } else {
      hero.mods.hpRegenPerSec += 1;
      hero.buffs.push({ name: '+1 HP/s (rest of realm)', age: 0, ttl: 9999 });
    }
    state.banners.push({ text: 'TOTEM CLAIMED — BUFF GAINED', color: '#a0e0ff', age: 0, ttl: 2, big: false });
  }
}

function eventFailure(state, type) {
  const hero = state.hero;
  if (type === 'emberRift') {
    state.globalMobSpeedMult = (state.globalMobSpeedMult || 1) * 1.10;
    scheduleRevert(state, 60, () => { state.globalMobSpeedMult /= 1.10; });
    state.banners.push({ text: 'RIFTTOUCHED', color: '#ff3030', age: 0, ttl: 2, big: true, bordered: 'red' });
  } else if (type === 'frostboundTotem') {
    hero.mods.damageMult *= 0.9;
    scheduleRevert(state, 60, () => { hero.mods.damageMult /= 0.9; });
    state.banners.push({ text: 'FORSAKEN', color: '#3080c0', age: 0, ttl: 2, big: true, bordered: 'red' });
  }
}

function scheduleRevert(state, delay, fn) {
  state.scheduled.push({ at: state.runTime + delay, fn: () => fn() });
}
