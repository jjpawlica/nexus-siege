// renderer.js — canvas layer rendering

import { worldToScreen, PIXELS_PER_METER, clamp, TAU } from './util.js';
import { NEXUS_MAX_HP, PRESSURE_MAX, PRESSURE_RADIUS } from './world.js';
import { getShakeOffset } from './projectiles.js';
import { AURA_RADIUS } from './hero.js';

export function render(ctx, state, alpha) {
  const W = state.canvasW, H = state.canvasH;
  const shake = getShakeOffset(state);

  // 1. Background
  const realm = state.currentRealm;
  const bg = realm ? realm.bgColor : '#0a0a0a';
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // Offset for shake
  ctx.save();
  ctx.translate(shake.x * PIXELS_PER_METER, shake.y * PIXELS_PER_METER);

  // 2. Ground tint / grid
  drawGroundGrid(ctx, state);

  // 3. Hazards (ice patches, static items)
  drawHazards(ctx, state);

  // 4. World objects (safe zones, well, towers, Nexus, lane bounds, structures)
  drawLaneBounds(ctx, state);
  drawSafeZones(ctx, state);
  drawHealingWell(ctx, state);
  drawTowers(ctx, state);
  drawLaneStructures(ctx, state);
  drawNexus(ctx, state);
  drawPressureZone(ctx, state);

  // 5. Ground AoEs (telegraphs too) — under mobs
  drawGroundAoes(ctx, state);
  drawTelegraphs(ctx, state);

  // 6. Searing aura (hero passive)
  drawSearingAura(ctx, state);

  // 7. Event entities (rift / totem)
  drawEventEntities(ctx, state);

  // 8. Mobs (including bosses via state.boss or embedded in mobs)
  drawMobs(ctx, state);
  drawBoss(ctx, state);

  // 9. Hero
  drawHero(ctx, state);

  // 10. Projectiles
  drawProjectiles(ctx, state);

  // 11. Slashes (basic attacks + cleaves)
  drawSlashes(ctx, state);

  // 12. Heal orbs
  drawHealOrbs(ctx, state);

  // 13. Portal (arena entry)
  drawWarpPortal(ctx, state);

  // 14. Particles
  drawParticles(ctx, state);

  // 15. Floaters (damage numbers)
  drawFloaters(ctx, state);

  ctx.restore();

  // HUD overlay (unshaken)
  drawHUD(ctx, state);
}

function drawGroundGrid(ctx, state) {
  const step = PIXELS_PER_METER;
  ctx.strokeStyle = 'rgba(255,255,255,0.04)';
  ctx.lineWidth = 1;
  const offX = ((state.canvasW / 2 - state.camera.x * PIXELS_PER_METER) % step + step) % step;
  const offY = ((state.canvasH / 2 - state.camera.y * PIXELS_PER_METER) % step + step) % step;
  for (let x = offX; x < state.canvasW; x += step) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, state.canvasH); ctx.stroke();
  }
  for (let y = offY; y < state.canvasH; y += step) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(state.canvasW, y); ctx.stroke();
  }
}

function drawLaneBounds(ctx, state) {
  if (state.phase === 'arena') return;
  const lb = state.world.laneBounds;
  const p1 = worldToScreen(lb.minX, lb.minY, state.camera, state.canvasW, state.canvasH);
  const p2 = worldToScreen(lb.maxX, lb.maxY, state.camera, state.canvasW, state.canvasH);
  ctx.fillStyle = 'rgba(255,255,255,0.04)';
  ctx.fillRect(p1.x, p1.y, p2.x - p1.x, p2.y - p1.y);
  ctx.strokeStyle = 'rgba(255,255,255,0.15)';
  ctx.lineWidth = 1;
  ctx.strokeRect(p1.x, p1.y, p2.x - p1.x, p2.y - p1.y);
}

function drawHazards(ctx, state) {
  for (const h of state.hazards) {
    const p = worldToScreen(h.pos.x, h.pos.y, state.camera, state.canvasW, state.canvasH);
    const r = h.radius * PIXELS_PER_METER;
    if (h.type === 'icePatch') {
      ctx.fillStyle = 'rgba(160,224,255,0.25)';
      ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, TAU); ctx.fill();
      ctx.strokeStyle = 'rgba(160,224,255,0.6)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }
}

function drawSafeZones(ctx, state) {
  if (state.phase === 'arena') return;
  for (const sz of state.world.safeZones) {
    const p = worldToScreen(sz.pos.x, sz.pos.y, state.camera, state.canvasW, state.canvasH);
    const r = sz.radius * PIXELS_PER_METER;
    ctx.fillStyle = 'rgba(80,220,80,0.18)';
    ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(120,255,120,0.7)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = 'rgba(120,255,120,0.9)';
    ctx.font = 'bold 11px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('SAFE', p.x, p.y + 4);
    ctx.textAlign = 'start';
  }
}

function drawHealingWell(ctx, state) {
  if (state.phase === 'arena') return;
  const w = state.world.well;
  const p = worldToScreen(w.pos.x, w.pos.y, state.camera, state.canvasW, state.canvasH);
  const r = w.radius * PIXELS_PER_METER;
  if (w.state === 'ready') {
    ctx.fillStyle = 'rgba(40,120,255,0.22)';
    ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#80c0ff';
    ctx.lineWidth = 3;
    ctx.stroke();
    // Charge indicator
    const chargePct = w.chargeTimer / 10;
    ctx.strokeStyle = '#4090ff';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r * 0.7, -Math.PI / 2, -Math.PI / 2 + TAU * chargePct);
    ctx.stroke();
    ctx.fillStyle = '#c0e0ff';
    ctx.font = 'bold 11px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('HEAL WELL', p.x, p.y + 4);
    ctx.textAlign = 'start';
    // Rising dot
    const t = (performance.now() / 400) % 1;
    ctx.fillStyle = 'rgba(160,220,255,0.7)';
    ctx.beginPath();
    ctx.arc(p.x, p.y - t * r, 3, 0, TAU);
    ctx.fill();
  } else {
    ctx.fillStyle = 'rgba(40,60,80,0.2)';
    ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#406080';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = '#80a0c0';
    ctx.font = '12px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`${w.rechargeTimer.toFixed(0)}s`, p.x, p.y + 4);
    ctx.textAlign = 'start';
  }
}

function drawTowers(ctx, state) {
  if (state.phase === 'arena') return;
  for (const t of state.world.towers) {
    const p = worldToScreen(t.pos.x, t.pos.y, state.camera, state.canvasW, state.canvasH);
    const sz = t.radius * PIXELS_PER_METER * 1.5;
    if (t.destroyed) {
      ctx.fillStyle = '#3a2a2a';
      ctx.fillRect(p.x - sz / 2, p.y - sz / 2, sz, sz);
    } else {
      // range circle
      ctx.strokeStyle = 'rgba(255,220,80,0.1)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(p.x, p.y, t.range * PIXELS_PER_METER, 0, TAU); ctx.stroke();
      // body
      ctx.fillStyle = '#606070';
      ctx.fillRect(p.x - sz / 2, p.y - sz / 2, sz, sz);
      ctx.fillStyle = t.kind === 'outer' ? '#ffb040' : '#ff8040';
      ctx.fillRect(p.x - sz / 2 + 3, p.y - sz / 2 + 3, sz - 6, sz - 6);
      // HP bar
      const pct = t.hp / t.maxHp;
      ctx.fillStyle = '#222';
      ctx.fillRect(p.x - sz / 2, p.y + sz / 2 + 4, sz, 4);
      ctx.fillStyle = '#b0d040';
      ctx.fillRect(p.x - sz / 2, p.y + sz / 2 + 4, sz * pct, 4);
    }
  }
}

