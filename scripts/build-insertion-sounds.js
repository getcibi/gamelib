// Deterministic, original insert cues. Run with node scripts/build-insertion-sounds.js.
const fs = require('node:fs');
const path = require('node:path');

const RATE = 44100;
const TAU = 2 * Math.PI;
const output = path.join(__dirname, '..', 'src', 'renderer', 'audio');
fs.mkdirSync(output, { recursive: true });

function envelope(t, duration, attack, decay) {
  if (t < 0 || t >= duration) return 0;
  return Math.min(1, t / attack, (duration - t) / 0.012) * Math.exp(-t / decay);
}

function tone(t, start, duration, hz, level, { attack = 0.006, decay = 0.07, glide = 0 } = {}) {
  const age = t - start;
  const gain = envelope(age, duration, attack, decay);
  return level * gain * Math.sin(TAU * (hz * age + (glide * age * age) / (2 * duration)));
}

function writeCue(name, duration, peak, synthesize) {
  const samples = new Float64Array(Math.round(duration * RATE));
  let seed = 0x741ade;
  let previous = 0;
  let max = 0;
  for (let i = 0; i < samples.length; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const noise = (seed / 4294967296) * 2 - 1;
    previous += (noise - previous) * 0.22;
    samples[i] = synthesize(i / RATE, noise - previous, previous);
    max = Math.max(max, Math.abs(samples[i]));
  }
  const wav = Buffer.alloc(44 + samples.length * 2);
  wav.write('RIFF', 0);
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(RATE, 24);
  wav.writeUInt32LE(RATE * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i++) {
    wav.writeInt16LE(Math.round((samples[i] / max) * peak * 32767), 44 + i * 2);
  }
  fs.writeFileSync(path.join(output, name + '.wav'), wav);
}

// Slot contact, a short drive-like texture, then one rounded electronic beep.
writeCue('disc-insert', 0.5, 0.29, (t, bright, low) =>
  bright * 0.16 * envelope(t, 0.035, 0.001, 0.009)
  + low * 0.25 * envelope(t - 0.008, 0.16, 0.013, 0.052)
  + tone(t, 0.006, 0.084, 224, 0.28, { decay: 0.024, glide: -64 })
  + tone(t, 0.055, 0.184, 1830, 0.65, { decay: 0.17, glide: -26 })
  + tone(t, 0.055, 0.14, 3660, 0.035, { decay: 0.064 })
  + tone(t, 0.075, 0.4, 361, 0.13, { attack: 0.04, decay: 0.11, glide: -17 }),
);

// A dry plastic snap with a tiny, bright confirmation after it seats.
writeCue('cartridge-insert', 0.33, 0.33, (t, bright, low) =>
  bright * 0.78 * envelope(t, 0.025, 0.0008, 0.004)
  + low * 0.32 * envelope(t - 0.011, 0.035, 0.002, 0.007)
  + tone(t, 0.002, 0.042, 630, 0.32, { attack: 0.001, decay: 0.009, glide: -164 })
  + tone(t, 0.015, 0.075, 1410, 0.29, { attack: 0.002, decay: 0.025 })
  + tone(t, 0.057, 0.22, 2210, 0.26, { decay: 0.043 })
  + tone(t, 0.057, 0.19, 3315, 0.075, { decay: 0.026 }),
);
