// Everything that moves: bats, moths, carried/falling cargo, ghost orbs, termites, landing ring.
import * as THREE from 'three';
import { bake, MATS, nodeLocal } from './assets.js';
import { BatRig } from './batRig.js';
import { CONFIG } from '../game/config.js';
import { cellPos, blockTop, cellAt, inCastle } from '../game/game.js';

const G = CONFIG.grid;
const rnd = (a, b) => a + Math.random() * (b - a);

function blobTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(0,0,0,.75)'); gr.addColorStop(0.5, 'rgba(0,0,0,.4)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

export class Actors {
  constructor(scene, models) {
    this.scene = scene;
    const blobMat = new THREE.MeshBasicMaterial({ map: blobTexture(), transparent: true, depthWrite: false, opacity: 0.55 });
    const blobGeo = new THREE.PlaneGeometry(1, 1); blobGeo.rotateX(-Math.PI / 2);

    // ---------------------------------------------------------------- cargo meshes
    this.cargoGeo = {
      rock: bake(models.rock).solid,
      termites: bake(models.termite_clump).solid,
    };
    this.cargoGeo.rock.computeVertexNormals();

    // ---------------------------------------------------------------- bats (skinned + rigged)
    const glowMat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
    this.bats = {};
    for (const [side, name, scale] of [['you', 'player', 1.16], ['rival', 'rival', 1.1]]) {
      const root = models['bat_' + name];
      // a faint self-glow in the fur color keeps the bats readable against the night
      const tint = side === 'you' ? '#2c2250' : '#3a2416';
      const furMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, emissive: tint, emissiveIntensity: 0.6 });
      const wingMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, side: THREE.DoubleSide, emissive: tint, emissiveIntensity: 0.45 });
      root.traverse((o) => {
        if (!o.isMesh) return;
        const n = o.material.name;
        o.material = n === 'bat_wing' ? wingMat : n === 'bat_glow' ? glowMat : furMat;
        o.castShadow = n !== 'bat_glow'; o.frustumCulled = false;
      });
      const g = new THREE.Group(); g.rotation.order = 'YXZ';
      const model = new THREE.Group(); model.scale.setScalar(scale); model.add(root); g.add(model);
      const rig = new BatRig(root);
      const cargo = new THREE.Mesh(this.cargoGeo.rock, MATS.solid); cargo.castShadow = true;
      cargo.position.set(0, -0.5, -0.05); cargo.visible = false; g.add(cargo);
      const blob = new THREE.Mesh(blobGeo, blobMat); blob.renderOrder = 1; scene.add(blob);
      scene.add(g);
      this.bats[side] = { g, model, rig, cargo, blob, scale, eye: side === 'you' ? '#ffb340' : '#ff7a2a' };
    }

    // ---------------------------------------------------------------- moths (instanced)
    const mr = models.moth;
    const mb = bake(mr, { exclude: ['WingL', 'WingR'] });
    const MAXM = 24;
    this.moth = { body: new THREE.InstancedMesh(mb.solid, MATS.solid, MAXM), wings: [], max: MAXM };
    this.moth.body.frustumCulled = false; scene.add(this.moth.body);
    for (const [nm, s] of [['WingL', 1], ['WingR', -1]]) {
      const node = mr.getObjectByName(nm);
      const wg = bake(node, { relativeTo: node, glowBoost: 1.0 });
      const im = new THREE.InstancedMesh(mergeWing(wg), MATS.glowSide, MAXM);
      im.frustumCulled = false; scene.add(im);
      this.moth.wings.push({ im, s, pivot: nodeLocal(mr, nm) });
    }

    // ---------------------------------------------------------------- falling cargo pool
    this.fallMeshes = new Map();
    // ---------------------------------------------------------------- orbs
    this.orbGeo = new THREE.SphereGeometry(0.13, 14, 10);
    this.orbMat = new THREE.MeshBasicMaterial({ color: '#efe8ff', toneMapped: false });
    this.orbMeshes = new Map();

    // ---------------------------------------------------------------- termites
    const tb = bake(models.termite);
    this.termites = new THREE.InstancedMesh(tb.solid, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, emissive: '#5a0c04', emissiveIntensity: 0.6 }), 16 * 10);
    this.termites.frustumCulled = false; this.termites.count = 0; scene.add(this.termites);
    this.bugState = new Map();
    this.labels = new Map();

    // ---------------------------------------------------------------- landing ring
    const ringMat = new THREE.MeshBasicMaterial({ color: '#3fd3b6', transparent: true, opacity: 0.95, depthWrite: false, depthTest: false, toneMapped: false });
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.56, 40), ringMat);
    ring.rotation.x = -Math.PI / 2; ring.renderOrder = 20;
    const dot = new THREE.Mesh(new THREE.CircleGeometry(0.1, 20), ringMat); ring.add(dot);
    const outer = new THREE.Mesh(new THREE.RingGeometry(0.62, 0.66, 40), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.35, depthWrite: false, depthTest: false })); outer.renderOrder = 20; dot.renderOrder = 20; ring.add(outer);
    ring.visible = false; scene.add(ring);
    this.ring = ring; this.ringMat = ringMat;
    // the rival's incoming drop, shown on your castle so you can see the threat coming
    const threatMat = new THREE.MeshBasicMaterial({ color: '#ff5a3a', transparent: true, opacity: 0.85, depthWrite: false, depthTest: false, toneMapped: false });
    const threat = new THREE.Mesh(new THREE.RingGeometry(0.36, 0.54, 4, 1, Math.PI / 4), threatMat);
    threat.rotation.x = -Math.PI / 2; threat.renderOrder = 20; threat.visible = false; scene.add(threat);
    this.threat = threat;
    // line from bat to ring
    const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0], 3));
    this.dropLine = new THREE.Line(lg, new THREE.LineDashedMaterial({ color: '#ffffff', dashSize: 0.12, gapSize: 0.1, transparent: true, opacity: 0.5, depthWrite: false, depthTest: false }));
    this.dropLine.frustumCulled = false; this.dropLine.renderOrder = 19; scene.add(this.dropLine);

    this.d = new THREE.Object3D(); this.m = new THREE.Matrix4(); this.m2 = new THREE.Matrix4();
    this.q = new THREE.Quaternion(); this.v = new THREE.Vector3(); this.s = new THREE.Vector3(); this.e = new THREE.Euler();
  }

  // ------------------------------------------------------------------ per-frame
  update(game, dt, time, glow, sparkles, labelLayer, camera) {
    this.dt = dt; this.sparkles = sparkles;
    for (const bat of [game.player, game.foe]) this.updateBat(game, bat, time, glow);
    this.updateMoths(game, time, glow);
    this.updateFalling(game, glow);
    this.updateOrbs(game, dt, glow, sparkles);
    this.updateTermites(game, dt, time, glow, labelLayer, camera);
    this.updateRing(game, time);
  }

  updateBat(game, bat, time, glow) {
    const v = this.bats[bat.side];
    v.g.position.set(bat.pos.x, bat.pos.y, bat.pos.z);
    const stunned = bat.stun > 0;
    v.g.rotation.set(Math.min(0.35, bat.speed * 0.045), bat.yaw, stunned ? bat.flap * 1.5 : bat.roll);
    v.rig.update(bat.flap, { speed: bat.speed, stun: bat.stun, turn: -bat.roll, carrying: !!bat.carrying, dt: this.dt, time });
    // body lifts on each downstroke
    v.model.position.y = Math.sin(bat.flap) * 0.05;
    v.cargo.visible = !!bat.carrying;
    if (bat.carrying) {
      v.cargo.geometry = this.cargoGeo[bat.carrying];
      v.cargo.rotation.y = time * 0.8;
      v.cargo.position.y = -0.5 + Math.sin(bat.flap) * 0.05;
    }
    // eye glow follows the head bone
    v.g.updateMatrixWorld(true);
    v.rig.eyeWorld(this.v);
    glow.add(this.v.x, this.v.y, this.v.z, 0.8, v.eye, stunned ? 0.3 : 0.75);
    if (stunned) {
      for (let i = 0; i < 3; i++) {
        const an = time * 6 + i * 2.09;
        glow.add(bat.pos.x + Math.cos(an) * 0.45, bat.pos.y + 0.55, bat.pos.z + Math.sin(an) * 0.45, 0.38, '#d8c8ff', 1);
      }
    }
    // faint wind trail behind fast bats
    if (bat.speed > 4.6 && !stunned && this.sparkles) {
      this.trailT = (this.trailT || 0) - this.dt;
      if (this.trailT <= 0) {
        this.trailT = 0.035;
        const back = 0.35, sx = Math.cos(bat.yaw), sz = -Math.sin(bat.yaw);
        for (const s of [-1, 1]) {
          this.sparkles.list.push({ x: bat.pos.x - Math.sin(bat.yaw) * back + sx * s * 1.1, y: bat.pos.y, z: bat.pos.z - Math.cos(bat.yaw) * back + sz * s * 1.1,
            vx: 0, vy: 0, vz: 0, life: 0.35, max: 0.35, color: bat.side === 'you' ? '#b8a8ff' : '#ffb08a', size: 0.22 });
        }
      }
    }
    // blob shadow directly under the bat (lands on block tops too) - the aiming aid
    const castle = bat.pos.z > 0 ? game.you : game.rival;
    let gy = 0.03;
    if (inCastle(castle, bat.pos.x, bat.pos.z, 0)) { const cl = cellAt(castle, bat.pos.x, bat.pos.z); gy = cl ? blockTop(castle, cl.c, cl.r) + 0.03 : G.floor + 0.03; }
    v.blob.position.set(bat.pos.x, gy, bat.pos.z);
    const bs = 1.1 * v.scale * (1 - (bat.pos.y - gy - 2) * 0.08);
    v.blob.scale.set(bs * 1.5, 1, bs);
    v.blob.rotation.y = bat.yaw;
  }

  updateMoths(game, time, glow) {
    const M = this.moth; let n = 0;
    for (const m of game.moths) {
      if (n >= M.max) break;
      const dx = Math.cos(m.t * 1.3) * 0.585, dz = -Math.sin(m.t * 1.1) * 0.385;
      const yaw = Math.atan2(dx, dz);
      const s = 1.75 * easeOutBack(m.born);
      this.q.setFromAxisAngle(this.v.set(0, 1, 0), yaw);
      this.m.compose(this.v.set(m.pos.x, m.pos.y, m.pos.z), this.q, this.s.set(s, s, s));
      M.body.setMatrixAt(n, this.m);
      const a = Math.sin(m.t * 24) * 0.75 - 0.15;
      for (const w of M.wings) {
        this.e.set(0, 0, w.s * a); this.q.setFromEuler(this.e);
        this.m2.compose(w.pivot, this.q, this.s.set(1, 1, 1)).premultiply(this.m);
        w.im.setMatrixAt(n, this.m2);
      }
      glow.add(m.pos.x, m.pos.y, m.pos.z, 1.7 * m.born, '#ffa53a', 0.75 + Math.sin(m.t * 5) * 0.2);
      n++;
    }
    for (const im of [M.body, ...M.wings.map((w) => w.im)]) { im.count = n; im.instanceMatrix.needsUpdate = true; }
  }

  updateFalling(game, glow) {
    const live = new Set();
    for (const f of game.falling) {
      live.add(f.id);
      let mesh = this.fallMeshes.get(f.id);
      if (!mesh) {
        mesh = new THREE.Mesh(this.cargoGeo[f.type], MATS.solid); mesh.castShadow = true;
        mesh.scale.setScalar(1.12);
        this.scene.add(mesh); this.fallMeshes.set(f.id, mesh);
      }
      mesh.position.set(f.pos.x, f.pos.y, f.pos.z);
      mesh.rotation.set(f.rot.x, f.rot.y, f.rot.z);
      if (f.type === 'termites') glow.add(f.pos.x, f.pos.y, f.pos.z, 0.8, '#ff5a30', 0.4);
    }
    for (const [id, mesh] of this.fallMeshes) if (!live.has(id)) { this.scene.remove(mesh); this.fallMeshes.delete(id); }
  }

  updateOrbs(game, dt, glow, sparkles) {
    const live = new Set();
    for (const o of game.orbs) {
      live.add(o.id);
      let mesh = this.orbMeshes.get(o.id);
      if (!mesh) { mesh = new THREE.Mesh(this.orbGeo, this.orbMat); this.scene.add(mesh); this.orbMeshes.set(o.id, mesh); o._trail = 0; }
      mesh.position.set(o.pos.x, o.pos.y, o.pos.z);
      glow.add(o.pos.x, o.pos.y, o.pos.z, 1.3, '#8c6bff', 0.95);
      glow.add(o.pos.x, o.pos.y, o.pos.z, 0.5, '#ffffff', 0.6);
      o._trail -= dt;
      if (o._trail <= 0) { o._trail = 0.04; sparkles.burst(o.pos, '#9a7bff', 1, 0.2, 0.42, 0.55); }
    }
    for (const [id, mesh] of this.orbMeshes) if (!live.has(id)) { this.scene.remove(mesh); this.orbMeshes.delete(id); }
  }

  updateTermites(game, dt, time, glow, layer, camera) {
    let n = 0; const live = new Set();
    const e = G.blockWidth / 2 + 0.025;
    const fwd = this._fwd || (this._fwd = new THREE.Vector3()), up = this._up || (this._up = new THREE.Vector3());
    const right = this._right || (this._right = new THREE.Vector3()), pos = this._pos || (this._pos = new THREE.Vector3());
    for (const f of game.infests) {
      live.add(f.id);
      const b = f.castle.cells[f.r][f.c];
      const lv = b ? b.level : 1, hgt = lv * G.levelHeight;
      const p = cellPos(f.castle, f.c, f.r);
      let bugs = this.bugState.get(f.id);
      if (!bugs) {
        bugs = []; const count = 12;
        for (let i = 0; i < count; i++) bugs.push({ u: rnd(0, 4), h: Math.random(), sp: rnd(0.35, 0.8) * (Math.random() < 0.5 ? -1 : 1), w: rnd(0, 6) });
        this.bugState.set(f.id, bugs);
      }
      for (const u of bugs) {
        if (n >= this.termites.instanceMatrix.count) break;
        u.u = ((u.u + u.sp * dt) % 4 + 4) % 4; u.w += dt * 9;
        const side = Math.floor(u.u), t = u.u - side;
        const L = 2 * e;
        let x, z;
        if (side === 0) { x = -e + t * L; z = e; up.set(0, 0, 1); fwd.set(1, 0, 0); }
        else if (side === 1) { x = e; z = e - t * L; up.set(1, 0, 0); fwd.set(0, 0, -1); }
        else if (side === 2) { x = e - t * L; z = -e; up.set(0, 0, -1); fwd.set(-1, 0, 0); }
        else { x = -e; z = -e + t * L; up.set(-1, 0, 0); fwd.set(0, 0, 1); }
        if (u.sp < 0) fwd.negate();
        const wig = Math.sin(u.w) * 0.25; fwd.y += wig; fwd.normalize();
        right.crossVectors(up, fwd);
        this.m.makeBasis(right, up, fwd);
        pos.set(p.x + x, p.y + 0.1 + u.h * (hgt - 0.22), p.z + z);
        this.m.setPosition(pos);
        this.m.scale(this.s.set(1.1, 1.1, 1.1));
        this.termites.setMatrixAt(n++, this.m);
      }
      glow.add(p.x, p.y + hgt * 0.6, p.z, 2.0, '#ff5a30', 0.32 + Math.sin(time * 6) * 0.06);
      // countdown label
      let lab = this.labels.get(f.id);
      if (!lab) { lab = document.createElement('div'); lab.className = 'tlabel'; layer.appendChild(lab); this.labels.set(f.id, lab); }
      this.v.set(p.x, p.y + hgt + 0.75, p.z).project(camera);
      lab.style.transform = `translate(${(this.v.x + 1) / 2 * innerWidth}px,${(1 - this.v.y) / 2 * innerHeight}px) translate(-50%,-50%)`;
      const txt = '0:' + String(Math.ceil(Math.max(0, f.t))).padStart(2, '0');
      if (lab.textContent !== txt) lab.textContent = txt;
    }
    this.termites.count = n; this.termites.instanceMatrix.needsUpdate = true;
    for (const [id, lab] of this.labels) if (!live.has(id)) { lab.remove(); this.labels.delete(id); this.bugState.delete(id); }
  }

  updateRing(game, time) {
    const f = game.foe;
    const incoming = game.state === 'play' && f.carrying && f.stun <= 0 && f.pos.z > -2;
    this.threat.visible = !!incoming;
    if (incoming) {
      const L = game.predictLanding(f);
      this.threat.position.set(L.x, L.y + 0.03, L.z);
      const k = 1 + Math.sin(time * 12) * 0.12;
      this.threat.scale.set(k, k, k);
      this.threat.material.opacity = 0.55 + Math.sin(time * 12) * 0.3;
    }
    const p = game.player;
    const show = game.state === 'play' && p.carrying && p.stun <= 0;
    this.ring.visible = !!show; this.dropLine.visible = !!show;
    if (!show) return;
    const L = game.predictLanding(p);
    this.ring.position.set(L.x, L.y + 0.02, L.z);
    this.ringMat.color.set(L.perfect ? '#fff2b0' : L.onTarget ? '#ff7a4a' : '#3fd3b6');
    const s = (L.perfect ? 1.15 : 1) + Math.sin(time * 8) * 0.08;
    this.ring.scale.set(s, s, s);
    const a = this.dropLine.geometry.attributes.position;
    a.setXYZ(0, p.pos.x, p.pos.y - 0.6, p.pos.z); a.setXYZ(1, L.x, L.y + 0.05, L.z); a.needsUpdate = true;
    this.dropLine.computeLineDistances();
  }

  clear() {
    for (const [, m] of this.fallMeshes) this.scene.remove(m); this.fallMeshes.clear();
    for (const [, m] of this.orbMeshes) this.scene.remove(m); this.orbMeshes.clear();
    for (const [, l] of this.labels) l.remove(); this.labels.clear(); this.bugState.clear();
  }
}

function easeOutBack(t) { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); }

function mergeWing(wg) {
  // moth wings: draw the whole wing (glowing parts + dark spot) with the unlit material
  if (wg.glow && wg.solid) {
    const g = wg.glow.clone();
    const geos = [g, wg.solid];
    const pos = [], col = [], idx = [];
    let off = 0;
    for (const x of geos) {
      const p = x.attributes.position, c = x.attributes.color;
      for (let i = 0; i < p.count; i++) { pos.push(p.getX(i), p.getY(i), p.getZ(i)); col.push(c.getX(i), c.getY(i), c.getZ(i)); }
      const ix = x.index; for (let i = 0; i < ix.count; i++) idx.push(ix.getX(i) + off);
      off += p.count;
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    out.setIndex(idx);
    return out;
  }
  return wg.glow || wg.solid;
}
