/*
 * Optional ambient sound, synthesised on the fly (no audio files).
 * Filtered brown noise swells like surf; a master low-pass closes as
 * the camera sinks so the sea goes muffled underwater.
 */
(function () {
  'use strict';
  let ctx = null, master, lowpass, on = false, lastDepth = null;

  function noiseBuffer(ac, seconds) {
    const len = ac.sampleRate * seconds;
    const buf = ac.createBuffer(2, len, ac.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let last = 0;
      for (let i = 0; i < len; i++) {
        last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; // brown
        d[i] = last * 3.2;
      }
    }
    return buf;
  }

  function layer(ac, buf, dest, { type, freq, q, gain, rate, depth, offset }) {
    const src = ac.createBufferSource();
    src.buffer = buf; src.loop = true;
    src.playbackRate.value = 0.9 + Math.random() * 0.2;
    const f = ac.createBiquadFilter();
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ac.createGain();
    g.gain.value = gain;
    // slow swell
    const lfo = ac.createOscillator();
    lfo.frequency.value = rate;
    const lfoGain = ac.createGain();
    lfoGain.gain.value = gain * depth;
    lfo.connect(lfoGain).connect(g.gain);
    src.connect(f).connect(g).connect(dest);
    src.start(0, offset);
    lfo.start();
  }

  function build() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0;
    lowpass = ctx.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.value = 9000;
    lowpass.Q.value = 0.4;
    lowpass.connect(master).connect(ctx.destination);
    const buf = noiseBuffer(ctx, 6);
    layer(ctx, buf, lowpass, { type: 'lowpass', freq: 520, q: 0.6, gain: 0.55, rate: 0.085, depth: 0.7, offset: 0 });
    layer(ctx, buf, lowpass, { type: 'bandpass', freq: 1400, q: 0.5, gain: 0.16, rate: 0.11, depth: 0.95, offset: 2.1 });
    layer(ctx, buf, lowpass, { type: 'highpass', freq: 4200, q: 0.3, gain: 0.05, rate: 0.13, depth: 1.0, offset: 3.7 });
    return true;
  }

  function setDepth(d) {
    if (!ctx || !on) return;
    if (lastDepth !== null && Math.abs(d - lastDepth) < 0.05) return;
    lastDepth = d;
    // above water: open; just under: ~600 Hz; deep: ~140 Hz
    const f = d <= 0 ? 9000 : d < 2 ? 9000 - (d / 2) * 8400 : Math.max(140, 600 * Math.exp(-(d - 2) * 0.004));
    lowpass.frequency.setTargetAtTime(f, ctx.currentTime, 0.25);
    const vol = d <= 0 ? 0.5 : 0.5 * Math.max(0.35, Math.exp(-d * 0.0012));
    master.gain.setTargetAtTime(vol, ctx.currentTime, 0.4);
  }

  function toggle(depth) {
    if (!ctx && !build()) return false;
    on = !on;
    if (on) {
      ctx.resume();
      lastDepth = null;
      setDepth(depth || 0);
    } else {
      master.gain.setTargetAtTime(0, ctx.currentTime, 0.3);
    }
    return on;
  }

  window.OceanSound = { toggle, setDepth, get on() { return on; } };
})();
