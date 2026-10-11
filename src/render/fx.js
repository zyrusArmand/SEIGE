// Visual effects that are cheap on phones:
// - GlowBatch: every glow sprite in the game (torches, moths, eyes, sparkles, orbs) in ONE draw call.
// - Debris: chunky cubes in ONE instanced draw call.
// - Floating combat text as DOM labels.
import * as THREE from 'three';

const rnd = (a, b) => a + Math.random() * (b - a);

/** Parse '#rrggbb' to display-space [r,g,b] 0..1 (glows bypass color management on purpose). */
const hexCache = new Map();
export function hex(h) {
  let v = hexCache.get(h);
  if (!v) {
    const n = parseInt(h.slice(1), 16);
    v = [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
    hexCache.set(h, v);
  }
  return v;
}

export class GlowBatch {
  constructor(scene, texture, max = 700) {
    this.max = max; this.n = 0;
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    this.offset = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.color = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('offset', this.offset);
    g.setAttribute('icolor', this.color);
    g.instanceCount = 0;
    this.geo = g;
    this.size = new THREE.InstancedBufferAttribute(new Float32Array(max), 1).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('isize', this.size);
    const mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: texture }, linear: { value: 0 } },
      vertexShader: `
        attribute vec3 offset; attribute vec4 icolor; attribute float isize;
        varying vec2 vUv; varying vec3 vColor;
        void main(){
          vUv = uv; vColor = icolor.rgb;
          vec4 mv = modelViewMatrix * vec4(offset, 1.0);
          mv.xy += position.xy * isize;   // camera-facing quad
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform sampler2D map; uniform float linear; varying vec2 vUv; varying vec3 vColor;
        void main(){
          vec3 c = vColor * texture2D(map, vUv).a;
          if (linear > 0.5) c = pow(c, vec3(2.0)) * 2.4;   // composer path works in linear light
          gl_FragColor = vec4(c, 1.0);
        }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;
    scene.add(this.mesh);
  }
  setLinear(on) { this.mesh.material.uniforms.linear.value = on ? 1 : 0; }
  begin() { this.n = 0; }
  add(x, y, z, size, color, opacity = 1) {
    if (this.n >= this.max || opacity <= 0.003) return;
    const i = this.n++, c = typeof color === 'string' ? hex(color) : color;
    this.offset.array[i * 3] = x; this.offset.array[i * 3 + 1] = y; this.offset.array[i * 3 + 2] = z;
    this.color.array[i * 4] = c[0] * opacity; this.color.array[i * 4 + 1] = c[1] * opacity; this.color.array[i * 4 + 2] = c[2] * opacity;
    this.size.array[i] = size;
  }
  end() {
    this.geo.instanceCount = this.n;
    this.offset.needsUpdate = this.color.needsUpdate = this.size.needsUpdate = true;
    this.offset.addUpdateRange?.(0, this.n * 3); this.color.addUpdateRange?.(0, this.n * 4); this.size.addUpdateRange?.(0, this.n);
  }
}

/** Short-lived sparkles drawn through the GlowBatch. */
export class Sparkles {
  constructor() { this.list = []; }
  burst(p, color, n, spd, size = 0.35, life = 0.7) {
    for (let i = 0; i < n; i++) {
      if (this.list.length > 400) this.list.shift();
      const l = rnd(life * 0.6, life * 1.15);
      this.list.push({ x: p.x, y: p.y, z: p.z, vx: rnd(-1, 1) * spd, vy: rnd(0, 1.6) * spd, vz: rnd(-1, 1) * spd, life: l, max: l, color, size: size * rnd(0.7, 1.2) });
    }
  }
  ring(p, color, n, spd, size = 0.35) {
    for (let i = 0; i < n; i++) {
      const a = i / n * Math.PI * 2;
      this.list.push({ x: p.x, y: p.y, z: p.z, vx: Math.cos(a) * spd, vy: 0.3, vz: Math.sin(a) * spd, life: 0.55, max: 0.55, color, size });
    }
  }
  update(dt, glow) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const s = this.list[i]; s.life -= dt;
      if (s.life <= 0) { this.list.splice(i, 1); continue; }
      const d = 1 - Math.min(1, 2 * dt);
      s.x += s.vx * dt; s.y += s.vy * dt; s.z += s.vz * dt; s.vx *= d; s.vy *= d; s.vz *= d;
      const t = s.life / s.max;
      glow.add(s.x, s.y, s.z, s.size * (0.5 + t * 0.5), s.color, Math.min(1, t * 1.6));
    }
  }
  clear() { this.list.length = 0; }
}

/** Chunky debris cubes: one InstancedMesh, colored per instance. */
export class Debris {
  constructor(scene, max = 220) {
    this.max = max; this.list = [];
    const geo = new THREE.BoxGeometry(0.15, 0.15, 0.15);
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.9, flatShading: true });
    this.mesh = new THREE.InstancedMesh(geo, mat, max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.setColorAt(0, new THREE.Color());
    this.mesh.castShadow = true; this.mesh.frustumCulled = false; this.mesh.count = 0;
    scene.add(this.mesh);
    this.d = new THREE.Object3D(); this.c = new THREE.Color();
  }
  /** colors: array of hex strings to pick from */
  burst(p, colors, n, spd, sizeMul = 1) {
    for (let i = 0; i < n; i++) {
      if (this.list.length >= this.max) this.list.shift();
      this.list.push({
        p: new THREE.Vector3(p.x + rnd(-0.3, 0.3), p.y + rnd(-0.1, 0.2), p.z + rnd(-0.3, 0.3)),
        v: new THREE.Vector3(rnd(-1, 1) * spd, rnd(0.8, 2.2) * spd, rnd(-1, 1) * spd),
        r: new THREE.Euler(rnd(0, 6), rnd(0, 6), rnd(0, 6)), w: new THREE.Vector3(rnd(-9, 9), rnd(-9, 9), rnd(-9, 9)),
        s: rnd(0.55, 1.35) * sizeMul, life: rnd(1.0, 1.7), color: colors[(Math.random() * colors.length) | 0],
      });
    }
  }
  update(dt) {
    const L = this.list;
    for (let i = L.length - 1; i >= 0; i--) {
      const d = L[i]; d.life -= dt;
      if (d.life <= 0) { L.splice(i, 1); continue; }
      d.v.y -= 14 * dt; d.p.addScaledVector(d.v, dt);
      d.r.x += d.w.x * dt; d.r.y += d.w.y * dt; d.r.z += d.w.z * dt;
      const floor = 0.08 * d.s;
      if (d.p.y < floor) { d.p.y = floor; d.v.y *= -0.32; d.v.x *= 0.6; d.v.z *= 0.6; d.w.multiplyScalar(0.5); }
    }
    for (let i = 0; i < L.length; i++) {
      const d = L[i], s = d.s * Math.min(1, d.life / 0.35);
      this.d.position.copy(d.p); this.d.rotation.copy(d.r); this.d.scale.setScalar(s); this.d.updateMatrix();
      this.mesh.setMatrixAt(i, this.d.matrix);
      this.mesh.setColorAt(i, this.c.set(d.color));
    }
    this.mesh.count = L.length;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
  clear() { this.list.length = 0; this.mesh.count = 0; }
}

/** Floating combat text (+1, -60, Perfect!) as DOM labels that follow a world point. */
export class FloatText {
  constructor(layer, camera) { this.layer = layer; this.camera = camera; this.list = []; this.v = new THREE.Vector3(); }
  add(p, text, color = '#fff', size = 20, cls = '') {
    const d = document.createElement('div');
    d.className = 'ftext ' + cls; d.textContent = text; d.style.color = color; d.style.fontSize = size + 'px';
    this.layer.appendChild(d);
    this.list.push({ d, p: new THREE.Vector3(p.x, p.y, p.z), t: 0 });
  }
  update(dt) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const f = this.list[i]; f.t += dt;
      this.v.copy(f.p).project(this.camera);
      const x = (this.v.x + 1) / 2 * innerWidth, y = (1 - this.v.y) / 2 * innerHeight - f.t * 55;
      const s = f.t < 0.12 ? 0.5 + f.t / 0.12 * 0.75 : Math.max(1, 1.25 - (f.t - 0.12) * 2);
      f.d.style.transform = `translate(${x}px,${y}px) translate(-50%,-50%) scale(${s})`;
      f.d.style.opacity = String(Math.max(0, 1 - Math.max(0, f.t - 0.65) / 0.45));
      if (f.t > 1.1) { f.d.remove(); this.list.splice(i, 1); }
    }
  }
  clear() { for (const f of this.list) f.d.remove(); this.list.length = 0; }
}
