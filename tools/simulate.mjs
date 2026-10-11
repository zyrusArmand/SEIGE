// Headless balance check: plays N matches with a simple player bot vs the AI.
// Run: node tools/simulate.mjs [matches]
import { Game, completion, cellPos } from '../src/game/game.js';

const N = +(process.argv[2] || 20);
const tally = { win: 0, lose: 0, draw: 0 };
const ev = {};
let totalLen = 0;
for (let m = 0; m < N; m++) {
  const g = new Game(); g.start();
  let t = 0, mode = 'gather', buildT = 0;
  while (g.state === 'play' && t < 400) {
    const p = g.player;
    // --- simple bot: gather 5 moths, go home, build; sometimes raid
    if (p.stun <= 0) {
      if (p.carrying) {
        let best = null; for (let r = 0; r < 3; r++) for (let c = 0; c < 6; c++) if (g.rival.cells[r][c]) best = { c, r };
        const q = best ? cellPos(g.rival, best.c, best.r) : { x: 0, z: -7 };
        g.input.target = { x: q.x, z: q.z };
        if (Math.hypot(p.pos.x - q.x, p.pos.z - q.z) < 0.4 && p.speed < 2) g.playerDrop();
      } else if (mode === 'gather') {
        let best = null, bd = 1e9; for (const mo of g.moths) { const d = Math.hypot(mo.pos.x - p.pos.x, mo.pos.z - p.pos.z); if (d < bd) { bd = d; best = mo; } }
        g.input.target = best ? { x: best.pos.x, z: best.pos.z } : { x: 0, z: 0 };
        if (p.moths >= 5) mode = Math.random() < 0.3 ? 'raid' : 'build';
      } else {
        g.input.target = { x: 0, z: 6.75 };
        buildT -= 1 / 30;
        if (p.home && buildT <= 0) {
          buildT = 0.4;
          if (mode === 'raid') { g.tryLoad('rock'); mode = 'gather'; }
          else {
            let done = false;
            for (let r = 0; r < 3 && !done; r++) for (let c = 0; c < 6 && !done; c++) {
              const b = g.you.cells[r][c];
              const type = b ? b.type : (p.moths >= 3 ? 'stone' : 'wood');
              if (!g.tryBuild(c, r, type)) done = true;
            }
            if (!done || p.moths < 1) mode = 'gather';
          }
        }
      }
    }
    g.update(1 / 30); t += 1 / 30;
    for (const e of g.events) ev[e.type] = (ev[e.type] || 0) + 1;
    g.events.length = 0;
  }
  tally[g.outcome]++; totalLen += t;
  if (m < 5) console.log(`match ${m + 1}: ${g.outcome} after ${t.toFixed(0)}s  you ${Math.round(completion(g.you) * 100)}%  rival ${Math.round(completion(g.rival) * 100)}%  stats`, g.stats);
}
console.log('\nresults', tally, 'avg length', (totalLen / N).toFixed(0) + 's');
console.log('events', ev);
