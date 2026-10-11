// The static night battlefield: lights, ground, path, pond, forest, castle frames.
import * as THREE from 'three';
import { bake, MATS, canvasTexture, sockets } from './assets.js';
import { POND } from '../game/game.js';
import { CONFIG } from '../game/config.js';

const rnd = (a, b) => a + Math.random() * (b - a);

export function buildWorld(scene, models, mobile) {
  const W = {};
  scene.background = new THREE.Color('#0a1424');
  scene.fog = new THREE.Fog('#0a1424', 34, 60);

  // ---------------------------------------------------------------- lights (ART_GUIDE)
  // ART_GUIDE numbers are from three r128 "legacy" lighting; modern three needs them x PI.
  const LK = Math.PI;
  W.hemi = new THREE.HemisphereLight('#6a82c8', '#0c1a10', 0.6 * LK);
  scene.add(W.hemi);
  const moon = new THREE.DirectionalLight('#c4d2ff', 1.25 * LK);
  moon.position.set(8, 18, -8);
  moon.castShadow = true;
  const sm = mobile ? 1024 : 2048;
  moon.shadow.mapSize.set(sm, sm);
  Object.assign(moon.shadow.camera, { left: -15, right: 15, top: 15, bottom: -15, near: 1, far: 50 });
  moon.shadow.bias = -0.0006; moon.shadow.normalBias = 0.02;
  scene.add(moon);
  W.moon = moon;
  const fill = new THREE.DirectionalLight('#ff9b5a', 0.18 * LK); fill.position.set(-8, 6, 10); scene.add(fill);
  W.moonBase = new THREE.Color('#c4d2ff'); W.moonBlood = new THREE.Color('#ff6a55');
  W.hemiBase = new THREE.Color('#6a82c8'); W.hemiBlood = new THREE.Color('#a8506a');
  W.fogBase = new THREE.Color('#0a1424'); W.fogBlood = new THREE.Color('#1c0a14');

  // ---------------------------------------------------------------- ground
  const grassTex = canvasTexture(512, 512, (g, w, h) => {
    g.fillStyle = '#21452a'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 40; i++) {
      const x = rnd(0, w), y = rnd(0, h), r = rnd(30, 90);
      const rg = g.createRadialGradient(x, y, 0, x, y, r);
      const dark = Math.random() < 0.5;
      rg.addColorStop(0, dark ? 'rgba(14,40,24,.35)' : 'rgba(58,106,58,.18)'); rg.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = rg; g.fillRect(x - r, y - r, r * 2, r * 2);
    }
    for (let i = 0; i < 9000; i++) {
      g.fillStyle = `rgba(${rnd(20, 64) | 0},${rnd(66, 122) | 0},${rnd(38, 72) | 0},${rnd(0.15, 0.55)})`;
      g.fillRect(rnd(0, w), rnd(0, h), rnd(1, 2.5), rnd(2, 6));
    }
  }, [6, 8]);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(48, 60), new THREE.MeshStandardMaterial({ map: grassTex, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);

  // winding dirt path between the castles
  const dirtTex = canvasTexture(128, 256, (g, w, h) => {
    g.fillStyle = '#6a5236'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 900; i++) {
      g.fillStyle = `rgba(${rnd(60, 140) | 0},${rnd(50, 110) | 0},${rnd(30, 70) | 0},.5)`;
      g.beginPath(); g.arc(rnd(0, w), rnd(0, h), rnd(0.5, 2.4), 0, 7); g.fill();
    }
    // soft darker edges so the path blends into the grass
    const lg = g.createLinearGradient(0, 0, w, 0);
    lg.addColorStop(0, 'rgba(33,69,42,.95)'); lg.addColorStop(0.16, 'rgba(33,69,42,0)');
    lg.addColorStop(0.84, 'rgba(33,69,42,0)'); lg.addColorStop(1, 'rgba(33,69,42,.95)');
    g.fillStyle = lg; g.fillRect(0, 0, w, h);
  });
  dirtTex.wrapT = THREE.RepeatWrapping;
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-18, 0, 1.6), new THREE.Vector3(-8, 0, -0.6), new THREE.Vector3(-2, 0, 1.4),
    new THREE.Vector3(3, 0, -0.9), new THREE.Vector3(9, 0, -1.6), new THREE.Vector3(18, 0, 0.2)]);
  const N = 120, pos = [], uv = [], idx = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N, p = curve.getPoint(t), tg = curve.getTangent(t), nx = -tg.z, nz = tg.x;
    const w = 0.85 + Math.sin(i * 0.7) * 0.08;
    pos.push(p.x + nx * w, 0.02, p.z + nz * w, p.x - nx * w, 0.02, p.z - nz * w);
    uv.push(0, t * 14, 1, t * 14);
    if (i < N) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  const pg = new THREE.BufferGeometry();
  pg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  pg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  pg.setIndex(idx); pg.computeVertexNormals();
  const pathMesh = new THREE.Mesh(pg, new THREE.MeshStandardMaterial({ map: dirtTex, roughness: 1, transparent: false }));
  pathMesh.receiveShadow = true; scene.add(pathMesh);

  // ---------------------------------------------------------------- pond
  const pond = models.pond;
  const pondGroup = new THREE.Group();
  const pondBake = bake(pond, { exclude: ['MoonReflection'], skipMaterials: ['water'] });
  const pondMesh = new THREE.Mesh(pondBake.solid, MATS.solid); pondMesh.receiveShadow = true;
  pondGroup.add(pondMesh);
  // water: re-create with a nice glowing material
  pond.traverse((o) => {
    if (o.isMesh && o.material && o.material.name === 'water') {
      const m = new THREE.Mesh(o.geometry, new THREE.MeshStandardMaterial({
        color: '#155f7d', emissive: '#2bb7d8', emissiveIntensity: 0.55, roughness: 0.15, metalness: 0.1 }));
      m.position.y = 0.002; m.applyMatrix4(o.matrixWorld);
      pondGroup.add(m); W.water = m;
    }
  });
  const reflSrc = pond.getObjectByName('MoonReflection');
  W.moonReflMat = new THREE.MeshBasicMaterial({ color: '#fbf6e8', toneMapped: false });
  reflSrc.updateMatrixWorld(true);
  reflSrc.traverse((o) => {
    if (o.isMesh) { const m = new THREE.Mesh(o.geometry, W.moonReflMat); m.applyMatrix4(o.matrixWorld); m.position.y += 0.012; pondGroup.add(m); W.refl = m; }
  });
  // a few craters so it reads as a moon
  const crMat = new THREE.MeshBasicMaterial({ color: '#d9d2bd', toneMapped: false, transparent: true, opacity: 0.55 });
  W.craterMat = crMat;
  for (const [x, z, r] of [[-0.15, -0.1, 0.11], [0.12, 0.14, 0.07], [0.2, -0.18, 0.05]]) {
    const c = new THREE.Mesh(new THREE.CircleGeometry(r, 16), crMat);
    c.rotation.x = -Math.PI / 2; c.position.set(W.refl.position.x + x, W.refl.position.y + 0.004, W.refl.position.z + z);
    pondGroup.add(c);
  }
  pondGroup.position.set(POND.x, 0, POND.z);
  scene.add(pondGroup);
  W.pond = pondGroup;
  W.reflWorld = new THREE.Vector3(); W.refl.getWorldPosition(W.reflWorld);

  // ---------------------------------------------------------------- forest + decoration (instanced)
  const inField = (x, z) => Math.abs(x) < 6.6 && Math.abs(z) < 11.4;
  const scatter = (name, count, test, opts = {}) => {
    const b = bake(models[name], { ao: opts.ao || 0, aoHeight: opts.aoHeight || 0.5 });
    const im = new THREE.InstancedMesh(b.solid, opts.material || MATS.solid, count);
    const d = new THREE.Object3D(); let n = 0, tries = 0;
    while (n < count && tries < count * 60) {
      tries++;
      const x = rnd(opts.x0 ?? -17, opts.x1 ?? 17), z = rnd(opts.z0 ?? -20, opts.z1 ?? 20);
      if (!test(x, z)) continue;
      d.position.set(x, 0, z); d.rotation.set(0, rnd(0, 6.28), 0);
      const s = rnd(opts.s0 ?? 1, opts.s1 ?? 1); d.scale.set(s, s * rnd(0.9, 1.15), s);
      if (opts.tilt) d.rotation.set(rnd(-opts.tilt, opts.tilt), rnd(0, 6.28), rnd(-opts.tilt, opts.tilt));
      d.updateMatrix(); im.setMatrixAt(n++, d.matrix);
    }
    im.count = n; im.castShadow = !!opts.shadow; im.receiveShadow = true;
    im.computeBoundingSphere();
    scene.add(im);
    return im;
  };
  const forest = (x, z) => !inField(x, z) && !(Math.abs(x) < 7.4 && Math.abs(z) < 12.2 && Math.random() < 0.6);
  scatter('tree_pine_a', 80, forest, { s0: 1.0, s1: 1.7, shadow: true, ao: 0.35, aoHeight: 1.2 });
  scatter('tree_pine_b', 60, forest, { s0: 0.9, s1: 1.5, shadow: true, ao: 0.35, aoHeight: 1.0 });
  scatter('bush', 46, (x, z) => !inField(x, z) || (Math.abs(x) > 5.9 && Math.abs(z) > 1.5 && Math.abs(z) < 4), { s0: 0.6, s1: 1.1, shadow: true, x0: -10, x1: 10, z0: -14, z1: 14 });
  const fieldFree = (x, z) => {
    if (Math.hypot((x - POND.x) / 1.4, z - POND.z) < 2.2) return false;
    const castleZ = (z > 3.6 && z < 9.9) || (z < -3.6 && z > -9.9);
    return !(castleZ && Math.abs(x) < 5.9);
  };
  scatter('grass_tuft', 110, fieldFree, { s0: 0.8, s1: 1.6, x0: -7, x1: 7, z0: -12, z1: 12, tilt: 0.15 });
  scatter('rock_scatter', 6, (x, z) => fieldFree(x, z) && Math.abs(z) > 1.6, { s0: 0.7, s1: 1.4, shadow: true, x0: -7, x1: 7, z0: -12, z1: 12 });

  // ---------------------------------------------------------------- castle frames (static, baked)
  const frame = models.castle_frame;
  const fb = bake(frame, { ao: 0.3, aoHeight: 0.6 });
  W.frameTorches = sockets(frame, 'TorchSocket_');
  W.frames = [];
  for (const z0 of [CONFIG.castles.youZ0, CONFIG.castles.rivalZ0]) {
    const cz = z0 + CONFIG.grid.cell;
    const g = new THREE.Group(); g.position.set(0, 0, cz);
    const m = new THREE.Mesh(fb.solid, MATS.solid); m.castShadow = true; m.receiveShadow = true; g.add(m);
    if (fb.glow) g.add(new THREE.Mesh(fb.glow, MATS.glow));
    scene.add(g);
    W.frames.push({ group: g, cz, torches: W.frameTorches.map((p) => p.clone().add(g.position)) });
  }
  // subtle dark grid lines on the castle floor so squares read clearly
  for (const z0 of [CONFIG.castles.youZ0, CONFIG.castles.rivalZ0]) {
    const C = CONFIG.grid, lines = [];
    const y = C.floor + 0.012;
    for (let c = 1; c < C.cols; c++) { const x = -C.cols * C.cell / 2 + c * C.cell; lines.push(x, y, z0 - C.cell / 2, x, y, z0 - C.cell / 2 + C.rows * C.cell); }
    for (let r = 1; r < C.rows; r++) { const z = z0 - C.cell / 2 + r * C.cell; lines.push(-C.cols * C.cell / 2, y, z, C.cols * C.cell / 2, y, z); }
    const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(lines, 3));
    scene.add(new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: '#2a2c30', transparent: true, opacity: 0.55 })));
  }

  W.setBlood = (k) => {
    moon.color.copy(W.moonBase).lerp(W.moonBlood, k);
    W.hemi.color.copy(W.hemiBase).lerp(W.hemiBlood, k * 0.6);
    scene.fog.color.copy(W.fogBase).lerp(W.fogBlood, k);
    scene.background.copy(scene.fog.color);
    W.moonReflMat.color.set('#fbf6e8').lerp(new THREE.Color('#ff9a86'), k);
    W.craterMat.color.set('#d9d2bd').lerp(new THREE.Color('#c0503c'), k);
    W.water.material.emissive.set('#2bb7d8').lerp(new THREE.Color('#d84a3a'), k * 0.55);
  };
  return W;
}
