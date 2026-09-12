#!/usr/bin/env node
// no framework, no dependencies. `node tools/test.js` or `--json` for the
// machine-readable summary the devlog generator quotes.

import { createGame, step, hashState, summarise } from '../src/engine/game.js';
import { DEFAULT_CONFIG, cloneConfig } from '../src/engine/config.js';
import { makeRng, random } from '../src/engine/rng.js';
import { botInput } from '../src/engine/bot.js';
import { runOne, runMany } from './sim.js';
import { lint } from './voice.js';
import { buildDraft, buildThread, checkNumbers } from './devlog.js';

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}
function equal(a, b, msg) {
  if (a !== b) throw new Error(`${msg || 'not equal'}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`);
}

const FIXTURE_FACTS = {
  git: {
    commits: 4, filesChanged: 6, insertions: 210, deletions: 33,
    since: '2026-09-10', headSha: 'abc1234',
    subjects: ['fix: chaser no longer kills on contact'],
    latestSubject: 'fix: chaser no longer kills on contact',
    fixSubjects: ['fix: chaser no longer kills on contact'], fixes: 1,
  },
  sim: {
    runs: 2000,
    blocks: { median: 57, mean: 57.4, p10: 40, p90: 72, max: 105, min: 12 },
    seconds: { median: 41.27, max: 59.77 },
    deaths: { wall: { runs: 2000, pct: 100 } },
    tightLineRate: 89.1,
    sandwichesPerRun: 9.85,
    deathsAfterSandwichPct: 63.2,
    sandwichBlameWindowSeconds: 1.5,
    timedOutRuns: 0,
  },
  tests: { passed: 12, failed: 0, total: 12 },
  config: {
    gapStart: 92, gapMin: 34, gapShrink: 2, spacing: 96, playerSize: 8,
    topSpeed: 260, gasLoss: 35, stunSeconds: 0.33, chaserEvery: 3,
    tightWindow: 12, fps: 60,
  },
};

// ------------------------------------------------------------- engine

test('same seed and same inputs give the same state', () => {
  const play = (seed) => {
    const g = createGame(seed);
    const rng = makeRng(99);
    for (let i = 0; i < 1200 && g.alive; i++) {
      step(g, { up: random(rng) > 0.55, down: random(rng) > 0.75, boost: random(rng) > 0.8 });
    }
    return hashState(g);
  };
  equal(play(4242), play(4242), 'replay of one seed diverged');
});

test('different seeds give different runs', () => {
  assert(hashState(createGame(1)) !== hashState(createGame(2)), 'seeds collided');
});

test('a sim run is reproducible', () => {
  equal(JSON.stringify(runOne(77, { jitter: 5 })), JSON.stringify(runOne(77, { jitter: 5 })));
});

test('the player never leaves the play area', () => {
  const g = createGame(11);
  const rng = makeRng(5);
  const half = DEFAULT_CONFIG.player.size / 2;
  for (let i = 0; i < 4000; i++) {
    step(g, { up: random(rng) > 0.5, down: random(rng) > 0.5, boost: random(rng) > 0.5 });
    assert(g.player.y >= DEFAULT_CONFIG.world.ceil + half - 0.001, `above ceiling: ${g.player.y}`);
    assert(g.player.y <= DEFAULT_CONFIG.world.floor - half + 0.001, `below floor: ${g.player.y}`);
    if (!g.alive) Object.assign(g, createGame(i + 100));
  }
});

test('every gap stays inside the play area and shrinks to the floor value', () => {
  const g = createGame(31337);
  for (let i = 0; i < 5000; i++) step(g, botInput(g));
  for (const b of g.blocks) {
    assert(b.gapH >= DEFAULT_CONFIG.blocks.gapMin - 0.001, `gap smaller than the floor: ${b.gapH}`);
    assert(b.gapY - b.gapH / 2 >= DEFAULT_CONFIG.world.ceil, 'gap pokes through the ceiling');
    assert(b.gapY + b.gapH / 2 <= DEFAULT_CONFIG.world.floor, 'gap pokes through the floor');
  }
});

test('consecutive gaps are reachable without boosting', () => {
  const { blocks, speed, player } = DEFAULT_CONFIG;
  const worstCaseTime = blocks.spacing / speed.max;
  const travel = player.maxSpeed * worstCaseTime;
  assert(
    blocks.maxGapDelta <= travel * 0.8,
    `gap can jump ${blocks.maxGapDelta}px but only ${travel.toFixed(1)}px is reachable at top speed`
  );
});

test('a chaser sandwiches instead of killing', () => {
  const cfg = cloneConfig();
  const g = createGame(9, cfg);
  g.bots.push({ x: cfg.player.x + 1, y: g.player.y, vy: 0, bornAtBlock: 0 });
  const gasBefore = g.gas;
  step(g, {});
  assert(g.alive, 'contact with a chaser killed the run');
  equal(g.sandwiches, 1, 'sandwich not counted');
  assert(g.gas < gasBefore, 'sandwich cost no gas');
  assert(g.frame < g.stunUntil, 'sandwich did not stun');
});

