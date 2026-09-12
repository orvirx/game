// scripted policy. used by the balance sim and by the attract mode on the page.
// it is a plain function of the state, so a sim run is reproducible from a seed.
//
// two jobs, in priority order: dodge a chaser that is about to reach the player
// column, otherwise line up on the centre of the next gap.

export function botInput(s, opts = {}) {
  const cfg = s.cfg;
  const p = s.player;
  const px = cfg.player.x;
  const deadzone = opts.deadzone ?? 4;
  const dodgeTime = opts.dodgeTime ?? 0.5;
  const dodgeRange = opts.dodgeRange ?? 26;
  const boostAt = opts.boostAt ?? 22;
  const gasFloor = opts.gasFloor ?? 25;
  const noise = opts.noise ?? 0;

  let next = null;
  for (const b of s.blocks) {
    if (b.x + cfg.blocks.wallWidth <= px - cfg.player.size / 2) continue;
    if (!next || b.x < next.x) next = b;
  }
  let target = next ? next.gapY : (cfg.world.ceil + cfg.world.floor) / 2;
  const room = next ? Math.max(0, next.gapH / 2 - cfg.player.size / 2 - 1) : 0;

  // nearest chaser about to arrive at the player column
  let threat = null;
  for (const bot of s.bots) {
    const tc = (bot.x - px) / Math.max(1, s.speed);
    if (tc < -0.1 || tc > dodgeTime) continue;
    if (Math.abs(bot.y - p.y) > dodgeRange + 20) continue;
    if (!threat || tc < threat.tc) threat = { bot, tc };
  }

  let urgent = false;
  if (threat) {
    const away = p.y >= threat.bot.y ? 1 : -1;
    const escape = p.y + away * (dodgeRange + 14);
    // stay inside the gap if a wall is also arriving
    const wallClose = next && (next.x - px) / Math.max(1, s.speed) < 0.55;
    target = wallClose ? clampTo(escape, next.gapY - room, next.gapY + room) : escape;
    urgent = Math.abs(target - p.y) > 2;
  }

  const err = target - p.y + noise;
  const want = err * 4 - p.vy * 0.9;
  return {
    up: want < -deadzone,
    down: want > deadzone,
    boost: (urgent || Math.abs(err) > boostAt) && s.gas > gasFloor,
  };
}

function clampTo(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}
