// Bat Siege game rules. Plain JavaScript, no rendering.
// The renderer reads `game` every frame and drains `game.events` for effects and sounds.
import { CONFIG, COST } from './config.js';

const G = CONFIG.grid;
const rnd = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const hyp = Math.hypot;

export const POND = { x: 3.9, z: 2.4, r: 1.75 };
export const cellX = (c) => -G.cols * G.cell / 2 + G.cell / 2 + c * G.cell;

export function cellPos(castle, c, r) {
  return { x: cellX(c), y: G.floor, z: castle.z0 + r * G.cell };
}
export function cellAt(castle, x, z) {
  const c = Math.round((x - cellX(0)) / G.cell), r = Math.round((z - castle.z0) / G.cell);
  if (c < 0 || c >= G.cols || r < 0 || r >= G.rows) return null;
  return { c, r, dx: x - cellX(c), dz: z - (castle.z0 + r * G.cell) };
}
export function inCastle(castle, x, z, m = 0) {
  return Math.abs(x) <= G.cols * G.cell / 2 + m &&
    z >= castle.z0 - G.cell / 2 - m && z <= castle.z0 + G.cell * (G.rows - 0.5) + m;
}
export function maxHp(b) { return b.level * CONFIG.blocks[b.type].hp; }
export function blockTop(castle, c, r) {
  const b = castle.cells[r][c];
  return G.floor + (b ? b.level * G.levelHeight : 0);
}
export function completion(castle) {
  let s = 0;
  for (const row of castle.cells) for (const b of row) if (b) s += b.level;
  return s / (G.cols * G.rows * G.maxLevel);
}

let nextId = 1;

function makeCastle(side, z0) {
  const cells = [];
  for (let r = 0; r < G.rows; r++) cells.push(new Array(G.cols).fill(null));
  return { side, z0, cz: z0 + G.cell, cells, target: null };   // target: rival square our turrets bombard
}

export function turretCount(castle) {
  let n = 0;
  for (const row of castle.cells) for (const b of row) if (b && b.type === 'turret') n++;
  return n;
}

function makeBat(side) {
  return {
    side, pos: { x: 0, y: CONFIG.bat.height, z: 0 }, vel: { x: 0, z: 0 }, target: { x: 0, z: 0 },
    yaw: side === 'you' ? Math.PI : 0, roll: 0, flap: Math.random() * 6, stun: 0, carrying: null,
    moths: 0, home: false, speed: 0,
  };
}

export class Game {
  constructor() {
    this.you = makeCastle('you', CONFIG.castles.youZ0);
    this.rival = makeCastle('rival', CONFIG.castles.rivalZ0);
    this.player = makeBat('you');
    this.foe = makeBat('rival');
    this.moths = []; this.falling = []; this.orbs = []; this.shells = []; this.infests = [];
    this.events = [];
    this.state = 'menu';
    this.input = { move: { x: 0, z: 0 } };   // joystick / keys, length 0..1
    this.reset();
  }

  emit(type, data = {}) { this.events.push({ type, ...data }); }

  reset() {
    const L = CONFIG.startLayout;
    this.resetCastle(this.you, L);
    this.resetCastle(this.rival, L.map(([c, r, t, l]) => [G.cols - 1 - c, G.rows - 1 - r, t, l]));
    for (const b of [this.player, this.foe]) {
      b.vel.x = b.vel.z = 0; b.stun = 0; b.moths = 0; b.carrying = null; b.roll = 0;
    }
    Object.assign(this.player.pos, { x: -1.5, z: 3.6 }); Object.assign(this.player.target, { x: -1.5, z: 3.6 });
    Object.assign(this.foe.pos, { x: 1.5, z: -3.6 }); Object.assign(this.foe.target, { x: 1.5, z: -3.6 });
    this.player.yaw = Math.PI; this.foe.yaw = 0;
    this.moths.length = 0; this.falling.length = 0; this.orbs.length = 0; this.shells.length = 0; this.infests.length = 0;
    this.you.target = null; this.rival.target = null;
    for (let i = 0; i < CONFIG.moths.startCount; i++) this.spawnMoth(true);
    this.timeLeft = CONFIG.match.seconds; this.blood = false; this.bloodT = 0;
    this.spawnT = 0; this.elapsed = 0; this.goldenT = rnd(14, 20);
    this.streak = { n: 0, t: 0 };
    this.stats = { moths: 0, broken: 0, perfect: 0, built: 0 };
    this.ai = { mode: 'gather', think: 0, buildT: 0, targetCell: null };
    this.outcome = null;
    this.input.move.x = this.input.move.z = 0;
    this.emit('reset');
  }

