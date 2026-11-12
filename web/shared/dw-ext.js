/* Doctor Who tab: Gemini app (copy and paste) tools.
   Uses DW Canon's own globals (D, ST, tabById, tabItems, W, normT, addItem, save, render, reviewSheet, toast, applyOrder…),
   which exist once its main script has run. Suggestions go into the same "waiting for approval" queue as the wiki sync. */
(function () {
  "use strict";
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); };
  var today = function () { return new Date().toISOString().slice(0, 10); };
  var typeIds = function () { return D.types.map(function (t) { return t.id; }); };
  var typeList = function () { return D.types.map(function (t) { return t.id + " (" + t.label + ")"; }).join(", "); };
  var line = function (it, i) { var w = W(it.k); return (i + 1) + ". " + (typeOf(w.type).label) + " | " + w.title; };
  var JSON_END = "\nReply with one ```json code block and nothing else.";

  function allTabs() {
    var out = [];
    D.groups.forEach(function (g) { if (!isSkip(g)) g.tabs.forEach(function (t) { out.push({ g: g, t: t }); }); });
    (ST.custom || []).forEach(function (t) { if (!out.some(function (x) { return x.t.id === t.id; })) { var r = tabById(t.id); if (r) out.push(r); } });
    return out;
  }

  // ---------------------------------------------------------------- prompts
  function findPrompt(g, t) {
    var items = tabItems(t);
    return "You are an expert on the Doctor Who universe in every medium (TV, Big Finish and other audio, novels, short stories, comics, " +
      "webcasts, games, films). This is my reading/watching list for the timeline \"" + t.name + "\" (section: " + g.name + "), in in-universe order, " +
      "based on the TARDIS wiki page " + (pagesFor(t)[0] || "\"Theory:Timeline - " + t.name + "\"") + ".\n\n" +
      "Find stories that belong in this timeline but are missing from my list, including ones released or officially announced recently " +
      "(today is " + today() + "). Use Google Search and the TARDIS wiki (tardis.wiki) to check. Do not repeat anything already listed, " +
      "even under a slightly different title.\n" +
      "For each missing story say which listed title it comes straight after (copy that title exactly), or null if it comes first.\n" +
      "\"type\" must be one of: " + typeList() + ".\n" +
      "Shape: [{\"title\": \"...\", \"type\": \"audio\", \"after\": \"exact listed title or null\", \"release_date\": \"YYYY-MM-DD or null\", \"why\": \"a few words, e.g. range or source\"}]\n" +
      "Use [] if nothing is missing." + JSON_END + "\n\nMY LIST:\n" + items.map(line).join("\n");
  }

  function verifyPrompt(g, t) {
    var items = tabItems(t);
    return "Check my Doctor Who reading/watching list for the timeline \"" + t.name + "\" (section: " + g.name + ") against the TARDIS wiki " +
      "(tardis.wiki, page " + (pagesFor(t)[0] || "\"Theory:Timeline - " + t.name + "\"") + "). Use Google Search where unsure.\n" +
      "Report every listed entry that has a problem:\n" +
      "- \"order\": in the wrong place in the in-universe order\n- \"not_here\": doesn't feature this character/era, so it doesn't belong in this timeline\n" +
      "- \"duplicate\": the same story listed twice\n- \"type\": wrong medium (correct one in \"type\", one of: " + typeIds().join(", ") + ")\n" +
      "- \"title\": misspelled or outdated title (correct one in \"fix\")\n" +
      "If the order needs changes, also give the complete corrected order as \"order\": every listed title, copied exactly. Otherwise \"order\": null.\n" +
      "Shape: {\"issues\": [{\"title\": \"exact listed title\", \"problem\": \"order|not_here|duplicate|type|title\", \"fix\": \"short explanation\", \"type\": null}], \"order\": null}" +
      JSON_END + "\n\nMY LIST:\n" + tabItems(t).map(line).join("\n");
  }

  function newsPrompt(tabs) {
    var seen = {}, titles = [];
    tabs.forEach(function (x) { tabItems(x.t).forEach(function (it) { var w = W(it.k); var k = normT(w.title); if (!seen[k]) { seen[k] = 1; titles.push(w.title); } }); });
    return "Today is " + today() + ". I keep Doctor Who checklists, one per character timeline (TARDIS wiki \"Theory:Timeline\" pages). " +
      "Find Doctor Who stories in any medium released in the last 12 months or officially announced for the future that are NOT in my lists, " +
      "and say which of my timelines each belongs to (a story can go in several: give one row per timeline). Use Google Search, the TARDIS wiki, " +
      "Big Finish, BBC and publisher announcements.\n" +
      "\"tab\" must be one of my timeline names exactly. \"type\" one of: " + typeList() + ".\n" +
      "Shape: [{\"tab\": \"exact timeline name\", \"title\": \"...\", \"type\": \"audio\", \"release_date\": \"YYYY-MM-DD or null\", \"status\": \"released|announced\", \"why\": \"range / publisher\"}]\n" +
      "Use [] if there is nothing new." + JSON_END + "\n\nMY TIMELINES: " + tabs.map(function (x) { return x.t.name; }).join("; ") +
      "\n\nTITLES ALREADY IN MY LISTS (" + titles.length + "):\n" + titles.join("\n");
  }

  // ---------------------------------------------------------------- import
  function knownIn(t) {
    var s = {};
    tabItems(t).forEach(function (it) { s[normT(W(it.k).title)] = 1; });
    (ST.pending[t.id] || []).forEach(function (p) { s[p.nk] = 1; });
    (ST.rejected[t.id] || []).forEach(function (nk) { s[nk] = 1; });
    return s;
  }
  function toPending(t, rows, src) {
    var known = knownIn(t), ids = typeIds(), n = 0;
    var P = ST.pending[t.id] || (ST.pending[t.id] = []);
    rows.forEach(function (r) {
      var title = String(r.title || "").trim(), nk = normT(title);
      if (!title || !nk || known[nk]) return;
      known[nk] = 1;
      var ty = ids.indexOf(String(r.type || "").toLowerCase()) >= 0 ? String(r.type).toLowerCase() : "short";
      var why = [r.status === "announced" ? "announced" : "", r.release_date ? "released " + r.release_date : "", r.why || ""].filter(Boolean).join(" · ");
      P.push({ nk: nk, title: title, ty: ty, pageType: ty, status: "ok", ai: src, after: r.after ? String(r.after) : null, date: r.release_date || null,
               why: "Gemini" + (why ? ": " + why : ""), main: null, isNew: true });
      n++;
    });
    return n;
  }

  // Gemini suggestions don't carry a wiki timeline index, so they're placed after the title Gemini named.
  function wrapApprove() {
    if (typeof approveSug !== "function" || approveSug._dwx) return;
    var orig = approveSug;
    approveSug = function (t, p) {
      if (!p || !p.ai) return orig.apply(this, arguments);
      var it = addItem(t.id, p.title, p.pageType || "short", "", { wiki: "gemini", main: null, img: p.img || null });
      var items = tabItems(t).filter(function (x) { return x.id !== it.id; });
      var anchor = null;
      if (p.after) { var a = normT(p.after); for (var i = 0; i < items.length && !anchor; i++) if (normT(W(items[i].k).title) === a) anchor = items[i].id; }
      var order = items.map(function (x) { return x.id; });
      order.splice(anchor ? order.indexOf(anchor) + 1 : order.length, 0, it.id);
      ST.orders[t.id] = order;
      ST.pending[t.id] = (ST.pending[t.id] || []).filter(function (x) { return x.nk !== p.nk; });
      return true;
    };
    approveSug._dwx = true;
  }

  function fail(e) {
    if (e && e.cancelled) return;
    toast("Gemini: " + String(e && e.message || e).slice(0, 120));
  }

  // ---------------------------------------------------------------- actions
  function find(tid) {
    var r = tabById(tid); if (!r) return;
    closeSheet();
    BantaAI.ask({ title: "Find missing stories", note: r.t.name + " · " + tabItems(r.t).length + " entries", prompt: findPrompt(r.g, r.t),
      validate: function (v) { return Array.isArray(BantaAI.parseJson(v)) ? null : "That doesn’t contain the JSON list the prompt asked for. Copy Gemini’s whole answer and paste it again."; } })
      .then(function (text) {
        var n = toPending(r.t, BantaAI.parseJson(text) || [], "find");
        save(); render();
        if (n) reviewSheet([r.t.id], "Gemini found " + n + " missing stor" + (n === 1 ? "y" : "ies") + ". Approve to add each one after the story Gemini named.");
        else toast("Gemini found nothing missing in " + r.t.name);
      }, fail);
  }

  function verify(tid) {
    var r = tabById(tid); if (!r) return;
    closeSheet();
    var items = tabItems(r.t);
    BantaAI.ask({ title: "Verify this timeline", note: r.t.name + " · " + items.length + " entries", prompt: verifyPrompt(r.g, r.t),
      validate: function (v) { var j = BantaAI.parseJson(v); return j && typeof j === "object" ? null : "That doesn’t contain the JSON the prompt asked for. Copy Gemini’s whole answer and paste it again."; } })
      .then(function (text) {
        var j = BantaAI.parseJson(text) || {};
        var issues = Array.isArray(j) ? j : (j.issues || []);
        var byNk = {};
        items.forEach(function (it) { var k = normT(W(it.k).title); (byNk[k] = byNk[k] || []).push(it); });
        var LABEL = { order: "Order", not_here: "Not in this timeline", duplicate: "Duplicate", type: "Wrong type", title: "Title" };
        var list = issues.map(function (x, i) {
          return { id: "i" + i, readonly: true, title: String(x.title || "?"), tag: LABEL[x.problem] || String(x.problem || "Note"), tagClass: x.problem === "order" ? "new" : "bad",
                   sub: (x.fix || "") + (byNk[normT(x.title)] ? "" : " (not matched in your list)") };
        });
        var order = Array.isArray(j.order) ? j.order : null, res = null, matched = 0;
        if (order && order.length) {
          var used = {};
          res = order.map(function (title) {
            var c = (byNk[normT(title)] || []).filter(function (it) { return !used[it.id]; })[0];
            if (c) { used[c.id] = 1; matched++; }
            return { it: c || null };
          });
          var cur = items.map(function (it) { return it.id; }).join(",");
          var next = res.filter(function (x) { return x.it; }).map(function (x) { return x.it.id; });
          if (matched < 2 || cur.indexOf(next.join(",")) === 0) res = null;
          else list.unshift({ id: "order", title: "Use Gemini’s order", tag: "Reorder", tagClass: "new",
                              sub: matched + " of " + items.length + " entries matched; unmatched ones keep their place next to their neighbours. You can undo." });
        }
        return BantaAI.review({ title: issues.length ? issues.length + " thing" + (issues.length === 1 ? "" : "s") + " to look at" : "No problems found",
          note: r.t.name + ". Gemini can be wrong: open the wiki from the story sheet before changing anything by hand.", items: list,
          ok: res ? "Apply" : "Done", cancel: "Close", empty: "Gemini found nothing wrong with this timeline." })
          .then(function (ids) {
            if (res && ids.indexOf("order") >= 0) {
              var before = ST.orders[r.t.id] ? ST.orders[r.t.id].slice() : null;
              applyOrder(r.t, res); save(); render();
              toast("Order updated from Gemini", function () { if (before) ST.orders[r.t.id] = before; else delete ST.orders[r.t.id]; save(); });
            }
          });
      }, fail);
  }

  function news() {
    var tabs = allTabs();
    BantaAI.ask({ title: "New releases & announcements", note: tabs.length + " timelines", prompt: newsPrompt(tabs),
      validate: function (v) { return Array.isArray(BantaAI.parseJson(v)) ? null : "That doesn’t contain the JSON list the prompt asked for. Copy Gemini’s whole answer and paste it again."; } })
      .then(function (text) {
        var rows = BantaAI.parseJson(text) || [], byTab = {}, total = 0, ids = [];
        rows.forEach(function (r) {
          var name = normT(r.tab || "");
          var hit = tabs.filter(function (x) { return normT(x.t.name) === name; })[0];
          if (hit) (byTab[hit.t.id] = byTab[hit.t.id] || []).push(r);
        });
        Object.keys(byTab).forEach(function (id) { var n = toPending(tabById(id).t, byTab[id], "news"); if (n) { total += n; ids.push(id); } });
        save(); render();
        if (total) reviewSheet(ids, "Gemini found " + total + " new or announced stor" + (total === 1 ? "y" : "ies") + ". New ones are added at the end of each timeline; move them if needed.");
        else toast("Nothing new that isn’t already in your lists");
      }, fail);
  }

  // ---------------------------------------------------------------- where to watch / listen / read
  function availPrompt(g, t, items) {
    return "Today is " + today() + ". For each Doctor Who story below (from the timeline \"" + t.name + "\"), say where I can get it LEGALLY right now:\n" +
      "- \"italy\": options in Italy (streaming services, free official sources, buying digital/physical, library apps such as MLOL)\n" +
      "- \"world\": streaming services in other countries usable with a VPN (e.g. BBC iPlayer UK, BritBox, Disney+ in another region, Tubi/Pluto US), with the country code\n" +
      "Types are TV episodes, Big Finish and BBC audio, novels, short stories, comics, webcasts, games. Use Google Search for current availability; leave lists empty when unsure.\n" +
      "\"how\" is one of: stream, free, buy, rent, library. Put the cheapest or included option first.\n" +
      "Shape: [{\"n\": 1, \"italy\": [{\"service\": \"Disney+\", \"how\": \"stream\", \"note\": \"4K\"}], \"world\": [{\"service\": \"BBC iPlayer\", \"country\": \"GB\", \"how\": \"free\"}]}]" +
      JSON_END + "\n\nSTORIES (number. type | title):\n" + items.map(line).join("\n");
  }

  function avail(tid) {
    var r = tabById(tid); if (!r) return;
    closeSheet();
    var items = tabItems(r.t).filter(function (it) { var a = ST.avail && ST.avail[it.k]; return !a || Date.now() - a.ts > 30 * 864e5; });
    if (!items.length) items = tabItems(r.t);
    items = items.slice(0, 80);
    BantaAI.ask({ title: "Where to watch, listen or read", note: r.t.name + " · " + items.length + " stories, in Italy and abroad with a VPN", prompt: availPrompt(r.g, r.t, items),
      validate: function (v) { return Array.isArray(BantaAI.parseJson(v)) ? null : "That doesn’t contain the JSON list the prompt asked for. Copy Gemini’s whole answer and paste it again."; } })
      .then(function (text) {
        ST.avail = ST.avail || {};
        var n = 0, now = Date.now();
        (BantaAI.parseJson(text) || []).forEach(function (d) {
          var it = items[parseInt(d.n, 10) - 1];
          if (!it) return;
          var clean = function (l) { return (Array.isArray(l) ? l : []).filter(function (x) { return x && x.service; }).slice(0, 8).map(function (x) {
            return { service: String(x.service).slice(0, 40), how: String(x.how || "").slice(0, 12), country: x.country ? String(x.country).toUpperCase().slice(0, 2) : "", note: x.note ? String(x.note).slice(0, 40) : "" }; }); };
          ST.avail[it.k] = { it: clean(d.italy), world: clean(d.world), ts: now };
          n++;
        });
        save(); render();
        toast("Availability saved for " + n + " stor" + (n === 1 ? "y" : "ies") + ": open a story to see it");
      }, fail);
  }

  var FLAG = function (cc) { return /^[A-Z]{2}$/.test(cc) ? String.fromCodePoint(0x1F1E6 + cc.charCodeAt(0) - 65, 0x1F1E6 + cc.charCodeAt(1) - 65) : ""; };
  function availHtml(k) {
    var a = ST.avail && ST.avail[k];
    var chip = function (x, abroad) { return '<span class="badge' + (x.how === "free" || x.how === "stream" ? " ok" : "") + '">' + (abroad ? FLAG(x.country) + " " : "") + esc(x.service) + (x.how ? " · " + esc(x.how) : "") + (x.note ? " · " + esc(x.note) : "") + "</span>"; };
    if (!a) return '<div class="panel dwx-av"><h3>Where to get it</h3><div class="meta">Not checked yet: timeline ⋯ › ✦ Gemini › Where to watch, listen or read.</div></div>';
    return '<div class="panel dwx-av"><h3>Where to get it</h3>' +
      '<div class="meta" style="margin:6px 0 4px">🇮🇹 In Italy</div><div class="wrap">' + (a.it.length ? a.it.map(function (x) { return chip(x, false); }).join("") : '<span class="meta">nothing found</span>') + "</div>" +
      '<div class="meta" style="margin:10px 0 4px">With a VPN</div><div class="wrap">' + (a.world.length ? a.world.map(function (x) { return chip(x, true); }).join("") : '<span class="meta">nothing found</span>') + "</div>" +
      '<div class="meta" style="margin-top:8px">From Gemini, ' + new Date(a.ts).toLocaleDateString() + ". Using a VPN for another country’s catalogue can break a service’s terms.</div></div>";
  }

  function wrapItemSheet() {
    if (typeof itemSheet !== "function" || itemSheet._dwx) return;
    var orig = itemSheet;
    itemSheet = function (k) {
      var r = orig.apply(this, arguments);
      try { var sh = document.getElementById("sheet"); if (sh) sh.insertAdjacentHTML("beforeend", availHtml(k)); } catch (e) { /* sheet layout changed */ }
      return r;
    };
    itemSheet._dwx = true;
  }

  function panel() {
    return '<div class="panel dwx"><div class="row"><h3 style="flex:1;margin:0">✦ Gemini app</h3><span class="badge">copy &amp; paste</span></div>' +
      '<div class="meta" style="margin:6px 0 10px">Uses your Gemini app with Google Search; no key needed. Suggestions wait for your approval like wiki syncs.</div>' +
      '<div class="wrap"><button class="btn pri" data-dwx="news">✦ New releases &amp; announcements</button></div>' +
      '<div class="meta" style="margin-top:8px">Per timeline: open it and tap ✦ Gemini.</div></div>';
  }

  function menu(tid) {
    var r = tabById(tid); if (!r) return;
    openSheet('<h3>✦ Gemini · ' + esc(r.t.name) + '</h3><div class="meta">Copy a prompt into the Gemini app, paste its answer back. Nothing changes until you approve it.</div>' +
      '<div class="links" style="flex-direction:column;align-items:stretch;margin-top:12px">' +
      '<button class="btn pri" data-dwx="find" data-tid="' + esc(tid) + '">Find missing stories</button>' +
      '<button class="btn" data-dwx="verify" data-tid="' + esc(tid) + '">Verify order &amp; entries</button>' +
      '<button class="btn" data-dwx="avail" data-tid="' + esc(tid) + '">Where to watch, listen or read (Italy + VPN)</button>' +
      '<button class="btn" data-dwx="news">New releases across all timelines</button></div>');
  }

  document.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest("[data-dwx]");
    if (!b) return;
    e.preventDefault(); e.stopPropagation();
    var a = b.getAttribute("data-dwx"), tid = b.getAttribute("data-tid") || (typeof cur !== "undefined" && cur ? cur.t : null);
    try {
      if (a === "find") find(tid);
      else if (a === "verify") verify(tid);
      else if (a === "news") { closeSheet(); news(); }
      else if (a === "menu") menu(tid);
      else if (a === "avail") avail(tid);
    } catch (x) { fail(x); }
  }, true);
  // ---------------------------------------------------------------- shared with the other tabs
  var SH = function () { return window.BantaShell && BantaShell.shared; };
  function publish() {
    var sh = SH(); if (!sh) return;
    var seen = {}, stories = [], total = { n: 0, d: 0 }, next = [];
    allTabs().forEach(function (x) {
      var items = tabItems(x.t), dn = 0, first = null;
      items.forEach(function (it) {
        var w = W(it.k);
        if (w.done) dn++; else if (!first) first = { k: it.k, t: w.title, tab: x.t.id, tabName: x.t.name };
        if (seen[it.k]) return;
        seen[it.k] = 1;
        total.n++; if (w.done) total.d++;
        stories.push({ k: it.k, t: w.title, ty: typeOf(w.type).label, tab: x.t.id, tabName: x.t.name, d: w.done ? 1 : 0 });
      });
      if (dn && dn < items.length && first) { first.pct = dn / items.length; next.push(first); }
    });
    next.sort(function (a, b) { return b.pct - a.pct; });
    sh.write("index_dw.json", JSON.stringify({ ts: Date.now(), stories: stories, total: total, next: next.slice(0, 8) }));
    sh.write("snap_dw.json", JSON.stringify({ app: "dwcanon", v: 1, state: ST }));
  }
  function applyRestore() {
    var sh = SH(); if (!sh) return false;
    var text = sh.read("restore_dw.json");
    if (!text) return false;
    sh.remove("restore_dw.json");
    try {
      var j = JSON.parse(text);
      if (j.app !== "dwcanon" || !j.state) throw new Error("not a DW Canon backup");
      ST = j.state; fill(); injectCustom(); save(); closeSheet(); render();
      toast("Doctor Who backup restored");
      return true;
    } catch (e) { toast("Doctor Who restore failed: " + e.message); return false; }
  }
  function openStory(k, tid) {
    var r = tabById(tid); if (!r) return;
    var gi = D.groups.indexOf(r.g);
    try { go(gi < 0 ? 0 : gi, r.t.id); } catch (e) { /* stay where we are */ }
    var it = tabItems(r.t).filter(function (x) { return x.k === k; })[0];
    if (it) setTimeout(function () { itemSheet(it.k, it.id); }, 150);
  }
  var pubTimer = null;
  function wrapSave() {
    if (typeof save !== "function" || save._dwx) return;
    var orig = save;
    save = function () {
      var r = orig.apply(this, arguments);
      clearTimeout(pubTimer);
      pubTimer = setTimeout(function () { try { publish(); } catch (e) { /* index is best-effort */ } }, 1500);
      return r;
    };
    save._dwx = true;
  }
  function startShared() {
    var sh = SH(); if (!sh || startShared.done || typeof ST === "undefined" || !ST) return;
    startShared.done = true;
    sh.onMessage(function (m) { if (m.restore) applyRestore(); if (m.open) openStory(m.open, m.tab); });
    applyRestore();
    // Banta's ratings and ticks that used to ship inside the app become save data (so backups carry them)
    try {
      if (window.DW_MINE && !(ST.ui && ST.ui.mineMoved)) {
        var M = window.DW_MINE.works;
        for (var k in M) { var cur = ST.works[k] || {}; var add = {}; if (cur.rating === undefined && M[k].rating != null) add.rating = M[k].rating; if (cur.done === undefined && M[k].done) add.done = M[k].done; if (Object.keys(add).length) ST.works[k] = Object.assign({}, cur, add); }
        ST.ui = ST.ui || {}; ST.ui.mineMoved = 1; save();
      }
    } catch (e) { /* stays in the overlay */ }
    setTimeout(function () { try { publish(); } catch (e) { /* index is best-effort */ } }, 800);
  }

  var wrapAll = function () { wrapApprove(); wrapItemSheet(); wrapSave(); startShared(); };
  document.addEventListener("DOMContentLoaded", wrapAll);
  window.addEventListener("load", wrapAll);

  window.DWX = { panel: panel, menu: menu, find: find, verify: verify, news: news, avail: avail, availHtml: availHtml, publish: publish, applyRestore: applyRestore, openStory: openStory, _prompts: { findPrompt: findPrompt, verifyPrompt: verifyPrompt, newsPrompt: newsPrompt } };
})();
