// Loads the Blender .glb files and "bakes" each one into as few draw calls as possible:
// every material's color is written into the vertices, so a whole brick block becomes one mesh.
// Glowing parts (torch flames, eyes, moth wings) go into a second, unlit "glow" mesh.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export const MODEL_NAMES = [
  'block_stone_body', 'block_stone_body_arch', 'block_stone_cap', 'block_wood_body', 'block_wood_cap',
  'block_bone_body', 'block_bone_cap', 'castle_frame', 'bat_player', 'bat_rival', 'ghost', 'moth', 'rock',
  'rock_scatter', 'termite', 'termite_clump', 'tree_pine_a', 'tree_pine_b', 'bush', 'grass_tuft', 'pond',
];

export async function loadModels(onProgress) {
  const loader = new GLTFLoader();
  const base = import.meta.env.BASE_URL;
  const out = {};
  let done = 0;
  await Promise.all(MODEL_NAMES.map(async (name) => {
    // Hosts that can't serve .glb files can ship the models inside a script as base64 (window.BAT_MODELS).
    const packed = globalThis.BAT_MODELS && globalThis.BAT_MODELS[name];
    const gltf = packed
      ? await loader.parseAsync(Uint8Array.from(atob(packed), (ch) => ch.charCodeAt(0)).buffer, base)
      : await loader.loadAsync(base + name + '.glb');
    gltf.scene.updateMatrixWorld(true);
    out[name] = gltf.scene;
    onProgress && onProgress(++done / MODEL_NAMES.length);
  }));
  return out;
}

const _m = new THREE.Matrix4();
const _c = new THREE.Color();

function isGlow(mat) {
  if (!mat.emissive) return false;
  const e = mat.emissive, k = mat.emissiveIntensity ?? 1;
  return (e.r + e.g + e.b) / 3 * k >= 0.9;
}

/**
 * Bake every mesh under `root` (skipping subtrees named in `exclude`) into
 * { solid, glow } BufferGeometries with vertex colors, in `relativeTo`'s local space.
 * ao: darken vertices near the bottom so things look grounded.
 */
export function bake(root, { exclude = [], skipMaterials = [], relativeTo = root, ao = 0, aoHeight = 0.35, glowBoost = 1.6 } = {}) {
  relativeTo.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(relativeTo.matrixWorld).invert();
  const solid = [], glow = [];
  const skip = new Set(exclude);
  const visit = (o) => {
    if (o !== root && skip.has(o.name)) return;
    if (o.isMesh) {
      const mat = Array.isArray(o.material) ? o.material[0] : o.material;
      if (skipMaterials.includes(mat.name)) return;
      let g = o.geometry.clone();
      for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
      _m.multiplyMatrices(inv, o.matrixWorld);
      g.applyMatrix4(_m);
      const n = g.attributes.position.count;
      const col = new Float32Array(n * 3);
      const glowy = isGlow(mat);
      if (glowy) {
        _c.copy(mat.color).lerp(mat.emissive, 0.6).multiplyScalar(glowBoost);
      } else {
        _c.copy(mat.color);
      }
      for (let i = 0; i < n; i++) { col[i * 3] = _c.r; col[i * 3 + 1] = _c.g; col[i * 3 + 2] = _c.b; }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      (glowy ? glow : solid).push(g);
    }
    for (const ch of o.children) visit(ch);
  };
  visit(root);
  const merge = (list) => {
    if (!list.length) return null;
    if (list.some((x) => !x.index)) list = list.map((x) => (x.index ? x.toNonIndexed() : x));
    const g = mergeGeometries(list, false);
    if (ao > 0) applyAO(g, ao, aoHeight);
    g.computeBoundingSphere(); g.computeBoundingBox();
    return g;
  };
  return { solid: merge(solid), glow: merge(glow) };
}

function applyAO(g, strength, height) {
  const p = g.attributes.position, c = g.attributes.color;
  let minY = Infinity;
  for (let i = 0; i < p.count; i++) minY = Math.min(minY, p.getY(i));
  for (let i = 0; i < p.count; i++) {
    const t = Math.min(1, (p.getY(i) - minY) / height);
    const k = 1 - strength * (1 - t * t * (3 - 2 * t));
    c.setXYZ(i, c.getX(i) * k, c.getY(i) * k, c.getZ(i) * k);
  }
}

/** Positions of named empties (e.g. TorchSocket_*) relative to the model root. */
export function sockets(root, prefix) {
  const list = [];
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  root.traverse((o) => {
    if (o.name.startsWith(prefix)) list.push(new THREE.Vector3().setFromMatrixPosition(o.matrixWorld).applyMatrix4(inv));
  });
  return list;
}

export function nodeLocal(root, name) {
  const o = root.getObjectByName(name);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  return new THREE.Vector3().setFromMatrixPosition(o.matrixWorld).applyMatrix4(inv);
}

// Shared materials
export const MATS = {
  solid: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0 }),
  glow: new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }),
  glowSide: new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, toneMapped: false }),
  solidSide: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, side: THREE.DoubleSide }),
};

/** Radial-gradient texture used for every glow. */
export function makeGlowTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.22, 'rgba(255,255,255,.6)');
  gr.addColorStop(0.55, 'rgba(255,255,255,.16)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

export function canvasTexture(w, h, draw, repeat) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
  return t;
}