function drawLaneStructures(ctx, state) {
  if (state.phase === 'arena') return;
  for (const mob of state.mobs) {
    if (!mob.structure || mob.dead) continue;
    const p = worldToScreen(mob.pos.x, mob.pos.y, state.camera, state.canvasW, state.canvasH);
    const r = mob.radius * PIXELS_PER_METER;
    // Base platform
    ctx.fillStyle = '#1a1208';
    ctx.fillRect(p.x - r * 1.3, p.y - r * 1.3, r * 2.6, r * 2.6);
    // Structure body
    ctx.fillStyle = mob.color;
    ctx.fillRect(p.x - r, p.y - r, r * 2, r * 2);
    // Accent core
    ctx.fillStyle = mob.accent;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y - r * 0.7);
    ctx.lineTo(p.x + r * 0.7, p.y);
    ctx.lineTo(p.x, p.y + r * 0.7);
    ctx.lineTo(p.x - r * 0.7, p.y);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = mob.accent;
    ctx.lineWidth = 2;
    ctx.strokeRect(p.x - r, p.y - r, r * 2, r * 2);
    // HP bar
    const barW = r * 2.6, barH = 5;
    ctx.fillStyle = '#222';
    ctx.fillRect(p.x - barW / 2, p.y - r - 16, barW, barH);
    ctx.fillStyle = mob.accent;
    ctx.fillRect(p.x - barW / 2, p.y - r - 16, barW * clamp(mob.hp / mob.maxHp, 0, 1), barH);
    // Label
    const label = mob.structureKind === 't1' ? 'OUTPOST (T1)' : 'FORWARD BASE (T2)';
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 10px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(label, p.x, p.y - r - 22);
    ctx.textAlign = 'start';
  }
}

function drawNexus(ctx, state) {
  if (state.phase === 'arena') return;
  const n = state.world.nexus;
  const p = worldToScreen(n.pos.x, n.pos.y, state.camera, state.canvasW, state.canvasH);
  const r = n.radius * PIXELS_PER_METER;
  const pulse = Math.sin(performance.now() / 300) * 0.1 + 1;
  const accent = state.currentRealm ? state.currentRealm.accentColor : '#ff7a1a';
  // outer glow
  ctx.fillStyle = hexAlpha(accent, 0.2);
  drawHex(ctx, p.x, p.y, r * 1.5 * pulse);
  ctx.fillStyle = accent;
  drawHex(ctx, p.x, p.y, r);
  ctx.fillStyle = '#fff8e0';
  drawHex(ctx, p.x, p.y, r * 0.4);
}

function drawPressureZone(ctx, state) {
  if (state.phase === 'arena') return;
  const n = state.world.nexus;
  const p = worldToScreen(n.pos.x, n.pos.y, state.camera, state.canvasW, state.canvasH);
  const r = PRESSURE_RADIUS * PIXELS_PER_METER;
  const pct = state.world.pressure / PRESSURE_MAX;
  ctx.strokeStyle = `rgba(255, ${Math.round(255 - pct * 180)}, ${Math.round(120 - pct * 120)}, ${0.35 + pct * 0.5})`;
  ctx.lineWidth = 2 + pct * 3;
  ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, TAU); ctx.stroke();
}

function drawHex(ctx, cx, cy, r) {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU - Math.PI / 2;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
}

function drawSearingAura(ctx, state) {
  const hero = state.hero;
  if (hero.dead) return;
  const p = worldToScreen(hero.pos.x, hero.pos.y, state.camera, state.canvasW, state.canvasH);
  const r = AURA_RADIUS * hero.mods.auraRadiusMult * PIXELS_PER_METER;
  ctx.fillStyle = 'rgba(255,100,40,0.06)';
  ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, TAU); ctx.fill();
  ctx.strokeStyle = 'rgba(255,130,50,0.25)';
  ctx.lineWidth = 1;
  ctx.stroke();
}

function drawHero(ctx, state) {
  const hero = state.hero;
  const p = worldToScreen(hero.pos.x, hero.pos.y, state.camera, state.canvasW, state.canvasH);
  const r = hero.radius * PIXELS_PER_METER;

  // Respawning: show dimmed corpse at death position
  if (hero.respawning) {
    ctx.fillStyle = 'rgba(80,30,30,0.8)';
    ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(255,100,100,0.4)';
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
    return;
  }

  // dodge trail
  if (hero.dodgeActive) {
    ctx.fillStyle = 'rgba(255,200,80,0.35)';
    ctx.beginPath(); ctx.arc(p.x, p.y, r * 1.5, 0, TAU); ctx.fill();
  }

  // i-frames glow
  if (hero.iFrames > 0) {
    ctx.strokeStyle = '#ffe060';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(p.x, p.y, r + 3, 0, TAU); ctx.stroke();
  }

  // body
  ctx.fillStyle = hero.downed ? '#606060' : (hero.hp < hero.maxHp * 0.25 ? '#c03010' : '#ff4a0a');
  ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, TAU); ctx.fill();

  // facing tick
  ctx.strokeStyle = '#ffe0a0';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(p.x, p.y);
  ctx.lineTo(p.x + Math.cos(hero.facing) * r * 1.6, p.y + Math.sin(hero.facing) * r * 1.6);
  ctx.stroke();

  // Stunned indicator
  if (hero.stunned > 0) {
    ctx.fillStyle = '#ffdc3a';
    ctx.font = 'bold 20px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('★', p.x, p.y - r - 10);
    ctx.textAlign = 'start';
  }

  // Downed timer
  if (hero.downed) {
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 18px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(Math.ceil(hero.downedTimer) + 's', p.x, p.y - 30);
    ctx.textAlign = 'start';
  }
}

function drawMobs(ctx, state) {
  for (const mob of state.mobs) {
    if (mob === state.miniboss) continue; // drawn below
    if (mob.structure) continue;           // drawn separately
    if (mob.eventEntity) continue;         // drawn separately
    const p = worldToScreen(mob.pos.x, mob.pos.y, state.camera, state.canvasW, state.canvasH);
    const r = mob.radius * PIXELS_PER_METER;
    // body
    ctx.fillStyle = mob.color;
    ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, TAU); ctx.fill();
    // accent core
    ctx.fillStyle = mob.accent;
    ctx.beginPath(); ctx.arc(p.x, p.y, r * 0.4, 0, TAU); ctx.fill();
    // facing tick
    ctx.strokeStyle = mob.accent;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(p.x + Math.cos(mob.facing) * r * 1.3, p.y + Math.sin(mob.facing) * r * 1.3);
    ctx.stroke();

    // HP bar for elites + casters
    if (mob.def && (mob.def.role === 'elite' || mob.hp < mob.maxHp)) {
      const barW = r * 2.2, barH = 3;
      ctx.fillStyle = '#222';
      ctx.fillRect(p.x - barW / 2, p.y - r - 8, barW, barH);
      ctx.fillStyle = '#c02020';
      ctx.fillRect(p.x - barW / 2, p.y - r - 8, barW * clamp(mob.hp / mob.maxHp, 0, 1), barH);
    }
    // status icons
    drawMobStatusIcons(ctx, mob, p, r);
  }

  // Miniboss
  if (state.miniboss && !state.miniboss.dead) {
    drawBossEntity(ctx, state.miniboss, state);
  }
}

