/* Saga website: stands in for the phone's bridge (window.Android, window.Banta) so the same app runs in a browser.
   Files live on the Saga server (your Pi): all of them are read once when the page opens, then kept in memory;
   every change is sent to the server in the background, in order. Calls to other sites go through the server
   (a browser can't call Trakt, TMDB or IMDb directly). Loaded before everything else by the server. */
(function () {
  "use strict";
  var files = {}, shas = {}, queue = {}, unsent = 0, seq = 0, results = {}, bodies = {}, reloadWanted = false;
  var TAB = Math.random().toString(36).slice(2);
  var api = function (p) { return "api/" + p; };
  // ---- every file, once, before the app starts (one request)
  try {
    var x = new XMLHttpRequest();
    x.open("GET", api("all"), false);
    x.send();
    if (x.status === 200) { files = JSON.parse(x.responseText) || {}; try { shas = JSON.parse(x.getResponseHeader("X-Sha") || "{}") || {}; } catch (e) { shas = {}; } }
    else if (x.status === 401) { location.href = "login"; return; }
    else window.__sagaServerError = "The Saga server answered " + x.status;
  } catch (e) { window.__sagaServerError = "Can't reach the Saga server: " + e.message; }
  var stampOf = function (t) { t = t || ""; return t.length + ":" + t.slice(-16); };
  function send(name, method, text) {
    unsent++;
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
            // changes from the phone were folded in on the server: show them
            if (j && j.merged) { files[name] = j.text; reloadWanted = true; }
          }, function () {});
        })
        .catch(function (e) { console.error("Saga: couldn't save " + name, e); window.__sagaSaveError = name + ": " + e.message; });
    }).then(function () { unsent--; if (unsent === 0 && reloadWanted) location.reload(); });
    queue[name] = p;
    return p;
  }
  function save(name, text) { text = String(text == null ? "" : text); files[name] = text; send(name, "PUT", text); return true; }
  function append(name, text) { text = String(text || ""); files[name] = (files[name] || "") + text; send(name, "POST", text); return true; }
  // the phone (or another page) changed a file on the server: reload to show it, once nothing of ours is unsaved
  try {
    var es = new EventSource(api("events"));
    es.onmessage = function (ev) { try { var m = JSON.parse(ev.data); if (m.from === TAB) return; reloadWanted = true; if (unsent === 0) setTimeout(function () { if (unsent === 0) location.reload(); }, 600); } catch (e) { /* ignore */ } };
  } catch (e) { /* no live updates */ }
  window.addEventListener("beforeunload", function (e) { if (unsent > 0) { e.preventDefault(); e.returnValue = "Still saving"; } });
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
  window.__sagaWeb = { pending: function () { return unsent; }, files: function () { return Object.keys(files); }, user: "" };
  fetch(api("me")).then(function (r) { return r.json(); }).then(function (m) { window.__sagaWeb.user = m.user || ""; }).catch(function () {});
})();
