// 0.5.8: Trakt downloads only what changed; play sessions and reading progress in the activity history.
// Run: node test_058.js
const assert = require("assert");
const C = require("./core.js"), A = require("./activity.js"), G = require("./games.js"), B = require("./books/core.js");
(async () => {
  // ---- Trakt: parts that haven't changed since the last sync aren't downloaded again
  const la = { all: "2026-11-10T10:00:00.000Z", movies: { watched_at: "2026-11-01T00:00:00.000Z", rated_at: "2026-10-01T00:00:00.000Z", watchlisted_at: "2026-09-01T00:00:00.000Z" },
    episodes: { watched_at: "2026-11-10T10:00:00.000Z", rated_at: "2026-10-02T00:00:00.000Z" }, shows: { rated_at: "2026-10-03T00:00:00.000Z" }, lists: { updated_at: "2026-08-01T00:00:00.000Z" } };
  let calls = [];
  const http = async (m, url) => {
    const p = url.replace("https://api.trakt.tv", "").split("?")[0]; calls.push(p);
    const body = p === "/sync/last_activities" ? la : /watched\/movies$/.test(p) ? [{ movie: { title: "Heat", year: 1995, ids: { imdb: "tt0113277", tmdb: 949 } }, last_watched_at: "2026-11-01T00:00:00Z" }]
      : /watched\/shows$/.test(p) ? [{ show: { title: "Dark", year: 2017, ids: { imdb: "tt5753856", tmdb: 70523 } }, seasons: [{ number: 1, episodes: [{ number: 1, plays: 1, last_watched_at: "2026-11-10T10:00:00Z" }] }] }]
      : /ratings$/.test(p) ? [] : /watchlist$/.test(p) ? [] : /lists$/.test(p) ? [] : [];
    return { status: 200, headers: { "x-pagination-page-count": "1" }, body: JSON.stringify(body) };
  };
  const db = new C.Store(null);
  db.set("username", "u"); db.set("client_id", "c"); db.set("token", "t");
  await C.syncAll(db, http, () => {}, new Set(["Trakt account"]));
  const first = calls.filter(p => p !== "/sync/last_activities").length;
  assert.ok(first >= 5, "first sync downloads everything: " + calls);
  calls = [];
  la.episodes.watched_at = "2026-11-12T10:00:00.000Z"; // only episodes changed
  const r = await C.syncAll(db, http, () => {}, new Set(["Trakt account"]));
  const got = calls.filter(p => p !== "/sync/last_activities");
  assert.deepStrictEqual(got, ["/users/u/watched/shows"], "only watched shows downloaded: " + got);
  assert.ok(/unchanged since the last sync, not downloaded again: watched movies, ratings, watchlist, lists/.test(r.report), r.report);
  assert.ok(db.items("trakt", ["watched"]).some(x => x.imdb === "tt0113277"), "skipped parts keep what's stored");
  calls = [];
  await C.syncAll(db, http, () => {}, new Set(["Trakt account"]), { fullTrakt: true });
  assert.ok(calls.filter(p => p !== "/sync/last_activities").length >= 5, "a full sync downloads everything");
  // without a sign-in: no skipping
  const db2 = new C.Store(null); db2.set("username", "u"); db2.set("client_id", "c"); calls = [];
  await C.syncAll(db2, http, () => {}, new Set(["Trakt account"])); await C.syncAll(db2, http, () => {}, new Set(["Trakt account"]));
  assert.ok(!calls.includes("/sync/last_activities") && calls.length >= 10);

  // ---- games: play sessions
  const g = G.blank({ title: "Hades", status: "backlog" });
  G.logSession(g, 90, "2026-11-01"); G.logSession(g, 30, "2026-11-01", "boss"); G.logSession(g, 0, "2026-11-02");
  assert.strictEqual(g.sessions.length, 2); assert.strictEqual(G.playedMins(g), 120); assert.strictEqual(g.status, "playing");
  // ---- books: chapter log
  const m = B.blankBook({ title: "Berserk", manga: true, chapters: 300 });
  B.setChapter(m, 5, null, Date.parse("2026-11-03T10:00:00Z")); B.setChapter(m, 9, null, Date.parse("2026-11-03T20:00:00Z")); B.setChapter(m, 12, null, Date.parse("2026-11-04T10:00:00Z"));
  const bk = B.blankBook({ title: "Dune", pages: 600 });
  B.setPage(bk, 40, Date.parse("2026-11-05T10:00:00Z")); B.setPage(bk, 100, Date.parse("2026-11-05T21:00:00Z"));
  // ---- activity: sessions and reading days
  const ev = A.build({ games: { visible: () => [g] }, books: { books: [m, bk] }, readsOf: () => [] });
  const ses = ev.filter(e => e.kind === "session"), rd = ev.filter(e => e.kind === "reading");
  assert.strictEqual(ses.length, 2); assert.ok(ses.some(e => /played 1.5 h/.test(e.sub)));
  assert.deepStrictEqual(rd.map(e => [e.d, e.t, e.sub]).sort(), [["2026-11-03", "Berserk", "9 chapters (to ch. 9)"], ["2026-11-04", "Berserk", "3 chapters (to ch. 12)"], ["2026-11-05", "Dune", "100 pages (to p. 100)"]]);
  const y = A.year(ev, 2026);
  assert.strictEqual(y.sessionMins, 120); assert.strictEqual(y.readPages, 100); assert.strictEqual(y.readChapters, 12); assert.strictEqual(y.playedHours, 2);
  // ---- search tolerates typos (and swapped letters), exact matches first
  const E = require("./extras.js");
  const st = [{ title: "Interstellar", norm: "interstellar", year: 2014 }, { title: "The Lord of the Rings", norm: "the lord of the rings", year: 2001 }, { title: "Alien", norm: "alien", year: 1979 }, { title: "Aliens", norm: "aliens", year: 1986 }];
  const q = x => E.searchAll(x, st, [], null, null).map(r => r.title);
  assert.deepStrictEqual(q("intersteller"), ["Interstellar"]); assert.deepStrictEqual(q("lord of the rigns"), ["The Lord of the Rings"]);
  assert.deepStrictEqual(q("alien"), ["Alien", "Aliens"]); assert.deepStrictEqual(q("ailen").sort(), ["Alien", "Aliens"]); assert.deepStrictEqual(q("xyz"), []);
  console.log("0.5.8 TESTS PASSED");
})().catch(e => { console.error(e); process.exit(1); });
