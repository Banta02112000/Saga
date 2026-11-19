// 0.7.2: the jobs Saga does by itself (auto.js). Made-up data. Run: node test_072.js
const assert = require("assert");
const C = require("./core.js"), L = require("./library.js"), G = require("./games.js"), Auto = require("./auto.js");
const ok = m => console.log("ok  " + m);
(async () => {
  const db = new C.Store(), lib = new L.Library(null), games = new G.Games(null);
  const calls = { snap: 0, sync: [], errors: [] };
  const S = { db, ui: {}, C, GC: G, L, lib, games, feat: () => true, http: async () => ({ status: 200, body: JSON.stringify({ d: [] }) }), gql: async () => ({ titles: [] }),
    Native: { http: async () => ({ status: 404, body: "" }) }, doSync: retry => calls.sync.push(retry), libOpt: () => ({}), libSave: () => {}, libTried: new Set(),
    snapshot: () => { calls.snap++; }, changed: () => {}, logError: (a, b) => calls.errors.push(a + ": " + b), esc: t => String(t), lang: () => "en", Kit: { head: t => t }, retryDelay: 20 };
  const A = Auto.make(S);
  // exact duplicates: same IMDb id merged, a copy first; same title only is left for you
  lib.items.a = L.blank({ id: "a", type: "movie", title: "Made Up Film", year: 2000, imdb: "tt7000001", rating: 8 });
  lib.items.b = L.blank({ id: "b", type: "movie", title: "Made-Up Film", year: 2000, imdb: "tt7000001", status: "watched", watches: ["2020-01-01"] });
  lib.items.c = L.blank({ id: "c", type: "movie", title: "Twin Title", year: 2001 });
  lib.items.d = L.blank({ id: "d", type: "movie", title: "Twin Title", year: 2001 });
  // canon games: one you rated on IMDb
  games.add({ title: "Some Other Game" }, "backlog");
  db.replaceCanon("ai", [{ franchise: "Made Up Saga", title: "Made Up Quest", year: 2004, medium: "Video Game", norm: C.norm("Made Up Quest") }]);
  db.addItems([{ imdb: "tt7000009", title: "Made Up Quest", year: 2004, medium: "Video Game", rating: 9 }], "imdb", "rated");
  // a sync part that failed because IMDb turned it away
  db.set("last_failed", JSON.stringify(["IMDb ratings"]));
  db.set("sync_state", JSON.stringify({ "IMDb ratings": { ok: false, kind: "blocked", msg: "IMDb is turning away automated requests for now." } }));
  await A.run("test");
  assert.strictEqual(Object.keys(lib.items).length, 3, "the same-IMDb pair merged, the same-title pair left");
  const m = lib.items.a || lib.items.b; assert.ok(m.rating === 8 && m.status === "watched");
  assert.strictEqual(calls.snap, 1, "a copy before merging");
  const q = games.find({ title: "Made Up Quest" }); assert.ok(q && q.status === "done" && q.rating === 9, "a canon game rated on IMDb: Finished");
  await new Promise(r => setTimeout(r, 60));
  assert.deepStrictEqual(calls.sync, [true], "the failed part tried again later");
  const lg = JSON.parse(db.get("auto_log"));
  assert.ok(lg.some(x => x.k === "dupes") && lg.some(x => x.k === "gamecanon") && lg.some(x => x.k === "retry"), JSON.stringify(lg));
  ok("by itself: exact duplicates merged (copy first), canon games from your IMDb, failed parts retried; all written down");
  // switched off: nothing
  db.set("auto_dupes", "0"); lib.items.e = L.blank({ id: "e", type: "movie", title: "X", imdb: "tt7000002" }); lib.items.f = L.blank({ id: "f", type: "movie", title: "Y", imdb: "tt7000002" });
  db.set("auto_retry", "0"); await A.run("test"); await new Promise(r => setTimeout(r, 60));
  assert.ok(lib.items.e && lib.items.f && calls.sync.length === 1, "switched off: left alone");
  // three retries a day at most
  db.set("auto_retry", "1"); db.set("auto_retry_day", new Date().toISOString().slice(0, 10)); db.set("auto_retry_n", "3");
  A.retryLater(); await new Promise(r => setTimeout(r, 60)); assert.strictEqual(calls.sync.length, 1);
  ok("each job can be switched off; at most 3 retries a day");
  assert.ok(A.html().includes("Done by itself") && A.html().includes("Merged duplicates"));
  console.log("0.7.2 TESTS PASSED");
})().catch(e => { console.error(e); process.exit(1); });
