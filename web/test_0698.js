// 0.6.9.8: episodes you rated on IMDb are kept by series (also from the newest-ratings batch). Made-up data.
// Run: node test_0698.js
const assert = require("assert");
const C = require("./core.js");
const db = new C.Store();
const items = [{ imdb: "tt0700001", title: "Made Up Series", year: 2020, rating: 8 },
  { imdb: "tt0700099", title: "Episode One", rating: 9, ep: ["tt0700001", 1, 1, "2026-11-17"] }, { imdb: "tt0700098", title: "Episode Two", rating: 7, ep: ["tt0700001", 1, 2, ""] }];
assert.strictEqual(C.keepImdbEps(db, items) > 0, true);
const m = JSON.parse(db.get("imdb_eps"));
assert.deepStrictEqual(m.tt0700001.eps, { "1:1": "2026-11-17", "1:2": 1 });
assert.deepStrictEqual(m.tt0700001.r, { "1:1": 9, "1:2": 7 });
assert.strictEqual(m.tt0700001.t, "Made Up Series");
assert.strictEqual(C.keepImdbEps(db, items), 0, "nothing new the second time");
const core = require("fs").readFileSync(__dirname + "/core.js", "utf8"), i = core.indexOf("keepEps(all);"), j = core.indexOf("if (groups.newest) return");
assert.ok(i > 0 && i < j, "episode ratings are kept before the newest-batch shortcut returns");
console.log("ok  IMDb episode ratings kept by series, with the day you rated them, from every sync");

// sources and time played (made-up data)
const G = require("./games.js"), I = require("./imports.js");
const hl = I.hltb([{ Title: "Made Up Quest", Platform: "PC", Completed: "1", Progress: "12:30:00", "Main Story": "10:00:00" }]);
assert.strictEqual(hl[0].played, 750, "your HowLongToBeat time: 12 h 30 min");
assert.strictEqual(hl[0].hours, null, "not taken as time to beat");
const sx = I.steamXml("<gamesList><games><game><appID>9990001</appID><name>Made Up Shooter</name><hoursOnRecord>3.5</hoursOnRecord></game></games></gamesList>");
assert.strictEqual(sx[0].mins, 210); assert.strictEqual(sx[0].hours, null);
const lib = new G.Games(null);
G.importRows(lib, sx, "Steam library");
G.importRows(lib, hl, "HowLongToBeat");
const sh = lib.games.find(g => g.title === "Made Up Shooter"), qu = lib.games.find(g => g.title === "Made Up Quest");
assert.strictEqual(sh.steamMins, 210); assert.ok(!sh.hours, "Steam playtime is not time to beat");
assert.strictEqual(G.timePlayed(sh).mins, 210);
assert.strictEqual(G.timePlayed(qu).mins, 750); assert.strictEqual(G.timePlayed(qu).parts[0][0], "HowLongToBeat");
qu.sessions = [{ mins: 900 }]; assert.strictEqual(G.timePlayed(qu).mins, 900, "the biggest count wins, never added up");
assert.strictEqual(G.hrs(750), "13 h"); assert.strictEqual(G.hrs(90), "1.5 h"); assert.strictEqual(G.hrs(20), "20 min");
assert.strictEqual(G.sourceOf(sh).from, "Steam");
assert.ok(G.sourceOf(qu).linked.includes("HowLongToBeat playtime"));
assert.strictEqual(G.sourceOf({}).from, "added before Saga kept track");
assert.strictEqual(C.canonFrom({ origin: "url", src: "https://www.imdb.com/list/ls000000001/" }), "IMDb list ls000000001");
assert.strictEqual(C.canonFrom({ origin: "gemini+tmdb" }), "Gemini scan · TMDB collection");
assert.strictEqual(C.canonFrom({ origin: "url", src: "https://trakt.tv/users/x/lists/made-up-saga" }), "Trakt list made-up-saga");
assert.strictEqual(C.canonFrom({}), "");
console.log("ok  where entries come from, and time played (Steam, HowLongToBeat, sessions)");
console.log("0.6.9.8 TESTS PASSED");
