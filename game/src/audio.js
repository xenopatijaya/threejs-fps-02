// Sound, synthesised with WebAudio: no audio files, no network. Every shot,
// reload, plant beep and explosion is a few oscillators and filtered noise.
export function createAudio() {
  let ctx = null;
  let master = null;
  function ensure() {
    if (ctx) return true;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.32;
      master.connect(ctx.destination);
    } catch {
      return false;
    }
    return true;
  }
  function noiseBuffer(seconds) {
    const buf = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i += 1) d[i] = Math.random() * 2 - 1;
    return buf;
  }
  function burst({ dur, freq, type = 'lowpass', gain = 0.5, slideTo = null }) {
    if (!ensure()) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(dur);
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (slideTo) f.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(master);
    src.start(t);
    src.stop(t + dur);
  }
  function tone({ freq, dur, type = 'sine', gain = 0.2, slideTo = null }) {
    if (!ensure()) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(master);
    o.start(t);
    o.stop(t + dur);
  }
  return {
    unlock() { ensure(); if (ctx && ctx.state === 'suspended') ctx.resume(); },
    shot(weapon) {
      if (weapon === 'vulture') { burst({ dur: 0.22, freq: 900, slideTo: 180, gain: 0.7 }); tone({ freq: 140, dur: 0.16, type: 'square', gain: 0.16, slideTo: 60 }); }
      else if (weapon === 'osprey') { burst({ dur: 0.3, freq: 700, slideTo: 120, gain: 0.8 }); tone({ freq: 110, dur: 0.2, type: 'square', gain: 0.2, slideTo: 50 }); }
      else burst({ dur: 0.11, freq: 1400, slideTo: 300, gain: 0.5 });
    },
    dry() { tone({ freq: 1400, dur: 0.03, type: 'square', gain: 0.12 }); },
    reload() { tone({ freq: 900, dur: 0.04, type: 'square', gain: 0.1 }); setTimeout(() => tone({ freq: 600, dur: 0.04, type: 'square', gain: 0.1 }), 180); },
    hit() { tone({ freq: 2100, dur: 0.05, gain: 0.16 }); },
    kill() { tone({ freq: 1320, dur: 0.07, gain: 0.18 }); setTimeout(() => tone({ freq: 1760, dur: 0.09, gain: 0.18 }), 70); },
    hurt() { tone({ freq: 220, dur: 0.12, type: 'sawtooth', gain: 0.14, slideTo: 120 }); },
    beep() { tone({ freq: 1150, dur: 0.09, gain: 0.2 }); },
    plantDone() { tone({ freq: 880, dur: 0.1, gain: 0.2 }); setTimeout(() => tone({ freq: 880, dur: 0.1, gain: 0.2 }), 140); },
    explosion() { burst({ dur: 0.9, freq: 500, slideTo: 60, gain: 0.9 }); tone({ freq: 70, dur: 0.7, type: 'sine', gain: 0.5, slideTo: 30 }); },
    bounce() { tone({ freq: 300, dur: 0.05, type: 'triangle', gain: 0.12 }); },
    click() { tone({ freq: 1600, dur: 0.03, type: 'square', gain: 0.1 }); },
    roundWin() { [523, 659, 784].forEach((f, i) => setTimeout(() => tone({ freq: f, dur: 0.14, gain: 0.16 }), i * 110)); },
    roundLose() { [392, 330, 262].forEach((f, i) => setTimeout(() => tone({ freq: f, dur: 0.16, gain: 0.14 }), i * 120)); },
    flash() { tone({ freq: 3200, dur: 0.5, gain: 0.1, slideTo: 1800 }); },
  };
}
