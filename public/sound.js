// Sound system.
// Every sound is synthesized with Web Audio, so no files are needed.
// To use your own sound, drop a file into public/sounds/ named after the
// sound (e.g. sounds/chips.mp3, sounds/win.wav). It replaces the synth version automatically.
//
// Sound names: deal, fold, check, chips, allin, street, win, turn, chat

const Sound = (() => {
  const NAMES = ['deal', 'fold', 'check', 'chips', 'allin', 'street', 'win', 'turn', 'chat'];
  let ctx = null;
  let master = null;
  let volume = Number(localStorage.getItem('poker.volume') ?? 0.6);
  let muted = localStorage.getItem('poker.muted') === '1';
  const files = {}; // name -> Audio element, if a custom file exists

  // Load any custom sound files listed by the server.
  fetch('sounds/list.json')
    .then((r) => (r.ok ? r.json() : []))
    .then((list) => {
      for (const file of list) {
        const name = file.replace(/\.[^.]+$/, '');
        if (NAMES.includes(name)) files[name] = new Audio(`sounds/${file}`);
      }
    })
    .catch(() => {});

  function ensure() {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain();
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
    master.gain.value = muted ? 0 : volume;
  }

  // --- building blocks ---
  function tone(freq, start, dur, { type = 'sine', gain = 0.3, slideTo = null } = {}) {
    const t = ctx.currentTime + start;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  function noise(start, dur, { freq = 3000, q = 1, gain = 0.3, type = 'bandpass', sweepTo = null } = {}) {
    const t = ctx.currentTime + start;
    const len = Math.ceil(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(freq, t);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(master);
    src.start(t);
  }

  // --- the sounds (tweak these to change the feel) ---
  const synth = {
    // Card flick: short bright noise burst, one per card.
    deal() { for (let i = 0; i < 4; i++) noise(i * 0.07, 0.06, { freq: 4500, q: 2, gain: 0.35 }); },
    // Fold: soft downward swish.
    fold() { noise(0, 0.25, { freq: 2500, sweepTo: 400, q: 0.8, gain: 0.25 }); },
    // Check: two knuckle knocks on the felt.
    check() { tone(140, 0, 0.08, { gain: 0.5, slideTo: 80 }); tone(140, 0.11, 0.08, { gain: 0.5, slideTo: 80 }); },
    // Chips: a few metallic clinks.
    chips() {
      [0, 0.05, 0.09, 0.16].forEach((s, i) => {
        tone(2800 + i * 350, s, 0.12, { type: 'triangle', gain: 0.12 });
        tone(4200 + i * 200, s, 0.06, { gain: 0.06 });
      });
    },
    // All-in: rising whoosh plus a pile of chips.
    allin() {
      noise(0, 0.5, { freq: 300, sweepTo: 5000, q: 1.5, gain: 0.25 });
      tone(110, 0, 0.5, { type: 'sawtooth', gain: 0.08, slideTo: 440 });
      setTimeout(() => synth.chips(), 350);
      setTimeout(() => synth.chips(), 450);
    },
    // New street: cards flipped onto the board.
    street() { for (let i = 0; i < 3; i++) noise(i * 0.09, 0.07, { freq: 3500, q: 1.5, gain: 0.3 }); },
    // Win: little major arpeggio.
    win() { [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.1, 0.35, { type: 'triangle', gain: 0.2 })); },
    // Your turn: gentle two-note chime.
    turn() { tone(880, 0, 0.25, { gain: 0.18 }); tone(1320, 0.12, 0.35, { gain: 0.15 }); },
    // Chat message: tiny blip.
    chat() { tone(1200, 0, 0.07, { type: 'square', gain: 0.04 }); },
  };

  function play(name) {
    if (muted) return;
    if (files[name]) {
      const a = files[name].cloneNode();
      a.volume = volume;
      a.play().catch(() => {});
      return;
    }
    if (!synth[name]) return;
    try { ensure(); synth[name](); } catch { /* audio not available */ }
  }

  return {
    play,
    unlock: ensure,
    setVolume(v) { volume = v; localStorage.setItem('poker.volume', v); if (master) master.gain.value = muted ? 0 : v; },
    toggleMute() { muted = !muted; localStorage.setItem('poker.muted', muted ? '1' : '0'); if (master) master.gain.value = muted ? 0 : volume; return muted; },
    get muted() { return muted; },
    get volume() { return volume; },
    NAMES,
  };
})();
