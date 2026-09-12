#!/usr/bin/env node
// devlog generator.
//
// it does not write posts about the game, it reports on it. every number in a
// draft has to come from one of three sources — git, the test run, or the
// balance sim — and generation fails if a template ever produces a number that
// is not in the collected facts. that is hard rule 2 from the account context,
// enforced by code instead of by memory.

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_CONFIG } from '../src/engine/config.js';
import { lint, format } from './voice.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const POSTS = join(root, 'posts');
const LOG = join(POSTS, 'log.json');
const SIM = join(root, 'data', 'sim-latest.json');
const PLAY_URL = process.env.MEMPOOL_URL || 'https://github.com/orvirx/game';
const SEP = '|::|';

const WEEKDAY_PLAN = {
  0: 'off',        // sunday — collect material
  1: 'build',      // monday — find of the week
  2: 'replies',    // tuesday — replies only, no post
  3: 'balance',    // wednesday — own test, what broke
  4: 'note',       // thursday — news with a personal angle
  5: 'broke',      // friday — a breakdown of a mistake
  6: 'note',       // saturday — light, human
};

// ---------------------------------------------------------------- facts

function git(args, fallback = '') {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  } catch {
    return fallback;
  }
}

function readLog() {
  if (!existsSync(LOG)) return { entries: [] };
  try { return JSON.parse(readFileSync(LOG, 'utf8')); } catch { return { entries: [] }; }
}

