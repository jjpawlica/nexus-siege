// talents.js — in-run talent pool + pick logic + apply()

import { HERO_BASE_MAX_HP } from './hero.js';

// Talents for Ember Knight (Emberblade default spec)

export const TALENTS = {
  // --- Common (5) ---
  searingEdge: {
    id: 'searingEdge', name: 'Searing Edge', tier: 'common', color: '#bfbfbf',
    desc: '+15% basic attack damage',
    apply(hero) { hero.mods.basicDmgMult *= 1.15; },
  },
  embersGrace: {
    id: 'embersGrace', name: "Ember's Grace", tier: 'common', color: '#bfbfbf',
    desc: '+10% move speed',
    apply(hero) { hero.mods.moveSpeedMult *= 1.10; },
  },
  fuelTheFlame: {
    id: 'fuelTheFlame', name: 'Fuel the Flame', tier: 'common', color: '#bfbfbf',
    desc: 'Kills build +2 Combo Flow',
    apply(hero) { hero.mods.killFlowBonus = (hero.mods.killFlowBonus || 0) + 2; },
  },
  burningResolve: {
    id: 'burningResolve', name: 'Burning Resolve', tier: 'common', color: '#bfbfbf',
    desc: '+75 max HP',
    apply(hero) { hero.mods.maxHpBonus += 75; hero.maxHp = HERO_BASE_MAX_HP + hero.mods.maxHpBonus; hero.hp = Math.min(hero.maxHp, hero.hp + 75); },
  },
  lingeringHeat: {
    id: 'lingeringHeat', name: 'Lingering Heat', tier: 'common', color: '#bfbfbf',
    desc: 'Burn DoT duration +2s, damage +10%',
    apply(hero) { hero.mods.fireBurnDurationBonus += 2; hero.mods.fireBurnDamageMult *= 1.10; },
  },
  // --- Rare (5) ---
  kindledDash: {
    id: 'kindledDash', name: 'Kindled Dash', tier: 'rare', color: '#4a8aff',
    desc: 'Flame Dash gains +1 charge (3 total)',
    apply(hero) { hero.mods.dashExtraCharges += 1; hero.abilityCharges.Q = Math.min(3, hero.abilityCharges.Q + 1); },
  },
  wideArc: {
    id: 'wideArc', name: 'Wide Arc', tier: 'rare', color: '#4a8aff',
    desc: 'Cinder Cleave radius +30%',
    apply(hero) { hero.mods.cleaveRadiusMult *= 1.30; },
  },
  concussiveUpper: {
    id: 'concussiveUpper', name: 'Concussive Upper', tier: 'rare', color: '#4a8aff',
    desc: 'Blazing Uppercut knockup +0.4s, +20% damage',
    apply(hero) { hero.mods.upperKnockupBonus += 0.4; hero.mods.upperDmgMult *= 1.20; },
  },
  meteoricLanding: {
    id: 'meteoricLanding', name: 'Meteoric Landing', tier: 'rare', color: '#4a8aff',
    desc: 'Phoenix Rend impact radius +40%',
    apply(hero) { hero.mods.phoenixRadiusMult *= 1.40; },
  },
  swiftCombo: {
    id: 'swiftCombo', name: 'Swift Combo', tier: 'rare', color: '#4a8aff',
    desc: 'Basic attack chain speed +25%, finisher Combo Flow +5',
    apply(hero) { hero.mods.basicChainSpeedMult *= 1.25; hero.mods.finisherFlowBonus += 5; },
  },
  // --- Epic (3) ---
  blazingFinisher: {
    id: 'blazingFinisher', name: 'Blazing Finisher', tier: 'epic', color: '#b060ff',
    desc: 'Basic combo Hit 3 fires a piercing flame shockwave projectile',
    apply(hero) { hero.mods.hit3Shockwave = true; },
  },
  cleavingFury: {
    id: 'cleavingFury', name: 'Cleaving Fury', tier: 'epic', color: '#b060ff',
    desc: 'Cinder Cleave becomes 3 sequential swings',
    apply(hero) { hero.mods.cleaveExtraSwings += 2; },
  },
  comboBank: {
    id: 'comboBank', name: 'Combo Bank', tier: 'epic', color: '#b060ff',
    desc: 'Combo Flow overflows past 100 (up to 200); stack 2 empowered casts',
    apply(hero) { hero.mods.comboFlowOverflowMax = 200; },
  },
  // --- Mythic (2) ---
  infernoIncarnate: {
    id: 'infernoIncarnate', name: 'Inferno Incarnate', tier: 'mythic', color: '#ff8040',
    desc: 'All damage is fire. +50% vs burning enemies. Aura 2×',
    apply(hero) { hero.mods.allDamageIsFire = true; hero.mods.fireVsBurningBonus += 0.5; hero.mods.auraRadiusMult *= 2.0; },
  },
  ashenWill: {
    id: 'ashenWill', name: 'Ashen Will', tier: 'mythic', color: '#ff8040',
    desc: 'Empowered casts cost 50% Combo Flow; Ult empowered at 50% meter',
    apply(hero) { hero.mods.empoweredCostMult *= 0.5; hero.mods.empoweredUltAtHalf = true; },
  },
};

