// Saga: the website: two-way sync (only changes since 0.7.0), history and undo, keys and settings for the website,
// sharing and friends, the calendar feed, the owner's page and website updates.
// A part of app.js, in its own file: it gets what it uses from the rest of the app through A, and gives back what
// the app uses (made by scripts/split_app.js; the names it uses are listed in app.js where it's put together).
(function (root) {
  "use strict";
  (root.SagaParts = root.SagaParts || {}).website = function (A) {
  // ---- 0.5.9: two-way sync with the Saga website (site/server.js). Each file the phone or the website changed since
  // they last agreed is sent; the server merges it entry by entry (site/merge.js) and both keep the result.
  const WEB_FILES = ["canonsync.json", "library.json", "games.json", "books.json", "dw.json", "music.json", "keys.json"];
  const fileStamp = t => (t ? t.length + ":" + t.slice(-24) : "");
  let webSyncing = false, webSyncT = null;
  // its own small file, so keeping track doesn't itself change the synced files
  const WS = { get: () => { try { return JSON.parse(A.Native.load("web_sync.json") || "{}") || {}; } catch (e) { return {}; } }, set: o => A.Native.save("web_sync.json", JSON.stringify(Object.assign(WS.get(), o))) };
  // 0.6.9.6: settings that live outside the settings file (sections on or off, language, look) go into it, so they
  // reach the website with everything else and come back; and, if you say so, your keys and sign-ins too.
  const LOOK_KEYS = ["saga_theme", "saga_accent", "saga_text"];
  function prefsOut() {
    try { const f = JSON.stringify(A.SH.readJson("features.json") || {}); if (f !== A.db.get("prefs_features", "")) { A.db.set("prefs_features", f); A.db.flush(); } } catch (e) { /* next time */ }
  }
  function prefsIn() {
    let changedAny = false;
    try {
      const want = A.db.get("prefs_features", "");
      if (!want) prefsOut();
      else if (want !== JSON.stringify(A.SH.readJson("features.json") || {})) { A.SH.write("features.json", want); changedAny = true; try { BantaShell.applyFeatures && BantaShell.applyFeatures(); } catch (e) { /* older shell */ } }
      for (const k of LOOK_KEYS) { const v = A.db.get("look_" + k, ""); if (!v) continue; const val = v === "-" ? "" : v; if (val !== A.lsGet(k)) { A.setLook(k, val, true); changedAny = true; } }
    } catch (e) { A.logError("settings", e.message); }
    return changedAny;
  }
  // the keys file for the website: only when "Send my keys and sign-ins to my website" is on
  const KEYS_OUT = () => A.db.get("web_keys", "0") === "1";
  function keysText() { const k = Object.fromEntries(Object.entries(Object.assign(Object.fromEntries(Object.entries(A.db.settings).filter(([n]) => A.C.SECRET_RX.test(n))), A.db.secretsOn() ? A.db.secretsAll() : {})).filter(([n, v]) => v && n !== "backup_secrets")); return Object.keys(k).length ? JSON.stringify(k, Object.keys(k).sort()) : ""; }
  function keysIn(text) {
    let k = {}; try { k = JSON.parse(text || "{}") || {}; } catch (e) { return 0; }
    let n = 0; for (const [name, v] of Object.entries(k)) if (A.C.SECRET_RX.test(name) && typeof v === "string" && v && A.db.get(name, "") !== v) { A.db.set(name, v); n++; }
    if (n) A.db.flush(); return n;
  }
  // 0.6.9.2: the website's address as typed, made usable: no "https://" → added; a trailing slash dropped
  function webBase() {
    let u = String(A.db.get("web_sync_url", "")).trim().replace(/\/+$/, "");
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
  function webSyncSoon(ms = 30000) { if (!A.db.get("web_sync_url") || A.db.get("web_sync_auto", "1") !== "1") return; clearTimeout(webSyncT); webSyncT = setTimeout(() => syncWithWebServer(false).catch(() => {}), ms); }
  // ---- 0.6.5: friends on your Saga website (each person decides to share; see /api/people on the server)
  async function webApi(method, pth, body) {
    if (window.__sagaWeb) { const r = await fetch(pth, { method, credentials: "same-origin", headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined }); if (!r.ok) throw new Error(`the website answered ${r.status}`); return r.json(); }
    const base = webBase();
    if (!base) throw new Error("set the website address first");
    const H = Object.assign({ Accept: "application/json" }, body ? { "Content-Type": "application/json" } : {}, A.db.get("web_sync_key") ? { Authorization: "Bearer " + A.db.get("web_sync_key") } : {});
    const r = await A.Native.http(method, base + "/" + pth, { headers: H, body: body ? JSON.stringify(body) : undefined });
    if (r.status !== 200) throw new Error(webWhy(r));
    return JSON.parse(r.body);
  }
  // 0.7.0: the website runs an older Saga than your phone: it doesn't save changes to your data (the older version could
  // undo what the newer did) and updates itself when it can; it says so on every screen
  async function behindCheck(m) {
    const pv = m && m.phone && m.phone.version;
    window.__sagaPhoneSeen = !!pv; // 0.7.8: with a phone, the phone does the Doctor Who mirroring (no double adds)
    if (!pv || A.verNum(pv) <= A.verNum(A.VERSION)) return;
    window.__sagaWeb.pause(true);
    const bar = (html) => { let b = document.getElementById("behindbar"); if (!b) { b = document.createElement("div"); b.id = "behindbar"; document.body.prepend(b); } b.innerHTML = html; };
    bar(`<b>Your phone runs Saga ${A.esc(pv)}, this website ${A.VERSION}.</b> Updating the website… Changes made here now aren't saved.`);
    let r = null;
    try { r = await webApi("POST", "api/admin/update", {}); } catch (e) { r = { ok: false, error: /403/.test(e.message) ? "only the website's owner can update it" : e.message }; }
    if (r && r.ok && r.restart) { bar(`<b>Updating the website to Saga ${A.esc(r.to)}…</b> This page reloads in a few seconds.`); setTimeout(() => location.reload(), 8000); return; }
    if (r && r.ok && !r.restart) { window.__sagaWeb.pause(false); bar(`Your phone runs Saga ${A.esc(pv)}; the newest on GitHub is ${A.esc(r.to || A.VERSION)}, which this website already has. <button class="btn quiet small" onclick="this.parentNode.remove()">OK</button>`); return; }
    bar(`<b>Your phone runs Saga ${A.esc(pv)}, this website ${A.VERSION}:</b> changes made here aren't saved until it's updated (${A.esc((r && r.error) || "no answer")}). On the Pi: <code>bash /opt/saga/app/site/update.sh</code>`);
  }
  // 0.6.9.9: the website's owner updates it from here (it pulls the newest Saga from GitHub and restarts)
  async function webUpdate() {
    A.toast("Asking the website to update…");
    let r;
    try { r = await webApi("POST", "api/admin/update", {}); }
    catch (e) { A.toast(/404|not found/i.test(e.message) ? "This website is too old to update itself from here: on the Pi run bash /opt/saga/app/site/update.sh (only this once)" : `Couldn't update the website: ${e.message}`); return; }
    if (!r || !r.ok) { A.toast(`The website couldn't update: ${(r && r.error) || "no answer"}`); return; }
    if (!r.restart) { A.toast(`The website already has the newest Saga on GitHub (${r.to || r.from})`); return; }
    if (!window.__sagaWeb) WS.set({ ver: r.to || "" }); A.render();
    A.toast(`The website is updating to Saga ${r.to}: back in a few seconds`);
    if (window.__sagaWeb) setTimeout(() => location.reload(), 8000);
  }
  const people = () => { const p = A.db.cacheGet("people:now"); return (p && p.people) || []; };
  async function peopleRefresh(loud) {
    if (!window.__sagaWeb && !A.db.get("web_sync_url")) return;
    try { const r = await webApi("GET", "api/people"); A.db.cacheSet("people:now", { at: Date.now(), people: r.people || [] });
      try { A.db.cacheSet("inbox:now", { at: Date.now(), items: await webApi("GET", "api/inbox") }); } catch (e) { /* older website */ }
      if (loud) A.toast(r.people.length ? `${r.people.length} sharing with you` : "Nobody shares with you yet"); A.render(); }
    catch (e) { if (loud) A.toast(`Friends: ${e.message}`); }
  }
  // the same title in a friend's library
  const friendKey = x => x.imdb ? "i:" + x.imdb : x.tmdb ? "t:" + x.type + x.tmdb : "n:" + x.type + A.C.norm(x.title) + (x.year || "");
  function friendsOn(it) {
    const out = [];
    for (const P of people()) { const f = P.lib.find(x => (it.imdb && x.imdb === it.imdb) || (it.tmdb && x.tmdb === it.tmdb && x.type === it.type) || (x.type === it.type && A.C.norm(x.title) === A.C.norm(it.title) && (!it.year || !x.year || Math.abs(x.year - it.year) <= 1)));
      if (f) out.push({ name: P.name, status: f.status, rating: f.rating }); }
    return out;
  }
  // you and one friend: taste match on titles you both rated, both seen, both want, what they loved that you haven't seen
  function friendCompare(P) {
    const mine = new Map(A.lib.all().map(it => [friendKey(it), it]));
    const both = [], bothWant = [], loved = [];
    for (const x of P.lib) {
      const it = mine.get(friendKey(x)) || A.lib.find({ type: x.type, imdb: x.imdb, tmdb: x.tmdb, title: x.title, year: x.year });
      if (it && it.rating && x.rating) both.push([it.rating, x.rating]);
      if (it && it.status === "watchlist" && x.status === "watchlist") bothWant.push(it);
      if (!it && x.rating >= 8) loved.push(x);
    }
    const match = both.length >= 3 ? Math.round(100 - both.reduce((a, [m, f]) => a + Math.abs(m - f), 0) / both.length * 11) : null;
    const seen = P.lib.filter(x => x.status === "watched" || x.status === "watching").filter(x => { const it = mine.get(friendKey(x)); return it && (it.status === "watched" || it.status === "watching"); }).length;
    return { match: match == null ? null : Math.max(0, Math.min(100, match)), rated: both.length, seen, bothWant, loved: loved.sort((a, b) => b.rating - a.rating) };
  }
  // 0.6.9: what friends sent you, and sending a title to them
  const inbox = () => { const b = A.db.cacheGet("inbox:now"); return (b && b.items) || []; };
  function inboxHtml() {
    const box = inbox(); if (!box.length) return "";
    return `<section>${Kit.head("From friends")}<div class="listcard">${box.slice(0, 8).map(x => `<div class="item" data-action="inboxopen" data-id="${A.esc(x.id)}" role="button">
      <div class="grow" style="min-width:0"><b class="ell">${A.esc(x.item.title)}</b><div class="small muted ell">${A.esc([x.from + " sent it", x.item.year, x.item.type === "show" ? "Series" : x.item.type === "movie" ? "Film" : x.item.type === "game" ? "Game" : "Book", x.note ? "“" + x.note + "”" : ""].filter(Boolean).join(" · "))}</div></div>
      <button class="iconbtn" data-action="inboxdone" data-id="${A.esc(x.id)}" aria-label="Done with it">${A.icon("x")}</button></div>`).join("")}</div></section>`;
  }
  const sendButtons = x => people().length ? `<div class="row wrap" style="margin:6px 0">${people().map(P => `<button class="btn small quiet" data-action="sendto" data-to="${A.esc(P.name)}" data-item="${A.esc(JSON.stringify({ type: x.type, title: x.title, year: x.year || null, tmdb: x.tmdb || null, imdb: x.imdb || null, poster: /^https:/.test(x.poster || "") ? x.poster : "" }))}">${A.icon("share")}Send to ${A.esc(P.name)}</button>`).join("")}</div>` : "";
  const WHEN = d => { try { return new Date(d + "T12:00:00").toLocaleDateString(A.lang() === "it" ? "it-IT" : "en-GB", { day: "numeric", month: "short" }); } catch (e) { return d; } };
  const ACT = { watched: "watched", finished: "watched", episode: "watched", played: "finished", read: "read" };
  // 0.6.9.5: sharing, chosen per person and per part
  const SHARE_LABEL = { lib: "Films & series", games: "Games", books: "Books", dw: "Doctor Who" };
  function loadShare() { if (A.ui.shareLoading) return; A.ui.shareLoading = true; webApi("GET", "api/share").then(r => { A.ui.share = r; A.db.set("web_share", r.on ? "1" : "0"); }, () => { A.ui.share = { on: A.db.get("web_share") === "1", to: null, people: [], failed: true }; }).then(() => { A.ui.shareLoading = false; if (A.ui.sec === "settings") A.render(); }); }
  function saveShare(st) {
    A.ui.share = st; A.render();
    webApi("POST", "api/share", { on: !!st.on, to: st.to || undefined }).then(r => { A.ui.share = Object.assign({}, st, { people: r.people || st.people }); A.db.set("web_share", st.on ? "1" : "0"); peopleRefresh(false); A.render(); }, e => A.toast(e.message));
  }
  function shareHtml() {
    const st = A.ui.share;
    if (!st) { loadShare(); return `<p class="small muted">Sharing: asking the website…</p>`; }
    const to = st.to || Object.fromEntries((st.people || []).map(n => [n, { lib: true, games: true, books: true, dw: false }]));
    return `<div class="card" style="padding:10px"><label class="switch"><input type="checkbox" data-action="shareon" ${st.on ? "checked" : ""}><span><b>Share with people on this website</b><small class="muted" style="display:block">They see titles, status and ratings (never notes, diary or keys) of the parts you pick for each of them. You see theirs if they share with you.</small></span></label>
      ${st.on && (st.people || []).length ? (st.people || []).map(n => `<div style="margin:8px 0 2px"><b>${A.esc(n)}</b></div><div class="chips">${Object.keys(SHARE_LABEL).map(k => `<button class="chip" data-action="sharepart" data-p="${A.esc(n)}" data-k="${k}" aria-pressed="${!!(to[n] || {})[k]}">${SHARE_LABEL[k]}</button>`).join("")}</div>`).join("") : st.on ? `<p class="small muted">Nobody else has an account on this website yet.</p>` : ""}
      ${st.failed ? `<p class="small muted">The website didn't answer: try again later.</p>` : ""}</div>`;
  }
  function friendsHtml() {
    const ps = people(); if (!ps.length) return "";
    return ps.map(P => { const c = friendCompare(P);
      return `<section>${Kit.head(`You and ${A.esc(P.name)}`)}
        <div class="sstrip"><div><b>${c.match == null ? "–" : c.match + "%"}</b><span>taste match${c.rated ? ` (${c.rated} both rated)` : ""}</span></div><div><b>${A.fmt(c.seen)}</b><span>both watched</span></div><div><b>${A.fmt(c.bothWant.length)}</b><span>both want to watch</span></div><div><b>${A.fmt(P.games.filter(g => g.status === "done").length)}</b><span>games ${A.esc(P.name)} finished</span></div></div>
        ${P.dw ? `<p class="small muted" style="margin:6px 0">Doctor Who: ${A.fmt(P.dw.done)} stories done${P.dw.avg != null ? ` · average ${P.dw.avg}` : ""}</p>` : ""}
        ${(P.recent || []).length ? `<h4>Lately</h4><div class="listcard">${P.recent.slice(0, 6).map((x, i) => `<div class="item"${x.type === "movie" || x.type === "show" ? ` data-action="actopen" data-p="${A.esc(P.name)}" data-i="${i}" role="button"` : ""}><div class="grow" style="min-width:0"><b class="ell">${A.esc(x.title)}</b><div class="small muted ell">${A.esc([`${P.name} ${ACT[x.kind] || x.kind}${x.kind === "episode" ? " S" + String(x.ep).replace(":", " E") : ""}`, x.rating ? "★ " + x.rating : "", WHEN(x.date)].filter(Boolean).join(" · "))}</div></div></div>`).join("")}</div>` : ""}
        ${c.bothWant.length ? `<h4>You both want to watch</h4><div class="listcard">${c.bothWant.slice(0, 8).map(it => `<div class="item" data-action="libopen" data-id="${A.esc(it.id)}">${A.libThumb(it)}<b class="grow ell">${A.esc(it.title)}</b><span class="small muted">${A.esc(it.year || "")}</span></div>`).join("")}</div>` : ""}
        ${c.loved.length ? `<h4>${A.esc(P.name)} loved, you haven't seen</h4><div class="listcard">${c.loved.slice(0, 8).map((x, i) => `<div class="item" data-action="friendopen" data-p="${A.esc(P.name)}" data-i="${P.lib.indexOf(x)}" role="button"><div class="grow" style="min-width:0"><b class="ell">${A.esc(x.title)}</b><div class="small muted">${A.esc([x.year, x.type === "show" ? "Series" : "Film", "★ " + x.rating].filter(Boolean).join(" · "))}</div></div><button class="btn quiet small" data-action="friendadd" data-p="${A.esc(P.name)}" data-i="${P.lib.indexOf(x)}">${A.icon("plus")}Add</button></div>`).join("")}</div>` : ""}</section>`; }).join("");
  }
  // 0.6.9: the calendar on your Saga website, for Google Calendar (or any calendar app) to subscribe to
  async function pushCalendar() {
    if (!window.__sagaWeb && !A.db.get("web_sync_url")) return;
    try { const c = A.icsText(); const r = await webApi("POST", "api/calendar", { text: c.text }); if (r && r.path) { A.db.set("cal_path", r.path); } } catch (e) { A.logError("calendar", e.message); }
  }
  const calUrl = () => { const base = window.__sagaWeb ? location.origin + location.pathname.replace(/[^/]*$/, "") : webBase() + "/"; return A.db.get("cal_path") ? base + A.db.get("cal_path") : ""; };
  // 0.6.9: the website's owner page: who has an account and when they last came by, space left, backups, updates
  async function openAdmin() {
    A.$("#overlay").innerHTML = `<div class="scrim bottom" data-action="dismiss"><div class="sheet" role="dialog" aria-modal="true"><h3 style="margin:0">Your Saga website</h3><p class="small muted">Asking the website…</p></div></div>`;
    let a;
    try { a = await webApi("GET", "api/admin"); } catch (e) { A.$("#overlay .sheet").innerHTML = `<h3 style="margin:0">Your Saga website</h3><p class="small muted">${/403/.test(e.message) ? "Only the website's owner sees this page." : A.esc(e.message)}</p>`; return; }
    const ago = t => !t ? "never" : (() => { const m = Math.round((Date.now() - t) / 60000); return m < 2 ? "just now" : m < 120 ? m + " min ago" : m < 2880 ? Math.round(m / 60) + " h ago" : Math.round(m / 1440) + " days ago"; })();
    const mb = n => (n / 1048576).toFixed(n < 10485760 ? 1 : 0) + " MB", gb = n => (n / 1073741824).toFixed(1) + " GB";
    const low = a.disk && a.disk.free < 1073741824;
    A.$("#overlay .sheet").innerHTML = `<h3 style="margin:0">Your Saga website</h3><p class="small muted" style="margin:2px 0 10px">Saga ${A.esc(a.version)} · Node ${A.esc(a.node)} · running for ${a.uptime > 86400 ? Math.round(a.uptime / 86400) + " days" : Math.round(a.uptime / 3600) + " h"}</p>
      <div class="sstrip"><div><b>${a.people.length}</b><span>accounts</span></div><div><b${low ? ' style="color:#f0883e"' : ""}>${a.disk ? gb(a.disk.free) : "?"}</b><span>free on the Pi${a.disk ? " of " + gb(a.disk.total) : ""}</span></div><div><b>${a.lastDaily ? A.esc(a.lastDaily.slice(5)) : "–"}</b><span>last daily copy</span></div><div><b>${a.autoUpdate ? "on" : "off"}</b><span>nightly updates</span></div></div>
      ${low ? `<p class="small" style="color:#f0883e">Less than 1 GB free on the Pi: when the card is full, saving stops working. Delete old files or move to a bigger card.</p>` : ""}
      <h4>People</h4><div class="listcard">${a.people.map(p => `<div class="item"><div class="grow" style="min-width:0"><b>${A.esc(p.name)}</b>${p.owner ? ' <span class="muted small">(owner)</span>' : ""}<div class="small muted">last here ${ago(p.at)} · last phone sync ${ago(p.sync)} · ${mb(p.size)}${p.shares ? " · shares" : ""}${p.calendar ? " · calendar" : ""}</div></div></div>`).join("")}</div>
      <p class="small muted">App updates on the download page: ${a.apks.length ? A.esc(a.apks.join(", ")) : "none (copy APKs into /opt/saga/data/apk/)"}.${a.autoUpdate ? "" : " Nightly updates: <code>bash /opt/saga/app/site/auto-update.sh on</code>."}</p>
      ${a.imdbCheck ? `<p class="small${a.imdbCheck.state === "changed" ? "" : " muted"}"${a.imdbCheck.state === "changed" ? ' style="color:#f0883e"' : ""}>Daily IMDb check (${A.esc(new Date(a.imdbCheck.at).toLocaleString())}): ${a.imdbCheck.state === "ok" ? "IMDb answers the way Saga reads it" : a.imdbCheck.state === "changed" ? "IMDb changed something Saga reads: " + A.esc(a.imdbCheck.lines.join(" · ")) : "no usable answer from IMDb today (it turned the Pi away)"}.</p>` : ""}
      <button class="btn small" data-action="webupdate">${A.icon("sync")}Update the website from GitHub${A.verNum(a.version) < A.verNum(A.VERSION) ? ` (it has ${A.esc(a.version)}, this ${window.__sagaWeb ? "page" : "app"} ${A.VERSION})` : ""}</button>`;
  }
  // 0.7.0: every change the website has seen, newest first: what, where it came from, and an undo for each
  const HIST_FILE = { "library.json": "Films & series", "games.json": "Games", "books.json": "Books", "dw.json": "Doctor Who", "canonsync.json": "Canon & settings", "music.json": "Music" };
  const HIST_DEV = { phone: "on the phone", web: "on the website", undo: "undone" };
  async function openHistory(before) {
    if (!before) A.$("#overlay").innerHTML = `<div class="scrim bottom" data-action="dismiss"><div class="sheet" role="dialog" aria-modal="true"><h3 style="margin:0">History of changes</h3><p class="small muted">Asking the website…</p></div></div>`;
    let h;
    try { h = await webApi("GET", "api/history?limit=100" + (before ? "&before=" + before : "")); }
    catch (e) { const sh = A.$("#overlay .sheet"); if (sh) sh.innerHTML = `<h3 style="margin:0">History of changes</h3><p class="small muted">${/404/.test(e.message) ? "Your website is older than 0.7.0: update it first (Settings › Website status)." : A.esc(e.message)}</p>`; return; }
    const items = h.items || [];
    const rows = items.map(x => `<div class="item"><div class="grow" style="min-width:0"><b class="ell">${A.esc(x.title)}</b><div class="small muted">${A.esc([x.what, HIST_FILE[x.file] || x.file, HIST_DEV[x.dev] || x.dev, WHEN(new Date(x.at).toISOString().slice(0, 10)) + " " + new Date(x.at).toTimeString().slice(0, 5)].join(" · "))}</div>${x.fields.length ? `<div class="small ell">${x.fields.map(f => `${A.esc(f.f)}: ${A.esc(f.from)} → ${A.esc(f.to)}`).join(" · ")}</div>` : ""}</div><button class="btn quiet small" data-action="webundo" data-file="${A.esc(x.file)}" data-r="${x.r}">Undo</button></div>`).join("");
    const more = items.length >= 100 ? `<button class="btn small" data-action="webhistmore" data-before="${items[items.length - 1].at}">Older</button>` : "";
    const sh = A.$("#overlay .sheet"); if (!sh) return;
    if (before) { const box = sh.querySelector(".histlist"); if (box) box.insertAdjacentHTML("beforeend", rows); const mb = sh.querySelector('[data-action="webhistmore"]'); if (mb) mb.outerHTML = more; return; }
    sh.innerHTML = `<h3 style="margin:0">History of changes</h3><p class="small muted" style="margin:2px 0 10px">Every change to your data that your website has seen, from the phone or the website. Undo puts that one title (or setting) back as it was before; the phone gets it at the next sync.</p>
      ${items.length ? `<div class="listcard histlist">${rows}</div>${more}` : `<p class="small muted">Nothing yet: changes are kept from Saga 0.7.0 on.</p>`}`;
  }
  async function undoChange(file, r, btn) {
    try { await webApi("POST", "api/history/undo", { file, r }); }
    catch (e) { A.toast("Couldn't undo: " + e.message); return; }
    if (btn) { btn.disabled = true; btn.textContent = "Undone"; }
    if (!window.__sagaWeb) { const msg = await syncWithWebServer(false); A.toast("Undone" + (/failed/.test(msg) ? ": it reaches the phone at the next sync" : "")); }
    else A.toast("Undone");
  }
  async function syncWithWebServer(loud) {
    const base = webBase();
    if (!base || webSyncing || A.ui.job) return "";
    webSyncing = true;
    const H = Object.assign({ Accept: "application/json" }, A.db.get("web_sync_key") ? { Authorization: "Bearer " + A.db.get("web_sync_key") } : {});
    const http = A.C.robust(A.Native.http, { timeout: 120000, tries: 2 });
    let sent = 0, got = 0;
    try {
      prefsOut();
      A.saveAllNow(); // everything written first
      const m = await http("GET", base + "/api/sync/manifest", { headers: H });
      if (m.status === 401) throw new Error("the website asked for the sync key (Settings › Accounts and sync › Saga website)");
      if (m.status !== 200) throw new Error(webWhy(m));
      const mj = JSON.parse(m.body), man = mj.files || {};
      // 0.6.9.9: which Saga the website runs (older websites only say it at /api/health)
      { let wv = mj.version || ""; if (!wv && Date.now() - (+WS.get().verAt || 0) > 6 * 3600e3) try { WS.set({ verAt: Date.now() }); const hr = await http("GET", base + "/api/health", { headers: H }); wv = (JSON.parse(hr.body || "{}") || {}).version || ""; } catch (e) { /* unknown */ }
        if (wv && wv !== WS.get().ver) WS.set({ ver: wv }); }
      if (mj.imdbCheck && JSON.stringify(mj.imdbCheck) !== JSON.stringify(WS.get().imdb || null)) WS.set({ imdb: mj.imdbCheck }); // 0.7.3: the Pi's daily IMDb check
      const last = WS.get().state || {};
      const changedHere = [];
      // 0.7.0: websites that keep a history send and take only the entries that changed; the first time (and whenever
      // the two disagree) the whole file goes, as before. A copy of everything is kept before the first one.
      const SE = window.SagaEntries, v2 = !!(mj.sync2 && SE), S2 = (WS.get().v2) || {};
      if (v2 && !WS.get().v2) { try { A.snapshot("before the website sync that sends only changes"); } catch (e) { /* no copy */ } }
      const saveV2 = async (n, rev, h) => { try { S2[n] = { rev, h: h || (SE.hashesAsync ? await SE.hashesAsync(n, SE.split(n, JSON.parse(A.Native.load(n) || "{}"))) : SE.hashes(n, SE.split(n, JSON.parse(A.Native.load(n) || "{}")))) }; WS.set({ v2: S2 }); } catch (e) { A.logError("website sync", n + ": " + e.message); } };
      for (const n of WEB_FILES) {
        // 0.6.9.6: keys.json is made here when you send your keys (from the phone's encrypted store, never a file here)
        if (n === "keys.json" && !KEYS_OUT()) continue;
        if (v2 && n !== "keys.json" && S2[n] && S2[n].rev != null) {
          const local = A.Native.load(n) || "";
          if (local) {
            await A.C.breathe(0);
            // 0.7.8: worked out a few milliseconds at a time, so the screen stays free
            const m = SE.split(n, JSON.parse(local)); await A.C.breathe(0);
            const dd = SE.diffAsync ? await SE.diffAsync(n, S2[n].h, m) : { patch: SE.diff(n, S2[n].h, m), h: null }, patch = dd.patch;
            if (!patch.length && mj.revs && mj.revs[n] === S2[n].rev) continue;
            const r = await http("POST", base + "/api/sync2/" + n, { headers: Object.assign({ "Content-Type": "application/json" }, H), body: JSON.stringify({ since: S2[n].rev, patch, version: A.VERSION }) });
            if (r.status !== 200) throw new Error(`${n}: ${webWhy(r)}`);
            const j = JSON.parse(r.body);
            if (!j.full) {
              SE.apply(m, j.changes || []);
              let hNow = dd.h;
              if (hNow) { hNow = Object.assign({}, hNow); for (const c of j.changes || []) { if (SE.isDevice(n, c[0])) continue; if (c.length < 2) delete hNow[c[0]]; else hNow[c[0]] = SE.hash(c[1]); }
                // a container marker the server added with its records
                for (const c of j.changes || []) { const t = c[0].indexOf("\t"); if (t > 0) { const f = c[0].slice(0, t); if (m.has(f) && !(f in hNow)) hNow[f] = SE.hash(m.get(f)); } } }
              if ((hNow && SE.digestOf ? SE.digestOf(hNow) : SE.digest(n, m)) === j.digest) {
                sent++;
                if ((j.changes || []).length) { applyWebFile(n, JSON.stringify(SE.join(m))); got++; changedHere.push(n); }
                await saveV2(n, j.rev, hNow);
                last[n] = { local: fileStamp(A.Native.load(n) || ""), server: null }; WS.set({ state: last });
                continue;
              }
              A.logError("website sync", `${n}: phone and website disagreed after sending changes; the whole file is compared instead`);
            }
          }
        }
        const local = n === "keys.json" ? keysText() : A.Native.load(n) || "";
        const st = last[n] || {}, srv = man[n] && man[n].sha256;
        if (local && fileStamp(local) === st.local && (!srv || srv === st.server)) continue;
        if (!local && !srv) continue;
        await A.C.breathe(0);
        const r = await http("POST", base + "/api/sync/file/" + n, { headers: Object.assign({ "Content-Type": "application/json", "X-Saga-Version": A.VERSION }, H), body: local || "" });
        if (r.status !== 200) throw new Error(`${n}: ${webWhy(r)}`);
        const j = JSON.parse(r.body);
        sent++;
        if (j.text !== local) { applyWebFile(n, j.text); got++; changedHere.push(n); }
        last[n] = { local: fileStamp((n === "keys.json" ? keysText() : A.Native.load(n)) || j.text), server: j.sha256 }; // what's on the phone now, as the phone wrote it
        WS.set({ state: last });
        if (v2 && j.rev != null && n !== "keys.json") await saveV2(n, j.rev);
      }
      const msg = !sent ? "nothing to do" : `${sent} file${sent === 1 ? "" : "s"} compared${got ? `, changes from the website in ${changedHere.map(n => n.replace(".json", "")).join(", ")}` : ""}`;
      WS.set({ at: Date.now(), msg });
      if (got) { prefsIn(); A.invalidate(); A.render(); }
      if (loud) A.toast("Website: " + msg);
      return msg;
    } catch (e) {
      WS.set({ at: Date.now(), msg: "failed: " + e.message }); A.logError("website sync", e.message);
      if (loud) A.toast("Website sync failed: " + e.message);
      return "failed: " + e.message;
    } finally { webSyncing = false; }
  }
  // a merged file from the website replaces the one in memory and on the phone
  // 0.6.9.4 (website): a file changed elsewhere, shown in place. Nothing is written back; if this page has unsaved
  // changes to the same file, they're saved first and the server sends the merged result here again.
  let liveT = null;
  window.__sagaLive = (n, text) => {
    if (!window.__sagaWeb || !text) return true;
    if (n === "library.json" && A.libPending()) { A.libWrite(true); return true; }
    if (n === "canonsync.json" && (A.db._timer || A.db._dirty)) { A.db.flush(); return true; }
    const d = JSON.parse(text);
    if (n === "canonsync.json") A.db.loadData(d);
    else if (n === "library.json") { const fresh = new A.L.Library({ load: () => text }); A.lib.items = fresh.items; A.lib.adopted = fresh.adopted; A.lib.outbox = fresh.outbox; A.mirrorDirty = true; }
    else if (n === "games.json") A.games.fromJSON(d);
    else if (n === "books.json") A.books.fromJSON(d);
    else if (n === "dw.json") { try { Kit.mods.timeline.reset(); } catch (e) { /* not loaded */ } }
    else if (n === "music.json") { try { Kit.mods.music.reset(); } catch (e) { /* not loaded */ } }
    else if (n === "keys.json") keysIn(text);
    else return true;
    if (n === "canonsync.json") prefsIn();
    A.invalidate();
    // shown when you're not typing and nothing is running
    clearTimeout(liveT);
    const show = () => { const a = document.activeElement; if (A.ui.job || (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName))) { liveT = setTimeout(show, 1500); return; } A.render(); };
    liveT = setTimeout(show, 300);
    return true;
  };
  function applyWebFile(n, text) {
    if (!text) return;
    const d = JSON.parse(text);
    if (n === "canonsync.json") { A.db.loadData(d); A.db.flush(true); }
    else if (n === "library.json") { const fresh = new A.L.Library({ load: () => text }); A.lib.items = fresh.items; A.lib.adopted = fresh.adopted; A.lib.outbox = fresh.outbox; A.libWrite(true); A.libMirror(); }
    else if (n === "games.json") { A.games.fromJSON(d); A.Native.save(n, text); }
    else if (n === "books.json") { A.books.fromJSON(d); A.Native.save(n, text); }
    else if (n === "dw.json") { A.Native.save(n, text); try { Kit.mods.timeline.reset(); } catch (e) { /* not loaded */ } }
    else if (n === "music.json") { A.Native.save(n, text); try { Kit.mods.music.reset(); } catch (e) { /* not loaded */ } }
    else if (n === "keys.json") keysIn(text);
  }
    return { WS, prefsOut, prefsIn, KEYS_OUT, keysText, keysIn, webBase, webWhy, webSyncSoon, webApi, behindCheck, webUpdate, people, peopleRefresh, friendsOn, inbox, inboxHtml, sendButtons, WHEN, ACT, saveShare, shareHtml, friendsHtml, pushCalendar, calUrl, openAdmin, openHistory, undoChange, syncWithWebServer };
  };
})(typeof window !== "undefined" ? window : this);
