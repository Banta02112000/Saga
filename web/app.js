/* CanonSync UI. Talks to the Android shell through window.Android (see Bridge.java). */
(function () {
  "use strict";
  const C = window.Core;
  const VERSION = "0.5.4.4";
  const AUTO_SYNC_HOURS = 12;
  const DEFAULT_PROFILE = "PKCE / Public Client (App 000001)";

  // ---- security: the page runs under a Content-Security-Policy (index.html), so no inline handlers anywhere.
  // Broken pictures are handled here: data-fb="rm" removes the picture, "ph" puts the initials placeholder in its place.
  const httpsUrl = u => String(u || "").replace(/^http:\/\//i, "https://");
  document.addEventListener("error", e => {
    const t = e.target;
    if (!t || t.tagName !== "IMG" || !t.dataset || !t.dataset.fb) return;
    if (t.dataset.broken && window.__imgBroken) window.__imgBroken(t.dataset.broken, t.src);
    if (t.dataset.fb === "ph") { const d = document.createElement("div"); d.className = t.dataset.fbc || "thumb ph"; d.setAttribute("aria-hidden", "true"); d.textContent = t.dataset.fbt || ""; t.replaceWith(d); }
    else t.remove();
  }, true);

  // ------------------------------------------------------------ native bridge
  const Native = (() => {
    const A = window.Android || null;
    const pending = new Map();
    let seq = 0;
    const settle = (id, fallback) => {
      const cb = pending.get(id);
      pending.delete(id);
      let r;
      try {
        let text;
        const n = A.takeLength ? A.takeLength(id) : -1;
        if (n > 4000000) { const parts = []; for (let i = 0; i < n; i += 4000000) parts.push(A.takePart(id, i, i + 4000000)); text = parts.join(""); }
        else text = A.take(id);
        r = JSON.parse(text);
      } catch (e) { r = fallback(e); }
      if (cb) cb(r);
    };
    window.__httpDone = id => settle(id, e => ({ status: 0, headers: {}, body: "", error: String(e) }));
    // a failed read must say so: an empty answer looks like "you picked nothing" and the import silently does nothing
    window.__pickDone = id => settle(id, e => [{ name: "the file", error: `couldn't read it (${String(e && e.message || e).slice(0, 120)}). If it's very large, try a smaller export` }]);
    window.__saveDone = id => settle(id, () => false);
    // Lets the person choose where to save a file. Resolves true when it was written.
    function saveAs(name, text) {
      if (A && A.saveAs) return new Promise(res => { const id = "s" + (++seq); pending.set(id, res); A.saveAs(id, name, text); });
      try { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text], { type: "application/json" })); a.download = name; a.click(); return Promise.resolve(true); } catch (e) { return Promise.resolve(false); }
    }

    async function http(method, url, opt = {}) {
      url = httpsUrl(url); // the app allows HTTPS only
      const headers = opt.headers || {}, body = opt.body || "";
      if (A) {
        return new Promise(res => {
          const id = "h" + (++seq);
          pending.set(id, res);
          A.http(id, method, url, Object.entries(headers).map(([k, v]) => `${k}: ${v}`).join("\n"), body);
        });
      }
      try {
        const r = await fetch(url, { method, headers, body: method === "GET" ? undefined : body });
        const h = {};
        for (const k of ["retry-after", "x-pagination-page-count", "content-type"]) if (r.headers.get(k)) h[k] = r.headers.get(k);
        return { status: r.status, headers: h, body: await r.text() };
      } catch (e) { return { status: 0, headers: {}, body: "", error: String(e) }; }
    }

    function pick(multiple, skip) {
      if (A) {
        return new Promise(res => {
          const id = "p" + (++seq);
          pending.set(id, res);
          if (skip && A.pickSkip) A.pickSkip(id, !!multiple, skip); else A.pick(id, !!multiple);
        });
      }
      return new Promise(res => {
        const inp = document.createElement("input");
        inp.type = "file";
        inp.multiple = !!multiple;
        inp.onchange = async () => {
          const out = [];
          for (const f of inp.files) out.push({ name: f.name, text: await f.text() });
          res(out);
        };
        inp.click();
      });
    }

    // Opens a page in a hidden in-app browser (real Chrome engine + your IMDb sign-in cookies) and returns
    // whatever the probe script evaluates to. Same callback channel as http.
    function browse(url, probe, timeoutMs) {
      if (!A || !A.browse) return Promise.resolve({ status: 0, value: null, error: "in-app browser unavailable" });
      return new Promise(res => {
        const id = "b" + (++seq);
        pending.set(id, res);
        A.browse(id, url, probe, timeoutMs || 35000);
      });
    }
    if (A && A.browse) http.browse = browse;

    const mem = {};
    return {
      native: !!A,
      http, pick, browse, saveAs,
      openInApp: u => (A && A.openInApp ? A.openInApp(u) : window.open(u, "_blank")),
      status: (title, text, pct, ongoing) => (A && A.status ? A.status(title, text, Math.round(pct), !!ongoing) : null),
      clearStatus: () => (A && A.clearStatus ? A.clearStatus() : null),
      notify: (id, title, text, tab) => (A && A.notify ? A.notify(id, title, text, tab || "home") : console.log("NOTIFY", title, text)),
      setBackground: (on, hours) => (A && A.setBackground ? A.setBackground(!!on, hours) : false),
      requestNotifications: () => (A && A.requestNotifications ? A.requestNotifications() : null),
      // a data file that can't be read as JSON falls back to yesterday's copy (kept by the phone as name.bak)
      load: n => {
        const t = A ? A.load(n) : (mem[n] || "");
        if (!A || !/\.json$/.test(n) || !t) return t;
        try { JSON.parse(t); return t; } catch (e) {
          const b = A.load(n + ".bak");
          try { JSON.parse(b); window.__recovered = (window.__recovered || []).concat(n); return b; } catch (e2) { return t; }
        }
      },
      save: (n, t) => (A ? A.save(n, t) : (mem[n] = t, true)),
      openUrl: u => (A ? A.openUrl(u) : window.open(u, "_blank")),
      copy: t => (A ? A.copy(t) : navigator.clipboard && navigator.clipboard.writeText(t)),
      sha256url: async s => {
        if (A) return A.sha256url(s);
        const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
        return btoa(String.fromCharCode(...d)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      },
      randomUrl: n => {
        if (A) return A.randomUrl(n);
        const b = crypto.getRandomValues(new Uint8Array(n));
        return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      },
    };
  })();
  window.__native = Native;

  // ------------------------------------------------------------ state
  const db = new C.Store({ load: () => Native.load("canonsync.json"), save: t => Native.save("canonsync.json", t),
                           stamp: () => (window.Android && Android.stamp ? Android.stamp("canonsync.json") : ""),
                           // keys and tokens: encrypted with the phone's Keystore when this Android build offers it
                           secrets: window.Android && Android.secretsLoad ? { load: () => Android.secretsLoad(), save: t => Android.secretsSave(t) } : null });
  // Personal defaults and keys come from preset.js; the shareable build ships that file empty.
  const OWN = window.CANONSYNC_PRESET || {};
  const defaults = Object.assign({
    profile: DEFAULT_PROFILE, client_id: C.PROFILES[DEFAULT_PROFILE].client_id,
    redirect: C.PROFILES[DEFAULT_PROFILE].redirect, gemini_model: "auto", threshold: "90", auto_sync: "1", claude_model: "auto", region: "IT", my_services: "Disney+, Netflix, Prime Video", vpn_countries: C.VPN_DEFAULT, claude_web: "1", home_calendar: "1", bg_enabled: "1", bg_hours: "12", bg_tv: "1",
  }, OWN.defaults || {});
  const PRESET = OWN.fill || {};
  for (const [k, v] of Object.entries(defaults)) if (!db.has(k)) db.settings[k] = v;
  // 1.0–1.3 saved Google's retired default; let the app pick a live model instead.
  if (/^gemini-2\.5-flash/.test(db.settings.gemini_model || "")) db.settings.gemini_model = "auto";
  if (!db.settings.preset_v1) {  // fill empty fields once; later edits (including clearing) stick
    for (const [k, v] of Object.entries(PRESET)) if (!db.get(k)) db.set(k, v);
    db.settings.preset_v1 = "1";
    db.touch();
  }

  const ui = {
    tab: "home", job: null, status: "", report: db.get("last_report", ""),
    missingQ: "", missingMed: "All", open: new Set(), missingView: "release", nextOnly: false,
    cmpView: "imdb", cmpQ: "", cmpLimit: 150, s0all: false,
  };
  let memo = null;
  const status = () => (memo = memo || C.canonStatus(db, threshold()));
  const invalidate = () => { memo = null; };
  const threshold = () => Math.max(0.7, Math.min(1, (parseFloat(db.get("threshold", "90")) || 90) / 100));

  // ------------------------------------------------------------ helpers
  const $ = s => document.querySelector(s);
  const esc = s => String(s === null || s === undefined ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const MED = { "Movie": ["movie", "Movie"], "TV Series": ["series", "Series"], "Special": ["special", "Special"], "Video Game": ["game", "Game"], "Episode": ["episode", "Episode"] };
  const medCls = m => (MED[m] || MED.Movie)[0];
  const medTag = m => `<span class="med ${medCls(m)}">${esc((MED[m] || [0, m || "?"])[1])}</span>`;
  const yr = y => (y ? ` (${y})` : "");
  const fmt = n => Number(n || 0).toLocaleString("en-US");
  const pct = f => `${Math.round(f * 100)}%`;

  const ICON = {
    undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
    home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>',
    stats: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    upcoming: '<rect x="3" y="4.5" width="18" height="16.5" rx="2"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4M7.5 14h3M7.5 17.5h6"/>',
    notcanon: '<circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8"/>',
    back: '<path d="M15 18l-6-6 6-6"/>',
    eyeoff: '<path d="M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.9 5.1A9.8 9.8 0 0 1 12 5c5 0 9 4.5 10 7-.4 1-1.2 2.3-2.4 3.5M6.3 6.3C4.3 7.6 2.7 9.6 2 12c1 2.5 5 7 10 7 1.6 0 3.1-.4 4.4-1.1"/>',
    eye: '<path d="M2 12c1-2.5 5-7 10-7s9 4.5 10 7c-1 2.5-5 7-10 7S3 14.5 2 12z"/><circle cx="12" cy="12" r="3"/>',
    spark: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M6 18l2.5-2.5M15.5 8.5L18 6"/>',
    missing: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3M8 11h6"/>',
    compare: '<path d="M7 4 3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    chev: '<path d="m9 6 6 6-6 6"/>',
    pad: '<path d="M7 7h10a5 5 0 0 1 4.9 4.1l.9 4.9a2.3 2.3 0 0 1-3.9 2L17 16H7l-1.9 2a2.3 2.3 0 0 1-3.9-2l.9-4.9A5 5 0 0 1 7 7z"/>',
    box: '<path d="M8 3h8v3H8zM6 6h12v15H6zM9 9h2.5v3H9zM12.5 9H15v3h-2.5z"/>',
    book: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5zM4 20.5A2.5 2.5 0 0 0 6.5 23H20v-5"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
    bell: '<path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.9 1.9 0 0 0 3.4 0"/>',
    open: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
    copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/>',
    sync: '<path d="M21 12a9 9 0 0 1-15.5 6.2L3 16M3 21v-5h5M3 12a9 9 0 0 1 15.5-6.2L21 8M21 3v5h-5"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    scan: '<path d="M4 7V5a1 1 0 0 1 1-1h2M17 4h2a1 1 0 0 1 1 1v2M20 17v2a1 1 0 0 1-1 1h-2M7 20H5a1 1 0 0 1-1-1v-2M7 8v8M10 8v8M13 8v8M16 8v8"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M14 6l4 4"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    library: '<rect x="3" y="4" width="18" height="14" rx="2"/><path d="m10 8.5 4.5 2.5-4.5 2.5zM7 21h10"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
    upload: '<path d="M12 15V3M7 8l5-5 5 5M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/>',
  };
  const icon = n => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[n]}</svg>`;

  let toastTimer = null;
  let undoFn = null;
  function toast(msg, undo) {
    const t = $("#toast");
    undoFn = typeof undo === "function" ? undo : null;
    t.textContent = msg;
    if (undoFn) { const b = document.createElement("button"); b.className = "undo"; b.dataset.action = "undo"; b.textContent = "Undo"; t.appendChild(b); }
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.classList.remove("show"); undoFn = null; }, undoFn ? 7000 : 3200);
  }
  // ---- look: theme, accent, text size (kept in this browser's storage so they apply before the first paint)
  const THEMES = [["night", "Night", "#0B0A10", "#F5F1E8"], ["amoled", "Black", "#000", "#F5F1E8"], ["slate", "Slate", "#10151C", "#EEF3F8"], ["sepia", "Sepia", "#1E1913", "#F3E9DA"], ["light", "Light", "#F5F2EC", "#1B1720"]];
  const ACCENTS = [["", "Each tab its own colour"], ["amber", "Amber"], ["teal", "Teal"], ["rose", "Rose"], ["violet", "Violet"], ["green", "Green"], ["blue", "Blue"]];
  const lsGet = k => { try { return localStorage.getItem(k) || ""; } catch (e) { return ""; } };
  function setLook(k, v) {
    try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch (e) { /* fine */ }
    const map = { saga_theme: "theme", saga_accent: "accent", saga_text: "text" }, de = document.documentElement;
    if (v && !(k === "saga_theme" && v === "night")) de.dataset[map[k]] = v; else delete de.dataset[map[k]];
    if (Native.native && window.Android && Android.setBars) try { Android.setBars(getComputedStyle(de).getPropertyValue("--night").trim() || "#0B0A10", de.dataset.theme === "light"); } catch (e) { /* older app */ }
  }
  // ---- what's new: shown once after an update (never on a fresh install)
  const CHANGES = [
    ["0.5.4.4", ["New icon.",
      "Up next no longer lists series whose remaining episodes aren't out yet, including ones with no date announced.",
      "Sync one entry at a time: films and series (details, IMDb and Trakt), games (Steam, date, store prices) and books (missing details, price). Check canon for one title with the AI, from your library or from the Missing tab.",
      "Next in your canon and the Up next widget skip titles that aren't out yet.",
      "API keys and sign-ins are now stored encrypted on the phone and left out of Android's own backup. Backup files can be locked with a password, and a restore can be undone.",
      "The app only talks over HTTPS and refuses scripts that didn't ship with it.",
      "Episode names you haven't watched are hidden (Settings › Data and about › Spoilers). A button on Home picks something from your watchlist.",
      "Settings search waits until you stop typing. TMDB credit added under About."]],
    ["0.5.4.3", ["Backup files you save or share no longer contain your Trakt sign-in or API keys (switch in Settings › Data and about). Restoring keeps the keys already on the phone.",
      "When IMDb and Trakt rate the same title differently, the newer rating wins instead of switching back and forth at every sync.",
      "Bringing lists into the library is much faster on big libraries.",
      "Links can no longer open inside the app's own window: they open in your browser."]],
    ["0.5.4.2", ["Versions now count up from 0.5 (pre-alpha); this is the release after 5.4.1.",
      "Titles that never updated: a re-sync now applies a new or changed rating and a watchlist title you've since watched (a rating you set in Saga is kept). Two titles with different IMDb ids are never merged any more.",
      "Your Trakt and IMDb lists can come into the library: Settings › Accounts and sync › Lists that go into the library. To-watch lists are on by default; lists for other people and game lists are not.",
      "Settings › Data and about › Why isn't a title showing? finds every record of a title and says what happened to it, with a button to bring it back.",
      "Live sync with AniList, MyAnimeList, Letterboxd and Goodreads (public profiles); Netflix viewing history import.",
      "Steam: the report now says how many games Steam returned; with a Web API key you get all of them.",
      "Themes: Night, Black, Slate, Sepia and Light, accent colours, larger text.",
      "Doctor Who: add your own entries, edit or hide existing ones.",
      "Games: prices from many stores (IsThereAnyDeal with a free key, or CheapShark).",
      "AI: ChatGPT (OpenAI), Mistral, Groq, OpenRouter and DeepSeek next to Gemini and Claude.",
      "Widgets show a real preview in the widget list; long-press the app icon for shortcuts."]],
    ["5.4.1", ["Episode ratings from Trakt and IMDb, and rating episodes in the app.", "Steam Web API key option.", "IMDb lists counted correctly."]],
    ["5.4", ["Undo, tags, Picked for you, calendar export, shareable canon lists, error log, daily copy of your data."]],
  ];
  function whatsNew(force) {
    const seen = db.get("seen_version", "");
    const fresh = !seen && !lib.all().length && !db.items(null, null).length;
    if (!force && (seen === VERSION || fresh)) { if (seen !== VERSION) db.set("seen_version", VERSION); return; }
    const idx = CHANGES.findIndex(c => c[0] === seen);
    const list = force ? CHANGES.slice(0, 3) : CHANGES.slice(0, idx < 0 ? 1 : Math.max(1, idx));
    db.set("seen_version", VERSION);
    sheet(`<div class="kicker">Saga ${esc(VERSION)} · pre-alpha</div><h3 style="font:800 28px/1.1 var(--display);margin:6px 0 12px">What's new</h3>
      ${list.map(([v, notes]) => `<h4 style="margin:14px 0 4px">${esc(v)}</h4><ul class="whatsnew">${notes.map(n => `<li>${esc(n)}</li>`).join("")}</ul>`).join("")}
      <button class="btn primary block" data-action="close" style="margin-top:14px">Got it</button>`, "whatsnew");
  }
  // ---- error log: what went wrong, kept on the phone, shown in Settings › Data and about
  const errLog = () => { try { return JSON.parse(localStorage.getItem("saga_errors") || "[]"); } catch (e) { return []; } };
  const where = () => { try { return ui.sec + (ui.sec === "watch" ? "/" + ui.tab : ""); } catch (e) { return ""; } };
  function logError(kind, msg) {
    try {
      const l = errLog(), text = String(msg || "").slice(0, 400), last = l[l.length - 1];
      if (last && last.m === text && last.k === kind) { last.n = (last.n || 1) + 1; last.at = Date.now(); }
      else l.push({ at: Date.now(), k: kind, m: text, v: VERSION, s: where() });
      localStorage.setItem("saga_errors", JSON.stringify(l.slice(-80)));
    } catch (e) { /* the log is optional */ }
  }
  window.addEventListener("error", e => logError("error", `${e.message} (${String(e.filename || "").split("/").pop()}:${e.lineno || 0})`));
  window.addEventListener("unhandledrejection", e => logError("error", (e.reason && (e.reason.stack || e.reason.message)) || e.reason));

  function setProgress(frac, text) {
    $("#jobfill").style.width = frac === null ? "0" : `${Math.round(Math.max(0, Math.min(1, frac)) * 100)}%`;
    if (text !== undefined) {
      ui.status = text;
      const el = $("#status");
      if (el) el.textContent = text;
    }
  }

  function commitFields() {
    document.querySelectorAll("[data-setting]").forEach(el => {
      const v = el.type === "checkbox" ? (el.checked ? "1" : "0") : el.value.trim();
      if (db.get(el.dataset.setting, null) !== v) db.set(el.dataset.setting, v);
    });
  }

  const QUIET_JOBS = new Set(["Gemini test", "Sign-in", "Import"]);
  async function runJob(name, fn) {
    if (ui.job) { toast(`${ui.job} is still running`); return; }
    commitFields();
    ui.job = name;
    BantaShell.shared.busy(true, "job");
    ui.jobStart = Date.now();
    C.CONFIG.cancelled = false;
    const notes = db.get("sync_notify", "1") === "1" && !QUIET_JOBS.has(name);
    let lastNote = 0, lastPct = -1, pct = 2, text = `${name}…`;
    const note = force => {
      if (!notes) return;
      const now = Date.now();
      if (!force && now - lastNote < 2000 && Math.abs(pct - lastPct) < 10) return;
      lastNote = now; lastPct = pct;
      Native.status(`${name} in progress`, text, pct, true);
    };
    // ticking elapsed time so a slow step never looks frozen
    const tick = setInterval(() => {
      const el = $("#status");
      if (el) el.textContent = `${ui.status} (${Math.round((Date.now() - ui.jobStart) / 1000)} s)`;
    }, 1000);
    $("#syncTop").classList.add("spin");
    setProgress(0.02, `${name}…`);
    note(true);
    render();
    let ok = true;
    try {
      const msg = await fn((f, t) => {
        setProgress(f, t);
        if (f !== null && f !== undefined) pct = Math.max(2, Math.min(99, Math.round(f * 100)));
        if (t) text = t;
        note(false);
      });
      ui.status = msg || `${name} finished`;
      toast(ui.status);
    } catch (e) {
      ok = false;
      logError("job", `${name} failed: ${e.message}`);
      ui.status = `${name} failed: ${e.message}`;
      toast(ui.status);
    } finally {
      clearInterval(tick);
      if (notes) Native.status(ok ? `${name} finished` : `${name} failed`, ui.status, -1, false);
      ui.job = null;
      BantaShell.shared.busy(false, "job");
      $("#syncTop").classList.remove("spin");
      setProgress(null);
      // the screen must come back even if saving or a cache refresh fails (otherwise every button stays greyed out)
      try { invalidate(); } catch (e) { /* rebuilt on next use */ }
      try { db.flush(); } catch (e) { toast(`Couldn't save: ${e.message}`); }
      render();
    }
  }

  // ------------------------------------------------------------ components
  function franchiseEntries(name) {
    return status().filter(c => c.franchise === name)
      .sort((a, b) => C.releaseKey(a).localeCompare(C.releaseKey(b)) || a.title.localeCompare(b.title));
  }

  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function when(c) {
    if (c.date) {
      const [y, m, d] = c.date.split("-");
      return d ? `${parseInt(d, 10)} ${MONTHS[parseInt(m, 10) - 1]} ${y}` : `${MONTHS[parseInt(m, 10) - 1]} ${y}`;
    }
    return c.year ? String(c.year) : "Date unknown";
  }

  function strip(name, opts = {}) {
    const all = franchiseEntries(name);
    const cap = opts.cap || 160;
    const cells = all.slice(0, cap).map(c =>
      `<i class="${medCls(c.medium)}${c.state === "seen" ? " on" : c.state === "listed" ? " ls" : ""}${opts.next && c.norm === opts.next.norm && c.year === opts.next.year ? " nx" : ""}" title="${esc(c.title + yr(c.year))}"></i>`).join("");
    const more = all.length > cap ? `<em>+${all.length - cap}</em>` : "";
    return `<div class="strip${opts.big ? " big" : ""}" aria-label="${all.filter(c => c.state === "seen").length} seen, ${all.filter(c => c.state === "listed").length} on your lists, ${all.length} total">${cells}${more}</div>`;
  }

  // ---- rows, posters, action sheet
  const IMG = "https://image.tmdb.org/t/p/";
  function initials(t) {
    const w = String(t || "?").replace(/^(the|a|an)\s+/i, "").split(/[\s:\-]+/).filter(x => /\w/.test(x));
    return ((w[0] || "?")[0] + (w[1] ? w[1][0] : "")).toUpperCase();
  }
  function thumb(c, big) {
    if (c.poster) return `<img class="thumb${big ? " big" : ""}" loading="lazy" src="${IMG}${big ? "w185" : "w92"}${esc(c.poster)}" alt="" data-fb="ph" data-fbc="thumb ph ${medCls(c.medium)}${big ? " big" : ""}" data-fbt="${esc(initials(c.title))}">`;
    return `<div class="thumb ph ${medCls(c.medium)}${big ? " big" : ""}" aria-hidden="true">${esc(initials(c.title))}</div>`;
  }
  const sheetItems = new Map();
  let sheetSeq = 0;
  const sid = (c, kind) => { const id = "s" + (++sheetSeq); sheetItems.set(id, Object.assign({ sheetKind: kind }, c)); return id; };

  // One list row: poster, title, two lines of detail, optional trailing control. Tap opens the action sheet.
  function row(c, kind, opts = {}) {
    const bits = c.kind === "episode" || c.kind === "next" ? { badge: "", line: "" } : infoBits(c);
    return `<div class="item" data-action="sheet" data-sid="${sid(c, kind)}">
      ${thumb(c)}
      <div class="grow body">
        <div class="ttl">${opts.tag ? `<span class="tag">${esc(opts.tag)}</span>` : ""}<b>${esc(opts.title || c.title)}</b></div>
        <div class="sub">${medTag(c.medium)}${opts.sub ? `<span class="muted ellipsis">${opts.sub}</span>` : ""}</div>
        ${bits.line || bits.badge ? `<div class="sub">${bits.badge}${bits.line ? `<span class="muted small ellipsis">${esc(bits.line)}</span>` : ""}</div>` : ""}
      </div>
      ${opts.trail || ""}
    </div>`;
  }
  // "Disney+ 4K" style badge and the release line for unreleased films, from cached details.
  const shortName = n => String(n).replace(/^Disney Plus$/i, "Disney+").replace(/^Amazon Prime Video$/i, "Prime Video").replace(/ with Ads$/i, " (ads)");
  function infoBits(c) {
    const inf = C.cachedInfo(db, c);
    if (!inf) return { badge: "", line: "" };
    const o = C.bestOffer(inf), v = o || !feat("vpn") ? null : C.bestVpn(inf, myServices());
    return { badge: o ? `<span class="pbadge">${esc(shortName(o.name))}${o.res ? ` ${o.res}` : ""}</span>`
                      : v ? `<span class="pbadge vpn" title="Not streaming in ${esc(inf.region)}; with a VPN">VPN ${v.flag} ${esc(shortName(v.name))}${v.res ? ` ${v.res}` : ""}</span>` : "",
             line: inf.unreleased && !inf.tv ? C.dateSummary(inf) : "" };
  }
  const seenBtn = c => `<button class="seen" data-action="seen" ${keyAttrs(c)} aria-label="Mark ${esc(c.title)} as seen">${icon("check")}</button>`;
  const hideBtn = c => `<button class="seen hidebtn" data-action="uphide" data-key="${esc(c.hideKey)}" data-label="${esc(c.kind === "canon" ? c.title : (c.show || c.franchise))}" aria-label="Hide from Upcoming">${icon("eyeoff")}</button>`;

  const cwRow = x => row(x, "up", { title: x.show, tag: x.fresh ? "New" : "",
    sub: `Next: S${x.s} E${x.e} · ${x.left} episode${x.left === 1 ? "" : "s"} to watch`, trail: hideBtn(x) });

  function openSheet(id) {
    const c = sheetItems.get(id);
    if (!c) return;
    const acts = [];
    acts.push(`<button class="sheetbtn" data-action="open" data-url="${esc(imdbUrl(c.kind === "episode" ? { imdb: c.imdb, title: c.show } : c))}">${icon("open")}Open on IMDb</button>`);
    if (c.sheetKind === "canon" || (c.sheetKind === "up" && c.kind === "canon")) {
      if (!c.have) acts.push(`<button class="sheetbtn" data-action="seen" ${keyAttrs(c)}>${icon("check")}Mark as seen</button>`);
      acts.push(`<button class="sheetbtn" data-action="canon1" ${keyAttrs(c)}>${icon("eye")}Check canon for this title (AI)</button>`);
      acts.push(`<button class="sheetbtn" data-action="notcanon" ${keyAttrs(c)}>${icon("notcanon")}Not canon (compilation, recap…)</button>`);
      if (c.franchise && c.franchise !== "Unsorted") acts.push(`<button class="sheetbtn" data-action="order" data-mv="${esc(c.franchise)}">${icon("list")}Watch order of ${esc(c.franchise)}</button>`);
      if (c.franchise) acts.push(`<button class="sheetbtn" data-action="hide" data-f="${esc(c.franchise)}">${icon("eyeoff")}Hide all of ${esc(c.franchise)}</button>`);
    }
    if (feat("trakt") && db.get("token") && c.medium !== "Video Game" && c.kind !== "episode" && c.kind !== "next" && c.title) {
      ui.sheetC = c;
      acts.splice(1, 0, `<button class="sheetbtn" data-action="trakt" data-k="history">${icon("check")}Mark watched on Trakt</button>`,
                        `<button class="sheetbtn" data-action="trakt" data-k="watchlist">${icon("list")}Add to Trakt watchlist</button>`);
    }
    if (c.sheetKind === "up") {
      acts.push(`<button class="sheetbtn" data-action="uphide" data-key="${esc(c.hideKey)}" data-label="${esc(c.kind === "canon" ? c.title : (c.show || c.franchise))}">${icon("eyeoff")}${c.kind === "canon" ? "Hide from Upcoming" : c.kind === "next" ? `Stop suggesting ${esc(c.show)}` : `Hide ${esc(c.show || c.franchise)} from Upcoming`}</button>`);
    }
    const detail = c.kind === "next" ? `Next to watch: S${c.s} E${c.e} · ${c.left} aired episode${c.left === 1 ? "" : "s"} you haven't seen` : c.kind === "episode" ? `S${c.s} E${c.e}${c.name && !/^episode \d+$/i.test(c.name) ? `, ${esc(c.name)}` : ""} · ${esc(C.fmtWhen(c))}`
      : [c.franchise + (c.sub ? ` · ${c.sub}` : ""), c.date || c.year ? when(c) : "", c.origin ? `from ${c.origin.split("+").map(o => ({ url: "your canon list", tmdb: "TMDB", gemini: "Gemini", claude: "Claude", ai: (C.AI_PRESETS[db.get("ai_preset", "openai")] || {}).label || "AI" })[o] || o).join(", ")}` : ""].filter(Boolean).map(esc).join(" · ");
    $("#overlay").innerHTML = `<div class="scrim bottom" data-action="dismiss"><div class="sheet" role="dialog" aria-modal="true">
      ${Kit.sheetHero({ title: c.kind === "episode" ? c.show : c.title, key: "canon:" + canonKey(c), img: cImg(c), kind: c.medium === "TV Series" ? "show" : c.medium === "Video Game" ? "game" : "movie" }, `<div class="small muted">${detail}</div>`)}
      <div id="details" class="details">${db.get("tmdb_key") ? `<p class="small muted">Loading details…</p>` : ""}</div>
      ${acts.join("")}</div></div>`;
    if (db.get("tmdb_key")) loadDetails(c);
  }

  const TYPE_LABEL = { flatrate: "Included", free: "Free", ads: "Free with ads", rent: "Rent", buy: "Buy" };
  const myServices = () => String(db.get("my_services", "Disney+, Netflix, Prime Video")).split(/[,;\n]+/).map(x => x.trim()).filter(Boolean);

  // Where else it streams: services you have first, then free ones, each with its countries and best picture quality.
  function worldHtml(inf) {
    if (!inf.world || !feat("vpn")) return "";
    const opts = C.vpnOptions(inf, myServices());
    const countries = C.worldCountries(inf.world).size;
    if (!opts.length) return `<h4>Worldwide</h4><p class="small muted">Not streaming in any other country yet.</p>`;
    const mine = opts.filter(s => s.pref < 10), rest = opts.filter(s => s.pref >= 10);
    const svc = s => `<div class="vsvc${s.pref < 10 ? " pref" : ""}"><div class="row"><b class="grow">${esc(shortName(s.name))}</b>
        <span class="small muted">${s.free ? "free" : "subscription"} · ${fmt(s.countries.length)} countr${s.countries.length === 1 ? "y" : "ies"}${s.here ? ` · also in ${esc(inf.region)}` : ""}</span></div>
        <div class="ccs">${s.countries.slice(0, 10).map(c => `<span class="cc" title="${esc(c.cc)}">${c.flag} ${esc(c.cc)}${c.res ? ` <i>${c.res}</i>` : ""}</span>`).join("")}${s.countries.length > 10 ? `<span class="cc more">+${s.countries.length - 10}</span>` : ""}</div></div>`;
    return `<h4>Worldwide with a VPN</h4>
      <p class="small muted" style="margin:0 0 6px">Streams in ${fmt(countries)} countr${countries === 1 ? "y" : "ies"}. Your services first (${esc(myServices().join(", "))}); picture quality shown where JustWatch has it.</p>
      ${mine.map(svc).join("")}
      ${rest.length ? `<details class="report"><summary>${fmt(rest.length)} other service${rest.length === 1 ? "" : "s"}</summary>${rest.slice(0, 25).map(svc).join("")}</details>` : ""}
      <p class="small muted" style="margin:6px 0 0">Watching another country's catalogue through a VPN can break a service's terms of use.</p>`;
  }
  async function loadDetails(c) {
    const target = c.kind === "episode" || c.kind === "next" ? { title: c.show, imdb: c.imdb, medium: "TV Series", tmdb: (c.hideKey || "").split("tv:")[1] || null }
      : { title: c.title, year: c.year, imdb: c.imdb, tmdb: c.tmdb, medium: c.medium };
    if (target.medium === "Video Game") { const el = $("#details"); if (el) el.innerHTML = ""; return; }
    let inf = null, err = null;
    try { inf = await C.titleInfo(db, Native.http, target); db.flush(); } catch (e) { err = e.message; }
    const el = $("#details");
    if (!el) return;
    if (!inf) { el.innerHTML = `<p class="small muted">${esc(err || "No details found on TMDB.")}</p>`; return; }
    const facts = [inf.runtime ? `${inf.runtime} min${inf.tv ? " per episode" : ""}` : "", inf.genres.slice(0, 3).join(", "), inf.cert ? `Rated ${inf.cert}` : "",
      inf.tv && inf.seasons ? `${inf.seasons} season${inf.seasons === 1 ? "" : "s"}, ${inf.episodes} episodes` : "", inf.tv ? inf.status : "", inf.networks.join(", ")].filter(Boolean);
    const scores = [inf.imdbScore ? `IMDb ${inf.imdbScore}` : "", inf.tmdbScore ? `TMDB ${inf.tmdbScore}` : "", inf.tomato ? `Rotten Tomatoes ${inf.tomato}%` : ""].filter(Boolean);
    const offers = inf.offers.length ? inf.offers.map(o => `<div class="offer${/disney|netflix|prime video/i.test(o.name) && (o.type === "flatrate" || o.type === "ads") ? " pref" : ""}">
        <span class="grow">${esc(shortName(o.name))}</span><span class="muted small">${TYPE_LABEL[o.type] || o.type}</span>${o.res ? `<span class="res">${o.res}</span>` : `<span class="res unk">?</span>`}</div>`).join("")
      : `<p class="small muted">Not available to stream in ${esc(inf.region)} yet.</p>`;
    const dates = inf.tv ? "" : `<div class="dates">
        ${inf.dates.cinema ? `<div><span class="muted">Cinema (${esc(inf.dates.region || inf.region)})</span><b>${esc(C.fmtWhen({ date: inf.dates.cinema }))}</b></div>` : ""}
        ${inf.dates.digital || inf.unreleased ? `<div><span class="muted">Digital/VOD${inf.dates.digitalRegion && inf.dates.digitalRegion !== inf.region ? ` (${esc(inf.dates.digitalRegion)})` : ""}</span><b>${inf.dates.digital ? esc(C.fmtWhen({ date: inf.dates.digital })) : "Not announced"}</b></div>` : ""}
        ${inf.original ? `<div><span class="muted">Original release</span><b>${esc(C.fmtWhen({ date: inf.original }))}</b></div>` : ""}
      </div>`;
    const sources = inf.sources.length > 1 ? `<details class="report"><summary>${inf.conflict ? "⚠ Sources disagree on the date" : "Dates from " + inf.sources.length + " sources"}</summary>
        <div class="small">${inf.sources.map(x => `<div class="row"><span class="grow muted">${esc(x.name)}</span><span>${esc(C.fmtWhen({ date: x.date }))}</span></div>`).join("")}</div></details>` : "";
    el.innerHTML = `
      ${dates}${sources}
      ${facts.length ? `<p class="small" style="margin:10px 0 0">${facts.map(esc).join(" · ")}</p>` : ""}
      ${scores.length ? `<p class="small muted" style="margin:4px 0 0">${scores.map(esc).join(" · ")}</p>` : ""}
      ${inf.crew.length ? `<p class="small muted" style="margin:4px 0 0">${inf.tv ? "Created by" : "Directed by"} ${esc(inf.crew.join(", "))}${inf.cast.length ? ` · With ${esc(inf.cast.slice(0, 3).join(", "))}` : ""}</p>` : ""}
      <h4>Where to watch in ${esc(inf.region)}</h4>${offers}
      ${inf.offers.length && inf.offers.every(o => !o.res) ? `<p class="small muted">Picture quality unavailable${inf.jwError ? " (JustWatch didn't respond)" : ""}.</p>` : ""}
      ${worldHtml(inf)}
      ${inf.overview ? `<details class="report"><summary>Synopsis (may contain spoilers)</summary><p class="small">${esc(inf.overview)}</p></details>` : ""}
      <p class="small muted" style="margin:8px 0 0">Streaming data: JustWatch via TMDB, every country.</p>`;
  }

  const imdbUrl = c => (c.imdb ? `https://www.imdb.com/title/${c.imdb}/` : `https://www.imdb.com/find/?q=${encodeURIComponent((c.title + " " + (c.year || "")).trim())}`);
  const keyAttrs = c => `data-title="${esc(c.title)}" data-year="${esc(c.year || "")}" data-medium="${esc(c.medium)}" data-imdb="${esc(c.imdb || "")}" data-franchise="${esc(c.franchise || "")}"`;

  function reportHtml(r) {
    if (!r) return "";
    return `<pre class="report">${r.split("\n").map(l => `<span class="${l.startsWith("FAIL") ? "fail" : l.startsWith("OK") ? "okl" : ""}">${esc(l)}</span>`).join("\n")}</pre>`;
  }

  // ------------------------------------------------------------ home
  function bars(rows, color, max) {
    const m = max || Math.max(1, ...rows.map(r => r[1]));
    return `<div class="bars">${rows.map(([label, v, shown]) => `
      <span class="ellipsis">${esc(label)}</span>
      <span class="track"><i style="width:${(v / m) * 100}%;background:${color}"></i></span>
      <span class="v">${esc(shown !== undefined ? shown : fmt(v))}</span>`).join("")}</div>`;
  }

  function renderStats() {
    const s = C.computeStats(db, status());
    if (!s.total) {
      return `<section class="next empty"><h1>No history yet</h1><p class="muted">Sync or import your IMDb and Trakt data and your stats appear here.</p>
        <button class="btn primary" data-action="tab" data-tab="home">Go to sync</button></section>`;
    }
    const color = m => `var(--${medCls(m)})`;
    const out = [`<section class="row"><span class="grow muted small">Where IMDb and Trakt disagree, your games ledger and the specials check.</span>
      <button class="btn" data-action="tab" data-tab="compare">${icon("compare")}Compare</button></section>`];
    out.push(`<section><h2>Library</h2><div class="bignum"><b>${fmt(s.total)}</b><span class="muted">titles consumed</span></div>
      <div class="bars">${["Movie", "TV Series", "Special", "Video Game", "Episode"].filter(m => s.by_medium.get(m)).map(m => {
        const mx = Math.max(...s.by_medium.values());
        return `<span>${esc(MED[m][1])}</span><span class="track"><i style="width:${(s.by_medium.get(m) / mx) * 100}%;background:${color(m)}"></i></span><span class="v">${fmt(s.by_medium.get(m))}</span>`;
      }).join("")}</div>
      ${s.runtime_known ? `<p class="small muted" style="margin:12px 0 0">About ${fmt(Math.round(s.movie_hours))} hours of movies and specials, from ${fmt(s.runtime_known)} titles with a known runtime.</p>` : ""}</section>`);
    if (s.rated_count) {
      out.push(`<section><h2>Ratings</h2><div class="bignum"><b>${s.avg_rating.toFixed(2)}</b><span class="muted">average over ${fmt(s.rated_count)} ratings${s.episodes_rated ? `, plus ${fmt(s.episodes_rated)} episodes` : ""}</span></div>
        ${bars([10, 9, 8, 7, 6, 5, 4, 3, 2, 1].map(n => [String(n), s.rating_hist.get(n) || 0]), "var(--movie)")}</section>`);
    }
    const am = Object.entries(s.avg_by_medium);
    if (am.length) {
      out.push(`<section><h2>Average rating by type</h2><div class="bars">${am.map(([m, [a]]) =>
        `<span>${esc(MED[m][1])}</span><span class="track"><i style="width:${a * 10}%;background:${color(m)}"></i></span><span class="v">${a.toFixed(1)}</span>`).join("")}</div></section>`);
    }
    if (s.ratings_per_year.length) out.push(`<section><h2>Ratings per year</h2>${bars(s.ratings_per_year, "var(--series)")}</section>`);
    if (s.decades.size) {
      const ds = [...s.decades.entries()].sort((a, b) => a[0] - b[0]);
      const mx = Math.max(...ds.map(d => d[1]));
      out.push(`<section><h2>Release decades</h2><div class="decades">${ds.map(([d, n]) =>
        `<div><span>${fmt(n)}</span><i style="height:${(n / mx) * 100}%"></i><span>${String(d).slice(2)}s</span></div>`).join("")}</div></section>`);
    }
    if (s.genres.length) out.push(`<section><h2>Top genres</h2>${bars(s.genres, "var(--special)")}<p class="small muted" style="margin:10px 0 0">From IMDb exports and lists; Trakt doesn't send genres.</p></section>`);
    const fr = s.franchises.filter(f => f.total >= 2);
    if (fr.length) {
      const row = f => `<li><div class="row"><b class="grow ellipsis">${esc(f.name)}</b><span class="muted small">${f.have} of ${f.total}</span></div>${strip(f.name, { cap: 80 })}</li>`;
      const closest = fr.filter(f => f.pct < 1).sort((a, b) => b.pct - a.pct || b.total - a.total).slice(0, 6);
      const gaps = fr.slice().sort((a, b) => (b.total - b.have) - (a.total - a.have)).slice(0, 6);
      if (closest.length) out.push(`<section><h2>Closest to complete</h2><ul class="plain">${closest.map(row).join("")}</ul></section>`);
      out.push(`<section><h2>Biggest gaps</h2><ul class="plain">${gaps.map(row).join("")}</ul></section>`);
    }
    const o = s.overlap;
    out.push(`<section><h2>IMDb and Trakt overlap</h2>${bars([["On both", o.both], ["IMDb only", o.imdb_only], ["Trakt only", o.trakt_only]], "var(--game)")}</section>`);
    if (s.lists.length) out.push(`<section><h2>Biggest lists</h2>${bars(s.lists.map(([k, n]) => { const [src, name] = k.split("|"); return [`${name} (${src === "imdb" ? "IMDb" : "Trakt"})`, n]; }), "var(--episode)")}</section>`);
    if (s.top_rated.length) out.push(`<section><h2>Top rated</h2><ul class="plain">${s.top_rated.map(r =>
      `<li class="row"><b style="font:800 18px/1 var(--display);color:var(--movie);width:28px">${r.rating}</b><span class="grow">${esc(r.title)}${esc(yr(r.year))}</span>${medTag(r.medium)}</li>`).join("")}</ul></section>`);
    return out.join("");
  }

  // ------------------------------------------------------------ missing
  function missingGroups() {
    const q = ui.missingQ.toLowerCase(), mf = ui.missingMed;
    const groups = new Map();
    for (const r of status()) {
      if ((r.have && !(ui.showListed && r.state === "listed")) || (mf !== "All" && r.medium !== mf)) continue;
      if (q && !r.title.toLowerCase().includes(q) && !r.franchise.toLowerCase().includes(q)) continue;
      if (!groups.has(r.franchise)) groups.set(r.franchise, []);
      groups.get(r.franchise).push(r);
    }
    return [...groups.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
  }

  function renderMissingList() {
    const groups = missingGroups();
    const prog = new Map(C.franchiseProgress(status()).map(f => [f.name, f]));
    const total = groups.reduce((n, g) => n + g[1].length, 0);
    if (!status().length) {
      return `<p class="muted">No canon yet. Run the Claude or TMDB scan above.</p>`;
    }
    if (!groups.length) return `<p class="muted">${ui.missingQ || ui.missingMed !== "All" ? "Nothing matches this filter." : "Nothing missing. Every canon entry is seen or excluded."}</p>`;
    return `<p class="small muted" style="margin:0 0 4px">${fmt(total)} missing across ${fmt(groups.length)} multiverses and franchises</p>` + groups.map(([f, items]) => {
      const p = prog.get(f) || { have: 0, total: items.length };
      const open = ui.open.has(f) || !!ui.missingQ.trim();
      items.sort((a, b) => (a.year || 9999) - (b.year || 9999) || a.title.localeCompare(b.title));
      return `<div class="fr">
        <button class="head" data-action="toggle" data-f="${esc(f)}" aria-expanded="${open}">
          <div class="row"><h3 class="grow">${esc(f)}</h3><span class="count">${p.have}/${p.total}</span></div>
          ${strip(f, { cap: 120 })}
        </button>
        ${open ? `<div class="frbody">${items.map(c => row(c, "canon", { sub: esc(when(c)) + (c.sub ? ` · ${esc(c.sub)}` : ""), trail: seenBtn(c) })).join("")}
          <div class="row" style="justify-content:flex-end;margin-top:6px"><button class="btn quiet small" data-action="hide" data-f="${esc(f)}">Hide this franchise</button></div>
        </div>` : ""}
      </div>`;
    }).join("");
  }

  function releaseRows(rows) {
    const q = ui.missingQ.toLowerCase(), mf = ui.missingMed;
    return rows.filter(r => (mf === "All" || r.medium === mf) && (!ui.nextOnly || r.upNext) &&
      (!q || r.title.toLowerCase().includes(q) || r.franchise.toLowerCase().includes(q)));
  }

  function releaseItem(c) {
    return row(c, "canon", { tag: c.upNext ? "Up next" : c.state === "listed" ? "On your list" : "", sub: `${esc(when(c))} · ${esc(c.franchise)}${c.sub ? ` · ${esc(c.sub)}` : ""}`, trail: seenBtn(c) });
  }

  // With "Include my lists" on, titles on your lists are shown too (tagged), since they're canon you still have to watch.
  function withListed(rel) {
    if (!ui.showListed) return rel;
    const today = new Date().toISOString().slice(0, 10), year = +today.slice(0, 4);
    const listed = status().filter(c => c.state === "listed");
    const fut = c => (c.date ? c.date > today : (c.year || 0) > year);
    const add = (arr, rows) => arr.concat(rows).sort((a, b) => C.releaseKey(a).localeCompare(C.releaseKey(b)) || a.title.localeCompare(b.title));
    return { released: add(rel.released, listed.filter(c => !fut(c))), upcoming: add(rel.upcoming, listed.filter(fut)) };
  }

  function renderReleaseList() {
    if (!status().length) return `<p class="muted">No canon yet. Run the Gemini or TMDB scan above.</p>`;
    const { released, upcoming } = withListed(C.releaseList(status()));
    const rel = releaseRows(released), up = releaseRows(upcoming);
    if (!rel.length && !up.length) return `<p class="muted">${ui.missingQ || ui.missingMed !== "All" || ui.nextOnly ? "Nothing matches this filter." : "Nothing missing. Every canon entry is seen or on one of your lists."}</p>`;
    const cap = ui.relLimit || 300;
    let out = `<p class="small muted" style="margin:0 0 4px">${fmt(rel.length)} released${up.length ? `, ${fmt(up.length)} upcoming` : ""}.${ui.showListed ? "" : " Titles on your lists are hidden; turn on Include my lists to see them."}</p>`;
    let lastYear = null;
    for (const c of rel.slice(0, cap)) {
      const y = c.date ? c.date.slice(0, 4) : (c.year ? String(c.year) : "Unknown year");
      if (y !== lastYear) { out += `<h3 class="yearhead">${esc(y)}</h3>`; lastYear = y; }
      out += releaseItem(c);
    }
    if (rel.length > cap) out += `<button class="btn block" data-action="relmore" style="margin:10px 0">Show ${fmt(Math.min(300, rel.length - cap))} more</button>`;
    if (up.length) out += `<h3 class="yearhead upcoming">Upcoming</h3>` + up.map(releaseItem).join("");
    return out;
  }

  const listHtml = () => (ui.missingView === "release" ? renderReleaseList() : renderMissingList());

  function scanLine(origin, label) {
    const g = C.aiState(db, origin);
    if (!g.pool.length || !g.sent.size) return "";
    return `<div class="row small muted" style="margin-top:6px"><span class="grow">${label} has checked ${fmt(g.sent.size)} of ${fmt(g.pool.length)} titles${g.pending.length ? ". Run it again to continue." : "."}</span>
      <button class="btn quiet small" data-action="aireset" data-origin="${origin}" data-label="${label}" ${ui.job ? "disabled" : ""}>Start over</button></div>`;
  }

  // Copy-and-paste tools that run on the person's own Gemini app (Gemini Pro), no API key needed.
  function gappSection() {
    const st = status(), missing = st.filter(c => !c.have), checked = gappChecked();
    const unchecked = missing.filter(c => !checked.has(gappKey(c)));
    const news = C.newsBatches(st), mv = mvState();
    const mvTool = (k, n, title, sub) => `<button class="tool" data-action="mv" data-k="${k}" data-via="app" ${ui.job ? "disabled" : ""}>
        <span class="tool-ic"><b>${n}</b></span><span class="grow"><b>${title}</b><small>${sub}</small></span>${icon("chev")}</button>`;
    const tool = (k, ic, title, sub) => `<button class="tool" data-action="gapp" data-k="${k}" ${ui.job ? "disabled" : ""}>
        <span class="tool-ic">${icon(ic)}</span><span class="grow"><b>${title}</b><small>${sub}</small></span>${icon("chev")}</button>`;
    return `<section>
        <div class="sechead"><h2 style="margin:0">${icon("spark")} Gemini app</h2><span class="pbadge">Copy &amp; paste</span></div>
        <p class="small muted" style="margin-top:0">For when the API key won't work, or for a deeper check: Saga writes the prompt, you paste it into the Gemini app (your Gemini Pro plan, with Google Search), then paste the answer back here.</p>
        <div class="tools">
          ${mvTool("group", "1", "Group into multiverses", mv.pending ? `${fmt(mv.pending)} titles to group · about ${fmt(Math.ceil(mv.pending / 200))} prompt${Math.ceil(mv.pending / 200) === 1 ? "" : "s"}` : "Every title is grouped")}
          ${mvTool("expand", "2", "Find entries per multiverse", mv.mvs.length ? (mv.stale.length ? `${fmt(mv.stale.length)} multiverses to search` : "All searched in the last 30 days") : "Do step 1 first")}
          ${tool("verify", "check", "Verify the missing list", unchecked.length ? `${fmt(unchecked.length)} entries not checked yet: flags non-canon and duplicates, fixes release dates` : `All ${fmt(missing.length)} entries checked`)}
          ${tool("news", "bell", "New announcements", news.length ? `${fmt(news.reduce((n, b) => n + b.length, 0))} multiverses you've started · ${fmt(news.length)} prompt${news.length === 1 ? "" : "s"}` : "Start a franchise first")}
        </div>
      </section>`;
  }
  const gappKey = c => `${c.franchise}|${c.norm}|${c.year || ""}`;
  function gappChecked() { try { return new Set(JSON.parse(db.get("gapp_verified", "[]"))); } catch (e) { return new Set(); } }
  // answers come back as "a | b | c" lines (or JSON from older prompts); anything else is asked for again
  const gappValid = v => (/\|/.test(v) || /^\s*(NONE|END|OK)\s*$/m.test(v) || BantaAI.parseJson(v) !== null) ? null
    : "That doesn’t look like the answer the prompt asked for (lines with | between the parts). Copy Gemini’s whole answer and paste it again.";
  const gappAsk = (prompt, o) => BantaAI.ask(Object.assign({ prompt, expect: "text", validate: gappValid }, o));
  const isCancel = e => e && e.cancelled;

  async function gappVerify(p) {
    const checked = gappChecked();
    const batches = C.franchiseBatches(status().filter(c => !c.have && !checked.has(gappKey(c))), 90);
    if (!batches.length) return "Every missing entry has been checked. Start over from Settings › Gemini to check again.";
    let marked = 0, dated = 0, done = 0;
    for (let b = 0; b < batches.length; b++) {
      const rows = batches[b];
      p(b / batches.length, `Gemini app: checking ${fmt(rows.length)} entries (${b + 1}/${batches.length})`);
      let text;
      try {
        text = await gappAsk(C.verifyPrompt(rows), { title: "Verify the missing list", step: b + 1, steps: batches.length,
          note: `${[...new Set(rows.map(r => r.franchise))].slice(0, 6).join(", ")}${new Set(rows.map(r => r.franchise)).size > 6 ? "…" : ""}` });
      } catch (e) { if (isCancel(e)) break; throw e; }
      const res = C.parseVerify(text, rows);
      const items = [];
      for (const r of res) {
        const c = r.c, sub = [c.franchise, c.year, r.why].filter(Boolean).join(" · ");
        if (r.verdict === "not_canon" || r.verdict === "duplicate" || r.verdict === "not_real") {
          const tag = { not_canon: "Not canon", duplicate: `Duplicate${r.same && rows[r.same - 1] ? " of " + rows[r.same - 1].title : ""}`, not_real: "Not found" }[r.verdict];
          items.push({ id: "nc:" + res.indexOf(r), title: c.title, sub: `${sub} → hide from the missing list`, tag, tagClass: "bad" });
        } else if (r.date && r.date !== c.date) {
          items.push({ id: "dt:" + res.indexOf(r), title: c.title, sub: `${c.franchise} · release date ${c.date ? c.date + " → " : ""}${r.date}`, tag: "Date", tagClass: "new" });
        }
      }
      const ids = await BantaAI.review({ title: items.length ? `${items.length} suggested change${items.length === 1 ? "" : "s"}` : "All good",
        note: `Gemini checked ${fmt(res.length)} of ${fmt(rows.length)} entries.${res.length < rows.length ? " The rest stay unchecked and come back next time." : ""}`,
        empty: "Nothing to change in this batch.", items, ok: "Apply", cancel: b < batches.length - 1 ? "Skip" : "Close" });
      for (const id of ids) {
        const r = res[parseInt(id.slice(3), 10)];
        if (id.startsWith("nc:")) { db.setNotCanon(r.c, true); marked++; }
        else dated += db.setCanonDates([{ franchise: r.c.franchise, title: r.c.title, year: r.c.year, date: r.date }]);
      }
      for (const r of res) checked.add(gappKey(r.c));
      done += res.length;
      db.set("gapp_verified", JSON.stringify([...checked]));
      invalidate(); db.flush();
    }
    return `Gemini app checked ${fmt(done)} entries: ${fmt(marked)} hidden as not canon, ${fmt(dated)} dates corrected`;
  }

  async function gappNews(p) {
    const st = status(), batches = C.newsBatches(st);
    if (!batches.length) return "Mark something seen or add it to a list first, so Saga knows which franchises you follow.";
    const known = new Set(st.map(c => `${C.norm(c.franchise)}|${c.norm}`));
    let added = 0;
    for (let b = 0; b < batches.length; b++) {
      p(b / batches.length, `Gemini app: new announcements (${b + 1}/${batches.length})`);
      let text;
      try {
        text = await gappAsk(C.newsPrompt(batches[b], new Date().toISOString().slice(0, 10)), { title: "New announcements", step: b + 1, steps: batches.length,
          note: batches[b].map(x => x[0]).slice(0, 6).join(", ") + (batches[b].length > 6 ? `… (${batches[b].length} franchises)` : "") });
      } catch (e) { if (isCancel(e)) break; throw e; }
      const rows = C.parseCanonRows(text).filter(r => !known.has(`${C.norm(C.franchiseName(r.franchise))}|${C.norm(r.title)}`));
      const items = rows.map((r, i) => ({ id: String(i), title: r.title, tag: MED[r.medium] ? MED[r.medium][1] : r.medium, tagClass: "new",
        sub: [r.franchise, r.date || r.year].filter(Boolean).join(" · ") }));
      const ids = await BantaAI.review({ title: rows.length ? `${rows.length} new entr${rows.length === 1 ? "y" : "ies"}` : "Nothing new", items,
        note: "Ticked entries are added to your missing canon.", empty: "Gemini found nothing new for these franchises.", ok: "Add", cancel: b < batches.length - 1 ? "Skip" : "Close" });
      const pick = ids.map(i => rows[+i]);
      if (pick.length) { added += db.mergeCanon("gemini", pick); for (const r of pick) known.add(`${C.norm(C.franchiseName(r.franchise))}|${C.norm(r.title)}`); }
      invalidate(); db.flush();
    }
    return `Gemini app added ${fmt(added)} new canon entr${added === 1 ? "y" : "ies"}`;
  }

  // Runs step 1 or 2 through the API (via "auto") or the Gemini app; an API failure offers the Gemini app for the same step.
  function mvRun(kind, via, only) {
    ui.gemFail = "";
    let stopped = false;
    const manual = { label: "Gemini app", call: (prompt, o) => gappAsk(prompt, Object.assign({ note: o.note || (kind === "group" ? "Sorts your titles into multiverses." : "") }, o))
      .catch(e => { if (isCancel(e)) stopped = true; throw e; }) };
    const name = kind === "group" ? "Multiverse grouping" : "Multiverse search";
    return runJob(via === "app" ? `${name} (Gemini app)` : name, async p => {
      const prov = via === "app" ? manual : C.geminiProvider(db, Native.http, db.get("gemini_key"), db.get("gemini_model") || "auto", { search: db.get("gemini_search", "0") === "1" });
      try {
        if (kind === "group") {
          const n = await C.mvGroup(db, prov, p, via === "app" ? 200 : 150);
          const m = mvState();
          return `${stopped ? "Stopped. " : ""}${fmt(n)} titles grouped · ${fmt(m.mvs.length)} multiverses${m.pending ? ` · ${fmt(m.pending)} still to group` : ". Next: step 2"}`;
        }
        const n = await C.mvExpand(db, prov, p, { only: only ? [only] : null, maxLines: via === "app" ? 300 : 220 });
        invalidate();
        return `${stopped ? "Stopped. " : ""}${fmt(n)} canon entr${n === 1 ? "y" : "ies"} added${mvState().stale.length ? ` · ${fmt(mvState().stale.length)} multiverses still to search` : ""}`;
      } catch (e) {
        if (via !== "app" && !/network error/i.test(e.message)) { ui.gemFail = e.message; ui.gemFailKind = kind; }
        throw e;
      }
    });
  }

  function gappRun(kind) {
    ui.gemFail = "";
    if (kind === "scan") {
      let stopped = false;
      const ask = (prompt, o) => gappAsk(prompt, Object.assign(o, { note: "Sorts your seen and listed titles into universes and lists every canon entry." }))
        .catch(e => { if (isCancel(e)) stopped = true; throw e; });
      return runJob("Gemini app scan", p => C.manualScan(db, ask, p)
        .then(n => { const g = C.geminiState(db); return `Gemini app ${stopped ? "stopped: " : ""}added ${fmt(n)} canon entries. Checked ${fmt(g.sent.size)} of ${fmt(g.pool.length)} titles${g.pending.length ? ", run again to continue" : ""}`; }));
    }
    if (kind === "verify") return runJob("Gemini app check", gappVerify);
    if (kind === "news") return runJob("Gemini app news", gappNews);
  }

  // Step 1 / step 2 status for the multiverse flow
  function mvState() {
    const g = C.mvPending(db), mvs = C.multiverses(db), now = Date.now();
    const stale = mvs.filter(m => now - m.last > 30 * 864e5);
    return { pool: g.pool.length, pending: g.pending.length, grouped: g.pool.length - g.pending.length, mvs, stale };
  }

  function renderMissing() {
    const meds = ["All", "Movie", "TV Series", "Special", "Video Game"];
    const hasClaude = !!db.get("claude_key"), hasGemini = !!db.get("gemini_key");
    const m = mvState(), via = hasGemini ? "auto" : "app";
    const step = (n, k, title, sub, done) => `<button class="tool step${done ? " done" : ""}" data-action="mv" data-k="${k}" data-via="${via}" ${ui.job ? "disabled" : ""}>
        <span class="tool-ic">${done ? icon("check") : `<b>${n}</b>`}</span><span class="grow"><b>${title}</b><small>${sub}</small></span>${icon("chev")}</button>`;
    return `<section>
        <div class="sechead"><h2 style="margin:0">Find more canon</h2>
          <button class="iconbtn" data-action="copy" aria-label="Copy missing list">${icon("copy")}</button></div>
        ${!feat("gemini") ? `<p class="muted small" style="margin-top:0">TMDB collections find the other films of a series you've started. For whole multiverses (films, series, specials and games) switch on the AI tools in Settings › Features: they use Gemini, through its app or your API key.</p>
          <button class="btn small" data-action="tab" data-tab="settings" data-scroll="features">Settings › Features</button>` : ""}
        <p class="muted small" style="margin-top:0" ${feat("gemini") ? "" : "hidden"}>Two steps with ${hasGemini ? "Gemini (your API key)" : "the Gemini app (copy and paste)"}: first every title you've seen or listed is grouped into its multiverse, then each multiverse is searched for the films, series, specials and games you're missing.</p>
        <div class="tools" ${feat("gemini") ? "" : "hidden"}>
          ${step(1, "group", "Group into multiverses", m.pool ? (m.pending ? `${fmt(m.grouped)} of ${fmt(m.pool)} titles grouped · ${fmt(m.pending)} to go` : `All ${fmt(m.pool)} titles grouped into ${fmt(m.mvs.length)} multiverses`) : "Sync your IMDb/Trakt data first", m.pool && !m.pending)}
          ${step(2, "expand", "Find entries per multiverse", m.mvs.length ? (m.stale.length ? `${fmt(m.stale.length)} of ${fmt(m.mvs.length)} multiverses to search` : `All ${fmt(m.mvs.length)} searched in the last 30 days`) : "Do step 1 first", m.mvs.length && !m.stale.length)}
        </div>
        <div class="row wrap" style="margin-top:10px">
          <button class="btn small" data-action="tmdb" ${ui.job ? "disabled" : ""}>TMDB collections</button>
          ${hasClaude ? `<button class="btn small" data-action="claude" ${ui.job ? "disabled" : ""}>Claude scan</button>` : ""}
          ${m.mvs.length ? `<button class="btn quiet small" data-action="mvlist">${ui.mvOpen ? "Hide" : "Show"} multiverses</button>` : ""}
        </div>
        ${ui.mvOpen && m.mvs.length ? `<div class="mvlist">${m.mvs.map(g => `<div class="mvrow"><span class="grow"><b>${esc(g.name)}</b><small>${fmt(g.seeds)} of yours · ${fmt(g.lines.size)} known${g.last ? ` · searched ${esc(new Date(g.last).toLocaleDateString())}` : ""}${(x => (x ? ` · ${esc(x.text)}` : ""))(crossLine(g.name))}</small></span>
            <button class="btn quiet small" data-action="order" data-mv="${esc(g.name)}">Order</button>
            <button class="btn quiet small" data-action="mv" data-k="expand" data-via="${via}" data-only="${esc(g.name)}" ${ui.job ? "disabled" : ""}>Search</button></div>`).join("")}</div>` : ""}
        <div class="row" style="margin-top:8px"><span class="small grow" id="status">${esc(ui.job ? ui.status : "")}</span>
          ${ui.job && /scan|multiverse/i.test(ui.job) ? `<button class="btn small" data-action="stopjob">Stop after this batch</button>` : ""}</div>
        ${scanLine("claude", "Claude")}
        ${ui.gemFail ? `<div class="callout" role="status"><b>The Gemini API didn't finish.</b><span class="small muted">${esc(ui.gemFail)}</span>
          <div class="row wrap"><button class="btn primary small" data-action="mv" data-k="${esc(ui.gemFailKind || "group")}" data-via="app" ${ui.job ? "disabled" : ""}>Continue in the Gemini app</button><button class="btn quiet small" data-action="gemfailx">Dismiss</button></div></div>` : ""}
      </section>
      ${feat("gemini") ? gappSection() : ""}
      <section>
        <div class="chips" style="margin-bottom:10px">
          <button class="chip" data-action="mview" data-v="release" aria-pressed="${ui.missingView === "release"}">Release order</button>
          <button class="chip" data-action="mview" data-v="franchise" aria-pressed="${ui.missingView === "franchise"}">By multiverse</button>
          ${ui.missingView === "release" ? `<button class="chip" data-action="nextonly" aria-pressed="${ui.nextOnly}">Up next only</button>` : ""}
          <button class="chip" data-action="showlisted" aria-pressed="${!!ui.showListed}">Include my lists</button>
        </div>
        <input type="search" placeholder="Search titles or franchises" value="${esc(ui.missingQ)}" data-input="missingQ" aria-label="Search missing canon">
        <div class="chips" style="margin:10px 0 6px">${meds.map(m => `<button class="chip" data-action="med" data-m="${esc(m)}" aria-pressed="${ui.missingMed === m}">${m === "All" ? "All" : esc(MED[m][1])}</button>`).join("")}</div>
        <div id="missingList">${listHtml()}</div>
      </section>`;
  }

  // ------------------------------------------------------------ compare
  const VIEWS = {
    imdb: ["IMDb only", "Watched or rated on IMDb but not on Trakt."],
    trakt: ["Trakt only", "Watched or rated on Trakt but not on IMDb."],
    games: ["Games", "Games you've rated on IMDb. Trakt doesn't track games, so they never sync."],
    ratings: ["Ratings differ", "Titles you rated differently on IMDb and Trakt, biggest gap first."],
    specials: ["Specials check", "Shorts and webisodes that only exist on IMDb, checked against TMDB to see whether Trakt files them as Season 0 specials."],
  };

  function compareRows() {
    if (ui.cmpView === "specials") return null;
    const d = C.discrepancies(db);
    const rows = { imdb: d.imdb_not_trakt, trakt: d.trakt_not_imdb, games: d.games, ratings: C.ratingDiffs(db) }[ui.cmpView];
    const q = ui.cmpQ.toLowerCase();
    return { warning: ui.cmpView === "games" || ui.cmpView === "ratings" ? "" : d.warning,
             rows: rows.filter(i => !q || (i.title || "").toLowerCase().includes(q)).sort((a, b) => (a.title || "").localeCompare(b.title || "")) };
  }

  function renderCompareList() {
    if (ui.cmpView === "specials") {
      const sp = db.specials().filter(s => !ui.cmpQ || (s.title || "").toLowerCase().includes(ui.cmpQ.toLowerCase()));
      if (!sp.length) return `<p class="muted">No specials checked yet. Needs a TMDB key in Settings.</p>`;
      return `<ul class="plain">${sp.map(s => `<li><div class="row"><b class="grow">${esc(s.title || s.imdb)}</b><button class="iconbtn" data-action="open" data-url="https://www.imdb.com/title/${esc(s.imdb)}/" aria-label="Open on IMDb">${icon("open")}</button></div>
        <div class="small" style="color:var(--special)">${esc(s.status)}</div><div class="small muted">${esc(s.note)}</div></li>`).join("")}</ul>`;
    }
    const { warning, rows } = compareRows();
    if (warning) return `<p class="muted">${esc(warning)}</p>`;
    if (!rows.length) return `<p class="muted">${ui.cmpQ ? "Nothing matches this search." : "Nothing here. Both sides agree."}</p>`;
    const shown = rows.slice(0, ui.cmpLimit);
    const pr = C.platformRatings(db);
    const side = (label, e) => !e ? `<span class="rchip none">${label}: not logged</span>`
      : e.rating ? `<span class="rchip">${label} ★${e.rating}${e.rated_at ? ` <small>${esc(C.fmtWhen({ date: e.rated_at }))}</small>` : ""}</span>`
      : `<span class="rchip">${label}: watched, no rating</span>`;
    return `<p class="small muted" style="margin:0 0 4px">${fmt(rows.length)} titles</p><ul class="plain">${shown.map(i => {
      const e = (i.imdb && pr.get(i.imdb)) || { imdb: null, trakt: null };
      // IMDb-only rows: games and anything Trakt can't log still show where they're rated
      const chips = ui.cmpView === "games" ? side("IMDb", e.imdb) : `${side("IMDb", e.imdb)}${side("Trakt", e.trakt)}`;
      return `
      <li data-action="open" data-url="${esc(imdbUrl(i))}" style="cursor:pointer">
        <div>${esc(i.title)}<span class="muted">${esc(yr(i.year))}</span></div>
        <div class="row small wrap" style="margin-top:4px;gap:6px">${medTag(i.medium)}${chips}</div>
      </li>`; }).join("")}</ul>
      ${rows.length > shown.length ? `<button class="btn block" data-action="more" style="margin-top:10px">Show ${fmt(Math.min(150, rows.length - shown.length))} more</button>` : ""}`;
  }

  function renderCompare() {
    return `<section class="row" style="padding-bottom:0;border:0"><button class="btn quiet" data-action="tab" data-tab="stats">${icon("back")}Stats</button><h2 style="margin:0">Compare IMDb and Trakt</h2></section>
      <section>
      <div class="chips">${Object.entries(VIEWS).map(([k, [label]]) => `<button class="chip" data-action="view" data-v="${k}" aria-pressed="${ui.cmpView === k}">${label}</button>`).join("")}</div>
      <p class="muted small">${esc(VIEWS[ui.cmpView][1])}</p>
      ${ui.cmpView === "specials" ? `<div class="stack" style="margin-bottom:12px">
        <button class="btn" data-action="s0" ${ui.job ? "disabled" : ""}>Check specials on TMDB</button>
        <label class="switch"><input type="checkbox" id="s0all" ${ui.s0all ? "checked" : ""}><span>Check every IMDb-only title, not just shorts (slower)</span></label>
        <div class="small" id="status">${esc(ui.job ? ui.status : "")}</div></div>` : ""}
      <input type="search" placeholder="Search" value="${esc(ui.cmpQ)}" data-input="cmpQ" aria-label="Search this list">
      <div id="cmpList" style="margin-top:10px">${renderCompareList()}</div>
    </section>`;
  }

  // ------------------------------------------------------------ upcoming
  const DAY = 864e5;
  function dayLabel(date, today) {
    const d = new Date(date + "T12:00:00Z"), t = new Date(today + "T12:00:00Z");
    const diff = Math.round((d - t) / DAY);
    if (diff === 0) return "Today";
    if (diff === 1) return "Tomorrow";
    const wd = d.toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" });
    if (diff < 7) return wd;
    return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: d.getUTCFullYear() !== t.getUTCFullYear() ? "numeric" : undefined, timeZone: "UTC" });
  }

  function renderToWatch() {
    const cw = C.continueWatching(db);
    const chips = [["all", "Everything"], ["towatch", "To watch"], ["episodes", "Episodes"], ["releases", "Canon releases"]].map(([k, l]) =>
      `<button class="chip" data-action="upfilter" data-v="${k}" aria-pressed="${k === "towatch"}">${l}</button>`).join("");
    return `<section><div class="chips">${chips}</div>
      <p class="small muted" style="margin:10px 0 0">Shows with aired episodes after the last one you watched on Trakt. "New" means episodes came out since you last watched.</p>
      <div class="row wrap" style="margin-top:8px"><button class="btn small" data-action="refreshshows" ${ui.job || !db.get("tmdb_key") ? "disabled" : ""}>${icon("sync")}Refresh shows</button></div>
      <div class="small" id="status">${esc(ui.job ? ui.status : "")}</div></section>
      <section>${cw.length ? cw.map(cwRow).join("") : `<p class="muted">Nothing to catch up on. Sync Trakt and tap Refresh shows if this looks wrong.</p>`}</section>`;
  }

  function renderUpcoming() {
    const today = new Date().toISOString().slice(0, 10);
    const eps = C.upcomingEpisodes(db, today);
    const rel = C.upcomingEvents(db, status(), today).filter(e => e.kind === "canon");
    const f = ui.upFilter || "all";
    if (f === "towatch") return renderToWatch();
    let rows = [];
    if (f !== "releases") rows = rows.concat(eps.map(e => Object.assign({ sort: e.date }, e)));
    if (f !== "episodes" && f !== "games") rows = rows.concat(rel.map(e => Object.assign({ sort: e.date || `${e.year}-13` }, e)));
    const gi = gamesIdx();
    const gameRel = gi && gi.upcoming ? gi.upcoming.filter(g => g.date >= today) : [];
    if (f === "all" || f === "games") rows = rows.concat(gameRel.map(g => ({ kind: "game", sort: g.date, date: g.date, title: g.t, id: g.id, franchise: g.f })));
    if (f === "games") rows = rows.filter(r => r.kind === "game");
    rows.sort((a, b) => a.sort.localeCompare(b.sort) || String(a.title).localeCompare(String(b.title)));
    const chips = [["all", "Everything"], ["towatch", "To watch"], ["episodes", "Episodes"], ["releases", "Canon releases"]].concat(gameRel.length ? [["games", "Games"]] : []).map(([k, l]) =>
      `<button class="chip" data-action="upfilter" data-v="${k}" aria-pressed="${f === k}">${l}</button>`).join("");
    const nHidden = Object.keys(db.upHidden()).length;
    const head = `<section>
        <div class="chips">${chips}</div>
        <p class="small muted" style="margin:10px 0 0">${db.get("tmdb_key") ? `Episodes of shows you've watched, from TMDB, plus missing canon with a release date.` : "Add a TMDB key in Settings to see upcoming episodes."}</p>
        <div class="row wrap" style="margin-top:8px"><button class="btn small" data-action="refreshshows" ${ui.job || !db.get("tmdb_key") ? "disabled" : ""}>${icon("sync")}Refresh shows</button>
        <span class="grow"></span>${nHidden ? `<button class="btn quiet small" data-action="tab" data-tab="settings">${icon("eyeoff")}${nHidden} hidden</button>` : ""}</div>
        <div class="small" id="status">${esc(ui.job ? ui.status : "")}</div>
      </section>`;
    if (!rows.length) {
      return head + `<section><p class="muted">${eps.length || rel.length ? "Nothing in this view." : "Nothing scheduled yet. Tap Refresh shows to look up the next episodes of your shows."}</p></section>`;
    }
    const cap = ui.upLimit || 200;
    let out = "", lastLabel = null;
    for (const r of rows.slice(0, cap)) {
      const label = r.date && r.date.length === 10 ? dayLabel(r.date, today) : (r.date ? C.fmtWhen(r) : String(r.year || "Date to be announced"));
      if (label !== lastLabel) { out += `<h3 class="dayhead">${esc(label)}</h3>`; lastLabel = label; }
      out += r.kind === "game" ? xrow("games", r.id, "", r.title, `Game · ${esc(r.franchise || "")}`, "Game")
        : r.kind === "episode"
        ? row(r, "up", { title: r.show, tag: r.premiere ? "Premiere" : "", sub: `S${r.s} E${r.e}${r.name && !/^episode \d+$/i.test(r.name) ? ` · ${esc(r.name)}` : ""}`, trail: hideBtn(r) })
        : row(r, "up", { tag: r.vod ? "Digital/VOD" : "", sub: esc(r.franchise), trail: hideBtn(r) });
    }
    if (rows.length > cap) out += `<button class="btn block" data-action="upmore" style="margin-top:10px">Show more</button>`;
    return head + `<div class="row" style="justify-content:flex-end;margin-bottom:6px"><button class="btn quiet small" data-action="icsexport">${icon("upcoming")}Add to my calendar</button></div><section>${out}</section>`;
  }
  // Everything dated in the next six months as a calendar file (.ics): episodes of your series, canon releases, games.
  function icsText() {
    const today = TODAY(), until = new Date(Date.now() + 183 * 864e5).toISOString().slice(0, 10), ev = [], seen = new Set();
    const add = (d, title, note) => { const k = d + "|" + title; if (!d || d.length !== 10 || d < today || d > until || seen.has(k)) return; seen.add(k); ev.push([d, title, note || ""]); };
    for (const it of lib.all()) if (it.type === "show" && it.status !== "dropped" && it.status !== "watchlist" && it.epl) for (const e of it.epl) if (e[2]) add(e[2], `${it.title} S${e[0]} E${e[1]}`, e[3] || "");
    const libShows = new Set(lib.all().map(it => it.imdb).filter(Boolean));
    for (const e of C.upcomingEpisodes(db, today)) if (!libShows.has(e.imdb)) add(e.date, `${e.show} S${e.s} E${e.e}`, e.name || "");
    for (const c of C.releaseList(status(), today).upcoming) add(c.date, c.title, c.franchise);
    if (secOn("games")) for (const g of games.upcoming(today)) add(g.date, `${g.title} (game)`, g.franchise || "");
    const escI = t => String(t).replace(/([\\;,])/g, "\\$1").replace(/\n/g, " ");
    const next = d => new Date(Date.parse(d + "T12:00:00Z") + 864e5).toISOString().slice(0, 10).replace(/-/g, "");
    const stamp = new Date().toISOString().replace(/[-:]|\.\d+/g, "");
    return { n: ev.length, text: ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Saga//Upcoming//EN", "CALSCALE:GREGORIAN",
      ...ev.sort((a, b) => a[0].localeCompare(b[0])).flatMap(([d, t, n]) => ["BEGIN:VEVENT", `UID:saga-${C.hashId ? C.hashId(d + t) : (d + t).replace(/\W/g, "")}@saga`, `DTSTAMP:${stamp}`,
        `DTSTART;VALUE=DATE:${d.replace(/-/g, "")}`, `DTEND;VALUE=DATE:${next(d)}`, `SUMMARY:${escI(t)}`, ...(n ? [`DESCRIPTION:${escI(n)}`] : []), "END:VEVENT"]), "END:VCALENDAR"].join("\r\n") + "\r\n" };
  }
  // ---- picked for you: watchlist titles ranked by how you've rated their genres
  function forYou(limit = 14) {
    const rated = lib.all().filter(it => it.rating && it.genres && it.genres.length);
    if (rated.length < 8) return [];
    const mean = rated.reduce((a, it) => a + it.rating, 0) / rated.length, g = {};
    for (const it of rated) for (const x of it.genres) { g[x] = g[x] || { s: 0, n: 0 }; g[x].s += it.rating - mean; g[x].n++; }
    const aff = x => (g[x] ? g[x].s / (g[x].n + 3) : 0); // few ratings in a genre count for less
    return lib.all().filter(it => it.status === "watchlist" && !isFinished(it) && it.genres && it.genres.length)
      .map(it => ({ it, score: it.genres.reduce((a, x) => a + aff(x), 0) / it.genres.length, why: it.genres.slice().sort((a, b) => aff(b) - aff(a))[0] }))
      .filter(x => x.score > 0).sort((a, b) => b.score - a.score).slice(0, limit);
  }
  const allTags = () => { const m = new Map(); for (const it of lib.all()) for (const t of it.tags || []) m.set(t, (m.get(t) || 0) + 1); return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])); };

  // ------------------------------------------------------------ settings
  const field = (key, label, opt = {}) => {
    const v = esc(db.get(key, ""));
    const ph = opt.placeholder ? ` placeholder="${esc(opt.placeholder)}"` : "";
    const input = opt.area ? `<textarea data-setting="${key}"${ph} spellcheck="false">${v}</textarea>`
      : `<input type="${opt.secret ? "password" : "text"}" data-setting="${key}" value="${v}"${ph} autocomplete="off" autocapitalize="off" spellcheck="false">`;
    return `<label class="field"><span>${esc(label)}</span>${input}</label>${opt.hint ? `<div class="small muted" style="margin:4px 2px 0">${opt.hint}</div>` : ""}`;
  };

  function settingsAll() {
    const ex = db.exclusions();
    const hidden = [...db.hiddenFranchises()].sort();
    const prof = db.get("profile", DEFAULT_PROFILE);
    return `${generalSection()}${importHub()}${featureSection()}${backupSection()}<section class="stack">
        <h2 id="accounts">Trakt</h2>
        <label class="switch"><input type="checkbox" data-setting="live_sync" ${db.get("live_sync", "1") === "1" ? "checked" : ""}><span>Live sync<small class="muted" style="display:block">Check Trakt whenever you open the app and every 10 minutes, and send changes right away instead of waiting for Sync now.</small></span></label>
        <label class="switch"><input type="checkbox" data-setting="trakt_push" ${db.get("trakt_push", "1") === "1" ? "checked" : ""}><span>Send what I log here to Trakt<small class="muted" style="display:block">Episodes, film watches and ratings go to your Trakt history after each sync. Needs the sign-in below.</small></span></label>
        ${field("username", "Username")}
        <label class="field"><span>App profile</span><select data-setting="profile" data-action-change="profile">${Object.keys(C.PROFILES).map(p => `<option ${p === prof ? "selected" : ""}>${esc(p)}</option>`).join("")}</select></label>
        ${field("client_id", "Client ID")}
        ${db.get("client_id") ? "" : `<p class="small muted" style="margin-top:-4px">Needed for Trakt. Create a free API app at trakt.tv › Settings › Your API Apps (redirect URI <b>https://trakt.tv</b>) and paste its Client ID here.</p>`}
        ${field("redirect", "Redirect URI")}
        ${prof.startsWith("OAuth") ? field("secret", "Client secret", { secret: true }) : ""}
        <p class="small muted">Public profiles sync without signing in. Sign in only if your Trakt profile is private.</p>
        <div class="row wrap"><button class="btn" data-action="authorize">Sign in to Trakt</button>
        ${db.get("token") ? `<button class="btn quiet" data-action="signout">Sign out</button>` : ""}</div>
        <label class="field"><span>Code from Trakt</span><input type="text" id="authcode" placeholder="Paste the code, or the whole address after approving" autocomplete="off" autocapitalize="off"></label>
        <button class="btn" data-action="exchange">Finish sign-in</button>
        <div class="small ${db.get("token") ? "" : "muted"}" style="${db.get("token") ? "color:var(--ok)" : ""}">${db.get("token") ? "Signed in. Private data will sync." : "Not signed in."}</div>
        <label class="switch"><input type="checkbox" data-setting="trakt_push" ${db.get("trakt_push") === "1" ? "checked" : ""} ${db.get("token") ? "" : "disabled"}><span>When I mark something as seen here, mark it watched on Trakt too<small class="muted" style="display:block">Needs the sign-in above. Each title's sheet also gets Trakt buttons.</small></span></label>
      </section>
      <section class="stack">
        <h2>IMDb</h2>
        <p class="small muted">Saga opens IMDb pages in a hidden browser, like visiting them in Chrome. To sync private lists and your ratings, sign in once.</p>
        <div class="row wrap"><button class="btn" data-action="imdbsignin">Sign in to IMDb</button>
        ${db.get("imdb_signed_in") ? `<span class="small" style="color:var(--ok)">Sign-in page was opened ${esc(db.get("imdb_signed_in"))}</span>` : ""}</div>
        ${field("imdb_user", "User ID", { placeholder: "ur12345678, p.abc123 or your profile link", hint: "Your ratings sync if they're public or you've signed in above. Importing your ratings CSV from the Home tab always works." })}
        ${field("imdb_lists", "Public lists and your watchlist link, one per line. Titles here count as already planned, not missing", { area: true, placeholder: "https://www.imdb.com/list/ls100000001/" })}
      </section>
      <section class="stack">
        <h2>Steam</h2>
        ${field("steam_profile", "Steam profile link or custom name", { placeholder: "https://steamcommunity.com/id/yourname", hint: "Your owned games and hours come in at every sync. In Steam › Edit profile › Privacy, My profile and Game details must be Public." })}
        ${field("itad_key", "IsThereAnyDeal API key (optional, for store prices)", { secret: true, hint: "Free at isthereanydeal.com › Settings › API keys. Game pages then compare euro prices across Steam, GOG, Epic, Humble, Fanatical, GamesPlanet and more. Without it, CheapShark's US prices are used." })}
        ${field("steam_key", "Steam Web API key (optional, recommended)", { secret: true, hint: "Free at steamcommunity.com/dev/apikey (any domain name will do). With it, your library comes from Steam’s official API, which is far more reliable than reading the profile page." })}
        ${db.get("steam_sync_at") ? `<p class="small muted" style="margin:0">Last read ${esc(new Date(+db.get("steam_sync_at")).toLocaleString(lang() === "it" ? "it-IT" : "en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }))}</p>` : ""}
      </section>
      ${listsHtml()}
      <section class="stack">
        <h2>More services</h2>
        <p class="small muted" style="margin:0">Synced at every sync, from your public profile (no password). Anime goes to the library, manga and light novels to Books.</p>
        ${field("anilist_user", "AniList username", { placeholder: "yourname" })}
        ${field("mal_user", "MyAnimeList username", { placeholder: "yourname" })}
        ${field("letterboxd_user", "Letterboxd username", { placeholder: "yourname", hint: "Letterboxd's public feed has your latest 50 diary entries; import the Letterboxd export once for everything older." })}
        ${field("goodreads_user", "Goodreads profile number or link", { placeholder: "goodreads.com/user/show/12345-name", hint: "Your read, reading and to-read shelves, if the profile is public." })}
        <p class="small muted" style="margin:0">Netflix, TV Time, Simkl, Serializd, Kitsu (as MAL XML), HowLongToBeat, Grouvee, StoryGraph and others: their export files, in Import and export.</p>
      </section>
      <section class="stack">
        <h2>Canon lists</h2>
        ${field("canon_urls", "One per line: franchise name | IMDb or Trakt list link", { area: true, placeholder: "Doctor Who | https://www.imdb.com/list/ls100000001/\nThe Walking Dead | https://trakt.tv/users/someone/lists/twd-canon" })}
      </section>
      <section class="stack">
        <h2>Gemini (free)</h2>
        ${field("gemini_key", "Gemini API key", { secret: true, hint: "Free from aistudio.google.com (Get API key). Saga only uses free models and paces itself to the free limits; if today's quota runs out it stops and continues tomorrow." })}
        ${field("gemini_model", "Gemini model", { placeholder: "auto", hint: `Leave as auto to use the best free model your key can access${db.get("gemini_model_used") ? ` (last used: ${esc(db.get("gemini_model_used"))})` : ""}.` })}
        <label class="switch"><input type="checkbox" data-setting="gemini_search" ${db.get("gemini_search", "0") === "1" ? "checked" : ""}><span>Let Gemini search Google for new announcements (needs a billed project, e.g. your AI Pro credits)</span></label>
        <div class="row wrap"><button class="btn" data-action="testgemini" ${ui.job ? "disabled" : ""}>Test Gemini key</button>
          <button class="btn quiet" data-action="gappreset">Re-verify everything with the Gemini app</button></div>
        <p class="small muted" style="margin:0">No key, or it stops working? The Missing tab has copy-and-paste tools for the Gemini app.</p>
        ${db.get("gemini_test") ? `<p class="small" style="margin:0;color:${db.get("gemini_test").startsWith("OK") ? "var(--ok)" : "var(--danger)"}">${esc(db.get("gemini_test"))}</p>` : ""}
      </section>
      <section class="stack">
        <h2>Region, streaming and TMDB</h2>
        ${field("region", "Country for release dates and streaming", { placeholder: "IT", hint: "Two-letter code, e.g. IT, GB, US." })}
        ${field("my_services", "Your streaming services", { placeholder: "Disney+, Netflix, Prime Video", hint: "Listed first in Worldwide with a VPN, and used for the VPN badge when a title doesn't stream in your country." })}
        ${field("vpn_countries", "VPN countries with picture quality", { placeholder: C.VPN_DEFAULT, hint: "Every country's services are shown; these also get 4K/HD info from JustWatch (up to 14)." })}
        ${field("tmdb_key", "TMDB API key or read token (free)", { secret: true })}
      </section>
      <section class="stack">
        <h2>Claude (optional, paid)</h2>
        <details class="report"><summary>Key and model</summary>
        <div class="stack" style="margin-top:10px">
        ${field("claude_key", "Claude API key", { secret: true, placeholder: "sk-ant-…", hint: "Create one at console.anthropic.com (API keys). The scan uses your API credit: roughly €1–3 per 1,000 titles, plus about €0.01 per web search." })}
        ${field("claude_model", "Model", { placeholder: "auto", hint: `Leave as auto for the newest Sonnet your key can use${db.get("claude_model_used") ? ` (last used: ${esc(db.get("claude_model_used"))})` : ""}.` })}
        <label class="switch"><input type="checkbox" data-setting="claude_web" ${db.get("claude_web", "1") === "1" ? "checked" : ""}><span>Let Claude search the web for new announcements</span></label>
        </div></details>
      </section>
      <section class="stack">
        <h2>Other AI services</h2>
        <p class="small muted" style="margin:0">ChatGPT, Mistral, Groq, OpenRouter, DeepSeek or any OpenAI-compatible service can run the canon scan too. Gemini stays the free default.</p>
        <label class="field"><span>Service</span><select data-setting="ai_preset">${Object.entries(C.AI_PRESETS).map(([k, v]) => `<option value="${k}" ${db.get("ai_preset", "openai") === k ? "selected" : ""}>${esc(v.label)}</option>`).join("")}</select></label>
        ${(() => { const pr = C.AI_PRESETS[db.get("ai_preset", "openai")] || C.AI_PRESETS.openai; return `
        ${field("ai_key", `${pr.label} API key`, { secret: true, hint: `From ${pr.keys}.` })}
        ${field("ai_model", "Model", { placeholder: pr.model || "model name", hint: `Leave empty for ${pr.model || "the service's default"}.${db.get("ai_model_used") ? ` Last used: ${esc(db.get("ai_model_used"))}.` : ""}` })}
        ${db.get("ai_preset") === "custom" ? field("ai_base", "Address (ends in /v1)", { placeholder: "https://example.com/v1" }) : ""}
        <button class="btn" data-action="aiscan" ${db.get("ai_key") ? "" : "disabled"}>${icon("spark")}Find missing canon with ${esc(pr.label)}</button>`; })()}
      </section>
      <section>
        <h2>Matching</h2>
        <label class="field"><span id="thrLabel">Title similarity needed: ${esc(db.get("threshold", "90"))}%</span>
        <input type="range" min="70" max="100" step="1" value="${esc(db.get("threshold", "90"))}" data-setting="threshold" data-input="threshold"></label>
        <p class="small muted">Lower values match more loosely spelled titles from Gemini, but risk false matches like Alien and Aliens.</p>
      </section>
      <section>
        <h2>Marked as seen</h2>
        ${ex.length ? `<ul class="plain">${ex.map(x => `<li class="row"><span class="grow">${esc(x.title)}${esc(yr(x.year))}</span>${medTag(x.medium)}<button class="btn quiet" data-action="unexclude" data-key="${esc(x.key)}">Undo</button></li>`).join("")}</ul>`
          : `<p class="muted small">Titles you mark as seen in the app appear here.</p>`}
        <h2 style="margin-top:18px">Not canon</h2>
        ${(() => {
          const seenT = new Set(), nc = Object.entries(db.notCanon()).filter(([k, v]) => { const id = v.title + "|" + v.year; if (seenT.has(id)) return false; seenT.add(id); return true; });
          return nc.length ? `<ul class="plain">${nc.map(([k, v]) => `<li class="row"><span class="grow">${esc(v.title)}${esc(yr(v.year))}<span class="small muted">${v.franchise ? `, ${esc(v.franchise)}` : ""}</span></span>${medTag(v.medium)}<button class="btn quiet" data-action="uncanon" data-key="${esc(k)}">Undo</button></li>`).join("")}</ul>`
            : `<p class="muted small">Compilations and other entries you mark as not canon appear here.</p>`;
        })()}
        <h2 style="margin-top:18px">Hidden from Upcoming</h2>
        ${(() => { const h = Object.entries(db.upHidden());
          return h.length ? `<ul class="plain">${h.map(([k, v]) => `<li class="row"><span class="grow">${esc(v.label || k)}<span class="small muted">${k.startsWith("show|") ? ", all episodes" : ""}</span></span><button class="btn quiet" data-action="upshow" data-key="${esc(k)}">Show</button></li>`).join("")}</ul>`
            : `<p class="muted small">Shows and releases you hide in the calendar appear here.</p>`; })()}
        <label class="switch"><input type="checkbox" data-setting="home_calendar" ${db.get("home_calendar", "1") === "1" ? "checked" : ""}><span>Show the next two weeks on Home</span></label>
        <h2 style="margin-top:18px">Hidden franchises</h2>
        ${hidden.length ? `<ul class="plain">${hidden.map(h => `<li class="row"><span class="grow">${esc(h)}</span><button class="btn quiet" data-action="unhide" data-f="${esc(h)}">Show</button></li>`).join("")}</ul>`
          : `<p class="muted small">Franchises you hide on the Missing tab appear here.</p>`}
      </section>
      <section class="stack">
        <h2>Notifications</h2>
        <label class="switch"><input type="checkbox" data-setting="sync_notify" ${db.get("sync_notify", "1") === "1" ? "checked" : ""}><span>Show sync and scan progress as a notification</span></label>
        <label class="switch"><input type="checkbox" data-setting="bg_enabled" ${db.get("bg_enabled", "1") === "1" ? "checked" : ""}><span>Check for new releases in the background</span></label>
        <label class="field"><span>How often</span><select data-setting="bg_hours">${[["6", "Every 6 hours"], ["12", "Every 12 hours"], ["24", "Once a day"]].map(([v, l]) =>
          `<option value="${v}" ${db.get("bg_hours", "12") === v ? "selected" : ""}>${l}</option>`).join("")}</select></label>
        <label class="switch"><input type="checkbox" data-setting="bg_tv" ${db.get("bg_tv", "1") === "1" ? "checked" : ""}><span>Include new seasons of shows I've watched</span></label>
        <label class="switch"><input type="checkbox" data-setting="bg_eps" ${db.get("bg_eps", "0") === "1" ? "checked" : ""}><span>Also notify for every new episode on its air day</span></label>
        <p class="small muted">In the background Saga syncs Trakt and checks TMDB for new films in your collections and new seasons. IMDb and Gemini only run with the app open. Android picks the exact time to save battery, so a check can run a little late.</p>
        <div class="row wrap"><button class="btn" data-action="bgnow" ${ui.job ? "disabled" : ""}>Check now</button>
        <span class="small muted">${(() => { const t = parseFloat(db.get("bg_last", "0")) || 0; return t ? `Last check ${new Date(t * 1000).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}` : "No check yet"; })()}</span></div>
        ${db.get("bg_report") ? reportHtml(db.get("bg_report")) : ""}
      </section>
      <section>
        <h2 id="files">IMDb, Trakt and Refract files</h2>
        <p class="muted small">For anything sync can't reach, like private IMDb ratings. These feed the canon finder; the titles also join your library.</p>
        <div class="stack">
          <button class="btn block" data-action="import" data-kind="imdb" ${ui.job ? "disabled" : ""}>${icon("upload")}IMDb ratings or watched CSV</button>
          <button class="btn block" data-action="import" data-kind="imdblist" ${ui.job ? "disabled" : ""}>${icon("upload")}IMDb list CSVs</button>
          <button class="btn block" data-action="import" data-kind="trakt" ${ui.job ? "disabled" : ""}>${icon("upload")}Trakt export ZIP</button>
          <button class="btn block" data-action="import" data-kind="refract" ${ui.job ? "disabled" : ""}>${icon("upload")}Refract export ZIP</button>
          ${(() => { let r; try { r = JSON.parse(db.get("refract_last", "")); } catch (e) { r = null; } if (!r) return `<p class="small muted" style="margin:0">Refract: Settings › Export Data, then pick the ZIP here (don't unzip it). Importing again replaces the previous Refract import.</p>`;
            const c = r.counts || {}; return `<p class="small muted" style="margin:0">Refract, ${esc(new Date(r.at).toLocaleDateString())}: ${fmt(c.watched || 0)} watched, ${fmt(c.rated || 0)} ratings, ${fmt(c.watchlist || 0)} on the watchlist, ${fmt(c.list || 0)} in lists.${r.skipped && r.skipped.length ? ` Not understood: ${esc(r.skipped.slice(0, 5).join(", "))}${r.skipped.length > 5 ? "…" : ""}.` : ""}</p>`; })()}
          <button class="btn block" data-action="import" data-kind="franchise" ${ui.job ? "disabled" : ""}>${icon("upload")}Franchise mapping file</button>
        </div>
        <label class="switch" style="margin-top:8px"><input type="checkbox" data-setting="auto_sync" ${db.get("auto_sync") === "1" ? "checked" : ""}><span>Sync when the app opens (at most every ${AUTO_SYNC_HOURS} hours)</span></label>
      </section>
      <section class="stack">
        <h2 id="lookup">Why isn’t a title showing?</h2>
        <p class="small muted" style="margin:0">Type a title to see every record of it from IMDb, Trakt and your imports, and what Saga did with each one.</p>
        <input type="search" id="lookupQ" data-input="lookupq" placeholder="e.g. Tokyo Revengers" value="${esc(ui.lookupQ || "")}" autocomplete="off">
        ${lookupHtml(ui.lookupQ)}
      </section>
      <section class="stack">
        <h2>Error log</h2>
        ${(() => { const l = errLog().slice().reverse(); return l.length ? `<p class="small muted" style="margin:0">Problems Saga ran into on this phone, newest first. Copy it and send it along when something breaks.</p>
          <div class="row wrap"><button class="btn small" data-action="errcopy">${icon("copy")}Copy the log</button><button class="btn quiet small" data-action="errclear">Clear</button></div>
          <div class="errlog">${l.slice(0, 40).map(x => `<div><small>${esc(new Date(x.at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }))} · ${esc(x.k)}${x.s ? " · " + esc(x.s) : ""}${x.n > 1 ? ` · ×${x.n}` : ""}</small>${esc(x.m)}</div>`).join("")}</div>`
          : `<p class="small muted" style="margin:0">Nothing has gone wrong. Errors and failed syncs are listed here so they can be copied and reported.</p>`; })()}
      </section>
      <section class="stack">
        <h2>Keys in backup files</h2>
        <label class="switch"><input type="checkbox" data-setting="backup_secrets" ${db.get("backup_secrets", "0") === "1" ? "checked" : ""}><span>Include API keys and sign-ins in backup files</span></label>
        <p class="small muted" style="margin:0">Off: backup files you save or share hold your library but not your Trakt sign-in or API keys; restoring one keeps the keys already on the phone. On this phone the keys are kept encrypted with Android's Keystore${db.secretsOn() ? "" : " (not available on this phone: they're kept in the app's private storage)"}.</p>
        ${field("backup_password", "Backup password (optional)", { secret: true, hint: "When set, backup files you save or pick are locked with it (AES-256). Saga can't open a locked backup without it, so write it down." })}
        ${db.get("restore_undo_at") ? `<button class="btn small" data-action="undorestore">${icon("undo")}Undo the restore from ${esc(new Date(+db.get("restore_undo_at")).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }))}</button>` : ""}
      </section>
      <section class="stack">
        <h2>Spoilers</h2>
        <label class="switch"><input type="checkbox" data-setting="spoiler_hide" ${db.get("spoiler_hide", "1") === "1" ? "checked" : ""}><span>Hide the names of episodes I haven't watched<small class="muted" style="display:block">The next episode's name still shows. Synopses stay folded.</small></span></label>
      </section>
      <section class="stack">
        <h2>About</h2>
        <p class="small muted" style="margin:0">Saga ${esc(VERSION)}, pre-alpha.</p>
        <p class="small muted" style="margin:0">This product uses the TMDB API but is not endorsed or certified by TMDB. Other data comes from Trakt, IMDb, TVmaze, Jikan, AniList, Open Library, Google Books, Steam, IsThereAnyDeal and CheapShark.</p>
        <button class="btn small" data-action="whatsnew">What's new</button>
      </section>
      <section>
        <h2>Data</h2>
        <button class="btn danger" data-action="clear">Clear imported data</button>
        <p class="small muted">Removes synced and imported titles, scans and caches. Keeps your settings and the titles you marked as seen. Keys are stored only on this phone, unencrypted.</p>
        <p class="small muted">Saga ${VERSION}${Native.native ? "" : " (browser preview)"}</p>
      </section>`;
  }

  // ---- Settings in groups: a front page with the groups and a search box, then one group at a time
  const SET_GROUPS = [
    ["accounts", "Accounts and sync", "sync", "Trakt, IMDb, Steam, AniList, MAL, Letterboxd, Goodreads, live sync", ["Trakt", "IMDb", "Steam", "Lists that go into the library", "More services"]],
    ["imports", "Import and export", "upload", "Files from IMDb, Trakt, Letterboxd and more; exports", ["Import from other apps", "IMDb, Trakt and Refract files"]],
    ["backup", "Backup", "box", "Automatic backup file, restore, old screens", ["Backup"]],
    ["general", "Look, language and tabs", "globe", "Theme, accent colour, text size, language, which tabs show, country", ["Look", "Language", "Features", "Region, streaming and TMDB"]],
    ["ai", "Canon finder and AI", "spark", "Gemini, Claude, ChatGPT, Mistral, Groq, OpenRouter, DeepSeek; canon lists", ["Gemini (free)", "Claude (optional, paid)", "Other AI services", "Canon lists", "Matching"]],
    ["alerts", "Notifications and widgets", "bell", "Background checks, alerts, home-screen widgets", ["Notifications"]],
    ["hidden", "Hidden and marked", "eyeoff", "Seen, not canon, hidden franchises and releases", ["Marked as seen"]],
    ["data", "Data and about", "settings", "Find a missing title, error log, clear data, version", ["Why isn’t a title showing?", "Error log", "Keys in backup files", "About", "Data"]],
  ];
  // which group a link (data-scroll) belongs to, for the old "Settings › …" buttons around the app
  const SET_ANCHOR = { accounts: "accounts", importhub: "imports", features: "general", backup: "backup", files: "imports" };
  const stripTags = h => h.replace(/<[^>]+>/g, " ").replace(/&[a-z#0-9]+;/gi, " ").replace(/\s+/g, " ").trim();
  function settingsSections() {
    const out = {};
    for (const g of SET_GROUPS) out[g[0]] = [];
    for (const part of settingsAll().split(/(?=<section[\s>])/)) {
      if (!/<section/.test(part)) continue;
      const h = stripTags((part.match(/<h2[^>]*>([\s\S]*?)<\/h2>/) || [])[1] || "");
      const g = SET_GROUPS.find(x => x[4].includes(h)) || SET_GROUPS.find(x => x[0] === "data");
      out[g[0]].push(part);
    }
    return out;
  }
  function widgetHelp() {
    return `<section class="stack"><h2>Home-screen widgets</h2>
      <label class="switch"><input type="checkbox" data-feature="widget" ${feat("widget") ? "checked" : ""}><span>Keep widgets up to date</span></label>
      <p class="small muted">Long-press your home screen › Widgets › Saga. Six to choose from: Up next, Next episodes (with a Mark watched button), Coming up, Games, Reading and Your year. They refresh whenever Saga changes something.</p></section>`;
  }
  function renderSettings() {
    const secs = settingsSections();
    // everything on one page, group by group
    if (ui.setGroup === "*") return `<div class="row" style="margin-bottom:6px"><button class="btn quiet small" data-action="setgroup" data-v="">${icon("back")}Settings</button></div>` +
      SET_GROUPS.map(g => `<div class="kicker" style="margin:22px 0 4px">${esc(g[1])}</div>${secs[g[0]].join("")}${g[0] === "alerts" ? widgetHelp() : ""}`).join("");
    const grp = ui.setGroup && SET_GROUPS.find(g => g[0] === ui.setGroup);
    if (grp) {
      return `<div class="row" style="margin-bottom:6px"><button class="btn quiet small" data-action="setgroup" data-v="">${icon("back")}Settings</button></div>
        <h2 style="font-size:26px;margin:4px 0 14px">${esc(grp[1])}</h2>${secs[grp[0]].join("")}${grp[0] === "alerts" ? widgetHelp() : ""}`;
    }
    const q = (ui.setQ || "").trim().toLowerCase();
    let found = "";
    if (q.length >= 2) {
      const hits = [];
      for (const g of SET_GROUPS) for (const part of secs[g[0]]) {
        const text = stripTags(part), i = text.toLowerCase().indexOf(q);
        if (i < 0) continue;
        const h = stripTags((part.match(/<h2[^>]*>([\s\S]*?)<\/h2>/) || [])[1] || g[1]);
        hits.push(`<button class="setrow" data-action="setgroup" data-v="${g[0]}"><span class="grow"><b>${esc(h)}</b><small>${esc(g[1])} · …${esc(text.slice(Math.max(0, i - 30), i + 60))}…</small></span>${icon("chev")}</button>`);
      }
      found = hits.length ? `<div class="setlist">${hits.join("")}</div>` : `<p class="muted">No setting matches “${esc(ui.setQ)}”.</p>`;
    }
    return `<input type="search" class="setsearch" id="setQ" placeholder="Find a setting (e.g. Steam, backup, Gemini)" value="${esc(ui.setQ || "")}" data-input="setq" autocomplete="off">
      ${found || `<div class="setlist">${SET_GROUPS.map(g => `<button class="setrow" data-action="setgroup" data-v="${g[0]}"><span class="seticon">${icon(g[2])}</span><span class="grow"><b>${esc(g[1])}</b><small>${esc(g[3])}</small></span>${icon("chev")}</button>`).join("")}</div>
      <div style="text-align:center;margin-top:14px"><button class="btn quiet small" data-action="setgroup" data-v="*">Show every setting on one page</button></div>
      <p class="small muted" style="text-align:center;margin-top:10px">Saga ${VERSION}${Native.native ? "" : " (browser preview)"}</p>`}`;
  }

  // ============================================================ 4.0: across tabs, backups, Trakt, watch order
  const SH = BantaShell.shared;
  const feat = k => BantaShell.feature(k);
  const FEATURES = [
    ["games", "Games", "The Games section in the bar at the bottom"],
    ["books", "Books", "The Books section in the bar at the bottom"],
    ["dw", "Doctor Who timeline", "The fixed Doctor Who timeline (off until you switch it on)"],
    ["bookPrices", "Book price alerts", "Ebook prices and alerts for books you want to read"],
    ["gemini", "AI tools (Gemini)", "Off until you switch it on. Multiverse grouping, canon search, verification and news through the Gemini app or your API key, in every tab"],
    ["vpn", "Worldwide streaming (VPN)", "Where a title streams in other countries, and the VPN badge"],
    ["streamAlerts", "Streaming alerts", "Notify when something you're missing arrives on one of your services"],
    ["priceAlerts", "Game price alerts", "Notify when a game you want hits your target price or a big discount"],
    ["subs", "Game subscriptions", "Subscription tags and the subscription check in the Games tab"],
    ["trakt", "Mark on Trakt", "Buttons to mark watched or add to your watchlist on Trakt"],
    ["widget", "Home-screen widget", "Keep the widget's Up next list updated"],
  ];
  // index files the Games and Doctor Who tabs publish; re-read only when they change
  const xrow = (app, id, tab, title, sub, tag) => `<div class="item" data-action="xopen" data-app="${app}" data-id="${esc(id)}" data-tabid="${esc(tab || "")}">
      <span class="xic ${app}">${icon(app === "games" ? "pad" : app === "books" ? "book" : "box")}</span>
      <div class="grow"><div class="row"><b class="grow ell">${esc(title)}</b>${tag ? `<span class="pbadge">${esc(tag)}</span>` : ""}</div><div class="small muted ell">${sub}</div></div>${icon("chev")}</div>`;

  // "12 games (8 played) · 1,322 stories (410 done)" for a multiverse, plus the combined completion
  function crossLine(mv, canonHave, canonTotal) {
    const x = C.crossCounts(mv, gamesIdx(), dwIdx());
    const bits = [];
    let have = canonHave || 0, total = canonTotal || 0;
    if (x.games) { bits.push(`${fmt(x.games.n)} game${x.games.n === 1 ? "" : "s"} (${fmt(x.games.done)} played)`); have += x.games.done; total += x.games.n; }
    if (x.dw) { bits.push(`${fmt(x.dw.n)} stories (${fmt(x.dw.done)} done)`); have += x.dw.done; total += x.dw.n; }
    return bits.length ? { text: bits.join(" · "), pct: total ? Math.round(100 * have / total) : 0 } : null;
  }

  // ---- search across Canon, Games and Doctor Who
  function searchResults() {
    const res = C.searchAll(ui.allQ || "", status(), db.items(), gamesIdx(), dwIdx(), 60, booksIdx());
    ui.sres = res;
    if ((ui.allQ || "").trim().length < 2) return `<p class="small muted">Type at least two letters. Searches your canon and titles${gamesIdx() ? ", your games" : ""}${booksIdx() ? ", your books" : ""}${dwIdx() ? " and your Doctor Who stories" : ""}.</p>`;
    const q = L.norm(ui.allQ || "");
    const mine = lib.all().filter(it => L.norm(it.title).includes(q)).slice(0, 20);
    const online = `<div class="row wrap" style="margin-top:14px"><button class="btn small" data-action="searchweb" data-v="watch">${icon("missing")}Films & series online</button>${secOn("games") ? `<button class="btn small" data-action="searchweb" data-v="games">Steam</button>` : ""}${secOn("books") ? `<button class="btn small" data-action="searchweb" data-v="books">Books online</button>` : ""}</div>`;
    if (!res.length && !mine.length) return `<p class="muted">Nothing in your lists.</p>${online}`;
    return (mine.length ? `<div class="kicker" style="margin:6px 0">Your library</div>${Kit.grid(mine.map(it => Kit.tile({ title: it.title, img: it.poster, kind: it.type, done: it.status === "watched", attrs: `data-action="libopen" data-id="${esc(it.id)}"` }, it.title, LST[it.status])))}` : "") + (res.length ? `<div class="kicker" style="margin:16px 0 6px">Everywhere else</div>` : "") + res.map((r, i) => `<div class="item" data-action="sres" data-i="${i}"><span class="xic ${r.app}">${icon(r.app === "games" ? "pad" : r.app === "dw" ? "box" : r.app === "books" ? "book" : "missing")}</span>
      <div class="grow"><div class="row"><b class="grow ell">${esc(r.title)}</b><span class="pbadge">${({ canon: "Canon", games: "Games", dw: "Doctor Who", books: "Books" })[r.app]}</span></div>
      <div class="small muted ell">${esc(r.sub)}${r.done ? " · ✓ done" : r.state === "listed" ? " · on your list" : ""}</div></div>${icon("chev")}</div>`).join("") + online;
    // eslint-disable-next-line no-unreachable
    const LABEL = { canon: "Canon", games: "Games", dw: "Doctor Who", books: "Books" };
    return res.map((r, i) => `<div class="item" data-action="sres" data-i="${i}"><span class="xic ${r.app}">${icon(r.app === "games" ? "pad" : r.app === "dw" ? "box" : r.app === "books" ? "book" : "missing")}</span>
      <div class="grow"><div class="row"><b class="grow ell">${esc(r.title)}</b><span class="pbadge">${LABEL[r.app]}</span></div>
      <div class="small muted ell">${esc(r.sub)}${r.done ? " · ✓ done" : r.state === "listed" ? " · on your list" : ""}</div></div>${icon("chev")}</div>`).join("");
  }
  function openSearch() {
    $("#overlay").innerHTML = `<div class="scrim bottom" data-action="dismiss"><div class="sheet searchsheet" role="dialog" aria-modal="true">
      <label class="field"><span>Search all tabs</span><input type="search" data-input="allQ" value="${esc(ui.allQ || "")}" placeholder="Title, in any tab" autocomplete="off" autocapitalize="off"></label>
      <div id="allRes">${searchResults()}</div></div></div>`;
    const el = document.querySelector('[data-input="allQ"]');
    if (el) el.focus();
  }
  document.addEventListener("banta-search", openSearch);
  SH.onMessage(m => { if (m.search) openSearch(); });

  // ---- watch order of one multiverse
  function openOrder(mv, mode) {
    ui.order = { mv, mode: mode || (ui.order && ui.order.mv === mv ? ui.order.mode : "release") };
    const o = C.watchOrder(db, mv, status(), ui.order.mode);
    const have = o.rows.filter(c => c.have && c.state !== "listed").length;
    const x = crossLine(mv, have, o.rows.length);
    const via = db.get("gemini_key") ? "auto" : "app";
    $("#overlay").innerHTML = `<div class="scrim bottom" data-action="dismiss"><div class="sheet" role="dialog" aria-modal="true">
      <h3 style="margin:0">${esc(mv)}</h3>
      <p class="small muted" style="margin:2px 0 8px">${fmt(have)} of ${fmt(o.rows.length)} seen${x ? ` · ${esc(x.text)} · ${x.pct}% across all tabs` : ""}</p>
      <div class="chips"><button class="chip" data-action="ordermode" data-v="release" aria-pressed="${ui.order.mode === "release"}">Release order</button>
        <button class="chip" data-action="ordermode" data-v="chrono" aria-pressed="${ui.order.mode === "chrono"}">In-universe order</button></div>
      ${ui.order.mode === "chrono" ? (o.chrono
        ? `<p class="small muted" style="margin:8px 0 0">From Gemini${o.at ? `, ${esc(new Date(o.at).toLocaleDateString())}` : ""}; it can be wrong.${o.notes ? " " + esc(o.notes) : ""}${o.unplaced ? ` ${fmt(o.unplaced)} newer entries are at the end.` : ""}</p>`
        : `<p class="small muted" style="margin:8px 0 0">No in-universe order yet: showing release order.</p>`) : ""}
      ${ui.order.mode === "chrono" && feat("gemini") ? `<button class="btn small" style="margin-top:8px" data-action="orderget" data-via="${via}" ${ui.job ? "disabled" : ""}>${icon("spark")}${o.chrono ? "Ask Gemini again" : "Get the in-universe order from Gemini"}</button>` : ""}
      <div style="margin-top:8px">${o.rows.slice(0, 400).map((c, i) => row(c, "canon", { sub: `${i + 1}. ${esc(when(c))}${c.sub ? ` · ${esc(c.sub)}` : ""}`, tag: c.have && c.state !== "listed" ? "Seen" : c.state === "listed" ? "On your list" : "" })).join("")}</div>
    </div></div>`;
  }
  function orderGet(via) {
    const mv = ui.order.mv;
    const rows = C.watchOrder(db, mv, status(), "release").rows.slice(0, 300);
    closeOverlay();
    return runJob("Watch order", async p => {
      p(0.2, `Asking Gemini for the in-universe order of ${mv}`);
      const prompt = C.orderPrompt(mv, rows);
      let text;
      if (via === "app") text = await BantaAI.ask({ title: "In-universe order", note: `${mv} · ${rows.length} entries`, prompt, validate: v => { try { C.parseOrder(v, rows); return null; } catch (e) { return e.message + " Copy Gemini’s whole answer and paste it again."; } } });
      else { const prov = C.geminiProvider(db, Native.http, db.get("gemini_key"), db.get("gemini_model") || "auto", { search: true }); await prov.prepare(); text = await prov.call(prompt); }
      C.saveOrder(db, mv, C.parseOrder(text, rows));
      ui.order.mode = "chrono";
      setTimeout(() => openOrder(mv, "chrono"), 50);
      return `In-universe order saved for ${mv}`;
    });
  }

  // ---- Trakt: mark watched / add to watchlist
  async function traktDo(c, action) {
    toast(action === "history" ? `Marking ${c.title} watched on Trakt…` : `Adding ${c.title} to your Trakt watchlist…`);
    try {
      await C.traktPush(db, Native.http, c, action);
      toast(action === "history" ? `Marked watched on Trakt: ${c.title}` : `On your Trakt watchlist: ${c.title}`);
    } catch (e) { toast(e.cancelled ? "Stopped" : `Trakt: ${e.message}`); }
  }

  // ---- backups of everything (Canon + the latest snapshot each other tab published)
  function featureSection() {
    return `<section class="stack">
        <h2 id="features">Features</h2>
        <p class="small muted">Switch off what you don't use. Applies to every tab.</p>
        ${FEATURES.map(([k, label, hint]) => `<label class="switch"><input type="checkbox" data-feature="${k}" ${feat(k) ? "checked" : ""}><span>${label}<small class="muted" style="display:block">${hint}</small></span></label>`).join("")}
      </section>`;
  }


  // ---- language, and the import hub for every other tracking site
  function generalSection() {
    const l = lang();
    return `<section class="stack">
        <h2>Look</h2>
        <div class="themepick">${THEMES.map(([k, l, bg, fg]) => `<button data-action="theme" data-v="${k}" aria-pressed="${(lsGet("saga_theme") || "night") === k}" style="background:${bg};color:${fg}">${l}</button>`).join("")}</div>
        <label class="field"><span>Accent colour</span><select data-accent="1">${ACCENTS.map(([k, l]) => `<option value="${k}" ${(lsGet("saga_accent") || "") === k ? "selected" : ""}>${l}</option>`).join("")}</select></label>
        <label class="switch"><input type="checkbox" data-textsize="1" ${lsGet("saga_text") === "large" ? "checked" : ""}><span>Larger text</span></label>
      </section>
      <section class="stack">
        <h2>Language</h2>
        <label class="field"><span>App language</span><select data-lang="1">
          <option value="en" ${l === "en" ? "selected" : ""}>English</option><option value="it" ${l === "it" ? "selected" : ""}>Italiano</option></select></label>
        <p class="small muted">Applies to every tab. In Italian, searches also bring Italian titles and descriptions where the source has them.</p>
        <label class="switch"><input type="checkbox" data-setting="lib_adopt" ${db.get("lib_adopt", "1") === "1" ? "checked" : ""}><span>Add titles from IMDb and Trakt to my library<small class="muted" style="display:block">After each sync or import. A title you remove from the library stays out.</small></span></label>
      </section>`;
  }
  const HUB = [
    ["Letterboxd", "letterboxd.com › Settings › Data › Export your data. Pick the ZIP: diary, ratings, rewatches and watchlist come in with their dates."],
    ["Trakt", "Sync above, or trakt.tv › Settings › Data › Export (ZIP)."],
    ["IMDb", "Sync above, or imdb.com › Your ratings / Watchlist / a list › Export (CSV)."],
    ["TV Time", "Request your data (GDPR) from TV Time support; pick the ZIP or its seen_episode CSV."],
    ["Simkl", "simkl.com › Settings › Data › Export (CSV or JSON)."],
    ["MyAnimeList / AniList", "myanimelist.net › Export (animelist .xml.gz, manga too). AniList: Settings › Import/Export › Export as MAL XML."],
    ["Serializd, JustWatch, spreadsheets", "Any CSV with a Title column (Year, Type, Status, Rating, Date and IMDb ID are used when present)."],
    ["Refract", "Settings › Export Data (ZIP)."],
    ["HowLongToBeat", "howlongtobeat.com › your profile › Options › Export (CSV): goes to Games."],
    ["Grouvee, Backloggd", "Grouvee › Settings › Export (CSV). Backloggd has no export: a CSV made with a browser extension or spreadsheet works."],
    ["Steam", "Your public Steam profile: type the profile link below (or set it in Accounts and sync, with a Web API key, to sync every time)."],
    ["Netflix", "netflix.com › Account › your profile › Viewing activity › Download all (CSV): films with dates, series you've watched."],
    ["Kitsu, Anime-Planet", "Their export as MAL XML: goes to the library and Books like a MyAnimeList export."],
    ["Goodreads, StoryGraph, LibraryThing, Libib, BookWyrm", "Their CSV / TSV / JSON exports: go to Books."],
  ];
  function importHub() {
    return `<section class="stack" id="importhub">
        <h2>Import from other apps</h2>
        <p class="small muted">Pick an export file from any of these. It's recognised automatically and goes to the right tab: films and series to your library, games to Games, books to Books. Nothing you already have is overwritten.</p>
        <button class="btn primary block" data-action="hubpick" ${ui.job ? "disabled" : ""}>${icon("upload")}Choose export files</button>
        <div class="row"><input class="grow" type="text" id="steamProfile" placeholder="Steam profile link or name" autocomplete="off" autocapitalize="off" value="${esc(db.get("steam_profile", ""))}">
          <button class="btn" data-action="hubsteam" ${ui.job ? "disabled" : ""}>Import Steam</button></div>
        <details class="report"><summary>Where to get each export</summary>${HUB.map(([n, t]) => `<p class="small"><b>${esc(n)}</b> · ${esc(t)}</p>`).join("")}</details>
        ${db.get("hub_last") ? `<p class="small muted" style="margin:0">${esc(db.get("hub_last"))}</p>` : ""}
      </section>`;
  }
  // games and books are handed to their tabs through a shared file and a message
  // games and books go straight into their sections
  function handOver(app, file, payload) {
    if (app === "games") { const r = GC.importRows(games, payload.rows || [], payload.kind); games.save(); changed("games"); return r; }
    const imp = payload.rows ? { kind: payload.kind, books: payload.rows.map(r => BC.blankBook(Object.assign({}, r, { finished: r.finished ? Date.parse(r.finished + "T12:00:00") : 0, started: r.started ? Date.parse(r.started + "T12:00:00") : 0 }))) } : BC.readImport(payload.raw, payload.name);
    const r = BC.applyImport(books, imp, "merge"); books.save(); changed("books"); return r;
  }
  async function hubImport(files) {
    const lines = [], canonFiles = [];
    let watchRows = [];
    for (const f of files) {
      if (f.error) { lines.push(`${f.name}: couldn't read (${f.error})`); continue; }
      let d;
      try { d = Imports.detect(f); } catch (e) { lines.push(`${f.name}: ${e.message}`); continue; }
      if (d.target === "watch") {
        watchRows = watchRows.concat(d.rows || []);
        lines.push(`${d.kind}: ${fmt((d.rows || []).length)} films and series`);
        if (d.books && d.books.length && secOn("books")) { handOver("books", "", { rows: d.books, kind: "MyAnimeList manga" }); lines.push(`MyAnimeList manga: ${fmt(d.books.length)} to Books`); }
      } else if (d.target === "games") {
        if (!feat("games")) { lines.push(`${d.kind}: switch the Games tab on in Features first`); continue; }
        const gr = handOver("games", "", { rows: d.rows, kind: d.kind });
        lines.push(`${d.kind}: ${fmt(gr.added)} games added, ${fmt(gr.updated)} updated`);
      } else if (d.target === "books") {
        if (!feat("books")) { lines.push(`${d.kind}: switch the Books tab on in Features first`); continue; }
        const br = handOver("books", "", d.rows ? { rows: d.rows, kind: d.kind } : { raw: d.raw, name: d.name, kind: d.kind });
        lines.push(`${d.kind}: ${fmt(br.added || 0)} books added${br.updated ? `, ${fmt(br.updated)} updated` : ""}`);
      } else if (d.target === "canon") canonFiles.push([d.kind, f]);
      else lines.push(`${f.name}: not recognised`);
    }
    if (watchRows.length) {
      const r = lib.merge(watchRows);
      libSave();
      lines.push(`Library: ${fmt(r.added)} added, ${fmt(r.updated)} updated`);
      lib.all().filter(x => x.type === "show" && (x.epsPending || x.upToPending)).slice(0, 8).forEach(x => libDetails(x));
    }
    for (const [kind, f] of canonFiles) {
      try {
        let n = 0;
        if (kind === "trakt") n = C.importTraktZip(db, f.zip);
        else if (kind === "refract") n = C.importRefract(db, f.zip, f.zipOther || []).total;
        else if (kind === "imdb") n = C.importImdbCsv(db, f.name, f.text, "auto");
        else n = C.importFranchiseFile(db, f.name, f.text);
        lines.push(`${f.name}: ${fmt(n)} records (${kind === "file" ? "franchise mapping" : kind})`);
      } catch (e) { lines.push(`${f.name}: ${e.message}`); }
    }
    if (canonFiles.length) { libAdopt(); invalidate(); }
    db.set("hub_last", `Last import ${new Date().toLocaleDateString()}: ${lines.join(" · ")}`);
    db.flush();
    return lines;
  }
  async function hubSteam() {
    const v = (($("#steamProfile") || {}).value || "").trim();
    const url = Imports.steamProfileUrl(v);
    if (!url) return toast("Type your Steam profile link or name");
    db.set("steam_profile", v);
    await runJob("Import", async () => {
      const rows = await Imports.steamLibrary(C.robust(Native.http, { timeout: 30000, tries: 2 }), v, db.get("steam_key"));
      const ggr = handOver("games", "", { rows, kind: "Steam library" });
      db.set("steam_sync_at", String(Date.now()));
      db.set("hub_last", `Last import ${new Date().toLocaleDateString()}: Steam, ${fmt(ggr.added)} games added, ${fmt(ggr.updated)} updated`);
      return `Steam: ${fmt(ggr.added)} games added, ${fmt(ggr.updated)} already there`;
    });
  }
  // ---- home-screen widget
  // Six widgets, each with its own file (heading, optional button "@@label<TAB>payload", then lines). Android draws them.
  const widgetCache = {};
  const wday = d => { const x = new Date(d + "T12:00:00"); return d === TODAY() ? "Today" : x.toLocaleDateString(lang() === "it" ? "it-IT" : "en-GB", { weekday: "short", day: "numeric", month: "short" }); };
  function widgetFiles() {
    const ne = nextEpisodes();
    const f = {};
    f["widget.txt"] = (ne[0] ? `▶ ${ne[0].lib ? ne[0].it.title : ne[0].show} · S${ne[0].s} E${ne[0].e}\n` : "") + C.widgetText(status(), gamesIdx(), dwIdx(), undefined, booksIdx());
    // next episodes, with a Mark watched button for the first
    const first = ne.find(x => x.lib);
    const epLines = ne.slice(0, 7).map(x => `${x.lib ? x.it.title : x.show} · S${x.s} E${x.e}${x.left > 1 ? `  (+${x.left - 1})` : ""}`);
    f["widget_episodes.txt"] = `Next episodes${ne.length > 7 ? ` · ${ne.length} series` : ""}\n` +
      (first ? `@@✓ ${first.it.title.slice(0, 22)} S${first.s}E${first.e}\t${JSON.stringify({ op: "ep", id: first.it.id, s: first.s, e: first.e, at: "__NOW__" })}\n` : "@@\n") +
      (epLines.join("\n") || "Nothing to catch up on. Series you're watching show up here.");
    // the next three weeks: episodes of your series, canon releases, games
    const today = TODAY(), until = new Date(Date.now() + 21 * 864e5).toISOString().slice(0, 10), up = [];
    for (const it of lib.all()) if (it.type === "show" && it.status !== "dropped" && it.epl) {
      const x = it.epl.find(e => e[2] && e[2] >= today && e[2] <= until);
      if (x) up.push([x[2], `${it.title} S${x[0]} E${x[1]}`]);
    }
    for (const c of C.releaseList(status(), today).upcoming.filter(c => c.date && c.date <= until).slice(0, 8)) up.push([c.date, c.title]);
    if (secOn("games")) for (const g of games.upcoming(today).filter(g => g.date <= until)) up.push([g.date, `🎮 ${g.title}`]);
    up.sort((a, b) => a[0].localeCompare(b[0]));
    f["widget_upcoming.txt"] = `Coming up · 3 weeks\n@@\n` + (up.slice(0, 8).map(([d, t]) => `${wday(d)} · ${t}`).join("\n") || "Nothing out in the next three weeks.");
    // games: what you're playing, price alerts, backlog size
    if (secOn("games")) {
      const vis = games.visible(), playing = vis.filter(g => g.status === "playing");
      const deals = vis.filter(g => g.status !== "done" && g.price && ((g.target != null && g.price.eur <= g.target) || g.price.disc >= 50)).slice(0, 3);
      f["widget_games.txt"] = `Games · ${vis.filter(g => g.status === "backlog").length} in backlog\n@@\n` +
        [...playing.slice(0, 4).map(g => `▶ ${g.title}`), ...deals.map(g => `€ ${g.title} ${g.price.eur.toFixed(2)}${g.price.disc ? ` (−${g.price.disc}%)` : ""}`)].join("\n") || "Mark a game as Playing to see it here.";
    } else f["widget_games.txt"] = "Games\n@@\nSwitch the Games tab on in Settings.";
    // books you're reading, with how far along
    if (secOn("books")) {
      const rd = books.books.filter(b => b.status === "reading");
      f["widget_books.txt"] = `Reading${rd.length > 5 ? ` · ${rd.length}` : ""}\n@@\n` + (rd.slice(0, 5).map(b => {
        const p = BC.percent ? BC.percent(b) : 0;
        return `${b.title}${p ? ` · ${Math.round(p)}%` : b.chapter ? ` · ch. ${b.chapter}` : ""}`;
      }).join("\n") || "Nothing on the go. Start a book to see it here.");
    } else f["widget_books.txt"] = "Reading\n@@\nSwitch the Books tab on in Settings.";
    // the year so far
    const y = new Date().getFullYear(), c = yearCounts(y);
    f["widget_year.txt"] = `${y} so far\n@@\n` + [`${fmt(c.films)} films · ${fmt(c.episodes)} episodes`, `${fmt(c.hours)} h watching`,
      secOn("games") ? `${fmt(c.games)} games finished` : "", secOn("books") ? `${fmt(c.books)} books · ${fmt(c.pages)} pages` : "",
      c.top[0] ? `Top: ${c.top[0].t} ★${c.top[0].r / 2}` : ""].filter(Boolean).join("\n");
    return f;
  }
  function updateWidget() {
    if (!feat("widget") || !SH.native()) return;
    let changed = false;
    let files;
    try { files = widgetFiles(); } catch (e) { return; }
    for (const [name, t] of Object.entries(files)) {
      if (widgetCache[name] === t) continue;
      widgetCache[name] = t;
      if (SH.read(name) !== t) { SH.write(name, t); changed = true; }
    }
    if (changed) SH.widget();
  }

  // ------------------------------------------------------------ render & nav
  // ------------------------------------------------------------ your library: films and series you track here
  const L = window.Lib;
  const lib = new L.Library({ load: () => Native.load("library.json"), save: t => Native.save("library.json", t) });
  let libStamp = window.Android && Android.stamp ? String(Android.stamp("library.json") || "") : "";
  const lang = () => (BantaShell.lang ? BantaShell.lang() : "en");
  const libOpt = () => ({ tmdbKey: db.get("tmdb_key"), lang: lang(), country: db.get("region", "IT") });
  const TODAY = () => new Date().toISOString().slice(0, 10);
  const shortDay = d => (d ? new Date(d + "T12:00:00").toLocaleDateString(lang() === "it" ? "it-IT" : "en-GB", { day: "numeric", month: "short", year: "numeric" }) : "date unknown");
  // the sync store gets a copy (source "app"), so the canon finder counts what you track here
  function libMirror() {
    for (const [k, r] of db.itemsMap) if (r.source === "app") db.itemsMap.delete(k);
    const rows = lib.dbRows();
    db.addItems(rows.watched, "app", "watched");
    db.addItems(rows.watchlist, "app", "watchlist", "Library");
    invalidate();
  }
  function libSave() {
    lib.save();
    libStamp = window.Android && Android.stamp ? String(Android.stamp("library.json") || "") : "";
    libMirror();
    db.touch();
    if (typeof changed === "function") changed("watch");
    if (typeof pushSoon === "function") pushSoon();
  }
  // titles from the IMDb / Trakt sync join the library once (on by default; Settings can switch it off)
  // Episode ratings into the library: from Trakt (exact season and episode), from IMDb's ratings page, and from the IMDb
  // CSV, whose episode rows only say "Series: Episode title", so those are matched by name against the episode list.
  // A rating you gave in Saga itself is never overwritten.
  // ---- your IMDb and Trakt lists: which ones count as "to watch" and come into the library as Watchlist
  function syncedLists() {
    const m = new Map();
    for (const r of db.items(null, ["list"])) {
      if (r.source === "app") continue;
      const k = `${r.source}|${r.list_name || ""}`;
      const e = m.get(k) || { source: r.source, name: r.list_name || "", n: 0, games: 0 };
      e.n++; if (r.medium === "Video Game") e.games++;
      m.set(k, e);
    }
    return [...m.values()].sort((a, b) => a.source.localeCompare(b.source) || a.name.localeCompare(b.name));
  }
  let listMemo = null; // { st, lists } for one library pass; cleared when the pass ends
  function listOn(source, name) {
    if (listMemo) { const k = `${source}|${name || ""}`; if (k in listMemo.on) return listMemo.on[k]; return (listMemo.on[k] = listOnRaw(source, name, listMemo.lists)); }
    return listOnRaw(source, name);
  }
  function listOnRaw(source, name, lists) {
    let st = {};
    try { st = JSON.parse(db.get("lib_lists", "{}")) || {}; } catch (e) { st = {}; }
    const k = `${source}|${name || ""}`;
    if (k in st) return !!st[k];
    // by default: lists named like a to-watch list, and IMDb lists made mostly of films and series (not games);
    // lists for other people ("x Mamma") and game lists stay out until you switch them on
    if (/^x\s/i.test(name || "")) return false;
    if (/watch|anime|vedere|guardare|serie|film|movie/i.test(name || "")) return true;
    if (source === "imdb") { const l = (lists || syncedLists()).find(x => x.source === source && x.name === name); return !!l && l.games < l.n / 2; }
    return false;
  }
  function listsHtml() {
    const ls = syncedLists();
    if (!ls.length) return "";
    return `<section class="stack"><h2 id="liblists">Lists that go into the library</h2>
      <p class="small muted" style="margin:0">Titles on a switched-on list come into the library as Watchlist. Game lists go to the Games tab either way.</p>
      ${ls.map(l => `<label class="switch"><input type="checkbox" data-action="listlib" data-k="${esc(l.source + "|" + l.name)}" ${listOn(l.source, l.name) ? "checked" : ""} ${l.games === l.n ? "disabled" : ""}><span>${esc(l.source === "imdb" ? "IMDb" : l.source === "trakt" ? "Trakt" : l.source)} · ${esc(l.name || "list")} <small class="muted">${fmt(l.n)} titles${l.games ? `, ${fmt(l.games)} games` : ""}</small></span></label>`).join("")}</section>`;
  }
  // ---- title lookup: every record of a title and what happened to it
  function lookupRows(q) {
    const n = L.norm(q);
    if (n.length < 2) return null;
    const recs = db.items(null, null).filter(r => L.norm(r.title).includes(n)).slice(0, 60);
    const libs = lib.all().filter(it => L.norm(it.title).includes(n) || L.norm(it.orig || "").includes(n)).slice(0, 30);
    const gms = secOn("games") ? games.visible().filter(g => L.norm(g.title).includes(n)).slice(0, 10) : [];
    const rows = recs.map(r => {
      const base = `${r.source}${r.kind ? " " + r.kind : ""}${r.list_name ? " (" + r.list_name + ")" : ""} · ${r.medium}${r.year ? " · " + r.year : ""}${r.rating ? " · ★" + r.rating : ""}${r.imdb ? " · " + r.imdb : ""}`;
      if (r.medium === "Video Game") return { r, base, verdict: gms.some(g => L.norm(g.title) === L.norm(r.title)) ? "in Games" : "a game: goes to the Games tab at the next sync", act: "" };
      if (r.medium === "Episode") return { r, base, verdict: "an episode: its rating shows on the series' episode list", act: "" };
      if (r.kind === "collection") return { r, base, verdict: "in your Trakt collection only (collections don't go into the library)", act: "" };
      if (r.kind === "list" && !listOn(r.source, r.list_name)) return { r, base, verdict: `on the list “${r.list_name}”, which isn't switched on for the library`, act: `<button class="btn small" data-action="listlib" data-k="${esc(r.source + "|" + (r.list_name || ""))}" data-on="1">Switch the list on</button>` };
      const o = { type: r.medium === "TV Series" ? "show" : "movie", title: r.title, year: r.year || null, imdb: r.imdb || null, tmdb: r.tmdb ? +r.tmdb : null };
      const it = lib.find(o), key = L.adoptKey(o);
      if (it) return { r, base, verdict: `in the library as “${it.title}”${it.year ? ` (${it.year})` : ""}: ${LST[it.status] || it.status}${it.rating ? `, ★${it.rating}` : ", no rating"}${it.ratedHere ? " (rated in Saga, so imports don't change it)" : ""}`, act: `<button class="btn quiet small" data-action="libopen" data-id="${esc(it.id)}">Open</button>` };
      if (lib.adopted[key]) return { r, base, verdict: "you removed it from the library, so syncs leave it out", act: `<button class="btn small" data-action="lookback" data-k="${esc(key)}">Bring back</button>` };
      return { r, base, verdict: db.get("lib_adopt", "1") === "1" ? "not brought in yet" : "not brought in: adding synced titles is off in Settings", act: `<button class="btn small" data-action="lookback" data-k="${esc(key)}">Bring in now</button>` };
    });
    return { rows, libs: libs.filter(it => !rows.some(x => x.verdict.includes(`“${it.title}”`))), gms };
  }
  function lookupHtml(q) {
    const res = lookupRows(q || "");
    if (!res) return "";
    if (!res.rows.length && !res.libs.length && !res.gms.length) return `<p class="small">No record of “${esc(q)}” from any sync or import. It isn't on IMDb or Trakt under that name, or that list hasn't synced yet.</p>`;
    return `<div class="errlog">${res.rows.map(x => `<div><small>${esc(x.base)}</small><b>${esc(x.r.title)}</b>: ${esc(x.verdict)} ${x.act}</div>`).join("")}
      ${res.libs.map(it => `<div><small>library only (added in Saga or from ${esc(it.src || "an import")})</small><b>${esc(it.title)}</b>${it.year ? ` (${it.year})` : ""}: ${esc(LST[it.status] || it.status)}${it.rating ? `, ★${it.rating}` : ""} <button class="btn quiet small" data-action="libopen" data-id="${esc(it.id)}">Open</button></div>`).join("")}
      ${res.gms.map(g => `<div><small>Games tab</small><b>${esc(g.title)}</b>: ${esc(g.status)}${g.rating ? `, ★${g.rating}` : ""}</div>`).join("")}</div>`;
  }
  function libTotals() {
    const t = { titles: 0, rated: 0, er: 0, eps: 0 };
    for (const it of lib.all()) { t.titles++; if (it.rating) t.rated++; if (it.er) t.er += Object.keys(it.er).length; t.eps += Object.keys(it.eps).length; }
    return t;
  }
  function adoptEpRatings(ieps) {
    let n = 0;
    const shows = lib.all().filter(x => x.type === "show");
    const byImdb = new Map(), byTmdb = new Map(), byName = new Map();
    for (const x of shows) { if (x.imdb) byImdb.set(x.imdb, x); if (x.tmdb) byTmdb.set(String(x.tmdb), x); const k = L.norm(x.title); if (!byName.has(k)) byName.set(k, x); if (x.orig) { const o = L.norm(x.orig); if (!byName.has(o)) byName.set(o, x); } }
    const put = (it, k, r) => { it.er = it.er || {}; if (!it.er[k] && r && !(it.erMine && it.erMine[k])) { it.er[k] = +r; n++; } };
    let tr = {};
    try { tr = JSON.parse(db.get("ep_ratings", "{}")) || {}; } catch (e) { tr = {}; }
    for (const p of Object.values(tr)) {
      const it = (p.tmdb && byTmdb.get(String(p.tmdb))) || (p.imdb && byImdb.get(p.imdb)) || byName.get(L.norm(p.t || ""));
      if (it) for (const [k, r] of Object.entries(p.r || {})) put(it, k, r);
    }
    for (const [sid, p] of Object.entries(ieps || {})) {
      const it = byImdb.get(sid) || byName.get(L.norm(p.t || ""));
      if (it) for (const [k, r] of Object.entries(p.r || {})) put(it, k, r);
    }
    const stamp = db.stamp ? db.stamp() : 0;
    if (adoptEpRatings.at !== stamp || !stamp) {
      adoptEpRatings.at = stamp;
      const epIx = new Map(); // show -> episode name -> "s:e"
      for (const r of db.items("imdb", ["rated"])) {
        if (r.medium !== "Episode" || !r.rating) continue;
        const cut = String(r.title).indexOf(": ");
        if (cut < 1) continue;
        const it = byName.get(L.norm(r.title.slice(0, cut)));
        if (!it || !it.epl || !it.epl.length) continue;
        let ix = epIx.get(it);
        if (!ix) { ix = new Map(); for (const x of it.epl) if (x[3]) { const k = L.norm(x[3]); ix.set(k, ix.has(k) ? null : L.epKey(x[0], x[1])); } epIx.set(it, ix); }
        const k = ix.get(L.norm(r.title.slice(cut + 2)));
        if (k) { put(it, k, r.rating); if (!it.eps[k] && it.status !== "watchlist") { it.eps[k] = (r.rated_at || r.date || TODAY()).slice(0, 10); n++; } }
      }
    }
    return n;
  }
  function libAdopt() {
    if (db.get("lib_adopt", "1") !== "1") return 0;
    listMemo = { on: {}, lists: syncedLists() };
    let rows;
    try { rows = db.items(null, ["watched", "rated", "watchlist", "list"]).filter(r => r.source !== "app" && (r.kind !== "list" || listOn(r.source, r.list_name))); } finally { listMemo = null; }
    const n = lib.adopt(rows);
    // episodes you've watched on Trakt, with the day you watched each one, merged into the library every time
    let prog = {}, changed = 0;
    try { prog = JSON.parse(db.get("trakt_progress", "{}")) || {}; } catch (e) { prog = {}; }
    for (const [tmdbId, p] of Object.entries(prog)) {
      let it = lib.all().find(x => x.type === "show" && ((x.tmdb && String(x.tmdb) === String(tmdbId)) || (p.imdb && x.imdb === p.imdb)));
      if (!it) it = lib.all().find(x => x.type === "show" && L.norm(x.title) === L.norm(p.t) && (!p.y || !x.year || Math.abs(x.year - p.y) <= 1));
      if (!it) { if (lib.adopted[p.imdb || `show|${L.norm(p.t)}|${p.y || ""}`]) continue; it = lib.add({ type: "show", title: p.t, year: p.y || null, imdb: p.imdb || null, tmdb: +tmdbId || null, src: "trakt" }, "watching").item; }
      if (!it.tmdb && +tmdbId) it.tmdb = +tmdbId;
      const fallback = (p.last || "").slice(0, 10);
      for (const [sn, nums] of Object.entries(p.eps || {})) for (const e of nums) {
        const k = L.epKey(+sn, e);
        if (!it.eps[k]) { it.eps[k] = (p.d && p.d[k]) || fallback; changed++; }
      }
      if (it.status === "watchlist" || (it.status === "watched" && !lib.caughtUp(it) && it.epl)) it.status = "watching";
    }
    // episodes you rated on IMDb count as watched (IMDb keeps no other episode progress)
    let ieps = {};
    try { ieps = JSON.parse(db.get("imdb_eps", "{}")) || {}; } catch (e) { ieps = {}; }
    for (const [sid, p] of Object.entries(ieps)) {
      let it = lib.all().find(x => x.type === "show" && x.imdb === sid);
      if (!it && p.t) it = lib.all().find(x => x.type === "show" && L.norm(x.title) === L.norm(p.t) && (!p.y || !x.year || Math.abs(x.year - p.y) <= 1));
      if (!it) { if (!p.t || lib.adopted[sid]) continue; it = lib.add({ type: "show", title: p.t, year: p.y || null, imdb: sid, src: "imdb" }, "watching").item; }
      if (!it.imdb) it.imdb = sid;
      for (const [k, d] of Object.entries(p.eps || {})) if (!it.eps[k]) { it.eps[k] = typeof d === "string" ? d : TODAY(); changed++; }
      if (it.status === "watchlist") it.status = "watching";
    }
    changed += adoptEpRatings(ieps);
    // a series marked watched elsewhere but with no episodes yet waits in Watching, unless it's known to have ended
    lib.all().forEach(it => { if (it.type === "show" && it.status === "watched" && !it.ended && !Object.keys(it.eps).length && !it.watches.length) { it.status = "watching"; it.autoWatching = true; } });
    changed += lib.settleAll();
    for (const it of lib.all()) if (it.status === "watchlist" && it.type === "movie" && seenElsewhere(it)) { it.status = "watched"; changed++; }
    if (n || changed) libSave();
    return n;
  }
  function libThumb(it, big) {
    const cls = `thumb${big ? " big" : ""}`;
    if (it.poster) return `<img class="${cls}" loading="lazy" src="${esc(httpsUrl(it.poster))}" alt="" data-fb="ph" data-fbc="thumb ph ${it.type === "show" ? "series" : "movie"}${big ? " big" : ""}" data-fbt="${esc(initials(it.title))}">`;
    return `<div class="${cls} ph ${it.type === "show" ? "series" : "movie"}" aria-hidden="true">${esc(initials(it.title))}</div>`;
  }
  const typeTag = it => medTag(it.type === "show" ? "TV Series" : "Movie");
  const LST = { watchlist: "Watchlist", watching: "Watching", watched: "Watched", dropped: "Dropped" };
  const timesTxt = n => (n > 1 ? `${n}×` : "");
  function libSub(it) {
    const bits = [];
    if (it.year) bits.push(it.year);
    bits.push(it.type === "movie" && it.watches.length > 1 ? `Watched ${it.watches.length}×` : LST[it.status]);
    if (it.type === "show" && it.watches.length) bits.push(`${it.watches.length} full run${it.watches.length === 1 ? "" : "s"}`);
    return bits.map(b => `<span>${esc(b)}</span>`).join(" · ");
  }
  function libRow(it, opts = {}) {
    const n = it.type === "show" && it.status !== "watched" && !opts.noNext ? lib.nextEp(it) : null;
    const nline = n ? (n.upcoming ? (n.date ? `Next: S${n.s} E${n.e} on ${esc(shortDay(n.date))}` : `S${n.s} E${n.e} not out yet`) : `Next: S${n.s} E${n.e}${n.left > 1 ? ` · ${n.left} to watch` : ""}`) : "";
    return `<div class="item" data-action="libopen" data-id="${esc(it.id)}">${libThumb(it)}
      <div class="grow body"><div class="ttl"><b>${esc(it.title)}</b></div>
        <div class="sub">${typeTag(it)}<span class="muted ellipsis">${opts.sub || libSub(it)}</span></div>
        ${nline ? `<div class="sub"><span class="small ellipsis" style="color:var(--action)">${nline}</span></div>` : ""}</div>
      ${opts.trail || (it.rating ? `<span class="pct">★ ${it.rating}</span>` : "")}</div>`;
  }
  function libResultRow(r, i) {
    const have = lib.find(r);
    return `<div class="item" data-action="libpeek" data-i="${i}">${libThumb(r)}
      <div class="grow body"><div class="ttl"><b>${esc(r.title)}</b></div>
        <div class="sub">${typeTag(r)}<span class="muted ellipsis">${esc([r.year, r.network, r.orig && r.orig !== r.title ? r.orig : ""].filter(Boolean).join(" · "))}</span></div>
        ${have ? `<div class="sub"><span class="small" style="color:var(--ok)">In your library · ${esc(LST[have.status])}</span></div>` : ""}</div>
      ${have ? icon("chev") : `<button class="seen" data-action="libadd" data-i="${i}" data-v="watchlist" aria-label="Add ${esc(r.title)} to your watchlist">${icon("plus")}</button>`}</div>`;
  }
  function libTile(it) {
    const n = it.type === "show" && it.status === "watching" ? lib.nextEp(it) : null;
    const s = ui.libF === "watchlist" || ui.libF === "services" ? streamsFor(it) : null;
    const badge = n ? (n.upcoming ? (n.date ? shortDay(n.date).replace(/ \d{4}$/, "") : "Soon") : `S${n.s} E${n.e}`) : s && s.mine ? shortName(s.o.name) : s && s.vpn ? `VPN ${s.vpn.flag}` : "";
    return Kit.tile({ key: "lib:" + it.id, title: it.title, img: it.poster, kind: it.type, badge, badgeAcc: !!(n && !n.upcoming) || !!(s && s.mine), badgeR: it.type === "movie" && it.watches.length > 1 ? `${it.watches.length}×` : it.rating ? `★ ${it.rating / 2}` : "",
      progress: it.type === "show" && it.status === "watching" ? progressOf(it) : null, done: it.status === "watched", attrs: `data-action="libopen" data-id="${esc(it.id)}"` },
      it.title, [it.year, it.type === "show" ? "Series" : "Film"].filter(Boolean).join(" · "));
  }
  function renderAnime() { return renderLibrary(true); }
  function renderLibrary(anime) {
    anime = anime === true;
    const all = lib.all().filter(it => !!it.anime === anime), c = lib.counts();
    for (const k of ["all", "watchlist", "watching", "watched", "dropped", "movie", "show"]) c[k] = 0;
    c.eps = 0; c.rewatches = 0;
    for (const it of all) { c.all++; c[it.status]++; c[it.type]++; c.eps += Object.keys(it.eps).length; if (it.watches.length > 1) c.rewatches += it.watches.length - 1; }
    const ty = ui.libType || "all";
    const head = `<div class="toolbar"><input type="search" data-input="libQ" value="${esc(ui.libQ || "")}" placeholder="${anime ? "Search anime on MyAnimeList" : "Search any film or series to add"}" autocomplete="off" enterkeyhint="search">
        <button class="btn primary" data-action="libsearch" ${ui.libBusy ? "disabled" : ""} aria-label="Search">${icon("missing")}</button></div>`;
    if (ui.libRes || ui.libBusy) {
      const res = (ui.libRes || []).filter(r => ty === "all" || r.type === ty);
      return head + `<div class="chips" style="margin-bottom:12px">${[["all", "Films & series"], ["movie", "Films"], ["show", "Series"]].map(([k, l]) => `<button class="chip" data-action="libtype" data-v="${k}" aria-pressed="${ty === k}">${l}</button>`).join("")}</div>
        <div class="sechead"><h2>${ui.libBusy ? "Searching…" : `${res.length} result${res.length === 1 ? "" : "s"}`}</h2><button class="btn quiet small" data-action="libclear">Back to your library</button></div>
        ${ui.libBusy ? "" : res.length ? Kit.grid(res.map(r => { const i = ui.libRes.indexOf(r), have = lib.find(r); return Kit.tile({ title: r.title, img: r.poster, kind: r.type, badge: have ? LST[have.status] : "", done: have && have.status === "watched", attrs: `data-action="libpeek" data-i="${i}"` }, r.title, [r.year, r.type === "show" ? "Series" : "Film", r.network].filter(Boolean).join(" · ")); })) : `<p class="muted">Nothing found for “${esc(ui.libQ)}”.</p>`}
        <p class="small muted" style="margin-top:14px">${anime ? "Results from MyAnimeList." : db.get("tmdb_key") ? "Results from TMDB." : "Results from TVmaze (series) and iTunes (films). A free TMDB key in Settings gives better matches and Italian titles."}</p>`;
    }
    if (!all.length) {
      if (anime) return head + `<div class="empty2"><div class="kicker">Anime</div><h2>Your anime, separately</h2>
        <p>Search MyAnimeList above to add series and films, tick episodes as they air, and import your MyAnimeList or AniList list. Anime already in your library shows up here once it's recognised (Japanese animation on TMDB, TVmaze or MyAnimeList), or mark one yourself from its page.</p>
        <div class="row wrap" style="justify-content:center"><button class="btn" data-action="go" data-sec="settings" data-scroll="importhub">${icon("upload")}Import MyAnimeList / AniList</button></div></div>`;
      return head + `<div class="empty2"><div class="kicker">Library</div><h2>Track every film and series</h2>
        <p>Search above to add titles. Mark what you've seen, keep a watchlist, tick episodes as you go and log every rewatch with its date.</p>
        <div class="row wrap" style="justify-content:center"><button class="btn" data-action="go" data-sec="settings" data-scroll="importhub">${icon("upload")}Import from another app</button>
        ${db.items().length ? `<button class="btn" data-action="libadoptnow">${icon("sync")}Add my IMDb and Trakt titles</button>` : ""}</div></div>`;
    }
    const f = ui.libF || (c.watching ? "watching" : "all");
    const sorters = { recent: (a, b) => (b.updated || 0) - (a.updated || 0), title: (a, b) => a.title.localeCompare(b.title), rating: (a, b) => (b.rating || 0) - (a.rating || 0) || a.title.localeCompare(b.title), year: (a, b) => (b.year || 0) - (a.year || 0) };
    const q = L.norm(ui.libFilterQ || "");
    const okF = it => f === "all" || (f === "watchlist" ? it.status === "watchlist" && !isFinished(it) : f === "services" ? it.status === "watchlist" && !isFinished(it) && streamsFor(it) : it.status === f);
    const tags = allTags();
    if (ui.libTag && !tags.some(([t]) => t === ui.libTag)) ui.libTag = "";
    // a chosen tag works as a list of its own: it shows every title with that tag, whatever its status
    const list = all.filter(it => (ui.libTag ? (it.tags || []).includes(ui.libTag) : okF(it)) && (ty === "all" || it.type === ty) && (!q || L.norm(it.title).includes(q))).sort(sorters[ui.libSort || "recent"]);
    const lim = ui.libLimit || 150;
    c.watchlist = all.filter(it => it.status === "watchlist" && !isFinished(it)).length;
    const chips = [["watching", "Watching"], ["watchlist", "Watchlist"], ["services", "Streaming for me"], ["watched", "Watched"], ["dropped", "Dropped"], ["all", "All"]];
    return head + `<div class="chips" style="margin-bottom:10px">${chips.map(([k, l]) => `<button class="chip" data-action="libfilter" data-v="${k}" aria-pressed="${f === k}">${l}${c[k] != null ? ` <span class="muted">${fmt(c[k])}</span>` : ""}</button>`).join("")}</div>
      ${tags.length ? `<div class="tagrow" style="margin-bottom:10px">${tags.slice(0, 20).map(([t, n]) => `<button class="tagchip" data-action="libtag" data-v="${esc(t)}" aria-pressed="${ui.libTag === t}">${esc(t)} <span style="opacity:.6">${n}</span></button>`).join("")}</div>` : ""}
      <div class="toolbar"><input type="search" data-input="libFilterQ" value="${esc(ui.libFilterQ || "")}" placeholder="Filter your library" autocomplete="off">
        <select data-libtype="1" aria-label="Type">${[["all", "Films & series"], ["movie", "Films"], ["show", "Series"]].map(([k, l]) => `<option value="${k}" ${ty === k ? "selected" : ""}>${l}</option>`).join("")}</select>
        <select data-libsort="1" aria-label="Sort">${[["recent", "Recent"], ["title", "Title"], ["rating", "Rating"], ["year", "Year"]].map(([k, l]) => `<option value="${k}" ${(ui.libSort || "recent") === k ? "selected" : ""}>${l}</option>`).join("")}</select></div>
      ${f === "services" ? `<p class="small muted">Watchlist titles on ${esc(myServices().join(", "))}${feat("vpn") ? ", or elsewhere with a VPN" : ""}. Where things stream is looked up after each sync (needs a TMDB key).</p>` : ""}
      ${list.length ? Kit.grid(list.slice(0, lim).map(libTile)) : `<p class="muted">Nothing here yet.</p>`}
      ${list.length > lim ? `<button class="btn block" style="margin-top:16px" data-action="libmore">Show more (${fmt(list.length - lim)})</button>` : ""}
      <p class="small muted" style="margin-top:16px">${fmt(c.movie)} film${c.movie === 1 ? "" : "s"} · ${fmt(c.show)} series · ${fmt(c.eps)} episode${c.eps === 1 ? "" : "s"} ticked${c.rewatches ? ` · ${fmt(c.rewatches)} rewatch${c.rewatches === 1 ? "" : "es"}` : ""}</p>`;
  }
  async function libSearch() {
    const q = String(ui.libQ || "").trim();
    if (q.length < 2) return toast("Type at least two letters");
    ui.libBusy = true; ui.libRes = null; render();
    try { ui.libRes = ui.tab === "anime" ? await L.searchAnime(Native.http, q) : await L.search(Native.http, q, Object.assign(libOpt(), { type: ui.libType || "all" })); }
    catch (e) { ui.libRes = []; toast(`Search failed: ${e.message}`); }
    ui.libBusy = false; render();
  }
  // fetch details and the episode list in the background, then redraw whatever is open
  const libLoading = new Set(), libTried = new Set(); // one automatic lookup per title per session
  async function libDetails(it, force) {
    if (!it || libLoading.has(it.id)) return;
    if (!force && (libTried.has(it.id) || (it.type === "movie" && it.imdb))) return;
    if (!force && it.type === "show" && it.epl && Date.now() - (it.epChecked || 0) < 864e5) return;
    libLoading.add(it.id); libTried.add(it.id);
    let changed = false;
    try { changed = await L.details(Native.http, it, libOpt()); if (changed) libSave(); }
    catch (e) { if (force) toast(`Couldn't load details: ${e.message}`); }
    libLoading.delete(it.id);
    if (!changed && !force) return;
    if (ui.libOpen === it.id && $(".libsheet")) openLib(it.id);
    else if (!$("#overlay").innerHTML && (ui.sec === "home" || (ui.sec === "watch" && (ui.tab === "library" || ui.tab === "anime")))) render();
  }
  // One title: refresh its details and episodes, apply what IMDb and Trakt already reported for it, then ask Trakt for it alone.
  async function libSyncOne(it) {
    const said = [];
    try { if (await L.details(Native.http, it, libOpt())) said.push(it.type === "show" ? "episodes refreshed" : "details refreshed"); } catch (e) { said.push(`details failed (${e.message})`); }
    const n0 = L.norm(it.title);
    const rows = db.items(null, ["watched", "rated", "watchlist"]).filter(r => r.source !== "app" && ((it.imdb && r.imdb === it.imdb) || (r.norm === n0 && (!it.year || !r.year || Math.abs(r.year - it.year) <= 1))));
    const before = JSON.stringify([it.status, it.rating, it.watches]);
    if (rows.length) lib.adopt(rows);
    if (JSON.stringify([it.status, it.rating, it.watches]) !== before) said.push("rating and status updated from IMDb/Trakt");
    if (db.get("token")) {
      try {
        const t = await C.traktOne(Native.http, db.get("client_id"), db.get("token"), it);
        let n = 0;
        if (it.type === "show") { for (const [k, d] of Object.entries(t.eps)) if (!it.eps[k]) { it.eps[k] = d || TODAY(); n++; } if (n) lib.afterEps(it); }
        else { for (const d of t.watches) if (d && !it.watches.includes(d)) { it.watches.push(d); n++; } if (n) { it.watches.sort(); if (it.status !== "watched") it.status = "watched"; } }
        if (!it.imdb && /^tt\d+$/.test(t.id)) it.imdb = t.id;
        said.push(n ? `${n} ${it.type === "show" ? "episode" : "viewing"}${n === 1 ? "" : "s"} added from Trakt` : "Trakt has nothing new");
      } catch (e) { said.push(`Trakt: ${e.message}`); }
    } else said.push("Trakt not signed in, so only stored data was used");
    libSave();
    if (ui.libOpen === it.id && $(".libsheet")) openLib(it.id);
    toast(`${it.title}: ${said.join("; ")}`);
  }
  // One title through the AI canon finder, whatever was checked before; says what its franchise now holds.
  function libCanonOne(it) {
    const medium = it.type === "show" ? "TV Series" : "Movie";
    const only = [{ title: it.title, year: it.year || null, medium, norm: C.norm(it.title), key: `one|${C.norm(it.title)}|${it.year || ""}` }];
    const done = n => {
      const mine = db.canon().find(c => C.norm(c.title) === only[0].norm);
      const fr = mine ? mine.franchise : "";
      const all = fr ? db.canon().filter(c => c.franchise === fr) : [];
      invalidate();
      return fr ? `${fr}: ${fmt(all.length)} entries known${n ? `, ${fmt(n)} new` : ", nothing new"}. See the Missing tab.` : `No franchise found for ${it.title}${n ? ` (${fmt(n)} entries added)` : ""}.`;
    };
    if (db.get("gemini_key")) return runJob("Canon check", p => C.multiverseScan(db, Native.http, db.get("gemini_key"), db.get("gemini_model") || "auto", p, 40, 1, { search: db.get("gemini_search", "0") === "1", only }).then(done));
    if (db.get("claude_key")) return runJob("Canon check", p => C.claudeScan(db, Native.http, db.get("claude_key"), db.get("claude_model") || "auto", p, { webSearch: db.get("claude_web", "1") === "1", only }).then(done));
    if (db.get("ai_key")) return runJob("Canon check", p => C.compatScan(db, Native.http, { preset: db.get("ai_preset", "openai"), key: db.get("ai_key"), model: db.get("ai_model"), base: db.get("ai_base") }, p, only).then(done));
    toast("Add an AI key in Settings › AI first");
  }
  // puts one title back exactly as it was (status, episodes, rating), and takes back what was queued for Trakt
  function libUndo(it) {
    const snap = JSON.stringify(it), id = it.id, out = lib.outbox.length, key = it.imdb || `${it.type}|${L.norm(it.title)}|${it.year || ""}`, wasAdopted = !!lib.adopted[key];
    return () => { lib.items[id] = L.blank(JSON.parse(snap)); if (!wasAdopted) delete lib.adopted[key]; lib.outbox.length = Math.min(lib.outbox.length, out); libSave(); if ($(".libsheet") && ui.libOpen === id) openLib(id); render(); toast("Undone"); };
  }
  function libAdd(r, status) {
    const res = lib.add(r, status);
    if (status === "watched") lib.setStatus(res.item, "watched");
    libSave();
    toast(res.existed ? `${r.title} is already in your library` : `Added ${r.title} to ${LST[res.item.status]}`);
    libDetails(res.item);
    return res.item;
  }
  function stars(rating) {
    return `<span class="stars">${[1, 2, 3, 4, 5].map(i => `<button data-action="librate" data-v="${i}" class="${rating >= i * 2 ? "on" : rating === i * 2 - 1 ? "half" : ""}" aria-label="${i} stars">★</button>`).join("")}</span>`;
  }
  function openLib(id) {
    const it = lib.get(id);
    if (!it) return;
    ui.libOpen = id;
    const show = it.type === "show";
    const n = show ? lib.nextEp(it) : null;
    const meta = [it.year, it.runtime ? `${it.runtime} min` : "", it.network, (it.genres || []).slice(0, 3).join(", ")].filter(Boolean).map(esc).join(" · ");
    const log = it.watches.map((d, i) => `<div class="logrow"><span class="grow">${show ? `Run ${i + 1}` : `Watch ${i + 1}`} · ${esc(shortDay(d))}</span><button class="btn quiet small" data-action="libunwatch" data-i="${i}" aria-label="Remove this entry">✕</button></div>`).join("");
    let eps = "";
    if (show) {
      if (!it.epl) eps = `<p class="small muted">${libLoading.has(it.id) ? "Loading episodes…" : "No episode list yet."} <button class="btn quiet small" data-action="librefresh">Load episodes</button></p>`;
      else {
        const by = {};
        for (const x of it.epl) if (x[0] > 0) (by[x[0]] = by[x[0]] || []).push(x);
        const t = TODAY();
        eps = Object.keys(by).map(Number).sort((a, b) => a - b).map(s => {
          const list = by[s].sort((a, b) => a[1] - b[1]);
          const aired = list.filter(x => !x[2] || x[2] <= t), w = list.filter(x => it.eps[L.epKey(s, x[1])]).length, er = it.er || {};
          const open = ui.libSeason === s || (ui.libSeason == null && n && n.s === s);
          return `<details class="season"${open ? " open" : ""}><summary data-action="libseasonopen" data-s="${s}"><b class="grow">Season ${s}</b><span class="small muted">${w} of ${list.length}</span></summary>
            <div class="row" style="margin:4px 0 6px"><button class="btn quiet small" data-action="libseason" data-s="${s}" data-on="${w < aired.length ? 1 : 0}">${w < aired.length ? "Mark season watched" : "Unmark season"}</button></div>
            ${list.map(x => { const on = it.eps[L.epKey(s, x[1])], fut = x[2] && x[2] > t; return `<div class="ep${on ? " on" : ""}${fut ? " fut" : ""}">
              <button class="epck" data-action="libep" data-s="${s}" data-e="${x[1]}" ${fut ? "disabled" : ""} aria-pressed="${!!on}" aria-label="Episode ${x[1]} watched">${icon("check")}</button>
              <div class="grow"><div class="ell"><b>${x[1]}.</b> ${esc(!on && db.get("spoiler_hide", "1") === "1" && !(n && n.s === s && n.e === x[1]) ? `Episode ${x[1]}` : (x[3] || `Episode ${x[1]}`))}</div><div class="small muted">${x[2] ? esc(shortDay(x[2])) : "date not announced"}${on ? ` · watched ${esc(on ? shortDay(on) : "")}` : ""}</div></div>
              ${!on && !fut ? `<button class="btn quiet small" data-action="libupto" data-s="${s}" data-e="${x[1]}" title="Mark everything up to here">up to here</button>` : ""}
              ${fut ? "" : `<button class="eprate${er[L.epKey(s, x[1])] ? " has" : ""}" data-action="libeprate" data-s="${s}" data-e="${x[1]}" aria-label="Rate episode ${x[1]}">★${er[L.epKey(s, x[1])] ? " " + er[L.epKey(s, x[1])] : ""}</button>`}</div>
              ${ui.epRate === L.epKey(s, x[1]) ? `<div class="eppick">${[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(v => `<button data-action="libepset" data-s="${s}" data-e="${x[1]}" data-v="${v}" aria-pressed="${er[L.epKey(s, x[1])] === v}">${v}</button>`).join("")}</div>` : ""}`; }).join("")}</details>`;
        }).join("");
      }
    }
    const inner = `
      ${Kit.sheetHero({ title: it.title, img: it.poster, kind: it.type }, `<div class="small muted">${meta}</div>`)}
      <div class="row"><span class="small muted grow">Your rating</span>${stars(it.rating)}</div>
      <div class="seg2" style="margin:10px 0">${L.STATUSES.map(s => `<button data-action="libst" data-v="${s}" aria-pressed="${it.status === s}">${LST[s]}</button>`).join("")}</div>
      ${n ? `<div class="nextbox"><div class="grow"><div class="kicker">${n.upcoming ? "Next episode airs" : "Next episode"}</div><b>S${n.s} E${n.e}${n.name && !/^episode \d+$/i.test(n.name) ? ` · ${esc(n.name)}` : ""}</b>
          <div class="small muted">${n.upcoming ? (n.date ? esc(shortDay(n.date)) : "date not announced") : `${n.left} aired episode${n.left === 1 ? "" : "s"} to watch`}</div></div>
          ${n.upcoming ? "" : `<button class="btn primary" data-action="libep" data-s="${n.s}" data-e="${n.e}">${icon("check")}Watched</button>`}</div>` : ""}
      <h4>${show ? "Full runs" : "Watch log"} <span class="muted small">${it.watches.length ? `· ${it.watches.length}×` : ""}</span></h4>
      ${log || `<p class="small muted">${show ? "Finishing every episode logs a run. Rewatching? Start a rewatch below." : "Not watched yet."}</p>`}
      <div class="row" style="margin:6px 0 10px"><input type="date" id="libDate" value="${TODAY()}" max="${TODAY()}" aria-label="Date">
        <button class="btn" data-action="libwatch">${icon("plus")}${show ? "Log a full run" : it.watches.length ? "Watched again" : "Watched"}</button></div>
      ${show && Object.keys(it.eps).length ? `<button class="sheetbtn" data-action="librewatch">${icon("sync")}Start a rewatch (keeps this run in the log)</button>` : ""}
      ${eps ? `<h4>Episodes</h4>${eps}` : ""}
      ${it.overview ? `<details class="report"><summary>About (may contain spoilers)</summary><p class="small">${esc(it.overview)}</p></details>` : ""}
      <label class="field" style="margin-top:8px"><span>Notes</span><textarea data-libnotes="1" rows="2" placeholder="Where you watched it, with whom…">${esc(it.notes || "")}</textarea></label>
      <div style="margin-top:8px">
        ${(() => { const x = streamsFor(it); return x ? `<p class="small" style="margin:4px 0 8px">${x.mine ? `On ${esc(shortName(x.o.name))}${x.o.res ? ` in ${esc(x.o.res)}` : ""}, one of your services` : x.o ? `Streaming on ${esc(shortName(x.o.name))}` : `Not in Italy: ${esc(x.vpn.flag)} ${esc(shortName(x.vpn.name))} with a VPN`}</p>` : ""; })()}
        <button class="sheetbtn" data-action="libwhere">${icon("eye")}Where to watch and details</button>
        <button class="sheetbtn" data-action="open" data-url="${esc(it.imdb ? `https://www.imdb.com/title/${it.imdb}/` : `https://www.imdb.com/find/?q=${encodeURIComponent(it.title + " " + (it.year || ""))}`)}">${icon("open")}Open on IMDb</button>
        <button class="sheetbtn" data-action="libsync1">${icon("sync")}Sync this title (details, IMDb and Trakt)</button>
        <button class="sheetbtn" data-action="libcanon1">${icon("eye")}Check canon for this title (AI)</button>
        <div class="tagrow" style="margin:6px 0 10px">${(it.tags || []).map(t => `<button class="tagchip" data-action="libtagdel" data-v="${esc(t)}" aria-label="Remove tag ${esc(t)}">${esc(t)} ✕</button>`).join("")}
          <input type="text" id="libTag" list="libTags" placeholder="Add a tag or list…" autocomplete="off" style="flex:1;min-width:130px;height:34px"><datalist id="libTags">${allTags().map(([t]) => `<option value="${esc(t)}">`).join("")}</datalist>
          <button class="btn small" data-action="libtagadd">${icon("plus")}Tag</button></div>
        <button class="sheetbtn" data-action="libanime">${icon("edit")}${it.anime ? "Not anime: move to Library" : "This is anime: move to Anime"}</button>
        <button class="sheetbtn" data-action="libremove">${icon("notcanon")}Remove from library</button></div>`;
    // redraw in place while it's open, so ticking an episode doesn't replay the opening animation or jump to the top
    sheet(inner, "libsheet", it.id);
    if (!libLoading.has(it.id)) libDetails(it);
  }
  function libAct(a, el) {
    const it = ui.libOpen ? lib.get(ui.libOpen) : null;
    const date = () => (($("#libDate") || {}).value || TODAY());
    const reopen = () => { libSave(); if (it) openLib(it.id); render(); };
    switch (a) {
      case "libsearch": commitFields(); libSearch(); return true;
      case "libclear": ui.libRes = null; ui.libQ = ""; render(); return true;
      case "libtype": ui.libType = el.dataset.v; if (ui.libRes && ui.libQ) libSearch(); else render(); return true;
      case "libfilter": ui.libF = el.dataset.v; ui.libLimit = 150; render(); return true;
      case "libtag": ui.libTag = ui.libTag === el.dataset.v ? "" : el.dataset.v; ui.libLimit = 150; render(); return true;
      case "libmore": ui.libLimit = (ui.libLimit || 150) + 150; render(); return true;
      case "libadd": { const r = (ui.libRes || [])[+el.dataset.i]; if (r) { libAdd(r, el.dataset.v); render(); } return true; }
      case "libpeek": { const r = (ui.libRes || [])[+el.dataset.i]; if (!r) return true; const have = lib.find(r); if (have) { openLib(have.id); return true; }
        $("#overlay").innerHTML = `<div class="scrim bottom" data-action="dismiss"><div class="sheet" role="dialog" aria-modal="true">
          <div class="sheethead">${libThumb(r, true)}<div class="grow"><h3>${esc(r.title)}</h3><div class="row small">${typeTag(r)}</div>
          <p class="small muted">${esc([r.year, r.network, r.orig && r.orig !== r.title ? r.orig : ""].filter(Boolean).join(" · "))}</p></div></div>
          ${r.overview ? `<p class="small">${esc(r.overview.length > 360 ? r.overview.slice(0, 360) + "…" : r.overview)}</p>` : ""}
          <p class="small muted">Add to your library as</p>
          ${(r.type === "show" ? ["watchlist", "watching", "watched"] : ["watchlist", "watched"]).map(s => `<button class="sheetbtn" data-action="libaddas" data-i="${el.dataset.i}" data-v="${s}">${icon("plus")}${LST[s]}</button>`).join("")}</div></div>`;
        return true; }
      case "libaddas": { const r = (ui.libRes || [])[+el.dataset.i]; if (r) { const x = libAdd(r, el.dataset.v); render(); openLib(x.id); } return true; }
      case "libopen": openLib(el.dataset.id); return true;
      case "libnext": { const x = lib.get(el.dataset.id); if (x) { const u = libUndo(x); lib.toggleEp(x, +el.dataset.s, +el.dataset.e); libSave(); toast(`Watched ${x.title} S${el.dataset.s} E${el.dataset.e}`, u); render(); } return true; }
      case "libadoptnow": { db.set("lib_adopt", "1"); const n = libAdopt(); toast(`${fmt(n)} titles added from your sync`); render(); lib.all().filter(x => x.type === "show").slice(0, 6).forEach(x => libDetails(x)); return true; }
    }
    if (!it) return false;
    switch (a) {
      case "libst": { const u = libUndo(it), was = it.status; lib.setStatus(it, el.dataset.v, date()); reopen(); if (was !== it.status) toast(`${it.title}: ${LST[it.status] || it.status}`, u); return true; }
      case "librate": { const v = +el.dataset.v * 2; lib.rate(it, it.rating === v ? v - 1 : it.rating === v - 1 ? 0 : v); reopen(); return true; }
      case "libwatch": { const n = lib.logWatch(it, date()); toast(it.type === "show" ? `Run ${n} logged` : n > 1 ? `Watched ${n} times` : "Logged"); reopen(); return true; }
      case "libunwatch": lib.removeWatch(it, +el.dataset.i); reopen(); return true;
      case "libep": { const on = lib.toggleEp(it, +el.dataset.s, +el.dataset.e, TODAY()); ui.libSeason = +el.dataset.s; if (on) toast(`S${el.dataset.s} E${el.dataset.e} watched`); reopen(); return true; }
      case "libeprate": { const k = L.epKey(+el.dataset.s, +el.dataset.e); ui.epRate = ui.epRate === k ? null : k; ui.libSeason = +el.dataset.s; openLib(it.id); return true; }
      case "libepset": { const k = L.epKey(+el.dataset.s, +el.dataset.e), v = +el.dataset.v; it.er = it.er || {}; if (it.er[k] === v) delete it.er[k]; else it.er[k] = v; it.erMine = it.erMine || {}; it.erMine[k] = 1; ui.epRate = null; ui.libSeason = +el.dataset.s; it.updated = Date.now(); libSave(); openLib(it.id); return true; }
      case "libupto": lib.markUpTo(it, +el.dataset.s, +el.dataset.e, TODAY()); ui.libSeason = +el.dataset.s; reopen(); return true;
      case "libseason": lib.markSeason(it, +el.dataset.s, el.dataset.on === "1", TODAY()); ui.libSeason = +el.dataset.s; reopen(); return true;
      case "libseasonopen": ui.libSeason = +el.dataset.s; return false;
      case "librewatch": { const n = lib.rewatch(it, date()); toast(`Rewatch started (${n} run${n === 1 ? "" : "s"} logged)`); reopen(); return true; }
      case "libanime": it.anime = !it.anime; libSave(); toast(it.anime ? "Moved to Anime" : "Moved to Library"); openLib(it.id); render(); return true;
      case "libtagadd": { const v = (($("#libTag") || {}).value || "").trim().slice(0, 30); if (!v) return true; it.tags = [...new Set([...(it.tags || []), v])]; it.updated = Date.now(); libSave(); openLib(it.id); return true; }
      case "libtagdel": it.tags = (it.tags || []).filter(t => t !== el.dataset.v); libSave(); openLib(it.id); return true;
      case "librefresh": libDetails(it, true); toast("Loading episodes…"); return true;
      case "libsync1": toast(`Syncing ${it.title}…`); libSyncOne(it); return true;
      case "libcanon1": closeOverlay(); libCanonOne(it); return true;
      case "libwhere": { const c = { title: it.title, year: it.year, medium: it.type === "show" ? "TV Series" : "Movie", imdb: it.imdb || null, franchise: "" }; closeOverlay(); openSheet(sid(c, "lib")); return true; }
      case "libremove": if (el.dataset.sure) { const u = libUndo(it); lib.remove(it.id); libSave(); closeOverlay(); ui.libOpen = null; toast(`Removed ${it.title}`, u); render(); } else { el.dataset.sure = "1"; el.lastChild.textContent = "Tap again to remove"; } return true;
    }
    return false;
  }
  // series with an episode waiting: your library first, then Trakt's progress for shows not in it
  function nextEpisodes() {
    const out = lib.upNext().map(x => ({ lib: true, it: x.item, s: x.s, e: x.e, name: x.name, left: x.left, last: x.last }));
    const have = new Set(out.map(x => x.it.imdb || L.norm(x.it.title)));
    for (const x of C.continueWatching(db)) if (!have.has(x.imdb || L.norm(x.show))) out.push(Object.assign({ trakt: true }, x));
    return out;
  }
  function nextEpRow(x) {
    if (x.trakt) return cwRow(x);
    return libRow(x.it, { noNext: true, sub: `S${x.s} E${x.e}${x.name && !/^episode \d+$/i.test(x.name) ? ` · ${esc(x.name)}` : ""}${x.left > 1 ? ` · ${x.left} to watch` : ""}`,
      trail: `<button class="seen" data-action="libnext" data-id="${esc(x.it.id)}" data-s="${x.s}" data-e="${x.e}" aria-label="Mark S${x.s} E${x.e} watched">${icon("check")}</button>` });
  }
  // the latest things you finished anywhere: films, episodes, games, books
  function recentAll(limit) {
    const out = lib.recent(60).map(x => ({ app: "watch", date: x.date, title: x.title, sub: x.type === "show" ? x.what : (x.what || "Film"), id: x.id, img: x.item.poster, type: x.type }));
    const inLib = new Set(out.map(x => `${L.norm(x.title)}|${x.date}`));
    for (const r of db.items(null, ["watched"])) {
      if (r.source === "app" || !r.date || r.medium === "Video Game") continue;
      const d = String(r.date).slice(0, 10);
      if (inLib.has(`${r.norm}|${d}`)) continue;
      inLib.add(`${r.norm}|${d}`);
      out.push({ app: "sync", date: d, title: r.title, sub: `${r.medium === "TV Series" ? "Series" : r.medium === "Episode" ? "Episode" : "Film"} · ${r.source === "imdb" ? "IMDb" : "Trakt"}`, r });
    }
    const g = gamesIdx(), bk = booksIdx();
    if (g && g.recent) for (const x of g.recent) { const gg = games.get(x.id); out.push({ app: "games", date: x.date, title: x.t, sub: x.n > 1 ? `Game · ${x.n}×` : "Game", id: x.id, img: gg && (gg.cover || (gg.steam ? GC.COVER(gg.steam) : "")) }); }
    if (bk && bk.recent) for (const x of bk.recent) { const bb = books.get(x.id); out.push({ app: "books", date: x.date, title: x.t, sub: `Book${x.a ? ` · ${x.a}` : ""}${x.n > 1 ? ` · read ${x.n}×` : ""}`, id: x.id, img: bb && (bb.cover || "").replace(/^http:/, "https:") }); }
    if (secOn("timeline")) for (const x of Kit.mods.timeline.recent(20)) out.push({ app: "dw", date: x.date, title: x.t, sub: "Doctor Who", id: x.k });
    return out.sort((a, b) => b.date.localeCompare(a.date)).slice(0, limit);
  }
  function recentRow(x) {
    const ic = x.app === "games" ? "pad" : x.app === "books" ? "book" : x.app === "watch" ? "eye" : "check";
    const act = x.app === "watch" ? `data-action="libopen" data-id="${esc(x.id)}"` : x.app === "games" || x.app === "books" ? `data-action="xopen" data-app="${x.app}" data-id="${esc(x.id)}" data-tabid=""` : `data-action="sheet" data-sid="${sid({ title: x.r.title, year: x.r.year, medium: x.r.medium, imdb: x.r.imdb, franchise: "" }, "lib")}"`;
    return `<div class="item" ${act}><span class="xic ${x.app === "games" ? "games" : x.app === "books" ? "books" : "canon"}">${icon(ic)}</span>
      <div class="grow"><div class="row"><b class="grow ell">${esc(x.title)}</b><span class="small muted">${esc(shortDay(x.date))}</span></div><div class="small muted ell">${esc(x.sub)}</div></div></div>`;
  }

  // ============================================================ Saga 5: one app, five sections
  const GC = window.GamesCore, BC = window.BooksCore;
  const games = new GC.Games({ load: () => Native.load("games.json"), save: t => Native.save("games.json", t) });
  const books = new BC.Library({ load: () => Native.load("books.json"), save: t => Native.save("books.json", t) });
  const NAV = [["home", "Home", "home"], ["watch", "Watch", "library"], ["games", "Games", "pad"], ["books", "Books", "book"], ["timeline", "Who", "box"]];
  const WATCH = [["library", "Library"], ["anime", "Anime"], ["upcoming", "Upcoming"], ["missing", "Canon"], ["stats", "Stats"]];
  const TITLES = { watch: "Watch", games: "Games", books: "Books", timeline: "Doctor Who", settings: "Settings", sync: "Sync", year: "Your year", mv: "Multiverse" };
  const secOn = s => (s === "games" ? feat("games") : s === "books" ? feat("books") : s === "timeline" ? feat("dw") : true);
  const RENDER = { library: renderLibrary, anime: renderAnime, upcoming: renderUpcoming, missing: renderMissing, stats: renderStats, compare: renderCompare };
  const SECR = { home: renderHome, settings: renderSettings, sync: renderSync, year: renderYear, mv: renderMv };
  let changeTimer = null;
  // something changed in a section: refresh the widget and the backup file a little later
  function changed(what) {
    clearTimeout(changeTimer);
    changeTimer = setTimeout(() => { try { updateWidget(); } catch (e) { /* optional */ } try { backupToFile(false).catch(() => {}); } catch (e) { /* next time */ } }, 20000);
  }
  function sheet(html, cls, id) {
    const open = document.querySelector("#overlay .sheet");
    if (open && cls && open.dataset.cls === cls && open.dataset.id === String(id || "")) { const top = open.scrollTop; open.innerHTML = html; open.scrollTop = top; if (window.BantaI18n && BantaI18n.isOn()) BantaI18n.walk(open); return; }
    $("#overlay").innerHTML = `<div class="scrim bottom" data-action="dismiss"><div class="sheet ${esc(cls || "")}" data-cls="${esc(cls || "")}" data-id="${esc(id || "")}" role="dialog" aria-modal="true">${html}</div></div>`;
  }
  function go(sec, tab) {
    commitFields();
    if (Kit.mods.books && Kit.mods.books.stopScan) Kit.mods.books.stopScan();
    if (WATCH.some(w => w[0] === sec) || sec === "compare") { tab = sec; sec = "watch"; }
    if (!secOn(sec) && !SECR[sec]) sec = "home";
    ui.sec = sec;
    if (tab && tab !== ui.tab) { ui.libRes = null; ui.libQ = ""; ui.libF = null; }
    if (tab) ui.tab = tab;
    if (sec === "watch" && !ui.tab) ui.tab = "library";
    render();
    window.scrollTo(0, 0);
  }
  function setTab(t) { go(t); }
  function render() {
    const active = document.activeElement;
    const keepInput = active && active.dataset && active.dataset.input ? active.dataset.input : null;
    const caret = keepInput && active.selectionStart != null ? active.selectionStart : null;
    if (!secOn(ui.sec) && !SECR[ui.sec] && ui.sec !== "watch") ui.sec = "home";
    const sec = ui.sec;
    document.body.dataset.sec = sec === "home" || sec === "watch" || !Kit.mods[sec] ? "watch" : sec;
    $("#view").dataset.tab = sec === "watch" ? ui.tab : sec;
    let html;
    try {
      if (sec === "watch") html = `<div class="subnav">${WATCH.map(([k, l]) => `<button data-action="tab" data-tab="${k}" ${ui.tab === k || (k === "stats" && ui.tab === "compare") ? 'aria-current="page"' : ""}>${l}</button>`).join("")}</div>${(RENDER[ui.tab] || renderLibrary)()}`;
      else if (Kit.mods[sec]) html = Kit.mods[sec].render(Saga);
      else html = (SECR[sec] || renderHome)();
    } catch (e) { logError("screen", (e.stack || e.message)); html = `<div class="empty2"><h2>Something went wrong here</h2><p>${esc(e.message)}</p><button class="btn" data-action="go" data-sec="home">Back to Home</button></div>`; console.error(e); }
    $("#view").innerHTML = html;
    $("#title").innerHTML = sec === "home" ? `<span class="wordmark">Sa<span>ga</span></span>` : esc(TITLES[sec] || "");
    const fails = failedLabels().length;
    $("#syncTop").classList.toggle("warn", !!fails);
    $("#tabs").innerHTML = NAV.filter(([k]) => secOn(k)).map(([k, label, ic]) => `<button data-action="go" data-sec="${k}" data-sec2="${k}" ${sec === k ? 'aria-current="page"' : ""} style="${k === "timeline" ? "--btn-accent:var(--timeline)" : ""}">${icon(ic)}<span>${label}</span></button>`).join("");
    $("#tabs").querySelectorAll("button").forEach(b => b.setAttribute("data-sec", b.dataset.sec2));
    if (keepInput) {
      const el = document.querySelector(`[data-input="${keepInput}"]`);
      if (el) { el.focus(); try { const p = caret != null ? caret : el.value.length; el.setSelectionRange(p, p); } catch (e) { /* not a text field */ } }
    }
  }

  // ---- Home: one look at everything
  function homeContinue() {
    const out = [];
    for (const x of nextEpisodes().slice(0, 8)) {
      if (x.lib) out.push({ ord: x.last || "", html: Kit.tile({ title: x.it.title, img: x.it.poster, kind: "show", badge: `S${x.s} E${x.e}`, badgeAcc: true, progress: progressOf(x.it), attrs: `data-action="libopen" data-id="${esc(x.it.id)}"` }, x.it.title, x.left > 1 ? `${x.left} to watch` : "Next episode") });
      else out.push({ ord: x.last || "", html: Kit.tile({ title: x.show, img: x.poster ? IMG + "w342" + x.poster : "", kind: "show", badge: `S${x.s} E${x.e}`, badgeAcc: true, attrs: `data-action="sheet" data-sid="${sid(x, "up")}"` }, x.show, "On Trakt") });
    }
    if (secOn("books")) for (const b of books.books.filter(b => b.status === "reading")) out.push({ ord: BC.isoDay ? BC.isoDay(Math.max(b.started || 0, ...(b.log || []).map(l => l.t))) : "", html: Kit.tile({ title: b.title, img: (b.cover || "").replace(/^http:/, "https:"), kind: "book", badge: `${BC.percent(b)}%`, badgeAcc: true, progress: BC.percent(b) / 100, attrs: `data-action="bopen" data-id="${esc(b.id)}"` }, b.title, b.authors[0] || "") });
    if (secOn("games")) for (const g of games.nextUp(6)) out.push({ ord: g.status === "playing" ? "~" : "", html: Kit.mods.games.tileOf(g) });
    if (secOn("timeline")) { const n = Kit.mods.timeline.next(); if (n) out.push({ ord: "", html: Kit.tile({ title: n.title, kind: "story", badge: n.era, attrs: `data-action="tlhome" data-k="${esc(n.k)}"` }, n.title, `Doctor Who · ${n.era}`) }); }
    return out.sort((a, b) => String(b.ord).localeCompare(String(a.ord))).map(x => x.html);
  }
  const progressOf = it => { const a = lib.aired(it).length; return a ? Object.keys(it.eps).length / a : null; };
  function homeHero() {
    const ne = nextEpisodes().find(x => x.lib);
    if (ne) return { img: ne.it.poster, kicker: "Next episode", title: ne.it.title, text: `S${ne.s} E${ne.e}${ne.name && !/^episode \d+$/i.test(ne.name) ? ` · ${ne.name}` : ""}${ne.left > 1 ? ` · ${ne.left} aired to watch` : ""}`,
      btns: `<button class="btn primary" data-action="libnext" data-id="${esc(ne.it.id)}" data-s="${ne.s}" data-e="${ne.e}">${icon("check")}Watched</button><button class="btn" data-action="libopen" data-id="${esc(ne.it.id)}">Episodes</button>` };
    const b = secOn("books") && books.books.find(x => x.status === "reading");
    if (b) return { img: (b.cover || "").replace(/^http:/, "https:"), kicker: "Reading now", title: b.title, text: `${b.authors[0] || ""} · ${BC.percent(b)}%`, btns: `<button class="btn primary" data-action="bopen" data-id="${esc(b.id)}">Update progress</button>` };
    const g = secOn("games") && games.nextUp(1)[0];
    if (g) return { img: g.steam ? GC.HEADER(g.steam) : "", kicker: g.status === "playing" ? "Playing" : "Next up", title: g.title, text: [g.franchise !== g.title ? g.franchise : "", g.platform, g.hours ? `${g.hours} h to beat` : ""].filter(Boolean).join(" · "), btns: `<button class="btn primary" data-action="gopen" data-id="${esc(g.id)}">Open</button>` };
    const w = lib.all().filter(x => x.status === "watchlist").sort((a, b) => (b.added || 0) - (a.added || 0))[0];
    if (w) return { img: w.poster, kicker: "On your watchlist", title: w.title, text: [w.year, w.type === "show" ? "Series" : "Film"].filter(Boolean).join(" · "), btns: `<button class="btn primary" data-action="libopen" data-id="${esc(w.id)}">Open</button>` };
    return null;
  }
  function renderHome() {
    const st = status(), parts = [];
    const empty = !lib.all().length && !st.length && !games.games.length && !books.books.length;
    if (empty) {
      return `<section class="hero2"><div class="bg gen" style="--h:32"></div><div class="in"><div class="kicker">Welcome</div><h1>Everything you watch, play and read</h1>
        <p>Search and add films, series, games and books, tick episodes as you go, log every rewatch with its date, and find the gaps in your franchises.</p>
        <div class="row wrap"><button class="btn primary" data-action="go" data-sec="library">${icon("missing")}Search and add</button>
        <button class="btn" data-action="go" data-sec="settings" data-scroll="importhub">${icon("upload")}Import</button>
        <button class="btn" data-action="go" data-sec="settings" data-scroll="accounts">${icon("sync")}Connect Trakt / IMDb</button></div></div></section>`;
    }
    const h = homeHero();
    if (h) parts.push(`<section class="hero2"><div class="bg${h.img ? "" : " gen"}" style="${h.img ? `background-image:url('${esc(h.img)}')` : `--h:${Kit.hue(h.title)}`}"></div>
      ${h.img ? `<img class="side" src="${esc(httpsUrl(h.img))}" alt="" data-fb="rm">` : ""}<div class="in"><div class="kicker">${esc(h.kicker)}</div><h1>${esc(h.title)}</h1><p>${esc(h.text)}</p><div class="row wrap">${h.btns}</div></div></section>`);
    const cont = homeContinue();
    if (cont.length) parts.push(`<section>${Kit.head("Continue")}${Kit.rail(cont)}</section>`);
    const rec = recentAll(16);
    if (rec.length) parts.push(`<section>${Kit.head("Recently watched, played and read", `<button class="btn quiet small" data-action="recentall">All</button>`)}${Kit.rail(rec.map(recentTile))}</section>`);
    if (db.get("home_calendar", "1") === "1") {
      const soon = comingUp(14);
      if (soon.length) parts.push(`<section>${Kit.head("Coming up", `<button class="btn quiet small" data-action="go" data-sec="upcoming">Calendar</button>`)}${Kit.rail(soon.map(x => x.html))}</section>`);
    }
    const nx = st.length ? C.upNext(st, 12) : [];
    const fy = forYou();
    if (lib.all().some(x => x.status === "watchlist")) parts.push(`<section><button class="btn" data-action="librandom">${icon("sync")}Pick something from my watchlist</button></section>`);
    if (fy.length >= 3) parts.push(`<section>${Kit.head("Picked for you from your watchlist")}${Kit.rail(fy.map(x => Kit.tile({ title: x.it.title, img: x.it.poster, kind: x.it.type, attrs: `data-action="libopen" data-id="${esc(x.it.id)}"` }, x.it.title, `Because you rate ${esc(x.why)} highly`)))}</section>`);
    if (nx.length) parts.push(`<section>${Kit.head("Next in your canon", `<button class="btn quiet small" data-action="go" data-sec="missing">Canon</button>`)}${Kit.rail(nx.map(c => Kit.tile({ title: c.title, key: "canon:" + canonKey(c), img: cImg(c), kind: c.medium === "TV Series" ? "show" : c.medium === "Video Game" ? "game" : "movie", attrs: `data-action="sheet" data-sid="${sid(c, "canon")}"` }, c.title, `${c.franchise}${c.year ? " · " + c.year : ""}`)))}</section>`);
    const mvs = multiverseList().slice(0, 12);
    if (mvs.length) parts.push(`<section>${Kit.head("Your multiverses")}${Kit.rail(mvs.map(m => `<button class="poster wide" data-action="mvopen" data-mv="${esc(m.name)}" style="text-align:left"><span class="gen" style="--h:${Kit.hue(m.name)}"><b>${esc(m.name)}</b><small>${m.done} of ${m.total} · ${Math.round(100 * m.done / Math.max(1, m.total))}%</small></span><span class="bar"><i style="width:${Math.round(100 * m.done / Math.max(1, m.total))}%"></i></span></button>`), true)}</section>`);
    const y = yearCounts(new Date().getFullYear());
    parts.push(`<section class="card" data-action="go" data-sec="year" style="cursor:pointer"><div class="kicker">${y.year} so far</div>
      <div class="stat3" style="margin-top:10px"><div><b>${fmt(y.films + y.episodes)}</b><span>films and episodes</span></div><div><b>${fmt(y.games)}</b><span>games finished</span></div><div><b>${fmt(y.books)}</b><span>books read</span></div></div>
      <p class="small muted" style="margin:10px 0 0">Your year in review ›</p></section>`);
    if (ui.report && /FAIL|PART/.test(ui.report)) parts.push(`<section class="card"><div class="row"><span class="grow small">Some sources didn't sync completely last time.</span><button class="btn small" data-action="go" data-sec="sync">See why</button></div></section>`);
    return parts.join("");
  }
  function recentTile(x) {
    const kind = x.app === "games" ? "game" : x.app === "books" ? "book" : x.app === "dw" ? "story" : x.type || "movie";
    const act = x.app === "watch" ? `data-action="libopen" data-id="${esc(x.id)}"` : x.app === "games" ? `data-action="gopen" data-id="${esc(x.id)}"` : x.app === "books" ? `data-action="bopen" data-id="${esc(x.id)}"` : x.app === "dw" ? `data-action="tlhome" data-k="${esc(x.id)}"` : `data-action="sheet" data-sid="${sid({ title: x.r.title, year: x.r.year, medium: x.r.medium, imdb: x.r.imdb, franchise: "" }, "lib")}"`;
    return Kit.tile({ title: x.title, img: x.img || "", kind, badge: shortDay(x.date).replace(/ \d{4}$/, ""), attrs: act }, x.title, x.sub);
  }
  // episodes, films, games and books coming out in the next n days
  function comingUp(n) {
    const today = TODAY(), until = new Date(Date.now() + n * 864e5).toISOString().slice(0, 10), out = [];
    for (const it of lib.all()) if (it.type === "show" && it.status !== "dropped" && it.epl) {
      const x = it.epl.find(e => e[2] && e[2] >= today && e[2] <= until);
      if (x) out.push({ d: x[2], html: Kit.tile({ title: it.title, img: it.poster, kind: "show", badge: dayLabel(x[2], today), badgeAcc: x[2] === today, attrs: `data-action="libopen" data-id="${esc(it.id)}"` }, it.title, `S${x[0]} E${x[1]}`) });
    }
    const libShows = new Set(lib.all().map(it => it.imdb).filter(Boolean));
    for (const e of C.upcomingEpisodes(db, today)) if (e.date <= until && !libShows.has(e.imdb) && !out.some(o => o.t === e.show)) out.push({ d: e.date, t: e.show, html: Kit.tile({ title: e.show, kind: "show", badge: dayLabel(e.date, today), attrs: `data-action="sheet" data-sid="${sid(Object.assign({ kind: "episode" }, e), "up")}"` }, e.show, `S${e.s} E${e.e}`) });
    for (const c of C.releaseList(status(), today).upcoming.filter(c => c.date && c.date <= until).slice(0, 10)) out.push({ d: c.date, html: Kit.tile({ title: c.title, key: "canon:" + canonKey(c), img: cImg(c), kind: c.medium === "TV Series" ? "show" : "movie", badge: dayLabel(c.date, today), attrs: `data-action="sheet" data-sid="${sid(c, "canon")}"` }, c.title, c.franchise) });
    if (secOn("games")) for (const g of games.upcoming(today).filter(g => g.date <= until)) out.push({ d: g.date, html: Kit.mods.games.tileOf(g) });
    return out.sort((a, b) => a.d.localeCompare(b.d)).slice(0, 20);
  }
  // multiverses across tabs: canon entries, games, books series, Doctor Who
  function multiverseList() {
    const m = new Map();
    const get = name => { const k = C.norm(name); if (!m.has(k)) m.set(k, { name, total: 0, done: 0 }); return m.get(k); };
    for (const c of status()) { if (!c.franchise || c.franchise === "Unsorted") continue; const x = get(c.franchise); x.total++; if (c.have) x.done++; }
    if (secOn("games")) for (const g of games.visible()) { const k = C.norm(g.multiverse || g.franchise); if (!k || !m.has(k)) continue; const x = m.get(k); x.total++; if (g.status === "done") x.done++; }
    return [...m.values()].filter(x => x.total >= 3).sort((a, b) => (b.done > 0) - (a.done > 0) || b.total - a.total);
  }
  function renderMv() {
    const name = ui.mv || "", n = C.norm(name), t = TODAY();
    const rows = [];
    for (const c of status()) if (C.norm(c.franchise) === n) rows.push({ date: c.date || (c.year ? c.year + "-07-01" : "9999"), done: !!c.have, html: Kit.tile({ title: c.title, key: "canon:" + canonKey(c), img: cImg(c), kind: c.medium === "TV Series" ? "show" : c.medium === "Video Game" ? "game" : "movie", done: !!c.have, badge: c.year || "", attrs: `data-action="sheet" data-sid="${sid(c, "canon")}"` }, c.title, c.medium) });
    if (secOn("games")) for (const g of games.visible()) if (C.norm(g.multiverse) === n || C.norm(g.franchise) === n) rows.push({ date: g.date || "9999", done: g.status === "done", html: Kit.mods.games.tileOf(g) });
    if (secOn("books")) for (const b of books.books) if (b.series && (C.norm(b.series).includes(n) || n.includes(C.norm(b.series)))) rows.push({ date: String(b.published || "9999").slice(0, 10), done: b.status === "read", html: Kit.mods.books.tileOf(b) });
    const done = rows.filter(r => r.done).length;
    rows.sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const who = /doctor ?who|whoniverse/i.test(name) && secOn("timeline");
    return `<section><div class="kicker">Multiverse</div><h2 style="font-size:30px;margin:6px 0">${esc(name)}</h2><p class="muted">${done} of ${rows.length} · ${Math.round(100 * done / Math.max(1, rows.length))}% · in release order</p>
      ${who ? `<button class="btn" data-action="go" data-sec="timeline">${icon("box")}Open the Doctor Who timeline</button>` : ""}
      <div class="row wrap" style="margin:10px 0 18px"><button class="btn small" data-action="order" data-mv="${esc(name)}">${icon("list")}Watch order</button><button class="btn small" data-action="mvshare" data-mv="${esc(name)}">${icon("upload")}Share this list</button></div>
      ${Kit.grid(rows.map(r => r.html))}</section>`;
  }

  // ---- your year: films, episodes, games, books and stories, by month
  function yearCounts(year) {
    const ys = String(year), m = Array(12).fill(0);
    let films = 0, episodes = 0, rewatches = 0, minutes = 0, gamesN = 0, gameHours = 0, booksN = 0, pages = 0, stories = 0;
    const top = [];
    const mo = d => { const k = +String(d).slice(5, 7) - 1; if (k >= 0) m[k]++; };
    for (const it of lib.all()) {
      if (it.type === "movie") it.watches.forEach((d, i) => { if (String(d).startsWith(ys)) { films++; if (i) rewatches++; minutes += it.runtime || 110; mo(d); if (it.rating >= 8) top.push({ t: it.title, r: it.rating, img: it.poster, act: `data-action="libopen" data-id="${esc(it.id)}"`, kind: "movie" }); } });
      else { let any = 0; for (const d of Object.values(it.eps)) if (String(d).startsWith(ys)) { episodes++; minutes += it.runtime || 45; mo(d); any = 1; } if (any && it.rating >= 8) top.push({ t: it.title, r: it.rating, img: it.poster, act: `data-action="libopen" data-id="${esc(it.id)}"`, kind: "show" }); }
    }
    for (const g of games.visible()) g.plays.forEach(d => { if (String(d).startsWith(ys)) { gamesN++; gameHours += g.hours || 0; mo(d); if (g.rating >= 8) top.push({ t: g.title, r: g.rating, img: g.steam ? GC.COVER(g.steam) : "", act: `data-action="gopen" data-id="${esc(g.id)}"`, kind: "game" }); } });
    for (const b of books.books) for (const r of BC.readsOf(b)) { const d = r.finished ? new Date(r.finished).toISOString().slice(0, 10) : ""; if (d.startsWith(ys)) { booksN++; pages += b.pages || 0; mo(d); if (b.rating >= 8) top.push({ t: b.title, r: b.rating, img: (b.cover || "").replace(/^http:/, "https:"), act: `data-action="bopen" data-id="${esc(b.id)}"`, kind: "book" }); } }
    if (secOn("timeline")) for (const x of Kit.mods.timeline.recent(9999)) if (x.date.startsWith(ys)) { stories++; mo(x.date); }
    return { year, months: m, films, episodes, rewatches, hours: Math.round(minutes / 60), games: gamesN, gameHours: Math.round(gameHours), books: booksN, pages, stories, top: top.sort((a, b) => b.r - a.r).slice(0, 20) };
  }
  function renderYear() {
    const y = ui.year || new Date().getFullYear(), c = yearCounts(y), max = Math.max(1, ...c.months);
    const MON = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];
    return `<div class="row" style="margin-bottom:10px"><button class="iconbtn" data-action="yearstep" data-v="-1" aria-label="Previous year">‹</button><h2 class="grow" style="text-align:center;margin:0;font-size:30px">${y}</h2><button class="iconbtn" data-action="yearstep" data-v="1" aria-label="Next year" ${y >= new Date().getFullYear() ? "disabled" : ""}>›</button></div>
      <section><div class="bigstat">${fmt(c.hours + c.gameHours)}</div><div class="muted">hours of stories: ${fmt(c.hours)} watching (estimated from runtimes), ${fmt(c.gameHours)} playing (time to beat)</div></section>
      <div class="stat3"><div><b>${fmt(c.films)}</b><span>films${c.rewatches ? ` (${c.rewatches} rewatch${c.rewatches === 1 ? "" : "es"})` : ""}</span></div><div><b>${fmt(c.episodes)}</b><span>episodes</span></div><div><b>${fmt(c.games)}</b><span>games finished</span></div>
        <div><b>${fmt(c.books)}</b><span>books read</span></div><div><b>${fmt(c.pages)}</b><span>pages</span></div><div><b>${fmt(c.stories)}</b><span>Doctor Who stories</span></div></div>
      <section class="card" style="margin-top:20px"><div class="kicker" style="margin-bottom:10px">Month by month</div><div class="months">${c.months.map(n => `<i style="height:${Math.round(n / max * 100)}%" title="${n}"></i>`).join("")}</div><div class="months" style="height:auto">${MON.map(x => `<span>${x}</span>`).join("")}</div></section>
      ${c.top.length ? `<section>${Kit.head("Your favourites of the year")}${Kit.rail(c.top.map(x => Kit.tile({ title: x.t, img: x.img, kind: x.kind, badge: `★ ${x.r / 2}`, attrs: x.act }, x.t)))}</section>` : `<p class="muted">Rate what you finish (4 stars or more) and your favourites show up here.</p>`}`;
  }

  // ---- Sync: every source, what happened, and why
  function renderSync() {
    let state = {}; try { state = JSON.parse(db.get("sync_state", "{}")); } catch (e) { state = {}; }
    let stages = {}; try { stages = JSON.parse(db.get("stage_state", "{}")); } catch (e) { stages = {}; }
    const last = parseFloat(db.get("last_sync", "0")) || 0, fails = failedLabels();
    const srcRow = (label, s, running) => `<div class="srcrow"><span class="st ${running ? "run" : !s ? "" : s.ok ? "ok" : /PART|first page/.test(s.msg || "") || s.part ? "part" : "fail"}"></span>
      <div class="grow"><b>${esc(label)}</b><div class="small muted">${running ? "running…" : s ? `${esc(s.msg || "")}${s.at ? ` · ${esc(new Date(s.at).toLocaleString(lang() === "it" ? "it-IT" : "en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }))}` : ""}${s.ms ? ` · ${(s.ms / 1000).toFixed(1)} s` : ""}` : "not run yet"}</div></div></div>`;
    const sources = [];
    if (db.get("username")) sources.push("Trakt account");
    if (db.get("imdb_user")) sources.push("IMDb ratings");
    for (const k of Object.keys(state)) if (!sources.includes(k)) sources.push(k);
    const STG = [["library", "Library from IMDb and Trakt"], ["push", "Send your changes to Trakt"], ["services", "AniList, MyAnimeList, Letterboxd, Goodreads"], ["games", "Games: IMDb, Steam covers, prices and dates"], ["episodes", "Episode lists of your series"], ["details", "Posters, release dates and streaming"]];
    return `<section class="card"><div class="row"><div class="grow"><div class="kicker">${ui.job ? esc(ui.job) + "…" : "Last sync"}</div>
        <b style="font:800 22px/1.2 var(--display)">${ui.job ? esc(ui.status || "Working") : last ? esc(new Date(last * 1000).toLocaleString(lang() === "it" ? "it-IT" : "en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })) : "Never"}</b></div>
        ${ui.job ? `<button class="btn" data-action="stopjob">Stop</button>` : `<button class="btn primary" data-action="sync">${icon("sync")}Sync now</button>`}</div>
        ${!ui.job && fails.length ? `<button class="btn block" style="margin-top:12px" data-action="retryfailed">Retry the ${fails.length} that failed</button>` : ""}</section>
      <section class="card"><div class="row"><span class="st ${liveOn() ? "ok" : ""}" style="width:12px;height:12px;border-radius:50%;background:${liveOn() ? "var(--ok)" : "var(--faint)"};flex:none"></span><div class="grow"><b>Live sync with Trakt</b>
        <div class="small muted">${!db.get("username") ? "Add your Trakt username in Settings." : !liveOn() ? "Off. Switch it on in Settings › Trakt." : db.get("token") ? `On: what you log goes to Trakt within seconds; Trakt is checked every 10 minutes while the app is open, and in the background.${db.get("live_pull_at") ? ` Last check ${esc(new Date(+db.get("live_pull_at")).toLocaleTimeString(lang() === "it" ? "it-IT" : "en-GB", { hour: "2-digit", minute: "2-digit" }))}.` : ""}` : "On for reading: your public profile is checked every 3 hours. Sign in to Trakt to send what you log here."}</div></div></div></section>
      <section>${Kit.head("Sources")}<div class="listcard">${sources.length ? sources.map(l => srcRow(l, state[l], ui.job && /Syncing (.+)/.test(ui.status || "") && (ui.status || "").includes(l))).join("") : `<p class="muted small" style="padding:10px 0">No sources yet. Add your Trakt username or IMDb profile in Settings.</p>`}</div>
        <button class="btn small" style="margin-top:10px" data-action="go" data-sec="settings" data-scroll="accounts">Accounts and lists</button></section>
      <section>${Kit.head("Connection test", `<button class="btn quiet small" data-action="nettest"${ui.netTesting ? " disabled" : ""}>${ui.netTesting ? "Testing…" : "Test"}</button>`)}<div class="listcard">${ui.netTest ? ui.netTest.map(t => `<div class="srcrow"><span class="st ${t.ok ? "ok" : "fail"}"></span><div class="grow"><b>${esc(t.name)}</b><div class="small muted">${esc(t.msg)}</div></div></div>`).join("") : `<p class="muted small" style="padding:10px 0">Checks whether your phone can reach Trakt, TMDB, IMDb and the other sources. If one is blocked here but opens on another network, the block is on the network, not in the app.</p>`}</div></section>
      <section>${Kit.head("After the sources")}<div class="listcard">${STG.map(([k, l]) => srcRow(l, stages[k], ui.job && ui.stage === k)).join("")}</div></section>
      ${ui.report ? `<section>${Kit.head("Report", `<button class="btn quiet small" data-action="copydiag">${icon("copy")}Copy report and log</button>`)}<pre class="log">${esc(ui.report)}${db.get("stage_report") ? "\n" + esc(db.get("stage_report")) : ""}</pre>
        <details class="report"><summary>Technical log (every request, its answer and how long it took)</summary><pre class="log">${esc(db.get("sync_log", "") || "Empty")}</pre></details></section>` : ""}
      <p class="small muted">If a source keeps failing, tap Copy report and log and send it to whoever helps you with the app: it has no passwords or keys in it.</p>`;
  }
  // One quick request per host. Any HTTP answer (even 401/403/404) means the host is reachable.
  const NET_HOSTS = [["Trakt", "https://api.trakt.tv/"], ["TMDB", "https://api.themoviedb.org/3/configuration"], ["IMDb", "https://www.imdb.com/robots.txt"],
    ["TVmaze (series episodes)", "https://api.tvmaze.com/shows/1"], ["IMDb search", "https://v3.sg.media-imdb.com/suggestion/x/dune.json"], ["Jikan (anime, manga)", "https://api.jikan.moe/v4"], ["Steam store", "https://store.steampowered.com/robots.txt"], ["Steam profiles", "https://steamcommunity.com/robots.txt"], ["Google Books", "https://www.googleapis.com/books/v1/volumes?q=isbn:9780000000000"], ["Wikipedia", "https://en.wikipedia.org/robots.txt"]];
  async function netTest() {
    ui.netTesting = true; ui.netTest = null; render();
    const http = C.robust(Native.http, { timeout: 12000, tries: 1 });
    ui.netTest = await Promise.all(NET_HOSTS.map(async ([name, url]) => {
      const t0 = Date.now();
      let r; try { r = await http("GET", url, {}); } catch (e) { r = { status: 0, error: e.message }; }
      const ms = Date.now() - t0;
      return r.status ? { name, ok: true, msg: `reachable (HTTP ${r.status}, ${ms} ms)` } : { name, ok: false, msg: `blocked: ${C.netHint(r.error)}` };
    }));
    ui.netTesting = false;
    const bad = ui.netTest.filter(t => !t.ok).map(t => t.name);
    db.set("sync_log", `${db.get("sync_log", "")}\nConnection test: ${ui.netTest.map(t => `${t.name} ${t.ok ? "OK" : "BLOCKED"}`).join(", ")}`.slice(-60000));
    if (ui.sec === "sync") render();
    toast(bad.length ? `Blocked on this network: ${bad.join(", ")}` : "Every source is reachable");
  }
  function setStage(k, ok, msg, t0) {
    let s = {}; try { s = JSON.parse(db.get("stage_state", "{}")); } catch (e) { s = {}; }
    s[k] = { ok, msg, at: Date.now(), ms: t0 ? Date.now() - t0 : 0 };
    db.set("stage_state", JSON.stringify(s));
  }
  // After the sources: the library, Trakt, games, episodes. Each step is independent and time-limited.
  async function postSync(progress, http) {
    const lines = [];
    const step = async (k, label, fn, limit) => {
      if (C.CONFIG.cancelled) return;
      ui.stage = k; progress(null, label);
      const t0 = Date.now();
      try { const m = await C.withTimeout(Promise.resolve().then(fn), limit || 120000, "stopped after its time limit, continues next time"); lines.push(`OK   ${label}: ${m}`); setStage(k, true, m, t0); }
      catch (e) { lines.push(`FAIL ${label}: ${e.message}`); setStage(k, false, e.message, t0); }
    };
    await step("library", "Library", () => { const b = libTotals(), n = libAdopt(), a = libTotals(); return `${n} new titles, ${fmt(a.rated - b.rated)} ratings, ${fmt(a.er - b.er)} episode ratings, ${fmt(a.eps - b.eps)} episodes ticked (now ${fmt(a.titles)} titles, ${fmt(a.rated)} rated, ${fmt(a.er)} episode ratings)`; });
    if (feat("trakt") && db.get("token") && db.get("trakt_push", "1") === "1") await step("push", "Trakt", async () => { const m = await L.traktPush(lib, http, db.get("client_id"), db.get("token")); lib.save(); return m; });
    else setStage("push", true, db.get("token") ? "switched off in Settings" : "not signed in to Trakt (only needed to send changes)");
    const svc = [["anilist_user", "AniList", u => Imports.anilist(http, u)], ["mal_user", "MyAnimeList", u => Imports.malLists(http, u)],
      ["letterboxd_user", "Letterboxd", async u => ({ anime: await Imports.letterboxdRss(http, u), books: [] })], ["goodreads_user", "Goodreads", async u => ({ anime: [], books: await Imports.goodreadsRss(http, u) })]]
      .filter(([k]) => (db.get(k) || "").trim());
    if (svc.length) await step("services", "Other services", async () => {
      const out = [], fails = [];
      for (const [k, name, fn] of svc) {
        try {
          const r = await fn(db.get(k).trim());
          const parts = [];
          if (r.anime.length) { const m = lib.merge(r.anime, true); parts.push(`${fmt(r.anime.length)} titles (${fmt(m.added)} new)`); }
          if (r.books.length && secOn("books")) { const m = handOver("books", "", { rows: r.books, kind: name }); parts.push(`${fmt(r.books.length)} books${m && m.added != null ? ` (${fmt(m.added)} new)` : ""}`); }
          out.push(`${name}: ${parts.join(", ") || "nothing on the list"}`);
        } catch (e) { fails.push(e.message); logError("sync", e.message); }
      }
      libSave();
      if (fails.length && !out.length) throw new Error(fails.join("; "));
      return out.concat(fails).join("; ");
    });
    if (secOn("games")) await step("games", "Games", async () => {
      const im = GC.fromImdb(games, db.items(null, ["rated", "watched", "watchlist", "list"]).filter(r => r.medium === "Video Game" && r.source === "imdb"));
      let steamTxt = "";
      if (db.get("steam_profile")) {
        try { const rows = await Imports.steamLibrary(http, db.get("steam_profile"), db.get("steam_key")); const sr = GC.importRows(games, rows, "Steam library"); db.set("steam_sync_at", String(Date.now()));
          steamTxt = `Steam library: ${fmt(rows.length)} games found (${fmt(sr.added)} new, ${fmt(rows.length - sr.added)} already in Games)${!db.get("steam_key") && rows.length < 12 ? " — the profile page may show only some games: add a Steam Web API key for all of them" : ""}; `; }
        catch (e) { steamTxt = `Steam library failed: ${e.message}; `; }
      }
      const linked = await GC.linkSteam(games, http, 15, 900);
      const alerts = feat("priceAlerts") ? await GC.steamPrices(games, http, games.settings.region || "IT") : [];
      for (const a of alerts) Native.notify(C.hashId("gp|" + a.g.id + "|" + a.g.price.eur), a.why === "target" ? `Price alert: ${a.g.title}` : `On sale: ${a.g.title}`, `€${a.g.price.eur.toFixed(2)} on Steam${a.g.price.disc ? ` (−${a.g.price.disc}%)` : ""}`, "games");
      const dates = await GC.steamDates(games, http, 8);
      games.save();
      let storeN = 0;
      for (const g of games.visible().filter(g => g.status === "wishlist" && (!g.storesAt || Date.now() - g.storesAt > 2 * 864e5)).slice(0, 12)) {
        try { await GC.storePrices(g, http, { itadKey: db.get("itad_key"), country: games.settings.region || "IT" }); storeN++; } catch (e) { logError("prices", e.message); break; }
      }
      if (storeN) games.save();
      return `${steamTxt}${storeN ? `store prices for ${storeN} wishlist games, ` : ""}${im.added} from IMDb, ${linked} linked to Steam, ${alerts.length} price alerts, ${dates} dates updated`;
    }, 180000);
    await step("episodes", "Episodes", async () => {
      const shows = L.stale(lib).slice(0, 20);
      let n = 0;
      await C.pool(shows, 4, async it => { if (await L.details(http, it, libOpt())) n++; });
      libSave();
      return `${shows.length} series checked, ${n} updated`;
    }, 150000);
    ui.stage = null;
    return lines.join("\n");
  }
  // posters, dates and streaming in the background, after the sync has reported
  let detailsRunning = false;
  async function runDetails() {
    if (detailsRunning || !db.get("tmdb_key")) return;
    detailsRunning = true;
    const t0 = Date.now();
    try {
      const r = await C.details(db, Native.http, () => {});
      // where your watchlist streams, for the "On my services" filter
      const want = lib.all().filter(it => it.status === "watchlist").slice(0, 40);
      await C.pool(want, 3, it => C.titleInfo(db, C.robust(Native.http, { timeout: 25000, tries: 2 }), libCanon(it)).catch(() => null));
      setStage("details", !/FAIL/.test(r), r.split("\n").map(l => l.replace(/^\S+\s+/, "")).join(" · "), t0);
      db.set("stage_report", (db.get("stage_report", "") + "\n" + r).trim());
      invalidate(); db.flush();
    } catch (e) { setStage("details", false, e.message, t0); }
    detailsRunning = false;
    if (!ui.job && !document.querySelector("#overlay .sheet")) render();
  }
  // finished: watched here, caught up on an ended series, or watched/rated on IMDb or Trakt
  function isFinished(it) {
    if (it.status === "watched") return true;
    if (it.type === "movie" && it.watches.length) return true;
    if (it.type === "show" && it.ended && lib.caughtUp(it)) return true;
    return seenElsewhere(it);
  }
  let seenIdx = null, seenAt = 0;
  function seenElsewhere(it) {
    if (!seenIdx || Date.now() - seenAt > 5000) {
      seenIdx = new Set(); seenAt = Date.now();
      for (const r of db.items(null, ["watched", "rated"])) { if (r.source === "app" || r.medium === "Episode" || r.medium === "Video Game") continue; if (r.imdb) seenIdx.add(r.imdb); seenIdx.add(`${r.norm}|${r.year || ""}`); }
    }
    if (it.type === "show") return false; // a series you've started isn't finished just because you rated it
    return (it.imdb && seenIdx.has(it.imdb)) || seenIdx.has(`${L.norm(it.title)}|${it.year || ""}`);
  }
  const libCanon = it => ({ title: it.title, year: it.year, medium: it.type === "show" ? "TV Series" : "Movie", imdb: it.imdb || null, tmdb: it.tmdb || null, franchise: "" });
  function streamsFor(it) {
    const inf = C.cachedInfo(db, libCanon(it));
    if (!inf) return null;
    const mine = myServices().map(x => x.toLowerCase());
    const o = C.bestOffer(inf);
    const on = o && shortName(o.name).toLowerCase().replace(/\s*\(ads\)/, "");
    if (on && mine.some(m => on.includes(m) || m.includes(on))) return { mine: true, o };
    const v = feat("vpn") ? C.bestVpn(inf, myServices()) : null;
    return o ? { o } : v ? { vpn: v } : null;
  }

  // ---- artwork: TMDB where there's a key, otherwise IMDb's own poster (keyless), for films, series, games and canon
  const imdbImg = u => (u ? String(u).replace(/\._V1_.*\.(jpg|png)$/i, "._V1_UX300_.$1") : "");
  const imgOf = tt => (tt ? db.cacheGet("img:" + tt) || "" : "");
  function cImg(c) { if (c.poster) return IMG + "w342" + c.poster; return imgOf(canonKey(c)) || ""; }
  // Pictures for everything that has none, trying several sources per kind (images.js). A picture that fails to
  // load moves that title on to its next source. Titles nothing was found for are tried again after three days.
  let imgRunning = false, imgAgain = false;
  const imgState = () => { try { return JSON.parse(db.get("img_state", "{}")); } catch (e) { return {}; } };
  const canonKey = c => c.imdb || `${C.norm(c.title)}|${c.year || ""}`;
  function imgTargets(state) {
    const out = [], now = Date.now();
    const ok = k => { const s = state[k]; return !s || !s.none || now - s.at > 3 * 864e5; };
    for (const it of lib.all()) { const k = "lib:" + it.id; if (!it.poster && ok(k)) out.push({ k, o: { kind: it.anime ? "anime" : it.type === "show" ? "show" : "movie", title: it.title, year: it.year, imdb: it.imdb, tmdb: it.tmdb, mal: it.mal }, set: u => { it.poster = u; } }); }
    if (secOn("games")) for (const g of games.visible()) { const k = "game:" + g.id; if (!g.cover && (!g.steam || (state[k] && (state[k].skip || []).includes("steam"))) && ok(k)) out.push({ k, o: { kind: "game", title: g.title, year: GC.yearOf(g), imdb: g.imdb, steam: g.steam }, set: u => { g.cover = u; } }); }
    if (secOn("books")) for (const b of books.books) { const k = "book:" + b.id; if (!b.cover && ok(k)) out.push({ k, o: { kind: b.manga ? "manga" : "book", title: b.title, isbn: BC.bookIsbn(b), author: b.authors[0] || "", mal: b.mal, series: b.series }, set: u => { b.cover = u; } }); }
    for (const c of status().slice(0, 500)) { const k = "canon:" + canonKey(c); if (!c.poster && !imgOf(canonKey(c)) && ok(k)) out.push({ k, o: { kind: c.medium === "Video Game" ? "game" : c.medium === "TV Series" ? "show" : "movie", title: c.title, year: c.year, imdb: c.imdb }, set: u => db.cacheSet("img:" + canonKey(c), u) }); }
    return out;
  }
  async function fillImages(budget = 200) {
    if (imgRunning) { imgAgain = true; return 0; }
    imgRunning = true;
    const state = imgState();
    const jobs = imgTargets(state).slice(0, budget);
    const http = C.robust(Native.http, { timeout: 15000, tries: 1 });
    let n = 0;
    await C.pool(jobs, 4, async j => {
      const st = state[j.k] = state[j.k] || {};
      const r = await Images.find(http, j.o, { tmdbKey: db.get("tmdb_key"), skip: st.skip || [], country: db.get("region", "IT") });
      st.at = Date.now();
      if (r) { j.set(r.url); st.src = r.src; st.none = false; n++; } else st.none = true;
    });
    db.set("img_state", JSON.stringify(state));
    if (n) { lib.save(); games.save(); books.save(); db.flush(); invalidate(); if (!document.querySelector("#overlay .sheet")) render(); }
    imgRunning = false;
    if (imgAgain) { imgAgain = false; setTimeout(fillImages, 1000); }
    return n;
  }
  let brokenTimer = null;
  window.__imgBroken = (key, url) => {
    const state = imgState(), st = state[key] = state[key] || {};
    const src = st.src || (/steamstatic.*library_600x900/.test(url) ? "steam" : /steamstatic/.test(url) ? "steamHeader" : /tmdb/.test(url) ? "tmdb" : /media-amazon/.test(url) ? "imdbId" : /tvmaze/.test(url) ? "tvmaze" : /jikan|myanimelist/.test(url) ? "jikanAnime" : "");
    st.skip = [...new Set((st.skip || []).concat(src ? [src] : []))]; st.src = ""; st.none = false;
    db.set("img_state", JSON.stringify(state));
    const [kind, id] = [key.slice(0, key.indexOf(":")), key.slice(key.indexOf(":") + 1)];
    const clear = (o, f) => { if (o && o[f] && (!url || url.includes(String(o[f]).replace(/^https?:/, "")) || String(o[f]) === url)) o[f] = ""; };
    if (kind === "lib") clear(lib.get(id), "poster"); else if (kind === "game") clear(games.get(id), "cover"); else if (kind === "book") clear(books.get(id), "cover"); else db.cacheSet("img:" + id, "");
    clearTimeout(brokenTimer);
    brokenTimer = setTimeout(() => fillImages(60), 3000);
  };

  // ---- live sync with Trakt: what you log goes out within seconds; Trakt is checked when you open or come back
  // (every 10 minutes when signed in, using Trakt's "last activity" so nothing is fetched when nothing changed)
  let pushTimer = null, liveBusy = false;
  const liveOn = () => feat("trakt") && db.get("live_sync", "1") === "1" && db.get("username") && db.get("client_id");
  function pushSoon() {
    if (!liveOn() || !db.get("token") || db.get("trakt_push", "1") !== "1" || !lib.outbox.length) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(async () => {
      if (ui.job || liveBusy) return pushSoon();
      liveBusy = true;
      const t0 = Date.now();
      try { const m = await L.traktPush(lib, C.robust(Native.http, { timeout: 30000, tries: 2 }), db.get("client_id"), db.get("token")); lib.save(); setStage("push", true, m, t0); db.set("live_push_at", String(Date.now())); }
      catch (e) { setStage("push", false, e.message, t0); }
      liveBusy = false;
      if (ui.sec === "sync") render();
    }, 8000);
  }
  async function livePull(force) {
    if (!liveOn() || ui.job || liveBusy) return;
    const last = parseFloat(db.get("live_pull_at", "0")) || 0;
    if (!force && Date.now() - last < (db.get("token") ? 10 * 60000 : 3 * 3600000)) return;
    liveBusy = true;
    try {
      let changed = true, all = "";
      if (db.get("token")) {
        const r = await C.robust(Native.http, { timeout: 20000, tries: 2 })("GET", "https://api.trakt.tv/sync/last_activities", { headers: { "Content-Type": "application/json", "trakt-api-version": "2", "trakt-api-key": db.get("client_id"), Authorization: `Bearer ${db.get("token")}` } });
        if (r.status === 200) { try { all = JSON.parse(r.body || "{}").all || ""; } catch (e) { all = ""; } changed = !all || all !== db.get("trakt_last_all"); }
      }
      db.set("live_pull_at", String(Date.now()));
      if (changed) {
        const res = await C.syncAll(db, Native.http, () => {}, new Set(["Trakt account"]));
        if (res.ok) {
          if (all) db.set("trakt_last_all", all);
          libAdopt(); invalidate(); db.flush();
          const a = document.activeElement;
          if (!document.querySelector("#overlay .sheet") && !(a && a.dataset && a.dataset.input)) render();
        }
      }
    } catch (e) { /* tried again next time */ }
    liveBusy = false;
  }

  // ---- Share to Saga: a link or a title shared from any app
  window.__shared = async text => {
    text = String(text || "").trim();
    if (!text) return;
    const tt = (text.match(/tt\d{7,9}/) || [])[0];
    const steam = (text.match(/store\.steampowered\.com\/app\/(\d+)(?:\/([^/?#\s]+))?/) || []);
    const lbx = (text.match(/letterboxd\.com\/film\/([^/?#\s]+)/) || [])[1];
    const isbn = (text.replace(/[-\s]/g, "").match(/97[89]\d{10}/) || [])[0];
    const gr = (text.match(/goodreads\.com\/book\/show\/\d+[.-]([^?#\s]+)/) || [])[1];
    if (steam[1]) { go("games"); const t = steam[2] ? decodeURIComponent(steam[2]).replace(/_/g, " ") : ""; Kit.mods.games.ui.sq = t; Kit.mods.games.ui.res = []; render(); if (t) Kit.mods.games.act("gsearch", {}); return; }
    if (isbn || gr) { go("books"); Kit.mods.books.ui.sq = isbn || decodeURIComponent(gr).replace(/[_-]/g, " "); Kit.mods.books.ui.res = []; render(); Kit.mods.books.act("bsearch", {}); return; }
    let q = tt ? "" : lbx ? decodeURIComponent(lbx).replace(/-\d{4}$/, "").replace(/-/g, " ") : text.replace(/https?:\/\/\S+/g, "").replace(/\s+/g, " ").trim();
    if (tt) {
      try {
        const r = await Native.http("GET", `https://v3.sg.media-imdb.com/suggestion/x/${tt}.json`, {});
        const d = ((JSON.parse(r.body || "{}").d) || []).find(x => x.id === tt);
        if (d) { const show = /series/i.test(d.q || d.qid || ""); const { item } = lib.add({ type: show ? "show" : "movie", title: d.l, year: d.y || null, imdb: tt, poster: d.i ? imdbImg(d.i.imageUrl) : "", src: "share" }, "watchlist"); libSave(); go("library"); openLib(item.id); libDetails(item); toast(`Added ${d.l} to your watchlist`); return; }
      } catch (e) { /* fall back to search */ }
      q = tt;
    }
    go("library"); ui.libQ = q.slice(0, 80); libSearch();
  };
  window.__sharePoll = () => { try { const t = window.Android && Android.takeShared ? Android.takeShared() : ""; if (t) window.__shared(t); } catch (e) { /* not in the app */ } };
  // "Mark watched" on a notification: the app picks the tap up here
  function applyPending() {
    let acts = [];
    try { acts = JSON.parse(SH.read("pending_actions.json") || "[]"); } catch (e) { acts = []; }
    if (!acts.length) return;
    SH.write("pending_actions.json", "[]");
    let n = 0;
    for (const a of acts) {
      const it = lib.get(a.id);
      if (a.op === "ep" && it && !it.eps[L.epKey(a.s, a.e)]) { lib.toggleEp(it, a.s, a.e, (a.at || "").slice(0, 10) || TODAY()); n++; }
    }
    if (n) { libSave(); toast(`${n} episode${n === 1 ? "" : "s"} marked from notifications`); }
  }

  // ---- backup: one file with everything, by hand or automatically to a file you choose
  // API keys and sign-in tokens: kept on this phone, left out of backup files unless the person asks for them
  const SECRET_RX = C.SECRET_RX;
  const canonForBackup = withSecrets => { const j = db.toJSON(); if (withSecrets) { j.settings = Object.assign({}, j.settings, db.secretsAll()); return j; } const st = {}; for (const [k, v] of Object.entries(j.settings || {})) if (!SECRET_RX.test(k)) st[k] = v; j.settings = st; j.secretsLeftOut = true; return j; };
  const bundle = (withSecrets = db.get("backup_secrets", "0") === "1") => JSON.stringify({ app: "canonsync-all", v: 2, version: VERSION, at: new Date().toISOString(), canon: canonForBackup(withSecrets), library: lib.toJSON(), games: games.toJSON(), books: books.toJSON(), dw: Kit.mods.timeline.state() });
  const autoBackups = () => { try { return JSON.parse(db.get("auto_backups", "[]")); } catch (e) { return []; } };
  function autoBackup() {
    const last = parseFloat(db.get("auto_backup_at", "0")) || 0;
    if (Date.now() - last < 7 * 864e5 || (!db.items().length && !lib.all().length && !games.games.length && !books.books.length)) return;
    const slot = Math.floor(Date.now() / (7 * 864e5)) % 4;
    if (!SH.write(`auto_backup_${slot}.json`, bundle(false))) return; // keys stay in the phone's encrypted store, not in copies Android may back up
    const list = autoBackups().filter(b => b.slot !== slot).concat([{ slot, at: Date.now() }]).sort((a, b) => b.at - a.at).slice(0, 4);
    db.set("auto_backups", JSON.stringify(list));
    db.set("auto_backup_at", String(Date.now()));
  }
  // the file you picked once (Drive, a folder on the phone…) is rewritten after changes and at least daily
  // ---- password-protected backups: AES-GCM with a key made from the password (PBKDF2, 250,000 rounds)
  const LOCK_ITER = 250000;
  const toB64 = buf => { const b = new Uint8Array(buf); let out = ""; for (let i = 0; i < b.length; i += 32768) out += String.fromCharCode.apply(null, b.subarray(i, i + 32768)); return btoa(out); };
  const fromB64 = t => Uint8Array.from(atob(t), c => c.charCodeAt(0));
  async function lockKey(pw, salt, iter) {
    const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(pw), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: iter, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  }
  async function sealBackup(text, pw) {
    if (!(window.crypto && crypto.subtle)) throw new Error("This phone can't encrypt here");
    const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
    const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await lockKey(pw, salt, LOCK_ITER), new TextEncoder().encode(text));
    return JSON.stringify({ app: "saga-locked", v: 1, kdf: "PBKDF2-SHA256", iter: LOCK_ITER, salt: toB64(salt), iv: toB64(iv), data: toB64(data) });
  }
  async function openBackup(j, pw) {
    try {
      const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(j.iv) }, await lockKey(pw, fromB64(j.salt), j.iter || LOCK_ITER), fromB64(j.data));
      return new TextDecoder().decode(plain);
    } catch (e) { throw new Error("Wrong password, or the file is damaged"); }
  }
  const isLocked = text => { try { const j = JSON.parse(String(text || "").replace(/^\ufeff/, "")); return j && j.app === "saga-locked" ? j : null; } catch (e) { return null; } };
  // what goes into backup files you keep outside the app: locked when a backup password is set
  async function bundleOut() { const t = bundle(); const pw = db.get("backup_password"); return pw ? sealBackup(t, pw) : t; }
  async function backupToFile(force) {
    if (!db.get("backup_uri") || !(window.Android && Android.writeUri)) return false;
    const last = parseFloat(db.get("backup_file_at", "0")) || 0;
    if (!force && Date.now() - last < 10 * 60000) return false;
    db.set("backup_file_at", String(Date.now())); // set first: a slow encryption must not start a second write
    let ok = false;
    try { ok = Android.writeUri(db.get("backup_uri"), await bundleOut()); } catch (e) { logError("backup", e.message); }
    db.set("backup_file_ok", ok ? "1" : "0");
    db.flush();
    return ok;
  }
  window.__backupPicked = async uri => { if (uri) { db.set("backup_uri", uri); db.flush(); toast((await backupToFile(true)) ? "Backup file set and written" : "Couldn't write to that file"); } render(); };
  function applyBackup(b) {
    const done = [];
    const J = x => (typeof x === "string" ? JSON.parse(x) : x);
    if (b.canon) {
      // a backup without keys keeps the keys and sign-ins already on this phone
      const keep = Object.assign({}, db.secretsAll()); for (const [k, v] of Object.entries(db.toJSON().settings || {})) if (SECRET_RX.test(k)) keep[k] = v;
      const c = typeof b.canon === "string" ? JSON.parse(b.canon) : JSON.parse(JSON.stringify(b.canon));
      db.reset(); db.fromJSON(c); for (const [k, v] of Object.entries(keep)) if (!db.get(k)) db.set(k, v);
      db.flush(); invalidate(); done.push("Watch");
    }
    if (b.library) { const j = J(b.library); lib.items = {}; lib.adopted = j.adopted || {}; lib.outbox = []; for (const [k, v] of Object.entries(j.items || {})) lib.items[k] = L.blank(v); libSave(); done.push("Library"); }
    if (b.games) {
      const j = J(b.games);
      if (j && j.app === "games") games.fromJSON(j); else games.games = GC.fromOld(j.state || j, j.base || null);
      games.save(); done.push("Games");
    }
    if (b.books) { const j = J(b.books); const imp = BC.readImport(JSON.stringify(j), "backup.json"); books.books = []; BC.applyImport(books, imp, "replace"); if (j.goal) books.goal = j.goal; books.save(); done.push("Books"); }
    if (b.dw) { const j = J(b.dw); const s = j.state || j; Native.save("dw.json", JSON.stringify({ works: s.works || {}, migrated: 1 })); Kit.mods.timeline.reset(); done.push("Doctor Who"); }
    render();
    toast(`Restored: ${done.join(", ")}`);
  }
  function readBackup2(text) {
    let j = null;
    try { j = JSON.parse(String(text || "").replace(/^﻿/, "")); } catch (e) { /* the old reader explains */ }
    if (j && j.app === "canonsync-all") return { kind: "all", canon: j.canon, library: j.library || null, games: j.games, dw: j.dw, books: j.books || null, at: j.at };
    if (j && j.app === "games" && Array.isArray(j.games)) return { kind: "games", games: j };
    return C.readBackup(text);
  }
  async function restoreFrom(text) {
    const locked = isLocked(text);
    if (locked) {
      const saved = db.get("backup_password");
      if (saved) { try { return restoreFrom(await openBackup(locked, saved)); } catch (e) { /* a different password: ask */ } }
      return passwordDialog("This backup is locked", "Type the password it was saved with.", async pw => { try { restoreFrom(await openBackup(locked, pw)); } catch (e) { toast(e.message); } });
    }
    let b;
    try { b = readBackup2(text); } catch (e) { toast(e.message); return; }
    const parts = [b.canon && "Watch", b.library && "Library", b.games && "Games", b.books && "Books", b.dw && "Doctor Who"].filter(Boolean);
    confirmDialog("Restore this backup?", `This replaces ${parts.join(", ")}${b.at ? ` with the copy from ${new Date(b.at).toLocaleString()}` : " with what's in the file"}. A copy of what's there now is kept, so you can undo it in Settings › Data and about.`, "Restore", () => {
      // safety copy first (without keys: they stay in the phone's encrypted store)
      const kept = SH.write("before_restore.json", bundle(false));
      applyBackup(b);
      if (kept) { db.set("restore_undo_at", String(Date.now())); db.flush(); }
    });
  }
  function undoRestore() {
    const t = SH.read("before_restore.json");
    if (!t) { toast("The copy from before the restore is no longer on this phone"); db.set("restore_undo_at", ""); render(); return; }
    confirmDialog("Undo the last restore?", "Your data goes back to how it was just before that restore.", "Undo restore", () => {
      try { applyBackup(readBackup2(t)); SH.remove("before_restore.json"); db.set("restore_undo_at", ""); db.flush(); render(); } catch (e) { toast(e.message); }
    });
  }
  async function saveBackup() {
    let ok = false;
    try { ok = await Native.saveAs(`saga-backup-${TODAY()}.json`, await bundleOut()); } catch (e) { toast(e.message); return; }
    toast(ok ? (db.get("backup_password") ? "Backup saved, locked with your password" : "Backup saved") : "Backup not saved");
  }
  // exports in other sites' formats, so nothing is locked in here
  const csv = rows => rows.map(r => r.map(v => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(",")).join("\n");
  function exportFile(kind) {
    let name, text;
    if (kind === "letterboxd") {
      const rows = [["Title", "Year", "imdbID", "WatchedDate", "Rating10", "Rewatch"]];
      for (const it of lib.all().filter(x => x.type === "movie")) {
        if (!it.watches.length) { if (it.status === "watched" || it.rating) rows.push([it.title, it.year || "", it.imdb || "", "", it.rating || "", ""]); continue; }
        it.watches.forEach((d, i) => rows.push([it.title, it.year || "", it.imdb || "", d || "", i === it.watches.length - 1 ? it.rating || "" : "", i ? "true" : "false"]));
      }
      name = "saga-letterboxd.csv"; text = csv(rows);
    } else if (kind === "imdb") {
      const rows = [["Const", "Your Rating", "Date Rated", "Title", "URL", "Title Type", "Year"]];
      for (const it of lib.all()) if (it.imdb && (it.rating || it.status === "watched")) rows.push([it.imdb, it.rating || "", it.watches[it.watches.length - 1] || "", it.title, `https://www.imdb.com/title/${it.imdb}/`, it.type === "show" ? "TV Series" : "Movie", it.year || ""]);
      name = "saga-imdb-ratings.csv"; text = csv(rows);
    } else if (kind === "goodreads") {
      const rows = [["Title", "Author", "ISBN13", "My Rating", "Exclusive Shelf", "Date Read", "Date Added", "Bookshelves", "Number of Pages", "Read Count"]];
      for (const b of books.books) rows.push([b.title, b.authors[0] || "", BC.bookIsbn(b), b.rating ? Math.round(b.rating / 2) : 0, { want: "to-read", reading: "currently-reading", read: "read", dnf: "did-not-finish" }[b.status], b.finished ? new Date(b.finished).toISOString().slice(0, 10).replace(/-/g, "/") : "", new Date(b.added || Date.now()).toISOString().slice(0, 10).replace(/-/g, "/"), (b.shelves || []).join(" "), b.pages || "", BC.readsOf(b).length]);
      name = "saga-goodreads.csv"; text = csv(rows);
    } else {
      const rows = [["Title", "Platform", "Status", "Release", "Rating", "Finished dates", "Playthroughs", "Franchise", "Multiverse", "Owned on", "Hours", "Steam app"]];
      for (const g of games.visible()) rows.push([g.title, g.platform, g.status, g.date || g.dateText, g.rating || "", g.plays.join(" "), g.plays.length, g.franchise, g.multiverse, g.owned, g.hours || "", g.steam || ""]);
      name = "saga-games.csv"; text = csv(rows);
    }
    Native.saveAs(name, text).then(ok => toast(ok ? `${name} saved` : "Not saved"));
  }
  function backupSection() {
    const autos = autoBackups(), uri = db.get("backup_uri"), at = parseFloat(db.get("backup_file_at", "0")) || 0;
    return `<section class="stack" id="backup">
        <h2>Backup</h2>
        <div class="card"><b>Automatic backup file</b>
          <p class="small muted" style="margin:6px 0 10px">${uri ? `Written after changes and at least once a day${at ? `, last ${esc(new Date(at).toLocaleString(lang() === "it" ? "it-IT" : "en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }))}${db.get("backup_file_ok") === "0" ? " (failed: pick the file again)" : ""}` : ""}.` : "Pick a file once (in Google Drive, or a folder that syncs) and Saga keeps it up to date, so a new phone loses nothing."}</p>
          <div class="row wrap"><button class="btn ${uri ? "" : "primary"}" data-action="backupfile">${icon("upload")}${uri ? "Change the file" : "Choose a backup file"}</button>${uri ? `<button class="btn quiet" data-action="backupnow">Write it now</button>` : ""}</div></div>
        <div class="row wrap"><button class="btn" data-action="backupsave">${icon("upload")}Save a copy</button><button class="btn" data-action="backuppick">Restore from a file</button></div>
        <p class="small muted">Restore also takes backups from CanonSync, GameCheck, DW Canon and BookCheck.</p>
        ${autos.length ? `<div class="small muted">Weekly copies kept on this phone:</div>${autos.map(b => `<div class="row"><span class="grow small">${esc(new Date(b.at).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric" }))}</span><button class="btn quiet small" data-action="backupauto" data-slot="${b.slot}">Restore</button></div>`).join("")}` : ""}
        <h3 style="margin-top:12px">The old Games and Doctor Who screens</h3>
        <p class="small muted">Your data was brought over when 5.0 first started. If something looks missing, open the old screen once (it saves a copy as it opens), come back, and bring it over again: this replaces what's in the new section.</p>
        <div class="row wrap"><button class="btn small" data-action="classic" data-v="games">Open old Games</button><button class="btn small" data-action="reimport" data-v="games">Bring games over again</button>
          <button class="btn small" data-action="classic" data-v="dw">Open old Doctor Who</button><button class="btn small" data-action="reimport" data-v="dw">Bring Doctor Who marks over again</button></div>
        <h3 style="margin-top:12px">Export for other sites</h3>
        <div class="row wrap"><button class="btn small" data-action="export" data-v="letterboxd">Letterboxd (films)</button><button class="btn small" data-action="export" data-v="imdb">IMDb / Trakt ratings</button>
          <button class="btn small" data-action="export" data-v="goodreads">Goodreads (books)</button><button class="btn small" data-action="export" data-v="games">Games (CSV)</button></div>
      </section>`;
  }

  // ---- what the old cross-tab code expects, now straight from memory
  const gamesIdx = () => {
    if (!secOn("games")) return null;
    const mv = {};
    for (const g of games.visible()) { const k = g.multiverse || g.franchise; if (!k) continue; mv[k] = mv[k] || { n: 0, d: 0 }; mv[k].n++; if (g.status === "done") mv[k].d++; }
    return { next: games.nextUp(3).map(g => ({ id: g.id, t: g.title })), games: games.visible().map(g => ({ id: g.id, t: g.title, f: g.franchise, m: g.multiverse, y: GC.yearOf(g), d: g.status === "done" })), mv, recent: games.recent(20), upcoming: games.upcoming().map(g => ({ id: g.id, t: g.title, date: g.date })) };
  };
  const booksIdx = () => (secOn("books") ? Object.assign(BC.indexFor(books), { books: books.books.map(b => ({ id: b.id, t: b.title, a: b.authors[0] || "", se: b.series, n: b.seriesNum, s: b.status, d: b.status === "read" })) }) : null);
  const dwIdx = () => {
    if (!secOn("timeline") || !window.DW_DATA) return null;
    const st = Kit.mods.timeline.state(), stories = [];
    let n = 0, d = 0;
    for (const g of DW_DATA.groups) for (const t of g.tabs) for (const it of t.items) { if (it.ref) continue; const w = DW_DATA.works[it.k] || {}; const isD = !!(st.works[it.k] || {}).done; n++; if (isD) d++; stories.push({ k: it.k, t: w.title || it.raw, ty: w.type, tabName: t.name, d: isD }); }
    const nx = Kit.mods.timeline.next();
    return { stories, total: { n, d }, next: nx ? [{ k: nx.k, t: nx.title }] : [] };
  };
  function crossHome() { return ""; }
  function openIn(app, id) {
    closeOverlay();
    if (app === "games") { go("games"); Kit.mods.games.open(id); }
    else if (app === "books") { go("books"); Kit.mods.books.open(id); }
    else if (app === "dw") { go("timeline"); Kit.mods.timeline.openStory(id); }
  }
  const openApp = app => go(app === "dw" ? "timeline" : app);

  // ---- first start of 5.0: bring the old Games, Books and Doctor Who data in, once
  async function migrate() {
    if (db.get("saga5_migrated")) return;
    const existing = db.items().length || lib.all().length || Native.load("books.json") || db.get("username") || db.get("imdb_user");
    const ls = {};
    try { for (const k of ["gc_base", "gc_done", "gc_ov", "gc_ex", "gc_live", "gc_acm"]) { const v = localStorage.getItem(k); if (v != null) ls[k] = v; } } catch (e) { /* no storage */ }
    let gn = 0, dn = 0;
    if (!games.games.length) {
      let snap = null;
      try { snap = JSON.parse(SH.read("snap_games.json") || "null"); } catch (e) { snap = null; }
      let rows = [];
      if (GC.hasOld(ls)) rows = GC.fromOld(ls, null);
      else if (snap && (snap.base || snap.state)) rows = GC.fromOld(Object.assign({}, snap.state || snap, snap.base ? { base: snap.base } : {}), null);
      else if (existing && localStorage.getItem("gc_mine") !== "0") { await loadScript("gc-mine.js"); if (window.GC_MINE && window.GC_MINE.length) rows = GC.fromOld({}, window.GC_MINE); }
      if (rows.length) { games.games = rows; games.save(); gn = rows.length; }
    }
    if (window.DW_DATA) {
      const snapDw = SH.read("snap_dw.json");
      if (!snapDw && existing) await loadScript("dw-mine.js");
      dn = Kit.mods.timeline.migrate(snapDw, existing ? window.DW_MINE : null);
    }
    // books written by the old Books tab live in books.json already; a newer snapshot wins if the file is empty
    if (!books.books.length) { const sb = SH.read("snap_books.json"); if (sb) { try { BC.applyImport(books, BC.readImport(sb, "snap.json"), "replace"); books.save(); } catch (e) { /* nothing to bring */ } } }
    db.set("saga5_migrated", String(Date.now()));
    db.flush();
    if (gn || dn) toast(`Brought over ${gn ? `${fmt(gn)} games` : ""}${gn && dn ? " and " : ""}${dn ? `${fmt(dn)} Doctor Who marks` : ""}`);
    render();
  }
  const loadScript = src => new Promise(res => { const s = document.createElement("script"); s.src = src; s.onload = () => res(true); s.onerror = () => res(false); document.head.appendChild(s); });

  // ------------------------------------------------------------ dialogs
  function passwordDialog(title, body, onOk) {
    $("#overlay").innerHTML = `<div class="scrim" data-action="dismiss"><div class="dialog" role="dialog" aria-modal="true" aria-labelledby="dlgT">
      <h3 id="dlgT">${esc(title)}</h3><p class="muted">${esc(body)}</p>
      <label class="field"><span>Password</span><input type="password" id="dlgPw" autocomplete="off"></label>
      <div class="actions"><button class="btn quiet" data-action="dismiss">Cancel</button><button class="btn primary" id="dlgOk">Open</button></div></div></div>`;
    $("#dlgOk").onclick = () => { const v = $("#dlgPw").value; closeOverlay(); if (v) onOk(v); };
  }
  function confirmDialog(title, body, okLabel, onOk) {
    $("#overlay").innerHTML = `<div class="scrim" data-action="dismiss"><div class="dialog" role="dialog" aria-modal="true" aria-labelledby="dlgT">
      <h3 id="dlgT">${esc(title)}</h3><p class="muted">${esc(body)}</p>
      <div class="actions"><button class="btn quiet" data-action="dismiss">Cancel</button><button class="btn primary" id="dlgOk">${esc(okLabel)}</button></div></div></div>`;
    $("#dlgOk").onclick = () => { closeOverlay(); onOk(); };
  }
  const closeOverlay = () => { if (Kit.mods.books && Kit.mods.books.stopScan) Kit.mods.books.stopScan(); $("#overlay").innerHTML = ""; };

  window.__browserClosed = () => {
    db.set("imdb_signed_in", new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short" }));
    db.flush();
    toast("Back in Saga. Tap Sync now to use your IMDb sign-in.");
    if (ui.sec === "settings") render();
  };

  window.__back = () => {
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    if ($("#overlay").innerHTML) { closeOverlay(); return true; }
    if (ui.sec === "settings" && (ui.setGroup || ui.setQ)) { ui.setGroup = ""; ui.setQ = ""; render(); return true; }
    if (ui.sec !== "home") { go(ui.sec === "mv" || ui.sec === "year" || ui.sec === "sync" ? "home" : "home"); return true; }
    return false;
  };

  // ------------------------------------------------------------ actions
  const TRAKT_SKIP = "(^|/)(history|comments|likes|notes|recommendations|network|user-|profile)[^/]*$";
  async function doImport(kind) {
    // Trakt's history, comments and likes files aren't used and can be huge: they're left inside the ZIP
    const files = await Native.pick(kind !== "trakt" && kind !== "refract", kind === "trakt" ? TRAKT_SKIP : "");
    if (!files.length) return;
    await runJob("Import", async progress => {
      let total = 0;
      const errs = [];
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        progress(i / files.length, `Reading ${f.name}`);
        try {
          if (f.error) throw new Error(f.error);
          if (kind === "refract") {
            if (!f.zip) throw new Error("not a ZIP file: pick the export exactly as Refract saved it");
            total += C.importRefract(db, f.zip, f.zipOther || []).total;
          } else if (kind === "trakt") {
            if (!f.zip) throw new Error("not a ZIP file");
            total += C.importTraktZip(db, f.zip);
          } else if (f.zip && kind !== "franchise") {
            // a CSV export that arrived zipped: read every CSV inside
            const csvs = Object.entries(f.zip).filter(([n]) => /\.csv$/i.test(n));
            if (!csvs.length) throw new Error("no CSV inside this ZIP");
            for (const [n, t] of csvs) total += C.importImdbCsv(db, n.split("/").pop(), t, kind === "imdblist" ? "list" : "auto");
          } else {
            if (f.text === undefined) throw new Error("expected a text file, got a ZIP");
            if (kind === "imdb") total += C.importImdbCsv(db, f.name, f.text, "auto");
            else if (kind === "imdblist") total += C.importImdbCsv(db, f.name, f.text, "list");
            else total += C.importFranchiseFile(db, f.name, f.text);
          }
        } catch (e) { errs.push(`${f.name}: ${e.message}`); }
      }
      // say what the import changed in the library, not only how many rows the file had
      let what = "";
      try {
        const b = libTotals(); libAdopt();
        if (secOn("games")) { const im = GC.fromImdb(games, db.items(null, ["rated", "watched", "watchlist", "list"]).filter(r => r.medium === "Video Game" && r.source === "imdb")); if (im.added || im.rated) { games.save(); changed("games"); } b.gr = im.rated; b.ga = im.added; }
        const a = libTotals();
        what = `. Library: ${fmt(a.titles - b.titles)} new titles, ${fmt(a.rated - b.rated)} ratings, ${fmt(a.er - b.er)} episode ratings, ${fmt(a.eps - b.eps)} episodes ticked${b.ga || b.gr ? `; games: ${fmt(b.ga)} new, ${fmt(b.gr)} ratings` : ""}`;
      } catch (e) { logError("import", "library update after import failed: " + (e.stack || e.message)); what = ". The library couldn't be updated (see the error log in Settings)"; }
      ui.importWhat = what;
      ui.report = errs.length ? errs.map(e => "FAIL " + e).join("\n") : ui.report;
      if (errs.length && !total) throw new Error(errs[0]);
      return `Imported ${fmt(total)} records${errs.length ? `, ${errs.length} file(s) skipped` : ""}${ui.importWhat || ""}`;
    });
  }

  const failedLabels = () => { try { return JSON.parse(db.get("last_failed", "[]")); } catch (e) { return []; } };
  const labelOf = line => (line.match(/^(?:OK|FAIL|PART)\s+([^:]+):/) || [])[1];

  // Sync: the sources (Trakt and IMDb side by side), then the library, Trakt, games and episodes, each with a time
  // limit. Posters, dates and streaming follow in the background. Everything is written to the Sync screen.
  function doSync(retryOnly = false) {
    const only = retryOnly ? new Set(failedLabels()) : null;
    if (!retryOnly && ui.sec !== "sync" && db.get("sync_open", "1") === "1") go("sync");
    return runJob(retryOnly ? "Retry" : "Sync", async progress => {
      const http = C.robust(Native.http, { timeout: 30000, tries: 2 });
      const r = await C.syncAll(db, Native.http, (f, t) => progress(f == null ? null : f * 0.7, t), only);
      if (only) {
        const fresh = new Map(r.report.split("\n").map(l => [labelOf(l), l]));
        ui.report = (ui.report || "").split("\n").map(l => fresh.get(labelOf(l)) || l).join("\n");
      } else ui.report = r.report;
      db.set("last_report", ui.report);
      if (feat("streamAlerts")) for (const n of C.streamAlerts(db, C.canonStatus(db, threshold()), myServices())) Native.notify(n.id, n.title, n.text, n.tab);
      invalidate();
      progress(0.72, "Library, Trakt, games and episodes");
      const post = await postSync((f, t) => progress(null, t), http);
      db.set("stage_report", post);
      db.flush();
      setTimeout(() => { runDetails(); fillImages(); }, 300);
      try { updateWidget(); backupToFile(false).catch(() => {}); } catch (e) { /* optional */ }
      const stageFails = (post.match(/^FAIL/gm) || []).length;
      if (!r.total && !post) return retryOnly ? "Nothing to retry" : "Nothing to sync yet. Add sources in Settings.";
      return retryOnly ? `Retried ${r.total}: ${r.ok} now OK` : `Synced ${r.ok} of ${r.total} sources${r.failed.length ? `, ${r.failed.length} with problems` : ""}${stageFails ? `, ${stageFails} later steps failed` : ""}`;
    });
  }

  async function authorize() {
    commitFields();
    const prof = C.PROFILES[db.get("profile")] || C.PROFILES[DEFAULT_PROFILE];
    let challenge = null;
    if (prof.pkce) {
      const verifier = Native.randomUrl(48);
      db.set("pkce_verifier", verifier);
      challenge = await Native.sha256url(verifier);
    } else db.set("pkce_verifier", "");
    db.flush();
    Native.openUrl(C.authorizeUrl(db.get("client_id"), db.get("redirect"), challenge));
    toast("Approve Saga in the browser, then paste the code here");
  }

  function exchange() {
    let code = ($("#authcode") || {}).value || "";
    const m = code.match(/[?&]code=([^&#\s]+)/);
    if (m) code = decodeURIComponent(m[1]);
    code = code.trim();
    if (!code) { toast("Paste the code from Trakt first"); return; }
    runJob("Sign-in", async () => {
      const tok = await C.exchangeCode(Native.http, db.get("client_id"), db.get("redirect"), code,
                                       db.get("pkce_verifier") || null, db.get("secret") || null);
      db.set("token", tok.access_token);
      if (tok.refresh_token) db.set("refresh_token", tok.refresh_token);
      return "Signed in to Trakt";
    });
  }

  function markSeen(el) {
    const d = el.dataset;
    db.addExclusion(d.title, d.year ? parseInt(d.year, 10) : null, d.medium, d.imdb || null);
    db.flush();
    invalidate();
    toast(`Marked ${d.title} as seen`);
    render();
    if (feat("trakt") && db.get("trakt_push") === "1" && db.get("token") && d.medium !== "Video Game")
      traktDo({ title: d.title, year: d.year ? parseInt(d.year, 10) : null, medium: d.medium, imdb: d.imdb || null }, "history");
  }

  document.addEventListener("click", e => {
    const el = e.target.closest("[data-action]");
    if (!el) return;
    const a = el.dataset.action;
    if (a === "dismiss") { if (e.target === el) closeOverlay(); return; }
    if (a.startsWith("lib") && libAct(a, el)) { if (a === "libseasonopen") return; e.preventDefault(); return; }
    for (const m of Object.values(Kit.mods)) if (m.act && m.act(a, el, e)) { e.preventDefault(); return; }
    switch (a) {
      case "search": openSearch(); break;
      case "go": { const sc = el.dataset.scroll; closeOverlay(); if (el.dataset.sec === "settings") ui.setGroup = sc ? SET_ANCHOR[sc] || "" : ""; go(el.dataset.sec); if (sc) setTimeout(() => { const t = document.getElementById(sc); if (t) t.scrollIntoView({ block: "start" }); }, 40); break; }
      case "icsexport": { const c = icsText(); if (!c.n) { toast("Nothing dated in the next six months"); break; } Native.saveAs("saga-upcoming.ics", c.text).then(ok => toast(ok ? `${c.n} dates saved. Open the file to add them to your calendar.` : "Not saved")); break; }
      case "mvshare": { const name = el.dataset.mv, n = C.norm(name), rows = status().filter(c => C.norm(c.franchise) === n).sort((a, b) => C.releaseKey(a).localeCompare(C.releaseKey(b)));
        if (!rows.length) { toast("No canon entries in this multiverse yet"); break; }
        const text = `# ${name}\n` + rows.map(c => `${c.title}${c.year ? ` (${c.year})` : ""}`).join("\n") + "\n";
        Native.saveAs(`${name.replace(/[^\w ]+/g, "").trim() || "canon"} canon list.txt`, text).then(ok => toast(ok ? `${rows.length} entries saved. Anyone can load it with Settings › Import › Franchise mapping file.` : "Not saved")); break; }
      case "listlib": { let st = {}; try { st = JSON.parse(db.get("lib_lists", "{}")) || {}; } catch (e) { st = {}; }
        const [src, ...nm] = el.dataset.k.split("|"), on = el.dataset.on ? true : !listOn(src, nm.join("|")); st[el.dataset.k] = on ? 1 : 0; db.set("lib_lists", JSON.stringify(st));
        const b = libTotals(); libAdopt(); libSave(); const a = libTotals(); toast(on ? `List switched on: ${fmt(a.titles - b.titles)} titles added` : "List switched off (titles already added stay)"); render(); break; }
      case "lookback": { delete lib.adopted[el.dataset.k]; const b = libTotals(); libAdopt(); libSave(); const a = libTotals(); toast(a.titles > b.titles ? "Brought into the library" : "Updated"); render(); break; }
      case "theme": setLook("saga_theme", el.dataset.v === "night" ? "" : el.dataset.v); render(); break;
      case "whatsnew": whatsNew(true); break;
      case "undo": { const f = undoFn; undoFn = null; $("#toast").classList.remove("show"); if (f) { try { f(); } catch (e) { logError("undo", e.message); } } break; }
      case "errcopy": Native.copy(`Saga ${VERSION} error log\n` + errLog().map(x => `${new Date(x.at).toISOString()} [${x.k}] ${x.s || ""} v${x.v}${x.n > 1 ? " x" + x.n : ""}: ${x.m}`).join("\n")); toast("Error log copied"); break;
      case "librandom": { const pool = lib.all().filter(x => x.status === "watchlist"); if (!pool.length) { toast("Your watchlist is empty"); break; } const pick = pool[Math.floor(Math.random() * pool.length)]; openLib(pick.id); toast(`How about ${pick.title}?`); break; }
      case "errclear": try { localStorage.removeItem("saga_errors"); } catch (e) { /* fine */ } render(); break;
      case "setgroup": ui.setGroup = el.dataset.v || ""; ui.setQ = ""; render(); window.scrollTo(0, 0); break;
      case "close": closeOverlay(); break;
      case "gosync": go("sync"); break;
      case "stopjob": C.CONFIG.cancelled = true; toast("Stopping after the current step…"); break;
      case "searchweb": { const q = ui.allQ || ""; closeOverlay(); const v = el.dataset.v;
        if (v === "watch") { go("library"); ui.libQ = q; libSearch(); } else if (v === "games") { go("games"); Kit.mods.games.ui.sq = q; Kit.mods.games.ui.res = []; render(); Kit.mods.games.act("gsearch", {}); } else { go("books"); Kit.mods.books.ui.sq = q; Kit.mods.books.ui.res = []; render(); Kit.mods.books.act("bsearch", {}); } break; }
      case "nettest": netTest(); break;
      case "copydiag": Native.copy(`Saga ${VERSION} sync report\n${ui.report || ""}\n${db.get("stage_report", "")}\n\n${(db.get("sync_log", "") || "").replace(/(api_key|key|token)=[^&\s]+/gi, "$1=…")}`); toast("Report and log copied"); break;
      case "mvopen": closeOverlay(); ui.mv = el.dataset.mv; go("mv"); break;
      case "tlhome": closeOverlay(); go("timeline"); Kit.mods.timeline.openStory(el.dataset.k); break;
      case "yearstep": ui.year = (ui.year || new Date().getFullYear()) + (+el.dataset.v); render(); break;
      case "export": exportFile(el.dataset.v); break;
      case "classic": if (window.Android && Android.openClassic) Android.openClassic(el.dataset.v); else toast("Only in the app"); break;
      case "reimport": confirmDialog("Bring it over again?", el.dataset.v === "games" ? "Your games here are replaced by the old Games screen's list, marks and playthroughs." : "Your Doctor Who marks here are replaced by the old screen's.", "Replace", () => {
        if (el.dataset.v === "games") { db.set("saga5_migrated", ""); games.games = []; games.save(); }
        else { Native.save("dw.json", JSON.stringify({ works: {} })); Kit.mods.timeline.reset(); db.set("saga5_migrated", ""); }
        migrate().then(() => toast("Done"));
      }); break;
      case "backupfile": if (window.Android && Android.pickBackupFile) Android.pickBackupFile(`saga-backup.json`); else toast("Only in the app"); break;
      case "backupnow": backupToFile(true).then(ok => { toast(ok ? "Backup written" : "Couldn't write the backup file: choose it again"); render(); }); break;
      case "undorestore": undoRestore(); break;
      case "tab": closeOverlay(); if (el.dataset.tab === "settings") ui.setGroup = SET_ANCHOR[el.dataset.scroll] || ""; setTab(el.dataset.tab); if (el.dataset.scroll) setTimeout(() => { const t = document.getElementById(el.dataset.scroll); if (t) t.scrollIntoView({ block: "start" }); }, 30); break;
      case "sync": doSync(); break;
      case "import": doImport(el.dataset.kind); break;
      case "open": Native.openUrl(el.dataset.url); break;
      case "seen": closeOverlay(); markSeen(el); break;
      case "sheet": openSheet(el.dataset.sid); break;
      case "uphide":
        closeOverlay();
        db.setUpHidden(el.dataset.key, el.dataset.label, true); db.flush();
        toast(`Hid ${el.dataset.label} from Upcoming. Undo in Settings.`); render();
        break;
      case "upshow": db.setUpHidden(el.dataset.key, "", false); db.flush(); render(); break;
      case "homecal": db.set("home_calendar", el.dataset.v); db.flush(); if (el.dataset.v === "0") toast("Calendar hidden from Home. Turn it back on in Settings."); render(); break;
      case "reporttoggle": ui.reportOpen = !ui.reportOpen; break;
      case "aiscan": { commitFields(); const cfg = { preset: db.get("ai_preset", "openai"), key: db.get("ai_key"), model: db.get("ai_model"), base: db.get("ai_base") }, lbl = (C.AI_PRESETS[cfg.preset] || {}).label || "AI";
        runJob(`${lbl} scan`, p => C.compatScan(db, Native.http, cfg, p).then(n => { const g = C.aiState(db, "ai"); return `${lbl} added ${fmt(n)} canon entries. Checked ${fmt(g.sent.size)} of ${fmt(g.pool.length)} titles${g.pending.length ? ", run again to continue" : ""}`; })); break; }
      case "claude":
        runJob("Claude scan", p => C.claudeScan(db, Native.http, db.get("claude_key"), db.get("claude_model") || "auto", p, { webSearch: db.get("claude_web", "1") === "1" })
          .then(n => { const g = C.aiState(db, "claude"); return `Claude added ${fmt(n)} canon entries. Checked ${fmt(g.sent.size)} of ${fmt(g.pool.length)} titles${g.pending.length ? ", run again to continue" : ""}`; }));
        break;
      case "aireset": {
        const origin = el.dataset.origin, label = el.dataset.label;
        confirmDialog(`Start the ${label} scan over?`, `Removes the canon ${label} found so far. The next scan checks all your titles again.`, "Start over", () => {
          C.resetAi(db, origin); db.flush(); invalidate(); render(); toast(`${label} results cleared`);
        });
        break;
      }
      case "canon1": { const d = el.dataset; closeOverlay(); libCanonOne({ title: d.title, year: d.year ? parseInt(d.year, 10) : null, type: d.medium === "TV Series" ? "show" : "movie" }); break; }
      case "notcanon": {
        closeOverlay();
        const d = el.dataset;
        const c = { title: d.title, year: d.year ? parseInt(d.year, 10) : null, medium: d.medium, imdb: d.imdb || null, franchise: d.franchise };
        db.setNotCanon(c, true); db.flush(); invalidate();
        toast(`${d.title} won't count as canon. Undo in Settings.`);
        render();
        break;
      }
      case "uncanon": {
        const v = db.notCanon()[el.dataset.key];
        if (v) db.setNotCanon(Object.assign({ imdb: /^tt\d+$/.test(el.dataset.key) ? el.dataset.key : null }, v), false);
        db.flush(); invalidate(); render();
        break;
      }
      case "towatch": ui.upFilter = "towatch"; setTab("upcoming"); break;
      case "upfilter": ui.upFilter = el.dataset.v; ui.upLimit = 200; render(); break;
      case "upmore": ui.upLimit = (ui.upLimit || 200) + 200; render(); break;
      case "refreshshows":
        runJob("Refresh shows", async p => { p(0.1, "Checking your shows on TMDB"); return `TMDB: ${await C.tvNext(db, Native.http, db.get("tmdb_key"), 450, Date.now(), true)}`; });
        break;
      case "toggle": {
        const f = el.dataset.f;
        if (ui.open.has(f)) ui.open.delete(f); else ui.open.add(f);
        $("#missingList").innerHTML = listHtml();
        break;
      }
      case "hide":
        closeOverlay();
        db.setHidden(el.dataset.f, true); db.flush(); invalidate();
        toast(`Hid ${el.dataset.f}. Undo it in Settings.`); render(); break;
      case "unhide": db.setHidden(el.dataset.f, false); db.flush(); invalidate(); render(); break;
      case "unexclude": db.removeExclusion(el.dataset.key); db.flush(); invalidate(); render(); break;
      case "med": ui.missingMed = el.dataset.m; render(); break;
      case "mview": ui.missingView = el.dataset.v; ui.relLimit = 300; render(); break;
      case "nextonly": ui.nextOnly = !ui.nextOnly; render(); break;
      case "showlisted": ui.showListed = !ui.showListed; render(); break;
      case "relmore": ui.relLimit = (ui.relLimit || 300) + 300; $("#missingList").innerHTML = listHtml(); break;
      case "geminireset":
        confirmDialog("Start the Gemini scan over?", "Removes the canon Gemini found so far. The next scan checks all your titles again from the beginning.", "Start over", () => {
          C.resetGemini(db); db.flush(); invalidate(); render(); toast("Gemini results cleared");
        });
        break;
      case "view": ui.cmpView = el.dataset.v; ui.cmpLimit = 150; render(); break;
      case "more": ui.cmpLimit += 150; $("#cmpList").innerHTML = renderCompareList(); break;
      case "copy": {
        const rows = ui.missingView === "release"
          ? (() => { const r = C.releaseList(status()); return releaseRows(r.released).concat(releaseRows(r.upcoming)); })()
          : missingGroups().flatMap(([, items]) => items);
        Native.copy(rows.map(r => `${when(r)} | ${r.upNext ? "UP NEXT | " : ""}${r.title} [${r.medium}] | ${r.franchise}`).join("\n"));
        toast(`Copied ${fmt(rows.length)} titles`);
        break;
      }
      case "tmdb":
        runJob("TMDB scan", p => C.collectionScan(db, Native.http, db.get("tmdb_key"), p).then(n => `TMDB scan found ${fmt(n)} collection entries`));
        break;
      case "stopjob": C.CONFIG.cancelled = true; toast("Stopping after the current batch"); break;
      case "gapp": gappRun(el.dataset.k); break;
      case "mv": mvRun(el.dataset.k, el.dataset.via, el.dataset.only || null); break;
      case "xapp": openApp(el.dataset.app); break;
      case "xopen": closeOverlay(); openIn(el.dataset.app, el.dataset.id, el.dataset.tabid); break;
      case "sres": {
        const r = (ui.sres || [])[+el.dataset.i];
        if (!r) break;
        if (r.app === "canon") openSheet(sid(r.c || r.item, r.c ? "canon" : "item"));
        else { closeOverlay(); openIn(r.app, r.id, r.tab); }
        break;
      }
      case "order": openOrder(el.dataset.mv); break;
      case "ordermode": openOrder(ui.order.mv, el.dataset.v); break;
      case "orderget": orderGet(el.dataset.via); break;
      case "trakt": { const c = ui.sheetC; closeOverlay(); if (c) traktDo(c, el.dataset.k); break; }
      case "backupsave": saveBackup(); break;
      case "hubpick": Native.pick(true).then(files => { if (!files.length) return; runJob("Import", async () => (await hubImport(files)).join(" · ")); }); break;
      case "hubsteam": hubSteam(); break;
      case "recentall": sheet(`<h3 style="font:800 24px/1.1 var(--display);margin:4px 0 14px">Recently watched, played and read</h3>${Kit.grid(recentAll(90).map(recentTile)) || '<p class="muted">Nothing yet.</p>'}`); break;
      case "backuppick": Native.pick(false).then(files => { const f = files[0]; if (!f) return; if (f.text === undefined) return toast("That's a ZIP, not a backup file"); restoreFrom(f.text); }); break;
      case "backupauto": { const t = SH.read(`auto_backup_${el.dataset.slot}.json`); if (t) restoreFrom(t); else toast("That copy is no longer on this phone"); break; }
      case "mvlist": ui.mvOpen = !ui.mvOpen; render(); break;
      case "gemfailx": ui.gemFail = ""; render(); break;
      case "gappreset": db.set("gapp_verified", "[]"); db.flush(); render(); toast("The Gemini app will check every missing entry again"); break;
      case "gemini":
        runJob("Gemini scan", p => C.multiverseScan(db, Native.http, db.get("gemini_key"), db.get("gemini_model") || "auto", p, 40, 25, { search: db.get("gemini_search", "0") === "1" })
          .then(n => { const g = C.geminiState(db); return `Gemini added ${fmt(n)} canon entries. Checked ${fmt(g.sent.size)} of ${fmt(g.pool.length)} titles${g.pending.length ? ", run again to continue" : ""}`; },
                e => { if (!/network error/i.test(e.message)) ui.gemFail = e.message; throw e; }));
        break;
      case "s0":
        ui.s0all = !!($("#s0all") || {}).checked;
        runJob("Specials check", p => C.season0Scan(db, Native.http, db.get("tmdb_key"), threshold(), p, ui.s0all).then(n => `Checked ${fmt(n)} titles`));
        break;
      case "authorize": authorize(); break;
      case "testgemini":
        commitFields();
        runJob("Gemini test", async p => {
          p(0.3, "Asking Google…");
          try {
            const r = await C.testGemini(Native.http, db.get("gemini_key"), db.get("gemini_model") || "auto");
            db.set("gemini_test", `OK: ${r.model} answered (${r.models} usable models).`);
            return "Gemini key works";
          } catch (e) { db.set("gemini_test", e.message); throw e; }
        });
        break;
      case "copyreport": Native.copy(ui.report); toast("Report copied"); break;
      case "retryfailed": doSync(true); break;
      case "bgnow":
        runJob("Release check", async p => {
          const r = await C.backgroundRun(db, Native.http, p);
          for (const n of r.notes) Native.notify(n.id, n.title, n.text, n.tab);
          return r.notes.length ? `${r.notes.length} notification${r.notes.length === 1 ? "" : "s"} sent` : "Checked. Nothing new since the last check";
        });
        break;
      case "imdbsignin":
        Native.openInApp("https://www.imdb.com/registration/signin/");
        toast("Sign in, then press back to return to Saga");
        break;
      case "exchange": exchange(); break;
      case "signout": db.set("token", ""); db.set("refresh_token", ""); db.flush(); render(); toast("Signed out of Trakt"); break;
      case "clear":
        confirmDialog("Clear imported data?", "Synced and imported titles, scan results and caches are removed. Settings and titles you marked as seen stay.", "Clear data", () => {
          db.clearCache(); db.set("last_report", ""); ui.report = ""; db.flush(); invalidate(); render(); toast("Imported data cleared");
        });
        break;
    }
  });

  let inputTimer = null;
  let modTimer = null;
  document.addEventListener("input", e => {
    const el = e.target;
    for (const m of Object.values(Kit.mods)) if (m.input && m.input(el)) { clearTimeout(modTimer); modTimer = setTimeout(render, 160); return; }
    const key = el.dataset && el.dataset.input;
    if (!key) return;
    if (key === "threshold") { $("#thrLabel").textContent = `Title similarity needed: ${el.value}%`; return; }
    ui[key] = el.value;
    clearTimeout(inputTimer);
    inputTimer = setTimeout(() => {
      if (key === "missingQ") $("#missingList").innerHTML = listHtml();
      if (key === "allQ" && $("#allRes")) $("#allRes").innerHTML = searchResults();
      if (key === "cmpQ") { ui.cmpLimit = 150; $("#cmpList").innerHTML = renderCompareList(); }
      if (key === "libFilterQ") { ui.libLimit = 150; render(); }
      if (key === "setq") { ui.setQ = el.value; clearTimeout(ui.setQT); ui.setQT = setTimeout(() => { render(); const q = $("#setQ"); if (q) { q.focus(); try { q.setSelectionRange(q.value.length, q.value.length); } catch (e) { /* not a text field */ } } }, 180); }
      if (key === "lookupq") { ui.lookupQ = el.value; render(); }
    }, 150);
  });

  document.addEventListener("keydown", e => {
    if (e.key !== "Enter" || !e.target.dataset) return;
    for (const m of Object.values(Kit.mods)) if (m.enter && m.enter(e.target)) { e.preventDefault(); return; }
    if (e.target.dataset.input === "libQ") { e.preventDefault(); ui.libQ = e.target.value; libSearch(); }
    if (e.target.id === "libTag") { e.preventDefault(); const b = document.querySelector('[data-action="libtagadd"]'); if (b) b.click(); }
  });
  document.addEventListener("change", e => {
    const el = e.target;
    for (const m of Object.values(Kit.mods)) if (m.change && m.change(el)) return;
    if (el.dataset && el.dataset.libsort) { ui.libSort = el.value; render(); return; }
    if (el.dataset && el.dataset.libtype) { ui.libType = el.value; render(); return; }
    if (el.dataset && el.dataset.libnotes) { const it = lib.get(ui.libOpen); if (it) { it.notes = el.value.trim(); lib.save(); } return; }
    if (el.dataset && el.dataset.accent) { setLook("saga_accent", el.value); return; }
    if (el.dataset && el.dataset.textsize) { setLook("saga_text", el.checked ? "large" : ""); return; }
    if (el.dataset && el.dataset.lang) { BantaShell.setLang(el.value); toast(el.value === "it" ? "Italiano attivo" : "English on"); render(); return; }
    if (el.dataset && el.dataset.feature) {
      BantaShell.setFeature(el.dataset.feature, el.checked);
      if (el.dataset.feature === "streamAlerts") { db.set("stream_alerts", el.checked ? "1" : "0"); db.flush(); }
      toast(`${FEATURES.find(f => f[0] === el.dataset.feature)[1]}: ${el.checked ? "on" : "off"}`);
      return;
    }
    if (!el.dataset || !el.dataset.setting) return;
    const k = el.dataset.setting;
    const v = el.type === "checkbox" ? (el.checked ? "1" : "0") : el.value.trim();
    db.set(k, v);
    if (k === "profile") {
      const p = C.PROFILES[v];
      if (p) { db.set("client_id", p.client_id); db.set("redirect", p.redirect); }
      render();
    }
    if (k === "threshold") invalidate();
    if (k === "ai_preset" || k === "ai_key") render(); // the key field and scan button follow the chosen service
    if (k.startsWith("bg_")) {
      applyBackground();
      if (k === "bg_enabled" && v === "1") Native.requestNotifications();
      render();
    }
    db.flush();
  });

  window.addEventListener("pagehide", () => { commitFields(); db.flush(); });
  document.addEventListener("visibilitychange", () => { if (document.hidden) { commitFields(); db.flush(); } });

  function applyBackground() {
    Native.setBackground(db.get("bg_enabled", "1") === "1", parseInt(db.get("bg_hours", "12"), 10) || 12);
  }

  // home-screen shortcuts (long-press the app icon) arrive as pseudo-tabs
  function shortcut(t) {
    if (t === "search") { go("home"); setTimeout(openSearch, 60); return true; }
    if (t === "syncnow") { go("sync"); if (!ui.job) doSync(); return true; }
    if (t === "scanbook") { go("books"); setTimeout(() => { const b = document.querySelector('[data-action="bscan"]'); if (b) b.click(); }, 120); return true; }
    if (t === "nextep") { go("watch", "library"); ui.libF = "watching"; render(); return true; }
    return false;
  }
  window.__openTab = t => { if (!shortcut(t)) go(t === "dw" ? "timeline" : t === "canon" ? "home" : t); };
  // The background job may have saved new data while the app was paused.
  // Coming back (from another tab, the Gemini app or a notification): only re-read and recompute if the
  // background sync changed the file meanwhile; otherwise just refresh date-dependent text.
  window.__resumed = () => {
    if (ui.job) return;
    if (db.reload()) { invalidate(); ui.report = db.get("last_report", ui.report); }
    const ls = window.Android && Android.stamp ? String(Android.stamp("library.json") || "") : "";
    if (ls && ls !== libStamp) { libStamp = ls; const fresh = new L.Library({ load: () => Native.load("library.json") }); lib.items = fresh.items; lib.adopted = fresh.adopted; lib.outbox = fresh.outbox; libMirror(); }
    try { const gs = Android.stamp("games.json"); if (gs && gs !== ui.gStamp) { if (ui.gStamp) { const t = Native.load("games.json"); if (t) games.fromJSON(JSON.parse(t)); } ui.gStamp = gs; } } catch (e) { /* not in the app */ }
    try { const bs = Android.stamp("books.json"); if (bs && bs !== ui.bStamp) { if (ui.bStamp) { const t = Native.load("books.json"); if (t) books.fromJSON(JSON.parse(t)); } ui.bStamp = bs; } } catch (e) { /* not in the app */ }
    applyPending();
    livePull();
    if (!BantaAI.isOpen()) render();
  };

  // ------------------------------------------------------------ start
  const Saga = window.Saga = { http: C.robust(Native.http, { timeout: 30000, tries: 2 }), Native, db, games, books, lib, lang, feat, render, sheet, go, changed,
    close: () => { if (Kit.mods.books && Kit.mods.books.stopScan) Kit.mods.books.stopScan(); closeOverlay(); } };
  Kit.toast = toast; Kit.icon = icon; Kit.sheet = sheet; Kit.close = Saga.close;
  ui.sec = "home"; ui.tab = "library";
  const startTab = (location.hash || "").slice(1);
  if (startTab) { const t = startTab === "dw" ? "timeline" : startTab === "canon" ? "home" : startTab; if (SECR[t] || Kit.mods[t] || WATCH.some(w => w[0] === t) || t === "watch") { if (WATCH.some(w => w[0] === t)) { ui.sec = "watch"; ui.tab = t; } else ui.sec = t; } }
  render();
  if (["search", "syncnow", "scanbook", "nextep"].includes(startTab)) setTimeout(() => shortcut(startTab), 300);
  migrate().catch(e => console.error(e));
  applyPending();
  setTimeout(() => window.__sharePoll(), 400);
  applyBackground();
  try { autoBackup(); } catch (e) { /* tried again next start */ }
  try { backupToFile(false).catch(() => {}); } catch (e) { /* next time */ }
  setTimeout(() => livePull(), 4000);
  if (lsGet("saga_theme")) setLook("saga_theme", lsGet("saga_theme")); // the phone's bars follow the theme
  // (automated test browsers skip it unless they ask, so it doesn't cover what they're testing)
  setTimeout(() => { try { if (!$(".sheet") && !BantaAI.isOpen() && (!navigator.webdriver || window.__wantWhatsNew)) whatsNew(false); } catch (e) { logError("whatsnew", e.message); } }, 900);
  setInterval(() => { if (!document.hidden) livePull(); }, 5 * 60000);
  setTimeout(() => { fillImages().catch(() => {}); if (secOn("games")) GC.linkSteam(games, Saga.http, 40, 700).then(n => { if (n) { games.save(); if (!document.querySelector("#overlay .sheet")) render(); } }).catch(() => {}); }, 2500);
  if (db.get("bg_enabled", "1") === "1" && !db.get("notif_asked")) { Native.requestNotifications(); db.set("notif_asked", "1"); }
  const last = parseFloat(db.get("last_sync", "0")) || 0;
  const hasSources = db.get("username") || db.get("imdb_user") || db.get("canon_urls") || db.get("imdb_lists");
  if (db.get("auto_sync") === "1" && hasSources && Date.now() / 1000 - last > AUTO_SYNC_HOURS * 3600) { db.set("sync_open", "0"); doSync(); db.set("sync_open", "1"); }
  window.__app = { whatsNew, setLook, icsText, forYou, logError, widgetFiles, fillImages, lib, libAdopt, db, ui, render, setTab, go, Native, invalidate, games, books, migrate, doSync, bundle, applyBackup, readBackup2, yearCounts, sealBackup, openBackup, restoreFrom, undoRestore, bundleOut };
})();