  resetCastle(castle, layout) {
    for (const row of castle.cells) row.fill(null);
    for (const [c, r, t, l] of layout) {
      this.placeBlock(castle, c, r, t, true);
      if (l === 2) this.placeBlock(castle, c, r, t, true);
    }
  }

  start() { this.state = 'play'; this.emit('start'); }

  // ------------------------------------------------------------------ building
  canPlace(castle, c, r, type) {
    const b = castle.cells[r][c];
    if (type === 'turret') return !b && turretCount(castle) < CONFIG.ghost.maxTurrets;
    return !b || (b.type === type && b.level < G.maxLevel);
  }

  placeBlock(castle, c, r, type, silent = false) {
    const cur = castle.cells[r][c];
    if (type === 'turret') {
      if (cur) return false;
      castle.cells[r][c] = {
        id: nextId++, type, level: G.maxLevel, hp: G.maxLevel * CONFIG.blocks.turret.hp, pop: silent ? 0 : 0.35, shake: 0,
        arch: false, healFx: 0, cd: rnd(1, 2), yaw: castle.side === 'you' ? Math.PI : 0, fire: 0,
      };
      if (!silent) this.emit('place', { side: castle.side, c, r, blockType: type, level: G.maxLevel });
      return true;
    }
    if (cur) {
      if (cur.type !== type || cur.level >= G.maxLevel) return false;
      cur.level++; cur.hp += CONFIG.blocks[type].hp; cur.pop = 0.35;
    } else {
      castle.cells[r][c] = {
        id: nextId++, type, level: 1, hp: CONFIG.blocks[type].hp, pop: silent ? 0 : 0.35, shake: 0,
        arch: type === 'stone' && Math.random() < CONFIG.archChance, healFx: 0,
      };
    }
    if (!silent) this.emit('place', { side: castle.side, c, r, blockType: type, level: castle.cells[r][c].level });
    return true;
  }

  /** Player taps a castle square with a block selected. Returns an error string or null. */
  tryBuild(c, r, type) {
    const p = this.player, b = this.you.cells[r][c];
    if (!p.home) return 'Fly home to place blocks';
    if (type === 'turret') {
      if (b) return 'Turrets go on an empty square';
      if (turretCount(this.you) >= CONFIG.ghost.maxTurrets) return `Max ${CONFIG.ghost.maxTurrets} turrets`;
    }
    if (b && b.type === 'turret') return 'That square has a turret';
    if (b && b.type !== type) return `Stack ${b.type} on ${b.type}`;
    if (b && b.level >= G.maxLevel) return 'That square is maxed out';
    if (p.moths < COST[type]) return `Need ${COST[type]} moths`;
    p.moths -= COST[type];
    this.placeBlock(this.you, c, r, type);
    this.stats.built++;
    return null;
  }

  /** Player taps Rock or Termites. Returns an error string or null. */
  tryLoad(type) {
    const p = this.player;
    if (p.carrying) return 'Drop what you are carrying first';
    if (p.stun > 0) return 'Still dizzy!';
    if (!p.home) return 'Load attacks while over your castle';
    if (p.moths < COST[type]) return `Need ${COST[type]} moths`;
    p.moths -= COST[type]; p.carrying = type;
    this.emit('load', { side: 'you', cargo: type });
    return null;
  }

  /** Player taps a rival square: every turret we own bombards it. Returns an error string or null. */
  setTarget(c, r) {
    if (turretCount(this.you) === 0) return 'Build a turret to bombard their castle';
    if (!this.rival.cells[r][c]) return 'Pick a rival block to aim at';
    this.you.target = { c, r };
    this.emit('target', { side: 'you', c, r });
    return null;
  }

  playerDrop() {
    if (this.state !== 'play' || !this.player.carrying || this.player.stun > 0) return;
    this.dropCargo(this.player);
  }

  dropCargo(bat) {
    if (!bat.carrying) return;
    const k = CONFIG.attacks.dropInherit;
    const f = {
      id: nextId++, type: bat.carrying, owner: bat.side,
      pos: { x: bat.pos.x, y: bat.pos.y - 0.55, z: bat.pos.z },
      vel: { x: bat.vel.x * k, y: -0.5, z: bat.vel.z * k },
      rot: { x: 0, y: 0, z: 0 }, spin: { x: rnd(-4, 4), y: rnd(-4, 4), z: rnd(-4, 4) },
    };
    this.falling.push(f);
    bat.carrying = null;
    this.emit('drop', { side: bat.side, falling: f });
  }

