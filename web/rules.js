// Saga: smart lists: every film, series, game and book as one row that rules can read.
// A part of app.js, in its own file: it gets what it uses from the rest of the app through A, and gives back what
// the app uses (made by scripts/split_app.js; the names it uses are listed in app.js where it's put together).
(function (root) {
  "use strict";
  (root.SagaParts = root.SagaParts || {}).rules = function (A) {
  // ---- 0.5.8: lists by rules. Every film, series, game and book as one row the rules can read.
  const STATUS_GROUP = { watchlist: "want", want: "want", wishlist: "want", backlog: "want", watching: "doing", playing: "doing", reading: "doing",
    watched: "done", done: "done", read: "done", paused: "paused", dropped: "dropped", dnf: "dropped" };
  function ruleRows() {
    const out = [];
    for (const it of A.lib.all()) {
      const inf = it.tmdb ? A.db.cacheGet(`info:${it.type === "show" ? "tv" : "m"}${it.tmdb}`) : null;
      const n = it.type === "show" && it.epl ? A.lib.nextEp(it) : null;
      const total = it.type === "show" && it.epl ? it.epl.filter(e => e[0] > 0).length : 0;
      out.push({ k: "lib:" + it.id, media: it.type, title: it.title, status: STATUS_GROUP[it.status] || it.status, rating: it.rating || 0, mins: it.type === "movie" ? it.runtime || 0 : 0,
        hours: 0, pages: 0, owned: !!it.owned, franchise: it.franchise || "", added: it.added || 0, year: it.year || 0,
        progress: total ? Math.round(Object.keys(it.eps || {}).length / total * 100) : 0, left: n && !n.upcoming ? n.left : null,
        offers: inf && inf.offers ? inf.offers.filter(o => /flatrate|free|ads/.test(o.type)).map(o => o.name) : null });
    }
    if (A.secOn("games")) for (const g of A.games.visible()) out.push({ k: "game:" + g.id, media: "game", title: g.title, status: STATUS_GROUP[g.status] || g.status, rating: g.rating || 0, mins: 0, hours: g.hours || 0, pages: 0,
      owned: !!g.owned, franchise: g.franchise || g.multiverse || "", added: g.added || 0, year: +(g.date || "").slice(0, 4) || 0, progress: 0, left: null, offers: null });
    if (A.secOn("books")) for (const b of A.books.books) out.push({ k: "book:" + b.id, media: "book", title: b.title, status: STATUS_GROUP[b.status] || b.status, rating: b.rating || 0, mins: 0, hours: 0, pages: b.pages || 0,
      owned: !!(b.owned || b.format), franchise: b.series || "", added: b.added || 0, year: +(b.published || "").slice(0, 4) || 0, progress: A.BC.percent ? A.BC.percent(b) : 0, left: null, offers: null });
    return out;
  }
  // a rule: { media: [], status: [], minRating, maxMins, maxHours, maxPages, ownedOnly, onMyServices, franchise, unrated, minProgress, sort }
  function applyRule(rule, rows = ruleRows()) {
    const r = rule || {}, svc = A.myServices().map(x => x.toLowerCase());
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
      const st = A.memo || [];
      const byF = new Map();
      for (const c of st) { const f = c.franchise; if (!f || f === "Unsorted") continue; const a = byF.get(f) || []; a.push(c); byF.set(f, a); }
      for (const [, list] of byF) {
        if (!list.some(c => c.state === "seen" || c.status === "seen")) continue;
        const next = list.filter(c => (c.state || c.status) !== "seen" && c.date && c.date <= A.TODAY()).sort((a, b) => String(a.date).localeCompare(String(b.date)))[0];
        if (!next) continue;
        const it = A.lib.all().find(x => (next.imdb && x.imdb === next.imdb) || A.L.norm(x.title) === A.L.norm(next.title));
        if (it) out.push("lib:" + it.id);
      }
    } catch (e) { /* the canon part needs the canon check */ }
    if (A.secOn("games")) {
      const byF = new Map();
      for (const g of A.games.visible()) { const f = g.franchise || g.multiverse; if (!f) continue; const a = byF.get(f) || []; a.push(g); byF.set(f, a); }
      for (const [, list] of byF) { if (!list.some(g => g.status === "done" || g.status === "playing")) continue; const n = list.filter(g => g.status === "backlog" || g.status === "wishlist").sort((a, b) => String(a.date || "9").localeCompare(String(b.date || "9")))[0]; if (n) out.push("game:" + n.id); }
    }
    if (A.secOn("books")) {
      const byS = new Map();
      for (const b of A.books.books) { if (!b.series) continue; const a = byS.get(b.series) || []; a.push(b); byS.set(b.series, a); }
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
    const sm = A.SMART.find(x => x[0] === id), l = sm ? null : A.myLists().find(x => x.id === id);
    const keys = sm ? sm[2]() : l && l.rule ? applyRule(l.rule) : ((l || {}).items || []);
    return keys.map(A.entryOf).filter(Boolean);
  }
  function listsSection() {
    const mine = A.myLists(), smart = A.SMART.map(([id, name]) => ({ id, name, n: listItems(id).length, smart: true })).filter(x => x.n);
    const all = [...mine.map(l => ({ id: l.id, name: l.name, n: listItems(l.id).length })), ...smart];
    if (!all.length) return "";
    return `<section>${Kit.head("Your lists", `<button class="btn quiet small" data-action="mlistnew">New list</button><button class="btn quiet small" data-action="mrulenew">Smart list</button>`)}${Kit.rail(all.map(l => `<button class="poster wide" data-action="mlistopen" data-l="${A.esc(l.id)}" style="text-align:left"><span class="gen" style="--h:${Kit.hue(l.name)}"><b>${A.esc(l.name)}</b><small>${A.fmt(l.n)} ${l.n === 1 ? "entry" : "entries"}${l.smart ? " · fills itself" : ""}</small></span></button>`))}</section>`;
  }
  function openMyList(id) {
    const sm = A.SMART.find(x => x[0] === id), l = sm ? null : A.myLists().find(x => x.id === id);
    if (!sm && !l) return;
    const items = listItems(id);
    const unk = l && l.rule && l.rule.onMyServices ? applyRule.unknown : 0;
    sheet(`<h3>${A.esc(sm ? sm[1] : l.name)}</h3><p class="small muted">${A.fmt(items.length)} ${items.length === 1 ? "entry" : "entries"}${sm || (l && l.rule) ? ". This list fills itself from your library by its rules." : ""}${unk ? ` ${A.fmt(unk)} titles have no streaming details yet (open them, or Settings › Fill in details) and aren't counted.` : ""}</p>
      ${l && l.rule ? `<button class="btn small" style="margin-bottom:10px" data-action="mrule" data-l="${A.esc(id)}">${A.icon("edit")}Edit rules</button>` : ""}
      ${items.length ? Kit.grid(items.slice(0, A.ui.listLim || 120).map(x => Kit.tile({ title: x.title, img: x.img, kind: x.kind, attrs: x.attrs }, x.year ? String(x.year) : ""))) + (items.length > (A.ui.listLim || 120) ? `<button class="btn block" data-action="mlistmore" data-l="${A.esc(id)}">Show more</button>` : "") : `<p class="muted">${l && l.rule ? "Nothing matches these rules right now." : "Empty. Open a film, series, game or book and tap Add to a list."}</p>`}
      ${l ? `<div style="margin-top:12px"><button class="sheetbtn" data-action="mlistcsv" data-l="${A.esc(id)}">${A.icon("open")}Save as a CSV file</button><button class="sheetbtn" data-action="mlistrename" data-l="${A.esc(id)}">${A.icon("edit")}Rename</button><button class="sheetbtn" data-action="mlistdel" data-l="${A.esc(id)}">${A.icon("notcanon")}<span>Delete this list</span></button></div>` : ""}`);
  }
  function ruleSheet(l) {
    const r = (l && l.rule) || { media: [], status: ["want"], sort: "rating" }, has = (a, x) => (a || []).includes(x);
    const chk = (attr, val, label, a) => `<label class="chip" style="cursor:pointer"><input type="checkbox" ${attr} value="${val}" ${has(a, val) ? "checked" : ""} style="margin-right:6px">${label}</label>`;
    const n = (id2, label, val, ph) => `<label class="field"><span>${label}</span><input id="${id2}" type="number" inputmode="decimal" min="0" value="${val || ""}" placeholder="${ph || "any"}"></label>`;
    sheet(`<h3>${l ? "Edit smart list" : "New smart list"}</h3>
      ${l ? "" : `<p class="small muted" style="margin:0 0 6px">Start from one of these, or set your own rules below.</p><div class="chips" style="margin-bottom:10px">${RULE_PRESETS.map((p, i) => `<button class="chip" data-action="mrulepreset" data-i="${i}">${A.esc(p[0])}</button>`).join("")}</div>`}
      <label class="field"><span>Name</span><input id="mr_name" maxlength="60" value="${A.esc(l ? l.name : "")}" placeholder="e.g. Short films for tonight"></label>
      <div class="kicker" style="margin:10px 0 4px">What (none ticked = everything)</div><div class="chips">${[["movie", "Films"], ["show", "Series"], ["game", "Games"], ["book", "Books"]].map(([v2, t]) => chk("data-mrm", v2, t, r.media)).join("")}</div>
      <div class="kicker" style="margin:10px 0 4px">Status (none ticked = any)</div><div class="chips">${[["want", "To watch / play / read"], ["doing", "In progress"], ["paused", "Paused"], ["done", "Finished"], ["dropped", "Dropped"]].map(([v2, t]) => chk("data-mrs", v2, t, r.status)).join("")}</div>
      ${n("mr_rating", "Your rating at least (1–10)", r.minRating)}${n("mr_mins", "Films no longer than (minutes)", r.maxMins)}${n("mr_hours", "Games no longer than (hours to beat)", r.maxHours)}${n("mr_pages", "Books no longer than (pages)", r.maxPages)}${n("mr_prog", "At least this far along (%; paused always counts)", r.minProgress)}
      <label class="field"><span>Franchise, multiverse or book series contains</span><input id="mr_fr" value="${A.esc(r.franchise || "")}" placeholder="any"></label>
      <label class="switch"><input type="checkbox" id="mr_owned" ${r.ownedOnly ? "checked" : ""}><span>Only games and books you own</span></label>
      <label class="switch"><input type="checkbox" id="mr_svc" ${r.onMyServices ? "checked" : ""}><span>Only films and series on my streaming services<small class="muted" style="display:block">${A.esc(A.myServices().join(", "))} (Settings)</small></span></label>
      <label class="switch"><input type="checkbox" id="mr_unrated" ${r.unrated ? "checked" : ""}><span>Only things you haven't rated</span></label>
      <label class="field"><span>Order</span><select id="mr_sort">${[["rating", "Your rating"], ["short", "Shortest first"], ["progress", "Furthest along"], ["added", "Recently added"], ["year", "Newest"], ["title", "Title"]].map(([v2, t]) => `<option value="${v2}" ${r.sort === v2 ? "selected" : ""}>${t}</option>`).join("")}</select></label>
      <button class="btn primary block" style="margin-top:10px" data-action="mrulesave" data-l="${A.esc(l ? l.id : "")}">Save</button>`);
  }
  function bulkListSheet(ids) {
    A.ui.bulkIds = ids;
    const mine = A.myLists().filter(l => !l.rule);
    sheet(`<h3>Add ${A.fmt(ids.length)} titles to a list</h3>${mine.map(l => `<button class="sheetbtn" data-action="bulklistput" data-l="${A.esc(l.id)}">${A.icon("plus")}${A.esc(l.name)} <span class="muted small">(${l.items.length})</span></button>`).join("") || `<p class="muted">No lists yet: make one from Home › Your lists › New list.</p>`}`);
  }
  function addToListSheet(k) {
    const mine = A.myLists().filter(l => !l.rule), e = A.entryOf(k);
    if (!e) return;
    sheet(`<h3>Add ${A.esc(e.title)} to a list</h3>
      ${mine.map(l => `<button class="sheetbtn" data-action="mlistput" data-l="${A.esc(l.id)}" data-k="${A.esc(k)}" aria-pressed="${l.items.includes(k)}">${A.icon(l.items.includes(k) ? "check" : "plus")}${A.esc(l.name)} <span class="muted small">(${l.items.length})</span></button>`).join("") || `<p class="muted small">No lists yet.</p>`}
      <label class="field" style="margin-top:10px"><span>New list</span><input id="mlistname" placeholder="e.g. Halloween, To watch with friends" maxlength="60"></label>
      <button class="btn" data-action="mlistnewadd" data-k="${A.esc(k)}">Create and add</button>`);
  }
  function myListAct(a, el) {
    const L2 = A.myLists(), l = L2.find(x => x.id === el.dataset.l);
    switch (a) {
      case "mlistopen": A.ui.listLim = 120; openMyList(el.dataset.l); return true;
      case "mlistmore": A.ui.listLim = (A.ui.listLim || 120) + 120; openMyList(el.dataset.l); return true;
      case "mrulenew": ruleSheet(null); return true;
      case "mrule": ruleSheet(l); return true;
      case "mrulepreset": { const p = RULE_PRESETS[+el.dataset.i]; if (!p) return true; const nl = { id: "l" + Date.now().toString(36), name: p[0], rule: JSON.parse(JSON.stringify(p[1])), items: [] };
        L2.push(nl); A.saveMyLists(L2); A.toast(`Smart list ${p[0]} added`); openMyList(nl.id); render(); return true; }
      case "mrulesave": {
        const v = id2 => document.getElementById(id2), on = sel => [...document.querySelectorAll(sel)].filter(x => x.checked).map(x => x.value);
        const num = id2 => { const n = parseFloat(((v(id2) || {}).value || "").replace(",", ".")); return Number.isFinite(n) && n > 0 ? n : 0; };
        const name = ((v("mr_name") || {}).value || "").trim() || "My smart list";
        const rule = { media: on("[data-mrm]"), status: on("[data-mrs]"), minRating: num("mr_rating"), maxMins: num("mr_mins"), maxHours: num("mr_hours"), maxPages: num("mr_pages"),
          minProgress: num("mr_prog"), ownedOnly: !!(v("mr_owned") || {}).checked, onMyServices: !!(v("mr_svc") || {}).checked, unrated: !!(v("mr_unrated") || {}).checked,
          franchise: ((v("mr_fr") || {}).value || "").trim(), sort: (v("mr_sort") || {}).value || "rating" };
        let target = l;
        if (target) { target.name = name; target.rule = rule; } else { target = { id: "l" + Date.now().toString(36), name, rule, items: [] }; L2.push(target); }
        A.saveMyLists(L2); openMyList(target.id); render(); return true; }
      case "mlistadd": addToListSheet(el.dataset.k); return true;
      case "mlistput": if (l) { const k = el.dataset.k, i = l.items.indexOf(k); if (i >= 0) l.items.splice(i, 1); else l.items.push(k); A.saveMyLists(L2); A.toast(i >= 0 ? `Removed from ${l.name}` : `Added to ${l.name}`); addToListSheet(k); } return true;
      case "mlistnewadd": case "mlistnew": {
        const inp = A.$("#mlistname"), name = ((inp && inp.value) || "").trim();
        if (a === "mlistnew") { sheet(`<h3>New list</h3><label class="field"><span>Name</span><input id="mlistname" maxlength="60" placeholder="e.g. Comfort watches"></label><button class="btn" data-action="mlistnewadd" data-k="">Create</button><p class="small muted" style="margin-top:14px">Or a list that fills itself by rules:</p><button class="btn" data-action="mrulenew">New smart list</button>`); return true; }
        if (!name) { A.toast("Give the list a name"); return true; }
        const nl = { id: "l" + Date.now().toString(36), name, items: el.dataset.k ? [el.dataset.k] : [] };
        L2.push(nl); A.saveMyLists(L2); A.toast(`List ${name} created`);
        if (el.dataset.k) addToListSheet(el.dataset.k); else { A.closeOverlay(); render(); }
        return true; }
      case "mlistrename": if (l) { sheet(`<h3>Rename</h3><label class="field"><span>Name</span><input id="mlistname" maxlength="60" value="${A.esc(l.name)}"></label><button class="btn" data-action="mlistrenamesave" data-l="${A.esc(l.id)}">Save</button>`); } return true;
      case "mlistrenamesave": if (l) { const v = ((A.$("#mlistname") || {}).value || "").trim(); if (v) { l.name = v; A.saveMyLists(L2); } openMyList(l.id); render(); } return true;
      case "mlistdel": if (l) { if (el.dataset.sure) { A.saveMyLists(L2.filter(x => x !== l)); A.closeOverlay(); A.toast(`Deleted ${l.name}`); render(); } else { el.dataset.sure = "1"; el.lastChild.textContent = "Tap again to delete"; } } return true;
      case "mlistcsv": if (l) { const q = v => `"${String(v == null ? "" : v).replace(/"/g, '""')}"`;
        const rows = [["Title", "Year", "Type", "IMDb ID"].join(",")].concat((l.rule ? listItems(l.id).map(e => e.k) : l.items).map(k => { const [kind, ...r] = k.split(":"), id = r.join(":"); const it = kind === "lib" ? A.lib.get(id) : kind === "game" ? A.games.get(id) : A.books.get(id); if (!it) return null;
          return [q(it.title), q(it.year || (it.date || "").slice(0, 4)), q(kind === "lib" ? (it.type === "show" ? "Series" : "Film") : kind === "game" ? "Game" : "Book"), q(it.imdb || "")].join(","); }).filter(Boolean));
        A.Native.saveAs(`${l.name.replace(/[^\w ]+/g, "").trim() || "list"}.csv`, rows.join("\n") + "\n").then(ok => A.toast(ok ? "Saved" : "Not saved")); } return true;
    }
    return false;
  }

  function sheet(html, cls, id) {
    const open = document.querySelector("#overlay .sheet");
    if (open && cls && open.dataset.cls === cls && open.dataset.id === String(id || "")) { const top = open.scrollTop; open.innerHTML = html; open.scrollTop = top; if (window.BantaI18n && BantaI18n.isOn()) BantaI18n.walk(open); return; }
    A.$("#overlay").innerHTML = `<div class="scrim bottom" data-action="dismiss"><div class="sheet ${A.esc(cls || "")}" data-cls="${A.esc(cls || "")}" data-id="${A.esc(id || "")}" role="dialog" aria-modal="true">${html}</div></div>`;
  }
  // 0.6.1: where you were, so Back returns there (not straight to Home)
  const backStack = [];
  function go(sec, tab, fromBack) {
    if (!fromBack) { const cur = { sec: A.ui.sec, tab: A.ui.tab, y: window.scrollY }; const top = backStack[backStack.length - 1]; if (cur.sec && !(top && top.sec === cur.sec && top.tab === cur.tab)) { backStack.push(cur); if (backStack.length > 30) backStack.shift(); } }
    A.commitFields();
    if (Kit.mods.books && Kit.mods.books.stopScan) Kit.mods.books.stopScan();
    if (A.WATCH.some(w => w[0] === sec) || sec === "compare") { tab = sec; sec = "watch"; }
    if (!A.secOn(sec) && !A.SECR[sec]) sec = "home";
    A.ui.sec = sec;
    if (tab && tab !== A.ui.tab) { A.ui.libRes = null; A.ui.libQ = ""; A.ui.libF = null; }
    if (tab) A.ui.tab = tab;
    if (sec === "watch" && !A.ui.tab) A.ui.tab = "library";
    render();
    window.scrollTo(0, 0);
  }
  function setTab(t) { go(t); }
  function render() { A.inRender = true; try { return render0(); } finally { A.inRender = false; } }
  function render0() {
    const active = document.activeElement;
    const keepInput = active && active.dataset && active.dataset.input ? active.dataset.input : null;
    const caret = keepInput && active.selectionStart != null ? active.selectionStart : null;
    if (!A.secOn(A.ui.sec) && !A.SECR[A.ui.sec] && A.ui.sec !== "watch") A.ui.sec = "home";
    const sec = A.ui.sec;
    document.body.dataset.sec = sec === "home" || sec === "watch" || !Kit.mods[sec] ? "watch" : sec;
    A.$("#view").dataset.tab = sec === "watch" ? A.ui.tab : sec;
    let html;
    try {
      if (sec === "watch") html = `<div class="subnav">${A.WATCH.map(([k, l]) => `<button data-action="tab" data-tab="${k}" ${A.ui.tab === k || (k === "stats" && A.ui.tab === "compare") ? 'aria-current="page"' : ""}>${l}</button>`).join("")}</div>${(A.RENDER[A.ui.tab] || A.renderLibrary)()}`;
      else if (Kit.mods[sec]) html = Kit.mods[sec].render(A.Saga);
      else html = (A.SECR[sec] || A.renderHome)();
    } catch (e) { A.logError("screen", (e.stack || e.message)); html = `<div class="empty2"><h2>Something went wrong here</h2><p>${A.esc(e.message)}</p><button class="btn" data-action="go" data-sec="home">Back to Home</button></div>`; console.error(e); }
    A.$("#view").innerHTML = html;
    A.$("#title").innerHTML = sec === "home" ? `<span class="wordmark">Sa<span>ga</span></span>` : A.esc(A.TITLES[sec] || "");
    const fails = A.failedLabels().length;
    A.$("#syncTop").classList.toggle("warn", !!fails);
    A.$("#tabs").innerHTML = A.NAV.filter(([k]) => A.secOn(k)).map(([k, label, ic]) => `<button data-action="go" data-sec="${k}" data-sec2="${k}" ${sec === k ? 'aria-current="page"' : ""} style="${k === "timeline" ? "--btn-accent:var(--timeline)" : ""}">${A.icon(ic)}<span>${label}</span></button>`).join("");
    A.$("#tabs").querySelectorAll("button").forEach(b => b.setAttribute("data-sec", b.dataset.sec2));
    if (keepInput) {
      const el = document.querySelector(`[data-input="${keepInput}"]`);
      if (el) { el.focus(); try { const p = caret != null ? caret : el.value.length; el.setSelectionRange(p, p); } catch (e) { /* not a text field */ } }
    }
  }

    return { applyRule, RULE_PRESETS, listsSection, bulkListSheet, myListAct, sheet, backStack, go, setTab, render };
  };
})(typeof window !== "undefined" ? window : this);
