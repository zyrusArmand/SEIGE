// Synthesized sound effects (no files to load). Audio starts after the first tap.
let AC = null, master = null, sfxBus = null, ambBus = null, muted = false, noiseBuf = null;

export function initAudio() {
  if (AC) { if (AC.state === 'suspended') AC.resume(); return; }
  try {
    AC = new (window.AudioContext || window.webkitAudioContext)();
    master = AC.createGain(); master.gain.value = muted ? 0 : 0.6;
    const comp = AC.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4;
    master.connect(comp); comp.connect(AC.destination);
    sfxBus = AC.createGain(); sfxBus.connect(master);
    ambBus = AC.createGain(); ambBus.gain.value = 0.0; ambBus.connect(master);
    const len = AC.sampleRate * 2; noiseBuf = AC.createBuffer(1, len, AC.sampleRate);
    const d = noiseBuf.getChannelData(0); for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    startAmbience();
  } catch (e) { AC = null; }
}

export function setMuted(m) {
  muted = m;
  if (master) master.gain.setTargetAtTime(m ? 0 : 0.6, AC.currentTime, 0.05);
  try { localStorage.setItem('batSiegeMuted', m ? '1' : '0'); } catch (e) { /* storage blocked */ }
}
export function isMuted() { return muted; }
try { muted = localStorage.getItem('batSiegeMuted') === '1'; } catch (e) { /* storage blocked */ }

function tone(f, dur, type = 'sine', vol = 0.2, slide, delay = 0, bus = sfxBus) {
  if (!AC) return;
  const t = AC.currentTime + delay, o = AC.createOscillator(), g = AC.createGain();
  o.type = type; o.frequency.setValueAtTime(f, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + dur);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(bus); o.start(t); o.stop(t + dur + 0.03);
}
function noise(dur, vol = 0.3, freq = 800, q = 1, type = 'bandpass', delay = 0, sweep) {
  if (!AC) return;
  const t = AC.currentTime + delay;
  const s = AC.createBufferSource(); s.buffer = noiseBuf;
  const f = AC.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
  if (sweep) f.frequency.exponentialRampToValueAtTime(sweep, t + dur);
  const g = AC.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f); f.connect(g); g.connect(sfxBus); s.start(t, Math.random()); s.stop(t + dur + 0.02);
}

let lastMoth = 0, mothStep = 0;
export function sfx(n, opt = {}) {
  if (!AC) return;
  const now = AC.currentTime;
  switch (n) {
    case 'moth': { // rising blip; quick pickups climb a little scale
      mothStep = now - lastMoth < 1.2 ? Math.min(mothStep + 1, 6) : 0; lastMoth = now;
      const f = 760 * Math.pow(2, [0, 2, 4, 7, 9, 12, 14][mothStep] / 12);
      tone(f, 0.12, 'sine', 0.13, f * 1.5); tone(f * 2, 0.08, 'triangle', 0.04, f * 3, 0.02); break;
    }
    case 'knockWood': noise(0.12, 0.5, 700, 2); tone(220, 0.1, 'triangle', 0.16, 140); break;
    case 'knockStone': noise(0.16, 0.5, 380, 1.5); tone(120, 0.15, 'sine', 0.24, 70); break;
    case 'knockBone': noise(0.08, 0.35, 1800, 3); tone(520, 0.07, 'square', 0.05, 300); tone(380, 0.09, 'triangle', 0.1, 260, 0.05); break;
    case 'load': tone(330, 0.08, 'square', 0.06, 440); tone(440, 0.1, 'square', 0.06, 660, 0.07); break;
    case 'whoosh': noise(0.35, 0.28, 2400, 0.8, 'bandpass', 0, 500); break;
    case 'smash': noise(0.5, 0.75, 260, 0.7); tone(85, 0.4, 'sine', 0.4, 38); noise(0.25, 0.3, 1600, 1, 'bandpass', 0.03); break;
    case 'break': noise(0.3, 0.5, 500, 0.9); tone(140, 0.2, 'triangle', 0.15, 70); break;
    case 'thud': noise(0.18, 0.35, 300, 1); tone(90, 0.14, 'sine', 0.18, 55); break;
    case 'perfect': tone(660, 0.14, 'triangle', 0.15); tone(990, 0.22, 'triangle', 0.15, null, 0.09); tone(1320, 0.3, 'sine', 0.07, null, 0.17); break;
    case 'chomp': noise(0.05, 0.16, 2400 + Math.random() * 800, 4); break;
    case 'zap': tone(520, 0.25, 'sawtooth', 0.05, 180); tone(780, 0.18, 'sine', 0.05, 300); break;
    case 'hit': tone(300, 0.25, 'square', 0.09, 90); noise(0.2, 0.3, 900, 1); tone(1200, 0.3, 'sine', 0.05, 2400, 0.05); break;
    case 'bad': tone(200, 0.12, 'square', 0.06, 150); break;
    case 'tap': tone(900, 0.04, 'sine', 0.05); break;
    case 'blood':
      tone(110, 1.6, 'sawtooth', 0.1, 55); tone(165, 1.6, 'sine', 0.1, 82); noise(1.6, 0.18, 120, 0.5, 'lowpass');
      break;
    case 'win': [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.3, 'triangle', 0.15, null, i * 0.13)); tone(1568, 0.6, 'sine', 0.06, null, 0.55); break;
    case 'lose': [392, 330, 262, 196].forEach((f, i) => tone(f, 0.34, 'triangle', 0.14, null, i * 0.16)); break;
    case 'start': [392, 523, 659].forEach((f, i) => tone(f, 0.18, 'triangle', 0.1, null, i * 0.08)); break;
    case 'tick': tone(1400, 0.05, 'sine', 0.05); break;
    case 'flap': noise(0.16, 0.07 * (opt.vol ?? 1), 520, 0.8, 'lowpass', 0, 160); break;
    case 'fly': tone(523, 0.12, 'triangle', 0.1); tone(784, 0.22, 'triangle', 0.1, null, 0.1); break;
    case 'firework': noise(0.5, 0.25, 3000, 0.6, 'bandpass', 0, 600); tone(1800 + Math.random() * 900, 0.4, 'sine', 0.03, 600, 0.05); break;
    default: break;
  }
}

// Night ambience: soft wind + occasional cricket chirps.
function startAmbience() {
  const s = AC.createBufferSource(); s.buffer = noiseBuf; s.loop = true;
  const f = AC.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 380;
  const g = AC.createGain(); g.gain.value = 0.05;
  const lfo = AC.createOscillator(), lg = AC.createGain(); lfo.frequency.value = 0.08; lg.gain.value = 0.03;
  lfo.connect(lg); lg.connect(g.gain); lfo.start();
  s.connect(f); f.connect(g); g.connect(ambBus); s.start();
  const chirp = () => {
    if (!AC) return;
    const t = AC.currentTime, base = 4200 + Math.random() * 900;
    for (let k = 0; k < 3; k++) tone(base, 0.035, 'sine', 0.025, null, k * 0.07, ambBus);
    setTimeout(chirp, 900 + Math.random() * 2600);
    void t;
  };
  setTimeout(chirp, 1500);
  ambBus.gain.setTargetAtTime(1, AC.currentTime, 1.5);
}

// Pause all sound while the tab/app is in the background.
document.addEventListener('visibilitychange', () => {
  if (!AC) return;
  if (document.hidden) AC.suspend(); else AC.resume();
});