  /** Where a drop would land right now (for the landing ring). */
  predictLanding(bat) {
    const A = CONFIG.attacks;
    const h = bat.pos.y - 0.55 - 0.3;
    const t = Math.sqrt(2 * Math.max(0.2, h) / A.gravity);
    const x = bat.pos.x + bat.vel.x * A.dropInherit * t, z = bat.pos.z + bat.vel.z * A.dropInherit * t;
    const enemy = bat.side === 'you' ? this.rival : this.you;
    let y = 0.12, onTarget = false, perfect = false;
    if (inCastle(enemy, x, z, 0)) {
      const cl = cellAt(enemy, x, z);
      if (cl && enemy.cells[cl.r][cl.c]) {
        y = blockTop(enemy, cl.c, cl.r) + 0.02; onTarget = true;
        perfect = hyp(cl.dx, cl.dz) < A.perfectRadius;
      } else if (cl) y = G.floor + 0.02;
    }
    return { x, y, z, onTarget, perfect };
  }

  // ------------------------------------------------------------------ damage
  damageBlock(castle, c, r, amt, byPlayer) {
    const b = castle.cells[r][c]; if (!b) return false;
    const hpPer = CONFIG.blocks[b.type].hp;
    b.hp -= amt; b.shake = Math.max(b.shake, amt > 5 ? 0.35 : 0.12);
    while (b.type !== 'turret' && b.level > 1 && b.hp <= (b.level - 1) * hpPer) {
      b.level--;
      this.emit('levelBreak', { side: castle.side, c, r, blockType: b.type, level: b.level });
    }
    if (b.hp <= 0) {
      castle.cells[r][c] = null;
      this.emit('destroy', { side: castle.side, c, r, blockType: b.type });
      if (byPlayer) this.stats.broken++;
      return true;
    }
    return false;
  }

  resolveImpact(f) {
    const p = f.pos;
    const target = p.z < -1 ? this.rival : this.you;
    const own = target.side === f.owner;
    const cl = inCastle(target, p.x, p.z, 0) ? cellAt(target, p.x, p.z) : null;
    const mult = this.blood ? CONFIG.match.bloodMoonMult : 1;
    const byP = f.owner === 'you';
    const A = CONFIG.attacks;
    if (!cl || own || !target.cells[cl.r][cl.c]) {
      this.emit('miss', { pos: { ...p }, cargo: f.type, byPlayer: byP, own });
      return;
    }
    const perfect = hyp(cl.dx, cl.dz) < A.perfectRadius;
    if (f.type === 'rock') {
      const dmg = Math.round(A.rock.damage * (perfect ? A.perfectMult : 1) * mult);
      this.emit('hit', { pos: { ...p }, cargo: 'rock', dmg, byPlayer: byP, perfect, side: target.side, c: cl.c, r: cl.r });
      this.damageBlock(target, cl.c, cl.r, dmg, byP);
    } else {
      this.infest(target, cl.c, cl.r, perfect ? A.termites.perfectDps : A.termites.dps);
      this.emit('hit', { pos: { ...p }, cargo: 'termites', byPlayer: byP, perfect, side: target.side, c: cl.c, r: cl.r });
    }
    if (perfect && byP) this.stats.perfect++;
  }

  infest(castle, c, r, dps) {
    if (!castle.cells[r][c]) return;
    const ex = this.infests.find((f) => f.castle === castle && f.c === c && f.r === r);
    if (ex) { ex.t = CONFIG.attacks.termites.duration; ex.dps = Math.max(ex.dps, dps); return; }
    this.infests.push({ id: nextId++, castle, c, r, t: CONFIG.attacks.termites.duration, dps, chomp: 0 });
  }

  // ------------------------------------------------------------------ moths
  spawnMoth(initial = false) {
    const M = CONFIG.moths;
    const lead = completion(this.you) - completion(this.rival);
    let x, z, tries = 0;
    do {
      x = rnd(-M.areaX, M.areaX);
      z = clamp(rnd(-M.areaZ, M.areaZ) - lead * M.comebackPull, -M.areaZ, M.areaZ);
      tries++;
    } while (hyp((x - POND.x) / 1.3, z - POND.z) < 1.6 && tries < 20);
    const home = { x, y: rnd(2.2, 2.9), z };
    this.moths.push({ id: nextId++, home, pos: { ...home }, t: Math.random() * 10, born: initial ? 0.6 : 0, golden: false });
  }

  spawnGolden() {
    const home = { x: rnd(-2.5, 2.5), y: 2.6, z: rnd(-1.2, 1.2) };
    const m = { id: nextId++, home, pos: { ...home }, t: 0, born: 0, golden: true, life: CONFIG.moths.goldenLife };
    this.moths.push(m);
    this.emit('golden', { pos: { ...home } });
  }