function drawBoss(ctx, state) {
  if (state.boss && !state.boss.dead) {
    drawBossEntity(ctx, state.boss, state);
  }
}

function drawBossEntity(ctx, boss, state) {
  const p = worldToScreen(boss.pos.x, boss.pos.y, state.camera, state.canvasW, state.canvasH);
  const r = boss.radius * PIXELS_PER_METER;
  // halo
  const pulse = 1 + Math.sin(performance.now() / 250) * 0.08;
  ctx.fillStyle = hexAlpha(boss.accent, 0.18);
  ctx.beginPath(); ctx.arc(p.x, p.y, r * 1.4 * pulse, 0, TAU); ctx.fill();
  // body
  ctx.fillStyle = boss.color;
  ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, TAU); ctx.fill();
  ctx.fillStyle = boss.accent;
  ctx.beginPath(); ctx.arc(p.x, p.y, r * 0.55, 0, TAU); ctx.fill();
  // facing
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(p.x, p.y);
  ctx.lineTo(p.x + Math.cos(boss.facing) * r * 1.4, p.y + Math.sin(boss.facing) * r * 1.4);
  ctx.stroke();
  // name + HP bar + timeout countdown above miniboss (realm bosses use top bar)
  if (boss.bossKind === 'miniboss') {
    const barW = r * 3.2, barH = 6;
    const barY = p.y - r - 26;
    const remaining = Math.max(0, (boss.timeoutAt || 0) - state.runTime);
    const mm = String(Math.floor(remaining / 60)).padStart(2, '0');
    const ss = String(Math.floor(remaining % 60)).padStart(2, '0');
    const timerColor = remaining < 60 ? '#ff4040' : remaining < 120 ? '#ffaa20' : '#fff';
    ctx.fillStyle = '#000a';
    ctx.fillRect(p.x - barW / 2 - 3, barY - 24, barW + 6, 38);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 11px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(boss.name, p.x, barY - 14);
    ctx.fillStyle = timerColor;
    ctx.font = 'bold 12px monospace';
    ctx.fillText(`${mm}:${ss}`, p.x, barY - 2);
    ctx.textAlign = 'start';
    ctx.fillStyle = '#222';
    ctx.fillRect(p.x - barW / 2, barY, barW, barH);
    ctx.fillStyle = boss.accent;
    ctx.fillRect(p.x - barW / 2, barY, barW * clamp(boss.hp / boss.maxHp, 0, 1), barH);
  }
}

function drawMobStatusIcons(ctx, mob, p, r) {
  if (!mob.statuses || mob.statuses.length === 0) return;
  let x = p.x - r;
  const y = p.y - r - 16;
  for (const s of mob.statuses) {
    let icon = '', col = '#fff';
    if (s.type === 'burn') { icon = '🔥'; col = '#ff7a30'; }
    else if (s.type === 'stun') { icon = '★'; col = '#ffdc3a'; }
    else if (s.type === 'knockup') { icon = '↑'; col = '#ffdc3a'; }
    else if (s.type === 'slow') { icon = '❄'; col = '#a0e0ff'; }
    else continue;
    ctx.fillStyle = col;
    ctx.font = 'bold 11px sans-serif';
    ctx.fillText(icon, x, y);
    x += 11;
  }
}

function drawProjectiles(ctx, state) {
  for (const p of state.projectiles) {
    const sp = worldToScreen(p.pos.x, p.pos.y, state.camera, state.canvasW, state.canvasH);
    const r = p.radius * PIXELS_PER_METER;
    ctx.fillStyle = p.color || (p.source === 'hero' ? '#ff9030' : '#b0c0ff');
    ctx.beginPath(); ctx.arc(sp.x, sp.y, r, 0, TAU); ctx.fill();
    // small motion trail
    if (p.type === 'shockwave') {
      ctx.strokeStyle = p.color;
      ctx.lineWidth = 2;
      const back = Math.atan2(p.vel.y, p.vel.x) + Math.PI;
      ctx.beginPath();
      ctx.moveTo(sp.x + Math.cos(back) * r * 2, sp.y + Math.sin(back) * r * 2);
      ctx.lineTo(sp.x, sp.y);
      ctx.stroke();
    }
  }
}

function drawTelegraphs(ctx, state) {
  for (const t of state.telegraphs) {
    const color = t.color || '#ff5030';
    let alpha = 0.4;
    if (t.phase === 'commit') alpha = 0.7;
    if (t.phase === 'execute') alpha = 1.0;
    if (t.shape === 'circle') {
      const p = worldToScreen(t.origin.x, t.origin.y, state.camera, state.canvasW, state.canvasH);
      const r = t.radius * PIXELS_PER_METER;
      ctx.fillStyle = hexAlpha(color, alpha * 0.3);
      ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, TAU); ctx.fill();
      ctx.strokeStyle = hexAlpha(color, alpha);
      ctx.lineWidth = 2 + (t.phase === 'commit' ? 1 : 0);
      ctx.stroke();
    } else if (t.shape === 'ring') {
      const p = worldToScreen(t.origin.x, t.origin.y, state.camera, state.canvasW, state.canvasH);
      const r = t.radius * PIXELS_PER_METER;
      const ir = (t.innerRadius || 0) * PIXELS_PER_METER;
      ctx.strokeStyle = hexAlpha(color, alpha);
      ctx.lineWidth = (r - ir);
      ctx.beginPath(); ctx.arc(p.x, p.y, (r + ir) / 2, 0, TAU); ctx.stroke();
    } else if (t.shape === 'cone') {
      const p = worldToScreen(t.origin.x, t.origin.y, state.camera, state.canvasW, state.canvasH);
      const r = t.radius * PIXELS_PER_METER;
      ctx.fillStyle = hexAlpha(color, alpha * 0.3);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.arc(p.x, p.y, r, t.facing - t.halfAngle, t.facing + t.halfAngle);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = hexAlpha(color, alpha);
      ctx.lineWidth = 2;
      ctx.stroke();
    } else if (t.shape === 'line') {
      const p1 = worldToScreen(t.origin.x, t.origin.y, state.camera, state.canvasW, state.canvasH);
      const p2 = worldToScreen(t.end.x, t.end.y, state.camera, state.canvasW, state.canvasH);
      ctx.strokeStyle = hexAlpha(color, alpha);
      ctx.lineWidth = (t.width || 1) * PIXELS_PER_METER;
      ctx.lineCap = 'butt';
      ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();
    }
  }
}

