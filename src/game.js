// game.js — orchestration, realm flow, run lifecycle

import { processAbilityInputs, tickSearingAura } from './abilities.js';
import {
  updateHeroMovementAndFacing, tickHeroState, applyHeroMods, damageHero, tryAetherRespawn,
} from './hero.js';
import { updateMob, removeDeadMobs } from './mobs.js';
import {
  updateProjectiles, updateGroundAoes, updateTelegraphs, updateFloaters,
  updateParticles, updateSlashes, updateHealOrbs, updateShakes,
} from './projectiles.js';
import { updateEvents } from './events.js';
import { updateWorld, damageTower, updateStructures, NEXUS_MAX_HP } from './world.js';
import { updateBoss, updatePortal, triggerNexusBoss } from './bosses.js';
import { startRealm, updateSpawns, checkRealmTransitions, REALMS } from './realms.js';
import { TALENTS, rollTalentChoices, applyTalent } from './talents.js';
import { keyPressed, mousePressed } from './input.js';
import { vDist, vDir, clamp, expDamp } from './util.js';
import { heroDamageToMob } from './damage.js';

// XP curve
export const XP_TABLE = [0, 50, 120, 210, 330, 480, 670, 910, 1210, 1580];

export function xpForLevel(level) {
  if (level <= 0) return 0;
  if (level >= XP_TABLE.length) return XP_TABLE[XP_TABLE.length - 1];
  return XP_TABLE[level];
}

export function beginRun(state) {
  state.runTime = 0;
  state.realmIndex = -1;
  state.phase = 'lane';
  state.victory = false;
  state.runFailed = false;
  startRealm(state, 0);
  applyHeroMods(state.hero);
}

// Main simulate step (fixed-dt)
export function simulate(state, dt) {
  if (state.paused) return;
  if (state.phase === 'results') return;
  if (state.runFailed) return;

  state.runTime += dt;
  if (state.phase === 'lane' || state.phase === 'arena') {
    state.realmTime += dt;
  }

  // Time Freeze tick (Nexus Ability)
  if (state.timeFreeze && state.timeFreeze.active) {
    state.timeFreeze.timeRemaining -= dt;
    if (state.timeFreeze.timeRemaining <= 0) {
      state.timeFreeze.active = false;
      state.banners.push({ text: 'TIME RESUMES', color: '#80c0ff', age: 0, ttl: 1.6, big: false });
    }
  }

  // Global: update scheduled events
  if (state.scheduled.length > 0) {
    for (let i = state.scheduled.length - 1; i >= 0; i--) {
      if (state.runTime >= state.scheduled[i].at) {
        try { state.scheduled[i].fn(state); } catch (e) { console.error(e); }
        state.scheduled.splice(i, 1);
      }
    }
  }

  // Inputs (abilities)
  processAbilityInputs(state, dt);

  // Hero
  updateHeroMovementAndFacing(state.hero, state, dt);
  tickHeroState(state.hero, dt);
  tickSearingAura(state, dt);

  // Camera follow (lane only — arena has its own camera setup)
  if (state.phase === 'lane') {
    // Keep Nexus visible when hero is near it; scroll north as hero pushes forward.
    const targetY = clamp(state.hero.pos.y * 0.55 - 3, -22, -4);
    state.camera.y = expDamp(state.camera.y, targetY, 3.5, dt);
  }

  // World + mobs (paused during arena)
  if (state.phase === 'lane') {
    updateWorld(state, dt);
    updateStructures(state, dt);
    for (const m of state.mobs) updateMob(m, state, dt);
    // mobs hitting towers (adjacency damage)
    for (const m of state.mobs) {
      if (m.dead || m.eventEntity || m.boss || m.structure) continue;
      for (const t of state.world.towers) {
        if (t.destroyed) continue;
        if (vDist(m.pos, t.pos) <= m.radius + t.radius + 0.3 && m.target === 'nexus') {
          damageTower(t, m.damage * dt * 0.5);
        }
      }
    }
    updateSpawns(state, dt);
    updateEvents(state, dt);
    updatePortal(state, dt);
    checkRealmTransitions(state);
  } else if (state.phase === 'arena') {
    // arena mode: no spawner, only bosses and arena-spawned adds
    for (const m of state.mobs) updateMob(m, state, dt);
  }

  // Bosses
  updateBoss(state, dt);

  // Event entity damage via hero hits: we hook via adding rift/totem to a special check
  damageEventEntities(state);

  // Projectiles etc.
  updateProjectiles(state, dt);
  updateGroundAoes(state, dt);
  updateTelegraphs(state, dt);
  updateFloaters(state, dt);
  updateParticles(state, dt);
  updateSlashes(state, dt);
  updateHealOrbs(state, dt);
  updateShakes(state, dt);

  // Moving ground AoEs (e.g., blizzard) — frozen during Time Freeze if enemy-source
  const frozen = state.timeFreeze && state.timeFreeze.active;
  for (const a of state.groundAoes) {
    if (frozen && a.source !== 'hero') continue;
    if (a.moving && a.vel) {
      a.pos.x += a.vel.x * dt;
      a.pos.y += a.vel.y * dt;
    }
  }

  // Banners
  for (const b of state.banners) b.age += dt;
  state.banners = state.banners.filter(b => b.age < b.ttl);

  // Level up check
  checkLevelUp(state);

  // UI modal commits
  updateTalentPickInputs(state);

  // Remove dead mobs
  removeDeadMobs(state);

  // Vendor phase input (between-realm)
  if (state.phase === 'warp') updateWarpInputs(state);

  // Nexus shop access from lane phase
  updateNexusShopInputs(state);

  // Realm advancement after vendor
  // (vendor phase ends when ENTER pressed)

  // (Pause/debug toggles are handled at frame level in gameLoop.js so they
  // stay responsive while paused.)

  // Hero died in arena? (lane deaths respawn, not fail)
  if (state.hero.dead && !state.runFailed) {
    state.runFailed = true;
    state.runFailReason = state.phase === 'arena' ? 'Fell in the arena' : 'Hero fell in battle';
    state.phase = 'results';
  }
  // Aether express respawn (V key) — lane phase only
  if (state.hero.respawning && keyPressed(state, 'KeyV')) {
    tryAetherRespawn(state);
  }

  // Nexus destroyed
  if (state.world.nexus.hp <= 0 && !state.runFailed) {
    state.runFailed = true;
    state.runFailReason = 'Nexus destroyed';
    state.phase = 'results';
  }

  // (pressedThisFrame is cleared in gameLoop.js between sim ticks)
}

