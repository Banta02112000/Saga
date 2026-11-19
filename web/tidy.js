// Saga: duplicates (suggested pairs, merged when you say so) and starting over part by part.
// A part of app.js, in its own file: it gets what it uses from the rest of the app through A, and gives back what
// the app uses (made by scripts/split_app.js; the names it uses are listed in app.js where it's put together).
(function (root) {
  "use strict";
  (root.SagaParts = root.SagaParts || {}).tidy = function (A) {
  // ---- 0.6.9: duplicates in your films and series and your games: suggested pairs, merged only when you say so
  const dupSkip = () => { try { return JSON.parse(A.db.get("dup_skip", "{}")) || {}; } catch (e) { return {}; } };
  function dupPairs() { const sk = dupSkip(); return { lib: A.L.findDuplicates(A.lib, sk), games: A.feat("games") ? A.GC.findDuplicates(A.games, sk) : [] }; }
  function openDuplicates() {
    const d = dupPairs(), n = d.lib.length + d.games.length;
    const side = (x, kind) => kind === "lib" ? `<div class="grow" style="min-width:0"><b class="ell">${A.esc(x.title)}</b><div class="small muted ell">${A.esc([A.L.span(x), x.type === "show" ? "Series" : "Film", A.LST[x.status], x.rating ? "★ " + x.rating : "", x.watches.length ? x.watches.length + " watch" + (x.watches.length === 1 ? "" : "es") : "", Object.keys(x.eps || {}).length ? Object.keys(x.eps).length + " episodes ticked" : "", x.imdb || ""].filter(Boolean).join(" · "))}</div></div>`
      : `<div class="grow" style="min-width:0"><b class="ell">${A.esc(x.title)}</b><div class="small muted ell">${A.esc([A.GC.yearOf(x), x.platform, A.GC.LABEL[x.status], x.rating ? "★ " + x.rating : "", x.plays.length ? x.plays.length + "× finished" : "", x.owned && !/^n\/a$/i.test(x.owned) ? "owned: " + x.owned : ""].filter(Boolean).join(" · "))}</div></div>`;
    const rows = (list, kind) => list.slice(0, 80).map((p, i) => `<div class="card" style="margin:8px 0;padding:10px"><div class="small muted" style="margin-bottom:4px">${A.esc(p.why)}</div>
      <div class="item" style="margin:0">${side(p.a, kind)}</div><div class="item" style="margin:0">${side(p.b, kind)}</div>
      <div class="row wrap" style="margin-top:6px"><button class="btn small" data-action="dupmerge" data-kind="${kind}" data-i="${i}">Merge into one</button><button class="btn small quiet" data-action="dupskip" data-kind="${kind}" data-i="${i}">Not the same</button></div></div>`).join("");
    A.ui.dups = d;
    A.$("#overlay").innerHTML = `<div class="scrim bottom" data-action="dismiss"><div class="sheet" role="dialog" aria-modal="true"><h3 style="margin:0">Duplicates</h3>
      <p class="small muted">${n ? `${A.fmt(n)} possible duplicate${n === 1 ? "" : "s"}. Merging keeps one entry with the further status, your rating, every watch or finish date, ticked episodes, notes and ids. A copy is kept first (Settings › History).` : "No duplicates found."}</p>
      ${n > 1 ? `<button class="btn" data-action="dupall">Merge all ${A.fmt(n)}</button>` : ""}
      ${d.lib.length ? `<h4>Films and series · ${A.fmt(d.lib.length)}</h4>${rows(d.lib, "lib")}` : ""}${d.games.length ? `<h4>Games · ${A.fmt(d.games.length)}</h4>${rows(d.games, "games")}` : ""}</div></div>`;
  }
  function keepBeforeImport(what) {
    A.snapshot(`before the ${what || "import"}`);
    if (A.SH.write("before_import.json", A.P_backup().bundle(false))) { A.db.set("import_undo_at", String(Date.now())); A.db.set("import_undo_what", what || "import"); A.db.flush(); }
  }
  function undoImport() {
    const t = A.SH.read("before_import.json");
    if (!t) { A.toast("The copy from before that import is no longer on this phone"); A.db.set("import_undo_at", ""); A.render(); return; }
    A.confirmDialog("Undo the last import?", `Everything goes back to how it was just before the ${A.db.get("import_undo_what", "import")} import of ${new Date(+A.db.get("import_undo_at")).toLocaleString()}. Changes you made after it are undone too.`, "Undo import", () => {
      try { A.applyBackup(A.readBackup2(t)); A.SH.remove("before_import.json"); A.db.set("import_undo_at", ""); A.db.flush(); A.render(); A.toast("Import undone"); } catch (e) { A.toast(e.message); }
    });
  }
  function undoRestore() {
    const t = A.SH.read("before_restore.json");
    if (!t) { A.toast("The copy from before the restore is no longer on this phone"); A.db.set("restore_undo_at", ""); A.render(); return; }
    A.confirmDialog("Undo the last restore?", "Your data goes back to how it was just before that restore.", "Undo restore", () => {
      try { A.applyBackup(A.readBackup2(t)); A.SH.remove("before_restore.json"); A.db.set("restore_undo_at", ""); A.db.flush(); A.render(); } catch (e) { A.toast(e.message); }
    });
  }
  async function saveBackup() {
    let ok = false;
    try { ok = await A.Native.saveAs(`saga-backup-${A.TODAY()}.json`, await A.bundleOut()); } catch (e) { A.toast(e.message); return; }
    A.toast(ok ? (A.db.get("backup_password") ? "Backup saved, locked with your password" : "Backup saved") : "Backup not saved");
  }
  // exports in other sites' formats, so nothing is locked in here
  const csv = rows => rows.map(r => r.map(v => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(",")).join("\n");
  function exportFile(kind) {
    let name, text;
    if (kind === "letterboxd") {
      const rows = [["Title", "Year", "imdbID", "WatchedDate", "Rating10", "Rewatch"]];
      for (const it of A.lib.all().filter(x => x.type === "movie")) {
        if (!it.watches.length) { if (it.status === "watched" || it.rating) rows.push([it.title, it.year || "", it.imdb || "", "", it.rating || "", ""]); continue; }
        it.watches.forEach((d, i) => rows.push([it.title, it.year || "", it.imdb || "", d || "", i === it.watches.length - 1 ? it.rating || "" : "", i ? "true" : "false"]));
      }
      name = "saga-letterboxd.csv"; text = csv(rows);
    } else if (kind === "imdb") {
      const rows = [["Const", "Your Rating", "Date Rated", "Title", "URL", "Title Type", "Year"]];
      for (const it of A.lib.all()) if (it.imdb && (it.rating || it.status === "watched")) rows.push([it.imdb, it.rating || "", it.watches[it.watches.length - 1] || "", it.title, `https://www.imdb.com/title/${it.imdb}/`, it.type === "show" ? "TV Series" : "Movie", it.year || ""]);
      name = "saga-imdb-ratings.csv"; text = csv(rows);
    } else if (kind === "goodreads") {
      const rows = [["Title", "Author", "ISBN13", "My Rating", "Exclusive Shelf", "Date Read", "Date Added", "Bookshelves", "Number of Pages", "Read Count"]];
      for (const b of A.books.books) rows.push([b.title, b.authors[0] || "", A.BC.bookIsbn(b), b.rating ? Math.round(b.rating / 2) : 0, { want: "to-read", reading: "currently-reading", read: "read", dnf: "did-not-finish" }[b.status], b.finished ? new Date(b.finished).toISOString().slice(0, 10).replace(/-/g, "/") : "", new Date(b.added || Date.now()).toISOString().slice(0, 10).replace(/-/g, "/"), (b.shelves || []).join(" "), b.pages || "", A.BC.readsOf(b).length]);
      name = "saga-goodreads.csv"; text = csv(rows);
    } else {
      // 0.6.5: the same columns the games spreadsheet import reads, so this file can be edited and imported again
      const NA = v => (v === null || v === undefined || v === "" ? "N/A" : v);
      const rows = [["Title", "OG Release Date", "OG Platform", "Remake Name", "Remake Release Date", "Remake Platform", "Owned Platform", "HLTB", "HLTB Bundle", "Rating", "Franchise", "Multiverse", "Next",
        "Status", "My rating", "Finished dates", "Notes", "Steam app"]];
      for (const g of A.games.visible()) rows.push([g.title, g.date || g.dateText || "N/A", NA(g.platform), g.remake ? g.remake.title : "N/A", g.remake ? NA(g.remake.date) : "N/A", g.remake ? NA(g.remake.platform) : "N/A",
        NA(g.owned), NA(g.hours), NA(g.hoursRemake), NA(g.imdbR), g.franchise || "", g.multiverse || "", g.next ? "X" : "", g.status, g.rating || "", g.plays.join(" "), g.notes || "", g.steam || ""]);
      name = "saga-games.csv"; text = csv(rows);
    }
    A.Native.saveAs(name, text).then(ok => A.toast(ok ? `${name} saved` : "Not saved"));
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
      <button class="btn" data-action="dupopen">${A.icon("list")}Find duplicates</button></section>
      <section class="stack" id="startover"><h2>Start over</h2>
      <p class="small muted" style="margin:0">Clear the parts you choose and keep the rest (settings, keys and accounts always stay). A copy of everything is kept first: Undo appears for 10 seconds, and Settings › Imports › Undo the last import works afterwards too.</p>
      <div class="card">${WIPE.map(([k, l, h]) => `<label class="switch"><input type="checkbox" data-wipe="${k}"><span>${A.esc(l)}${h ? `<small class="muted" style="display:block">${A.esc(h)}</small>` : ""}</span></label>`).join("")}
        <button class="btn" style="margin-top:10px" data-action="wipe">Clear what's ticked</button></div></section>`;
  }
  function wipe(cats) {
    keepBeforeImport("clearing");
    const before = A.SH.read("before_import.json");
    const dropRows = keep => { for (const [k, r] of A.db.itemsMap) if (!keep(r)) A.db.itemsMap.delete(k); };
    const dropSettings = rx => { for (const k of Object.keys(A.db.settings)) if (rx.test(k)) delete A.db.settings[k]; };
    if (cats.includes("imdb")) { dropRows(r => r.source !== "imdb"); dropSettings(/^(imdb_eps|imdb_tpl|imdb_ur|imdb_ur_for|imdb_counts)/); }
    else if (cats.includes("imdblists")) dropRows(r => !(r.source === "imdb" && r.kind === "list"));
    if (cats.includes("trakt")) { dropRows(r => r.source !== "trakt"); dropSettings(/^(trakt_progress|ep_ratings|trakt_lists|trakt_la|trakt_last_rated_at|trakt_last_all)$/); }
    if (cats.includes("imports")) dropRows(r => r.source === "imdb" || r.source === "trakt" || r.source === "app");
    if (cats.includes("canon")) { A.db.canonMap.clear(); A.db.franchiseMap.clear(); }
    if (cats.includes("cache")) { A.db.tmdbCache.clear(); A.db._cacheFull = true; A.db._cacheDirty = true; }
    if (cats.includes("library")) { A.lib.items = {}; A.lib.adopted = {}; A.lib.outbox = []; A.libWrite(true); A.mirrorDirty = true; }
    if (cats.includes("games")) { A.games.games = []; A.games.removed = {}; A.games._fi = null; A.games.save(); A.gamesFile.now(); }
    if (cats.includes("books")) { A.books.books = []; A.books.save(); A.booksFile.now(); }
    if (cats.includes("dw")) { A.Native.save("dw.json", ""); try { Kit.mods.timeline.reset(); } catch (e) { /* not loaded */ } }
    if (cats.includes("lists")) A.db.set("my_lists", "[]");
    A.mirrorNow(); A.invalidate(); A.db.flush(true); A.render();
    A.toast(`Cleared: ${cats.length} part${cats.length === 1 ? "" : "s"}`, () => { try { A.applyBackup(A.readBackup2(before)); A.db.flush(true); A.render(); A.toast("Put back"); } catch (e) { A.toast(e.message); } });
  }
  function backupSection() { return backupSection0() + A.historySection() + startOverSection(); }
  function backupSection0() {
    const autos = A.P_backup().autoBackups(), uri = A.db.get("backup_uri"), at = parseFloat(A.db.get("backup_file_at", "0")) || 0;
    return `<section class="stack" id="backup">
        <h2>Backup</h2>
        <div class="card"><b>Automatic backup file</b>
          <p class="small muted" style="margin:6px 0 10px">${uri ? `Written after changes and at least once a day${at ? `, last ${A.esc(new Date(at).toLocaleString(A.lang() === "it" ? "it-IT" : "en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }))}${A.db.get("backup_file_ok") === "0" ? " (failed: pick the file again)" : ""}` : ""}.` : "Pick a file once (in Google Drive, or a folder that syncs) and Saga keeps it up to date, so a new phone loses nothing."}</p>
          <div class="row wrap"><button class="btn ${uri ? "" : "primary"}" data-action="backupfile">${A.icon("upload")}${uri ? "Change the file" : "Choose a backup file"}</button>${uri ? `<button class="btn quiet" data-action="backupnow">Write it now</button>` : ""}</div></div>
        <div class="row wrap"><button class="btn" data-action="backupsave">${A.icon("upload")}Save a copy</button><button class="btn" data-action="backuppick">Restore from a file</button></div>
        <p class="small muted">Restore also takes backups from CanonSync, GameCheck, DW Canon and BookCheck.</p>
        ${autos.length ? `<div class="small muted">Weekly copies kept on this phone:</div>${autos.map(b => `<div class="row"><span class="grow small">${A.esc(new Date(b.at).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric" }))}</span><button class="btn quiet small" data-action="backupauto" data-slot="${b.slot}">Restore</button></div>`).join("")}` : ""}
        <h3 style="margin-top:12px">The old Games and Doctor Who screens</h3>
        <p class="small muted">Your data was brought over when 5.0 first started. If something looks missing, open the old screen once (it saves a copy as it opens), come back, and bring it over again: this replaces what's in the new section.</p>
        <div class="row wrap"><button class="btn small" data-action="classic" data-v="games">Open old Games</button><button class="btn small" data-action="reimport" data-v="games">Bring games over again</button>
          <button class="btn small" data-action="classic" data-v="dw">Open old Doctor Who</button><button class="btn small" data-action="reimport" data-v="dw">Bring Doctor Who marks over again</button></div>
        <h3 style="margin-top:12px">Export for other sites</h3>
        <div class="row wrap"><button class="btn small" data-action="export" data-v="letterboxd">Letterboxd (films)</button><button class="btn small" data-action="export" data-v="imdb">IMDb / Trakt ratings</button>
          <button class="btn small" data-action="export" data-v="goodreads">Goodreads (books)</button><button class="btn small" data-action="export" data-v="games">Games (CSV)</button></div>
      </section>`;
  }

    return { dupSkip, openDuplicates, keepBeforeImport, undoImport, undoRestore, saveBackup, exportFile, WIPE, wipe, backupSection };
  };
})(typeof window !== "undefined" ? window : this);
