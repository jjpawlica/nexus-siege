// projectiles.js — updates and collisions for projectiles, ground AoEs, telegraphs, slashes, particles

import { uid, vDist, vLen, angleBetween } from './util.js';
import { heroDamageToMob } from './damage.js';
import { damageHero } from './hero.js';
import { circleCircle, pointInCone, circleCone } from './collision.js';
import { damageTower } from './world.js';

export function updateProjectiles(state, dt) {
  const hero = state.hero;
  const nexus = state.world.nexus;
  const frozen = state.timeFreeze && state.timeFreeze.active;
  for (const p of state.projectiles) {
    // Mob projectiles freeze in place; hero/tower projectiles keep moving.
    if (!(frozen && p.source === 'mob')) {
      p.pos.x += p.vel.x * dt;
      p.pos.y += p.vel.y * dt;
      p.lifetime -= dt;
    }
    if (p.lifetime <= 0) { p.dead = true; continue; }

    if (p.source === 'hero' || p.source === 'tower') {
      // Hit mobs
      for (const m of state.mobs) {
        if (m.dead) continue;
        if (p.hitIds.has(m.id)) continue;
        if (circleCircle(p.pos, p.radius, m.pos, m.radius)) {
          if (p.source === 'hero') {
            heroDamageToMob(state, m, p.damage, { fire: p.fire });
          } else {
            // tower hit — simple damage
            m.hp -= p.damage;
            state.floaters.push({ pos: { x: m.pos.x, y: m.pos.y - 0.4 }, text: `${p.damage}`, color: '#ffe040', age: 0, ttl: 0.6, vy: -0.9, size: 12 });
          }
          p.hitIds.add(m.id);
          if (!p.pierce) { p.dead = true; break; }
        }
      }
      // Hit boss
      if (!p.dead && state.boss && !state.boss.dead && !p.hitIds.has(state.boss.id)) {
        if (circleCircle(p.pos, p.radius, state.boss.pos, state.boss.radius)) {
          if (p.source === 'hero') heroDamageToMob(state, state.boss, p.damage, { fire: p.fire });
          p.hitIds.add(state.boss.id);
          if (!p.pierce) p.dead = true;
        }
      }
    } else if (p.source === 'mob') {
      // Hit hero
      if (!hero.dead && circleCircle(p.pos, p.radius, hero.pos, hero.radius)) {
        damageHero(state, p.damage, p.sourceName || 'mobShot');
        if (!p.pierce) p.dead = true;
      }
      // Hit nexus
      if (!p.dead && circleCircle(p.pos, p.radius, nexus.pos, nexus.radius)) {
        nexus.hp -= p.damage * 0.5;  // reduced direct damage
        p.dead = true;
      }
      // Hit tower (blocks)
      for (const t of state.world.towers) {
        if (!t.destroyed && circleCircle(p.pos, p.radius, t.pos, t.radius)) {
          damageTower(t, p.damage * 0.5);
          p.dead = true;
          break;
        }
      }
    }
  }
  state.projectiles = state.projectiles.filter(p => !p.dead);
}

export function updateGroundAoes(state, dt) {
  const frozen = state.timeFreeze && state.timeFreeze.active;
  for (const a of state.groundAoes) {
    // During Time Freeze, enemy ground AoEs pause (hero-source AoEs keep ticking)
    if (frozen && a.source !== 'hero') continue;
    a.age += dt;
    if (a.age >= a.ttl) { a.dead = true; continue; }
    a.tickAccum += dt;
    while (a.tickAccum >= a.tickRate) {
      a.tickAccum -= a.tickRate;
      // Freeze field: applies stun (no damage)
      if (a.type === 'freezeField' && a.source === 'hero') {
        for (const m of state.mobs) {
          if (m.dead || m.structure || m.eventEntity || m.boss) continue;  // bosses immune
          if (vDist(m.pos, a.pos) <= a.radius + m.radius) {
            if (!m.statuses) m.statuses = [];
            const existing = m.statuses.find(s => s.type === 'stun');
            if (existing) { existing.age = 0; existing.ttl = Math.max(existing.ttl, a.freezeDuration); }
            else m.statuses.push({ type: 'stun', age: 0, ttl: a.freezeDuration });
          }
        }
        continue;
      }
      // Apply damage to mobs inside
      if (a.source === 'hero') {
        for (const m of state.mobs) {
          if (m.dead) continue;
          if (vDist(m.pos, a.pos) <= a.radius + m.radius) {
            heroDamageToMob(state, m, a.dps * a.tickRate, { fire: a.fire, burn: a.burn });
          }
        }
        if (state.boss && !state.boss.dead) {
          if (vDist(state.boss.pos, a.pos) <= a.radius + state.boss.radius) {
            heroDamageToMob(state, state.boss, a.dps * a.tickRate, { fire: a.fire });
          }
        }
      } else {
        // mob-source ground AoE
        if (!state.hero.dead && vDist(state.hero.pos, a.pos) <= a.radius + state.hero.radius) {
          damageHero(state, a.dps * a.tickRate, a.sourceName || 'aoe');
        }
      }
    }
  }
  state.groundAoes = state.groundAoes.filter(a => !a.dead);
}

