// the account's own formatting rules, encoded so a draft can be checked before
// it goes anywhere. rules come from the account context doc, section 3 and 9.

export const PROPER_NOUNS = [
  'OpenAI', 'Anthropic', 'GPT-6 Astra', 'Claude', 'GitHub', 'Chrome', 'Firefox',
  'Safari', 'X', 'JavaScript', 'Node', 'MCP', 'DexScreener', 'Discord', 'Telegram',
];

const HYPE = [
  'this changes everything', 'game changer', 'game-changer', 'to the moon',
  'next level', 'mind blowing', 'mind-blowing', 'insane', '100x', '10x gains',
  'you wont believe', "you won't believe", 'huge news', 'massive',
];

const ESSAY_CONNECTIVES = [
  'the interesting part is', "that's the whole trick", 'thats the whole trick',
  'worth noting', 'the part most people skip', 'in other words',
  'which is the point', 'the takeaway is', 'tl;dr', 'in summary',
];

const EMOJI = /\p{Extended_Pictographic}/u;
const TICKER = /\$[A-Za-z]{2,}/;
const THREAD_MARKER = /(^\s*\d{1,2}\s*\/\s*\d{0,2}\b)|(\b\d{1,2}\s*\/\s*\d{0,2}\s*$)/;

export function lint(text, opts = {}) {
  const issues = [];
  const err = (msg) => issues.push({ level: 'error', msg });
  const warn = (msg) => issues.push({ level: 'warn', msg });

  const lines = text.split('\n');
  const nonEmpty = lines.filter((l) => l.trim().length);
  const lower = text.toLowerCase();

  if (!nonEmpty.length) err('empty draft');
  if (text.length > 280) warn(`${text.length} chars — over the 280 free limit, premium only`);
  if (text.length > 4000) err(`${text.length} chars — over the hard limit`);

  const last = nonEmpty[nonEmpty.length - 1] ?? '';
  if (/\.$/.test(last.trim())) err('final line ends in a full stop');

  if (EMOJI.test(text)) err('emoji');
  if (TICKER.test(text)) err('ticker symbol');

  for (const line of lines) {
    if (THREAD_MARKER.test(line)) err(`thread marker: "${line.trim()}"`);
    if (line.length > 64) warn(`line over 64 chars: "${line.slice(0, 30)}…"`);
  }

  for (const phrase of HYPE) if (lower.includes(phrase)) err(`hype phrase: "${phrase}"`);
  for (const phrase of ESSAY_CONNECTIVES) if (lower.includes(phrase)) err(`essay connective: "${phrase}"`);

  // lowercase rule, with product names as the only exception
  let stripped = text;
  for (const noun of [...PROPER_NOUNS, ...(opts.extraNouns ?? [])]) {
    stripped = stripped.split(noun).join(' ');
  }
  const shouty = stripped.match(/\b[A-Z][A-Za-z]*\b/g);
  if (shouty) {
    const uniq = [...new Set(shouty)];
    err(`uppercase outside the allowlist: ${uniq.slice(0, 5).join(', ')}`);
  }

  if (opts.kind === 'opener' && /https?:\/\//.test(text)) {
    err('link in the opener — links belong in the last reply');
  }

  return { ok: !issues.some((i) => i.level === 'error'), issues };
}

export function format(issues) {
  return issues.map((i) => `  ${i.level === 'error' ? 'x' : '!'} ${i.msg}`).join('\n');
}