export const TIER_COLORS = {
  common: '#bfbfbf',
  rare: '#4a8aff',
  epic: '#b060ff',
  mythic: '#ff8040',
};

export function rarityWeightsForLevel(level) {
  // Per spec §B.3
  if (level <= 3) return { common: 0.70, rare: 0.30, epic: 0, mythic: 0 };
  if (level <= 6) return { common: 0.40, rare: 0.45, epic: 0.15, mythic: 0 };
  if (level <= 9) return { common: 0.20, rare: 0.40, epic: 0.30, mythic: 0.10 };
  return { common: 0, rare: 0, epic: 0, mythic: 1.0 }; // level 10: pure mythic
}

// Roll 3 unique talent choices for a given level
export function rollTalentChoices(state, level) {
  const pool = Object.values(TALENTS).filter(t => !state.hero.talents.has(t.id));
  const weights = rarityWeightsForLevel(level);

  // At lvl 10 require mythic
  if (level === 10) {
    // If no mythic left, fall back to epic
    const mythics = pool.filter(t => t.tier === 'mythic');
    if (mythics.length > 0) {
      // Pick up to 3 mythics
      return uniqueDraw(state, mythics, Math.min(3, mythics.length));
    }
  }

  // Build the tier-filtered pools
  const byTier = { common: [], rare: [], epic: [], mythic: [] };
  for (const t of pool) byTier[t.tier].push(t);

  // Mythic uniqueness: only 1 mythic per run
  const hasMythic = [...state.hero.talents].some(id => TALENTS[id] && TALENTS[id].tier === 'mythic');
  if (hasMythic) byTier.mythic = [];

  const choices = [];
  for (let i = 0; i < 3; i++) {
    const tier = weightedPickTier(state.rng, weights, byTier);
    if (!tier) break;
    const t = state.rng.pick(byTier[tier]);
    byTier[tier] = byTier[tier].filter(x => x.id !== t.id);
    choices.push(t);
  }
  return choices;
}

function weightedPickTier(rng, weights, byTier) {
  // normalize, skip empty tiers
  const effective = {};
  let total = 0;
  for (const [tier, w] of Object.entries(weights)) {
    if (w > 0 && byTier[tier] && byTier[tier].length > 0) {
      effective[tier] = w;
      total += w;
    }
  }
  if (total <= 0) return null;
  let r = rng.next() * total;
  for (const [tier, w] of Object.entries(effective)) {
    r -= w;
    if (r <= 0) return tier;
  }
  return Object.keys(effective).pop();
}

function uniqueDraw(state, arr, n) {
  const copy = arr.slice();
  const out = [];
  while (out.length < n && copy.length > 0) {
    const idx = Math.floor(state.rng.next() * copy.length);
    out.push(copy[idx]);
    copy.splice(idx, 1);
  }
  return out;
}

export function applyTalent(state, talent) {
  state.hero.talents.add(talent.id);
  talent.apply(state.hero);
}
