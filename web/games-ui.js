/* Games screens: poster grid with filters, franchises and multiverses, the game page (status, rating, playthroughs
   with dates, price and stores, details), add from Steam or by hand. Uses Saga (set by app.js) and Kit. */
(function () {
  "use strict";
  const G = window.GamesCore, K = window.Kit, esc = K.esc;
  const ui = { f: "all", sort: "release", q: "", view: "grid", lim: 120, res: null, busy: false, open: null };
  const today = () => new Date().toISOString().slice(0, 10);
  const lib = () => Saga.games;
  const save = () => { lib().save(); Saga.changed("games"); };
  const cover = g => (g.cover || (g.steam ? G.COVER(g.steam) : ""));
  const eur = n => (n == null ? "" : n === 0 ? "Free" : `€${(+n).toFixed(2).replace(".", Saga.lang() === "it" ? "," : ".")}`);
  function posterOf(g, opt = {}) {
    const t = today();
    const badge = g.status === "playing" ? "Playing" : g.next && g.status !== "done" ? "Next" : g.date && g.date > t ? K.when(g.date, Saga.lang()).replace(/^\d+ /, "") : "";
    const cut = Math.max(g.price && g.price.disc || 0, g.deal && g.deal.cut || 0);
    const badgeR = cut >= 10 && g.status !== "done" ? `${g.deal && g.deal.atLow && g.deal.cut === cut ? "Low " : ""}−${cut}%` : g.plays.length > 1 ? `${g.plays.length}×` : "";
    return K.poster({ key: "game:" + g.id, title: g.title, img: cover(g), kind: "game", badge, badgeAcc: g.status === "playing", badgeR, done: g.status === "done", attrs: `data-action="gopen" data-id="${esc(g.id)}"` });
  }
  const tileOf = (g, why) => `<div class="tile">${posterOf(g)}<div class="cap">${esc(g.title)}</div><div class="cap2">${why ? esc(why) + " · " : ""}${ui.sort === "played" && G.timePlayed(g).mins ? esc(G.hrs(G.timePlayed(g).mins) + " played") + " · " : ""}${esc(ui.sort === "remake" && g.remake ? `Remake ${g.remake.date ? g.remake.date.slice(0, 4) : ""} · ${g.remake.platform || ""}` : [G.yearOf(g), g.platform].filter(Boolean).join(" · "))}</div></div>`;

  function listFor() {
    const t = today(), q = G.norm(ui.q);
    let list = lib().visible().filter(g => {
      if (q && !G.norm(g.title + " " + g.franchise + " " + g.multiverse).includes(q)) return false;
      if (ui.f === "all") return true;
      if (ui.f === "next") return g.next && g.status !== "done";
      if (ui.f === "upcoming") return g.date && g.date > t && g.status !== "done";
      if (ui.f === "owned") return g.owned && g.status !== "done";
      if (ui.f === "sale") return ((g.price && g.price.disc > 0) || (g.deal && g.deal.cut > 0)) && g.status !== "done";
      if (ui.f === "lowest") return g.deal && g.deal.atLow && g.deal.cut > 0 && g.status !== "done";
      if (ui.f === "subs") return g.subs && g.subs.length > 0 && g.status !== "done";
      if (ui.f === "remakes") return !!g.remake;
      return g.status === ui.f;
    });
    const by = {
      release: (a, b) => (a.date || "9999").localeCompare(b.date || "9999") || a.title.localeCompare(b.title),
      deal: (a, b) => ((b.deal && b.deal.atLow && b.deal.cut ? 1 : 0) - (a.deal && a.deal.atLow && a.deal.cut ? 1 : 0)) || (Math.max(b.deal ? b.deal.cut : 0, b.price ? b.price.disc || 0 : 0) - Math.max(a.deal ? a.deal.cut : 0, a.price ? a.price.disc || 0 : 0)) || a.title.localeCompare(b.title),
      recent: (a, b) => (b.plays[b.plays.length - 1] || "").localeCompare(a.plays[a.plays.length - 1] || "") || (b.added || 0) - (a.added || 0),
      title: (a, b) => a.title.localeCompare(b.title), rating: (a, b) => (b.rating || 0) - (a.rating || 0) || (b.imdbR || 0) - (a.imdbR || 0),
      remake: (a, b) => ((a.remake && a.remake.date) || a.date || "9999").localeCompare((b.remake && b.remake.date) || b.date || "9999") || a.title.localeCompare(b.title),
      newest: (a, b) => (b.date || "").localeCompare(a.date || "") || a.title.localeCompare(b.title),
      short: (a, b) => (a.hours || 999) - (b.hours || 999), played: (a, b) => G.timePlayed(b).mins - G.timePlayed(a).mins || a.title.localeCompare(b.title), price: (a, b) => ((a.price || {}).eur ?? 999) - ((b.price || {}).eur ?? 999) };
    return list.sort(by[ui.sort] || by.release);
  }

  function render(S) {
    const L = lib(), c = L.counts();
    if (ui.res || ui.busy) return renderSearch();
    if (!L.games.length) {
      return `<div class="empty2"><div class="kicker">Games</div><h2>Your games, all in one place</h2>
        <p>Search Steam to add a game, import your own games spreadsheet (.xlsx or .csv), your Steam library, HowLongToBeat, Grouvee or Backloggd, or let your IMDb ratings bring the games you've rated.</p>
        <div class="row wrap" style="justify-content:center"><button class="btn primary" data-action="gadd">${K.icon("plus")}Add a game</button>
        <button class="btn" data-action="go" data-sec="settings" data-scroll="importhub">${K.icon("upload")}Import</button></div></div>`;
    }
    const playing = L.nextUp(12);
    const f = [["all", "All", c.all], ["playing", "Playing", c.playing], ["paused", "Paused", c.paused], ["next", "Next", c.next], ["backlog", "Backlog", c.backlog], ["done", "Finished", c.done],
      ["wishlist", "Wishlist", c.wishlist], ["upcoming", "Upcoming", c.upcoming], ["owned", "Owned, to play", null], ["sale", "On sale", null], ["lowest", "At its lowest", null], ["subs", "In a subscription", null], ["remakes", "Has a remake", null], ["dropped", "Dropped", c.dropped]];
    const list = ui.view === "grid" ? listFor() : [];
    return `${playing.length && ui.f === "all" && !ui.q ? `<section>${K.head("Playing and up next", "", playing.length)}${K.rail(playing.map(g => tileOf(g, L.whyNext(g))))}</section>` : ""}
      <div class="subnav">${[["grid", "Library"], ["mv", "Franchises"], ["canon", "Missing"], ["stats", "Stats"]].map(([k, l]) => `<button data-action="gview" data-v="${k}" ${ui.view === k ? 'aria-current="page"' : ""}>${l}</button>`).join("")}</div>
      <div class="toolbar"><input type="search" data-gq="1" data-input="gq" value="${esc(ui.q)}" placeholder="Filter your games" autocomplete="off">
        ${ui.view === "grid" ? `<select data-gsort="1" aria-label="Sort">${[["release", "Release (oldest)"], ["newest", "Release (newest)"], ["remake", "Remake release"], ["recent", "Recently played"], ["played", "Most played"], ["title", "Title"], ["rating", "Rating"], ["deal", "Best deal"], ["short", "Shortest"], ["price", "Price"]].map(([k, l]) => `<option value="${k}" ${ui.sort === k ? "selected" : ""}>${l}</option>`).join("")}</select>` : ""}
        <button class="iconbtn" data-action="gadd" aria-label="Add a game">${K.icon("plus")}</button></div>
      ${ui.view !== "stats" ? strip() : ""}
      ${ui.view === "check" ? renderCheck() : ui.view === "canon" ? renderCanon() : ui.view === "stats" ? renderStats() : ui.view === "grid" ? `<div class="chips" style="margin-bottom:14px">${f.map(([k, l, n]) => `<button class="chip" data-action="gfilter" data-v="${k}" aria-pressed="${ui.f === k}">${l}${n != null ? ` <span class="muted">${n}</span>` : ""}</button>`).join("")}</div>
        ${list.length ? K.grid(list.slice(0, ui.lim).map(g => tileOf(g))) : `<p class="muted">Nothing here.</p>`}
        ${list.length > ui.lim ? `<button class="btn block automore" style="margin-top:16px" data-action="gmore">Show more (${list.length - ui.lim})</button>` : ""}
        <p class="small muted" style="margin-top:16px">${c.all} games · ${c.done} finished · ${c.plays} playthroughs</p>` : renderMv()}`;
  }
  // a line of the main numbers at the top of Library and Franchises
  function strip() {
    const s = G.stats(lib());
    return `<div class="sstrip"><div><b>${s.total}</b><span>games</span></div><div><b>${s.done}</b><span>finished</span></div><div><b>${s.backlogDone}%</b><span>backlog cleared</span></div>
      ${(() => { const h = Math.round(lib().visible().reduce((t, g) => t + G.timePlayed(g).mins, 0) / 60); return h ? `<div><b>${fmt(h)} h</b><span>played (Steam, HLTB, sessions)</span></div>` : ""; })()}<div><b>${s.avg != null ? "★ " + s.avg : "–"}</b><span>average</span></div><div><b>${s.ownedUnplayed}</b><span>owned, unplayed</span></div></div>`;
  }
  // 0.6.9: the backlog in hours, at the pace you finish games, and short owned games to finish next
  const fmt = n => Number(n || 0).toLocaleString(Saga.lang && Saga.lang() === "it" ? "it-IT" : "en-GB");
  function backlogCard() {
    const b = G.backlogHours(lib()), steamH = Math.round(lib().visible().reduce((a, g) => a + (g.steamMins || 0), 0) / 60);
    if (!b.games) return "";
    const pace = b.years == null ? "Finish a few games with a How Long To Beat time to see how long it would take at your pace."
      : b.years < 1 ? `At your pace (${fmt(b.paceH)} h of games finished in the last 12 months) that's about ${Math.max(1, Math.round(b.years * 12))} months.`
      : `At your pace (${fmt(b.paceH)} h of games finished in the last 12 months) that's about ${b.years < 10 ? b.years.toFixed(1) : Math.round(b.years)} years.`;
    return `<section class="card" style="padding:14px"><div class="kicker">Backlog</div>
      <p class="small"><b>${fmt(b.hours)} h</b> to beat ${fmt(b.known)} of your ${fmt(b.games)} games still to play (How Long To Beat${b.known < b.games ? `; ${fmt(b.games - b.known)} have no time` : ""}). ${pace}${steamH ? ` Steam counts ${fmt(steamH)} h played in all.` : ""}</p>
      ${b.quick.length ? `<div class="kicker" style="margin-top:8px">Short ones you own${b.quick.some(g => b.started.has(G.norm(g.franchise))) ? ", series you've started first" : ""}</div>
        <div class="listcard">${b.quick.map(g => `<div class="item" data-action="gopen" data-id="${esc(g.id)}" role="button"><span class="grow ell">${esc(g.title)}</span><span class="small muted">${g.hours} h${b.started.has(G.norm(g.franchise)) ? " · " + esc(g.franchise) : ""}</span></div>`).join("")}</div>` : ""}</section>`;
  }
  function renderStats() {
    const s = G.stats(lib()), mx = Math.max(1, ...s.hist), mm = Math.max(1, ...s.months);
    const rows = (list, f) => list.slice(0, 12).map(o => `<div class="item"><span class="grow ell">${esc(o.k)}</span><span class="small muted">${f(o)}</span></div>`).join("");
    return `<div class="statgrid">
      <section class="card" style="padding:14px"><div class="kicker">Status</div>
        <div class="sstrip" style="flex-wrap:wrap">${[["Finished", s.done], ["Playing", s.playing], ["Paused", s.paused], ["Backlog", s.backlog], ["Wishlist", s.wishlist], ["Dropped", s.dropped]].map(([l, n]) => `<div><b>${n}</b><span>${l}</span></div>`).join("")}</div>
        <p class="small">Backlog cleared: <b>${s.backlogDone}%</b> (finished out of finished, playing, paused and backlog) · owned but not played: <b>${s.ownedUnplayed}</b>${s.backlogHours ? ` (about ${s.backlogHours} h to beat them all)` : ""}</p></section>
      ${backlogCard()}
      <section class="card" style="padding:14px"><div class="kicker">Playtime</div>
        <p class="small">${s.playedHours} h logged in sessions · ${s.plays} playthroughs${s.avgBeat ? ` · ${s.avgBeat} h to beat a finished game, on average` : ""}</p>
        <div class="kicker" style="margin-top:8px">Sessions per month, ${new Date().getFullYear()}</div><div class="months" style="height:80px">${s.months.map(n => `<i style="height:${Math.round((100 * n) / mm)}%" title="${Math.round(n / 60)} h"></i>`).join("")}</div></section>
      <section class="card" style="padding:14px"><div class="kicker">Ratings</div>
        <p class="small">${s.rated} rated · average <b>★ ${s.avg != null ? s.avg : "–"}</b>${s.vsImdb != null ? ` · ${s.vsImdb >= 0 ? "+" : ""}${s.vsImdb} against IMDb` : ""}</p>
        <div class="hist">${s.hist.map(n => `<i style="height:${Math.round((100 * n) / mx)}%" title="${n}"></i>`).join("")}</div><div class="histl">${s.hist.map((_, i) => `<span>${i + 1}</span>`).join("")}</div></section>
      <section class="card" style="padding:14px"><div class="kicker">By platform</div>${rows(s.platforms, o => `${o.n} · ${o.done} finished${o.avg != null ? ` · ★ ${o.avg}` : ""}`)}</section>
      <section class="card" style="padding:14px"><div class="kicker">Franchises closest to done</div>${rows(s.franchises, o => `${o.done}/${o.n}${o.avg != null ? ` · ★ ${o.avg}` : ""}`)}</section>
      <section class="card" style="padding:14px"><div class="kicker">By decade</div>${rows(s.decades, o => `${o.n}${o.avg != null ? ` · ★ ${o.avg}` : ""}`)}</section>
      ${s.wishValue || s.sale ? `<section class="card" style="padding:14px"><div class="kicker">Wishlist</div><p class="small">${s.sale} on sale now${s.wishValue ? ` · about €${s.wishValue} for all of it at today's prices` : ""}</p></section>` : ""}
    </div>`;
  }
  // 0.6.9.7: canon games you don't have yet (from your canon lists and the AI scans), by series; what isn't out yet is
  // listed apart and not counted
  function canonRows() {
    const C = window.Core, db = Saga.db;
    if (!C || !C.gameCanon) return [];
    const st = db.ver ? db.ver() : 0;
    if (ui.cMemo && ui.cMemo.st === st && ui.cMemo.n === lib().games.length && ui.cMemo.at > Date.now() - 4000) return ui.cMemo.rows;
    // 0.7.6: without tie-ins, non-canon, story-less games and versions (see GC.missingRows)
    const m = G.missingRows(C, db, lib()), rows = m.rows;
    ui.cMemo = { st, n: lib().games.length, at: Date.now(), rows, hidden: m.hidden };
    return rows;
  }
  function renderCanon() {
    const rows = canonRows(), q = G.norm(ui.q || "");
    if (!rows.length) return `<div class="empty2"><h3>No canon games yet</h3><p class="muted">Canon games come from your canon lists (Settings › Canon sources) and the AI canon scan (Watch › Missing), which now also checks the games in this tab.</p></div>`;
    const fr = new Map();
    for (const c of rows) { if (q && !G.norm(c.title).includes(q) && !G.norm(c.franchise).includes(q)) continue; const f = fr.get(c.franchise) || { name: c.franchise, have: 0, total: 0, miss: [], soon: [] }; if (c.unreleased) f.soon.push(c); else { f.total++; if (c.have) f.have++; else f.miss.push(c); } fr.set(c.franchise, f); }
    const list = [...fr.values()].filter(f => f.miss.length || f.soon.length).sort((a, b) => b.miss.length - a.miss.length || a.name.localeCompare(b.name));
    const all = rows.filter(c => !c.unreleased), have = all.filter(c => c.have).length;
    const hid = (ui.cMemo && ui.cMemo.hidden) || [];
    const row = c => `<div class="item"><div class="grow" style="min-width:0"><b class="ell" style="display:block">${esc(c.title)}</b>${c.versions && c.versions.length ? `<div class="small muted ell">also ${c.versions.map(v => `${esc(v.title)}${v.year ? ` (${v.year})` : ""}`).join(", ")}</div>` : ""}<div class="small muted">${esc([c.date || c.year || "", c.sub, window.Core && Core.canonFrom ? "from " + Core.canonFrom(c) : ""].filter(Boolean).join(" · "))}${c.unreleased ? " · <b>Not out yet</b>" : ""}${(() => { const m = ((lib().meta || {}).canonImdb || {})[`${G.norm(c.title)}|${c.year || ""}`]; return m && m.imdb ? ` · IMDb${m.r ? ` ★ ${m.r}` : ""}${m.votes ? ` (${m.votes.toLocaleString()})` : ""}, not rated by you` : m && m.none ? " · not on IMDb" : ""; })()}</div></div>
      <button class="btn small" data-action="gcanonadd" data-t="${esc(c.title)}" data-y="${esc(c.date || c.year || "")}" data-i="${esc(c.imdb || "")}" data-f="${esc(c.franchise)}">${K.icon("plus")}Wishlist</button>
      <button class="iconbtn" data-action="gcanonno" data-t="${esc(c.title)}" data-y="${esc(c.year || "")}" data-i="${esc(c.imdb || "")}" data-f="${esc(c.franchise)}" aria-label="Not canon" title="Not canon">${K.icon("notcanon")}</button></div>`;
    const gaps = lib().visible().filter(g => !g.aiAt && (!g.date || !g.platform || g.hours == null)).length;
    return `<div class="row wrap" style="gap:8px;margin:4px 0"><button class="btn small" data-action="gcanoncheck">${K.icon("spark")}AI canon check</button><button class="btn small" data-action="gcanonimdb">${K.icon("sync")}Check on IMDb (rating, finished)</button><button class="btn small" data-action="ginfoall">${K.icon("sync")}Fill missing details with AI${gaps ? ` (${fmt(gaps)} games)` : ""}</button></div>
      ${hid.length ? `<details class="small muted" style="margin:6px 0"><summary>${fmt(hid.length)} left out: tie-ins to film or TV series, not canon, no story, or another version of a game listed</summary>${hid.slice(0, 80).map(h => `<div>${esc(h.c.title)}${h.c.year ? ` (${h.c.year})` : ""}: ${esc(h.why)}</div>`).join("")}</details>` : ""}
      <p class="muted" style="margin:4px 0 12px">You have ${fmt(have)} of ${fmt(all.length)} canon games (${Math.round(100 * have / Math.max(1, all.length))}%), in ${fmt(fr.size)} series. Your Games tab is what counts: IMDb lists are only a source.</p>`
      + (list.length ? list.slice(0, ui.cLim || 40).map(f => `<section>${K.head(f.name, `${f.have} of ${f.total}`, f.miss.length)}<div class="listcard">${f.miss.map(row).join("")}${f.soon.map(row).join("")}</div></section>`).join("")
        + (list.length > (ui.cLim || 40) ? `<button class="btn block" data-action="gcanonmore">Show more</button>` : "") : `<p class="muted">You have every canon game${q ? " that matches" : ""}.</p>`);
  }
  function renderMv() {
    const q = G.norm(ui.q);
    // 0.7.6b: series as the canon scans found them (your list's names kept), whenever the canon or your games changed
    try { const C = window.Core, db = Saga.db, v = `${db.canon().length}|${lib().games.length}`; if (C && C.gameCanon && ui.fcVer !== v) { ui.fcVer = v; const ch = lib().followCanon(C.gameCanon(db, lib().visible())).concat(lib().resolveFranchises()); if (ch.length) ui.fcVer = `${db.canon().length}|${lib().games.length}`; } } catch (e) { /* as they are */ }
    const all = lib().multiverses(ui.mvSort || "remake");
    const mvs = all.filter(m => !q || G.norm(m.name).includes(q) || m.series.some(s => G.norm(s.name).includes(q)) || m.all.some(g => G.norm(g.title).includes(q)));
    const chip = (v, l) => `<button class="chip" data-action="gmvsort" data-v="${v}" aria-pressed="${(ui.mvSort || "remake") === v}">${l}</button>`;
    const open = ui.mvOpen || (ui.mvOpen = {});
    // 0.7.9: one entry per multiverse, all its games in one row; "Series" opens it into its sub-series. The same title
    // twice in a row (two platforms, two games of one name) shows its platform and year.
    const rail = gs => { const n = new Map(); for (const g of gs) n.set(G.norm(g.title), (n.get(G.norm(g.title)) || 0) + 1);
      return K.rail(gs.map(g => tileOf(g, n.get(G.norm(g.title)) > 1 ? [g.platform, String(g.date || "").slice(0, 4)].filter(Boolean).join(" · ") : ""))); };
    const LIM = 24, MVL = ui.mvLim || 12; // 0.8.1: fewer tiles at once (the page laid out thousands of posters); more as you scroll
    return `<div class="chips" style="margin-bottom:10px">${chip("remake", "By newest version (remakes, remasters)")}${chip("date", "By original release")}${chip("size", "Biggest first")}</div>
      <div class="row" style="gap:8px;flex-wrap:wrap;margin:0 0 12px"><button class="btn small" data-action="gaisort">${K.icon("sync")}Sort my games with AI</button><button class="btn quiet small" data-action="ghist">${K.icon("list")}Changes to your games</button><button class="btn quiet small" data-action="gcheck">${K.icon("search")}Check your games</button></div>` + mvs.slice(0, MVL).map(m => {
      const isOpen = !!open[m.name] || (q && !G.norm(m.name).includes(q)), many = m.series.length > 1;
      const games = q && !G.norm(m.name).includes(q) ? m.all.filter(g => G.norm(g.title).includes(q) || G.norm(g.franchise).includes(q)) : m.all;
      return `<section>
      ${K.banner({ name: m.name, small: true, imgs: [...new Set(m.all.map(cover).filter(Boolean))], pct: 100 * m.done / Math.max(1, m.total), line: `${many ? `${m.series.length} series · ` : ""}${m.done} of ${m.total} finished`,
        right: m.standalone ? `<span class="count">${m.done}/${m.total}</span>` : `<span class="count">${m.done}/${m.total}</span><button class="iconbtn" data-action="gmvmenu" data-mv="${esc(m.name)}" aria-label="Change ${esc(m.name)}: rename, merge, open up" title="Rename, merge, open up">${K.icon("edit")}</button><button class="iconbtn" data-action="gmvrefresh" data-mv="${esc(m.name)}" aria-label="Refresh ${esc(m.name)}" title="Refresh: check its games, find missing ones">${K.icon("sync")}</button>` })}
      ${many ? `<div class="row" style="margin:-4px 0 8px"><button class="chip" data-action="gmvopen" data-mv="${esc(m.name)}" aria-pressed="${isOpen}">${isOpen ? "All in one row" : `Show its ${m.series.length} series`}</button></div>` : ""}
      ${isOpen && many ? m.series.map(sr => { const gs = sr.games.filter(g => games.includes(g)); return gs.length ? `<div class="small muted row" style="margin:0 0 8px;gap:8px"><span class="grow"><b>${esc(sr.name)}</b> · ${gs.filter(g => g.status === "done").length}/${gs.length}</span>${sr.other || words(sr.name) === words(m.name) ? "" : `<button class="btn quiet small" data-action="gsplit" data-mv="${esc(m.name)}" data-s="${esc(sr.name)}">Make it its own multiverse</button>`}</div>${rail(gs)}` : ""; }).filter(Boolean).join('<div style="height:12px"></div>')
        : rail(games.slice(0, open["+" + m.name] ? 9999 : LIM)) + (games.length > LIM && !open["+" + m.name] ? `<button class="btn quiet small" data-action="gmvall" data-mv="${esc(m.name)}">Show all ${games.length}</button>` : "")}</section>`;
    }).join("") + (mvs.length > MVL ? `<button class="btn block automore" data-action="gmvmore">Show more</button>` : "") + (mvs.length ? "" : `<p class="muted">Nothing matches.</p>`);
  }
  function renderSearch() {
    const lim = ui.res || [];
    return `<div class="toolbar"><input type="search" data-gsq="1" data-input="gsq" value="${esc(ui.sq || "")}" placeholder="Search games (Steam + IMDb)" autocomplete="off" enterkeyhint="search">
      <button class="btn primary" data-action="gsearch">${K.icon("missing")}</button></div>
      <div class="sechead"><h2>${ui.busy ? "Searching…" : `${lim.length} found`}</h2><button class="btn quiet small" data-action="gsearchclose">Back</button></div>
      ${ui.busy ? "" : K.grid(lim.map((r, i) => { const have = lib().find(r); return `<div class="tile">${K.poster({ title: r.title, img: r.steam ? G.COVER(r.steam) : r.cover, kind: "game", badge: have ? "In your games" : r.src === "imdb" ? "IMDb" : "", attrs: `data-action="gpeek" data-i="${i}"` })}<div class="cap">${esc(r.title)}</div><div class="cap2">${r.price ? esc(eur(r.price.eur)) : ""}</div></div>`; }))}
      <button class="btn block" style="margin-top:16px" data-action="gmanual">${K.icon("plus")}Not found? Add it by hand</button>`;
  }

  const hm = m => (m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ""}` : `${m} min`);
  // 0.6.1: at the bottom of a game: its DLC (from Steam, on request), and games of the same series or studio you have
  function relatedHtml(g) {
    const L = lib(), fr = G.norm(g.franchise || g.multiverse || "");
    const same = fr ? L.visible().filter(x => x !== g && (G.norm(x.franchise) === fr || G.norm(x.multiverse) === fr)).sort((a, b) => String(a.date).localeCompare(String(b.date))) : [];
    const studio = g.dev ? L.visible().filter(x => x !== g && x.dev === g.dev && !same.includes(x)) : [];
    const ex = ui.extras && ui.extras.id === g.id ? ui.extras : null;
    const row = x => `<div class="item" data-action="gopen" data-id="${esc(x.id)}"><b class="grow ell">${esc(x.title)}</b><span class="small muted">${esc([G.yearOf(x), G.LABEL[x.status]].filter(Boolean).join(" · "))}</span></div>`;
    return `${same.length ? `<h4>Same series <span class="muted small">· ${esc(g.franchise || g.multiverse)}</span></h4><div class="listcard">${same.slice(0, 12).map(row).join("")}</div>
        <button class="sheetbtn" data-action="mvopen" data-mv="${esc(g.franchise || g.multiverse)}">${K.icon("list")}The whole series: films, series, games and books</button>` : ""}
      ${studio.length ? `<h4>More from ${esc(g.dev)}</h4><div class="listcard">${studio.slice(0, 8).map(row).join("")}</div>` : ""}
      ${g.steam ? (ex ? (ex.busy ? `<p class="small muted">Asking Steam…</p>` : ex.err ? `<p class="small muted">${esc(ex.err)}</p>` : `<h4>DLC <span class="muted small">· ${ex.dlc.length}</span></h4>${ex.dlc.length ? `<div class="listcard">${ex.dlc.map((d, i) => { const have = L.find({ steam: d.steam, title: d.title });
          return `<div class="item" ${have ? `data-action="gopen" data-id="${esc(have.id)}"` : `data-action="open" data-url="https://store.steampowered.com/app/${esc(d.steam)}/"`} role="button"><div class="grow" style="min-width:0"><b class="ell">${esc(d.title)}</b><div class="small muted">${esc([d.date ? d.date.slice(0, 4) : "", d.price ? eur(d.price.eur) + (d.price.disc ? ` −${d.price.disc}%` : "") : ""].filter(Boolean).join(" · "))}</div></div>${have ? `<span class="small muted">In your games</span>` : `<button class="btn quiet small" data-action="gdlcadd" data-i="${i}">${K.icon("plus")}Add</button>`}</div>`; }).join("")}</div>` : `<p class="small muted">No DLC on Steam.</p>`}`)
        : `<button class="sheetbtn" data-action="gextras">${K.icon("plus")}DLC and studio (from Steam)</button>`) : ""}`;
  }
  // 0.6.2: a studio: its games you have (how many finished, your average, hours), and a Steam search for the rest
  function studioHtml(dev) {
    const gs = lib().visible().filter(x => x.dev === dev).sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")));
    const done = gs.filter(x => x.status === "done").length, rated = gs.filter(x => x.rating > 0);
    const avg = rated.length ? Math.round(rated.reduce((a, x) => a + x.rating, 0) / rated.length * 10) / 10 : null;
    const mins = gs.reduce((a, x) => a + (G.playedMins ? G.playedMins(x) : 0), 0);
    return `<h3 style="margin:0">${esc(dev)}</h3><p class="small muted" style="margin:2px 0 8px">Studio</p>
      <div class="sstrip"><div><b>${gs.length}</b><span>your games</span></div><div><b>${done}</b><span>finished</span></div><div><b>${avg === null ? "–" : avg}</b><span>your average</span></div><div><b>${mins ? Math.round(mins / 60) : "–"}</b><span>hours</span></div></div>
      <div class="listcard">${gs.map(x => `<div class="item" data-action="gopen" data-id="${esc(x.id)}"><b class="grow ell">${esc(x.title)}</b><span class="small muted">${esc([G.yearOf(x), G.LABEL[x.status], x.rating ? "★ " + x.rating : ""].filter(Boolean).join(" · "))}</span></div>`).join("")}</div>
      <p class="small muted">Only games where the studio is known are counted: open a game and tap “DLC and studio” to fill it in.</p>
      <button class="sheetbtn" data-action="gstudiosteam" data-dev="${esc(dev)}">${K.icon("missing")}Search Steam for ${esc(dev)}</button>`;
  }
  // 0.7.8: one version's own page: its progress, and links only where Saga knows it
  function openVersion(g, i) {
    const v = (g.versions || [])[i]; if (!v) return;
    const dl = d => (Saga.lang() === "it" ? K.when(d, "it") : G.longDate(d));
    const links = [v.steam ? ["Steam", `https://store.steampowered.com/app/${v.steam}/`] : null, v.imdb ? ["IMDb", `https://www.imdb.com/title/${v.imdb}/`] : null].filter(Boolean);
    const st = v.status || "";
    Saga.sheet(`${K.sheetHero({ title: v.title, img: v.cover || (v.steam ? G.COVER(v.steam) : cover(g)), kind: "game" }, `<div class="small muted">${esc([v.kind ? v.kind[0].toUpperCase() + v.kind.slice(1) + " of " + g.title : "A version of " + g.title].join(""))}</div>`)}
      <div class="seg2" style="grid-template-columns:repeat(3,1fr);margin:6px 0 12px">${[["", "Not played"], ["playing", "Playing"], ["done", "Finished"]].map(([k, l]) => `<button data-action="gverst" data-i="${i}" data-v="${k}" aria-pressed="${st === k}">${l}</button>`).join("")}</div>
      <div class="listcard">${[["Release", v.date ? dl(v.date) : ""], ["Platform", v.platform], ["Finished", (v.plays || []).length ? v.plays.map(d => K.when(d, Saga.lang())).join(", ") : ""], ["Your rating", v.rating ? `★ ${v.rating}` : ""]].filter(x => x[1]).map(([k, x]) => `<div class="row small" style="min-height:38px;border-bottom:1px solid var(--line)"><span class="muted" style="width:110px">${esc(k)}</span><span class="grow">${esc(x)}</span></div>`).join("")}</div>
      <p class="small muted">Finishing any version counts the whole game as finished.</p>
      <div class="chips" style="margin:4px 0 10px">${["remake", "remaster", "re-release"].map(k => `<button class="chip" data-action="gverkind" data-i="${i}" data-v="${k}" aria-pressed="${(v.kind || "") === k}">${k[0].toUpperCase() + k.slice(1)}</button>`).join("")}</div>
      <button class="sheetbtn" data-action="gverdetach" data-i="${i}">${K.icon("x")}Not a version of ${esc(g.title)}: make it a game of its own</button>
      ${links.map(([n, u]) => `<button class="sheetbtn" data-action="open" data-url="${esc(u)}">${K.icon("open")}${esc(n)}</button>`).join("")}
      <button class="sheetbtn" data-action="gverback" data-id="${esc(g.id)}">${K.icon("chev")}Back to ${esc(g.title)}</button>`, "gsheet", g.id);
  }
  function sheetHtml(g) {
    const t = today(), L = Saga.lang();
    const plays = g.plays.map((d, i) => `<div class="logrow"><span class="grow">${i + 1}. ${esc(K.when(d, L))}</span><button class="btn quiet small" data-action="gunplay" data-i="${i}" aria-label="Remove this playthrough">✕</button></div>`).join("");
    const dl = d => (Saga.lang() === "it" ? K.when(d, "it") : G.longDate(d)); // January 1, 1900
    const facts = [["Release", g.date ? dl(g.date) + (g.date > t ? " (upcoming)" : "") : g.dateText || "Not announced"], ["Platform", g.platform], ["Owned on", g.owned],
      // 0.7.6: every remake, remaster and re-release bundled with it
      ["Remake", !(g.versions || []).length && g.remake ? [g.remake.title, g.remake.platform, g.remake.date ? dl(g.remake.date) : ""].filter(Boolean).join(" · ") : ""],
      ["Time played", (() => { const tp = G.timePlayed(g); return tp.mins ? `${G.hrs(tp.mins)}${tp.parts.length > 1 || tp.parts[0][0] !== "your sessions" ? ` (${tp.parts.map(p => `${p[0]} ${G.hrs(p[1])}`).join(" · ")})` : ""}` : ""; })()],
      ["From", (() => { const so = G.sourceOf(g); return so.from + (so.linked.length ? ` · linked: ${so.linked.join(", ")}` : ""); })()],
      ["IMDb rating", g.imdbR ? `★ ${g.imdbR}` : ""], ["Time to beat", g.hours ? `${g.hours} h${g.hoursRemake ? ` (remake ${g.hoursRemake} h)` : ""}` : ""],
      ["Studio", g.dev || ""], ["Franchise", g.franchise], ["Multiverse", g.multiverse !== g.franchise ? g.multiverse : ""]].filter(x => x[1]);
    const pr = g.price;
    // 0.7.8: the original first; its remakes, remasters and re-releases each with its own progress (tap one to open it)
    const VST = { done: "Finished", playing: "Playing", "": "Not played" };
    const versionsHtml = (g.versions || []).length ? `<h4>Versions <span class="muted small">· the original and ${g.versions.length} more${G.versionDone(g) ? " · the bundle counts as finished" : ""}</span></h4><div class="listcard">
      <div class="item"><span class="xic">${K.icon("games")}</span><div class="grow" style="min-width:0"><b class="ell">${esc(g.title)}</b><div class="small muted">Original · ${esc([G.yearOf(g), g.platform].filter(Boolean).join(" · "))}</div></div><span class="pill ${g.status === "done" ? "ok" : ""}">${esc(G.LABEL[g.status] || "")}</span></div>
      ${g.versions.map((v, i) => `<div class="item" data-action="gver" data-i="${i}" role="button"><span class="xic">${K.icon("sync")}</span><div class="grow" style="min-width:0"><b class="ell">${esc(v.title)}</b><div class="small muted">${esc([v.kind ? v.kind[0].toUpperCase() + v.kind.slice(1) : "Version", v.date ? dl(v.date) : "", v.platform].filter(Boolean).join(" · "))}</div></div><span class="pill ${v.status === "done" ? "ok" : ""}">${VST[v.status || ""]}</span>${K.icon("chev")}</div>`).join("")}</div>` : "";
    return `${K.sheetHero({ title: g.title, img: cover(g), kind: "game" }, `<div class="small muted">${esc([G.yearOf(g), g.platform, g.franchise].filter(Boolean).join(" · "))}</div>`)}
      <div class="seg2" style="grid-template-columns:repeat(3,1fr);margin:6px 0 12px">${G.STATUSES.map(s => `<button data-action="gst" data-v="${s}" aria-pressed="${g.status === s}">${G.LABEL[s]}</button>`).join("")}</div>
      <div class="row" style="margin-bottom:6px"><span class="small muted grow">Your rating</span>${K.stars(g.rating, "grate")}</div>
      <label class="switch"><input type="checkbox" data-gnext="1" ${g.next ? "checked" : ""}><span>Next up<small class="muted" style="display:block">${g.nextBy && g.next ? `Set when you finished ${esc((lib().get(g.nextBy) || {}).title || "the one before")}` : "Shows on Home and at the top of Games"}</small></span></label>
      <label class="switch"><input type="checkbox" data-action="gstory" ${g.story === false ? "checked" : ""}><span>No campaign or story<small class="muted" style="display:block">Left out of its series' order, Up next and canon counts</small></span></label>
      ${versionsHtml}
      <h4>Play sessions <span class="muted small">${(g.sessions || []).length ? `· ${hm(G.playedMins(g))} in ${g.sessions.length}` : ""}</span></h4>
      ${(g.sessions || []).slice(-4).reverse().map((x, j) => `<div class="logrow"><span class="grow">${esc(K.when(x.d, L))} · ${hm(x.mins)}${x.note ? ` · ${esc(x.note)}` : ""}</span><button class="btn quiet small" data-action="gunsess" data-i="${g.sessions.length - 1 - j}" aria-label="Remove this session">✕</button></div>`).join("")}
      <div class="row" style="margin:6px 0 4px;flex-wrap:wrap;gap:6px">${[[30, "+30 min"], [60, "+1 h"], [120, "+2 h"]].map(([m, l]) => `<button class="btn small" data-action="gsess" data-m="${m}">${l}</button>`).join("")}
        <input type="number" inputmode="decimal" step="0.25" min="0" id="gSessH" placeholder="hours" style="width:84px" aria-label="Hours played"><button class="btn small" data-action="gsess">Log</button></div>
      <p class="small muted" style="margin:0 0 12px">Sessions count as played today (or the date above) and show in the Diary.</p>
      <h4>Playthroughs <span class="muted small">${g.plays.length ? `· ${g.plays.length}×` : ""}</span></h4>
      ${plays || `<p class="small muted">Not finished yet.</p>`}
      <div class="row" style="margin:6px 0 12px"><input type="date" id="gDate" value="${t}" max="${t}" aria-label="Date"><button class="btn" data-action="gplay">${K.icon("plus")}${g.plays.length ? "Finished again" : "Finished"}</button></div>
      ${pr || g.steam ? `<h4>Price</h4><div class="nextbox"><div class="grow">${pr ? `<b>${esc(eur(pr.eur))}</b>${pr.disc ? ` <span class="pbadge">−${pr.disc}%</span> <s class="small muted">${esc(eur(pr.retail))}</s>` : ""}<div class="small muted">Steam Italy${pr.low != null && pr.low < pr.eur ? ` · lowest seen ${esc(eur(pr.low))}` : ""}</div>` : `<span class="small muted">No price yet: it's checked on the next sync.</span>`}</div></div>
        <label class="field"><span>Alert me at or below (€)</span><input type="number" inputmode="decimal" step="0.01" data-gtarget="1" value="${g.target != null ? g.target : ""}" placeholder="any big discount"></label>` : ""}
      ${dealHtml(g)}
      <h4>Prices in other stores</h4>${storesHtml(g)}
      ${g.steamMins || g.ach ? `<p class="small" style="margin:6px 0">Steam: ${g.steamMins ? `<b>${g.steamMins >= 120 ? Math.round(g.steamMins / 60) + " h" : g.steamMins + " min"}</b> played` : ""}${g.steam2w ? ` (${Math.round(g.steam2w / 6) / 10} h in the last two weeks)` : ""}${g.steamLast ? ` · last played ${esc(g.steamLast)}` : ""}${g.ach && g.ach.total ? ` · achievements <b>${g.ach.got}/${g.ach.total}</b> (${Math.round(100 * g.ach.got / g.ach.total)}%)` : ""}</p>${g.ach && g.ach.total ? `<div class="minibar" style="margin:0 0 8px"><i style="width:${Math.round(100 * g.ach.got / g.ach.total)}%"></i></div>` : ""}` : ""}
      <h4>Details</h4><div class="listcard">${facts.map(([k, v]) => `<div class="row small" style="min-height:38px;border-bottom:1px solid var(--line)" ${k === "Franchise" || k === "Multiverse" ? `data-action="mvopen" data-mv="${esc(v)}" role="button"` : k === "Studio" ? `data-action="gstudio" data-dev="${esc(v)}" role="button"` : ""}><span class="muted" style="width:42%">${esc(k)}</span><span class="grow">${esc(v)}${k === "Franchise" || k === "Multiverse" || k === "Studio" ? ` <span class="muted">›</span>` : ""}</span></div>`).join("")}</div>
      ${g.aiText ? `<details class="small" style="margin:8px 0"><summary class="muted">AI answer to your prompt</summary><pre style="white-space:pre-wrap;font:inherit;margin:6px 0">${esc(g.aiText)}</pre><button class="btn quiet small" data-action="ginfoone" data-id="${esc(g.id)}">Ask again</button></details>` : `<button class="btn quiet small" data-action="ginfoone" data-id="${esc(g.id)}">${K.icon("spark")}Details from AI (your prompt)</button>`}
      <button class="sheetbtn" data-action="grefresh1" data-id="${esc(g.id)}">${K.icon("sync")}Refresh everything (IMDb, series, versions, details, canon)</button>
      <label class="field" style="margin-top:12px"><span>Notes</span><textarea rows="2" data-gnotes="1" placeholder="Difficulty, mods, who you played with…">${esc(g.notes)}</textarea></label>
      ${relatedHtml(g)}
      ${G.storeLinks(g).length ? "<h4>Where to get it</h4>" : ""}${G.storeLinks(g).map(([n, u]) => `<button class="sheetbtn" data-action="open" data-url="${esc(u)}">${K.icon("open")}${esc(n)}</button>`).join("")}
      <div style="margin-top:8px"><button class="sheetbtn" data-action="mlistadd" data-k="game:${esc(g.id)}">${K.icon("plus")}Add to a list</button><button class="sheetbtn" data-action="gsync1">${K.icon("sync")}Sync this game (Steam details, date, store prices)</button>
      <button class="sheetbtn" data-action="gedit">${K.icon("edit")}Edit details</button>
      <button class="sheetbtn" data-action="gmove">${K.icon("list")}Move to another multiverse or series${g.fManual ? " (you placed it)" : ""}</button>
      ${g.steam ? "" : `<button class="sheetbtn" data-action="glink">${K.icon("sync")}Find on Steam (cover, price, date)</button>`}
      <button class="sheetbtn" data-action="ginfo" data-id="${esc(g.id)}">${K.icon("sync")}Fill missing details with AI (release, platform, remake, HLTB)</button>
      <button class="sheetbtn" data-action="glink">${K.icon("list")}Link: its remake, or the same game twice</button>
      ${g.remake && g.remake.title ? `<button class="sheetbtn" data-action="gunremake">${K.icon("x")}Not a remake: take ${esc(g.remake.title)} off this game</button>` : ""}
      <button class="sheetbtn" data-action="gremove">${K.icon("notcanon")}Remove from your games</button></div>`;
  }
  function open(id) { const g = lib().get(id); if (!g) return; ui.open = id; Saga.sheet(sheetHtml(g), "gsheet", id); }
  function editHtml(g, isNew) {
    const f = (k, l, v, type) => `<label class="field"><span>${l}</span><input ${type ? `type="${type}"` : ""} id="ge_${k}" value="${esc(v == null ? "" : v)}"></label>`;
    return `<h3>${isNew ? "Add a game" : "Edit details"}</h3>${f("title", "Title", g.title)}${f("date", "Release date", g.date, "date")}${f("platform", "Platform", g.platform)}
      ${f("owned", "Owned on (leave empty if not)", g.owned)}${f("franchise", "Franchise", g.franchise)}${f("multiverse", "Multiverse", g.multiverse)}${f("hours", "Hours to beat", g.hours, "number")}
      ${f("cover", "Cover image link (optional)", g.cover)}<div class="row" style="margin-top:12px"><button class="btn quiet grow" data-action="close">Cancel</button><button class="btn primary grow" data-action="gsave" data-id="${esc(isNew ? "" : g.id)}">Save</button></div>`;
  }
  async function search() {
    const q = String(ui.sq || "").trim();
    if (q.length < 2) return K.toast("Type at least two letters");
    ui.busy = true; ui.res = []; Saga.render();
    // 0.6.1: Steam and IMDb together, so console-only games (Switch, PlayStation…) can be found too
    const [st, im] = await Promise.all([
      G.steamSearch(Saga.http, q, lib().settings.region || "IT", Saga.lang() === "it" ? "italian" : "english").catch(e => { K.toast(`Steam search failed: ${e.message}`); return []; }),
      G.imdbGameSearch(Saga.http, q).catch(() => [])]);
    const seen = new Set(st.map(r => G.norm(r.title)));
    ui.res = st.concat(im.filter(r => !seen.has(G.norm(r.title))));
    ui.busy = false; Saga.render();
  }

  function act(a, el) {
    const L = lib(), g = ui.open ? L.get(ui.open) : null;
    const reopen = () => { save(); if (g) open(g.id); Saga.render(); };
    switch (a) {
      case "gopen": open(el.dataset.id); return true;
      // 0.6.9.6: link two games by hand: a remake, or the same game entered twice
      case "glink": if (!g) return true; ui.linkFor = g.id; ui.lq = ""; Saga.sheet(linkHtml(g), "glinksheet"); return true;
      case "glinkdo": {
        const base = L.get(ui.linkFor), other = L.get(el.dataset.id);
        if (!base || !other) return true;
        const how = el.dataset.how;
        const keep = how === "remake" ? L.attachVersion(base, other) : how === "original" ? L.attachVersion(other, base) : L.batch(`${other.title} merged into ${base.title}`, () => G.mergeInto(L, base, other));
        save(); K.toast(how === "same" ? `${other.title} merged into ${base.title}` : `${keep.title}: remake ${keep.remake.title}`); open(keep.id); Saga.render(); return true; }
      case "gunremake": if (g) { const r = g.remake; g.remake = null; g.hoursRemake = null; save(); K.toast(`${r && r.title} is no longer this game's remake`); open(g.id); } return true;
      case "gstudio": Saga.sheet(studioHtml(el.dataset.dev)); return true;
      case "gstudiosteam": Saga.close(); ui.open = null; ui.res = []; ui.sq = el.dataset.dev; Saga.render(); search(); return true;
      case "gfilter": ui.f = el.dataset.v; ui.lim = 120; Saga.render(); return true;
      case "gview": ui.view = el.dataset.v; Saga.render(); return true;
      case "ginfo": Saga.gameInfo([el.dataset.id]); return true;
      case "gcanonimdb": Saga.gameImdbCheck(); return true;
      case "grefresh1": Saga.gameRefresh(el.dataset.id); return true;
      case "gmvrefresh": Saga.universeRefresh(el.dataset.mv); return true;
      case "gver": openVersion(g, +el.dataset.i); return true;
      case "gverst": { const nx = G.setVersionStatus(lib(), g, +el.dataset.i, el.dataset.v); K.toast(el.dataset.v === "done" ? `Finished${g.status === "done" ? ": the whole game counts as finished" : ""}${nx ? ` · Up next: ${nx.title}` : ""}` : "Saved"); openVersion(g, +el.dataset.i); Saga.render(); return true; }
      case "gverback": reopen(); return true;
      // ---- 0.8.4: grouping tools (what you set stays)
      case "gverkind": if (g) { L.setVersionKind(g, +el.dataset.i, el.dataset.v); save(); openVersion(g, +el.dataset.i); } return true;
      case "gverdetach": if (g) { if (!K.confirmTap(el, "Tap again to make it a game of its own")) return true; const n = L.detachVersion(g, +el.dataset.i); save(); K.toast(`${n.title} is a game of its own again (Changes › Undo)`); open(g.id); Saga.render(); } return true;
      case "gmove": if (g) Saga.sheet(moveHtml(g), "gsheet", g.id); return true;
      case "gmovedo": if (g) { const mv = (document.querySelector("#gmMv") || {}).value, sr = (document.querySelector("#gmSr") || {}).value; if (!String(mv || "").trim()) { K.toast("Pick or type a multiverse"); return true; } L.moveGame(g, mv, sr); save(); K.toast(`${g.title}: ${mv}${sr && sr !== mv ? " › " + sr : ""}. It stays there.`); open(g.id); Saga.render(); } return true;
      case "gmvmenu": Saga.sheet(mvMenuHtml(el.dataset.mv)); return true;
      case "gmvrename": { const to = (document.querySelector("#gmvName") || {}).value; const n = L.renameMv(el.dataset.mv, to); save(); Saga.close(); K.toast(n ? `${el.dataset.mv} is now ${to}` : "Type the new name first"); Saga.render(); return true; }
      case "gmvmerge": { const to = (document.querySelector("#gmvInto") || {}).value; if (!to) { K.toast("Pick the multiverse to merge into"); return true; } const n = L.mergeMv(el.dataset.mv, to); save(); Saga.close(); K.toast(`${G.fmtN ? G.fmtN(n) : n} games of ${el.dataset.mv} are now in ${to}`); Saga.render(); return true; }
      case "gmvopenup": { if (!K.confirmTap(el, "Tap again to open it up")) return true; const n = L.openUpMv(el.dataset.mv); save(); Saga.close(); K.toast(`${el.dataset.mv} opened up: ${n} games now in their own series' multiverses (Changes › Undo)`); Saga.render(); return true; }
      case "gsplit": { const n = L.splitSeries(el.dataset.mv, el.dataset.s); save(); K.toast(`${el.dataset.s} is its own multiverse now (${n} games)`); Saga.render(); return true; }
      case "ghist": Saga.sheet(histHtml()); return true;
      case "gaisort": Saga.gameAiSort(); return true;
      case "gcunsteam": { const x = L.get(el.dataset.id); if (x) { L.unlinkSteam(x); save(); Saga.render(); } return true; }
      case "gcfixsteam": Saga.fixSteam(); return true;
      case "gcmerge": { const a2 = L.get(el.dataset.a), b2 = L.get(el.dataset.b); if (a2 && b2) { L.batch(`${b2.title} merged into ${a2.title}`, () => G.mergeInto(L, a2, b2)); save(); K.toast("Merged (Changes › Undo)"); Saga.render(); } return true; }
      case "gcnotsame": { const a2 = L.get(el.dataset.a), b2 = L.get(el.dataset.b); if (a2 && b2) { L.notSame(a2, b2); Saga.render(); } return true; }
      case "gcdropver": { const x = L.get(el.dataset.id); if (x) { L.dropVersion(x, +el.dataset.i); save(); Saga.render(); } return true; }
      case "gcswap": { const x = L.get(el.dataset.id); if (x) { L.swapOriginal(x, +el.dataset.i); save(); Saga.render(); } return true; }
      case "gcdetach": { const x = L.get(el.dataset.id); if (x) { L.detachVersion(x, +el.dataset.i); save(); Saga.render(); } return true; }
      case "gctidy": { const r = L.tidy(); save(); K.toast(`${r.length} tidied`); Saga.render(); return true; }
      case "gcinfo": Saga.gameInfo(L.check().noInfo.map(x => x.id)); return true;
      case "gcheck": ui.view = "check"; Saga.render(); return true;
      case "ghistundo": { const r = L.undoBatch(el.dataset.b, el.dataset.g || null); save(); K.toast(`Undone: ${r.back} back${r.kept ? `, ${r.kept} kept (you changed them since)` : ""}`); Saga.sheet(histHtml(el.dataset.b)); Saga.render(); return true; }
      case "ghistopen": Saga.sheet(histHtml(el.dataset.b)); return true;
      case "gcanoncheck": Saga.gameCanonCheck(); return true;
      case "gstory": { g.story = g.story === false ? null : false; lib().save(); ui.cMemo = null; reopen(); return true; }
      case "ginfoone": { const g = lib().get(el.dataset.id); if (g) { g.aiAt = 0; Saga.gameInfo([g.id]); } return true; }
      case "ginfoall": Saga.gameInfo(lib().visible().filter(g => !g.aiAt && (!g.date || !g.platform || g.hours == null)).map(g => g.id)); return true;
      case "gcanonmore": ui.cLim = (ui.cLim || 40) + 40; Saga.render(); return true;
      case "gcanonadd": {
        const d = el.dataset, y = String(d.y || ""), r = lib().add({ title: d.t, date: y.length >= 7 ? y : "", dateText: y.length === 4 ? y : "", imdb: d.i || null, franchise: d.f, multiverse: d.f, src: "canon" }, "wishlist");
        if (r && r.game && y.length === 4 && !r.game.date) r.game.date = y + "-12-31";
        save(); ui.cMemo = null; K.toast(`${d.t}: on your wishlist`); Saga.render(); return true; }
      case "gcanonno": {
        const d = el.dataset; Saga.db.setNotCanon({ title: d.t, year: d.y ? parseInt(d.y, 10) : null, medium: "Video Game", imdb: d.i || null, franchise: d.f }, true); Saga.db.flush(); ui.cMemo = null;
        K.toast(`${d.t} won't count as canon. Undo in Settings.`); Saga.render(); return true; }
      case "gmvsort": ui.mvSort = el.dataset.v; ui.mvLim = 12; Saga.render(); return true;
      case "gmvopen": { const o = ui.mvOpen || (ui.mvOpen = {}); o[el.dataset.mv] = !o[el.dataset.mv]; Saga.render(); return true; }
      case "gmvall": { const o = ui.mvOpen || (ui.mvOpen = {}); o["+" + el.dataset.mv] = true; Saga.render(); return true; }
      case "gmvmore": ui.mvLim = (ui.mvLim || 12) + 12; Saga.render(); return true;
      case "gmore": ui.lim += 120; Saga.render(); return true;
      case "gadd": ui.res = []; ui.sq = ""; Saga.render(); setTimeout(() => { const i = document.querySelector("[data-gsq]"); if (i) i.focus(); }, 30); return true;
      case "gsearch": { const i = document.querySelector("[data-gsq]"); ui.sq = i ? i.value : ui.sq; search(); return true; }
      case "gsearchclose": ui.res = null; ui.busy = false; Saga.render(); return true;
      case "gmanual": Saga.sheet(editHtml(G.blank({ title: ui.sq || "" }), true)); return true;
      case "gpeek": { const r = ui.res[+el.dataset.i]; if (!r) return true; const have = L.find(r); if (have) { open(have.id); return true; }
        Saga.sheet(`${K.sheetHero({ title: r.title, img: r.steam ? G.COVER(r.steam) : r.cover, kind: "game" }, `<div class="small muted">${r.src === "imdb" ? "IMDb" + (r.dateText ? " · " + esc(r.dateText) : "") : "Steam"}${r.price ? " · " + esc(eur(r.price.eur)) : ""}</div>`)}
          <p class="small muted">Add to your games as</p>${["backlog", "playing", "done", "wishlist"].map(s => `<button class="sheetbtn" data-action="gaddas" data-i="${el.dataset.i}" data-v="${s}">${K.icon("plus")}${G.LABEL[s]}</button>`).join("")}`);
        return true; }
      case "gaddas": { const r = ui.res[+el.dataset.i]; if (!r) return true; const { game } = L.add(Object.assign({}, r, { owned: el.dataset.v === "wishlist" ? "" : r.src === "imdb" ? "Yes" : "PC (Steam)", src: r.src || "steam" }), el.dataset.v); save(); K.toast(`Added ${game.title}`); Saga.close(); open(game.id); Saga.render(); refreshDate(game); return true; }
      case "gsave": {
        const v = k => (document.getElementById("ge_" + k) || {}).value || "";
        if (!v("title").trim()) { K.toast("The title is needed"); return true; }
        const data = { title: v("title").trim(), date: v("date"), platform: v("platform").trim(), owned: v("owned").trim(), franchise: v("franchise").trim(), multiverse: v("multiverse").trim() || v("franchise").trim(), hours: parseFloat(v("hours")) || null, cover: v("cover").trim() };
        let x;
        if (el.dataset.id) { x = L.get(el.dataset.id); Object.assign(x, data); } else x = L.add(Object.assign(data, { src: "added" }), "backlog").game;
        save(); Saga.close(); ui.res = null; open(x.id); Saga.render(); return true; }
    }
    if (!g) return false;
    switch (a) {
      case "gst": { const was = g.status; G.setStatus(g, el.dataset.v, (document.getElementById("gDate") || {}).value); const nx = lib().statusChanged(g, was); reopen(); if (nx) K.toast(`Up next: ${nx.title}`); return true; }
      case "gsess": { const h = document.getElementById("gSessH"), mins = el.dataset.m ? +el.dataset.m : Math.round((parseFloat(String(h && h.value || "").replace(",", ".")) || 0) * 60);
        if (!mins) { K.toast("Type the hours played"); return true; }
        G.logSession(g, mins, (document.getElementById("gDate") || {}).value || today()); reopen(); K.toast(`Logged ${hm(mins)}`); return true; }
      case "gunsess": { g.sessions.splice(+el.dataset.i, 1); reopen(); return true; }
      case "grate": { const v = +el.dataset.v * 2; g.rating = g.rating === v ? v - 1 : g.rating === v - 1 ? 0 : v; reopen(); return true; }
      case "gbundles": { const id = g.id; ui.bundles = { id, busy: true }; reopen();
        G.itadBundles(Saga.http, Saga.db.get("itad_key"), g.itad, lib().settings.region || "IT", true).then(list => { ui.bundles = { id, list }; }, e => { ui.bundles = { id, err: e.message }; }).then(() => { if (ui.open === id) reopen(); });
        return true; }
      case "gextras": { const id = g.id; ui.extras = { id, busy: true }; reopen();
        G.steamExtras(Saga.http, g.steam, lib().settings.region || "IT").then(x => { if (x.dev && !g.dev) { g.dev = x.dev; lib().save(); } ui.extras = Object.assign({ id }, x); }, e => { ui.extras = { id, err: e.message }; }).then(() => { if (ui.open === id) reopen(); });
        return true; }
      case "gdlcadd": { const d = ui.extras && ui.extras.dlc[+el.dataset.i]; if (!d) return true;
        const r = lib().add({ title: d.title, steam: d.steam, date: d.date, platform: "PC", franchise: g.franchise, multiverse: g.multiverse, dev: g.dev, price: d.price, src: "steam" }, "wishlist");
        lib().save(); K.toast(r.existed ? "Already in your games" : `Added ${d.title} to your wishlist`); reopen(); return true; }
      case "gsync1": (async () => {
        K.toast(`Syncing ${g.title}…`); const said = [];
        try { if (!g.steam) { delete (L.meta.noSteam || {})[g.id]; const n = await G.linkSteam({ visible: () => [g], meta: L.meta, settings: L.settings }, Saga.http, 1, 0); said.push(n ? "linked to Steam" : "not found on Steam"); } } catch (e) { said.push("Steam: " + e.message); }
        await refreshDate(g);
        try { await G.storePrices(g, Saga.http, { itadKey: Saga.db.get("itad_key"), country: lib().settings.region || "IT" }); said.push(g.stores && g.stores.length ? `${g.stores.length} store prices` : "no store prices"); } catch (e) { said.push("Prices: " + e.message); }
        save(); if (ui.open === g.id) open(g.id); K.toast(`${g.title}: ${said.join("; ")}`);
      })(); return true;
      case "gstores": (async () => { K.toast("Checking stores…"); try { await G.storePrices(g, Saga.http, { itadKey: Saga.db.get("itad_key"), country: lib().settings.region || "IT" }); save(); if (ui.open === g.id) open(g.id); K.toast(g.stores.length ? `${g.stores.length} store prices` : "No store prices found"); } catch (e) { K.toast(e.message); } })(); return true;
      case "gplay": { const was = g.status, n = G.logPlay(g, (document.getElementById("gDate") || {}).value); const nx = lib().statusChanged(g, was); K.toast((n > 1 ? `Finished ${n} times` : "Marked as finished") + (nx ? ` · Up next: ${nx.title}` : "")); reopen(); return true; }
      case "gunplay": { const was = g.status; G.removePlay(g, +el.dataset.i); lib().statusChanged(g, was); reopen(); return true; }
      case "gedit": Saga.sheet(editHtml(g)); return true;
      case "glink": (async () => { K.toast("Looking on Steam…"); delete (L.meta.noSteam || {})[g.id]; const n = await G.linkSteam({ visible: () => [g], meta: L.meta, settings: L.settings }, Saga.http, 1, 0); if (n) { await refreshDate(g); K.toast("Linked to Steam"); } else K.toast("Not found on Steam"); reopen(); })(); return true;
      case "gremove": if (el.dataset.sure) { const key = Object.keys(L.removed).length; L.remove(g.id); save(); Saga.close(); ui.open = null;
        K.toast(`Removed ${g.title}`, () => { if (!L.get(g.id)) L.games.push(g); for (const k of Object.keys(L.removed).slice(key)) delete L.removed[k]; save(); Saga.render(); K.toast("Undone"); }); Saga.render(); } else { el.dataset.sure = "1"; el.lastChild.textContent = "Tap again to remove"; } return true;
    }
    return false;
  }
  const money = (n, cur) => (n == null ? "" : n === 0 ? "Free" : cur === "USD" ? `$${(+n).toFixed(2)}` : eur(n));
  // 0.6.6: the best price now in any store, the all-time low, subscriptions and bundles (IsThereAnyDeal)
  function dealHtml(g) {
    const d = g.deal, subs = g.subs || [], bs = (lib().meta.bundles || []).filter(b => g.itad && b.games.includes(g.itad)), bx = ui.bundles && ui.bundles.id === g.id ? ui.bundles : null;
    if (!d && !subs.length && !bs.length && !g.itad) return "";
    return `<h4>Best price</h4>
      ${d ? `<button class="sheetbtn" data-action="open" data-url="${esc(d.url)}"><span class="grow">${esc(d.shop)}${d.atLow && d.cut ? ` <span class="pbadge">Lowest ever</span>` : ""}</span><b>${esc(money(d.price, d.cur))}</b>${d.cut ? ` <span class="pbadge">−${d.cut}%</span>` : ""}</button>
        ${d.low ? `<p class="small muted" style="margin:4px 0 8px">Lowest ever: ${esc(money(d.low.price, d.cur))}${d.low.shop ? ` at ${esc(d.low.shop)}` : ""}${d.low.at ? `, ${esc(d.low.at)}` : ""}${d.regular ? ` · full price ${esc(money(d.regular, d.cur))}` : ""}</p>` : ""}` : ""}
      ${subs.length ? `<p class="small" style="margin:4px 0">Included in ${subs.map(x => `<b>${esc(x.name)}</b>${x.leaving ? ` <span class="muted">(leaving ${esc(x.leaving)})</span>` : ""}`).join(", ")}</p>` : ""}
      ${bs.length ? `<p class="small" style="margin:4px 0">In a bundle now: ${bs.map(b => `<a href="#" data-action="open" data-url="${esc(b.url)}">${esc(b.title)}</a>${b.expiry ? ` <span class="muted">(until ${esc(String(b.expiry).slice(0, 10))})</span>` : ""}`).join(", ")}</p>` : ""}
      ${g.itad ? (bx ? (bx.busy ? `<p class="small muted">Asking IsThereAnyDeal…</p>` : bx.err ? `<p class="small muted">${esc(bx.err)}</p>` : bx.list.length ? `<div class="listcard">${bx.list.map(b => `<div class="item" data-action="open" data-url="${esc(b.url)}"><div class="grow" style="min-width:0"><b class="ell">${esc(b.title)}</b><div class="small muted">${esc([b.shop, b.price != null ? money(b.price, b.cur) : "", b.expiry ? (b.expiry < today() ? "ended " : "until ") + b.expiry : ""].filter(Boolean).join(" · "))}</div></div></div>`).join("")}</div>` : `<p class="small muted">Never in a bundle.</p>`)
        : `<button class="btn small" data-action="gbundles">Every bundle it was in</button>`) : ""}`;
  }
  function storesHtml(g) {
    const when = g.storesAt ? new Date(g.storesAt).toLocaleDateString(Saga.lang() === "it" ? "it-IT" : "en-GB", { day: "numeric", month: "short" }) : "";
    const rows = (g.stores || []).slice(0, 8).map(x => `<button class="sheetbtn" data-action="open" data-url="${esc(x.url)}"><span class="grow">${esc(x.shop)}</span><b>${esc(money(x.price, x.cur))}</b>${x.cut ? ` <span class="pbadge">−${x.cut}%</span>` : ""}</button>`).join("");
    return `${rows || (g.storesAt ? `<p class="small muted">${esc(g.storesSrc || "No store prices found")}.</p>` : "")}
      ${g.storesLow ? `<p class="small muted">Lowest ever: ${esc(money(g.storesLow.price, g.storesLow.cur))}</p>` : ""}
      <div class="row wrap"><button class="btn small" data-action="gstores">${K.icon("sync")}${g.storesAt ? "Check again" : "Compare stores"}</button>
      ${when ? `<span class="small muted">${esc(g.storesSrc || "")} · ${esc(when)}</span>` : `<span class="small muted">${Saga.db.get("itad_key") ? "IsThereAnyDeal, euro prices" : "CheapShark, US prices. Add an IsThereAnyDeal key in Settings for euro prices from more stores."}</span>`}</div>`;
  }
  async function refreshDate(g) { try { if (g.steam && await G.steamDates({ visible: () => [g], settings: lib().settings }, Saga.http, 1)) save(); } catch (e) { /* later */ } }
  function change(el) {
    const g = ui.open ? lib().get(ui.open) : null;
    if (el.dataset.gsort) { ui.sort = el.value; Saga.render(); return true; }
    if (el.dataset.gnotes && g) { g.notes = el.value.trim(); save(); return true; }
    if (el.dataset.gnext && g) { g.next = el.checked; save(); Saga.render(); return true; }
    if (el.dataset.gtarget && g) { const v = parseFloat(String(el.value).replace(",", ".")); g.target = isFinite(v) ? v : null; save(); return true; }
    return false;
  }
  // ---- 0.8.4: Check your games
  function renderCheck() {
    const r = lib().check(), y = g => [G.yearOf(g), g.platform].filter(Boolean).join(" · ");
    const row = (g, extra, btns) => `<div class="item"><div class="grow" style="min-width:0" data-action="gopen" data-id="${esc(g.id)}" role="button"><b class="ell">${esc(g.title)}</b><div class="small muted">${esc([y(g), extra].filter(Boolean).join(" · "))}</div></div>${btns || ""}</div>`;
    const sec = (title, n, why, body, all) => n ? `<h4 style="margin-top:18px">${title} <span class="muted small">· ${n}</span></h4><p class="small muted" style="margin:0 0 8px">${why}</p>${all || ""}<div class="listcard">${body}</div>` : "";
    return `<div class="row" style="margin:0 0 6px"><button class="btn quiet small" data-action="gview" data-v="mv">${K.icon("back")}Franchises</button></div>
      <h2 style="margin:6px 0">Check your games</h2>
      <p class="small muted">${r.total ? `${r.total} things look wrong. Each fix is one step in Changes to your games, with Undo.` : "Nothing looks wrong."}${r.noInfo.length ? ` ${r.noInfo.length} games have no release date yet (at the end).` : ""}</p>
      ${sec("One Steam game on two of yours", r.steam.length, "They show the same cover and price. Steam's own name and release date say which one it is.", r.steam.map(x => x.games.map(g => row(g, `Steam ${x.id}`, `<button class="btn quiet small" data-action="gcunsteam" data-id="${esc(g.id)}">Not this one</button>`)).join("")).join('<div style="height:6px"></div>'), `<button class="btn small" data-action="gcfixsteam" style="margin-bottom:8px">${K.icon("sync")}Ask Steam for all of them</button>`)}
      ${sec("Possible copies", r.copies.length, "The same name and year, and nothing says they're two games.", r.copies.slice(0, 80).map(x => `<div style="padding:6px 0;border-bottom:1px solid var(--line)">${row(x.a, x.a.src)}${row(x.b, x.b.src)}<div class="row" style="gap:6px;padding:0 12px 6px"><button class="btn small" data-action="gcmerge" data-a="${esc(x.a.id)}" data-b="${esc(x.b.id)}">Merge them</button><button class="btn quiet small" data-action="gcnotsame" data-a="${esc(x.a.id)}" data-b="${esc(x.b.id)}">Two different games</button></div></div>`).join(""))}
      ${sec("Versions that look wrong", r.versions.length, "A remake older than its original, or the same version listed twice.", r.versions.map(x => row(x.g, `${x.g.versions[x.i].title} (${String(x.g.versions[x.i].date || "").slice(0, 4)}): ${x.why}`, x.why === "listed twice" ? `<button class="btn quiet small" data-action="gcdropver" data-id="${esc(x.g.id)}" data-i="${x.i}">Remove the extra</button>` : `<button class="btn quiet small" data-action="gcswap" data-id="${esc(x.g.id)}" data-i="${x.i}">Make it the original</button><button class="btn quiet small" data-action="gcdetach" data-id="${esc(x.g.id)}" data-i="${x.i}">Not a version</button>`)).join(""))}
      ${sec("Names that look broken", r.names.length, "Accents read in the wrong encoding, a stray backslash or a placeholder series from an import.", r.names.slice(0, 60).map(g => row(g, [g.franchise, g.multiverse].filter(Boolean).join(" › "))).join(""), `<button class="btn small" data-action="gctidy" style="margin-bottom:8px">Tidy them all</button>`)}
      ${sec("No release date", r.noInfo.length, "Filled from your prompt with the AI (or copy and paste).", r.noInfo.slice(0, 40).map(g => row(g, "no date")).join("") + (r.noInfo.length > 40 ? `<p class="small muted" style="padding:6px 12px">…and ${r.noInfo.length - 40} more</p>` : ""), `<button class="btn small" data-action="gcinfo" style="margin-bottom:8px">${K.icon("sync")}Fill them in (${r.noInfo.length})</button>`)}`;
  }
  // ---- 0.8.4: grouping tools
  const words = t => G.words(t);
  function moveHtml(g) {
    const mvs = lib().multiverses("size").filter(m => !m.standalone);
    return `<div class="kicker">Move</div><h2 style="margin:4px 0 6px">${esc(g.title)}</h2>
      <p class="small muted">Now: ${esc(g.multiverse || g.franchise || "no multiverse")}${g.franchise && g.franchise !== g.multiverse ? " › " + esc(g.franchise) : ""}. Where you put it, it stays: no rule, scan or list merge moves it again.</p>
      <label class="field"><span>Multiverse</span><input id="gmMv" list="gmMvL" value="${esc(g.multiverse || "")}" autocomplete="off"></label>
      <datalist id="gmMvL">${mvs.map(m => `<option value="${esc(m.name)}">`).join("")}</datalist>
      <label class="field"><span>Series inside it (empty: the multiverse itself)</span><input id="gmSr" list="gmSrL" value="${esc(g.franchise && g.franchise !== g.multiverse ? g.franchise : "")}" autocomplete="off"></label>
      <datalist id="gmSrL">${[...new Set(mvs.flatMap(m => m.series.map(s => s.name)))].slice(0, 400).map(n => `<option value="${esc(n)}">`).join("")}</datalist>
      <button class="btn block" data-action="gmovedo">${K.icon("check")}Move it</button>
      <button class="sheetbtn" data-action="gopen" data-id="${esc(g.id)}">${K.icon("chev")}Back to ${esc(g.title)}</button>`;
  }
  function mvMenuHtml(name) {
    const all = lib().multiverses("size"), m = all.find(x => x.name === name); if (!m) return "";
    return `<div class="kicker">Multiverse</div><h2 style="margin:4px 0 10px">${esc(name)} <span class="muted small">· ${m.total} games, ${m.series.length} series</span></h2>
      <label class="field"><span>Rename</span><input id="gmvName" value="${esc(name)}"></label><button class="btn small" data-action="gmvrename" data-mv="${esc(name)}">Rename</button>
      <label class="field" style="margin-top:14px"><span>Merge into another multiverse (its series stay as series)</span><input id="gmvInto" list="gmvIntoL" placeholder="Pick or type"></label>
      <datalist id="gmvIntoL">${all.filter(x => !x.standalone && x.name !== name).map(x => `<option value="${esc(x.name)}">`).join("")}</datalist><button class="btn small" data-action="gmvmerge" data-mv="${esc(name)}">Merge</button>
      ${m.series.length > 1 ? `<h4 style="margin-top:16px">Open it up</h4><p class="small muted">Each of its ${m.series.length} series (${esc(m.series.slice(0, 6).map(s => s.name).join(", "))}${m.series.length > 6 ? "…" : ""}) becomes a multiverse of its own.</p><button class="btn small" data-action="gmvopenup" data-mv="${esc(name)}">Open up ${esc(name)}</button>` : ""}
      <p class="small muted" style="margin-top:14px">Everything here is one step in Changes to your games, with Undo.</p>`;
  }
  function histHtml(open) {
    const bs = lib().meta.batches || [];
    if (!bs.length) return `<div class="kicker">Changes to your games</div><p class="muted">Nothing yet. Every regroup, merge, Steam fix or move you make shows here, with Undo.</p>`;
    const L = Saga.lang();
    return `<div class="kicker">Changes to your games</div><p class="small muted">The last ${bs.length} changes Saga or you made to many games at once. Undo puts back what it changed; a game you changed again since keeps your later change.</p>
      ${bs.map(b => `<div class="listcard" style="margin-bottom:8px"><div class="item" data-action="ghistopen" data-b="${b.id}" role="button"><div class="grow" style="min-width:0"><b>${esc(b.what)}</b><div class="small muted">${esc(K.when(new Date(b.at).toISOString().slice(0, 10), L))} · ${b.items.length} game${b.items.length === 1 ? "" : "s"}${b.undone ? " · undone" : ""}</div></div>${b.undone ? "" : `<button class="btn quiet small" data-action="ghistundo" data-b="${b.id}">Undo</button>`}</div>
        ${open === b.id ? b.items.slice(0, 200).map(it => `<div class="row small" style="padding:6px 12px;border-top:1px solid var(--line)"><span class="grow">${esc(it.t || it.id)} <span class="muted">${it.k === "removed" ? "merged away" : it.k === "added" ? "added" : esc(Object.keys(it.now || {}).filter(f => !/^(_|fGuess|fCanon|fManual|fImported)/.test(f)).slice(0, 3).map(f => f === "multiverse" || f === "franchise" ? `${f}: ${it.was[f] || "—"} → ${it.now[f] || "—"}` : f).join(" · "))}</span></span>${it.undone || b.undone ? "" : `<button class="btn quiet small" data-action="ghistundo" data-b="${b.id}" data-g="${esc(it.id)}">Undo</button>`}</div>`).join("") + (b.items.length > 200 ? `<p class="small muted" style="padding:6px 12px">…and ${b.items.length - 200} more (Undo above covers them all)</p>` : "") : ""}</div>`).join("")}`;
  }
  function linkHtml(g) {
    return `<div class="kicker">Link to ${esc(g.title)}</div><h3 style="margin:4px 0 8px">Its remake, or the same game</h3>
      <p class="small muted">Remake: the two become one game, with the other as its remake (your plays, rating and notes from both). Same game: the other is merged into this one.</p>
      <input type="search" data-glq="1" placeholder="Find the other game" autocomplete="off" style="width:100%;margin:6px 0"><div id="glinkList">${linkList(g, "")}</div>`;
  }
  function linkList(g, q) {
    const L = lib(), n = G.norm(q), fr = G.norm(g.franchise || g.multiverse || ""), base = G.norm(g.title).split(" ")[0] || "";
    const pool = L.visible().filter(x => x !== g);
    const hits = (n ? pool.filter(x => G.norm(x.title).includes(n)) : pool.filter(x => (fr && (G.norm(x.franchise) === fr || G.norm(x.multiverse) === fr)) || (base.length > 3 && G.norm(x.title).startsWith(base))))
      .sort((a, b) => String(a.date || "9999").localeCompare(String(b.date || "9999"))).slice(0, 40);
    return hits.length ? `<div class="listcard">${hits.map(x => `<div class="item" style="flex-wrap:wrap;gap:6px"><div class="grow" style="min-width:160px"><b class="ell" style="display:block">${esc(x.title)}</b><div class="small muted">${esc([String(x.date || "").slice(0, 4), x.platform].filter(Boolean).join(" · "))}</div></div>
      <button class="btn small" data-action="glinkdo" data-how="remake" data-id="${esc(x.id)}">Its remake</button><button class="btn quiet small" data-action="glinkdo" data-how="original" data-id="${esc(x.id)}">Its original</button><button class="btn quiet small" data-action="glinkdo" data-how="same" data-id="${esc(x.id)}">Same game</button></div>`).join("")}</div>`
      : `<p class="small muted">${n ? "No game matches." : "Type part of the other game's title."}</p>`;
  }
  function input(el) {
    if (el.dataset.glq) { const g = lib().get(ui.linkFor), box = document.getElementById("glinkList"); if (g && box) box.innerHTML = linkList(g, el.value); return false; } if (el.dataset.gq) { ui.q = el.value; ui.lim = 120; return "grid"; } if (el.dataset.gsq) { ui.sq = el.value; } return false; }
  function enter(el) { if (el.dataset.gsq) { ui.sq = el.value; search(); return true; } return false; }
  K.mods.games = { title: "Games", render, act, change, input, enter, open, ui, posterOf, tileOf };
})();