function drawGroundAoes(ctx, state) {
  for (const a of state.groundAoes) {
    const p = worldToScreen(a.pos.x, a.pos.y, state.camera, state.canvasW, state.canvasH);
    const r = a.radius * PIXELS_PER_METER;
    const alpha = 0.45;
    ctx.fillStyle = hexAlpha(a.color, alpha * 0.5);
    ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, TAU); ctx.fill();
    ctx.strokeStyle = hexAlpha(a.color, alpha);
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Moving AoE (blizzard)
    if (a.moving && a.vel) {
      a.pos.x += a.vel.x * 0;  // moved via sim, but ensure we don't double-move
    }
    if (a.warming) {
      // yellow rune
      ctx.strokeStyle = '#ffdc3a';
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a1 = (i / 6) * TAU;
        const a2 = ((i + 1) / 6) * TAU;
        ctx.moveTo(p.x + Math.cos(a1) * r * 0.5, p.y + Math.sin(a1) * r * 0.5);
        ctx.lineTo(p.x + Math.cos(a2) * r * 0.5, p.y + Math.sin(a2) * r * 0.5);
      }
      ctx.stroke();
    }
  }
}

function drawSlashes(ctx, state) {
  for (const s of state.slashes) {
    const t = 1 - (s.age / s.ttl);
    const p = worldToScreen(s.origin.x, s.origin.y, state.camera, state.canvasW, state.canvasH);
    const r = s.radius * PIXELS_PER_METER;
    ctx.fillStyle = hexAlpha(s.color, 0.3 * t);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.arc(p.x, p.y, r, s.facing - s.halfAngle, s.facing + s.halfAngle);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = hexAlpha(s.color, t);
    ctx.lineWidth = 3;
    ctx.stroke();
  }
}

function drawEventEntities(ctx, state) {
  if (state.events.active) {
    const ev = state.events.active;
    if (ev.type === 'emberRift' && ev.rift && !ev.rift.dead) {
      drawRift(ctx, state, ev.rift);
    } else if (ev.type === 'frostboundTotem' && ev.totem && !ev.totem.dead) {
      drawTotem(ctx, state, ev.totem);
    }
  }
}

function drawRift(ctx, state, rift) {
  const p = worldToScreen(rift.pos.x, rift.pos.y, state.camera, state.canvasW, state.canvasH);
  const r = rift.radius * PIXELS_PER_METER;
  const pulse = 1 + Math.sin(performance.now() / 150) * 0.3;
  // Swirl
  ctx.fillStyle = 'rgba(120,20,20,0.5)';
  ctx.beginPath(); ctx.arc(p.x, p.y, r * 2 * pulse, 0, TAU); ctx.fill();
  ctx.fillStyle = '#ff4030';
  ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, TAU); ctx.fill();
  ctx.fillStyle = '#601010';
  ctx.beginPath(); ctx.arc(p.x, p.y, r * 0.5 * pulse, 0, TAU); ctx.fill();
  // HP bar
  drawBarAbove(ctx, p, rift.hp / rift.maxHp, '#ff4030', r);
  // Timer
  const remaining = Math.max(0, rift.ttl - rift.age);
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 12px monospace';
  ctx.textAlign = 'center';
  ctx.fillText(`${remaining.toFixed(0)}s`, p.x, p.y - r - 16);
  ctx.textAlign = 'start';
}

function drawTotem(ctx, state, totem) {
  const p = worldToScreen(totem.pos.x, totem.pos.y, state.camera, state.canvasW, state.canvasH);
  const r = totem.radius * PIXELS_PER_METER;
  const pulse = 1 + Math.sin(performance.now() / 200) * 0.2;
  // beam pointing up
  ctx.strokeStyle = 'rgba(160,224,255,0.4)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(p.x, p.y);
  ctx.lineTo(p.x, p.y - 300);
  ctx.stroke();
  // body
  ctx.fillStyle = '#a0e0ff';
  ctx.fillRect(p.x - r * 0.5, p.y - r, r, r * 2);
  ctx.fillStyle = '#e0f8ff';
  ctx.fillRect(p.x - r * 0.3, p.y - r * 0.7, r * 0.6, r * 1.4);
  // HP bar
  drawBarAbove(ctx, p, totem.hp / totem.maxHp, '#a0e0ff', r);
  // Timer
  const remaining = Math.max(0, totem.ttl - totem.age);
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 12px monospace';
  ctx.textAlign = 'center';
  ctx.fillText(`${remaining.toFixed(0)}s`, p.x, p.y - r - 16);
  ctx.textAlign = 'start';
}

function drawBarAbove(ctx, p, pct, color, r) {
  const barW = r * 2.5, barH = 4;
  ctx.fillStyle = '#222';
  ctx.fillRect(p.x - barW / 2, p.y - r - 10, barW, barH);
  ctx.fillStyle = color;
  ctx.fillRect(p.x - barW / 2, p.y - r - 10, barW * clamp(pct, 0, 1), barH);
}

function drawHealOrbs(ctx, state) {
  for (const o of state.healOrbs) {
    const p = worldToScreen(o.pos.x, o.pos.y, state.camera, state.canvasW, state.canvasH);
    const r = o.radius * PIXELS_PER_METER * (1 + Math.sin(performance.now() / 200 + o.id) * 0.15);
    ctx.fillStyle = 'rgba(100,255,130,0.7)';
    ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#c0ffc0';
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}

function drawWarpPortal(ctx, state) {
  if (!state.warpPortal) return;
  const p = worldToScreen(state.warpPortal.pos.x, state.warpPortal.pos.y, state.camera, state.canvasW, state.canvasH);
  const r = state.warpPortal.radius * PIXELS_PER_METER;
  const pulse = 1 + Math.sin(performance.now() / 180) * 0.4;
  ctx.fillStyle = 'rgba(255,200,60,0.35)';
  ctx.beginPath(); ctx.arc(p.x, p.y, r * 1.6 * pulse, 0, TAU); ctx.fill();
  ctx.fillStyle = 'rgba(255,140,40,0.6)';
  ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, TAU); ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 14px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('ENTER', p.x, p.y + 5);
  ctx.textAlign = 'start';
}

function drawParticles(ctx, state) {
  for (const p of state.particles) {
    const sp = worldToScreen(p.pos.x, p.pos.y, state.camera, state.canvasW, state.canvasH);
    const a = 1 - p.age / p.ttl;
    ctx.fillStyle = hexAlpha(p.color, a);
    ctx.fillRect(sp.x - p.size / 2, sp.y - p.size / 2, p.size, p.size);
  }
}