  // ------------------------------------------------------------------ bats
  updateBat(bat, dt, maxSpd, isPlayer) {
    const B = CONFIG.bat;
    // wing-beat phase: quicker, choppier beats when hovering, longer strokes at speed
    bat.flap += dt * (bat.stun > 0 ? 9 : 14.5 - Math.min(bat.speed, 6.6) * 0.5);
    if (bat.stun > 0) {
      bat.stun -= dt;
      const k = 1 - Math.min(1, 2.5 * dt); bat.vel.x *= k; bat.vel.z *= k;
    } else {
      let tx, tz, a;
      if (isPlayer && this.state !== 'menu') {
        const m = this.input.move, l = hyp(m.x, m.z), s = l > 1 ? 1 / l : 1;
        tx = m.x * s * maxSpd; tz = m.z * s * maxSpd; a = B.keyAccel;
      } else {
        const dx = bat.target.x - bat.pos.x, dz = bat.target.z - bat.pos.z, d = hyp(dx, dz);
        if (d > 0.05) { const s = maxSpd * Math.min(1, d / B.slowRadius) / d; tx = dx * s; tz = dz * s; } else { tx = 0; tz = 0; }
        a = B.accel;
      }
      const k = Math.min(1, a * dt);
      bat.vel.x += (tx - bat.vel.x) * k; bat.vel.z += (tz - bat.vel.z) * k;
    }
    bat.pos.x = clamp(bat.pos.x + bat.vel.x * dt, -B.boundsX, B.boundsX);
    bat.pos.z = clamp(bat.pos.z + bat.vel.z * dt, -B.boundsZ, B.boundsZ);
    const sinkTarget = bat.stun > 0 ? -0.5 : 0;
    bat.sink = (bat.sink || 0) + (sinkTarget - (bat.sink || 0)) * Math.min(1, dt * 6);
    bat.pos.y = B.height + Math.sin(bat.flap * 0.5) * B.bob + bat.sink;
    const sp = hyp(bat.vel.x, bat.vel.z); bat.speed = sp;
    if (sp > 0.3) {
      const yaw = Math.atan2(bat.vel.x, bat.vel.z);
      let dy = yaw - bat.yaw;
      while (dy > Math.PI) dy -= Math.PI * 2; while (dy < -Math.PI) dy += Math.PI * 2;
      bat.yaw += dy * Math.min(1, 6 * dt);
      bat.roll += (-dy * 1.2 - bat.roll) * Math.min(1, 5 * dt);
    } else bat.roll += (0 - bat.roll) * Math.min(1, 4 * dt);
    const castle = isPlayer ? this.you : this.rival;
    const wasHome = bat.home;
    bat.home = inCastle(castle, bat.pos.x, bat.pos.z, B.homeMargin);
    if (isPlayer && wasHome !== bat.home && this.state === 'play') this.emit(bat.home ? 'arriveHome' : 'leaveHome');
  }

  // ------------------------------------------------------------------ bat vs bat
  checkBump() {
    const B = CONFIG.bat, a = this.player, b = this.foe;
    if (a.stun > 0 || b.stun > 0 || (this.bumpT || 0) > this.elapsed) return;
    const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z, d = hyp(dx, dz);
    if (d > B.bumpRadius || d < 0.001) return;
    const nx = dx / d, nz = dz / d;
    // who hit whom: the bat moving harder toward the other one
    const va = a.vel.x * nx + a.vel.z * nz, vb = -(b.vel.x * nx + b.vel.z * nz);
    if (Math.max(va, vb) < B.bumpMinSpeed) return;
    const [hitter, victim, sx, sz] = va >= vb ? [a, b, nx, nz] : [b, a, -nx, -nz];
    victim.stun = B.bumpStun;
    victim.vel.x = sx * B.bumpPush; victim.vel.z = sz * B.bumpPush;
    hitter.vel.x *= 0.3; hitter.vel.z *= 0.3;
    const dropped = victim.carrying;
    if (dropped) this.dropCargo(victim);
    const stole = victim.moths > 0 ? 1 : 0;
    victim.moths -= stole; hitter.moths += stole;
    this.bumpT = this.elapsed + B.bumpCooldown;
    this.emit('bump', { hitter: hitter.side, victim: victim.side, pos: { x: (a.pos.x + b.pos.x) / 2, y: a.pos.y, z: (a.pos.z + b.pos.z) / 2 }, stole, dropped });
  }

  // ------------------------------------------------------------------ AI
  nearestMoth(bat) {
    let best = null, bd = 1e9;
    for (const m of this.moths) {
      const d = (bat.pos.x - m.pos.x) ** 2 + (bat.pos.z - m.pos.z) ** 2 + (m.pos.z > 2 ? 6 : 0) - (m.golden ? 40 : 0);
      if (d < bd) { bd = d; best = m; }
    }
    return best;
  }

