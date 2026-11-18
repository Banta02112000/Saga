/* CanonSync UI. Talks to the Android shell through window.Android (see Bridge.java). */
(function () {
  "use strict";
  const C = window.Core;
  const VERSION = "0.6.9.2";
  const AUTO_SYNC_HOURS = 12;
  const DEFAULT_PROFILE = "PKCE / Public Client (App 000001)";

  // ---- security: the page runs under a Content-Security-Policy (index.html), so no inline handlers anywhere.
  // Broken pictures are handled here: data-fb="rm" removes the picture, "ph" puts the initials placeholder in its place.
  const httpsUrl = u => String(u || "").replace(/^http:\/\//i, "https://");
  document.addEventListener("load", e => { const t = e.target; if (t && t.tagName === "IMG") t.classList.add("in"); }, true);
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
    let seq = 0, browsing = 0;
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
        // 0.5.7: the body comes as it is, in pieces when large (no escaping, no second parse of a multi-MB text)
        if (r && r.split === 1) { const len = r.len || 0; if (len > 4000000) { const ps = []; for (let i = 0; i < len; i += 4000000) ps.push(A.takeBodyPart(id, i, i + 4000000)); r.body = ps.join(""); } else r.body = A.takeBody(id); delete r.split; delete r.len; }
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
        browsing++;
        pending.set(id, r => { browsing = Math.max(0, browsing - 1); res(r); });
        A.browse(id, url, probe, timeoutMs || 35000);
        // 0.5.9: if the phone never answers, close the page ourselves and move on
        setTimeout(() => { if (pending.has(id)) { try { if (A.cancelBrowse) A.cancelBrowse(id); } catch (e) { /* older app */ } setTimeout(() => { const f = pending.get(id); if (f) { pending.delete(id); f({ status: 0, value: null, error: "timeout" }); } }, 3000); } }, (timeoutMs || 35000) + 30000);
      });
    }
    if (A && A.browse) http.browse = browse;
    http.cancelBrowse = () => { try { if (A && A.cancelBrowse) A.cancelBrowse(""); } catch (e) { /* older app */ } };

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
      // written by the phone in the background: the screen doesn't wait for the disk (falls back to save)
      saveLater: (n, t) => { try { return A && A.saveLater ? A.saveLater(n, t) : A ? A.save(n, t) : (mem[n] = t, true); } catch (e) { logError("save", `${n}: ${e.message}`); return false; } },
      later: !!(A && A.saveLater && A.ownStamp),
      browsing: () => browsing > 0,
      // 0.5.6: big files go to the phone in pieces, with a pause between pieces, and are written in the background.
      // `still` says whether this save is still the newest one; if not it's dropped.
      parts: !!(A && A.bufAdd && A.saveBuf && A.saveLater && A.ownStamp),
      saveParts: async (n, parts, still) => {
        const key = n + "#" + (++seq);
        try {
          for (let i = 0; i < parts.length; i++) { A.bufAdd(key, parts[i]); await new Promise(r => setTimeout(r, 0)); if (still && !still()) { A.bufDrop(key); return false; } }
          return !!A.saveBuf(n, key);
        } catch (e) { try { A.bufDrop(key); } catch (e2) { /* gone */ } logError("save", `${n}: ${e.message}`); return false; }
      },
      append: (n, t) => A.appendLater(n, t),
      canAppend: !!(A && A.appendLater && A.bufAdd && A.saveBuf),
      // the backup file the person chose: handed over in pieces, written in the background
      writeUriParts: (uri, parts) => new Promise(async res => {
        if (!(A && A.writeUriBuf && A.bufAdd)) { let ok = false; try { ok = A.writeUri(uri, parts.join("")); } catch (e) { ok = false; } return res(ok); }
        const id = "s" + (++seq), key = "uri#" + id;
        try { for (const p of parts) { A.bufAdd(key, p); await new Promise(r => setTimeout(r, 0)); } pending.set(id, res); A.writeUriBuf(id, uri, key); }
        catch (e) { try { A.bufDrop(key); } catch (e2) { /* gone */ } res(false); }
      }),
      ownStamp: n => (A && A.ownStamp ? String(A.ownStamp(n) || "") : ""),
      openUrl: u => (A ? A.openUrl(u) : window.open(u, "_blank")),
      copy: t => (A ? A.copy(t) : navigator.clipboard && navigator.clipboard.writeText(t)),
      sha256url: async s => {
        if (A) return A.sha256url(s);
        const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
        return btoa(String.fromCharCode(...d)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      },
      linkScheme: () => (A && A.linkScheme ? String(A.linkScheme() || "") : ""),
      takeOauth: () => (A && A.takeOauth ? String(A.takeOauth() || "") : ""),
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
                           saveLater: Native.later ? t => Native.saveLater("canonsync.json", t) : null, ownStamp: () => Native.ownStamp("canonsync.json"),
                           saveParts: Native.parts ? (parts, still) => Native.saveParts("canonsync.json", parts, still) : null,
                           cache: Object.assign({ load: () => Native.load("cache.json"), save: t => Native.saveLater("cache.json", t) },
                             Native.canAppend ? { loadLog: () => Native.load("cache.log"), append: t => Native.append("cache.log", t), clearLog: () => Native.saveLater("cache.log", ""), saveParts: parts => Native.saveParts("cache.json", parts) } : {}),
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
  // 0.5.9: during a job the screen shows the last canon state and the new one is worked out in slices,
  // instead of redoing the whole canon check in one go each time the screen is drawn
  let lastMemo = null;
  const bootStatus = { done: false, p: null };
  let inRender = false; // only drawing the screen may use the empty first answer; anything that saves waits for the real one
  const status = () => {
    if (memo) return memo;
    if (ui.job && lastMemo) { if (typeof statusSoon === "function") setTimeout(() => statusSoon().catch(() => {}), 0); return lastMemo; }
    // 0.6.2: drawing the screen uses the last answer and works out the new one in slices, then draws again
    // (not right after a tap: what you just changed must show as changed)
    if (inRender && lastMemo && typeof statusSoon === "function" && Date.now() - lastTap > 1500) { refreshSoon(); return lastMemo; }
    // 0.6.1: opening the app: the first screen comes at once, the canon parts a moment later (worked out in slices)
    if (inRender && !lastMemo && !bootStatus.done && typeof statusSoon === "function") {
      if (!bootStatus.p) bootStatus.p = new Promise(r => setTimeout(r, 60)).then(() => statusSoon()).then(() => { bootStatus.done = true; if (!$("#overlay").innerHTML) render(); }, () => { bootStatus.done = true; });
      return [];
    }
    if (typeof mirrorNow === "function") mirrorNow();
    return (memo = lastMemo = C.canonStatus(db, threshold()));
  };
  let memoGen = 0, memoAsync = null, refreshP = null, lastTap = 0;
  function refreshSoon() {
    if (refreshP) return;
    refreshP = new Promise(r => setTimeout(r, 0)).then(() => statusSoon()).then(() => { refreshP = null; if (memo && !$("#overlay").innerHTML) render(); }, () => { refreshP = null; });
  }
  const invalidate = () => { memo = null; memoGen++; };
  // 0.5.7: the same, worked out in slices so the screen stays free (after a sync, for the widget and pictures)
  async function statusSoon() {
    if (memo) return memo;
    if (memoAsync && memoAsync.gen === memoGen) return memoAsync.p;
    const gen = memoGen;
    const p = (async () => { if (typeof mirrorNow === "function") mirrorNow(); await C.breathe(0); const st = await C.canonStatusAsync(db, threshold()); if (gen === memoGen && !memo) memo = lastMemo = st; return st; })();
    memoAsync = { gen, p };
    try { return await p; } finally { if (memoAsync && memoAsync.p === p) memoAsync = null; }
  }
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
    share: '<circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="m8.2 10.8 7.6-4.3M8.2 13.2l7.6 4.3"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
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
    toastTimer = setTimeout(() => { t.classList.remove("show"); undoFn = null; }, undoFn ? 10000 : 3200); // 0.6.1: 10 s to undo
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
    ["0.6.9.2", ["Your Saga website: the address works typed without https://, and a failed sync says why (an address ending in :8443 works only with Tailscale on; a name the phone can't find means Funnel is off; a refused sync key).", "Your own AI server: an address typed without http:// (like 100.116.92.58:3000) works.", "The error log no longer fills up with tiny screen hitches: only real pauses are written."]],
    ["0.6.9.1", ["Only a rating means watched or finished. An IMDb list or watchlist file brought in through Import used to mark every title on it as watched (and its games as finished): now an unrated title goes to To watch (a game to the Wishlist), and titles and games marked only because of an earlier import are put back once, with a copy kept first. Anything you rated, ticked, dated or wrote a note on stays as it is.", "Any other CSV: a title counts as watched only with a rating, a watched status or a watched date.", "A film rated on IMDb is dated the day you rated it, not the day it came out."]],
    ["0.6.9", ["History (Settings › Backup): before every import, Start over, list removal, merge, going back and the first sync of the day, a copy of what you made yourself is kept (the last 12); go back to any of them.",
      "Find duplicates (Settings › Tidy up): the same film, series or game entered twice, side by side; merge keeps the further status, your rating, every date, ticked episodes, notes and ids. The same game on two consoles isn't a duplicate.",
      "Steam (with your Web API key): hours played and last played on each game, achievements, and a game you've played in the last two weeks moves to Playing by itself.",
      "Games › Stats: your backlog in hours (How Long To Beat), how long it would take at your pace, and short owned games to finish next, series you've started first.",
      "A calendar address on your Saga website for Google Calendar: episodes, releases, games and books you're waiting for, updated after each sync (no episode names you've hidden).",
      "Friends: Send to … on a film or series; From friends on Home; what each friend watched, played and read lately.",
      "Website status for the owner (Settings › Accounts and sync): people and when they last came by, space left on the Pi, the last daily copy, nightly updates.",
      "A notification when your Saga website hasn't answered for 3 hours, and when it's back."]],
    ["0.6.8", ["Fixed: film, series and game pages could slide sideways (the picture at the top was 2 px too wide); nothing on a screen or a page can scroll sideways any more.",
      "Tapping the title or year under a cover opens it, not only the picture.",
      "Suggestions (For you), what a friend loved and a person's other work open a page with the details, Add to my watchlist and Mark as watched; DLC rows open their Steam page; related anime their MyAnimeList page.",
      "Website: Home says when the Pi runs an older Saga and how to update it; it can update itself every night (auto-update.sh on)."]],
    ["0.6.7", ["Doctor Who: a story told after another timeline waits for it. Falling and The Forbidden Time sit in season 4, but they're told after Ben & Polly's travels end, so they aren't Next up until the Ben & Polly timeline before them is done (the list says “after Ben & Polly: N to go”, the story shows what's left). You can still mark them done whenever you like. When everything left in a timeline is waiting like that, its Next up offers what the other timeline can play next.",
      "A story listed twice in one timeline (During and After) is Next up at its later place."]],
    ["0.6.6", ["IsThereAnyDeal, much more of it (with your free API key): the best price now in any store for every game you'd still buy or play, with its all-time low (and a notification when a game you want hits it); which subscriptions include it (Game Pass, PS Plus, Switch Online…, and when it leaves); current bundles and every bundle it was ever in.",
      "Games: filters At its lowest and In a subscription, On sale now covers every store, a Best deal sort, and a Low badge on the cover.",
      "Sign in to IsThereAnyDeal (Settings › Accounts): your ITAD waitlist and your Saga wishlist stay in step both ways, and what you finish or own goes to your ITAD collection.",
      "Games › Up next follows each franchise: after the game you finished or are playing, the next one out in that franchise (“After …”), the franchises you played most recently first."]],
    ["0.6.5", ["Why is this here? at the bottom of every film and series: the lists and ratings it came from. Switch a list off and remove the titles only it brought (anything you rated, ticked or noted stays; Undo).",
      "A source that keeps failing gets a warning on Home and in Sync (how many days, what went wrong, what to do), and a notification on the third failure in a row.",
      "Updates: Home says when a newer Saga is out; Get it opens your Saga website's download page. Settings › About › Check for updates.",
      "For you on Home: suggestions from the films and series you rated 8 or more, by type and genre, with Add and Not interested.",
      "Friends on your Saga website: switch sharing on (Settings › Accounts and sync) to see You and … on Home (taste match, both want to watch, what they loved) and their rating on a title.",
      "Notifications on release day for games on your wishlist, backlog or Next list, and books you want.",
      "Website: download a backup of your files; the Games export has the spreadsheet's columns, so it imports again.",
      "Get started steps on a fresh install. The app follows Android's font size."]],
    ["0.6.4", ["Import your own games list: Settings › Import › Choose export files takes an Excel (.xlsx) or CSV spreadsheet with columns like Title, OG Release Date, OG Platform, Remake…, Owned Platform, HLTB, Rating, Franchise, Multiverse, Next. A preview first; importing again updates the list's columns and keeps your status, ratings, plays and notes; the same game on two consoles stays two entries; Undo puts things back."]],
    ["0.6.3", ["Posters and covers fade in as they load instead of popping in."]],
    ["0.6.2", ["Smoother during and after a sync: the screen is drawn from the last canon check while the new one is worked out in slices; repeated lookups of the synced titles are answered from memory; the progress bar updates at most 4 times a second; background lookups of posters, new seasons and streaming pause regularly.",
      "Directors, creators and actors are tappable: a sheet with their work, what of it is in your library, how much you've watched and your average rating, and Add for the rest. Films and series have Cast & crew at the bottom.",
      "Change poster: pick any of TMDB's posters for a film or series.",
      "Games: the Studio row opens the studio's games you have (finished, your average, hours) and a Steam search.",
      "Search: grouped by tab, with one-tap Watched and next episode. On a computer: Ctrl+K (Cmd+K) or / opens it, Escape closes any sheet.",
      "Website: Jellyfin and Plex can tick what you watch (see site/README); installable as an app, and it opens without the server (on https).",
      ]],
    ["0.6.1", ["Back while searching clears the search first, then goes to the previous screen (not straight to Home).",
      "Home › Continue: tick a series' next episode as watched from its tile, without opening it.",
      "Settings › Backup › Start over: clear IMDb, Trakt, your library, games, books, Doctor Who or lists one by one, for a clean base. A copy is kept and Undo puts everything back.",
      "Doctor Who: hold the ⋮⋮ grip and drag to reorder; hold an entry to delete it. Undo for 10 seconds (all undo buttons now last 10 s).",
      "Games: the Franchise row opens the whole series (films, series, games, books); same-series and same-studio games, and DLC from Steam with Add, at the bottom of a game.",
      "Games search finds console games too (IMDb), not only Steam.",
      "Anime: Related (films, sequels, side stories) at the bottom of a series, with Add.",
      "Faster first screen: the sync summary is worked out just after the first paint.",
      "Website: several people can sign in, each with their own data; centred layout on wide PC screens; Sign out in Settings."]],
    ["0.6.0", ["Saga website ↔ phone: Settings › Accounts and sync › Saga website (address and sync key). The phone sends what changed after each sync, when you open it and a little after you change something; the server merges entry by entry (where both changed the same thing, the phone's wins) and open website pages reload by themselves.",
      "The website can be reached without Tailscale: a password page and a sync key for the phone, a separate public entrance for a Cloudflare Tunnel or a reverse proxy (see site/README).",
      "Stats everywhere: a strip of numbers on top of Library, Anime, Games, Books and Manga; Watch › Stats adds your library (hours, rewatches, episodes), ratings by kind with a 1–10 chart, and canon progress (closest to complete, biggest gaps); Games gets a Stats view (status, backlog cleared, playtime, ratings by platform and franchise, decades, wishlist); Books splits books, manga and light novels.",
      "Doctor Who: each section shows its progress, the average rating overall and per type (tap a type to show only it), best and lowest, the rating spread and Next up; an Overview with every canon story, sections in progress, each group and the top rated.",
      "Layout: on the Fold's inner screen and tablets the navigation sits on the left (between 720 and 840 px it used to break into one floating button); on wide screens the rail shows names; status chips stay on one scrolling line; the section switcher stays at the top while you scroll."]],
    ["0.5.9", ["IMDb sync without the hidden browser: lists, your ratings and your watchlist are read from IMDb's data service the way the old GameCheck app did (the cached address first, 250 titles a request), then a list's CSV export; the hidden browser only if both fail. Your sync report showed lists taking 13–23 minutes in the hidden browser: that route is now the last resort.",
      "The hidden browser itself: a page that doesn't bring its data gives up after about 20 s; other requests on the page (your lists sidebar, exports, recently viewed) no longer take over the list's page count; one page at a time, and a page the app stopped waiting for is closed at once.",
      "The screen stays on while a sync runs in the app, and the stall report no longer counts the phone sleeping (screen off) as a frozen screen.",
      "Trakt: ratings pages come 4 at a time, and without a sign-in a sync stops at the ratings it already has (Trakt sends the newest first).",
      "Rated means seen: a rated film on a list or watchlist counts as watched, rated imports from MyAnimeList, AniList and others too; rated episodes are ticked (on the day they were rated, when known) and their series added or moved to Watching. Episodes from the IMDb ratings CSV wait by name until the series' episode list is loaded.",
      "Games: games rated on IMDb that were on your backlog or wishlist move to Finished; the report says how many IMDb games are already in Games.",
      "Steam: a custom name like banta_02_11_2000 is also tried as banta02112000, then through your community page.",
      "Big syncs add rows in small batches, and the screen shows the last canon state during a sync instead of redoing the canon check each time it's drawn."]],
    ["0.5.8", ["Sync: Trakt is asked what changed since the last sync, and only those parts are downloaded again (ratings, watchlist, lists, watched films or series). The 10-minute background check no longer downloads your whole account because of your own ticks, and it now works in small steps.",
      "Universe dashboard for any franchise: films, series, games and books with progress per medium, release / in-universe / your own order, and a tier per entry (essential, recommended, optional, alternate continuity, not canon) with Essential only and Missing only.",
      "Smart lists by rules (what, status, rating, length, owned, on your streaming services, franchise, progress), with five ready-made ones: Short & owned backlog, Streaming now on my services, Next canon entries, Paused & almost done, All-time favourites.",
      "Games: play sessions (+30 min, +1 h, +2 h or any time). Books: chapters read are kept. Both show in the Diary, by day.",
      "Year in review: your year in one card (hours watching, playing and reading, month by month, favourites, most explored franchises, milestones), to share as text.",
      "Widgets: +1 chapter or +10 pages on the book you're reading; Mark watched on the main widget too; a widget not refreshed for 6 hours or more says how long ago.",
      "Picks for today: Not for me (seen it, too long, not now, not for me) hides a pick for 90 days, or a week for Not now.",
      "Library: Select to change many titles at once (status, list, tag, remove).",
      "Search finds titles with a typo or two swapped letters.",
      "Home shows a line when the last sync failed in part or is more than two days old."]],
    ["0.5.7.1", ["If a sync still hitches, the report now also watches the phone's own screen thread (where taps and scrolling are handled) and reports smaller hitches too, with what was going on at the time.",
      "Saga website: the same app in a browser, from your own machine on your Tailscale network (site/ folder; see its README)."]],
    ["0.5.7", ["Sync: nothing is saved while a sync runs (it's saved once at the end, or at once if you leave the app). Building the multi-MB save text again and again was a main cause of the lag.",
      "Answers from Trakt and IMDb reach the app as they are, instead of being wrapped and unpacked twice.",
      "Checking a file's state no longer waits for a big file to finish writing (that could hold the screen for seconds).",
      "After a sync: the widget, posters, release dates and the backup now run one after another instead of all at once, and the canon check behind them is worked out in small steps.",
      "IMDb: one odd list no longer sends every other list to the slow hidden-browser route; the hidden page also skips style sheets.",
      "Pictures that fail to load no longer rewrite a big settings entry each time."]],
    ["0.5.6", ["Sync no longer holds the screen while it saves. Before, each save turned your whole collection into one text of many MB and handed it to the phone in one go, every few seconds during a sync; the same for the library and, at the end, the backup file. Now saves are built a few entries at a time and handed over in small pieces, written in the background, and spaced far apart while a sync runs.",
      "The look-up cache (posters, dates, episode lists) is now a journal: new entries are added to the end of a small file instead of rewriting the whole cache.",
      "IMDb's page in the hidden browser shares the browser engine with the app's screen, so it slows the app while it's open: adverts, trackers, pictures, fonts and video on it are no longer loaded.",
      "Sync: the library step runs in small steps with pauses; series with rated IMDb episodes are looked up through an index instead of scanning the library for each one.",
      "If the screen still pauses, the Sync screen shows it in a card with a Copy button, and says when IMDb's page was open at the time."]],
    ["0.5.5", ["AI: your own server. Settings › AI › Other AI services › Ollama or Open WebUI: type the address (through Tailscale, the MagicDNS name ending in .ts.net), tap Find models, pick one. Nothing leaves your network and nothing is paid per use.",
      "Home: Picks for today, across films, series, games and books, each with its reason: series nearly finished, short films, games you own that are quick to finish, short books, things you paused, and genres you rate highly."]],
    ["0.5.4.9", ["Sync lag: Saga no longer rewrites its big files over and over while syncing. Saves are spaced out, the phone writes them in the background so the screen doesn't wait, and posters, episode lists and dates live in a separate cache file that's written every 30 seconds at most.",
      "Posters are fetched after a sync or import finishes, not during it.",
      "IMDb ratings and watchlist: after the first sync, Saga asks IMDb's API directly with the page's own request instead of opening the page each time.",
      "If the screen still hitches during a job, the report's SLOW line now also adds up the small hitches per step."]],
    ["0.5.4.8", ["Diary: everything you watched, played and read in one list, newest first, by month, with filters (Home › Recently › Diary). A day's episodes of one series show as one line.",
      "Your year and the diary now come from one shared activity history, so their numbers always agree.",
      "Imports: before anything is written, Saga shows what each file is, how many entries it has and how many are already in your library. Every import can be undone afterwards (Settings › Import)."]],
    ["0.5.4.7", ["Sync and the frozen screen: with 1,000 or more IMDb ratings already in Saga, a sync reads only your newest 500 instead of every page, and IMDb lists are asked for straight from IMDb's API without opening their page. Settings › IMDb › Read all my ratings again reads the whole list when you want it.",
      "New app icon: your chosen picture, used as it is."]],
    ["0.5.4.6", ["Sync: reading IMDb lists no longer redraws thousands of rows on the screen engine the app shares, and each page of results is processed as it arrives instead of all at the end. These were the long freezes during the IMDb part of a sync.",
      "If the screen still pauses during a job, the Sync report ends with a SLOW line saying how long and during which step (also in Settings › Error log).",
      "Library: films and series of your own lists, and a Paused status for anything you've put on hold."]],
    ["0.5.4.5", ["Syncing no longer freezes the screen with a big library: the slowest steps were rewritten and the screen gets a chance to redraw between steps.",
      "Your year no longer counts episodes you ticked in bulk (catching up, marking a whole series, imports without a date) as watched that day; it shows how many it left out.",
      "Picture quality from JustWatch can be switched off (Settings › Streaming). When JustWatch doesn't answer, Saga waits 12 hours before asking again instead of slowing every title down.",
      "Widgets: choose the background opacity (down to fully see-through), a light or dark look, and the text size in Settings › Widgets."]],
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
  // ---- 0.6.5: is there a newer Saga? The public code says which version is current; the app itself comes from your
  // website's download page (the website's owner puts it there). Checked at most once a day.
  const UPDATE_URL = "https://raw.githubusercontent.com/Banta02112000/Saga/main/web/app.js";
  const verNum = v => String(v || "").split(".").map(x => parseInt(x, 10) || 0).reduce((a, x, i) => a + x * Math.pow(1000, 3 - i), 0);
  async function checkUpdate(loud) {
    if (!loud && Date.now() - (+db.get("upd_at", "0") || 0) < 20 * 3600e3) return db.get("upd_ver", "");
    let v = "";
    try {
      const r = await Native.http("GET", UPDATE_URL + "?t=" + Math.floor(Date.now() / 3600e3), { headers: { Accept: "text/plain" } });
      const m = r && r.status === 200 && /const VERSION = "([\d.]+)"/.exec(r.body || "");
      if (!m) throw new Error(r && r.status ? `HTTP ${r.status}` : "no answer");
      v = verNum(m[1]) > verNum(VERSION) ? m[1] : "";
      db.set("upd_at", String(Date.now())); db.set("upd_ver", v);
    } catch (e) { if (loud) toast(`Couldn't check for updates: ${e.message}`); return ""; }
    if (loud) toast(v ? `Saga ${v} is out` : `Saga ${VERSION} is the newest`);
    if (v) render();
    return v;
  }
  function updateUrl() { const u = webBase(); return u ? u + "/download" : ""; }
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

  // 0.6.2: the bar and the text change at most every 250 ms (a sync sends hundreds of updates a second at times)
  let progLast = 0, progTimer = null, progNext = null;
  function setProgress(frac, text) {
    // a text still waiting to be shown is kept; no text means "leave the text as it is"
    const pendingText = progTimer && progNext ? progNext[1] : undefined;
    progNext = [frac, text === undefined ? pendingText : text];
    const wait = 250 - (Date.now() - progLast);
    if (wait > 0 && frac !== null) { if (!progTimer) progTimer = setTimeout(() => { progTimer = null; const [f, t] = progNext; setProgressNow(f, t); }, wait); return; }
    clearTimeout(progTimer); progTimer = null; setProgressNow(frac, progNext[1]);
  }
  function setProgressNow(frac, text) {
    progLast = Date.now();
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
    C.BUSY.on = true; // saves are spaced out while it runs
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
    // Stall watch: a 250 ms timer that fires late means the screen couldn't respond. Each pause over 0.7 s is kept
    // with the step it happened in, and listed in the report, so a freeze on the phone says where it came from.
    // Shorter hitches (over 0.15 s) are added up per step: many small ones are what makes the screen feel laggy.
    const stalls = [], jank = {}; let beat = Date.now();
    const stepOf = () => (Native.browsing() ? "IMDb page (hidden browser): " : "") + String(ui.status || name).replace(/\s*\(\d+ s\)$/, "").replace(/\d[\d,.]*/g, "#").slice(0, 60);
    try { if (window.Android && window.Android.watchScreen) window.Android.watchScreen(true); } catch (e) { /* older app */ }
    const watch = setInterval(() => { const now = Date.now(), gap = now - beat - 250; beat = now; if (document.hidden || gap > 20000) return; /* 0.5.9: the app asleep (screen off, in the background) is not a hitch */ if (gap > 150) { const k = stepOf(); jank[k] = (jank[k] || 0) + gap; } if (gap > 700) stalls.push([gap, (Native.browsing() ? "IMDb page (hidden browser): " : "") + (ui.status || name)]); }, 250);
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
      clearInterval(tick); clearInterval(watch);
      clearTimeout(progTimer); progTimer = null; // 0.6.2: a late progress update must not cover the job's last message
      // 0.5.7.1: the phone's own screen thread (taps and scrolling) is watched too, and smaller hitches are reported
      let native = { total: 0, list: [] };
      try { const A = window.Android; if (A && A.screenReport) { A.watchScreen(false); const t = String(A.screenReport() || "0").split("\n"); native = { total: +t[0] || 0, list: t.slice(1).map(l => l.split("\t")).map(([ms, w]) => [+ms, w || ""]) }; } } catch (e) { /* older app */ }
      const jankAll = Object.values(jank).reduce((a, b) => a + b, 0);
      // 0.6.9.2: a report only when the screen really stuck (one pause, or 3 s of hitches): smaller ones were noise in the log
      if (stalls.length || jankAll > 3000 || native.total > 3000) {
        const worst = stalls.slice().sort((a, b) => b[0] - a[0]).slice(0, 5);
        const steps = Object.entries(jank).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, ms]) => `${(ms / 1000).toFixed(1)} s in "${k}"`).join("; ");
        const line = `SLOW screen paused ${stalls.length} time${stalls.length === 1 ? "" : "s"} over 0.7 s` + (worst.length ? ` (longest: ${worst.map(([ms, st]) => `${(ms / 1000).toFixed(1)} s during "${String(st).replace(/\s*\(\d+ s\)$/, "").slice(0, 60)}"`).join("; ")})` : "") +
          `. Hitches added up: ${(jankAll / 1000).toFixed(1)} s${steps ? ` (most: ${steps})` : ""}` +
          (native.total ? `. Phone screen thread: ${(native.total / 1000).toFixed(1)} s in ${native.list.length} hitch${native.list.length === 1 ? "" : "es"}` +
            ` (longest: ${native.list.slice().sort((a, b) => b[0] - a[0]).slice(0, 3).map(([ms, w]) => `${(ms / 1000).toFixed(1)} s${w ? ` while ${w}` : ""}`).join("; ")})` : "");
        ui.stalls = line;
        if (name === "Sync" || name === "Retry") { ui.report = (ui.report || "") + "\n" + line; db.set("last_report", ui.report); }
        logError("stall", `${name}: ${line}`);
      } else ui.stalls = "";
      if (notes) Native.status(ok ? `${name} finished` : `${name} failed`, ui.status, -1, false);
      ui.job = null;
      C.BUSY.on = false;
      if (db._timer) db.touch(); // back to the normal pace: what the job changed is saved soon
      if (libTimer || libJobDirty) { clearTimeout(libTimer); libTimer = null; libJobDirty = false; libTouch(); }
      if (db._dirty) db.touch();
      if (mirrorDirty && !mirrorTimer) mirrorTimer = setTimeout(mirrorNow, 1500);
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

  // 0.6.8: the page of a film or series you don't have (a suggestion, a friend's, a person's work, a related anime):
  // its details, and Add to watchlist / Mark as watched. One you have opens its own page instead.
  function openTitle(x) {
    const have = lib.find({ type: x.type, tmdb: x.tmdb, imdb: x.imdb, title: x.title, year: x.year });
    if (have) { openLib(have.id); return; }
    const c = { title: x.title, year: x.year || null, medium: x.type === "show" ? "TV Series" : "Movie", tmdb: x.tmdb || null, imdb: x.imdb || null, poster: x.poster || "", franchise: "",
      why: x.why || "", src: x };
    openSheet(sid(c, "find"));
  }
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
    if (c.sheetKind === "find") {
      if (people().length) acts.push(sendButtons(Object.assign({ type: c.medium === "TV Series" ? "show" : "movie" }, c.src || {}, { title: c.title, year: c.year })));
      acts.unshift(`<button class="btn primary block" data-action="findadd" data-id="${esc(id)}" data-st="watchlist">${icon("plus")}Add to my watchlist</button>`,
        `<button class="sheetbtn" data-action="findadd" data-id="${esc(id)}" data-st="watched">${icon("check")}Mark as watched</button>`);
    }
    if (c.sheetKind === "up") {
      acts.push(`<button class="sheetbtn" data-action="uphide" data-key="${esc(c.hideKey)}" data-label="${esc(c.kind === "canon" ? c.title : (c.show || c.franchise))}">${icon("eyeoff")}${c.kind === "canon" ? "Hide from Upcoming" : c.kind === "next" ? `Stop suggesting ${esc(c.show)}` : `Hide ${esc(c.show || c.franchise)} from Upcoming`}</button>`);
    }
    const detail = c.sheetKind === "find" ? esc([c.year, c.medium === "TV Series" ? "Series" : "Film", c.why].filter(Boolean).join(" · ")) : c.kind === "next" ? `Next to watch: S${c.s} E${c.e} · ${c.left} aired episode${c.left === 1 ? "" : "s"} you haven't seen` : c.kind === "episode" ? `S${c.s} E${c.e}${c.name && !/^episode \d+$/i.test(c.name) ? `, ${esc(c.name)}` : ""} · ${esc(C.fmtWhen(c))}`
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
  // 0.6.2: directors, creators and actors open a sheet of their work
  const personLink = n => `<a href="#" class="plink" data-action="person" data-name="${esc(n)}">${esc(n)}</a>`;
  const peopleLine = inf => [inf.crew.length ? `${inf.tv ? "Created by" : "Directed by"} ${inf.crew.map(personLink).join(", ")}` : "",
    inf.cast.length ? `With ${inf.cast.slice(0, 5).map(personLink).join(", ")}` : ""].filter(Boolean).join(" · ");
  async function openPerson(name) {
    ui.person = { name, busy: true };
    drawPerson();
    try { ui.person = Object.assign({ name }, await C.personWorks(db, Native.http, name)); }
    catch (e) { ui.person = { name, err: e.message }; }
    if (ui.person.name === name || ui.person.err) drawPerson();
  }
  function drawPerson() {
    const P = ui.person; if (!P) return;
    let body;
    if (P.busy) body = `<p class="small muted">Asking TMDB…</p>`;
    else if (P.err) body = `<p class="small muted">${esc(P.err)}</p>`;
    else if (!P.works.length) body = `<p class="small muted">TMDB doesn't know ${esc(P.name)}.</p>`;
    else {
      const rows = P.works.map((w, i) => ({ w, i, have: lib.find({ tmdb: w.tmdb, type: w.type, title: w.title, year: w.year }) }));
      const mine = rows.filter(x => x.have), rated = mine.filter(x => x.have.rating), seen = mine.filter(x => x.have.status === "watched");
      const avg = rated.length ? Math.round(rated.reduce((a, x) => a + x.have.rating, 0) / rated.length * 10) / 10 : null;
      const line = x => `<div class="item" ${x.have ? `data-action="libopen" data-id="${esc(x.have.id)}"` : `data-action="personopen" data-i="${x.i}"`} role="button"><div class="grow" style="min-width:0"><b class="ell">${esc(x.w.title)}</b>
        <div class="small muted ell">${esc([x.w.year, x.w.type === "show" ? "Series" : "Film", x.w.roles.slice(0, 2).join(", ")].filter(Boolean).join(" · "))}</div></div>
        ${x.have ? `<span class="small muted">${esc(LST[x.have.status])}${x.have.rating ? ` · ★ ${x.have.rating}` : ""}</span>` : `<button class="btn quiet small" data-action="personadd" data-i="${x.i}">${icon("plus")}Add</button>`}</div>`;
      body = `<div class="sstrip"><div><b>${mine.length}</b><span>in your library</span></div><div><b>${seen.length}</b><span>watched</span></div><div><b>${avg === null ? "–" : avg}</b><span>your average</span></div><div><b>${P.works.length}</b><span>on TMDB</span></div></div>
        ${mine.length ? `<h4>In your library</h4><div class="listcard">${mine.map(line).join("")}</div>` : ""}
        <h4>Best known</h4><div class="listcard">${rows.filter(x => !x.have).slice(0, 40).map(line).join("")}</div>`;
    }
    $("#overlay").innerHTML = `<div class="scrim bottom" data-action="dismiss"><div class="sheet" role="dialog" aria-modal="true">
      <h3 style="margin:0">${esc(P.name)}</h3>${P.dept ? `<p class="small muted" style="margin:2px 0 8px">${esc(P.dept)}</p>` : ""}${body}</div></div>`;
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
      ${inf.crew.length || inf.cast.length ? `<p class="small muted" style="margin:4px 0 0">${peopleLine(inf)}</p>` : ""}
      <h4>Where to watch in ${esc(inf.region)}</h4>${offers}
      ${inf.offers.length && inf.offers.every(o => !o.res) ? `<p class="small muted">Picture quality unavailable${inf.jwError ? ` (JustWatch ${inf.jwError === "switched off" ? "switched off in Settings" : "didn't respond"})` : ""}.</p>` : ""}
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
    // 0.5.9: your library (episode ticks, dated viewings, rewatches), ratings per medium, and canon progress per franchise
    { const items = lib.all(), w = watchStats(items), wa = watchStats(items.filter(x => x.anime));
      const hist = Array(10).fill(0); for (const it of items) if (it.rating > 0) hist[Math.min(10, Math.max(1, Math.round(it.rating))) - 1]++;
      const mh = Math.max(1, ...hist);
      const films = items.filter(x => x.type === "movie" && x.status === "watched").length, series = items.filter(x => x.type === "show");
      const wl = items.filter(x => x.status === "watchlist").length;
      const fr = new Map(); for (const c of status()) { if (!c.franchise || c.franchise === "Unsorted") continue; const o = fr.get(c.franchise) || { n: 0, d: 0 }; o.n++; if (c.have && c.state !== "listed") o.d++; fr.set(c.franchise, o); }
      const frs = [...fr.entries()].map(([k, o]) => ({ k, ...o, p: o.n ? o.d / o.n : 0 }));
      const started = frs.filter(f => f.d > 0), complete = frs.filter(f => f.n && f.d === f.n), near = started.filter(f => f.d < f.n).sort((a, b) => b.p - a.p).slice(0, 6), gaps = started.filter(f => f.d < f.n).sort((a, b) => (b.n - b.d) - (a.n - a.d)).slice(0, 6);
      const canonAll = frs.reduce((a, f) => a + f.n, 0), canonDone = frs.reduce((a, f) => a + f.d, 0);
      out.push(`<section><h2>Your library</h2>${watchStrip(items)}
        <p class="small">${fmt(films)} films watched (+${fmt(w.rewatches)} rewatches) · ${fmt(series.filter(x => x.status === "watched").length)} series finished, ${fmt(series.filter(x => x.status === "watching").length)} watching · ${fmt(w.eps)} episodes ticked · ${fmt(w.hours)} h (${Math.round(w.hours / 24)} days)${wa.n ? `, of which anime ${fmt(wa.hours)} h` : ""} · watchlist: ${fmt(wl)} to go</p>
        <div class="kicker" style="margin-top:10px">Your ratings, 1–10</div><div class="hist">${hist.map(n => `<i style="height:${Math.round((100 * n) / mh)}%" title="${n}"></i>`).join("")}</div><div class="histl">${hist.map((_, i) => `<span>${i + 1}</span>`).join("")}</div>
        <p class="small muted">Average: films ★ ${w.avgMovie ?? "–"} (${fmt(w.nMovie)}) · series ★ ${w.avgShow ?? "–"} (${fmt(w.nShow)}) · episodes ★ ${w.avgEp ?? "–"} (${fmt(w.nEp)})${wa.avgAll != null ? ` · anime ★ ${wa.avgAll}` : ""}</p></section>`);
      if (frs.length) out.push(`<section><h2>Canon</h2><p class="small">${canonAll ? Math.round((100 * canonDone) / canonAll) : 0}% of all canon entries · ${started.length} franchises started, ${complete.length} complete</p>
        ${near.length ? `<div class="kicker">Closest to complete</div><div class="listcard">${near.map(f => `<div class="item" data-action="mvopen" data-mv="${esc(f.k)}"><span class="grow ell">${esc(f.k)}</span><span class="small muted">${f.d}/${f.n}</span></div>`).join("")}</div>` : ""}
        ${gaps.length ? `<div class="kicker" style="margin-top:10px">Biggest gaps</div><div class="listcard">${gaps.map(f => `<div class="item" data-action="mvopen" data-mv="${esc(f.k)}"><span class="grow ell">${esc(f.k)}</span><span class="small muted">${f.n - f.d} missing</span></div>`).join("")}</div>` : ""}</section>`); }
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
    const hideNames = db.get("spoiler_hide", "1") === "1"; // 0.6.9: no episode names you'd rather not see
    for (const it of lib.all()) if (it.type === "show" && it.status !== "dropped" && it.status !== "watchlist" && it.epl) for (const e of it.epl) if (e[2]) add(e[2], `${it.title} S${e[0]} E${e[1]}`, hideNames ? "" : e[3] || "");
    const libShows = new Set(lib.all().map(it => it.imdb).filter(Boolean));
    for (const e of C.upcomingEpisodes(db, today)) if (!libShows.has(e.imdb)) add(e.date, `${e.show} S${e.s} E${e.e}`, hideNames ? "" : e.name || "");
    for (const c of C.releaseList(status(), today).upcoming) add(c.date, c.title, c.franchise);
    if (secOn("games")) for (const g of games.upcoming(today)) add(g.date, `${g.title} (game)`, g.franchise || "");
    if (secOn("books")) for (const b of books.books) if (b.status === "want" && b.published) add(String(b.published).slice(0, 10), `${b.title} (book)`, (b.authors || []).join(", "));
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
  // ---- Picks for today, across films, series, games and books, each with its reason (no AI, nothing sent anywhere).
  // Taken in turn from each kind of reason, and shuffled by the date so the row changes from day to day.
  function picksToday(limit = 14) {
    const seed = +new Date().toISOString().slice(0, 10).replace(/-/g, ""), rnd = k => { let h = seed; for (const ch of String(k)) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return h; };
    const mix = a => a.sort((x, y) => rnd(x.k) - rnd(y.k));
    const lists = [];
    lists.push(mix(lib.all().filter(x => x.type === "show" && x.status === "watching" && x.epl).map(x => ({ x, n: lib.nextEp(x) })).filter(o => o.n && !o.n.upcoming && o.n.left <= 3)
      .map(o => ({ k: "lib:" + o.x.id, t: o.x.title, img: o.x.poster, kind: "show", attrs: `data-action="libopen" data-id="${esc(o.x.id)}"`, why: `${o.n.left} episode${o.n.left === 1 ? "" : "s"} left` }))));
    lists.push(forYou(8).map(o => ({ k: "lib:" + o.it.id, t: o.it.title, img: o.it.poster, kind: o.it.type, attrs: `data-action="libopen" data-id="${esc(o.it.id)}"`, why: `You rate ${o.why} highly${o.it.runtime ? ` · ${o.it.runtime} min` : ""}` })));
    lists.push(mix(lib.all().filter(x => x.type === "movie" && x.status === "watchlist" && x.runtime && x.runtime < 100 && !isFinished(x))
      .map(x => ({ k: "lib:" + x.id, t: x.title, img: x.poster, kind: "movie", attrs: `data-action="libopen" data-id="${esc(x.id)}"`, why: `Short: ${x.runtime} min` }))));
    if (secOn("games")) lists.push(mix(games.visible().filter(g => g.owned && g.status === "backlog" && g.hours && g.hours <= 12)
      .map(g => ({ k: "game:" + g.id, t: g.title, img: g.cover || (g.steam ? GC.COVER(g.steam) : ""), kind: "game", attrs: `data-action="gopen" data-id="${esc(g.id)}"`, why: `You own it · ${g.hours} h to finish` }))));
    if (secOn("books")) lists.push(mix(books.books.filter(b => b.status === "want" && b.pages && b.pages <= 300)
      .map(b => ({ k: "book:" + b.id, t: b.title, img: (b.cover || "").replace(/^http:/, "https:"), kind: "book", attrs: `data-action="bopen" data-id="${esc(b.id)}"`, why: `Short read · ${b.pages} pages` }))));
    lists.push(mix([...lib.all().filter(x => x.status === "paused").map(x => ({ k: "lib:" + x.id, t: x.title, img: x.poster, kind: x.type, attrs: `data-action="libopen" data-id="${esc(x.id)}"`, why: "Paused: pick it back up?" })),
      ...(secOn("games") ? games.visible().filter(g => g.status === "paused").map(g => ({ k: "game:" + g.id, t: g.title, img: g.cover || (g.steam ? GC.COVER(g.steam) : ""), kind: "game", attrs: `data-action="gopen" data-id="${esc(g.id)}"`, why: "Paused: pick it back up?" })) : []),
      ...(secOn("books") ? books.books.filter(b => b.status === "paused").map(b => ({ k: "book:" + b.id, t: b.title, img: (b.cover || "").replace(/^http:/, "https:"), kind: "book", attrs: `data-action="bopen" data-id="${esc(b.id)}"`, why: "Paused: pick it back up?" })) : [])]));
    // 0.5.8: "not for me" hides a pick for 90 days ("not in the mood": 7 days)
    let hide = {}; try { hide = JSON.parse(db.get("pick_hide", "{}")) || {}; } catch (e) { hide = {}; }
    const now = Date.now();
    for (const l of lists) for (let i = l.length - 1; i >= 0; i--) if (hide[l[i].k] && hide[l[i].k] > now) l.splice(i, 1);
    const out = [], seen = new Set();
    for (let i = 0; out.length < limit && lists.some(l => l.length > i); i++) for (const l of lists) { const x = l[i]; if (x && !seen.has(x.k) && out.length < limit) { seen.add(x.k); out.push(x); } }
    return out;
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
        <button class="btn quiet" data-action="imdbfull">Read all my ratings again</button>
        <p class="small muted">Once you have 1,000 or more IMDb ratings in Saga, a sync reads only your newest 500 (it keeps the screen responsive). Use this now and then to catch ratings you removed on IMDb; it takes a few minutes.</p>
      </section>
      <section class="stack">
        <h2>Steam</h2>
        ${field("steam_profile", "Steam profile link or custom name", { placeholder: "https://steamcommunity.com/id/yourname", hint: "Your owned games and hours come in at every sync. In Steam › Edit profile › Privacy, My profile and Game details must be Public." })}
        ${field("itad_client_id", "IsThereAnyDeal app client ID (for your waitlist)", { hint: `From isthereanydeal.com › Apps (the same app as the API key). Its redirect URI must be ${itadRedirect()}` })}
        <div class="row wrap">${db.get("itad_token") ? `<span class="small muted">Signed in to IsThereAnyDeal: your waitlist ↔ Saga wishlist, and what you own → your ITAD collection, after each sync.</span>
          <button class="btn small" data-action="itadnow">Sync waitlist and prices now</button><button class="btn small quiet" data-action="itadout">Sign out</button>`
          : `<button class="btn small" data-action="itadin" ${db.get("itad_client_id") ? "" : "disabled"}>Sign in to IsThereAnyDeal</button><button class="btn small quiet" data-action="itadpaste">Paste the address by hand</button>`}</div>
        ${field("itad_key", "IsThereAnyDeal API key (optional, for store prices)", { secret: true, hint: "Free at isthereanydeal.com › Settings › API keys. Game pages then compare euro prices across Steam, GOG, Epic, Humble, Fanatical, GamesPlanet and more. Without it, CheapShark's US prices are used." })}
        ${field("steam_key", "Steam Web API key (optional, recommended)", { secret: true, hint: "Free at steamcommunity.com/dev/apikey (any domain name will do). With it, your library comes from Steam’s official API, which is far more reliable than reading the profile page." })}
        ${db.get("steam_sync_at") ? `<p class="small muted" style="margin:0">Last read ${esc(new Date(+db.get("steam_sync_at")).toLocaleString(lang() === "it" ? "it-IT" : "en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }))}</p>` : ""}
      </section>
      ${listsHtml()}
      <section class="stack">
        <h2>Saga website</h2>
        ${window.__sagaWeb ? `<p class="small" style="margin:0">You're on the website${window.__sagaWeb.user ? ` as <b>${esc(window.__sagaWeb.user)}</b>` : ""}. <a href="api/auth/logout">Sign out</a></p>` : ""}
        <p class="small muted" style="margin:0">Your Saga website (site/ folder, on your Pi): the phone and the website keep the same library, games, books, Doctor Who and sync data. Changes on both sides are merged, entry by entry.</p>
        ${field("web_sync_url", "Website address", { placeholder: "https://raspberrypi.your-tailnet.ts.net:8443", hint: "Through Tailscale (.ts.net) or your public address. Plain http:// works only for .ts.net addresses." })}
        ${field("web_sync_key", "Sync key", { secret: true, hint: "Printed by  node server.js --set-password  on the server (needed for a public address; through Tailscale it works without one)." })}
        <label class="switch"><input type="checkbox" data-setting="web_sync_auto" ${db.get("web_sync_auto", "1") === "1" ? "checked" : ""}><span>Sync with the website by itself<small class="muted" style="display:block">After each sync, when you open the app, and a little after you change something.</small></span></label>
        <button class="btn" data-action="websync" ${db.get("web_sync_url") ? "" : "disabled"}>${icon("sync")}Sync with the website now</button>
        ${window.__sagaWeb || db.get("web_sync_url") ? `<button class="btn small" data-action="webadmin">${icon("box")}Website status (owner)</button>` : ""}
        ${window.__sagaWeb || db.get("web_sync_url") ? `<label class="switch"><input type="checkbox" data-action="webshare" ${db.get("web_share") === "1" ? "checked" : ""}><span>Share my films, series, games and books with the other people on this website<small class="muted" style="display:block">They see titles, status and ratings (not notes, diary or keys), and you see theirs if they share too: “You and …” on Home, and their rating on a title.</small></span></label>
        <button class="btn small" data-action="peoplenow">Refresh friends</button>` : ""}
        ${calUrl() ? `<div class="card" style="padding:10px"><b>Your calendar</b><p class="small muted" style="margin:4px 0">Episodes, releases, games and books you're waiting for. In Google Calendar: Other calendars › + › From URL, and paste this address (keep it private: anyone with it can read the dates). It updates after each sync.</p>
          <div class="row wrap"><code class="small" style="word-break:break-all">${esc(calUrl())}</code></div><div class="row wrap"><button class="btn small" data-action="copyval" data-text="${esc(calUrl())}">Copy</button><button class="btn small quiet" data-action="calnew">New address</button></div></div>`
          : (window.__sagaWeb || db.get("web_sync_url")) ? `<button class="btn small" data-action="calnow">${icon("upcoming")}Make a calendar link for Google Calendar</button>` : ""}
        ${window.__sagaWeb ? `<a class="btn" href="api/backup" download>${icon("box")}Download a backup of your files (.zip)</a>`
          : db.get("web_sync_url") ? `<button class="btn" data-action="open" data-url="${esc(webBase() + "/api/backup")}">${icon("box")}Download the website's copy (.zip)</button>` : ""}
        <p class="small muted" style="margin:0">Phone and website hold the same files, so either one can rebuild the other. For a copy of every account on the Pi (onto a USB stick, say): <code>node server.js --backup /media/usb/saga.zip</code>.</p>
        ${WS.get().at ? `<p class="small muted" style="margin:0">Last: ${esc(new Date(WS.get().at).toLocaleString(lang() === "it" ? "it-IT" : "en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }))} · ${esc(WS.get().msg || "")}</p>` : ""}
      </section>
      <section class="stack">
        <h2>More services</h2>
        <p class="small muted" style="margin:0">Synced at every sync, from your public profile (no password). Anime goes to the library, manga and light novels to Books.</p>
        ${field("anilist_user", "AniList username", { placeholder: "yourname" })}
        ${field("anilist_client_id", "AniList app client ID (to send your changes back)", { hint: `anilist.co › Settings › Developer › Create new client, with the redirect URL ${anilistRedirect()}` })}
        <div class="row wrap">${db.get("anilist_token") ? `<span class="small muted">Signed in to AniList: what you change in Saga (status, episodes, rating) goes back after each sync.</span><button class="btn small quiet" data-action="alout">Sign out</button>`
          : `<button class="btn small" data-action="alin" ${db.get("anilist_client_id") && db.get("anilist_user") ? "" : "disabled"}>Sign in to AniList</button><button class="btn small quiet" data-action="alpaste">Paste the address by hand</button>`}</div>
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
        <label class="switch"><input type="checkbox" data-setting="jw_quality" ${db.get("jw_quality", "1") === "1" ? "checked" : ""}><span>Picture quality (4K, HD) from JustWatch. JustWatch has no public API, so this uses its app's own address and can stop working at any time.</span></label>
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
        <p class="small muted" style="margin:0">ChatGPT, Mistral, Groq, OpenRouter, DeepSeek, any OpenAI-compatible service, or your own Ollama or Open WebUI server can run the canon scan too. Gemini stays the free default.</p>
        <label class="field"><span>Service</span><select data-setting="ai_preset">${Object.entries(C.AI_PRESETS).map(([k, v]) => `<option value="${k}" ${db.get("ai_preset", "openai") === k ? "selected" : ""}>${esc(v.label)}</option>`).join("")}</select></label>
        ${(() => { const pr = C.AI_PRESETS[db.get("ai_preset", "openai")] || C.AI_PRESETS.openai;
          if (pr.local) return `
        <p class="small muted" style="margin:0">Your own model, on your own server: nothing leaves your network (or your tailnet) and nothing is paid per use. Saga talks to the server directly, the same way the Conduit app does for Open WebUI. Local models are slower and less sure of franchise details than the big online ones: a 7–8B model works, a bigger one is better.</p>
        ${field("ai_base", "Server address", { placeholder: pr.hintBase, hint: pr.api === "ollama" ? "Ollama's address and port (11434 unless you changed it). Through Tailscale use the MagicDNS name (….ts.net): plain http:// works only with those names. With \"tailscale serve\" you can use https:// instead." : "The address you open Open WebUI at. Through Tailscale use the MagicDNS name (….ts.net); https:// with \"tailscale serve\"." })}
        ${pr.noKey ? "" : field("ai_key", `${pr.label.replace(/ \(.*/, "")} API key`, { secret: true, hint: `From ${pr.keys}.` })}
        ${field("ai_model", "Model", { placeholder: "e.g. llama3.1:8b, qwen2.5:14b", hint: `${db.get("ai_model_used") ? `Last used: ${esc(db.get("ai_model_used"))}. ` : ""}Find models lists what the server has and checks the connection.` })}
        ${ui.aiModels && ui.aiModels.length ? `<div class="chips">${ui.aiModels.slice(0, 30).map(m => `<button class="chip" data-action="aimodelpick" data-v="${esc(m)}" aria-pressed="${db.get("ai_model") === m}">${esc(m)}</button>`).join("")}</div>` : ""}
        <div class="row wrap"><button class="btn quiet" data-action="aimodels">Find models</button>
        <button class="btn" data-action="aiscan" ${aiReady() ? "" : "disabled"}>${icon("spark")}Find missing canon with ${esc(pr.label.replace(/ \(.*/, ""))}</button></div>`;
          return `
        ${field("ai_key", `${pr.label} API key`, { secret: true, hint: `From ${pr.keys}.` })}
        ${field("ai_model", "Model", { placeholder: pr.model || "model name", hint: `Leave empty for ${pr.model || "the service's default"}.${db.get("ai_model_used") ? ` Last used: ${esc(db.get("ai_model_used"))}.` : ""}` })}
        ${db.get("ai_preset") === "custom" ? field("ai_base", "Address (ends in /v1)", { placeholder: "https://example.com/v1" }) : ""}
        <button class="btn" data-action="aiscan" ${aiReady() ? "" : "disabled"}>${icon("spark")}Find missing canon with ${esc(pr.label)}</button>`; })()}
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
        <button class="btn small" data-action="updcheck">Check for updates</button>
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
      <p class="small muted">Long-press your home screen › Widgets › Saga. Six to choose from: Up next, Next episodes (with a Mark watched button), Coming up, Games, Reading and Your year. They refresh whenever Saga changes something.</p>
      <label class="field"><span>Background opacity: <b id="walphaV">${esc(db.get("widget_alpha", "95"))}%</b></span><input type="range" min="0" max="100" step="5" value="${esc(db.get("widget_alpha", "95"))}" data-setting="widget_alpha" aria-label="Widget background opacity"></label>
      <label class="field"><span>Look</span><select data-setting="widget_look">${[["dark", "Dark background, light text"], ["light", "Light background, dark text"]].map(([v, l]) => `<option value="${v}" ${db.get("widget_look", "dark") === v ? "selected" : ""}>${l}</option>`).join("")}</select></label>
      <label class="field"><span>Text size</span><select data-setting="widget_size">${[["12", "Small"], ["14", "Normal"], ["16", "Large"], ["18", "Extra large"]].map(([v, l]) => `<option value="${v}" ${db.get("widget_size", "14") === v ? "selected" : ""}>${l}</option>`).join("")}</select></label>
      <p class="small muted">At low opacity, pick the look that reads best on your wallpaper: light text for dark wallpapers, dark text for light ones.</p></section>`;
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
    // 0.6.2: grouped by tab; films and series get a one-tap Watched / next episode
    const quick = it => { if (it.type === "show") { const n = lib.nextEp(it); return n && !n.upcoming ? `<button class="btn quiet small" data-action="libnext" data-id="${esc(it.id)}" data-s="${n.s}" data-e="${n.e}">${icon("check")}S${n.s} E${n.e}</button>` : ""; }
      return it.status === "watched" ? "" : `<button class="btn quiet small" data-action="sqwatch" data-id="${esc(it.id)}">${icon("check")}Watched</button>`; };
    const libRows = mine.map(it => `<div class="item" data-action="libopen" data-id="${esc(it.id)}">${libThumb(it)}<div class="grow" style="min-width:0"><b class="ell">${esc(it.title)}</b><div class="small muted ell">${esc([it.year, it.type === "show" ? "Series" : "Film", LST[it.status]].filter(Boolean).join(" · "))}</div></div>${quick(it)}</div>`).join("");
    const LABEL = { canon: "Canon and lists", games: "Games", books: "Books and manga", dw: "Doctor Who" };
    const groups = ["games", "books", "dw", "canon"].map(app => [app, res.map((r, i) => [r, i]).filter(([r]) => r.app === app)]).filter(([, l]) => l.length);
    return (mine.length ? `<div class="kicker" style="margin:6px 0">Films and series · ${mine.length}</div><div class="listcard">${libRows}</div>` : "")
      + groups.map(([app, l]) => `<div class="kicker" style="margin:16px 0 6px">${LABEL[app]} · ${l.length}</div>` + l.map(([r, i]) => `<div class="item" data-action="sres" data-i="${i}"><span class="xic ${r.app}">${icon(r.app === "games" ? "pad" : r.app === "dw" ? "box" : r.app === "books" ? "book" : "missing")}</span>
      <div class="grow"><b class="ell">${esc(r.title)}</b><div class="small muted ell">${esc(r.sub)}${r.done ? " · ✓ done" : r.state === "listed" ? " · on your list" : ""}</div></div>${icon("chev")}</div>`).join("")).join("") + online;
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
    ["Your own games list (.xlsx or .csv)", "A spreadsheet with a Title column and columns like OG Release Date, OG Platform, Remake Name / Release Date / Platform, Owned Platform, HLTB, HLTB Bundle, Rating (IMDb), Franchise, Multiverse, Next (X); Status and My rating are optional. Importing it again updates those columns and keeps your status, ratings, plays and notes; the same game on two consoles stays two entries."],
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
        ${db.get("import_undo_at") ? `<button class="btn small" data-action="undoimport">${icon("undo")}Undo the ${esc(db.get("import_undo_what", "last"))} import of ${esc(new Date(+db.get("import_undo_at")).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }))}</button>` : ""}
      </section>`;
  }
  // games and books are handed to their tabs through a shared file and a message
  // games and books go straight into their sections
  // 0.6.4: a games spreadsheet (.xlsx, or .csv / .tsv) with a Title column and game columns (HLTB, platform, release date,
  // franchise…), like the All_Games list. Anything else goes to the usual detection.
  function gameSheetOf(f) {
    let rows = null;
    if (f.zip && Object.keys(f.zip).some(n => /(^|\/)xl\/worksheets\/sheet\d+\.xml$/i.test(n))) rows = GC.readXlsx(f.zip);
    else if (typeof f.text === "string" && /\.(csv|tsv)$/i.test(f.name || "")) { const t = /\.tsv$/i.test(f.name) ? f.text.replace(/\t/g, ",") : f.text; try { rows = C.parseCsv(t); } catch (e) { return null; } }
    if (!rows) return null;
    const head = rows.slice(0, 10).find(r => (r || []).some(c => /^(title|name|game)$/i.test(String(c == null ? "" : c).trim())));
    const hs = (head || []).map(c => String(c == null ? "" : c).trim().toLowerCase());
    const gameCols = hs.filter(h => /^(hltb|hltb bundle|og release date|og platform|owned platform|remake name|remake platform|multiverse|how long to beat)$/.test(h)).length;
    if (!head || gameCols < 2) { if (f.zip) throw new Error("a spreadsheet, but not a games list (it needs a Title column and columns like OG Platform, HLTB, Franchise)"); return null; }
    return rows;
  }
  const detectFile = f => { const sheet = gameSheetOf(f); return sheet ? { target: "gamesheet", kind: "Games spreadsheet", sheet } : Imports.detect(f); };
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
      try { d = detectFile(f); } catch (e) { lines.push(`${f.name}: ${e.message}`); continue; }
      if (d.target === "gamesheet") {
        if (!feat("games")) { lines.push(`${f.name}: switch the Games tab on in Features first`); continue; }
        const gr = GC.fromSheet(games, d.sheet); games.save(); changed("games");
        lines.push(`${f.name}: ${fmt(gr.added)} games added, ${fmt(gr.updated)} updated, ${fmt(gr.same)} unchanged${gr.skipped ? `, ${fmt(gr.skipped)} you had removed left out` : ""}`);
        continue;
      }
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
  // Before anything is written: what each file is, how many entries, and how many are already in Saga
  function previewImport(files) {
    const rows = [];
    let total = 0;
    lib.withIndex(() => {
      for (const f of files) {
        if (f.error) { rows.push(`${f.name}: can't be read (${f.error})`); continue; }
        let d;
        try { d = detectFile(f); } catch (e) { rows.push(`${f.name}: ${e.message}`); continue; }
        if (d.target === "gamesheet") {
          // a dry run on a copy: exactly what the import will do
          const copy = new GC.Games(); copy.games = games.games.map(g => Object.assign({}, g)); copy.removed = Object.assign({}, games.removed);
          const r = GC.fromSheet(copy, d.sheet); total += r.rows;
          rows.push(`${f.name} (games list): ${fmt(r.rows)} games: ${fmt(r.added)} new, ${fmt(r.updated)} to update, ${fmt(r.same)} already the same${r.skipped ? `, ${fmt(r.skipped)} you had removed (left out)` : ""}${feat("games") ? "" : " (switch Games on in Features first)"}`);
          continue;
        }
        if (d.target === "watch") {
          const rs = d.rows || []; let have = 0;
          for (const r of rs) if (lib.find({ type: r.type || "movie", title: r.title, year: r.year, imdb: r.imdb, tmdb: r.tmdb, mal: r.mal })) have++;
          total += rs.length;
          rows.push(`${d.kind}: ${fmt(rs.length)} films and series, ${fmt(have)} already in your library, ${fmt(rs.length - have)} new`);
        } else if (d.target === "games") {
          const rs = d.rows || []; const have = rs.filter(r => games.find(r)).length; total += rs.length;
          rows.push(`${d.kind}: ${fmt(rs.length)} games, ${fmt(have)} already in Games, ${fmt(rs.length - have)} new${feat("games") ? "" : " (switch Games on in Features first)"}`);
        } else if (d.target === "books") {
          const n = (d.rows || []).length; total += n;
          rows.push(`${d.kind}: ${n ? fmt(n) + " books" : "books"} for Books${feat("books") ? "" : " (switch Books on in Features first)"}`);
        } else if (d.target === "canon") { total++; rows.push(`${f.name}: ${d.kind === "file" ? "franchise mapping" : d.kind} records for the canon finder`); }
        else rows.push(`${f.name}: not recognised`);
      }
    });
    const ok = total > 0;
    $("#overlay").innerHTML = `<div class="scrim" data-action="dismiss"><div class="dialog" role="dialog" aria-modal="true" aria-labelledby="dlgT">
      <h3 id="dlgT">${ok ? "Import these?" : "Nothing to import"}</h3>${rows.map(r => `<p class="small" style="margin:6px 0">${esc(r)}</p>`).join("")}
      ${ok ? `<p class="small muted">Ratings, notes and progress you set in Saga are kept. A copy of your data from just before is saved, so you can undo this import in Settings › Import.</p>` : ""}
      <div class="actions"><button class="btn quiet" data-action="dismiss">${ok ? "Cancel" : "Close"}</button>${ok ? `<button class="btn primary" id="dlgOk">Import</button>` : ""}</div></div></div>`;
    if (ok) $("#dlgOk").onclick = () => { closeOverlay(); runJob("Import", async () => { keepBeforeImport("export file"); return (await hubImport(files)).join(" · "); }); };
  }
  async function hubSteam() {
    const v = (($("#steamProfile") || {}).value || "").trim();
    const url = Imports.steamProfileUrl(v);
    if (!url) return toast("Type your Steam profile link or name");
    db.set("steam_profile", v);
    await runJob("Import", async () => {
      keepBeforeImport("Steam");
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
  const lastTouch = b => Math.max(b.started || 0, ...((b.log || []).slice(-1).map(x => x.t || 0)));
  function widgetFiles() {
    const ne = nextEpisodes();
    const f = {};
    f["widget_style.txt"] = `alpha=${db.get("widget_alpha", "95")}\nlook=${db.get("widget_look", "dark")}\nsize=${db.get("widget_size", "14")}\n`;
    // next episodes, with a Mark watched button for the first (on this widget and the main one)
    const first = ne.find(x => x.lib);
    const epBtn = first ? `@@✓ ${first.it.title.slice(0, 22)} S${first.s}E${first.e}\t${JSON.stringify({ op: "ep", id: first.it.id, s: first.s, e: first.e, at: "__NOW__" })}\n` : "";
    f["widget.txt"] = (ne[0] ? `▶ ${ne[0].lib ? ne[0].it.title : ne[0].show} · S${ne[0].s} E${ne[0].e}\n${epBtn}` : "") + C.widgetText(status(), gamesIdx(), dwIdx(), undefined, booksIdx());
    const epLines = ne.slice(0, 7).map(x => `${x.lib ? x.it.title : x.show} · S${x.s} E${x.e}${x.left > 1 ? `  (+${x.left - 1})` : ""}`);
    f["widget_episodes.txt"] = `Next episodes${ne.length > 7 ? ` · ${ne.length} series` : ""}\n` +
      (first ? `@@✓ ${first.it.title.slice(0, 22)} S${first.s}E${first.e}\t${JSON.stringify({ op: "ep", id: first.it.id, s: first.s, e: first.e, at: "__NOW__" })}\n` : "@@\n") +
      (epLines.join("\n") || "Nothing to catch up on. Series you're watching show up here.");
    // the next three weeks: episodes of your series, canon releases, games
    const today = TODAY(), until = new Date(Date.now() + 21 * 864e5).toISOString().slice(0, 10), up = [];
    for (const it of lib.all()) if (it.type === "show" && it.status !== "dropped" && it.status !== "paused" && it.epl) {
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
      const rd = books.books.filter(b => b.status === "reading").sort((a, b) => lastTouch(b) - lastTouch(a));
      // a button for the book you touched last: one chapter more (manga) or ten pages more
      const top = rd[0], manga = top && (top.manga || BC.isManga(top));
      const bBtn = top ? `@@${manga ? `+1 ch. ${top.title.slice(0, 20)}` : `+10 p. ${top.title.slice(0, 20)}`}\t${JSON.stringify({ op: "book_step", id: top.id, ch: manga ? 1 : 0, pages: manga ? 0 : 10, at: "__NOW__" })}\n` : "@@\n";
      f["widget_books.txt"] = `Reading${rd.length > 5 ? ` · ${rd.length}` : ""}\n${bBtn}` + (rd.slice(0, 5).map(b => {
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
  // 0.5.6: done a moment later and once for a burst of changes (it walks every row of both stores); anything that
  // reads the rows (the canon check, a save, a backup) brings it up to date first.
  let mirrorDirty = false, mirrorTimer = null;
  function libMirror() { mirrorDirty = true; invalidate(); if (!mirrorTimer && !C.BUSY.on) mirrorTimer = setTimeout(mirrorNow, 1500); } // during a job: only when something reads the rows
  function mirrorNow(quiet) {
    clearTimeout(mirrorTimer); mirrorTimer = null;
    if (!mirrorDirty) return;
    mirrorDirty = false;
    const hadTimer = !!db._timer;
    for (const [k, r] of db.itemsMap) if (r.source === "app") db.itemsMap.delete(k);
    const rows = lib.dbRows();
    db.addItems(rows.watched, "app", "watched");
    db.addItems(rows.watchlist, "app", "watchlist", "Library");
    if (quiet === true && !hadTimer) { clearTimeout(db._timer); db._timer = null; } // called by a save: these rows are in it already
    invalidate();
  }
  // the same in slices, before a save in pieces (0.5.7)
  async function mirrorSoft() {
    if (!mirrorDirty) return;
    mirrorDirty = false; clearTimeout(mirrorTimer); mirrorTimer = null;
    const hadTimer = !!db._timer;
    let i = 0;
    for (const [k, r] of db.itemsMap) { if (r.source === "app") db.itemsMap.delete(k); if ((++i & 4095) === 0) await C.breathe(0); }
    if (mirrorDirty) return mirrorSoft();
    const rows = lib.dbRows();
    await C.breathe(0);
    for (const [list, kind, ln] of [[rows.watched, "watched", ""], [rows.watchlist, "watchlist", "Library"]])
      for (let j = 0; j < list.length; j += 1500) { db.addItems(list.slice(j, j + 1500), "app", kind, ln); await C.breathe(0); }
    if (!hadTimer) { clearTimeout(db._timer); db._timer = null; }
    invalidate();
  }
  if (db.persist) db.persist.prepare = mirrorSoft;
  { const items = db.items.bind(db), toJSON = db.toJSON.bind(db);
    db.items = (a, b) => { mirrorNow(); return items(a, b); };
    db.toJSON = () => { mirrorNow(true); return toJSON(); }; }
  // a small file (games, books) saved a moment later, in pieces; leaving the app writes it at once
  function lazyFile(name, obj) {
    let timer = null, gen = 0, busy = false;
    const write = () => { timer = null; const g = ++gen; busy = true;
      C.jsonParts(obj().toJSON()).then(parts => (g === gen ? Native.saveParts(name, parts, () => g === gen) : false)).catch(() => {}).then(() => { if (g === gen) busy = false; }); };
    let jobDirty = false;
    const later = () => { if (C.BUSY.on) { jobDirty = true; if (!timer) timer = setTimeout(later, 5000); return; } timer = null; jobDirty = false; write(); };
    return { lazy: () => { if (C.BUSY.on) jobDirty = true; if (!timer) timer = setTimeout(later, 700); },
      now: () => { if (!timer && !busy && !jobDirty) return; jobDirty = false; clearTimeout(timer); timer = null; gen++; busy = false; Native.save(name, JSON.stringify(obj().toJSON())); } };
  }
  const libTouch = () => { if (C.BUSY.on && Native.parts) { libJobDirty = true; return; } if (!libTimer) libTimer = setTimeout(libWrite, Math.max(800, (C.BUSY.on && Native.parts ? 25000 : 4000) - (Date.now() - libLast))); };
  // The library file is written a moment later, and once for a burst of changes (a sync, ticking several episodes):
  // with a big library each write takes long enough to hold up the screen. Leaving the app writes it at once.
  let libTimer = null, libLast = 0, libGen = 0, libBusy = false;
  function libWrite(sync) {
    clearTimeout(libTimer); libTimer = null; libLast = Date.now(); libJobDirty = false;
    if (sync !== true && Native.parts) { // built and handed over in pieces: the screen stays free
      const gen = ++libGen; libBusy = true;
      C.jsonParts(lib.toJSON()).then(parts => (gen === libGen ? Native.saveParts("library.json", parts, () => gen === libGen) : false))
        .then(ok => { if (ok) libStamp = null; }, () => {}).then(() => { if (gen === libGen) libBusy = false; });
      return;
    }
    libGen++; libBusy = false;
    if (!sync && Native.later) { Native.saveLater("library.json", JSON.stringify(lib.toJSON())); libStamp = null; return; }
    lib.save();
    libStamp = window.Android && Android.stamp ? String(Android.stamp("library.json") || "") : "";
  }
  // after a background write, the stamp it left (asked only when needed: asking waits for the write)
  const libOwnStamp = () => { if (libStamp === null) libStamp = Native.ownStamp("library.json"); return libStamp; };
  let libJobDirty = false;
  const libPending = () => !!libTimer || libBusy || libJobDirty;
  function libSave() {
    if (C.BUSY.on && Native.parts) { libJobDirty = true; libMirror(); return; } // saved once when the job ends
    if (!libTimer) libTimer = setTimeout(libWrite, Math.max(800, (C.BUSY.on && Native.parts ? 25000 : 4000) - (Date.now() - libLast)));
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
  // ---- 0.6.5: where a title came from. Every synced row (not Saga's own copy) that is the same title.
  const SRC_NAME = { imdb: "IMDb", trakt: "Trakt", letterboxd: "Letterboxd", csv: "an import", url: "a canon list" };
  const KIND_NAME = { watched: "watched", rated: "ratings", watchlist: "watchlist", list: "list", collection: "collection" };
  function originsIndex() {
    const ix = new Map(), put = (k, r) => { if (!k) return; const a = ix.get(k); if (a) a.push(r); else ix.set(k, [r]); };
    for (const r of db.items()) { if (r.source === "app") continue; put(r.imdb && "i:" + r.imdb, r); put(r.tmdb && "t:" + r.tmdb, r); put(r.norm && "n:" + r.norm, r); }
    return ix;
  }
  function originsOf(it, ix = originsIndex()) {
    const tv = it.type === "show", nm = C.norm(it.title), out = new Set();
    const same = r => (r.medium === "TV Series") === tv && r.medium !== "Video Game" && r.medium !== "Episode";
    for (const k of [it.imdb && "i:" + it.imdb, it.tmdb && "t:" + it.tmdb]) for (const r of (k && ix.get(k)) || []) if (same(r)) out.add(r);
    for (const r of ix.get("n:" + nm) || []) if (same(r) && (!it.year || !r.year || Math.abs(r.year - it.year) <= 1) && (!it.imdb || !r.imdb || r.imdb === it.imdb)) out.add(r);
    return [...out];
  }
  const originKey = r => `${r.source}|${r.kind === "list" ? r.list_name || "" : "#" + r.kind}`;
  const originLabel = r => `${SRC_NAME[r.source] || r.source} ${KIND_NAME[r.kind] || r.kind}${r.kind === "list" && r.list_name ? ` “${r.list_name}”` : ""}${r.rating ? ` · rated ${r.rating}` : ""}${r.date ? ` · ${String(r.date).slice(0, 10)}` : ""}`;
  // something you did in Saga: these titles are never removed with a list
  const yours = it => it.rating > 0 || it.watches.some(Boolean) || Object.keys(it.eps || {}).length > 0 || !!it.notes || it.ratedHere;
  // the titles that only a given list brought, that you haven't touched
  function listOnlyItems(source, name) {
    const ix = originsIndex(), k = `${source}|${name || ""}`;
    return lib.all().filter(it => { if (yours(it)) return false; const o = originsOf(it, ix); return o.length > 0 && o.every(r => originKey(r) === k); });
  }
  function whyHtml(it) {
    const o = originsOf(it), seen = new Set();
    const rows = o.filter(r => { const k = originKey(r); if (seen.has(k)) return false; seen.add(k); return true; });
    const lists = rows.filter(r => r.kind === "list");
    return `<details class="why"><summary class="small muted">Why is this here?</summary><div class="small" style="margin:6px 0 10px">
      <p class="muted" style="margin:0 0 6px">Added ${esc(new Date(it.added || Date.now()).toLocaleDateString(lang() === "it" ? "it-IT" : "en-GB", { day: "numeric", month: "short", year: "numeric" }))}${it.src ? ` by ${esc(SRC_NAME[it.src] || (it.src === "sync" ? "a sync" : it.src))}` : ""}.</p>
      ${rows.length ? `<ul style="margin:0;padding-left:18px">${rows.map(r => `<li>${esc(originLabel(r))}${r.kind === "list" ? (listOn(r.source, r.list_name) ? "" : ` <span class="muted">(switched off)</span>`) : ""}</li>`).join("")}</ul>`
        : `<p class="muted" style="margin:0">Not on any of your synced lists or ratings now: you added it, an import did, or a list it was on has changed since.</p>`}
      ${lists.filter(r => listOn(r.source, r.list_name)).map(r => `<button class="btn quiet small" style="margin-top:6px" data-action="listpurge" data-k="${esc(r.source + "|" + (r.list_name || ""))}">Switch off “${esc(r.list_name || "list")}” and remove its titles…</button>`).join("")}
    </div></details>`;
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
  // 0.5.8: these two run as generators: in one go when called plainly, or in slices with pauses during a sync
  const runGen = g => { let r; do { r = g.next(); } while (!r.done); return r.value; };
  async function runGenSoft(g) { let r, t = Date.now(); do { r = g.next(); if (Date.now() - t > 10) { await C.breathe(0); t = Date.now(); } } while (!r.done); return r.value; }
  function adoptEpRatings(ieps) { return runGen(adoptEpRatingsG(ieps)); }
  function* adoptEpRatingsG(ieps) {
    let n = 0, Y = 0;
    const shows = lib.all().filter(x => x.type === "show");
    const byImdb = new Map(), byTmdb = new Map(), byName = new Map();
    const index = x => { if (x.imdb) byImdb.set(x.imdb, x); if (x.tmdb) byTmdb.set(String(x.tmdb), x); const k = L.norm(x.title); if (!byName.has(k)) byName.set(k, x); if (x.orig) { const o = L.norm(x.orig); if (!byName.has(o)) byName.set(o, x); } };
    for (const x of shows) index(x);
    const put = (it, k, r) => { it.er = it.er || {}; if (!it.er[k] && r && !(it.erMine && it.erMine[k])) { it.er[k] = +r; n++; } };
    // 0.5.9: a rated episode is a watched episode: ticked (on the day it was rated when known), and its series moves
    // from the watchlist to Watching. A series not in the library yet is added, unless you removed it.
    const tick = (it, k, d) => {
      if (!it.eps[k]) { it.eps[k] = d || TODAY(); if (!d) L.markBulk(it, k); n++; }
      if (it.status === "watchlist") { it.status = "watching"; it.updated = Date.now(); }
    };
    const showFor = (p, fallbackTitle) => {
      let it = (p.tmdb && byTmdb.get(String(p.tmdb))) || (p.imdb && byImdb.get(p.imdb)) || byName.get(L.norm(p.t || fallbackTitle || ""));
      if (it && lib.items[it.id] !== it) it = null;
      if (it || !(p.t || fallbackTitle)) return it || null;
      const ak = p.imdb || `show|${L.norm(p.t || fallbackTitle)}|${p.y || ""}`;
      if (lib.adopted[ak]) return null; // brought in before and since removed by you
      lib.adopted[ak] = 1;
      it = lib.add({ type: "show", title: p.t || fallbackTitle, year: p.y || null, imdb: p.imdb || null, tmdb: p.tmdb ? +p.tmdb : null, src: "sync" }, "watching").item;
      it.autoWatching = true; index(it); n++;
      return it;
    };
    let tr = {};
    try { tr = JSON.parse(db.get("ep_ratings", "{}")) || {}; } catch (e) { tr = {}; }
    for (const p of Object.values(tr)) {
      const it = showFor(p);
      if (it) for (const [k, r] of Object.entries(p.r || {})) { put(it, k, r); if (r > 0) tick(it, k, (p.d || {})[k]); }
      if ((++Y & 63) === 0) yield;
    }
    for (const [sid, p] of Object.entries(ieps || {})) {
      const it = showFor(Object.assign({ imdb: sid }, p));
      if (it) for (const [k, r] of Object.entries(p.r || {})) { put(it, k, r); if (r > 0) tick(it, k, (p.d || {})[k] || ((p.eps || {})[k] && typeof p.eps[k] === "string" ? p.eps[k] : null)); }
      if ((++Y & 63) === 0) yield;
    }
    {
      const epIx = new Map(); // show -> episode name -> "s:e"
      for (const r of db.items("imdb", ["rated"])) {
        if (r.medium !== "Episode" || !r.rating) continue;
        // "Series: Episode" — the series name can hold ": " itself, so each split is tried against your library
        // (no series is created from a CSV row: it carries no series id, and a wrong split would add a wrong title)
        let it = null, epName = "";
        for (let cut = String(r.title).indexOf(": "); cut > 0 && !it; cut = r.title.indexOf(": ", cut + 2)) { const x = byName.get(L.norm(r.title.slice(0, cut))); if (x && lib.items[x.id] === x) { it = x; epName = r.title.slice(cut + 2); } }
        if (!it) continue;
        const d = String(r.rated_at || r.date || "").slice(0, 10) || null;
        if (!it.epl || !it.epl.length) {
          // the episode list isn't loaded yet: kept by name, ticked as soon as it is (library.js pendingEps)
          const pk = L.norm(epName);
          it.epRatedPending = it.epRatedPending || {};
          if (!it.epRatedPending[pk]) { it.epRatedPending[pk] = { r: +r.rating, d }; n++; }
          if (it.status === "watchlist") it.status = "watching";
          continue;
        }
        let ix = epIx.get(it);
        if (!ix) { ix = new Map(); for (const x of it.epl) if (x[3]) { const k = L.norm(x[3]); ix.set(k, ix.has(k) ? null : L.epKey(x[0], x[1])); } epIx.set(it, ix); }
        const k = ix.get(L.norm(epName));
        if (k) { put(it, k, r.rating); tick(it, k, d); }
        if ((++Y & 255) === 0) yield;
      }
    }
    return n;
  }
  function adoptRows() {
    listMemo = { on: {}, lists: syncedLists() };
    try { return db.items(null, ["watched", "rated", "watchlist", "list"]).filter(r => r.source !== "app" && (r.kind !== "list" || listOn(r.source, r.list_name))); } finally { listMemo = null; }
  }
  function libAdopt() {
    if (db.get("lib_adopt", "1") !== "1") return 0;
    return libAdoptRest(lib.adopt(adoptRows()));
  }
  // during a sync: the same in small steps, with pauses, so taps and scrolling keep working
  async function libAdoptSoft() {
    if (db.get("lib_adopt", "1") !== "1") return 0;
    const rows = adoptRows();
    await C.breathe(0);
    const n = await lib.adoptSliced(rows, () => C.breathe(0));
    await C.breathe(0);
    return runGenSoft(libAdoptRestG(n));
  }
  function libAdoptRest(n) { return runGen(libAdoptRestG(n)); }
  function* libAdoptRestG(n) {
    let Y = 0;
    // episodes you've watched on Trakt, with the day you watched each one, merged into the library every time
    let prog = {}, changed = 0;
    try { prog = JSON.parse(db.get("trakt_progress", "{}")) || {}; } catch (e) { prog = {}; }
    // series looked up through maps built once (a scan per series froze the screen with a big library)
    const byTmdb = new Map(), byImdb = new Map(), byName = new Map();
    const index = x => { if (x.type !== "show") return; if (x.tmdb && !byTmdb.has(String(x.tmdb))) byTmdb.set(String(x.tmdb), x); if (x.imdb && !byImdb.has(x.imdb)) byImdb.set(x.imdb, x);
      const k = L.norm(x.title); if (k) { const a = byName.get(k); if (a) a.push(x); else byName.set(k, [x]); } };
    for (const x of lib.all()) { index(x); if ((++Y & 1023) === 0) yield; }
    for (const [tmdbId, p] of Object.entries(prog)) {
      if ((++Y & 31) === 0) yield;
      let it = byTmdb.get(String(tmdbId)) || (p.imdb && byImdb.get(p.imdb)) || null;
      if (!it) it = (byName.get(L.norm(p.t)) || []).find(x => !p.y || !x.year || Math.abs(x.year - p.y) <= 1) || null;
      if (!it) { if (lib.adopted[p.imdb || `show|${L.norm(p.t)}|${p.y || ""}`]) continue; it = lib.add({ type: "show", title: p.t, year: p.y || null, imdb: p.imdb || null, tmdb: +tmdbId || null, src: "trakt" }, "watching").item; index(it); }
      if (!it.tmdb && +tmdbId) it.tmdb = +tmdbId;
      const fallback = (p.last || "").slice(0, 10);
      for (const [sn, nums] of Object.entries(p.eps || {})) for (const e of nums) {
        const k = L.epKey(+sn, e);
        if (!it.eps[k]) { it.eps[k] = (p.d && p.d[k]) || fallback; if (!(p.d && p.d[k])) L.markBulk(it, k); changed++; }
      }
      if (it.status === "watchlist" || (it.status === "watched" && !lib.caughtUp(it) && it.epl)) it.status = "watching";
    }
    // episodes you rated on IMDb count as watched (IMDb keeps no other episode progress)
    let ieps = {};
    try { ieps = JSON.parse(db.get("imdb_eps", "{}")) || {}; } catch (e) { ieps = {}; }
    for (const [sid, p] of Object.entries(ieps)) {
      if ((++Y & 31) === 0) yield;
      let it = byImdb.get(sid) || null; // through the maps above: a scan of the whole library per series froze the screen
      if (!it && p.t) it = (byName.get(L.norm(p.t)) || []).find(x => !p.y || !x.year || Math.abs(x.year - p.y) <= 1) || null;
      if (it && lib.items[it.id] !== it) it = null;
      if (!it) { if (!p.t || lib.adopted[sid]) continue; it = lib.add({ type: "show", title: p.t, year: p.y || null, imdb: sid, src: "imdb" }, "watching").item; index(it); }
      if (!it.imdb) it.imdb = sid;
      for (const [k, d] of Object.entries(p.eps || {})) if (!it.eps[k]) { it.eps[k] = typeof d === "string" ? d : TODAY(); changed++; }
      if (it.status === "watchlist") it.status = "watching";
    }
    yield;
    changed += yield* adoptEpRatingsG(ieps);
    yield;
    // a series marked watched elsewhere but with no episodes yet waits in Watching, unless it's known to have ended
    lib.all().forEach(it => { if (it.type === "show" && it.status === "watched" && !it.ended && !Object.keys(it.eps).length && !it.watches.length) { it.status = "watching"; it.autoWatching = true; } });
    yield;
    changed += lib.settleAll();
    yield;
    for (const it of lib.all()) { if (it.status === "watchlist" && it.type === "movie" && seenElsewhere(it)) { it.status = "watched"; changed++; } if ((++Y & 511) === 0) yield; }
    if (n || changed) libSave();
    return n;
  }
  function libThumb(it, big) {
    const cls = `thumb${big ? " big" : ""}`;
    if (it.poster) return `<img class="${cls}" loading="lazy" src="${esc(httpsUrl(it.poster))}" alt="" data-fb="ph" data-fbc="thumb ph ${it.type === "show" ? "series" : "movie"}${big ? " big" : ""}" data-fbt="${esc(initials(it.title))}">`;
    return `<div class="${cls} ph ${it.type === "show" ? "series" : "movie"}" aria-hidden="true">${esc(initials(it.title))}</div>`;
  }
  const typeTag = it => medTag(it.type === "show" ? "TV Series" : "Movie");
  const LST = { watchlist: "Watchlist", watching: "Watching", paused: "Paused", watched: "Watched", dropped: "Dropped" };
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
  // 0.5.9: the main numbers for a set of library titles (the strip on top of Library and Anime, and Stats)
  function watchStats(items) {
    let mins = 0, rewatches = 0, done = 0, eps = 0;
    const r = { movie: [], show: [], ep: [] };
    for (const it of items) {
      if (it.status === "watched") done++;
      if (it.type === "movie") { const w = Math.max(it.watches.length, it.status === "watched" ? 1 : 0); mins += (it.runtime || 0) * w; rewatches += Math.max(0, it.watches.length - 1); }
      else { const n = Object.keys(it.eps || {}).length; eps += n; mins += n * (it.runtime || it.epRuntime || 0); }
      if (it.rating > 0) r[it.type === "show" ? "show" : "movie"].push(it.rating);
      for (const v of Object.values(it.er || {})) if (v > 0) r.ep.push(v);
    }
    const A = a => (a.length ? Math.round((a.reduce((x, y) => x + y, 0) / a.length) * 10) / 10 : null);
    const all = [...r.movie, ...r.show];
    return { n: items.length, done, pct: items.length ? Math.round((100 * done) / items.length) : 0, hours: Math.round(mins / 60), eps, rewatches,
      avgMovie: A(r.movie), avgShow: A(r.show), avgEp: A(r.ep), avgAll: A(all), nMovie: r.movie.length, nShow: r.show.length, nEp: r.ep.length };
  }
  function watchStrip(items) {
    const s = watchStats(items);
    return `<div class="sstrip"><div><b>${fmt(s.n)}</b><span>titles</span></div><div><b>${s.pct}%</b><span>watched</span></div>${s.hours ? `<div><b>${fmt(s.hours)} h</b><span>watched</span></div>` : ""}
      <div><b>${s.avgAll != null ? "★ " + s.avgAll : "–"}</b><span>average</span></div>${s.avgMovie != null ? `<div><b>★ ${s.avgMovie}</b><span>films</span></div>` : ""}${s.avgShow != null ? `<div><b>★ ${s.avgShow}</b><span>series</span></div>` : ""}
      ${s.avgEp != null ? `<div><b>★ ${s.avgEp}</b><span>episodes (${fmt(s.nEp)})</span></div>` : ""}${s.rewatches ? `<div><b>${fmt(s.rewatches)}</b><span>rewatches</span></div>` : ""}</div>`;
  }
  function libTile(it) {
    const n = it.type === "show" && it.status === "watching" ? lib.nextEp(it) : null;
    const s = ui.libF === "watchlist" || ui.libF === "services" ? streamsFor(it) : null;
    const badge = n ? (n.upcoming ? (n.date ? shortDay(n.date).replace(/ \d{4}$/, "") : "Soon") : `S${n.s} E${n.e}`) : s && s.mine ? shortName(s.o.name) : s && s.vpn ? `VPN ${s.vpn.flag}` : "";
    return Kit.tile({ key: "lib:" + it.id, title: it.title, img: it.poster, kind: it.type, badge, badgeAcc: !!(n && !n.upcoming) || !!(s && s.mine), badgeR: it.type === "movie" && it.watches.length > 1 ? `${it.watches.length}×` : it.rating ? `★ ${it.rating / 2}` : "",
      progress: it.type === "show" && it.status === "watching" ? progressOf(it) : null, done: it.status === "watched" || (ui.sel && ui.sel.has(it.id)), attrs: ui.sel ? `data-action="libsel" data-id="${esc(it.id)}" aria-pressed="${ui.sel.has(it.id)}"` : `data-action="libopen" data-id="${esc(it.id)}"` },
      it.title, [it.year, it.type === "show" ? "Series" : "Film"].filter(Boolean).join(" · "));
  }
  function renderAnime() { return renderLibrary(true); }
  function renderLibrary(anime) {
    anime = anime === true;
    const all = lib.all().filter(it => !!it.anime === anime), c = lib.counts();
    for (const k of ["all", "watchlist", "watching", "paused", "watched", "dropped", "movie", "show"]) c[k] = 0;
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
    const chips = [["watching", "Watching"], ["watchlist", "Watchlist"], ["services", "Streaming for me"], ["paused", "Paused"], ["watched", "Watched"], ["dropped", "Dropped"], ["all", "All"]];
    return head + `<div class="chips" style="margin-bottom:10px">${chips.map(([k, l]) => `<button class="chip" data-action="libfilter" data-v="${k}" aria-pressed="${f === k}">${l}${c[k] != null ? ` <span class="muted">${fmt(c[k])}</span>` : ""}</button>`).join("")}</div>
      ${tags.length ? `<div class="tagrow" style="margin-bottom:10px">${tags.slice(0, 20).map(([t, n]) => `<button class="tagchip" data-action="libtag" data-v="${esc(t)}" aria-pressed="${ui.libTag === t}">${esc(t)} <span style="opacity:.6">${n}</span></button>`).join("")}</div>` : ""}
      <div class="toolbar"><input type="search" data-input="libFilterQ" value="${esc(ui.libFilterQ || "")}" placeholder="Filter your library" autocomplete="off">
        <select data-libtype="1" aria-label="Type">${[["all", "Films & series"], ["movie", "Films"], ["show", "Series"]].map(([k, l]) => `<option value="${k}" ${ty === k ? "selected" : ""}>${l}</option>`).join("")}</select>
        <select data-libsort="1" aria-label="Sort">${[["recent", "Recent"], ["title", "Title"], ["rating", "Rating"], ["year", "Year"]].map(([k, l]) => `<option value="${k}" ${(ui.libSort || "recent") === k ? "selected" : ""}>${l}</option>`).join("")}</select></div>
      ${f === "services" ? `<p class="small muted">Watchlist titles on ${esc(myServices().join(", "))}${feat("vpn") ? ", or elsewhere with a VPN" : ""}. Where things stream is looked up after each sync (needs a TMDB key).</p>` : ""}
      ${watchStrip(list)}
      <div class="row" style="margin:0 0 10px;gap:8px">${ui.sel ? `<b class="grow">${fmt(ui.sel.size)} selected</b><button class="btn quiet small" data-action="libselall">Select all ${fmt(Math.min(list.length, lim))}</button><button class="btn quiet small" data-action="libselend">Done</button>` : `<span class="grow"></span><button class="btn quiet small" data-action="libselstart">Select</button>`}</div>
      ${ui.sel && ui.sel.size ? `<div class="chips" style="position:sticky;top:0;z-index:5;background:var(--bg);padding:6px 0;margin-bottom:8px">${[["watched", "Watched"], ["watchlist", "Watchlist"], ["watching", "Watching"], ["paused", "Paused"], ["dropped", "Dropped"]].map(([v, l]) => `<button class="chip" data-action="libbulk" data-v="${v}">${l}</button>`).join("")}<button class="chip" data-action="libbulk" data-v="list">${icon("plus")}List</button><button class="chip" data-action="libbulk" data-v="tag">Tag</button><button class="chip" data-action="libbulk" data-v="remove">Remove</button></div>` : ""}
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
  // the "Other AI" choice is ready: a key, or a local server with an address (and a key for Open WebUI)
  function aiReady() {
    const pr = C.AI_PRESETS[db.get("ai_preset", "openai")] || {};
    if (pr.local) return !!db.get("ai_base") && !!db.get("ai_model") && (pr.noKey || !!db.get("ai_key"));
    return !!db.get("ai_key");
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
    if (aiReady()) return runJob("Canon check", p => C.compatScan(db, Native.http, { preset: db.get("ai_preset", "openai"), key: db.get("ai_key"), model: db.get("ai_model"), base: db.get("ai_base") }, p, only).then(done));
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
  // 0.6.2: cast and crew (each opens their work) and a choice of posters, at the bottom of a film or series
  function libExtrasHtml(it) {
    if (!db.get("tmdb_key")) return "";
    const cc = ui.libCast && ui.libCast.id === it.id ? ui.libCast : null, pp = ui.libPosters && ui.libPosters.id === it.id ? ui.libPosters : null;
    const cast = !cc ? `<button class="sheetbtn" data-action="libcast">${icon("list")}Cast & crew</button>`
      : cc.busy ? `<p class="small muted">Asking TMDB…</p>` : cc.err ? `<p class="small muted">${esc(cc.err)}</p>`
      : cc.inf ? `<h4>Cast & crew</h4><p class="small">${peopleLine(cc.inf) || "TMDB lists nobody."}</p>` : `<p class="small muted">TMDB doesn't know this title.</p>`;
    const post = !pp ? `<button class="sheetbtn" data-action="libposters">${icon("box")}Change poster</button>`
      : pp.busy ? `<p class="small muted">Loading posters…</p>` : pp.err ? `<p class="small muted">${esc(pp.err)}</p>`
      : `<h4>Pick a poster</h4><div class="postpick">${pp.list.map((u, i) => `<button data-action="libposter" data-i="${i}" aria-label="Poster ${i + 1}" aria-pressed="${u === it.poster}"><img src="${esc(u)}" alt="" loading="lazy"></button>`).join("") || `<p class="small muted">No posters on TMDB.</p>`}</div>`;
    return cast + post;
  }
  // 0.6.1: related anime (its films, sequels, side stories) at the bottom of an anime sheet, on request
  function relHtml(it) {
    const r = ui.rel && ui.rel.id === it.id ? ui.rel : null;
    if (!r) return `<button class="sheetbtn" data-action="librel">${icon("list")}Related: films, sequels, side stories</button>`;
    if (r.busy) return `<p class="small muted">Asking MyAnimeList…</p>`;
    if (r.err) return `<p class="small muted">${esc(r.err)}</p>`;
    if (!r.list.length) return `<p class="small muted">Nothing related on MyAnimeList.</p>`;
    return `<h4>Related</h4><div class="listcard">${r.list.map((x, i) => { const have = lib.all().find(y => String(y.mal) === String(x.mal));
      return `<div class="item" ${have ? `data-action="libopen" data-id="${esc(have.id)}"` : `data-action="open" data-url="https://myanimelist.net/anime/${esc(x.mal)}"`} role="button"><div class="grow" style="min-width:0"><b class="ell">${esc(x.title)}</b><div class="small muted">${esc(x.relation)}</div></div>${have ? `<span class="small muted">${esc(L.LABEL[have.status] || "In library")}</span>` : `<button class="btn quiet small" data-action="libreladd" data-i="${i}">${icon("plus")}Add</button>`}</div>`; }).join("")}</div>`;
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
      <div class="seg2" style="grid-template-columns:repeat(5,1fr);margin:10px 0">${L.STATUSES.map(s => `<button data-action="libst" data-v="${s}" aria-pressed="${it.status === s}">${LST[s]}</button>`).join("")}</div>
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
        ${it.anime && it.mal ? relHtml(it) : ""}
        ${libExtrasHtml(it)}
        ${sendButtons(it)}
        ${(() => { const f = friendsOn(it); return f.length ? `<p class="small" style="margin:8px 0">${f.map(x => `<b>${esc(x.name)}</b>: ${esc(LST[x.status] || x.status)}${x.rating ? ` · ★ ${x.rating}` : ""}`).join(" · ")}</p>` : ""; })()}
        ${whyHtml(it)}
        <button class="sheetbtn" data-action="libwhere">${icon("eye")}Where to watch and details</button>
        <button class="sheetbtn" data-action="open" data-url="${esc(it.imdb ? `https://www.imdb.com/title/${it.imdb}/` : `https://www.imdb.com/find/?q=${encodeURIComponent(it.title + " " + (it.year || ""))}`)}">${icon("open")}Open on IMDb</button>
        <button class="sheetbtn" data-action="mlistadd" data-k="lib:${esc(it.id)}">${icon("plus")}Add to a list</button>
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
      case "libnext": { const x = lib.get(el.dataset.id); if (x) { const u = libUndo(x); lib.toggleEp(x, +el.dataset.s, +el.dataset.e); libSave(); toast(`Watched ${x.title} S${el.dataset.s} E${el.dataset.e}`, u); render(); if ($("#allRes")) $("#allRes").innerHTML = searchResults(); } return true; }
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
      case "librel": { const id = it.id; ui.rel = { id, busy: true }; openLib(id);
        L.animeRelations(Native.http, it.mal).then(list => { ui.rel = { id, list }; }, e => { ui.rel = { id, err: e.message }; }).then(() => { if (ui.libOpen === id) openLib(id); });
        return true; }
      case "libreladd": { const x = ui.rel && ui.rel.list[+el.dataset.i]; if (!x) return true; const back = it.id;
        L.animeOne(Native.http, x.mal).then(r => { libAdd(r, "watchlist"); if (ui.libOpen === back) openLib(back); render(); }, e => toast(`MyAnimeList: ${e.message}`));
        return true; }
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
  const gamesFile = lazyFile("games.json", () => games), booksFile = lazyFile("books.json", () => books);
  const games = new GC.Games({ load: () => Native.load("games.json"), save: t => Native.save("games.json", t), saveLazy: Native.parts ? () => gamesFile.lazy() : null });
  const books = new BC.Library({ load: () => Native.load("books.json"), save: t => Native.save("books.json", t), saveLazy: Native.parts ? () => booksFile.lazy() : null });
  const NAV = [["home", "Home", "home"], ["watch", "Watch", "library"], ["games", "Games", "pad"], ["books", "Books", "book"], ["timeline", "Who", "box"]];
  const WATCH = [["library", "Library"], ["anime", "Anime"], ["upcoming", "Upcoming"], ["missing", "Canon"], ["stats", "Stats"]];
  const TITLES = { watch: "Watch", games: "Games", books: "Books", timeline: "Doctor Who", settings: "Settings", sync: "Sync", year: "Your year", mv: "Multiverse" };
  const secOn = s => (s === "games" ? feat("games") : s === "books" ? feat("books") : s === "timeline" ? feat("dw") : true);
  const RENDER = { library: renderLibrary, anime: renderAnime, upcoming: renderUpcoming, missing: renderMissing, stats: renderStats, compare: renderCompare };
  const SECR = { home: renderHome, settings: renderSettings, sync: renderSync, year: renderYear, mv: renderMv };
  let changeTimer = null;
  // something changed in a section: refresh the widget and the backup file a little later
  function changed(what) {
    webSyncSoon();
    clearTimeout(changeTimer);
    const run = () => { if (ui.job) { changeTimer = setTimeout(run, 20000); return; } // not in the middle of a sync
      statusSoon().catch(() => {}).then(() => { try { updateWidget(); } catch (e) { /* optional */ } try { backupToFile(false).catch(() => {}); } catch (e) { /* next time */ } }); };
    changeTimer = setTimeout(run, 20000);
  }
  // ---- Your lists: films, series, games and books together; plus smart lists that fill themselves
  // An entry is "lib:<id>", "game:<id>" or "book:<id>".
  const myLists = () => { try { return JSON.parse(db.get("my_lists", "[]")) || []; } catch (e) { return []; } };
  const saveMyLists = a => { db.set("my_lists", JSON.stringify(a)); db.flush(); };
  function entryOf(k) {
    const [kind, ...rest] = String(k).split(":"), id = rest.join(":");
    if (kind === "lib") { const it = lib.get(id); return it && { k, title: it.title, img: it.poster, kind: it.type, attrs: `data-action="libopen" data-id="${esc(id)}"`, year: it.year }; }
    if (kind === "game") { const g = games.get(id); return g && { k, title: g.title, img: g.cover || (g.steam ? GC.COVER(g.steam) : ""), kind: "game", attrs: `data-action="gopen" data-id="${esc(id)}"` }; }
    if (kind === "book") { const b = books.get(id); return b && { k, title: b.title, img: (b.cover || "").replace(/^http:/, "https:"), kind: "book", attrs: `data-action="bopen" data-id="${esc(id)}"` }; }
    return null;
  }
  // rules, each explained by its name; computed on the spot so they're never out of date
  const SMART = [
    ["s_short", "Short films on your watchlist (under 100 min)", () => lib.all().filter(x => x.type === "movie" && x.status === "watchlist" && x.runtime && x.runtime < 100).map(x => "lib:" + x.id)],
    ["s_nearly", "Series nearly finished (3 episodes or fewer left)", () => lib.all().filter(x => x.type === "show" && x.status === "watching" && x.epl && (() => { const n = lib.nextEp(x); return n && !n.upcoming && n.left <= 3; })()).map(x => "lib:" + x.id)],
    ["s_paused", "Paused, anything", () => [...lib.all().filter(x => x.status === "paused").map(x => "lib:" + x.id), ...(secOn("games") ? games.visible().filter(g => g.status === "paused").map(g => "game:" + g.id) : []), ...(secOn("books") ? books.books.filter(b => b.status === "paused").map(b => "book:" + b.id) : [])]],
    ["s_owned", "Games you own and haven't started", () => secOn("games") ? games.visible().filter(g => g.owned && (g.status === "backlog" || g.status === "wishlist")).map(g => "game:" + g.id) : []],
    ["s_top", "Rated 9 or 10, anything", () => [...lib.all().filter(x => x.rating >= 9).map(x => "lib:" + x.id), ...(secOn("games") ? games.visible().filter(g => g.rating >= 9).map(g => "game:" + g.id) : []), ...(secOn("books") ? books.books.filter(b => b.rating >= 9).map(b => "book:" + b.id) : [])]],
  ];
  // ---- 0.5.8: lists by rules. Every film, series, game and book as one row the rules can read.
  const STATUS_GROUP = { watchlist: "want", want: "want", wishlist: "want", backlog: "want", watching: "doing", playing: "doing", reading: "doing",
    watched: "done", done: "done", read: "done", paused: "paused", dropped: "dropped", dnf: "dropped" };
  function ruleRows() {
    const out = [];
    for (const it of lib.all()) {
      const inf = it.tmdb ? db.cacheGet(`info:${it.type === "show" ? "tv" : "m"}${it.tmdb}`) : null;
      const n = it.type === "show" && it.epl ? lib.nextEp(it) : null;
      const total = it.type === "show" && it.epl ? it.epl.filter(e => e[0] > 0).length : 0;
      out.push({ k: "lib:" + it.id, media: it.type, title: it.title, status: STATUS_GROUP[it.status] || it.status, rating: it.rating || 0, mins: it.type === "movie" ? it.runtime || 0 : 0,
        hours: 0, pages: 0, owned: !!it.owned, franchise: it.franchise || "", added: it.added || 0, year: it.year || 0,
        progress: total ? Math.round(Object.keys(it.eps || {}).length / total * 100) : 0, left: n && !n.upcoming ? n.left : null,
        offers: inf && inf.offers ? inf.offers.filter(o => /flatrate|free|ads/.test(o.type)).map(o => o.name) : null });
    }
    if (secOn("games")) for (const g of games.visible()) out.push({ k: "game:" + g.id, media: "game", title: g.title, status: STATUS_GROUP[g.status] || g.status, rating: g.rating || 0, mins: 0, hours: g.hours || 0, pages: 0,
      owned: !!g.owned, franchise: g.franchise || g.multiverse || "", added: g.added || 0, year: +(g.date || "").slice(0, 4) || 0, progress: 0, left: null, offers: null });
    if (secOn("books")) for (const b of books.books) out.push({ k: "book:" + b.id, media: "book", title: b.title, status: STATUS_GROUP[b.status] || b.status, rating: b.rating || 0, mins: 0, hours: 0, pages: b.pages || 0,
      owned: !!(b.owned || b.format), franchise: b.series || "", added: b.added || 0, year: +(b.published || "").slice(0, 4) || 0, progress: BC.percent ? BC.percent(b) : 0, left: null, offers: null });
    return out;
  }
  // a rule: { media: [], status: [], minRating, maxMins, maxHours, maxPages, ownedOnly, onMyServices, franchise, unrated, minProgress, sort }
  function applyRule(rule, rows = ruleRows()) {
    const r = rule || {}, svc = myServices().map(x => x.toLowerCase());
    let unknown = 0;
    let out = rows.filter(x => {
      if (r.media && r.media.length && !r.media.includes(x.media)) return false;
      if (r.status && r.status.length && !r.status.includes(x.status)) return false;
      if (r.minRating && x.rating < r.minRating) return false;
      if (r.unrated && x.rating) return false;
      if (r.maxMins && x.media === "movie" && !(x.mins && x.mins <= r.maxMins)) return false;
      if (r.maxHours && x.media === "game" && !(x.hours && x.hours <= r.maxHours)) return false;
      if (r.maxPages && x.media === "book" && !(x.pages && x.pages <= r.maxPages)) return false;
      if (r.ownedOnly && (x.media === "game" || x.media === "book") && !x.owned) return false;
      if (r.minProgress && !(x.progress >= r.minProgress || x.status === "paused")) return false;
      if (r.franchise && !x.franchise.toLowerCase().includes(String(r.franchise).toLowerCase())) return false;
      if (r.onMyServices) {
        if (x.media !== "movie" && x.media !== "show") return false;
        if (!x.offers) { unknown++; return false; }
        if (!x.offers.some(o => svc.some(s2 => o.toLowerCase().includes(s2)))) return false;
      }
      return true;
    });
    const by = { rating: (a, b) => b.rating - a.rating, title: (a, b) => a.title.localeCompare(b.title), added: (a, b) => b.added - a.added,
      short: (a, b) => ((a.mins || a.hours * 60 || a.pages) || 1e9) - ((b.mins || b.hours * 60 || b.pages) || 1e9), year: (a, b) => b.year - a.year, progress: (a, b) => b.progress - a.progress }[r.sort || "rating"];
    if (by) out.sort(by);
    if (r.nextCanon) out = nextCanonKeys().map(k => rows.find(x => x.k === k)).filter(Boolean);
    applyRule.unknown = unknown;
    return out.map(x => x.k);
  }
  // the earliest entry you haven't seen of each franchise you've started (films and series from the canon lists, games by franchise, books by series)
  function nextCanonKeys() {
    const out = [];
    try {
      const st = memo || [];
      const byF = new Map();
      for (const c of st) { const f = c.franchise; if (!f || f === "Unsorted") continue; const a = byF.get(f) || []; a.push(c); byF.set(f, a); }
      for (const [, list] of byF) {
        if (!list.some(c => c.state === "seen" || c.status === "seen")) continue;
        const next = list.filter(c => (c.state || c.status) !== "seen" && c.date && c.date <= TODAY()).sort((a, b) => String(a.date).localeCompare(String(b.date)))[0];
        if (!next) continue;
        const it = lib.all().find(x => (next.imdb && x.imdb === next.imdb) || L.norm(x.title) === L.norm(next.title));
        if (it) out.push("lib:" + it.id);
      }
    } catch (e) { /* the canon part needs the canon check */ }
    if (secOn("games")) {
      const byF = new Map();
      for (const g of games.visible()) { const f = g.franchise || g.multiverse; if (!f) continue; const a = byF.get(f) || []; a.push(g); byF.set(f, a); }
      for (const [, list] of byF) { if (!list.some(g => g.status === "done" || g.status === "playing")) continue; const n = list.filter(g => g.status === "backlog" || g.status === "wishlist").sort((a, b) => String(a.date || "9").localeCompare(String(b.date || "9")))[0]; if (n) out.push("game:" + n.id); }
    }
    if (secOn("books")) {
      const byS = new Map();
      for (const b of books.books) { if (!b.series) continue; const a = byS.get(b.series) || []; a.push(b); byS.set(b.series, a); }
      for (const [, list] of byS) { if (!list.some(b => b.status === "read" || b.status === "reading")) continue; const n = list.filter(b => b.status === "want").sort((a, b) => (a.seriesNum || 999) - (b.seriesNum || 999))[0]; if (n) out.push("book:" + n.id); }
    }
    return out;
  }
  const RULE_PRESETS = [
    ["Short & owned backlog", { media: ["game", "book"], status: ["want"], maxHours: 12, maxPages: 250, ownedOnly: true, sort: "short" }],
    ["Streaming now on my services", { media: ["movie", "show"], status: ["want"], onMyServices: true, sort: "rating" }],
    ["Next canon entries", { nextCanon: true }],
    ["Paused & almost done", { media: ["show", "book", "game"], status: ["doing", "paused"], minProgress: 70, sort: "progress" }],
    ["All-time favourites (9–10)", { minRating: 9, status: ["done", "doing", "paused"], sort: "rating" }],
  ];
  function listItems(id) {
    const sm = SMART.find(x => x[0] === id), l = sm ? null : myLists().find(x => x.id === id);
    const keys = sm ? sm[2]() : l && l.rule ? applyRule(l.rule) : ((l || {}).items || []);
    return keys.map(entryOf).filter(Boolean);
  }
  function listsSection() {
    const mine = myLists(), smart = SMART.map(([id, name]) => ({ id, name, n: listItems(id).length, smart: true })).filter(x => x.n);
    const all = [...mine.map(l => ({ id: l.id, name: l.name, n: listItems(l.id).length })), ...smart];
    if (!all.length) return "";
    return `<section>${Kit.head("Your lists", `<button class="btn quiet small" data-action="mlistnew">New list</button><button class="btn quiet small" data-action="mrulenew">Smart list</button>`)}${Kit.rail(all.map(l => `<button class="poster wide" data-action="mlistopen" data-l="${esc(l.id)}" style="text-align:left"><span class="gen" style="--h:${Kit.hue(l.name)}"><b>${esc(l.name)}</b><small>${fmt(l.n)} ${l.n === 1 ? "entry" : "entries"}${l.smart ? " · fills itself" : ""}</small></span></button>`))}</section>`;
  }
  function openMyList(id) {
    const sm = SMART.find(x => x[0] === id), l = sm ? null : myLists().find(x => x.id === id);
    if (!sm && !l) return;
    const items = listItems(id);
    const unk = l && l.rule && l.rule.onMyServices ? applyRule.unknown : 0;
    sheet(`<h3>${esc(sm ? sm[1] : l.name)}</h3><p class="small muted">${fmt(items.length)} ${items.length === 1 ? "entry" : "entries"}${sm || (l && l.rule) ? ". This list fills itself from your library by its rules." : ""}${unk ? ` ${fmt(unk)} titles have no streaming details yet (open them, or Settings › Fill in details) and aren't counted.` : ""}</p>
      ${l && l.rule ? `<button class="btn small" style="margin-bottom:10px" data-action="mrule" data-l="${esc(id)}">${icon("edit")}Edit rules</button>` : ""}
      ${items.length ? Kit.grid(items.slice(0, ui.listLim || 120).map(x => Kit.tile({ title: x.title, img: x.img, kind: x.kind, attrs: x.attrs }, x.year ? String(x.year) : ""))) + (items.length > (ui.listLim || 120) ? `<button class="btn block" data-action="mlistmore" data-l="${esc(id)}">Show more</button>` : "") : `<p class="muted">${l && l.rule ? "Nothing matches these rules right now." : "Empty. Open a film, series, game or book and tap Add to a list."}</p>`}
      ${l ? `<div style="margin-top:12px"><button class="sheetbtn" data-action="mlistcsv" data-l="${esc(id)}">${icon("open")}Save as a CSV file</button><button class="sheetbtn" data-action="mlistrename" data-l="${esc(id)}">${icon("edit")}Rename</button><button class="sheetbtn" data-action="mlistdel" data-l="${esc(id)}">${icon("notcanon")}<span>Delete this list</span></button></div>` : ""}`);
  }
  function ruleSheet(l) {
    const r = (l && l.rule) || { media: [], status: ["want"], sort: "rating" }, has = (a, x) => (a || []).includes(x);
    const chk = (attr, val, label, a) => `<label class="chip" style="cursor:pointer"><input type="checkbox" ${attr} value="${val}" ${has(a, val) ? "checked" : ""} style="margin-right:6px">${label}</label>`;
    const n = (id2, label, val, ph) => `<label class="field"><span>${label}</span><input id="${id2}" type="number" inputmode="decimal" min="0" value="${val || ""}" placeholder="${ph || "any"}"></label>`;
    sheet(`<h3>${l ? "Edit smart list" : "New smart list"}</h3>
      ${l ? "" : `<p class="small muted" style="margin:0 0 6px">Start from one of these, or set your own rules below.</p><div class="chips" style="margin-bottom:10px">${RULE_PRESETS.map((p, i) => `<button class="chip" data-action="mrulepreset" data-i="${i}">${esc(p[0])}</button>`).join("")}</div>`}
      <label class="field"><span>Name</span><input id="mr_name" maxlength="60" value="${esc(l ? l.name : "")}" placeholder="e.g. Short films for tonight"></label>
      <div class="kicker" style="margin:10px 0 4px">What (none ticked = everything)</div><div class="chips">${[["movie", "Films"], ["show", "Series"], ["game", "Games"], ["book", "Books"]].map(([v2, t]) => chk("data-mrm", v2, t, r.media)).join("")}</div>
      <div class="kicker" style="margin:10px 0 4px">Status (none ticked = any)</div><div class="chips">${[["want", "To watch / play / read"], ["doing", "In progress"], ["paused", "Paused"], ["done", "Finished"], ["dropped", "Dropped"]].map(([v2, t]) => chk("data-mrs", v2, t, r.status)).join("")}</div>
      ${n("mr_rating", "Your rating at least (1–10)", r.minRating)}${n("mr_mins", "Films no longer than (minutes)", r.maxMins)}${n("mr_hours", "Games no longer than (hours to beat)", r.maxHours)}${n("mr_pages", "Books no longer than (pages)", r.maxPages)}${n("mr_prog", "At least this far along (%; paused always counts)", r.minProgress)}
      <label class="field"><span>Franchise, multiverse or book series contains</span><input id="mr_fr" value="${esc(r.franchise || "")}" placeholder="any"></label>
      <label class="switch"><input type="checkbox" id="mr_owned" ${r.ownedOnly ? "checked" : ""}><span>Only games and books you own</span></label>
      <label class="switch"><input type="checkbox" id="mr_svc" ${r.onMyServices ? "checked" : ""}><span>Only films and series on my streaming services<small class="muted" style="display:block">${esc(myServices().join(", "))} (Settings)</small></span></label>
      <label class="switch"><input type="checkbox" id="mr_unrated" ${r.unrated ? "checked" : ""}><span>Only things you haven't rated</span></label>
      <label class="field"><span>Order</span><select id="mr_sort">${[["rating", "Your rating"], ["short", "Shortest first"], ["progress", "Furthest along"], ["added", "Recently added"], ["year", "Newest"], ["title", "Title"]].map(([v2, t]) => `<option value="${v2}" ${r.sort === v2 ? "selected" : ""}>${t}</option>`).join("")}</select></label>
      <button class="btn primary block" style="margin-top:10px" data-action="mrulesave" data-l="${esc(l ? l.id : "")}">Save</button>`);
  }
  function bulkListSheet(ids) {
    ui.bulkIds = ids;
    const mine = myLists().filter(l => !l.rule);
    sheet(`<h3>Add ${fmt(ids.length)} titles to a list</h3>${mine.map(l => `<button class="sheetbtn" data-action="bulklistput" data-l="${esc(l.id)}">${icon("plus")}${esc(l.name)} <span class="muted small">(${l.items.length})</span></button>`).join("") || `<p class="muted">No lists yet: make one from Home › Your lists › New list.</p>`}`);
  }
  function addToListSheet(k) {
    const mine = myLists().filter(l => !l.rule), e = entryOf(k);
    if (!e) return;
    sheet(`<h3>Add ${esc(e.title)} to a list</h3>
      ${mine.map(l => `<button class="sheetbtn" data-action="mlistput" data-l="${esc(l.id)}" data-k="${esc(k)}" aria-pressed="${l.items.includes(k)}">${icon(l.items.includes(k) ? "check" : "plus")}${esc(l.name)} <span class="muted small">(${l.items.length})</span></button>`).join("") || `<p class="muted small">No lists yet.</p>`}
      <label class="field" style="margin-top:10px"><span>New list</span><input id="mlistname" placeholder="e.g. Halloween, To watch with friends" maxlength="60"></label>
      <button class="btn" data-action="mlistnewadd" data-k="${esc(k)}">Create and add</button>`);
  }
  function myListAct(a, el) {
    const L2 = myLists(), l = L2.find(x => x.id === el.dataset.l);
    switch (a) {
      case "mlistopen": ui.listLim = 120; openMyList(el.dataset.l); return true;
      case "mlistmore": ui.listLim = (ui.listLim || 120) + 120; openMyList(el.dataset.l); return true;
      case "mrulenew": ruleSheet(null); return true;
      case "mrule": ruleSheet(l); return true;
      case "mrulepreset": { const p = RULE_PRESETS[+el.dataset.i]; if (!p) return true; const nl = { id: "l" + Date.now().toString(36), name: p[0], rule: JSON.parse(JSON.stringify(p[1])), items: [] };
        L2.push(nl); saveMyLists(L2); toast(`Smart list ${p[0]} added`); openMyList(nl.id); render(); return true; }
      case "mrulesave": {
        const v = id2 => document.getElementById(id2), on = sel => [...document.querySelectorAll(sel)].filter(x => x.checked).map(x => x.value);
        const num = id2 => { const n = parseFloat(((v(id2) || {}).value || "").replace(",", ".")); return Number.isFinite(n) && n > 0 ? n : 0; };
        const name = ((v("mr_name") || {}).value || "").trim() || "My smart list";
        const rule = { media: on("[data-mrm]"), status: on("[data-mrs]"), minRating: num("mr_rating"), maxMins: num("mr_mins"), maxHours: num("mr_hours"), maxPages: num("mr_pages"),
          minProgress: num("mr_prog"), ownedOnly: !!(v("mr_owned") || {}).checked, onMyServices: !!(v("mr_svc") || {}).checked, unrated: !!(v("mr_unrated") || {}).checked,
          franchise: ((v("mr_fr") || {}).value || "").trim(), sort: (v("mr_sort") || {}).value || "rating" };
        let target = l;
        if (target) { target.name = name; target.rule = rule; } else { target = { id: "l" + Date.now().toString(36), name, rule, items: [] }; L2.push(target); }
        saveMyLists(L2); openMyList(target.id); render(); return true; }
      case "mlistadd": addToListSheet(el.dataset.k); return true;
      case "mlistput": if (l) { const k = el.dataset.k, i = l.items.indexOf(k); if (i >= 0) l.items.splice(i, 1); else l.items.push(k); saveMyLists(L2); toast(i >= 0 ? `Removed from ${l.name}` : `Added to ${l.name}`); addToListSheet(k); } return true;
      case "mlistnewadd": case "mlistnew": {
        const inp = $("#mlistname"), name = ((inp && inp.value) || "").trim();
        if (a === "mlistnew") { sheet(`<h3>New list</h3><label class="field"><span>Name</span><input id="mlistname" maxlength="60" placeholder="e.g. Comfort watches"></label><button class="btn" data-action="mlistnewadd" data-k="">Create</button><p class="small muted" style="margin-top:14px">Or a list that fills itself by rules:</p><button class="btn" data-action="mrulenew">New smart list</button>`); return true; }
        if (!name) { toast("Give the list a name"); return true; }
        const nl = { id: "l" + Date.now().toString(36), name, items: el.dataset.k ? [el.dataset.k] : [] };
        L2.push(nl); saveMyLists(L2); toast(`List ${name} created`);
        if (el.dataset.k) addToListSheet(el.dataset.k); else { closeOverlay(); render(); }
        return true; }
      case "mlistrename": if (l) { sheet(`<h3>Rename</h3><label class="field"><span>Name</span><input id="mlistname" maxlength="60" value="${esc(l.name)}"></label><button class="btn" data-action="mlistrenamesave" data-l="${esc(l.id)}">Save</button>`); } return true;
      case "mlistrenamesave": if (l) { const v = (($("#mlistname") || {}).value || "").trim(); if (v) { l.name = v; saveMyLists(L2); } openMyList(l.id); render(); } return true;
      case "mlistdel": if (l) { if (el.dataset.sure) { saveMyLists(L2.filter(x => x !== l)); closeOverlay(); toast(`Deleted ${l.name}`); render(); } else { el.dataset.sure = "1"; el.lastChild.textContent = "Tap again to delete"; } } return true;
      case "mlistcsv": if (l) { const q = v => `"${String(v == null ? "" : v).replace(/"/g, '""')}"`;
        const rows = [["Title", "Year", "Type", "IMDb ID"].join(",")].concat((l.rule ? listItems(l.id).map(e => e.k) : l.items).map(k => { const [kind, ...r] = k.split(":"), id = r.join(":"); const it = kind === "lib" ? lib.get(id) : kind === "game" ? games.get(id) : books.get(id); if (!it) return null;
          return [q(it.title), q(it.year || (it.date || "").slice(0, 4)), q(kind === "lib" ? (it.type === "show" ? "Series" : "Film") : kind === "game" ? "Game" : "Book"), q(it.imdb || "")].join(","); }).filter(Boolean));
        Native.saveAs(`${l.name.replace(/[^\w ]+/g, "").trim() || "list"}.csv`, rows.join("\n") + "\n").then(ok => toast(ok ? "Saved" : "Not saved")); } return true;
    }
    return false;
  }

  function sheet(html, cls, id) {
    const open = document.querySelector("#overlay .sheet");
    if (open && cls && open.dataset.cls === cls && open.dataset.id === String(id || "")) { const top = open.scrollTop; open.innerHTML = html; open.scrollTop = top; if (window.BantaI18n && BantaI18n.isOn()) BantaI18n.walk(open); return; }
    $("#overlay").innerHTML = `<div class="scrim bottom" data-action="dismiss"><div class="sheet ${esc(cls || "")}" data-cls="${esc(cls || "")}" data-id="${esc(id || "")}" role="dialog" aria-modal="true">${html}</div></div>`;
  }
  // 0.6.1: where you were, so Back returns there (not straight to Home)
  const backStack = [];
  function go(sec, tab, fromBack) {
    if (!fromBack) { const cur = { sec: ui.sec, tab: ui.tab, y: window.scrollY }; const top = backStack[backStack.length - 1]; if (cur.sec && !(top && top.sec === cur.sec && top.tab === cur.tab)) { backStack.push(cur); if (backStack.length > 30) backStack.shift(); } }
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
  function render() { inRender = true; try { return render0(); } finally { inRender = false; } }
  function render0() {
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
      if (x.lib) out.push({ ord: x.last || "", html: tickable(Kit.tile({ title: x.it.title, img: x.it.poster, kind: "show", badge: `S${x.s} E${x.e}`, badgeAcc: true, progress: progressOf(x.it), attrs: `data-action="libopen" data-id="${esc(x.it.id)}"` }, x.it.title, x.left > 1 ? `${x.left} to watch` : "Next episode"), x) });
      else out.push({ ord: x.last || "", html: Kit.tile({ title: x.show, img: x.poster ? IMG + "w342" + x.poster : "", kind: "show", badge: `S${x.s} E${x.e}`, badgeAcc: true, attrs: `data-action="sheet" data-sid="${sid(x, "up")}"` }, x.show, "On Trakt") });
    }
    if (secOn("books")) for (const b of books.books.filter(b => b.status === "reading")) out.push({ ord: BC.isoDay ? BC.isoDay(Math.max(b.started || 0, ...(b.log || []).map(l => l.t))) : "", html: Kit.tile({ title: b.title, img: (b.cover || "").replace(/^http:/, "https:"), kind: "book", badge: `${BC.percent(b)}%`, badgeAcc: true, progress: BC.percent(b) / 100, attrs: `data-action="bopen" data-id="${esc(b.id)}"` }, b.title, b.authors[0] || "") });
    if (secOn("games")) for (const g of games.nextUp(6)) out.push({ ord: g.status === "playing" ? "~" : "", html: Kit.mods.games.tileOf(g, games.whyNext(g)) });
    if (secOn("timeline")) { const n = Kit.mods.timeline.next(); if (n) out.push({ ord: "", html: Kit.tile({ title: n.title, kind: "story", badge: n.era, attrs: `data-action="tlhome" data-k="${esc(n.k)}"` }, n.title, `Doctor Who · ${n.era}`) }); }
    return out.sort((a, b) => String(b.ord).localeCompare(String(a.ord))).map(x => x.html);
  }
  // 0.6.1: a Watched button on the poster, so the next episode is ticked without opening the series
  const tickable = (html, x) => html.replace(/<\/div>$/, `<button class="tilecheck" data-action="libnext" data-id="${esc(x.it.id)}" data-s="${x.s}" data-e="${x.e}" aria-label="Mark S${x.s} E${x.e} of ${esc(x.it.title)} watched">${icon("check")}</button></div>`);
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
  // ---- 0.6.5: suggestions from your ratings ("For you" on Home). Worked out after a sync, at most once a day.
  const recsHidden = () => { try { return new Set(JSON.parse(db.get("recs_hide", "[]"))); } catch (e) { return new Set(); } };
  const recsNow = () => { const r = db.cacheGet("recs:now"); return r && r.items ? r : null; };
  async function recsRefresh(loud) {
    if (!db.get("tmdb_key") || (!loud && recsNow() && Date.now() - recsNow().at < 20 * 3600e3)) return;
    const seeds = lib.all().filter(it => it.rating >= 8 && (it.type === "movie" || it.type === "show"))
      .sort((a, b) => String(b.ratedAt || b.watches[b.watches.length - 1] || "").localeCompare(String(a.ratedAt || a.watches[a.watches.length - 1] || "")) || b.rating - a.rating)
      .slice(0, 12).map(it => ({ title: it.title, year: it.year, type: it.type, tmdb: it.tmdb, imdb: it.imdb, rating: it.rating }));
    if (!seeds.length) { if (loud) toast("Rate a few films or series 8 or more first"); return; }
    const hid = recsHidden();
    try {
      const items = await C.recommend(db, Native.http, seeds, x => hid.has(x.type + x.tmdb) || !!lib.find({ type: x.type, tmdb: x.tmdb, title: x.title, year: x.year }));
      db.cacheSet("recs:now", { at: Date.now(), items });
      if (loud) toast(`${items.length} suggestions`); render();
    } catch (e) { if (loud) toast(e.message); }
  }
  function recsHtml() {
    const R = recsNow(); if (!R) return "";
    const hid = recsHidden(), f = ui.recF || "all";
    let items = R.items.filter(x => !hid.has(x.type + x.tmdb) && !lib.find({ type: x.type, tmdb: x.tmdb, title: x.title, year: x.year }));
    if (!items.length) return "";
    const genres = Object.entries(items.reduce((m, x) => { for (const g of x.genres.slice(0, 2)) m[g] = (m[g] || 0) + 1; return m; }, {})).sort((a, b) => b[1] - a[1]).slice(0, 5).map(x => x[0]);
    items = items.filter(x => f === "all" || (f === "movie" || f === "show" ? x.type === f : x.genres.includes(f))).slice(0, 10);
    const chip = (k, l) => `<button class="chip ${f === k ? "on" : ""}" data-action="recf" data-v="${esc(k)}">${esc(l)}</button>`;
    return `<section>${Kit.head("For you", `<button class="btn quiet small" data-action="recsnow">Refresh</button>`)}
      <div class="chips" style="margin-bottom:8px">${chip("all", "All")}${chip("movie", "Films")}${chip("show", "Series")}${genres.map(g => chip(g, g)).join("")}</div>
      <div class="listcard">${items.map(x => `<div class="item" data-action="recopen" data-k="${esc(x.type + x.tmdb)}" role="button"><img class="thumb" loading="lazy" src="${esc(x.poster)}" alt="" data-fb="ph" data-fbc="thumb ph ${x.type === "show" ? "series" : "movie"}" data-fbt="${esc(initials(x.title))}">
        <div class="grow" style="min-width:0"><b class="ell">${esc(x.title)}</b><div class="small muted ell">${esc([x.year, x.type === "show" ? "Series" : "Film", x.genres.slice(0, 2).join(", "), x.vote ? "★ " + x.vote.toFixed(1) : ""].filter(Boolean).join(" · "))}</div>
        <div class="small muted ell">Because you rated ${esc(x.because.join(", "))}</div></div>
        <button class="btn quiet small" data-action="recadd" data-k="${esc(x.type + x.tmdb)}">${icon("plus")}Add</button><button class="iconbtn" data-action="rechide" data-k="${esc(x.type + x.tmdb)}" aria-label="Not interested">${icon("x")}</button></div>`).join("") || `<p class="small muted" style="padding:8px">Nothing in this group.</p>`}</div></section>`;
  }
  // 0.6.5: first steps on a fresh install (the Starter build), each ticked when done
  function startHtml() {
    const steps = [
      ["features", "Pick your tabs", "Films and series, Games, Books, Doctor Who: switch off what you don't use.", db.get("features_seen") === "1"],
      ["accounts", "Add a TMDB key", "Free from themoviedb.org: posters, details, new seasons, suggestions.", !!db.get("tmdb_key")],
      ["accounts", "Connect Trakt or IMDb", "Brings your ratings, watchlist and history; a rating counts as watched.", !!(db.get("username") || db.get("imdb_user"))],
      ["accounts", "Your Saga website", "The address and sync key you were given: your data on your phone and the web, and friends.", !!db.get("web_sync_url")],
      ["importhub", "Import from other apps", "Letterboxd, Goodreads, HowLongToBeat, Steam, MyAnimeList, a games spreadsheet…", !!db.get("hub_last")],
    ];
    const done = steps.filter(x => x[3]).length;
    return `<section>${Kit.head(`Get started · ${done} of ${steps.length}`)}<div class="listcard">${steps.map(([k, t, d, ok]) => `<div class="item" data-action="go" data-sec="settings" data-scroll="${k}" role="button">
      <span class="tilecheck" style="position:static;${ok ? "" : "opacity:.35"}" aria-label="${ok ? "Done" : "To do"}">${icon(ok ? "check" : "chev")}</span><div class="grow"><b>${esc(t)}</b><div class="small muted">${esc(d)}</div></div></div>`).join("")}</div></section>`;
  }
  function renderHome() {
    const st = status(), parts = [];
    // 0.5.8: a line when the last sync failed in part or is old, with the way to it
    { const nv = db.get("upd_ver", ""); if (nv && verNum(nv) > verNum(VERSION) && db.get("upd_hide") !== nv) parts.push(`<div class="nextbox" style="margin-bottom:12px"><div class="grow small"><b>Saga ${esc(nv)} is out</b> (this ${window.__sagaWeb ? "website" : "app"} has ${VERSION}). ${window.__sagaWeb ? "To update the website, on the Pi run <code>bash /opt/saga/app/site/update.sh</code>, or let it update itself every night: <code>bash /opt/saga/app/site/auto-update.sh on</code>."
        : updateUrl() ? "Get it from your Saga website; your data stays." : "Ask whoever gave you Saga for the new version; your data stays."}</div>${!window.__sagaWeb && updateUrl() ? `<button class="btn small" data-action="updget">Get it</button>` : ""}<button class="iconbtn" data-action="updhide" aria-label="Hide">${icon("x")}</button></div>`); }
    { const sick = C.sourceHealth(db);
      if (!ui.job && sick.length) parts.push(`<div class="nextbox warnbox" style="margin-bottom:12px" data-action="go" data-sec="sync" role="button"><div class="grow small"><b>${esc(healthText(sick[0]))}</b>${sick.length > 1 ? ` · and ${sick.length - 1} more` : ""}<div class="muted ell">${esc(sick[0].msg)}</div></div><span class="small">Fix ›</span></div>`); }
    { const last = parseFloat(db.get("last_sync", "0")) || 0, fails = failedLabels(), h = last ? (Date.now() / 1000 - last) / 3600 : null;
      if (!ui.job && (db.get("username") || db.get("imdb_user")) && (fails.length || h == null || h > 48))
        parts.push(`<div class="nextbox" style="margin-bottom:12px" data-action="go" data-sec="sync"><div class="grow small">${h == null ? "Not synced yet" : `Last sync ${h > 48 ? `${Math.round(h / 24)} days ago` : `${Math.max(1, Math.round(h))} h ago`}`}${fails.length ? ` · ${fails.length} part${fails.length === 1 ? "" : "s"} failed: ${esc(fails.slice(0, 3).join(", "))}` : ""}</div><span class="small">Open ›</span></div>`); }
    const empty = !lib.all().length && !st.length && !games.games.length && !books.books.length;
    if (empty) {
      return `<section class="hero2"><div class="bg gen" style="--h:32"></div><div class="in"><div class="kicker">Welcome</div><h1>Everything you watch, play and read</h1>
        <p>Search and add films, series, games and books, tick episodes as you go, log every rewatch with its date, and find the gaps in your franchises.</p>
        <div class="row wrap"><button class="btn primary" data-action="go" data-sec="library">${icon("missing")}Search and add</button>
        <button class="btn" data-action="go" data-sec="settings" data-scroll="importhub">${icon("upload")}Import</button>
        <button class="btn" data-action="go" data-sec="settings" data-scroll="accounts">${icon("sync")}Connect Trakt / IMDb</button></div></div></section>${startHtml()}`;
    }
    const h = homeHero();
    if (h) parts.push(`<section class="hero2"><div class="bg${h.img ? "" : " gen"}" style="${h.img ? `background-image:url('${esc(h.img)}')` : `--h:${Kit.hue(h.title)}`}"></div>
      ${h.img ? `<img class="side" src="${esc(httpsUrl(h.img))}" alt="" data-fb="rm">` : ""}<div class="in"><div class="kicker">${esc(h.kicker)}</div><h1>${esc(h.title)}</h1><p>${esc(h.text)}</p><div class="row wrap">${h.btns}</div></div></section>`);
    const cont = homeContinue();
    if (cont.length) parts.push(`<section>${Kit.head("Continue")}${Kit.rail(cont)}</section>`);
    const rec = recentAll(16);
    { const fy = recsHtml(); if (fy) parts.push(fy); }
    { const ib = inboxHtml(); if (ib) parts.push(ib); }
    { const fr = friendsHtml(); if (fr) parts.push(fr); }
    if (rec.length) parts.push(`<section>${Kit.head("Recently watched, played and read", `<button class="btn quiet small" data-action="recentall">Diary</button>`)}${Kit.rail(rec.map(recentTile))}</section>`);
    if (db.get("home_calendar", "1") === "1") {
      const soon = comingUp(14);
      if (soon.length) parts.push(`<section>${Kit.head("Coming up", `<button class="btn quiet small" data-action="go" data-sec="upcoming">Calendar</button>`)}${Kit.rail(soon.map(x => x.html))}</section>`);
    }
    { const ls = listsSection(); if (ls) parts.push(ls); }
    const nx = st.length ? C.upNext(st, 12) : [];
    const fy = forYou();
    if (lib.all().some(x => x.status === "watchlist")) parts.push(`<section><button class="btn" data-action="librandom">${icon("sync")}Pick something from my watchlist</button></section>`);
    { const pk = picksToday(); if (pk.length >= 3) parts.push(`<section>${Kit.head("Picks for today", `<button class="btn quiet small" data-action="pickedit">${ui.pickEdit ? "Done" : "Not for me…"}</button>`)}${ui.pickEdit
      ? `<div class="listcard">${pk.map(x => `<div class="item"><div class="grow" style="min-width:0"><b class="ell">${esc(x.t)}</b><div class="small muted ell">${esc(x.why)}</div></div>${[["seen", "Seen it"], ["long", "Too long"], ["mood", "Not now"], ["no", "Not for me"]].map(([r, l]) => `<button class="btn quiet small" data-action="pickhide" data-k="${esc(x.k)}" data-v="${r}">${l}</button>`).join("")}</div>`).join("")}</div>`
      : Kit.rail(pk.map(x => Kit.tile({ title: x.t, img: x.img, kind: x.kind, attrs: x.attrs }, x.t, esc(x.why))))}</section>`); }
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
    for (const it of lib.all()) if (it.type === "show" && it.status !== "dropped" && it.status !== "paused" && it.epl) {
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
  // ---- 0.5.8: Universe dashboard. Any franchise or multiverse: completion per medium, three orders (release,
  // in-universe, your own) and a tier per entry (essential … not canon), with "essential only" and "missing only".
  const TIERS = [["", "No tier"], ["essential", "Essential"], ["recommended", "Recommended"], ["optional", "Optional / spin-off"], ["alternate", "Alternate continuity"], ["notcanon", "Not canon"]];
  const TIER_SHORT = { essential: "Essential", recommended: "Recommended", optional: "Optional", alternate: "Alternate", notcanon: "Not canon" };
  const uKey = name => C.norm(name);
  const uGet = (k, name) => { try { return JSON.parse(db.get(`u_${k}:${uKey(name)}`, k === "order" ? "[]" : "{}")); } catch (e) { return k === "order" ? [] : {}; } };
  const uSet = (k, name, v) => db.set(`u_${k}:${uKey(name)}`, JSON.stringify(v));
  function universeEntries(name) {
    const n = uKey(name), out = [];
    const MED = c => c.medium === "TV Series" ? "show" : c.medium === "Video Game" ? "game" : "movie";
    for (const c of status()) if (C.norm(c.franchise) === n && MED(c) !== "game") out.push({ key: "canon:" + canonKey(c), title: c.title, medium: MED(c), date: c.date || (c.year ? c.year + "-07-01" : ""), done: !!c.have && c.state !== "listed",
      img: cImg(c), attrs: `data-action="sheet" data-sid="${sid(c, "canon")}"`, sub: [c.year, c.medium].filter(Boolean).join(" · "), canon: c });
    if (secOn("games")) for (const g of games.visible()) if (C.norm(g.multiverse) === n || C.norm(g.franchise) === n) out.push({ key: "game:" + g.id, title: g.title, medium: "game", date: g.date || "", done: g.status === "done",
      img: g.cover || (g.steam ? GC.COVER(g.steam) : ""), attrs: `data-action="gopen" data-id="${esc(g.id)}"`, sub: [G_YEAR(g), g.platform].filter(Boolean).join(" · ") });
    if (secOn("books")) for (const b of books.books) if (b.series && (C.norm(b.series).includes(n) || n.includes(C.norm(b.series)))) out.push({ key: "book:" + b.id, title: b.title, medium: "book", date: String(b.published || "").slice(0, 10), done: b.status === "read",
      img: (b.cover || "").replace(/^http:/, "https:"), attrs: `data-action="bopen" data-id="${esc(b.id)}"`, sub: [(b.authors || [])[0], b.seriesNum ? `#${b.seriesNum}` : ""].filter(Boolean).join(" · ") });
    return out;
  }
  const G_YEAR = g => (g.date || "").slice(0, 4);
  function universeOrdered(name, mode, list) {
    const byDate = (a, b) => String(a.date || "9999").localeCompare(String(b.date || "9999"));
    if (mode === "custom") {
      const ord = uGet("order", name), pos = new Map(ord.map((k, i) => [k, i]));
      return list.slice().sort((a, b) => (pos.has(a.key) ? pos.get(a.key) : 1e6) - (pos.has(b.key) ? pos.get(b.key) : 1e6) || byDate(a, b));
    }
    if (mode === "chrono") {
      let o = null; try { o = C.watchOrder(db, name, status(), "chrono"); } catch (e) { o = null; }
      if (o && o.chrono) {
        const pos = new Map(o.rows.map((c, i) => [canonKey(c), i]));
        const canon = list.filter(e => e.canon && pos.has(canonKey(e.canon))).sort((a, b) => pos.get(canonKey(a.canon)) - pos.get(canonKey(b.canon)));
        const rest = list.filter(e => !(e.canon && pos.has(canonKey(e.canon)))).sort(byDate);
        // games and books go after the last canon entry released before them
        const out = canon.slice();
        for (const e of rest) { let at = out.length; if (e.date) { let last = -1; out.forEach((x, i) => { if (x.date && x.date <= e.date) last = i; }); at = last + 1; } out.splice(at, 0, e); }
        return out;
      }
    }
    return list.slice().sort(byDate);
  }
  function renderMv() {
    const name = ui.mv || "", u = ui.u || (ui.u = { mode: "release", tier: "all", missing: false, edit: false });
    if (u.name !== name) Object.assign(u, { name, mode: uGet("order", name).length ? "custom" : "release", tier: "all", missing: false, edit: false });
    const tiers = uGet("tier", name), all = universeEntries(name);
    all.forEach(e => { e.tier = tiers[e.key] || ""; });
    const counted = all.filter(e => e.tier !== "notcanon");
    // completion per medium
    const MEDS = [["movie", "Films"], ["show", "Series"], ["game", "Games"], ["book", "Books"]];
    const bars = MEDS.map(([m, l]) => { const xs = counted.filter(e => e.medium === m); return xs.length ? { l, done: xs.filter(e => e.done).length, n: xs.length } : null; }).filter(Boolean);
    const ess = counted.filter(e => e.tier === "essential"), done = counted.filter(e => e.done).length;
    let list = universeOrdered(name, u.mode, all);
    if (u.tier === "essential") list = list.filter(e => e.tier === "essential");
    else if (u.tier === "core") list = list.filter(e => e.tier === "essential" || e.tier === "recommended");
    else if (u.tier === "canon") list = list.filter(e => e.tier !== "notcanon");
    if (u.missing) list = list.filter(e => !e.done);
    const next = universeOrdered(name, u.mode, counted).find(e => !e.done && (!ess.length || e.tier === "essential" || u.tier === "all"));
    const who = /doctor ?who|whoniverse/i.test(name) && secOn("timeline");
    const chip = (act, v, cur, label) => `<button class="chip" data-action="${act}" data-v="${v}" aria-pressed="${cur === v}">${label}</button>`;
    const rowHtml = (e, i) => `<div class="item" style="gap:10px"><span class="small muted" style="width:26px;text-align:right">${i + 1}</span>
      <div class="grow" ${e.attrs} style="min-width:0"><div class="row"><b class="grow ell">${esc(e.title)}</b>${e.done ? `<span class="pbadge">${icon("check")}</span>` : ""}</div>
        <div class="small muted ell">${esc({ movie: "Film", show: "Series", game: "Game", book: "Book" }[e.medium])}${e.sub ? " · " + esc(e.sub) : ""}${e.tier ? ` · <b>${esc(TIER_SHORT[e.tier])}</b>` : ""}</div></div>
      ${u.edit ? `<button class="btn quiet small" data-action="utier" data-k="${esc(e.key)}" aria-label="Change tier">${esc(e.tier ? TIER_SHORT[e.tier] : "Tier")}</button>
        <button class="iconbtn" data-action="umove" data-k="${esc(e.key)}" data-v="-1" aria-label="Move up">↑</button><button class="iconbtn" data-action="umove" data-k="${esc(e.key)}" data-v="1" aria-label="Move down">↓</button>` : ""}</div>`;
    return `<section><div class="kicker">Universe</div><h2 style="font-size:30px;margin:6px 0">${esc(name)}</h2>
      <p class="muted">${done} of ${counted.length} · ${Math.round(100 * done / Math.max(1, counted.length))}%${ess.length ? ` · essential: ${ess.filter(e => e.done).length} of ${ess.length}` : ""}</p>
      ${bars.length > 1 ? `<div class="card" style="margin:10px 0">${bars.map(b => `<div class="row small" style="gap:8px;margin:4px 0"><span style="width:56px">${b.l}</span><div class="grow" style="height:8px;border-radius:4px;background:var(--line);overflow:hidden"><i style="display:block;height:100%;width:${Math.round(100 * b.done / b.n)}%;background:var(--accent)"></i></div><span class="muted" style="width:64px;text-align:right">${b.done}/${b.n}</span></div>`).join("")}</div>` : ""}
      ${next ? `<div class="nextbox" style="margin:10px 0"><div class="grow" ${next.attrs}><div class="kicker">Next</div><b>${esc(next.title)}</b><div class="small muted">${esc(next.sub || "")}</div></div></div>` : ""}
      ${who ? `<button class="btn" data-action="go" data-sec="timeline">${icon("box")}Open the Doctor Who timeline</button>` : ""}
      <div class="chips" style="margin-top:10px">${chip("umode", "release", u.mode, "Release order")}${chip("umode", "chrono", u.mode, "In-universe order")}${chip("umode", "custom", u.mode, "My order")}</div>
      ${u.mode === "chrono" ? `<p class="small muted">In-universe order comes from the canon list's order (Watch order › Get the in-universe order); games and books are placed by release date.</p>` : ""}
      ${u.mode === "custom" ? `<p class="small muted">Tap Edit, then the arrows, to put entries in your own order.</p>` : ""}
      <div class="chips">${chip("utierf", "all", u.tier, "100% (everything)")}${chip("utierf", "canon", u.tier, "Without not-canon")}${chip("utierf", "core", u.tier, "Essential + recommended")}${chip("utierf", "essential", u.tier, "Essential only")}
        <button class="chip" data-action="umissing" aria-pressed="${u.missing}">Missing only</button><button class="chip" data-action="uedit" aria-pressed="${u.edit}">${icon("edit")}Edit tiers and order</button></div>
      <div class="row wrap" style="margin:10px 0 14px"><button class="btn small" data-action="order" data-mv="${esc(name)}">${icon("list")}Watch order</button><button class="btn small" data-action="mvshare" data-mv="${esc(name)}">${icon("upload")}Share this list</button></div>
      ${list.length ? `<div class="listcard">${list.slice(0, ui.uLim || 200).map(rowHtml).join("")}</div>${list.length > (ui.uLim || 200) ? `<button class="btn block" data-action="umore">Show more</button>` : ""}` : `<p class="muted">Nothing here with these filters.${u.tier !== "all" && !Object.keys(tiers).length ? " No tiers set yet: tap Edit tiers and order." : ""}</p>`}</section>`;
  }
  function universeAct(a, el) {
    const name = ui.mv || "", u = ui.u || {};
    switch (a) {
      case "umode": u.mode = el.dataset.v; if (u.mode === "custom" && !uGet("order", name).length) uSet("order", name, universeOrdered(name, "release", universeEntries(name)).map(e => e.key)); render(); return true;
      case "utierf": u.tier = el.dataset.v; render(); return true;
      case "umissing": u.missing = !u.missing; render(); return true;
      case "uedit": u.edit = !u.edit; render(); return true;
      case "umore": ui.uLim = (ui.uLim || 200) + 200; render(); return true;
      case "utier": { const t = uGet("tier", name), cur = t[el.dataset.k] || "", i = TIERS.findIndex(x => x[0] === cur), nx = TIERS[(i + 1) % TIERS.length][0];
        if (nx) t[el.dataset.k] = nx; else delete t[el.dataset.k]; uSet("tier", name, t); render(); return true; }
      case "umove": {
        let ord = uGet("order", name); const list = universeOrdered(name, u.mode === "custom" ? "custom" : u.mode, universeEntries(name)).map(e => e.key);
        if (u.mode !== "custom" || !ord.length) ord = list; else { const have = new Set(ord); for (const k of list) if (!have.has(k)) ord.push(k); }
        const i = ord.indexOf(el.dataset.k), j = i + (+el.dataset.v);
        if (i >= 0 && j >= 0 && j < ord.length) { [ord[i], ord[j]] = [ord[j], ord[i]]; uSet("order", name, ord); u.mode = "custom"; }
        render(); return true; }
    }
    return false;
  }

  // ---- your year: films, episodes, games, books and stories, by month
  // ---- activity history: one dated list across films, series, games, books and Doctor Who (activity.js)
  function activity() {
    return Activity.build({ library: lib, games: secOn("games") ? games : null, books: secOn("books") ? books : null, readsOf: BC.readsOf, gameCover: GC.COVER,
      stories: secOn("timeline") ? Kit.mods.timeline.recent(99999) : null });
  }
  const openAttrs = e => e.app === "watch" ? `data-action="libopen" data-id="${esc(e.id)}"` : e.app === "games" ? `data-action="gopen" data-id="${esc(e.id)}"` : e.app === "books" ? `data-action="bopen" data-id="${esc(e.id)}"` : "";
  function yearCounts(year) {
    const c = Activity.year(activity(), year);
    c.top = c.top.map(e => ({ t: e.t, r: e.rating, img: e.img, act: openAttrs(e), kind: e.app === "watch" ? (e.kind === "episode" ? "show" : "movie") : e.app === "games" ? "game" : "book" }));
    return c;
  }
  // Diary: everything, newest first, by month; a day's episodes of one series on one line
  const DIARY_KINDS = [["all", "All"], ["film", "Films"], ["episode", "Episodes"], ["game", "Games finished"], ["session", "Play sessions"], ["book", "Books finished"], ["reading", "Reading"], ["story", "Doctor Who"]];
  function openDiary() {
    const f = ui.diaryF || "all", n = ui.diaryN || 200;
    const all = activity().filter(e => !e.bulk);
    const ev = Activity.grouped(all.filter(e => f === "all" || e.kind === f || (f === "film" && e.kind === "rewatch")));
    const MONTH = d => new Date(d.slice(0, 7) + "-15T12:00:00").toLocaleDateString(lang() === "it" ? "it-IT" : "en-GB", { month: "long", year: "numeric" });
    const ic = e => e.app === "games" ? "pad" : e.app === "books" ? "book" : e.app === "watch" ? "eye" : "check";
    let html = "", cur = "";
    for (const e of ev.slice(0, n)) {
      const mk = e.d.slice(0, 7);
      if (mk !== cur) { cur = mk; html += `<div class="kicker" style="margin:16px 0 6px">${esc(MONTH(e.d))}</div>`; }
      const what = e.kind === "rewatch" ? "Rewatched" : e.kind === "film" ? "Film" : e.kind === "episode" ? "Episode" : e.kind === "game" ? "Game" : e.kind === "session" ? "Played" : e.kind === "reading" ? "Read" : e.kind === "book" ? "Book" : "Story";
      html += `<div class="item" ${openAttrs(e)}><span class="xic ${e.app === "games" ? "games" : e.app === "books" ? "books" : "canon"}">${icon(ic(e))}</span>
        <div class="grow"><div class="row"><b class="grow ell">${esc(e.t)}</b><span class="small muted">${esc(shortDay(e.d))}</span></div><div class="small muted ell">${esc(what)}${e.sub ? " · " + esc(e.sub) : ""}${e.rating ? ` · ★ ${e.rating / 2}` : ""}</div></div></div>`;
    }
    const bulk = activity().filter(e => e.bulk).length;
    sheet(`<h3 style="font:800 24px/1.1 var(--display);margin:4px 0 6px">Diary</h3>
      <p class="small muted" style="margin:0 0 10px">${fmt(all.length)} things watched, played and read, newest first${bulk ? `. ${fmt(bulk)} episodes ticked in bulk without a date aren't listed` : ""}.</p>
      <div class="chips">${DIARY_KINDS.map(([k, l]) => `<button class="chip" data-action="diaryf" data-v="${k}" aria-pressed="${f === k}">${l}</button>`).join("")}</div>
      ${html || '<p class="muted">Nothing here yet.</p>'}
      ${ev.length > n ? `<button class="btn block" style="margin-top:12px" data-action="diarymore">Show more (${fmt(ev.length - n)} left)</button>` : ""}`);
  }
  // ---- Year in review: the year in one card you can share as text (0.5.8)
  function wrappedData(y) {
    const ev = activity().filter(e => !e.bulk && e.d.startsWith(String(y)));
    const c = yearCounts(y);
    const readHours = Math.round((c.readPages / 40 + c.readChapters / 3) * 10) / 10; // estimate: 40 pages or 3 manga chapters an hour
    const playHours = c.playedHours || c.gameHours;
    // franchises: films and series through the canon lists, games by franchise, books by series
    const fr = new Map(), add = (k, w) => { if (k) fr.set(k, (fr.get(k) || 0) + w); };
    let canonBy = new Map();
    try { for (const r of (memo || [])) { if (r.imdb) canonBy.set(r.imdb, r.franchise); canonBy.set("n:" + C.norm(r.title), r.franchise); } } catch (e) { canonBy = new Map(); }
    for (const e of ev) {
      if (e.app === "watch") { const it = lib.get(e.id); if (it) add(canonBy.get(it.imdb) || canonBy.get("n:" + C.norm(it.title)), e.kind === "episode" ? 0.25 : 1); }
      else if (e.app === "games") { const g = games.get(e.id); if (g) add(g.franchise, e.kind === "session" ? 0.25 : 2); }
      else if (e.app === "books") { const b = books.get(e.id); if (b) add(b.series, e.kind === "reading" ? 0.25 : 1); }
      else if (e.app === "dw") add("Doctor Who", 0.5);
    }
    const franchises = [...fr.entries()].filter(([k]) => k && k !== "Unsorted").sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k]) => k);
    // the longest run of days with something watched, played or read
    const days = [...new Set(ev.map(e => e.d))].sort();
    let best = 0, run = 0, prev = null;
    for (const d of days) { run = prev && (Date.parse(d) - Date.parse(prev)) === 864e5 ? run + 1 : 1; best = Math.max(best, run); prev = d; }
    const busiest = c.months.indexOf(Math.max(...c.months));
    const finishedShows = lib.all().filter(it => it.type === "show" && it.status === "watched" && Object.values(it.eps || {}).some(d => String(d).startsWith(String(y)))).length;
    const miles = [c.films >= 50 ? `${c.films} films` : "", c.episodes >= 500 ? `${fmt(c.episodes)} episodes` : "", finishedShows ? `${finishedShows} series finished` : "",
      c.books ? `${c.books} book${c.books === 1 ? "" : "s"} finished` : "", c.games ? `${c.games} game${c.games === 1 ? "" : "s"} finished` : "", best >= 7 ? `${best} days in a row` : ""].filter(Boolean);
    return { y, c, total: Math.round(c.hours + playHours + readHours), watch: c.hours, play: playHours, read: readHours, franchises, best, busiest, miles, top: c.top.slice(0, 5), estPlay: !c.playedHours && c.gameHours > 0 };
  }
  const MONTHS_EN = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  function wrappedText(w) {
    return [`My ${w.y} in Saga`, `${fmt(w.total)} hours of stories: ${fmt(w.watch)} watching, ${fmt(w.play)} playing, ${fmt(w.read)} reading`,
      `${fmt(w.c.films)} films · ${fmt(w.c.episodes)} episodes · ${fmt(w.c.games)} games · ${fmt(w.c.books)} books${w.c.stories ? ` · ${fmt(w.c.stories)} Doctor Who stories` : ""}`,
      w.top.length ? `Favourites: ${w.top.map(x => `${x.t} (★${x.r / 2})`).join(", ")}` : "", w.franchises.length ? `Most explored: ${w.franchises.join(", ")}` : "",
      w.c.months.some(Boolean) ? `Busiest month: ${MONTHS_EN[w.busiest]}` : "", w.miles.length ? `Milestones: ${w.miles.join(" · ")}` : ""].filter(Boolean).join("\n");
  }
  async function openWrapped() {
    const y = ui.year || new Date().getFullYear();
    try { await statusSoon(); } catch (e) { /* franchises from games and books only */ }
    const w = wrappedData(y), max = Math.max(1, ...w.c.months);
    const MON = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];
    sheet(`<div class="wrapped"><div class="kicker">Year in review</div><h3 style="font:800 34px/1 var(--display);margin:4px 0 14px">${y}</h3>
      <div class="bigstat">${fmt(w.total)} h</div><div class="muted" style="margin-bottom:14px">${fmt(w.watch)} h watching · ${fmt(w.play)} h playing${w.estPlay ? " (time to beat; log sessions for real time)" : ""} · ${fmt(w.read)} h reading (estimated)</div>
      <div class="stat3"><div><b>${fmt(w.c.films)}</b><span>films</span></div><div><b>${fmt(w.c.episodes)}</b><span>episodes</span></div><div><b>${fmt(w.c.games)}</b><span>games</span></div><div><b>${fmt(w.c.books)}</b><span>books</span></div><div><b>${fmt(w.c.stories)}</b><span>Doctor Who</span></div><div><b>${fmt(w.best)}</b><span>days in a row</span></div></div>
      <section class="card" style="margin-top:14px"><div class="kicker" style="margin-bottom:10px">Month by month${w.c.months.some(Boolean) ? ` · busiest: ${MONTHS_EN[w.busiest]}` : ""}</div><div class="months">${w.c.months.map(n => `<i style="height:${Math.round(n / max * 100)}%" title="${n}"></i>`).join("")}</div><div class="months" style="height:auto">${MON.map(m => `<span>${m}</span>`).join("")}</div></section>
      ${w.top.length ? `<h4>Favourites</h4>${w.top.map(x => `<div class="item" ${x.act}><b class="grow ell">${esc(x.t)}</b><span class="small">★ ${x.r / 2}</span></div>`).join("")}` : ""}
      ${w.franchises.length ? `<h4>Most explored</h4><p>${w.franchises.map(esc).join(" · ")}</p>` : ""}
      ${w.miles.length ? `<h4>Milestones</h4><p>${w.miles.map(esc).join(" · ")}</p>` : ""}
      <div class="row" style="margin-top:14px;gap:8px"><button class="btn primary grow" data-action="wrapshare">Share</button><button class="btn grow" data-action="wrapcopy">Copy text</button></div></div>`);
  }
  function renderYear() {
    const y = ui.year || new Date().getFullYear(), c = yearCounts(y), max = Math.max(1, ...c.months);
    const MON = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];
    return `<div class="row" style="margin-bottom:10px"><button class="iconbtn" data-action="yearstep" data-v="-1" aria-label="Previous year">‹</button><h2 class="grow" style="text-align:center;margin:0;font-size:30px">${y}</h2><button class="iconbtn" data-action="yearstep" data-v="1" aria-label="Next year" ${y >= new Date().getFullYear() ? "disabled" : ""}>›</button></div>
      <button class="btn block" style="margin-bottom:14px" data-action="wrapped">${icon("spark")} Year in review: your ${y} in one card</button>
      <section><div class="bigstat">${fmt(c.hours + c.gameHours)}</div><div class="muted">hours of stories: ${fmt(c.hours)} watching (estimated from runtimes), ${fmt(c.gameHours)} playing (time to beat)</div></section>
      <div class="stat3"><div><b>${fmt(c.films)}</b><span>films${c.rewatches ? ` (${c.rewatches} rewatch${c.rewatches === 1 ? "" : "es"})` : ""}</span></div><div><b>${fmt(c.episodes)}</b><span>episodes${c.bulkEps ? ` (+${fmt(c.bulkEps)} ticked in bulk, not counted)` : ""}</span></div><div><b>${fmt(c.games)}</b><span>games finished</span></div>
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
    const STG = [["library", "Library from IMDb and Trakt"], ["push", "Send your changes to Trakt"], ["services", "AniList, MyAnimeList, Letterboxd, Goodreads"], ["games", "Games: IMDb, Steam covers, prices and dates"], ["itad", "IsThereAnyDeal: best prices, lows, subscriptions, waitlist"], ["episodes", "Episode lists of your series"], ["details", "Posters, release dates and streaming"]];
    return `<section class="card"><div class="row"><div class="grow"><div class="kicker">${ui.job ? esc(ui.job) + "…" : "Last sync"}</div>
        <b style="font:800 22px/1.2 var(--display)">${ui.job ? esc(ui.status || "Working") : last ? esc(new Date(last * 1000).toLocaleString(lang() === "it" ? "it-IT" : "en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })) : "Never"}</b></div>
        ${ui.job ? `<button class="btn" data-action="stopjob">Stop</button>` : `<button class="btn primary" data-action="sync">${icon("sync")}Sync now</button>`}</div>
        ${!ui.job && fails.length ? `<button class="btn block" style="margin-top:12px" data-action="retryfailed">Retry the ${fails.length} that failed</button>` : ""}</section>
      ${!ui.job && ui.stalls ? `<section class="card"><div class="kicker">The screen paused during this job</div><p class="small" style="margin:6px 0 10px">${esc(ui.stalls)}</p><button class="btn small" data-action="copystalls">Copy this line</button></section>` : ""}
      <section class="card"><div class="row"><span class="st ${liveOn() ? "ok" : ""}" style="width:12px;height:12px;border-radius:50%;background:${liveOn() ? "var(--ok)" : "var(--faint)"};flex:none"></span><div class="grow"><b>Live sync with Trakt</b>
        <div class="small muted">${!db.get("username") ? "Add your Trakt username in Settings." : !liveOn() ? "Off. Switch it on in Settings › Trakt." : db.get("token") ? `On: what you log goes to Trakt within seconds; Trakt is checked every 10 minutes while the app is open, and in the background.${db.get("live_pull_at") ? ` Last check ${esc(new Date(+db.get("live_pull_at")).toLocaleTimeString(lang() === "it" ? "it-IT" : "en-GB", { hour: "2-digit", minute: "2-digit" }))}.` : ""}` : "On for reading: your public profile is checked every 3 hours. Sign in to Trakt to send what you log here."}</div></div></div></section>
      ${(() => { const sick = C.sourceHealth(db); return sick.length ? `<section>${Kit.head("Keeps failing")}<div class="listcard">${sick.map(h => `<div class="srcrow"><span class="st fail"></span><div class="grow"><b>${esc(healthText(h))}</b><div class="small muted">${esc(h.msg)}</div><div class="small muted">${/IMDb/i.test(h.label) ? "IMDb: sign in to IMDb in Settings › Accounts, or check the list is public." : /Trakt/i.test(h.label) ? "Trakt: sign in again in Settings › Accounts." : "Check the address in Settings, or remove the source."}</div></div></div>`).join("")}</div></section>` : ""; })()}
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
      await C.breathe(); // let the screen redraw and taps through before the next heavy step
      const t0 = Date.now();
      try { const m = await C.withTimeout(Promise.resolve().then(fn), limit || 120000, "stopped after its time limit, continues next time"); lines.push(`OK   ${label}: ${m}`); setStage(k, true, m, t0); }
      catch (e) { lines.push(`FAIL ${label}: ${e.message}`); setStage(k, false, e.message, t0); }
    };
    await step("library", "Library", async () => { const b = libTotals(), n = await libAdoptSoft(), a = libTotals(); return `${n} new titles, ${fmt(a.rated - b.rated)} ratings, ${fmt(a.er - b.er)} episode ratings, ${fmt(a.eps - b.eps)} episodes ticked (now ${fmt(a.titles)} titles, ${fmt(a.rated)} rated, ${fmt(a.er)} episode ratings)`; });
    if (feat("trakt") && db.get("token") && db.get("trakt_push", "1") === "1") await step("push", "Trakt", async () => { const m = await L.traktPush(lib, http, db.get("client_id"), db.get("token")); libTouch(); ownTraktChange(); return m; });
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
          // 0.6.9: AniList two-way: what AniList says now, then what changed in Saga since goes back
          if (name === "AniList") {
            const alState = Imports.alStateFrom(r.anime);
            if (db.get("anilist_token")) {
              try { const pr = await Imports.anilistPush(http, db.get("anilist_token"), lib.all(), alState); if (pr.sent) parts.push(`${fmt(pr.sent)} sent to AniList`); if (pr.failed.length) parts.push(`${pr.failed.length} couldn't be sent (${pr.failed[0]})`); }
              catch (e) { parts.push(e.message); if (/expired/.test(e.message)) db.set("anilist_token", ""); }
            }
          }
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
          steamTxt = `Steam library: ${fmt(rows.length)} games found (${fmt(sr.added)} new, ${fmt(rows.length - sr.added)} already in Games)${!db.get("steam_key") && rows.length < 12 ? " — the profile page may show only some games: add a Steam Web API key for all of them" : ""}; `;
          // 0.6.9: hours played, last played; with the API key also recently played (→ Playing) and achievements
          try {
            let recent = [];
            if (db.get("steam_key") && rows.steamid) { db.set("steam_id", rows.steamid); recent = await Imports.steamRecent(http, db.get("steam_key"), rows.steamid).catch(() => []); }
            const sp = GC.steamPlay(games, rows, recent);
            if (sp.moved.length) steamTxt += `now Playing: ${sp.moved.slice(0, 3).join(", ")}${sp.moved.length > 3 ? "…" : ""}; `;
            if (db.get("steam_key") && rows.steamid) {
              const due = games.visible().filter(g => g.steam && g.steamMins > 0 && (!g.achAt || Date.now() - g.achAt > 3 * 864e5))
                .sort((a, b) => String(b.steamLast || "").localeCompare(String(a.steamLast || ""))).slice(0, 25);
              let n = 0;
              for (const g of due) { const ac = await Imports.steamAchievements(http, db.get("steam_key"), rows.steamid, g.steam).catch(() => undefined); if (ac === undefined) continue; g.ach = ac; g.achAt = Date.now(); if (ac) n++; }
              if (n) steamTxt += `achievements of ${fmt(n)} games; `;
            }
            games.save();
          } catch (e) { steamTxt += `playtime: ${e.message}; `; } }
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
      return `${steamTxt}${storeN ? `store prices for ${storeN} wishlist games, ` : ""}IMDb games: ${im.added} new, ${im.matched || 0} already in Games${im.promoted ? ` (${im.promoted} marked finished: rated on IMDb)` : ""}, ${linked} linked to Steam, ${alerts.length} price alerts, ${dates} dates updated`;
    }, 180000);
    // 0.6.6: IsThereAnyDeal: ids, best price in any store with the all-time low, subscriptions (twice a day at most),
    // and your ITAD waitlist and collection when you've signed in
    if (secOn("games") && db.get("itad_key")) await step("itad", "IsThereAnyDeal", async () => itadRefresh(http, false), 180000);
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
  // ---- 0.5.9: two-way sync with the Saga website (site/server.js). Each file the phone or the website changed since
  // they last agreed is sent; the server merges it entry by entry (site/merge.js) and both keep the result.
  const WEB_FILES = ["canonsync.json", "library.json", "games.json", "books.json", "dw.json"];
  const fileStamp = t => (t ? t.length + ":" + t.slice(-24) : "");
  let webSyncing = false, webSyncT = null;
  // its own small file, so keeping track doesn't itself change the synced files
  const WS = { get: () => { try { return JSON.parse(Native.load("web_sync.json") || "{}") || {}; } catch (e) { return {}; } }, set: o => Native.save("web_sync.json", JSON.stringify(Object.assign(WS.get(), o))) };
  // 0.6.9.2: the website's address as typed, made usable: no "https://" → added; a trailing slash dropped
  function webBase() {
    let u = String(db.get("web_sync_url", "")).trim().replace(/\/+$/, "");
    if (u && !/^https?:\/\//i.test(u)) u = (/^(\d+\.){3}\d+(:\d+)?$|^localhost\b/i.test(u) ? "http://" : "https://") + u;
    return u;
  }
  // what a failed website call means, in words (the phone only gets Java's error text)
  function webWhy(r) {
    const e = String((r && (r.status || r.error)) || "nothing"), u = webBase(), port = (/:(\d+)$/.exec(u) || [])[1];
    if (/UnknownHost|resolve host/i.test(e)) return `the phone can't find ${u.replace(/^https?:\/\//, "")}. With Tailscale off, the address works only while Funnel is on (on the Pi: tailscale funnel status)`;
    if (port === "8443" && /SSL|closed|reset|ConnectException|timeout/i.test(e)) return `${e}. An address ending in :8443 works only with Tailscale on: from anywhere, use it without :8443`;
    if (/^401$|^403$/.test(e)) return `the website refused the sync key (${e}): copy it again from the server (node server.js --set-password)`;
    if (/SSL|closed|reset/i.test(e)) return `${e}. Is the address the one from tailscale funnel status, starting with https://?`;
    return `the website answered ${e}`;
  }
  function webSyncSoon(ms = 30000) { if (!db.get("web_sync_url") || db.get("web_sync_auto", "1") !== "1") return; clearTimeout(webSyncT); webSyncT = setTimeout(() => syncWithWebServer(false).catch(() => {}), ms); }
  // ---- 0.6.5: friends on your Saga website (each person decides to share; see /api/people on the server)
  async function webApi(method, pth, body) {
    if (window.__sagaWeb) { const r = await fetch(pth, { method, credentials: "same-origin", headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined }); if (!r.ok) throw new Error(`the website answered ${r.status}`); return r.json(); }
    const base = webBase();
    if (!base) throw new Error("set the website address first");
    const H = Object.assign({ Accept: "application/json" }, body ? { "Content-Type": "application/json" } : {}, db.get("web_sync_key") ? { Authorization: "Bearer " + db.get("web_sync_key") } : {});
    const r = await Native.http(method, base + "/" + pth, { headers: H, body: body ? JSON.stringify(body) : undefined });
    if (r.status !== 200) throw new Error(webWhy(r));
    return JSON.parse(r.body);
  }
  const people = () => { const p = db.cacheGet("people:now"); return (p && p.people) || []; };
  async function peopleRefresh(loud) {
    if (!window.__sagaWeb && !db.get("web_sync_url")) return;
    try { const r = await webApi("GET", "api/people"); db.cacheSet("people:now", { at: Date.now(), people: r.people || [] });
      try { db.cacheSet("inbox:now", { at: Date.now(), items: await webApi("GET", "api/inbox") }); } catch (e) { /* older website */ }
      if (loud) toast(r.people.length ? `${r.people.length} sharing with you` : "Nobody shares with you yet"); render(); }
    catch (e) { if (loud) toast(`Friends: ${e.message}`); }
  }
  // the same title in a friend's library
  const friendKey = x => x.imdb ? "i:" + x.imdb : x.tmdb ? "t:" + x.type + x.tmdb : "n:" + x.type + C.norm(x.title) + (x.year || "");
  function friendsOn(it) {
    const out = [];
    for (const P of people()) { const f = P.lib.find(x => (it.imdb && x.imdb === it.imdb) || (it.tmdb && x.tmdb === it.tmdb && x.type === it.type) || (x.type === it.type && C.norm(x.title) === C.norm(it.title) && (!it.year || !x.year || Math.abs(x.year - it.year) <= 1)));
      if (f) out.push({ name: P.name, status: f.status, rating: f.rating }); }
    return out;
  }
  // you and one friend: taste match on titles you both rated, both seen, both want, what they loved that you haven't seen
  function friendCompare(P) {
    const mine = new Map(lib.all().map(it => [friendKey(it), it]));
    const both = [], bothWant = [], loved = [];
    for (const x of P.lib) {
      const it = mine.get(friendKey(x)) || lib.find({ type: x.type, imdb: x.imdb, tmdb: x.tmdb, title: x.title, year: x.year });
      if (it && it.rating && x.rating) both.push([it.rating, x.rating]);
      if (it && it.status === "watchlist" && x.status === "watchlist") bothWant.push(it);
      if (!it && x.rating >= 8) loved.push(x);
    }
    const match = both.length >= 3 ? Math.round(100 - both.reduce((a, [m, f]) => a + Math.abs(m - f), 0) / both.length * 11) : null;
    const seen = P.lib.filter(x => x.status === "watched" || x.status === "watching").filter(x => { const it = mine.get(friendKey(x)); return it && (it.status === "watched" || it.status === "watching"); }).length;
    return { match: match == null ? null : Math.max(0, Math.min(100, match)), rated: both.length, seen, bothWant, loved: loved.sort((a, b) => b.rating - a.rating) };
  }
  // 0.6.9: what friends sent you, and sending a title to them
  const inbox = () => { const b = db.cacheGet("inbox:now"); return (b && b.items) || []; };
  function inboxHtml() {
    const box = inbox(); if (!box.length) return "";
    return `<section>${Kit.head("From friends")}<div class="listcard">${box.slice(0, 8).map(x => `<div class="item" data-action="inboxopen" data-id="${esc(x.id)}" role="button">
      <div class="grow" style="min-width:0"><b class="ell">${esc(x.item.title)}</b><div class="small muted ell">${esc([x.from + " sent it", x.item.year, x.item.type === "show" ? "Series" : x.item.type === "movie" ? "Film" : x.item.type === "game" ? "Game" : "Book", x.note ? "“" + x.note + "”" : ""].filter(Boolean).join(" · "))}</div></div>
      <button class="iconbtn" data-action="inboxdone" data-id="${esc(x.id)}" aria-label="Done with it">${icon("x")}</button></div>`).join("")}</div></section>`;
  }
  const sendButtons = x => people().length ? `<div class="row wrap" style="margin:6px 0">${people().map(P => `<button class="btn small quiet" data-action="sendto" data-to="${esc(P.name)}" data-item="${esc(JSON.stringify({ type: x.type, title: x.title, year: x.year || null, tmdb: x.tmdb || null, imdb: x.imdb || null, poster: /^https:/.test(x.poster || "") ? x.poster : "" }))}">${icon("share")}Send to ${esc(P.name)}</button>`).join("")}</div>` : "";
  const WHEN = d => { try { return new Date(d + "T12:00:00").toLocaleDateString(lang() === "it" ? "it-IT" : "en-GB", { day: "numeric", month: "short" }); } catch (e) { return d; } };
  const ACT = { watched: "watched", finished: "watched", episode: "watched", played: "finished", read: "read" };
  function friendsHtml() {
    const ps = people(); if (!ps.length) return "";
    return ps.map(P => { const c = friendCompare(P);
      return `<section>${Kit.head(`You and ${esc(P.name)}`)}
        <div class="sstrip"><div><b>${c.match == null ? "–" : c.match + "%"}</b><span>taste match${c.rated ? ` (${c.rated} both rated)` : ""}</span></div><div><b>${fmt(c.seen)}</b><span>both watched</span></div><div><b>${fmt(c.bothWant.length)}</b><span>both want to watch</span></div><div><b>${fmt(P.games.filter(g => g.status === "done").length)}</b><span>games ${esc(P.name)} finished</span></div></div>
        ${(P.recent || []).length ? `<h4>Lately</h4><div class="listcard">${P.recent.slice(0, 6).map((x, i) => `<div class="item"${x.type === "movie" || x.type === "show" ? ` data-action="actopen" data-p="${esc(P.name)}" data-i="${i}" role="button"` : ""}><div class="grow" style="min-width:0"><b class="ell">${esc(x.title)}</b><div class="small muted ell">${esc([`${P.name} ${ACT[x.kind] || x.kind}${x.kind === "episode" ? " S" + String(x.ep).replace(":", " E") : ""}`, x.rating ? "★ " + x.rating : "", WHEN(x.date)].filter(Boolean).join(" · "))}</div></div></div>`).join("")}</div>` : ""}
        ${c.bothWant.length ? `<h4>You both want to watch</h4><div class="listcard">${c.bothWant.slice(0, 8).map(it => `<div class="item" data-action="libopen" data-id="${esc(it.id)}">${libThumb(it)}<b class="grow ell">${esc(it.title)}</b><span class="small muted">${esc(it.year || "")}</span></div>`).join("")}</div>` : ""}
        ${c.loved.length ? `<h4>${esc(P.name)} loved, you haven't seen</h4><div class="listcard">${c.loved.slice(0, 8).map((x, i) => `<div class="item" data-action="friendopen" data-p="${esc(P.name)}" data-i="${P.lib.indexOf(x)}" role="button"><div class="grow" style="min-width:0"><b class="ell">${esc(x.title)}</b><div class="small muted">${esc([x.year, x.type === "show" ? "Series" : "Film", "★ " + x.rating].filter(Boolean).join(" · "))}</div></div><button class="btn quiet small" data-action="friendadd" data-p="${esc(P.name)}" data-i="${P.lib.indexOf(x)}">${icon("plus")}Add</button></div>`).join("")}</div>` : ""}</section>`; }).join("");
  }
  // 0.6.9: the calendar on your Saga website, for Google Calendar (or any calendar app) to subscribe to
  async function pushCalendar() {
    if (!window.__sagaWeb && !db.get("web_sync_url")) return;
    try { const c = icsText(); const r = await webApi("POST", "api/calendar", { text: c.text }); if (r && r.path) { db.set("cal_path", r.path); } } catch (e) { logError("calendar", e.message); }
  }
  const calUrl = () => { const base = window.__sagaWeb ? location.origin + location.pathname.replace(/[^/]*$/, "") : webBase() + "/"; return db.get("cal_path") ? base + db.get("cal_path") : ""; };
  // 0.6.9: the website's owner page: who has an account and when they last came by, space left, backups, updates
  async function openAdmin() {
    $("#overlay").innerHTML = `<div class="scrim bottom" data-action="dismiss"><div class="sheet" role="dialog" aria-modal="true"><h3 style="margin:0">Your Saga website</h3><p class="small muted">Asking the website…</p></div></div>`;
    let a;
    try { a = await webApi("GET", "api/admin"); } catch (e) { $("#overlay .sheet").innerHTML = `<h3 style="margin:0">Your Saga website</h3><p class="small muted">${/403/.test(e.message) ? "Only the website's owner sees this page." : esc(e.message)}</p>`; return; }
    const ago = t => !t ? "never" : (() => { const m = Math.round((Date.now() - t) / 60000); return m < 2 ? "just now" : m < 120 ? m + " min ago" : m < 2880 ? Math.round(m / 60) + " h ago" : Math.round(m / 1440) + " days ago"; })();
    const mb = n => (n / 1048576).toFixed(n < 10485760 ? 1 : 0) + " MB", gb = n => (n / 1073741824).toFixed(1) + " GB";
    const low = a.disk && a.disk.free < 1073741824;
    $("#overlay .sheet").innerHTML = `<h3 style="margin:0">Your Saga website</h3><p class="small muted" style="margin:2px 0 10px">Saga ${esc(a.version)} · Node ${esc(a.node)} · running for ${a.uptime > 86400 ? Math.round(a.uptime / 86400) + " days" : Math.round(a.uptime / 3600) + " h"}</p>
      <div class="sstrip"><div><b>${a.people.length}</b><span>accounts</span></div><div><b${low ? ' style="color:#f0883e"' : ""}>${a.disk ? gb(a.disk.free) : "?"}</b><span>free on the Pi${a.disk ? " of " + gb(a.disk.total) : ""}</span></div><div><b>${a.lastDaily ? esc(a.lastDaily.slice(5)) : "–"}</b><span>last daily copy</span></div><div><b>${a.autoUpdate ? "on" : "off"}</b><span>nightly updates</span></div></div>
      ${low ? `<p class="small" style="color:#f0883e">Less than 1 GB free on the Pi: when the card is full, saving stops working. Delete old files or move to a bigger card.</p>` : ""}
      <h4>People</h4><div class="listcard">${a.people.map(p => `<div class="item"><div class="grow" style="min-width:0"><b>${esc(p.name)}</b>${p.owner ? ' <span class="muted small">(owner)</span>' : ""}<div class="small muted">last here ${ago(p.at)} · last phone sync ${ago(p.sync)} · ${mb(p.size)}${p.shares ? " · shares" : ""}${p.calendar ? " · calendar" : ""}</div></div></div>`).join("")}</div>
      <p class="small muted">App updates on the download page: ${a.apks.length ? esc(a.apks.join(", ")) : "none (copy APKs into /opt/saga/data/apk/)"}.${a.autoUpdate ? "" : " Nightly updates: <code>bash /opt/saga/app/site/auto-update.sh on</code>."}</p>`;
  }
  async function syncWithWebServer(loud) {
    const base = webBase();
    if (!base || webSyncing || ui.job) return "";
    webSyncing = true;
    const H = Object.assign({ Accept: "application/json" }, db.get("web_sync_key") ? { Authorization: "Bearer " + db.get("web_sync_key") } : {});
    const http = C.robust(Native.http, { timeout: 120000, tries: 2 });
    let sent = 0, got = 0;
    try {
      saveAllNow(); // everything written first
      const m = await http("GET", base + "/api/sync/manifest", { headers: H });
      if (m.status === 401) throw new Error("the website asked for the sync key (Settings › Accounts and sync › Saga website)");
      if (m.status !== 200) throw new Error(webWhy(m));
      const man = JSON.parse(m.body).files || {};
      const last = WS.get().state || {};
      const changedHere = [];
      for (const n of WEB_FILES) {
        const local = Native.load(n) || "";
        const st = last[n] || {}, srv = man[n] && man[n].sha256;
        if (local && fileStamp(local) === st.local && (!srv || srv === st.server)) continue;
        if (!local && !srv) continue;
        await C.breathe(0);
        const r = await http("POST", base + "/api/sync/file/" + n, { headers: Object.assign({ "Content-Type": "application/json" }, H), body: local || "" });
        if (r.status !== 200) throw new Error(`${n}: ${webWhy(r)}`);
        const j = JSON.parse(r.body);
        sent++;
        if (j.text !== local) { applyWebFile(n, j.text); got++; changedHere.push(n); }
        last[n] = { local: fileStamp(Native.load(n) || j.text), server: j.sha256 }; // what's on the phone now, as the phone wrote it
        WS.set({ state: last });
      }
      const msg = !sent ? "nothing to do" : `${sent} file${sent === 1 ? "" : "s"} compared${got ? `, changes from the website in ${changedHere.map(n => n.replace(".json", "")).join(", ")}` : ""}`;
      WS.set({ at: Date.now(), msg });
      if (got) { invalidate(); render(); }
      if (loud) toast("Website: " + msg);
      return msg;
    } catch (e) {
      WS.set({ at: Date.now(), msg: "failed: " + e.message }); logError("website sync", e.message);
      if (loud) toast("Website sync failed: " + e.message);
      return "failed: " + e.message;
    } finally { webSyncing = false; }
  }
  // a merged file from the website replaces the one in memory and on the phone
  function applyWebFile(n, text) {
    if (!text) return;
    const d = JSON.parse(text);
    if (n === "canonsync.json") { db.loadData(d); db.flush(true); }
    else if (n === "library.json") { const fresh = new L.Library({ load: () => text }); lib.items = fresh.items; lib.adopted = fresh.adopted; lib.outbox = fresh.outbox; libWrite(true); libMirror(); }
    else if (n === "games.json") { games.fromJSON(d); Native.save(n, text); }
    else if (n === "books.json") { books.fromJSON(d); Native.save(n, text); }
    else if (n === "dw.json") { Native.save(n, text); try { Kit.mods.timeline.reset(); } catch (e) { /* not loaded */ } }
  }
  // 0.5.7: what follows a sync runs one thing after another, after the sync's own save, instead of all at once
  let afterRunning = false;
  // 0.6.9: the ITAD sign-in used to be kept as "itad_auth", which wasn't treated as secret (it went into backups and
  // the website's copy of settings): moved to a secret name once
  try { const old = db.get("itad_auth"); if (old) { if (!db.get("itad_token")) db.set("itad_token", old); delete db.settings.itad_auth; delete db.settings.itad_pkce; db.flush(); } } catch (e) { /* nothing to move */ }
  // ---- 0.6.6: IsThereAnyDeal
  async function itadToken() {
    let t = {}; try { t = JSON.parse(db.get("itad_token", "{}")) || {}; } catch (e) { t = {}; }
    if (!t.access) return "";
    if (t.until && Date.now() < t.until - 60000) return t.access;
    if (!t.refresh) return "";
    const n = await GC.itadToken(Native.http, { grant_type: "refresh_token", refresh_token: t.refresh, client_id: db.get("itad_client_id") });
    db.set("itad_token", JSON.stringify(Object.assign(t, n, { refresh: n.refresh || t.refresh }))); db.flush();
    return n.access;
  }
  async function itadRefresh(http, force) {
    const key = db.get("itad_key"), cc = games.settings.region || "IT", out = [];
    if (!key) throw new Error("add an IsThereAnyDeal API key in Settings");
    const due = force || Date.now() - (games.meta.dealsAt || 0) > 11 * 3600e3;
    const ids = await GC.itadIds(games, http, key, GC.priceWatch(games));
    if (ids) out.push(`${fmt(ids)} games matched`);
    if (due) {
      const deals = await GC.itadOverview(games, http, key, cc); out.push(`${fmt(deals)} on sale`);
      const subs = await GC.itadSubs(games, http, key, cc); out.push(`${fmt(subs)} in a subscription`);
      // a game you want at its lowest price ever: a notification (once per price)
      if (feat("priceAlerts")) for (const g of games.visible()) if (g.deal && g.deal.atLow && g.deal.cut > 0 && (g.status === "wishlist" || g.next))
        Native.notify(C.hashId("glow|" + g.id + "|" + g.deal.price), `Lowest price ever: ${g.title}`, `${g.deal.cur === "EUR" ? "€" : g.deal.cur + " "}${(+g.deal.price).toFixed(2)} at ${g.deal.shop} (−${g.deal.cut}%)`, "games");
    }
    if (db.get("itad_token")) {
      try { const tok = await itadToken(); if (tok) { const w = await GC.itadWaitSync(games, http, tok); out.push(`waitlist: ${w.added} in, ${w.pushed} out${w.removedHere + w.removedThere ? `, ${w.removedHere + w.removedThere} removed` : ""}; ${w.owned} to your collection`); } }
      catch (e) { out.push(`waitlist: ${e.message}`); }
    }
    games.save();
    return out.join(", ") || "nothing new";
  }
  async function itadSignIn() {
    const cid = String(db.get("itad_client_id", "")).trim();
    if (!cid) { toast("Add your IsThereAnyDeal app's client ID first"); return; }
    const verifier = Native.randomUrl(48), state = Native.randomUrl(16);
    db.set("itad_pkce_secret", JSON.stringify({ verifier, state, redirect: itadRedirect() })); db.flush();
    Native.openUrl(GC.itadAuthUrl(cid, itadRedirect(), await Native.sha256url(verifier), state));
    toast("Approve Saga on IsThereAnyDeal; you'll come back here by yourself");
  }
  const itadRedirect = () => `${(Native.linkScheme && Native.linkScheme()) || "bantaapps"}://oauth/itad`;
  // the browser comes back with …://oauth/itad?code=…&state=… (or the address pasted by hand)
  async function itadFinish(url) {
    let st = {}; try { st = JSON.parse(db.get("itad_pkce_secret", "{}")) || {}; } catch (e) { st = {}; }
    const q = new URLSearchParams(String(url).replace(/^[^?]*\?/, "").replace(/#.*/, ""));
    if (q.get("error")) { toast(`IsThereAnyDeal: ${q.get("error_description") || q.get("error")}`); return; }
    if (!q.get("code") || !st.verifier) { toast("That isn't an IsThereAnyDeal sign-in address"); return; }
    if (st.state && q.get("state") !== st.state) { toast("Sign-in didn't match: try again"); return; }
    runJob("IsThereAnyDeal sign-in", async () => {
      const t = await GC.itadToken(Native.http, { grant_type: "authorization_code", code: q.get("code"), redirect_uri: st.redirect || itadRedirect(), client_id: db.get("itad_client_id"), code_verifier: st.verifier });
      db.set("itad_token", JSON.stringify(t)); db.set("itad_pkce_secret", ""); db.flush();
      return "Signed in to IsThereAnyDeal. " + await itadRefresh(Native.http, true);
    });
  }
  window.__oauth = url => { if (/oauth\/itad/.test(url)) itadFinish(url); else if (/oauth\/anilist/.test(url)) anilistFinish(url); };
  // 0.6.9: AniList sign-in (the token comes back in the address: …://oauth/anilist#access_token=…)
  const anilistRedirect = () => `${(Native.linkScheme && Native.linkScheme()) || "bantaapps"}://oauth/anilist`;
  function anilistFinish(url) {
    const t = Imports.anilistTokenFrom(url);
    if (!t) { toast("That isn't an AniList sign-in address"); return; }
    db.set("anilist_token", t.token); db.set("anilist_until", String(t.until)); db.flush();
    toast("Signed in to AniList: changes go back to it after each sync"); render();
  }
  window.__oauthPoll = () => { const u = Native.takeOauth(); if (u) window.__oauth(u); };
  setTimeout(() => { try { window.__oauthPoll(); } catch (e) { logError("oauth", e.message); } }, 600);
  async function afterSync() {
    setTimeout(() => checkUpdate(false).catch(() => {}), 5000);
    setTimeout(() => { if (db.get("cal_path")) pushCalendar(); }, 7000);
    setTimeout(() => recsRefresh(false).catch(() => {}), 9000);
    setTimeout(() => peopleRefresh(false).catch(() => {}), 12000);
    setTimeout(() => { if (db.get("cal_path")) pushCalendar(); }, 14000);
    if (afterRunning) return;
    afterRunning = true;
    try {
      for (let i = 0; i < 600 && ui.job; i++) await new Promise(r => setTimeout(r, 500));
      await new Promise(r => setTimeout(r, 1200)); // the result on screen first
      await db.settled();
      await statusSoon();
      await C.breathe(30);
      try { updateWidget(); } catch (e) { /* optional */ }
      await C.breathe(30);
      await runDetails();
      await C.breathe(30);
      await fillImages();
      await db.settled();
      await backupToFile(false).catch(() => {});
      if (db.get("web_sync_url") && db.get("web_sync_auto", "1") === "1") await syncWithWebServer(false);
    } catch (e) { logError("after sync", e.message); }
    afterRunning = false;
  }
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
  function cImg(c) { if (c.poster) return /^https?:/.test(c.poster) ? c.poster : IMG + "w342" + c.poster; return imgOf(canonKey(c)) || ""; }
  // Pictures for everything that has none, trying several sources per kind (images.js). A picture that fails to
  // load moves that title on to its next source. Titles nothing was found for are tried again after three days.
  let imgRunning = false, imgAgain = false;
  // 0.5.7: kept in memory and saved a few seconds after a change (a broken picture used to parse and rewrite it each time)
  let imgMem = null, imgSaveT = null;
  const imgState = () => { if (!imgMem) { try { imgMem = JSON.parse(db.get("img_state", "{}")) || {}; } catch (e) { imgMem = {}; } } return imgMem; };
  const imgSave = () => { clearTimeout(imgSaveT); imgSaveT = setTimeout(() => { imgSaveT = null; if (imgMem) db.set("img_state", JSON.stringify(imgMem)); }, 5000); };
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
    // pictures wait for a running sync or import to finish: both at once is what made the screen lag
    if (ui.job) { clearTimeout(fillImages._wait); fillImages._wait = setTimeout(() => fillImages(budget), 15000); return 0; }
    imgRunning = true;
    try { await statusSoon(); } catch (e) { /* the canon part is skipped */ }
    const state = imgState();
    const jobs = imgTargets(state).slice(0, budget);
    const http = C.robust(Native.http, { timeout: 15000, tries: 1 });
    let n = 0;
    const hit = {};
    await C.pool(jobs, 3, async j => {
      const st = state[j.k] = state[j.k] || {};
      const r = await Images.find(http, j.o, { tmdbKey: db.get("tmdb_key"), skip: st.skip || [], country: db.get("region", "IT") });
      st.at = Date.now();
      if (r) { j.set(r.url); st.src = r.src; st.none = false; n++; hit[j.k.slice(0, j.k.indexOf(":"))] = 1; } else st.none = true;
      await C.breathe(20);
    });
    imgSave();
    if (n) { if (hit.lib) libSave(); if (hit.game) games.save(); if (hit.book) books.save(); invalidate(); if (!ui.job && !document.querySelector("#overlay .sheet")) render(); }
    imgRunning = false;
    if (imgAgain) { imgAgain = false; setTimeout(fillImages, 1000); }
    return n;
  }
  let brokenTimer = null;
  window.__imgBroken = (key, url) => {
    const state = imgState(), st = state[key] = state[key] || {};
    const src = st.src || (/steamstatic.*library_600x900/.test(url) ? "steam" : /steamstatic/.test(url) ? "steamHeader" : /tmdb/.test(url) ? "tmdb" : /media-amazon/.test(url) ? "imdbId" : /tvmaze/.test(url) ? "tvmaze" : /jikan|myanimelist/.test(url) ? "jikanAnime" : "");
    st.skip = [...new Set((st.skip || []).concat(src ? [src] : []))]; st.src = ""; st.none = false;
    imgSave();
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
      try { const m = await L.traktPush(lib, C.robust(Native.http, { timeout: 30000, tries: 2 }), db.get("client_id"), db.get("token")); libTouch(); ownTraktChange(); setStage("push", true, m, t0); db.set("live_push_at", String(Date.now())); }
      catch (e) { setStage("push", false, e.message, t0); }
      liveBusy = false;
      if (ui.sec === "sync") render();
    }, 8000);
  }
  // 0.5.8: what Saga itself just sent to Trakt isn't news: note Trakt's "last change" right after a push,
  // so the next check doesn't download your whole account again because of your own tick.
  let ownPushAt = 0;
  function ownTraktChange() { ownPushAt = Date.now(); }
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
        // the only change since the last check came from a push this app made in that time: nothing to fetch
        // (at least every 3 hours it fetches anyway, in case something else changed in the same minutes)
        const at = Date.parse(all), realPull = parseFloat(db.get("live_real_pull_at", "0")) || 0;
        if (changed && ownPushAt > last && at && at <= ownPushAt + 30000 && Date.now() - realPull < 3 * 3600000) { changed = false; db.set("trakt_last_all", all); }
      }
      db.set("live_pull_at", String(Date.now()));
      if (changed && !ui.job) {
        db.set("live_real_pull_at", String(Date.now()));
        C.BUSY.on = true; // no saves in the middle; the library step in small slices
        let res;
        try {
          res = await C.syncAll(db, Native.http, () => {}, new Set(["Trakt account"]));
          if (res.ok) { if (all) db.set("trakt_last_all", all); await C.breathe(0); await libAdoptSoft(); }
        } finally { C.BUSY.on = false; }
        if (res && res.ok) {
          invalidate(); libTouch(); db.touch();
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
    let n = 0, nb = 0;
    for (const a of acts) {
      const it = lib.get(a.id);
      if (a.op === "ep" && it && !it.eps[L.epKey(a.s, a.e)]) { lib.toggleEp(it, a.s, a.e, (a.at || "").slice(0, 10) || TODAY()); n++; }
      if (a.op === "book_step") { const b = books.get(a.id); if (b) { const t = Date.parse((a.at || "") + "T12:00:00") || Date.now(); const when = (a.at || "").slice(0, 10) === TODAY() ? Date.now() : t;
        if (a.ch) BC.setChapter(b, (b.chapter || 0) + a.ch, null, when); else if (a.pages) BC.setPage(b, (b.currentPage || 0) + a.pages, when); nb++; } }
    }
    if (nb) { books.save(); }
    if (n) libSave();
    if (n || nb) toast([n ? `${n} episode${n === 1 ? "" : "s"} marked` : "", nb ? `${nb} reading step${nb === 1 ? "" : "s"} saved` : ""].filter(Boolean).join(", ") + " from the widget or notifications");
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
  // the same backup in pieces, built without holding the screen (the backup file that's rewritten after changes)
  async function bundleParts() {
    const parts = await C.jsonParts({ app: "canonsync-all", v: 2, version: VERSION, at: new Date().toISOString(), canon: canonForBackup(db.get("backup_secrets", "0") === "1"), library: lib.toJSON(), games: games.toJSON(), books: books.toJSON(), dw: Kit.mods.timeline.state() }, 6, 1);
    const pw = db.get("backup_password");
    if (!pw) return parts;
    if (!(window.crypto && crypto.subtle)) throw new Error("This phone can't encrypt here");
    const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
    const data = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await lockKey(pw, salt, LOCK_ITER), new TextEncoder().encode(parts.join(""))));
    const out = [JSON.stringify({ app: "saga-locked", v: 1, kdf: "PBKDF2-SHA256", iter: LOCK_ITER, salt: toB64(salt), iv: toB64(iv) }).slice(0, -1) + ',"data":"'];
    for (let i = 0; i < data.length; i += 196608) { out.push(toB64(data.subarray(i, i + 196608))); await C.breathe(0); } // 196608 = 3 × 65536: each piece is whole base64
    out.push('"}');
    return out;
  }
  async function bundleOut() { const t = bundle(); const pw = db.get("backup_password"); return pw ? sealBackup(t, pw) : t; }
  async function backupToFile(force) {
    if (!db.get("backup_uri") || !(window.Android && Android.writeUri)) return false;
    const last = parseFloat(db.get("backup_file_at", "0")) || 0;
    if (!force && Date.now() - last < 10 * 60000) return false;
    db.set("backup_file_at", String(Date.now())); // set first: a slow encryption must not start a second write
    let ok = false;
    try { ok = await Native.writeUriParts(db.get("backup_uri"), await bundleParts()); } catch (e) { logError("backup", e.message); }
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
  // Every import keeps a copy of the data from just before it, so the latest one can be undone (Settings › Import).
  // ---- 0.6.9: history. Before every import, Start over, list removal, merge, restore and the first sync of the day,
  // a copy of what you made yourself (films and series, games, books, Doctor Who, your lists) is kept: the last 12.
  // What syncs from IMDb and Trakt isn't in it (a sync brings it back), so each copy stays small.
  const SNAP_MAX = 12;
  const snaps = () => { try { return JSON.parse(db.get("snaps", "[]")) || []; } catch (e) { return []; } };
  const MINE_SETTINGS = /^(lib_lists|my_lists|mylists|u_order|u_tier|recs_hide|pick_hide|lib_rules)/;
  // a copy can be several MB: it goes to the phone in pieces, written in the background (one huge text would stall the screen)
  function snapWrite(name, body) {
    if (Native.parts) { const parts = []; for (let i = 0; i < body.length; i += 150000) parts.push(body.slice(i, i + 150000)); Native.saveParts(name, parts); return true; }
    return !!Native.save(name, body);
  }
  function snapshot(why) {
    try {
      const mine = {}; for (const [k, v] of Object.entries(db.toJSON().settings || {})) if (MINE_SETTINGS.test(k)) mine[k] = v;
      const body = JSON.stringify({ app: "saga-snapshot", v: 1, version: VERSION, at: Date.now(), why, settings: mine, library: lib.toJSON(), games: games.toJSON(), books: books.toJSON(), dw: Kit.mods.timeline.state() });
      const list = snaps(), n = list.length ? (Math.max(...list.map(x => x.n)) + 1) : 1;
      if (!snapWrite(`snap_${n}.json`, body)) return false;
      list.unshift({ n, at: Date.now(), why, films: lib.all().length, games: games.visible().length, books: books.books.length, size: body.length });
      for (const old of list.slice(SNAP_MAX)) { try { Native.saveLater(`snap_${old.n}.json`, ""); } catch (e) { /* already gone */ } }
      db.set("snaps", JSON.stringify(list.slice(0, SNAP_MAX))); db.flush();
      return true;
    } catch (e) { logError("snapshot", e.message); return false; }
  }
  function restoreSnap(n) {
    const s0 = snaps().find(x => x.n === n), t = s0 && Native.load(`snap_${n}.json`);
    if (!t) { toast("That copy is no longer on this device"); return; }
    confirmDialog(`Go back to ${new Date(s0.at).toLocaleString(lang() === "it" ? "it-IT" : "en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}?`,
      `Your films and series, games, books, Doctor Who and lists go back to how they were ${esc(s0.why)} (${fmt(s0.films)} films and series, ${fmt(s0.games)} games, ${fmt(s0.books)} books). A copy of how things are now is kept first, so you can come back. Synced IMDb and Trakt data and your settings stay as they are.`, "Go back", () => {
        snapshot("before going back to an earlier copy");
        try {
          const j = JSON.parse(t);
          applyBackup({ library: j.library, games: j.games, books: j.books, dw: j.dw });
          for (const [k, v] of Object.entries(j.settings || {})) db.set(k, v);
          db.flush(); invalidate(); render(); toast("Back to the earlier copy");
        } catch (e) { toast(e.message); }
      });
  }
  function historySection() {
    const list = snaps();
    return `<section class="stack" id="history"><h2>History</h2>
      <p class="small muted" style="margin:0">A copy of what you made yourself is kept before every import, Start over, list removal, merge and the first sync of each day (the last ${SNAP_MAX}). Going back keeps a copy of now first.</p>
      <div class="listcard">${list.length ? list.map(x => `<div class="item"><div class="grow" style="min-width:0"><b class="ell">${esc(new Date(x.at).toLocaleString(lang() === "it" ? "it-IT" : "en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }))}</b>
        <div class="small muted ell">${esc(x.why)} · ${fmt(x.films)} films and series · ${fmt(x.games)} games · ${fmt(x.books)} books</div></div><button class="btn small" data-action="snaprestore" data-n="${x.n}">Go back</button></div>`).join("")
        : `<p class="small muted" style="padding:8px">No copies yet: the first is made before your next import or sync.</p>`}</div>
      <button class="btn small" data-action="snapnow">${icon("box")}Keep a copy now</button></section>`;
  }
  // ---- 0.6.9: duplicates in your films and series and your games: suggested pairs, merged only when you say so
  const dupSkip = () => { try { return JSON.parse(db.get("dup_skip", "{}")) || {}; } catch (e) { return {}; } };
  function dupPairs() { const sk = dupSkip(); return { lib: L.findDuplicates(lib, sk), games: feat("games") ? GC.findDuplicates(games, sk) : [] }; }
  function openDuplicates() {
    const d = dupPairs(), n = d.lib.length + d.games.length;
    const side = (x, kind) => kind === "lib" ? `<div class="grow" style="min-width:0"><b class="ell">${esc(x.title)}</b><div class="small muted ell">${esc([x.year, x.type === "show" ? "Series" : "Film", LST[x.status], x.rating ? "★ " + x.rating : "", x.watches.length ? x.watches.length + " watch" + (x.watches.length === 1 ? "" : "es") : "", Object.keys(x.eps || {}).length ? Object.keys(x.eps).length + " episodes ticked" : "", x.imdb || ""].filter(Boolean).join(" · "))}</div></div>`
      : `<div class="grow" style="min-width:0"><b class="ell">${esc(x.title)}</b><div class="small muted ell">${esc([GC.yearOf(x), x.platform, GC.LABEL[x.status], x.rating ? "★ " + x.rating : "", x.plays.length ? x.plays.length + "× finished" : "", x.owned && !/^n\/a$/i.test(x.owned) ? "owned: " + x.owned : ""].filter(Boolean).join(" · "))}</div></div>`;
    const rows = (list, kind) => list.slice(0, 80).map((p, i) => `<div class="card" style="margin:8px 0;padding:10px"><div class="small muted" style="margin-bottom:4px">${esc(p.why)}</div>
      <div class="item" style="margin:0">${side(p.a, kind)}</div><div class="item" style="margin:0">${side(p.b, kind)}</div>
      <div class="row wrap" style="margin-top:6px"><button class="btn small" data-action="dupmerge" data-kind="${kind}" data-i="${i}">Merge into one</button><button class="btn small quiet" data-action="dupskip" data-kind="${kind}" data-i="${i}">Not the same</button></div></div>`).join("");
    ui.dups = d;
    $("#overlay").innerHTML = `<div class="scrim bottom" data-action="dismiss"><div class="sheet" role="dialog" aria-modal="true"><h3 style="margin:0">Duplicates</h3>
      <p class="small muted">${n ? `${fmt(n)} possible duplicate${n === 1 ? "" : "s"}. Merging keeps one entry with the further status, your rating, every watch or finish date, ticked episodes, notes and ids. A copy is kept first (Settings › History).` : "No duplicates found."}</p>
      ${n > 1 ? `<button class="btn" data-action="dupall">Merge all ${fmt(n)}</button>` : ""}
      ${d.lib.length ? `<h4>Films and series · ${fmt(d.lib.length)}</h4>${rows(d.lib, "lib")}` : ""}${d.games.length ? `<h4>Games · ${fmt(d.games.length)}</h4>${rows(d.games, "games")}` : ""}</div></div>`;
  }
  function keepBeforeImport(what) {
    snapshot(`before the ${what || "import"}`);
    if (SH.write("before_import.json", bundle(false))) { db.set("import_undo_at", String(Date.now())); db.set("import_undo_what", what || "import"); db.flush(); }
  }
  function undoImport() {
    const t = SH.read("before_import.json");
    if (!t) { toast("The copy from before that import is no longer on this phone"); db.set("import_undo_at", ""); render(); return; }
    confirmDialog("Undo the last import?", `Everything goes back to how it was just before the ${db.get("import_undo_what", "import")} import of ${new Date(+db.get("import_undo_at")).toLocaleString()}. Changes you made after it are undone too.`, "Undo import", () => {
      try { applyBackup(readBackup2(t)); SH.remove("before_import.json"); db.set("import_undo_at", ""); db.flush(); render(); toast("Import undone"); } catch (e) { toast(e.message); }
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
      // 0.6.5: the same columns the games spreadsheet import reads, so this file can be edited and imported again
      const NA = v => (v === null || v === undefined || v === "" ? "N/A" : v);
      const rows = [["Title", "OG Release Date", "OG Platform", "Remake Name", "Remake Release Date", "Remake Platform", "Owned Platform", "HLTB", "HLTB Bundle", "Rating", "Franchise", "Multiverse", "Next",
        "Status", "My rating", "Finished dates", "Notes", "Steam app"]];
      for (const g of games.visible()) rows.push([g.title, g.date || g.dateText || "N/A", NA(g.platform), g.remake ? g.remake.title : "N/A", g.remake ? NA(g.remake.date) : "N/A", g.remake ? NA(g.remake.platform) : "N/A",
        NA(g.owned), NA(g.hours), NA(g.hoursRemake), NA(g.imdbR), g.franchise || "", g.multiverse || "", g.next ? "X" : "", g.status, g.rating || "", g.plays.join(" "), g.notes || "", g.steam || ""]);
      name = "saga-games.csv"; text = csv(rows);
    }
    Native.saveAs(name, text).then(ok => toast(ok ? `${name} saved` : "Not saved"));
  }
  // ---- 0.6.1: start over, part by part. A copy of everything is kept first, so it can be undone.
  const WIPE = [["library", "Your library (films and series, ticks, viewings, ratings you gave in Saga)", "Also forgets which synced titles were already brought in, so the next sync brings in only what's on your lists and ratings now."],
    ["imdb", "Everything synced or imported from IMDb", "Ratings, lists, watchlist, episode ratings."], ["imdblists", "Only your IMDb lists", "Keeps IMDb ratings and watchlist."],
    ["trakt", "Everything synced or imported from Trakt", "Watched, ratings, watchlist, lists, progress."], ["imports", "Other imports", "MyAnimeList, AniList, Simkl, Letterboxd, Refract and other files."],
    ["canon", "Canon lists (franchises and their entries)", ""], ["games", "Games", "Your games, playthroughs and sessions."], ["books", "Books and manga", ""],
    ["dw", "Doctor Who progress", "Ticks, ratings, your own entries and order."], ["lists", "Your lists", ""], ["cache", "Look-up cache", "Posters, dates and details: fetched again when needed."]];
  function startOverSection() {
    return `<section class="stack" id="tidy"><h2>Tidy up</h2>
      <p class="small muted" style="margin:0">The same film, series or game entered twice (an import and a sync, another year or spelling): see them side by side and merge.</p>
      <button class="btn" data-action="dupopen">${icon("list")}Find duplicates</button></section>
      <section class="stack" id="startover"><h2>Start over</h2>
      <p class="small muted" style="margin:0">Clear the parts you choose and keep the rest (settings, keys and accounts always stay). A copy of everything is kept first: Undo appears for 10 seconds, and Settings › Imports › Undo the last import works afterwards too.</p>
      <div class="card">${WIPE.map(([k, l, h]) => `<label class="switch"><input type="checkbox" data-wipe="${k}"><span>${esc(l)}${h ? `<small class="muted" style="display:block">${esc(h)}</small>` : ""}</span></label>`).join("")}
        <button class="btn" style="margin-top:10px" data-action="wipe">Clear what's ticked</button></div></section>`;
  }
  function wipe(cats) {
    keepBeforeImport("clearing");
    const before = SH.read("before_import.json");
    const dropRows = keep => { for (const [k, r] of db.itemsMap) if (!keep(r)) db.itemsMap.delete(k); };
    const dropSettings = rx => { for (const k of Object.keys(db.settings)) if (rx.test(k)) delete db.settings[k]; };
    if (cats.includes("imdb")) { dropRows(r => r.source !== "imdb"); dropSettings(/^(imdb_eps|imdb_tpl|imdb_ur|imdb_ur_for|imdb_counts)/); }
    else if (cats.includes("imdblists")) dropRows(r => !(r.source === "imdb" && r.kind === "list"));
    if (cats.includes("trakt")) { dropRows(r => r.source !== "trakt"); dropSettings(/^(trakt_progress|ep_ratings|trakt_lists|trakt_la|trakt_last_rated_at|trakt_last_all)$/); }
    if (cats.includes("imports")) dropRows(r => r.source === "imdb" || r.source === "trakt" || r.source === "app");
    if (cats.includes("canon")) { db.canonMap.clear(); db.franchiseMap.clear(); }
    if (cats.includes("cache")) { db.tmdbCache.clear(); db._cacheFull = true; db._cacheDirty = true; }
    if (cats.includes("library")) { lib.items = {}; lib.adopted = {}; lib.outbox = []; libWrite(true); mirrorDirty = true; }
    if (cats.includes("games")) { games.games = []; games.removed = {}; games._fi = null; games.save(); gamesFile.now(); }
    if (cats.includes("books")) { books.books = []; books.save(); booksFile.now(); }
    if (cats.includes("dw")) { Native.save("dw.json", ""); try { Kit.mods.timeline.reset(); } catch (e) { /* not loaded */ } }
    if (cats.includes("lists")) db.set("my_lists", "[]");
    mirrorNow(); invalidate(); db.flush(true); render();
    toast(`Cleared: ${cats.length} part${cats.length === 1 ? "" : "s"}`, () => { try { applyBackup(readBackup2(before)); db.flush(true); render(); toast("Put back"); } catch (e) { toast(e.message); } });
  }
  function backupSection() { return backupSection0() + historySection() + startOverSection(); }
  function backupSection0() {
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
  // 0.6.9.1: an IMDb list or watchlist file imported through Import used to count every title without your rating as
  // watched (and a game as finished). Once: those rows become watchlist entries, and titles and games that were marked
  // watched/finished only because of them go back to To watch / Wishlist. Anything you rated, ticked, dated or wrote a
  // note on stays as it is. A copy is kept first (Settings › Backup › Earlier copies).
  function fixListedWatched() {
    if (db.get("fix_listed_v1")) return null;
    const bad = db.items("imdb", ["watched"]).filter(r => !(+r.rating > 0));
    if (!bad.length) { db.set("fix_listed_v1", "1"); return null; }
    snapshot("before un-marking titles that were only on a list");
    const relDays = new Set(bad.map(r => r.date).filter(Boolean));
    const gameKeys = new Set(bad.filter(r => r.medium === "Video Game").flatMap(r => [r.imdb && "i:" + r.imdb, "n:" + C.norm(r.title)].filter(Boolean)));
    for (const r of bad) {
      db.itemsMap.delete(C.Store.itemId(r));
      db.addItems([{ title: r.title, year: r.year, medium: r.medium, imdb: r.imdb, tmdb: r.tmdb, genres: r.genres, runtime: r.runtime, date: r.date }], "imdb", "watchlist", "");
    }
    let films = 0, gms = 0;
    const ix = originsIndex();
    for (const it of lib.all()) {
      if (it.status !== "watched" || it.rating > 0 || it.ratedHere || it.notes || Object.keys(it.eps || {}).length) continue;
      if (!it.watches.every(d => !d || relDays.has(d))) continue; // a watch date of your own: you saw it
      const o = originsOf(it, ix);
      if (!o.length || !o.every(r => !(+r.rating > 0) && ["watchlist", "list", "collection"].includes(r.kind))) continue;
      it.status = "watchlist"; it.watches = []; delete it.autoWatching; it.updated = Date.now(); films++;
    }
    if (films) libSave();
    for (const g of games.games) {
      if (g.status !== "done" || g.rating > 0 || g.notes || (g.sessions || []).length || g.plays.length > 1 || g.src !== "imdb") continue;
      if (!gameKeys.has(g.imdb && "i:" + g.imdb) && !gameKeys.has("n:" + C.norm(g.title))) continue;
      g.status = "wishlist"; g.plays = []; gms++;
    }
    if (gms) games.save();
    db.set("fix_listed_v1", "1"); db.flush(); invalidate();
    return { rows: bad.length, films, games: gms };
  }
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
    // a search or filter in progress: Back clears it first
    const gm = Kit.mods.games && Kit.mods.games.ui, bm = Kit.mods.books && Kit.mods.books.ui;
    if (ui.sec === "watch" && (ui.libRes || ui.libBusy || ui.libQ || ui.libFilterQ)) { ui.libRes = null; ui.libBusy = false; ui.libQ = ""; ui.libFilterQ = ""; render(); return true; }
    if (ui.sec === "games" && gm && (gm.res || gm.busy || gm.q)) { gm.res = null; gm.busy = false; gm.q = ""; gm.sq = ""; render(); return true; }
    if (ui.sec === "books" && bm && (bm.res || bm.busy || bm.q)) { bm.res = null; bm.busy = false; bm.q = ""; bm.sq = ""; render(); return true; }
    if (ui.sel) { ui.sel = null; render(); return true; }
    // then back to the screen before
    while (backStack.length) {
      const b = backStack.pop();
      if (b.sec === ui.sec && b.tab === ui.tab) continue;
      if (b.sec === "watch") { ui.sec = "watch"; ui.tab = b.tab || "library"; render(); } else go(b.sec, undefined, true);
      setTimeout(() => window.scrollTo(0, b.y || 0), 0);
      return true;
    }
    if (ui.sec !== "home") { go("home", undefined, true); return true; }
    return false;
  };

  // ------------------------------------------------------------ actions
  const TRAKT_SKIP = "(^|/)(history|comments|likes|notes|recommendations|network|user-|profile)[^/]*$";
  async function doImport(kind) {
    // Trakt's history, comments and likes files aren't used and can be huge: they're left inside the ZIP
    const files = await Native.pick(kind !== "trakt" && kind !== "refract", kind === "trakt" ? TRAKT_SKIP : "");
    if (!files.length) return;
    await runJob("Import", async progress => {
      keepBeforeImport(kind === "trakt" ? "Trakt" : kind === "refract" ? "Refract" : kind === "franchise" ? "franchise file" : "IMDb");
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

  // 0.6.5: a source that keeps failing, in words: "IMDb ratings hasn't worked for 4 days (3 syncs in a row)"
  const healthText = h => `${h.label} ${h.okAt ? `hasn't worked for ${h.days ? `${h.days} day${h.days === 1 ? "" : "s"}` : "a day"}` : "has never worked"} (${h.streak} syncs in a row)`;
  const failedLabels = () => { try { return JSON.parse(db.get("last_failed", "[]")); } catch (e) { return []; } };
  const labelOf = line => (line.match(/^(?:OK|FAIL|PART)\s+([^:]+):/) || [])[1];

  // Sync: the sources (Trakt and IMDb side by side), then the library, Trakt, games and episodes, each with a time
  // limit. Posters, dates and streaming follow in the background. Everything is written to the Sync screen.
  function doSync(retryOnly = false, fullImdb = false) {
    const only = retryOnly ? new Set(failedLabels()) : null;
    if (!retryOnly && ui.sec !== "sync" && db.get("sync_open", "1") === "1") go("sync");
    if (!retryOnly && new Date(+db.get("snap_sync_at", "0") || 0).toDateString() !== new Date().toDateString()) { if (snapshot("before the first sync of the day")) db.set("snap_sync_at", String(Date.now())); }
    return runJob(retryOnly ? "Retry" : "Sync", async progress => {
      const http = C.robust(Native.http, { timeout: 30000, tries: 2 });
      const r = await C.syncAll(db, Native.http, (f, t) => progress(f == null ? null : f * 0.7, t), only, { fullImdb });
      if (only) {
        const fresh = new Map(r.report.split("\n").map(l => [labelOf(l), l]));
        ui.report = (ui.report || "").split("\n").map(l => fresh.get(labelOf(l)) || l).join("\n");
      } else ui.report = r.report;
      db.set("last_report", ui.report);
      for (const h of C.sourceHealth(db)) if (h.streak === 3) Native.notify(C.hashId("sick|" + h.label), `${h.label} keeps failing`, `${healthText(h)}: ${h.msg}`.slice(0, 200), "sync");
      invalidate();
      await C.breathe();
      if (feat("streamAlerts")) for (const n of C.streamAlerts(db, await statusSoon(), myServices())) Native.notify(n.id, n.title, n.text, n.tab);
      await C.breathe();
      progress(0.72, "Library, Trakt, games and episodes");
      const post = await postSync((f, t) => progress(null, t), http);
      db.set("stage_report", post);
      await C.breathe();
      setTimeout(afterSync, 300);
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

  // live number next to a slider (inline handlers are blocked by the content security policy)
  document.addEventListener("input", e => { const el = e.target; if (el && el.dataset && el.dataset.setting === "widget_alpha") { const v = document.getElementById("walphaV"); if (v) v.textContent = el.value + "%"; } });

  document.addEventListener("click", e => {
    let el = e.target.closest("[data-action]");
    // 0.6.8: the title and year under a cover open it too (only the picture used to)
    if (!el) { const tile = e.target.closest(".tile"); const p = tile && tile.querySelector("[data-action]"); if (p) { p.click(); return; } }
    if (!el) return;
    lastTap = Date.now();
    const a = el.dataset.action;
    if (a === "dismiss") { if (e.target === el) closeOverlay(); return; }
    if (a.startsWith("lib") && libAct(a, el)) { if (a === "libseasonopen") return; e.preventDefault(); return; }
    if ((a.startsWith("mlist") || a.startsWith("mrule")) && myListAct(a, el)) { e.preventDefault(); return; }
    if (a === "imdbfull") { e.preventDefault(); doSync(false, true); return; }
    for (const m of Object.values(Kit.mods)) if (m.act && m.act(a, el, e)) { e.preventDefault(); return; }
    switch (a) {
      case "search": openSearch(); break;
      case "person": openPerson(el.dataset.name); break;
      case "copyval": Native.copy(el.dataset.text || ""); toast("Copied"); break;
      case "calnow": pushCalendar().then(() => { toast(calUrl() ? "Calendar link ready" : "Couldn't reach the website"); render(); }); break;
      case "calnew": webApi("POST", "api/calendar", { text: icsText().text, renew: true }).then(r => { db.set("cal_path", r.path); toast("New address: the old one stops working"); render(); }, e => toast(e.message)); break;
      case "snaprestore": restoreSnap(+el.dataset.n); break;
      case "sendto": { let item = {}; try { item = JSON.parse(el.dataset.item); } catch (e) { break; }
        const note = prompt(`A note for ${el.dataset.to}? (optional)`, ""); if (note === null) break;
        webApi("POST", "api/send", { to: el.dataset.to, item, note }).then(() => toast(`Sent to ${el.dataset.to}`), e => toast(/403/.test(e.message) ? "Both of you need sharing on (Settings › Accounts and sync)" : e.message)); break; }
      case "inboxopen": { const x = inbox().find(y => y.id === el.dataset.id); if (x && (x.item.type === "movie" || x.item.type === "show")) openTitle(Object.assign({ why: `from ${x.from}${x.note ? ": " + x.note : ""}` }, x.item)); else if (x) toast(`${x.from} sent ${x.item.title}`); break; }
      case "inboxdone": { const id = el.dataset.id; db.cacheSet("inbox:now", { at: Date.now(), items: inbox().filter(y => y.id !== id) }); render(); webApi("POST", "api/inbox", { done: id }).catch(() => {}); break; }
      case "actopen": { const P = people().find(p => p.name === el.dataset.p), x = P && (P.recent || [])[+el.dataset.i]; if (x) openTitle(Object.assign({ why: `${P.name} ${ACT[x.kind] || x.kind} it ${WHEN(x.date)}` }, x)); break; }
      case "webadmin": openAdmin(); break;
      case "snapnow": toast(snapshot("kept by hand") ? "Copy kept" : "Couldn't keep a copy"); render(); break;
      case "dupopen": openDuplicates(); break;
      case "dupmerge": { const P = ui.dups && ui.dups[el.dataset.kind][+el.dataset.i]; if (!P) break; snapshot("before merging duplicates");
        if (el.dataset.kind === "lib") { L.mergeItems(lib, P.a, P.b); libSave(); } else { GC.mergeGames(games, P.a, P.b); games.save(); }
        toast("Merged"); openDuplicates(); render(); break; }
      case "dupskip": { const P = ui.dups && ui.dups[el.dataset.kind][+el.dataset.i]; if (!P) break; const sk = dupSkip(); sk[[P.a.id, P.b.id].sort().join("|")] = 1; db.set("dup_skip", JSON.stringify(sk)); openDuplicates(); break; }
      case "dupall": { const d = ui.dups; if (!d) break; snapshot("before merging duplicates"); let n = 0;
        for (const P of d.lib) if (lib.get(P.a.id) && lib.get(P.b.id)) { L.mergeItems(lib, P.a, P.b); n++; }
        for (const P of d.games) if (games.get(P.a.id) && games.get(P.b.id)) { GC.mergeGames(games, P.a, P.b); n++; }
        libSave(); games.save(); toast(`${fmt(n)} merged · Settings › History can undo it`); openDuplicates(); render(); break; }
      case "findadd": { const c = sheetItems.get(el.dataset.id); if (!c) break; const x = c.src || {};
        const r = libAdd({ type: c.medium === "TV Series" ? "show" : "movie", title: c.title, year: c.year, tmdb: c.tmdb, imdb: c.imdb, poster: x.poster || "", overview: x.overview || "" }, el.dataset.st);
        closeOverlay(); render(); const it = r && (r.item || r); if (it && it.id) openLib(it.id); break; }
      case "recopen": { const x = (recsNow() || { items: [] }).items.find(y => y.type + y.tmdb === el.dataset.k); if (x) openTitle(Object.assign({ why: "because you rated " + x.because.join(", ") }, x)); break; }
      case "friendopen": { const P = people().find(p => p.name === el.dataset.p), x = P && P.lib[+el.dataset.i]; if (x) openTitle(Object.assign({ why: `${P.name}: ★ ${x.rating || "–"}` }, x)); break; }
      case "personopen": { const w = ui.person && ui.person.works && ui.person.works[+el.dataset.i]; if (w) openTitle(Object.assign({ why: w.roles.slice(0, 2).join(", ") }, w)); break; }
      case "sqwatch": { const x = lib.get(el.dataset.id); if (x) { const u = libUndo(x); lib.setStatus(x, "watched"); libSave(); toast(`Watched ${x.title}`, u); if ($("#allRes")) $("#allRes").innerHTML = searchResults(); } break; }
      case "personadd": { const w = ui.person && ui.person.works && ui.person.works[+el.dataset.i]; if (w) { libAdd({ type: w.type, title: w.title, year: w.year, tmdb: w.tmdb, poster: w.poster }, "watchlist"); drawPerson(); } break; }
      case "libcast": { const it = lib.get(ui.libOpen); if (!it) break; ui.libCast = { id: it.id, busy: true }; openLib(it.id);
        C.titleInfo(db, Native.http, libCanon(it)).then(inf => { ui.libCast = { id: it.id, inf }; }, e => { ui.libCast = { id: it.id, err: e.message }; }).then(() => { if (ui.libOpen === it.id) openLib(it.id); }); break; }
      case "libposters": { const it = lib.get(ui.libOpen); if (!it) break; ui.libPosters = { id: it.id, busy: true }; openLib(it.id);
        C.tmdbPosters(db, Native.http, libCanon(it)).then(list => { ui.libPosters = { id: it.id, list }; }, e => { ui.libPosters = { id: it.id, err: e.message }; }).then(() => { if (ui.libOpen === it.id) openLib(it.id); }); break; }
      case "libposter": { const it = lib.get(ui.libOpen), P = ui.libPosters; if (!it || !P || !P.list) break; const old = it.poster;
        it.poster = P.list[+el.dataset.i]; it.posterSet = true; it.updated = Date.now(); libSave(); ui.libPosters = null; openLib(it.id); render();
        toast("Poster changed", () => { it.poster = old; it.posterSet = false; libSave(); if (ui.libOpen === it.id) openLib(it.id); render(); }); break; }
      case "go": { const sc = el.dataset.scroll; closeOverlay(); if (el.dataset.sec === "settings") ui.setGroup = sc ? SET_ANCHOR[sc] || "" : ""; go(el.dataset.sec); if (sc) setTimeout(() => { const t = document.getElementById(sc); if (t) t.scrollIntoView({ block: "start" }); }, 40); break; }
      case "icsexport": { const c = icsText(); if (!c.n) { toast("Nothing dated in the next six months"); break; } Native.saveAs("saga-upcoming.ics", c.text).then(ok => toast(ok ? `${c.n} dates saved. Open the file to add them to your calendar.` : "Not saved")); break; }
      case "mvshare": { const name = el.dataset.mv, n = C.norm(name), rows = status().filter(c => C.norm(c.franchise) === n).sort((a, b) => C.releaseKey(a).localeCompare(C.releaseKey(b)));
        if (!rows.length) { toast("No canon entries in this multiverse yet"); break; }
        const text = `# ${name}\n` + rows.map(c => `${c.title}${c.year ? ` (${c.year})` : ""}`).join("\n") + "\n";
        Native.saveAs(`${name.replace(/[^\w ]+/g, "").trim() || "canon"} canon list.txt`, text).then(ok => toast(ok ? `${rows.length} entries saved. Anyone can load it with Settings › Import › Franchise mapping file.` : "Not saved")); break; }
      case "listpurge": { const [src, ...nm] = el.dataset.k.split("|"), name = nm.join("|"), gone = listOnlyItems(src, name);
        const total = syncedLists().find(l => l.source === src && l.name === name);
        confirmDialog(`Switch off “${name || src}”?`, `${gone.length ? `${fmt(gone.length)} title${gone.length === 1 ? "" : "s"} that only this list brought will be removed` : "No titles came only from this list"}. Titles also on another list or in your ratings, and anything you've rated, ticked or written notes on, stay.${total ? ` The list has ${fmt(total.n)} entries.` : ""}`, "Switch off and remove", () => {
          snapshot(`before removing the titles of “${name || src}”`);
          const before = JSON.stringify(lib.toJSON());
          let st = {}; try { st = JSON.parse(db.get("lib_lists", "{}")) || {}; } catch (e) { st = {}; }
          st[el.dataset.k] = 0; db.set("lib_lists", JSON.stringify(st));
          for (const it of gone) lib.remove(it.id);
          libSave(); closeOverlay(); ui.libOpen = null; render();
          toast(`List switched off, ${fmt(gone.length)} title${gone.length === 1 ? "" : "s"} removed`, () => { const j = JSON.parse(before); lib.items = j.items; lib.adopted = j.adopted; lib.outbox = j.outbox || []; lib._ix = null; delete st[el.dataset.k]; db.set("lib_lists", JSON.stringify(st)); libSave(); render(); });
        });
        break; }
      case "listlib": { let st = {}; try { st = JSON.parse(db.get("lib_lists", "{}")) || {}; } catch (e) { st = {}; }
        const [src, ...nm] = el.dataset.k.split("|"), on = el.dataset.on ? true : !listOn(src, nm.join("|")); st[el.dataset.k] = on ? 1 : 0; db.set("lib_lists", JSON.stringify(st));
        const b = libTotals(); libAdopt(); libSave(); const a = libTotals(); toast(on ? `List switched on: ${fmt(a.titles - b.titles)} titles added` : "List switched off (titles already added stay)"); render(); break; }
      case "lookback": { delete lib.adopted[el.dataset.k]; const b = libTotals(); libAdopt(); libSave(); const a = libTotals(); toast(a.titles > b.titles ? "Brought into the library" : "Updated"); render(); break; }
      case "theme": setLook("saga_theme", el.dataset.v === "night" ? "" : el.dataset.v); render(); break;
      case "whatsnew": whatsNew(true); break;
      case "updcheck": checkUpdate(true); break;
      case "recsnow": recsRefresh(true); break;
      case "itadin": itadSignIn(); break;
      case "alin": Native.openUrl(Imports.anilistAuthUrl(db.get("anilist_client_id"))); toast("Approve Saga on AniList; you'll come back here by yourself"); break;
      case "alout": db.set("anilist_token", ""); db.flush(); toast("Signed out of AniList"); render(); break;
      case "alpaste": { const u = prompt("Paste the address the browser showed after approving (it starts with " + anilistRedirect() + ")"); if (u) anilistFinish(u); break; }
      case "itadout": db.set("itad_token", ""); db.flush(); toast("Signed out of IsThereAnyDeal"); render(); break;
      case "itadnow": runJob("IsThereAnyDeal", async () => itadRefresh(Native.http, true)); break;
      case "itadpaste": { const u = prompt("Paste the address the browser showed after approving (it starts with " + itadRedirect() + ")"); if (u) itadFinish(u); break; }
      case "webshare": { const on = el.checked; db.set("web_share", on ? "1" : "0"); webApi("POST", "api/share", { on }).then(() => { toast(on ? "Sharing with the other people on the website" : "Not sharing any more"); peopleRefresh(false); }, e => { toast(e.message); db.set("web_share", on ? "0" : "1"); render(); }); break; }
      case "peoplenow": peopleRefresh(true); break;
      case "friendadd": { const P = people().find(x => x.name === el.dataset.p), x = P && P.lib[+el.dataset.i]; if (x) { libAdd({ type: x.type, title: x.title, year: x.year, imdb: x.imdb, tmdb: x.tmdb, poster: x.poster }, "watchlist"); render(); } break; }
      case "recf": ui.recF = el.dataset.v; render(); break;
      case "recadd": { const x = (recsNow() || { items: [] }).items.find(y => y.type + y.tmdb === el.dataset.k); if (x) { libAdd({ type: x.type, title: x.title, year: x.year, tmdb: x.tmdb, poster: x.poster, overview: x.overview }, "watchlist"); render(); } break; }
      case "rechide": { const h = recsHidden(); h.add(el.dataset.k); db.set("recs_hide", JSON.stringify([...h].slice(-500))); render(); toast("Won't suggest it again", () => { const h2 = recsHidden(); h2.delete(el.dataset.k); db.set("recs_hide", JSON.stringify([...h2])); render(); }); break; }
      case "updget": Native.openUrl(updateUrl()); break;
      case "updhide": db.set("upd_hide", db.get("upd_ver", "")); render(); break;
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
      case "umode": case "utierf": case "umissing": case "uedit": case "umore": case "utier": case "umove": universeAct(a, el); break;
      case "tlhome": closeOverlay(); go("timeline"); Kit.mods.timeline.openStory(el.dataset.k); break;
      case "yearstep": ui.year = (ui.year || new Date().getFullYear()) + (+el.dataset.v); render(); break;
      case "wrapped": openWrapped(); break;
      case "wipe": { const cats = [...document.querySelectorAll("[data-wipe]")].filter(x => x.checked).map(x => x.dataset.wipe);
        if (!cats.length) { toast("Tick what to clear"); break; }
        confirmDialog("Clear these parts?", cats.map(c => "• " + WIPE.find(w => w[0] === c)[1]).join("\n") + "\n\nA copy is kept first: you can undo it.", "Clear", () => wipe(cats)); break; }
      case "websync": syncWithWebServer(true).then(() => render()); break;
      case "pickedit": ui.pickEdit = !ui.pickEdit; render(); break;
      // 0.5.8: select many titles in the library and change them together
      case "libselstart": ui.sel = new Set(); render(); break;
      case "libselend": ui.sel = null; render(); break;
      case "libsel": if (ui.sel) { const id = el.dataset.id; if (ui.sel.has(id)) ui.sel.delete(id); else ui.sel.add(id); render(); } break;
      case "libselall": if (ui.sel) { for (const t of document.querySelectorAll('#view [data-action="libsel"]')) ui.sel.add(t.dataset.id); render(); } break;
      case "libbulk": if (ui.sel && ui.sel.size) {
        const ids = [...ui.sel].filter(id => lib.get(id)), v = el.dataset.v;
        if (v === "list") { bulkListSheet(ids); break; }
        if (v === "tag") { sheet(`<h3>Tag ${fmt(ids.length)} titles</h3><label class="field"><span>Tag</span><input id="bulktag" maxlength="40" placeholder="e.g. comfort"></label><button class="btn primary" data-action="libbulktag">Add the tag</button>`); break; }
        if (v === "remove" && !el.dataset.sure) { el.dataset.sure = "1"; el.textContent = `Tap again to remove ${ids.length}`; break; }
        for (const id of ids) { const it = lib.get(id); if (!it) continue; if (v === "remove") lib.remove ? lib.remove(id) : delete lib.items[id]; else lib.setStatus(it, v); }
        libSave(); toast(v === "remove" ? `Removed ${ids.length}` : `${ids.length} marked ${LST[v] || v}`); ui.sel = null; render(); }
        break;
      case "libbulktag": { const t = (($("#bulktag") || {}).value || "").trim(); if (!t || !ui.sel) break; for (const id of ui.sel) { const it = lib.get(id); if (it) { it.tags = it.tags || []; if (!it.tags.includes(t)) it.tags.push(t); } }
        libSave(); closeOverlay(); toast(`Tagged ${ui.sel.size}`); ui.sel = null; render(); break; }
      case "bulklistput": { const L2 = myLists(), l = L2.find(x => x.id === el.dataset.l); if (l && ui.bulkIds) { for (const id of ui.bulkIds) { const k = "lib:" + id; if (!l.items.includes(k)) l.items.push(k); } saveMyLists(L2); toast(`Added ${ui.bulkIds.length} to ${l.name}`); closeOverlay(); ui.sel = null; render(); } break; }
      case "pickhide": { let h = {}; try { h = JSON.parse(db.get("pick_hide", "{}")) || {}; } catch (e2) { h = {}; }
        const days = el.dataset.v === "mood" ? 7 : 90, now = Date.now();
        for (const k of Object.keys(h)) if (h[k] < now) delete h[k];
        h[el.dataset.k] = now + days * 864e5; db.set("pick_hide", JSON.stringify(h));
        if (el.dataset.v === "seen" && el.dataset.k.startsWith("lib:")) { const it = lib.get(el.dataset.k.slice(4)); if (it && it.type === "movie" && it.status === "watchlist") { lib.setStatus ? lib.setStatus(it, "watched") : (it.status = "watched"); libSave(); } }
        toast(days === 7 ? "Hidden for a week" : "Hidden for 90 days"); render(); break; }
      case "wrapshare": { const t = wrappedText(wrappedData(ui.year || new Date().getFullYear())); let ok = false; try { ok = !!(window.Banta && Banta.share && Banta.share(`My year in Saga`, t)); } catch (e) { ok = false; } if (!ok) { Native.copy(t); toast("Copied: paste it anywhere"); } break; }
      case "wrapcopy": Native.copy(wrappedText(wrappedData(ui.year || new Date().getFullYear()))); toast("Copied"); break;
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
      case "undoimport": undoImport(); break;
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
      case "aimodels": { commitFields(); const cfg = { preset: db.get("ai_preset"), key: db.get("ai_key"), base: db.get("ai_base") };
        toast("Asking the server…");
        C.localModels(C.robust(Native.http, { timeout: 20000, tries: 1 }), cfg).then(list => { ui.aiModels = list; toast(list.length ? `Connected: ${list.length} model${list.length === 1 ? "" : "s"}. Tap one to use it` : "Connected, but the server has no models yet"); render(); }, e => toast("Couldn't connect: " + e.message));
        break; }
      case "aimodelpick": db.set("ai_model", el.dataset.v); db.flush(); render(); break;
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
      case "hubpick": Native.pick(true).then(files => { if (!files.length) return; previewImport(files); }); break;
      case "hubsteam": hubSteam(); break;
      case "diaryf": ui.diaryF = el.dataset.v; ui.diaryN = 200; openDiary(); break;
      case "diarymore": ui.diaryN = (ui.diaryN || 200) + 300; openDiary(); break;
      case "recentall": openDiary(); break;
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
      case "copystalls": Native.copy(`Saga ${VERSION}: ${ui.stalls}`); toast("Copied"); break;
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

  // 0.6.2: Ctrl+K / Cmd+K (or / outside a text box) opens the search on a computer; Escape closes any sheet
  document.addEventListener("keydown", e => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target && e.target.tagName) || "");
    if ((e.key === "k" || e.key === "K") && (e.ctrlKey || e.metaKey) && !e.altKey) { e.preventDefault(); openSearch(); return; }
    if (e.key === "/" && !typing && !$("#overlay").innerHTML) { e.preventDefault(); openSearch(); return; }
    if (e.key === "Escape" && $("#overlay").innerHTML) { e.preventDefault(); closeOverlay(); }
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
    if (el.dataset && el.dataset.libnotes) { const it = lib.get(ui.libOpen); if (it) { it.notes = el.value.trim(); libTouch(); } return; }
    if (el.dataset && el.dataset.accent) { setLook("saga_accent", el.value); return; }
    if (el.dataset && el.dataset.textsize) { setLook("saga_text", el.checked ? "large" : ""); return; }
    if (el.dataset && el.dataset.lang) { BantaShell.setLang(el.value); toast(el.value === "it" ? "Italiano attivo" : "English on"); render(); return; }
    if (el.dataset && el.dataset.feature) {
      BantaShell.setFeature(el.dataset.feature, el.checked);
      db.set("features_seen", "1");
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
    if (k.startsWith("widget_")) { widgetCache["widget_style.txt"] = null; updateWidget(); }
    if (k === "ai_preset") ui.aiModels = null;
    if (k === "ai_preset" || k === "ai_key" || k === "ai_base" || k === "ai_model") render(); // the key field and scan button follow the chosen service
    if (k.startsWith("bg_")) {
      applyBackground();
      if (k === "bg_enabled" && v === "1") Native.requestNotifications();
      render();
    }
    db.flush();
  });

  // leaving the app: everything written now and waited for, so a background sync starts from the latest copy
  // leaving the app: everything not yet written is written at once (the background job reads these files)
  const saveAllNow = () => { commitFields(); if (libPending()) libWrite(true); else libOwnStamp(); gamesFile.now(); booksFile.now(); if (db._timer || db._flushing || db._cacheDirty || db._dirty) db.flush(true); };
  window.addEventListener("pagehide", saveAllNow);
  document.addEventListener("visibilitychange", () => { if (document.hidden) saveAllNow(); });
  window.__paused = saveAllNow;

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
    if (libPending()) libWrite(true); // our own unsaved changes first, so they're never taken for the background job's
    if (db.reload()) { invalidate(); ui.report = db.get("last_report", ui.report); }
    const ls = window.Android && Android.stamp ? String(Android.stamp("library.json") || "") : "";
    if (ls && ls !== libOwnStamp()) { libStamp = ls; const fresh = new L.Library({ load: () => Native.load("library.json") }); lib.items = fresh.items; lib.adopted = fresh.adopted; lib.outbox = fresh.outbox; libMirror(); }
    try { const gs = Android.stamp("games.json"); if (gs && gs !== ui.gStamp) { if (ui.gStamp) { const t = Native.load("games.json"); if (t) games.fromJSON(JSON.parse(t)); } ui.gStamp = gs; } } catch (e) { /* not in the app */ }
    try { const bs = Android.stamp("books.json"); if (bs && bs !== ui.bStamp) { if (ui.bStamp) { const t = Native.load("books.json"); if (t) books.fromJSON(JSON.parse(t)); } ui.bStamp = bs; } } catch (e) { /* not in the app */ }
    applyPending();
    livePull();
    if (Date.now() - (WS.get().at || 0) > 10 * 60000) webSyncSoon(3000);
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
  try { const fx = fixListedWatched(); if (fx && (fx.films || fx.games)) { render(); setTimeout(() => toast(`${fmt(fx.films)} titles and ${fmt(fx.games)} games were only on a list, not rated: back to To watch / Wishlist`), 1200); } } catch (e) { logError("fixlisted", e.message); }
  applyPending();
  setTimeout(() => window.__sharePoll(), 400);
  applyBackground();
  try { autoBackup(); } catch (e) { /* tried again next start */ }
  try { backupToFile(false).catch(() => {}); } catch (e) { /* next time */ }
  setTimeout(() => livePull(), 4000);
  if (lsGet("saga_theme")) setLook("saga_theme", lsGet("saga_theme")); // the phone's bars follow the theme
  // (automated test browsers skip it unless they ask, so it doesn't cover what they're testing)
  setTimeout(() => { try { if (!$(".sheet") && !BantaAI.isOpen() && (!navigator.webdriver || window.__wantWhatsNew)) whatsNew(false); } catch (e) { logError("whatsnew", e.message); } }, 900);
  // 0.6.5: friends, suggestions and the update check also when no sync runs (the website, a quick look)
  if (!navigator.webdriver) setTimeout(() => { peopleRefresh(false).catch(() => {}); recsRefresh(false).catch(() => {}); checkUpdate(false).catch(() => {}); }, 15000);
  setInterval(() => { if (!document.hidden) livePull(); }, 5 * 60000);
  setTimeout(() => { fillImages().catch(() => {}); if (secOn("games")) GC.linkSteam(games, Saga.http, 40, 700).then(n => { if (n) { games.save(); if (!document.querySelector("#overlay .sheet")) render(); } }).catch(() => {}); }, 2500);
  if (db.get("bg_enabled", "1") === "1" && !db.get("notif_asked")) { Native.requestNotifications(); db.set("notif_asked", "1"); }
  const last = parseFloat(db.get("last_sync", "0")) || 0;
  const hasSources = db.get("username") || db.get("imdb_user") || db.get("canon_urls") || db.get("imdb_lists");
  if (db.get("auto_sync") === "1" && hasSources && Date.now() / 1000 - last > AUTO_SYNC_HOURS * 3600) { db.set("sync_open", "0"); doSync(); db.set("sync_open", "1"); }
  window.__app = { fixListedWatched, webApi, webWhy, openLib, wipe, syncWithWebServer, whatsNew, setLook, icsText, forYou, picksToday, imgState, applyRule, RULE_PRESETS, wrappedData, wrappedText, universeEntries, openWrapped, livePull, ownTraktChange, logError, widgetFiles, fillImages, lib, libAdopt, db, ui, render, setTab, go, Native, invalidate, games, books, migrate, doSync, bundle, applyBackup, readBackup2, yearCounts, sealBackup, openBackup, restoreFrom, undoRestore, bundleOut };
})();
