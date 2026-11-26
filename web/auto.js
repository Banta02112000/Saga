/* Saga 0.7.2: the small jobs you used to start by hand, done by Saga itself after each sync (and when the app opens),
   each one switchable and each one written down (Sync › Done by itself):
   - a sync part that failed because IMDb or the connection turned it away is tried again 45 minutes later (3 times a day)
   - canon games you've rated or listed on IMDb come out of Games › Missing (your synced IMDb rows; 10 IMDb look-ups a run)
   - new games get their details from your prompt (Gemini API only, 5 a run; the Gemini app needs you, so never by itself)
   - films and series get their length and cast from TMDB (12 a run)
   - exact duplicates (the same IMDb, TMDB or Steam id) are merged, with a copy kept first so it can be undone
   Nothing here sends anything anywhere new: it uses the accounts and keys you already set up. */
(function (root) {
  "use strict";
  const JOBS = [
    ["retry", "Try failed sync parts again", "When IMDb or the connection turned a part away, it's tried again 45 minutes later (up to 3 times a day)."],
    ["gamecanon", "Canon games from your IMDb", "Missing canon games you rated on IMDb become Finished with your rating; listed ones go to the wishlist."],
    ["gameinfo", "Game details from your prompt", "New games get release dates, platforms, remakes and HLTB from your prompt (Gemini API key only, 5 per run)."],
    ["cast", "Length and cast for titles", "Films and series get their length and cast from TMDB in the background (12 per run)."],
    ["bundle", "Bundle game versions, follow your multiverses", "Remakes, remasters and re-releases join their original (a copy is kept first); games whose series was only guessed join your list's multiverse."],
    ["dupes", "Merge exact duplicates", "Two entries with the same IMDb, TMDB or Steam id become one (a copy is kept first; History › Undo)."],
    ["backupcheck", "Check the weekly copy", "Once a week the newest automatic copy of your data is opened and compared with what you have, so a broken copy is found before you need it."],
  ];
  function make(S) {
    const db = () => S.db;
    const on = k => db().get("auto_" + k, "1") === "1";
    const log = (k, what) => {
      let a = []; try { a = JSON.parse(db().get("auto_log", "[]")); } catch (e) { a = []; }
      a.unshift({ at: Date.now(), k, what }); db().set("auto_log", JSON.stringify(a.slice(0, 60)));
    };
    const today = () => new Date().toISOString().slice(0, 10);
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    let running = false, retryT = null;

    // ---- 1. failed parts again, later
    function retryLater() {
      if (!on("retry")) return;
      let st = {}; try { st = JSON.parse(db().get("sync_state", "{}")); } catch (e) { return; }
      const failed = (() => { try { return JSON.parse(db().get("last_failed", "[]")); } catch (e) { return []; } })();
      const passing = failed.filter(l => st[l] && !st[l].ok && (/blocked|network/.test(st[l].kind || "") || /couldn't reach|timed? ?out|took longer|limiting|turning away|connection/i.test(st[l].msg || "")));
      if (!passing.length) return;
      const day = db().get("auto_retry_day", ""), n = day === today() ? +db().get("auto_retry_n", "0") : 0;
      if (n >= 3) return;
      clearTimeout(retryT);
      retryT = setTimeout(() => {
        if (S.ui.job) { retryLater(); return; }
        db().set("auto_retry_day", today()); db().set("auto_retry_n", String(n + 1));
        log("retry", `Tried again: ${passing.join(", ")}`);
        S.doSync(true);
      }, S.retryDelay != null ? S.retryDelay : 45 * 60000);
    }

    // ---- 2. canon games from your IMDb
    async function gameCanon() {
      if (!on("gamecanon") || !S.feat("games") || !S.C.gameCanon) return;
      const rows = S.GC.missingRows(S.C, db(), S.games).rows.filter(c => !c.have && !c.unreleased);
      if (!rows.length) return;
      const mine = db().items(null, ["rated", "watched", "watchlist", "list"]).filter(r => r.medium === "Video Game");
      // your own rows for every missing game; IMDb's search for at most 10 not looked up before
      const known = (S.games.meta && S.games.meta.canonImdb) || {};
      const fresh = rows.filter(c => !known[`${S.GC.norm(c.title)}|${c.year || ""}`]).slice(0, 10);
      const r = await S.GC.imdbCheckMissing(S.games, rows.filter(c => fresh.includes(c) || mine.some(m => S.GC.norm(m.title) === S.GC.norm(c.title))), mine,
        S.http, S.gql, { gap: 1500 });
      if (r.finished || r.wishlist) { S.games.save(); S.changed("games"); log("gamecanon", `From your IMDb: ${r.finished} canon game${r.finished === 1 ? "" : "s"} Finished${r.wishlist ? `, ${r.wishlist} on the wishlist` : ""}${r.rated.length ? ` (${r.rated.slice(0, 4).join(", ")}${r.rated.length > 4 ? "…" : ""})` : ""}`); }
    }

    // ---- 3. game details from your prompt (API only)
    async function gameInfo() {
      if (!on("gameinfo") || !S.feat("games") || !db().get("gemini_key") || db().get("ai_manual", "0") === "1") return;
      const todo = S.games.visible().filter(g => !g.aiAt && (!g.date || !g.platform || g.hours == null)).slice(0, 5);
      if (!todo.length) return;
      const prov = S.C.geminiProvider(db(), S.Native.http, db().get("gemini_key"), db().get("gemini_model") || "auto", { search: db().get("gemini_search", "0") === "1" });
      if (prov.prepare) await prov.prepare();
      const done = [];
      for (const g of todo) {
        try {
          const text = await prov.call(S.GC.infoPromptOne(g.title), { title: "Game details" });
          g.aiText = String(text || "").slice(0, 1500);
          const r = S.GC.applyInfo(S.games, [g], [S.GC.parseInfoText(text, g.title)]);
          if (r.filled) done.push(g.title);
        } catch (e) { g.aiAt = Date.now(); S.logError("auto game details", `${g.title}: ${e.message}`); if (/quota|429|key/i.test(e.message)) break; }
        await sleep(1500);
      }
      S.games.save(); S.changed("games");
      if (done.length) log("gameinfo", `Details from your prompt: ${done.join(", ")}`);
    }

    // ---- 4. length and cast
    async function cast() {
      if (!on("cast") || !db().get("tmdb_key")) return;
      const todo = S.lib.all().filter(it => !it.castAt && !it.mal && (it.tmdb || it.imdb) && !(S.libTried && S.libTried.has(it.id)))
        .sort((a, b) => (b.updated || b.added || 0) - (a.updated || a.added || 0)).slice(0, 12);
      let n = 0;
      for (const it of todo) { if (S.libTried) S.libTried.add(it.id); try { if (await S.L.details(S.Native.http, it, S.libOpt())) n++; } catch (e) { if (/429|401|key/i.test(e.message)) break; } await sleep(700); }
      if (n) { S.libSave(); log("cast", `Length and cast for ${n} title${n === 1 ? "" : "s"}`); }
    }

    // ---- 5. exact duplicates
    function dupes() {
      if (!on("dupes")) return;
      const libPairs = S.L.findDuplicates(S.lib, {}).filter(p => p.why === "same IMDb id" || p.why === "same TMDB id");
      // 0.8.4: one Steam app is not proof: two games named alike got the same app by mistake (Doom 1993 and 2016); only
      // the same game by name and no two IMDb pages
      const gPairs = S.feat("games") ? S.GC.findDuplicates(S.games, {}).filter(p => p.why === "same Steam game" && !(p.a.imdb && p.b.imdb && p.a.imdb !== p.b.imdb) && S.GC.storyKey(p.a.title) === S.GC.storyKey(p.b.title)) : [];
      if (!libPairs.length && !gPairs.length) return;
      try { S.snapshot("before Saga merged exact duplicates by itself"); } catch (e) { return; } // no copy, no merge
      const names = [];
      for (const p of libPairs) { if (!S.lib.get(p.a.id) || !S.lib.get(p.b.id)) continue; S.L.mergeItems(S.lib, p.a, p.b); names.push(p.a.title); }
      if (gPairs.length) S.games.batch(`Exact duplicates merged: ${gPairs.length}`, () => { for (const p of gPairs) { if (!S.games.get(p.a.id) || !S.games.get(p.b.id)) continue; S.GC.mergeGames(S.games, p.a, p.b); names.push(p.a.title); } });
      if (names.length) { S.libSave(); S.games.save(); S.changed("games"); log("dupes", `Merged duplicates: ${names.slice(0, 6).join(", ")}${names.length > 6 ? ` and ${names.length - 6} more` : ""}`); }
    }

    // ---- 0.7.6: versions together; series from your list
    function bundle() {
      if (!on("bundle") || !S.feat("games")) return;
      // the canon scans first (they know the wider series), then your list's names for what's left
      const fc = S.C.gameCanon ? S.games.followCanon(S.C.gameCanon(db(), S.games.visible())) : [];
      const fr = fc.concat(S.games.resolveFranchises());
      if (fr.length) log("bundle", `Joined your multiverses: ${fr.slice(0, 5).join("; ")}${fr.length > 5 ? ` and ${fr.length - 5} more` : ""}`);
      // only when something would be bundled: a copy first
      let b = [];
      if (S.games.bundleVersions(true).length) {
        try { S.snapshot("before Saga bundled game versions by itself"); } catch (e) { if (fr.length) S.changed("games"); return; }
        b = S.games.bundleVersions();
        if (b.length) log("bundle", `Bundled with their original: ${b.slice(0, 5).join("; ")}${b.length > 5 ? ` and ${b.length - 5} more` : ""}`);
      }
      if (fr.length || b.length) S.changed("games");
    }
    // ---- 6. the weekly copy opens and has everything in it
    function backupCheck() {
      if (!on("backupcheck") || !S.SH) return;
      if (Date.now() - (+db().get("auto_bcheck_at", "0") || 0) < 6 * 864e5) return;
      let list = []; try { list = JSON.parse(db().get("auto_backups", "[]")); } catch (e) { return; }
      const newest = list.sort((a, b) => b.at - a.at)[0]; if (!newest) return;
      db().set("auto_bcheck_at", String(Date.now()));
      let d = null; try { d = JSON.parse(S.SH.read(`auto_backup_${newest.slot}.json`) || "null"); } catch (e) { d = null; }
      const n = x => (x && typeof x === "object" ? Object.keys(x).length : 0);
      const have = { titles: S.lib.all().length, games: S.games.games.length };
      const got = d ? { titles: n(d.library && d.library.items), games: ((d.games && d.games.games) || []).length } : null;
      // the copy is up to a week old: a few new titles since then are fine, a big gap isn't
      const short = !got || got.titles < have.titles * 0.8 - 5 || got.games < have.games * 0.8 - 5;
      if (short) { S.logError("backup check", `the weekly copy from ${new Date(newest.at).toISOString().slice(0, 10)} ${got ? `has ${got.titles} titles and ${got.games} games of your ${have.titles} and ${have.games}` : "doesn't open"}`); log("backupcheck", `The weekly copy from ${new Date(newest.at).toLocaleDateString()} ${got ? "is missing part of your data" : "doesn't open"}: a new one is made now`); try { db().set("auto_backup_at", "0"); S.autoBackup(); } catch (e) { /* next time */ } }
      else log("backupcheck", `Weekly copy checked: it opens, with ${got.titles} titles and ${got.games} games`);
    }
    // after a sync (and once when the app opens): each job in turn, quietly; one failing doesn't stop the others
    async function run(why) {
      if (running) return; running = true;
      try {
        retryLater();
        for (const [name, fn] of [["backupcheck", backupCheck], ["bundle", bundle], ["dupes", dupes], ["gamecanon", gameCanon], ["cast", cast], ["gameinfo", gameInfo]]) {
          if (S.ui.job) break;
          try { await fn(); } catch (e) { S.logError("auto " + name, e.message); }
          await sleep(300);
        }
        db().set("auto_at", String(Date.now())); db().set("auto_why", why || "");
      } finally { running = false; }
    }
    function html() {
      let a = []; try { a = JSON.parse(db().get("auto_log", "[]")); } catch (e) { a = []; }
      const esc = S.esc, when = t => new Date(t).toLocaleString(S.lang() === "it" ? "it-IT" : "en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
      return `<section>${S.Kit.head("Done by itself")}${typeof window !== "undefined" && window.__sagaWeb ? `<p class="small muted" style="margin:0 0 8px">Your phone does these (so they don't run twice); the switches here change what it does, and the list shows what it did.</p>` : ""}<div class="card" style="padding:10px">${JOBS.map(([k, t, d]) => `<label class="switch"><input type="checkbox" data-action="autoset" data-k="${k}" ${on(k) ? "checked" : ""}><span><b>${esc(t)}</b><small class="muted" style="display:block">${esc(d)}</small></span></label>`).join("")}</div>
        <div class="listcard" style="margin-top:8px">${a.length ? a.slice(0, 20).map(x => `<div class="item"><div class="grow" style="min-width:0"><div class="small">${esc(x.what)}</div><div class="small muted">${esc(when(x.at))}</div></div></div>`).join("") : `<p class="small muted" style="padding:8px 0">Nothing yet: it runs after each sync.</p>`}</div></section>`;
    }
    return { run, html, retryLater, JOBS, log, on, _jobs: { dupes, gameCanon, cast, gameInfo } };
  }
  root.SagaAuto = { make, JOBS };
  if (typeof module !== "undefined" && module.exports) module.exports = root.SagaAuto;
})(typeof window !== "undefined" ? window : this);
