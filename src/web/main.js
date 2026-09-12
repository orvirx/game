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
const record = params.get('record') === '1' || window.MEMPOOL_RECORD === true;
const fixedSeed = params.get('seed') ? Number(params.get('seed')) >>> 0 : null;

// storage can throw in an embedded frame or a private window
const store = {
  get(key, fallback) {
    try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, value); } catch { /* best is session-only */ }
  },
};

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const input = createInput(canvas, cfg);

const view = {
  skyline: makeSkyline(hashSeed('mempool'), cfg.world.width, cfg.world.height),
  scroll: 0,
  best: Number(store.get('mempool.best', 0)) || 0,
  record,
  attract: true,
};

let requestedSeed = null;
let game = newGame();
let idleFrames = 0;

function newGame() {
  const seed = requestedSeed ?? fixedSeed ?? (Math.random() * 0xffffffff) >>> 0;
  requestedSeed = null;
  const g = createGame(seed, cfg);
  const label = document.getElementById('seed');
  if (label) label.textContent = `seed ${seed}`;
  return g;
}

function resize() {
  // fit the box we are given, in whole pixels, so the art stays crisp
  const box = canvas.parentElement ? canvas.parentElement.getBoundingClientRect().width : window.innerWidth;
  const avail = Math.min(box || window.innerWidth, window.innerHeight - 120);
  const scale = Math.max(1, Math.floor(avail / cfg.world.width));
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
        store.set('mempool.best', String(view.best));
      }
      view.attract = idleFrames > 600;
      game = newGame();
      idleFrames = 0;
    }
  }
  if (!game.alive && !view.attract) {
    view.best = Math.max(view.best, game.blocksPassed);
    store.set('mempool.best', String(view.best));
  }
}

canvas.addEventListener('pointerdown', () => {
  if (!game.alive) { game = newGame(); idleFrames = 0; view.attract = false; }
});

// small control surface for a host page: a fresh run, a fixed seed, a clean frame
window.mempool = {
  newRun(seed) {
    requestedSeed = seed === undefined ? null : seed >>> 0;
    view.attract = false;
    idleFrames = 0;
    game = newGame();
  },
  setRecord(on) {
    view.record = !!on;
    document.body.classList.toggle('record', !!on);
  },
  get record() { return view.record; },
  get best() { return view.best; },
  get blocks() { return game.blocksPassed; },
};

requestAnimationFrame((t) => { last = t; frame(t); });