function drawFloaters(ctx, state) {
  for (const f of state.floaters) {
    const sp = worldToScreen(f.pos.x, f.pos.y, state.camera, state.canvasW, state.canvasH);
    const a = 1 - f.age / f.ttl;
    ctx.fillStyle = hexAlpha(f.color, a);
    ctx.font = `bold ${f.size || 14}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(f.text, sp.x, sp.y);
    ctx.textAlign = 'start';
  }
}

// HUD —
function drawHUD(ctx, state) {
  const W = state.canvasW, H = state.canvasH;
  const hero = state.hero;

  // Top-left realm label
  if (state.currentRealm) {
    ctx.fillStyle = '#c0c0c0';
    ctx.font = '14px monospace';
    ctx.fillText(state.currentRealm.name, 14, 22);
  }
  // Timer
  const t = state.runTime;
  const mm = String(Math.floor(t / 60)).padStart(2, '0');
  const ss = String(Math.floor(t % 60)).padStart(2, '0');
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 18px monospace';
  const timeText = `${mm}:${ss}`;
  const tw = ctx.measureText(timeText).width;
  ctx.fillText(timeText, W - tw - 14, 24);

  // Top-center: Nexus HP or Boss HP
  if (state.phase === 'arena' && state.boss) {
    const b = state.boss;
    const enrageIn = Math.max(0, (b.enrageAt || 0) - state.runTime);
    const mm = String(Math.floor(enrageIn / 60)).padStart(2, '0');
    const ss = String(Math.floor(enrageIn % 60)).padStart(2, '0');
    const subtext = b.enraged
      ? `Phase ${b.phaseIndex + 1}  ·  ENRAGED`
      : `Phase ${b.phaseIndex + 1}  ·  Enrage in ${mm}:${ss}`;
    drawTopBar(ctx, state, b.name, b.hp, b.maxHp, b.enraged ? '#ff2020' : '#ff4040', subtext);
  } else if (state.phase === 'lane') {
    drawNexusTopBar(ctx, state);
  }

  // Hero HP
  drawHeroHUD(ctx, state);
  // Banners
  drawBanners(ctx, state);
  // Talent pending badge
  drawTalentBadge(ctx, state);
  // Talent modal
  if (state.ui.modalOpen) drawTalentModal(ctx, state);
  // Pause menu
  if (state.ui.pauseMenu) drawPauseMenu(ctx, state);
  // Vendor / warp panel
  if (state.ui.vendorOpen) drawVendor(ctx, state);
  // Results screen
  if (state.phase === 'results' || state.runFailed) drawResults(ctx, state);
  // Event status mini-indicator
  drawEventIndicator(ctx, state);
  // Nexus shop prompt
  drawNexusShopPrompt(ctx, state);
  // Respawn overlay
  drawRespawnOverlay(ctx, state);
  // Debug
  if (state.ui.debug) drawDebug(ctx, state);
}

function drawNexusTopBar(ctx, state) {
  const W = state.canvasW;
  const n = state.world.nexus;
  const barW = 400, barH = 20;
  const x = (W - barW) / 2, y = 20;
  ctx.fillStyle = '#000a';
  ctx.fillRect(x - 8, y - 4, barW + 16, barH + 28);
  // Nexus HP
  ctx.fillStyle = '#222';
  ctx.fillRect(x, y, barW, barH);
  ctx.fillStyle = '#c02020';
  ctx.fillRect(x, y, barW * clamp(n.hp / n.maxHp, 0, 1), barH);
  ctx.strokeStyle = '#c0a060';
  ctx.lineWidth = 2;
  ctx.strokeRect(x, y, barW, barH);
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 13px monospace';
  ctx.textAlign = 'center';
  ctx.fillText(`NEXUS  ${Math.ceil(n.hp)}/${n.maxHp}`, x + barW / 2, y + 14);
  ctx.textAlign = 'start';
  // Pressure
  const py = y + barH + 2;
  const pct = state.world.pressure / PRESSURE_MAX;
  ctx.fillStyle = '#222';
  ctx.fillRect(x, py, barW, 6);
  ctx.fillStyle = `rgb(${Math.round(180 + pct * 75)}, ${Math.round(100 - pct * 80)}, 40)`;
  ctx.fillRect(x, py, barW * pct, 6);
}

function drawTopBar(ctx, state, name, hp, maxHp, color, subtext) {
  const W = state.canvasW;
  const barW = 500, barH = 22;
  const x = (W - barW) / 2, y = 20;
  ctx.fillStyle = '#000a';
  ctx.fillRect(x - 8, y - 4, barW + 16, barH + 30);
  ctx.fillStyle = '#222';
  ctx.fillRect(x, y, barW, barH);
  ctx.fillStyle = color;
  ctx.fillRect(x, y, barW * clamp(hp / maxHp, 0, 1), barH);
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2;
  ctx.strokeRect(x, y, barW, barH);
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 14px monospace';
  ctx.textAlign = 'center';
  ctx.fillText(`${name}  ${Math.ceil(hp)}/${maxHp}`, x + barW / 2, y + 15);
  if (subtext) {
    ctx.font = '11px monospace';
    ctx.fillText(subtext, x + barW / 2, y + barH + 14);
  }
  ctx.textAlign = 'start';
}

function drawHeroHUD(ctx, state) {
  const hero = state.hero;
  const W = state.canvasW, H = state.canvasH;
  // HP bar (bottom-left cluster)
  const x0 = 20, y0 = H - 80;
  const hpW = 300, hpH = 16;
  ctx.fillStyle = '#000a';
  ctx.fillRect(x0 - 6, y0 - 24, hpW + 12, 100);
  ctx.fillStyle = '#222';
  ctx.fillRect(x0, y0, hpW, hpH);
  ctx.fillStyle = hero.downed ? '#606060' : (hero.hp < hero.maxHp * 0.25 ? '#ff2020' : '#c02020');
  ctx.fillRect(x0, y0, hpW * clamp(hero.hp / hero.maxHp, 0, 1), hpH);
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(x0, y0, hpW, hpH);
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 12px monospace';
  ctx.fillText(`HP ${Math.ceil(hero.hp)}/${hero.maxHp}`, x0 + 4, y0 + 12);

  // Level + XP
  const xpW = 300, xpH = 8;
  const xpY = y0 + hpH + 4;
  import('./talents.js').then(() => {}); // no-op to ensure module is loaded; use xpForLevel below
  const xpNeeded = xpForLevelStatic(hero.level);
  const xpPrev = xpForLevelStatic(hero.level - 1);
  const pct = hero.level >= 10 ? 1 : (hero.xp - xpPrev) / (xpNeeded - xpPrev);
  ctx.fillStyle = '#222';
  ctx.fillRect(x0 + 28, xpY, xpW - 28, xpH);
  ctx.fillStyle = '#ffcc20';
  ctx.fillRect(x0 + 28, xpY, (xpW - 28) * clamp(pct, 0, 1), xpH);
  // Level circle
  ctx.fillStyle = '#202020';
  ctx.beginPath(); ctx.arc(x0 + 14, xpY + 4, 12, 0, TAU); ctx.fill();
  ctx.strokeStyle = '#ffcc20';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 12px monospace';
  ctx.textAlign = 'center';
  ctx.fillText(`${hero.level}`, x0 + 14, xpY + 8);
  ctx.textAlign = 'start';

  // Ability row — Q / E / R / F (ultimate)
  const abW = 48, abGap = 6;
  const abY = y0 + hpH + 22;
  drawAbilitySlot(ctx, hero, 'Q', x0, abY, abW, abH(), hero.abilityCharges.Q, 2 + hero.mods.dashExtraCharges);
  drawAbilitySlot(ctx, hero, 'E', x0 + (abW + abGap), abY, abW, abH(), null, null);
  drawAbilitySlot(ctx, hero, 'R', x0 + (abW + abGap) * 2, abY, abW, abH(), null, null);
  drawAbilitySlot(ctx, hero, 'F', x0 + (abW + abGap) * 3, abY, abW, abH(), null, null, true);
  // Dodge
  const dx = x0 + (abW + abGap) * 4 + 10;
  ctx.fillStyle = '#222';
  ctx.fillRect(dx, abY, abW, abH());
  ctx.strokeStyle = '#80c0ff';
  ctx.lineWidth = 2;
  ctx.strokeRect(dx, abY, abW, abH());
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 12px monospace';
  ctx.textAlign = 'center';
  ctx.fillText(`⎵`, dx + abW / 2, abY + 18);
  // Charge pips
  for (let i = 0; i < 2; i++) {
    ctx.fillStyle = i < hero.dodgeCharges ? '#80c0ff' : '#405070';
    ctx.beginPath();
    ctx.arc(dx + 10 + i * 14, abY + abH() - 10, 4, 0, TAU);
    ctx.fill();
  }
  ctx.textAlign = 'start';

  // Combo Flow meter
  const cfX = dx + abW + 20;
  const cfW = 14, cfH = abH();
  ctx.fillStyle = '#222';
  ctx.fillRect(cfX, abY, cfW, cfH);
  const flowPct = hero.comboFlow / hero.mods.comboFlowOverflowMax;
  const maxPct = 100 / hero.mods.comboFlowOverflowMax;
  ctx.fillStyle = flowPct >= maxPct ? '#ffc040' : '#d07020';
  ctx.fillRect(cfX, abY + cfH - cfH * flowPct, cfW, cfH * flowPct);
  ctx.strokeStyle = hero.comboFlowQueued ? '#ffffff' : '#ff8040';
  ctx.lineWidth = 2;
  ctx.strokeRect(cfX, abY, cfW, cfH);
  // "100" marker line
  const markerY = abY + cfH - cfH * maxPct;
  ctx.strokeStyle = '#ffff80';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cfX - 3, markerY);
  ctx.lineTo(cfX + cfW + 3, markerY);
  ctx.stroke();

  // Consumables — Z / X / C / V slots
  const cbX = cfX + cfW + 20;
  const consKeys = ['Z', 'X', 'C', 'V'];
  for (let i = 0; i < 4; i++) {
    const sx = cbX + i * (abW + abGap);
    ctx.fillStyle = '#222';
    ctx.fillRect(sx, abY, abW, abH());
    ctx.strokeStyle = '#80a0b0';
    ctx.lineWidth = 1;
    ctx.strokeRect(sx, abY, abW, abH());
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 11px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(consKeys[i], sx + abW / 2, abY + 12);
    if (i === 0) {
      ctx.fillText('Potion', sx + abW / 2, abY + 26);
      ctx.fillStyle = hero.potions > 0 ? '#70ff70' : '#706060';
      ctx.fillText(`×${hero.potions}`, sx + abW / 2, abY + 42);
      if (hero.potionCD > 0) {
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.fillRect(sx, abY, abW, abH() * (hero.potionCD / 8));
      }
    } else {
      ctx.fillStyle = '#555';
      ctx.fillText('—', sx + abW / 2, abY + 34);
    }
    ctx.textAlign = 'start';
  }

  // Buff strip
  let bx = x0;
  const by = y0 - 20;
  ctx.fillStyle = '#70ff70';
  ctx.font = 'bold 11px monospace';
  for (const b of hero.buffs) {
    const txt = b.name || 'Buff';
    ctx.fillText(txt, bx, by);
    bx += ctx.measureText(txt).width + 12;
  }

  // Aether
  ctx.fillStyle = '#ffcc80';
  ctx.font = 'bold 12px monospace';
  ctx.fillText(`Aether: ${state.aether}`, state.canvasW - 150, state.canvasH - 20);
}

function abH() { return 48; }

function drawAbilitySlot(ctx, hero, key, x, y, w, h, charges, maxCharges, isUlt = false) {
  ctx.fillStyle = '#222';
  ctx.fillRect(x, y, w, h);
  const cd = hero.abilityCDs[key];
  if ((charges != null && charges <= 0) || cd > 0) {
    ctx.fillStyle = '#444';
    ctx.fillRect(x, y, w, h);
  }
  ctx.strokeStyle = isUlt ? '#ffcc40' : '#ff9030';
  ctx.lineWidth = isUlt ? 3 : 2;
  ctx.strokeRect(x, y, w, h);
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 14px monospace';
  ctx.textAlign = 'center';
  ctx.fillText(key, x + w / 2, y + 18);
  if (cd > 0) {
    ctx.font = 'bold 11px monospace';
    ctx.fillText(cd.toFixed(1), x + w / 2, y + 34);
  } else if (charges != null) {
    ctx.font = 'bold 11px monospace';
    ctx.fillText(`${charges}/${maxCharges}`, x + w / 2, y + 34);
  }
  ctx.textAlign = 'start';
}

function drawBanners(ctx, state) {
  const W = state.canvasW;
  let y = 80;
  for (const b of state.banners) {
    if (b.age > b.ttl) continue;
    const fadeIn = Math.min(1, b.age / 0.2);
    const fadeOut = Math.min(1, (b.ttl - b.age) / 0.3);
    const a = Math.min(fadeIn, fadeOut);
    ctx.fillStyle = `rgba(0,0,0,${0.5 * a})`;
    const bw = b.big ? 520 : 380;
    const bh = b.big ? 46 : 30;
    ctx.fillRect(W / 2 - bw / 2, y, bw, bh);
    ctx.strokeStyle = b.bordered === 'red' ? `rgba(255,80,80,${a})` : b.bordered === 'yellow' ? `rgba(255,200,40,${a})` : `rgba(255,255,255,${0.3 * a})`;
    ctx.lineWidth = 2;
    ctx.strokeRect(W / 2 - bw / 2, y, bw, bh);
    ctx.fillStyle = hexAlpha(b.color, a);
    ctx.font = `bold ${b.big ? 20 : 14}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(b.text, W / 2, y + (b.big ? 30 : 20));
    ctx.textAlign = 'start';
    y += bh + 8;
  }
}

