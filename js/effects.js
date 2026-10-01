/*
 * Shared GSAP setup: plugin registration, custom eases and reusable effects.
 * Loaded after the vendor GSAP files and before script.js.
 */
(function (root) {
  "use strict";

  const gsap = root.gsap;
  gsap.registerPlugin(
    root.Flip, root.Draggable, root.MotionPathPlugin, root.DrawSVGPlugin,
    root.SplitText, root.TextPlugin, root.ScrambleTextPlugin,
    root.CustomEase, root.CustomWiggle, root.Physics2DPlugin
  );

  const reduced = root.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* Reduced motion: every transition plays 3x faster. Story timelines
     (the fridge recording, the fix run) divide this back out so they stay readable. */
  const MOTION = reduced ? 3 : 1;
  gsap.globalTimeline.timeScale(MOTION);
  gsap.defaults({ ease: "power3.out", duration: 0.5 });

  root.CustomEase.create("softBounce", "M0,0 C0.14,0 0.24,1.1 0.44,1.1 0.58,1.1 0.64,0.96 0.74,0.96 0.84,0.96 0.9,1 1,1");
  root.CustomEase.create("snap", "M0,0 C0.2,0 0.1,1.18 0.5,1.06 0.72,1 0.8,1 1,1");
  root.CustomWiggle.create("shake", { wiggles: 6, type: "easeOut" });
  root.CustomWiggle.create("jiggle", { wiggles: 4, type: "uniform" });

  gsap.registerEffect({
    name: "popIn",
    defaults: { duration: 0.55, delay: 0 },
    effect: (targets, config) => gsap.fromTo(targets,
      { autoAlpha: 0, scale: 0.6, y: 18 },
      { autoAlpha: 1, scale: 1, y: 0, duration: config.duration, delay: config.delay, ease: "back.out(2)", stagger: 0.06, clearProps: "transform" })
  });

  gsap.registerEffect({
    name: "shake",
    defaults: { distance: 14 },
    effect: (targets, config) => gsap.fromTo(targets, { x: 0 }, { x: config.distance, duration: 0.55, ease: "shake", clearProps: "x" })
  });

  gsap.registerEffect({
    name: "nudge",
    defaults: {},
    effect: targets => gsap.fromTo(targets, { rotation: 0 }, { rotation: 4, duration: 0.6, ease: "jiggle", clearProps: "rotation" })
  });

  gsap.registerEffect({
    name: "pulse",
    defaults: { scale: 1.08, repeat: 1 },
    effect: (targets, config) => gsap.to(targets, { scale: config.scale, duration: 0.22, yoyo: true, repeat: config.repeat, ease: "sine.inOut" })
  });

  /*
   * Star burst with Physics2D. `layer` is an element inside the scaled game plane,
   * x/y are coordinates inside that plane.
   */
  function burst(layer, x, y, options = {}) {
    if (reduced || !layer) return;
    const count = options.count || 14;
    const colors = options.colors || ["#ffd53f", "#43c52f", "#29afde", "#ff6b22", "#a36bff"];
    for (let i = 0; i < count; i++) {
      const star = document.createElement("i");
      star.className = "fx-star";
      star.style.left = x + "px";
      star.style.top = y + "px";
      star.style.background = colors[i % colors.length];
      layer.appendChild(star);
      gsap.set(star, { xPercent: -50, yPercent: -50, scale: gsap.utils.random(0.5, 1.1), rotation: gsap.utils.random(0, 180) });
      gsap.to(star, {
        duration: gsap.utils.random(0.9, 1.4),
        physics2D: { velocity: gsap.utils.random(260, 520), angle: gsap.utils.random(200, 340), gravity: 900 },
        rotation: "+=" + gsap.utils.random(180, 540),
        autoAlpha: 0,
        ease: "none",
        onComplete: () => star.remove()
      });
    }
  }

  root.GameFX = { reduced, MOTION, burst };
})(window);
