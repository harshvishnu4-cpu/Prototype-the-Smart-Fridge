(() => {
  "use strict";

  const storyOrder = ["title", "goal", "predict", "observe", "calibrate", "investigate", "repair", "explain", "transfer", "complete"];
  const missionSteps = ["goal", "predict", "observe", "calibrate", "investigate", "repair", "explain", "transfer", "complete"];
  const correctAnswers = { cause: "papa", fix: "recheck", scale: "many", transfer: "recheck" };
  const hints = {
    goal: "A useful rule must prevent both empty shelves and extra waste.",
    predict: "This is only a prediction—choose the number you think is best.",
    observe: "Watch for the yellow order ticket and what happens after it appears.",
    calibrate: "Try the middle number and compare the balance meter.",
    investigate: "Who added cartons after the smart fridge had already decided?",
    repair: "The stock can change after the first check. Which fix notices that?",
    explain: "Do all families have the same number of people and the same routine?",
    transfer: "Reuse the principle, not the milk number: check fresh information before acting."
  };
  const feedback = {
    cause: "The recording showed Papa adding cartons after the order was queued.",
    fix: "A fresh re-check catches stock changes before the order is sent.",
    scale: "Households have different people, habits, amounts, and shopping times.",
    transfer: "Checking again uses the newest cupboard information before acting."
  };

  const state = {
    scene: "title", sceneIndex: 0, prediction: null, threshold: null,
    elapsed: 0, sound: true, playing: false, observed: false,
    goalSeen: new Set(), completed: new Set()
  };

  const game = document.getElementById("game");
  const hud = document.getElementById("hud");
  const rail = document.getElementById("progressRail");
  const hintBtn = document.getElementById("hintBtn");
  const live = document.getElementById("liveRegion");
  let hintTimer = 0, movieTimer = 0, audioCtx = null, toastTimer = 0;

  function fitGame() {
    const scale = Math.min(window.innerWidth / 1600, window.innerHeight / 900);
    game.style.transform = `translate(-50%, -50%) scale(${scale})`;
  }

  function sceneEl(name = state.scene) { return document.querySelector(`[data-scene="${name}"]`); }

  function updateRail() {
    rail.innerHTML = "";
    const current = missionSteps.indexOf(state.scene);
    missionSteps.forEach((name, i) => {
      const dot = document.createElement("span");
      dot.className = "progress-dot" + (i < current ? " done" : "") + (i === current ? " current" : "");
      dot.title = name.charAt(0).toUpperCase() + name.slice(1);
      dot.setAttribute("aria-label", dot.title + (i === current ? ", current" : i < current ? ", complete" : ""));
      rail.appendChild(dot);
    });
  }

  function showScene(name, direction = 1) {
    clearInterval(movieTimer); state.playing = false;
    document.querySelectorAll(".scene").forEach(s => s.classList.remove("active"));
    state.scene = name; state.sceneIndex = storyOrder.indexOf(name); game.dataset.currentScene = name;
    sceneEl(name).classList.add("active");
    hud.hidden = name === "title" || name === "complete";
    rail.hidden = name === "title" || name === "complete";
    document.getElementById("backBtn").disabled = state.sceneIndex <= 1;
    updateRail(); resetHint(); announce(`${name} activity`);
    if (name === "calibrate") document.getElementById("savedPrediction").textContent = state.prediction ? `${state.prediction} carton${state.prediction > 1 ? "s" : ""}` : "not set";
    if (name === "observe" && !state.observed) resetRecording();
    if (name === "complete") playTone("win");
  }

  function nextScene() {
    const next = storyOrder[Math.min(state.sceneIndex + 1, storyOrder.length - 1)];
    state.completed.add(state.scene); playTone("next"); showScene(next);
  }

  function previousScene() {
    if (state.sceneIndex > 1) { playTone("tap"); showScene(storyOrder[state.sceneIndex - 1], -1); }
  }

  function resetHint() {
    clearTimeout(hintTimer); hintBtn.hidden = true;
    if (!["title", "complete"].includes(state.scene)) hintTimer = setTimeout(() => { hintBtn.hidden = false; }, 12000);
  }

  function interact() { resetHint(); }
  function announce(message) { live.textContent = ""; requestAnimationFrame(() => { live.textContent = message; }); }
  function toast(message) {
    const el = document.getElementById("toast"); el.textContent = message; el.classList.add("show");
    clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove("show"), 2600);
  }

  function playTone(type = "tap") {
    if (!state.sound) return;
    try {
      audioCtx ||= new (window.AudioContext || window.webkitAudioContext)();
      const now = audioCtx.currentTime;
      const notes = type === "win" ? [523,659,784,1047] : type === "wrong" ? [240,185] : type === "next" ? [420,620] : [440];
      notes.forEach((frequency, i) => {
        const osc = audioCtx.createOscillator(), gain = audioCtx.createGain();
        osc.type = type === "wrong" ? "sawtooth" : "sine"; osc.frequency.value = frequency;
        gain.gain.setValueAtTime(.0001, now + i * .09); gain.gain.exponentialRampToValueAtTime(.08, now + i * .09 + .01); gain.gain.exponentialRampToValueAtTime(.0001, now + i * .09 + .14);
        osc.connect(gain).connect(audioCtx.destination); osc.start(now + i * .09); osc.stop(now + i * .09 + .16);
      });
    } catch (_) { /* audio is optional */ }
  }

  function selectExclusive(group, button) {
    group.querySelectorAll("button").forEach(b => b.classList.remove("selected"));
    button.classList.add("selected");
  }

  function answerQuestion(button) {
    const group = button.closest("[data-question]");
    const question = group.dataset.question;
    if (["predict", "calibrate"].includes(question)) return;
    selectExclusive(group, button);
    const scene = button.closest(".scene"), fb = scene.querySelector("[data-feedback]");
    group.querySelectorAll("button").forEach(b => b.classList.remove("wrong", "correct"));
    if (button.dataset.value === correctAnswers[question]) {
      button.classList.add("correct"); fb.textContent = feedback[question]; fb.className = "feedback success";
      playTone("next");
      if (question === "transfer") document.getElementById("impactPair").hidden = false;
      if (question === "fix") {
        document.getElementById("fixTest").hidden = false;
        const run = document.getElementById("runFixBtn"); run.hidden = false; run.textContent = "Run the fix"; run.dataset.mode = "run";
      } else scene.querySelector("[data-next]").hidden = false;
    } else {
      button.classList.add("wrong"); fb.textContent = feedback[question]; fb.className = "feedback error"; playTone("wrong");
    }
  }

  function evaluateThreshold(value) {
    const result = document.getElementById("calibrateResult"), needle = document.getElementById("meterNeedle");
    result.className = "result-card";
    if (value <= 1) {
      needle.style.left = "13%"; result.classList.add("bad");
      result.innerHTML = '<span class="result-icon">!</span><div><b>Too late: milk ran out</b><p>The family used the last carton before the delivery arrived. Try another number.</p></div>';
      playTone("wrong");
    } else if (value === 2) {
      needle.style.left = "50%"; result.classList.add("good");
      result.innerHTML = '<span class="result-icon">&#10003;</span><div><b>Balanced for this week</b><p>There was enough milk without building up extra stock.</p></div>';
      sceneEl().querySelector("[data-next]").hidden = false; playTone("next");
    } else {
      needle.style.left = "86%"; result.classList.add("bad");
      result.innerHTML = '<span class="result-icon">!</span><div><b>Too early: extra milk built up</b><p>An order arrived while several cartons were still left. Try another number.</p></div>';
      playTone("wrong");
    }
  }

  const week = [
    { day:"Mon", milk:4, note:"Four cartons are ready." },
    { day:"Tue", milk:3, note:"The family uses one carton." },
    { day:"Wed", milk:2, order:true, note:"Two cartons remain. The fridge queues an order." },
    { day:"Thu", milk:4, order:true, papa:true, note:"Papa adds two cartons, but the old order is still queued." },
    { day:"Fri", milk:3, order:true, note:"One carton is used. The queued order is on its way." },
    { day:"Sat", milk:5, note:"The delivery arrives. Now there is extra milk." },
    { day:"Sun", milk:4, note:"The week ends with more milk than needed." }
  ];

  function resetRecording() {
    clearInterval(movieTimer); state.playing = false;
    document.getElementById("days").innerHTML = week.map((d,i) => `<span class="day${i===0 ? " active" : ""}">${d.day}</span>`).join("");
    renderWeekFrame(0); document.getElementById("timelineFill").style.width = "0%";
    document.getElementById("playBtn").textContent = "▶"; document.getElementById("replayBtn").hidden = true;
    document.getElementById("watchNote").textContent = "Press play to begin the recording.";
  }

  function renderWeekFrame(i) {
    const frame = week[i], shelf = document.getElementById("milkShelf");
    shelf.innerHTML = Array.from({length:frame.milk}, () => '<img class="milk-carton-art" src="assets/generated/props/milk-carton.png" alt="">').join("");
    document.querySelectorAll(".day").forEach((d,j) => { d.classList.toggle("active", j===i); d.classList.toggle("done", j<i); });
    document.getElementById("orderTicket").hidden = !frame.order; document.getElementById("papaPop").hidden = !frame.papa;
    document.getElementById("watchNote").textContent = frame.note;
    document.getElementById("timelineFill").style.width = `${i / (week.length - 1) * 100}%`;
  }

  function playRecording() {
    if (state.playing) { clearInterval(movieTimer); state.playing = false; document.getElementById("playBtn").textContent = "▶"; return; }
    resetRecording(); state.playing = true; document.getElementById("playBtn").textContent = "Ⅱ"; playTone("tap");
    let frame = 0;
    movieTimer = setInterval(() => {
      frame += 1; renderWeekFrame(frame);
      if (frame === week.length - 1) {
        clearInterval(movieTimer); state.playing = false; state.observed = true;
        document.getElementById("playBtn").textContent = "▶"; document.getElementById("replayBtn").hidden = false;
        sceneEl("observe").querySelector("[data-next]").hidden = false;
        announce("Recording complete. The order created extra milk."); playTone("next");
      }
    }, 900);
  }

  document.addEventListener("click", (event) => {
    const button = event.target.closest("button"); if (!button) return; interact();
    if (button.dataset.action === "start") { playTone("next"); showScene("goal"); return; }
    if (button.matches("[data-next]")) { nextScene(); return; }
    if (button.matches("[data-close]")) { document.getElementById(button.dataset.close).hidden = true; playTone("tap"); return; }
    if (button.matches("[data-question] button")) answerQuestion(button);
  });

  document.querySelectorAll(".goal-card").forEach(button => button.addEventListener("click", () => {
    button.classList.add("revealed"); state.goalSeen.add(button.dataset.goal); playTone("tap");
    if (state.goalSeen.size === 2) sceneEl("goal").querySelector("[data-next]").hidden = false;
  }));

  document.querySelectorAll('[data-question="predict"] button').forEach(button => button.addEventListener("click", () => {
    selectExclusive(button.parentElement, button); state.prediction = Number(button.dataset.value); playTone("tap");
    document.getElementById("predictSummary").textContent = `Your prediction: order when ${state.prediction} carton${state.prediction > 1 ? "s are" : " is"} left.`;
    document.getElementById("confirmPrediction").hidden = false;
  }));
  document.getElementById("confirmPrediction").addEventListener("click", nextScene);

  document.getElementById("playBtn").addEventListener("click", playRecording);
  document.getElementById("replayBtn").addEventListener("click", playRecording);

  document.querySelectorAll('[data-question="calibrate"] button').forEach(button => button.addEventListener("click", () => {
    selectExclusive(button.parentElement, button); state.threshold = Number(button.dataset.value); document.getElementById("testRuleBtn").disabled = false; playTone("tap");
  }));
  document.getElementById("testRuleBtn").addEventListener("click", () => evaluateThreshold(state.threshold));

  document.getElementById("runFixBtn").addEventListener("click", () => {
    const button = document.getElementById("runFixBtn"), test = document.getElementById("fixTest");
    if (button.dataset.mode === "continue") { nextScene(); return; }
    button.disabled = true; test.classList.add("running"); document.getElementById("fixTestText").textContent = "Checking the newest stock before sending the order…"; playTone("tap");
    setTimeout(() => {
      test.classList.add("success"); document.getElementById("fixTestText").textContent = "No extra order! The fresh re-check found Papa’s milk.";
      button.disabled = false; button.textContent = "Explain the bigger idea"; button.dataset.mode = "continue"; playTone("next");
    }, 1400);
  });

  document.getElementById("backBtn").addEventListener("click", previousScene);
  document.getElementById("helpBtn").addEventListener("click", () => { document.getElementById("helpOverlay").hidden = false; });
  document.getElementById("soundBtn").addEventListener("click", (e) => {
    state.sound = !state.sound; e.currentTarget.textContent = state.sound ? "🔊" : "🔇"; e.currentTarget.setAttribute("aria-pressed", state.sound); e.currentTarget.setAttribute("aria-label", state.sound ? "Turn sound off" : "Turn sound on"); if (state.sound) playTone("tap");
  });
  hintBtn.addEventListener("click", () => { toast(hints[state.scene] || "Look closely at the evidence."); hintBtn.hidden = true; });
  document.getElementById("finishBtn").addEventListener("click", () => {
    playTone("tap");
    window.location.reload();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      const pause = document.getElementById("pauseOverlay"); if (state.scene !== "title" && state.scene !== "complete") pause.hidden = !pause.hidden;
    }
    if (["1","2","3"].includes(event.key) && !document.querySelector(".overlay:not([hidden])")) {
      const buttons = [...sceneEl().querySelectorAll("[data-question] button")].filter(b => !b.disabled);
      const target = buttons[Number(event.key)-1]; if (target) target.click();
    }
  });

  setInterval(() => {
    if (state.scene !== "title" && state.scene !== "complete" && document.getElementById("pauseOverlay").hidden) {
      state.elapsed += 1; const m = String(Math.floor(state.elapsed / 60)).padStart(2,"0"), s = String(state.elapsed % 60).padStart(2,"0"); document.getElementById("timerText").textContent = `${m}:${s}`;
    }
  }, 1000);

  window.addEventListener("resize", fitGame); fitGame(); showScene("title");
})();
