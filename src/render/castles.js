// Draws both castles' blocks with instancing (one draw call per block piece type),
// the teal build squares, and the ghost turrets.
import * as THREE from 'three';
import { bake, MATS, sockets, canvasTexture } from './assets.js';
import { CONFIG } from '../game/config.js';
import { cellX, maxHp } from '../game/game.js';

const G = CONFIG.grid;
const PIECES = ['stone_body', 'stone_body_arch', 'stone_cap', 'wood_body', 'wood_cap', 'bone_body', 'bone_cap'];

export class CastleView {
  constructor(scene, models) {
    this.scene = scene;
    this.pieces = {};
    for (const key of PIECES) {
      const b = bake(models['block_' + key], { ao: key.endsWith('body') ? 0.28 : 0.12, aoHeight: 0.45 });
      const cap = key.endsWith('cap') ? 36 : (key === 'stone_body_arch' ? 36 : 72);
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
    }
    this.archTorches = sockets(models.block_stone_body_arch, 'TorchSocket_');
    this.m = new THREE.Matrix4(); this.m2 = new THREE.Matrix4(); this.c = new THREE.Color();
    this.q = new THREE.Quaternion(); this.e = new THREE.Euler(); this.v = new THREE.Vector3(); this.s = new THREE.Vector3();
    this.torchList = [];  // world positions of block torches this frame

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

    // ---- ghosts
    const gb = bake(models.ghost, { skipMaterials: ['ghost_face'] });
    const gf = bake(models.ghost, { skipMaterials: ['ghost'] });
    this.ghosts = {};
    for (const side of ['you', 'rival']) {
      const mat = new THREE.MeshStandardMaterial({ color: '#c8b8ff', emissive: '#6b4cff', emissiveIntensity: 0.75,
        transparent: true, opacity: 0.92, roughness: 0.4, side: THREE.DoubleSide });
      const faceMat = new THREE.MeshBasicMaterial({ color: '#1d1240', transparent: true, opacity: 1 });
      const g = new THREE.Group();
      const body = new THREE.Mesh(gb.solid, mat); body.castShadow = true;
      const face = new THREE.Mesh(gf.solid, faceMat);
      const inner = new THREE.Group(); inner.add(body, face); inner.position.y = -0.45;
      g.add(inner); g.scale.setScalar(1.15);
      scene.add(g);
      this.ghosts[side] = { g, inner, mat, faceMat };
    }
  }

  begin() { for (const k in this.pieces) this.pieces[k].n = 0; this.torchList.length = 0; }

  push(key, matrix, color) {
    const p = this.pieces[key];
    if (p.n >= p.cap) return;
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
        // damage tint: darken toward 42% as HP drops
        const f = Math.max(0, b.hp) / maxHp(b);
        const k = 0.42 + 0.58 * Math.min(1, f * 1.15);
        this.c.setRGB(k, k * (0.92 + 0.08 * f), k * (0.88 + 0.12 * f));
        for (let i = 0; i < b.level; i++) {
          const key = b.type + '_body' + (i === 0 && b.arch ? '_arch' : '');
          this.m2.makeTranslation(0, i * G.levelHeight, 0).premultiply(this.m);
          this.push(key, this.m2, this.c);
        }
        this.m2.makeTranslation(0, b.level * G.levelHeight, 0).premultiply(this.m);
        this.push(b.type + '_cap', this.m2, this.c);
        if (b.arch) {
          for (const s of this.archTorches) {
            this.v.copy(s).applyMatrix4(this.m);
            const fl = 0.75 + Math.sin(time * 13 + c * 3 + r * 7 + s.x * 5) * 0.12 + Math.random() * 0.1;
            glow.add(this.v.x, this.v.y + 0.04, this.v.z, 0.75 * fl, '#ff9a3c', 0.85 * k);
          }
        }
      }
    }
    this.end();
  }

  updateMarks(game, tool, hover, dt, time) {
    const show = game.state === 'play' && tool && game.player.home && ['wood', 'stone', 'bone'].includes(tool);
    for (const m of this.marks) {
      const ok = show && game.canPlace(game.you, m.c, m.r, tool);
      const hov = hover && hover.c === m.c && hover.r === m.r;
      const target = ok ? (hov ? 1 : 0.78 + Math.sin(time * 5 + m.c * 0.6) * 0.18) : 0;
      m.o += (target - m.o) * Math.min(1, dt * 10);
      m.mk.visible = m.o > 0.01;
      m.mk.material.opacity = m.o;
      const b = game.you.cells[m.r][m.c];
      m.mk.position.y = G.floor + 0.03 + (b ? b.level * G.levelHeight + (b.type === 'stone' ? 0.06 : 0.02) : 0);
      const s = hov && ok ? 1.04 : 1;
      m.mk.scale.set(s, 1, s);
    }
  }

  updateGhosts(game, time, glow) {
    for (const castle of [game.you, game.rival]) {
      const tu = castle.turret, gh = this.ghosts[castle.side];
      gh.g.position.set(tu.pos.x, tu.pos.y, tu.pos.z);
      gh.g.rotation.y = tu.yaw;
      const fire = tu.fire / 0.4;
      gh.g.scale.setScalar(1.15 * (1 + fire * 0.18));
      gh.inner.rotation.z = Math.sin(time * 1.7 + (castle.side === 'you' ? 0 : 2)) * 0.08;
      gh.mat.opacity = 0.92 * tu.opacity;
      gh.faceMat.opacity = tu.opacity;
      gh.mat.emissiveIntensity = 0.75 + fire * 1.2;
      glow.add(tu.pos.x, tu.pos.y, tu.pos.z, 2.0 + fire * 1.2, '#9a7bff', (0.45 + fire * 0.5) * tu.opacity);
    }
  }
}