  aiThink(dt) {
    const AI = this.ai, foe = this.foe, C = CONFIG.ai;
    AI.think -= dt; AI.buildT -= dt;
    if (foe.stun > 0) return;
    if (foe.carrying) {
      if (!AI.targetCell || !this.you.cells[AI.targetCell.r][AI.targetCell.c]) {
        const list = [];
        for (let r = 0; r < G.rows; r++) for (let c = 0; c < G.cols; c++) {
          const b = this.you.cells[r][c];
          if (b) list.push({ c, r, score: b.level * 2 + (b.type === 'turret' ? 3 : 0) + Math.random() * 2 });
        }
        list.sort((a, b) => b.score - a.score);
        AI.targetCell = list[0] || { c: 2, r: 1 };
      }
      const p = cellPos(this.you, AI.targetCell.c, AI.targetCell.r);
      foe.target.x = p.x; foe.target.z = p.z;
      if (hyp(foe.pos.x - p.x, foe.pos.z - p.z) < C.dropRadius && foe.speed < C.dropMaxSpeed) {
        this.dropCargo(foe); AI.targetCell = null; AI.mode = 'gather';
      }
      return;
    }
    const myC = completion(this.rival), yourC = completion(this.you);
    if (AI.think <= 0) {
      AI.think = rnd(C.thinkMin, C.thinkMax);
      if (turretCount(this.rival) && !this.rival.target) {
        let best = null, bs = -1;
        for (let r = 0; r < G.rows; r++) for (let c = 0; c < G.cols; c++) {
          const b = this.you.cells[r][c];
          if (b) { const sc = b.level + (b.type === 'turret' ? 3 : 0) + Math.random(); if (sc > bs) { bs = sc; best = { c, r }; } }
        }
        this.rival.target = best;
      }
      if (AI.mode === 'gather') {
        if (foe.moths >= C.buildAt && Math.random() < 0.5) AI.mode = (myC < yourC + 0.04 || Math.random() < 0.45) ? 'build' : 'raid';
        else if (foe.moths >= C.raidAt && (myC > yourC + C.raidLead || Math.random() < C.raidChance) && Math.random() < 0.5) AI.mode = 'raid';
        else if (foe.moths >= C.buildAlwaysAt) AI.mode = 'build';
      }
    }
    // you're carrying cargo close by: try to ram you and make you drop it
    const pl = this.player;
    if (pl.carrying && pl.stun <= 0 && hyp(pl.pos.x - foe.pos.x, pl.pos.z - foe.pos.z) < C.bumpChaseRange) {
      foe.target.x = pl.pos.x + pl.vel.x * 0.3; foe.target.z = pl.pos.z + pl.vel.z * 0.3;
      return;
    }
    if (AI.mode === 'gather') {
      const m = this.nearestMoth(foe);
      if (m) { foe.target.x = m.pos.x; foe.target.z = m.pos.z; } else { foe.target.x = Math.sin(this.elapsed * 0.3) * 3; foe.target.z = -2; }
      return;
    }
    foe.target.x = Math.sin(this.elapsed * 0.7) * 1.8; foe.target.z = this.rival.cz + 0.6;
    if (!foe.home || AI.buildT > 0) return;
    AI.buildT = C.buildEvery;
    if (AI.mode === 'raid') {
      const t = foe.moths >= COST.termites && Math.random() < C.termiteChance ? 'termites' : 'rock';
      if (foe.moths >= COST[t]) { foe.moths -= COST[t]; foe.carrying = t; this.emit('load', { side: 'rival', cargo: t }); }
      else AI.mode = 'gather';
      return;
    }
    if (foe.moths >= COST.turret && turretCount(this.rival) < 1 && Math.random() < C.turretChance) {
      for (const r of [0, 1, 2]) for (const c of [2, 3, 1, 4, 0, 5]) {
        if (!this.rival.cells[r][c]) { foe.moths -= COST.turret; this.placeBlock(this.rival, c, r, 'turret'); return; }
      }
    }
    const opts = [];
    for (let r = 0; r < G.rows; r++) for (let c = 0; c < G.cols; c++) {
      const b = this.rival.cells[r][c];
      if (!b || (b.type !== 'turret' && b.level < G.maxLevel)) opts.push({ c, r, b, k: (b ? 1 : 0) + Math.random() - 0.5 });
    }
    if (!opts.length || foe.moths < 1) { AI.mode = 'gather'; return; }
    opts.sort((a, b) => a.k - b.k);
    const o = opts[0];
    let t = o.b ? o.b.type : (foe.moths >= 3 && Math.random() < 0.5 ? (Math.random() < 0.3 ? 'bone' : 'stone') : 'wood');
    if (foe.moths < COST[t]) { if (!o.b) t = 'wood'; else { AI.mode = 'gather'; return; } }
    if (foe.moths >= COST[t]) { foe.moths -= COST[t]; this.placeBlock(this.rival, o.c, o.r, t); }
    else AI.mode = 'gather';
  }

