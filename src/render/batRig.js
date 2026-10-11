// Procedural flight animation for the rigged bats (skeleton built in blender/build_assets.py).
//
// Real bat wing beat, simplified:
//  - Downstroke (power): wings fully spread, sweep down and a little forward, outer wing lags.
//  - Upstroke (recovery): elbow and wrist fold, fingers close the fan so the wing gets shorter,
//    the wing lifts and sweeps back, then snaps open again at the top.
// Ears, head, and legs follow with a little lag so the whole body feels alive.
import * as THREE from 'three';

const TAU = Math.PI * 2;
const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1);
const _q = new THREE.Quaternion(), _a = new THREE.Vector3();
const smooth = (t) => t * t * (3 - 2 * t);

export class BatRig {
  /** root: the loaded glTF scene for one bat. */
  constructor(root) {
    this.root = root;
    root.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
    this.bones = {};
    root.traverse((o) => {
      if (!o.isBone) return;
      const m = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld);
      const modelQ = new THREE.Quaternion(); m.decompose(new THREE.Vector3(), modelQ, new THREE.Vector3());
      this.bones[o.name] = { bone: o, rest: o.quaternion.clone(), invModelQ: modelQ.invert() };
    });
    const head = this.bones.head;
    // eye position relative to the head bone (for the glow sprite)
    this.eyeLocal = new THREE.Vector3(0, 0.27, 0.42).applyMatrix4(
      new THREE.Matrix4().copy(head.bone.matrixWorld).invert().multiply(root.matrixWorld));
    this.t = Math.random() * 10;
    this.twitch = 0; this.twitchSide = 1; this.nextTwitch = 2 + Math.random() * 3;
    this.legSwing = 0; this.prevRoll = 0;
  }

  /** Begin a pose: reset bones to rest. */
  _reset() { for (const k in this.bones) this.bones[k].bone.quaternion.copy(this.bones[k].rest); }

  /** Rotate bone `name` by `ang` around a MODEL-space axis (as it is at rest), on top of its current pose. */
  _rot(name, axis, ang) {
    if (!ang) return;
    const b = this.bones[name]; if (!b) return;
    _a.copy(axis).applyQuaternion(b.invModelQ);
    b.bone.quaternion.multiply(_q.setFromAxisAngle(_a, ang));
  }

  /**
   * phase: wing-beat phase in radians (keeps increasing)
   * o: { speed, stun, turn, carrying, dt, time }
   */
  update(phase, o) {
    this._reset();
    const p = ((phase / TAU) % 1 + 1) % 1;
    const c = Math.cos(p * TAU), sn = Math.sin(p * TAU);
    const stunned = o.stun > 0;
    const hover = Math.max(0, 1 - o.speed / 3);           // slow = more vigorous hovering beat
    const fold = smooth(Math.max(0, -sn));                 // 0 on downstroke, peaks mid-upstroke
    const amp = 0.52 + hover * 0.18;

    for (const [s, sfx] of [[1, '_L'], [-1, '_R']]) {
      let elev = 0.12 + amp * c;                            // + = wing up
      let sweep = -0.22 * sn + fold * 0.3;                  // + = swept back
      let f = fold * (0.6 + hover * 0.2);
      if (stunned) {                                        // dizzy: floppy, out of sync flailing
        const w = Math.sin(o.time * (s > 0 ? 17 : 13));
        elev = 0.25 + 0.7 * w; sweep = 0.2 + 0.3 * Math.sin(o.time * 9 + s); f = 0.45 + 0.35 * Math.sin(o.time * 11 + s * 2);
      }
      // in turns the outside wing beats a little harder
      elev *= 1 - s * o.turn * 0.25;
      this._rot('upperarm' + sfx, Z, s * elev);
      this._rot('upperarm' + sfx, Y, s * sweep);
      this._rot('upperarm' + sfx, X, 0.18 * sn);            // leading edge pitches down on the power stroke
      // elbow + wrist fold the wing in on the upstroke; outer wing lags the beat
      this._rot('forearm' + sfx, Y, s * f * 0.6);
      this._rot('forearm' + sfx, Z, s * (0.28 * sn - 0.1));
      this._rot('hand' + sfx, Y, s * f * 0.5);
      this._rot('hand' + sfx, Z, s * (0.22 * sn - 0.05 - f * 0.2));
      // fingers close the fan toward finger 5, and curl down for a cupped wing
      this._rot('d2' + sfx, Y, s * f * 0.4);
      this._rot('d3' + sfx, Y, s * f * 0.36);
      this._rot('d4' + sfx, Y, s * f * 0.2);
      this._rot('d5' + sfx, Y, s * f * 0.06);
      for (const d of ['d2', 'd3', 'd4', 'd5']) this._rot(d + sfx, Z, s * (-0.08 - 0.18 * f + 0.1 * sn));
      this._rot('thumb' + sfx, Y, -s * 0.2);

      // legs: trail back with speed, grip forward when carrying, swing with the beat
      const legBack = o.carrying ? -0.55 : 0.25 + Math.min(0.6, o.speed * 0.09);
      this._rot('leg' + sfx, X, legBack + 0.08 * c + (stunned ? 0.4 * Math.sin(o.time * 15 + s) : 0));
      this._rot('leg' + sfx, Z, -s * 0.12);
      this._rot('foot' + sfx, X, o.carrying ? -0.9 : 0.35 + 0.1 * sn);
    }

    // body pitches with each stroke, head stays steadier (counter-rotates) and looks into turns
    this._rot('body', X, 0.07 * sn + (stunned ? 0.3 * Math.sin(o.time * 7) : 0));
    this._rot('head', X, -0.06 * sn);
    this._rot('head', Y, o.turn * 0.5);
    this._rot('head', Z, o.turn * 0.25 + (stunned ? 0.35 * Math.sin(o.time * 9) : 0));

    // ears flop with lag, plus the odd random twitch
    this.nextTwitch -= o.dt;
    if (this.nextTwitch <= 0) { this.twitch = 1; this.twitchSide = Math.random() < 0.5 ? 1 : -1; this.nextTwitch = 2 + Math.random() * 4; }
    this.twitch = Math.max(0, this.twitch - o.dt * 5);
    const lagC = Math.cos(p * TAU - 1.1);
    for (const [s, sfx] of [[1, '_L'], [-1, '_R']]) {
      const tw = this.twitchSide === s ? Math.sin(this.twitch * Math.PI) * 0.45 : 0;
      this._rot('ear' + sfx, X, -0.12 * lagC - Math.min(0.5, o.speed * 0.05) + tw);
      this._rot('ear' + sfx, Z, s * (0.08 * lagC + (stunned ? 0.4 * Math.sin(o.time * 12 + s) : 0)));
    }
  }

  eyeWorld(target) {
    return target.copy(this.eyeLocal).applyMatrix4(this.bones.head.bone.matrixWorld);
  }
}
