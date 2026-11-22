// Saga: suggestions from your ratings (For you on Home), worked out after a sync.
// A part of app.js, in its own file: it gets what it uses from the rest of the app through A, and gives back what
// the app uses (made by scripts/split_app.js; the names it uses are listed in app.js where it's put together).
(function (root) {
  "use strict";
  (root.SagaParts = root.SagaParts || {}).foryou = function (A) {
  // ---- 0.6.5: suggestions from your ratings ("For you" on Home). Worked out after a sync, at most once a day.
  const recsHidden = () => { try { return new Set(JSON.parse(A.db.get("recs_hide", "[]"))); } catch (e) { return new Set(); } };
  const recsNow = () => { const r = A.db.cacheGet("recs:now"); return r && r.items ? r : null; };
  async function recsRefresh(loud) {
    if (!A.db.get("tmdb_key") || (!loud && recsNow() && Date.now() - recsNow().at < 20 * 3600e3)) return;
    const seeds = A.lib.all().filter(it => it.rating >= 8 && (it.type === "movie" || it.type === "show"))
      .sort((a, b) => String(b.ratedAt || b.watches[b.watches.length - 1] || "").localeCompare(String(a.ratedAt || a.watches[a.watches.length - 1] || "")) || b.rating - a.rating)
      .slice(0, 12).map(it => ({ title: it.title, year: it.year, type: it.type, tmdb: it.tmdb, imdb: it.imdb, rating: it.rating }));
    if (!seeds.length) { if (loud) A.toast("Rate a few films or series 8 or more first"); return; }
    const hid = recsHidden();
    try {
      const items = await A.C.recommend(A.db, A.Native.http, seeds, x => hid.has(x.type + x.tmdb) || !!A.lib.find({ type: x.type, tmdb: x.tmdb, title: x.title, year: x.year }));
      A.db.cacheSet("recs:now", { at: Date.now(), items });
      if (loud) A.toast(`${items.length} suggestions`); A.render();
    } catch (e) { if (loud) A.toast(e.message); }
  }
  function recsHtml() {
    const R = recsNow(); if (!R) return "";
    const hid = recsHidden(), f = A.ui.recF || "all";
    let items = R.items.filter(x => !hid.has(x.type + x.tmdb) && !A.lib.find({ type: x.type, tmdb: x.tmdb, title: x.title, year: x.year }));
    if (!items.length) return "";
    const genres = Object.entries(items.reduce((m, x) => { for (const g of x.genres.slice(0, 2)) m[g] = (m[g] || 0) + 1; return m; }, {})).sort((a, b) => b[1] - a[1]).slice(0, 5).map(x => x[0]);
    items = items.filter(x => f === "all" || (f === "movie" || f === "show" ? x.type === f : x.genres.includes(f))).slice(0, 10);
    const chip = (k, l) => `<button class="chip ${f === k ? "on" : ""}" data-action="recf" data-v="${A.esc(k)}">${A.esc(l)}</button>`;
    return `<section>${Kit.head("For you", `<button class="btn quiet small" data-action="recsnow">Refresh</button>`)}
      <div class="chips" style="margin-bottom:8px">${chip("all", "All")}${chip("movie", "Films")}${chip("show", "Series")}${genres.map(g => chip(g, g)).join("")}</div>
      <div class="listcard">${items.map(x => `<div class="item" data-action="recopen" data-k="${A.esc(x.type + x.tmdb)}" role="button"><img class="thumb" loading="lazy" src="${A.esc(x.poster)}" alt="" data-fb="ph" data-fbc="thumb ph ${x.type === "show" ? "series" : "movie"}" data-fbt="${A.esc(A.initials(x.title))}">
        <div class="grow" style="min-width:0"><b class="ell">${A.esc(x.title)}</b><div class="small muted ell">${A.esc([x.year, x.type === "show" ? "Series" : "Film", x.genres.slice(0, 2).join(", "), x.vote ? "★ " + x.vote.toFixed(1) : ""].filter(Boolean).join(" · "))}</div>
        <div class="small muted ell">Because you rated ${A.esc(x.because.join(", "))}</div></div>
        <button class="btn quiet small" data-action="recadd" data-k="${A.esc(x.type + x.tmdb)}">${A.icon("plus")}Add</button><button class="iconbtn" data-action="rechide" data-k="${A.esc(x.type + x.tmdb)}" aria-label="Not interested">${A.icon("x")}</button></div>`).join("") || `<p class="small muted" style="padding:8px">Nothing in this group.</p>`}</div></section>`;
  }
  // 0.6.5: first steps on a fresh install (the Starter build), each ticked when done
  function startHtml() {
    const steps = [
      ["features", "Pick your tabs", "Films and series, Games, Books, Doctor Who: switch off what you don't use.", A.db.get("features_seen") === "1"],
      ["accounts", "Add a TMDB key", "Free from themoviedb.org: posters, details, new seasons, suggestions.", !!A.db.get("tmdb_key")],
      ["accounts", "Connect Trakt or IMDb", "Brings your ratings, watchlist and history; a rating counts as watched.", !!(A.db.get("username") || A.db.get("imdb_user"))],
      ["accounts", "Your Saga website", "The address and sync key you were given: your data on your phone and the web, and friends.", !!A.db.get("web_sync_url")],
      ["importhub", "Import from other apps", "Letterboxd, Goodreads, HowLongToBeat, Steam, MyAnimeList, a games spreadsheet…", !!A.db.get("hub_last")],
    ];
    const done = steps.filter(x => x[3]).length;
    return `<section>${Kit.head(`Get started · ${done} of ${steps.length}`)}<div class="listcard">${steps.map(([k, t, d, ok]) => `<div class="item" data-action="go" data-sec="settings" data-scroll="${k}" role="button">
      <span class="tilecheck" style="position:static;${ok ? "" : "opacity:.35"}" aria-label="${ok ? "Done" : "To do"}">${A.icon(ok ? "check" : "chev")}</span><div class="grow"><b>${A.esc(t)}</b><div class="small muted">${A.esc(d)}</div></div></div>`).join("")}</div></section>`;
  }
  function renderHome() {
    const st = A.status(), parts = [];
    // 0.5.8: a line when the last sync failed in part or is old, with the way to it
    // 0.6.9.9: the website runs an older Saga than this app: the two show different screens until it updates
    // 0.7.3: the Pi's daily check found that IMDb changed something Saga reads
    { const ic = window.__sagaWeb ? null : A.P_website().WS.get().imdb; if (ic && ic.state === "changed" && Date.now() - ic.at < 4 * 864e5 && A.db.get("imdbchk_hide") !== String(ic.at)) parts.push(`<div class="nextbox warnbox" style="margin-bottom:12px"><div class="grow small"><b>IMDb changed something Saga reads</b> (found by your website's daily check). The IMDb parts of a sync may fail until Saga is updated; what you have is kept.<div class="muted ell">${A.esc((ic.lines || []).join(" · "))}</div></div><button class="iconbtn" data-action="imdbchkhide" data-v="${ic.at}" aria-label="Hide">${A.icon("x")}</button></div>`); }
    { const wv = window.__sagaWeb ? "" : A.P_website().WS.get().ver || ""; if (wv && A.verNum(wv) < A.verNum(A.VERSION) && A.P_website().WS.get().hide !== wv) parts.push(`<div class="nextbox" style="margin-bottom:12px"><div class="grow small"><b>Your website runs Saga ${A.esc(wv)}</b>, this app ${A.VERSION}: until it's updated, the website shows older screens and may handle your data differently.</div><button class="btn small" data-action="webupdate">Update the website</button><button class="iconbtn" data-action="webupdhide" aria-label="Hide">${A.icon("x")}</button></div>`); }
    { const nv = A.db.get("upd_ver", ""); if (nv && A.verNum(nv) > A.verNum(A.VERSION) && A.db.get("upd_hide") !== nv) parts.push(`<div class="nextbox" style="margin-bottom:12px"><div class="grow small"><b>Saga ${A.esc(nv)} is out</b> (this ${window.__sagaWeb ? "website" : "app"} has ${A.VERSION}). ${window.__sagaWeb ? "Update it now (the website restarts for a few seconds), or on the Pi run <code>bash /opt/saga/app/site/update.sh</code>; to let it update itself every night: <code>bash /opt/saga/app/site/auto-update.sh on</code>."
        : A.updateUrl() ? "Get it from your Saga website; your data stays." : "Ask whoever gave you Saga for the new version; your data stays."}</div>${window.__sagaWeb ? `<button class="btn small" data-action="webupdate">Update now</button>` : A.updateUrl() ? `<button class="btn small" data-action="updget">Get it</button>` : ""}<button class="iconbtn" data-action="updhide" aria-label="Hide">${A.icon("x")}</button></div>`); }
    { const sick = A.C.sourceHealth(A.db);
      if (!A.ui.job && sick.length) parts.push(`<div class="nextbox warnbox" style="margin-bottom:12px" data-action="go" data-sec="sync" role="button"><div class="grow small"><b>${A.esc(A.healthText(sick[0]))}</b>${sick.length > 1 ? ` · and ${sick.length - 1} more` : ""}<div class="muted ell">${A.esc(sick[0].msg.replace(/ \([^()]*details:[\s\S]*$/, ""))}</div></div><span class="small">Fix ›</span></div>`); }
    { const last = parseFloat(A.db.get("last_sync", "0")) || 0, fails = A.failedLabels(), h = last ? (Date.now() / 1000 - last) / 3600 : null;
      if (!A.ui.job && (A.db.get("username") || A.db.get("imdb_user")) && (fails.length || h == null || h > 48))
        parts.push(`<div class="nextbox" style="margin-bottom:12px" data-action="go" data-sec="sync"><div class="grow small">${h == null ? "Not synced yet" : `Last sync ${h > 48 ? `${Math.round(h / 24)} days ago` : `${Math.max(1, Math.round(h))} h ago`}`}${fails.length ? ` · ${fails.length} part${fails.length === 1 ? "" : "s"} failed: ${A.esc(fails.slice(0, 3).join(", "))}` : ""}</div><span class="small">Open ›</span></div>`); }
    const empty = !A.lib.all().length && !st.length && !A.games.games.length && !A.books.books.length;
    if (empty) {
      return `<section class="hero2"><div class="bg gen" style="--h:32"></div><div class="in"><div class="kicker">Welcome</div><h1>Everything you watch, play and read</h1>
        <p>Search and add films, series, games and books, tick episodes as you go, log every rewatch with its date, and find the gaps in your franchises.</p>
        <div class="row wrap"><button class="btn primary" data-action="go" data-sec="library">${A.icon("missing")}Search and add</button>
        <button class="btn" data-action="go" data-sec="settings" data-scroll="importhub">${A.icon("upload")}Import</button>
        <button class="btn" data-action="go" data-sec="settings" data-scroll="accounts">${A.icon("sync")}Connect Trakt / IMDb</button></div></div></section>${startHtml()}`;
    }
    const h = A.homeHero();
    if (h) parts.push(`<section class="hero2"><div class="bg${h.img ? "" : " gen"}" style="${h.img ? `background-image:url('${A.esc(h.img)}')` : `--h:${Kit.hue(h.title)}`}"></div>
      ${h.img ? `<img class="side" src="${A.esc(A.httpsUrl(h.img))}" alt="" data-fb="rm">` : ""}<div class="in"><div class="kicker">${A.esc(h.kicker)}</div><h1>${A.esc(h.title)}</h1><p>${A.esc(h.text)}</p><div class="row wrap">${h.btns}</div></div></section>`);
    const cont = A.homeContinue();
    if (cont.length) parts.push(`<section>${Kit.head("What next")}${Kit.rail(cont)}</section>`);
    const rec = A.recentAll(16);
    { const fy = recsHtml(); if (fy) parts.push(fy); }
    { const ib = A.inboxHtml(); if (ib) parts.push(ib); }
    { const fr = A.friendsHtml(); if (fr) parts.push(fr); }
    if (rec.length) parts.push(`<section>${Kit.head("Recently watched, played and read", `<button class="btn quiet small" data-action="recentall">Diary</button>`)}${Kit.rail(rec.map(recentTile))}</section>`);
    if (A.db.get("home_calendar", "1") === "1") {
      const soon = comingUp(14);
      if (soon.length) parts.push(`<section>${Kit.head("Coming up", `<button class="btn quiet small" data-action="go" data-sec="upcoming">Calendar</button>`)}${Kit.rail(soon.map(x => x.html))}</section>`);
    }
    { const ls = A.listsSection(); if (ls) parts.push(ls); }
    const nx = st.length ? A.C.upNext(st, 12) : [];
    if (A.lib.all().some(x => x.status === "watchlist")) parts.push(`<section><button class="btn" data-action="librandom">${A.icon("sync")}Pick something from my watchlist</button></section>`);
    { const pk = A.picksToday(); if (pk.length >= 3) parts.push(`<section>${Kit.head("Picks for today", `<button class="btn quiet small" data-action="pickedit">${A.ui.pickEdit ? "Done" : "Not for me…"}</button>`)}${A.ui.pickEdit
      ? `<div class="listcard">${pk.map(x => `<div class="item"><div class="grow" style="min-width:0"><b class="ell">${A.esc(x.t)}</b><div class="small muted ell">${A.esc(x.why)}</div></div>${[["seen", "Seen it"], ["long", "Too long"], ["mood", "Not now"], ["no", "Not for me"]].map(([r, l]) => `<button class="btn quiet small" data-action="pickhide" data-k="${A.esc(x.k)}" data-v="${r}">${l}</button>`).join("")}</div>`).join("")}</div>`
      : Kit.rail(pk.map(x => Kit.tile({ title: x.t, img: x.img, kind: x.kind, attrs: x.attrs }, x.t, A.esc(x.why))))}</section>`); }
    if (nx.length) parts.push(`<section>${Kit.head("Next in your canon", `<button class="btn quiet small" data-action="go" data-sec="missing">Canon</button>`)}${Kit.rail(nx.map(c => Kit.tile({ title: c.title, key: "canon:" + A.canonKey(c), img: A.cImg(c), kind: c.medium === "TV Series" ? "show" : c.medium === "Video Game" ? "game" : "movie", attrs: `data-action="sheet" data-sid="${A.sid(c, "canon")}"` }, c.title, `${c.franchise}${c.year ? " · " + c.year : ""}`)))}</section>`);
    const mvs = multiverseList().slice(0, 12);
    if (mvs.length) parts.push(`<section>${Kit.head("Your multiverses")}${Kit.rail(mvs.map(m => `<button class="poster wide" data-action="mvopen" data-mv="${A.esc(m.name)}" style="text-align:left"><span class="gen" style="--h:${Kit.hue(m.name)}"><b>${A.esc(m.name)}</b><small>${m.done} of ${m.total} · ${Math.round(100 * m.done / Math.max(1, m.total))}%</small></span><span class="bar"><i style="width:${Math.round(100 * m.done / Math.max(1, m.total))}%"></i></span></button>`), true)}</section>`);
    if (!A.activityReady()) { A.warmActivity(); parts.push(`<section class="card" data-action="go" data-sec="year" style="cursor:pointer;min-height:132px"><div class="kicker">${new Date().getFullYear()} so far</div><p class="small muted" style="margin:10px 0 0">Your year in review ›</p></section>`); }
    else { const y = A.yearCounts(new Date().getFullYear());
    parts.push(`<section class="card" data-action="go" data-sec="year" style="cursor:pointer"><div class="kicker">${y.year} so far</div>
      <div class="stat3" style="margin-top:10px"><div><b>${A.fmt(y.films + y.episodes)}</b><span>films and episodes</span></div><div><b>${A.fmt(y.games)}</b><span>games finished</span></div><div><b>${A.fmt(y.books)}</b><span>books read</span></div></div>
      <p class="small muted" style="margin:10px 0 0">Your year in review ›</p></section>`); }
    if (A.ui.report && /FAIL|PART/.test(A.ui.report)) parts.push(`<section class="card"><div class="row"><span class="grow small">Some sources didn't sync completely last time.</span><button class="btn small" data-action="go" data-sec="sync">See why</button></div></section>`);
    return parts.join("");
  }
  function recentTile(x) {
    const kind = x.app === "games" ? "game" : x.app === "books" ? "book" : x.app === "dw" ? "story" : x.type || "movie";
    const act = x.app === "watch" ? `data-action="libopen" data-id="${A.esc(x.id)}"` : x.app === "games" ? `data-action="gopen" data-id="${A.esc(x.id)}"` : x.app === "books" ? `data-action="bopen" data-id="${A.esc(x.id)}"` : x.app === "dw" ? `data-action="tlhome" data-k="${A.esc(x.id)}"` : `data-action="sheet" data-sid="${A.sid({ title: x.r.title, year: x.r.year, medium: x.r.medium, imdb: x.r.imdb, franchise: "" }, "lib")}"`;
    return Kit.tile({ title: x.title, img: x.img || "", kind, badge: A.shortDay(x.date).replace(/ \d{4}$/, ""), attrs: act }, x.title, x.sub);
  }
  // episodes, films, games and books coming out in the next n days
  function comingUp(n) {
    const today = A.TODAY(), until = new Date(Date.now() + n * 864e5).toISOString().slice(0, 10), out = [];
    for (const it of A.lib.all()) if (it.type === "show" && it.status !== "dropped" && it.status !== "paused" && it.epl) {
      const x = it.epl.find(e => e[2] && e[2] >= today && e[2] <= until);
      if (x) out.push({ d: x[2], html: Kit.tile({ title: it.title, img: it.poster, kind: "show", badge: A.dayLabel(x[2], today), badgeAcc: x[2] === today, attrs: `data-action="libopen" data-id="${A.esc(it.id)}"` }, it.title, `S${x[0]} E${x[1]}`) });
    }
    const libShows = new Set(A.lib.all().map(it => it.imdb).filter(Boolean));
    for (const e of A.notDropped(A.C.upcomingEpisodes(A.db, today))) if (e.date <= until && !libShows.has(e.imdb) && !out.some(o => o.t === e.show)) out.push({ d: e.date, t: e.show, html: Kit.tile({ title: e.show, kind: "show", badge: A.dayLabel(e.date, today), attrs: `data-action="sheet" data-sid="${A.sid(Object.assign({ kind: "episode" }, e), "up")}"` }, e.show, `S${e.s} E${e.e}`) });
    for (const c of A.C.releaseList(A.status(), today).upcoming.filter(c => c.date && c.date <= until).slice(0, 10)) out.push({ d: c.date, html: Kit.tile({ title: c.title, key: "canon:" + A.canonKey(c), img: A.cImg(c), kind: c.medium === "TV Series" ? "show" : "movie", badge: A.dayLabel(c.date, today), attrs: `data-action="sheet" data-sid="${A.sid(c, "canon")}"` }, c.title, c.franchise) });
    if (A.secOn("games")) for (const g of A.games.upcoming(today).filter(g => g.date <= until)) out.push({ d: g.date, html: Kit.mods.games.tileOf(g) });
    return out.sort((a, b) => a.d.localeCompare(b.d)).slice(0, 20);
  }
  // multiverses across tabs: canon entries, games, books series, Doctor Who
  function multiverseList() {
    const m = new Map();
    const get = name => { const k = A.C.norm(name); if (!m.has(k)) m.set(k, { name, total: 0, done: 0 }); return m.get(k); };
    for (const c of A.status()) { if (!c.franchise || c.franchise === "Unsorted") continue; const x = get(c.franchise); x.total++; if (c.have) x.done++; }
    if (A.secOn("games")) for (const g of A.games.visible()) { const k = A.C.norm(g.multiverse || g.franchise); if (!k || !m.has(k)) continue; const x = m.get(k); x.total++; if (g.status === "done") x.done++; }
    return [...m.values()].filter(x => x.total >= 3).sort((a, b) => (b.done > 0) - (a.done > 0) || b.total - a.total);
  }
    return { recsHidden, recsNow, recsRefresh, renderHome };
  };
})(typeof window !== "undefined" ? window : this);
