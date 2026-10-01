/*
 * Interface sounds, synthesised with Tone.js (Web Audio). No audio files.
 * Levels follow the build guide: interface effects sit between -16 and -12 dB.
 * Audio is optional — every call fails silently if Tone.js or audio is unavailable.
 */
(function (root) {
  "use strict";

  const Tone = root.Tone;
  let kit = null, enabled = true, started = false, last = 0;

  function build() {
    if (kit || !Tone) return kit;
    try {
      Tone.getContext().lookAhead = 0.01;
      const bus = new Tone.Volume(0).toDestination();
      const shimmer = new Tone.Reverb({ decay: 1.4, wet: 0.18 }).connect(bus);

      kit = {
        bus,
        pluck: new Tone.Synth({
          oscillator: { type: "triangle" },
          envelope: { attack: 0.004, decay: 0.12, sustain: 0, release: 0.08 },
          volume: -14
        }).connect(bus),
        chime: new Tone.PolySynth(Tone.Synth, {
          oscillator: { type: "sine" },
          envelope: { attack: 0.01, decay: 0.3, sustain: 0.08, release: 0.5 },
          volume: -13
        }).connect(shimmer),
        bonk: new Tone.MembraneSynth({
          pitchDecay: 0.04, octaves: 2.5,
          envelope: { attack: 0.001, decay: 0.22, sustain: 0, release: 0.1 },
          volume: -12
        }).connect(bus),
        bell: new Tone.FMSynth({
          harmonicity: 3.01, modulationIndex: 6,
          envelope: { attack: 0.002, decay: 0.5, sustain: 0, release: 0.3 },
          modulationEnvelope: { attack: 0.002, decay: 0.2, sustain: 0, release: 0.2 },
          volume: -16
        }).connect(shimmer),
        air: new Tone.NoiseSynth({
          noise: { type: "pink" },
          envelope: { attack: 0.04, decay: 0.28, sustain: 0, release: 0.05 },
          volume: -22
        }),
        airFilter: new Tone.Filter({ type: "bandpass", frequency: 600, Q: 1.2 }).connect(bus)
      };
      kit.air.connect(kit.airFilter);
    } catch (_) { kit = null; }
    return kit;
  }

  /* Monophonic synths need strictly increasing start times. */
  function at(offset = 0) {
    const t = Math.max(Tone.now() + offset, last + 0.012);
    last = t;
    return t;
  }

  const recipes = {
    tap: k => k.pluck.triggerAttackRelease("C5", "32n", at()),
    select: k => { k.pluck.triggerAttackRelease("E5", "32n", at()); k.pluck.triggerAttackRelease("A5", "32n", at(0.07)); },
    flip: k => { k.airFilter.frequency.setValueAtTime(900, Tone.now()); k.airFilter.frequency.exponentialRampTo(2600, 0.2); k.air.triggerAttackRelease(0.18, at()); k.pluck.triggerAttackRelease("G5", "32n", at(0.12)); },
    correct: k => ["C5", "E5", "G5", "C6"].forEach((n, i) => k.chime.triggerAttackRelease(n, "16n", Tone.now() + i * 0.075)),
    wrong: k => { k.bonk.triggerAttackRelease("A2", "8n", at()); k.pluck.triggerAttackRelease("Eb4", "16n", at(0.11)); },
    next: k => { k.airFilter.frequency.setValueAtTime(400, Tone.now()); k.airFilter.frequency.exponentialRampTo(2400, 0.3); k.air.triggerAttackRelease(0.3, at()); },
    drop: k => k.bonk.triggerAttackRelease("G3", "16n", at()),
    lift: k => k.pluck.triggerAttackRelease("A4", "32n", at()),
    ding: k => k.bell.triggerAttackRelease("A5", "8n", at()),
    tick: k => k.pluck.triggerAttackRelease("C6", "64n", at()),
    lock: k => { k.bonk.triggerAttackRelease("C3", "16n", at()); k.bell.triggerAttackRelease("E6", "16n", at(0.05)); },
    alert: k => { k.bell.triggerAttackRelease("D5", "16n", at()); k.bell.triggerAttackRelease("D5", "16n", at(0.16)); },
    win: k => {
      const now = Tone.now();
      [["C5", 0], ["E5", 0.1], ["G5", 0.2], ["C6", 0.32]].forEach(([n, t]) => k.chime.triggerAttackRelease(n, "8n", now + t));
      k.chime.triggerAttackRelease(["C5", "E5", "G5", "C6"], "2n", now + 0.5);
    }
  };

  const GameSound = {
    /* Call from a user gesture: browsers only allow audio after one. */
    unlock() {
      if (!Tone || started) return;
      started = true;
      Tone.start().then(build).catch(() => { started = false; });
    },
    play(name) {
      if (!enabled || !Tone || !kit || !recipes[name]) return;
      if (Tone.getContext().state !== "running") return;
      try { recipes[name](kit); } catch (_) { /* audio is optional */ }
    },
    setEnabled(on) {
      enabled = !!on;
      if (Tone) try { Tone.getDestination().mute = !enabled; } catch (_) { /* ignore */ }
    },
    get enabled() { return enabled; }
  };

  root.GameSound = GameSound;
})(window);