function damageEventEntities(state) {
  // Apply hero-damage cones/radii to rift/totem too.
  // Simple approach: on every frame, just let hero-basic-attack cone & ability hits check
  // these event entities via a pseudo-mob structure.
  // Since abilities.js uses state.mobs, we temporarily "patch" event entities into it.
  // But that would re-run every frame. Simpler: spawn them as mobs with a flag.
  // Instead, we reverse-calc: after hero actions, check proximity-based damage against nearby projectiles.

  // Actually easier: add a helper that checks hero basic attack hits against event entities.
  // Since hits happen inside ability functions, we can't easily intercept here.
  // Workaround: add them to state.mobs as hidden pseudo-mobs when active, then strip them back.
  // Implementation pushed to mobs injection below.
}

function checkLevelUp(state) {
  const hero = state.hero;
  while (hero.level < 10 && hero.xp >= xpForLevel(hero.level)) {
    hero.level++;
    hero.pendingLevels++;
    state.ui.pendingPickCount++;
    // Roll pool if none pending currently
    if (!state.ui.pickPool.length) {
      state.ui.pickPool = rollTalentChoices(state, hero.level);
    }
    state.banners.push({
      text: hero.level >= 10 ? 'AWAKENING' : `LEVEL ${hero.level}`,
      color: hero.level >= 10 ? '#ff8040' : '#ffcc40',
      age: 0, ttl: 1.8, big: true,
    });
  }
  // If no pick pool yet but pending picks — roll for current level
  if (state.ui.pendingPickCount > 0 && state.ui.pickPool.length === 0) {
    state.ui.pickPool = rollTalentChoices(state, state.hero.level);
  }
}

function updateTalentPickInputs(state) {
  if (state.ui.pendingPickCount <= 0) return;
  if (keyPressed(state, 'Tab')) {
    state.ui.modalOpen = !state.ui.modalOpen;
    if (state.ui.modalOpen) {
      state.ui.nexusShopOpen = false;
      state.ui.vendorOpen = false;
    }
  }
  if (!state.ui.modalOpen) return;
  // Digit 1/2/3 pick inside modal
  for (let i = 0; i < 3; i++) {
    if (keyPressed(state, `Digit${i + 1}`) && state.ui.pickPool[i]) {
      pickTalent(state, i);
      return;
    }
  }
  // Click on card
  if (mousePressed(state, 0)) {
    const idx = detectCardClick(state);
    if (idx != null) pickTalent(state, idx);
  }
}