// Telegraph phase progression + execute
export function updateTelegraphs(state, dt) {
  const frozen = state.timeFreeze && state.timeFreeze.active;
  for (const t of state.telegraphs) {
    // Enemy telegraphs pause mid-cycle during Time Freeze
    if (frozen && t.fromMob) continue;
    t.age += dt;
    if (t.phase === 'windUp' && t.age >= t.windUp) {
      t.phase = 'commit';
      t.age = 0;
    } else if (t.phase === 'commit' && t.age >= t.commit) {
      // Execute
      t.phase = 'execute';
      t.age = 0;
      executeTelegraph(state, t);
    } else if (t.phase === 'execute' && t.age >= t.execute) {
      t.dead = true;
    }
  }
  state.telegraphs = state.telegraphs.filter(t => !t.dead);
}

function executeTelegraph(state, t) {
  const hero = state.hero;
  if (t.fromMob && !hero.dead) {
    let hit = false;
    if (t.shape === 'circle') {
      if (vDist(hero.pos, t.origin) <= t.radius + hero.radius) hit = true;
    } else if (t.shape === 'cone') {
      if (circleCone(hero.pos, hero.radius, { origin: t.origin, facing: t.facing, halfAngle: t.halfAngle, radius: t.radius })) hit = true;
    } else if (t.shape === 'ring') {
      const d = vDist(hero.pos, t.origin);
      const ir = t.innerRadius || 0;
      if (d >= ir - hero.radius && d <= t.radius + hero.radius) hit = true;
    } else if (t.shape === 'line') {
      // Thick line: rectangle centered on a direction
      const dx = t.end.x - t.origin.x, dy = t.end.y - t.origin.y;
      const L = Math.hypot(dx, dy);
      const ex = dx / L, ey = dy / L;
      const px = hero.pos.x - t.origin.x, py = hero.pos.y - t.origin.y;
      const along = px * ex + py * ey;
      const perp = Math.abs(-py * ex + px * ey);
      if (along >= 0 && along <= L && perp <= (t.width / 2 + hero.radius)) hit = true;
    }
    if (hit) {
      damageHero(state, t.damage, t.sourceName || 'telegraph');
      if (t.stun) { hero.stunned = Math.max(hero.stunned, t.stun); }
      if (t.slow) {
        if (!hero.statuses) hero.statuses = [];
        hero.statuses.push({ type: 'slow', percent: t.slow.percent || 0.2, age: 0, ttl: t.slow.duration || 2 });
      }
    }
  }
  if (t.onExecute) t.onExecute(state);
}

export function updateFloaters(state, dt) {
  for (const f of state.floaters) {
    f.age += dt;
    f.pos.y += (f.vy || -1.0) * dt;
    if (f.age >= f.ttl) f.dead = true;
  }
  state.floaters = state.floaters.filter(f => !f.dead);
}

export function updateParticles(state, dt) {
  for (const p of state.particles) {
    p.age += dt;
    p.pos.x += p.vel.x * dt;
    p.pos.y += p.vel.y * dt;
    p.vel.x *= 0.93;
    p.vel.y *= 0.93;
  }
  state.particles = state.particles.filter(p => p.age < p.ttl);
}

export function updateSlashes(state, dt) {
  for (const s of state.slashes) s.age += dt;
  state.slashes = state.slashes.filter(s => s.age < s.ttl);
}

export function updateHealOrbs(state, dt) {
  const hero = state.hero;
  for (const o of state.healOrbs) {
    o.age += dt;
    if (o.age >= o.ttl) { o.dead = true; continue; }
    if (!hero.dead && !hero.respawning && vDist(o.pos, hero.pos) <= o.pickupRadius + hero.radius) {
      hero.hp = Math.min(hero.maxHp, hero.hp + o.heal);
      state.floaters.push({ pos: { x: hero.pos.x, y: hero.pos.y - 0.7 }, text: `+${o.heal}`, color: '#70ff70', age: 0, ttl: 0.8, vy: -1.2, size: 14 });
      o.dead = true;
    }
  }
  state.healOrbs = state.healOrbs.filter(o => !o.dead);
}

export function updateShakes(state, dt) {
  for (const s of state.shakes) s.age += dt;
  state.shakes = state.shakes.filter(s => s.age < s.ttl);
}

export function getShakeOffset(state) {
  let x = 0, y = 0;
  for (const s of state.shakes) {
    const t = 1 - s.age / s.ttl;
    const mag = s.mag * t;
    x += (Math.random() * 2 - 1) * mag;
    y += (Math.random() * 2 - 1) * mag;
  }
  return { x, y };
}