function drawTalentBadge(ctx, state) {
  if (state.ui.pendingPickCount <= 0) return;
  const x = state.canvasW - 70, y = state.canvasH - 170;
  const blink = (Math.sin(performance.now() / 200) + 1) / 2;
  ctx.fillStyle = `rgba(255, ${Math.round(200 * blink + 50)}, 40, 0.95)`;
  ctx.beginPath(); ctx.arc(x, y, 18, 0, TAU); ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 20px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('!', x, y + 7);
  ctx.font = '10px monospace';
  ctx.fillText('TAB', x, y + 34);
  ctx.fillText(`(${state.ui.pendingPickCount})`, x, y + 46);
  ctx.textAlign = 'start';
}

function drawTalentModal(ctx, state) {
  const W = state.canvasW, H = state.canvasH;
  ctx.fillStyle = 'rgba(0,0,0,0.72)';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 22px sans-serif';
  ctx.textAlign = 'center';
  const title = state.hero.level >= 10 ? 'AWAKENING' : `LEVEL ${state.hero.level}`;
  ctx.fillText(`${title} — CHOOSE A TALENT`, W / 2, 90);
  ctx.textAlign = 'start';

  const cards = state.ui.pickPool || [];
  const cardW = 240, cardH = 260, gap = 24;
  const totalW = cards.length * cardW + (cards.length - 1) * gap;
  const sx = (W - totalW) / 2;
  const sy = (H - cardH) / 2;
  for (let i = 0; i < cards.length; i++) {
    const c = cards[i];
    const cx = sx + i * (cardW + gap);
    ctx.fillStyle = '#1a1a22';
    ctx.fillRect(cx, sy, cardW, cardH);
    ctx.strokeStyle = c.color;
    ctx.lineWidth = 3;
    ctx.strokeRect(cx, sy, cardW, cardH);
    // Tier icon
    ctx.fillStyle = c.color;
    ctx.fillRect(cx + cardW / 2 - 30, sy + 28, 60, 60);
    // Name
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 18px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(c.name, cx + cardW / 2, sy + 120);
    // Tier label
    ctx.fillStyle = c.color;
    ctx.font = '12px monospace';
    ctx.fillText(c.tier.toUpperCase(), cx + cardW / 2, sy + 140);
    // Description
    ctx.fillStyle = '#cfcfd8';
    ctx.font = '13px sans-serif';
    wrapText(ctx, c.desc, cx + cardW / 2, sy + 170, cardW - 32, 18);
    // Hotkey
    ctx.fillStyle = '#ffcc40';
    ctx.font = 'bold 14px monospace';
    ctx.fillText(`[${i + 1}]`, cx + cardW / 2, sy + cardH - 18);
    ctx.textAlign = 'start';
  }
  ctx.fillStyle = '#a0a0b0';
  ctx.font = '12px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('Tab: close (stays pending) · 1/2/3: pick · click a card to pick', W / 2, H - 40);
  ctx.textAlign = 'start';
}

