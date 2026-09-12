// every tunable number lives here. the balance sim and the devlog generator
// both read this file, so a post about "the gap is now 34px" is checkable.

export const DEFAULT_CONFIG = {
  dt: 1 / 60,
  world: { width: 270, height: 270, ceil: 26, floor: 256 },
  player: {
    x: 62,
    size: 8,
    accel: 980,
    boostAccel: 2100,
    maxSpeed: 150,
    boostMaxSpeed: 250,
    friction: 7,
  },
  gas: { max: 100, start: 100, drain: 40, regen: 12, tightBonus: 10 },
  blocks: {
    spacing: 96,
    wallWidth: 14,
    gapStart: 92,
    gapMin: 34,
    gapShrink: 2.0,
    maxGapDelta: 42,
    firstX: 310,
  },
  speed: { start: 88, perBlock: 2.2, max: 260 },
  bots: { firstBlock: 6, everyBlocks: 3, speed: 60, size: 7, lead: 0.35, gain: 3 },
  sandwich: { gasLoss: 35, stunFrames: 20, stunAccel: 0.35, blameFrames: 90 },
  tight: { window: 12 },
  score: { perBlock: 10, tightBonus: 5, maxComboBonus: 5 },
};

export function cloneConfig(cfg = DEFAULT_CONFIG) {
  return JSON.parse(JSON.stringify(cfg));
}
