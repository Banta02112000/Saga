/* 0.8.5: Tonight (what fits the time you have), goals, the Doctor Who queue, and exports for Letterboxd and other
   games sites. Uses the app through window.__app (lib, games, books, db…) and Kit. */
(function () {
  "use strict";
  const K = window.Kit, esc = K.esc;
  const A = () => window.__app;
  const fmt = n => Number(n || 0).toLocaleString("en-GB");
  const len = m => (!m ? "" : m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ""}` : `${m} min`);
  const today = () => new Date().toISOString().slice(0, 10);
  let tonight = null; // minutes picked

  // ---- Tonight: one thing per kind that fits the time you have
  function tonightPicks(mins) {
    const a = A(), out = [];
    // a run of episodes of a series you're watching (the one you watched last first)
    const shows = a.lib.all().filter(it => it.type === "show" && it.status === "watching").map(it => ({ it, tl: a.lib.timeLeft(it), last: Object.values(it.eps || {}).map(String).sort().pop() || "" })).filter(x => x.tl && x.tl.eps).sort((p, q) => q.last.localeCompare(p.last));
    for (const x of shows) {
      const per = x.tl.mins ? Math.max(5, Math.round(x.tl.mins / x.tl.eps)) : +x.it.runtime || 45, n = Math.min(x.tl.eps, Math.floor((mins + 5) / per));
      if (n >= 1) { const nx = a.lib.nextEp ? a.lib.nextEp(x.it) : null; out.push({ kind: "series", title: x.it.title, img: x.it.poster, act: `data-action="libopen" data-id="${esc(x.it.id)}"`, why: `${n} episode${n === 1 ? "" : "s"}${nx && nx.s != null ? ` from S${nx.s} E${nx.e}` : ""} · ${len(n * per)}` }); break; }
    }
    // a film from your watchlist that fits (the one waiting longest)
    const films = a.lib.all().filter(it => it.type === "movie" && it.status === "watchlist" && +it.runtime && +it.runtime <= mins + 10).sort((p, q) => (p.added || 0) - (q.added || 0));
    if (films.length) { const f = films[Math.floor((Date.now() / 864e5) % Math.min(films.length, 5))]; out.push({ kind: "film", title: f.title, img: f.poster, act: `data-action="libopen" data-id="${esc(f.id)}"`, why: `${len(+f.runtime)}${f.year ? " · " + f.year : ""} · on your watchlist` }); }
    // the game you're playing (or Up next), for a session
    if (a.games) {
      const g = a.games.visible().filter(x => x.status === "playing").sort((p, q) => String((q.sessions || []).map(s => s.d).sort().pop() || "").localeCompare(String((p.sessions || []).map(s => s.d).sort().pop() || "")))[0] || a.games.visible().find(x => x.next);
      if (g && mins >= 30) { const left = g.hours ? Math.max(0, Math.round(g.hours * 60 - (g.sessions || []).reduce((s, x) => s + (+x.mins || 0), 0))) : 0; out.push({ kind: "game", title: g.title, img: g.cover, act: `data-action="gopen" data-id="${esc(g.id)}"`, why: `a ${len(mins)} session${left ? ` · about ${len(left)} to finish` : ""}` }); }
    }
    // the book you're reading
    if (a.books) {
      const b = a.books.books.find(x => x.status === "reading");
      if (b) { const pages = Math.round(mins * 0.8); out.push({ kind: "book", title: b.title, img: b.cover, act: `data-action="bopen" data-id="${esc(b.id)}"`, why: `about ${pages} pages${b.pages ? ` · ${Math.max(0, b.pages - (b.currentPage || 0))} left` : ""}` }); }
    }
    return out;
  }
  function tonightHtml() {
    const chips = [[30, "30 min"], [60, "1 h"], [120, "2 h"], [180, "3 h+"]].map(([m, l]) => `<button class="chip" data-action="xtonight" data-v="${m}" aria-pressed="${tonight === m}">${l}</button>`).join("");
    const picks = tonight ? tonightPicks(tonight) : [];
    return `<section>${K.head("Tonight")}<p class="small muted" style="margin:-4px 0 8px">How much time do you have?</p><div class="chips">${chips}</div>
      ${tonight ? (picks.length ? K.rail(picks.map(p => K.tile({ title: p.title, img: p.img || "", kind: p.kind === "series" ? "show" : p.kind === "film" ? "movie" : p.kind, attrs: p.act }, p.title, esc(p.why)))) : `<p class="small muted">Nothing on your lists fits ${len(tonight)}.</p>`) : ""}</section>`;
  }

  // ---- goals: { id, kind: films|episodes|games|books|multiverse|series, n, year, mv, id2, by }
  const goals = () => { try { return JSON.parse(A().db.get("goals", "[]")) || []; } catch (e) { return []; } };
  const setGoals = l => { A().db.set("goals", JSON.stringify(l)); };
  function progressOf(gl) {
    const a = A(), y = +gl.year || new Date().getFullYear();
    if (["films", "episodes", "games", "books"].includes(gl.kind)) { const c = a.yearCounts(y); return { done: c[gl.kind] || 0, total: +gl.n || 1 }; }
    if (gl.kind === "multiverse") { const m = a.games.multiverses("date").find(x => x.name === gl.mv); return m ? { done: m.done, total: m.total } : { done: 0, total: 0, gone: true }; }
    if (gl.kind === "series") { const it = a.lib.get(gl.id2); const tl = it && a.lib.timeLeft(it); const all = it && it.epl ? it.epl.filter(x => x[0] > 0).length : 0; return it ? { done: Math.max(0, all - (tl ? tl.eps : 0)), total: all || 1 } : { done: 0, total: 0, gone: true }; }
    return { done: 0, total: 1 };
  }
  const goalName = gl => gl.kind === "multiverse" ? `Finish ${gl.mv}` : gl.kind === "series" ? `Finish ${gl.title || "a series"}` : `${gl.n} ${gl.kind} in ${gl.year}`;
  function paceOf(gl, p) {
    const end = gl.by ? new Date(gl.by) : new Date(`${gl.year || new Date().getFullYear()}-12-31`), start = gl.from ? new Date(gl.from) : new Date(`${gl.year || new Date().getFullYear()}-01-01`);
    const share = Math.min(1, Math.max(0, (Date.now() - start) / Math.max(1, end - start))), want = Math.round(p.total * share), days = Math.ceil((end - Date.now()) / 864e5);
    if (p.done >= p.total) return "done";
    return `${p.done >= want ? "on track" : `${want - p.done} behind`}${days > 0 ? ` · ${days} days left` : " · past its date"}`;
  }
  function goalsHtml() {
    const l = goals();
    if (!l.length) return `<section class="row"><button class="btn quiet small" data-action="xgoaladd">Set a goal for ${new Date().getFullYear()}…</button></section>`;
    return `<section>${K.head("Goals", `<button class="btn quiet small" data-action="xgoaladd">Add</button>`)}<div class="listcard">${l.map(gl => { const p = progressOf(gl), pct = p.total ? Math.min(100, Math.round(100 * p.done / p.total)) : 0;
      return `<div class="item" style="display:block"><div class="row"><b class="grow">${esc(goalName(gl))}</b><span class="small">${fmt(p.done)}/${fmt(p.total)}</span><button class="iconbtn" data-action="xgoaldel" data-id="${esc(gl.id)}" aria-label="Remove goal">×</button></div>
        <div class="mvbar" style="position:static;margin:6px 0 4px;height:6px;border-radius:3px;background:var(--raised)"><i style="display:block;height:100%;border-radius:3px;width:${pct}%;background:var(--action)"></i></div><div class="small muted">${p.gone ? "no longer in your lists" : esc(paceOf(gl, p))}</div></div>`; }).join("")}</div></section>`;
  }
  function goalSheet() {
    const a = A(), mvs = a.games ? a.games.multiverses("size").filter(m => !m.standalone) : [], shows = a.lib.all().filter(it => it.type === "show" && it.status === "watching");
    return `<div class="kicker">New goal</div><h2 style="margin:4px 0 10px">What do you want to get done?</h2>
      <label class="field"><span>Kind</span><select id="xgK"><option value="books">Books read this year</option><option value="films">Films watched this year</option><option value="episodes">Episodes watched this year</option><option value="games">Games finished this year</option>${mvs.length ? `<option value="multiverse">Finish a games multiverse</option>` : ""}${shows.length ? `<option value="series">Finish a series</option>` : ""}</select></label>
      <label class="field"><span>How many (for a count)</span><input id="xgN" type="number" min="1" value="12"></label>
      ${mvs.length ? `<label class="field"><span>Multiverse (for Finish a multiverse)</span><input id="xgM" list="xgML" autocomplete="off"></label><datalist id="xgML">${mvs.map(m => `<option value="${esc(m.name)}">`).join("")}</datalist>` : ""}
      ${shows.length ? `<label class="field"><span>Series (for Finish a series)</span><select id="xgS">${shows.map(it => `<option value="${esc(it.id)}">${esc(it.title)}</option>`).join("")}</select></label>` : ""}
      <label class="field"><span>By (optional; otherwise the end of the year)</span><input id="xgB" type="date"></label>
      <button class="btn block" data-action="xgoalsave">Add the goal</button>`;
  }

  // ---- Doctor Who: the next stories that aren't TV (audio, comics, short stories…), in timeline order
  function dwHtml() {
    const T = K.mods && K.mods.timeline, a = A();
    if (!T || !T.queue || (T.started && !T.started()) || !a.secOn || !a.secOn("timeline") || !window.DW_DATA) return "";
    const q = T.queue(10, ["audio", "comic", "short", "novel", "webcast", "video", "poem"]);
    if (!q.length) return "";
    return `<section>${K.head("Doctor Who: next 10 beyond TV", `<button class="btn quiet small" data-action="go" data-sec="timeline">Timeline</button>`)}<div class="listcard">${q.map((x, i) => `<div class="item" data-action="tlopen" data-k="${esc(x.k)}" role="button"><span class="small muted" style="width:22px">${i + 1}</span><div class="grow" style="min-width:0"><b class="ell">${esc(x.title)}</b><div class="small muted">${esc(x.type)} · ${esc(x.era)}</div></div></div>`).join("")}</div></section>`;
  }

  // ---- exports
  const csvCell = v => { const x = v == null ? "" : String(v); return /[",\n]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x; };
  const csv = rows => rows.map(r => r.map(csvCell).join(",")).join("\n") + "\n";
  // Letterboxd's import: Title, Year, imdbID, WatchedDate, Rating (0.5–5), Rewatch. One row per watch with its date.
  function letterboxdCsv() {
    const rows = [["Title", "Year", "imdbID", "WatchedDate", "Rating", "Rewatch"]];
    for (const it of A().lib.all()) {
      if (it.type !== "movie" || it.status !== "watched") continue;
      const r = it.rating ? Math.max(0.5, Math.round(it.rating) / 2) : "";
      const ws = (it.watches || []).filter(Boolean).map(d => typeof d === "number" ? new Date(d).toISOString().slice(0, 10) : String(d).slice(0, 10)).sort();
      if (!ws.length) rows.push([it.title, it.year || "", it.imdb || "", "", r, ""]);
      ws.forEach((d, i) => rows.push([it.title, it.year || "", it.imdb || "", d, i === ws.length - 1 ? r : "", i ? "Yes" : ""]));
    }
    return { text: csv(rows), n: rows.length - 1 };
  }
  // games: a plain CSV most sites and spreadsheets read (Backloggd, HowLongToBeat, a sheet)
  function gamesCsv() {
    const rows = [["Title", "Platform", "Release Date", "Status", "Rating (1-10)", "Finished", "Hours", "Series", "Multiverse", "Versions"]];
    const st = { done: "Completed", playing: "Playing", paused: "On hold", backlog: "Backlog", wishlist: "Wishlist", dropped: "Abandoned" };
    for (const g of A().games.visible()) rows.push([g.title, g.platform || "", g.date || "", st[g.status] || g.status, g.rating || "", (g.plays || []).slice().sort().pop() || "", g.hours || "", g.franchise || "", g.multiverse || "", (g.versions || []).map(v => `${v.title} (${String(v.date || "").slice(0, 4)})`).join("; ")]);
    return { text: csv(rows), n: rows.length - 1 };
  }
  function exportHtml() {
    return `<section class="stack"><h2>Export to other sites</h2>
      <p class="small muted" style="margin:0">Files other sites import. Letterboxd: Settings › Import & Export › Import your data, pick the file. Games: a CSV with title, platform, status, rating, finished date and hours, for Backloggd, HowLongToBeat or a spreadsheet.</p>
      <div class="row wrap"><button class="btn small" data-action="xexport" data-v="letterboxd">Films for Letterboxd (.csv)</button><button class="btn small" data-action="xexport" data-v="games">Games (.csv)</button></div></section>`;
  }

  function act(a, el) {
    const app = A();
    switch (a) {
      case "xtonight": tonight = tonight === +el.dataset.v ? null : +el.dataset.v; app.render(); return true;
      case "xgoaladd": window.Saga.sheet(goalSheet()); return true;
      case "xgoalsave": {
        const v = id => (document.getElementById(id) || {}).value || "";
        const kind = v("xgK"), gl = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), kind, year: new Date().getFullYear(), from: today() };
        if (["films", "episodes", "games", "books"].includes(kind)) { gl.n = Math.max(1, +v("xgN") || 1); gl.from = `${gl.year}-01-01`; }
        if (kind === "multiverse") { gl.mv = v("xgM").trim(); if (!gl.mv) { K.toast("Pick a multiverse"); return true; } }
        if (kind === "series") { gl.id2 = v("xgS"); const it = app.lib.get(gl.id2); gl.title = it ? it.title : ""; }
        if (v("xgB")) gl.by = v("xgB");
        setGoals(goals().concat([gl])); window.Saga.close(); app.render(); K.toast("Goal added: on Home"); return true;
      }
      case "xgoaldel": { if (!K.confirmTap(el, "Remove?")) return true; setGoals(goals().filter(g => g.id !== el.dataset.id)); app.render(); return true; }
      case "xexport": {
        const r = el.dataset.v === "letterboxd" ? letterboxdCsv() : gamesCsv();
        if (!r.n) { K.toast("Nothing to export"); return true; }
        app.Native.saveAs(el.dataset.v === "letterboxd" ? "saga-letterboxd.csv" : "saga-games.csv", r.text).then(ok => K.toast(ok ? `${fmt(r.n)} rows saved` : "Not saved"));
        return true;
      }
    }
    return false;
  }
  function homeCards() { try { return tonightHtml() + goalsHtml() + dwHtml(); } catch (e) { return ""; } }
  K.mods.tonight = { title: "", act };
  window.SagaExtras = { homeCards, exportHtml, letterboxdCsv, gamesCsv, tonightPicks, progressOf, paceOf, goalSheet };
})();