function drawPauseMenu(ctx, state) {
  const W = state.canvasW, H = state.canvasH;
  ctx.fillStyle = 'rgba(0,0,0,0.8)';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 36px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('PAUSED', W / 2, H / 2 - 40);
  ctx.font = '16px sans-serif';
  ctx.fillText('ESC: Resume    F5: Restart Run    ` (backtick): Debug overlay', W / 2, H / 2 + 10);
  ctx.font = '14px sans-serif';
  ctx.fillText('WASD move · LMB 3-hit combo · RMB empower next cast · Space dodge (×2)', W / 2, H / 2 + 40);
  ctx.fillText('Q Flame Dash · E Cinder Cleave · R Blazing Uppercut · F Phoenix Rend (ult)', W / 2, H / 2 + 60);
  ctx.fillText('Z potion · X/C/V reserved · Tab talents · B shop at Nexus (when near)', W / 2, H / 2 + 80);
  ctx.fillStyle = '#ffcc80';
  ctx.fillText('Destroy T1 Outpost → miniboss faster · Destroy T2 Forward Base → realm boss faster', W / 2, H / 2 + 110);
  ctx.textAlign = 'start';
}

function drawVendor(ctx, state) {
  const W = state.canvasW, H = state.canvasH;
  const live = state.ui.nexusShopOpen;   // lane-phase shop keeps game live
  ctx.fillStyle = live ? 'rgba(0,0,0,0.55)' : 'rgba(0,0,0,0.85)';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 28px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(live ? 'NEXUS SHOP — LIVE' : 'REALM CLEARED — NEXUS WARPS', W / 2, 80);
  ctx.font = '16px sans-serif';
  ctx.fillText(`Aether: ${state.aether}`, W / 2, 118);
  ctx.fillText(`Potions: ${state.hero.potions}`, W / 2, 140);

  // Items for purchase
  const items = [
    { id: 'potion', name: 'Health Potion', desc: '+1 potion (heal 150 HP)', price: 10 },
    { id: 'upgradeHP', name: 'Iron Heart', desc: '+50 max HP (permanent this run)', price: 20 },
    { id: 'upgradeSpeed', name: 'Swift Boots', desc: '+5% move speed (permanent this run)', price: 15 },
  ];
  const cardW = 260, cardH = 120, gap = 20;
  const totalW = items.length * cardW + (items.length - 1) * gap;
  const sx = (W - totalW) / 2;
  const sy = 180;
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const cx = sx + i * (cardW + gap);
    ctx.fillStyle = '#1a1a22';
    ctx.fillRect(cx, sy, cardW, cardH);
    ctx.strokeStyle = state.aether >= it.price ? '#80ff80' : '#604020';
    ctx.lineWidth = 2;
    ctx.strokeRect(cx, sy, cardW, cardH);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 17px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(it.name, cx + cardW / 2, sy + 30);
    ctx.font = '13px sans-serif';
    wrapText(ctx, it.desc, cx + cardW / 2, sy + 56, cardW - 24, 18);
    ctx.fillStyle = state.aether >= it.price ? '#ffcc80' : '#806040';
    ctx.font = 'bold 14px monospace';
    ctx.fillText(`${it.price} Aether  [${i + 1}]`, cx + cardW / 2, sy + 104);
    ctx.textAlign = 'start';
  }

  ctx.fillStyle = '#ffcc40';
  ctx.font = 'bold 18px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(live ? '[B] CLOSE SHOP   (live — mobs still push)' : '[ENTER] CONTINUE TO NEXT REALM', W / 2, H - 60);
  ctx.textAlign = 'start';
}

function drawResults(ctx, state) {
  const W = state.canvasW, H = state.canvasH;
  ctx.fillStyle = 'rgba(0,0,0,0.92)';
  ctx.fillRect(0, 0, W, H);
  // Title
  ctx.fillStyle = state.victory ? '#ffcc40' : '#ff4040';
  ctx.font = 'bold 44px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(state.victory ? 'VICTORY' : 'DEFEAT', W / 2, 90);
  // Headline stats
  ctx.fillStyle = '#fff';
  ctx.font = '16px sans-serif';
  const mm = String(Math.floor(state.runTime / 60)).padStart(2, '0');
  const ss = String(Math.floor(state.runTime % 60)).padStart(2, '0');
  ctx.fillText(`Run time: ${mm}:${ss}   |   Level: ${state.hero.level}   |   Aether: ${state.aether}   |   Deaths: ${state.hero.deathsThisRun}`, W / 2, 130);
  ctx.fillText(`Nexus HP: ${Math.max(0, Math.ceil(state.world.nexus.hp))}/${state.world.nexus.maxHp}`, W / 2, 152);
  if (state.runFailReason) {
    ctx.fillStyle = '#ff8080';
    ctx.fillText(`Reason: ${state.runFailReason}`, W / 2, 176);
  }
  // Death log
  const log = state.deathLog || [];
  ctx.fillStyle = '#ffcc80';
  ctx.font = 'bold 18px sans-serif';
  ctx.fillText('Death Log', W / 2, 216);
  ctx.font = '13px monospace';
  if (log.length === 0) {
    ctx.fillStyle = '#80ff80';
    ctx.fillText('No deaths — clean run!', W / 2, 244);
  } else {
    const maxRows = Math.min(log.length, 12);
    for (let i = 0; i < maxRows; i++) {
      const d = log[log.length - 1 - i];
      const dm = String(Math.floor(d.time / 60)).padStart(2, '0');
      const ds = String(Math.floor(d.time % 60)).padStart(2, '0');
      const phaseTag = d.phase === 'arena' ? 'arena' : 'lane';
      ctx.fillStyle = i === 0 ? '#ffa0a0' : '#cfcfcf';
      ctx.fillText(`#${d.deathNumber}  ${dm}:${ds}  [${phaseTag}]  ${d.realm}  — killed by ${d.killer} (L${d.level})`, W / 2, 244 + i * 18);
    }
    if (log.length > 12) {
      ctx.fillStyle = '#808080';
      ctx.fillText(`... +${log.length - 12} more`, W / 2, 244 + 12 * 18);
    }
  }
  // Restart hint
  ctx.fillStyle = '#ffcc40';
  ctx.font = 'bold 16px monospace';
  ctx.fillText('[F5] RESTART RUN', W / 2, H - 60);
  ctx.textAlign = 'start';
}

