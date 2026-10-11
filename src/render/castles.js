// Draws both castles with instancing (one draw call per piece type), the teal build squares,
// the turrets (cannon + ghost gunner), and the bombard target markers.
//
// Every block shares one castle style; the piece is picked from where the block sits:
//   corner squares -> tower cap, edge squares -> wall cap facing outward, inside -> keep cap,
//   the two front-middle squares (row 2, cols 2-3) -> gate body on the ground level.
import * as THREE from 'three';
import { bake, MATS, sockets, canvasTexture, nodeLocal } from './assets.js';
import { CONFIG } from '../game/config.js';
import { cellX, maxHp, cellPos, blockTop } from '../game/game.js';

const G = CONFIG.grid;
const TYPES = ['stone', 'wood', 'bone'];
const SHAPES = ['keep', 'wall', 'corner'];

export function cellShape(c, r) {
  const edgeC = c === 0 || c === G.cols - 1, edgeR = r === 0 || r === G.rows - 1;
  if (edgeC && edgeR) return 'corner';
  if (edgeC || edgeR) return 'wall';
  return 'keep';
}
/** Yaw that turns a wall cap's battlements (+Z by default) to face out of the castle. */
function wallYaw(c, r) {
  if (r === 0) return Math.PI;
  if (r === G.rows - 1) return 0;
  return c === 0 ? -Math.PI / 2 : Math.PI / 2;
}
const isGate = (c, r) => r === G.rows - 1 && (c === 2 || c === 3);

