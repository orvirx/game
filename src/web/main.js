// page wiring: fixed 60hz timestep, integer canvas scaling, attract mode.
// ?seed=123   reproduce an exact run
// ?record=1   clean frame for a screen capture: no combo, no best, no hints

import { DEFAULT_CONFIG } from '../engine/config.js';
import { createGame, step } from '../engine/game.js';
import { botInput } from '../engine/bot.js';
import { createInput } from './input.js';
import { draw, makeSkyline } from './render.js';
import { hashSeed } from '../engine/rng.js';

const cfg = DEFAULT_CONFIG;
const params = new URLSearchParams(location.search);
const record = params.get('record') === '1';
const fixedSeed = params.get('seed') ? Number(params.get('seed')) >>> 0 : null;

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const input = createInput(canvas, cfg);

const view = {
  skyline: makeSkyline(hashSeed('mempool'), cfg.world.width, cfg.world.height),
  scroll: 0,
  best: Number(localStorage.getItem('mempool.best') || 0),
  record,
  attract: true,
};

let game = newGame();
let idleFrames = 0;

function newGame() {
  const seed = fixedSeed ?? (Math.random() * 0xffffffff) >>> 0;
  const g = createGame(seed, cfg);
  document.getElementById('seed').textContent = `seed ${seed}`;
  return g;
}

function resize() {
  const scale = Math.max(1, Math.floor(Math.min(window.innerWidth, window.innerHeight - 72) / cfg.world.width));
  canvas.style.width = `${cfg.world.width * scale}px`;
  canvas.style.height = `${cfg.world.height * scale}px`;
}
window.addEventListener('resize', resize);
canvas.width = cfg.world.width;
canvas.height = cfg.world.height;
resize();

let acc = 0;
let last = performance.now();

function frame(now) {
  acc += Math.min(0.25, (now - last) / 1000);
  last = now;
  while (acc >= cfg.dt) {
    tick();
    acc -= cfg.dt;
  }
  draw(ctx, game, view);
  requestAnimationFrame(frame);
}

function tick() {
  const human = input.read(game);
  const pressed = human.up || human.down || human.boost;
  if (pressed) { view.attract = false; idleFrames = 0; }
  else idleFrames++;

  if (game.alive) {
    const cmd = view.attract ? botInput(game) : human;
    step(game, cmd);
    view.scroll += game.speed * cfg.dt;
  } else {
    // attract mode restarts itself, a human run waits for r or a tap
    const wantsRestart = input.consumeRestart() || (view.attract && idleFrames > 90);
    if (wantsRestart || (!view.attract && idleFrames > 600)) {
      if (!view.attract) {
        view.best = Math.max(view.best, game.blocksPassed);
        localStorage.setItem('mempool.best', String(view.best));
      }
      view.attract = idleFrames > 600;
      game = newGame();
      idleFrames = 0;
    }
  }
  if (!game.alive && !view.attract) {
    view.best = Math.max(view.best, game.blocksPassed);
    localStorage.setItem('mempool.best', String(view.best));
  }
}

canvas.addEventListener('pointerdown', () => {
  if (!game.alive) { game = newGame(); idleFrames = 0; view.attract = false; }
});

requestAnimationFrame((t) => { last = t; frame(t); });