function detectCardClick(state) {
  // Mirror the renderer math
  const W = state.canvasW, H = state.canvasH;
  const cards = state.ui.pickPool || [];
  const cardW = 240, cardH = 260, gap = 24;
  const totalW = cards.length * cardW + (cards.length - 1) * gap;
  const sx = (W - totalW) / 2;
  const sy = (H - cardH) / 2;
  const mx = state.input.mouse.x, my = state.input.mouse.y;
  for (let i = 0; i < cards.length; i++) {
    const cx = sx + i * (cardW + gap);
    if (mx >= cx && mx <= cx + cardW && my >= sy && my <= sy + cardH) return i;
  }
  return null;
}

function pickTalent(state, idx) {
  const t = state.ui.pickPool[idx];
  if (!t) return;
  applyTalent(state, t);
  state.ui.pickPool = [];
  state.ui.pendingPickCount--;
  state.ui.modalOpen = false;
  // If more pending, roll a new pool
  if (state.ui.pendingPickCount > 0) {
    state.ui.pickPool = rollTalentChoices(state, state.hero.level);
  }
  state.banners.push({
    text: `${t.name} acquired`, color: t.color, age: 0, ttl: 1.5, big: false,
  });
}

function updateWarpInputs(state) {
  if (keyPressed(state, 'Enter') || keyPressed(state, 'NumpadEnter')) {
    state.ui.vendorOpen = false;
    advanceRealm(state);
  }
  if (keyPressed(state, 'Digit1')) vendorBuy(state, 'potion', 10);
  if (keyPressed(state, 'Digit2')) vendorBuy(state, 'freezeGrenade', 12);
  if (keyPressed(state, 'Digit3')) vendorBuy(state, 'flameGrenade', 12);
  if (keyPressed(state, 'Digit4')) vendorBuy(state, 'upgradeHP', 20);
  if (keyPressed(state, 'Digit5')) vendorBuy(state, 'upgradeSpeed', 15);
}

function updateNexusShopInputs(state) {
  if (state.phase !== 'lane') return;
  if (state.ui.modalOpen) return;
  const hero = state.hero;
  const n = state.world.nexus;
  const near = vDist(hero.pos, n.pos) <= n.radius + 2.5;
  state.ui.nexusShopAvailable = near && !hero.dead && !hero.downed && !hero.respawning;

  // B toggles open/close in a SINGLE branch so one press isn't double-consumed
  if (keyPressed(state, 'KeyB')) {
    if (state.ui.nexusShopOpen) {
      state.ui.nexusShopOpen = false;
      state.ui.vendorOpen = false;
    } else if (state.ui.nexusShopAvailable) {
      state.ui.nexusShopOpen = true;
      state.ui.vendorOpen = true;
    }
    return; // consume the key press this tick
  }

  // Auto-close if hero walks away
  if (!near && state.ui.nexusShopOpen) {
    state.ui.nexusShopOpen = false;
    state.ui.vendorOpen = false;
  }

  // Purchase hotkeys + Esc while shop is open
  if (state.ui.nexusShopOpen) {
    if (keyPressed(state, 'Digit1')) vendorBuy(state, 'potion', 10);
    if (keyPressed(state, 'Digit2')) vendorBuy(state, 'freezeGrenade', 12);
    if (keyPressed(state, 'Digit3')) vendorBuy(state, 'flameGrenade', 12);
    if (keyPressed(state, 'Digit4')) vendorBuy(state, 'upgradeHP', 20);
    if (keyPressed(state, 'Digit5')) vendorBuy(state, 'upgradeSpeed', 15);
  }
}

function vendorBuy(state, id, price) {
  if (state.aether < price) return;
  state.aether -= price;
  if (id === 'potion') state.hero.potions++;
  else if (id === 'freezeGrenade') state.hero.freezeGrenades++;
  else if (id === 'flameGrenade') state.hero.flameGrenades++;
  else if (id === 'upgradeHP') { state.hero.mods.maxHpBonus += 50; state.hero.maxHp += 50; state.hero.hp += 50; }
  else if (id === 'upgradeSpeed') state.hero.mods.moveSpeedMult *= 1.05;
  state.banners.push({ text: `Purchased: ${id}`, color: '#80ff80', age: 0, ttl: 1.2, big: false });
}

function advanceRealm(state) {
  const next = state.realmIndex + 1;
  if (next >= REALMS.length) {
    // All realms cleared — trigger Nexus boss
    triggerNexusBoss(state);
    state.phase = 'lane';
    state.hero.pos = { x: 0, y: -3 };
    return;
  }
  startRealm(state, next);
  state.hero.pos = { x: 0, y: -5 };
}

export function restartRun(state) {
  // Simplest and most reliable: reload the page
  window.location.reload();
}
