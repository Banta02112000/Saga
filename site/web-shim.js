/* Saga website: stands in for the phone's bridge (window.Android, window.Banta) so the same app runs in a browser.
   Files live on the Saga server (your Pi): all of them are read once when the page opens, then kept in memory;
   every change is sent to the server in the background, in order. Calls to other sites go through the server
   (a browser can't call Trakt, TMDB or IMDb directly). Loaded before everything else by the server. */
(function () {
  "use strict";
  var files = {}, shas = {}, queue = {}, unsent = 0, seq = 0, results = {}, bodies = {}, reloadWanted = false, pend = {}, stale = {};
  var TAB = Math.random().toString(36).slice(2);
  var api = function (p) { return "api/" + p; };
  // ---- every file, once, before the app starts (one request)
  var online = false;
  try {
    var x = new XMLHttpRequest();
    x.open("GET", api("all"), false);
    x.send();
    if (x.status === 200) { files = JSON.parse(x.responseText) || {}; online = true; try { shas = JSON.parse(x.getResponseHeader("X-Sha") || "{}") || {}; } catch (e) { shas = {}; } }
    else if (x.status === 401) { offlineClear(); location.href = "login"; return; }
    else window.__sagaServerError = "The Saga server answered " + x.status;
  } catch (e) { window.__sagaServerError = "Can't reach the Saga server: " + e.message; }
  // ---- 0.7.0: offline. This browser keeps a copy of your files (IndexedDB) and the changes it couldn't send yet. When
  // the server can't be reached, the app opens from that copy; changes wait and go out when it's back (the server
  // merges them with whatever the phone sent meanwhile). The app's scripts start once the files are there.
  var IDB = "saga-offline", waiting = {}; // name → { text, base, baseText } not sent yet
  var known = {}; Object.keys(files).forEach(function (n) { known[n] = files[n]; }); // what the server last confirmed
  function wait(name, text) { var w = waiting[name]; waiting[name] = { text: text, base: (w && w.base) || shas[name] || "", baseText: w && w.baseText != null ? w.baseText : (known[name] != null ? known[name] : "") }; keepWaiting(); }
  // a change kept while offline goes out merged against the version it started from
  function sendWaiting(n, w) {
    if (w.baseText == null) { if (w.base) shas[n] = w.base; send(n, "PUT", w.text); return; }
    unsent++;
    fetch(api("merge/" + encodeURIComponent(n)), { method: "POST", headers: { "Content-Type": "application/json", "X-Tab": TAB }, body: JSON.stringify({ base: w.baseText, mine: w.text }) })
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(function (j) { shas[n] = j.sha256; known[n] = j.text; if (j.text !== files[n]) live(n, j.text); keepCopy(); })
      .catch(function (e) { waiting[n] = w; keepWaiting(); console.error("Saga: couldn't send " + n, e); })
      .then(function () { unsent--; });
  }
  function idb(fn) {
    return new Promise(function (res) {
      try { var rq = indexedDB.open(IDB, 1); rq.onupgradeneeded = function () { rq.result.createObjectStore("kv"); };
        rq.onsuccess = function () { try { var tx = rq.result.transaction("kv", fn.length > 1 ? "readwrite" : "readonly"); var st = tx.objectStore("kv"); var out = fn(st, true); tx.oncomplete = function () { res(out && out.result !== undefined ? out.result : out); }; tx.onerror = function () { res(null); }; } catch (e) { res(null); } };
        rq.onerror = function () { res(null); };
      } catch (e) { res(null); }
    });
  }
  var idbGet = function (k) { return idb(function (st) { return st.get(k); }); };
  var idbPut = function (k, v) { return idb(function (st, w) { st.put(v, k); return null; }); };
  function offlineClear() { try { indexedDB.deleteDatabase(IDB); } catch (e) { /* none */ } }
  var keepT = null;
  function keepCopy() { clearTimeout(keepT); keepT = setTimeout(function () { var f = {}; Object.keys(files).forEach(function (n) { if (!/^(secrets|keys)\.json$/.test(n)) f[n] = files[n]; }); idbPut("files", { files: f, shas: shas, at: Date.now() }); }, 1500); }
  function keepWaiting() { idbPut("waiting", waiting); }
  var bar = function (html) { var b = document.getElementById("offlinebar"); if (!html) { if (b) b.remove(); return; } if (!b) { b = document.createElement("div"); b.id = "offlinebar"; document.body.prepend(b); } b.innerHTML = html; };
  var when = function (t) { try { return new Date(t).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }); } catch (e) { return ""; } };
  function startApp() {
    var go = function () {
      var list = (document.body.getAttribute("data-scripts") || "").split(",").filter(Boolean);
      list.forEach(function (src) { var el = document.createElement("script"); el.src = src; el.async = false; document.body.appendChild(el); });
    };
    if (document.body) go(); else document.addEventListener("DOMContentLoaded", go);
  }
  window.__sagaBoot = (online ? Promise.all([idbGet("waiting")]).then(function (r) {
    keepCopy();
    var w = r[0] || {};
    // changes made here while the server was away: sent now, merged on the server, the result shown
    Object.keys(w).forEach(function (n) { if (w[n] && typeof w[n].text === "string") { files[n] = w[n].text; later(function () { sendWaiting(n, w[n]); }); } });
    if (Object.keys(w).length) idbPut("waiting", {});
  }) : idbGet("files").then(function (c) {
    if (!c || !c.files) return;
    files = c.files; shas = c.shas || {}; Object.keys(files).forEach(function (n) { known[n] = files[n]; });
    return idbGet("waiting").then(function (w) {
      waiting = w || {}; Object.keys(waiting).forEach(function (n) { files[n] = waiting[n].text; });
      delete window.__sagaServerError;
      window.__sagaOffline = { at: c.at };
      var show = function () { bar("<b>Offline</b>: your data as of " + when(c.at) + ". Changes are kept in this browser and sent when the website is back."); };
      if (document.body) show(); else document.addEventListener("DOMContentLoaded", show);
    });
  })).catch(function () { /* start anyway */ }).then(startApp);
  // back online: the changes kept here go out
  function flushWaiting() {
    var names = Object.keys(waiting); if (!names.length) return;
    fetch(api("me"), { cache: "no-store" }).then(function (r) {
      if (!r.ok) return;
      var w = waiting; waiting = {}; keepWaiting();
      names.forEach(function (n) { sendWaiting(n, w[n]); });
      window.__sagaOffline = null; bar(""); if (window.__sagaOnline) try { window.__sagaOnline(); } catch (e) { /* app older */ }
    }).catch(function () { /* still away */ });
  }
  window.addEventListener("online", flushWaiting);
  setInterval(function () { if (Object.keys(waiting).length || window.__sagaOffline) { if (!Object.keys(waiting).length) { fetch(api("me"), { cache: "no-store" }).then(function (r) { if (r.ok) { window.__sagaOffline = null; bar(""); } }).catch(function () {}); } else flushWaiting(); } }, 20000);
  var stampOf = function (t) { t = t || ""; return t.length + ":" + t.slice(-16); };
  // 0.6.9.4: a file changed on the server (the phone synced, another page saved, a webhook): its new text is handed to
  // the open page, which shows it in place. The page used to reload itself each time, which looked like it refreshing on
  // its own (and two open pages could set each other off).
  function live(name, text) {
    files[name] = text;
    if (window.__sagaLive) { try { if (window.__sagaLive(name, text) !== false) return; } catch (e) { console.error(e); } }
    reloadWanted = true; if (unsent === 0) setTimeout(function () { if (unsent === 0) location.reload(); }, 600);
  }
  function fetchLive(name) {
    if (pend[name]) { stale[name] = true; return; } // ours first: the server merges and sends back the result
    fetch(api("file/" + encodeURIComponent(name)), { headers: { "X-Tab": TAB } }).then(function (r) {
      if (r.status === 401) { location.href = "login"; return null; }
      if (!r.ok) return null;
      var h = r.headers.get("X-Sha");
      return r.text().then(function (t) { if (pend[name]) { stale[name] = true; return; } if (h) shas[name] = h; if (t !== files[name]) live(name, t); });
    }).catch(function () { /* next change */ });
  }
  function send(name, method, text) {
    unsent++; pend[name] = (pend[name] || 0) + 1;
    var prev = queue[name] || Promise.resolve();
    var p = prev.then(function () {
      var h = { "Content-Type": "text/plain; charset=utf-8", "X-Tab": TAB };
      if (method === "PUT" && shas[name]) h["X-Base-Sha"] = shas[name];
      return fetch(api("file/" + encodeURIComponent(name)), { method: method, body: text, headers: h })
        .then(function (r) {
          if (r.status === 401) { location.href = "login"; throw new Error("signed out"); }
          if (r.status === 409) { delete h["X-Base-Sha"]; return fetch(api("file/" + encodeURIComponent(name)), { method: "PUT", body: text, headers: h }).then(function (r2) { return r2.json(); }).then(function (j) { if (j && j.sha256) shas[name] = j.sha256; }); } // the server lost track: this page's version goes in
          if (!r.ok) throw new Error("HTTP " + r.status);
          return r.json().then(function (j) {
            if (j && j.sha256) shas[name] = j.sha256;
            known[name] = j && j.merged ? j.text : text;
            keepCopy();
            // changes from the phone were folded in on the server: show them
            if (j && j.merged) live(name, j.text);
          }, function () {});
        })
        .catch(function (e) {
          // 0.7.0: the server can't be reached: kept in this browser, sent when it's back
          if (method === "PUT" && SYNCED.test(name) && (e instanceof TypeError || /fetch|network/i.test(e.message))) {
            wait(name, text);
            if (!window.__sagaOffline) { window.__sagaOffline = { at: Date.now() }; bar("<b>Offline</b>: changes are kept in this browser and sent when the website is back."); }
            return;
          }
          console.error("Saga: couldn't save " + name, e); window.__sagaSaveError = name + ": " + e.message; });
    }).then(function () { unsent--; pend[name]--; if (!pend[name] && stale[name]) { stale[name] = false; fetchLive(name); } if (unsent === 0 && reloadWanted) location.reload(); });
    queue[name] = p;
    return p;
  }
  // 0.7.0: while this website runs an older Saga than your phone, its changes to your data aren't sent (an older
  // version could undo what the newer one did); the page says so and the website updates itself
  var paused = false, held = 0, SYNCED = /^(canonsync|library|games|books|dw|music)\.json$/;
  function save(name, text) { text = String(text == null ? "" : text); files[name] = text; if (paused && SYNCED.test(name)) { held++; return true; }
    if (window.__sagaOffline && SYNCED.test(name)) { wait(name, text); keepCopy(); return true; }
    send(name, "PUT", text); return true; }
  function append(name, text) { text = String(text || ""); files[name] = (files[name] || "") + text; send(name, "POST", text); return true; }
  // the phone (or another page) changed a file on the server: reload to show it, once nothing of ours is unsaved
  try {
    var es = new EventSource(api("events"));
    es.onmessage = function (ev) { try { var m = JSON.parse(ev.data); if (m.from === TAB) return; (m.files || []).forEach(fetchLive); } catch (e) { /* ignore */ } };
  } catch (e) { /* no live updates */ }
  window.addEventListener("beforeunload", function (e) { if (unsent > 0 && !window.__sagaOffline) { e.preventDefault(); e.returnValue = "Still saving"; } });
  var later = function (fn) { setTimeout(fn, 0); };
  var deliver = function (fn, id, text) { results[id] = text; later(function () { if (window[fn]) window[fn](id); }); };
  var bufs = {};
  // ---- calls to other sites, through the server
  function http(id, method, url, headerText, body) {
    var headers = {};
    String(headerText || "").split("\n").forEach(function (l) { var i = l.indexOf(":"); if (i > 0) headers[l.slice(0, i).trim()] = l.slice(i + 1).trim(); });
    fetch(api("http"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ method: method, url: url, headers: headers, body: body || "" }) })
      .then(function (r) { return r.json(); })
      .then(function (r) { var b = r.body == null ? "" : String(r.body); bodies[id] = b; delete r.body; r.split = 1; r.len = b.length; deliver("__httpDone", id, JSON.stringify(r)); })
      .catch(function (e) { deliver("__httpDone", id, JSON.stringify({ status: 0, headers: {}, body: "", error: "Saga server: " + e.message })); });
  }
  // ---- choosing files (exports, backups); a .zip is opened by the server
  function pick(id, multiple) {
    var inp = document.createElement("input");
    inp.type = "file"; inp.multiple = !!multiple;
    var done = false;
    inp.onchange = function () {
      done = true;
      var list = Array.prototype.slice.call(inp.files || []);
      Promise.all(list.map(function (f) {
        if (/\.zip$/i.test(f.name)) return f.arrayBuffer().then(function (buf) {
          return fetch(api("unzip"), { method: "POST", body: buf }).then(function (r) { return r.json(); })
            .then(function (z) { return z.error ? { name: f.name, error: z.error } : { name: f.name, zip: z.zip, zipOther: z.other || [] }; });
        }).catch(function (e) { return { name: f.name, error: String(e.message || e) }; });
        return f.text().then(function (t) { return { name: f.name, text: t }; }, function (e) { return { name: f.name, error: String(e) }; });
      })).then(function (out) { deliver("__pickDone", id, JSON.stringify(out)); });
    };
    window.addEventListener("focus", function f() { window.removeEventListener("focus", f); setTimeout(function () { if (!done && !(inp.files && inp.files.length)) deliver("__pickDone", id, "[]"); }, 1500); });
    inp.click();
  }
  function download(name, text) {
    try { var a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text], { type: "application/octet-stream" })); a.download = name; document.body.appendChild(a); a.click(); a.remove(); return true; } catch (e) { return false; }
  }
  var noop = function () {};
  window.Android = {
    // files
    load: function (n) { return files[n] || ""; },
    save: save,
    saveLater: save,
    appendLater: append,
    stamp: function (n) { return stampOf(files[n]); },
    ownStamp: function (n) { return stampOf(files[n]); },
    bufAdd: function (k, t) { bufs[k] = (bufs[k] || "") + t; },
    bufDrop: function (k) { delete bufs[k]; },
    saveBuf: function (n, k) { if (!(k in bufs)) return false; var t = bufs[k]; delete bufs[k]; return save(n, t); },
    secretsLoad: function () { return files["secrets.json"] || ""; },
    secretsSave: function (t) { return save("secrets.json", t); },
    // answers
    http: http,
    take: function (id) { var r = results[id]; delete results[id]; return r || ""; },
    takeLength: function () { return -1; },
    takePart: function () { return ""; },
    takeBody: function (id) { var b = bodies[id]; delete bodies[id]; return b || ""; },
    takeBodyPart: function (id, a, e) { var b = bodies[id] || ""; if (e >= b.length) delete bodies[id]; return b.slice(a, e); },
    // the hidden IMDb browser doesn't exist on the website: IMDb is read through its data service instead
    browse: function (id) { deliver("__httpDone", id, JSON.stringify({ status: 0, error: "No hidden browser on the website" })); },
    // files you choose and files to download
    pick: pick,
    pickSkip: function (id, multiple) { pick(id, multiple); },
    saveAs: function (id, name, text) { deliver("__saveDone", id, download(name, text) ? "true" : "false"); },
    pickBackupFile: noop,
    writeUri: function () { return false; },
    writeUriBuf: function (id, uri, k) { delete bufs[k]; deliver("__saveDone", id, "false"); },
    takeShared: function () { return ""; },
    // the phone's own things: nothing to do on a website
    copy: function (t) { try { navigator.clipboard.writeText(t); } catch (e) { /* no clipboard */ } },
    openUrl: function (u) { window.open(u, "_blank", "noopener"); },
    openInApp: function (u) { window.open(u, "_blank", "noopener"); },
    openClassic: function (u) { window.open(u, "_blank", "noopener"); },
    notify: noop, notifyAction: noop, status: noop, clearStatus: noop, requestNotifications: noop,
    setBars: noop, setBackground: noop, done: noop, randomUrl: function () { return ""; },
    watchScreen: noop, screenReport: function () { return "0"; },
  };
  // the shared bridge the tabs use (features, Doctor Who, games…): the same files
  window.Banta = {
    read: function (n) { return files[n] || ""; },
    write: function (n, t) { return save(n, t); },
    remove: function (n) { delete files[n]; fetch(api("file/" + encodeURIComponent(n)), { method: "DELETE" }).catch(noop); },
    stamp: function (n) { return stampOf(files[n]); },
    take: function () { return ""; }, post: noop, busy: noop, notify: noop, widget: noop, shareTo: function () { return false; },
    share: function (title, text) { try { if (navigator.share) { navigator.share({ title: title, text: text }).catch(noop); return true; } } catch (e) { /* no share sheet */ } return false; },
  };
  window.__sagaWeb = { pending: function () { return unsent; }, files: function () { return Object.keys(files); }, user: "", me: null,
    pause: function (on) { paused = !!on; }, paused: function () { return paused; }, held: function () { return held; } };
  window.__sagaWeb.ready = fetch(api("me")).then(function (r) { return r.json(); }).then(function (m) { window.__sagaWeb.user = m.user || ""; window.__sagaWeb.me = m; return m; }).catch(function () { return null; });
  // 0.6.2: installable, and the app and its pictures open even when the server can't be reached.
  // Browsers only allow this on https (a Cloudflare Tunnel, Tailscale serve) or on localhost.
  try { if ("serviceWorker" in navigator && window.isSecureContext) navigator.serviceWorker.register("sw.js").catch(noop); } catch (e) { /* not available */ }
})();
