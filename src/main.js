// Bat Siege entry point: sets up rendering, input, HUD, and connects game events to effects + sounds.
import * as THREE from 'three';
import { Game, inCastle, cellAt, blockTop, cellPos, completion } from './game/game.js';
import { CONFIG, COST } from './game/config.js';
import { loadModels, makeGlowTexture } from './render/assets.js';
import { buildWorld } from './render/world.js';
import { CastleView } from './render/castles.js';
import { Actors } from './render/actors.js';
import { GlowBatch, Sparkles, Debris, FloatText } from './render/fx.js';
import { initAudio, sfx, setMuted, isMuted } from './audio.js';
import { Tutorial } from './ui/tutorial.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

const $ = (id) => document.getElementById(id);
const MOBILE = matchMedia('(pointer:coarse)').matches;
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const DEBUG = /[?&]debug/.test(location.search);
const G = CONFIG.grid;

// ------------------------------------------------------------------ renderer + camera
const canvas = $('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(MOBILE ? 1.75 : 2, window.devicePixelRatio || 1));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.2;
renderer.info.autoReset = false;   // count every pass (bloom renders several) per frame

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 200);
const camTarget = new THREE.Vector3(0, 0, 0.9);
const camDir = new THREE.Vector3(0, 24, 12.5).normalize();
let camDist = 30;
let shakeAmt = 0;
let finale = null;   // end-of-match camera move + fireworks

// Soft bloom on glowing things: desktop only (phones skip it to keep 60 fps). ?bloom=0 / ?bloom=1 to force.
const bloomParam = new URLSearchParams(location.search).get('bloom');
let composer = null, bloomPass = null;
function setupBloom() {
  if (bloomParam === '0' || (MOBILE && bloomParam !== '1')) return;
  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  bloomPass = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.5, 0.55, 0.82);
  composer.addPass(bloomPass);
  composer.addPass(new OutputPass());
  composer.setPixelRatio(renderer.getPixelRatio());
  composer.setSize(innerWidth, innerHeight);
}
function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  if (composer) { composer.setPixelRatio(renderer.getPixelRatio()); composer.setSize(w, h); }
  camera.aspect = w / h;
  const th = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
  camDist = Math.max((camera.aspect > 1 ? 11.6 : 12.4) / th, 6.4 / (th * camera.aspect));
  camTarget.z = camera.aspect > 1 ? 1.5 : 0.6 + (camera.aspect < 0.7 ? 0.4 : 0);
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize); resize();

// ------------------------------------------------------------------ game + views (built after load)
const game = new Game();
let world, castles, actors, glow, sparkles, debris, floats;
let tool = null, hoverCell = null;
const tutorial = new Tutorial({ game, camera, toast: (m, i, d) => toast(m, i, d), tools: [...document.querySelectorAll('.tool')] });

const BLOCK_COLORS = {
  wood: ['#d97a2b', '#c4682a', '#8f4a22', '#e58e40'],
  stone: ['#bdb8ae', '#a29d94', '#8a857d'],
  bone: ['#efe6cf', '#e3d7b8', '#d6c8a3'],
  turret: ['#7f7b86', '#6e6a76', '#b9a2ff'],
};

// ------------------------------------------------------------------ HUD
const ui = {
  youBar: $('youBar'), rivalBar: $('rivalBar'), youPct: $('youPct'), rivalPct: $('rivalPct'),
  moth: $('mothCount'), mothBox: $('mothBox'), timer: $('timer'), tray: document.querySelector('.tray'), drop: $('dropBtn'),
  toast: $('toast'), banner: $('banner'), vignette: $('vignette'), debug: $('debug'),
};
const tools = [...document.querySelectorAll('.tool')];
function setTool(t) { tool = t; for (const b of tools) b.setAttribute('aria-pressed', String(b.dataset.tool === t)); }
let toastT = 0;
function toast(msg, info = false, dur = 1.9) {
  ui.toast.textContent = msg; ui.toast.classList.toggle('info', info); ui.toast.classList.add('on'); toastT = dur;
}
function nope(btn, msg) {
  if (btn) { btn.classList.remove('shake'); void btn.offsetWidth; btn.classList.add('shake'); }
  toast(msg); sfx('bad');
}
function buzz(ms) { if (navigator.vibrate && !REDUCED) try { navigator.vibrate(ms); } catch (e) { /* ignore */ } }
function shake(a) { if (!REDUCED) shakeAmt = Math.max(shakeAmt, a); }