function drawRespawnOverlay(ctx, state) {
  const hero = state.hero;
  if (!hero.respawning) return;
  const W = state.canvasW, H = state.canvasH;
  // Dim background
  ctx.fillStyle = 'rgba(20,0,0,0.35)';
  ctx.fillRect(0, 0, W, H);
  // Central panel
  const pw = 440, ph = 150;
  const px = W / 2 - pw / 2, py = H / 2 - ph / 2;
  ctx.fillStyle = 'rgba(0,0,0,0.8)';
  ctx.fillRect(px, py, pw, ph);
  ctx.strokeStyle = '#ff4040';
  ctx.lineWidth = 3;
  ctx.strokeRect(px, py, pw, ph);
  // Title
  ctx.fillStyle = '#ff6060';
  ctx.font = 'bold 32px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('YOU DIED', W / 2, py + 44);
  // Killer
  ctx.fillStyle = '#dddddd';
  ctx.font = '14px sans-serif';
  ctx.fillText(`Killed by: ${hero.lastKiller || '?'}`, W / 2, py + 68);
  // Timer
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 24px monospace';
  ctx.fillText(`Respawn in ${hero.respawnTimer.toFixed(1)}s`, W / 2, py + 100);
  // Death count
  ctx.fillStyle = '#a0a0a0';
  ctx.font = '12px monospace';
  ctx.fillText(`Death ${hero.deathsThisRun} this run`, W / 2, py + 120);
  // Aether express revive
  const canAfford = state.aether >= 25;
  ctx.fillStyle = canAfford ? '#ffcc40' : '#806040';
  ctx.font = 'bold 14px monospace';
  ctx.fillText(`[V] Instant respawn — 25 Aether (have: ${state.aether})`, W / 2, py + ph - 12);
  ctx.textAlign = 'start';
}

function drawNexusShopPrompt(ctx, state) {
  if (!state.ui.nexusShopAvailable || state.ui.nexusShopOpen || state.ui.modalOpen) return;
  const W = state.canvasW;
  const x = W / 2, y = state.canvasH - 170;
  ctx.fillStyle = 'rgba(0,0,0,0.75)';
  ctx.fillRect(x - 110, y - 14, 220, 28);
  ctx.strokeStyle = '#ffcc40';
  ctx.lineWidth = 2;
  ctx.strokeRect(x - 110, y - 14, 220, 28);
  ctx.fillStyle = '#ffcc40';
  ctx.font = 'bold 13px monospace';
  ctx.textAlign = 'center';
  ctx.fillText('[B] Shop at Nexus', x, y + 5);
  ctx.textAlign = 'start';
}

function drawEventIndicator(ctx, state) {
  if (!state.events.active) return;
  const ev = state.events.active;
  let text = '', color = '#fff';
  if (ev.type === 'emberRift' && ev.rift) {
    text = `EMBER RIFT: ${(ev.rift.ttl - ev.rift.age).toFixed(0)}s  HP ${Math.ceil(ev.rift.hp)}/${ev.rift.maxHp}`;
    color = '#ff4030';
  } else if (ev.type === 'frostboundTotem' && ev.totem) {
    text = `TOTEM: ${(ev.totem.ttl - ev.totem.age).toFixed(0)}s  HP ${Math.ceil(ev.totem.hp)}/${ev.totem.maxHp}`;
    color = '#a0e0ff';
  }
  ctx.fillStyle = '#000a';
  const W = state.canvasW;
  ctx.fillRect(W / 2 - 160, 58, 320, 22);
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.strokeRect(W / 2 - 160, 58, 320, 22);
  ctx.fillStyle = color;
  ctx.font = 'bold 13px monospace';
  ctx.textAlign = 'center';
  ctx.fillText(text, W / 2, 73);
  ctx.textAlign = 'start';
}

function drawDebug(ctx, state) {
  const dbg = document.getElementById('debug');
  if (dbg) {
    dbg.classList.add('visible');
    dbg.textContent =
      `FPS: ${state.fps.toFixed(1)}
Frame: ${state.frameTime.toFixed(2)}ms
Mobs: ${state.mobs.length}
Projectiles: ${state.projectiles.length}
Telegraphs: ${state.telegraphs.length}
GroundAoEs: ${state.groundAoes.length}
Floaters: ${state.floaters.length}
Phase: ${state.phase}
Realm: ${state.currentRealm ? state.currentRealm.name : '-'} (${state.realmTime.toFixed(1)}s)
Hero: pos(${state.hero.pos.x.toFixed(1)},${state.hero.pos.y.toFixed(1)}) hp(${Math.ceil(state.hero.hp)}/${state.hero.maxHp}) lvl(${state.hero.level}) xp(${state.hero.xp}) flow(${state.hero.comboFlow.toFixed(0)})
Nexus: ${Math.ceil(state.world.nexus.hp)}/${state.world.nexus.maxHp}
Pressure: ${state.world.pressure.toFixed(0)}%`;
  }
}

function hexAlpha(hex, alpha) {
  // Accept '#rrggbb' or 'rgba(...)' passthrough; returns 'rgba(r,g,b,a)'
  if (!hex) hex = '#ffffff';
  if (hex.startsWith('rgba') || hex.startsWith('rgb')) return hex;
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  const r = parseInt(h.substr(0, 2), 16);
  const g = parseInt(h.substr(2, 2), 16);
  const b = parseInt(h.substr(4, 2), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
  const words = text.split(' ');
  let line = '';
  let yy = y;
  for (const w of words) {
    const test = line ? line + ' ' + w : w;
    if (ctx.measureText(test).width > maxWidth && line) {
      ctx.fillText(line, x, yy);
      line = w;
      yy += lineHeight;
    } else {
      line = test;
    }
  }
  if (line) ctx.fillText(line, x, yy);
}

// XP curve (matches talents module table) — duplicated here to avoid dynamic import pain
const XP_TABLE = [0, 50, 120, 210, 330, 480, 670, 910, 1210, 1580, 99999];
function xpForLevelStatic(level) {
  if (level <= 0) return 0;
  if (level >= XP_TABLE.length) return XP_TABLE[XP_TABLE.length - 1];
  return XP_TABLE[level];
}