test('a wall kills', () => {
  const g = createGame(5);
  g.blocks[0].x = DEFAULT_CONFIG.player.x;
  g.blocks[0].gapY = DEFAULT_CONFIG.world.ceil + 10;
  g.blocks[0].gapH = DEFAULT_CONFIG.blocks.gapMin;
  g.player.y = DEFAULT_CONFIG.world.floor - 20;
  step(g, {});
  assert(!g.alive, 'ran straight through a wall');
  equal(g.death.cause, 'wall');
});

test('the game is playable: the scripted bot clears a floor of blocks', () => {
  const stats = runMany(200, { jitter: 6, baseSeed: 900 });
  assert(stats.blocks.median >= 5, `median run is only ${stats.blocks.median} blocks`);
  assert(stats.blocks.p10 >= 1, `the bottom tenth dies on block ${stats.blocks.p10}`);
});

// -------------------------------------------------------------- voice

test('voice rules accept the account style and reject the usual mistakes', () => {
  const good = 'ok the gap shrinks too fast\n\ngot cornered twice and just held boost instead of\nreading the wall\n\nis that the curve or me';
  assert(lint(good).ok, JSON.stringify(lint(good).issues));

  assert(!lint('This is a post').ok, 'uppercase slipped through');
  assert(!lint('a post that ends properly.').ok, 'final full stop slipped through');
  assert(!lint('a post with a rocket 🚀').ok, 'emoji slipped through');
  assert(!lint('1/ opener\n\nsecond beat').ok, 'thread marker slipped through');
  assert(!lint('bought some $SOL today').ok, 'ticker slipped through');
  assert(!lint('honestly this changes everything for me').ok, 'hype phrase slipped through');
  assert(!lint('the interesting part is the gap size').ok, 'essay connective slipped through');
  assert(!lint('read it here https://example.com', { kind: 'opener' }).ok, 'link in the opener slipped through');
  assert(lint('product names stay as they are, like OpenAI and Anthropic').ok, 'proper nouns rejected');
});

// ------------------------------------------------------------ devlog

test('every generated draft passes the voice rules', () => {
  for (const kind of ['balance', 'build', 'broke', 'ship']) {
    for (const date of ['2026-09-12', '2026-09-13', '2026-09-14']) {
      const text = buildDraft(kind, FIXTURE_FACTS, { date });
      const res = lint(text, { kind: 'opener' });
      assert(res.ok, `${kind} on ${date}: ${JSON.stringify(res.issues)}`);
    }
  }
});

test('a thread puts the link in the last reply only', () => {
  const parts = buildThread('ship', FIXTURE_FACTS, { date: '2026-09-12' });
  assert(parts.length >= 3, 'thread too short');
  const withLinks = parts.filter((p) => /https?:\/\//.test(p));
  equal(withLinks.length, 1, 'more than one part carries a link');
  assert(/https?:\/\//.test(parts[parts.length - 1]), 'the link is not in the last reply');
});

test('no number reaches a draft without a source', () => {
  for (const kind of ['balance', 'build', 'broke', 'ship']) {
    for (const date of ['2026-09-12', '2026-09-13', '2026-09-14']) {
      const text = buildDraft(kind, FIXTURE_FACTS, { date });
      const stray = checkNumbers(text, FIXTURE_FACTS);
      equal(stray.length, 0, `${kind} on ${date} invented: ${stray.join(', ')}`);
    }
  }
  const invented = checkNumbers('tested 6 methods, 2 work, 4881 people agree', FIXTURE_FACTS);
  assert(invented.includes('4881'), 'the receipts guard missed an invented number');
});

test('a format that needs a human observation refuses to invent one', () => {
  let refused = false;
  try { buildDraft('note', FIXTURE_FACTS, { date: '2026-09-12' }); } catch { refused = true; }
  assert(refused, 'the note format made something up');
});

// ---------------------------------------------------------------- run

const json = process.argv.includes('--json');
let passed = 0;
const failures = [];
const started = Date.now();

for (const t of tests) {
  try {
    t.fn();
    passed++;
    if (!json) console.log(`  ok   ${t.name}`);
  } catch (e) {
    failures.push({ name: t.name, error: e.message });
    if (!json) console.log(`  FAIL ${t.name}\n       ${e.message}`);
  }
}

const summary = {
  total: tests.length,
  passed,
  failed: failures.length,
  durationMs: Date.now() - started,
  failures,
};

if (json) console.log(JSON.stringify(summary));
else console.log(`\n${passed}/${tests.length} passing in ${summary.durationMs}ms`);

process.exit(failures.length ? 1 : 0);