for (const btn of tools) {
  btn.addEventListener('click', (e) => {
    e.stopPropagation(); initAudio();
    if (game.state !== 'play') return;
    const t = btn.dataset.tool;
    if (t === 'rock' || t === 'termites') {
      const err = game.tryLoad(t);
      if (err) return nope(btn, err);
      setTool(null);
      toast(t === 'rock' ? 'Rock loaded. Fly over a rival block' : 'Termites loaded. Fly over a big block', true, 1.4);
    } else {
      setTool(tool === t ? null : t);
      sfx('tap');
      if (tool && !game.player.home) toast('Fly home to build', true);
    }
  });
}
ui.drop.addEventListener('pointerdown', (e) => { e.stopPropagation(); e.preventDefault(); game.playerDrop(); });
const muteBtn = $('muteBtn');
function syncMute() {
  muteBtn.setAttribute('aria-pressed', String(isMuted()));
  muteBtn.setAttribute('aria-label', isMuted() ? 'Unmute sound' : 'Mute sound');
  $('waves').style.opacity = isMuted() ? 0 : 1; $('cross').style.opacity = isMuted() ? 1 : 0;
}
muteBtn.addEventListener('click', (e) => { e.stopPropagation(); initAudio(); setMuted(!isMuted()); syncMute(); });
syncMute();

// ------------------------------------------------------------------ input
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit = new THREE.Vector3();
function pointAt(e, y) {
  const r = canvas.getBoundingClientRect();
  ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  plane.constant = -y;
  return ray.ray.intersectPlane(plane, hit) ? hit.clone() : null;
}
/** Which of your castle squares is under the pointer (accounts for block height). */
function castleCellAt(e) {
  let p = pointAt(e, G.floor);
  if (!p || !inCastle(game.you, p.x, p.z, 0.2)) return null;
  let cl = cellAt(game.you, p.x, p.z);
  for (let i = 0; i < 2 && cl; i++) {   // refine against the block's top surface
    const top = blockTop(game.you, cl.c, cl.r);
    const p2 = pointAt(e, top); if (!p2) break;
    const c2 = cellAt(game.you, p2.x, p2.z);
    if (!c2) break;
    cl = c2;
  }
  return cl;
}
/** Which rival square is under the pointer (for aiming turrets). */
function rivalCellAt(e) {
  let p = pointAt(e, G.floor);
  if (!p || !inCastle(game.rival, p.x, p.z, 0.3)) return null;
  let cl = cellAt(game.rival, p.x, p.z);
  for (let i = 0; i < 2 && cl; i++) {
    const p2 = pointAt(e, blockTop(game.rival, cl.c, cl.r)); if (!p2) break;
    const c2 = cellAt(game.rival, p2.x, p2.z); if (!c2) break;
    cl = c2;
  }
  return cl;
}

// Floating joystick: put your thumb down anywhere and drag; the bat flies that way while you hold.
// A quick tap (no drag) builds on your castle or aims your turrets at a rival block.
const JOY_R = 58, TAP_MOVE = 12, TAP_TIME = 320;
const joyEl = $('joy'), knobEl = $('joyKnob');
const joy = { id: null, x0: 0, y0: 0, t0: 0, active: false, vx: 0, vz: 0 };
canvas.addEventListener('pointerdown', (e) => {
  initAudio();
  if (game.state !== 'play' || joy.id !== null) return;
  joy.id = e.pointerId; joy.x0 = e.clientX; joy.y0 = e.clientY; joy.t0 = performance.now(); joy.active = false;
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', (e) => {
  if (!MOBILE && joy.id === null) hoverCell = castleCellAt(e);
  if (e.pointerId !== joy.id) return;
  const dx = e.clientX - joy.x0, dy = e.clientY - joy.y0, d = Math.hypot(dx, dy);
  if (!joy.active && d > TAP_MOVE) {
    joy.active = true;
    joyEl.style.transform = `translate(${joy.x0}px,${joy.y0}px)`; joyEl.hidden = false;
  }
  if (!joy.active) return;
  const k = Math.min(1, d / JOY_R) / (d || 1);
  joy.vx = dx * k; joy.vz = dy * k;            // screen up = toward the rival (camera looks down from the player's side)
  knobEl.style.transform = `translate(${joy.vx * JOY_R}px,${joy.vz * JOY_R}px)`;
});
function endJoy(e) {
  if (e.pointerId !== joy.id) return;
  const tap = !joy.active && performance.now() - joy.t0 < TAP_TIME;
  joy.id = null; joy.active = false; joy.vx = joy.vz = 0; joyEl.hidden = true;
  if (tap && e.type === 'pointerup') handleTap(e);
}
canvas.addEventListener('pointerup', endJoy); canvas.addEventListener('pointercancel', endJoy);
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

