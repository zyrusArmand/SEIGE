// Every gameplay number lives here, so balance changes are one-line edits.
export const CONFIG = {
  match: {
    seconds: 180,          // one match = 3:00
    bloodMoonAt: 30,       // blood moon for the last 30 s
    bloodMoonFade: 3,      // seconds for the moonlight to turn red
    bloodMoonMult: 2,      // all damage x2 during blood moon
  },

  grid: { cols: 6, rows: 3, cell: 1.5, levelHeight: 0.8, blockWidth: 1.3, floor: 0.24, maxLevel: 2 },
  castles: { youZ0: 5.25, rivalZ0: -8.25 },  // z of row 0 for each castle

  // c, r, type, level. Rival gets the mirror image.
  startLayout: [
    [0, 2, 'stone', 1], [1, 2, 'wood', 1], [4, 2, 'wood', 1], [5, 2, 'stone', 1],
    [0, 0, 'stone', 1], [5, 0, 'stone', 1], [2, 1, 'bone', 1], [3, 1, 'wood', 1],
  ],

  blocks: {
    wood:  { cost: 1, hp: 40 },
    stone: { cost: 3, hp: 100 },
    bone:  { cost: 3, hp: 70, healPerSec: 2 },
    turret: { cost: 4, hp: 55 },   // HP per level; a turret always fills its square (counts as 2 levels)
  },
  archChance: 0.35,        // ground-level stone blocks that get the torch-lit doorway look

  attacks: {
    rock:     { cost: 2, damage: 60 },
    termites: { cost: 3, dps: 3, duration: 30, perfectDps: 4.5 },
    perfectRadius: 0.38,   // within this of a square's center = perfect hit
    perfectMult: 1.5,
    gravity: 16,
    dropInherit: 0.6,      // share of the bat's velocity the cargo keeps
  },

  moths: {
    spawnMin: 0.8, spawnMax: 1.3, bloodSpawn: 0.6,
    max: 12, startCount: 6,
    areaX: 5.4, areaZ: 3.9,
    comebackPull: 7,       // spawns drift toward the losing side by lead * this
    eatRadius: 0.9,
  },

  bat: {
    maxSpeed: 6.6, aiMaxSpeed: 5.6, accel: 4.5, keyAccel: 5,
    height: 2.8, bob: 0.08,
    boundsX: 6.3, boundsZ: 10.4,
    homeMargin: 0.6,       // how far outside the walls still counts as "home"
    slowRadius: 1.6,       // starts braking this far from the touch point
  },

  // Ghost turret: a block you buy. It zaps the enemy bat when it comes close (guard),
  // otherwise it lobs ghost shells at the rival block you picked.
  ghost: {
    range: 7.2, cooldownMin: 2.0, cooldownMax: 2.6,
    orbSpeed: 5.2, orbSteer: 1.6, orbLife: 2.6, hitRadius: 0.6,
    stun: 1.2, mothPenalty: 1,
    shellEvery: 3.2, shellDamage: 16, shellSpeed: 9, maxTurrets: 2, turnSpeed: 4,
  },

  ai: {
    thinkMin: 0.6, thinkMax: 1.1,
    buildEvery: 0.55,
    buildAt: 4, buildAlwaysAt: 7,
    raidAt: 2, raidLead: 0.08,
    termiteChance: 0.4,
    turretChance: 0.45,
    dropRadius: 0.35, dropMaxSpeed: 1.6,
  },
};
export const COST = {
  wood: CONFIG.blocks.wood.cost, stone: CONFIG.blocks.stone.cost, bone: CONFIG.blocks.bone.cost,
  turret: CONFIG.blocks.turret.cost,
  rock: CONFIG.attacks.rock.cost, termites: CONFIG.attacks.termites.cost,
};
