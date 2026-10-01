/*
 * Asset preloader for the title-screen loading bar.
 *
 * Fetches every file in ASSET_MANIFEST (js/asset-manifest.js — byte sizes taken from the files on disk),
 * smallest first and five at a time, reading each body as a stream so the bar moves by real bytes.
 * Each finished image/audio file becomes a blob: URL, swapped onto the <img> elements that use it and
 * handed out through GameAssets.url(), so "loaded" means the bytes are already in memory.
 *
 * Images in hidden parts of the page are marked loading="lazy" in index.html, so the browser never
 * fetches them itself — the preloader fills them. The one eagerly visible image (the title cover art)
 * loads natively and is counted when its own load event fires, so nothing is downloaded twice.
 *
 * It never blocks the game: a failed, stalled (no bytes for STALL_MS), over-long or blocked transfer —
 * including file://, where fetch is not allowed — simply counts as done, and the asset keeps its file URL.
 */
(function (root) {
  "use strict";

  const MANIFEST = root.ASSET_MANIFEST || [];          // [[path, bytes], ...]
  const CONCURRENCY = 5, STALL_MS = 10000, MAX_MS = 60000;
  const MIME = { webp: "image/webp", svg: "image/svg+xml", png: "image/png", ogg: "audio/ogg", woff2: "font/woff2" };
  const SWAP = /\.(webp|svg|png|ogg)$/;
  const FONT = /chakra-petch-(\d+)\.woff2$/;              // registered from the fetched bytes (see loadFont)

  const expected = new Map(MANIFEST.map(([path, bytes]) => [path, Math.max(1, bytes)]));
  const loaded = new Map(MANIFEST.map(([path]) => [path, 0]));
  const blobs = new Map(), originals = new Map(), listeners = new Set(), settled = new Map();
  let shown = 0, ready = false, started = null;

  function progress() {
    let total = 0, done = 0;
    expected.forEach((bytes, path) => { total += bytes; done += Math.min(loaded.get(path), bytes); });
    shown = Math.max(shown, total ? done / total : 1);   // monotonic, even when Content-Length refines a size
    return shown;
  }
  /* Size the 1600 × 900 plane now so the title and bar are visible before the libraries load
     (script.js's fitGame takes over with the same formula once it runs). */
  const plane = document.getElementById("game");
  const fitPlane = () => { if (plane) plane.style.transform = `translate(-50%, -50%) scale(${Math.min(innerWidth / 1600, innerHeight / 900)})`; };
  fitPlane();
  addEventListener("resize", fitPlane);

  /* The bar is driven from here, so it moves from first paint, before the libraries have loaded. */
  const bar = { fill: document.getElementById("loaderFill"), pct: document.getElementById("loaderPct"), root: document.getElementById("titleLoader") };
  function paint(p) {
    const pct = Math.round(p * 100);
    if (bar.fill) bar.fill.style.transform = `scaleX(${p})`;
    if (bar.pct) bar.pct.textContent = `${pct}%`;
    if (bar.root) bar.root.setAttribute("aria-valuenow", String(pct));
  }
  let frame = 0;
  const emit = () => {
    if (frame) return;
    frame = requestAnimationFrame(() => { frame = 0; const p = progress(); paint(p); listeners.forEach(fn => fn(p)); });
  };

  function swapInDom(path, url) {
    document.querySelectorAll("img").forEach(img => { if (img.getAttribute("src") === path) img.src = url; });
  }

  /* An eagerly loading <img> already fetching this file: count its own load instead of fetching again. */
  function nativeImage(path) {
    return [...document.images].find(img => img.getAttribute("src") === path && img.loading !== "lazy");
  }
  function awaitNative(img, path) {
    return new Promise(resolve => {
      const finish = () => { clearTimeout(cap); loaded.set(path, expected.get(path)); emit(); resolve(); };
      const cap = setTimeout(finish, MAX_MS);
      if (img.complete) return finish();
      img.addEventListener("load", finish, { once: true });
      img.addEventListener("error", finish, { once: true });
    });
  }

  /* Fonts: the bytes become a FontFace; if the fetch failed (file://) the face loads from the file itself. */
  function loadFont(path, buffer) {
    const weight = path.match(FONT)[1];
    try {
      const face = new FontFace("Chakra Petch", buffer || `url("${path}") format("woff2")`, { weight, style: "normal", display: "swap" });
      document.fonts.add(face);
      if (!buffer) face.load().catch(() => {});
    } catch (_) { /* FontFace unsupported: text keeps the fallback font */ }
  }

  function load(path) {
    const job = transfer(path);
    settled.set(path, job);
    return job;
  }

  async function transfer(path) {
    const img = nativeImage(path);
    if (img) return awaitNative(img, path);
    let buffer = null;
    const ctrl = new AbortController();
    let stall = setTimeout(() => ctrl.abort(), STALL_MS);
    const cap = setTimeout(() => ctrl.abort(), MAX_MS);
    try {
      const res = await fetch(path, { signal: ctrl.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const length = Number(res.headers.get("Content-Length"));
      if (length > 0) expected.set(path, length);
      const chunks = [];
      if (res.body && res.body.getReader) {
        const reader = res.body.getReader();
        let got = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          got += value.byteLength;
          loaded.set(path, got);
          clearTimeout(stall);
          stall = setTimeout(() => ctrl.abort(), STALL_MS);
          emit();
        }
      } else {
        chunks.push(new Uint8Array(await res.arrayBuffer()));
      }
      if (FONT.test(path)) buffer = await new Blob(chunks).arrayBuffer();
      if (SWAP.test(path)) {
        const url = URL.createObjectURL(new Blob(chunks, { type: MIME[path.split(".").pop()] || "" }));
        blobs.set(path, url);
        originals.set(url, path);
        swapInDom(path, url);
      }
    } catch (_) {
      /* failed / aborted / blocked: counts as done, the element keeps its original src */
    } finally {
      if (FONT.test(path)) loadFont(path, buffer);
      clearTimeout(stall);
      clearTimeout(cap);
      loaded.set(path, expected.get(path));
      emit();
    }
  }

  function start() {
    if (started) return started;
    const queue = [...MANIFEST].sort((a, b) => a[1] - b[1]).map(([path]) => path);   // smallest first
    const worker = async () => { while (queue.length) await load(queue.shift()); };
    started = Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker)).then(() => {
      ready = true;
      shown = 1;
      document.querySelectorAll("img").forEach(img => { const url = blobs.get(img.getAttribute("src")); if (url) img.src = url; });
      paint(1);
      listeners.forEach(fn => fn(1));
    });
    return started;
  }

  /* An <img> whose blob: URL fails reverts once to the file it came from. */
  document.addEventListener("error", event => {
    const el = event.target;
    if (el && el.tagName === "IMG" && originals.has(el.src) && !el.dataset.fileFallback) {
      el.dataset.fileFallback = "1";
      el.src = originals.get(el.src);
    }
  }, true);

  /* CSS backgrounds can't fire `error`, so the blob is probed first and the file used if it fails.
     While the preloader is still fetching that file, the background waits for it (no second download). */
  function setBackground(el, path) {
    el.dataset.bg = path;
    if (!ready && expected.has(path)) {
      (settled.get(path) || started).then(() => { if (el.dataset.bg === path) applyBackground(el, path); });
      return;
    }
    applyBackground(el, path);
  }
  function applyBackground(el, path) {
    const url = blobs.get(path);
    el.style.backgroundImage = `url("${url || path}")`;
    if (!url) return;
    const probe = new Image();
    probe.onerror = () => { el.style.backgroundImage = `url("${path}")`; };
    probe.src = url;
  }

  start();

  root.GameAssets = {
    start,
    onProgress(fn) { listeners.add(fn); fn(ready ? 1 : progress()); return () => listeners.delete(fn); },
    isReady: () => ready,
    url: path => blobs.get(path) || path,
    setBackground
  };
})(window);