  // ------------------------------------------------------------------ main step
  update(dt) {
    this.elapsed += dt;
    const playing = this.state === 'play';
    const M = CONFIG.moths;

    if (playing) {
      this.timeLeft -= dt;
      if (!this.blood && this.timeLeft <= CONFIG.match.bloodMoonAt) { this.blood = true; this.emit('bloodMoon'); }
      if (this.timeLeft <= 0) {
        this.timeLeft = 0;
        const a = completion(this.you), b = completion(this.rival);
        this.end(Math.abs(a - b) < 0.001 ? 'draw' : a > b ? 'win' : 'lose');
      }
      this.spawnT -= dt;
      if (this.spawnT <= 0 && this.moths.length < M.max) { this.spawnMoth(); this.spawnT = this.blood ? M.bloodSpawn : rnd(M.spawnMin, M.spawnMax); }
      this.aiThink(dt);
      this.goldenT -= dt;
      if (this.goldenT <= 0) { this.goldenT = rnd(...M.goldenEvery); if (!this.moths.some((m) => m.golden)) this.spawnGolden(); }
    }
    if (this.blood) this.bloodT = Math.min(1, this.bloodT + dt / CONFIG.match.bloodMoonFade);

    if (this.state === 'menu') {
      const e = this.elapsed;
      Object.assign(this.foe.target, { x: Math.sin(e * 0.4) * 3, z: -2 + Math.cos(e * 0.5) * 1.5 });
      Object.assign(this.player.target, { x: Math.cos(e * 0.35) * 3, z: 2.5 + Math.sin(e * 0.6) });
    }
    this.updateBat(this.player, dt, CONFIG.bat.maxSpeed, this.state !== 'menu');
    this.updateBat(this.foe, dt, playing ? CONFIG.bat.aiMaxSpeed : 2.2, false);

    // moths: hover, scatter away from nearby bats, get eaten
    this.streak.t -= dt;
    for (let i = this.moths.length - 1; i >= 0; i--) {
      const m = this.moths[i]; m.t += dt; m.born = Math.min(1, m.born + dt * 2.5);
      if (playing) {
        for (const b of [this.player, this.foe]) {
          const dx = m.home.x - b.pos.x, dz = m.home.z - b.pos.z, d = hyp(dx, dz);
          if (d < M.fleeRadius && d > 0.01) {
            const sp = (m.golden ? M.goldenFlee : M.fleeSpeed) * (1 - d / M.fleeRadius) * 1.6;
            m.home.x = clamp(m.home.x + dx / d * sp * dt, -M.areaX - 0.6, M.areaX + 0.6);
            m.home.z = clamp(m.home.z + dz / d * sp * dt, -M.areaZ - 1.2, M.areaZ + 1.2);
          }
        }
        if (m.golden) {
          m.life -= dt;
          if (m.life <= 0) { this.emit('goldenGone', { pos: { ...m.pos } }); this.moths.splice(i, 1); continue; }
        }
      }
      const wob = m.golden ? 1.4 : 1;
      m.pos.x = m.home.x + Math.sin(m.t * 1.3 * wob) * 0.45;
      m.pos.y = m.home.y + Math.sin(m.t * 2.1) * 0.2;
      m.pos.z = m.home.z + Math.cos(m.t * 1.1 * wob) * 0.35;
      if (!playing) continue;
      let eater = null;
      for (const b of [this.player, this.foe]) {
        if (b.stun <= 0 && hyp(b.pos.x - m.pos.x, b.pos.z - m.pos.z) < M.eatRadius) { eater = b; break; }
      }
      if (eater) {
        const value = m.golden ? M.goldenValue : 1;
        eater.moths += value;
        if (eater === this.player) {
          this.stats.moths += value;
          this.streak.n = this.streak.t > 0 ? this.streak.n + 1 : 1;
          this.streak.t = M.streakWindow;
        }
        this.emit('mothEaten', { side: eater.side, pos: { ...m.pos }, golden: m.golden, value, streak: eater === this.player ? this.streak.n : 0 });
        if (eater === this.player && !m.golden && this.streak.n % M.streakEvery === 0) {
          eater.moths++; this.stats.moths++;
          this.emit('streak', { n: this.streak.n, pos: { ...eater.pos } });
        }
        this.moths.splice(i, 1);
      }
    }

    if (playing) this.checkBump();

    // blocks: animation timers + bone healing
    for (const castle of [this.you, this.rival]) {
      for (let r = 0; r < G.rows; r++) for (let c = 0; c < G.cols; c++) {
        const b = castle.cells[r][c]; if (!b) continue;
        if (b.pop > 0) b.pop = Math.max(0, b.pop - dt);
        if (b.shake > 0) b.shake = Math.max(0, b.shake - dt);
        if (playing && b.type === 'bone') {
          for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const n = castle.cells[r + dr] && castle.cells[r + dr][c + dc];
            if (n && n.hp < maxHp(n)) {
              n.hp = Math.min(maxHp(n), n.hp + CONFIG.blocks.bone.healPerSec * dt);
              n.healFx += dt;
              if (n.healFx > 0.7) { n.healFx = 0; this.emit('heal', { side: castle.side, c: c + dc, r: r + dr }); }
            }
          }
        }
      }
      this.updateTurrets(castle, dt, playing);
    }

