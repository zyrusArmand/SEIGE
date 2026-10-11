// First-match hints: teaches the loop one step at a time, then gets out of the way.
// Shown until the player finishes all steps once (remembered in localStorage).
import * as THREE from 'three';
import { COST } from '../game/config.js';
import { turretCount } from '../game/game.js';

const KEY = 'batSiegeTutorialDone';
const STEPS = ['eat', 'goHome', 'build', 'turret', 'raid', 'done'];

export class Tutorial {
  constructor({ game, camera, toast, tools }) {
    this.game = game; this.camera = camera; this.toast = toast; this.tools = tools;
    let done = false;
    try { done = localStorage.getItem(KEY) === '1'; } catch (e) { /* storage blocked */ }
    this.active = !done;
    this.step = 0; this.t = 0; this.shown = -1;
    this.arrow = document.createElement('div');
    this.arrow.className = 'hint-arrow'; this.arrow.hidden = true;
    this.arrow.innerHTML = '<span>Home</span><svg viewBox="0 0 24 24"><path d="M12 21l-8-9h5V3h6v9h5z" fill="currentColor"/></svg>';
    document.body.appendChild(this.arrow);
    this.v = new THREE.Vector3();
    this.highlight = null;   // world position of the moth to highlight
    this.built = 0;
  }

  reset() { this.step = 0; this.t = 0; this.shown = -1; this.built = 0; this.arrow.hidden = true; }

  onEvent(ev) {
    if (ev.type === 'place' && ev.side === 'you') this.built++;
  }

  finish() {
    this.active = false; this.arrow.hidden = true; this.highlight = null;
    for (const b of this.tools) b.classList.remove('ready');
    try { localStorage.setItem(KEY, '1'); } catch (e) { /* storage blocked */ }
  }

  say(text) { if (this.shown !== this.step) { this.shown = this.step; this.toast(text, true, 3.2); } }

  update(dt) {
    this.highlight = null;
    const g = this.game, p = g.player;
    if (!this.active || g.state !== 'play') { this.arrow.hidden = true; return; }
    this.t += dt;
    const name = STEPS[this.step];
    let pulse = [];
    if (name === 'eat') {
      if (this.t > 0.6) this.say('Hold and drag your thumb to fly. Eat the glowing moths');
      let best = null, bd = 1e9;
      for (const m of g.moths) { const d = (m.pos.x - p.pos.x) ** 2 + (m.pos.z - p.pos.z) ** 2; if (d < bd) { bd = d; best = m; } }
      if (best) this.highlight = best.pos;
      if (p.moths >= 3) this.next();
    } else if (name === 'goHome') {
      this.say('Nice! Fly home to spend your moths');
      if (p.home) this.next();
    } else if (name === 'build') {
      if (p.home) {
        this.say('Pick a block, then tap a glowing square');
        pulse = ['wood', 'stone', 'bone'];
      }
      if (this.built >= 2) this.next();
    } else if (name === 'turret') {
      if (p.home && p.moths >= COST.turret) {
        this.say('Buy a turret, then tap a rival block to aim it');
        pulse = ['turret'];
      }
      if (g.you.target || this.t > 30) this.next();
      else if (turretCount(g.you) && this.shown === this.step && this.t > 1) { this.toast('Now tap a rival block to aim your turret', true, 2.5); this.shown = -2; }
    } else if (name === 'raid') {
      if (p.home && p.moths >= COST.rock && !p.carrying) {
        this.say('Load a rock, then drop it on the rival castle');
        pulse = ['rock'];
      }
      if (p.carrying || this.t > 25) this.next();
    } else {
      this.finish(); return;
    }
    for (const b of this.tools) b.classList.toggle('ready', pulse.includes(b.dataset.tool) && p.moths >= COST[b.dataset.tool]);
    // arrow over home when you should go back
    const showArrow = (name === 'goHome' || (name === 'build' && !p.home) || (name === 'raid' && !p.home && !p.carrying && p.moths >= COST.rock));
    this.arrow.hidden = !showArrow;
    if (showArrow) {
      this.v.set(0, 2.2, g.you.cz).project(this.camera);
      const x = (this.v.x + 1) / 2 * innerWidth, y = (1 - this.v.y) / 2 * innerHeight;
      this.arrow.style.transform = `translate(${x}px,${y + Math.sin(this.t * 6) * 6}px) translate(-50%,-100%)`;
    }
  }

  next() { this.step++; this.t = 0; }
}
