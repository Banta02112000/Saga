/* Shared by the three tabs (Canon, Games, Doctor Who):
   - BantaShell.strip(current, go): the app switcher at the top of every screen
   - BantaAI: hand a prompt to the Gemini app by copy and paste, and read the answer back
   Plain ES2017, no dependencies. Each page passes its own native bridge calls in, so nothing here
   assumes which Android interface exists. */
(function () {
  "use strict";
  var A = function () { return window.Android || null; };
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); };

  // ---------------------------------------------------------------- shared files and messages between tabs
  // window.Banta is the native bridge every tab has; without it (tests, a browser) an in-memory stand-in is used.
  var B = function () { return window.Banta || null; };
  var mem = window.__bantaMem || {}, handlers = [], holds = {}; // __bantaMem: tests seed files without a phone
  var shared = {
    native: function () { return !!B(); },
    read: function (name) { try { return B() ? String(B().read(name) || "") : (mem[name] || ""); } catch (e) { return ""; } },
    readJson: function (name) { try { return JSON.parse(shared.read(name)); } catch (e) { return null; } },
    write: function (name, text) { try { if (B()) return !!B().write(name, String(text)); mem[name] = String(text); return true; } catch (e) { return false; } },
    remove: function (name) { try { if (B()) B().remove(name); else delete mem[name]; } catch (e) { /* nothing to remove */ } },
    post: function (app, msg) { try { if (B()) B().post(app, JSON.stringify(msg)); } catch (e) { /* not on Android */ } },
    stamp: function (name) { try { return B() && B().stamp ? String(B().stamp(name) || "") : String((mem[name] || "").length); } catch (e) { return ""; } },
    // several things can hold the background sync off at once (a running job, an open Gemini sheet)
    busy: function (on, key) {
      key = key || "sheet";
      if (on) holds[key] = 1; else delete holds[key];
      try { if (B() && B().busy) B().busy(Object.keys(holds).length > 0); } catch (e) { /* not on Android */ }
    },
    notify: function (id, title, text, tab) { try { if (B() && B().notify) B().notify(id, title, text, tab); } catch (e) { /* not on Android */ } },
    widget: function () { try { if (B() && B().widget) B().widget(); } catch (e) { /* not on Android */ } },
    onMessage: function (fn) { handlers.push(fn); },
  };
  // ---- features switched on or off in Canon › Settings (shared by all tabs; everything is on by default)
  var featCache = { st: null, f: {} };
  function features() {
    var st = shared.stamp("features.json");
    if (st !== featCache.st) { featCache = { st: st, f: shared.readJson("features.json") || {} }; }
    return featCache.f;
  }
  // everything is on unless switched off, except these, which start off
  var DEFAULT_OFF = { dw: 1, gemini: 1 };
  function feature(k) { var f = features(); return k in f ? f[k] !== 0 : !DEFAULT_OFF[k]; }
  function setFeature(k, on) { var f = Object.assign({}, features()); if (on === !DEFAULT_OFF[k]) delete f[k]; else f[k] = on ? 1 : 0; shared.write("features.json", JSON.stringify(f)); featCache.st = null; applyFeatures(); }
  function applyFeatures() {
    if (!document.body) return;
    ["gemini", "games", "dw", "books", "bookPrices", "vpn", "subs", "priceAlerts", "cross", "trakt"].forEach(function (k) { document.body.classList.toggle("nofeat-" + k, !feature(k)); });
    var nav = document.getElementById("bswitch");
    if (nav) {
      var shown = 0;
      nav.querySelectorAll("a[data-app]").forEach(function (a) { var app = a.getAttribute("data-app"), off = app !== "canon" && !feature(app) && !a.classList.contains("on"); a.hidden = off; if (!off) shown++; });
      nav.classList.toggle("solo", shown < 2);
      nav.classList.toggle("many", shown > 3);
    }
  }
  // ---- language: "en" or "it", stored with the features so every tab follows it
  function lang() { var l = features().lang; return l === "it" ? "it" : "en"; }
  function setLang(l) { var f = Object.assign({}, features()); if (l === "it") f.lang = "it"; else delete f.lang; shared.write("features.json", JSON.stringify(f)); featCache.st = null; if (window.BantaI18n) BantaI18n.apply(); }
  document.addEventListener("DOMContentLoaded", applyFeatures);
  document.addEventListener("visibilitychange", applyFeatures);

  function poll() {
    if (document.hidden || !B() || !handlers.length) return;
    var raw = "";
    try { raw = String(B().take() || ""); } catch (e) { return; }
    if (!raw) return;
    var msg; try { msg = JSON.parse(raw); } catch (e) { return; }
    handlers.forEach(function (fn) { try { fn(msg); } catch (e) { /* one handler failing doesn't stop the others */ } });
  }
  setInterval(poll, 700);
  document.addEventListener("visibilitychange", poll);
  window.addEventListener("focus", poll);

  // ---------------------------------------------------------------- strip
  var APPS = [
    ["canon", "Watch", '<path d="M4 5h3v14H4zM10 5h3v14h-3zM16 5h4v14h-4z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>'],
    ["games", "Games", '<path d="M7 7h10a5 5 0 0 1 4.9 4.1l.9 4.9a2.3 2.3 0 0 1-3.9 2L17 16H7l-1.9 2a2.3 2.3 0 0 1-3.9-2l.9-4.9A5 5 0 0 1 7 7z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>'],
    ["books", "Books", '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5zM4 20.5A2.5 2.5 0 0 0 6.5 23H20v-5" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"/>'],
    ["dw", "Doctor Who", '<path d="M8 3h8v3H8zM6 6h12v15H6zM9 9h2.5v3H9zM12.5 9H15v3h-2.5z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>'],
  ];

  function strip(current, go) {
    if (!document.body) { document.addEventListener("DOMContentLoaded", function () { strip(current, go); }); return; }
    if (document.getElementById("bswitch")) return;
    var nav = document.createElement("nav");
    nav.id = "bswitch";
    nav.setAttribute("aria-label", "Apps");
    nav.innerHTML = '<div class="seg">' + APPS.map(function (a) {
      var on = a[0] === current;
      return '<a href="#" data-app="' + a[0] + '" class="' + (on ? "on" : "") + '" aria-current="' + (on ? "page" : "false") + '">' +
        '<svg viewBox="0 0 24 24" aria-hidden="true">' + a[2] + "</svg>" + (a[0] === "dw" ? '<span class="long">' + a[1] + '</span><span class="short">Who</span>' : a[1]) + "</a>";
    }).join("") + '</div><button id="bsearch" type="button" aria-label="Search all tabs"><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg></button>';
    nav.addEventListener("click", function (e) {
      if (e.target.closest("#bsearch")) {
        // the search lives in the Canon tab; other tabs hand over to it
        if (current === "canon") document.dispatchEvent(new CustomEvent("banta-search"));
        else { shared.post("canon", { search: 1 }); try { go("canon"); } catch (x) { /* not on Android */ } }
        return;
      }
      var a = e.target.closest("a[data-app]");
      if (!a) return;
      e.preventDefault();
      if (a.classList.contains("on")) return;
      try { go(a.getAttribute("data-app")); } catch (x) { /* not on Android */ }
    });
    document.body.insertBefore(nav, document.body.firstChild);
    applyFeatures();
  }

  // ---------------------------------------------------------------- clipboard / links
  var io = {
    copy: function (t) {
      var a = A();
      try { if (a && a.copy) { a.copy(t); return true; } } catch (e) { /* fall through */ }
      try { navigator.clipboard.writeText(t); return true; } catch (e) { return false; }
    },
    open: function (u) {
      var a = A();
      try {
        if (a && a.openUrl) return a.openUrl(u);
        if (a && a.open) return a.open(u);
      } catch (e) { /* fall through */ }
      window.open(u, "_blank");
    },
    canPaste: function () { var a = A(); return !!(a && a.paste); },
    paste: function () { var a = A(); try { return a && a.paste ? String(a.paste() || "") : ""; } catch (e) { return ""; } },
  };
  var GEMINI_URL = "https://gemini.google.com/app";
  var CLAUDE_URL = "https://claude.ai/new";

  // ---------------------------------------------------------------- answer parsing
  // Finds JSON in a chat answer: a ```json block, a <json> block, or the outermost [ ] / { } in the text.
  function parseJson(raw) {
    var text = String(raw || "").trim();
    var tries = [];
    var m = text.match(/<json>([\s\S]*?)<\/json>/i);
    if (m) tries.push(m[1]);
    var re = /```(?:json|JSON)?\s*([\s\S]*?)```/g, b;
    while ((b = re.exec(text))) tries.push(b[1]);
    tries.push(text);
    for (var i = 0; i < tries.length; i++) {
      var s = tries[i].trim();
      try { return JSON.parse(s); } catch (e) { /* try the brackets */ }
      var pairs = [["[", "]"], ["{", "}"]];
      for (var p = 0; p < pairs.length; p++) {
        var a = s.indexOf(pairs[p][0]), z = s.lastIndexOf(pairs[p][1]);
        if (a >= 0 && z > a) {
          var cut = s.slice(a, z + 1);
          try { return JSON.parse(cut); } catch (e) {
            // chat apps sometimes turn quotes typographic or leave trailing commas
            try { return JSON.parse(cut.replace(/[“”]/g, '"').replace(/,\s*([\]}])/g, "$1")); } catch (e2) { /* next */ }
          }
        }
      }
    }
    return null;
  }

  // ---------------------------------------------------------------- sheets
  var open = null;
  function close() { if (open) { open.remove(); open = null; shared.busy(false); } document.removeEventListener("keydown", onKey); }
  function onKey(e) { if (e.key === "Escape" && open && open._cancel) open._cancel(); }
  function mount(html) {
    close();
    var scrim = document.createElement("div");
    scrim.className = "bai-scrim";
    scrim.innerHTML = '<div class="bai-sheet" role="dialog" aria-modal="true">' + html + "</div>";
    document.body.appendChild(scrim);
    document.addEventListener("keydown", onKey);
    open = scrim;
    shared.busy(true); // background sync holds off while this waits for an answer
    return scrim;
  }
  var ICON_COPY = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>';

  /* ask({title, prompt, note, warn, step, steps, expect:"json"|"text", validate(text)->msg|null})
     Resolves with the pasted answer. Rejects with {cancelled:true} when the person stops. */
  function ask(o) {
    o = o || {};
    var prompt = String(o.prompt || "");
    var expect = o.expect || "json";
    return new Promise(function (resolve, reject) {
      var s = mount(
        '<div class="bai-grab"></div>' +
        '<div class="bai-kicker">✦ Gemini app' + (o.steps > 1 ? " · prompt " + o.step + " of " + o.steps : "") + "</div>" +
        "<h2>" + esc(o.title || "Ask Gemini") + "</h2>" +
        (o.warn ? '<p class="bai-note warn">' + esc(o.warn) + "</p>" : "") +
        (o.note ? '<p class="bai-note">' + esc(o.note) + "</p>" : "") +
        '<ol class="bai-steps"><li><span>Tap <b>Copy prompt &amp; open Gemini</b>, start a new chat and paste it. Your Gemini Pro plan covers it.</span></li>' +
        "<li><span>When Gemini has finished, tap <b>Copy</b> under its answer" + (expect === "json" ? " (or on the code block)" : "") + ".</span></li>" +
        "<li><span>Come back here and paste it below.</span></li></ol>" +
        '<button class="bai-btn primary bai-wide" data-a="gem">' + ICON_COPY + "Copy prompt &amp; open Gemini</button>" +
        '<div class="bai-links"><button class="bai-btn quiet" data-a="copy">Copy only</button>' + (B() && B().shareTo ? '<button class="bai-btn quiet" data-a="send">Send straight to Gemini</button>' : "") + '<button class="bai-btn quiet" data-a="claude">Use Claude instead</button><button class="bai-btn quiet" data-a="show">See the prompt</button></div>' +
        '<textarea class="bai-prompt" readonly hidden></textarea>' +
        '<div class="bai-label"><span>Gemini’s answer</span>' + (io.canPaste() ? '<button class="bai-btn quiet" data-a="paste">Paste</button>' : "") + "</div>" +
        '<textarea class="bai-in" placeholder="Long-press here and paste Gemini’s answer" spellcheck="false" autocapitalize="off"></textarea>' +
        '<div class="bai-err" role="status"></div>' +
        '<div class="bai-actions"><button class="bai-btn" data-a="stop">' + esc(o.stopLabel || "Stop") + '</button><button class="bai-btn primary" data-a="ok">Import</button></div>' +
        '<div class="bai-meta">' + prompt.length.toLocaleString() + " characters" + (o.meta ? " · " + esc(o.meta) : "") + "</div>");
      var $ = function (q) { return s.querySelector(q); };
      var input = $(".bai-in"), err = $(".bai-err");
      s._cancel = function () { close(); reject(Object.assign(new Error("Stopped"), { cancelled: true })); };
      var check = function () {
        var v = input.value.trim();
        if (!v) return "Paste Gemini’s answer first.";
        if (o.validate) return o.validate(v);
        if (expect === "json" && parseJson(v) === null) return "That doesn’t contain the JSON the prompt asked for. Copy Gemini’s whole answer (or its code block) and paste it again.";
        return null;
      };
      input.addEventListener("input", function () { err.textContent = ""; err.className = "bai-err"; });
      s.addEventListener("click", function (e) {
        if (e.target === s) return; // tapping the dimmed area keeps the sheet: the pasted answer would be lost
        var b = e.target.closest("[data-a]");
        if (!b) return;
        var a = b.getAttribute("data-a");
        if (a === "gem" || a === "copy" || a === "claude") {
          var ok = io.copy(prompt);
          err.className = "bai-err bai-ok";
          err.textContent = ok ? "Prompt copied." : "Couldn’t copy automatically: open “See the prompt” and copy it from there.";
          if (a !== "copy") setTimeout(function () { io.open(a === "claude" ? CLAUDE_URL : GEMINI_URL); }, 350);
        } else if (a === "send") {
          io.copy(prompt); // still on the clipboard in case Gemini opens without the text
          var sent = false;
          try { sent = !!B().shareTo("com.google.android.apps.bard", prompt); } catch (x) { sent = false; }
          err.className = sent ? "bai-err bai-ok" : "bai-err";
          err.textContent = sent ? "Sent to Gemini. If the prompt isn’t there, paste it: it’s copied too." : (prompt.length > 120000 ? "This prompt is too long to hand over directly. Use Copy prompt & open Gemini." : "Couldn’t hand it to the Gemini app. Use Copy prompt & open Gemini.");
        } else if (a === "show") {
          var p = $(".bai-prompt");
          p.hidden = !p.hidden;
          if (!p.hidden) { p.value = prompt; p.focus(); p.select(); }
        } else if (a === "paste") {
          var v = io.paste();
          if (v) { input.value = v; err.textContent = ""; } else { err.className = "bai-err"; err.textContent = "The clipboard is empty."; }
        } else if (a === "stop") {
          s._cancel();
        } else if (a === "ok") {
          var msg = check();
          if (msg) { err.className = "bai-err"; err.textContent = msg; return; }
          var v2 = input.value.trim();
          close();
          resolve(v2);
        }
      });
    });
  }

  /* review({title, note, items:[{id, title, sub, tag, tagClass, checked}], ok}) → Promise<ids[]> (empty when cancelled) */
  function review(o) {
    return new Promise(function (resolve) {
      var items = o.items || [];
      var s = mount(
        '<div class="bai-grab"></div><div class="bai-kicker">✦ From Gemini</div><h2>' + esc(o.title || "Review") + "</h2>" +
        (o.note ? '<p class="bai-note">' + esc(o.note) + "</p>" : "") +
        (items.length ? '<div class="bai-list">' + items.map(function (it, i) {
          return '<label class="bai-item"><input type="checkbox" data-i="' + i + '"' + (it.checked === false || it.readonly ? "" : " checked") + (it.readonly ? " disabled hidden" : "") + '><span class="t">' +
            "<b>" + (it.tag ? '<span class="bai-tag ' + esc(it.tagClass || "") + '">' + esc(it.tag) + "</span>" : "") + esc(it.title) + "</b>" +
            (it.sub ? "<small>" + esc(it.sub) + "</small>" : "") + "</span></label>";
        }).join("") + "</div>" : '<p class="bai-note">' + esc(o.empty || "Nothing to change.") + "</p>") +
        '<div class="bai-actions"><button class="bai-btn" data-a="no">' + esc(o.cancel || "Cancel") + '</button><button class="bai-btn primary" data-a="ok">' + esc(items.some(function (i) { return !i.readonly; }) ? (o.ok || "Apply selected") : "Done") + "</button></div>");
      s._cancel = function () { close(); resolve([]); };
      s.addEventListener("click", function (e) {
        var b = e.target.closest("[data-a]");
        if (!b) return;
        if (b.getAttribute("data-a") === "no") return s._cancel();
        var ids = [];
        s.querySelectorAll("input[data-i]").forEach(function (c) { if (c.checked && !c.disabled) ids.push(items[+c.getAttribute("data-i")].id); });
        close();
        resolve(ids);
      });
    });
  }

  // Android back closes an open Gemini sheet first (stopping its step) before the page's own back handling.
  function cancel() { if (open && open._cancel) open._cancel(); else close(); }
  function hookBack() {
    ["__back", "onBack"].forEach(function (name) {
      var orig = window[name];
      if (typeof orig !== "function" || orig._bai) return;
      var wrapped = function () { if (open) { cancel(); return true; } return orig.apply(this, arguments); };
      wrapped._bai = true;
      window[name] = wrapped;
    });
  }
  document.addEventListener("DOMContentLoaded", hookBack);
  window.addEventListener("load", hookBack);

  window.BantaShell = { lang: lang, setLang: setLang, strip: strip, hookBack: hookBack, shared: shared, poll: poll, feature: feature, features: features, setFeature: setFeature, applyFeatures: applyFeatures };
  window.BantaAI = { ask: ask, review: review, parseJson: parseJson, copy: io.copy, open: io.open, close: close, cancel: cancel, isOpen: function () { return !!open; }, GEMINI_URL: GEMINI_URL };
})();
