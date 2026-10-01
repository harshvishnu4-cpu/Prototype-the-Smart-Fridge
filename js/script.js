/*
 * Milk mission — main game script.
 *
 * Libraries (all stored in js/vendor, no network needed):
 *   GSAP + plugins  animation (scene transitions, recording, Flip layouts, Draggable dials,
 *                   MotionPath flights, DrawSVG strokes, SplitText headings, Physics2D bursts)
 *   XState          mission flow state machine (scene order, completion guards, pause layer)
 *   Tone.js         synthesised interface sounds (js/sound.js)
 *   GameVoice       Meera's recorded voice-over, assets/audio/vo (js/voice.js)
 *   canvas-confetti the finale celebration
 * Game logic:
 *   FridgeSim       every stock number the learner sees (js/simulation.js)
 */
(() => {
  "use strict";

  const { gsap, Flip, Draggable, SplitText, XState, FridgeSim, GameSound, GameVoice, GameFX, GameAssets } = window;

  /* ------------------------------------------------------------------
     Mission definition
     ------------------------------------------------------------------ */
  const storyOrder = ["title", "goal", "predict", "observe", "calibrate", "investigate", "repair", "explain", "transfer", "complete"];
  const missionSteps = ["goal", "predict", "observe", "calibrate", "investigate", "repair", "explain", "transfer", "complete"];
  const stepLabels = {
    goal: "Goal", predict: "Predict", observe: "Observe", calibrate: "Calibrate", investigate: "Investigate",
    repair: "Repair", explain: "Explain", transfer: "Transfer", complete: "Complete"
  };
  const correctAnswers = { cause: "papa", fix: "recheck", scale: "many", transfer: "recheck" };

  const ART = {
    carton: "assets/storyboard/props/milk-carton.webp"
  };
  const ENV = {
    closed: "assets/storyboard/environments/kitchen-closed-fridge.webp",
    open: "assets/storyboard/environments/kitchen-open-fridge.webp",
    classroom: "assets/storyboard/environments/classroom-cupboard.webp"
  };
  const POSE = {
    presenting: "assets/storyboard/characters/meera-presenting.webp",
    thinking: "assets/storyboard/characters/meera-thinking.webp",
    pointing: "assets/storyboard/characters/meera-pointing.webp",
    celebrating: "assets/storyboard/characters/meera-celebrating.webp"
  };
  const sceneLook = {
    title: { env: "closed", pose: "presenting" },
    goal: { env: "closed", pose: "presenting" },
    predict: { env: "closed", pose: "thinking" },
    observe: { env: "open", pose: null },
    calibrate: { env: "open", pose: "pointing" },
    investigate: { env: "open", pose: "thinking" },
    repair: { env: "open", pose: "pointing" },
    explain: { env: "closed", pose: "presenting" },
    transfer: { env: "classroom", pose: "pointing" },
    complete: { env: "closed", pose: "celebrating" }
  };

  const hints = {
    goal: "Tap both cards. A good rule has two jobs to do.",
    predict: "It’s only a guess! Remember: a delivery takes 2 days, and the family drinks 1 carton a day.",
    observe: "Press play. Watch the yellow order ticket, and who comes home on Wednesday evening.",
    calibrate: "Try a number, then press Test. Red means the milk ran out. Orange means extra milk.",
    investigate: "The milk went UP on Thursday. Who brought cartons home?",
    repair: "Papa changed the stock after the first check. Which fix looks again?",
    explain: "Think of a big family and a small one. Do they drink the same amount of milk?",
    transfer: "Use the idea that fixed the fridge: look again just before ordering."
  };

  /* One short, evidence-based prompt per answer. */
  const prompts = {
    cause: {
      papa: "Yes! Papa added 2 cartons after the order was queued, and the fridge never looked again.",
      sibling: "Drinking milk makes the stock go down, not up. On Thursday the milk went up.",
      spoiled: "Spoiled milk would mean fewer good cartons. On Thursday the milk went up."
    },
    fix: {
      recheck: "Yes! A fresh check just before sending would spot Papa’s cartons.",
      wait: "Waiting doesn’t look inside the fridge. Papa’s cartons would still be missed.",
      stop: "Then the milk would run out. The family still needs deliveries."
    },
    scale: {
      many: "Yes! Different people, amounts and shopping times need different numbers.",
      same: "Papa shopped on his own. Families shop at different times.",
      size: "Size isn’t the problem. A big family drinks more milk than a small one."
    },
    transfer: {
      recheck: "Yes! Looking again before ordering works for glue sticks too.",
      weekly: "Ordering without looking ignores glue from home, so the cupboard overflows.",
      extra: "Extra boxes pile up, just like the extra milk did. Use fresh information."
    }
  };
  const defaultFeedback = {
    cause: "Choose the explanation that matches the footage.",
    fix: "Choose the change that uses fresh information.",
    scale: "Choose the reason that fits real households.",
    transfer: "Use the idea that fixed the fridge."
  };

  /* Simulated weeks (see js/simulation.js). */
  const recorded = FridgeSim.scenarios.recordedWeek();
  const fixed = FridgeSim.scenarios.fixedWeek();
  const households = FridgeSim.scenarios.households();
  const FRESH = FridgeSim.DEFAULTS.freshLimit;
  const PACK = FridgeSim.DEFAULTS.pack;

  /* ------------------------------------------------------------------
     State — one small object for learner data. Flow lives in XState.
     ------------------------------------------------------------------ */
  function freshState(sound = true) {
    return {
      scene: null, sound,
      prediction: null, locked: false,
      dial: null, tests: [], lastResult: null,
      goalSeen: new Set(),
      recordingStarted: false, observed: false,
      answers: {}, fixRun: false,
      elapsed: 0
    };
  }
  const state = freshState();

  /* ------------------------------------------------------------------
     DOM
     ------------------------------------------------------------------ */
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const game = $("#game");
  const hud = $("#hud"), rail = $("#progressRail"), railCount = $("#railCount");
  const railSegments = $$("#railSegments path");          // document order runs bottom → top
  const backBtn = $("#backBtn"), replayBtn = $("#replayBtn"), soundBtn = $("#soundBtn");
  const soundMenu = $("#soundMenu"), muteBtn = $("#muteBtn"), muteText = $("#muteText");
  const ctaBtn = $("#ctaBtn"), ctaLabel = $("#ctaLabel");
  const hintBtn = $("#hintBtn"), hintBubble = $("#hintBubble"), hintText = $("#hintText");
  const helpOverlay = $("#helpOverlay"), pauseOverlay = $("#pauseOverlay");
  const live = $("#liveRegion"), fxLayer = $("#fxLayer");
  const hero = $("#hero"), heroParallax = $("#heroParallax"), meera = $("#meera");
  const bgWrap = $("#bg"), bgLayers = [$("#bgA"), $("#bgB")];
  const sceneEl = (name = state.scene) => $(`[data-scene="${name}"]`);

  const sfx = name => GameSound.play(name);
  const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
  const formatTime = s => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

  function announce(message) {
    live.textContent = "";
    requestAnimationFrame(() => { live.textContent = message; });
  }

  /* ------------------------------------------------------------------
     Scaling the 1600 × 900 plane
     ------------------------------------------------------------------ */
  let planeScale = 1;
  function fitGame() {
    planeScale = Math.min(window.innerWidth / 1600, window.innerHeight / 900);
    game.style.transform = `translate(-50%, -50%) scale(${planeScale})`;
  }
  function planePoint(el) {
    const r = el.getBoundingClientRect(), g = game.getBoundingClientRect();
    return { x: (r.left + r.width / 2 - g.left) / planeScale, y: (r.top + r.height / 2 - g.top) / planeScale };
  }
  const burstAt = (el, options) => { const p = planePoint(el); GameFX.burst(fxLayer, p.x, p.y, options); };

  /* ------------------------------------------------------------------
     Mission flow — XState machine generated from storyOrder
     ------------------------------------------------------------------ */
  const { createMachine, createActor, assign } = XState;

  function buildMissionMachine() {
    const flowStates = {};
    storyOrder.forEach((name, i) => {
      const on = {};
      if (i < storyOrder.length - 1) {
        on.NEXT = { target: storyOrder[i + 1], guard: ({ context }) => context.done.includes(name) };
      }
      if (i > 1) on.BACK = { target: storyOrder[i - 1] };
      flowStates[name] = { on };
    });

    return createMachine({
      id: "mission",
      type: "parallel",
      context: { done: ["title"] },
      on: {
        DONE: { actions: assign({ done: ({ context, event }) => (context.done.includes(event.scene) ? context.done : [...context.done, event.scene]) }) },
        RESET: { target: [".flow.title", ".overlay.none"], actions: assign({ done: () => ["title"] }) }
      },
      states: {
        flow: { initial: "title", states: flowStates },
        overlay: {
          initial: "none",
          states: {
            none: { on: { PAUSE: "pause", HELP: "help" } },
            pause: { on: { PAUSE: "none", RESUME: "none" } },
            help: { on: { CLOSE: "none", PAUSE: "none" } }
          }
        }
      }
    });
  }

  const actor = createActor(buildMissionMachine());
  const isDone = name => actor.getSnapshot().context.done.includes(name);
  const overlayMode = () => actor.getSnapshot().value.overlay;

  let lastFlow = null, lastOverlay = "none";
  function onSnapshot(snapshot) {
    const { flow, overlay } = snapshot.value;
    if (flow !== lastFlow) {
      const direction = lastFlow ? Math.sign(storyOrder.indexOf(flow) - storyOrder.indexOf(lastFlow)) || 1 : 1;
      lastFlow = flow;
      showScene(flow, direction);
    }
    if (overlay !== lastOverlay) { lastOverlay = overlay; syncOverlay(overlay); }
  }

  function complete(name, { reveal = true } = {}) {
    if (isDone(name)) return;
    actor.send({ type: "DONE", scene: name });
    updateRail();
    if (reveal) revealNext(name);
  }

  function revealNext(name) {
    const button = $("[data-next]", sceneEl(name));
    if (!button || !button.hidden) return;
    button.hidden = false;
    gsap.effects.popIn(button, { delay: 0.35 });
    gsap.delayedCall(1, () => gsap.effects.pulse(button, { scale: 1.05, repeat: 3 }));
  }

  /* ------------------------------------------------------------------
     Scene switching
     ------------------------------------------------------------------ */
  const headingSplits = new Map();
  let sceneTl = null, envCurrent = null, poseCurrent = undefined, frontLayer = 1;

  function changeEnvironment(tl, env) {
    if (env === envCurrent) return;
    envCurrent = env;
    const incoming = bgLayers[1 - frontLayer], outgoing = bgLayers[frontLayer];
    frontLayer = 1 - frontLayer;
    tl.add(() => {
      GameAssets.setBackground(incoming, ENV[env]);
      gsap.set(incoming, { zIndex: 2, willChange: "opacity, transform" }); gsap.set(outgoing, { zIndex: 1 });
    }, 0);
    tl.fromTo(incoming, { autoAlpha: 0, scale: 1.06 }, { autoAlpha: 1, scale: 1, duration: 0.9, ease: "power2.out", immediateRender: false }, 0.02);
    tl.set(outgoing, { autoAlpha: 0, willChange: "auto" }, 0.95);   // hidden layer releases its GPU texture
  }

  function changePose(tl, pose) {
    if (pose === poseCurrent) return;
    const had = !!poseCurrent;
    poseCurrent = pose;
    if (had) tl.to(hero, { autoAlpha: 0, y: 40, duration: 0.22, ease: "power2.in" }, 0);
    if (pose) {
      tl.add(() => { meera.src = GameAssets.url(POSE[pose]); }, had ? 0.23 : 0);
      tl.fromTo(hero, { autoAlpha: 0, y: 50 }, { autoAlpha: 1, y: 0, duration: 0.55, ease: "back.out(1.5)", immediateRender: false }, had ? 0.26 : 0.05);
    }
  }

  function showScene(name, direction = 1) {
    const prevName = state.scene;
    const prev = prevName ? sceneEl(prevName) : null;
    const next = sceneEl(name);
    if (sceneTl) sceneTl.progress(1).kill();
    if (prevName) sceneHandlers[prevName]?.leave?.();
    hideHint();
    GameVoice.stop();

    state.scene = name;
    game.dataset.currentScene = name;

    const tl = sceneTl = gsap.timeline();
    if (prev && prev !== next) {
      const outgoing = $$("[data-anim], .next:not([hidden]), .title-card", prev);
      tl.to(outgoing, { autoAlpha: 0, y: -26 * direction, duration: 0.26, stagger: 0.03, ease: "power2.in" });
      tl.add(() => {
        prev.classList.remove("active");
        gsap.set(outgoing, { clearProps: "opacity,visibility,transform" });
      });
    }
    const inAt = tl.duration();
    changeEnvironment(tl, sceneLook[name].env);
    changePose(tl, sceneLook[name].pose);

    const incoming = $$("[data-anim]", next);
    tl.add(() => {
      next.classList.add("active");
      $$("[data-next]", next).forEach(b => { b.hidden = !isDone(name); });
      sceneHandlers[name]?.enter?.();
      updateHud();
      animateHeading($("h2", next));
      const ready = $$(".next:not([hidden])", next);
      if (ready.length) tl.from(ready, { autoAlpha: 0, scale: 0.8, duration: 0.4, ease: "back.out(2)" }, inAt + 0.3);
    }, inAt);
    if (incoming.length) tl.from(incoming, { autoAlpha: 0, y: 36 * direction, duration: 0.55, stagger: 0.08, ease: "power3.out" }, inAt);
    /* Focus once the panel is visible again (a hidden ancestor would refuse focus). */
    if (name !== "title") tl.call(() => $("h2", next)?.focus({ preventScroll: true }), null, inAt + 0.08);
    if (name !== "title") tl.call(() => GameVoice.play(name), null, inAt + 0.35);

    if (name !== "title") announce(`${stepLabels[name]}, step ${missionSteps.indexOf(name) + 1} of ${missionSteps.length}`);
    if (prevName) sfx("next");
  }

  /* Headings are split the first time they are visible: splitting inside a
     display:none scene collapses the space before the last word in Chrome. */
  let headingTween = null;
  function animateHeading(h2) {
    if (!h2) return;
    headingTween?.progress(1);
    if (!headingSplits.has(h2)) headingSplits.set(h2, SplitText.create(h2, { type: "words", wordsClass: "word" }));
    headingTween = gsap.from(headingSplits.get(h2).words, {
      autoAlpha: 0, y: 16, rotationX: -60, transformOrigin: "50% 100%",
      stagger: 0.022, duration: 0.45, delay: 0.1, ease: "back.out(1.8)"
    });
  }

  /* A short debounce stops a double-click from skipping two scenes. */
  let lastNav = 0;
  function go(type) {
    const now = performance.now();
    if (now - lastNav < 350) return;
    lastNav = now;
    actor.send({ type });
  }

  /* ------------------------------------------------------------------
     HUD, progress rail, timer
     ------------------------------------------------------------------ */
  /* The SKAI rail has one segment per story scene (title counts as step 1). */
  const RAIL_ON = "#22D3EE", RAIL_OFF = "#ABEEF9";
  function updateRail() {
    const step = Math.max(1, storyOrder.indexOf(state.scene) + 1);
    railSegments.forEach((seg, i) => seg.setAttribute("fill", i < step ? RAIL_ON : RAIL_OFF));
    railCount.textContent = `${step}/${storyOrder.length}`;
    railCount.classList.toggle("long", railCount.textContent.length > 4);
    rail.setAttribute("aria-valuenow", String(step));
    rail.setAttribute("aria-valuetext", `${stepLabels[state.scene] || "Start"}, step ${step} of ${storyOrder.length}`);
  }

  let hudShown = false;
  function updateHud() {
    const inMission = state.scene !== "title";
    hud.hidden = !inMission;
    rail.hidden = !inMission;
    backBtn.disabled = storyOrder.indexOf(state.scene) <= 1;
    replayBtn.hidden = !(state.scene === "observe" && state.recordingStarted);
    if (inMission && !hudShown) {
      hudShown = true;
      gsap.from(".skai-top > *", { y: -120, autoAlpha: 0, stagger: 0.05, duration: 0.6, ease: "back.out(1.7)" });
      gsap.from(".skai-bottom > :not(.skai-cta)", { y: 140, autoAlpha: 0, stagger: 0.04, duration: 0.6, ease: "back.out(1.5)" });
      gsap.from(rail, { x: 130, autoAlpha: 0, duration: 0.7, ease: "back.out(1.4)" });
    }
    if (!inMission) { hudShown = false; closeSoundMenu(); }
    updateRail();
    syncCta();
    resetHint();
  }

  /* ------------------------------------------------------------------
     CTA plate — presents the active scene's visible next action
     (the scene's own .next buttons stay in the DOM as the source of truth)
     ------------------------------------------------------------------ */
  let ctaSource = null, ctaTl = null;
  const ctaBolts = $$(".skai-screw", ctaBtn), ctaSlots = $$(".skai-slot", ctaBtn);
  function syncCta() {
    const scene = state.scene && state.scene !== "title" ? sceneEl() : null;
    const source = scene ? $$(".next", scene).find(b => !b.hidden) || null : null;
    const label = source ? source.textContent.replace(/\s+/g, " ").trim() : "";
    const wasReady = !!ctaSource;
    ctaSource = source;
    if (label) {
      ctaBtn.setAttribute("aria-label", label);
      if (ctaLabel.textContent !== label) { ctaLabel.textContent = label; fitCtaLabel(); }
    }
    if (source && !wasReady) showCta();
    else if (!source && wasReady) hideCta();
  }

  /* A CTA plate rises in, then its four bolts spin in clockwise, then the label. */
  function ctaIntro(button) {
    const allBolts = $$(".skai-screw", button), slots = $$(".skai-slot", button), label = $(".skai-cta-label", button);
    const bolts = [2, 3, 1, 0].map(i => allBolts[i]);       // bottom-left, top-left, top-right, bottom-right
    return gsap.timeline()
      .set([allBolts, slots, label], { autoAlpha: 0 })
      .fromTo(button, { autoAlpha: 0, y: 70, scale: 0.55, rotation: -4 },
        { autoAlpha: 1, y: 0, scale: 1, rotation: 0, duration: 0.55, ease: "back.out(1.9)", transformOrigin: "50% 100%" })
      .fromTo(bolts, { autoAlpha: 0, scaleX: 0, scaleY: 0, rotation: -300 },
        { autoAlpha: 1, scaleX: 1, scaleY: -1, rotation: 0, duration: 0.38, stagger: 0.09, ease: "back.out(2.6)" }, 0.32)
      .to(slots, { autoAlpha: 1, duration: 0.2, stagger: 0.09 }, 0.42)
      .fromTo(label, { autoAlpha: 0, y: 18 }, { autoAlpha: 1, y: 0, duration: 0.35, ease: "power3.out" }, 0.62);
  }
  function showCta() {
    ctaTl?.kill();
    ctaTl = ctaIntro(ctaBtn)
      .add(() => sfx("select"), 0.3)
      .eventCallback("onComplete", () => ctaSource && gsap.effects.pulse(ctaBtn, { scale: 1.05, repeat: 3 }));
  }
  function hideCta() {
    ctaTl?.kill();
    ctaTl = gsap.timeline()
      .to(ctaLabel, { autoAlpha: 0, y: -12, duration: 0.14, ease: "power2.in" })
      .to([ctaBolts, ctaSlots], { autoAlpha: 0, scaleX: 0, scaleY: 0, duration: 0.16, stagger: 0.03, ease: "power2.in" }, 0.04)
      .to(ctaBtn, { autoAlpha: 0, y: 50, scale: 0.7, duration: 0.26, ease: "back.in(1.6)", transformOrigin: "50% 100%" }, 0.1);
  }
  function fitCtaLabel() {
    let size = 34;
    ctaLabel.style.fontSize = `${size}px`;
    while (size > 20 && ctaLabel.scrollWidth > ctaLabel.clientWidth) ctaLabel.style.fontSize = `${size -= 1}px`;
  }
  new MutationObserver(syncCta).observe(game, { subtree: true, attributes: true, attributeFilter: ["hidden"] });
  ctaBtn.addEventListener("click", () => { if (ctaSource && !ctaSource.hidden) ctaSource.click(); });

  setInterval(() => {
    if (!state.scene || state.scene === "title" || state.scene === "complete" || overlayMode() !== "none" || document.hidden) return;
    state.elapsed += 1;
    $("#timerText").textContent = formatTime(state.elapsed);
  }, 1000);

  /* ------------------------------------------------------------------
     Hint — the bulb is always in the frame; it glows after 12 seconds without interaction
     ------------------------------------------------------------------ */
  let hintCall = null, hintBob = null, hintHide = null;
  function resetHint() {
    hintCall?.kill();
    hideHintIcon();
    hintBtn.disabled = !hints[state.scene];
    if (!state.scene || state.scene === "title" || state.scene === "complete" || !hints[state.scene]) return;
    hintCall = gsap.delayedCall(12 * GameFX.MOTION, showHintIcon);
  }
  function showHintIcon() {
    if (!hintBubble.hidden) return;
    hintBtn.classList.add("ready");
    gsap.fromTo(hintBtn, { rotation: -16 }, { rotation: 0, duration: 0.6, ease: "elastic.out(1.2, 0.4)" });
    hintBob = gsap.to(hintBtn, { y: -10, duration: 0.7, repeat: -1, yoyo: true, ease: "sine.inOut", delay: 0.6 });
  }
  function hideHintIcon() {
    hintBob?.kill(); hintBob = null;
    gsap.set(hintBtn, { clearProps: "transform" });
    hintBtn.classList.remove("ready");
  }
  function showHintBubble() {
    const text = hints[state.scene];
    if (!text) return;
    hideHintIcon();
    hintText.textContent = text;
    hintBubble.hidden = false;
    gsap.fromTo(hintBubble, { autoAlpha: 0, x: -24, scale: 0.9 }, { autoAlpha: 1, x: 0, scale: 1, duration: 0.4, ease: "back.out(2)", transformOrigin: "0% 100%" });
    announce(text);
    sfx("ding");
    hintHide?.kill();
    const closeHint = delay => { hintHide?.kill(); hintHide = gsap.delayedCall(delay, () => { hideHint(); resetHint(); }); };
    const voiced = GameVoice.play(`hint-${state.scene}`, () => closeHint(2 * GameFX.MOTION));
    closeHint((voiced ? 16 : 8) * GameFX.MOTION);
  }
  function hideHint() {
    hintHide?.kill();
    if (!hintBubble.hidden) GameVoice.stop();
    hintBubble.hidden = true;
    hideHintIcon();
  }
  function onInteraction(event) {
    if (event.target.closest && event.target.closest("#hintBtn")) return;
    if (!hintBubble.hidden && event.type === "pointerdown") hideHint();
    resetHint();
  }

  /* ------------------------------------------------------------------
     Overlays (help / pause) — driven by the machine's overlay region
     ------------------------------------------------------------------ */
  let focusBeforeOverlay = null;
  function syncOverlay(mode) {
    if (mode !== "none" && !focusBeforeOverlay) focusBeforeOverlay = document.activeElement;
    helpOverlay.hidden = mode !== "help";
    pauseOverlay.hidden = mode !== "pause";
    if (mode === "none") {
      gsap.globalTimeline.resume();
      GameVoice.resume();
      focusBeforeOverlay?.focus?.({ preventScroll: true });
      focusBeforeOverlay = null;
    } else {
      window.confetti?.reset?.();
      gsap.globalTimeline.pause();
      GameVoice.pause();
      (mode === "help" ? $("#helpClose") : $("#resumeBtn")).focus({ preventScroll: true });
      announce(mode === "help" ? "How to play" : "Mission paused");
    }
  }
  function trapFocus(event) {
    const layer = $(".overlay:not([hidden])");
    if (!layer || event.key !== "Tab") return;
    const items = $$("button", layer);
    const first = items[0], last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    else if (!layer.contains(document.activeElement)) { event.preventDefault(); first.focus(); }
  }

  /* ------------------------------------------------------------------
     Shared: week chart (a pictograph of cartons, one column per day)
     ------------------------------------------------------------------ */
  function buildWeekChart(el, { mini = false } = {}) {
    const days = FridgeSim.DAYS;
    el.innerHTML = `
      <div class="wk-area">
        <div class="wk-line fresh"><span>Fresh limit · ${FRESH}</span></div>
        <div class="wk-line order"><span>Order at <b class="wk-t">2</b></span></div>
        ${days.map(() => `<div class="wk-stack">${Array.from({ length: 6 }, (_, j) =>
          `<img class="wk-carton" src="${GameAssets.url(ART.carton)}" alt="" style="bottom:calc(var(--unit) * ${j})">`).join("")}<span class="wk-empty">✕</span></div>`).join("")}
      </div>
      <div class="wk-flags">${days.map(() =>
        `<div class="wk-flag"><span class="f-order"><svg class="ic"><use href="#i-ticket"/></svg></span><span class="f-truck"><svg class="ic"><use href="#i-truck"/></svg>+${PACK}</span></div>`).join("")}</div>
      <div class="wk-days">${days.map(d => `<span>${mini ? d.slice(0, 1) : d}</span>`).join("")}</div>`;
    const orders = $$(".f-order", el), trucks = $$(".f-truck", el);
    el._cols = $$(".wk-stack", el).map((stack, i) => ({
      stack, cartons: $$(".wk-carton", stack), empty: $(".wk-empty", stack), order: orders[i], truck: trucks[i]
    }));
    return el;
  }

  function clearWeekChart(el) {
    gsap.set($$(".wk-carton, .wk-empty, .wk-flag > span", el), { autoAlpha: 0 });
    el._cols.forEach(col => col.stack.classList.remove("runout", "over"));
  }

  function animateWeek(el, result, { instant = false } = {}) {
    clearWeekChart(el);
    const tl = gsap.timeline();
    result.days.forEach((d, i) => {
      const col = el._cols[i];
      col.stack.classList.toggle("runout", d.runOut);
      col.stack.classList.toggle("over", d.over > 0);
      col.cartons.forEach((c, j) => c.classList.toggle("over", j >= result.options.freshLimit));
      const shown = col.cartons.slice(0, Math.min(d.morning, col.cartons.length));
      const t = i * 0.13;
      if (shown.length) tl.fromTo(shown, { autoAlpha: 0, y: -26, scale: 0.5 }, { autoAlpha: 1, y: 0, scale: 1, duration: 0.32, stagger: 0.04, ease: "back.out(2.2)", immediateRender: false }, t);
      if (d.runOut) tl.fromTo(col.empty, { autoAlpha: 0, scale: 1.7 }, { autoAlpha: 1, scale: 1, duration: 0.35, ease: "back.out(2)", immediateRender: false }, t + 0.1);
      if (d.queued) tl.fromTo(col.order, { autoAlpha: 0, y: 10 }, { autoAlpha: 1, y: 0, duration: 0.3, immediateRender: false }, t + 0.15);
      if (d.delivered) tl.fromTo(col.truck, { autoAlpha: 0, x: -14 }, { autoAlpha: 1, x: 0, duration: 0.3, immediateRender: false }, t + 0.05);
    });
    if (instant) tl.progress(1);
    return tl;
  }

  /* ------------------------------------------------------------------
     Goal
     ------------------------------------------------------------------ */
  const goalCards = $$(".goal-card");
  const goalBalance = $("#goalBalance"), beam = $("#beam");
  let beamRock = null;

  goalCards.forEach(card => {
    card.dataset.front = card.getAttribute("aria-label");
    card.addEventListener("click", () => revealGoal(card));
  });

  function revealGoal(card) {
    const key = card.dataset.goal;
    if (state.goalSeen.has(key)) { gsap.effects.nudge(card); return; }
    state.goalSeen.add(key);
    card.classList.add("revealed");
    card.setAttribute("aria-label", card.dataset.label);
    sfx("flip");
    gsap.to($(".gc-inner", card), { rotationY: 180, duration: 0.85, ease: "back.out(1.3)" });
    gsap.delayedCall(0.35, () => burstAt(card, { count: 12 }));
    announce(card.dataset.label);
    if (state.goalSeen.size === 2) gsap.delayedCall(0.75, () => { showBalance(); complete("goal"); sfx("correct"); });
  }

  function showBalance(instant = false) {
    goalBalance.hidden = false;
    beamRock?.kill();
    const rock = () => { beamRock = gsap.to(beam, { rotation: 2.5, duration: 2.2, yoyo: true, repeat: -1, ease: "sine.inOut" }); };
    if (instant) { gsap.set(beam, { rotation: 0 }); if (!GameFX.reduced) rock(); return; }
    gsap.timeline({ onComplete: () => { if (!GameFX.reduced) rock(); } })
      .fromTo(goalBalance, { autoAlpha: 0, y: 24 }, { autoAlpha: 1, y: 0, duration: 0.45 })
      .fromTo(beam, { rotation: -18 }, { rotation: 0, duration: 1.7, ease: "elastic.out(1, 0.3)" }, "<0.1")
      .fromTo($$(".pan", goalBalance), { scale: 0 }, { scale: 1, stagger: 0.14, duration: 0.45, ease: "back.out(2.6)" }, "<");
  }

  function goalEnter() {
    goalCards.forEach(card => {
      const seen = state.goalSeen.has(card.dataset.goal);
      card.classList.toggle("revealed", seen);
      card.setAttribute("aria-label", seen ? card.dataset.label : card.dataset.front);
      gsap.set($(".gc-inner", card), { rotationY: seen ? 180 : 0 });
    });
    if (state.goalSeen.size === 2) showBalance(true);
    else { goalBalance.hidden = true; beamRock?.kill(); }
  }

  /* ------------------------------------------------------------------
     Predict
     ------------------------------------------------------------------ */
  const numberGroup = $('[data-question="predict"]');
  const numberCards = $$(".number-card", numberGroup);
  const lockBtn = $("#lockBtn"), predictSummary = $("#predictSummary");

  numberCards.forEach(card => card.addEventListener("click", () => {
    if (state.locked) { gsap.effects.nudge(card); return; }
    state.prediction = Number(card.dataset.value);
    numberCards.forEach(c => { c.classList.toggle("selected", c === card); c.setAttribute("aria-pressed", c === card); });
    gsap.fromTo($$("img", card), { y: 0 }, { y: -14, duration: 0.18, yoyo: true, repeat: 1, stagger: 0.05, ease: "power2.out" });
    predictSummary.innerHTML = `Your guess: order when <b>${plural(state.prediction, "carton")}</b> ${state.prediction === 1 ? "is" : "are"} left.`;
    sfx("select");
    if (lockBtn.hidden) { lockBtn.hidden = false; gsap.effects.popIn(lockBtn); }
  }));

  lockBtn.addEventListener("click", () => {
    if (state.prediction == null || state.locked) return;
    state.locked = true;
    const chosen = numberCards.find(c => Number(c.dataset.value) === state.prediction);
    const others = numberCards.filter(c => c !== chosen);
    numberGroup.classList.add("locked");
    lockBtn.hidden = true;
    complete("predict", { reveal: false });
    sfx("lock");
    gsap.timeline({ onComplete: () => go("NEXT") })
      .add(() => others.forEach(c => c.classList.add("dimmed")))
      .to(others, { scale: 0.94, duration: 0.3 }, "<")
      .fromTo($(".nc-lock", chosen), { autoAlpha: 0, scale: 2.4, rotation: -45 }, { autoAlpha: 1, scale: 1, rotation: 0, duration: 0.5, ease: "back.out(2.6)" }, "<")
      .to(chosen, { scale: 1.06, duration: 0.18, yoyo: true, repeat: 1, ease: "sine.inOut" }, "<0.25")
      .add(() => {
        burstAt(chosen);
        predictSummary.innerHTML = `Locked in: <b>${state.prediction}</b>. Now let’s watch the evidence!`;
        announce(`Prediction locked: ${state.prediction}`);
      }, "<")
      .to({}, { duration: 1 });
  });

  function predictEnter() {
    numberGroup.classList.toggle("locked", state.locked);
    numberCards.forEach(card => {
      const selected = Number(card.dataset.value) === state.prediction;
      card.classList.toggle("selected", selected);
      card.setAttribute("aria-pressed", selected);
      card.classList.toggle("dimmed", state.locked && !selected);
      gsap.set(card, state.locked && !selected ? { scale: 0.94 } : { clearProps: "opacity,visibility,transform" });
      gsap.set($(".nc-lock", card), { autoAlpha: state.locked && selected ? 1 : 0 });
    });
    lockBtn.hidden = state.locked || state.prediction == null;
    predictSummary.innerHTML = state.locked ? `Locked in: <b>${state.prediction}</b>. Now let’s watch the evidence!`
      : state.prediction != null ? `Your guess: order when <b>${plural(state.prediction, "carton")}</b> ${state.prediction === 1 ? "is" : "are"} left.`
      : "Pick a number, then lock it in.";
  }

  /* ------------------------------------------------------------------
     Observe — the seven-day recording is one GSAP timeline built from
     the simulation, so it can play, pause, replay and be scrubbed.
     ------------------------------------------------------------------ */
  const CAM = {
    slotLeft: [40, 152, 264, 376, 520, 612],
    slotTop: 142,
    papaHand: { x: 742, y: 89 },
    crate: { x: 440, y: -4 },
    crateOut: { x: 453, y: 62 }
  };
  const dayChips = $("#dayChips"), slotsEl = $("#slots"), captionEl = $("#caption"), displayEl = $("#fridgeDisplay");
  const orderTicket = $("#orderTicket"), ticketText = $("#ticketText"), ticketSub = $("#ticketSub");
  const camPapa = $("#camPapa"), deliveryEl = $("#delivery"), floatEl = $("#floatLabel"), camAlert = $("#camAlert");
  const camResult = $("#camResult"), zoneExtra = $("#zoneExtra"), scanBeam = $("#scanBeam");
  const playBtn = $("#playBtn"), playIcon = $("#playIcon"), scrub = $("#scrub"), scrubFill = $("#scrubFill"), scrubKnob = $("#scrubKnob"), scrubDay = $("#scrubDay");
  let recTl = null, scrubbing = false, scrubDrag = null;

  const INTRO_CAPTION = "Press play to start the footage.";

  function recordingCaption(d) {
    switch (d.day) {
      case "Mon": return `Monday: ${plural(d.morning, "carton")}. The family drinks 1 carton a day.`;
      case "Tue": return `Tuesday: ${plural(d.morning, "carton")} left.`;
      case "Wed": return `Wednesday: only ${d.morning} left. The rule says “order at 2”, so the fridge queues an order.`;
      case "Thu": return `Thursday: ${plural(d.morning, "carton")}. The fridge sends its old order without looking again.`;
      case "Fri": return `Friday: the delivery adds ${d.delivered}. Now there are ${d.morning} cartons. Too many!`;
      case "Sat": return `Saturday: still ${plural(d.morning, "carton")}. Extra milk is waiting to go bad.`;
      default: return `Sunday: ${plural(d.morning, "carton")}. The week is over.`;
    }
  }
  function displayText(d) {
    if (d.sent && d.recheckStock == null) return "SENDING ORDER · NO RE-CHECK";
    if (d.waiting) return "ORDER WAITING…";
    return `CHECK: ${d.morning} LEFT → ${d.queued ? "ORDER!" : "OK"}`;
  }

  function buildRecordingDom() {
    dayChips.innerHTML = recorded.days.map(d => `<li class="day-chip" data-state="todo"><span>${d.day}</span><b>${d.morning}</b></li>`).join("");
    slotsEl.innerHTML = CAM.slotLeft.map((x, i) =>
      `<img class="slot${i >= FRESH ? " extra" : ""}" src="${GameAssets.url(ART.carton)}" alt="" style="left:${x}px;top:${CAM.slotTop}px">`).join("");
    gsap.set([orderTicket, camPapa, deliveryEl, floatEl, camAlert, camResult, scanBeam], { autoAlpha: 0, x: 0, y: 0 });
    gsap.set(zoneExtra, { attr: { "data-alert": "off" } });
    captionEl.textContent = INTRO_CAPTION;
    displayEl.textContent = "RULE: ORDER AT 2";
    ticketText.textContent = "ORDER QUEUED";
    const queuedDay = recorded.days.find(d => d.queued);
    ticketSub.textContent = `${PACK} cartons · arrives ${recorded.days[queuedDay.index + 2].day}`;
    $("#camResultTitle").textContent = `${plural(recorded.extraCartons, "extra carton")}`;
  }

  const cue = name => { if (!scrubbing && recTl && !recTl.reversed()) sfx(name); };
  const speak = text => { if (!scrubbing) announce(text); };

  /*
   * Built only from set() + to() pairs: when the footage is scrubbed backwards,
   * GSAP restores each element's recorded pre-state, so every frame is exact.
   */
  function makeRecordingTimeline() {
    const days = recorded.days;
    const slots = $$(".slot", slotsEl);
    const chips = $$(".day-chip", dayChips);
    const tl = gsap.timeline({ paused: true, onUpdate: syncScrub, onComplete: recordingEnded });
    tl.timeScale(1 / GameFX.MOTION);
    let at = 0.1, count = 0;

    const enter = (targets, fromVars, toVars, t) => { tl.set(targets, fromVars, t); tl.to(targets, toVars, t); };
    const say = (text, t) => {
      tl.set(captionEl, { text: "" }, t);
      tl.to(captionEl, { text: { value: text }, duration: Math.min(0.9, text.length * 0.016), ease: "none" }, t);
      tl.call(speak, [text], t);
    };
    const floatLabel = (text, index, t, color) => {
      const x = CAM.slotLeft[gsap.utils.clamp(0, 5, index)] + 26, y = CAM.slotTop - 8;
      tl.set(floatEl, { text, x, y, autoAlpha: 1, backgroundColor: color }, t);
      tl.to(floatEl, { y: y - 58, autoAlpha: 0, duration: 0.95, ease: "power1.out" }, t + 0.05);
    };
    const flyIn = (from, first, n, t, gap) => {
      for (let k = 0; k < n; k++) {
        const i = first + k, slot = slots[i];
        const sx = from.x - CAM.slotLeft[i], sy = from.y - CAM.slotTop, tk = t + k * gap;
        tl.set(slot, { autoAlpha: 1, x: sx, y: sy, scale: 0.45, rotation: -12 }, tk);
        tl.to(slot, { motionPath: { path: [{ x: sx * 0.5, y: Math.min(sy, 0) - 70 }, { x: 0, y: 0 }], curviness: 1.3 }, scale: 1, rotation: 0, duration: 0.6, ease: "power1.inOut" }, tk);
        tl.call(cue, ["drop"], tk + 0.5);
      }
      return t + (n - 1) * gap + 0.6;
    };

    days.forEach((d, i) => {
      tl.addLabel(`day${i}`, at);
      tl.set(chips[i], { attr: { "data-state": "active" } }, at);
      if (i > 0) tl.set(chips[i - 1], { attr: { "data-state": days[i - 1].over ? "over" : "done" } }, at);
      tl.call(cue, ["tick"], at);
      say(recordingCaption(d), at + 0.15);
      at += 0.3;

      if (i === 0) {
        const first = slots.slice(0, d.morning);
        first.forEach((slot, k) => {
          const tk = at + k * 0.13;
          enter(slot, { autoAlpha: 1, y: -250 }, { y: 0, duration: 0.65, ease: "bounce.out" }, tk);
          tl.call(cue, ["drop"], tk + 0.35);
        });
        count = d.morning;
        at += 0.65 + 0.13 * (first.length - 1);
      }

      if (d.delivered) {
        enter(deliveryEl, { autoAlpha: 1, x: CAM.crate.x, y: -180, rotation: -10 }, { y: CAM.crate.y, rotation: 0, duration: 1, ease: "sine.out" }, at);
        tl.to(orderTicket, { autoAlpha: 0, y: -24, duration: 0.3 }, at + 0.2);
        tl.to(displayEl, { text: `DELIVERY +${d.delivered}`, duration: 0.3, ease: "none" }, at + 0.2);
        tl.call(cue, ["ding"], at + 0.9);
        at += 1;
        at = flyIn(CAM.crateOut, count, d.delivered, at, 0.16);
        floatLabel(`+${d.delivered}`, count + d.delivered - 1, at - 0.3, "#155ed7");
        count += d.delivered;
        tl.to(deliveryEl, { autoAlpha: 0, y: CAM.crate.y - 70, duration: 0.45, ease: "power2.in" }, at);
        at += 0.35;
      }

      /* Morning check (skipped when an old order is simply sent). */
      if (d.sent && d.recheckStock == null) {
        tl.to(displayEl, { text: displayText(d), duration: 0.4, ease: "none" }, at);
        tl.to(ticketText, { scrambleText: { text: "ORDER SENT", chars: "XO01", speed: 0.6 }, duration: 0.7 }, at);
        tl.to(ticketSub, { text: "No one checked again", duration: 0.4, ease: "none" }, at + 0.1);
        enter(orderTicket, { rotation: 3 }, { rotation: -3, duration: 0.12, repeat: 5, yoyo: true, ease: "sine.inOut" }, at);
        tl.call(cue, ["alert"], at + 0.2);
        at += 0.8;
      } else {
        enter(scanBeam, { autoAlpha: 1, x: 0 }, { x: 440, duration: 0.7, ease: "power1.inOut" }, at);
        tl.to(scanBeam, { autoAlpha: 0, duration: 0.2 }, at + 0.6);
        tl.to(displayEl, { text: displayText(d), duration: 0.4, ease: "none" }, at + 0.2);
        at += 0.8;
      }

      if (d.queued) {
        enter(orderTicket, { autoAlpha: 1, y: -40, rotation: -10 }, { y: 0, rotation: 2, duration: 0.55, ease: "back.out(2)" }, at);
        tl.to(ticketText, { scrambleText: { text: "ORDER QUEUED", chars: "XO01", speed: 0.6 }, duration: 0.7 }, at);
        tl.call(cue, ["ding"], at + 0.1);
        at += 0.7;
      }

      const wasOver = i > 0 && days[i - 1].over > 0;
      if (d.over && !wasOver) {
        tl.set(zoneExtra, { attr: { "data-alert": "on" } }, at);
        enter(camAlert, { autoAlpha: 0, scale: 1.9, rotation: -20 }, { autoAlpha: 1, scale: 1, rotation: -6, duration: 0.5, ease: "back.out(2.4)" }, at);
        tl.call(cue, ["alert"], at + 0.1);
        at += 0.5;
      } else if (!d.over && wasOver) {
        tl.set(zoneExtra, { attr: { "data-alert": "off" } }, at);
        tl.to(camAlert, { autoAlpha: 0, duration: 0.3 }, at);
      }

      at += 1.05;

      if (d.used) {
        const leaving = slots.slice(count - d.used, count);
        tl.to(leaving, { y: -80, autoAlpha: 0, scale: 0.7, duration: 0.45, ease: "power2.in" }, at);
        floatLabel(`−${d.used}`, count - 1, at, "#25105f");
        tl.call(cue, ["lift"], at);
        count -= d.used;
        at += 0.6;
      }

      if (d.added) {
        say(`That evening, Papa brings home ${d.added} cartons from the shop.`, at);
        enter(camPapa, { autoAlpha: 1, x: 260 }, { x: 0, duration: 0.7, ease: "back.out(1.3)" }, at);
        at += 0.85;
        at = flyIn(CAM.papaHand, count, d.added, at, 0.22);
        floatLabel(`+${d.added}`, count + d.added - 1, at - 0.3, "#079a9b");
        count += d.added;
        tl.to(camPapa, { x: 270, duration: 0.55, ease: "power2.in" }, at + 0.5);
        tl.set(camPapa, { autoAlpha: 0 }, at + 1.05);
        at += 1.1;
      }
      at += 0.3;
    });

    tl.set(chips[days.length - 1], { attr: { "data-state": days[days.length - 1].over ? "over" : "done" } }, at);
    enter(camResult, { autoAlpha: 0, scale: 0.7 }, { autoAlpha: 1, scale: 1, duration: 0.6, ease: "back.out(1.8)" }, at);
    say(`Result: ${plural(recorded.extraCartons, "extra carton")} this week. Some milk could go to waste.`, at);
    tl.call(cue, ["alert"], at + 0.1);
    tl.to({}, { duration: 0.6 }, at + 0.6);
    return tl;
  }

  function currentDayIndex() {
    if (!recTl) return 0;
    const t = recTl.time();
    let index = 0;
    recorded.days.forEach((_, i) => { if (recTl.labels[`day${i}`] <= t + 0.001) index = i; });
    return index;
  }
  const scrubMax = () => scrub.offsetWidth;

  function syncScrub() {
    if (!recTl) return;
    const p = recTl.progress();
    gsap.set(scrubFill, { scaleX: p });
    if (!scrubbing || !scrubDrag?.isDragging) gsap.set(scrubKnob, { x: p * scrubMax() });
    const i = currentDayIndex(), d = recorded.days[i];
    scrubDay.textContent = d.day;
    scrubKnob.setAttribute("aria-valuenow", i + 1);
    scrubKnob.setAttribute("aria-valuetext", d.dayName);
  }

  function setPlayIcon(mode) {
    playIcon.setAttribute("href", mode === "pause" ? "#i-pause" : mode === "replay" ? "#i-replay" : "#i-play");
    playBtn.setAttribute("aria-label", mode === "pause" ? "Pause the footage" : mode === "replay" ? "Replay the footage" : "Play the footage");
  }

  function startRecording(restart = false) {
    GameSound.unlock();
    if (!recTl) return;
    if (restart || recTl.progress() >= 1) recTl.restart(); else recTl.play();
    state.recordingStarted = true;
    if (replayBtn.hidden && state.scene === "observe") { replayBtn.hidden = false; gsap.effects.popIn(replayBtn); }
    setPlayIcon("pause");
  }
  function togglePlay() {
    if (!recTl) return;
    if (!recTl.paused() && recTl.progress() < 1) { recTl.pause(); setPlayIcon("play"); sfx("tap"); return; }
    startRecording();
  }
  function seekRecording(progress) {
    if (!recTl) return;
    scrubbing = true;
    recTl.pause().progress(gsap.utils.clamp(0, 1, progress));
    scrubbing = false;
    setPlayIcon(recTl.progress() >= 1 ? "replay" : "play");
    if (recTl.progress() >= 0.999) recordingEnded();
  }
  function seekDay(delta) {
    if (!recTl) return;
    const i = gsap.utils.clamp(0, recorded.days.length - 1, currentDayIndex() + delta);
    seekRecording(recTl.labels[`day${i}`] / recTl.duration() + 0.0005);
  }

  function recordingEnded() {
    setPlayIcon("replay");
    if (state.observed) return;
    state.observed = true;
    state.recordingStarted = true;
    replayBtn.hidden = state.scene !== "observe";
    complete("observe");
    gsap.effects.pulse(camResult, { scale: 1.04, repeat: 1 });
  }

  function observeEnter() {
    if (!recTl) {
      buildRecordingDom();
      recTl = makeRecordingTimeline();
      if (state.observed) { scrubbing = true; recTl.progress(1); scrubbing = false; }
    }
    if (!scrubDrag) {
      scrubDrag = Draggable.create(scrubKnob, {
        type: "x",
        bounds: { minX: 0, maxX: scrubMax() },
        onPress() { this.applyBounds({ minX: 0, maxX: scrubMax() }); recTl.pause(); scrubbing = true; },
        onDrag() { recTl.progress(this.x / scrubMax()); },
        onRelease() { scrubbing = false; seekRecording(this.x / scrubMax()); }
      })[0];
    }
    syncScrub();
    setPlayIcon(recTl.progress() >= 1 ? "replay" : "play");
  }
  function observeLeave() {
    if (recTl && !recTl.paused()) recTl.pause();
    setPlayIcon(recTl && recTl.progress() >= 1 ? "replay" : "play");
  }

  playBtn.addEventListener("click", togglePlay);
  replayBtn.addEventListener("click", () => { sfx("tap"); startRecording(true); });
  scrub.addEventListener("pointerdown", event => {
    if (event.target === scrubKnob) return;
    const r = scrub.getBoundingClientRect();
    seekRecording((event.clientX - r.left) / r.width);
    sfx("tick");
  });
  scrubKnob.addEventListener("keydown", event => {
    if (event.key === "ArrowRight" || event.key === "ArrowUp") { event.preventDefault(); seekDay(1); }
    else if (event.key === "ArrowLeft" || event.key === "ArrowDown") { event.preventDefault(); seekDay(-1); }
    else if (event.key === "Home") { event.preventDefault(); seekRecording(0); }
    else if (event.key === "End") { event.preventDefault(); seekRecording(1); }
    else if (event.key === " " || event.key === "Enter") { event.preventDefault(); togglePlay(); }
  });

  /* ------------------------------------------------------------------
     Calibrate — test a threshold against a normal week
     ------------------------------------------------------------------ */
  const calChart = buildWeekChart($("#calChart"));
  const dialTrack = $("#dialTrack"), dialKnob = $("#dialKnob"), dialKnobText = $("#dialKnobText"), dialValue = $("#dialValue");
  const testBtn = $("#testBtn"), calResult = $("#calResult"), needle = $("#needle");
  const stopSpacing = () => dialTrack.offsetWidth / 4;
  let dialDrag = null;

  /* Normal-week threshold logic: 0–1 run-out, 2 balanced, 3–4 excess stock. */
  function evaluateThreshold(value) {
    const result = FridgeSim.scenarios.normalWeek(value);
    let title, text;
    if (result.outcome === "runout") {
      title = "Too late: the milk ran out";
      text = `No milk on ${result.runOutDays.map(d => d.dayName).join(" and ")}. The delivery came too late. Try another number.`;
    } else if (result.outcome === "excess") {
      title = "Too early: extra milk piled up";
      text = `${result.peak} cartons on ${result.peakDay.dayName}: ${result.extraCartons} more than the family can drink fresh. Try another number.`;
    } else {
      title = "Balanced for this week!";
      text = "Milk was ready every day, and nothing went to waste.";
    }
    return Object.assign(result, { value, title, text });
  }

  function needlePosition(result) {
    if (result.outcome === "runout") return Math.max(6, 26 - 9 * result.runOutDays.length);
    if (result.outcome === "excess") return Math.min(94, 72 + 11 * result.extraCartons);
    return 50;
  }

  function setDial(value, { fromDrag = false, silent = false, instant = false } = {}) {
    value = gsap.utils.clamp(0, 4, Math.round(value));
    const changed = value !== state.dial;
    state.dial = value;
    dialKnobText.textContent = value;
    dialValue.textContent = value;
    $(".wk-t", calChart).textContent = value;
    dialKnob.setAttribute("aria-valuenow", value);
    dialKnob.setAttribute("aria-valuetext", plural(value, "carton"));
    if (!fromDrag) gsap.to(dialKnob, { x: value * stopSpacing(), duration: instant ? 0 : 0.35, ease: "back.out(2)" });
    gsap.to(calChart, { "--t": value, duration: instant ? 0 : 0.4, ease: "power2.out" });
    if (changed && !silent) {
      sfx("tick");
      if (!fromDrag) gsap.effects.pulse(dialKnob, { scale: 1.12, repeat: 1 });
    }
  }

  function renderCalResult(result, { animate = true } = {}) {
    const kind = result.outcome === "balanced" ? "good" : result.outcome === "runout" ? "bad" : "warn";
    const icon = kind === "good" ? "i-check" : kind === "bad" ? "i-x" : "i-box";
    let extra = "";
    if (kind === "good") {
      extra = state.prediction === result.value
        ? `<br><strong>Your prediction of ${state.prediction} was spot on!</strong>`
        : `<br><strong>You predicted ${state.prediction ?? "—"}. The evidence showed ${result.value} works better. That’s why we test!</strong>`;
    }
    calResult.className = `result-card ${kind}`;
    calResult.innerHTML = `<span class="result-icon"><svg class="ic"><use href="#${icon}"/></svg></span><div><b>${result.title}</b><p>${result.text}${extra}</p></div>`;
    gsap.to(needle, { left: `${needlePosition(result)}%`, duration: animate ? 1.3 : 0, ease: "elastic.out(1, 0.45)" });
    if (animate) gsap.fromTo(calResult, { scale: 0.95, autoAlpha: 0.4 }, { scale: 1, autoAlpha: 1, duration: 0.4, ease: "back.out(2)" });
  }

  function runTest() {
    if (testBtn.disabled) return;
    GameSound.unlock();
    const result = evaluateThreshold(state.dial);
    state.tests.push(state.dial);
    state.lastResult = result;
    testBtn.disabled = true;
    sfx("tap");
    const tl = animateWeek(calChart, result);
    tl.add(() => {
      testBtn.disabled = false;
      renderCalResult(result);
      if (result.outcome === "balanced") {
        sfx("correct");
        burstAt(calResult);
        complete("calibrate");
      } else {
        sfx("wrong");
        const culprits = result.outcome === "runout" ? result.runOutDays : result.days.filter(d => d.over);
        culprits.forEach(d => gsap.effects.pulse(calChart._cols[d.index].stack, { scale: 1.08, repeat: 1 }));
      }
    }, ">-0.1");
  }

  function layoutDial() {
    const s = stopSpacing();
    $$("#dialStops span").forEach(span => { span.style.left = `${Number(span.dataset.stop) * s}px`; });
    if (!dialDrag) {
      dialDrag = Draggable.create(dialKnob, {
        type: "x",
        bounds: { minX: 0, maxX: 4 * s },
        liveSnap: { x: v => Math.round(v / stopSpacing()) * stopSpacing() },
        onPress() { this.applyBounds({ minX: 0, maxX: 4 * stopSpacing() }); GameSound.unlock(); },
        onDrag() { setDial(this.x / stopSpacing(), { fromDrag: true }); },
        onRelease() { setDial(this.x / stopSpacing()); }
      })[0];
    }
  }

  function calibrateEnter() {
    $("#savedPrediction").textContent = state.prediction ?? "not set";
    if (state.dial == null) state.dial = state.prediction ?? 2;
    layoutDial();
    setDial(state.dial, { silent: true, instant: true });
    dialDrag.update();
    if (state.lastResult) {
      animateWeek(calChart, state.lastResult, { instant: true });
      renderCalResult(state.lastResult, { animate: false });
    } else {
      clearWeekChart(calChart);
      calResult.className = "result-card";
      calResult.innerHTML = `<span class="result-icon"><svg class="ic"><use href="#i-scale"/></svg></span><div><b>Waiting for your test</b><p>Set a number and press Test. The week will show if it is too low, balanced, or too high.</p></div>`;
      gsap.set(needle, { left: "50%" });
    }
  }

  $("#dialMinus").addEventListener("click", () => setDial(state.dial - 1));
  $("#dialPlus").addEventListener("click", () => setDial(state.dial + 1));
  $$("#dialStops span").forEach(span => span.addEventListener("click", () => setDial(Number(span.dataset.stop))));
  dialKnob.addEventListener("keydown", event => {
    const map = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 };
    if (event.key in map) { event.preventDefault(); setDial(state.dial + map[event.key]); }
    else if (event.key === "Home") { event.preventDefault(); setDial(0); }
    else if (event.key === "End") { event.preventDefault(); setDial(4); }
    else if (event.key === "Enter") { event.preventDefault(); runTest(); }
  });
  testBtn.addEventListener("click", runTest);

  /* ------------------------------------------------------------------
     Question scenes (investigate, repair, explain, transfer)
     ------------------------------------------------------------------ */
  function setFeedback(el, text, kind = "", quiet = false) {
    el.textContent = text;
    el.className = `feedback${kind ? " " + kind : ""}`;
    if (!quiet) gsap.fromTo(el, { scale: 0.96 }, { scale: 1, duration: 0.35, ease: "back.out(3)" });
  }

  function renderQuestion(group) {
    const q = group.dataset.question, solved = state.answers[q];
    const fb = $("[data-feedback]", group.closest(".scene"));
    group.classList.toggle("solved", !!solved);
    $$(".choice", group).forEach(button => {
      const isCorrect = button.dataset.value === correctAnswers[q];
      button.classList.remove("wrong");
      button.classList.toggle("correct", !!solved && isCorrect);
      button.hidden = !!solved && !isCorrect;
      gsap.set(button, { clearProps: "opacity,visibility,transform" });
    });
    setFeedback(fb, solved ? prompts[q][solved] : defaultFeedback[q], solved ? "success" : "", true);
  }

  function answerQuestion(button) {
    const group = button.closest("[data-question]"), q = group.dataset.question;
    const scene = button.closest(".scene"), fb = $("[data-feedback]", scene);
    if (state.answers[q]) { gsap.effects.nudge(button); return; }
    const value = button.dataset.value;
    $$(".choice", group).forEach(b => b.classList.remove("wrong"));

    if (value !== correctAnswers[q]) {
      button.classList.add("wrong");
      setFeedback(fb, prompts[q][value], "error");
      sfx("wrong");
      gsap.effects.shake(button);
      if (q === "cause") gsap.effects.pulse($(".clue.key"), { scale: 1.06, repeat: 3 });
      return;
    }

    state.answers[q] = value;
    sfx("correct");
    burstAt(button);
    setFeedback(fb, prompts[q][value], "success");
    const others = $$(".choice", group).filter(b => b !== button);
    gsap.timeline()
      .to(others, { autoAlpha: 0, scale: 0.85, duration: 0.25, ease: "power2.in" })
      .add(() => {
        const flipState = Flip.getState([button, fb]);
        others.forEach(b => { b.hidden = true; gsap.set(b, { clearProps: "opacity,visibility,transform" }); });
        button.classList.add("correct");
        group.classList.add("solved");
        Flip.from(flipState, { duration: 0.6, ease: "power2.inOut" });
        afterCorrect[q]();
      });
  }

  const afterCorrect = {
    cause() {
      gsap.effects.pulse($(".clue.key"), { scale: 1.06, repeat: 1 });
      complete("investigate");
    },
    fix() {
      showFixLab(false);
    },
    scale() {
      showHouseholds(false);
    },
    transfer() {
      showImpact(false);
      complete("transfer");
    }
  };

  $$("[data-question] .choice").forEach(button => button.addEventListener("click", () => answerQuestion(button)));

  /* Investigate clues come straight from the recorded week. */
  function buildClues() {
    const wed = recorded.days.find(d => d.queued), thu = recorded.days[wed.index + 1], fri = recorded.days.find(d => d.delivered);
    $("#clues").innerHTML = `
      <li class="clue"><span class="clue-num">${wed.morning}</span><span><b>${wed.dayName}</b><small><svg class="ic"><use href="#i-ticket"/></svg>Order queued</small></span></li>
      <li class="clue key"><span class="clue-num">${thu.morning}</span><span><b>${thu.dayName}</b><small><svg class="ic"><use href="#i-up"/></svg>Milk went up!</small></span></li>
      <li class="clue bad"><span class="clue-num">${fri.morning}</span><span><b>${fri.dayName}</b><small><svg class="ic"><use href="#i-truck"/></svg>Delivery: too many</small></span></li>`;
  }

  /* ------------------------------------------------------------------
     Repair — run the fix along a MotionPath
     ------------------------------------------------------------------ */
  const fixLab = $("#fixLab"), runFixBtn = $("#runFixBtn"), fixPath = $("#fixPath"), fixToken = $("#fixToken");
  const fixStamp = $("#fixStamp"), fixChart = buildWeekChart($("#fixChart"), { mini: true }), fixResultText = $("#fixResultText");
  const fixNodes = $$(".fix-node", fixLab);
  let fixTl = null;

  function prepareFixLab() {
    const queued = fixed.days.find(d => d.queued), recheck = fixed.days.find(d => d.cancelled);
    $('[data-node="1"] small', fixLab).textContent = `${queued.morning} left → order queued`;
    $('[data-node="2"] small', fixLab).textContent = `Now ${plural(queued.evening, "carton")}`;
    $("#recheckText").textContent = `${recheck.recheckStock} left → cancel`;
  }

  function resetFixLab() {
    fixTl?.kill(); fixTl = null;
    fixNodes.forEach(n => n.classList.remove("lit", "win"));
    gsap.set(fixStamp, { autoAlpha: 0 });
    gsap.set([fixToken, fixPath], { autoAlpha: 0 });
    clearWeekChart(fixChart);
    fixResultText.textContent = "Waiting…";
    runFixBtn.disabled = false;
    $("span", runFixBtn).textContent = "Run the fix";
  }

  function showFixLab(instant) {
    fixLab.hidden = false;
    if (instant) return;
    gsap.fromTo(fixLab, { autoAlpha: 0, y: 30 }, { autoAlpha: 1, y: 0, duration: 0.55, delay: 0.5, ease: "back.out(1.4)" });
    gsap.from(fixNodes, { autoAlpha: 0, scale: 0.7, stagger: 0.1, duration: 0.45, delay: 0.7, ease: "back.out(2)" });
    gsap.delayedCall(1.4, () => gsap.effects.pulse(runFixBtn, { scale: 1.07, repeat: 3 }));
  }

  function fixEndState() {
    fixNodes.forEach(n => n.classList.add("lit"));
    fixNodes[3].classList.add("win");
    gsap.set(fixStamp, { autoAlpha: 1, scale: 1, rotation: 10 });
    gsap.set(fixPath, { autoAlpha: 1, drawSVG: "100%" });
    animateWeek(fixChart, fixed, { instant: true });
    fixResultText.textContent = `Most milk: ${fixed.peak} · No extra!`;
    $("span", runFixBtn).textContent = "Run again";
  }

  function runFix() {
    if (fixTl && fixTl.isActive()) return;
    GameSound.unlock();
    resetFixLab();
    runFixBtn.disabled = true;
    const D = 3.3;
    const light = i => {
      fixNodes[i].classList.add("lit");
      gsap.effects.pulse(fixNodes[i], { scale: 1.05, repeat: 1 });
      sfx(i === 2 ? "ding" : "tap");
      $("#fixLive").textContent = `${$(".fn-when", fixNodes[i]).textContent}: ${$("b", fixNodes[i]).textContent}. ${$("small", fixNodes[i]).textContent}`;
    };
    const tl = fixTl = gsap.timeline({ onComplete: fixDone });
    tl.timeScale(1 / GameFX.MOTION);
    tl.set([fixToken, fixPath], { autoAlpha: 1 }, 0);
    tl.fromTo(fixPath, { drawSVG: "0%" }, { drawSVG: "100%", duration: D, ease: "none" }, 0);
    tl.to(fixToken, { motionPath: { path: fixPath, align: fixPath, alignOrigin: [0.5, 0.5] }, duration: D, ease: "none" }, 0);
    [0, D / 3, (2 * D) / 3].forEach((t, i) => tl.call(light, [i], t + 0.05));
    tl.fromTo(fixStamp, { autoAlpha: 0, scale: 2.4, rotation: -20 }, { autoAlpha: 1, scale: 1, rotation: 10, duration: 0.45, ease: "back.out(2.5)", immediateRender: false }, (2 * D) / 3 + 0.35);
    tl.call(() => sfx("lock"), null, (2 * D) / 3 + 0.5);
    tl.call(() => {
      light(3);
      fixNodes[3].classList.add("win");
      animateWeek(fixChart, fixed);
      fixResultText.textContent = `Most milk: ${fixed.peak} · No extra!`;
    }, null, D);
    tl.to(fixToken, { autoAlpha: 0, duration: 0.3 }, D);
    tl.to({}, { duration: 1.3 }, D);
  }

  function fixDone() {
    state.fixRun = true;
    runFixBtn.disabled = false;
    $("span", runFixBtn).textContent = "Run again";
    sfx("correct");
    burstAt(fixNodes[3]);
    $("#fixLive").textContent = `The fresh re-check cancelled the extra order. Most milk all week: ${fixed.peak}. No extra milk.`;
    complete("repair");
  }

  runFixBtn.addEventListener("click", runFix);

  function repairEnter() {
    if (!state.answers.fix) { fixLab.hidden = true; resetFixLab(); return; }
    showFixLab(true);
    if (state.fixRun) fixEndState(); else resetFixLab();
  }

  /* ------------------------------------------------------------------
     Explain — same rule, three households
     ------------------------------------------------------------------ */
  const householdsEl = $("#households"), hhGrid = $("#hhGrid");

  function verdictFor(result) {
    if (result.outcome === "balanced") return `<svg class="ic"><use href="#i-check"/></svg>Balanced`;
    if (result.outcome === "runout") return `<svg class="ic"><use href="#i-x"/></svg>Runs out on ${plural(result.runOutDays.length, "day")}`;
    return `<svg class="ic"><use href="#i-x"/></svg>${plural(result.extraCartons, "extra carton")}`;
  }

  function buildHouseholds() {
    hhGrid.innerHTML = households.map(h =>
      `<div class="hh-card ${h.result.outcome}"><b>${h.title}</b><small>${h.detail}</small><div class="week-chart mini"></div><span class="hh-verdict">${verdictFor(h.result)}</span></div>`).join("");
    $$(".week-chart", hhGrid).forEach(el => buildWeekChart(el, { mini: true }));
  }

  function showHouseholds(instant) {
    householdsEl.hidden = false;
    const cards = $$(".hh-card", hhGrid), charts = $$(".week-chart", hhGrid);
    if (instant) { households.forEach((h, i) => animateWeek(charts[i], h.result, { instant: true })); return; }
    charts.forEach(clearWeekChart);
    const tl = gsap.timeline({ delay: 0.45, onComplete: () => complete("explain") });
    tl.fromTo(householdsEl, { autoAlpha: 0, y: 30 }, { autoAlpha: 1, y: 0, duration: 0.5, ease: "back.out(1.4)" })
      .from(cards, { autoAlpha: 0, y: 26, stagger: 0.15, duration: 0.45 }, "<0.15");
    households.forEach((h, i) => tl.add(() => animateWeek(charts[i], h.result), 0.5 + i * 0.35));
    tl.from($$(".hh-verdict", hhGrid), { autoAlpha: 0, scale: 0.5, stagger: 0.35, duration: 0.4, ease: "back.out(2.5)" }, 1.1);
    tl.to({}, { duration: 0.4 });
  }

  function explainEnter() {
    if (state.answers.scale) showHouseholds(true); else householdsEl.hidden = true;
  }

  /* ------------------------------------------------------------------
     Transfer — glue sticks in the class cupboard
     ------------------------------------------------------------------ */
  const impactEl = $("#impact");
  function showImpact(instant) {
    impactEl.hidden = false;
    if (instant) return;
    gsap.from($$("figure", impactEl), { autoAlpha: 0, x: 90, rotation: 4, stagger: 0.22, duration: 0.7, delay: 0.4, ease: "back.out(1.5)" });
  }
  function transferEnter() {
    if (state.answers.transfer) showImpact(true); else impactEl.hidden = true;
  }

  function questionsEnter() {
    $$("[data-question]:not([data-question='predict'])", sceneEl()).forEach(renderQuestion);
  }

  /* ------------------------------------------------------------------
     Title and Complete
     ------------------------------------------------------------------ */
  let titleLoops = [];
  function titleEnter() {
    titleLoops.forEach(t => t.kill());
    titleLoops = [];
    startRevealed = false;
    if (!GameAssets.isReady()) return;              // the loading bar is already on screen; it reveals Start itself
    gsap.timeline({ delay: 0.15 })
      .fromTo(".title-card", { autoAlpha: 0, scale: 0.85, y: 40 }, { autoAlpha: 1, scale: 1, y: 0, duration: 0.8, ease: "back.out(1.5)" })
      .add(revealStart, "-=0.25");
  }

  /* ------------------------------------------------------------------
     Title loading bar — the Start plate appears only once every asset is fetched
     ------------------------------------------------------------------ */
  const startBtn = $("#startBtn"), titleLoader = $("#titleLoader");
  let startRevealed = false;
  function revealStart() {
    if (startRevealed || state.scene !== "title") return;
    startRevealed = true;
    gsap.killTweensOf(titleLoader);
    titleLoader.hidden = true;
    startBtn.hidden = false;
    ctaIntro(startBtn);
    if (!GameFX.reduced) titleLoops.push(gsap.to(startBtn, { scale: 1.04, duration: 0.9, yoyo: true, repeat: -1, ease: "sine.inOut", delay: 1.2 }));
  }
  GameAssets.onProgress(() => {                 // the bar itself is painted by js/preload.js
    if (GameAssets.isReady() && !startRevealed && state.scene === "title") {
      gsap.to(titleLoader, { autoAlpha: 0, y: -10, duration: 0.25, delay: 0.25, onComplete: revealStart });
    }
  });
  function titleLeave() { titleLoops.forEach(t => t.kill()); titleLoops = []; }

  function celebrate(big = false) {
    if (!window.confetti) return;
    const base = { disableForReducedMotion: true, zIndex: 150, colors: ["#ffd53f", "#43c52f", "#29afde", "#ff6b22", "#a36bff", "#ffffff"] };
    window.confetti({ ...base, particleCount: big ? 220 : 130, spread: big ? 120 : 80, startVelocity: 48, origin: { x: 0.6, y: 0.32 } });
    window.confetti({ ...base, particleCount: 70, angle: 60, spread: 60, origin: { x: 0, y: 0.75 } });
    window.confetti({ ...base, particleCount: 70, angle: 120, spread: 60, origin: { x: 1, y: 0.75 } });
  }

  let medalFloat = null;
  function completeEnter() {
    $("#statPrediction").textContent = state.prediction ?? "–";
    $("#statTests").textContent = state.tests.length;
    $("#statTime").textContent = formatTime(state.elapsed);
    medalFloat?.kill();
    const medal = $("#medal");
    gsap.timeline({ delay: 0.3 })
      .fromTo(medal, { autoAlpha: 0, scale: 0, rotationY: -540 }, { autoAlpha: 1, scale: 1, rotationY: 0, duration: 1.3, ease: "back.out(1.4)" })
      .fromTo(".learned li", { autoAlpha: 0, x: 44 }, { autoAlpha: 1, x: 0, stagger: 0.18, duration: 0.45 }, "-=0.6")
      .fromTo(".learned .tick path", { drawSVG: "0%" }, { drawSVG: "100%", stagger: 0.18, duration: 0.4, ease: "power2.inOut" }, "<0.15")
      .fromTo(".stats span", { autoAlpha: 0, y: 14 }, { autoAlpha: 1, y: 0, stagger: 0.08 }, "-=0.2")
      .add(() => { if (!GameFX.reduced) medalFloat = gsap.to(medal, { y: -8, rotation: 3, duration: 1.8, yoyo: true, repeat: -1, ease: "sine.inOut" }); });
    gsap.delayedCall(0.5, () => { celebrate(); sfx("win"); });
    complete("complete", { reveal: false });
  }

  $("#finishBtn").addEventListener("click", () => {
    if (sceneTl && sceneTl.isActive()) return;
    sfx("win");
    celebrate(true);
    gsap.to(".complete-card", { autoAlpha: 0, scale: 0.9, duration: 0.5, delay: 0.9, ease: "power2.in", onComplete: resetMission });
  });

  function resetMission() {
    recTl?.kill(); recTl = null;
    resetFixLab();
    medalFloat?.kill();
    gsap.set(".complete-card", { clearProps: "all" });
    Object.assign(state, freshState(state.sound), { scene: state.scene });
    state.goalSeen = new Set();
    $("#timerText").textContent = formatTime(0);
    replayBtn.hidden = true;
    actor.send({ type: "RESET" });
  }

  /* ------------------------------------------------------------------
     Scene handlers
     ------------------------------------------------------------------ */
  const sceneHandlers = {
    title: { enter: titleEnter, leave: titleLeave },
    goal: { enter: goalEnter },
    predict: { enter: predictEnter },
    observe: { enter: observeEnter, leave: observeLeave },
    calibrate: { enter: calibrateEnter },
    investigate: { enter: questionsEnter },
    repair: { enter() { questionsEnter(); repairEnter(); } },
    explain: { enter() { questionsEnter(); explainEnter(); } },
    transfer: { enter() { questionsEnter(); transferEnter(); } },
    complete: { enter: completeEnter, leave() { medalFloat?.kill(); } }
  };

  /* ------------------------------------------------------------------
     Input
     ------------------------------------------------------------------ */
  startBtn.addEventListener("click", () => {
    if (!GameAssets.isReady()) return;           // keyboard / programmatic starts wait for the preloader too
    GameSound.unlock(); GameVoice.unlock(); go("NEXT");
  });
  $$("[data-next]").forEach(button => button.addEventListener("click", () => go("NEXT")));
  backBtn.addEventListener("click", () => { sfx("tap"); go("BACK"); });
  $("#helpBtn").addEventListener("click", () => { sfx("tap"); closeSoundMenu(); actor.send({ type: "HELP" }); });
  $("#helpClose").addEventListener("click", () => { sfx("tap"); actor.send({ type: "CLOSE" }); });
  $("#resumeBtn").addEventListener("click", () => { sfx("tap"); actor.send({ type: "RESUME" }); });
  $("#pauseClose").addEventListener("click", () => { sfx("tap"); actor.send({ type: "RESUME" }); });
  [helpOverlay, pauseOverlay].forEach(layer => layer.addEventListener("click", event => {
    if (event.target === layer || event.target === layer.firstElementChild) actor.send({ type: layer === helpOverlay ? "CLOSE" : "RESUME" });
  }));
  hintBtn.addEventListener("click", showHintBubble);

  /* Sound hex opens the menu: Replay Narration / Mute All Sounds. */
  function openSoundMenu() {
    soundMenu.hidden = false;
    soundBtn.setAttribute("aria-expanded", "true");
    $("#narrationBtn").focus({ preventScroll: true });
  }
  function closeSoundMenu({ refocus = false } = {}) {
    if (soundMenu.hidden) return;
    soundMenu.hidden = true;
    soundBtn.setAttribute("aria-expanded", "false");
    if (refocus) soundBtn.focus({ preventScroll: true });
  }
  soundBtn.addEventListener("click", () => {
    GameSound.unlock();
    if (soundMenu.hidden) { sfx("tap"); openSoundMenu(); } else closeSoundMenu();
  });
  document.addEventListener("pointerdown", event => {
    if (!soundMenu.hidden && !event.target.closest("#soundMenu, #soundBtn")) closeSoundMenu();
  });

  /* Replay Narration restarts the active step's recorded line. */
  function narrate() {
    if (state.scene && state.scene !== "title") GameVoice.play(state.scene);
  }
  $("#narrationBtn").addEventListener("click", () => { closeSoundMenu({ refocus: true }); narrate(); });

  function setSound(on) {
    state.sound = on;
    GameSound.setEnabled(on);
    GameVoice.setEnabled(on);
    soundBtn.classList.toggle("is-muted", !on);
    soundBtn.setAttribute("aria-label", on ? "Sound options" : "Sound options, muted");
    muteBtn.setAttribute("aria-checked", String(!on));
    muteText.innerHTML = on ? "Mute All<br>Sounds" : "Unmute<br>Sounds";
  }
  muteBtn.addEventListener("click", () => {
    GameSound.unlock();
    setSound(!state.sound);
    if (state.sound) sfx("tap");
    closeSoundMenu({ refocus: true });
  });

  document.addEventListener("pointerdown", () => { GameSound.unlock(); GameVoice.unlock(); });
  game.addEventListener("pointerdown", onInteraction, true);

  document.addEventListener("keydown", event => {
    onInteraction(event);
    if (event.key === "Escape") {
      event.preventDefault();
      if (!soundMenu.hidden) { closeSoundMenu({ refocus: true }); return; }
      if (state.scene !== "title") actor.send({ type: "PAUSE" });
      return;
    }
    if (overlayMode() !== "none") { trapFocus(event); return; }
    if (event.ctrlKey || event.metaKey || event.altKey || !/^[0-9]$/.test(event.key)) return;
    const n = Number(event.key);
    if (state.scene === "calibrate") { if (n <= 4) setDial(n); return; }
    if (n < 1 || n > 3) return;
    const choices = $$("[data-key-choice]", sceneEl()).filter(b => !b.disabled && !b.hidden && b.offsetParent);
    const target = choices[n - 1];
    if (target) { target.focus({ preventScroll: true }); target.click(); }
  });

  /* Subtle depth: background and Meera drift with the pointer. */
  if (!GameFX.reduced) {
    const bgX = gsap.quickTo(bgWrap, "x", { duration: 1.4, ease: "power3" });
    const bgY = gsap.quickTo(bgWrap, "y", { duration: 1.4, ease: "power3" });
    const heroX = gsap.quickTo(heroParallax, "x", { duration: 1.1, ease: "power3" });
    game.addEventListener("pointermove", event => {
      const g = game.getBoundingClientRect();
      const nx = (event.clientX - g.left) / g.width - 0.5, ny = (event.clientY - g.top) / g.height - 0.5;
      bgX(-nx * 22); bgY(-ny * 12); heroX(nx * 10);
    });
    gsap.to(meera, { scaleY: 1.012, scaleX: 0.995, transformOrigin: "50% 100%", duration: 2.4, yoyo: true, repeat: -1, ease: "sine.inOut" });
  }

  /* ------------------------------------------------------------------
     Boot
     ------------------------------------------------------------------ */
  function boot() {
    fitGame();
    window.addEventListener("resize", fitGame);
    buildClues();
    buildHouseholds();
    prepareFixLab();
    resetFixLab();
    actor.subscribe(onSnapshot);
    actor.start();
    onSnapshot(actor.getSnapshot());
  }

  boot();
})();