    // ghost orbs
    const GH = CONFIG.ghost;
    for (let i = this.orbs.length - 1; i >= 0; i--) {
      const o = this.orbs[i]; o.life -= dt;
      const t = o.target.pos;
      let dx = t.x - o.pos.x, dy = t.y - o.pos.y, dz = t.z - o.pos.z;
      const d = Math.hypot(dx, dy, dz) || 1;
      const k = Math.min(1, dt * GH.orbSteer);
      o.vel.x += (dx / d * GH.orbSpeed - o.vel.x) * k;
      o.vel.y += (dy / d * GH.orbSpeed - o.vel.y) * k;
      o.vel.z += (dz / d * GH.orbSpeed - o.vel.z) * k;
      o.pos.x += o.vel.x * dt; o.pos.y += o.vel.y * dt; o.pos.z += o.vel.z * dt;
      if (d < GH.hitRadius && o.target.stun <= 0 && playing) {
        const bat = o.target; bat.stun = GH.stun;
        if (bat.carrying) this.dropCargo(bat);
        const lost = Math.min(bat.moths, GH.mothPenalty); bat.moths -= lost;
        this.emit('ghosted', { side: bat.side, pos: { ...bat.pos }, lost });
        this.emit('orbGone', { orb: o, hit: true }); this.orbs.splice(i, 1); continue;
      }
      if (o.life <= 0) { this.emit('orbGone', { orb: o, hit: false }); this.orbs.splice(i, 1); }
    }

    this.updateShells(dt, playing);

    // falling cargo
    const A = CONFIG.attacks;
    for (let i = this.falling.length - 1; i >= 0; i--) {
      const f = this.falling[i];
      f.vel.y -= A.gravity * dt;
      f.pos.x += f.vel.x * dt; f.pos.y += f.vel.y * dt; f.pos.z += f.vel.z * dt;
      f.rot.x += f.spin.x * dt; f.rot.y += f.spin.y * dt; f.rot.z += f.spin.z * dt;
      const tgt = f.pos.z < -1 ? this.rival : this.you;
      let floor = 0.1;
      if (inCastle(tgt, f.pos.x, f.pos.z, 0)) { const cl = cellAt(tgt, f.pos.x, f.pos.z); if (cl) floor = blockTop(tgt, cl.c, cl.r); }
      if (f.pos.y <= floor) {
        f.pos.y = floor; this.falling.splice(i, 1);
        if (playing) this.resolveImpact(f);
        this.emit('fallingGone', { falling: f });
      }
    }

    // termites
    for (let i = this.infests.length - 1; i >= 0; i--) {
      const f = this.infests[i], b = f.castle.cells[f.r][f.c];
      if (!b || f.t <= 0) { this.infests.splice(i, 1); this.emit('infestGone', { infest: f }); continue; }
      if (!playing) continue;
      f.t -= dt;
      f.chomp -= dt;
      if (f.chomp <= 0) { f.chomp = rnd(0.25, 0.5); this.emit('chomp', { side: f.castle.side, c: f.c, r: f.r }); }
      this.damageBlock(f.castle, f.c, f.r, f.dps * (this.blood ? CONFIG.match.bloodMoonMult : 1) * dt, f.castle === this.rival);
    }

