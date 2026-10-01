/*
 * Meera's voice-over: pre-recorded clips in assets/audio/vo/ (ElevenLabs, voice "Suhana J",
 * model Multilingual v2). One clip plays at a time on a single <audio> element.
 * Clips are Ogg Opus (Chrome, Edge, Firefox and recent Safari).
 * Audio is optional — a missing file or blocked playback fails silently, and `onEnd` still runs
 * (on `ended`, on `error`, or from a watchdog at clip length + grace) so nothing waits forever.
 */
(function (root) {
  "use strict";

  const BASE = "assets/audio/vo/", EXT = ".ogg";
  const GRACE = 3, MAX_CLIP = 20;                       // seconds
  const audio = new Audio();
  audio.preload = "none";                               // js/preload.js fetches the clips
  let enabled = true, unlocked = false, resumeOnFocus = false, active = null;

  const fileUrl = name => BASE + name + EXT;
  const resolve = path => (root.GameAssets ? root.GameAssets.url(path) : path);

  /* Safari only lets an element play programmatically once it has played inside a gesture. */
  function unlock() {
    if (unlocked) return;
    unlocked = true;
    audio.muted = true;
    audio.src = resolve(fileUrl("goal"));
    const p = audio.play();
    if (p) p.then(() => { if (audio.muted) audio.pause(); }).catch(() => {});
  }

  function stop() {
    active?.cancel();
    active = null;
    audio.onended = audio.onerror = audio.onloadedmetadata = null;
    audio.pause();
    resumeOnFocus = false;
  }

  /* Plays `name` from the start; `onEnd` runs once when it finishes. Returns false if muted. */
  function play(name, onEnd) {
    stop();
    if (!enabled || !name) return false;
    const path = fileUrl(name);
    let done = false, timer = 0, reverted = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      onEnd?.();
    };
    const arm = seconds => { clearTimeout(timer); timer = setTimeout(finish, (seconds + GRACE) * 1000); };
    const remaining = () => (isFinite(audio.duration) ? Math.max(0, audio.duration - audio.currentTime) : MAX_CLIP);
    active = { cancel() { done = true; clearTimeout(timer); }, rearm() { if (!done) arm(remaining()); }, hold() { clearTimeout(timer); } };

    audio.muted = false;
    audio.src = resolve(path);
    audio.onended = finish;
    audio.onloadedmetadata = () => arm(remaining());
    audio.onerror = () => {
      if (!reverted && audio.src.startsWith("blob:")) {   // one-time fallback to the file itself
        reverted = true;
        audio.src = path;
        audio.play()?.catch(() => {});
        return;
      }
      finish();
    };
    arm(MAX_CLIP);
    audio.play()?.catch(() => {});
    return true;
  }

  function pause() {
    resumeOnFocus = !audio.paused && !audio.ended;
    audio.pause();
    active?.hold();
  }

  function resume() {
    if (resumeOnFocus && enabled) audio.play()?.catch(() => {});
    resumeOnFocus = false;
    active?.rearm();
  }

  function setEnabled(on) {
    enabled = on;
    if (!on) stop();
  }

  root.GameVoice = { unlock, play, stop, pause, resume, setEnabled };
})(window);
