/* Spoken landing page: language + theme toggles, screenshot swapping, scroll reveals,
   the pinned "how it works" phone, and the hero dot field. No dependencies. */
(() => {
  "use strict";
  const root = document.documentElement;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const store = {
    get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode: choice lasts this visit */ } },
  };

  /* ---------- English copy. Norwegian is the markup itself and is read back from the DOM. ---------- */
  const EN = {
    skip: "Skip to content",
    navLabel: "Sections",
    navHow: "How it works", navFeatures: "Features", navSafety: "Safety", navNav: "Nav grant",
    langHint: ": switch language to Norwegian",
    themeToLight: "Switch to light theme", themeToDark: "Switch to dark theme",
    ctaTryShort: "Try it now",
    eyebrow: "Phone calls for Deaf and hard-of-hearing people",
    h1a: "You type,", h1b: "we talk.",
    lede: "Spoken calls the doctor, the barber or the pizza place for you. You read the call live as text, and nothing is agreed until you say YES.",
    ctaTry: "Try it in your browser", ctaApp: "Get the app",
    heroFine: "Log in with your phone number and an SMS code. Spoken always says it is an AI.",
    altLive: "Spoken during a call with Løkka Pizza: what they say and what Spoken says appear as text bubbles, with a field at the bottom to type to Spoken.",
    whyTitle: "Why Spoken",
    why: "For most people a phone call is nothing. For Deaf people it is impossible. <em>Booking an appointment or asking the pharmacy something shouldn't take another person.</em>",
    howKicker: "How it works",
    howTitle: "Three steps, and you're in control of every one.",
    s1t: "Type what you need",
    s1p: "“Order a large pepperoni for pickup at 18:30, max 250 kr.” Use a shortcut or write freely. If something is missing, Spoken asks you first.",
    s2t: "See the plan, say YES",
    s2p: "Spoken shows who it will call, the goal, what it must check with you, and exactly how it opens the call. Nothing happens until you start it.",
    s3t: "Spoken calls. You read it live.",
    s3p: "What they say arrives as text while they speak. What you type, Spoken says out loud. Ask them to repeat, add something, or hang up.",
    s4t: "A price or a time? You decide.",
    s4p: "If they offer 239 kr and 18:40 instead of 18:30, Spoken asks them to hold and checks with you. You tap Accept or Decline. Spoken never says yes for you.",
    s5t: "The result, short and clear",
    s5p: "When they hang up you get what was agreed: what, price, time and name. You can read the whole call again afterwards.",
    altHome: "Spoken's home screen with shortcuts: Order a pizza, Book a doctor, Call mom and Book a haircut.",
    altPlan: "The plan before the call: Løkka Pizza, the goal, that price and pickup time need approval, and the opening line where Spoken says it is an AI assistant.",
    altLive2: "The call as text: Løkka Pizza answers, Spoken orders a large pepperoni for 18:30.",
    altApprove: "The approval card: 239 kr, ready 18:40, you asked for 18:30. Buttons Accept and Decline.",
    altDone: "The result: Order placed. Large pepperoni, 239 kr, pickup 18:40 at Løkka Pizza, name Ingrid.",
    demoNote: "Screens are from the demo call in the app. Løkka Pizza and Ingrid are made up.",
    featKicker: "Features",
    featTitle: "Built for the calls that actually happen.",
    featSub: "Queues, menus, people who talk fast. Spoken does the tedious part, you make the decisions.",
    f1t: "Live transcript", f1p: "What they say appears as text while they speak. What you type, Spoken says out loud.",
    f2t: "You approve", f2p: "Price, time and booking come to you as YES or NO. Spoken never commits you to anything on its own.",
    f3t: "Phone menus and queues", f3p: "Presses the right key, waits quietly through recorded messages and queues, and only speaks once a person answers.",
    f4t: "When they call back", f4p: "If they need to check and call back, Spoken takes the call and gives you the message as text.",
    f5t: "Three places at once", f5p: "Ask Spoken to check price and the first free slot at three places. The calls run in parallel, the answers land side by side.",
    f6t: "Norwegian and English", f6p: "Pick the language for the call. If they answer in another language, Spoken switches mid-call.",
    f7t: "Natural voices", f7p: "Choose the voice that speaks for you. It sounds like a calm person, not an answering machine.",
    f8t: "Follows your phone", f8p: "Larger Text, Reduce Motion, Increase Contrast and dark mode from your iPhone settings apply in Spoken too.",
    safeKicker: "Safety and privacy",
    safeTitle: "The first sentence is always: “I'm an AI.”",
    safeSub: "Whoever answers should know who they are talking to. And you should know what happens to the call.",
    r1t: "Says it's an AI", r1d: "“Hi! I'm an AI assistant calling on behalf of …” comes before anything else, on every call.",
    r2t: "No recordings", r2d: "The call is not recorded. Neither audio nor transcript is stored in the database, only a short summary.",
    r3t: "Data in the EU", r3d: "Profile, contacts and summaries live in a database in Ireland. Speech and AI run at ElevenLabs and OpenRouter, and the app's data overview says so.",
    r4t: "Never without your YES", r4d: "Price, time and booking are only accepted when you tap Accept. Your card number is never read out.",
    r5t: "Never calls emergency numbers", r5d: "110, 112 and 113 are blocked. If you need help, use the emergency text service for Deaf and hard-of-hearing people.",
    r6t: "Approved numbers only", r6d: "Calls are rate-limited, and real calls only go to approved numbers. That stops pranks and harassment.",
    navKicker: "For Deaf and hard-of-hearing people",
    navTitle: "Nav pays 2,000 kr towards apps you need because of a lasting impairment.",
    navP1: "The grant covers buying and subscribing to apps made to help with an impairment. You apply yourself, with a statement from a professional. Spoken is not approved by Nav yet. The conditions are on Nav's site.",
    navP2: "Nav's video interpreting service is open weekdays 08–20. Spoken takes the small calls, at nine on a Sunday evening too.",
    navLink: "Read about the grant on nav.no",
    getTitle: "Make your first call today.",
    getSub: "Spoken works in the browser on phone and computer. The apps are on their way.",
    iosSmall: "For iPhone", andSmall: "For Android", soon: "Coming soon",
    expoSmall: "Test now", expoB: "with Expo Go",
    expoNote: "Install Expo Go and scan the QR code you get from the team. That runs the mobile app before it reaches the stores.",
    footSay: "Built for Deaf people, useful for everyone.",
    footBuilt: "Built at", footContact: "Contact", footApp: "The app",
    footFine: "Spoken is not an emergency service.",
  };
  const NO = { themeToDark: "Bytt til mørkt tema" };
  const TITLES = { no: "Spoken: Du skriver, vi snakker.", en: "Spoken: You type, we talk." };

  // Snapshot the Norwegian strings once, so switching back is lossless.
  const textEls = [...document.querySelectorAll("[data-i18n]")];
  textEls.forEach((el) => { el._no = el.innerHTML; });
  const attrEls = [...document.querySelectorAll("[data-i18n-attr]")].map((el) => {
    const [attr, key] = el.dataset.i18nAttr.split(":");
    return { el, attr, key, no: el.getAttribute(attr) };
  });

  const lang = () => (root.dataset.lang === "en" ? "en" : "no");
  const theme = () => (root.dataset.theme === "light" ? "light" : "dark");

  function applyLang(l) {
    root.lang = l === "en" ? "en" : "nb";
    if (l === "en") root.dataset.lang = "en"; else delete root.dataset.lang;
    textEls.forEach((el) => { const k = el.dataset.i18n; el.innerHTML = l === "en" && EN[k] ? EN[k] : el._no; });
    attrEls.forEach(({ el, attr, key, no }) => {
      if (key.startsWith("themeTo")) return; // labelThemeBtn owns this one
      else el.setAttribute(attr, l === "en" && EN[key] ? EN[key] : no);
    });
    document.title = TITLES[l];
    splitWords();
    applyShots();
    labelThemeBtn();
  }

  function labelThemeBtn() {
    const btn = document.getElementById("themeBtn");
    const toLight = theme() === "dark";
    const label = lang() === "en" ? (toLight ? EN.themeToLight : EN.themeToDark) : (toLight ? "Bytt til lyst tema" : NO.themeToDark);
    btn.setAttribute("aria-label", label);
  }

  // Every app screenshot exists per language and theme: /shots/<no|en>-<dark|light>-<screen>.webp
  function applyShots() {
    const pre = `/shots/${lang()}-${theme()}-`;
    document.querySelectorAll("img[data-shot]").forEach((img) => {
      const src = `${pre}${img.dataset.shot}.webp`;
      if (img.getAttribute("src") !== src) img.setAttribute("src", src);
    });
  }

  function applyTheme(t, origin) {
    const swap = () => { root.dataset.theme = t; applyShots(); labelThemeBtn(); field.recolor(); };
    if (!document.startViewTransition || reduced.matches || !origin) return swap();
    const x = origin.left + origin.width / 2, y = origin.top + origin.height / 2;
    const r = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
    document.startViewTransition(swap).ready.then(() => {
      root.animate({ clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${r}px at ${x}px ${y}px)`] },
        { duration: 650, easing: "cubic-bezier(.2,.7,.2,1)", pseudoElement: "::view-transition-new(root)" });
    }).catch(() => {});
  }

  document.getElementById("langBtn").addEventListener("click", () => {
    const next = lang() === "en" ? "no" : "en";
    store.set("spoken-site-lang", next);
    const url = new URL(location.href);
    if (next === "en") url.searchParams.set("lang", "en"); else url.searchParams.delete("lang");
    history.replaceState(null, "", url);
    applyLang(next);
  });
  document.getElementById("themeBtn").addEventListener("click", (e) => {
    const next = theme() === "dark" ? "light" : "dark";
    store.set("spoken-site-theme", next);
    applyTheme(next, e.currentTarget.getBoundingClientRect());
  });

  /* ---------- nav background once the page moves ---------- */
  const nav = document.querySelector(".nav");
  const onScroll = () => nav.classList.toggle("scrolled", scrollY > 12);
  addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  /* ---------- reveals ---------- */
  const mark = (sel, cls, stagger = 0) => document.querySelectorAll(sel).forEach((el, i, all) => {
    el.classList.add(cls);
    if (stagger) {
      const sibs = [...el.parentElement.children].filter((c) => c.matches(sel));
      el.style.transitionDelay = `${sibs.indexOf(el) * stagger}ms`;
    }
  });
  mark(".sec-title, .get-title", "rv-mask");
  mark(".kicker, .sec-sub, .nav-copy p, .arrow-link, .demo-note, .amount, .get-copy .btn, .stores .fine", "rv");
  mark(".spec li", "rv", 70);
  mark(".receipt > div", "rv", 60);
  mark(".store", "rv", 80);
  const io = new IntersectionObserver((entries) => entries.forEach((e) => {
    if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
  }), { rootMargin: "0px 0px -12% 0px" });
  document.querySelectorAll(".rv, .rv-mask").forEach((el) => io.observe(el));

  /* ---------- statement: words light up as it scrolls through, like a line being transcribed ---------- */
  const say = document.querySelector(".big-say");
  let words = [];
  function splitWords() {
    // Wrap each word of text nodes in a span; keeps <em> structure intact.
    const walk = (node) => [...node.childNodes].forEach((n) => {
      if (n.nodeType === 3) {
        const frag = document.createDocumentFragment();
        n.textContent.split(/(\s+)/).forEach((part) => {
          if (!part) return;
          if (/^\s+$/.test(part)) frag.append(part);
          else { const s = document.createElement("span"); s.className = "w"; s.textContent = part; frag.append(s); }
        });
        n.replaceWith(frag);
      } else if (n.nodeType === 1) walk(n);
    });
    walk(say);
    words = [...say.querySelectorAll(".w")];
    lightWords();
  }
  function lightWords() {
    const r = say.getBoundingClientRect();
    const p = Math.min(1, Math.max(0, (innerHeight * 0.85 - r.top) / (r.height + innerHeight * 0.35)));
    const n = Math.round(p * words.length);
    words.forEach((w, i) => w.classList.toggle("lit", i < n));
  }
  let sayTick = false;
  addEventListener("scroll", () => {
    if (sayTick) return;
    sayTick = true;
    requestAnimationFrame(() => { sayTick = false; lightWords(); });
  }, { passive: true });

  /* ---------- how it works: the pinned phone follows the step in view ---------- */
  const steps = [...document.querySelectorAll(".step")];
  const layers = [...document.querySelectorAll(".pin .layer")];
  const ticks = [...document.querySelectorAll(".rail span")];
  function setStep(name) {
    steps.forEach((s) => s.classList.toggle("on", s.dataset.step === name));
    layers.forEach((l) => l.classList.toggle("on", l.dataset.shot === name));
    const idx = steps.findIndex((s) => s.dataset.step === name);
    ticks.forEach((t, i) => t.classList.toggle("on", i === idx));
  }
  const stepIO = new IntersectionObserver((entries) => entries.forEach((e) => {
    if (e.isIntersecting) setStep(e.target.dataset.step);
  }), { rootMargin: "-45% 0px -45% 0px" });
  steps.forEach((s) => stepIO.observe(s));
  setStep("home");
  // Warm the pinned screens once the section is near, so the swap never shows an empty frame.
  const warm = new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting)) { layers.forEach((l) => { l.loading = "eager"; }); warm.disconnect(); }
  }, { rootMargin: "100% 0px" });
  const how = document.getElementById("slik");
  if (how) warm.observe(how);

  /* ---------- hero dot field: a square-dot grid that ripples out from the phone like a voice ---------- */
  const field = (() => {
    const cv = document.getElementById("field");
    const hero = cv.parentElement;
    const ctx = cv.getContext("2d", { alpha: true });
    let w = 0, h = 0, dpr = 1, cols = 0, rows = 0, gap = 22, src = { x: 0, y: 0 }, color = "165,180,255", raf = 0, visible = true, t0 = performance.now();
    const seed = [];

    function recolor() {
      color = theme() === "light" ? "74,91,224" : "165,180,255";
      if (!raf) draw(performance.now());
    }
    function size() {
      const r = hero.getBoundingClientRect();
      dpr = Math.min(2, devicePixelRatio || 1);
      w = r.width; h = r.height;
      cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      gap = w < 700 ? 18 : 22;
      cols = Math.ceil(w / gap) + 1; rows = Math.ceil(h / gap) + 1;
      seed.length = 0;
      for (let i = 0; i < cols * rows; i++) seed.push(Math.random());
      const phone = hero.querySelector(".phone");
      const pr = phone.getBoundingClientRect();
      src = { x: pr.left - r.left + pr.width / 2, y: pr.top - r.top + pr.height * 0.42 };
    }
    function draw(now) {
      const t = (now - t0) / 1000;
      ctx.clearRect(0, 0, w, h);
      // A speech-like envelope: syllable bursts with pauses between phrases.
      const env = 0.35 + 0.65 * Math.abs(Math.sin(t * 1.7) * Math.sin(t * 0.63 + 1.1));
      const wide = w >= 980;
      for (let j = 0; j < rows; j++) {
        for (let i = 0; i < cols; i++) {
          const x = i * gap, y = j * gap;
          const d = Math.hypot(x - src.x, y - src.y);
          const ring = Math.max(0, Math.sin(d * 0.042 - t * 2.4));
          const wave = ring * ring * ring * env * Math.exp(-d / (wide ? 620 : 420));
          // keep the left (text) side quiet on wide screens, the top quiet on phones
          const guard = wide ? Math.min(1, Math.max(0, (x - w * 0.42) / (w * 0.2))) : Math.min(1, Math.max(0, (y - h * 0.55) / (h * 0.2)));
          const a = (0.07 + 0.6 * wave + 0.03 * seed[j * cols + i]) * (0.25 + 0.75 * guard);
          if (a < 0.03) continue;
          const s = 1.2 + 2.2 * wave;
          ctx.fillStyle = `rgba(${color},${a.toFixed(3)})`;
          ctx.fillRect(x - s / 2, y - s / 2, s, s);
        }
      }
    }
    function loop(now) { draw(now); raf = visible && !reduced.matches ? requestAnimationFrame(loop) : 0; }
    function start() { if (!raf && visible && !reduced.matches && !document.hidden) raf = requestAnimationFrame(loop); }
    function stop() { cancelAnimationFrame(raf); raf = 0; }

    new IntersectionObserver(([e]) => { visible = e.isIntersecting; visible ? start() : stop(); }).observe(hero);
    document.addEventListener("visibilitychange", () => (document.hidden ? stop() : start()));
    reduced.addEventListener("change", () => { stop(); start(); if (reduced.matches) draw(t0 + 1400); });
    let rt = 0;
    addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(() => { size(); if (!raf) draw(t0 + 1400); }, 120); });

    return { init() { size(); recolor(); reduced.matches ? draw(t0 + 1400) : start(); }, recolor };
  })();

  /* ---------- boot ---------- */
  if (lang() === "en") applyLang("en"); else { splitWords(); applyShots(); labelThemeBtn(); }
  requestAnimationFrame(() => {
    root.classList.add("ready");
    // the phone animates in; measure the ripple source after it settles
    field.init();
    setTimeout(() => { if (!reduced.matches) field.init(); }, 1700);
  });
})();