    if (playing) {
      const yc = completion(this.you), rc = completion(this.rival);
      if (yc >= 1 && rc >= 1) this.end('draw'); else if (yc >= 1) this.end('win'); else if (rc >= 1) this.end('lose');
    }
  }

  turretTop(castle, c, r) {
    const p = cellPos(castle, c, r);
    return { x: p.x, y: G.floor + G.levelHeight + 0.45, z: p.z };
  }

  updateTurrets(castle, dt, playing) {
    const GH = CONFIG.ghost;
    const enemyCastle = castle === this.you ? this.rival : this.you;
    const enemy = castle === this.you ? this.foe : this.player;
    if (castle.target && !enemyCastle.cells[castle.target.r][castle.target.c]) {
      castle.target = null;
      this.emit('targetLost', { side: castle.side });
    }
    for (let r = 0; r < G.rows; r++) for (let c = 0; c < G.cols; c++) {
      const b = castle.cells[r][c];
      if (!b || b.type !== 'turret') continue;
      b.fire = Math.max(0, b.fire - dt);
      const top = this.turretTop(castle, c, r);
      // guard first: zap the enemy bat if it comes close, otherwise bombard the chosen square
      const d = Math.hypot(enemy.pos.x - top.x, enemy.pos.y - top.y, enemy.pos.z - top.z);
      let aim = null, mode = null;
      if (d < GH.range && enemy.stun <= 0) { aim = enemy.pos; mode = 'guard'; }
      else if (castle.target) { aim = cellPos(enemyCastle, castle.target.c, castle.target.r); mode = 'shell'; }
      if (aim) {
        const want = Math.atan2(aim.x - top.x, aim.z - top.z);
        let dy = want - b.yaw;
        while (dy > Math.PI) dy -= Math.PI * 2; while (dy < -Math.PI) dy += Math.PI * 2;
        b.yaw += Math.sign(dy) * Math.min(Math.abs(dy), GH.turnSpeed * dt);
        b.aimed = Math.abs(dy) < 0.25;
      } else b.aimed = false;
      if (!playing) continue;
      b.cd -= dt;
      if (b.cd > 0 || !aim || !b.aimed) continue;
      b.fire = 0.4;
      if (mode === 'guard') {
        b.cd = rnd(GH.cooldownMin, GH.cooldownMax);
        const dx = enemy.pos.x - top.x, dy = enemy.pos.y - top.y, dz = enemy.pos.z - top.z;
        const o = { id: nextId++, owner: castle.side, pos: { ...top }, vel: { x: dx / d * GH.orbSpeed, y: dy / d * GH.orbSpeed, z: dz / d * GH.orbSpeed }, target: enemy, life: GH.orbLife };
        this.orbs.push(o);
        this.emit('orbFire', { side: castle.side, orb: o });
      } else {
        b.cd = GH.shellEvery * rnd(0.9, 1.1);
        const t = castle.target;
        const to = cellPos(enemyCastle, t.c, t.r); to.y = blockTop(enemyCastle, t.c, t.r);
        const dist = Math.hypot(to.x - top.x, to.z - top.z);
        const sh = { id: nextId++, owner: castle.side, from: { ...top }, to, cell: { c: t.c, r: t.r }, target: enemyCastle,
          t: 0, dur: dist / GH.shellSpeed + 0.4, arc: 1.5 + dist * 0.18, pos: { ...top } };
        this.shells.push(sh);
        this.emit('shellFire', { side: castle.side, shell: sh });
      }
    }
  }

  updateShells(dt, playing) {
    for (let i = this.shells.length - 1; i >= 0; i--) {
      const s = this.shells[i]; s.t += dt;
      const u = Math.min(1, s.t / s.dur);
      s.pos.x = s.from.x + (s.to.x - s.from.x) * u;
      s.pos.z = s.from.z + (s.to.z - s.from.z) * u;
      s.pos.y = s.from.y + (s.to.y - s.from.y) * u + s.arc * 4 * u * (1 - u);
      if (u < 1) continue;
      this.shells.splice(i, 1);
      this.emit('shellGone', { shell: s });
      if (!playing) continue;
      const b = s.target.cells[s.cell.r][s.cell.c];
      const byP = s.owner === 'you';
      if (!b) { this.emit('miss', { pos: { ...s.pos }, cargo: 'shell', byPlayer: byP, own: false }); continue; }
      const dmg = Math.round(CONFIG.ghost.shellDamage * (this.blood ? CONFIG.match.bloodMoonMult : 1));
      this.emit('shellHit', { pos: { ...s.pos }, dmg, byPlayer: byP, side: s.target.side, c: s.cell.c, r: s.cell.r });
      this.damageBlock(s.target, s.cell.c, s.cell.r, dmg, byP);
    }
  }

  end(outcome) {
    if (this.state !== 'play') return;
    this.state = 'over'; this.outcome = outcome;
    this.emit('end', { outcome });
  }
}
