/* Games tab additions: multiverse tools (regroup, find missing per multiverse), PC store links (Steam first,
   otherwise the cheapest store) and subscription services. Uses GameCheck's own globals (all, visible, live, ov,
   AI, CL, claude, queueFrom, aliasStart, ali, unali, gameLine, patchRow, saveAll, saveAi, renderAll, renderAi, req…),
   which exist once its main script has run; everything here is called later, from clicks. */
(function () {
  "use strict";
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); };
  var enc = encodeURIComponent;
  var DAYMS = 864e5;
  var ago = function (t) { var d = Math.round((Date.now() - t) / DAYMS); return d <= 0 ? "today" : d === 1 ? "yesterday" : d + " days ago"; };
  var nm = function (s) { return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[™®©]/g, "").replace(/&/g, "and").replace(/^the\s+/, "").replace(/[^a-z0-9]/g, ""); };
  var multi = function (g) { return g.m && g.m !== "N/A" ? g.m : (g.f || "—"); };

  // ---------------------------------------------------------------- subscriptions
  var SUBS = ["PC Game Pass", "Game Pass Ultimate", "Game Pass Standard", "PS Plus Extra", "PS Plus Premium", "EA Play", "EA Play Pro", "Ubisoft+ Classics", "Ubisoft+ Premium",
              "Nintendo Switch Online", "Netflix Games", "Apple Arcade", "Amazon Luna", "Prime Gaming", "Humble Choice", "GeForce Now (stream only)"];
  var short = function (n) { return String(n).replace(/^Game Pass Ultimate$/, "GP Ultimate").replace(/^PC Game Pass$/, "PC Game Pass").replace(/^Nintendo Switch Online$/, "NSO"); };
  function subsOf(id) { var l = live[id] || {}; return (l.subs && l.subs.list) || []; }

  // Microsoft's public Game Pass catalog (PC and console): product ids, then their titles.
  var GP = [["PC Game Pass", "fdd9e2a7-0fee-49f6-ad69-4354098401ff"], ["Game Pass Ultimate", "f6f1f99f-9b49-4ccd-b3bf-4d9767a77f5e"]];
  async function gamePassCatalog() {
    var st = typeof SET !== "undefined" ? SET : {};
    if (st.gpCat && Date.now() - st.gpCatTs < 3 * DAYMS) return st.gpCat;
    var out = {};
    for (var i = 0; i < GP.length; i++) {
      var r = await req("https://catalog.gamepass.com/sigls/v2?id=" + GP[i][1] + "&language=en-us&market=IT", { timeout: 30000 });
      if (r.status !== 200) throw new Error("Xbox catalog HTTP " + r.status);
      var ids = (JSON.parse(r.text) || []).map(function (x) { return x.id; }).filter(Boolean);
      for (var j = 0; j < ids.length; j += 20) {
        if (CL.stop) throw new Error("Stopped");
        var p = await req("https://displaycatalog.mp.microsoft.com/v7.0/products?bigIds=" + ids.slice(j, j + 20).join(",") + "&market=IT&languages=en-us&MS-CV=DGU1mcuYo0WMMp+F.1", { timeout: 30000 });
        if (p.status !== 200) continue;
        (JSON.parse(p.text).Products || []).forEach(function (x) {
          var t = ((x.LocalizedProperties || [])[0] || {}).ProductTitle;
          if (!t) return;
          var k = nm(t.replace(/\s*(for windows( 10)?|\(pc\)|- windows edition|standard edition|game preview)\s*$/i, ""));
          (out[k] = out[k] || []).indexOf(GP[i][0]) < 0 && out[k].push(GP[i][0]);
        });
        await sleep(250);
      }
    }
    st.gpCat = out; st.gpCatTs = Date.now();
    return out;
  }

  async function checkSubs() {
    if (CL.running) return;
    var rows = visible().filter(function (g) { return !done[g.id]; });
    CL = { running: true, stop: false, label: "Checking subscriptions", done: 0, total: 1, answer: CL.answer };
    aiPill(); renderAi();
    var now = Date.now(), xbox = 0, ai = 0, note = "";
    var before = {}; rows.forEach(function (g) { before[g.id] = subsOf(g.id).map(function (s) { return s.name; }); });
    var hadCheck = !!AI.subsTs;
    try {
      // 1. Xbox Game Pass straight from Microsoft's catalog
      try {
        CL.label = "Reading the Game Pass catalog"; aiPill();
        var cat = await gamePassCatalog();
        rows.forEach(function (g) {
          var hit = cat[nm(g.t)] || (g.rn && g.rn !== "N/A" ? cat[nm(g.rn)] : null);
          var l = live[g.id] = live[g.id] || {};
          var prev = (l.subs && l.subs.list || []).filter(function (s) { return s.src !== "xbox"; });
          if (hit) { xbox++; hit.forEach(function (n) { prev.push({ name: n, src: "xbox" }); }); }
          l.subs = { list: prev, ts: (l.subs && l.subs.ts) || now, xts: now };
        });
      } catch (e) { if (e.message === "Stopped") throw e; note = " (Xbox catalog unavailable: " + e.message + ")"; }
      saveAll();
      // 2. Everything else (PS Plus, EA Play, Ubisoft+, NSO…) through Gemini, 150 games per prompt
      var per = 150, batches = [];
      for (var i = 0; i < rows.length; i += per) batches.push(rows.slice(i, i + per));
      CL.total = batches.length;
      for (var b = 0; b < batches.length; b++) {
        if (CL.stop) break;
        CL.label = "Subscriptions " + (b + 1) + "/" + batches.length; aiPill();
        aliasStart();
        var lines = batches[b].map(function (g) { return [ali(g.id), g.t, g.rn && g.rn !== "N/A" ? "newest: " + g.rn : "", g.best && g.best.label ? "plays on " + g.best.label : ""].filter(Boolean).join(" | "); });
        var res = await claude({ prompt: "Which of these games are CURRENTLY included in a subscription service available in Italy (today is " + new Date().toISOString().slice(0, 10) + ")? " +
          "Services: " + SUBS.join(", ") + ". Count the newest version too. Use Google Search to check each service's current catalogue; only report what you can confirm, and give the date a game leaves if announced.\n" +
          "Format: id | title | newest version | platform.\n\n" + lines.join("\n") + "\n\n" +
          'Return JSON: {"subs":[{"id":"<row id such as g12>","services":[{"name":"exact service name from the list","leaving":"YYYY-MM-DD or null"}]}]} listing only games that are in at least one service.',
          search: 1, label: "Subscriptions " + (b + 1) + "/" + batches.length });
        var found = {};
        ((res.json || {}).subs || []).forEach(function (s) { var id = unali(s.id); if (id) found[id] = (s.services || []).filter(function (x) { return x && x.name; }); });
        batches[b].forEach(function (g) {
          var l = live[g.id] = live[g.id] || {};
          var keep = (l.subs && l.subs.list || []).filter(function (s) { return s.src === "xbox"; });
          (found[g.id] || []).forEach(function (s) {
            var n = String(s.name).trim();
            if (keep.some(function (k) { return k.name === n; })) return;
            keep.push({ name: n, leaving: s.leaving || null, src: "ai" });
          });
          if ((found[g.id] || []).length) ai++;
          l.subs = { list: keep, ts: now, xts: l.subs && l.subs.xts };
        });
        CL.done++; aiPill(); saveAll();
      }
      AI.subsTs = now; saveAi();
      // games that just joined a service you have
      var mine = mySubs(), joined = [];
      if (hadCheck && mine.length) rows.forEach(function (g) {
        subsOf(g.id).forEach(function (s) { if (before[g.id].indexOf(s.name) < 0 && mine.some(function (m) { return s.name.toLowerCase().indexOf(m) >= 0; })) joined.push(g.t + " (" + s.name + ")"); });
      });
      if (joined.length && SH()) SH().notify(hash("sub" + joined.join()), joined.length === 1 ? "Now in your subscription: " + joined[0] : joined.length + " games joined your subscriptions", joined.slice(0, 8).join(", ") + (joined.length > 8 ? "…" : "."), "games");
      toast(xbox + " on Game Pass (Microsoft) · " + ai + " found by Gemini" + note);
    } catch (e) { if (!/Cancelled|Stopped/.test(e.message)) toast(e.message); }
    CL.running = false; aiPill(); renderAi(); renderAll(true);
  }

  // ---------------------------------------------------------------- multiverses
  function mvList() {
    var by = {};
    visible().forEach(function (g) { var m = multi(g); (by[m] = by[m] || { name: m, games: [], frs: {} }).games.push(g); by[m].frs[g.f || "—"] = 1; });
    return Object.keys(by).map(function (k) { return by[k]; }).sort(function (a, b) { return b.games.length - a.games.length || a.name.localeCompare(b.name); });
  }

  async function regroup() {
    if (CL.running) return;
    var frs = {};
    visible().forEach(function (g) { var f = g.f || "—"; var x = frs[f] = frs[f] || { f: f, n: 0, m: {}, t: [] }; x.n++; x.m[multi(g)] = (x.m[multi(g)] || 0) + 1; if (x.t.length < 3) x.t.push(g.t); });
    var list = Object.keys(frs).map(function (k) { var x = frs[k]; x.cur = Object.keys(x.m).sort(function (a, b) { return x.m[b] - x.m[a]; })[0]; return x; });
    var names = mvList().map(function (m) { return m.name; });
    CL = { running: true, stop: false, label: "Grouping into multiverses", done: 0, total: 1, answer: CL.answer };
    aiPill(); renderAi();
    try {
      var res = await claude({ prompt: "Group the user's game franchises into MULTIVERSES: the widest shared fictional universe or crossover setting a franchise belongs to " +
        "(e.g. Marvel games → \"Marvel\", LEGO Star Wars → \"Star Wars\", Kingdom Hearts → \"Kingdom Hearts\"). The user's own multiverse names come first: keep them unless they are clearly wrong, " +
        "and reuse these names exactly when they fit: " + names.slice(0, 150).join("; ") + ".\nFormat: franchise | current multiverse | number of games | example titles.\n\n" +
        list.map(function (x) { return x.f + " | " + x.cur + " | " + x.n + " | " + x.t.join(", "); }).join("\n") + "\n\n" +
        'Return JSON: {"groups":[{"franchise":"exact franchise name","multiverse":"multiverse name","why":"few words"}]} for EVERY franchise.', search: 0, label: "Group into multiverses" });
      var items = [];
      ((res.json || {}).groups || []).forEach(function (r, i) {
        var x = frs[r.franchise];
        if (!x || !r.multiverse || r.multiverse === x.cur) return;
        items.push({ id: String(i), title: x.f + " → " + r.multiverse, sub: "now: " + x.cur + " · " + x.n + " game" + (x.n === 1 ? "" : "s") + (r.why ? " · " + r.why : ""),
                     tag: "Move", tagClass: "new", checked: x.cur === x.f || x.cur === "—", r: r });
      });
      CL.running = false; aiPill(); renderAi();
      var ids = await BantaAI.review({ title: items.length ? items.length + " franchise" + (items.length === 1 ? "" : "s") + " to move" : "Your multiverses look right",
        note: "Ticked by default: franchises that had no multiverse of their own. Your other groupings stay as they are unless you tick them.", items: items, ok: "Move ticked" });
      var n = 0;
      ids.forEach(function (id) {
        var it = items.filter(function (x) { return x.id === id; })[0];
        if (!it) return;
        all().filter(function (g) { return (g.f || "—") === it.r.franchise; }).forEach(function (g) { patchRow(g.id, { m: it.r.multiverse }); n++; });
      });
      if (n) { VER++; saveAll(); renderAll(true); toast(n + " games moved"); }
    } catch (e) { if (!/Cancelled|Stopped/.test(e.message)) toast(e.message); }
    CL.running = false; aiPill(); renderAi();
  }

  async function findMissing(names) {
    if (CL.running || !names.length) return;
    CL = { running: true, stop: false, label: "Searching " + names.length + " multiverse" + (names.length === 1 ? "" : "s"), done: 0, total: names.length, answer: CL.answer };
    aiPill(); renderAi();
    var n = 0, mvs = mvList();
    AI.mvChecked = AI.mvChecked || {};
    try {
      for (var i = 0; i < names.length; i++) {
        if (CL.stop) break;
        var m = mvs.filter(function (x) { return x.name === names[i]; })[0];
        if (!m) continue;
        CL.label = "Searching " + m.name; aiPill();
        aliasStart();
        var byF = {};
        m.games.forEach(function (g) { (byF[g.f || "—"] = byF[g.f || "—"] || []).push(g); });
        var secs = Object.keys(byF).map(function (f) { return "## " + f + "\n" + byF[f].map(gameLine).join("\n"); }).join("\n\n");
        var res = await claude({ prompt: "The user's games in the \"" + m.name + "\" multiverse, by franchise. Format: id | title | original date | original platform | newest version | its date | its platform | owned.\n\n" + secs +
          "\n\nFind every canon game of this MULTIVERSE missing from the list: mainline entries and notable spin-offs of these franchises, other franchises set in the same universe, crossovers, and announced games (search the web for recent announcements). " +
          "Not DLC, editions or bundles. Put each in the franchise it belongs to, using the names after ## when they fit, otherwise a new franchise name. Also report wrong titles/dates/platforms as fixes and duplicates if you notice them.\n" +
          "Return JSON with this schema:\n" + SCHEMA, search: 1, label: "Find missing: " + m.name });
        n += queueFrom(res.json, { f: "" });
        AI.mvChecked[m.name] = Date.now();
        CL.done++; aiPill(); saveAi(); if (curView === "vAi") renderAi();
      }
      toast("Searched " + CL.done + " multiverse" + (CL.done === 1 ? "" : "s") + " · " + n + " suggestions to review");
    } catch (e) { if (!/Cancelled|Stopped/.test(e.message)) toast(e.message); }
    CL.running = false; aiPill(); renderAi();
  }

  // ---------------------------------------------------------------- HTML
  function aiHtml() {
    var mvs = mvList(), chk = (AI.mvChecked || {}), now = Date.now();
    var unchecked = mvs.filter(function (m) { return !chk[m.name] || now - chk[m.name] > 30 * DAYMS; });
    var subsN = {}, gamesIn = 0;
    visible().forEach(function (g) { var s = subsOf(g.id); if (s.length) gamesIn++; s.forEach(function (x) { subsN[x.name] = (subsN[x.name] || 0) + 1; }); });
    var dis = CL.running ? " disabled" : "";
    return '<div class="sec gcx-ai"><h3>Multiverses</h3><div class="panel">' +
      '<div class="tg"><div class="l"><div>1 · Group franchises into multiverses</div><div>' + mvs.length + " multiverses now · Gemini suggests moves, you tick which to apply</div></div>" +
      '<button class="btn sm" data-gcx="regroup"' + dis + ">Group</button></div>" +
      '<div class="tg"><div class="l"><div>2 · Find missing games per multiverse</div><div>' + unchecked.length + " of " + mvs.length + " not searched in the last 30 days · results go to Suggestions</div></div>" +
      '<button class="btn sm pr" data-gcx="next3"' + dis + (unchecked.length ? "" : " disabled") + ">Next 3</button></div>" +
      '<div class="btns" style="margin-top:8px"><select class="num" id="gcxMv" style="flex:1 1 180px;min-width:0;width:100%;max-width:100%;text-align:left">' +
      mvs.map(function (m) { return '<option value="' + esc(m.name) + '">' + esc(m.name) + " (" + m.games.length + ")" + (chk[m.name] ? " ✓" : "") + "</option>"; }).join("") +
      '</select><button class="btn sm" data-gcx="one"' + dis + ">Search</button></div></div></div>" +
      '<div class="sec gcx-subsec"><h3>Subscriptions</h3><div class="panel">' +
      '<div class="tg"><div class="l"><div>Check subscription catalogues</div><div>' +
      (AI.subsTs ? gamesIn + " games in a service · checked " + ago(AI.subsTs) : "Game Pass from Microsoft's catalog, then PS Plus, EA Play, Ubisoft+, Switch Online and more through Gemini") +
      '</div></div><button class="btn sm pr" data-gcx="subs"' + dis + ">" + (AI.subsTs ? "Refresh" : "Check") + "</button></div>" +
      '<div class="tg"><div class="l"><div>Your subscriptions</div><div>Notifies you when a game on your list joins one of these</div></div></div>' +
      '<input class="num" id="gcxMine" style="width:100%;text-align:left;margin-top:6px" value="' + esc(SET.gcxSubs == null ? "PC Game Pass" : SET.gcxSubs) + '" placeholder="PC Game Pass, PS Plus Extra">' +
      '<div class="tg"><div class="l"><div>Price alert</div><div>Notify when a game you don\'t own is discounted by at least this much on Steam (0 = off). Set a target price per game in its sheet.</div></div>' +
      '<input class="num" id="gcxDisc" type="number" min="0" max="95" value="' + (SET.gcxDisc == null ? 50 : +SET.gcxDisc) + '" style="width:64px"> %</div>' +
      (Object.keys(subsN).length ? '<div class="gcx-subs">' + Object.keys(subsN).sort(function (a, b) { return subsN[b] - subsN[a]; }).map(function (k) {
        return '<details><summary><span class="tag sub">' + esc(k) + "</span> " + subsN[k] + "</summary>" +
          visible().filter(function (g) { return subsOf(g.id).some(function (s) { return s.name === k; }); }).slice(0, 80).map(function (g) {
            var s = subsOf(g.id).filter(function (x) { return x.name === k; })[0];
            return '<div class="gcx-row" data-gcx="open" data-id="' + esc(g.id) + '">' + esc(g.t) + (s.leaving ? ' <span class="muted">· leaves ' + esc(s.leaving) + "</span>" : "") + (done[g.id] ? " ✓" : "") + "</div>";
          }).join("") + "</details>";
      }).join("") + "</div>" : "") + "</div></div>";
  }

  // PC store: Steam when the game is there, otherwise the cheapest store; subscriptions underneath.
  function storeHtml(g, lv) {
    lv = lv || {};
    var what = g._isR && g.rn && g.rn !== "N/A" && g.best && g.best.ver === g.rn ? g.rn : g.t;
    var q = enc(what.replace(/\s*\([^)]*\)\s*$/, ""));
    var rows = [];
    if (lv.steam) rows.push(['https://store.steampowered.com/app/' + enc(lv.steam) + '/', "Steam", "Store page" + (lv.disc ? " · " + lv.disc + "% off" : ""), lv.eur != null ? eur(lv.eur) : ""]);
    if (lv.deal && (!lv.steam || (lv.store && !/steam/i.test(lv.store)))) rows.push(["https://www.cheapshark.com/redirect?dealID=" + enc(lv.deal), "Cheapest: " + (lv.store || "PC store"), lv.steam ? "Cheaper than Steam right now?" : "Not on Steam · cheapest official PC store", lv.usd != null ? "$" + lv.usd.toFixed(2) : ""]);
    if (!lv.steam && !lv.deal) {
      rows.push(["https://store.steampowered.com/search/?term=" + q, "Search Steam", "Not linked to Steam yet", ""]);
      rows.push(["https://www.gog.com/en/games?query=" + q, "Search GOG", "DRM-free", ""]);
      rows.push(["https://store.epicgames.com/it/browse?q=" + q, "Search Epic Games Store", "", ""]);
      rows.push(["https://isthereanydeal.com/search/?q=" + q, "Compare every PC store", "IsThereAnyDeal", ""]);
    }
    var subs = subsOf(g.id), l = live[g.id] || {};
    return '<div class="cbox"><h4>PC store<span class="sp"></span>' + (lv.steam ? '<span class="tag own">Steam</span>' : "") + "</h4>" +
      rows.map(function (r) { return '<div class="offer" data-u="' + esc(r[0]) + '"><div class="b"><div>' + esc(r[1]) + "</div><div>" + esc(r[2]) + '</div></div><div class="pr">' + esc(r[3]) + "</div></div>"; }).join("") +
      (NA(g.ow) && !done[g.id] ? '<div class="srow" style="margin-top:8px"><span>Alert me at</span><div class="sv">€ <input class="num" inputmode="decimal" data-gcx-target="' + esc(g.id) + '" value="' + esc((SET.gcxT || {})[g.id] || "") + '" placeholder="any big sale" style="width:110px"> or less</div></div>' : "") +
      '<div class="srow" style="margin-top:8px"><span>Subscriptions</span><div class="sv">' +
      (subs.length ? subs.map(function (s) { return '<i class="ok">' + esc(s.name) + (s.leaving ? " · until " + esc(s.leaving) : "") + (s.src === "xbox" ? " ✓" : "") + "</i>"; }).join("")
                   : "<i>" + (l.subs ? "none found" : "not checked yet · AI tab › Subscriptions") + "</i>") + "</div></div>" +
      (l.subs && l.subs.ts ? '<div class="muted" style="font-size:12px;margin-top:4px">Checked ' + ago(l.subs.ts) + (subs.some(function (s) { return s.src === "xbox"; }) ? " · ✓ = Microsoft's Game Pass catalog" : "") + "</div>" : "") + "</div>";
  }

  function tags(g, list) {
    subsOf(g.id).slice(0, 2).forEach(function (s) { list.push('<span class="tag sub">' + esc(short(s.name)) + "</span>"); });
  }

  // ---------------------------------------------------------------- shared with the other tabs
  var SH = function () { return window.BantaShell && BantaShell.shared; };
  var hash = function (s) { var h = 7; for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h) % 2000000000; };
  var iso = function (ms) { return new Date(ms).toISOString().slice(0, 10); };

  // Index for search, "what's next", the calendar and multiverse counts in the Canon tab, plus a full backup snapshot.
  function publish() {
    var sh = SH(); if (!sh) return;
    var vis = visible(), now = Date.now(), mv = {}, byF = {};
    var games = vis.map(function (g) {
      var m = multi(g), x = mv[m] = mv[m] || { n: 0, d: 0 };
      x.n++; if (done[g.id]) x.d++;
      (byF[g.f || "—"] = byF[g.f || "—"] || []).push(g);
      var o = { id: g.id, t: g.t, f: g.f, m: m, d: done[g.id] ? 1 : 0 }, y = yr(pd(g.od));
      if (y) o.y = y;
      if (g.rn && g.rn !== "N/A") o.rn = g.rn;
      return o;
    });
    var upcoming = [];
    vis.forEach(function (g) { if (done[g.id]) return; var d = preciseDay(g); if (d != null && d > now) upcoming.push({ id: g.id, t: g._isR && g.rn && g.rn !== "N/A" ? g.rn : g.t, date: iso(d), f: g.f }); });
    upcoming.sort(function (a, b) { return a.date.localeCompare(b.date); });
    // next to play: in each franchise you've started, the earliest game you haven't finished and can play now
    var next = [];
    Object.keys(byF).forEach(function (f) {
      var list = byF[f], dn = list.filter(function (g) { return done[g.id]; }).length;
      if (!dn || dn === list.length) return;
      var cand = list.filter(function (g) { var d = preciseDay(g); return !done[g.id] && !(d != null && d > now); })
        .sort(function (a, b) { return (pd(a.od) || 0) - (pd(b.od) || 0); })[0];
      if (cand) next.push({ id: cand.id, t: cand.t, f: f, pct: dn / list.length, own: !NA(cand.ow) });
    });
    next.sort(function (a, b) { return (b.own - a.own) || b.pct - a.pct; });
    var recent = [];
    vis.forEach(function (g) { var p = playsOf(g.id); if (p.length) recent.push({ id: g.id, t: g.t, f: g.f, date: p[p.length - 1], n: p.length }); });
    recent.sort(function (a, b) { return b.date.localeCompare(a.date); });
    sh.write("index_games.json", JSON.stringify({ ts: now, games: games, mv: mv, next: next.slice(0, 8), upcoming: upcoming.slice(0, 60), recent: recent.slice(0, 20) }));
    // the games list itself travels with the backup, so a restore onto a clean install brings the games back
    sh.write("snap_games.json", JSON.stringify({ v: 3, done: done, ov: ov, ex: ex, live: live, sugg: sugg, block: block, set: SET, base: D }));
    priceAlerts(vis);
  }

  // A wanted game hits your target price or a big discount: one notification per new price.
  function priceAlerts(vis) {
    var sh = SH(); if (!sh || !sh.native() || !BantaShell.feature("priceAlerts")) return;
    SET.gcxA = SET.gcxA || {}; SET.gcxT = SET.gcxT || {};
    var pct = SET.gcxDisc == null ? 50 : +SET.gcxDisc, base = !SET.gcxBase, hits = [];
    vis.forEach(function (g) {
      if (done[g.id] || !NA(g.ow)) return;
      var lv = live[g.id] || {};
      if (lv.eur == null) return;
      var target = +SET.gcxT[g.id] || 0;
      var hit = (target && lv.eur <= target) || (pct > 0 && (lv.disc || 0) >= pct);
      if (!hit) { delete SET.gcxA[g.id]; return; }
      if (SET.gcxA[g.id] === lv.eur) return;
      SET.gcxA[g.id] = lv.eur;
      if (!base) hits.push({ g: g, lv: lv, target: target });
    });
    SET.gcxBase = 1;
    S("set", SET);
    if (!hits.length) return;
    if (hits.length <= 4) hits.forEach(function (h) {
      sh.notify(hash("p" + h.g.id + h.lv.eur), "Price drop: " + h.g.t, eur(h.lv.eur) + " on Steam" + (h.lv.disc ? " (−" + h.lv.disc + "%)" : "") + (h.target ? " · your target was " + eur(h.target) : ""), "games");
    });
    else sh.notify(hash("pm" + hits.length + hits[0].g.id), hits.length + " games on your list dropped in price", hits.slice(0, 6).map(function (h) { return h.g.t + " " + eur(h.lv.eur); }).join(", ") + (hits.length > 6 ? "…" : "."), "games");
  }

  function applyRestore() {
    var sh = SH(); if (!sh) return false;
    var text = sh.read("restore_games.json");
    if (!text) return false;
    sh.remove("restore_games.json");
    try {
      var j = JSON.parse(text);
      var reload = false;
      if (Array.isArray(j.base) && j.base.length && JSON.stringify(j.base) !== JSON.stringify(D)) { try { localStorage.setItem("gc_base", JSON.stringify(j.base)); reload = true; } catch (e) { /* storage full: keep the current list */ } }
      done = j.done || {}; ov = j.ov || {}; ex = j.ex || [];
      if (j.live) live = j.live; if (j.sugg) sugg = j.sugg; if (j.block) block = j.block; if (j.set) SET = Object.assign(SET, j.set);
      for (var k in ov) { delete ov[k].imdb; delete ov[k].hl; }
      saveAll();
      if (reload) { location.reload(); return true; }
      fillOptions(); renderAll(true);
      toast("Games backup restored: " + Object.keys(done).length + " finished games");
      return true;
    } catch (e) { toast("Games restore failed: " + e.message); return false; }
  }


  // ---------------------------------------------------------------- 4.2: imports from other sites, Steam search, playthroughs
  var dayStr = function (ms) { return new Date(ms).toISOString().slice(0, 10); };
  var gnorm = function (t) { return nm(String(t || "").replace(/\s*\((19|20)\d\d\)\s*$/, "")); };
  function fguess(t) {
    var s0 = String(t || "").split(/\s*[:–—]\s+|\s+-\s+/)[0];
    s0 = s0.replace(/\s+(Remastered|Remake|HD|Deluxe|Edition|Definitive Edition|GOTY)$/i, "").replace(/\s+(\d+|[IVX]{1,4})$/i, "").trim();
    return s0 || String(t || "");
  }
  // Rows from HowLongToBeat, Grouvee, Backloggd, a Steam library or any CSV (sent over by the Watch tab's import hub)
  function importRows(rows, kind) {
    var byNorm = {}, added = 0, marked = 0, now = Date.now();
    all().forEach(function (g) { byNorm[gnorm(g.t)] = g; });
    rows.forEach(function (r, i) {
      if (!r || !r.title) return;
      var g = byNorm[gnorm(r.title)], id;
      if (g) id = g.id;
      else {
        if (r.status === "backlog" && r.src === "Steam" && !r.hours) { /* unplayed Steam games still come in as owned */ }
        id = "i" + hash(kind + "|" + r.title) + "_" + i;
        var plat = r.platform || "PC";
        ex.push({ id: id, cu: 1, src: "import", t: r.title, od: "TBA", op: plat, rn: "N/A", rd: "TBA", rp: plat, ow: r.owned || (r.status === "wishlist" ? "N/A" : (r.status === "done" || r.status === "playing" || r.src === "Steam" ? plat : "N/A")),
          r: "N/A", h: "N/A", hb: "N/A", f: fguess(r.title), m: fguess(r.title), n: 0, no: r.src ? "From " + r.src : "", addedTs: now });
        byNorm[gnorm(r.title)] = { id: id, t: r.title };
        if (r.steam) { live[id] = Object.assign(live[id] || {}, { steam: r.steam }); }
        added++;
      }
      if (r.status === "done" && !done[id]) { done[id] = (r.date && Date.parse(r.date)) || now; marked++; }
      if (r.date && r.status === "done") { var o = ov[id] = ov[id] || {}; o.plays = o.plays || []; if (o.plays.indexOf(r.date) < 0) { o.plays.push(r.date); o.plays.sort(); } }
      if (r.rating) { var o2 = ov[id] = ov[id] || {}; if (o2.myR == null) o2.myR = Math.round(r.rating * 10) / 10; }
    });
    saveAll(); try { fillOptions(); } catch (e) { /* older page */ } renderAll(true);
    try { VER++; } catch (e) { /* read-only in some builds */ }
    toast((kind || "Import") + ": " + added + " added, " + marked + " marked done");
    return { added: added, marked: marked };
  }
  function takeImport() {
    var sh = SH(); if (!sh) return;
    var t = sh.read("import_games.json");
    if (!t) return;
    sh.remove("import_games.json");
    try { var j = JSON.parse(t); importRows(j.rows || [], j.kind); } catch (e) { toast("Games import failed: " + e.message); }
  }

  // playthroughs: every finish with its date (ov[id].plays), shown in the game's sheet
  function playsOf(id) { var o = ov[id] || {}, p = (o.plays || []).slice(); if (!p.length && done[id]) p.push(dayStr(done[id])); return p; }
  function playsHtml(id) {
    var p = playsOf(id), today = dayStr(Date.now());
    return '<div class="cbox gcx-plays"><h4>Playthroughs<span class="sp"></span><span class="muted" style="text-transform:none">' + (p.length ? p.length + "×" : "not finished yet") + "</span></h4>" +
      p.map(function (d, i) { return '<div class="gcx-play"><span>' + (i + 1) + ". " + esc(new Date(d + "T12:00:00").toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })) + '</span><button class="btn sm" data-gcx="unplay" data-id="' + esc(id) + '" data-i="' + i + '" aria-label="Remove">✕</button></div>'; }).join("") +
      '<div class="gcx-play"><input type="date" id="gcxPlayDate" value="' + today + '" max="' + today + '"><button class="btn sm" data-gcx="play" data-id="' + esc(id) + '">' + (p.length ? "Finished again" : "Finished") + "</button></div></div>";
  }
  function logPlay(id, date) {
    var o = ov[id] = ov[id] || {};
    o.plays = playsOf(id); o.plays.push(date || dayStr(Date.now())); o.plays.sort();
    if (!done[id]) done[id] = Date.parse(date) || Date.now();
    saveAll(); renderAll(true); openEditor(id);
    toast(o.plays.length > 1 ? "Finished " + o.plays.length + " times" : "Marked as finished");
  }

  // Search Steam's store to add a game (from the Add game sheet)
  var pendingSteam = null;
  async function steamSearch(q) {
    var box = document.getElementById("gcxSteamRes"); if (!box) return;
    q = String(q || "").trim(); if (q.length < 2) { box.innerHTML = '<div class="muted">Type at least two letters.</div>'; return; }
    box.innerHTML = '<div class="muted">Searching Steam…</div>';
    var j = await jget("https://store.steampowered.com/api/storesearch/?term=" + encodeURIComponent(q) + "&cc=it&l=" + (BantaShell.lang && BantaShell.lang() === "it" ? "italian" : "english"));
    var items = (j && j.items) || [];
    gcxSteamItems = items;
    box.innerHTML = items.length ? items.slice(0, 12).map(function (x, i) {
      var pr = x.price && x.price.final != null ? eur(x.price.final / 100) : "";
      return '<div class="offer" data-gcx="steampick" data-i="' + i + '"><div class="b"><div>' + esc(x.name) + "</div><div>Steam" + (pr ? " · " + esc(pr) : "") + '</div></div><div class="pr">Add</div></div>';
    }).join("") : '<div class="muted">Not on Steam. Fill in the details by hand below.</div>';
  }
  var gcxSteamItems = [];
  async function steamPick(i) {
    var x = gcxSteamItems[i]; if (!x) return;
    var set = function (k, v) { var el = document.getElementById("e_" + k); if (el && v) el.value = v; };
    set("t", x.name); set("op", "PC"); set("f", fguess(x.name)); set("m", fguess(x.name));
    pendingSteam = { t: x.name, steam: x.id };
    var j = await jget("https://store.steampowered.com/api/appdetails?appids=" + x.id + "&cc=it&l=english");
    var d = j && j[x.id] && j[x.id].data;
    if (d && d.release_date && d.release_date.date && !d.release_date.coming_soon) { try { var ms = steamDate(d.release_date.date); if (ms) set("od", fmtISO(typeof ms === "number" ? dayStr(ms) : ms)); } catch (e) { /* keep empty */ } }
    toast("Filled in from Steam. Check the franchise, then Save.");
  }
  function linkPendingSteam() {
    if (!pendingSteam) return;
    var g = ex.filter(function (r) { return r.t === pendingSteam.t; }).pop();
    if (!g) return;
    live[g.id] = Object.assign(live[g.id] || {}, { steam: pendingSteam.steam });
    pendingSteam = null; S("live", live);
  }
  // the page defines openEditor after this file loads: wrap it once the page is ready
  function hookEditor() {
    var origEditor = window.openEditor;
    if (typeof origEditor !== "function" || origEditor._gcx) return;
    window.openEditor = function (id, preset) {
      var r = origEditor.apply(this, arguments);
      try {
        var box = document.getElementById("eLinks");
        if (box && id) box.insertAdjacentHTML("afterbegin", playsHtml(id));
        else if (box) box.innerHTML = '<div class="cbox"><h4>Search Steam</h4><div class="gcx-play"><input type="search" id="gcxSteamQ" placeholder="Game title" autocomplete="off"><button class="btn sm" data-gcx="steam">Search</button></div><div id="gcxSteamRes"></div></div>';
      } catch (e) { /* the sheet still works without these */ }
      return r;
    };
    window.openEditor._gcx = true;
  }
  document.addEventListener("keydown", function (e) { if (e.key === "Enter" && e.target && e.target.id === "gcxSteamQ") { e.preventDefault(); steamSearch(e.target.value); } }, true);
  var lastVer = -1, pubTimer = null;
  function watch() {
    if (typeof VER === "undefined" || VER === lastVer) return;
    lastVer = VER;
    try { linkPendingSteam(); } catch (e) { /* next time */ }
    clearTimeout(pubTimer);
    pubTimer = setTimeout(function () { try { publish(); } catch (e) { /* index is best-effort */ } }, 1500);
  }
  function start() {
    var sh = SH(); if (!sh || start.done) return;
    start.done = true;
    hookEditor();
    sh.onMessage(function (m) {
      if (m.restore) applyRestore();
      if (m.importFile) takeImport();
      if (m.open) { try { document.querySelector('[data-v="vGames"]').click(); } catch (e) { /* already there */ } openEditor(m.open); }
    });
    applyRestore();
    takeImport();
    setInterval(watch, 2000); watch();
  }
  document.addEventListener("DOMContentLoaded", start);
  window.addEventListener("load", start);

  document.addEventListener("change", function (e) {
    var t = e.target;
    if (!t || !t.getAttribute) return;
    if (t.getAttribute("data-gcx-target")) { SET.gcxT = SET.gcxT || {}; var v = parseFloat(String(t.value).replace(",", ".")); if (v > 0) SET.gcxT[t.getAttribute("data-gcx-target")] = v; else delete SET.gcxT[t.getAttribute("data-gcx-target")]; S("set", SET); toast(v > 0 ? "You'll be notified at " + eur(v) + " or less" : "Price alert removed"); }
    if (t.id === "gcxDisc") { SET.gcxDisc = Math.max(0, Math.min(95, parseInt(t.value, 10) || 0)); S("set", SET); }
    if (t.id === "gcxMine") { SET.gcxSubs = t.value; S("set", SET); }
  }, true);
  var mySubs = function () { return String(SET.gcxSubs == null ? "PC Game Pass" : SET.gcxSubs).split(/[,;]+/).map(function (x) { return x.trim().toLowerCase(); }).filter(Boolean); };

  document.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest("[data-gcx]");
    if (!b) return;
    var a = b.getAttribute("data-gcx");
    e.preventDefault();
    if (a === "regroup") regroup();
    else if (a === "subs") checkSubs();
    else if (a === "one") { var s = document.getElementById("gcxMv"); if (s && s.value) findMissing([s.value]); }
    else if (a === "next3") {
      var chk = AI.mvChecked || {}, now = Date.now();
      findMissing(mvList().filter(function (m) { return !chk[m.name] || now - chk[m.name] > 30 * DAYMS; }).slice(0, 3).map(function (m) { return m.name; }));
    } else if (a === "open") openEditor(b.getAttribute("data-id"));
    else if (a === "steam") steamSearch((document.getElementById("gcxSteamQ") || {}).value);
    else if (a === "steampick") steamPick(+b.getAttribute("data-i"));
    else if (a === "play") logPlay(b.getAttribute("data-id"), (document.getElementById("gcxPlayDate") || {}).value);
    else if (a === "unplay") { var id = b.getAttribute("data-id"), o = ov[id] = ov[id] || {}; o.plays = playsOf(id); o.plays.splice(+b.getAttribute("data-i"), 1); if (!o.plays.length) delete done[id]; saveAll(); renderAll(true); openEditor(id); }
  }, true);

  window.GCX = { importRows: importRows, playsOf: playsOf, steamSearch: steamSearch, fguess: fguess, aiHtml: aiHtml, storeHtml: storeHtml, tags: tags, mvList: mvList, regroup: regroup, findMissing: findMissing, checkSubs: checkSubs, gamePassCatalog: gamePassCatalog, SUBS: SUBS, publish: publish, applyRestore: applyRestore, priceAlerts: priceAlerts };
})();