export class CastleView {
  constructor(scene, models) {
    this.scene = scene;
    this.pieces = {};
    const addPiece = (key, model, ao, cap) => {
      const b = bake(model, { ao, aoHeight: 0.45 });
      const solid = new THREE.InstancedMesh(b.solid, MATS.solid, cap);
      solid.castShadow = true; solid.receiveShadow = true; solid.frustumCulled = false;
      solid.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      solid.setColorAt(0, new THREE.Color(1, 1, 1));
      scene.add(solid);
      let glow = null;
      if (b.glow) {
        glow = new THREE.InstancedMesh(b.glow, MATS.glow, cap);
        glow.frustumCulled = false; glow.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        scene.add(glow);
      }
      this.pieces[key] = { solid, glow, n: 0, cap };
    };
    for (const t of TYPES) {
      addPiece(t + '_body', models[`block_${t}_body`], 0.28, 72);
      addPiece(t + '_gate', models[`block_${t}_gate`], 0.28, 8);
      for (const sh of SHAPES) addPiece(`${t}_cap_${sh}`, models[`block_${t}_cap_${sh}`], 0.12, 36);
    }
    addPiece('turret_base', models.turret_base, 0.28, 8);
    this.gateTorches = sockets(models.block_stone_gate, 'TorchSocket_');
    this.m = new THREE.Matrix4(); this.m2 = new THREE.Matrix4(); this.c = new THREE.Color();
    this.q = new THREE.Quaternion(); this.e = new THREE.Euler(); this.v = new THREE.Vector3(); this.s = new THREE.Vector3();
    this.rot = new THREE.Matrix4();

    // ---- build squares (player castle)
    const dashTex = canvasTexture(128, 128, (g) => {
      g.fillStyle = 'rgba(255,255,255,.22)'; g.beginPath(); g.roundRect(8, 8, 112, 112, 12); g.fill();
      g.strokeStyle = '#ffffff'; g.lineWidth = 10; g.lineCap = 'round'; g.setLineDash([18, 13]);
      g.beginPath(); g.roundRect(7, 7, 114, 114, 14); g.stroke();
    });
    dashTex.colorSpace = THREE.NoColorSpace;
    const markGeo = new THREE.PlaneGeometry(G.cell * 0.92, G.cell * 0.92); markGeo.rotateX(-Math.PI / 2);
    this.marks = [];
    for (let r = 0; r < G.rows; r++) for (let c = 0; c < G.cols; c++) {
      const mat = new THREE.MeshBasicMaterial({ map: dashTex, color: '#5ff5d6', transparent: true, opacity: 0, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending });
      const mk = new THREE.Mesh(markGeo, mat);
      mk.position.set(cellX(c), G.floor + 0.03, CONFIG.castles.youZ0 + r * G.cell);
      mk.renderOrder = 5; mk.visible = false;
      scene.add(mk); this.marks.push({ mk, c, r, o: 0 });
    }

    // ---- turrets: cannon head + ghost gunner (a few real meshes, pooled by block id)
    const th = bake(models.turret_head, { glowBoost: 1.4 });
    this.headGeo = th;
    this.seat = nodeLocal(models.turret_head, 'GhostSeat');
    this.muzzle = nodeLocal(models.turret_head, 'Muzzle');
    this.ghostBody = bake(models.ghost, { skipMaterials: ['ghost_face'] }).solid;
    this.ghostFace = bake(models.ghost, { skipMaterials: ['ghost'] }).solid;
    this.turrets = new Map();

    // ---- target markers (where turrets are aiming)
    this.targets = {};
    for (const [side, color] of [['you', '#ff5a3a'], ['rival', '#b49bff']]) {
      const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false, depthTest: false, toneMapped: false });
      const g = new THREE.Group();
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.5, 40), mat); ring.rotation.x = -Math.PI / 2; g.add(ring);
      for (let i = 0; i < 4; i++) {
        const tick = new THREE.Mesh(new THREE.PlaneGeometry(0.08, 0.26), mat);
        tick.rotation.x = -Math.PI / 2; const a = i * Math.PI / 2;
        tick.position.set(Math.sin(a) * 0.6, 0, Math.cos(a) * 0.6); tick.rotation.z = a; g.add(tick);
      }
      g.traverse((o) => { o.renderOrder = 21; });
      g.visible = false; scene.add(g);
      this.targets[side] = g;
    }
  }

  makeTurret() {
    const g = new THREE.Group();
    const head = new THREE.Group(); g.add(head);
    const hm = new THREE.Mesh(this.headGeo.solid, MATS.solid); hm.castShadow = true; head.add(hm);
    if (this.headGeo.glow) head.add(new THREE.Mesh(this.headGeo.glow, MATS.glow));
    const mat = new THREE.MeshStandardMaterial({ color: '#c8b8ff', emissive: '#6b4cff', emissiveIntensity: 0.75,
      transparent: true, opacity: 0.94, roughness: 0.4, side: THREE.DoubleSide });
    const ghost = new THREE.Group();
    const body = new THREE.Mesh(this.ghostBody, mat); body.castShadow = true;
    ghost.add(body, new THREE.Mesh(this.ghostFace, new THREE.MeshBasicMaterial({ color: '#1d1240' })));
    ghost.scale.setScalar(0.7); ghost.position.copy(this.seat);
    head.add(ghost);
    this.scene.add(g);
    return { g, head, ghost, mat };
  }

  begin() { for (const k in this.pieces) this.pieces[k].n = 0; }

  push(key, matrix, color) {
    const p = this.pieces[key];
    if (!p || p.n >= p.cap) return;
    p.solid.setMatrixAt(p.n, matrix);
    p.solid.setColorAt(p.n, color);
    if (p.glow) p.glow.setMatrixAt(p.n, matrix);
    p.n++;
  }

  end() {
    for (const k in this.pieces) {
      const p = this.pieces[k];
      p.solid.count = p.n; p.solid.instanceMatrix.needsUpdate = true;
      if (p.solid.instanceColor) p.solid.instanceColor.needsUpdate = true;
      if (p.glow) { p.glow.count = p.n; p.glow.instanceMatrix.needsUpdate = true; }
    }
  }

  update(game, dt, time, glow, reducedMotion) {
    this.begin();
    const live = new Set();
    for (const castle of [game.you, game.rival]) {
      for (let r = 0; r < G.rows; r++) for (let c = 0; c < G.cols; c++) {
        const b = castle.cells[r][c]; if (!b) continue;
        // squash & stretch pop
        let sy = 1, sxz = 1;
        if (b.pop > 0 && !reducedMotion) {
          const t = 1 - b.pop / 0.35;
          sy = 1 - 0.7 * Math.cos(t * 9) * Math.exp(-4 * t);
          sxz = 1 + (1 - sy) * 0.45;
        }
        let ox = 0, rz = 0;
        if (b.shake > 0 && !reducedMotion) { ox = Math.sin(time * 70) * b.shake * 0.22; rz = Math.sin(time * 55) * b.shake * 0.12; }
        const z = castle.z0 + r * G.cell;
        this.e.set(0, 0, rz); this.q.setFromEuler(this.e);
        this.m.compose(this.v.set(cellX(c) + ox, G.floor, z), this.q, this.s.set(sxz, sy, sxz));
        // damage tint: darken toward 42% as HP drops, flash white when hit
        const f = Math.max(0, b.hp) / maxHp(b);
        const k = 0.42 + 0.58 * Math.min(1, f * 1.15);
        this.c.setRGB(k, k * (0.92 + 0.08 * f), k * (0.88 + 0.12 * f));
        if (b.shake > 0.2) { const fl = (b.shake - 0.2) * 9; this.c.r += fl; this.c.g += fl; this.c.b += fl; }

        if (b.type === 'turret') {
          this.push('turret_base', this.m, this.c);
          live.add(b.id);
          this.updateTurret(castle, b, c, r, sxz, sy, ox, time, glow);
          continue;
        }
        const gate = isGate(c, r);
        for (let i = 0; i < b.level; i++) {
          this.m2.makeTranslation(0, i * G.levelHeight, 0).premultiply(this.m);
          this.push(b.type + (i === 0 && gate ? '_gate' : '_body'), this.m2, this.c);
        }
        const shape = cellShape(c, r);
        this.m2.makeTranslation(0, b.level * G.levelHeight, 0);
        if (shape === 'wall') this.m2.multiply(this.rot.makeRotationY(wallYaw(c, r)));
        this.m2.premultiply(this.m);
        this.push(`${b.type}_cap_${shape}`, this.m2, this.c);
        if (gate) {
          for (const s of this.gateTorches) {
            this.v.copy(s).applyMatrix4(this.m);
            const fl = 0.75 + Math.sin(time * 13 + c * 3 + r * 7 + s.x * 5) * 0.12 + Math.random() * 0.1;
            glow.add(this.v.x, this.v.y + 0.04, this.v.z, 0.75 * fl, '#ff9a3c', 0.85 * k);
          }
        }
      }
    }
    this.end();
    for (const [id, t] of this.turrets) if (!live.has(id)) { this.scene.remove(t.g); this.turrets.delete(id); }
    this.updateTargets(game, time);
  }

  updateTurret(castle, b, c, r, sxz, sy, ox, time, glow) {
    let t = this.turrets.get(b.id);
    if (!t) { t = this.makeTurret(); this.turrets.set(b.id, t); }
    const z = castle.z0 + r * G.cell;
    t.g.position.set(cellX(c) + ox, G.floor + G.levelHeight * sy, z);
    t.g.scale.set(sxz, sy, sxz);
    t.g.rotation.y = b.yaw;
    const fire = b.fire / 0.4;
    t.head.position.z = -0.14 * fire;                       // recoil
    t.ghost.position.y = this.seat.y + Math.sin(time * 3 + b.id) * 0.03;
    t.ghost.rotation.z = Math.sin(time * 1.7 + b.id) * 0.08;
    t.mat.emissiveIntensity = 0.75 + fire * 1.4;
    // muzzle glow, bigger as it winds up to fire
    const charge = b.aimed ? Math.max(0, 1 - b.cd / 0.6) : 0;
    t.g.updateMatrixWorld(true);
    this.v.copy(this.muzzle).applyMatrix4(t.head.matrixWorld);
    glow.add(this.v.x, this.v.y, this.v.z, 0.6 + charge * 1.0 + fire * 1.4, '#b49bff', 0.35 + charge * 0.5 + fire * 0.6);
    this.v.copy(this.seat).applyMatrix4(t.head.matrixWorld);
    glow.add(this.v.x, this.v.y + 0.25, this.v.z, 1.5, '#9a7bff', 0.35);
  }

  updateTargets(game, time) {
    for (const [side, castle, enemy] of [['you', game.you, game.rival], ['rival', game.rival, game.you]]) {
      const g = this.targets[side], t = castle.target;
      const show = game.state === 'play' && t && enemy.cells[t.r][t.c];
      g.visible = !!show;
      if (!show) continue;
      const p = cellPos(enemy, t.c, t.r);
      g.position.set(p.x, blockTop(enemy, t.c, t.r) + 0.08, p.z);
      g.rotation.y = time * 0.8;
      const s = 1 + Math.sin(time * 6) * 0.06; g.scale.set(s, 1, s);
    }
  }

  updateMarks(game, tool, hover, dt, time) {
    const show = game.state === 'play' && tool && game.player.home && ['wood', 'stone', 'bone', 'turret'].includes(tool);
    for (const m of this.marks) {
      const ok = show && game.canPlace(game.you, m.c, m.r, tool);
      const hov = hover && hover.c === m.c && hover.r === m.r;
      const target = ok ? (hov ? 1 : 0.78 + Math.sin(time * 5 + m.c * 0.6) * 0.18) : 0;
      m.o += (target - m.o) * Math.min(1, dt * 10);
      m.mk.visible = m.o > 0.01;
      m.mk.material.opacity = m.o;
      const b = game.you.cells[m.r][m.c];
      m.mk.position.y = G.floor + 0.03 + (b ? b.level * G.levelHeight + 0.06 : 0);
      const s = hov && ok ? 1.04 : 1;
      m.mk.scale.set(s, 1, s);
    }
  }
}
