// 0.6.9.7: canon for games, checked against the Games tab; the AI scan also checks Games-tab games. Made-up data.
// Run: node test_0697.js
const assert = require("assert");
const C = require("./core.js");
const db = new C.Store();
db.replaceCanon("list", [
  { franchise: "Quest", title: "Quest One", year: 1990, medium: "Video Game", imdb: "tt9000001" },
  { franchise: "Quest", title: "Quest Two", year: 1993, medium: "Video Game" },
  { franchise: "Quest", title: "Quest Three", year: 1996, medium: "Video Game" },
  { franchise: "Quest", title: "Quest Four", year: 2099, medium: "Video Game" },
  { franchise: "Quest", title: "Quest Film", year: 2001, medium: "Movie" },
  { franchise: "Quest", title: "Quest Spinoff", year: 1998, medium: "Video Game" },
]);
const games = [{ id: "a", title: "Quest One", date: "1990-02-02", status: "done" }, { id: "b", title: "Quest II Classic", date: "1993-05-05", status: "backlog", remake: { title: "Quest Two", date: "1994-01-01" } }];
db.setNotCanon({ title: "Quest Spinoff", year: 1998, medium: "Video Game", franchise: "Quest" }, true);
const rows = C.gameCanon(db, games, "2026-11-18");
const by = Object.fromEntries(rows.map(c => [c.title, [c.have, c.done, c.unreleased, c.game]]));
assert.deepStrictEqual(by, { "Quest One": [true, true, false, "a"], "Quest Two": [true, false, false, "b"], "Quest Three": [false, false, false, null], "Quest Four": [false, false, true, null] }, JSON.stringify(by));
console.log("ok  canon games against your Games tab: by IMDb id, by title or remake title; films left out; not-canon and not-out-yet handled");
C.CONFIG.extraSeeds = () => [{ key: "game|questfive|2000", title: "Quest Five", year: 2000, medium: "Video Game", norm: "questfive" }];
const st = C.aiState(db, "gemini");
assert.ok(st.pool.some(i => i.title === "Quest Five") && st.pending.some(i => i.title === "Quest Five"), "Games-tab games go to the canon scan");
C.CONFIG.extraSeeds = null;
console.log("ok  the AI canon scan checks your Games-tab games too");
// game details from an AI, with the list's rules
const G = require("./games.js");
const pr = G.infoPrompt(["Made Up Brick Saga (2007, PS3)"]);
assert.ok(/January 1, 1900/.test(pr) && /same story/.test(pr) && /HLTB/.test(pr) && /Made Up Brick Saga \(2007, PS3\)/.test(pr));
const ans = 'Sure:\n```json\n[{"title":"Made Up Brick Saga","og_date":"November 6, 2007","og_platform":"PlayStation 3","remake_name":"","remake_date":"","remake_platform":"","hltb":"12.5"},' +
  '{"title":"Made Up Remade","og_date":"March 3rd, 1998","og_platform":"PlayStation","remake_name":"Made Up Remade HD","remake_date":"June 2023","remake_platform":"PC","hltb":20}]\n```';
const info = G.parseInfo(ans);
assert.deepStrictEqual(info[0], { title: "Made Up Brick Saga", date: "2007-11-06", platform: "PlayStation 3", remake: null, hours: 12.5 });
assert.deepStrictEqual(info[1].remake, { title: "Made Up Remade HD", date: "2023-06", platform: "PC" });
const GL = new G.Games();
const g1 = GL.add({ title: "Made Up Brick Saga", platform: "Wii" }, "backlog").game, g2 = GL.add({ title: "Made Up Remade", date: "1998-03-01", hours: 18 }, "done").game;
const res = G.applyInfo(GL, [g1, g2], info);
assert.ok(g1.date === "2007-11-06" && g1.platform === "Wii" && g1.hours === 12.5 && !g1.remake, "only empty fields filled: " + JSON.stringify(g1));
assert.ok(g2.date === "1998-03-01" && g2.hours === 18 && g2.platform === "PlayStation" && g2.remake.title === "Made Up Remade HD" && res.filled === 2, JSON.stringify(g2));
assert.strictEqual(G.longDate("2007-11-06"), "November 6, 2007");
assert.throws(() => G.parseInfo("no idea"), /no list/);
console.log("ok  game details from an AI: your rules in the prompt, dates in words read back, only empty fields filled, your values win");
console.log("0.6.9.7 TESTS PASSED");
