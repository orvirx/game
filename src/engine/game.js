// mempool — the whole simulation. no dom, no timers, no Math.random.
// the browser build and the headless balance sim import this same file, so a
// number measured in the sim is the number the player experiences.

import { DEFAULT_CONFIG } from './config.js';
import { makeRng, random, randRange } from './rng.js';

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

export function createGame(seed = 1, cfg = DEFAULT_CONFIG) {
  const mid = (cfg.world.ceil + cfg.world.floor) / 2;
  const s = {
    cfg,
    seed: seed >>> 0,
    rng: makeRng(seed),
    t: 0,
    frame: 0,
    speed: cfg.speed.start,
    player: { y: mid, vy: 0 },
    gas: cfg.gas.start,
    boosting: false,
    blocks: [],
    bots: [],
    nextIndex: 0,
    lastGapY: mid,
    blocksPassed: 0,
    tightLines: 0,
    looseLines: 0,
    combo: 0,
    bestCombo: 0,
    score: 0,
    gasEmptyFrames: 0,
    sandwiches: 0,
    lastSandwichFrame: -999,
    stunUntil: -1,
    alive: true,
    death: null,
    events: [],
  };
  fillBlocks(s);
  return s;
}

function fillBlocks(s) {
  const { blocks: b, world } = s.cfg;
  while (!s.blocks.length || s.blocks[s.blocks.length - 1].x < world.width + b.spacing) {
    spawnBlock(s);
  }
}

function spawnBlock(s) {
  const { blocks: b, world } = s.cfg;
  const i = s.nextIndex++;
  const gapH = Math.max(b.gapMin, b.gapStart - i * b.gapShrink);
  const lo = world.ceil + gapH / 2 + 6;
  const hi = world.floor - gapH / 2 - 6;
  const drift = (random(s.rng) * 2 - 1) * b.maxGapDelta;
  const gapY = clamp(s.lastGapY + drift, lo, hi);
  s.lastGapY = gapY;
  const prev = s.blocks[s.blocks.length - 1];
  const x = prev ? prev.x + b.spacing : b.firstX;
  s.blocks.push({ index: i, x, gapY, gapH, passed: false });

  const bots = s.cfg.bots;
  if (i >= bots.firstBlock && i % bots.everyBlocks === 0) {
    s.bots.push({
      x: x + b.spacing / 2,
      y: randRange(s.rng, world.ceil + 12, world.floor - 12),
      vy: 0,
      bornAtBlock: i,
    });
  }
}

function kill(s, cause) {
  if (!s.alive) return;
  s.alive = false;
  s.death = { cause, block: s.blocksPassed, t: round(s.t, 3), gas: round(s.gas, 1) };
}

const round = (v, n) => Number(v.toFixed(n));

