// pixel renderer. logical canvas is 270x270 and scales by integers only, so a
// 4x capture is exactly 1080x1080 — the square crop that reads on mobile.

import { makeRng, random, randRange } from '../engine/rng.js';

export const PALETTE = {
  sky: '#0b1118',
  cityFar: '#101822',
  cityNear: '#14202b',
  rail: '#24394c',
  wall: '#37607f',
  wallShade: '#24405697',
  wallEdge: '#8fdcff',
  player: '#a9e8ff',
  playerCore: '#ffffff',
  trail: '#3d7fa0',
  bot: '#ff6b6b',
  botDim: '#8f3a3a',
  gas: '#8fe1ff',
  gasLow: '#ffb347',
  text: '#cfe8ff',
  dim: '#5c7a91',
};

export function makeSkyline(seed, width, height) {
  const rng = makeRng(seed);
  const layers = [];
  for (let l = 0; l < 2; l++) {
    const buildings = [];
    let x = -20;
    while (x < width + 60) {
      const w = Math.round(randRange(rng, 10, 26));
      const h = Math.round(randRange(rng, 12, l === 0 ? 40 : 62));
      buildings.push({ x, w, h, lit: random(rng) > 0.55 });
      x += w + Math.round(randRange(rng, 2, 8));
    }
    layers.push({ buildings, speed: l === 0 ? 0.08 : 0.18, color: l === 0 ? PALETTE.cityFar : PALETTE.cityNear });
  }
  return layers;
}

export function draw(ctx, s, view) {
  const cfg = s.cfg;
  const W = cfg.world.width;
  const H = cfg.world.height;
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = PALETTE.sky;
  ctx.fillRect(0, 0, W, H);

  // parallax skyline, drawn from the world offset so it never desyncs
  for (const layer of view.skyline) {
    ctx.fillStyle = layer.color;
    const shift = (view.scroll * layer.speed) % (W + 80);
    for (const b of layer.buildings) {
      const x = Math.floor(b.x - shift);
      const y = cfg.world.floor - b.h;
      ctx.fillRect(x, y, b.w, b.h);
      ctx.fillRect(x + W + 80, y, b.w, b.h);
    }
  }

  // play area rails
  ctx.fillStyle = PALETTE.rail;
  ctx.fillRect(0, cfg.world.ceil - 2, W, 2);
  ctx.fillRect(0, cfg.world.floor, W, 2);

  // walls
  for (const b of s.blocks) {
    const x = Math.floor(b.x);
    const top = Math.floor(b.gapY - b.gapH / 2);
    const bottom = Math.ceil(b.gapY + b.gapH / 2);
    ctx.fillStyle = PALETTE.wall;
    ctx.fillRect(x, cfg.world.ceil, cfg.blocks.wallWidth, top - cfg.world.ceil);
    ctx.fillRect(x, bottom, cfg.blocks.wallWidth, cfg.world.floor - bottom);
    ctx.fillStyle = PALETTE.sky;
    ctx.fillRect(x + cfg.blocks.wallWidth - 2, cfg.world.ceil, 1, top - cfg.world.ceil);
    ctx.fillRect(x + cfg.blocks.wallWidth - 2, bottom, 1, cfg.world.floor - bottom);
    ctx.fillStyle = PALETTE.wallEdge;
    ctx.fillRect(x, top - 1, cfg.blocks.wallWidth, 1);
    ctx.fillRect(x, bottom, cfg.blocks.wallWidth, 1);
  }

  // chasers
  for (const bot of s.bots) {
    const x = Math.round(bot.x);
    const y = Math.round(bot.y);
    const h = cfg.bots.size;
    ctx.fillStyle = PALETTE.botDim;
    ctx.fillRect(x - h / 2 - 2, y - h / 2, 2, h);
    ctx.fillStyle = PALETTE.bot;
    ctx.fillRect(x - h / 2, y - h / 2, h, h);
    ctx.fillStyle = PALETTE.sky;
    ctx.fillRect(x - 1, y - 1, 2, 2);
  }

  // player, with a short trail when boosting
  const px = cfg.player.x;
  const py = Math.round(s.player.y);
  const size = cfg.player.size;
  if (s.boosting) {
    ctx.fillStyle = PALETTE.trail;
    ctx.fillRect(px - size / 2 - 10, py - 2, 10, 4);
  }
  const stunned = s.frame < s.stunUntil;
  ctx.fillStyle = stunned && s.frame % 6 < 3 ? PALETTE.bot : PALETTE.player;
  ctx.fillRect(px - size / 2, py - size / 2, size, size);
  ctx.fillStyle = PALETTE.playerCore;
  ctx.fillRect(px - 1, py - 1, 2, 2);

  drawHud(ctx, s, view);
}

function drawHud(ctx, s, view) {
  const cfg = s.cfg;
  const W = cfg.world.width;
  ctx.font = '8px monospace';
  ctx.textBaseline = 'top';

  // gas bar
  const barW = 60;
  const filled = Math.round((s.gas / cfg.gas.max) * barW);
  ctx.fillStyle = PALETTE.rail;
  ctx.fillRect(8, 7, barW, 5);
  ctx.fillStyle = s.gas < 25 ? PALETTE.gasLow : PALETTE.gas;
  ctx.fillRect(8, 7, filled, 5);
  ctx.fillStyle = PALETTE.dim;
  ctx.fillText('gas', 72, 6);

  ctx.fillStyle = PALETTE.text;
  ctx.textAlign = 'right';
  ctx.fillText(`${s.blocksPassed} blocks`, W - 8, 6);
  ctx.textAlign = 'left';

  if (!view.record) {
    ctx.fillStyle = PALETTE.dim;
    ctx.fillText(`x${s.combo}`, 8, 16);
    ctx.textAlign = 'right';
    ctx.fillText(`best ${view.best}`, W - 8, 16);
    ctx.textAlign = 'left';
  }

  if (!s.alive) {
    ctx.fillStyle = 'rgba(13,20,28,0.82)';
    ctx.fillRect(0, 104, W, 62);
    ctx.fillStyle = PALETTE.text;
    ctx.textAlign = 'center';
    ctx.fillText('not included', W / 2, 112);
    ctx.fillStyle = PALETTE.dim;
    ctx.fillText(`${s.blocksPassed} blocks · ${s.sandwiches} sandwiched`, W / 2, 128);
    ctx.fillText(view.record ? '' : 'r to run it again', W / 2, 146);
    ctx.textAlign = 'left';
  } else if (s.frame < 150 && !view.record) {
    ctx.fillStyle = PALETTE.dim;
    ctx.textAlign = 'center';
    ctx.fillText('arrows move · space burns gas', W / 2, 232);
    ctx.textAlign = 'left';
  }
}
