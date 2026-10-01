/*
 * Meera's voice-over: pre-recorded clips in assets/audio/vo/ (ElevenLabs, voice "Suhana J",
 * model Multilingual v2). One clip plays at a time on a single <audio> element.
 * Audio is optional — a missing file or blocked playback fails silently.
 */
(function (root) {
  "use strict";

  const BASE = "assets/audio/vo/";
  const audio = new Audio();
  audio.preload = "auto";
  let enabled = true, unlocked = false, resumeOnFocus = false;

  /* Safari only lets an element play programmatically once it has played inside a gesture. */
  function unlock() {
    if (unlocked) return;
    unlocked = true;
    audio.muted = true;
    audio.src = BASE + "goal.mp3";
    const p = audio.play();
    if (p) p.then(() => { if (audio.muted) audio.pause(); }).catch(() => {});
  }

  function stop() {
    audio.onended = null;
    audio.pause();
    resumeOnFocus = false;
  }

  /* Plays `name`.mp3 from the start; `onEnd` runs when it finishes. Returns false if muted. */
  function play(name, onEnd) {
    stop();
    if (!enabled || !name) return false;
    audio.muted = false;
    audio.src = BASE + name + ".mp3";
    audio.onended = () => { audio.onended = null; onEnd?.(); };
    audio.play()?.catch(() => {});
    return true;
  }

  function pause() {
    resumeOnFocus = !audio.paused && !audio.ended;
    audio.pause();
  }

  function resume() {
    if (resumeOnFocus && enabled) audio.play()?.catch(() => {});
    resumeOnFocus = false;
  }

  function setEnabled(on) {
    enabled = on;
    if (!on) stop();
  }

  root.GameVoice = { unlock, play, stop, pause, resume, setEnabled };
})(window);