export function step(s, input = {}) {
  if (!s.alive) return s;
  const cfg = s.cfg;
  const dt = cfg.dt;
  const p = s.player;
  const half = cfg.player.size / 2;

  const stunned = s.frame < s.stunUntil;
  const dir = (input.down ? 1 : 0) - (input.up ? 1 : 0);
  const boosting = !!input.boost && s.gas > 0 && !stunned;
  s.boosting = boosting;

  let accel = boosting ? cfg.player.boostAccel : cfg.player.accel;
  if (stunned) accel *= cfg.sandwich.stunAccel;
  const maxV = boosting ? cfg.player.boostMaxSpeed : cfg.player.maxSpeed;

  if (dir !== 0) p.vy += dir * accel * dt;
  else p.vy -= p.vy * cfg.player.friction * dt;
  p.vy = clamp(p.vy, -maxV, maxV);
  p.y += p.vy * dt;

  if (p.y < cfg.world.ceil + half) { p.y = cfg.world.ceil + half; p.vy = 0; }
  if (p.y > cfg.world.floor - half) { p.y = cfg.world.floor - half; p.vy = 0; }

  if (boosting) s.gas = Math.max(0, s.gas - cfg.gas.drain * dt);
  else s.gas = Math.min(cfg.gas.max, s.gas + cfg.gas.regen * dt);
  if (s.gas <= 0) s.gasEmptyFrames++;

  s.speed = Math.min(cfg.speed.max, cfg.speed.start + s.blocksPassed * cfg.speed.perBlock);
  const dx = s.speed * dt;

  for (const b of s.blocks) b.x -= dx;
  for (const bot of s.bots) {
    bot.x -= dx;
    const target = p.y + p.vy * cfg.bots.lead;
    bot.vy = clamp((target - bot.y) * cfg.bots.gain, -cfg.bots.speed, cfg.bots.speed);
    bot.y = clamp(bot.y + bot.vy * dt, cfg.world.ceil + 4, cfg.world.floor - 4);
  }

  // scoring: a wall counts as passed once its right edge clears the player
  for (const b of s.blocks) {
    if (b.passed || b.x + cfg.blocks.wallWidth > cfg.player.x - half) continue;
    b.passed = true;
    s.blocksPassed++;
    const off = Math.abs(p.y - b.gapY);
    let gained = cfg.score.perBlock;
    if (off <= cfg.tight.window) {
      s.tightLines++;
      s.combo++;
      s.bestCombo = Math.max(s.bestCombo, s.combo);
      s.gas = Math.min(cfg.gas.max, s.gas + cfg.gas.tightBonus);
      gained += cfg.score.tightBonus * Math.min(s.combo, cfg.score.maxComboBonus);
      s.events.push({ frame: s.frame, type: 'tight', block: b.index, combo: s.combo });
    } else {
      s.looseLines++;
      s.combo = 0;
    }
    s.score += gained;
  }

  s.blocks = s.blocks.filter((b) => b.x + cfg.blocks.wallWidth > -20);
  s.bots = s.bots.filter((b) => b.x > -20);
  fillBlocks(s);

  // collisions
  const px0 = cfg.player.x - half;
  const px1 = cfg.player.x + half;
  for (const b of s.blocks) {
    if (b.x >= px1 || b.x + cfg.blocks.wallWidth <= px0) continue;
    const top = b.gapY - b.gapH / 2;
    const bottom = b.gapY + b.gapH / 2;
    if (p.y - half < top || p.y + half > bottom) { kill(s, 'wall'); break; }
  }
  // a chaser does not kill. it sandwiches you: gas gone, combo gone, controls
  // mushy for a moment. what kills you is the wall you hit while recovering.
  const bh = cfg.bots.size / 2;
  const survivors = [];
  for (const bot of s.bots) {
    const hit = Math.abs(bot.x - cfg.player.x) < half + bh && Math.abs(bot.y - p.y) < half + bh;
    if (!hit) { survivors.push(bot); continue; }
    s.sandwiches++;
    s.lastSandwichFrame = s.frame;
    s.stunUntil = s.frame + cfg.sandwich.stunFrames;
    s.gas = Math.max(0, s.gas - cfg.sandwich.gasLoss);
    s.combo = 0;
    s.events.push({ frame: s.frame, type: 'sandwich', block: s.blocksPassed });
  }
  s.bots = survivors;

  s.t += dt;
  s.frame++;
  return s;
}

// compact, stable fingerprint of a state — used by the determinism test
export function hashState(s) {
  const parts = [
    s.frame, round(s.t, 4), round(s.player.y, 4), round(s.player.vy, 4),
    round(s.gas, 4), s.blocksPassed, s.score, s.combo, s.rng.a,
    s.alive ? 1 : 0, s.death ? s.death.cause : '-',
    s.blocks.map((b) => `${b.index}:${round(b.x, 3)}:${round(b.gapY, 3)}`).join(','),
    s.bots.map((b) => `${round(b.x, 3)}:${round(b.y, 3)}`).join(','),
  ].join('|');
  let h = 2166136261;
  for (let i = 0; i < parts.length; i++) {
    h ^= parts.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}

export function summarise(s) {
  return {
    seed: s.seed,
    blocks: s.blocksPassed,
    score: s.score,
    seconds: round(s.t, 2),
    tightLines: s.tightLines,
    looseLines: s.looseLines,
    bestCombo: s.bestCombo,
    topSpeed: round(s.speed, 1),
    gasEmptySeconds: round(s.gasEmptyFrames * s.cfg.dt, 2),
    sandwiches: s.sandwiches,
    death: s.death ? s.death.cause : 'none',
    diedAfterSandwich:
      !!s.death && s.frame - s.lastSandwichFrame <= s.cfg.sandwich.blameFrames,
  };
}