function gitFacts() {
  const log = readLog();
  const lastEntry = log.entries[log.entries.length - 1];
  const range = lastEntry && lastEntry.sha ? `${lastEntry.sha}..HEAD` : null;
  const logArgs = ['log', `--pretty=format:%h${SEP}%cI${SEP}%s`];
  if (range) logArgs.push(range); else logArgs.push('--max-count=40');
  const raw = git(logArgs);
  const commits = raw
    ? raw.split('\n').map((line) => {
        const [sha, date, subject] = line.split(SEP);
        return { sha, date, subject: subject ?? '' };
      })
    : [];
  // numstat over the same commit selection: works on a root commit too, where
  // sha~1 does not exist
  const statArgs = ['log', '--numstat', '--pretty=tformat:'];
  if (range) statArgs.push(range); else statArgs.push('--max-count=40');
  const churn = { insertions: 0, deletions: 0, files: new Map() };
  for (const line of git(statArgs).split('\n')) {
    const m = line.match(/^(\d+|-)\t(\d+|-)\t(.+)$/);
    if (!m) continue;
    const added = m[1] === '-' ? 0 : Number(m[1]);
    const removed = m[2] === '-' ? 0 : Number(m[2]);
    churn.insertions += added;
    churn.deletions += removed;
    churn.files.set(m[3], (churn.files.get(m[3]) || 0) + added + removed);
  }
  const ranked = [...churn.files.entries()].sort((a, b) => b[1] - a[1]);
  const fixes = commits.filter((c) => /^(fix|revert)[(:]/i.test(c.subject));
  return {
    commits: commits.length,
    filesChanged: churn.files.size,
    insertions: churn.insertions,
    deletions: churn.deletions,
    topFile: ranked.length ? ranked[0][0] : '',
    since: (lastEntry && lastEntry.date ? lastEntry.date : (commits[commits.length - 1] || {}).date || '').slice(0, 10),
    headSha: git(['rev-parse', '--short', 'HEAD']),
    subjects: commits.map((c) => c.subject),
    latestSubject: commits[0] ? commits[0].subject : '',
    fixSubjects: fixes.map((c) => c.subject),
    fixes: fixes.length,
  };
}

function simFacts() {
  if (!existsSync(SIM)) {
    throw new Error('no data/sim-latest.json — run `npm run sim` first');
  }
  return JSON.parse(readFileSync(SIM, 'utf8'));
}

function testFacts() {
  try {
    const out = execFileSync(process.execPath, [join(root, 'tools', 'test.js'), '--json'], {
      cwd: root, encoding: 'utf8',
    });
    return JSON.parse(out);
  } catch (e) {
    const out = e.stdout ? String(e.stdout) : '';
    try { return JSON.parse(out); } catch { return { passed: 0, failed: 0, total: 0 }; }
  }
}

function configFacts(cfg = DEFAULT_CONFIG) {
  return {
    gapStart: cfg.blocks.gapStart,
    gapMin: cfg.blocks.gapMin,
    gapShrink: cfg.blocks.gapShrink,
    spacing: cfg.blocks.spacing,
    playerSize: cfg.player.size,
    topSpeed: cfg.speed.max,
    gasLoss: cfg.sandwich.gasLoss,
    stunSeconds: Number((cfg.sandwich.stunFrames * cfg.dt).toFixed(2)),
    chaserEvery: cfg.bots.everyBlocks,
    tightWindow: cfg.tight.window,
    fps: Math.round(1 / cfg.dt),
  };
}

export function collectFacts() {
  return { git: gitFacts(), sim: simFacts(), tests: testFacts(), config: configFacts() };
}

// ------------------------------------------------------- receipts guard

const NUMBER = /\d+(?:\.\d+)?/g;

export function factNumbers(facts) {
  const out = new Set();
  const walk = (v) => {
    if (typeof v === 'number') {
      out.add(String(v));
      if (Number.isInteger(v)) out.add(v.toFixed(1));
      else out.add(String(Math.round(v)));
    } else if (typeof v === 'string') {
      for (const m of v.match(NUMBER) || []) out.add(m);
    } else if (v && typeof v === 'object') {
      for (const k of Object.keys(v)) {
        const inKey = k.match(NUMBER);
        if (inKey) out.add(inKey[0]);
        walk(v[k]);
      }
    }
  };
  walk(facts);
  out.delete('');
  return out;
}

export function checkNumbers(text, facts) {
  const known = factNumbers(facts);
  const used = text.match(NUMBER) || [];
  return used.filter((n) => !known.has(n));
}

// ------------------------------------------------------------ templates

const TEMPLATES = {
  balance: [
    (f) => `ran the bot through ${f.sim.runs} runs of the thing i'm building

median is ${f.sim.blocks.median} blocks, best run got ${f.sim.blocks.max}

every death is a wall, technically. but ${f.sim.deathsAfterSandwichPct}% of them
land within ${f.sim.sandwichBlameWindowSeconds}s of getting sandwiched`,

    (f) => `the chasers in my game don't kill you

they take ${f.config.gasLoss} gas and mush the controls for ${f.config.stunSeconds}s,
then you fly into a wall entirely by yourself

${f.sim.deathsAfterSandwichPct}% of deaths happen inside that window`,

    (f) => `gap starts at ${f.config.gapStart}px and shrinks ${f.config.gapShrink} a block
down to ${f.config.gapMin}, and the square you steer is ${f.config.playerSize}

${f.sim.runs} bot runs, median ${f.sim.blocks.median} blocks, p90 ${f.sim.blocks.p90}

is that a difficulty curve or a cliff with extra steps`,
  ],

  build: [
    (f) => `${f.commitWord} on the little game since ${f.git.since}

${f.git.insertions} lines in, ${f.git.deletions} out, across ${f.git.filesChanged} files

the biggest single chunk of that is ${f.git.topFile}`,

    (f) => `one thing today: ${f.git.latestSubject}

${f.git.insertions} lines for that, which feels like too many,
but the ${f.tests.total} tests still pass so it stays`,
  ],

  broke: [
    (f) => `broke it again: ${f.brokeSubject}

${f.tests.passed} of ${f.tests.total} tests passing now

the one that caught it replays the same seed twice and
compares the two states`,

    (f) => `${f.brokeSubject}

found it because the sim runs off a seed, and two runs
of the same seed stopped matching

no idea how long that would have taken by hand`,
  ],

  ship: [
    () => `small thing i made: a game about getting a transaction included

arrows move, space burns gas, the red squares aren't
trying to kill you, they're trying to make you miss

browser, no wallet, no install`,
  ],

  note: [
    (f) => f.note,
  ],
};

const REPLY_BUILDERS = {
  numbers: (f) => `numbers, because a claim without them is a mood:

${f.sim.runs} bot runs, median ${f.sim.blocks.median} blocks, p90 ${f.sim.blocks.p90},
longest run ${f.sim.seconds.max}s

tight-line rate ${f.sim.tightLineRate}%`,
  mechanic: () => `the chaser aims at where you'll be, not where you are,
so it leads you and an early dodge just feeds it

one line of code, most of the difficulty`,
  code: () => `the page and the headless sim run the same engine,
so anything i say about the balance is a number
i can re-run, not a feeling`,
  link: () => `playable here, source sits next to it

${PLAY_URL}`,
};

// -------------------------------------------------------------- assembly

function pick(list, salt) {
  let h = 0;
  for (let i = 0; i < salt.length; i++) h = (h * 31 + salt.charCodeAt(i)) >>> 0;
  return list[h % list.length];
}

export function buildDraft(kind, facts, opts = {}) {
  const f = { ...facts };
  f.commitWord = facts.git.commits === 1 ? '1 commit' : `${facts.git.commits} commits`;
  f.brokeSubject = facts.git.fixSubjects[0] || '';
  f.note = opts.note || '';
  const list = TEMPLATES[kind];
  if (!list) throw new Error(`unknown kind: ${kind}`);
  if (kind === 'build' && facts.git.commits === 0) {
    throw new Error('nothing committed since the last draft — there is nothing to report yet');
  }
  if (kind === 'broke' && !f.brokeSubject) {
    throw new Error('no fix commit to write about — this format reports a real one');
  }
  if (kind === 'note' && !f.note) {
    throw new Error('this format needs a real observation: pass --note="..." — it will not be invented');
  }
  const text = pick(list, `${opts.date || ''}${kind}`)(f).trim();
  const stray = checkNumbers(text, facts);
  if (stray.length && kind !== 'note') {
    throw new Error(`draft contains numbers with no source: ${stray.join(', ')}`);
  }
  return text;
}

export function buildThread(kind, facts, opts = {}) {
  const opener = buildDraft(kind, facts, opts);
  const names = ['numbers', 'mechanic', 'code'].slice(0, opts.replies || 2).concat(['link']);
  const replies = names.map((name) => REPLY_BUILDERS[name](facts).trim());
  return [opener, ...replies];
}

// ------------------------------------------------------------------ cli

function arg(name, fallback) {
  const hit = process.argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return fallback;
  return hit.includes('=') ? hit.split('=').slice(1).join('=') : true;
}

function report(parts) {
  let bad = false;
  parts.forEach((text, i) => {
    const kind = i === 0 ? 'opener' : 'reply';
    const res = lint(text, { kind });
    console.log(`\n--- ${kind}${parts.length > 1 ? ` ${i + 1} of ${parts.length}` : ''} · ${text.length} chars ---\n`);
    console.log(text);
    if (res.issues.length) console.log(`\nlint:\n${format(res.issues)}`);
    if (!res.ok) bad = true;
  });
  return !bad;
}

function save(kind, parts, facts) {
  mkdirSync(POSTS, { recursive: true });
  const date = new Date().toISOString().slice(0, 10);
  const file = join(POSTS, `${date}-${kind}.md`);
  const body = [
    '---',
    `date: ${date}`,
    `kind: ${kind}`,
    `head: ${facts.git.headSha}`,
    `sim_runs: ${facts.sim.runs}`,
    `tests: ${facts.tests.passed}/${facts.tests.total}`,
    '---',
    '',
    ...parts.map((p, i) => `## ${i === 0 ? 'opener' : `reply ${i}`}\n\n${p}\n`),
    '## receipts',
    '',
    '```json',
    JSON.stringify({ git: facts.git, sim: facts.sim, tests: facts.tests }, null, 2),
    '```',
    '',
  ].join('\n');
  writeFileSync(file, body);

  const log = readLog();
  log.entries.push({
    date: new Date().toISOString(),
    kind,
    sha: facts.git.headSha,
    file: `posts/${date}-${kind}.md`,
  });
  writeFileSync(LOG, JSON.stringify(log, null, 2) + '\n');
  return file;
}

if (process.argv[1] && process.argv[1].endsWith('devlog.js')) {
  const today = new Date();
  const planned = WEEKDAY_PLAN[today.getDay()];
  const kind = String(arg('kind', planned));

  if (kind === 'replies' || kind === 'off') {
    console.log(
      kind === 'replies'
        ? 'tuesday is replies only — no post today\nquota: 10-15 replies, aim at threads under an hour old\nwith a high comment-to-view ratio'
        : 'sunday is off — collect material, review bookmarks in analytics'
    );
    console.log('\noverride with --kind=balance | build | broke | ship | note');
    process.exit(0);
  }

  let facts;
  try {
    facts = collectFacts();
  } catch (e) {
    console.error(`refused: ${e.message}`);
    process.exit(1);
  }

  const opts = { note: arg('note', ''), date: today.toISOString().slice(0, 10) };
  let parts;
  try {
    parts = arg('thread', false) ? buildThread(kind, facts, opts) : [buildDraft(kind, facts, opts)];
  } catch (e) {
    console.error(`refused: ${e.message}`);
    process.exit(1);
  }

  const clean = report(parts);
  if (arg('save', false)) {
    console.log(`\nsaved ${save(kind, parts, facts)}`);
  }
  if (!clean) {
    console.log('\nlint found errors — fix the draft before posting');
    process.exit(2);
  }
}
