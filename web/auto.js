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
    ["dupes", "Merge exact duplicates", "Two entries with the same IMDb, TMDB or Steam id become one (a copy is kept first; History › Undo)."],
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
      const rows = S.C.gameCanon(db(), S.games.visible()).filter(c => !c.have && !c.unreleased);
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
      if (!on("gameinfo") || !S.feat("games") || !db().get("gemini_key")) return;
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
      const gPairs = S.feat("games") ? S.GC.findDuplicates(S.games, {}).filter(p => p.why === "same Steam game") : [];
      if (!libPairs.length && !gPairs.length) return;
      try { S.snapshot("before Saga merged exact duplicates by itself"); } catch (e) { return; } // no copy, no merge
      const names = [];
      for (const p of libPairs) { if (!S.lib.get(p.a.id) || !S.lib.get(p.b.id)) continue; S.L.mergeItems(S.lib, p.a, p.b); names.push(p.a.title); }
      for (const p of gPairs) { if (!S.games.get(p.a.id) || !S.games.get(p.b.id)) continue; S.GC.mergeGames(S.games, p.a, p.b); names.push(p.a.title); }
      if (names.length) { S.libSave(); S.games.save(); S.changed("games"); log("dupes", `Merged duplicates: ${names.slice(0, 6).join(", ")}${names.length > 6 ? ` and ${names.length - 6} more` : ""}`); }
    }

    // after a sync (and once when the app opens): each job in turn, quietly; one failing doesn't stop the others
    async function run(why) {
      if (running) return; running = true;
      try {
        retryLater();
        for (const [name, fn] of [["dupes", dupes], ["gamecanon", gameCanon], ["cast", cast], ["gameinfo", gameInfo]]) {
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
      return `<section>${S.Kit.head("Done by itself")}<div class="card" style="padding:10px">${JOBS.map(([k, t, d]) => `<label class="switch"><input type="checkbox" data-action="autoset" data-k="${k}" ${on(k) ? "checked" : ""}><span><b>${esc(t)}</b><small class="muted" style="display:block">${esc(d)}</small></span></label>`).join("")}</div>
        <div class="listcard" style="margin-top:8px">${a.length ? a.slice(0, 20).map(x => `<div class="item"><div class="grow" style="min-width:0"><div class="small">${esc(x.what)}</div><div class="small muted">${esc(when(x.at))}</div></div></div>`).join("") : `<p class="small muted" style="padding:8px 0">Nothing yet: it runs after each sync.</p>`}</div></section>`;
    }
    return { run, html, retryLater, JOBS, log, on, _jobs: { dupes, gameCanon, cast, gameInfo } };
  }
  root.SagaAuto = { make, JOBS };
  if (typeof module !== "undefined" && module.exports) module.exports = root.SagaAuto;
})(typeof window !== "undefined" ? window : this);
