// Small synthesized sounds. Nothing is loaded; everything is made with
// oscillators and filtered noise, and started on the player's first input.
export function createAudio() {
  let ctx = null;
  let master = null;
  let enabled = true;
  let wind = null;
  let hum = null;
  let humGain = null;

  function ensure() {
    if (ctx) {
      if (ctx.state === "suspended") ctx.resume().catch(() => {});
      return ctx;
    }
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = enabled ? 0.8 : 0;
    master.connect(ctx.destination);
    startWind();
    return ctx;
  }

  function noiseBuffer(seconds) {
    const n = Math.floor(ctx.sampleRate * seconds);
    const b = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }

  function startWind() {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(4);
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = 320;
    f.Q.value = 0.6;
    const g = ctx.createGain();
    g.gain.value = 0.035;
    src.connect(f).connect(g).connect(master);
    src.start();
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.09;
    const lg = ctx.createGain();
    lg.gain.value = 0.02;
    lfo.connect(lg).connect(g.gain);
    lfo.start();
    wind = { src, lfo };
  }

  function tone(freq, t0, dur, { type = "sine", gain = 0.2, attack = 0.005, slide = null } = {}) {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (slide) o.frequency.exponentialRampToValueAtTime(slide, t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(master);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }

  function noise(t0, dur, { freq = 1200, q = 1, gain = 0.15, type = "bandpass", slide = null } = {}) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(dur + 0.1);
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t0);
    if (slide) f.frequency.exponentialRampToValueAtTime(slide, t0 + dur);
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f).connect(g).connect(master);
    src.start(t0);
    src.stop(t0 + dur + 0.1);
  }

  const api = {
    unlock() {
      ensure();
    },
    setEnabled(on) {
      enabled = on;
      if (master) master.gain.setTargetAtTime(on ? 0.8 : 0, ctx.currentTime, 0.05);
    },
    get enabled() {
      return enabled;
    },
    step() {
      if (!ensure()) return;
      noise(ctx.currentTime, 0.07, { freq: 900 + Math.random() * 300, q: 2, gain: 0.06 });
    },
    dew() {
      if (!ensure()) return;
      const t = ctx.currentTime;
      tone(1046, t, 0.25, { gain: 0.12 });
      tone(1568, t + 0.09, 0.35, { gain: 0.1 });
    },
    sensor() {
      if (!ensure()) return;
      const t = ctx.currentTime;
      tone(660, t, 0.4, { type: "triangle", gain: 0.12, slide: 880 });
    },
    gate() {
      if (!ensure()) return;
      const t = ctx.currentTime;
      tone(110, t, 0.7, { type: "triangle", gain: 0.25, slide: 55 });
      noise(t, 0.5, { freq: 300, q: 0.8, gain: 0.12, type: "lowpass" });
    },
    scorch() {
      if (!ensure()) return;
      const t = ctx.currentTime;
      noise(t, 0.9, { freq: 3000, q: 0.7, gain: 0.2, slide: 200 });
      tone(330, t, 0.8, { type: "sawtooth", gain: 0.08, slide: 60 });
    },
    win() {
      if (!ensure()) return;
      const t = ctx.currentTime;
      [523, 659, 784, 1046].forEach((f, i) => tone(f, t + i * 0.11, 0.6, { gain: 0.12, type: "triangle" }));
      tone(262, t, 1.2, { gain: 0.1 });
    },
    click() {
      if (!ensure()) return;
      noise(ctx.currentTime, 0.05, { freq: 2000, q: 1.5, gain: 0.05 });
    },
    // A soft hum while the sun turns; rate is 0..1.
    turning(rate, el) {
      if (!ctx) return;
      if (!hum) {
        hum = ctx.createOscillator();
        hum.type = "sine";
        humGain = ctx.createGain();
        humGain.gain.value = 0;
        const f = ctx.createBiquadFilter();
        f.type = "lowpass";
        f.frequency.value = 600;
        hum.connect(f).connect(humGain).connect(master);
        hum.start();
      }
      const target = Math.min(0.06, rate * 0.08);
      humGain.gain.setTargetAtTime(target, ctx.currentTime, 0.08);
      hum.frequency.setTargetAtTime(90 + el * 2.2, ctx.currentTime, 0.1);
    },
    suspend() {
      if (ctx && ctx.state === "running") ctx.suspend().catch(() => {});
    },
    resume() {
      if (ctx && ctx.state === "suspended") ctx.resume().catch(() => {});
    },
  };
  return api;
}
