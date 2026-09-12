#!/usr/bin/env node
// headless balance run. prints real numbers and writes data/sim-latest.json,
// which is the only place the devlog generator is allowed to get numbers from.

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGame, step, summarise } from '../src/engine/game.js';
import { botInput } from '../src/engine/bot.js';
import { DEFAULT_CONFIG } from '../src/engine/config.js';
import { makeRng, random } from '../src/engine/rng.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

export function runOne(seed, opts = {}) {
  const g = createGame(seed, opts.config ?? DEFAULT_CONFIG);
  const rng = makeRng(seed ^ 0x9e3779b9);
  const maxFrames = opts.maxFrames ?? 60 * 180;
  const jitter = opts.jitter ?? 0;
  while (g.alive && g.frame < maxFrames) {
    const noise = jitter ? (random(rng) * 2 - 1) * jitter : 0;
    step(g, botInput(g, { ...opts.policy, noise }));
  }
  const out = summarise(g);
  out.timedOut = g.alive;
  return out;
}

export function runMany(runs, opts = {}) {
  const baseSeed = opts.baseSeed ?? 1;
  const results = [];
  for (let i = 0; i < runs; i++) results.push(runOne(baseSeed + i, opts));
  const blocks = results.map((r) => r.blocks).sort((a, b) => a - b);
  const deaths = {};
  for (const r of results) deaths[r.death] = (deaths[r.death] ?? 0) + 1;
  const tight = results.reduce((a, r) => a + r.tightLines, 0);
  const loose = results.reduce((a, r) => a + r.looseLines, 0);
  const sandwiches = results.reduce((a, r) => a + r.sandwiches, 0);
  const blamed = results.filter((r) => r.diedAfterSandwich).length;
  const ended = results.filter((r) => !r.timedOut).length;
  return {
    generatedAt: new Date().toISOString().slice(0, 19) + 'Z',
    runs,
    jitter: opts.jitter ?? 0,
    blocks: {
      median: percentile(blocks, 0.5),
      mean: round(blocks.reduce((a, b) => a + b, 0) / blocks.length, 1),
      p10: percentile(blocks, 0.1),
      p90: percentile(blocks, 0.9),
      max: blocks[blocks.length - 1],
      min: blocks[0],
    },
    seconds: {
      median: percentile(results.map((r) => r.seconds).sort((a, b) => a - b), 0.5),
      max: Math.max(...results.map((r) => r.seconds)),
    },
    deaths: Object.fromEntries(
      Object.entries(deaths)
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => [k, { runs: v, pct: round((v / runs) * 100, 1) }])
    ),
    tightLineRate: round((tight / Math.max(1, tight + loose)) * 100, 1),
    sandwichesPerRun: round(sandwiches / runs, 2),
    deathsAfterSandwichPct: round((blamed / Math.max(1, ended)) * 100, 1),
    sandwichBlameWindowSeconds: round(DEFAULT_CONFIG.sandwich.blameFrames * DEFAULT_CONFIG.dt, 2),
    timedOutRuns: results.filter((r) => r.timedOut).length,
  };
}

function percentile(sorted, q) {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * q)));
  return sorted[i];
}
const round = (v, n) => Number(v.toFixed(n));

function arg(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=')[1] : fallback;
}

if (process.argv[1] && process.argv[1].endsWith('sim.js')) {
  const runs = Number(arg('runs', 2000));
  const jitter = Number(arg('jitter', 6));
  const baseSeed = Number(arg('seed', 1));
  const stats = runMany(runs, { jitter, baseSeed });
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(stats, null, 2));
  } else {
    console.log(`runs           ${stats.runs}  (aim jitter ${stats.jitter}px)`);
    console.log(`blocks         median ${stats.blocks.median}  p10 ${stats.blocks.p10}  p90 ${stats.blocks.p90}  max ${stats.blocks.max}`);
    console.log(`run length     median ${stats.seconds.median}s  longest ${stats.seconds.max}s`);
    console.log(`tight lines    ${stats.tightLineRate}% of gaps`);
    console.log(`sandwiches     ${stats.sandwichesPerRun} per run`);
    console.log(`death within ${stats.sandwichBlameWindowSeconds}s of a sandwich: ${stats.deathsAfterSandwichPct}%`);
    for (const [cause, d] of Object.entries(stats.deaths)) {
      console.log(`death: ${cause.padEnd(8)} ${d.pct}%  (${d.runs} runs)`);
    }
    if (stats.timedOutRuns) console.log(`timed out      ${stats.timedOutRuns} runs`);
  }
  mkdirSync(join(root, 'data'), { recursive: true });
  writeFileSync(join(root, 'data', 'sim-latest.json'), JSON.stringify(stats, null, 2) + '\n');
}