function handleTap(e) {
  if (game.state !== 'play') return;
  if (tool && game.player.home) {
    const cl = castleCellAt(e);
    if (cl) {
      const err = game.tryBuild(cl.c, cl.r, tool);
      if (err) nope(tools.find((b) => b.dataset.tool === tool), err);
      return;
    }
  }
  const rc = rivalCellAt(e);
  if (rc) {
    const err = game.setTarget(rc.c, rc.r);
    if (err) nope(tools.find((b) => b.dataset.tool === 'turret'), err);
    return;
  }
  if (tool && !game.player.home) toast('Fly home to build', true);
}

const keys = {};
const KEYMAP = { w: [0, -1], arrowup: [0, -1], s: [0, 1], arrowdown: [0, 1], a: [-1, 0], arrowleft: [-1, 0], d: [1, 0], arrowright: [1, 0] };
function updateMove() {
  let x = 0, z = 0;
  for (const k in KEYMAP) if (keys[k]) { x += KEYMAP[k][0]; z += KEYMAP[k][1]; }
  const l = Math.hypot(x, z);
  if (l) { x /= l; z /= l; } else { x = joy.vx; z = joy.vz; }
  game.input.move.x = x; game.input.move.z = z;
}
addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if (KEYMAP[k]) { keys[k] = true; e.preventDefault(); return; }
  if (e.repeat) return;
  if (k === ' ') { e.preventDefault(); initAudio(); game.playerDrop(); }
  const idx = '123456'.indexOf(k); if (idx >= 0 && tools[idx]) tools[idx].click();
  if (k === 'escape') setTool(null);
  if (k === 'm') muteBtn.click();
  if ((k === 'enter') && !$('startScreen').hidden) $('playBtn').click();
});
addEventListener('keyup', (e) => { const k = e.key.toLowerCase(); if (KEYMAP[k]) keys[k] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

// ------------------------------------------------------------------ screens
$('playBtn').addEventListener('click', () => {
  initAudio(); sfx('start');
  $('startScreen').hidden = true; setHud(true); game.start(); intro();
  if (!tutorial.active) setTimeout(() => toast('Grab moths, then fly home to build', true), 400);
});
$('againBtn').addEventListener('click', () => {
  initAudio(); sfx('start');
  resetViews(); game.reset(); $('endScreen').hidden = true; game.start(); intro();
});
function intro() {
  ui.banner.className = 'banner go'; ui.banner.innerHTML = 'Fly!<small>Build up. Knock them down.</small>';
  requestAnimationFrame(() => ui.banner.classList.add('on'));
  setTimeout(() => sfx('fly'), 120);
  setTimeout(() => ui.banner.classList.remove('on'), 1300);
}
function setHud(on) { for (const id of ['hudTop', 'hudBottom', 'muteBtn']) $(id).style.opacity = on ? '' : '0'; }
function updateFinale(dt) {
  if (!finale) return;
  finale.t += dt; finale.next -= dt;
  const castle = finale.outcome === 'lose' ? game.rival : game.you;
  if (finale.next <= 0 && finale.t < 6) {
    finale.next = finale.outcome === 'win' ? 0.32 : 0.5;
    const p = { x: (Math.random() - 0.5) * 8, y: 2.5 + Math.random() * 2, z: castle.cz + (Math.random() - 0.5) * 3 };
    if (finale.outcome === 'win') {
      const col = ['#3fd3b6', '#ffd27a', '#ff8a5c', '#c9b8ff'][(Math.random() * 4) | 0];
      sparkles.burst(p, col, 22, 3.2, 0.5, 1.1); sparkles.ring(p, '#ffffff', 10, 3, 0.3); sfx('firework');
    } else if (finale.outcome === 'lose') {
      const loser = game.you, c = (Math.random() * 6) | 0, r = (Math.random() * 3) | 0;
      const b = loser.cells[r][c];
      if (b) { const q = cellPos(loser, c, r); q.y = blockTop(loser, c, r); debris.burst(q, BLOCK_COLORS[b.type], 6, 1.4, 0.8); b.shake = 0.3; }
    }
  }
}
function resetViews() {
  finale = null;
  setTool(null); tutorial.reset();
  sparkles.clear(); debris.clear(); floats.clear(); actors.clear();
  ui.timer.classList.remove('blood'); ui.vignette.className = 'vignette';
}
function showEnd(outcome) {
  const title = $('resultTitle');
  title.className = 'result ' + outcome;
  title.textContent = outcome === 'win' ? 'Victory' : outcome === 'lose' ? 'Defeated' : 'Stalemate';
  $('resultLine').textContent = outcome === 'win' ? 'Your castle stands tall under the moon.'
    : outcome === 'lose' ? 'The rival bat out-built you this time.' : 'Both castles stand. Rematch?';
  $('fYou').textContent = Math.round(completion(game.you) * 100) + '%';
  $('fRival').textContent = Math.round(completion(game.rival) * 100) + '%';
  $('sMoths').textContent = game.stats.moths; $('sBroken').textContent = game.stats.broken; $('sPerfect').textContent = game.stats.perfect;
  $('endScreen').hidden = false;
  $('againBtn').focus({ preventScroll: true });
}

// ------------------------------------------------------------------ game events -> effects + sound
const V = (p) => new THREE.Vector3(p.x, p.y, p.z);
function topOf(side, c, r, level) {
  const castle = side === 'you' ? game.you : game.rival;
  const p = cellPos(castle, c, r);
  return new THREE.Vector3(p.x, p.y + (level ?? 1) * G.levelHeight, p.z);
}
let fxErrors = 0;
function handleEvents() {
  for (const ev of game.events) {
    try { handleEvent(ev); } catch (err) { if (fxErrors++ < 5) console.error('[bat-siege] effect failed for', ev.type, err); }
  }
  game.events.length = 0;
}
function handleEvent(ev) {
    tutorial.onEvent(ev);
    switch (ev.type) {
      case 'place': {
        const p = topOf(ev.side, ev.c, ev.r, ev.level);
        debris.burst(p, BLOCK_COLORS[ev.blockType], 7, 1.6, 0.8);
        sparkles.ring(p, ev.side === 'you' ? '#3fd3b6' : '#ff6a3d', 10, 2.2, 0.3);
        if (ev.side === 'you') sfx(ev.blockType === 'wood' ? 'knockWood' : ev.blockType === 'bone' ? 'knockBone' : 'knockStone');
        else if (Math.random() < 0.6) sfx(ev.blockType === 'wood' ? 'knockWood' : 'knockStone');
        break;
      }
      case 'levelBreak': {
        const p = topOf(ev.side, ev.c, ev.r, ev.level + 1);
        debris.burst(p, BLOCK_COLORS[ev.blockType], 12, 2.4, 1.1); sfx('break');
        break;
      }
      case 'destroy': {
        const p = topOf(ev.side, ev.c, ev.r, 1);
        debris.burst(p, BLOCK_COLORS[ev.blockType], 22, 3, 1.25);
        debris.burst(p, ['#3a3530', '#5a5048'], 6, 1.5, 0.7);
        sfx('smash'); shake(ev.side === 'you' ? 0.5 : 0.3);
        floats.add(V(p).setY(p.y + 0.4), ev.side === 'you' ? 'Block lost!' : 'Smashed!', ev.side === 'you' ? '#ff8a6a' : '#ffd27a', 20);
        break;
      }
      case 'hit': {
        const p = V(ev.pos);
        if (ev.cargo === 'rock') {
          sfx('smash'); shake(ev.byPlayer ? 0.32 : 0.5); buzz(ev.byPlayer ? 25 : 45);
          debris.burst(p, ['#8d929b', '#6c7078'], 6, 2, 0.9);
          floats.add(p.clone().setY(p.y + 0.6), '-' + ev.dmg, ev.byPlayer ? '#ffd27a' : '#ff8a6a', 26);
        } else {
          sfx('chomp'); shake(0.15);
          debris.burst(p, ['#5a3418', '#d9452b'], 8, 1.4, 0.6);
          floats.add(p.clone().setY(p.y + 0.6), 'Termites!', '#ff9a7a', 22);
        }
        if (!ev.byPlayer) { $('youBar').parentElement.classList.remove('flash'); void ui.youBar.offsetWidth; $('youBar').parentElement.classList.add('flash'); }
        if (ev.perfect) {
          sfx('perfect'); buzz([20, 40, 30]);
          sparkles.burst(p.clone().setY(p.y + 0.3), '#fff2b0', 18, 2.4, 0.5);
          sparkles.ring(p.clone().setY(p.y + 0.1), '#ffd27a', 16, 3.5, 0.4);
          floats.add(p.clone().setY(p.y + 1.5), 'Perfect!', '#fff2b0', 30, 'big');
        }
        break;
      }
      case 'miss': {
        const p = V(ev.pos);
        debris.burst(p.setY(Math.max(0.2, p.y)), ['#6a5236', '#7d6a4a', '#4a5a3a'], 8, 1.3, 0.7);
        sfx('thud'); shake(0.08);
        if (ev.byPlayer && !ev.own) floats.add(p.clone().setY(p.y + 0.5), 'Miss', '#c9d2ea', 19);
        break;
      }
      case 'mothEaten': {
        if (ev.golden) {
          sparkles.burst(ev.pos, '#ffe066', 24, 2.6, 0.5); sparkles.ring(ev.pos, '#fff3b0', 16, 3.2, 0.35);
          sfx('goldenEat');
          if (ev.side === 'you') { floats.add(ev.pos, '+' + ev.value, '#ffe066', 32, 'big'); buzz([20, 30, 20]); for (let i = 0; i < 3; i++) setTimeout(() => flyToCounter(ev.pos), i * 90); }
          else { floats.add(ev.pos, '+' + ev.value, '#ff9a6a', 24); taunt('Ha ha! Mine!'); }
          break;
        }
        sparkles.burst(ev.pos, '#ffb347', 9, 1.5, 0.4);
        if (ev.side === 'you') {
          sfx('moth'); floats.add(ev.pos, '+1', '#ffd27a', 19);
          flyToCounter(ev.pos);
        }
        break;
      }
      case 'drop': sfx('whoosh'); break;
      case 'load': if (ev.side === 'you') sfx('load'); break;
      case 'orbFire': sfx('zap'); break;
      case 'ghosted': {
        sparkles.burst(ev.pos, '#c9b8ff', 16, 2, 0.45);
        if (ev.side === 'you') {
          sfx('hit'); shake(0.25); buzz(60); if (ev.side === 'you') taunt('Boo!');
          floats.add(ev.pos, ev.lost ? 'Ghosted! -1' : 'Ghosted!', '#c9b8ff', 22);
          ui.vignette.classList.add('hurt'); setTimeout(() => ui.vignette.classList.remove('hurt'), 160);
        } else floats.add(ev.pos, 'Ghosted!', '#c9b8ff', 18);
        break;
      }
      case 'golden':
        sfx('golden'); toast('A golden moth appeared! Worth 5', true, 1.8);
        break;
      case 'goldenGone':
        sparkles.burst(ev.pos, '#ffe066', 10, 1.2, 0.4);
        break;
      case 'streak':
        sfx('streak', { n: ev.n });
        floats.add({ x: ev.pos.x, y: ev.pos.y + 0.9, z: ev.pos.z }, `Streak x${ev.n}! +1`, '#ffe9a0', 22, 'big');
        break;
      case 'bump': {
        const youHit = ev.hitter === 'you';
        sfx('bonk'); shake(youHit ? 0.18 : 0.3); buzz(youHit ? 25 : 50);
        sparkles.ring(ev.pos, '#ffffff', 12, 3, 0.35); sparkles.burst(ev.pos, '#ffe9a0', 8, 2, 0.35);
        floats.add({ x: ev.pos.x, y: ev.pos.y + 0.8, z: ev.pos.z }, youHit ? (ev.stole ? 'Bonk! +1' : 'Bonk!') : (ev.stole ? 'Bonked! -1' : 'Bonked!'), youHit ? '#7ff5dc' : '#ff8a6a', 24, 'big');
        if (ev.dropped && !youHit) toast('Your cargo fell!', false, 1.2);
        taunt(youHit ? ['Hey!', 'Ow!', 'Rude!'][(Math.random() * 3) | 0] : ['Mine!', 'Too slow!', 'Hehe!'][(Math.random() * 3) | 0]);
        break;
      }
      case 'target':
        sfx('tap'); toast('Turrets aiming there', true, 1.2);
        break;
      case 'targetLost':
        if (ev.side === 'you') toast('Target down! Tap another rival block', true, 1.6);
        break;
      case 'shellFire': sfx('zap'); break;
      case 'shellHit': {
        const p = V(ev.pos);
        sparkles.burst(p, '#b49bff', 10, 2, 0.4); debris.burst(p, ['#8a7bc0', '#5a4f80'], 3, 1.2, 0.6);
        sfx('thud'); shake(ev.side === 'you' ? 0.2 : 0.08);
        floats.add(p.clone().setY(p.y + 0.5), '-' + ev.dmg, ev.byPlayer ? '#d9ccff' : '#ff8a6a', 20);
        break;
      }
      case 'heal': {
        const castle = ev.side === 'you' ? game.you : game.rival;
        const b = castle.cells[ev.r][ev.c];
        if (b) sparkles.burst(topOf(ev.side, ev.c, ev.r, b.level).setY(blockTop(castle, ev.c, ev.r) + 0.25), '#9dffb0', 2, 0.6, 0.3);
        break;
      }
      case 'chomp': {
        if (ev.side === 'rival' || Math.random() < 0.6) sfx('chomp');
        if (Math.random() < 0.5) {
          const castle = ev.side === 'you' ? game.you : game.rival;
          const p = cellPos(castle, ev.c, ev.r); p.y = blockTop(castle, ev.c, ev.r);
          debris.burst({ x: p.x + (Math.random() - 0.5) * 0.8, y: p.y, z: p.z + (Math.random() - 0.5) * 0.8 }, ['#c07a3a', '#8a5a2a'], 1, 0.8, 0.5);
        }
        break;
      }
      case 'bloodMoon':
        sfx('blood'); shake(0.2);
        ui.banner.className = 'banner';
        ui.banner.innerHTML = 'Blood moon<small>Every attack does double damage</small>';
        ui.banner.classList.add('on'); setTimeout(() => ui.banner.classList.remove('on'), 2800);
        ui.timer.classList.add('blood'); ui.vignette.classList.add('on');
        break;
      case 'end':
        sfx(ev.outcome === 'win' ? 'win' : 'lose'); setTool(null);
        finale = { t: 0, outcome: ev.outcome, next: 0 };
        setTimeout(() => showEnd(ev.outcome), 1700);
        break;
      default: break;
    }
}

// the rival bat shouts little reactions
let lastTaunt = -10;
function taunt(text) {
  if (time - lastTaunt < 2.5) return;
  lastTaunt = time;
  const p = game.foe.pos;
  floats.add({ x: p.x, y: p.y + 1.9, z: p.z - 0.6 }, text, '#ffb08a', 18, 'taunt');
}

// eaten moths fly up into the moth counter
const MOTH_SVG = document.querySelector('#mothBox svg').outerHTML;
const _fp = new THREE.Vector3();
function flyToCounter(pos) {
  _fp.set(pos.x, pos.y, pos.z).project(camera);
  const x0 = (_fp.x + 1) / 2 * innerWidth, y0 = (1 - _fp.y) / 2 * innerHeight;
  const r = ui.mothBox.querySelector('svg').getBoundingClientRect();
  const d = document.createElement('div'); d.className = 'flymoth'; d.innerHTML = MOTH_SVG;
  d.style.transform = `translate(${x0}px,${y0}px) translate(-50%,-50%) scale(1.2)`;
  $('fx').appendChild(d);
  requestAnimationFrame(() => requestAnimationFrame(() => {
    d.style.transform = `translate(${r.left + r.width / 2}px,${r.top + r.height / 2}px) translate(-50%,-50%) scale(.7)`;
    d.style.opacity = '0.9';
  }));
  setTimeout(() => {
    d.remove();
    ui.mothBox.classList.remove('bump'); void ui.mothBox.offsetWidth; ui.mothBox.classList.add('bump');
  }, 480);
}

// ------------------------------------------------------------------ HUD update
let lastSec = -1, lastMoths = -1, lastYou = -1, lastRival = -1, lastStatus = '';
function updateHud(dt) {
  if (toastT > 0) { toastT -= dt; if (toastT <= 0) ui.toast.classList.remove('on'); }
  const yc = completion(game.you), rc = completion(game.rival);
  if (yc !== lastYou) { lastYou = yc; ui.youBar.style.width = (yc * 100).toFixed(1) + '%'; ui.youPct.textContent = Math.round(yc * 100) + '%'; }
  if (rc !== lastRival) { lastRival = rc; ui.rivalBar.style.width = (rc * 100).toFixed(1) + '%'; ui.rivalPct.textContent = Math.round(rc * 100) + '%'; }
  const p = game.player;
  if (p.moths !== lastMoths) {
    lastMoths = p.moths; ui.moth.textContent = p.moths;
    for (const b of tools) b.classList.toggle('poor', p.moths < COST[b.dataset.tool]);
  }
  const sec = Math.ceil(game.timeLeft);
  if (sec !== lastSec) {
    if (game.state === 'play' && sec <= 10 && sec > 0 && lastSec !== -1) sfx('tick');
    lastSec = sec; ui.timer.textContent = Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0');
  }
  const playing = game.state === 'play';
  const showDrop = playing && !!p.carrying;
  if (ui.drop.hidden === showDrop) ui.drop.hidden = !showDrop;
  if (showDrop) ui.drop.classList.toggle('hot', game.predictLanding(p).perfect);
  // no status text: block buttons dim while you're away (you can only build at home)
  const away = playing && !p.home;
  if (away !== lastStatus) { lastStatus = away; ui.tray.classList.toggle('away', away); }
}

// ------------------------------------------------------------------ adaptive quality
// If a phone can't hold ~50 fps, step down resolution and shadow detail (once per step, never back up).
const quality = { tier: 2, t: 0, frames: 0, warm: 2.5, locked: /[?&]hq/.test(location.search) };
function adaptQuality(dt) {
  if (quality.locked || quality.tier === 0 || game.state !== 'play' || document.hidden) return;
  if (quality.warm > 0) { quality.warm -= dt; return; }
  quality.t += dt; quality.frames++;
  if (quality.t < 3) return;
  const fps = quality.frames / quality.t;
  quality.t = 0; quality.frames = 0;
  if (fps >= 48) return;
  quality.tier--;
  const dpr = Math.min(window.devicePixelRatio || 1, quality.tier === 1 ? 1.25 : 1);
  renderer.setPixelRatio(dpr);
  if (composer) { composer.dispose?.(); composer = null; glow.setLinear(false); }   // drop bloom first
  resize();
  const sz = quality.tier === 1 ? 1024 : 512;
  const sh = world.moon.shadow;
  if (sh.mapSize.x > sz) { sh.mapSize.set(sz, sz); if (sh.map) { sh.map.dispose(); sh.map = null; } }
  console.info(`[bat-siege] fps ${fps.toFixed(0)}: quality -> tier ${quality.tier}`);
  quality.warm = 1.5;
}

// ------------------------------------------------------------------ main loop
const clock = new THREE.Clock();
const ROTATE = matchMedia('(orientation:landscape) and (max-height:500px) and (pointer:coarse)');
const _camT = new THREE.Vector3();
let lastBeat = 0;
let time = 0, fpsT = 0, fpsN = 0, fps = 0;
function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, clock.getDelta());
  if (ROTATE.matches) return;   // "turn your phone upright" screen: pause the match
  time += dt;
  updateMove();
  game.update(dt);
  handleEvents();
  const beat = Math.floor(game.player.flap / (Math.PI * 2));
  if (beat !== lastBeat) { lastBeat = beat; if (game.state === 'play' && game.player.stun <= 0) sfx('flap', { vol: 0.6 + Math.min(1, game.player.speed / 6) * 0.6 }); }

  glow.begin();
  world.setBlood(game.blood ? game.bloodT : 0);
  castles.update(game, dt, time, glow, REDUCED);
  castles.updateMarks(game, tool, hoverCell, dt, time);
  actors.update(game, dt, time, glow, sparkles, $('fx'), camera);
  // castle frame torches flicker
  for (const f of world.frames) {
    f.torches.forEach((t, i) => {
      const fl = 0.8 + Math.sin(time * 12 + i * 2.3 + f.cz) * 0.1 + Math.random() * 0.08;
      glow.add(t.x, t.y + 0.04, t.z, 0.95 * fl, '#ff9a3c', 0.9);
    });
  }
  // pond + moon reflection glow
  glow.add(world.pond.position.x, 0.3, world.pond.position.z, 6.2, game.blood ? '#ff4a3a' : '#3fd8ff', 0.18 + Math.sin(time * 1.3) * 0.03);
  glow.add(world.reflWorld.x, 0.25, world.reflWorld.z, 2.4, game.blood ? '#ff5a40' : '#fff6dc', 0.55);
  tutorial.update(dt);
  if (tutorial.highlight) {
    const h = tutorial.highlight, k = 0.5 + 0.5 * Math.sin(time * 6);
    glow.add(h.x, h.y, h.z, 2.2 + k * 0.8, '#7ff5dc', 0.35 + k * 0.25);
  }
  sparkles.update(dt, glow);
  glow.end();
  debris.update(dt);
  floats.update(dt);
  updateHud(dt);
  adaptQuality(dt);

  renderer.info.reset();
  updateFinale(dt);
  shakeAmt = Math.max(0, shakeAmt - dt * 1.6);
  const sx = (Math.random() - 0.5) * shakeAmt, sz = (Math.random() - 0.5) * shakeAmt;
  let dist = camDist; const tgt = _camT.copy(camTarget);
  if (finale && !REDUCED) {   // ease the camera toward the castle that decided the match
    const k = Math.min(1, finale.t / 1.4), e = k * k * (3 - 2 * k);
    const cz = (finale.outcome === 'lose' ? game.rival : game.you).cz;
    tgt.z += (cz - tgt.z) * 0.45 * e; dist *= 1 - 0.18 * e;
  }
  camera.position.copy(tgt).addScaledVector(camDir, dist);
  camera.position.x += sx; camera.position.z += sz;
  camera.lookAt(tgt.x + sx * 0.5, tgt.y, tgt.z + sz * 0.5);
  if (window.__batSiege.camOverride) window.__batSiege.camOverride(camera, game);   // test hook
  if (composer) composer.render(); else renderer.render(scene, camera);

  if (DEBUG) {
    fpsN++; fpsT += dt;
    if (fpsT > 0.5) { fps = Math.round(fpsN / fpsT); fpsN = 0; fpsT = 0; }
    const info = renderer.info.render;
    ui.debug.textContent = `fps ${fps}\ndraw calls ${info.calls}\ntriangles ${(info.triangles / 1000).toFixed(1)}k`;
  }
}

// ------------------------------------------------------------------ boot
(async function boot() {
  try {
    const models = await loadModels((k) => { $('loadFill').style.width = Math.round(k * 100) + '%'; });
    world = buildWorld(scene, models, MOBILE);
    castles = new CastleView(scene, models);
    actors = new Actors(scene, models);
    glow = new GlowBatch(scene, makeGlowTexture());
    sparkles = new Sparkles(); debris = new Debris(scene); floats = new FloatText($('fx'), camera);
    setupBloom(); glow.setLinear(!!composer);
    if (DEBUG) ui.debug.hidden = false;
    renderer.compile(scene, camera);
    $('loadScreen').hidden = true; $('startScreen').hidden = false; setHud(false);
    $('playBtn').focus({ preventScroll: true });
    window.__batSiege = { game, renderer, scene, camera };
    frame();
  } catch (err) {
    console.error(err);
    $('loadText').textContent = 'Could not load the game. Please refresh.';
  }
})();
