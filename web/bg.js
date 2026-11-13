/* Background check, run by SyncJobService in an off-screen WebView: sync Trakt, refresh TMDB collections and
   new seasons, then post notifications for new announcements and release days. */
(function () {
  "use strict";
  const A = window.Android;
  const C = window.Core;
  const pending = new Map();
  let seq = 0;
  window.__httpDone = id => {
    const cb = pending.get(id);
    pending.delete(id);
    let r;
    try { r = JSON.parse(A.take(id)); } catch (e) { r = { status: 0, headers: {}, body: "", error: String(e) }; }
    if (cb) cb(r);
  };
  const http = (method, url, opt = {}) => new Promise(res => {
    const id = "g" + (++seq);
    pending.set(id, res);
    A.http(id, method, String(url).replace(/^http:\/\//i, "https://"), Object.entries(opt.headers || {}).map(([k, v]) => `${k}: ${v}`).join("\n"), opt.body || "");
  });

  async function main() {
    const db = new C.Store({ load: () => A.load("canonsync.json"), save: t => A.save("canonsync.json", t), cache: { load: () => A.load("cache.json"), save: t => A.save("cache.json", t) }, secrets: A.secretsLoad ? { load: () => A.secretsLoad(), save: t => A.secretsSave(t) } : null });
    if (db.get("bg_enabled", "1") !== "1") return "background checks are off";
    const { report, notes } = await C.backgroundRun(db, http);
    for (const n of notes) A.notify(n.id, n.title, n.text, n.tab || "home");
    db.flush();
    return report + await library(db) + await books() + await games(db);
  }

  // Your library: refresh the episode lists of series you're watching and say when a new one is out
  async function library(db) {
    try {
      if (!window.Lib) return "";
      const L = window.Lib;
      const lib = new L.Library({ load: () => A.load("library.json"), save: t => A.save("library.json", t) });
      const shows = L.stale(lib).slice(0, 12);
      if (!shows.length && !(db.get("token") && lib.outbox.length)) return "";
      const opt = { tmdbKey: db.get("tmdb_key"), lang: (() => { try { return JSON.parse(window.Banta.read("features.json") || "{}").lang === "it" ? "it" : "en"; } catch (e) { return "en"; } })(), country: db.get("region", "IT") };
      let n = 0, notes = 0;
      const today = new Date().toISOString().slice(0, 10);
      for (const it of shows) {
        const before = L.Library.prototype.nextEp.call(lib, it, today);
        try { if (await L.details(http, it, opt)) n++; } catch (e) { continue; }
        const after = lib.nextEp(it, today);
        // a new aired episode of a show you're up to date with
        if (it.status === "watching" && after && !after.upcoming && (!before || before.upcoming) && db.get("bg_eps_lib", "1") === "1") {
          const nid = C.hashId(`lib|${it.id}|${after.s}|${after.e}`), txt = `S${after.s} E${after.e}${after.name ? ` · ${after.name}` : ""} is out.`;
          if (A.notifyAction) A.notifyAction(nid, `New episode: ${it.title}`, txt, "home", "Mark watched", JSON.stringify({ op: "ep", id: it.id, s: after.s, e: after.e, at: "__NOW__" }));
          else A.notify(nid, `New episode: ${it.title}`, txt, "home");
          notes++;
        }
      }
      // live sync: what you logged while the app was closed goes to Trakt
      let pushed = "";
      if (db.get("token") && db.get("trakt_push", "1") === "1" && db.get("live_sync", "1") === "1" && lib.outbox.length) {
        try { pushed = `, Trakt: ${await L.traktPush(lib, http, db.get("client_id"), db.get("token"))}`; } catch (e) { pushed = `, Trakt: ${e.message}`; }
      }
      lib.save();
      return `\nOK  Library${pushed}: ${shows.length} series checked, ${n} updated${notes ? `, ${notes} new episode${notes === 1 ? "" : "s"}` : ""}`;
    } catch (e) { return `\nFAIL library: ${e && e.message}`; }
  }

  // Books: ebook price drops for want-to-read books (features "books" and "bookPrices", and the Books setting)
  // Games: Steam prices for games you want, twice a day at most
  async function games(db) {
    try {
      if (!window.GamesCore) return "";
      const feats = (() => { try { return JSON.parse(window.Banta.read("features.json") || "{}"); } catch (e) { return {}; } })();
      if (feats.games === 0 || feats.priceAlerts === 0) return "";
      const G = window.GamesCore;
      const lib = new G.Games({ load: () => A.load("games.json"), save: t => A.save("games.json", t) });
      if (!lib.games.length || Date.now() - (lib.meta.pricesAt || 0) < 11 * 36e5) return "";
      const alerts = await G.steamPrices(lib, http, lib.settings.region || "IT");
      lib.meta.pricesAt = Date.now();
      lib.save();
      for (const a of alerts) A.notify(C.hashId("gp|" + a.g.id + "|" + a.g.price.eur), a.why === "target" ? `Price alert: ${a.g.title}` : `On sale: ${a.g.title}`, `€${a.g.price.eur.toFixed(2)} on Steam${a.g.price.disc ? ` (−${a.g.price.disc}%)` : ""}`, "games");
      return `\nOK  Games: prices checked, ${alerts.length} alerts`;
    } catch (e) { return `\nFAIL games: ${e && e.message}`; }
  }

  async function books() {
    try {
      const f = window.Banta ? JSON.parse(window.Banta.read("features.json") || "{}") : {};
      if (f.books === 0 || f.bookPrices === 0 || !window.BooksCore) return "";
      const lib = new window.BooksCore.Library({ load: () => A.load("books.json"), save: t => A.save("books.json", t) });
      if (!lib.books.length || !lib.settings.alerts) return "";
      const notes = await window.BooksCore.priceCheck(lib, http, { budget: 40 });
      for (const n of notes) A.notify(n.id, n.title, n.text, "books");
      return `\nOK  Book prices: ${notes.length} alert${notes.length === 1 ? "" : "s"}`;
    } catch (e) { return `\nFAIL book prices: ${e && e.message}`; }
  }

  main().then(r => A.done(String(r || "")), e => {
    try {
      const db = new C.Store({ load: () => A.load("canonsync.json"), save: t => A.save("canonsync.json", t), cache: { load: () => A.load("cache.json"), save: t => A.save("cache.json", t) }, secrets: A.secretsLoad ? { load: () => A.secretsLoad(), save: t => A.secretsSave(t) } : null });
      db.set("bg_report", `FAIL background check: ${e && e.message}`);
      db.flush();
    } catch (x) { /* nothing else to do */ }
    A.done(`FAIL ${e && e.message}`);
  });
})();
